import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RepositorioPagosFalso } from '@/test/fixtures/repositorioPagosFalso';
import { ErrorWompi, type TransaccionWompi } from '../wompi/cliente';
import type { CobroParaPago } from './confirmarPago';
import { confirmarDesdeRetorno, type DepsRetorno, type ParametrosRetorno } from './confirmarPorRedirect';

// MUTATION-TESTING (cada fila se corrió: romper, ver fallar con ESE test, restaurar):
//   - no exigir que el cobro sea de la cuenta de la sesión → falla "un cobro de OTRA cuenta es inválido"
//   - confiar en los parámetros sin consultar la API        → falla "si la API dice que no está aprobada, no se aplica"
//   - hacer bloqueante el hash del redirect                 → falla "un hash que no coincide NO bloquea"
//   - tratar un 404 como error                              → falla "si Wompi todavía no la refleja, sigue confirmando"
//   - aplicar aunque la API devuelva otra transacción      → falla "una transacción con otro id que el del redirect es inválida"

const SECRETO = 'secreto-de-prueba';
const CUENTA = '11111111-1111-4111-8111-111111111111';
const OTRA_CUENTA = '99999999-9999-4999-8999-999999999999';
const COBRO = '22222222-2222-4222-8222-222222222222';
const TX = 'd0efabed-12e0-4915-abc1-0d3689906700';

const cobro = (extra: Partial<CobroParaPago> = {}): CobroParaPago => ({
  id: COBRO, cuentaId: CUENTA, tipo: 'periodo', estado: 'pendiente', monto: 49, planDestino: 'growth', wompiIdTransaccion: null, ...extra,
});

const transaccion = (extra: Partial<TransaccionWompi> = {}): TransaccionWompi => ({
  idTransaccion: TX, esReal: true, esAprobada: true, monto: 49, fecha: '2026-09-15T18:00:00Z', datosAdicionales: null, ...extra,
});

function hashDe(idEnlace: string, monto: string): string {
  return createHmac('sha256', SECRETO).update(COBRO + TX + idEnlace + monto).digest('hex');
}

const params = (extra: ParametrosRetorno = {}): ParametrosRetorno => ({
  identificadorEnlaceComercio: COBRO,
  idTransaccion: TX,
  idEnlace: '66',
  monto: '49',
  hash: hashDe('66', '49'),
  ...extra,
});

function armar(opciones: { cobro?: CobroParaPago | null; transaccion?: TransaccionWompi | Error } = {}) {
  const c = opciones.cobro === undefined ? cobro() : opciones.cobro;
  const repo = new RepositorioPagosFalso(c);
  const avisos: string[] = [];
  const advertencias: string[] = [];
  const consultas: string[] = [];
  const deps: DepsRetorno = {
    repo,
    wompi: {
      async consultarTransaccion(id) {
        consultas.push(id);
        const t = opciones.transaccion ?? transaccion();
        if (t instanceof Error) throw t;
        return t;
      },
    },
    // Scopeado por cuenta, igual que `obtenerCobro` de cobros.ts.
    async obtenerCobroDeLaCuenta(cuentaId, cobroId) {
      const encontrado = repo.cobros.get(cobroId);
      return encontrado && encontrado.cuentaId === cuentaId ? { ...encontrado } : null;
    },
    secreto: SECRETO,
    aceptarPruebas: false,
    hoy: '2026-09-15',
    alReclamar: (x) => void avisos.push(x.id),
    advertir: (m) => void advertencias.push(m),
  };
  return { deps, repo, avisos, advertencias, consultas };
}

describe('confirmar desde el redirect', () => {
  it('una transacción aprobada y real aplica el plan, paga el cobro y avisa a Meta una vez', async () => {
    const { deps, repo, avisos } = armar();
    expect(await confirmarDesdeRetorno(deps, CUENTA, params())).toEqual({ estado: 'confirmado' });
    expect(repo.cobros.get(COBRO)).toMatchObject({ estado: 'pagado', wompiIdTransaccion: TX });
    expect(repo.planesAplicados).toHaveLength(1);
    expect(avisos).toEqual([COBRO]);
    expect([...repo.eventos.values()][0]).toMatchObject({ idTransaccion: TX, conciliacion: 'aplicado' });
  });

  it('si el webhook ya lo aplicó, confirma sin consultar a Wompi', async () => {
    const { deps, consultas } = armar({ cobro: cobro({ estado: 'pagado', wompiIdTransaccion: TX }) });
    expect(await confirmarDesdeRetorno(deps, CUENTA, params())).toEqual({ estado: 'confirmado' });
    expect(consultas).toEqual([]);
  });

  it('recargar la página no aplica dos veces', async () => {
    const { deps, repo, avisos } = armar();
    await confirmarDesdeRetorno(deps, CUENTA, params());
    await confirmarDesdeRetorno(deps, CUENTA, params());
    expect(repo.planesAplicados).toHaveLength(1);
    expect(avisos).toHaveLength(1);
  });
});

describe('lo que NO confirma', () => {
  it('un cobro de OTRA cuenta es inválido: un identificador ajeno no aplica nada', async () => {
    const { deps, repo, consultas } = armar({ cobro: cobro({ cuentaId: OTRA_CUENTA }) });
    expect(await confirmarDesdeRetorno(deps, CUENTA, params())).toEqual({ estado: 'invalido' });
    expect(consultas).toEqual([]);
    expect(repo.cobros.get(COBRO)?.estado).toBe('pendiente');
  });

  it.each([
    ['sin identificador', { identificadorEnlaceComercio: null }],
    ['con un identificador que no es UUID', { identificadorEnlaceComercio: 'OC1234' }],
    ['sin transacción', { idTransaccion: '' }],
  ])('parámetros %s son inválidos', async (_n, extra) => {
    const { deps } = armar();
    expect(await confirmarDesdeRetorno(deps, CUENTA, params(extra))).toEqual({ estado: 'invalido' });
  });

  it('un cobro que no existe es inválido', async () => {
    const { deps } = armar({ cobro: null });
    expect(await confirmarDesdeRetorno(deps, CUENTA, params())).toEqual({ estado: 'invalido' });
  });

  it('si la API dice que no está aprobada, no se aplica', async () => {
    const { deps, repo } = armar({ transaccion: transaccion({ esAprobada: false }) });
    expect(await confirmarDesdeRetorno(deps, CUENTA, params())).toEqual({ estado: 'rechazado' });
    expect(repo.cobros.get(COBRO)?.estado).toBe('pendiente');
  });

  it('un pago de prueba se ve como prueba y no cambia el plan', async () => {
    const { deps, repo } = armar({ transaccion: transaccion({ esReal: false }) });
    expect(await confirmarDesdeRetorno(deps, CUENTA, params())).toEqual({ estado: 'prueba' });
    expect(repo.planesAplicados).toEqual([]);
  });

  it('una transacción con otro id que el del redirect es inválida', async () => {
    const { deps, repo } = armar({ transaccion: transaccion({ idTransaccion: 'otra-transaccion' }) });
    expect(await confirmarDesdeRetorno(deps, CUENTA, params())).toEqual({ estado: 'invalido' });
    expect(repo.cobros.get(COBRO)?.estado).toBe('pendiente');
  });

  it('un monto distinto va a revisión, no se aplica', async () => {
    const { deps, repo } = armar({ transaccion: transaccion({ monto: 29 }) });
    expect(await confirmarDesdeRetorno(deps, CUENTA, params())).toEqual({ estado: 'revision' });
    expect(repo.cobros.get(COBRO)?.estado).toBe('pendiente');
  });

  it('un cobro que ya figura pagado confirma, aunque el redirect traiga otra transacción', async () => {
    // Un doble pago se detecta en el WEBHOOK de la segunda transacción (ya_pagado), no acá: el dueño ve
    // su cobro pagado, que es lo cierto, y FM ve la segunda transacción en /admin/pagos.
    const { deps, consultas } = armar({ cobro: cobro({ estado: 'pagado', wompiIdTransaccion: 'tx-anterior' }) });
    expect(await confirmarDesdeRetorno(deps, CUENTA, params({ idTransaccion: 'tx-nueva' }))).toEqual({ estado: 'confirmado' });
    expect(consultas).toEqual([]);
  });
});

describe('cuando Wompi todavía no la refleja', () => {
  it('un 404 sigue "confirmando" sin lanzar ni avisar', async () => {
    const { deps, advertencias } = armar({ transaccion: new ErrorWompi('no encontrada', 404) });
    expect(await confirmarDesdeRetorno(deps, CUENTA, params())).toEqual({ estado: 'confirmando' });
    expect(advertencias).toEqual([]);
  });

  it('otra falla de la API también sigue "confirmando", pero deja una advertencia', async () => {
    const { deps, advertencias } = armar({ transaccion: new ErrorWompi('caído', 500) });
    expect(await confirmarDesdeRetorno(deps, CUENTA, params())).toEqual({ estado: 'confirmando' });
    expect(advertencias[0]).toContain('No se pudo consultar la transacción');
  });

  it('una falla al aplicar el pago sigue "confirmando" (el webhook puede completarlo) y avisa', async () => {
    const { deps, repo, advertencias } = armar();
    repo.resultadoPlan = { ok: false, motivo: 'error', error: 'No se pudo cambiar el plan.' };
    expect(await confirmarDesdeRetorno(deps, CUENTA, params())).toEqual({ estado: 'confirmando' });
    expect(advertencias[0]).toContain('Falló al aplicar el pago');
  });
});

describe('el hash del redirect NO es bloqueante', () => {
  it('un hash que no coincide (la doc se contradice) NO bloquea: se confirma con la API y se deja una advertencia', async () => {
    const { deps, advertencias } = armar();
    const r = await confirmarDesdeRetorno(deps, CUENTA, params({ hash: 'no-coincide' }));
    expect(r).toEqual({ estado: 'confirmado' });
    expect(advertencias).toHaveLength(1);
    expect(advertencias[0]).toContain('hash del redirect');
  });

  it('un hash que coincide no deja advertencias', async () => {
    const { deps, advertencias } = armar();
    await confirmarDesdeRetorno(deps, CUENTA, params());
    expect(advertencias).toEqual([]);
  });

  it('sin hash en la URL tampoco bloquea', async () => {
    const { deps } = armar();
    expect(await confirmarDesdeRetorno(deps, CUENTA, params({ hash: null }))).toEqual({ estado: 'confirmado' });
  });
});

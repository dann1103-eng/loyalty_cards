import { describe, expect, it } from 'vitest';
import { RepositorioPagosFalso } from '@/test/fixtures/repositorioPagosFalso';
import { confirmarPagoCobro, type CobroParaPago, type Conciliacion, type EntradaPago } from './confirmarPago';
import type { PagoAdmin } from './pagosAdmin';
import { aplicarPagoAMano, marcarCobroPagadoAMano, reintentarPago, type DependenciasResolver } from './resolverPagos';

// Lo que FM hace con un pago desde /admin/pagos, contra el repositorio FALSO (mismo contrato que la base).
//
// MUTATION-TESTING (cada fila se corrió):
//   - quitar la revalidación de estado al reintentar            → falla "solo se reintenta un pago que quedó en error"
//   - quitar la revalidación de estado al aplicar a mano        → falla "solo se aplica a mano un pago de monto distinto o cobro anulado"
//   - no forzar al aplicar a mano                               → fallan "aplica a mano un pago de monto distinto", "revive un cobro anulado" y "un plan que no cupo…"
//   - no dejar revisado el evento que se reprocesó bajo otro id → falla "un evento sin identificador reprocesado…"
//   - dejar revisado siempre, aunque el id no cambie            → falla "reintentar con el mismo id no marca nada como revisado"
//   - no atrapar el error de confirmarPagoCobro                 → falla "una falla interna se devuelve como error, no se lanza"
//   - no exigir cobro pendiente al marcarlo pagado              → falla "no marca pagado un cobro que ya no está pendiente"
//   - no distinguir el mensaje de un resultado que no es aplicado → falla "un plan que no cupo se informa con su etiqueta y su detalle"
//   - marcar a mano con un id de transacción que no es por cobro → falla "marcar dos veces el mismo cobro (pantalla vieja) no aplica ni avisa dos veces"

const CUENTA = '11111111-1111-4111-8111-111111111111';
const COBRO = '22222222-2222-4222-8222-222222222222';
const HOY = '2026-09-15';

const cobroBase = (extra: Partial<CobroParaPago> = {}): CobroParaPago => ({
  id: COBRO, cuentaId: CUENTA, tipo: 'periodo', estado: 'pendiente', monto: 49, planDestino: 'growth', wompiIdTransaccion: null, ...extra,
});

const cuerpo = (extra: Record<string, unknown> = {}) => ({
  IdTransaccion: 'tx-1',
  Monto: 49,
  EsProductiva: true,
  ResultadoTransaccion: 'ExitosaAprobada',
  FechaTransaccion: '2026-09-15T18:00:00Z',
  EnlacePago: { Id: 66, IdentificadorEnlaceComercio: COBRO },
  ...extra,
});

interface Entorno {
  repo: RepositorioPagosFalso;
  deps: DependenciasResolver;
  reclamados: CobroParaPago[];
  revisados: Array<{ id: string; detalle: string }>;
}

function entorno(cobro: CobroParaPago | null = cobroBase()): Entorno {
  const repo = new RepositorioPagosFalso(cobro);
  const reclamados: CobroParaPago[] = [];
  const revisados: Array<{ id: string; detalle: string }> = [];
  return {
    repo,
    reclamados,
    revisados,
    deps: {
      repo,
      hoy: HOY,
      aceptarPruebas: false,
      alReclamar: (c) => void reclamados.push(c),
      marcarRevisado: async (id, detalle) => void revisados.push({ id, detalle }),
    },
  };
}

// Lo que el panel le pasa a la acción: la fila guardada, tal como la leería `listarPagos`.
function comoPagoAdmin(repo: RepositorioPagosFalso, eventoId: string, payload: unknown): PagoAdmin {
  const e = repo.eventos.get(eventoId)!;
  return {
    id: e.id, idTransaccion: e.idTransaccion, fuente: 'webhook', cobroId: e.cobroId, cuentaId: e.cuentaId,
    cuentaNombre: null, identificadorEnlace: null, monto: 0, esReal: true, fecha: null,
    conciliacion: e.conciliacion, detalle: e.detalle, revisadoEn: null, payload: payload as PagoAdmin['payload'],
    creadoEn: '2026-09-15T18:00:00Z',
  };
}

const entradaWebhook = (extra: Partial<EntradaPago> = {}): EntradaPago => ({
  fuente: 'webhook', idTransaccion: 'tx-1', monto: 49, esReal: true, aprobada: true,
  identificadorEnlace: COBRO, fecha: '2026-09-15T18:00:00.000Z', payload: cuerpo(), ...extra,
});

// Un evento sembrado a la fuerza en `conciliacion` (sin haber pasado por el flujo).
async function sembrar(repo: RepositorioPagosFalso, idTransaccion: string, conciliacion: Conciliacion, payload: unknown) {
  const e = await repo.registrarEvento({
    idTransaccion, fuente: 'webhook', identificadorEnlace: null, monto: 0, esReal: true, fecha: null, payload, conciliacion,
  });
  return comoPagoAdmin(repo, e.id, payload);
}

describe('reintentarPago', () => {
  it('reprocesa un evento que quedó en error: aplica el plan, paga el cobro y avisa a Meta una vez', async () => {
    const { repo, deps, reclamados } = entorno();
    const evento = await sembrar(repo, 'tx-1', 'error', cuerpo());

    const r = await reintentarPago(deps, evento);

    expect(r).toEqual({ ok: true, conciliacion: 'aplicado', mensaje: 'Listo: el pago quedó aplicado.' });
    expect(repo.cobros.get(COBRO)?.estado).toBe('pagado');
    expect(repo.planesAplicados).toEqual([{ cuentaId: CUENTA, plan: 'growth', tipo: 'periodo' }]);
    expect(reclamados.map((c) => c.id)).toEqual([COBRO]);
  });

  it('solo se reintenta un pago que quedó en error', async () => {
    const { repo, deps } = entorno();
    const evento = await sembrar(repo, 'tx-1', 'ya_pagado', cuerpo());

    const r = await reintentarPago(deps, evento);

    expect(r).toEqual({ ok: false, error: 'Este pago no se puede reintentar: solo se reintentan los que quedaron en error.' });
    expect(repo.llamadas).toEqual([]);
    expect(repo.cobros.get(COBRO)?.estado).toBe('pendiente');
  });

  it('un evento sin identificador reprocesado con un parser arreglado nace como evento nuevo y deja revisado el viejo', async () => {
    const { repo, deps, revisados } = entorno();
    const evento = await sembrar(repo, 'sin-id-abc', 'error', cuerpo({ IdTransaccion: 'tx-real' }));

    const r = await reintentarPago(deps, evento);

    expect(r).toMatchObject({ ok: true, conciliacion: 'aplicado' });
    expect(repo.cobros.get(COBRO)?.wompiIdTransaccion).toBe('tx-real');
    expect(revisados).toEqual([{ id: evento.id, detalle: 'Reprocesado como la transacción tx-real.' }]);
  });

  it('reintentar con el mismo id no marca nada como revisado', async () => {
    const { repo, deps, revisados } = entorno();
    await reintentarPago(deps, await sembrar(repo, 'tx-1', 'error', cuerpo()));
    expect(revisados).toEqual([]);
  });

  it('un cuerpo que sigue sin reconocerse devuelve el motivo y no toca nada', async () => {
    const { repo, deps, revisados } = entorno();
    const evento = await sembrar(repo, 'sin-id-abc', 'error', { algo: 1 });

    const r = await reintentarPago(deps, evento);

    expect(r).toEqual({ ok: false, error: 'El cuerpo guardado sigue sin reconocerse: falta IdTransaccion.' });
    expect(repo.llamadas).toEqual([]);
    expect(revisados).toEqual([]);
  });

  it('una falla interna se devuelve como error, no se lanza', async () => {
    const repo = new RepositorioPagosFalso(cobroBase(), { aplicarPlan: 1 });
    const deps: DependenciasResolver = { repo, hoy: HOY, aceptarPruebas: false, marcarRevisado: async () => undefined };
    const evento = await sembrar(repo, 'tx-1', 'error', cuerpo());

    const r = await reintentarPago(deps, evento);

    expect(r).toEqual({ ok: false, error: 'No se pudo procesar: se cayó la base al aplicar el plan' });
    expect(repo.cobros.get(COBRO)?.estado).toBe('pendiente');
  });

  it('el reintento es seguro de repetir: la segunda vez no aplica ni avisa de nuevo', async () => {
    const { repo, deps, reclamados } = entorno();
    const evento = await sembrar(repo, 'tx-1', 'error', cuerpo());
    await reintentarPago(deps, evento);
    // La pantalla no se refrescó: el evento sigue viéndose como `error`.
    const r = await reintentarPago(deps, evento);

    expect(r).toMatchObject({ ok: true, conciliacion: 'aplicado' });
    expect(reclamados).toHaveLength(1);
    expect(repo.planesAplicados).toHaveLength(1);
  });
});

describe('aplicarPagoAMano', () => {
  async function eventoProcesado(repo: RepositorioPagosFalso, entrada: EntradaPago): Promise<PagoAdmin> {
    await confirmarPagoCobro(repo, entrada, { aceptarPruebas: false, hoy: HOY });
    const id = [...repo.eventos.values()].find((e) => e.idTransaccion === entrada.idTransaccion)!.id;
    return comoPagoAdmin(repo, id, entrada.payload);
  }

  it('aplica a mano un pago de monto distinto', async () => {
    const { repo, deps, reclamados } = entorno();
    const evento = await eventoProcesado(repo, entradaWebhook({ monto: 50, payload: cuerpo({ Monto: 50 }) }));
    expect(evento.conciliacion).toBe('monto_distinto');
    expect(repo.cobros.get(COBRO)?.estado).toBe('pendiente');

    const r = await aplicarPagoAMano(deps, evento);

    expect(r).toEqual({ ok: true, conciliacion: 'aplicado', mensaje: 'Listo: el pago quedó aplicado.' });
    expect(repo.cobros.get(COBRO)?.estado).toBe('pagado');
    expect(reclamados).toHaveLength(1);
  });

  it('revive un cobro anulado cuya plata sí entró', async () => {
    const { repo, deps } = entorno(cobroBase({ estado: 'anulado' }));
    const evento = await eventoProcesado(repo, entradaWebhook());
    expect(evento.conciliacion).toBe('cobro_anulado');

    const r = await aplicarPagoAMano(deps, evento);

    expect(r).toMatchObject({ ok: true, conciliacion: 'aplicado' });
    expect(repo.cobros.get(COBRO)?.estado).toBe('pagado');
  });

  it('solo se aplica a mano un pago de monto distinto o cobro anulado', async () => {
    const { repo, deps } = entorno();
    const evento = await sembrar(repo, 'tx-1', 'ya_pagado', cuerpo());

    const r = await aplicarPagoAMano(deps, evento);

    expect(r).toEqual({ ok: false, error: 'Este pago no se puede aplicar a mano: solo los de monto distinto o cobro anulado.' });
    expect(repo.llamadas).toEqual([]);
  });

  it('un plan que no cupo se informa con su etiqueta y su detalle', async () => {
    const { repo, deps } = entorno();
    repo.resultadoPlan = { ok: false, motivo: 'cupo', error: 'Tiene 5 negocios y el plan permite 3.' };
    const evento = await eventoProcesado(repo, entradaWebhook({ monto: 50, payload: cuerpo({ Monto: 50 }) }));

    const r = await aplicarPagoAMano(deps, evento);

    expect(r).toEqual({
      ok: true,
      conciliacion: 'plan_no_aplicable',
      mensaje: 'Quedó como «Plan no aplicado»: Tiene 5 negocios y el plan permite 3.',
    });
  });
});

describe('marcarCobroPagadoAMano', () => {
  it('marca pagado un cobro pendiente, aplica su plan y deja un evento manual', async () => {
    const { repo, deps, reclamados } = entorno();

    const r = await marcarCobroPagadoAMano(deps, cobroBase());

    expect(r).toEqual({ ok: true, conciliacion: 'aplicado', mensaje: 'Listo: el pago quedó aplicado.' });
    expect(repo.cobros.get(COBRO)?.estado).toBe('pagado');
    expect(repo.cobros.get(COBRO)?.wompiIdTransaccion).toBe(`manual-${COBRO}`);
    expect(repo.planesAplicados).toEqual([{ cuentaId: CUENTA, plan: 'growth', tipo: 'periodo' }]);
    expect(repo.licencias).toEqual([CUENTA]);
    expect(reclamados).toHaveLength(1);
  });

  it('un ajuste marcado a mano aplica el plan pero no dispara Meta', async () => {
    const { repo, deps, reclamados } = entorno(cobroBase({ tipo: 'ajuste' }));
    await marcarCobroPagadoAMano(deps, cobroBase({ tipo: 'ajuste' }));
    expect(repo.planesAplicados).toEqual([{ cuentaId: CUENTA, plan: 'growth', tipo: 'ajuste' }]);
    expect(reclamados).toEqual([]);
  });

  it('no marca pagado un cobro que ya no está pendiente', async () => {
    const { repo, deps } = entorno(cobroBase({ estado: 'pagado' }));
    const r = await marcarCobroPagadoAMano(deps, cobroBase({ estado: 'pagado' }));
    expect(r).toEqual({ ok: false, error: 'Solo se puede marcar como pagado un cobro pendiente.' });
    expect(repo.llamadas).toEqual([]);
    expect(repo.eventos.size).toBe(0);
  });

  it('marcar dos veces el mismo cobro (pantalla vieja) no aplica ni avisa dos veces', async () => {
    const { repo, deps, reclamados } = entorno();
    await marcarCobroPagadoAMano(deps, cobroBase());
    // La pantalla no se refrescó: sigue creyendo que el cobro está pendiente.
    const r = await marcarCobroPagadoAMano(deps, cobroBase());

    expect(r).toMatchObject({ ok: true, conciliacion: 'aplicado' });
    expect(repo.planesAplicados).toHaveLength(1);
    expect(reclamados).toHaveLength(1);
    expect(repo.eventos.size).toBe(1);
  });
});

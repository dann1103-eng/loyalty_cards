import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatosEnlace } from '../wompi/cliente';
import type { CuentaParaPagos } from './opcionesPago';
import {
  iniciarPagoPlan,
  VIGENCIA_ENLACE_MS,
  type DepsIniciarPago,
  type IntentoAbierto,
  type RepositorioIniciarPago,
  type ResultadoCrearCobro,
} from './iniciarPagoPlan';

// Sin base de datos y sin red: repositorio, cliente de Wompi y reloj son falsos.
//
// MUTATION-TESTING (cada fila se corrió: romper, ver fallar con ESE test, restaurar):
//   - aceptar una opción que no está entre las calculadas   → falla "un plan que no se ofrece se rechaza…"
//   - ignorar el bloqueo por cupo                            → falla "una opción bloqueada por cupo se rechaza…"
//   - no anular el intento anterior antes de crear otro      → falla "otra opción anula el intento anterior…"
//   - reusar aunque el intento sea de otro día               → falla "un intento de ayer no se reusa"
//   - reusar aunque el enlace haya vencido                   → falla "un enlace vencido no se reusa"
//   - reusar aunque el monto sea otro                        → falla "un intento con otro monto no se reusa"
//   - vigencia de 48 h en vez de 2 h                         → falla "el enlace vence a las 2 horas"
//   - el identificador del enlace no es el id del cobro      → falla "el enlace lleva el id del cobro…"
//   - no anular el cobro si Wompi falla                      → falla "si Wompi falla, el cobro se anula…"
//   - tomar el monto de otra parte que de la opción          → falla "el importe sale de las opciones del servidor"

const CUENTA = '11111111-1111-4111-8111-111111111111';
const COBRO = '33333333-3333-4333-8333-333333333333';
const AHORA = new Date('2026-09-15T18:00:00.000Z'); // 12:00 en El Salvador

const cuentaStarter: CuentaParaPagos = {
  plan: 'starter',
  precioActual: 29,
  limite: 1,
  unidadesUsadas: 1,
  periodosPagados: [{ desde: '2026-09-01', hasta: '2026-09-30' }],
};

class RepoIniciarFalso implements RepositorioIniciarPago {
  cobrosCreados: Array<{ id: string; datos: Parameters<RepositorioIniciarPago['crearCobro']>[1] }> = [];
  enlacesGuardados: Array<{ cobroId: string; enlace: { idEnlace: number; url: string; vence: string } }> = [];
  anulados: string[] = [];
  intentosAnulados = 0;
  llamadas: string[] = [];
  resultadoCrear: ResultadoCrearCobro = { ok: true, id: COBRO };

  constructor(
    public cuenta: CuentaParaPagos | null = cuentaStarter,
    public abierto: IntentoAbierto | null = null,
  ) {}

  async cargarCuenta() {
    return this.cuenta;
  }
  async intentoAbierto() {
    return this.abierto;
  }
  async anularIntentos() {
    this.llamadas.push('anularIntentos');
    this.intentosAnulados += 1;
  }
  async crearCobro(_cuentaId: string, datos: Parameters<RepositorioIniciarPago['crearCobro']>[1]) {
    this.llamadas.push('crearCobro');
    if (this.resultadoCrear.ok) this.cobrosCreados.push({ id: this.resultadoCrear.id, datos });
    return this.resultadoCrear;
  }
  async guardarEnlace(cobroId: string, enlace: { idEnlace: number; url: string; vence: string }) {
    this.enlacesGuardados.push({ cobroId, enlace });
  }
  async anularCobro(cobroId: string) {
    this.anulados.push(cobroId);
  }
}

function armar(repo: RepoIniciarFalso, opciones: { wompiFalla?: boolean } = {}) {
  const enlaces: DatosEnlace[] = [];
  const deps: DepsIniciarPago = {
    repo,
    wompi: {
      async crearEnlacePago(datos) {
        if (opciones.wompiFalla) throw new Error('Wompi devolvió 500');
        enlaces.push(datos);
        return { idEnlace: 15, urlEnlace: 'https://lk.wompi.sv/yhDt', urlEnlaceLargo: null, esProductivo: false };
      },
    },
    ahora: () => AHORA,
    // El día de El Salvador (UTC−6, sin horario de verano).
    fechaDe: (instante) => new Date(instante.getTime() - 6 * 3_600_000).toISOString().slice(0, 10),
    baseUrl: 'https://www.cardly-sv.site',
  };
  return { deps, enlaces };
}

afterEach(() => vi.restoreAllMocks());

describe('crear el intento de pago', () => {
  it('a mitad de período crea el cobro de ajuste con el importe, el período y la nota del servidor', async () => {
    const repo = new RepoIniciarFalso();
    const { deps, enlaces } = armar(repo);

    const r = await iniciarPagoPlan(deps, { cuentaId: CUENTA, plan: 'growth', accion: 'cambiar' });

    expect(r).toEqual({ ok: true, url: 'https://lk.wompi.sv/yhDt' });
    expect(repo.cobrosCreados).toEqual([
      {
        id: COBRO,
        datos: {
          tipo: 'ajuste',
          periodoDesde: '2026-09-15',
          periodoHasta: '2026-09-30',
          monto: 10.67,
          planDestino: 'growth',
          nota: 'Starter → Growth, 16 de 30 días',
        },
      },
    ]);
    expect(enlaces[0].monto).toBe(10.67);
  });

  it('el importe sale de las opciones del servidor: la entrada solo trae plan y acción', async () => {
    const repo = new RepoIniciarFalso();
    const { deps } = armar(repo);
    await iniciarPagoPlan(deps, { cuentaId: CUENTA, plan: 'pro', accion: 'cambiar', monto: 0.01 } as never);
    expect(repo.cobrosCreados[0].datos.monto).toBe(32);
  });

  it('el enlace lleva el id del cobro, las URLs de la app y los datos de correlación', async () => {
    const repo = new RepoIniciarFalso();
    const { deps, enlaces } = armar(repo);
    await iniciarPagoPlan(deps, { cuentaId: CUENTA, plan: 'growth', accion: 'cambiar' });

    expect(enlaces[0]).toMatchObject({
      identificador: COBRO,
      nombreProducto: 'Cardly SV · Ajuste al plan Growth',
      descripcion: 'Starter → Growth, 16 de 30 días',
      urlRedirect: 'https://www.cardly-sv.site/comercio/plan/pago/resultado',
      urlRetorno: 'https://www.cardly-sv.site/comercio/plan',
      urlWebhook: 'https://www.cardly-sv.site/api/wompi/webhook',
      datosAdicionales: { cobro: COBRO, cuenta: CUENTA },
    });
  });

  it('el enlace vence a las 2 horas, y se guarda con su vencimiento', async () => {
    const repo = new RepoIniciarFalso();
    const { deps, enlaces } = armar(repo);
    await iniciarPagoPlan(deps, { cuentaId: CUENTA, plan: 'growth', accion: 'cambiar' });

    expect(VIGENCIA_ENLACE_MS).toBe(7_200_000);
    expect(enlaces[0].venceEn.getTime() - enlaces[0].ahora.getTime()).toBe(7_200_000);
    expect(repo.enlacesGuardados).toEqual([
      { cobroId: COBRO, enlace: { idEnlace: 15, url: 'https://lk.wompi.sv/yhDt', vence: '2026-09-15T20:00:00.000Z' } },
    ]);
  });

  it('en la ventana crea un cobro de período completo por el precio del plan elegido', async () => {
    const repo = new RepoIniciarFalso({ ...cuentaStarter, periodosPagados: [{ desde: '2026-09-01', hasta: '2026-09-20' }] });
    const { deps, enlaces } = armar(repo);
    // Con el período que termina el 20, hoy (15) ya está en la ventana de 7 días.
    const r = await iniciarPagoPlan(deps, { cuentaId: CUENTA, plan: 'growth', accion: 'renovar' });
    expect(r.ok).toBe(true);
    expect(repo.cobrosCreados[0].datos).toMatchObject({ tipo: 'periodo', monto: 49, periodoDesde: '2026-09-21', periodoHasta: '2026-10-20', planDestino: 'growth', nota: null });
    expect(enlaces[0].nombreProducto).toBe('Cardly SV · Plan Growth (2026-09-21 al 2026-10-20)');
  });
});

describe('lo que se rechaza', () => {
  it('un plan que no se ofrece se rechaza sin crear nada ni llamar a Wompi', async () => {
    const repo = new RepoIniciarFalso();
    const { deps, enlaces } = armar(repo);
    for (const entrada of [
      { plan: 'starter', accion: 'cambiar' as const }, // no es subir
      { plan: 'growth', accion: 'renovar' as const }, // a mitad de período no se renueva
      { plan: 'inventado', accion: 'cambiar' as const },
    ]) {
      const r = await iniciarPagoPlan(deps, { cuentaId: CUENTA, ...entrada });
      expect(r).toEqual({ ok: false, error: 'Esa opción no está disponible ahora. Recargá la página.' });
    }
    expect(repo.cobrosCreados).toEqual([]);
    expect(enlaces).toEqual([]);
  });

  it('cuando no hay nada que ofrecer, dice por qué', async () => {
    const renovado = { ...cuentaStarter, periodosPagados: [{ desde: '2026-09-01', hasta: '2026-09-30' }, { desde: '2026-10-01', hasta: '2026-10-31' }] };
    const repo = new RepoIniciarFalso(renovado);
    const r = await iniciarPagoPlan(armar(repo).deps, { cuentaId: CUENTA, plan: 'growth', accion: 'cambiar' });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('Ya pagaste el próximo período') });
  });

  it('una opción bloqueada por cupo se rechaza con el mensaje de cuánto usa', async () => {
    const repo = new RepoIniciarFalso({
      plan: 'growth', precioActual: 49, limite: 3, unidadesUsadas: 3,
      periodosPagados: [{ desde: '2026-09-01', hasta: '2026-09-20' }],
    });
    const r = await iniciarPagoPlan(armar(repo).deps, { cuentaId: CUENTA, plan: 'starter', accion: 'renovar' });
    expect(r).toEqual({ ok: false, error: 'Tu cuenta usa 3 unidades y el plan Starter permite 1. Desactivá negocios o sucursales antes de elegirlo.' });
    expect(repo.cobrosCreados).toEqual([]);
  });

  it('una cuenta que no existe no crea nada', async () => {
    const repo = new RepoIniciarFalso(null);
    const r = await iniciarPagoPlan(armar(repo).deps, { cuentaId: CUENTA, plan: 'growth', accion: 'cambiar' });
    expect(r).toEqual({ ok: false, error: 'No se pudo leer tu cuenta.' });
  });
});

describe('un solo intento abierto', () => {
  const abierto = (extra: Partial<IntentoAbierto> = {}): IntentoAbierto => ({
    cobroId: COBRO,
    tipo: 'ajuste',
    planDestino: 'growth',
    monto: 10.67,
    periodoDesde: '2026-09-15',
    creadoEn: '2026-09-15T17:00:00.000Z',
    enlaceUrl: 'https://lk.wompi.sv/previo',
    enlaceVence: '2026-09-15T19:00:00.000Z',
    ...extra,
  });

  it('el mismo intento, de hoy y con el enlace vigente, se reusa: no crea cobro ni enlace', async () => {
    const repo = new RepoIniciarFalso(cuentaStarter, abierto());
    const { deps, enlaces } = armar(repo);
    const r = await iniciarPagoPlan(deps, { cuentaId: CUENTA, plan: 'growth', accion: 'cambiar' });
    expect(r).toEqual({ ok: true, url: 'https://lk.wompi.sv/previo' });
    expect(repo.cobrosCreados).toEqual([]);
    expect(enlaces).toEqual([]);
    expect(repo.intentosAnulados).toBe(0);
  });

  it('otra opción anula el intento anterior y crea uno nuevo, EN ESE ORDEN', async () => {
    const repo = new RepoIniciarFalso(cuentaStarter, abierto({ planDestino: 'pro', monto: 32 }));
    await iniciarPagoPlan(armar(repo).deps, { cuentaId: CUENTA, plan: 'growth', accion: 'cambiar' });
    expect(repo.llamadas).toEqual(['anularIntentos', 'crearCobro']);
  });

  it('un intento de ayer no se reusa', async () => {
    const repo = new RepoIniciarFalso(cuentaStarter, abierto({ creadoEn: '2026-09-14T17:00:00.000Z' }));
    await iniciarPagoPlan(armar(repo).deps, { cuentaId: CUENTA, plan: 'growth', accion: 'cambiar' });
    expect(repo.intentosAnulados).toBe(1);
    expect(repo.cobrosCreados).toHaveLength(1);
  });

  it('un enlace vencido no se reusa', async () => {
    const repo = new RepoIniciarFalso(cuentaStarter, abierto({ enlaceVence: '2026-09-15T17:59:59.000Z' }));
    await iniciarPagoPlan(armar(repo).deps, { cuentaId: CUENTA, plan: 'growth', accion: 'cambiar' });
    expect(repo.intentosAnulados).toBe(1);
    expect(repo.cobrosCreados).toHaveLength(1);
  });

  it('un intento con otro monto no se reusa', async () => {
    const repo = new RepoIniciarFalso(cuentaStarter, abierto({ monto: 10.66 }));
    await iniciarPagoPlan(armar(repo).deps, { cuentaId: CUENTA, plan: 'growth', accion: 'cambiar' });
    expect(repo.cobrosCreados).toHaveLength(1);
  });

  it('un intento sin enlace guardado no se reusa', async () => {
    const repo = new RepoIniciarFalso(cuentaStarter, abierto({ enlaceUrl: null, enlaceVence: null }));
    await iniciarPagoPlan(armar(repo).deps, { cuentaId: CUENTA, plan: 'growth', accion: 'cambiar' });
    expect(repo.cobrosCreados).toHaveLength(1);
  });

  it('si la base rechaza el cobro por el índice de un solo intento, lo dice sin lanzar', async () => {
    const repo = new RepoIniciarFalso();
    repo.resultadoCrear = { ok: false, error: 'x', intentoAbierto: true };
    const r = await iniciarPagoPlan(armar(repo).deps, { cuentaId: CUENTA, plan: 'growth', accion: 'cambiar' });
    expect(r).toEqual({ ok: false, error: 'Ya tenés un pago en curso. Recargá la página.' });
  });

  it('otro error al crear el cobro se devuelve tal cual', async () => {
    const repo = new RepoIniciarFalso();
    repo.resultadoCrear = { ok: false, error: 'No se pudo registrar el cobro.' };
    const r = await iniciarPagoPlan(armar(repo).deps, { cuentaId: CUENTA, plan: 'growth', accion: 'cambiar' });
    expect(r).toEqual({ ok: false, error: 'No se pudo registrar el cobro.' });
  });
});

describe('si Wompi falla', () => {
  it('el cobro se anula (no queda un pago pendiente fantasma) y el dueño ve un mensaje sin detalles internos', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const repo = new RepoIniciarFalso();
    const r = await iniciarPagoPlan(armar(repo, { wompiFalla: true }).deps, { cuentaId: CUENTA, plan: 'growth', accion: 'cambiar' });

    expect(r).toEqual({ ok: false, error: 'No pudimos generar el enlace de pago. Probá de nuevo en un rato.' });
    expect(repo.anulados).toEqual([COBRO]);
    expect(repo.enlacesGuardados).toEqual([]);
  });
});

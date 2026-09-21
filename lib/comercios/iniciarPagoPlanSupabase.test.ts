import { afterEach, describe, expect, it } from 'vitest';
import type { DatosEnlace } from '../wompi/cliente';
import { createServiceClient } from '../supabase/server';
import { registrarCobro } from './cobros';
import { iniciarPagoPlan } from './iniciarPagoPlan';
import { cargarCuentaParaPagos, repositorioIniciarPagoSupabase } from './iniciarPagoPlanSupabase';

// Contra Supabase (necesita .env.local y la migración 0037). Wompi es falso: no se llama a ninguna API.

const supabase = createServiceClient();
const cuentas: string[] = [];
const comercios: string[] = [];
const sucursales: string[] = [];

afterEach(async () => {
  if (sucursales.length) await supabase.from('sucursales').delete().in('id', sucursales.splice(0));
  if (comercios.length) await supabase.from('comercios').delete().in('id', comercios.splice(0));
  if (cuentas.length) {
    await supabase.from('cobros').delete().in('cuenta_id', cuentas);
    await supabase.from('cuentas_comercio').delete().in('id', cuentas.splice(0));
  }
});

const sufijo = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function crearCuenta(campos: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await supabase
    .from('cuentas_comercio')
    .insert({ nombre: `Cuenta Iniciar ${sufijo()}`, ...campos })
    .select('id')
    .single();
  if (error) throw error;
  cuentas.push(data.id);
  return data.id;
}

// Un período pagado (lo registra FM a mano, como hoy) que contiene el día de la prueba.
async function pagarPeriodo(cuentaId: string, desde: string, hasta: string) {
  const r = await registrarCobro(supabase, cuentaId, {
    periodoDesde: desde, periodoHasta: hasta, monto: 29,
    estado: 'pagado', metodo: 'Transferencia', nota: null, pagadoEn: desde,
  });
  if (!r.ok) throw new Error(r.error);
}

// El período pagado más largo posible que contiene "hoy" de El Salvador, para que la prueba no dependa del día.
function hoySv(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/El_Salvador' }).format(new Date());
}
function sumar(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  f.setUTCDate(f.getUTCDate() + dias);
  return f.toISOString().slice(0, 10);
}

function wompiFalso() {
  const enlaces: DatosEnlace[] = [];
  return {
    enlaces,
    wompi: {
      async crearEnlacePago(datos: DatosEnlace) {
        enlaces.push(datos);
        return { idEnlace: enlaces.length, urlEnlace: `https://lk.wompi.sv/enlace-${enlaces.length}`, urlEnlaceLargo: null, esProductivo: false };
      },
    },
  };
}

function deps(wompi: ReturnType<typeof wompiFalso>['wompi']) {
  return {
    repo: repositorioIniciarPagoSupabase(supabase),
    wompi,
    ahora: () => new Date(),
    fechaDe: (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/El_Salvador' }).format(d),
    baseUrl: 'https://www.cardly-sv.site',
  };
}

describe('cargarCuentaParaPagos', () => {
  it('junta el plan, el precio, el límite, el cupo usado y los períodos pagados', async () => {
    const cuentaId = await crearCuenta({ plan: 'growth', licencia_monto_mensual: 45, limite_negocios: 3 });
    await pagarPeriodo(cuentaId, '2026-08-01', '2026-08-31');
    const { data: comercio } = await supabase.from('comercios').insert({ nombre: 'C', slug: `test-iniciar-${sufijo()}`, cuenta_id: cuentaId }).select('id').single();
    comercios.push(comercio!.id);

    expect(await cargarCuentaParaPagos(supabase, cuentaId)).toEqual({
      plan: 'growth',
      precioActual: 45,
      limite: 3,
      unidadesUsadas: 1,
      periodosPagados: [{ desde: '2026-08-01', hasta: '2026-08-31' }],
    });
  });

  it('una cuenta sin plan ni precio los devuelve en null', async () => {
    const cuentaId = await crearCuenta();
    expect(await cargarCuentaParaPagos(supabase, cuentaId)).toMatchObject({ plan: null, precioActual: null, periodosPagados: [] });
  });

  it('una cuenta que no existe devuelve null', async () => {
    expect(await cargarCuentaParaPagos(supabase, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('iniciarPagoPlan sobre Supabase', () => {
  it('sin período pagado: crea el cobro de la app con su plan destino y guarda el enlace', async () => {
    const cuentaId = await crearCuenta({ plan: null, licencia_monto_mensual: null, limite_negocios: null });
    const { wompi, enlaces } = wompiFalso();

    const r = await iniciarPagoPlan(deps(wompi), { cuentaId, plan: 'growth', accion: 'activar' });

    expect(r).toEqual({ ok: true, url: 'https://lk.wompi.sv/enlace-1' });
    const { data: cobro } = await supabase.from('cobros').select('*').eq('cuenta_id', cuentaId).single();
    expect(cobro).toMatchObject({
      estado: 'pendiente', metodo: 'Wompi', tipo: 'periodo', plan_destino: 'growth',
      wompi_id_enlace: 1, wompi_url_enlace: 'https://lk.wompi.sv/enlace-1',
    });
    expect(Number(cobro!.monto)).toBe(49);
    expect(enlaces[0].identificador).toBe(cobro!.id);
    expect(new Date(cobro!.wompi_enlace_vence!).getTime() - new Date(cobro!.created_at).getTime()).toBeGreaterThan(0);
  });

  it('a mitad de período crea un ajuste, sin abrir período', async () => {
    const hoy = hoySv();
    const cuentaId = await crearCuenta({ plan: 'starter', licencia_monto_mensual: 29, limite_negocios: 1 });
    // Un período de 30 días que empezó hace 10: quedan 20, o sea "a mitad" (más de 7).
    await pagarPeriodo(cuentaId, sumar(hoy, -10), sumar(hoy, 19));
    const { wompi } = wompiFalso();

    const r = await iniciarPagoPlan(deps(wompi), { cuentaId, plan: 'growth', accion: 'cambiar' });

    expect(r.ok).toBe(true);
    const { data: ajuste } = await supabase.from('cobros').select('tipo, plan_destino, periodo_desde, periodo_hasta, nota, estado').eq('cuenta_id', cuentaId).eq('metodo', 'Wompi').single();
    expect(ajuste).toMatchObject({ tipo: 'ajuste', plan_destino: 'growth', periodo_desde: hoy, periodo_hasta: sumar(hoy, 19), estado: 'pendiente' });
    expect(ajuste!.nota).toContain('Starter → Growth');
  });

  it('tocar de nuevo la misma opción reusa el intento: no crea otro cobro ni otro enlace', async () => {
    const cuentaId = await crearCuenta({ plan: null, licencia_monto_mensual: null, limite_negocios: null });
    const { wompi, enlaces } = wompiFalso();

    const primero = await iniciarPagoPlan(deps(wompi), { cuentaId, plan: 'growth', accion: 'activar' });
    const segundo = await iniciarPagoPlan(deps(wompi), { cuentaId, plan: 'growth', accion: 'activar' });

    expect(segundo).toEqual(primero);
    expect(enlaces).toHaveLength(1);
    const { count } = await supabase.from('cobros').select('id', { count: 'exact', head: true }).eq('cuenta_id', cuentaId);
    expect(count).toBe(1);
  });

  it('elegir OTRA opción anula el intento anterior y crea uno nuevo', async () => {
    const cuentaId = await crearCuenta({ plan: null, licencia_monto_mensual: null, limite_negocios: null });
    const { wompi } = wompiFalso();

    await iniciarPagoPlan(deps(wompi), { cuentaId, plan: 'growth', accion: 'activar' });
    await iniciarPagoPlan(deps(wompi), { cuentaId, plan: 'pro', accion: 'activar' });

    const { data: cobros } = await supabase.from('cobros').select('plan_destino, estado').eq('cuenta_id', cuentaId).order('created_at');
    expect(cobros).toEqual([
      { plan_destino: 'growth', estado: 'anulado' },
      { plan_destino: 'pro', estado: 'pendiente' },
    ]);
  });

  it('no toca un cobro pendiente que registró FM a mano', async () => {
    const cuentaId = await crearCuenta({ plan: null, licencia_monto_mensual: null, limite_negocios: null });
    await registrarCobro(supabase, cuentaId, {
      periodoDesde: '2026-08-01', periodoHasta: '2026-08-31', monto: 49,
      estado: 'pendiente', metodo: 'Transferencia', nota: null, pagadoEn: null,
    });
    const { wompi } = wompiFalso();

    await iniciarPagoPlan(deps(wompi), { cuentaId, plan: 'growth', accion: 'activar' });
    await iniciarPagoPlan(deps(wompi), { cuentaId, plan: 'pro', accion: 'activar' });

    const { data: manual } = await supabase.from('cobros').select('estado').eq('cuenta_id', cuentaId).eq('metodo', 'Transferencia').single();
    expect(manual!.estado).toBe('pendiente');
  });

  it('si Wompi falla, el cobro se anula y se puede volver a intentar', async () => {
    const cuentaId = await crearCuenta({ plan: null, licencia_monto_mensual: null, limite_negocios: null });
    const fallido = { async crearEnlacePago(): Promise<never> { throw new Error('Wompi devolvió 500'); } };

    const r = await iniciarPagoPlan(deps(fallido as never), { cuentaId, plan: 'growth', accion: 'activar' });

    expect(r).toMatchObject({ ok: false });
    const { data: cobro } = await supabase.from('cobros').select('estado').eq('cuenta_id', cuentaId).single();
    expect(cobro!.estado).toBe('anulado');

    const { wompi } = wompiFalso();
    expect((await iniciarPagoPlan(deps(wompi), { cuentaId, plan: 'growth', accion: 'activar' })).ok).toBe(true);
  });

  it('dos toques SIMULTÁNEOS: uno crea el intento y el otro recibe un mensaje, sin dejar dos cobros pendientes', async () => {
    const cuentaId = await crearCuenta({ plan: null, licencia_monto_mensual: null, limite_negocios: null });
    const { wompi } = wompiFalso();

    const [a, b] = await Promise.all([
      iniciarPagoPlan(deps(wompi), { cuentaId, plan: 'growth', accion: 'activar' }),
      iniciarPagoPlan(deps(wompi), { cuentaId, plan: 'growth', accion: 'activar' }),
    ]);

    expect([a, b].filter((r) => r.ok).length).toBeGreaterThanOrEqual(1);
    const { count } = await supabase.from('cobros').select('id', { count: 'exact', head: true }).eq('cuenta_id', cuentaId).eq('estado', 'pendiente').eq('metodo', 'Wompi');
    expect(count, 'quedaron dos intentos pendientes').toBe(1);
  });
});

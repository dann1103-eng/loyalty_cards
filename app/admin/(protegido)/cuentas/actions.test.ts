import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServiceClient } from '@/lib/supabase/server';
import { METODO_PEDIDO_FM } from '@/lib/comercios/cobros';

// El gate de FM se mockea porque necesita cookies de una request real; se prueba aparte en
// verifyFmAdmin. Mismo criterio que las pruebas de acciones del comercio (sucursales/actions.test.ts).
vi.mock('@/lib/fm/verifyFmAdmin', () => ({
  verifyFmAdmin: async () => ({ authUserId: 'fm-test' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const { accionPedirPago, accionAnularCobro } = await import('./actions');

const supabase = createServiceClient();
const cuentas: string[] = [];

afterEach(async () => {
  if (cuentas.length) {
    await supabase.from('cobros').delete().in('cuenta_id', cuentas);
    await supabase.from('cuentas_comercio').delete().in('id', cuentas.splice(0));
  }
});

const sufijo = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function crearCuenta(): Promise<string> {
  const { data, error } = await supabase
    .from('cuentas_comercio')
    .insert({ nombre: `Cuenta Acciones Cobranza ${sufijo()}` })
    .select('id')
    .single();
  if (error) throw error;
  cuentas.push(data.id);
  return data.id;
}

async function crearCobroPedido(cuentaId: string): Promise<string> {
  const { data, error } = await supabase
    .from('cobros')
    .insert({
      cuenta_id: cuentaId,
      tipo: 'periodo',
      periodo_desde: '2026-09-01',
      periodo_hasta: '2026-09-30',
      monto: 1,
      estado: 'pendiente',
      metodo: METODO_PEDIDO_FM,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

function formulario(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [clave, valor] of Object.entries(campos)) fd.append(clave, valor);
  return fd;
}

describe('accionPedirPago', () => {
  it('crea el cobro pedido por FM y lo deja pendiente', async () => {
    const cuentaId = await crearCuenta();

    const res = await accionPedirPago(
      cuentaId,
      undefined,
      formulario({ monto: '1', plan: 'growth', periodo_desde: '2026-09-01', periodo_hasta: '2026-09-30' }),
    );

    expect(res).toEqual({ ok: true });
    const { data: cobro } = await supabase.from('cobros').select('*').eq('cuenta_id', cuentaId).single();
    expect(cobro).toMatchObject({
      estado: 'pendiente',
      metodo: METODO_PEDIDO_FM,
      tipo: 'periodo',
      plan_destino: 'growth',
    });
    expect(Number(cobro!.monto)).toBe(1);
  });

  it('sin plan: plan_destino queda null', async () => {
    const cuentaId = await crearCuenta();

    const res = await accionPedirPago(
      cuentaId,
      undefined,
      formulario({ monto: '1', plan: '', periodo_desde: '2026-09-01', periodo_hasta: '2026-09-30' }),
    );

    expect(res).toEqual({ ok: true });
    const { data: cobro } = await supabase.from('cobros').select('plan_destino').eq('cuenta_id', cuentaId).single();
    expect(cobro!.plan_destino).toBeNull();
  });

  it('propaga el error de validación (no crea el cobro)', async () => {
    const cuentaId = await crearCuenta();

    const res = await accionPedirPago(
      cuentaId,
      undefined,
      formulario({ monto: '1', plan: '', periodo_desde: '2026-09-30', periodo_hasta: '2026-09-01' }),
    );

    expect(res).toEqual({ error: 'El período termina antes de empezar.' });
    const { count } = await supabase.from('cobros').select('id', { count: 'exact', head: true }).eq('cuenta_id', cuentaId);
    expect(count).toBe(0);
  });
});

describe('accionAnularCobro', () => {
  it('anula un cobro pendiente de la cuenta', async () => {
    const cuentaId = await crearCuenta();
    const cobroId = await crearCobroPedido(cuentaId);

    const res = await accionAnularCobro(cuentaId, cobroId, undefined, formulario({}));

    expect(res).toEqual({ ok: true });
    const { data: cobro } = await supabase.from('cobros').select('estado').eq('id', cobroId).single();
    expect(cobro!.estado).toBe('anulado');
  });

  it('NO anula el cobro de otra cuenta', async () => {
    const cuentaId = await crearCuenta();
    const otraCuentaId = await crearCuenta();
    const cobroId = await crearCobroPedido(otraCuentaId);

    const res = await accionAnularCobro(cuentaId, cobroId, undefined, formulario({}));

    expect(res).toEqual({ error: 'No encontramos ese cobro en esta cuenta. Recargá la página.' });
    const { data: cobro } = await supabase.from('cobros').select('estado').eq('id', cobroId).single();
    expect(cobro!.estado).toBe('pendiente');
  });

  it('un cobro que no existe no se toca y devuelve error', async () => {
    const cuentaId = await crearCuenta();

    const res = await accionAnularCobro(cuentaId, '00000000-0000-0000-0000-000000000000', undefined, formulario({}));

    expect(res).toEqual({ error: 'No encontramos ese cobro en esta cuenta. Recargá la página.' });
  });
});

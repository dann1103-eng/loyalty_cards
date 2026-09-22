import { afterEach, describe, expect, it } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { pedirPago } from './pedirPago';

// Contra Supabase (necesita .env.local). NO depende de la migración 0038: usa columnas de `cobros` que
// ya existen desde la 0037.

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
    .insert({ nombre: `Cuenta Pedir Pago ${sufijo()}` })
    .select('id')
    .single();
  if (error) throw error;
  cuentas.push(data.id);
  return data.id;
}

describe('pedirPago', () => {
  it('crea un cobro pendiente, tipo periodo, metodo "Pedido por FM", con el monto y el plan que eligió FM', async () => {
    const cuentaId = await crearCuenta();

    const r = await pedirPago(supabase, cuentaId, {
      monto: 1,
      plan: 'growth',
      periodoDesde: '2026-09-01',
      periodoHasta: '2026-09-30',
    });

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('esperaba ok: true');
    const { data: cobro } = await supabase.from('cobros').select('*').eq('id', r.id).single();
    expect(cobro).toMatchObject({
      cuenta_id: cuentaId,
      tipo: 'periodo',
      estado: 'pendiente',
      metodo: 'Pedido por FM',
      plan_destino: 'growth',
      periodo_desde: '2026-09-01',
      periodo_hasta: '2026-09-30',
      pagado_en: null,
    });
    // El monto de "pedirle un pago al cliente" es de $1: NO coincide con ningún plan del catálogo, y
    // pedirPago lo acepta igual (sirve para probar).
    expect(Number(cobro!.monto)).toBe(1);
  });

  it('sin plan (pedir un pago sin tocar el plan): plan_destino queda null, no rechaza por el CHECK de ajuste', async () => {
    const cuentaId = await crearCuenta();

    const r = await pedirPago(supabase, cuentaId, {
      monto: 5,
      plan: null,
      periodoDesde: '2026-09-01',
      periodoHasta: '2026-09-30',
    });

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('esperaba ok: true');
    const { data: cobro } = await supabase.from('cobros').select('tipo, plan_destino').eq('id', r.id).single();
    expect(cobro).toEqual({ tipo: 'periodo', plan_destino: null });
  });

  it('rechaza un período inválido (reusa validarCobro)', async () => {
    const cuentaId = await crearCuenta();

    const r = await pedirPago(supabase, cuentaId, {
      monto: 5,
      plan: null,
      periodoDesde: '2026-09-30',
      periodoHasta: '2026-09-01',
    });

    expect(r).toEqual({ ok: false, error: 'El período termina antes de empezar.' });
    const { count } = await supabase.from('cobros').select('id', { count: 'exact', head: true }).eq('cuenta_id', cuentaId);
    expect(count).toBe(0);
  });
});

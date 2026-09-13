import { afterEach, describe, expect, it } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { registrarCobro } from './cobros';

// El alta del cobro devuelve el id de la fila creada: accionRegistrarCobro lo usa para el event_id
// de Subscribe en Meta. Se prueba contra la base porque el id sale del `.select()` del insert.

const supabase = createServiceClient();
const cuentas: string[] = [];

afterEach(async () => {
  if (!cuentas.length) return;
  await supabase.from('cobros').delete().in('cuenta_id', cuentas);
  await supabase.from('cuentas_comercio').delete().in('id', cuentas.splice(0));
});

describe('registrarCobro', () => {
  it('devuelve el id del cobro que acaba de crear', async () => {
    const { data: cuenta, error } = await supabase
      .from('cuentas_comercio')
      .insert({ nombre: `Cuenta Cobro ${Date.now()}` })
      .select('id')
      .single();
    if (error) throw error;
    cuentas.push(cuenta.id);

    const res = await registrarCobro(supabase, cuenta.id, {
      periodoDesde: '2026-09-01',
      periodoHasta: '2026-09-30',
      monto: 49,
      estado: 'pagado',
      metodo: 'Transferencia',
      nota: null,
      pagadoEn: '2026-09-13',
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { data: fila } = await supabase.from('cobros').select('cuenta_id, monto, estado').eq('id', res.id).single();
    expect(fila).toMatchObject({ cuenta_id: cuenta.id, estado: 'pagado' });
    expect(Number(fila?.monto)).toBe(49);
  });

  it('un cobro inválido no devuelve id', async () => {
    const res = await registrarCobro(supabase, '00000000-0000-0000-0000-000000000000', {
      periodoDesde: '2026-09-30',
      periodoHasta: '2026-09-01',
      monto: 49,
      estado: 'pendiente',
      metodo: null,
      nota: null,
      pagadoEn: null,
    });
    expect(res).toEqual({ ok: false, error: 'El período termina antes de empezar.' });
  });
});

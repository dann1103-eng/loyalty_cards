import { afterEach, describe, expect, it } from 'vitest';
import { createServiceClient } from '../supabase/server';
import {
  METODO_WOMPI,
  anularCobroPendiente,
  anularIntentosPendientes,
  crearCobroPendiente,
  guardarEnlaceDelCobro,
  listarPeriodosPagados,
  obtenerCobroParaPagoDeLaCuenta,
  obtenerIntentoAbierto,
  reclamarCobroPagado,
  registrarCobro,
} from './cobros';

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

// ─────────────────────────────────────────────────────────────────────────────
// Pasarela Wompi (migración 0037). Necesitan la migración aplicada.
// ─────────────────────────────────────────────────────────────────────────────
async function crearCuenta(): Promise<string> {
  const { data, error } = await supabase
    .from('cuentas_comercio')
    .insert({ nombre: `Cuenta Cobro ${Date.now()}-${Math.random().toString(36).slice(2)}` })
    .select('id')
    .single();
  if (error) throw error;
  cuentas.push(data.id);
  return data.id;
}

const INTENTO = {
  tipo: 'periodo' as const,
  periodoDesde: '2026-09-15',
  periodoHasta: '2026-10-14',
  monto: 49,
  planDestino: 'growth',
  nota: null,
};

async function estadoDe(cobroId: string) {
  const { data } = await supabase
    .from('cobros')
    .select('estado, pagado_en, wompi_id_transaccion, metodo, tipo, plan_destino')
    .eq('id', cobroId)
    .single();
  return data!;
}

describe('crearCobroPendiente', () => {
  it("crea el cobro pendiente de la app: metodo 'Wompi', su tipo y el plan destino", async () => {
    const cuentaId = await crearCuenta();

    const res = await crearCobroPendiente(supabase, cuentaId, { ...INTENTO, tipo: 'ajuste', nota: 'Starter → Growth, 16 de 30 días', monto: 10.67 });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(await estadoDe(res.id)).toMatchObject({
      estado: 'pendiente',
      metodo: METODO_WOMPI,
      tipo: 'ajuste',
      plan_destino: 'growth',
      pagado_en: null,
    });
  });

  it('un SEGUNDO intento pendiente de la misma cuenta lo rechaza el índice único, sin lanzar', async () => {
    const cuentaId = await crearCuenta();
    expect((await crearCobroPendiente(supabase, cuentaId, INTENTO)).ok).toBe(true);

    const segundo = await crearCobroPendiente(supabase, cuentaId, INTENTO);

    expect(segundo).toEqual({ ok: false, error: 'Ya hay un pago en curso.', intentoAbierto: true });
  });

  it('un cobro pendiente que registró FM a mano NO cuenta como intento abierto', async () => {
    const cuentaId = await crearCuenta();
    await registrarCobro(supabase, cuentaId, {
      periodoDesde: '2026-09-01', periodoHasta: '2026-09-30', monto: 49,
      estado: 'pendiente', metodo: 'Transferencia', nota: null, pagadoEn: null,
    });

    expect((await crearCobroPendiente(supabase, cuentaId, INTENTO)).ok).toBe(true);
  });

  it('valida como cualquier cobro: un período al revés se rechaza con el mensaje en español', async () => {
    const cuentaId = await crearCuenta();
    const res = await crearCobroPendiente(supabase, cuentaId, { ...INTENTO, periodoDesde: '2026-10-14', periodoHasta: '2026-09-15' });
    expect(res).toEqual({ ok: false, error: 'El período termina antes de empezar.' });
  });
});

describe('anular intentos', () => {
  it('anula SOLO los cobros pendientes de la app, nunca los que registró FM ni los ya pagados', async () => {
    const cuentaId = await crearCuenta();
    const manual = await registrarCobro(supabase, cuentaId, {
      periodoDesde: '2026-08-01', periodoHasta: '2026-08-31', monto: 49,
      estado: 'pendiente', metodo: 'Transferencia', nota: null, pagadoEn: null,
    });
    const pagado = await crearCobroPendiente(supabase, cuentaId, INTENTO);
    if (!manual.ok || !pagado.ok) throw new Error('preparación');
    await reclamarCobroPagado(supabase, pagado.id, { hoy: '2026-09-15', idTransaccion: 'tx-anular-1', estadosPermitidos: ['pendiente'] });
    const abierto = await crearCobroPendiente(supabase, cuentaId, { ...INTENTO, periodoDesde: '2026-10-15', periodoHasta: '2026-11-14' });
    if (!abierto.ok) throw new Error('preparación');

    await anularIntentosPendientes(supabase, cuentaId);

    expect((await estadoDe(abierto.id)).estado, 'no anuló el intento de la app').toBe('anulado');
    expect((await estadoDe(manual.id)).estado, 'anuló un cobro de FM').toBe('pendiente');
    expect((await estadoDe(pagado.id)).estado, 'anuló un cobro pagado').toBe('pagado');
  });

  it('anularCobroPendiente no toca un cobro ya pagado', async () => {
    const cuentaId = await crearCuenta();
    const c = await crearCobroPendiente(supabase, cuentaId, INTENTO);
    if (!c.ok) throw new Error('preparación');
    await reclamarCobroPagado(supabase, c.id, { hoy: '2026-09-15', idTransaccion: 'tx-anular-2', estadosPermitidos: ['pendiente'] });

    await anularCobroPendiente(supabase, c.id);

    expect((await estadoDe(c.id)).estado).toBe('pagado');
  });

  it('tras anular, se puede abrir otro intento', async () => {
    const cuentaId = await crearCuenta();
    await crearCobroPendiente(supabase, cuentaId, INTENTO);
    await anularIntentosPendientes(supabase, cuentaId);

    expect((await crearCobroPendiente(supabase, cuentaId, INTENTO)).ok).toBe(true);
  });
});

describe('obtenerIntentoAbierto y el enlace', () => {
  it('devuelve el intento abierto con su enlace, y null cuando no hay', async () => {
    const cuentaId = await crearCuenta();
    expect(await obtenerIntentoAbierto(supabase, cuentaId)).toBeNull();

    const c = await crearCobroPendiente(supabase, cuentaId, INTENTO);
    if (!c.ok) throw new Error('preparación');
    await guardarEnlaceDelCobro(supabase, c.id, { idEnlace: 15, url: 'https://lk.wompi.sv/yhDt', vence: '2026-09-15T20:00:00.000Z' });

    expect(await obtenerIntentoAbierto(supabase, cuentaId)).toMatchObject({
      cobroId: c.id,
      tipo: 'periodo',
      planDestino: 'growth',
      monto: 49,
      periodoDesde: '2026-09-15',
      enlaceUrl: 'https://lk.wompi.sv/yhDt',
    });
  });

  it('un intento pagado ya no es "abierto"', async () => {
    const cuentaId = await crearCuenta();
    const c = await crearCobroPendiente(supabase, cuentaId, INTENTO);
    if (!c.ok) throw new Error('preparación');
    await reclamarCobroPagado(supabase, c.id, { hoy: '2026-09-15', idTransaccion: 'tx-abierto-1', estadosPermitidos: ['pendiente'] });

    expect(await obtenerIntentoAbierto(supabase, cuentaId)).toBeNull();
  });

  it('guardarEnlaceDelCobro lanza si el cobro no se puede actualizar por un id inválido', async () => {
    await expect(guardarEnlaceDelCobro(supabase, 'no-es-un-uuid', { idEnlace: 1, url: 'https://x', vence: '2026-09-15T20:00:00.000Z' })).rejects.toThrow(
      'No se pudo guardar el enlace del cobro',
    );
  });
});

describe('reclamarCobroPagado', () => {
  it('reclama un cobro pendiente: lo paga, anota la transacción y devuelve el cobro como quedó', async () => {
    const cuentaId = await crearCuenta();
    const c = await crearCobroPendiente(supabase, cuentaId, INTENTO);
    if (!c.ok) throw new Error('preparación');

    const r = await reclamarCobroPagado(supabase, c.id, { hoy: '2026-09-15', idTransaccion: 'tx-1', estadosPermitidos: ['pendiente'] });

    expect(r.reclamado).toBe(true);
    expect(r.cobro).toMatchObject({ id: c.id, cuentaId, estado: 'pagado', wompiIdTransaccion: 'tx-1', monto: 49, planDestino: 'growth', tipo: 'periodo' });
    expect(await estadoDe(c.id)).toMatchObject({ estado: 'pagado', pagado_en: '2026-09-15', wompi_id_transaccion: 'tx-1' });
  });

  it('un segundo reclamo NO reclama, y devuelve el cobro con la transacción que ya lo pagó', async () => {
    const cuentaId = await crearCuenta();
    const c = await crearCobroPendiente(supabase, cuentaId, INTENTO);
    if (!c.ok) throw new Error('preparación');
    await reclamarCobroPagado(supabase, c.id, { hoy: '2026-09-15', idTransaccion: 'tx-1', estadosPermitidos: ['pendiente'] });

    const segundo = await reclamarCobroPagado(supabase, c.id, { hoy: '2026-09-16', idTransaccion: 'tx-2', estadosPermitidos: ['pendiente'] });

    expect(segundo.reclamado).toBe(false);
    expect(segundo.cobro?.wompiIdTransaccion, 'una segunda transacción pisó a la primera').toBe('tx-1');
    expect((await estadoDe(c.id)).pagado_en, 'pisó la fecha de pago').toBe('2026-09-15');
  });

  it('dos reclamos SIMULTÁNEOS de transacciones distintas: gana uno solo', async () => {
    const cuentaId = await crearCuenta();
    const c = await crearCobroPendiente(supabase, cuentaId, INTENTO);
    if (!c.ok) throw new Error('preparación');

    const [a, b] = await Promise.all([
      reclamarCobroPagado(supabase, c.id, { hoy: '2026-09-15', idTransaccion: 'tx-a', estadosPermitidos: ['pendiente'] }),
      reclamarCobroPagado(supabase, c.id, { hoy: '2026-09-15', idTransaccion: 'tx-b', estadosPermitidos: ['pendiente'] }),
    ]);

    expect([a.reclamado, b.reclamado].filter(Boolean)).toHaveLength(1);
    const ganadora = a.reclamado ? 'tx-a' : 'tx-b';
    expect((await estadoDe(c.id)).wompi_id_transaccion).toBe(ganadora);
  });

  it('no reclama un cobro anulado, salvo que se permita (FM a mano)', async () => {
    const cuentaId = await crearCuenta();
    const c = await crearCobroPendiente(supabase, cuentaId, INTENTO);
    if (!c.ok) throw new Error('preparación');
    await anularCobroPendiente(supabase, c.id);

    const normal = await reclamarCobroPagado(supabase, c.id, { hoy: '2026-09-15', idTransaccion: 'tx-1', estadosPermitidos: ['pendiente'] });
    expect(normal.reclamado).toBe(false);
    expect(normal.cobro?.estado).toBe('anulado');

    const forzado = await reclamarCobroPagado(supabase, c.id, { hoy: '2026-09-15', idTransaccion: 'tx-1', estadosPermitidos: ['pendiente', 'anulado'] });
    expect(forzado.reclamado).toBe(true);
  });

  it('UNA transacción no puede pagar DOS cobros: el segundo reclamo no lanza, devuelve "no reclamado"', async () => {
    const cuentaId = await crearCuenta();
    const c1 = await crearCobroPendiente(supabase, cuentaId, INTENTO);
    if (!c1.ok) throw new Error('preparación');
    await reclamarCobroPagado(supabase, c1.id, { hoy: '2026-09-15', idTransaccion: 'tx-repetida', estadosPermitidos: ['pendiente'] });
    const c2 = await crearCobroPendiente(supabase, cuentaId, { ...INTENTO, periodoDesde: '2026-10-15', periodoHasta: '2026-11-14' });
    if (!c2.ok) throw new Error('preparación');

    const r = await reclamarCobroPagado(supabase, c2.id, { hoy: '2026-09-15', idTransaccion: 'tx-repetida', estadosPermitidos: ['pendiente'] });

    expect(r.reclamado).toBe(false);
    expect((await estadoDe(c2.id)).estado).toBe('pendiente');
  });

  it('un cobro que no existe no se reclama', async () => {
    const r = await reclamarCobroPagado(supabase, '00000000-0000-0000-0000-000000000000', { hoy: '2026-09-15', idTransaccion: 'tx-x', estadosPermitidos: ['pendiente'] });
    expect(r).toEqual({ reclamado: false, cobro: null });
  });

  it('una fecha inválida lanza antes de tocar nada', async () => {
    await expect(reclamarCobroPagado(supabase, '00000000-0000-0000-0000-000000000000', { hoy: 'ayer', idTransaccion: 'tx', estadosPermitidos: ['pendiente'] })).rejects.toThrow(
      'La fecha de pago no es válida',
    );
  });
});

describe('obtenerCobroParaPagoDeLaCuenta', () => {
  it('devuelve el cobro solo a la cuenta dueña: un id ajeno no lo ve', async () => {
    const cuentaA = await crearCuenta();
    const cuentaB = await crearCuenta();
    const c = await crearCobroPendiente(supabase, cuentaA, INTENTO);
    if (!c.ok) throw new Error('preparación');

    expect(await obtenerCobroParaPagoDeLaCuenta(supabase, cuentaA, c.id)).toMatchObject({ id: c.id, cuentaId: cuentaA, monto: 49, planDestino: 'growth' });
    expect(await obtenerCobroParaPagoDeLaCuenta(supabase, cuentaB, c.id), 'otra cuenta vio el cobro').toBeNull();
  });
});

describe('listarPeriodosPagados', () => {
  it('devuelve solo los períodos PAGADOS de tipo período: ni pendientes ni ajustes', async () => {
    const cuentaId = await crearCuenta();
    await registrarCobro(supabase, cuentaId, {
      periodoDesde: '2026-08-01', periodoHasta: '2026-08-31', monto: 49,
      estado: 'pagado', metodo: 'Transferencia', nota: null, pagadoEn: '2026-08-01',
    });
    await registrarCobro(supabase, cuentaId, {
      periodoDesde: '2026-09-01', periodoHasta: '2026-09-30', monto: 49,
      estado: 'pendiente', metodo: 'Transferencia', nota: null, pagadoEn: null,
    });
    const ajuste = await crearCobroPendiente(supabase, cuentaId, { ...INTENTO, tipo: 'ajuste', periodoDesde: '2026-08-15', periodoHasta: '2026-08-31', monto: 10 });
    if (!ajuste.ok) throw new Error('preparación');
    await reclamarCobroPagado(supabase, ajuste.id, { hoy: '2026-08-15', idTransaccion: 'tx-ajuste', estadosPermitidos: ['pendiente'] });

    expect(await listarPeriodosPagados(supabase, cuentaId)).toEqual([{ desde: '2026-08-01', hasta: '2026-08-31' }]);
  });

  it('una cuenta sin cobros devuelve una lista vacía, no null', async () => {
    expect(await listarPeriodosPagados(supabase, await crearCuenta())).toEqual([]);
  });
});

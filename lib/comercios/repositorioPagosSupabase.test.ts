import { afterEach, describe, expect, it } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearCobroPendiente, reclamarCobroPagado } from './cobros';
import { confirmarPagoCobro, type CobroParaPago, type EntradaPago } from './confirmarPago';
import { repositorioPagosSupabase } from './repositorioPagosSupabase';

// El adaptador REAL contra Supabase (necesita .env.local y la migración 0037 aplicada). Corre los MISMOS
// casos que `confirmarPago.test.ts` corre contra el repositorio falso: si el falso y la base se desvían,
// las pruebas de la lógica se vuelven decorativas (ver test/fixtures/repositorioPagosFalso.ts).

const supabase = createServiceClient();
const repo = repositorioPagosSupabase(supabase);
const cuentas: string[] = [];
const comercios: string[] = [];
const sucursales: string[] = [];
const transacciones: string[] = [];

afterEach(async () => {
  // Primero lo que apunta a los cobros, después los cobros, después las cuentas.
  if (transacciones.length) await supabase.from('pagos_wompi').delete().in('id_transaccion', transacciones.splice(0));
  if (cuentas.length) await supabase.from('pagos_wompi').delete().in('cuenta_id', cuentas);
  if (sucursales.length) await supabase.from('sucursales').delete().in('id', sucursales.splice(0));
  if (comercios.length) await supabase.from('comercios').delete().in('id', comercios.splice(0));
  if (cuentas.length) {
    await supabase.from('cobros').delete().in('cuenta_id', cuentas);
    await supabase.from('cuentas_comercio').delete().in('id', cuentas.splice(0));
  }
});

const sufijo = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Un id de transacción propio de cada prueba, para que la limpieza lo encuentre.
function nuevaTransaccion(): string {
  const id = `tx-prueba-${sufijo()}`;
  transacciones.push(id);
  return id;
}

async function crearCuenta(campos: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await supabase
    .from('cuentas_comercio')
    .insert({ nombre: `Cuenta Pagos ${sufijo()}`, ...campos })
    .select('id')
    .single();
  if (error) throw error;
  cuentas.push(data.id);
  return data.id;
}

async function consumirCupo(cuentaId: string, n: number) {
  const { data: comercio, error } = await supabase
    .from('comercios')
    .insert({ nombre: 'Comercio Pagos', slug: `test-pagos-${sufijo()}`, cuenta_id: cuentaId })
    .select('id')
    .single();
  if (error) throw error;
  comercios.push(comercio.id);
  const { data: principal } = await supabase
    .from('sucursales')
    .insert({ comercio_id: comercio.id, nombre: 'Principal', es_principal: true })
    .select('id')
    .single();
  sucursales.push(principal!.id);
  for (let i = 1; i < n; i++) {
    const { data: extra } = await supabase
      .from('sucursales')
      .insert({ comercio_id: comercio.id, nombre: `Extra ${i}` })
      .select('id')
      .single();
    sucursales.push(extra!.id);
  }
}

async function cobroPendiente(
  cuentaId: string,
  extra: Partial<Parameters<typeof crearCobroPendiente>[2]> = {},
): Promise<string> {
  const r = await crearCobroPendiente(supabase, cuentaId, {
    tipo: 'periodo',
    periodoDesde: '2026-09-15',
    periodoHasta: '2026-10-14',
    monto: 49,
    planDestino: 'growth',
    nota: null,
    ...extra,
  });
  if (!r.ok) throw new Error(r.error);
  return r.id;
}

const OPCIONES = { aceptarPruebas: false, hoy: '2026-09-15' };

function entrada(cobroId: string | null, idTransaccion: string, extra: Partial<EntradaPago> = {}): EntradaPago {
  return {
    fuente: 'webhook',
    idTransaccion,
    monto: 49,
    esReal: true,
    aprobada: true,
    identificadorEnlace: cobroId,
    fecha: '2026-09-15T18:00:00.000Z',
    payload: { IdTransaccion: idTransaccion, Monto: 49 },
    ...extra,
  };
}

async function cuentaDe(cuentaId: string) {
  const { data } = await supabase
    .from('cuentas_comercio')
    .select('plan, licencia_estado, licencia_activa_desde, limite_negocios, licencia_monto_mensual')
    .eq('id', cuentaId)
    .single();
  return data!;
}

async function eventoDe(idTransaccion: string) {
  const { data } = await supabase
    .from('pagos_wompi')
    .select('conciliacion, fuente, cobro_id, cuenta_id, detalle, payload, es_real, monto')
    .eq('id_transaccion', idTransaccion)
    .single();
  return data!;
}

async function cobroDe(cobroId: string) {
  const { data } = await supabase.from('cobros').select('estado, pagado_en, wompi_id_transaccion').eq('id', cobroId).single();
  return data!;
}

describe('registrarEvento', () => {
  it('crea un evento pendiente con el cuerpo crudo', async () => {
    const tx = nuevaTransaccion();

    const evento = await repo.registrarEvento({
      idTransaccion: tx, fuente: 'webhook', identificadorEnlace: 'OC1234', monto: 49, esReal: true,
      fecha: '2026-09-15T18:00:00.000Z', payload: { IdTransaccion: tx, cliente: { Nombre: 'Ana' } },
    });

    expect(evento.conciliacion).toBe('pendiente');
    expect(await eventoDe(tx)).toMatchObject({
      fuente: 'webhook', es_real: true, monto: 49, payload: { IdTransaccion: tx, cliente: { Nombre: 'Ana' } },
    });
  });

  it('es idempotente: la misma transacción devuelve el mismo evento con la conciliación que ya tenía', async () => {
    const tx = nuevaTransaccion();
    const nuevo = { idTransaccion: tx, fuente: 'webhook' as const, identificadorEnlace: null, monto: 49, esReal: true, fecha: null, payload: {} };
    const primero = await repo.registrarEvento(nuevo);
    await repo.actualizarEvento(primero.id, { conciliacion: 'aplicado' });

    const segundo = await repo.registrarEvento(nuevo);

    expect(segundo).toEqual({ id: primero.id, conciliacion: 'aplicado' });
  });

  it('dos registros simultáneos de la misma transacción terminan en UN solo evento', async () => {
    const tx = nuevaTransaccion();
    const nuevo = { idTransaccion: tx, fuente: 'webhook' as const, identificadorEnlace: null, monto: 49, esReal: true, fecha: null, payload: {} };

    const [a, b] = await Promise.all([repo.registrarEvento(nuevo), repo.registrarEvento(nuevo)]);

    expect(a.id).toBe(b.id);
    const { count } = await supabase.from('pagos_wompi').select('id', { count: 'exact', head: true }).eq('id_transaccion', tx);
    expect(count).toBe(1);
  });

  it('si el evento vino del REDIRECT y llega el webhook, se guarda el cuerpo real del webhook', async () => {
    const tx = nuevaTransaccion();
    const base = { idTransaccion: tx, identificadorEnlace: null, monto: 49, esReal: true, fecha: null };
    await repo.registrarEvento({ ...base, fuente: 'redirect', payload: { origen: 'respuesta de la API' } });

    await repo.registrarEvento({ ...base, fuente: 'webhook', payload: { origen: 'cuerpo del webhook' } });

    expect(await eventoDe(tx)).toMatchObject({ fuente: 'webhook', payload: { origen: 'cuerpo del webhook' } });
  });

  it('un evento nacido como error (cuerpo irreconocible) se guarda tal cual', async () => {
    const tx = nuevaTransaccion();
    const evento = await repo.registrarEvento({
      idTransaccion: tx, fuente: 'webhook', identificadorEnlace: null, monto: 0, esReal: false, fecha: null,
      payload: { cuerpoCrudo: 'raro' }, conciliacion: 'error', detalle: 'Cuerpo no reconocido: falta IdTransaccion',
    });
    expect(evento.conciliacion).toBe('error');
    expect(await eventoDe(tx)).toMatchObject({ conciliacion: 'error', detalle: 'Cuerpo no reconocido: falta IdTransaccion' });
  });
});

describe('actualizarEvento', () => {
  it('un campo ausente no se toca: marcar error después de asignar el cobro NO le borra el cobro', async () => {
    const cuentaId = await crearCuenta();
    const cobroId = await cobroPendiente(cuentaId);
    const tx = nuevaTransaccion();
    const evento = await repo.registrarEvento({ idTransaccion: tx, fuente: 'webhook', identificadorEnlace: cobroId, monto: 49, esReal: true, fecha: null, payload: {} });
    await repo.actualizarEvento(evento.id, { conciliacion: 'monto_distinto', detalle: 'x', cobroId, cuentaId });

    await repo.actualizarEvento(evento.id, { conciliacion: 'error', detalle: 'se cayó' });

    expect(await eventoDe(tx)).toMatchObject({ conciliacion: 'error', detalle: 'se cayó', cobro_id: cobroId, cuenta_id: cuentaId });

    // Y sin `detalle` tampoco se borra el detalle: cambiar solo la conciliación no toca nada más.
    await repo.actualizarEvento(evento.id, { conciliacion: 'monto_distinto' });

    expect(await eventoDe(tx)).toMatchObject({ conciliacion: 'monto_distinto', detalle: 'se cayó', cobro_id: cobroId, cuenta_id: cuentaId });
  });

  it('una conciliación que la base no acepta lanza', async () => {
    const tx = nuevaTransaccion();
    const evento = await repo.registrarEvento({ idTransaccion: tx, fuente: 'webhook', identificadorEnlace: null, monto: 1, esReal: true, fecha: null, payload: {} });
    await expect(repo.actualizarEvento(evento.id, { conciliacion: 'inventada' as never })).rejects.toThrow('No se pudo actualizar el evento de pago');
  });
});

// Los mismos casos que confirmarPago.test.ts, ahora contra la base.
describe('confirmarPagoCobro sobre Supabase', () => {
  it('el camino feliz: aplica el plan y la licencia, paga el cobro, y avisa a Meta UNA vez', async () => {
    const cuentaId = await crearCuenta({ plan: 'starter', licencia_monto_mensual: 29, limite_negocios: 1, licencia_estado: 'inactivo', licencia_activa_desde: null });
    const cobroId = await cobroPendiente(cuentaId);
    const tx = nuevaTransaccion();
    const avisos: CobroParaPago[] = [];

    const r = await confirmarPagoCobro(repo, entrada(cobroId, tx), { ...OPCIONES, alReclamar: (c) => void avisos.push(c) });

    expect(r).toEqual({ conciliacion: 'aplicado', repetido: false, detalle: null });
    expect(await cuentaDe(cuentaId)).toMatchObject({ plan: 'growth', licencia_estado: 'activo', licencia_activa_desde: '2026-09-15', limite_negocios: 3 });
    expect(Number((await cuentaDe(cuentaId)).licencia_monto_mensual)).toBe(49);
    expect(await cobroDe(cobroId)).toMatchObject({ estado: 'pagado', pagado_en: '2026-09-15', wompi_id_transaccion: tx });
    expect(await eventoDe(tx)).toMatchObject({ conciliacion: 'aplicado', cobro_id: cobroId, cuenta_id: cuentaId });
    expect(avisos).toHaveLength(1);
  });

  it('un webhook repetido no reaplica ni vuelve a avisar', async () => {
    const cuentaId = await crearCuenta({ plan: 'starter', licencia_monto_mensual: 29, limite_negocios: 1 });
    const cobroId = await cobroPendiente(cuentaId);
    const tx = nuevaTransaccion();
    const avisos: CobroParaPago[] = [];
    const opciones = { ...OPCIONES, alReclamar: (c: CobroParaPago) => void avisos.push(c) };

    await confirmarPagoCobro(repo, entrada(cobroId, tx), opciones);
    const segundo = await confirmarPagoCobro(repo, entrada(cobroId, tx), opciones);

    expect(segundo).toEqual({ conciliacion: 'aplicado', repetido: true, detalle: null });
    expect(avisos).toHaveLength(1);
  });

  it('dos webhooks SIMULTÁNEOS de la misma transacción: un solo reclamo y un solo aviso a Meta', async () => {
    const cuentaId = await crearCuenta({ plan: 'starter', licencia_monto_mensual: 29, limite_negocios: 1 });
    const cobroId = await cobroPendiente(cuentaId);
    const tx = nuevaTransaccion();
    const avisos: CobroParaPago[] = [];
    const opciones = { ...OPCIONES, alReclamar: (c: CobroParaPago) => void avisos.push(c) };

    const [a, b] = await Promise.all([
      confirmarPagoCobro(repo, entrada(cobroId, tx), opciones),
      confirmarPagoCobro(repo, entrada(cobroId, tx), opciones),
    ]);

    expect([a.conciliacion, b.conciliacion]).toEqual(['aplicado', 'aplicado']);
    expect(avisos).toHaveLength(1);
    expect((await cobroDe(cobroId)).estado).toBe('pagado');
  });

  it('una segunda transacción para el mismo cobro es ya_pagado y no cambia nada', async () => {
    const cuentaId = await crearCuenta({ plan: 'starter', licencia_monto_mensual: 29, limite_negocios: 1 });
    const cobroId = await cobroPendiente(cuentaId);
    const tx1 = nuevaTransaccion();
    const tx2 = nuevaTransaccion();
    await confirmarPagoCobro(repo, entrada(cobroId, tx1), OPCIONES);

    const r = await confirmarPagoCobro(repo, entrada(cobroId, tx2), OPCIONES);

    expect(r.conciliacion).toBe('ya_pagado');
    expect((await cobroDe(cobroId)).wompi_id_transaccion).toBe(tx1);
  });

  it('un pago de prueba no aplica nada, pero queda registrado', async () => {
    const cuentaId = await crearCuenta({ plan: 'starter', licencia_monto_mensual: 29, limite_negocios: 1 });
    const cobroId = await cobroPendiente(cuentaId);
    const tx = nuevaTransaccion();

    const r = await confirmarPagoCobro(repo, entrada(cobroId, tx, { esReal: false }), OPCIONES);

    expect(r.conciliacion).toBe('prueba');
    expect((await cuentaDe(cuentaId)).plan).toBe('starter');
    expect((await cobroDe(cobroId)).estado).toBe('pendiente');
    expect(await eventoDe(tx)).toMatchObject({ conciliacion: 'prueba', es_real: false });
  });

  it('un monto distinto no se aplica', async () => {
    const cuentaId = await crearCuenta({ plan: 'starter', licencia_monto_mensual: 29, limite_negocios: 1 });
    const cobroId = await cobroPendiente(cuentaId);
    const r = await confirmarPagoCobro(repo, entrada(cobroId, nuevaTransaccion(), { monto: 29 }), OPCIONES);
    expect(r.conciliacion).toBe('monto_distinto');
    expect((await cobroDe(cobroId)).estado).toBe('pendiente');
  });

  it('un identificador que no es un UUID es sin_cobro y NO rompe la consulta', async () => {
    const tx = nuevaTransaccion();
    const r = await confirmarPagoCobro(repo, entrada('OC1234', tx), OPCIONES);
    expect(r.conciliacion).toBe('sin_cobro');
    expect(await eventoDe(tx)).toMatchObject({ conciliacion: 'sin_cobro', cobro_id: null });
  });

  it('un UUID que no es un cobro de la app es sin_cobro', async () => {
    const r = await confirmarPagoCobro(repo, entrada('00000000-0000-4000-8000-000000000000', nuevaTransaccion()), OPCIONES);
    expect(r.conciliacion).toBe('sin_cobro');
  });

  it('un cobro anulado no se aplica', async () => {
    const cuentaId = await crearCuenta({ plan: 'starter', licencia_monto_mensual: 29, limite_negocios: 1 });
    const cobroId = await cobroPendiente(cuentaId);
    await supabase.from('cobros').update({ estado: 'anulado' }).eq('id', cobroId);

    const r = await confirmarPagoCobro(repo, entrada(cobroId, nuevaTransaccion()), OPCIONES);

    expect(r.conciliacion).toBe('cobro_anulado');
    expect((await cuentaDe(cuentaId)).plan).toBe('starter');
  });

  it('un AJUSTE sobre una cuenta que ya subió por su cuenta no la baja, y no avisa a Meta', async () => {
    const cuentaId = await crearCuenta({ plan: 'pro', licencia_monto_mensual: 89, limite_negocios: 10 });
    const cobroId = await cobroPendiente(cuentaId, { tipo: 'ajuste', monto: 10.67, planDestino: 'growth', periodoDesde: '2026-09-15', periodoHasta: '2026-09-30' });
    const avisos: CobroParaPago[] = [];

    const r = await confirmarPagoCobro(repo, entrada(cobroId, nuevaTransaccion(), { monto: 10.67 }), { ...OPCIONES, alReclamar: (c) => void avisos.push(c) });

    expect(r.conciliacion).toBe('aplicado');
    expect(await cuentaDe(cuentaId)).toMatchObject({ plan: 'pro', limite_negocios: 10 });
    expect((await cobroDe(cobroId)).estado).toBe('pagado');
    expect(avisos).toHaveLength(0);
  });

  it('si el plan ya no cabe (bajar con más unidades que el nuevo tope): el cobro queda pagado y el evento en plan_no_aplicable', async () => {
    const cuentaId = await crearCuenta({ plan: 'growth', licencia_monto_mensual: 49, limite_negocios: 3 });
    await consumirCupo(cuentaId, 2);
    const cobroId = await cobroPendiente(cuentaId, { planDestino: 'starter', monto: 29 });
    const tx = nuevaTransaccion();

    const r = await confirmarPagoCobro(repo, entrada(cobroId, tx, { monto: 29 }), OPCIONES);

    expect(r.conciliacion).toBe('plan_no_aplicable');
    expect(r.detalle).toBe('La cuenta usa 2 unidades y el plan Starter permite 1.');
    expect((await cuentaDe(cuentaId)).plan, 'bajó el plan aunque no cabía').toBe('growth');
    expect((await cobroDe(cobroId)).estado, 'la plata entró: el cobro tiene que quedar pagado').toBe('pagado');
    expect(await eventoDe(tx)).toMatchObject({ conciliacion: 'plan_no_aplicable' });
  });

  it('el reintento tras una falla a medias completa el pago y no avisa dos veces a Meta', async () => {
    const cuentaId = await crearCuenta({ plan: 'starter', licencia_monto_mensual: 29, limite_negocios: 1 });
    const cobroId = await cobroPendiente(cuentaId);
    const tx = nuevaTransaccion();
    const avisos: CobroParaPago[] = [];
    const opciones = { ...OPCIONES, alReclamar: (c: CobroParaPago) => void avisos.push(c) };

    // Simula que el reclamo funcionó pero se cayó todo lo que venía después: el cobro ya figura pagado
    // por ESTA transacción y el evento quedó en 'error'.
    const evento = await repo.registrarEvento({ idTransaccion: tx, fuente: 'webhook', identificadorEnlace: cobroId, monto: 49, esReal: true, fecha: null, payload: {} });
    await reclamarCobroPagado(supabase, cobroId, { hoy: '2026-09-15', idTransaccion: tx, estadosPermitidos: ['pendiente'] });
    await repo.actualizarEvento(evento.id, { conciliacion: 'error', detalle: 'se cayó' });

    const r = await confirmarPagoCobro(repo, entrada(cobroId, tx), opciones);

    expect(r.conciliacion, 'lo trató como un doble pago en vez de un reintento propio').toBe('aplicado');
    expect((await cuentaDe(cuentaId)).plan).toBe('growth');
    expect(avisos, 'Meta se contaría dos veces').toHaveLength(0);
  });

  it('FM a mano: acepta un monto distinto y revive un cobro anulado', async () => {
    const cuentaId = await crearCuenta({ plan: 'starter', licencia_monto_mensual: 29, limite_negocios: 1 });
    const cobroId = await cobroPendiente(cuentaId);
    await supabase.from('cobros').update({ estado: 'anulado' }).eq('id', cobroId);

    const r = await confirmarPagoCobro(repo, entrada(cobroId, nuevaTransaccion(), { fuente: 'manual', monto: 29, forzar: true }), OPCIONES);

    expect(r.conciliacion).toBe('aplicado');
    expect((await cobroDe(cobroId)).estado).toBe('pagado');
    expect((await cuentaDe(cuentaId)).plan).toBe('growth');
  });
});

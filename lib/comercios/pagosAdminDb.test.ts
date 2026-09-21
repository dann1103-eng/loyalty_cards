import { afterEach, describe, expect, it } from 'vitest';
import { createServiceClient } from '../supabase/server';
import type { Conciliacion } from './confirmarPago';
import { contarPagosAtencion, listarPagos, marcarRevisado, obtenerPago } from './pagosAdmin';

// Las consultas del panel de pagos de FM contra Supabase (necesita .env.local y la migración 0037). Las
// reglas puras están en pagosAdmin.test.ts.
//
// La tabla es compartida: puede haber pagos ajenos a la prueba. Por eso los conteos se comparan contra lo
// que había ANTES, y las listas se filtran a los ids que crea cada prueba.
//
// MUTATION-TESTING (cada fila se corrió el 2026-09-21 contra Supabase: romper, ver fallar con ESE test, restaurar):
//   - el filtro `soloAtencion` no excluye los ya revisados       → falla "soloAtencion deja solo lo que espera a FM"
//   - el filtro `soloAtencion` no filtra por conciliación         → falla "soloAtencion deja solo lo que espera a FM"
//   - el conteo no excluye los ya revisados                       → falla "el contador sube con un pago por revisar y baja al marcarlo revisado"
//   - marcarRevisado no guarda la fecha                           → fallan "el contador sube…" y "marcarRevisado con nota…"
//   - marcarRevisado pisa el detalle aunque no se pase uno        → falla "marcarRevisado sin nota no toca el detalle"
//   - listarPagos no trae el nombre de la cuenta                  → falla "cada pago trae el nombre de su cuenta"

const supabase = createServiceClient();
const transacciones: string[] = [];
const cuentas: string[] = [];

afterEach(async () => {
  if (transacciones.length) await supabase.from('pagos_wompi').delete().in('id_transaccion', transacciones.splice(0));
  if (cuentas.length) await supabase.from('cuentas_comercio').delete().in('id', cuentas.splice(0));
});

const sufijo = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function crearCuenta(): Promise<{ id: string; nombre: string }> {
  const nombre = `Cuenta Panel Pagos ${sufijo()}`;
  const { data, error } = await supabase.from('cuentas_comercio').insert({ nombre }).select('id').single();
  if (error) throw error;
  cuentas.push(data.id);
  return { id: data.id, nombre };
}

async function crearEvento(
  conciliacion: Conciliacion,
  extra: { cuentaId?: string; revisado?: boolean; detalle?: string } = {},
): Promise<{ id: string; idTransaccion: string }> {
  const idTransaccion = `tx-panel-${sufijo()}`;
  transacciones.push(idTransaccion);
  const { data, error } = await supabase
    .from('pagos_wompi')
    .insert({
      id_transaccion: idTransaccion,
      fuente: 'webhook',
      monto: 49,
      es_real: true,
      conciliacion,
      cuenta_id: extra.cuentaId ?? null,
      detalle: extra.detalle ?? null,
      revisado_en: extra.revisado ? new Date().toISOString() : null,
      payload: { IdTransaccion: idTransaccion },
    })
    .select('id')
    .single();
  if (error) throw error;
  return { id: data.id, idTransaccion };
}

describe('obtenerPago', () => {
  it('obtenerPago devuelve el evento tal como se guardó', async () => {
    const cuenta = await crearCuenta();
    const e = await crearEvento('monto_distinto', { cuentaId: cuenta.id, detalle: 'Wompi cobró 50 y el cobro era de 49.' });

    const p = await obtenerPago(supabase, e.id);

    expect(p).toMatchObject({
      id: e.id,
      idTransaccion: e.idTransaccion,
      fuente: 'webhook',
      cuentaId: cuenta.id,
      monto: 49,
      esReal: true,
      conciliacion: 'monto_distinto',
      detalle: 'Wompi cobró 50 y el cobro era de 49.',
      revisadoEn: null,
      payload: { IdTransaccion: e.idTransaccion },
    });
  });

  it('un id que no existe devuelve null', async () => {
    expect(await obtenerPago(supabase, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('un id que ni siquiera es un UUID devuelve null, no lanza', async () => {
    expect(await obtenerPago(supabase, 'no-es-uuid')).toBeNull();
  });
});

describe('listarPagos', () => {
  it('soloAtencion deja solo lo que espera a FM: los estados que piden decisión y no están revisados', async () => {
    const cuenta = await crearCuenta();
    const aplicado = await crearEvento('aplicado', { cuentaId: cuenta.id });
    const porRevisar = await crearEvento('monto_distinto', { cuentaId: cuenta.id });
    const revisado = await crearEvento('ya_pagado', { cuentaId: cuenta.id, revisado: true });
    const prueba = await crearEvento('prueba', { cuentaId: cuenta.id });
    const propios = new Set([aplicado.id, porRevisar.id, revisado.id, prueba.id]);

    const todos = (await listarPagos(supabase, { soloAtencion: false }))!.filter((p) => propios.has(p.id));
    const atencion = (await listarPagos(supabase, { soloAtencion: true }))!.filter((p) => propios.has(p.id));

    expect(todos.map((p) => p.id).sort()).toEqual([aplicado.id, porRevisar.id, revisado.id, prueba.id].sort());
    expect(atencion.map((p) => p.id)).toEqual([porRevisar.id]);
  });

  it('cada pago trae el nombre de su cuenta', async () => {
    const cuenta = await crearCuenta();
    const e = await crearEvento('error', { cuentaId: cuenta.id });

    const p = (await listarPagos(supabase, { soloAtencion: false }))!.find((x) => x.id === e.id);

    expect(p?.cuentaNombre).toBe(cuenta.nombre);
  });

  it('un pago sin cuenta se lista con cuentaNombre null', async () => {
    const e = await crearEvento('sin_cobro');
    const p = (await listarPagos(supabase, { soloAtencion: false }))!.find((x) => x.id === e.id);
    expect(p).toMatchObject({ cuentaId: null, cuentaNombre: null });
  });
});

describe('contarPagosAtencion y marcarRevisado', () => {
  it('el contador sube con un pago por revisar y baja al marcarlo revisado', async () => {
    const antes = (await contarPagosAtencion(supabase))!;
    const e = await crearEvento('cobro_anulado');
    expect(await contarPagosAtencion(supabase)).toBe(antes + 1);

    await marcarRevisado(supabase, e.id);

    expect(await contarPagosAtencion(supabase)).toBe(antes);
    expect((await obtenerPago(supabase, e.id))!.revisadoEn).not.toBeNull();
  });

  it('un pago aplicado o de prueba no suma al contador', async () => {
    const antes = (await contarPagosAtencion(supabase))!;
    await crearEvento('aplicado');
    await crearEvento('prueba');
    expect(await contarPagosAtencion(supabase)).toBe(antes);
  });

  it('marcarRevisado con nota la guarda en el detalle', async () => {
    const e = await crearEvento('error', { detalle: 'Cuerpo no reconocido: falta IdTransaccion' });
    await marcarRevisado(supabase, e.id, 'Reprocesado como la transacción tx-real.');
    const p = (await obtenerPago(supabase, e.id))!;
    expect(p.detalle).toBe('Reprocesado como la transacción tx-real.');
    expect(p.revisadoEn).not.toBeNull();
  });

  it('marcarRevisado sin nota no toca el detalle', async () => {
    const e = await crearEvento('error', { detalle: 'Cuerpo no reconocido: falta IdTransaccion' });
    await marcarRevisado(supabase, e.id);
    expect((await obtenerPago(supabase, e.id))!.detalle).toBe('Cuerpo no reconocido: falta IdTransaccion');
  });
});

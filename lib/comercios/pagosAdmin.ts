import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../supabase/types';
import { estaAprobado, parsearWebhook } from '../wompi/webhook';
import { formatearFecha } from '../tarjetas/vigencia';
import { NECESITAN_ATENCION, aConciliacion, type Conciliacion, type EntradaPago, type FuentePago } from './confirmarPago';
import type { EstadoPeriodo } from './prorrateo';

// Lo que el panel de FM (/admin/pagos) sabe hacer con los pagos que Wompi informa: qué necesita atención,
// qué acciones ofrece cada estado, y cómo se reprocesa un evento guardado. Las reglas son PURAS; las
// consultas reciben el cliente de Supabase.

export interface PagoAdmin {
  id: string;
  idTransaccion: string;
  fuente: FuentePago;
  cobroId: string | null;
  cuentaId: string | null;
  cuentaNombre: string | null;
  identificadorEnlace: string | null;
  monto: number;
  esReal: boolean;
  fecha: string | null;
  conciliacion: Conciliacion;
  detalle: string | null;
  revisadoEn: string | null;
  // El cuerpo crudo. Trae nombre y correo del pagador: SOLO se muestra en el panel de FM.
  payload: Json;
  creadoEn: string;
}

// Un evento "necesita atención" si quedó en un estado que espera una decisión de FM y nadie lo marcó como
// revisado. Los pagos de prueba, los aplicados y los que Wompi informó como no aprobados no lo necesitan.
export function necesitaAtencion(p: { conciliacion: Conciliacion; revisadoEn: string | null }): boolean {
  return NECESITAN_ATENCION.has(p.conciliacion) && p.revisadoEn === null;
}

export type AccionAdminPago = 'reintentar' | 'aplicar' | 'revisado';

// Qué puede hacer FM con un evento, según en qué quedó:
//   - reintentar: un `error` (algo se cayó a medias; el reintento es idempotente);
//   - aplicar: un pago con `monto_distinto` o sobre un `cobro_anulado`, que FM decide aceptar de todos modos;
//   - revisado: cualquiera que necesite atención, para sacarlo de la lista sin aplicar nada.
export function accionesDisponibles(p: { conciliacion: Conciliacion; revisadoEn: string | null }): AccionAdminPago[] {
  const acciones: AccionAdminPago[] = [];
  if (p.conciliacion === 'error') acciones.push('reintentar');
  if (p.conciliacion === 'monto_distinto' || p.conciliacion === 'cobro_anulado') acciones.push('aplicar');
  if (necesitaAtencion(p)) acciones.push('revisado');
  return acciones;
}

const ETIQUETAS: Record<Conciliacion, string> = {
  pendiente: 'Procesando',
  aplicado: 'Aplicado',
  prueba: 'Prueba',
  sin_cobro: 'Sin cobro de la app',
  cobro_anulado: 'Cobro anulado',
  monto_distinto: 'Monto distinto',
  ya_pagado: 'Doble pago',
  plan_no_aplicable: 'Plan no aplicado',
  no_aprobada: 'No aprobada',
  error: 'Error',
};

export function etiquetaConciliacion(c: Conciliacion): string {
  return ETIQUETAS[c];
}

export interface EventoParaReintento {
  fuente: FuentePago;
  identificadorEnlace: string | null;
  payload: Json;
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

// Reconstruye la entrada de un evento guardado para volver a procesarlo. Se re-lee el CUERPO, no las
// columnas: un evento nacido de un cuerpo irreconocible tiene columnas vacías (monto 0), y un parser
// arreglado después puede reconocerlo. Devuelve `{ error }` si el cuerpo sigue sin servir.
export function entradaParaReintentar(e: EventoParaReintento): EntradaPago | { error: string } {
  if (e.fuente === 'webhook') {
    const r = parsearWebhook(e.payload);
    if (!r.ok) return { error: `El cuerpo guardado sigue sin reconocerse: ${r.motivo}.` };
    const p = r.pago;
    return {
      fuente: 'webhook',
      idTransaccion: p.idTransaccion,
      monto: p.monto,
      esReal: p.esProductiva,
      aprobada: estaAprobado(p),
      identificadorEnlace: p.identificadorEnlace,
      fecha: p.fecha,
      payload: e.payload,
    };
  }

  if (e.fuente === 'redirect') {
    const t = e.payload;
    if (
      !esObjeto(t) ||
      typeof t.idTransaccion !== 'string' ||
      typeof t.monto !== 'number' ||
      typeof t.esReal !== 'boolean' ||
      typeof t.esAprobada !== 'boolean'
    ) {
      return { error: 'El cuerpo guardado de la consulta a Wompi no tiene el formato esperado.' };
    }
    return {
      fuente: 'redirect',
      idTransaccion: t.idTransaccion,
      monto: t.monto,
      esReal: t.esReal,
      aprobada: t.esAprobada,
      identificadorEnlace: e.identificadorEnlace,
      fecha: typeof t.fecha === 'string' ? t.fecha : null,
      payload: e.payload,
    };
  }

  return { error: 'Un pago aplicado a mano se reintenta volviendo a marcar el cobro como pagado.' };
}

type FilaPago = Database['public']['Tables']['pagos_wompi']['Row'];

function aPagoAdmin(f: FilaPago, cuentaNombre: string | null): PagoAdmin {
  return {
    id: f.id,
    idTransaccion: f.id_transaccion,
    fuente: f.fuente === 'redirect' || f.fuente === 'manual' ? f.fuente : 'webhook',
    cobroId: f.cobro_id,
    cuentaId: f.cuenta_id,
    cuentaNombre,
    identificadorEnlace: f.identificador_enlace,
    monto: Number(f.monto),
    esReal: f.es_real,
    fecha: f.fecha_transaccion,
    conciliacion: aConciliacion(f.conciliacion),
    detalle: f.detalle,
    revisadoEn: f.revisado_en,
    payload: f.payload,
    creadoEn: f.created_at,
  };
}

export interface FiltroPagos {
  soloAtencion: boolean;
  limite?: number;
}

const LIMITE_POR_DEFECTO = 100;
const CONCILIACIONES_ATENCION = [...NECESITAN_ATENCION];

// `null` ante un error, no `[]`: una lista vacía diría "no cayó ningún pago", y FM dejaría de mirar.
export async function listarPagos(
  supabase: SupabaseClient<Database>,
  filtro: FiltroPagos,
): Promise<PagoAdmin[] | null> {
  let consulta = supabase
    .from('pagos_wompi')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(filtro.limite ?? LIMITE_POR_DEFECTO);
  if (filtro.soloAtencion) {
    consulta = consulta.in('conciliacion', CONCILIACIONES_ATENCION).is('revisado_en', null);
  }
  const { data, error } = await consulta;
  if (error) {
    console.error('[pagos] no se pudieron leer los pagos:', error);
    return null;
  }

  const idsCuenta = [...new Set((data ?? []).map((f) => f.cuenta_id).filter((id): id is string => id !== null))];
  const nombres = new Map<string, string>();
  if (idsCuenta.length > 0) {
    const { data: cuentas } = await supabase.from('cuentas_comercio').select('id, nombre').in('id', idsCuenta);
    for (const c of cuentas ?? []) nombres.set(c.id, c.nombre);
  }

  return (data ?? []).map((f) => aPagoAdmin(f, f.cuenta_id ? (nombres.get(f.cuenta_id) ?? null) : null));
}

// Un evento por id, o `null` si no existe o no se pudo leer. Lo usan las acciones de FM: releen el evento
// de la base en vez de fiarse de lo que mandó la pantalla.
export async function obtenerPago(supabase: SupabaseClient<Database>, id: string): Promise<PagoAdmin | null> {
  const { data, error } = await supabase.from('pagos_wompi').select('*').eq('id', id).maybeSingle();
  if (error) {
    console.error('[pagos] no se pudo leer el pago:', error);
    return null;
  }
  return data ? aPagoAdmin(data, null) : null;
}

// Cuántos pagos esperan a FM: es el número de la nav. `null` si no se pudo contar (la nav no muestra
// nada, que es mejor que mostrar un cero falso).
export async function contarPagosAtencion(supabase: SupabaseClient<Database>): Promise<number | null> {
  const { count, error } = await supabase
    .from('pagos_wompi')
    .select('id', { count: 'exact', head: true })
    .in('conciliacion', CONCILIACIONES_ATENCION)
    .is('revisado_en', null);
  if (error) {
    console.error('[pagos] no se pudieron contar los pagos que necesitan atención:', error);
    return null;
  }
  return count ?? 0;
}

// LANZA si falla: la acción de servidor lo convierte en un mensaje.
export async function marcarRevisado(
  supabase: SupabaseClient<Database>,
  eventoId: string,
  detalle?: string,
): Promise<void> {
  const cambios: Database['public']['Tables']['pagos_wompi']['Update'] = { revisado_en: new Date().toISOString() };
  if (detalle !== undefined) cambios.detalle = detalle;
  const { error } = await supabase.from('pagos_wompi').update(cambios).eq('id', eventoId);
  if (error) throw new Error(`No se pudo marcar el pago como revisado: ${error.message}`);
}

// La línea de la ficha de cuenta que dice hasta cuándo tiene pagado. Sale de los cobros de la app
// (`estadoDelPeriodo`): un cobro registrado a mano por FM sin período no aparece acá. `ultimoPagadoHasta`
// es el fin del último período pagado: distingue "nunca pagó" de "el período venció el …", que para FM son
// dos conversaciones distintas con el cliente.
export function describirPeriodo(estado: EstadoPeriodo, ultimoPagadoHasta: string | null = null): string {
  switch (estado.tipo) {
    case 'sin_periodo':
      return ultimoPagadoHasta === null
        ? 'Sin período pagado en la app.'
        : `Su último período pagado venció el ${formatearFecha(ultimoPagadoHasta)}.`;
    case 'futuro':
      return `Su primer período pagado empieza el ${formatearFecha(estado.desde)}.`;
    case 'en_curso': {
      if (estado.fase === 'ya_renovado') {
        return `Período actual hasta el ${formatearFecha(estado.hasta)}; ya renovado hasta el ${formatearFecha(estado.cubiertoHasta)}.`;
      }
      const quedan = estado.diasRestantes === 1 ? 'queda 1 día' : `quedan ${estado.diasRestantes} días`;
      return `Período pagado hasta el ${formatearFecha(estado.hasta)} (${quedan}).`;
    }
  }
}

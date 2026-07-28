import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { verificarLimiteCuenta } from '../comercios/cuentas';

// Capa de datos de sucursales (migración 0008). Espeja recompensas.ts: TODA operación se scopea por
// comercio_id (que viene SIEMPRE del gate, nunca del formulario) y la validación vive acá, en la capa
// lib — es la única defensa, la BD solo garantiza NOT NULL sobre nombre/comercio_id.

export interface DatosSucursal {
  nombre: string;
}

export interface SucursalListada {
  id: string;
  nombre: string;
  activa: boolean;
  esPrincipal: boolean;
  // Geopush (migración 0016). Se listan junto al resto para que la pantalla de sucursales pueda
  // mostrar el estado de cada local sin una segunda consulta por fila.
  latitud: number | null;
  longitud: number | null;
  mensajeCercania: string | null;
  geopushActivo: boolean;
}

export type ResultadoSucursal = { ok: true; id: string } | { ok: false; error: string };
export type ResultadoAccion = { ok: true } | { ok: false; error: string };

export async function crearSucursal(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  datos: DatosSucursal,
): Promise<ResultadoSucursal> {
  const nombre = datos.nombre.trim();
  if (!nombre) return { ok: false, error: 'El nombre de la sucursal es obligatorio.' };

  // ¿Primera sucursal del comercio? Nace PRINCIPAL y NO consume cupo (0012): representa el local
  // del propio comercio. Es también la auto-reparación del caso "el alta del comercio no pudo
  // crear su Principal" — la primera creada a mano toma ese lugar. Dos altas concurrentes de la
  // "primera" chocan contra el índice parcial único (23505) → cae al error genérico, sin daño.
  const { count, error: eConteo } = await supabase
    .from('sucursales').select('id', { count: 'exact', head: true }).eq('comercio_id', comercioId);
  if (eConteo) {
    console.error('[comercio] no se pudo contar las sucursales del comercio:', eConteo);
    return { ok: false, error: 'No se pudo crear la sucursal.' };
  }
  const esPrimera = (count ?? 0) === 0;

  if (!esPrimera) {
    // Una sucursal ADICIONAL consume cupo del plan (migración 0011 + 0012): hay que saber a qué
    // cuenta pertenece este comercio y verificar su cupo. Un comercio sin cuenta_id (legado/fixture)
    // no tiene límite que verificar — degrada con gracia (spec Fase 6 §4.1).
    const { data: comercio, error: eComercio } = await supabase
      .from('comercios').select('cuenta_id').eq('id', comercioId).maybeSingle();
    if (eComercio) {
      console.error('[comercio] no se pudo leer el comercio para verificar el límite:', eComercio);
      return { ok: false, error: 'No se pudo crear la sucursal.' };
    }
    if (comercio?.cuenta_id) {
      const limite = await verificarLimiteCuenta(supabase, comercio.cuenta_id);
      if (!limite.ok) return { ok: false, error: limite.error };
    }
  }

  const { data, error } = await supabase
    .from('sucursales')
    .insert({ comercio_id: comercioId, nombre, es_principal: esPrimera }) // activa=true por default (0008)
    .select('id')
    .single();

  if (error) {
    console.error('[comercio] falló el insert de sucursal:', error);
    return { ok: false, error: 'No se pudo crear la sucursal.' };
  }
  return { ok: true, id: data.id };
}

// Scopeado por comercio_id: id de OTRO comercio → el update no matchea → PGRST116 ("0 rows" de
// .single()) → "Esa sucursal ya no existe." (mismo patrón que desactivarRecompensa).
export async function renombrarSucursal(
  supabase: SupabaseClient<Database>,
  id: string,
  comercioId: string,
  datos: DatosSucursal,
): Promise<ResultadoAccion> {
  const nombre = datos.nombre.trim();
  if (!nombre) return { ok: false, error: 'El nombre de la sucursal es obligatorio.' };

  const { error } = await supabase
    .from('sucursales')
    .update({ nombre })
    .eq('id', id)
    .eq('comercio_id', comercioId)
    .select('id')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return { ok: false, error: 'Esa sucursal ya no existe.' };
    }
    console.error('[comercio] falló el renombrado de sucursal:', error);
    return { ok: false, error: 'No se pudo renombrar la sucursal.' };
  }
  return { ok: true };
}

// SOFT enable/disable — update({activa}), NUNCA .delete(). usuarios_comercio.sucursal_id,
// transacciones_puntos.sucursal_id y canjes.sucursal_id (0008) apuntan a esta fila: si desaparece,
// esas FKs quedan colgando. Scopeado por comercio_id (del gate).
export async function cambiarEstadoSucursal(
  supabase: SupabaseClient<Database>,
  id: string,
  comercioId: string,
  activa: boolean,
): Promise<ResultadoAccion> {
  // CANDADO: la principal no se puede desactivar — sin ella el comercio vuelve al callejón "no hay
  // sucursal activa para cajeros" que la 0012 elimina. Solo aplica al APAGAR (reactivarla es no-op
  // legítimo). Ver MUTATION-TESTING en el .test.ts.
  if (!activa) {
    const { data: fila, error: eFila } = await supabase
      .from('sucursales').select('es_principal').eq('id', id).eq('comercio_id', comercioId).maybeSingle();
    if (eFila) {
      console.error('[comercio] no se pudo leer la sucursal para el candado de principal:', eFila);
      return { ok: false, error: 'No se pudo cambiar el estado de la sucursal.' };
    }
    if (!fila) return { ok: false, error: 'Esa sucursal ya no existe.' };
    if (fila.es_principal) return { ok: false, error: 'La sucursal principal no se puede desactivar.' };
  }

  const { error } = await supabase
    .from('sucursales')
    .update({ activa })
    .eq('id', id)
    .eq('comercio_id', comercioId)
    .select('id')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return { ok: false, error: 'Esa sucursal ya no existe.' };
    }
    console.error('[comercio] falló el cambio de estado de sucursal:', error);
    return { ok: false, error: 'No se pudo cambiar el estado de la sucursal.' };
  }
  return { ok: true };
}

// Lista TODAS las sucursales del comercio (activas e inactivas): el dueño necesita ver las
// desactivadas para poder reactivarlas con el toggle. Devuelve null ante un ERROR de BD (distinto de
// [] = "no hay sucursales"): sin esa distinción, la página mostraría el vacío "agregá la primera" ante
// un fallo transitorio, invitando a crear un duplicado (paridad con recompensas/page.tsx).
export async function listarSucursales(
  supabase: SupabaseClient<Database>,
  comercioId: string,
): Promise<SucursalListada[] | null> {
  const { data, error } = await supabase
    .from('sucursales')
    .select('id, nombre, activa, es_principal, latitud, longitud, mensaje_cercania, geopush_activo')
    .eq('comercio_id', comercioId)
    .order('es_principal', { ascending: false }) // la principal SIEMPRE primera (0012)
    .order('created_at');

  if (error) {
    console.error('[comercio] falló la consulta de sucursales:', error);
    return null;
  }
  return (data ?? []).map((s) => ({
    id: s.id,
    nombre: s.nombre,
    activa: s.activa,
    esPrincipal: s.es_principal,
    // numeric de Postgres llega como number por PostgREST, pero se normaliza igual: una fila vieja
    // o un driver distinto podrían entregarlo como string y el pass saldría con "13.6989" entre
    // comillas, que PassKit rechaza.
    latitud: s.latitud === null ? null : Number(s.latitud),
    longitud: s.longitud === null ? null : Number(s.longitud),
    mensajeCercania: s.mensaje_cercania,
    geopushActivo: s.geopush_activo,
  }));
}

// Ids de las sucursales PRINCIPALES de VARIOS comercios en UNA sola consulta. La usa la pantalla de
// reportes (vista conglomerado): necesita etiquetar la Principal en cada carta y reporte_sucursales
// (0010) no devuelve es_principal. Sin esto habría que llamar listarSucursales una vez POR comercio
// — N round-trips extra por carga en una página force-dynamic que se abre seguido.
//
// El .eq('es_principal', true) es lo que hace que devuelva SOLO principales; el .in('comercio_id')
// la scopea al alcance ya verificado por el gate (ver MUTATION-TESTING en el .test.ts).
//
// Fail-soft ante error: Set vacío, no null. A diferencia de listarSucursales —donde el vacío invita
// a crear un duplicado y por eso hay que distinguirlo del error— acá lo único que se pierde es una
// etiqueta cosmética; no justifica tumbar la pantalla (mismo criterio que lib/reportes/reportes.ts).
export async function idsSucursalesPrincipales(
  supabase: SupabaseClient<Database>,
  comercioIds: string[],
): Promise<Set<string>> {
  // Sin comercios no hay nada que preguntar: un .in(…, []) sería un round-trip a la nada.
  if (comercioIds.length === 0) return new Set();

  const { data, error } = await supabase
    .from('sucursales')
    .select('id')
    .eq('es_principal', true)
    .in('comercio_id', comercioIds);

  if (error) {
    console.error('[comercio] falló la consulta de sucursales principales:', error);
    return new Set();
  }
  return new Set((data ?? []).map((s) => s.id));
}

// Control de seguridad: el picker de sucursal del dueño y la atribución del escáner deben rechazar
// un sucursal_id que no sea de ESTE comercio. El .eq('comercio_id') es el candado — sin él, una
// sucursal ajena pasaría como válida (ver MUTATION-TESTING en el .test.ts).
export async function sucursalPerteneceAComercio(
  supabase: SupabaseClient<Database>,
  sucursalId: string,
  comercioId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('sucursales')
    .select('id')
    .eq('id', sucursalId)
    .eq('comercio_id', comercioId)
    .maybeSingle();

  if (error) {
    // Falla cerrado (data null → false), pero deja rastro: un error de infra no debe rechazar en
    // silencio una sucursal legítima.
    console.error('[comercio] falló la verificación de pertenencia de sucursal:', error);
  }
  return data !== null;
}

// La fila "Principal" que todo comercio recibe al nacer (0012). La llama crearComercio
// (guardarComercio.ts) — el alta de FM y la self-serve pasan por ahí — para que ningún caller
// pueda olvidarla. Si falla, el caller NO revierte el comercio: la primera sucursal creada a mano
// toma el lugar (auto-reparación de crearSucursal).
export async function crearSucursalPrincipal(
  supabase: SupabaseClient<Database>,
  comercioId: string,
): Promise<ResultadoSucursal> {
  const { data, error } = await supabase
    .from('sucursales')
    .insert({ comercio_id: comercioId, nombre: 'Principal', es_principal: true })
    .select('id')
    .single();
  if (error) {
    console.error('[comercio] falló el insert de la sucursal principal:', error);
    return { ok: false, error: 'No se pudo crear la sucursal principal.' };
  }
  return { ok: true, id: data.id };
}

// La consulta de validación del contexto: id + nombre SOLO si la sucursal es de ESTE comercio y
// está activa. La usan verifyComercioAcceso (cookie del owner y sucursal del cajero) y
// cambiarContextoActivo (input del sheet). CONTROL DE SEGURIDAD: sin el .eq('comercio_id') una
// cookie con sucursal ajena pasaría; sin el .eq('activa') se fijaría contexto en una apagada
// (ver MUTATION-TESTING en el .test.ts).
export async function obtenerSucursalActiva(
  supabase: SupabaseClient<Database>,
  sucursalId: string,
  comercioId: string,
): Promise<{ id: string; nombre: string } | null> {
  const { data, error } = await supabase
    .from('sucursales')
    .select('id, nombre')
    .eq('id', sucursalId)
    .eq('comercio_id', comercioId)
    .eq('activa', true)
    .maybeSingle();
  if (error) {
    // Falla cerrado (null = "todas"), pero deja rastro: infra ≠ contexto inválido.
    console.error('[comercio] falló la validación de la sucursal activa:', error);
  }
  return data ?? null;
}

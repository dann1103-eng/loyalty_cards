import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

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

  const { data, error } = await supabase
    .from('sucursales')
    .insert({ comercio_id: comercioId, nombre }) // activa=true por default de la BD (0008)
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
    .select('id, nombre, activa')
    .eq('comercio_id', comercioId)
    .order('created_at');

  if (error) {
    console.error('[comercio] falló la consulta de sucursales:', error);
    return null;
  }
  return data ?? [];
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

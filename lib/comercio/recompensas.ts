import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

// Espejo del check de la BD (migración 0001: tipo in ('codigo_descuento','articulo_gratis','otro')).
export const TIPOS_RECOMPENSA = [
  { valor: 'codigo_descuento', etiqueta: 'Código de descuento' },
  { valor: 'articulo_gratis', etiqueta: 'Artículo gratis' },
  { valor: 'otro', etiqueta: 'Otro' },
] as const;

export interface DatosRecompensa {
  nombre: string;
  descripcion: string | null;
  costo_puntos: number;
  tipo: string;
  valor: string | null;
}

export type ResultadoRecompensa = { ok: true; id: string } | { ok: false; error: string };
export type ResultadoAccion = { ok: true } | { ok: false; error: string };

export async function crearRecompensa(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  datos: DatosRecompensa,
): Promise<ResultadoRecompensa> {
  const nombre = datos.nombre.trim();
  if (!nombre) return { ok: false, error: 'El nombre de la recompensa es obligatorio.' };
  if (!TIPOS_RECOMPENSA.some((t) => t.valor === datos.tipo)) {
    return { ok: false, error: 'El tipo de recompensa no es válido.' };
  }
  if (!Number.isInteger(datos.costo_puntos) || datos.costo_puntos <= 0) {
    return { ok: false, error: 'El costo en puntos debe ser un número entero mayor que cero.' };
  }

  const { data, error } = await supabase
    .from('recompensas')
    .insert({
      comercio_id: comercioId,
      nombre,
      descripcion: datos.descripcion?.trim() || null,
      costo_puntos: datos.costo_puntos,
      tipo: datos.tipo,
      valor: datos.valor?.trim() || null,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[comercio] falló el insert de recompensa:', error);
    return { ok: false, error: 'No se pudo crear la recompensa.' };
  }
  return { ok: true, id: data.id };
}

// SOFT-DELETE — update({activa:false}), NUNCA .delete(). El historial de canjes.recompensa_id
// (Fase 4) depende de que la fila NO desaparezca. Es la primera vez que se escribe este patrón en
// el proyecto: no copiar el hard delete de eliminarComercio. Scopeado por comercio_id (del gate).
export async function desactivarRecompensa(
  supabase: SupabaseClient<Database>,
  id: string,
  comercioId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase
    .from('recompensas')
    .update({ activa: false })
    .eq('id', id)
    .eq('comercio_id', comercioId)
    .select('id')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return { ok: false, error: 'Esa recompensa ya no existe.' };
    }
    console.error('[comercio] falló la desactivación de recompensa:', error);
    return { ok: false, error: 'No se pudo desactivar la recompensa.' };
  }
  return { ok: true };
}

// Foto del premio. `recompensas.foto_url` existe desde la migración 0001 y el spec del MVP la
// contemplaba ("CRUD del owner ... con subida de foto a Supabase Storage"), pero nunca se cableó:
// la columna estuvo muerta hasta acá. No hace falta migración, solo conectarla.
//
// Se guarda la URL ya armada por el Server Action (que es quien habla con Storage), no el archivo:
// esta capa no hace I/O de binarios, igual que guardarBranding.
export async function guardarFotoRecompensa(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  recompensaId: string,
  fotoUrl: string | null,
): Promise<ResultadoAccion> {
  // Scope por comercio_id: conocer el id de una recompensa ajena no debe permitir cambiarle la foto.
  const { error } = await supabase
    .from('recompensas')
    .update({ foto_url: fotoUrl })
    .eq('id', recompensaId)
    .eq('comercio_id', comercioId);

  if (error) {
    console.error('[comercio] falló el guardado de la foto de la recompensa:', error);
    return { ok: false, error: 'No se pudo guardar la foto.' };
  }
  return { ok: true };
}

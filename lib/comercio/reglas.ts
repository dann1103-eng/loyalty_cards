import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

// Espejo del check de la BD (migración 0001: tipo in ('por_visita','por_monto')). El <select> del
// formulario se construye desde esta constante.
export const TIPOS_REGLA = [
  { valor: 'por_visita', etiqueta: 'Por visita' },
  { valor: 'por_monto', etiqueta: 'Por monto' },
] as const;

export interface DatosRegla {
  tipo: string;
  valor: number;
}

export type ResultadoRegla = { ok: true; id: string } | { ok: false; error: string };

export async function crearRegla(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  datos: DatosRegla,
): Promise<ResultadoRegla> {
  if (!TIPOS_REGLA.some((t) => t.valor === datos.tipo)) {
    // Sin esto, un tipo inválido cae en el 23514 de la BD → mensaje genérico sin explicar qué pasó.
    return { ok: false, error: 'El tipo de regla debe ser "por visita" o "por monto".' };
  }
  if (!Number.isFinite(datos.valor) || datos.valor <= 0) {
    return { ok: false, error: 'El valor de la regla debe ser un número mayor que cero.' };
  }

  const { data, error } = await supabase
    .from('reglas_puntos')
    .insert({ comercio_id: comercioId, tipo: datos.tipo, valor: datos.valor })
    .select('id')
    .single();

  if (error) {
    console.error('[comercio] falló el insert de regla:', error);
    return { ok: false, error: 'No se pudo crear la regla.' };
  }
  return { ok: true, id: data.id };
}

// Hard delete a propósito (spec §6): ninguna regla tiene historial que dependa de ella. Scopeado
// por comercio_id (del gate) para que un dueño no borre reglas de otro comercio manipulando el id.
export async function eliminarRegla(
  supabase: SupabaseClient<Database>,
  id: string,
  comercioId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase
    .from('reglas_puntos')
    .delete()
    .eq('id', id)
    .eq('comercio_id', comercioId)
    .select('id')
    .single();

  if (error) {
    // PGRST116 = 0 filas: el id no existe o no es de este comercio. En ambos casos, para el dueño,
    // "esa regla no existe (para ti)" — no la borramos, no reportamos éxito falso.
    if (error.code === 'PGRST116') {
      return { ok: false, error: 'Esa regla ya no existe.' };
    }
    console.error('[comercio] falló el borrado de regla:', error);
    return { ok: false, error: 'No se pudo eliminar la regla.' };
  }
  return { ok: true };
}

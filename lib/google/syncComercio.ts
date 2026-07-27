import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { syncObjetoTarjeta } from './syncObjeto';

// Re-sincroniza los objetos de TODAS las tarjetas de un comercio. Equivalente para Google de
// notificarCambioComercio (Apple): se llama cuando cambia algo del branding que la GRILLA dibuja
// (ícono del sello, colores, foto de fondo, meta), porque esa imagen se compone por tarjeta y
// Google la tiene cacheada por URL — sin re-sincronizar, los clientes que ya guardaron el pass se
// quedan con la grilla vieja para siempre.
//
// Ojo con la asimetría: el LOGO y los colores de la cabecera viven en la clase (una sola llamada,
// syncClaseComercio); la GRILLA vive en cada objeto. Un cambio de branding suele tocar ambos.
//
// Best-effort de punta a punta, igual que el resto del módulo: un fallo se loguea y no rompe el
// guardado que lo disparó.
export async function syncObjetosComercio(
  supabase: SupabaseClient<Database>,
  comercioId: string,
): Promise<void> {
  const { data: tarjetas, error } = await supabase
    .from('tarjetas')
    .select('id')
    .eq('comercio_id', comercioId);

  if (error) {
    console.error('[google] no se pudieron listar las tarjetas para re-sincronizar:', error);
    return;
  }

  for (const t of tarjetas ?? []) {
    await syncObjetoTarjeta(supabase, t.id);
  }
}

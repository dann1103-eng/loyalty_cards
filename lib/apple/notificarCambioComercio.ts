import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { notificarCambioTarjeta } from './notificarCambioTarjeta';

// Empuja la actualización a TODOS los passes de un comercio. Se llama cuando cambia algo que el
// pass renderiza pero que no pasa por el endpoint de puntos: tipo de tarjeta (FM), colores o meta
// de sellos (panel del dueño). Sin esto, un pass emitido antes del cambio muestra el diseño viejo
// para siempre — Wallet solo re-descarga cuando recibe un push (bug real visto en el piloto:
// el comercio pasó a sellos y el pass siguió diciendo "15 PUNTOS").
//
// Best-effort a propósito: notificarCambioTarjeta ya traga y loguea fallos por registro; un push
// caído no debe revertir el guardado que lo disparó.
export async function notificarCambioComercio(
  supabase: SupabaseClient<Database>,
  comercioId: string,
): Promise<void> {
  const { data: tarjetas, error } = await supabase
    .from('tarjetas')
    .select('id')
    .eq('comercio_id', comercioId);

  if (error) {
    console.error('[apple] no se pudieron listar las tarjetas para notificar:', error);
    return;
  }

  for (const t of tarjetas ?? []) {
    await notificarCambioTarjeta(supabase, t.id);
  }
}

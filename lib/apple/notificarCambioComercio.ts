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
  await notificar(supabase, comercioId, null);
}

// Igual que la de arriba, pero solo los passes de UN programa: lo que necesita el branding por
// programa (migración 0027). Sin este push, el dueño le cambia la marca a su cupón y NINGÚN iPhone
// que ya lo tenga instalado se entera — Wallet solo re-descarga el .pkpass cuando recibe uno.
//
// Acotado al programa a propósito: un push al programa que no cambió hace que ese cliente descargue
// de nuevo un pase idéntico. Y el comercioId no es redundante: el programaId viaja en el formulario
// del dueño, el comercioId viene del gate.
export async function notificarCambioPrograma(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  programaId: string,
): Promise<void> {
  await notificar(supabase, comercioId, programaId);
}

async function notificar(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  programaId: string | null,
): Promise<void> {
  let consulta = supabase.from('tarjetas').select('id').eq('comercio_id', comercioId);
  if (programaId) consulta = consulta.eq('programa_id', programaId);

  const { data: tarjetas, error } = await consulta;

  if (error) {
    console.error('[apple] no se pudieron listar las tarjetas para notificar:', error);
    return;
  }

  for (const t of tarjetas ?? []) {
    await notificarCambioTarjeta(supabase, t.id);
  }
}

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
  await resincronizar(supabase, comercioId, null);
}

// Igual que la de arriba, pero solo las tarjetas de UN programa: lo que necesita el branding por
// programa (migración 0027). Acotarlo no es una optimización cosmética — cada tarjeta es una
// llamada a la API de Google, y re-sincronizar el programa que NO cambió hace que Google
// re-descargue una grilla idéntica para cada uno de esos clientes.
//
// El comercioId sigue siendo obligatorio y NO es redundante: el programaId viaja en el formulario
// del dueño mientras el comercioId viene del gate. Sin el scope por comercio, un id de programa
// ajeno dispararía escrituras sobre las tarjetas de otro negocio.
export async function syncObjetosPrograma(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  programaId: string,
): Promise<void> {
  await resincronizar(supabase, comercioId, programaId);
}

async function resincronizar(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  programaId: string | null,
): Promise<void> {
  let consulta = supabase.from('tarjetas').select('id').eq('comercio_id', comercioId);
  if (programaId) consulta = consulta.eq('programa_id', programaId);

  const { data: tarjetas, error } = await consulta;

  if (error) {
    console.error('[google] no se pudieron listar las tarjetas para re-sincronizar:', error);
    return;
  }

  for (const t of tarjetas ?? []) {
    await syncObjetoTarjeta(supabase, t.id);
  }
}

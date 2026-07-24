import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { membresiasDeUsuario } from './membresiasDeUsuario';

// ¿De qué comercios es DUEÑO (owner) este usuario autenticado? Devuelve la LISTA de comercios
// (id y nombre) donde tiene rol 'owner' — puede ser 0, 1 o varios. Se apoya en membresiasDeUsuario
// (la consulta base, sin .maybeSingle()) y filtra por rol. Separado de verifyComercioAcceso() para
// testear la consulta contra la BD real sin un contexto de request de Next — mismo patrón que
// esAdminFm().
export async function esOwnerDeComercio(
  supabase: SupabaseClient<Database>,
  authUserId: string,
): Promise<{ comercioId: string; nombre: string }[]> {
  const membresias = await membresiasDeUsuario(supabase, authUserId);
  return membresias
    .filter((m) => m.rol === 'owner')
    .map((m) => ({ comercioId: m.comercioId, nombre: m.nombre }));
}

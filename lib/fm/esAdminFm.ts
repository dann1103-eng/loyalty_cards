import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

// ¿Este usuario autenticado es administrador de FM (la plataforma)?
// Separado de verifyFmAdmin() para poder testear la consulta contra la BD real sin necesitar
// un contexto de request de Next.
export async function esAdminFm(
  supabase: SupabaseClient<Database>,
  authUserId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('usuarios_fm')
    .select('id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  return Boolean(data);
}

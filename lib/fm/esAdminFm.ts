import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

// ¿Este usuario autenticado es administrador de FM (la plataforma)?
// Separado de verifyFmAdmin() para poder testear la consulta contra la BD real sin necesitar
// un contexto de request de Next.
export async function esAdminFm(
  supabase: SupabaseClient<Database>,
  authUserId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('usuarios_fm')
    .select('id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (error) {
    // maybeSingle() devuelve error: null cuando no hay filas — así que un error aquí SIEMPRE
    // es infraestructura (llave revocada, migración rota, red), nunca un "no es admin".
    // Seguimos fallando cerrado (false), pero dejamos rastro: sin esto una caída total se ve
    // idéntica a una denegación rutinaria, y el admin recibiría "no tienes acceso" —mentira—
    // sin una sola línea de log que lo explique.
    console.error('[fm] falló la consulta de usuarios_fm; se deniega por seguridad:', error);
    return false;
  }

  return Boolean(data);
}

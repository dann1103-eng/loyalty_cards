import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

// ¿Este usuario autenticado es DUEÑO (owner) de un comercio? Devuelve el id y el nombre del
// comercio (para el panel), o null. Separado de verifyComercioOwner() para testear la consulta
// contra la BD real sin un contexto de request de Next — mismo patrón que esAdminFm().
export async function esOwnerDeComercio(
  supabase: SupabaseClient<Database>,
  authUserId: string,
): Promise<{ comercioId: string; nombre: string } | null> {
  const { data, error } = await supabase
    .from('usuarios_comercio')
    .select('comercio_id, comercios(nombre)')
    .eq('auth_user_id', authUserId)
    .eq('rol', 'owner')
    .maybeSingle();

  if (error) {
    // maybeSingle() devuelve error:null cuando no hay filas — así que un error aquí SIEMPRE es
    // infraestructura (llave revocada, red, migración rota), nunca un "no es owner". Fallamos
    // cerrado (null) pero dejamos rastro. CAVEAT (spec §5): usuarios_comercio.auth_user_id NO es
    // único; si una cuenta llegara a tener 2 filas owner, maybeSingle() lanza PGRST116 y cae aquí
    // → el dueño queda bloqueado. Baja probabilidad (email sí es único, una cuenta = un comercio);
    // vale tenerlo presente si el flujo de alta cambia.
    console.error('[comercio] falló la consulta de usuarios_comercio; se deniega por seguridad:', error);
    return null;
  }

  if (!data || !data.comercios) return null;

  return { comercioId: data.comercio_id, nombre: data.comercios.nombre };
}

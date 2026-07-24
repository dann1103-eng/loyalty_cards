import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

export interface Membresia {
  usuarioComercioId: string;
  comercioId: string;
  nombre: string;
  rol: string;
  sucursalId: string | null;
}

// Todas las membresías (owner o cajero) de una cuenta de Auth. Lista, NO maybeSingle(): una cuenta
// puede administrar varios comercios (arreglo del lockout que documentaba esOwnerDeComercio.ts).
// Falla cerrado → [] con log (un error acá es infraestructura, no "sin membresías").
export async function membresiasDeUsuario(
  supabase: SupabaseClient<Database>,
  authUserId: string,
): Promise<Membresia[]> {
  const { data, error } = await supabase
    .from('usuarios_comercio')
    .select('id, comercio_id, rol, sucursal_id, comercios(nombre)')
    .eq('auth_user_id', authUserId);

  if (error) {
    console.error('[comercio] falló la consulta de membresías; se deniega por seguridad:', error);
    return [];
  }
  return (data ?? [])
    .filter((f) => f.comercios)
    .map((f) => ({
      usuarioComercioId: f.id,
      comercioId: f.comercio_id,
      nombre: f.comercios!.nombre,
      rol: f.rol,
      sucursalId: f.sucursal_id,
    }));
}

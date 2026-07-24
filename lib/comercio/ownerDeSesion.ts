import 'server-only';

import { cookies } from 'next/headers';
import { createClienteServidor, createServiceClient } from '@/lib/supabase/server';
import { membresiasDeUsuario } from './membresiasDeUsuario';
import { resolverComercioActivo } from './comercioActivo';
import { COOKIE_COMERCIO_ACTIVO } from './cookieComercio';

// Variante del gate del dueño para ROUTE HANDLERS (APIs): devuelve la sesión o null, y el caller
// responde 401 en JSON. verifyComercioOwner() es para páginas/acciones (redirige con
// NEXT_REDIRECT); una API no debe redirigir a una pantalla de login.
//
// Comparte con verifyComercioAcceso() la política de "comercio activo" (misma cookie, misma
// revalidación contra la lista real), pero DEVOLVIENDO en vez de redirigir: si no resuelve (2+
// comercios sin cookie válida) o el comercio activo no es de owner → null.
export async function ownerDeSesion(): Promise<{
  comercioId: string;
  nombre: string;
  usuarioComercioId: string;
} | null> {
  try {
    const supabase = await createClienteServidor();
    const { data, error } = await supabase.auth.getClaims();
    if (error) {
      console.warn('[comercio] getClaims() falló; se trata como sesión ausente:', error);
    }
    const authUserId = data?.claims?.sub;
    if (!authUserId) return null;

    const membresias = await membresiasDeUsuario(createServiceClient(), authUserId);
    const cookieStore = await cookies();
    const r = resolverComercioActivo(membresias, cookieStore.get(COOKIE_COMERCIO_ACTIVO)?.value);

    if (r.tipo !== 'resuelto' || r.membresia.rol !== 'owner') return null;
    return {
      comercioId: r.membresia.comercioId,
      nombre: r.membresia.nombre,
      usuarioComercioId: r.membresia.usuarioComercioId,
    };
  } catch (error) {
    // Fuera de un request de Next (p. ej. Vitest) cookies() lanza: sin contexto de request no hay
    // sesión — mismo resultado que un visitante anónimo. Fail-closed.
    console.warn('[comercio] no se pudo leer la sesión; se trata como ausente:', error);
    return null;
  }
}

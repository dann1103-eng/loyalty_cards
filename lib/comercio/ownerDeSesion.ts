import 'server-only';

import { createClienteServidor, createServiceClient } from '@/lib/supabase/server';
import { esOwnerDeComercio } from './esOwnerDeComercio';

// Variante del gate del dueño para ROUTE HANDLERS (APIs): devuelve la sesión o null, y el caller
// responde 401 en JSON. verifyComercioOwner() es para páginas/acciones (redirige con
// NEXT_REDIRECT); una API no debe redirigir a una pantalla de login.
export async function ownerDeSesion(): Promise<{ comercioId: string; nombre: string } | null> {
  try {
    const supabase = await createClienteServidor();
    const { data, error } = await supabase.auth.getClaims();
    if (error) {
      console.warn('[comercio] getClaims() falló; se trata como sesión ausente:', error);
    }
    const authUserId = data?.claims?.sub;
    if (!authUserId) return null;
    return await esOwnerDeComercio(createServiceClient(), authUserId);
  } catch (error) {
    // Fuera de un request de Next (p. ej. Vitest) cookies() lanza: sin contexto de request no hay
    // sesión — mismo resultado que un visitante anónimo. Fail-closed.
    console.warn('[comercio] no se pudo leer la sesión; se trata como ausente:', error);
    return null;
  }
}

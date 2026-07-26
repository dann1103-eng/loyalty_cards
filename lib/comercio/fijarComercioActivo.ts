import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClienteServidor, createServiceClient } from '@/lib/supabase/server';
import { membresiasDeUsuario } from './membresiasDeUsuario';
import { COOKIE_COMERCIO_ACTIVO, COOKIE_SUCURSAL_ACTIVA, opcionesCookieComercio } from './cookieComercio';

// Lógica compartida de "fijar el comercio activo". Su caller vivo es elegirComercio
// (/comercio/elegir); el switcher del header usa su propia acción (cambiarContextoActivo), que
// también fija sucursal y no siempre redirige. El comercioId llega del CLIENTE y se revalida
// SIEMPRE contra la lista real de membresías antes de escribir la cookie (spec §4.4: sin esa
// aserción, un POST armado a mano dejaría a la cuenta "activar" un comercio ajeno). Se mantiene
// aparte porque es lógica de seguridad: dos copias podrían divergir (un arreglo en una y no en la
// otra).
//
// OJO: redirect() y getClaims() van FUERA de cualquier try/catch — redirect() funciona LANZANDO
// NEXT_REDIRECT, y tragarse ese throw desactivaría el gate. El redirect() de acá propaga a través del
// Server Action que la llama. La cookie se escribe acá porque un Server Action sí puede modificar
// cookies (a diferencia del render de un Server Component).
export async function fijarComercioActivo(comercioId: string): Promise<never> {
  const supabase = await createClienteServidor();
  const { data, error } = await supabase.auth.getClaims();
  if (error) {
    console.warn('[comercio] getClaims() falló al fijar comercio activo; sesión ausente:', error);
  }
  const sub = data?.claims?.sub;
  if (!sub) {
    redirect('/comercio/login');
  }

  // usuarios_comercio es deny-all bajo RLS → service client.
  const membresias = await membresiasDeUsuario(createServiceClient(), sub);
  if (!membresias.some((m) => m.comercioId === comercioId)) {
    // Id ajeno o inventado: no confiar en el input, de vuelta a elegir.
    redirect('/comercio/elegir');
  }

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_COMERCIO_ACTIVO, comercioId, opcionesCookieComercio());
  // Cambiar de comercio resetea el contexto de sucursal a "todas" (la cookie vieja apuntaría a una
  // sucursal de OTRO comercio; la revalidación igual la descartaría — esto la limpia antes).
  cookieStore.delete(COOKIE_SUCURSAL_ACTIVA);
  revalidatePath('/comercio', 'layout');
  redirect('/comercio/panel');
}

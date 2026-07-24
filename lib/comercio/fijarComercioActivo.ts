import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClienteServidor, createServiceClient } from '@/lib/supabase/server';
import { membresiasDeUsuario } from './membresiasDeUsuario';
import { COOKIE_COMERCIO_ACTIVO, opcionesCookieComercio } from './cookieComercio';

// Lógica compartida de "fijar el comercio activo" para elegirComercio (/comercio/elegir) y
// cambiarComercioActivo (selector del header): el comercioId llega del CLIENTE y se revalida SIEMPRE
// contra la lista real de membresías antes de escribir la cookie (spec §4.4: sin esa aserción, un
// POST armado a mano dejaría a la cuenta "activar" un comercio ajeno). Se centraliza porque es
// lógica de seguridad: dos copias podrían divergir (un arreglo en una y no en la otra).
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
  revalidatePath('/comercio', 'layout');
  redirect('/comercio/panel');
}

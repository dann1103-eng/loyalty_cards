'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClienteServidor, createServiceClient } from '@/lib/supabase/server';
import { membresiasDeUsuario } from '@/lib/comercio/membresiasDeUsuario';
import { COOKIE_COMERCIO_ACTIVO } from '@/lib/comercio/cookieComercio';

// Fija el "comercio activo" a partir de la elección del dueño en /comercio/elegir. Recibe el
// comercioId ya ligado por bind() en el <form>, PERO ese id llega del cliente: se revalida SIEMPRE
// contra la lista real de membresías antes de escribir la cookie. Sin esa aserción, un POST armado a
// mano dejaría a la cuenta "activar" un comercio ajeno (spec §4.4).
//
// OJO: redirect() y getClaims() van FUERA de cualquier try/catch — redirect() funciona LANZANDO
// NEXT_REDIRECT, y tragarse ese throw desactivaría el gate. La cookie sí se escribe acá porque un
// Server Action puede modificar cookies (a diferencia del render de un Server Component).
export async function elegirComercio(comercioId: string) {
  const supabase = await createClienteServidor();
  const { data, error } = await supabase.auth.getClaims();
  if (error) {
    console.warn('[comercio] getClaims() falló al elegir comercio; sesión ausente:', error);
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
  cookieStore.set(COOKIE_COMERCIO_ACTIVO, comercioId, { httpOnly: true, sameSite: 'lax', path: '/' });
  revalidatePath('/comercio', 'layout');
  redirect('/comercio/panel');
}

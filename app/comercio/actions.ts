'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClienteServidor, createServiceClient } from '@/lib/supabase/server';
import { membresiasDeUsuario } from '@/lib/comercio/membresiasDeUsuario';
import { COOKIE_COMERCIO_ACTIVO } from '@/lib/comercio/cookieComercio';

export async function cerrarSesionComercio() {
  const supabase = await createClienteServidor();
  await supabase.auth.signOut();
  revalidatePath('/comercio', 'layout');
  redirect('/comercio/login');
}

// Cambia el "comercio activo" desde el selector del header (SelectorComercio). Misma lógica que
// elegirComercio en /comercio/elegir, pero como acción propia del panel: el nuevoId llega del cliente
// → se revalida SIEMPRE contra la lista real de membresías antes de escribir la cookie (spec §4.4: un
// id ajeno dejaría a la cuenta "activar" un comercio que no es suyo).
//
// OJO: redirect() y getClaims() van FUERA de cualquier try/catch (redirect() LANZA NEXT_REDIRECT).
// La cookie se escribe acá porque un Server Action sí puede modificar cookies.
export async function cambiarComercioActivo(comercioId: string) {
  const supabase = await createClienteServidor();
  const { data, error } = await supabase.auth.getClaims();
  if (error) {
    console.warn('[comercio] getClaims() falló al cambiar de comercio; sesión ausente:', error);
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

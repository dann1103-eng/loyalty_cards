'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClienteServidor } from '@/lib/supabase/server';

export type EstadoLogin = { error: string } | undefined;

export async function iniciarSesion(
  _estadoPrevio: EstadoLogin,
  formData: FormData,
): Promise<EstadoLogin> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { error: 'Ingresa tu correo y contraseña.' };
  }

  const supabase = await createClienteServidor();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Supabase no distingue "no existe la cuenta" de "contraseña incorrecta", a propósito:
    // hacerlo permitiría enumerar qué correos tienen cuenta. No lo distingas tú tampoco.
    return { error: 'Correo o contraseña incorrectos.' };
  }

  revalidatePath('/admin', 'layout');
  // redirect() lanza NEXT_REDIRECT: va FUERA de cualquier try/catch, o se traga en silencio.
  redirect('/admin/comercios');
}

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClienteServidor } from '@/lib/supabase/server';

export type EstadoLogin = { error: string } | undefined;

export async function iniciarSesionComercio(
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
    // Genérico a propósito: no distinguir "no existe" de "contraseña incorrecta" evita enumerar
    // qué correos tienen cuenta.
    return { error: 'Correo o contraseña incorrectos.' };
  }

  revalidatePath('/comercio', 'layout');
  // redirect() lanza NEXT_REDIRECT: va FUERA de cualquier try/catch.
  redirect('/comercio/panel');
}

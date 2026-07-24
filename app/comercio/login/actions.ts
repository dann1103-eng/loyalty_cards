'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClienteServidor, createServiceClient } from '@/lib/supabase/server';
import { membresiasDeUsuario } from '@/lib/comercio/membresiasDeUsuario';
import { COOKIE_COMERCIO_ACTIVO, opcionesCookieComercio } from '@/lib/comercio/cookieComercio';

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
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    // Genérico a propósito: no distinguir "no existe" de "contraseña incorrecta" evita enumerar
    // qué correos tienen cuenta.
    return { error: 'Correo o contraseña incorrectos.' };
  }

  // Sesión OK. A dónde entra depende de sus membresías: una cuenta puede administrar varios
  // comercios (elige), uno solo (directo al panel) o ser solo cajero (al escáner). usuarios_comercio
  // es deny-all bajo RLS → service client.
  const membresias = await membresiasDeUsuario(createServiceClient(), data.user.id);
  const owners = membresias.filter((m) => m.rol === 'owner');

  const cookieStore = await cookies();
  revalidatePath('/comercio', 'layout');

  // redirect() LANZA NEXT_REDIRECT → todas estas llamadas van FUERA de cualquier try/catch. La
  // cookie sí se escribe acá porque un Server Action puede modificar cookies (y viaja junto al
  // redirect en la misma respuesta).
  if (owners.length >= 2) {
    // Varios comercios propios: que elija cuál gestionar (la cookie se fija en /elegir).
    redirect('/comercio/elegir');
  }
  if (owners.length === 1) {
    cookieStore.set(COOKIE_COMERCIO_ACTIVO, owners[0].comercioId, opcionesCookieComercio());
    redirect('/comercio/panel');
  }
  if (membresias.length > 0) {
    // Sin comercios propios pero sí membresía de cajero: su lugar es el escáner.
    cookieStore.set(COOKIE_COMERCIO_ACTIVO, membresias[0].comercioId, opcionesCookieComercio());
    redirect('/comercio/escanear');
  }
  // Autenticó pero no tiene ninguna membresía: sin acceso al panel.
  redirect('/comercio/login?error=sin-permiso');
}

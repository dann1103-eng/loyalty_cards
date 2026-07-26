'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClienteServidor, createServiceClient } from '@/lib/supabase/server';
import { membresiasDeUsuario } from '@/lib/comercio/membresiasDeUsuario';
import { obtenerSucursalActiva } from '@/lib/comercio/sucursales';
import {
  COOKIE_COMERCIO_ACTIVO,
  COOKIE_SUCURSAL_ACTIVA,
  opcionesCookieComercio,
} from '@/lib/comercio/cookieComercio';

export async function cerrarSesionComercio() {
  const supabase = await createClienteServidor();
  await supabase.auth.signOut();
  revalidatePath('/comercio', 'layout');
  redirect('/comercio/login');
}

// Cambia el contexto activo (comercio + sucursal) desde el sheet del switcher (SelectorContexto).
// TODO input del cliente se revalida acá: el comercio contra las membresías OWNER de la sesión, la
// sucursal con obtenerSucursalActiva (pertenencia + activa; una ajena/apagada degrada a "todas"
// sin tumbar el cambio de comercio). NO reusa fijarComercioActivo: aquélla valida contra TODAS las
// membresías y SIEMPRE redirige al panel — acá cambiar solo de sucursal no debe sacarte de la
// página. ORDEN de cookies: la de sucursal se escribe DESPUÉS de la de comercio (fijar comercio
// resetea sucursal; al revés, la elegida se perdería).
// getClaims() y redirect() FUERA de try/catch (NEXT_REDIRECT).
export async function cambiarContextoActivo(comercioId: string, sucursalId: string | null) {
  const supabase = await createClienteServidor();
  const { data, error } = await supabase.auth.getClaims();
  if (error) {
    console.warn('[comercio] getClaims() falló al cambiar contexto; se trata como sesión ausente:', error);
  }
  const sub = data?.claims?.sub;
  if (!sub) {
    redirect('/comercio/login');
  }

  // usuarios_comercio es deny-all bajo RLS → service client.
  const servicio = createServiceClient();
  const membresias = await membresiasDeUsuario(servicio, sub);
  if (!membresias.some((m) => m.comercioId === comercioId && m.rol === 'owner')) {
    // Comercio ajeno o donde no es owner: no confiar en el input, de vuelta a elegir.
    redirect('/comercio/elegir');
  }

  let sucursalValidadaId: string | null = null;
  if (sucursalId !== null) {
    const sucursal = await obtenerSucursalActiva(servicio, sucursalId, comercioId);
    sucursalValidadaId = sucursal?.id ?? null;
  }

  const cookieStore = await cookies();
  const cambiaComercio = cookieStore.get(COOKIE_COMERCIO_ACTIVO)?.value !== comercioId;
  cookieStore.set(COOKIE_COMERCIO_ACTIVO, comercioId, opcionesCookieComercio());
  if (sucursalValidadaId) {
    cookieStore.set(COOKIE_SUCURSAL_ACTIVA, sucursalValidadaId, opcionesCookieComercio());
  } else {
    cookieStore.delete(COOKIE_SUCURSAL_ACTIVA);
  }
  revalidatePath('/comercio', 'layout');
  if (cambiaComercio) {
    redirect('/comercio/panel');
  }
}

'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import {
  crearSucursal,
  renombrarSucursal,
  cambiarEstadoSucursal,
} from '@/lib/comercio/sucursales';
import { crearComercioPropio } from '@/lib/comercios/crearComercioPropio';
import {
  COOKIE_COMERCIO_ACTIVO,
  COOKIE_SUCURSAL_ACTIVA,
  opcionesCookieComercio,
} from '@/lib/comercio/cookieComercio';

export type EstadoSucursal = { error: string } | undefined;

// El alta tiene su propio estado (no el EstadoSucursal compartido): el modal se cierra al ver
// {ok:true}, y un `undefined` de éxito sería indistinguible del estado inicial.
export type EstadoCrearSucursal = { error: string } | { ok: true } | undefined;

// CADA acción re-verifica el gate (verifyComercioOwner() FUERA de try/catch — lanza NEXT_REDIRECT)
// y toma el comercioId de la SESIÓN, nunca del formulario: un comercio_id del cliente dejaría a un
// dueño tocar sucursales de OTRO comercio.

export async function accionCrearSucursal(
  _estadoPrevio: EstadoCrearSucursal,
  formData: FormData,
): Promise<EstadoCrearSucursal> {
  const { comercioId } = await verifyComercioOwner();

  const res = await crearSucursal(createServiceClient(), comercioId, {
    nombre: String(formData.get('nombre') ?? ''),
  });
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/sucursales');
  return { ok: true };
}

export async function accionRenombrarSucursal(
  id: string,
  _estadoPrevio: EstadoSucursal,
  formData: FormData,
): Promise<EstadoSucursal> {
  const { comercioId } = await verifyComercioOwner();

  const res = await renombrarSucursal(createServiceClient(), id, comercioId, {
    nombre: String(formData.get('nombre') ?? ''),
  });
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/sucursales');
  return undefined;
}

// Toggle activar/desactivar (soft, NUNCA borra). El estado destino lo decide el botón según cómo
// está la fila hoy; la función de datos garantiza que sea un update, no un delete.
export async function accionCambiarEstado(
  id: string,
  activa: boolean,
  _estadoPrevio: EstadoSucursal,
  _formData: FormData,
): Promise<EstadoSucursal> {
  const { comercioId } = await verifyComercioOwner();

  const res = await cambiarEstadoSucursal(createServiceClient(), id, comercioId, activa);
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/sucursales');
  return undefined;
}

export type EstadoComercioPropio = { error: string } | undefined;

// Alta self-serve de comercio (modal "¿Qué estás creando?"). Gate owner FUERA de try/catch. Al
// éxito fija el comercio NUEVO como activo (su membresía owner se acaba de crear — válido por
// construcción, mismo criterio que fijar tras elegir), resetea la sucursal a "todas" y aterriza
// en /marca para terminar la identidad. redirect() LANZA NEXT_REDIRECT: nada de try/catch acá.
export async function accionCrearComercioPropio(
  _estadoPrevio: EstadoComercioPropio,
  formData: FormData,
): Promise<EstadoComercioPropio> {
  const { authUserId, comercioId } = await verifyComercioOwner();

  const res = await crearComercioPropio(
    createServiceClient(),
    { authUserId, comercioActivoId: comercioId },
    {
      nombre: String(formData.get('nombre') ?? ''),
      tipoTarjeta: String(formData.get('tipoTarjeta') ?? ''),
    },
  );
  if (!res.ok) return { error: res.error };

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_COMERCIO_ACTIVO, res.id, opcionesCookieComercio());
  cookieStore.delete(COOKIE_SUCURSAL_ACTIVA);
  revalidatePath('/comercio', 'layout');
  redirect('/comercio/branding?nuevo=1');
}

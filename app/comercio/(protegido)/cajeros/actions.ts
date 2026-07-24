'use server';

import { revalidatePath } from 'next/cache';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { crearCajero, desactivarCajero } from '@/lib/comercio/cajeros';

export type EstadoCajero = { error: string } | undefined;

// CADA acción re-verifica el gate del DUEÑO (verifyComercioOwner() FUERA de try/catch — lanza
// NEXT_REDIRECT) y toma el comercioId de la SESIÓN, nunca del formulario: un comercio_id del cliente
// dejaría a un dueño crear cajeros en OTRO comercio. El alta corre con createServiceClient()
// (auth.admin.* + insert en usuarios_comercio, que es deny-all bajo RLS).
//
// SEGURIDAD: esta acción NUNCA loguea la contraseña. No hay ningún console.* con formData ni con el
// objeto de datos; los errores que se propagan vienen de la capa lib, que solo registra error.message.

export async function accionCrearCajero(
  _estadoPrevio: EstadoCajero,
  formData: FormData,
): Promise<EstadoCajero> {
  const { comercioId } = await verifyComercioOwner();

  const res = await crearCajero(createServiceClient(), comercioId, {
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
    sucursalId: String(formData.get('sucursalId') ?? ''),
  });
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/cajeros');
  return undefined;
}

export async function accionDesactivarCajero(
  id: string,
  _estadoPrevio: EstadoCajero,
  _formData: FormData,
): Promise<EstadoCajero> {
  const { comercioId } = await verifyComercioOwner();

  const res = await desactivarCajero(createServiceClient(), id, comercioId);
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/cajeros');
  return undefined;
}

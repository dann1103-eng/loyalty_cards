'use server';

import { revalidatePath } from 'next/cache';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import {
  crearSucursal,
  renombrarSucursal,
  cambiarEstadoSucursal,
} from '@/lib/comercio/sucursales';

export type EstadoSucursal = { error: string } | undefined;

// CADA acción re-verifica el gate (verifyComercioOwner() FUERA de try/catch — lanza NEXT_REDIRECT)
// y toma el comercioId de la SESIÓN, nunca del formulario: un comercio_id del cliente dejaría a un
// dueño tocar sucursales de OTRO comercio.

export async function accionCrearSucursal(
  _estadoPrevio: EstadoSucursal,
  formData: FormData,
): Promise<EstadoSucursal> {
  const { comercioId } = await verifyComercioOwner();

  const res = await crearSucursal(createServiceClient(), comercioId, {
    nombre: String(formData.get('nombre') ?? ''),
  });
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/sucursales');
  return undefined;
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

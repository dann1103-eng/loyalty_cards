'use server';

import { revalidatePath } from 'next/cache';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { crearRecompensa, desactivarRecompensa } from '@/lib/comercio/recompensas';

export type EstadoRecompensa = { error: string } | undefined;

export async function accionCrearRecompensa(
  _estadoPrevio: EstadoRecompensa,
  formData: FormData,
): Promise<EstadoRecompensa> {
  const { comercioId } = await verifyComercioOwner();

  const costoTexto = String(formData.get('costo_puntos') ?? '').trim();
  const res = await crearRecompensa(createServiceClient(), comercioId, {
    nombre: String(formData.get('nombre') ?? ''),
    descripcion: String(formData.get('descripcion') ?? '') || null,
    costo_puntos: costoTexto === '' ? NaN : Number(costoTexto),
    tipo: String(formData.get('tipo') ?? ''),
    valor: String(formData.get('valor') ?? '') || null,
  });
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/recompensas');
  return undefined;
}

// Desactiva (soft-delete), NO borra. La función de datos ya lo garantiza; la acción solo delega.
export async function accionDesactivarRecompensa(
  id: string,
  _estadoPrevio: EstadoRecompensa,
  _formData: FormData,
): Promise<EstadoRecompensa> {
  const { comercioId } = await verifyComercioOwner();

  const res = await desactivarRecompensa(createServiceClient(), id, comercioId);
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/recompensas');
  return undefined;
}

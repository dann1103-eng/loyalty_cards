'use server';

import { revalidatePath } from 'next/cache';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { crearRegla, eliminarRegla } from '@/lib/comercio/reglas';

export type EstadoRegla = { error: string } | undefined;

export async function accionCrearRegla(
  _estadoPrevio: EstadoRegla,
  formData: FormData,
): Promise<EstadoRegla> {
  const { comercioId } = await verifyComercioOwner();

  const valorTexto = String(formData.get('valor') ?? '').trim();
  const res = await crearRegla(createServiceClient(), comercioId, {
    tipo: String(formData.get('tipo') ?? ''),
    valor: valorTexto === '' ? NaN : Number(valorTexto),
  });
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/reglas');
  return undefined;
}

export async function accionEliminarRegla(
  id: string,
  _estadoPrevio: EstadoRegla,
  _formData: FormData,
): Promise<EstadoRegla> {
  const { comercioId } = await verifyComercioOwner();

  const res = await eliminarRegla(createServiceClient(), id, comercioId);
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/reglas');
  return undefined;
}

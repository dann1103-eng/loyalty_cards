'use server';

import { revalidatePath } from 'next/cache';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { crearRegla, eliminarRegla } from '@/lib/comercio/reglas';
import { notificarCambioComercio } from '@/lib/apple/notificarCambioComercio';

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

  // Las reglas de puntos se imprimen en el reverso del pass ("Ganás N puntos por visita"): se avisa
  // a los passes ya emitidos para que Wallet los re-descargue (sin esto, muestran las reglas viejas
  // hasta el próximo cambio de puntos — bug visto en el piloto al pasar a sellos).
  await notificarCambioComercio(createServiceClient(), comercioId);

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

  // Mismo motivo que al crear: sin el push, el reverso de los passes ya emitidos sigue prometiendo
  // puntos por una regla que el dueño acaba de borrar.
  await notificarCambioComercio(createServiceClient(), comercioId);

  revalidatePath('/comercio/reglas');
  return undefined;
}

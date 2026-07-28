'use server';

import { revalidatePath } from 'next/cache';
import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { resolverSolicitud } from '@/lib/comercios/planCuenta';

export type EstadoResolucion = { error: string } | { ok: true } | undefined;

// Aprobar aplica el plan del catálogo (monto y límite). Si la cuenta quedaría por encima de su
// nuevo cupo al BAJAR de plan, resolverSolicitud lo bloquea con un mensaje que dice qué hacer —
// aplicarlo dejaría la cuenta en un estado que el propio sistema considera inválido.
export async function accionResolverSolicitud(
  solicitudId: string,
  aprobar: boolean,
  _estadoPrevio: EstadoResolucion,
  formData: FormData,
): Promise<EstadoResolucion> {
  await verifyFmAdmin();

  const res = await resolverSolicitud(
    createServiceClient(),
    solicitudId,
    aprobar,
    String(formData.get('comentario') ?? ''),
  );
  if (!res.ok) return { error: res.error };

  revalidatePath('/admin/solicitudes');
  return { ok: true };
}

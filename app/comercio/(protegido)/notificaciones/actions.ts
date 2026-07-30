'use server';

import { revalidatePath } from 'next/cache';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { crearDifusion } from '@/lib/comercio/difusiones';

export type EstadoDifusion = { error: string } | { ok: true } | undefined;

export async function accionCrearDifusion(
  _estadoPrevio: EstadoDifusion,
  formData: FormData,
): Promise<EstadoDifusion> {
  const { comercioId, authUserId } = await verifyComercioOwner();
  const supabase = createServiceClient();

  // creada_por es usuarios_comercio.id, no el authUserId — resolverlo desde la membresía activa.
  const { data: membresia, error: eMembresia } = await supabase
    .from('usuarios_comercio')
    .select('id')
    .eq('comercio_id', comercioId)
    .eq('auth_user_id', authUserId)
    .eq('rol', 'owner')
    .eq('activo', true)
    .maybeSingle();
  if (eMembresia || !membresia) {
    return { error: 'No se pudo identificar tu cuenta.' };
  }

  const programaId = String(formData.get('programa_id') ?? '');
  const res = await crearDifusion(supabase, comercioId, membresia.id, {
    mensaje: String(formData.get('mensaje') ?? ''),
    vigenteHasta: String(formData.get('vigente_hasta') ?? ''),
    programaId: programaId || null,
  });
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/notificaciones');
  return { ok: true };
}

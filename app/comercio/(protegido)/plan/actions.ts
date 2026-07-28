'use server';

import { revalidatePath } from 'next/cache';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { solicitarCambioPlan } from '@/lib/comercios/planCuenta';

export type EstadoSolicitudPlan = { error: string } | { ok: true } | undefined;

// La cuenta se deriva del comercio del gate, NUNCA de un campo del formulario: si viniera del
// cliente, un dueño podría pedir un cambio de plan sobre la cuenta de otro.
export async function cuentaDelComercio(comercioId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('comercios')
    .select('cuenta_id')
    .eq('id', comercioId)
    .maybeSingle();
  return data?.cuenta_id ?? null;
}

export async function accionSolicitarPlan(
  _estadoPrevio: EstadoSolicitudPlan,
  formData: FormData,
): Promise<EstadoSolicitudPlan> {
  const { comercioId } = await verifyComercioOwner();

  const cuentaId = await cuentaDelComercio(comercioId);
  if (!cuentaId) return { error: 'Tu comercio todavía no está asociado a una cuenta.' };

  const res = await solicitarCambioPlan(
    createServiceClient(),
    cuentaId,
    String(formData.get('plan') ?? ''),
    String(formData.get('motivo') ?? ''),
  );
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/plan');
  return { ok: true };
}

'use server';

import { revalidatePath } from 'next/cache';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { solicitarCambioPlan, subirPlanPorElDueno } from '@/lib/comercios/planCuenta';

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

// Subir de plan AL INSTANTE, sin pasar por la bandeja de FM. Bajar sigue siendo una solicitud, y la
// capa de datos lo rechaza nombrando ese camino (ver subirPlanPorElDueno).
//
// La cuenta se deriva del comercio del gate igual que arriba: nunca del formulario.
export async function accionSubirPlan(
  _estadoPrevio: EstadoSolicitudPlan,
  formData: FormData,
): Promise<EstadoSolicitudPlan> {
  const { comercioId } = await verifyComercioOwner();

  const cuentaId = await cuentaDelComercio(comercioId);
  if (!cuentaId) return { error: 'Tu comercio todavía no está asociado a una cuenta.' };

  const res = await subirPlanPorElDueno(
    createServiceClient(),
    cuentaId,
    String(formData.get('plan') ?? ''),
  );
  if (!res.ok) return { error: res.error };

  // El cupo del plan lo leen varias pantallas (sucursales, el modal de agregar local): sin esto, el
  // dueño sube de plan y sigue viendo "alcanzaste el límite" hasta que recargue a mano.
  revalidatePath('/comercio', 'layout');
  return { ok: true };
}

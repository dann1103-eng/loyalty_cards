'use server';

import { revalidatePath } from 'next/cache';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import {
  crearPrograma,
  guardarConfiguracionPrograma,
  desactivarPrograma,
  configuracionProgramaDesdeFormulario,
} from '@/lib/comercio/programas';

export type EstadoPrograma = { error: string } | { ok: true } | undefined;

function configuracionDeFormData(formData: FormData) {
  return configuracionProgramaDesdeFormulario({
    cashbackPorcentaje: String(formData.get('cashback_porcentaje') ?? ''),
    multipassVisitas: String(formData.get('multipass_visitas') ?? ''),
    membresiaDias: String(formData.get('membresia_dias') ?? ''),
    cuponVigenciaDias: String(formData.get('cupon_vigencia_dias') ?? ''),
  });
}

// NINGUNA acción de este archivo empuja cambios a los teléfonos, y no es un olvido: crear un
// programa todavía no tiene tarjetas emitidas, y la configuración del tipo (porcentaje, visitas,
// días) no se dibuja en el pase. Lo que SÍ se dibuja es el diseño de la tarjeta, y ese se edita en
// Marca (`/comercio/branding?programa=<id>`), donde vive la vista previa en vivo y donde sus
// acciones sí propagan a Apple y a Google.

export async function accionCrearPrograma(
  _estadoPrevio: EstadoPrograma,
  formData: FormData,
): Promise<EstadoPrograma> {
  const { comercioId } = await verifyComercioOwner();

  const res = await crearPrograma(createServiceClient(), comercioId, {
    nombre: String(formData.get('nombre') ?? ''),
    tipoTarjeta: String(formData.get('tipo_tarjeta') ?? ''),
    ...configuracionDeFormData(formData),
  });
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/programas');
  return { ok: true };
}

export async function accionGuardarConfiguracionPrograma(
  programaId: string,
  _estadoPrevio: EstadoPrograma,
  formData: FormData,
): Promise<EstadoPrograma> {
  const { comercioId } = await verifyComercioOwner();

  const res = await guardarConfiguracionPrograma(
    createServiceClient(),
    comercioId,
    programaId,
    configuracionDeFormData(formData),
  );
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/programas');
  return { ok: true };
}

export async function accionDesactivarPrograma(
  programaId: string,
  _estadoPrevio: EstadoPrograma,
  _formData: FormData,
): Promise<EstadoPrograma> {
  const { comercioId } = await verifyComercioOwner();

  const res = await desactivarPrograma(createServiceClient(), comercioId, programaId);
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/programas');
  return { ok: true };
}

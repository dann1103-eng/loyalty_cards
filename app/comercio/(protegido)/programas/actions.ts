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

// NOTA para quien haga la tanda del dibujo del pase: a propósito NO se llama acá a
// notificarCambioComercio/notificarCambioTarjeta. El reverso del pass hoy lee la configuración de
// `comercios`, no de `programas_tarjeta` — empujar un refresco no cambiaría nada visible y en un
// programa no-principal podría confundir (refrescaría el pass con datos de OTRO programa). Agregar
// el push cuando el dibujo del pase pase a leer desde el programa de cada tarjeta.

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

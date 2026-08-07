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
import { crearNivel, eliminarNivel } from '@/lib/tarjetas/descuento';
import { centavosDesdeTexto } from '@/lib/tarjetas/tipos';

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

// ─────────────────────────────────────────────────────────────────────────────
// Niveles de descuento
// ─────────────────────────────────────────────────────────────────────────────
// El tipo "Descuento por nivel" tenía su motor completo (registrar_compra_atomico, migración 0023) y
// su capa de datos (lib/tarjetas/descuento.ts) desde el día uno, pero NINGUNA pantalla llamaba a
// crearNivel: el dueño elegía el tipo, el cajero registraba compras, y todos sus clientes se
// quedaban en "Sin descuento todavía" para siempre porque no había un solo umbral cargado. Esto es
// lo que faltaba para que el octavo tipo fuera usable.
//
// Los niveles son del COMERCIO (`niveles_descuento.comercio_id`, 0018), no del programa. Se editan
// desde la tarjeta de su programa porque es donde el dueño los busca, pero si tuviera dos programas
// de descuento compartirían la escalera — con el tope de 2 programas activos, es un caso que no se
// da en la práctica.

export async function accionCrearNivel(
  _estadoPrevio: EstadoPrograma,
  formData: FormData,
): Promise<EstadoPrograma> {
  const { comercioId } = await verifyComercioOwner();

  // El umbral se teclea en DÓLARES y se guarda en centavos, con la función que no pasa por punto
  // flotante (Number('19.99') * 100 da 1998.9999999999998).
  const centavos = centavosDesdeTexto(String(formData.get('desde') ?? ''));
  if (centavos === null) {
    return { error: 'Escribí desde cuánto gastado aplica este nivel (por ejemplo 50.00).' };
  }

  const porcentaje = Number(String(formData.get('porcentaje') ?? '').trim().replace(',', '.'));
  if (!Number.isFinite(porcentaje)) {
    return { error: 'Escribí el porcentaje de descuento (por ejemplo 10).' };
  }

  const res = await crearNivel(createServiceClient(), comercioId, centavos, porcentaje);
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/programas');
  return { ok: true };
}

export async function accionEliminarNivel(
  nivelId: string,
  _estadoPrevio: EstadoPrograma,
  _formData: FormData,
): Promise<EstadoPrograma> {
  const { comercioId } = await verifyComercioOwner();

  // eliminarNivel se scopea por comercio_id: conocer el id de un nivel ajeno no alcanza para borrarlo.
  const res = await eliminarNivel(createServiceClient(), comercioId, nivelId);
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

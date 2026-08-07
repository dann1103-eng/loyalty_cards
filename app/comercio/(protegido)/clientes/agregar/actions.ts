'use server';

import { revalidatePath } from 'next/cache';
import { verifyComercioAcceso } from '@/lib/comercio/verifyComercioAcceso';
import { createServiceClient } from '@/lib/supabase/server';
import { altaYAcreditacionPorTelefono } from '@/lib/comercio/altaPorTelefono';
import { resolverSucursalDeAccion } from '@/lib/comercio/atribucionEscaner';
import { notificarCambioTarjeta } from '@/lib/apple/notificarCambioTarjeta';
import { syncObjetoTarjeta } from '@/lib/google/syncObjeto';

export type EstadoAgregar = { error: string; bloqueoLimite?: boolean } | { ok: true; mensaje: string } | undefined;

// Alta + acreditación por teléfono, para el cliente que pidió a domicilio y nunca estuvo en el local.
//
// Gate COMPARTIDO (dueño O cajero): quien atiende el teléfono suele ser el cajero, y mandarlo a
// pedirle el favor al dueño por cada pedido haría que la feature no se use.
//
// La atribución de sucursal se arma en el SERVIDOR y nunca se confía al cliente, igual que en el
// escáner: para un cajero la fija su membresía, para el dueño es la sucursal de su contexto activo.
export async function accionAgregarClientePorTelefono(
  _estadoPrevio: EstadoAgregar,
  formData: FormData,
): Promise<EstadoAgregar> {
  const sesion = await verifyComercioAcceso();
  const supabase = createServiceClient();

  const cantidad = Number(String(formData.get('cantidad') ?? '').trim());

  const res = await altaYAcreditacionPorTelefono(
    supabase,
    sesion.comercioId,
    {
      telefono: String(formData.get('telefono') ?? ''),
      nombre: String(formData.get('nombre') ?? ''),
      programaId: String(formData.get('programa_id') ?? ''),
      cantidad: Number.isFinite(cantidad) ? cantidad : Number.NaN,
    },
    {
      sucursalId: resolverSucursalDeAccion(sesion.rol, sesion.sucursalId, sesion.sucursalActiva?.id ?? null),
      cajeroUsuarioId: sesion.usuarioComercioId,
    },
  );

  if (!res.ok) return { error: res.error, bloqueoLimite: res.bloqueoLimite };

  // El pase del cliente se refresca solo, igual que en cualquier movimiento del escáner. Va DESPUÉS
  // de que la acreditación ya quedó firme: si el push falla, el saldo igual está bien guardado.
  await notificarCambioTarjeta(supabase, res.tarjetaId);
  await syncObjetoTarjeta(supabase, res.tarjetaId);

  revalidatePath('/comercio/clientes');
  return { ok: true, mensaje: res.mensaje };
}

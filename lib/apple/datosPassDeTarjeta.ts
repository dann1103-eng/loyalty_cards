import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import type { DatosPass } from './generatePass';

export async function datosPassDeTarjeta(
  supabase: SupabaseClient<Database>,
  serialNumber: string,
): Promise<{ datos: DatosPass; authTokenAlmacenado: string } | null> {
  // Sin esta guarda, un NEXT_PUBLIC_BASE_URL ausente produce "undefined/api/apple"
  // y un error críptico de validación (Joi) recién al firmar el pass.
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('NEXT_PUBLIC_BASE_URL no está configurada — requerida para el webServiceURL del pass');
  }

  const { data: tarjeta } = await supabase
    .from('tarjetas')
    .select('*, comercios(*)')
    .eq('apple_serial_number', serialNumber)
    .maybeSingle();

  if (!tarjeta || !tarjeta.comercios || !tarjeta.apple_auth_token) return null;

  return {
    authTokenAlmacenado: tarjeta.apple_auth_token,
    datos: {
      serialNumber,
      qrToken: tarjeta.qr_token,
      puntos: tarjeta.puntos_actuales,
      nombreComercio: tarjeta.comercios.nombre,
      colorFondo: tarjeta.comercios.color_fondo ?? 'rgb(35, 24, 18)',
      colorTexto: tarjeta.comercios.color_texto ?? 'rgb(255, 255, 255)',
      colorLabel: tarjeta.comercios.color_label ?? 'rgb(255, 255, 255)',
      webServiceURL: `${baseUrl}/api/apple`,
      authenticationToken: tarjeta.apple_auth_token,
    },
  };
}

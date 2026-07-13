import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { enviarPushActualizacion } from './enviarPush';

export async function notificarCambioTarjeta(
  supabase: SupabaseClient<Database>,
  tarjetaId: string,
): Promise<void> {
  const { data: registros } = await supabase
    .from('apple_push_registrations')
    .select('push_token, device_library_identifier')
    .eq('tarjeta_id', tarjetaId);

  if (!registros || registros.length === 0) return;

  const passTypeIdentifier = process.env.APPLE_PASS_TYPE_IDENTIFIER!;

  for (const registro of registros) {
    try {
      const resultado = await enviarPushActualizacion(registro.push_token, passTypeIdentifier);
      const fallo = resultado.failed[0];
      if (fallo && ['BadDeviceToken', 'Unregistered', 'ExpiredToken'].includes(fallo.response?.reason ?? '')) {
        // El token ya no sirve (dispositivo quitó el pass): borramos el registro para no
        // reintentar en cada cambio. Coherente con el refresh de token de la Tarea 9.
        await supabase
          .from('apple_push_registrations')
          .delete()
          .eq('device_library_identifier', registro.device_library_identifier)
          .eq('tarjeta_id', tarjetaId);
      }
    } catch (err) {
      // Un push fallido NUNCA debe tumbar la transacción de puntos — el punto ya quedó
      // guardado en base de datos (ver spec §8, manejo de errores).
      console.error('Error enviando push (ignorado, no bloquea la transacción):', err);
    }
  }
}

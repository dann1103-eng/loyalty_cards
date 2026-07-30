import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { notificarCambioTarjeta } from '../apple/notificarCambioTarjeta';
import { enviarMensajeGoogle } from '../google/enviarMensaje';

export interface ResultadoEnvio {
  enviadoApple: boolean;
  enviadoGoogle: boolean;
}

// La función compartida: manda un mensaje a UNA tarjeta puntual por los dos canales que tenga
// disponibles. Ver "La función compartida" en el spec para el razonamiento completo — en
// resumen: enviadoApple/enviadoGoogle reflejan si ESE canal tenía de verdad un dispositivo/objeto
// al que entregarle el mensaje, no si "se intentó". El caller usa `enviadoApple || enviadoGoogle`
// para decidir si la tarjeta cuenta como alcanzada.
export async function enviarMensajeTarjeta(
  supabase: SupabaseClient<Database>,
  tarjetaId: string,
  mensaje: string,
  vigenteHasta: string,
  origen: 'campana' | 'inactividad',
  difusionId?: string,
): Promise<ResultadoEnvio> {
  // 1. Estado actual del aviso — esto es lo que construirReverso lee de ahora en más, en
  // CUALQUIER regeneración del pase, no solo esta.
  const { error: errorUpdate } = await supabase
    .from('tarjetas')
    .update({ aviso_texto: mensaje, aviso_hasta: vigenteHasta })
    .eq('id', tarjetaId);
  if (errorUpdate) {
    console.error('[notificaciones] no se pudo guardar el aviso en la tarjeta:', errorUpdate);
    return { enviadoApple: false, enviadoGoogle: false };
  }

  // 2. Apple: el campo ya cambió de valor en el paso 1. enviadoApple es true solo si hay al menos
  // un dispositivo registrado — insertar la fila de auditoría igual sería una auditoría que miente.
  const { data: registrosApple } = await supabase
    .from('apple_push_registrations')
    .select('id')
    .eq('tarjeta_id', tarjetaId)
    .limit(1);
  const enviadoApple = (registrosApple?.length ?? 0) > 0;
  if (enviadoApple) {
    await notificarCambioTarjeta(supabase, tarjetaId);
    await supabase.from('notificaciones_enviadas').insert({
      tarjeta_id: tarjetaId,
      canal: 'apple',
      origen,
      difusion_id: difusionId ?? null,
    });
  }

  // 3. Google: si no tiene objeto sincronizado, no hay nada que hacer.
  const { data: tarjeta } = await supabase
    .from('tarjetas')
    .select('google_object_id')
    .eq('id', tarjetaId)
    .maybeSingle();

  let enviadoGoogle = false;
  if (tarjeta?.google_object_id) {
    // Candado de 3/24h — POR CANAL, no por origen: las filas de Apple del paso 2 no cuentan acá,
    // el candado es específicamente el tope de Google.
    const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('notificaciones_enviadas')
      .select('id', { count: 'exact', head: true })
      .eq('tarjeta_id', tarjetaId)
      .eq('canal', 'google')
      .gte('enviada_en', hace24h);

    if ((count ?? 0) < 3) {
      const exito = await enviarMensajeGoogle(tarjeta.google_object_id, 'Cardly SV', mensaje);
      if (exito) {
        enviadoGoogle = true;
        await supabase.from('notificaciones_enviadas').insert({
          tarjeta_id: tarjetaId,
          canal: 'google',
          origen,
          difusion_id: difusionId ?? null,
        });
      }
    }
  }

  return { enviadoApple, enviadoGoogle };
}

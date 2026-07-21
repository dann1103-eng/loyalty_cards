import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { walletClient, issuerId } from './walletClient';
import { idObjetoGoogle } from './ids';
import { construirObjeto } from './construirRecursos';

export type ResultadoSyncObjeto = { ok: true; objectId: string } | { ok: false; error: string };

// Crea (una sola vez) o actualiza el LoyaltyObject de una tarjeta: saldo, tipo, QR. Requiere que
// el comercio ya tenga google_class_id (ver syncClaseComercio) — si no lo tiene, no-op best-effort
// (mismo criterio: nunca rompe el flujo que llama, sea registro, acreditación o canje).
export async function syncObjetoTarjeta(
  supabase: SupabaseClient<Database>,
  tarjetaId: string,
): Promise<ResultadoSyncObjeto> {
  const { data: tarjeta, error } = await supabase
    .from('tarjetas')
    .select('qr_token, puntos_actuales, google_object_id, comercios(google_class_id, tipo_tarjeta, sello_meta)')
    .eq('id', tarjetaId)
    .maybeSingle();

  if (error || !tarjeta || !tarjeta.comercios) {
    console.error('[google] no se pudo leer la tarjeta para sincronizar el objeto:', error);
    return { ok: false, error: 'No se pudo leer la tarjeta.' };
  }
  if (!tarjeta.comercios.google_class_id) {
    return { ok: false, error: 'El comercio no tiene Google Wallet habilitado.' };
  }

  try {
    const objectId = tarjeta.google_object_id ?? idObjetoGoogle(issuerId(), tarjetaId);
    const cuerpo = construirObjeto(objectId, tarjeta.comercios.google_class_id, {
      qrToken: tarjeta.qr_token,
      puntosActuales: tarjeta.puntos_actuales,
      tipoTarjeta: tarjeta.comercios.tipo_tarjeta,
      selloMeta: tarjeta.comercios.sello_meta,
    });
    const client = walletClient();

    if (tarjeta.google_object_id) {
      await client.loyaltyobject.patch({ resourceId: objectId, requestBody: cuerpo });
    } else {
      await client.loyaltyobject.insert({ requestBody: cuerpo });
      const { error: errorUpdate } = await supabase
        .from('tarjetas')
        .update({ google_object_id: objectId })
        .eq('id', tarjetaId)
        .is('google_object_id', null);
      if (errorUpdate) {
        console.error('[google] el objeto se creó pero no se pudo guardar su id:', errorUpdate);
      }
    }
    return { ok: true, objectId };
  } catch (err) {
    console.error('[google] falló la sincronización del objeto:', err);
    return { ok: false, error: 'No se pudo sincronizar con Google Wallet.' };
  }
}

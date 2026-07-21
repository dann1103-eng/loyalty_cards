import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { walletClient, issuerId } from './walletClient';
import { idClaseGoogle } from './ids';
import { construirClase } from './construirRecursos';

export type ResultadoSyncClase = { ok: true; classId: string } | { ok: false; error: string };

// Crea (una sola vez) o actualiza la LoyaltyClass de un comercio. Best-effort a propósito, igual
// que notificarCambioTarjeta para Apple: un fallo de Google Wallet nunca debe tumbar el flujo que
// lo llama (registro de cliente, guardado de branding). Google exige programLogo — sin logo el
// comercio simplemente no tiene Google Wallet habilitado todavía (el botón "Agregar a Google
// Wallet" del registro se oculta cuando comercios.google_class_id es null).
export async function syncClaseComercio(
  supabase: SupabaseClient<Database>,
  comercioId: string,
): Promise<ResultadoSyncClase> {
  const { data: comercio, error } = await supabase
    .from('comercios')
    .select('nombre, color_fondo, logo_url, hero_url, google_class_id')
    .eq('id', comercioId)
    .maybeSingle();

  if (error || !comercio) {
    console.error('[google] no se pudo leer el comercio para sincronizar la clase:', error);
    return { ok: false, error: 'No se pudo leer el comercio.' };
  }
  if (!comercio.logo_url) {
    return { ok: false, error: 'El comercio todavía no tiene logo; Google Wallet lo requiere.' };
  }

  try {
    const classId = comercio.google_class_id ?? idClaseGoogle(issuerId(), comercioId);
    const cuerpo = construirClase(classId, {
      nombre: comercio.nombre,
      colorFondo: comercio.color_fondo,
      logoUrl: comercio.logo_url,
      heroUrl: comercio.hero_url,
    });
    const client = walletClient();

    if (comercio.google_class_id) {
      await client.loyaltyclass.patch({ resourceId: classId, requestBody: cuerpo });
    } else {
      await client.loyaltyclass.insert({ requestBody: cuerpo });
      // Guard de una sola escritura (igual que .is('apple_serial_number', null) en /api/registro):
      // si dos requests concurrentes crean la clase a la vez, ambas llamadas a Google son
      // idempotentes por id, pero solo la primera escritura en BD debe "ganar".
      const { error: errorUpdate } = await supabase
        .from('comercios')
        .update({ google_class_id: classId })
        .eq('id', comercioId)
        .is('google_class_id', null);
      if (errorUpdate) {
        console.error('[google] la clase se creó pero no se pudo guardar su id:', errorUpdate);
      }
    }
    return { ok: true, classId };
  } catch (err) {
    console.error('[google] falló la sincronización de la clase:', err);
    return { ok: false, error: 'No se pudo sincronizar con Google Wallet.' };
  }
}

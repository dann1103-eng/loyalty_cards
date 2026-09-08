import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { walletClient, issuerId } from './walletClient';
import { idClaseGoogle } from './ids';
import { construirClase } from './construirRecursos';
import { heroUrlDeClase } from './heroUrl';
import { listarUbicacionesGeopush } from '../comercio/geopush';
import { encuadreDelComercio } from '../comercio/encuadreFranja';

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
    .select(
      'nombre, color_fondo, color_label, logo_url, hero_url, difuminado_franja, encuadre_franja, foco_franja_x, foco_franja_y, zoom_franja, google_class_id',
    )
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
    // Las ubicaciones del geopush viven en `sucursales`, no en `comercios`, así que hacen falta una
    // consulta aparte. listarUbicacionesGeopush ya devuelve [] ante un error: un fallo acá deja la
    // clase sin aviso por cercanía, no sin clase.
    const ubicaciones = await listarUbicacionesGeopush(supabase, comercioId);

    // La portada compuesta (misma banda que el pass de Apple), versionada por todo lo que dibuja. Si
    // falta NEXT_PUBLIC_BASE_URL cae a la foto cruda: degradación, no fallo.
    const heroUrl = heroUrlDeClase(comercioId, null, {
      colorFondo: comercio.color_fondo,
      colorLabel: comercio.color_label,
      heroUrl: comercio.hero_url,
      difuminadoFranja: comercio.difuminado_franja,
      encuadreFranja: encuadreDelComercio(comercio),
    });

    const cuerpo = construirClase(classId, {
      nombre: comercio.nombre,
      colorFondo: comercio.color_fondo,
      logoUrl: comercio.logo_url,
      heroUrl,
      ubicaciones,
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

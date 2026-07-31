import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { walletClient, issuerId } from './walletClient';
import { idObjetoGoogle } from './ids';
import { construirObjeto } from './construirRecursos';
import { urlHeroTarjeta, versionHero } from './heroUrl';
import { listarUbicacionesGeopush } from '../comercio/geopush';
import { brandingEfectivo } from '../comercio/brandingEfectivo';

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
    // programas_tarjeta trae el tipo y la meta REALES: desde la 0024 viven en el programa y las
    // columnas homónimas de comercios quedaron legadas. Sin este join, la tarjeta de un programa
    // secundario se sincronizaba a Google con el tipo del COMERCIO — la misma falla que tenía el
    // lado de Apple (ver datosPassDeTarjeta.ts).
    .select('qr_token, puntos_actuales, google_object_id, comercio_id, programas_tarjeta(tipo_tarjeta, sello_meta, google_class_id, branding_propio, color_fondo, color_label, hero_url, strip_url, sello_icono_url, difuminado_franja), comercios(google_class_id, tipo_tarjeta, sello_meta, color_fondo, color_label, sello_icono_url, hero_url, strip_url, difuminado_franja)')
    .eq('id', tarjetaId)
    .maybeSingle();

  if (error || !tarjeta || !tarjeta.comercios) {
    console.error('[google] no se pudo leer la tarjeta para sincronizar el objeto:', error);
    return { ok: false, error: 'No se pudo leer la tarjeta.' };
  }
  if (!tarjeta.comercios.google_class_id) {
    return { ok: false, error: 'El comercio no tiene Google Wallet habilitado.' };
  }

  // Cuelga del PROGRAMA entero, no de cada campo: con `??`, un programa de cupón (sello_meta null
  // legítimamente) heredaría la meta del comercio y volvería a dibujarse como grilla de sellos.
  const programa = tarjeta.programas_tarjeta;
  if (!programa) {
    console.error(`[google] la tarjeta ${tarjetaId} no tiene programa; se usa el tipo legado del comercio`);
  }
  const tipoTarjeta = programa ? programa.tipo_tarjeta : tarjeta.comercios.tipo_tarjeta;
  const selloMeta = programa ? programa.sello_meta : tarjeta.comercios.sello_meta;

  // El branding EFECTIVO alimenta el hash del cache-busting, y tiene que ser EL MISMO que usa
  // /api/tarjetas/<id>/hero.png para dibujar. Si divergen, la URL cambia, Google re-descarga y
  // recibe la imagen de siempre — cache-busting perfecto entregando lo incorrecto, sin errores.
  const cm = tarjeta.comercios;
  const marca = brandingEfectivo(
    {
      colorFondo: cm.color_fondo,
      colorTexto: cm.color_label, // el objeto no usa color_texto; se pasa algo válido y se ignora
      colorLabel: cm.color_label,
      logoUrl: null,
      heroUrl: cm.hero_url,
      stripUrl: cm.strip_url,
      selloIconoUrl: cm.sello_icono_url,
      difuminadoFranja: cm.difuminado_franja,
    },
    programa
      ? {
          brandingPropio: programa.branding_propio,
          colorFondo: programa.color_fondo,
          colorLabel: programa.color_label,
          heroUrl: programa.hero_url,
          stripUrl: programa.strip_url,
          selloIconoUrl: programa.sello_icono_url,
          difuminadoFranja: programa.difuminado_franja ?? undefined,
        }
      : null,
  );

  try {
    const objectId = tarjeta.google_object_id ?? idObjetoGoogle(issuerId(), tarjetaId);
    // Google pide las ubicaciones en la clase Y en el objeto (ver construirRecursos.ts). Es una
    // consulta extra en cada sync, igual que la que ya hace syncClaseComercio, y devuelve [] ante
    // un error: un fallo acá deja el objeto sin geopush, no sin objeto.
    const ubicaciones = await listarUbicacionesGeopush(supabase, tarjeta.comercio_id);
    // El objeto cuelga de la clase del PROGRAMA si tiene una propia (branding por programa, 0027);
    // si no, de la del comercio. Google guarda logo y colores en la CLASE, así que este `??` es lo
    // que hace que el color propio de un programa se vea en Android.
    //
    // OJO: la guarda de "Google Wallet habilitado" de más arriba sigue mirando el COMERCIO a
    // propósito. Sin clase del comercio no hay Wallet para nadie de ese negocio, tenga el programa
    // la clase que tenga — si esa guarda mirara el programa, un comercio sin Wallet habilitado
    // empezaría a emitir objetos sueltos.
    const classId = programa?.google_class_id ?? tarjeta.comercios.google_class_id;
    const cuerpo = construirObjeto(objectId, classId, {
      qrToken: tarjeta.qr_token,
      puntosActuales: tarjeta.puntos_actuales,
      tipoTarjeta,
      selloMeta,
      ubicaciones,
      heroImageUrl: urlHeroTarjeta(
        tarjetaId,
        versionHero({
          puntos: tarjeta.puntos_actuales,
          selloMeta,
          colorFondo: marca.colorFondo,
          colorLabel: marca.colorLabel,
          selloIconoUrl: marca.selloIconoUrl,
          heroUrl: marca.heroUrl,
          stripUrl: marca.stripUrl,
          difuminadoFranja: marca.difuminadoFranja,
        }),
      ),
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

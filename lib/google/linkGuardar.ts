import jwt from 'jsonwebtoken';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { credencialesServicio, issuerId } from './walletClient';
import { idObjetoGoogle } from './ids';
import { construirClase, construirObjeto } from './construirRecursos';
import { syncClaseComercio } from './syncClase';
import { syncObjetoTarjeta } from './syncObjeto';
import { urlHeroTarjeta } from './heroUrl';

// Payload con la clase y el objeto EMBEBIDOS (no solo su id): mismo patrón exacto de
// google-wallet/rest-samples/nodejs/demo-loyalty.js, verificado 2026-07-20. La documentación
// oficial no confirma un modo "solo referencia" para objetos ya creados por REST, así que se usa
// la forma que sí está garantizada: Google hace upsert por id al procesar el JWT, sea que el
// objeto ya exista (creado en el registro, ver syncObjeto.ts) o no.
export async function generarLinkGuardar(
  supabase: SupabaseClient<Database>,
  tarjetaId: string,
): Promise<string | null> {
  const { data: tarjeta, error } = await supabase
    .from('tarjetas')
    .select('comercio_id, qr_token, puntos_actuales, comercios(nombre, color_fondo, logo_url, hero_url, google_class_id, tipo_tarjeta, sello_meta)')
    .eq('id', tarjetaId)
    .maybeSingle();

  if (error || !tarjeta || !tarjeta.comercios || !tarjeta.comercios.logo_url) {
    return null;
  }

  // Autorreparación: la sincronización de /api/registro (o de un guardado de branding) puede
  // haber fallado en silencio (best-effort, ej. un cold start lento) dejando la clase o el
  // objeto sin crear del lado de Google. Que alguien pida el link de guardado es la señal de
  // que sí lo necesita — vale la pena reintentar acá antes de rendirse. syncObjetoTarjeta
  // SIEMPRE se llama (no solo si falta): si el objeto ya existe hace un patch con el saldo
  // actual; si no existe lo crea — así tarjetas.google_object_id queda consistente para que
  // futuras acreditaciones/canjes actualicen (patch) en vez de reintentar un insert duplicado.
  let classId = tarjeta.comercios.google_class_id;
  if (!classId) {
    const resClase = await syncClaseComercio(supabase, tarjeta.comercio_id);
    if (!resClase.ok) return null;
    classId = resClase.classId;
  }
  await syncObjetoTarjeta(supabase, tarjetaId);

  const objectId = idObjetoGoogle(issuerId(), tarjetaId);

  const clase = construirClase(classId, {
    nombre: tarjeta.comercios.nombre,
    colorFondo: tarjeta.comercios.color_fondo,
    logoUrl: tarjeta.comercios.logo_url,
    heroUrl: tarjeta.comercios.hero_url,
  });
  const objeto = construirObjeto(objectId, classId, {
    qrToken: tarjeta.qr_token,
    puntosActuales: tarjeta.puntos_actuales,
    tipoTarjeta: tarjeta.comercios.tipo_tarjeta,
    selloMeta: tarjeta.comercios.sello_meta,
    heroImageUrl: urlHeroTarjeta(tarjetaId),
  });

  const { client_email, private_key } = credencialesServicio();
  const claims = {
    iss: client_email,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Date.now() / 1000),
    origins: [] as string[],
    payload: { loyaltyClasses: [clase], loyaltyObjects: [objeto] },
  };
  const token = jwt.sign(claims, private_key, { algorithm: 'RS256' });
  return `https://pay.google.com/gp/v/save/${token}`;
}

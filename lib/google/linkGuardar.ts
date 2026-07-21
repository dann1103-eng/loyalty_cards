import jwt from 'jsonwebtoken';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { credencialesServicio, issuerId } from './walletClient';
import { idObjetoGoogle } from './ids';
import { construirClase, construirObjeto } from './construirRecursos';

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
    .select('qr_token, puntos_actuales, comercios(nombre, color_fondo, logo_url, hero_url, google_class_id, tipo_tarjeta, sello_meta)')
    .eq('id', tarjetaId)
    .maybeSingle();

  if (error || !tarjeta || !tarjeta.comercios || !tarjeta.comercios.google_class_id || !tarjeta.comercios.logo_url) {
    return null;
  }

  const classId = tarjeta.comercios.google_class_id;
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

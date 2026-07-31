import jwt from 'jsonwebtoken';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { credencialesServicio, issuerId } from './walletClient';
import { idObjetoGoogle } from './ids';
import { construirClase, construirObjeto } from './construirRecursos';
import { syncClaseComercio } from './syncClase';
import { syncClasePrograma } from './syncClasePrograma';
import { syncObjetoTarjeta } from './syncObjeto';
import { urlHeroTarjeta, versionHero } from './heroUrl';
import { listarUbicacionesGeopush } from '../comercio/geopush';
import { brandingEfectivo } from '../comercio/brandingEfectivo';

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
    // programas_tarjeta trae el tipo y la meta REALES (0024). Sin este join, el objeto que se
    // EMBEBE en el JWT se armaba con el tipo del COMERCIO — y como Google hace upsert por id al
    // procesar el JWT, ese cuerpo PISABA al que syncObjetoTarjeta acababa de escribir bien unas
    // líneas más abajo. O sea que el camino "Agregar a Google Wallet" reintroducía en silencio el
    // bug que el resto del sistema ya tenía arreglado.
    .select('comercio_id, qr_token, puntos_actuales, programas_tarjeta(id, tipo_tarjeta, sello_meta, google_class_id, branding_propio, color_fondo, color_texto, color_label, logo_url, hero_url, strip_url, sello_icono_url, difuminado_franja), comercios(nombre, color_fondo, color_texto, color_label, logo_url, hero_url, strip_url, sello_icono_url, difuminado_franja, google_class_id, tipo_tarjeta, sello_meta)')
    .eq('id', tarjetaId)
    .maybeSingle();

  if (error || !tarjeta || !tarjeta.comercios || !tarjeta.comercios.logo_url) {
    return null;
  }

  // Cuelga del PROGRAMA entero, no de cada campo: con `??`, un cupón (sello_meta null legítimo)
  // heredaría la meta del comercio y volvería a dibujarse como grilla de sellos.
  const programa = tarjeta.programas_tarjeta;
  const tipoTarjeta = programa ? programa.tipo_tarjeta : tarjeta.comercios.tipo_tarjeta;
  const selloMeta = programa ? programa.sello_meta : tarjeta.comercios.sello_meta;

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
  // Si el programa tiene (o necesita) su propia clase, esa es la que va en el JWT. Se sincroniza
  // ANTES de armarlo para que exista del lado de Google cuando el usuario toque el botón.
  //
  // Es crítico que el JWT lleve la clase CORRECTA: Google hace upsert por id al procesarlo, así que
  // un cuerpo con la clase equivocada pisa lo que syncObjetoTarjeta acaba de escribir bien. Esa
  // fue exactamente la falla del 2026-07-30 con el tipo de tarjeta (commit 998bcae).
  if (programa) {
    const resProg = await syncClasePrograma(supabase, tarjeta.comercio_id, programa.id);
    if (resProg.ok && resProg.classId) classId = resProg.classId;
  }
  await syncObjetoTarjeta(supabase, tarjetaId);

  const objectId = idObjetoGoogle(issuerId(), tarjetaId);

  // Las mismas ubicaciones que pone syncClaseComercio: esta clase viaja EMBEBIDA en el JWT y es la
  // que Google usa si todavía no existe, así que omitirlas acá dejaría sin geopush justamente a los
  // clientes que estrenan la tarjeta por este camino.
  const ubicaciones = await listarUbicacionesGeopush(supabase, tarjeta.comercio_id);

  // El branding EFECTIVO, no el del comercio: si el programa tiene marca propia, la clase que
  // viaja en el JWT tiene que llevarla o Google la pisa con la del comercio al hacer upsert.
  const cm = tarjeta.comercios;
  const marca = brandingEfectivo(
    {
      colorFondo: cm.color_fondo,
      colorTexto: cm.color_texto,
      colorLabel: cm.color_label,
      logoUrl: cm.logo_url,
      heroUrl: cm.hero_url,
      stripUrl: cm.strip_url,
      selloIconoUrl: cm.sello_icono_url,
      difuminadoFranja: cm.difuminado_franja,
    },
    programa
      ? {
          brandingPropio: programa.branding_propio,
          colorFondo: programa.color_fondo,
          colorTexto: programa.color_texto,
          colorLabel: programa.color_label,
          logoUrl: programa.logo_url,
          heroUrl: programa.hero_url,
          stripUrl: programa.strip_url,
          selloIconoUrl: programa.sello_icono_url,
          difuminadoFranja: programa.difuminado_franja ?? undefined,
        }
      : null,
  );

  // La guarda de arriba ya garantizó que el comercio tiene logo, y brandingEfectivo hereda ese
  // valor cuando el programa no define uno propio — así que acá nunca es null. El `??` final es
  // solo para que el tipo lo refleje.
  const clase = construirClase(classId, {
    nombre: cm.nombre,
    colorFondo: marca.colorFondo,
    logoUrl: marca.logoUrl ?? tarjeta.comercios.logo_url,
    heroUrl: marca.heroUrl,
    ubicaciones,
  });
  const objeto = construirObjeto(objectId, classId, {
    qrToken: tarjeta.qr_token,
    puntosActuales: tarjeta.puntos_actuales,
    tipoTarjeta,
    selloMeta,
    // Las mismas del bloque de arriba: Google pide las ubicaciones en la clase Y en el objeto.
    ubicaciones,
    heroImageUrl: urlHeroTarjeta(
      tarjetaId,
      // El hash del cache-busting tiene que salir del branding EFECTIVO, el mismo que usa
      // /api/tarjetas/<id>/hero.png para DIBUJAR. Si divergen, la URL cambia, Google re-descarga y
      // recibe la imagen de siempre: cache-busting perfecto entregando lo incorrecto, sin un solo
      // error. Es el riesgo que el spec de branding por programa marca como el peor del sistema.
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

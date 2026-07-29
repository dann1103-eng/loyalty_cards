import type { Metadata } from 'next';
import { MARCA } from './marca';

// Vista previa de enlace (OpenGraph + Twitter Card) en UN solo lugar.
//
// ══ POR QUÉ ESTE ARCHIVO EXISTE ══
// Next NO hace merge PROFUNDO de `metadata`: cuando una página define `openGraph`, ese objeto
// REEMPLAZA entero al del layout, no se combina campo por campo. La primera versión de esto puso
// `openGraph: { url, title, description }` en la landing dando por hecho que `images` se heredaba
// del layout, y el resultado fue una página SIN `og:image` — o sea, un enlace compartido sin
// imagen. Lo mismo pasó con `twitter.card`, que volvió a `summary` (la tarjeta chica) y se perdió
// el `summary_large_image`.
//
// El bug no se ve en el código ni lo atrapa el typechecker: las dos formas compilan igual. Solo
// aparece leyendo las meta tags que el navegador realmente recibe. Con estos helpers, cualquier
// página que quiera cambiar el título arrastra la imagen y el tipo de tarjeta sin poder olvidarlos.

export const DESCRIPCION_SITIO =
  'Sellos, puntos, cashback y más, directo en la billetera del teléfono de tus clientes. Sin apps que instalar y sin plásticos que perder.';

// Tarjeta 1200×630 (la relación 1.91:1 que piden WhatsApp, Facebook, LinkedIn, X y Telegram),
// compuesta con los insumos reales de marca: la foto del kit + el wordmark. Ruta relativa a
// propósito — `metadataBase` en app/layout.tsx la vuelve absoluta al emitir las tags, que es lo que
// los scrapers necesitan (no resuelven rutas relativas).
export const IMAGEN_OG = '/_inicio/og.jpg';
export const ALT_OG = `${MARCA.nombre}: tarjetas de lealtad digitales en la billetera del teléfono.`;

interface Opciones {
  titulo: string;
  descripcion?: string;
  // Ruta de la página, relativa a metadataBase. '/' para la landing.
  url?: string;
}

export function openGraphDe({ titulo, descripcion = DESCRIPCION_SITIO, url = '/' }: Opciones): Metadata['openGraph'] {
  return {
    type: 'website',
    siteName: MARCA.nombre,
    locale: 'es_SV',
    url,
    title: titulo,
    description: descripcion,
    images: [{ url: IMAGEN_OG, width: 1200, height: 630, alt: ALT_OG }],
  };
}

// El `fb:app_id` que el depurador de Facebook reclama como "propiedad obligatoria".
//
// ══ NO ES OBLIGATORIO PARA LA VISTA PREVIA ══ El depurador lo marca en rojo en cualquier sitio que
// no lo tenga, pero la tarjeta del enlace funciona igual (verificado: la previa carga bien sin él).
// Solo sirve para atribuirle a una App de Facebook las estadísticas de dominio de lo que se
// comparte. Sin App de Facebook no hay nada que atribuir, así que el aviso se puede ignorar.
//
// Se lee de env y NO se escribe a mano acá: el ID sale de crear una App en
// developers.facebook.com, que es una cuenta del dueño. Cuando exista, es agregar
// FACEBOOK_APP_ID en Vercel y volver a desplegar — sin tocar código.
//
// Sin la variable la clave se OMITE por completo. Emitir `<meta property="fb:app_id" content="">`
// sería peor que no emitirla: Facebook lo lee como un ID inválido en vez de como ausente.
export function facebookDe(): Metadata['facebook'] | undefined {
  const appId = process.env.FACEBOOK_APP_ID?.trim();
  return appId ? { appId } : undefined;
}

export function twitterDe({ titulo, descripcion = DESCRIPCION_SITIO }: Opciones): Metadata['twitter'] {
  return {
    // summary_large_image muestra la imagen grande arriba del título; `summary` la encajona chiquita
    // al costado y desperdicia la tarjeta.
    card: 'summary_large_image',
    title: titulo,
    description: descripcion,
    images: [{ url: IMAGEN_OG, alt: ALT_OG }],
  };
}

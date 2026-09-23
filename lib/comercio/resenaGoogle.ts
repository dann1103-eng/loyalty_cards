import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

// Reseña de Google antes del registro (columnas pedir_resena_google/resena_google_url de comercios,
// migración 0039). Nace del primer onboarding con clientes reales (2026-09-22): el dueño quiere
// pedirle al cliente "déjanos una reseña y recibí tu primer sello" antes de sacar la tarjeta.
// Sistema de HONOR a propósito (decisión 3 de la spec): Google no deja verificar en tiempo real que
// la reseña exista sin la API de Business Profile, así que la app no lo intenta — se confía en que el
// cliente tocó el link.
// Spec: docs/superpowers/specs/2026-09-23-onboarding-manifest-monto-resena-design.md, sección 3.
//
// POR QUÉ LA LISTA DE HOSTS: el link se pega crudo en una página pública que el cliente ve como del
// negocio (Tarea 8, RegistroCliente.tsx) y se abre con target="_blank". Sin esta lista, pegar por
// error el link de Instagram mandaría al cliente a otro lado con la cara de Cardly puesta encima, y
// una cuenta de dueño comprometida tendría una forma lista para mandar clientes a cualquier sitio.
// Validar contra un puñado de hosts de Google ataja las dos cosas sin impedir el pegado normal (un
// link de "Pedir reseñas" del Perfil de Empresa, o uno copiado de Google Maps).
//
// CORREGIDO el 2026-09-23, tras la revisión de código de este mismo archivo (commit 455b165): la
// primera versión aceptaba CUALQUIER subdominio de google.com (`host === 'google.com' ||
// host.endsWith('.google.com')`). Eso dejaba pasar `sites.google.com` —páginas que publica
// cualquiera, sin relación con el negocio— y `docs.google.com/forms` —un formulario que le pide
// datos al cliente con la marca de Google puesta encima—. La lista ahora es de HOSTS EXACTOS, sin
// ningún sufijo abierto.

// g.page y maps.app.goo.gl: cualquier ruta. Son los links que da directamente "Pedir reseñas" del
// Perfil de Empresa y el enlace corto que arma Google Maps; no existe una página DENTRO de esos dos
// hosts que no sea justamente eso.
const HOSTS_RUTA_LIBRE = new Set(['g.page', 'maps.app.goo.gl']);

// google.com/.com.sv y sus tres subdominios de Maps/búsqueda — los ocho hosts, EXACTOS, con los que
// un link de reseña puede llegar. `maps.google.com` y `search.google.com` son los que arma un
// "Compartir" desde la app de Maps o desde una búsqueda; `www.google.com` es el genérico. El
// mercado es El Salvador: un link copiado ahí puede traer el dominio local (.com.sv), no solo el
// genérico — por eso los mismos cuatro, dos veces.
const HOSTS_GOOGLE = new Set([
  'google.com', 'www.google.com', 'search.google.com', 'maps.google.com',
  'google.com.sv', 'www.google.com.sv', 'search.google.com.sv', 'maps.google.com.sv',
]);

// google.com/url y google.com/amp son los saltos GENÉRICOS de Google (el "esto te saca del sitio" de
// los resultados de búsqueda, y el visor de páginas AMP): los dos reenvían a lo que traiga la query o
// el resto de la ruta, sea lo que sea — exactamente la puerta que esta función existe para cerrar. Un
// link de reseña legítimo nunca empieza así.
function esRutaDeRedireccion(pathname: string): boolean {
  return pathname.startsWith('/url') || pathname.startsWith('/amp');
}

// Comparación EXACTA de host (`Set.has`), nunca `includes` ni sufijo abierto: `malogoogle.com` no
// está en `HOSTS_GOOGLE`, ni tampoco `google.com.malo.com` ni `sites.google.com` — ninguno de los
// tres es una de las ocho cadenas exactas. `url.hostname` ya llega en minúsculas (lo normaliza el
// propio parser de URL).
function hostYRutaPermitidos(url: URL): boolean {
  const host = url.hostname;
  if (HOSTS_RUTA_LIBRE.has(host)) return true;
  // goo.gl es el acortador GENÉRICO de Google: goo.gl/xxxxx puede apuntar a cualquier sitio del
  // mundo. Su forma de Maps, en cambio, siempre empieza con /maps/ y solo la arma Google Maps.
  if (host === 'goo.gl') return url.pathname.startsWith('/maps/');
  if (HOSTS_GOOGLE.has(host)) return !esRutaDeRedireccion(url.pathname);
  return false;
}

export type ResultadoValidacionUrl = { ok: true; url: string | null } | { ok: false; error: string };

// El CHECK de la 0039 (`resena_google_url` con `char_length(...) <= 500`): sin este atajador acá, un
// link larguísimo pasaría esta validación y recién la BD lo rechazaría — el dueño vería el genérico
// "No se pudo guardar la configuración." sin ninguna pista de qué estuvo mal.
export const MAXIMO_LARGO_URL_RESENA = 500;

const ERROR_NO_ES_LINK =
  'Ese texto no es un link. Pegá el link para dejar reseña que te da Google (empieza con https://g.page/…).';
const ERROR_NO_HTTPS = 'El link tiene que empezar con https://.';
const ERROR_CREDENCIALES_O_PUERTO =
  'Ese link no puede llevar usuario, contraseña ni puerto. Pegá el link tal como te lo da Google.';
const ERROR_HOST_AJENO =
  'Ese link no es de Google. Pegá el link para dejar reseña que te da Google (empieza con https://g.page/…).';
const ERROR_MUY_LARGO =
  "Ese link es muy largo. Usá el de \"Pedir reseñas\" de tu Perfil de Empresa de Google (https://g.page/…).";

// Vacío (tras recortar) es válido: es "no hay link todavía", no un error — el dueño puede guardar la
// casilla apagada sin haber pegado nada.
//
// Devuelve y guarda `url.href`, NUNCA el texto tal como lo tecleó el dueño: es lo que de verdad se
// va a usar como `href` en la página de registro (Tarea 8), así que es lo que hay que validar —
// incluido el largo, que se mide sobre `url.href` y no sobre el texto crudo.
export function validarUrlResenaGoogle(texto: string): ResultadoValidacionUrl {
  const limpio = texto.trim();
  if (!limpio) return { ok: true, url: null };

  let url: URL;
  try {
    url = new URL(limpio);
  } catch {
    return { ok: false, error: ERROR_NO_ES_LINK };
  }

  // Antes que el host: un `javascript:alert(1)` parsea sin tirar (es un esquema válido para `URL`),
  // así que sin este chequeo llegaría al de abajo con un hostname vacío en vez de quedar atajado acá
  // con un mensaje que tiene sentido.
  if (url.protocol !== 'https:') {
    return { ok: false, error: ERROR_NO_HTTPS };
  }

  // `https://malo.com@g.page/r/x` tiene un HOST válido (g.page) con un usuario que imita otro sitio;
  // sin este chequeo se colaría porque el chequeo de host de abajo solo mira `url.hostname`, nunca
  // `url.username`. Va ANTES del chequeo de host a propósito: un link con usuario/contraseña/puerto
  // se rechaza por eso, aunque el host en sí fuera uno permitido.
  if (url.username || url.password || url.port) {
    return { ok: false, error: ERROR_CREDENCIALES_O_PUERTO };
  }

  if (!hostYRutaPermitidos(url)) {
    return { ok: false, error: ERROR_HOST_AJENO };
  }

  if (url.href.length > MAXIMO_LARGO_URL_RESENA) {
    return { ok: false, error: ERROR_MUY_LARGO };
  }

  return { ok: true, url: url.href };
}

export interface ResenaGoogle {
  pedir: boolean;
  url: string | null;
}

// La consumen las páginas de registro (Tarea 8, `leerResenaGoogle` en una consulta APARTE de la del
// comercio que falla hacia `null` en vez de ensanchar el `select` que decide "no encontrado") y esta
// misma página de Reglas, para precargar el formulario.
export async function leerResenaGoogle(
  supabase: SupabaseClient<Database>,
  comercioId: string,
): Promise<ResenaGoogle | null> {
  const { data, error } = await supabase
    .from('comercios')
    .select('pedir_resena_google, resena_google_url')
    .eq('id', comercioId)
    .maybeSingle();
  if (error || !data) {
    console.error('[comercio] no se pudo leer la configuración de la reseña de Google:', error);
    return null;
  }

  // Lo que sale de un jsonb o, como acá, de cualquier columna de texto libre es dato hostil (regla
  // del proyecto): un link guardado en algún momento anterior que HOY ya no pasa la validación (la
  // lista de hosts se puede endurecer más adelante) se trata como si no hubiera link, nunca se usa
  // crudo como `href`. `?? ''` cubre null igual que un texto vacío guardado directo por fuera de
  // `guardarResenaGoogle` — los dos vuelven `url: null` acá.
  //
  // PENDIENTE (Tarea 9, con la 0039 aplicada): confirmar por mutación que quitar esta revalidación
  // hace fallar el caso "link inválido guardado" de resenaGoogle.test.ts — hoy esa prueba está en
  // rojo por la columna faltante, así que la mutación todavía no se puede correr.
  const revalidado = validarUrlResenaGoogle(data.resena_google_url ?? '');

  return { pedir: data.pedir_resena_google, url: revalidado.ok ? revalidado.url : null };
}

export type ResultadoGuardarResenaGoogle = { ok: true } | { ok: false; error: string };

export async function guardarResenaGoogle(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  datos: { pedir: boolean; urlTexto: string },
): Promise<ResultadoGuardarResenaGoogle> {
  const validado = validarUrlResenaGoogle(datos.urlTexto);
  if (!validado.ok) return validado;

  // El CHECK de la 0039 (`comercios_resena_con_link`) exige esto en la BD; se repite acá para que el
  // dueño vea un mensaje con sentido en vez de un 23514 crudo — mismo criterio que
  // controlesAcreditacion.ts con las implicaciones de exigir/mínimo.
  if (datos.pedir && validado.url === null) {
    return { ok: false, error: 'Pegá el link para dejar reseña en Google.' };
  }

  const { error } = await supabase
    .from('comercios')
    .update({ pedir_resena_google: datos.pedir, resena_google_url: validado.url })
    .eq('id', comercioId);
  if (error) {
    console.error('[comercio] no se pudo guardar la configuración de la reseña de Google:', error);
    return { ok: false, error: 'No se pudo guardar la configuración.' };
  }

  return { ok: true };
}

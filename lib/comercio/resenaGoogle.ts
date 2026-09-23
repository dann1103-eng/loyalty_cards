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

const HOSTS_EXACTOS = new Set(['g.page', 'goo.gl', 'maps.app.goo.gl']);
// El mercado es El Salvador: un link copiado de Maps puede venir con el dominio local (.com.sv), no
// solo el genérico.
const SUFIJOS_GOOGLE = ['google.com', 'google.com.sv'];

// Comparación EXACTA de host o SUFIJO CON PUNTO — nunca `includes`. `endsWith('google.com')` SIN el
// punto delante aceptaría `malogoogle.com` (termina en esas diez letras, no es un subdominio); un
// `includes('google.com')` aceptaría `google.com.malo.com` (lo contiene en el medio, no al final).
// Las dos son la vía de inyección que esta función existe para cerrar. `url.hostname` ya llega en
// minúsculas (lo normaliza el propio parser de URL).
function hostPermitido(host: string): boolean {
  if (HOSTS_EXACTOS.has(host)) return true;
  return SUFIJOS_GOOGLE.some((sufijo) => host === sufijo || host.endsWith(`.${sufijo}`));
}

export type ResultadoValidacionUrl = { ok: true; url: string | null } | { ok: false; error: string };

const ERROR_NO_ES_LINK =
  'Ese texto no es un link. Pegá el link para dejar reseña que te da Google (empieza con https://g.page/…).';
const ERROR_NO_HTTPS = 'El link tiene que empezar con https://.';
const ERROR_HOST_AJENO =
  'Ese link no es de Google. Pegá el link para dejar reseña que te da Google (empieza con https://g.page/…).';

// Vacío (tras recortar) es válido: es "no hay link todavía", no un error — el dueño puede guardar la
// casilla apagada sin haber pegado nada.
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

  if (!hostPermitido(url.hostname)) {
    return { ok: false, error: ERROR_HOST_AJENO };
  }

  return { ok: true, url: limpio };
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

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

// El reverso de un pass no es un contrato: 2000 caracteres ya son más de lo que nadie lee en un
// teléfono, y sin tope una pegada accidental viajaría dentro del .pkpass de cada cliente.
const LARGO_MAXIMO_TERMINOS = 2000;
const LARGO_MAXIMO_URL = 500;

export interface DatosReversoComercio {
  terminos_uso: string;
  red_instagram: string;
  red_facebook: string;
  red_whatsapp: string;
  sitio_web: string;
  // Llega YA como booleano. Un checkbox HTML manda 'on' cuando está marcado y NO manda nada cuando
  // no lo está; esa conversión conoce el FormData, así que vive en la Server Action. Acá no se adivina.
  mostrar_como_funciona: boolean;
}

export type ResultadoReverso = { ok: true } | { ok: false; error: string };

// Las DOS condiciones, no una. El parser WHATWG borra tabs y saltos de línea ANTES de parsear, así
// que "ht\ntps://ejemplo.com" devuelve protocol 'https:' y pasaría un chequeo que mire solo el
// protocolo — pero lo que se GUARDA es la cadena cruda, que no empieza con https:// y termina así
// dentro del href del pass. El startsWith cierra esa brecha; el new URL() rechaza javascript:,
// http: y cualquier basura que empiece bien pero no sea una URL ("https://" a secas revienta).
// Comprobado en el Node de este proyecto.
export function validarUrlHttps(valor: string): boolean {
  if (!valor.startsWith('https://')) return false;
  try {
    return new URL(valor).protocol === 'https:';
  } catch {
    return false;
  }
}

// Vacío y solo-espacios colapsan a null para que el armado del reverso tenga UN solo caso que
// mirar por campo; con '' habría que chequear las dos formas en cada uno y la que se olvide
// termina siendo una fila vacía en la tarjeta del cliente.
function normalizarOpcional(valor: string): string | null {
  const recortado = valor.trim();
  return recortado === '' ? null : recortado;
}

// Lo que llega del formulario (crudo) y lo que sale ya normalizado. En camelCase porque lo comparten
// el reverso del comercio y el del PROGRAMA (guardarReversoPrograma.ts), y ese módulo sigue la
// convención de guardarBrandingPrograma.
export interface CamposReverso {
  terminosUso: string;
  redInstagram: string;
  redFacebook: string;
  redWhatsapp: string;
  sitioWeb: string;
}

export interface ReversoNormalizado {
  terminosUso: string | null;
  redInstagram: string | null;
  redFacebook: string | null;
  redWhatsapp: string | null;
  sitioWeb: string | null;
}

export type ResultadoNormalizacion =
  | { ok: true; valores: ReversoNormalizado }
  | { ok: false; error: string };

// Normaliza y valida los cinco campos de texto del reverso. Vive acá y la usan LOS DOS que escriben
// reverso —el del comercio y el del programa— para que el tope de caracteres y la exigencia de
// https:// no puedan divergir entre las dos pantallas: el texto termina en la misma tarjeta.
export function normalizarReverso(campos: CamposReverso): ResultadoNormalizacion {
  const terminos = normalizarOpcional(campos.terminosUso);
  if (terminos !== null && terminos.length > LARGO_MAXIMO_TERMINOS) {
    // El largo actual va en el mensaje: "es muy largo" a secas no le dice al dueño cuánto recortar.
    return {
      ok: false,
      error: `Los términos de uso no pueden pasar de ${LARGO_MAXIMO_TERMINOS} caracteres (tienen ${terminos.length}).`,
    };
  }

  // La etiqueta es la frase completa para que el mensaje se lea natural en los dos campos
  // ("El enlace de Instagram…" / "La dirección del sitio web…") sin armar preposiciones a mano.
  const enlaces: [string, string | null][] = [
    ['El enlace de Instagram', normalizarOpcional(campos.redInstagram)],
    ['El enlace de Facebook', normalizarOpcional(campos.redFacebook)],
    ['El enlace de WhatsApp', normalizarOpcional(campos.redWhatsapp)],
    ['La dirección del sitio web', normalizarOpcional(campos.sitioWeb)],
  ];
  for (const [etiqueta, valor] of enlaces) {
    if (valor === null) continue;
    if (!validarUrlHttps(valor)) {
      return { ok: false, error: `${etiqueta} debe empezar con https:// y ser una dirección válida.` };
    }
    if (valor.length > LARGO_MAXIMO_URL) {
      return {
        ok: false,
        error: `${etiqueta} no puede pasar de ${LARGO_MAXIMO_URL} caracteres (tiene ${valor.length}).`,
      };
    }
  }

  return {
    ok: true,
    valores: {
      terminosUso: terminos,
      // La cadena CRUDA con trim(), no new URL().href: la normalización agrega barras finales y
      // percent-encodea, y devolverle al dueño algo distinto de lo que escribió es desconcertante.
      // La defensa contra comillas es el escape del render (spec §7.1), no esta normalización.
      redInstagram: enlaces[0][1],
      redFacebook: enlaces[1][1],
      redWhatsapp: enlaces[2][1],
      sitioWeb: enlaces[3][1],
    },
  };
}

// Guarda SOLO el reverso configurable (términos, redes e interruptor de la sección automática).
// Separado a propósito de guardarBranding, que ya valida colores, meta de sellos y difuminado: son
// responsabilidades distintas y el formulario del dueño también es otro. El comercioId SIEMPRE
// viene del gate (verifyComercioOwner), nunca del formulario (spec §8).
export async function guardarReverso(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  datos: DatosReversoComercio,
): Promise<ResultadoReverso> {
  const normalizado = normalizarReverso({
    terminosUso: datos.terminos_uso,
    redInstagram: datos.red_instagram,
    redFacebook: datos.red_facebook,
    redWhatsapp: datos.red_whatsapp,
    sitioWeb: datos.sitio_web,
  });
  if (!normalizado.ok) return normalizado;
  const v = normalizado.valores;

  const { error } = await supabase
    .from('comercios')
    .update({
      terminos_uso: v.terminosUso,
      red_instagram: v.redInstagram,
      red_facebook: v.redFacebook,
      red_whatsapp: v.redWhatsapp,
      sitio_web: v.sitioWeb,
      // Boolean() no es redundante pese al tipo: si un llamador de JS mandara undefined, la
      // serialización a JSON borraría la clave y la columna (NOT NULL) quedaría sin tocar en
      // silencio, que es peor que guardar false.
      mostrar_como_funciona: Boolean(datos.mostrar_como_funciona),
    })
    .eq('id', comercioId)
    .select('id')
    .single();

  if (error) {
    // PGRST116 = la consulta no devolvió exactamente una fila (id inexistente). El .select().single()
    // NO es decorativo: sin él, un update de 0 filas devuelve 204 sin error y esto reportaría ok:true.
    if (error.code === 'PGRST116') {
      return { ok: false, error: 'Ese comercio ya no existe.' };
    }
    console.error('[comercio] falló el update del reverso:', error);
    return { ok: false, error: 'No se pudo guardar el reverso.' };
  }

  return { ok: true };
}

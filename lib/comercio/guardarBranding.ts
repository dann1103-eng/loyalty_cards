import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { validarColorRgb } from '../comercios/validarColorRgb';
import { NIVELES_DIFUMINADO } from '../apple/difuminadoFranja';
import { validarEncuadre } from './encuadreFranja';
import { validarNombrePase } from './nombrePase';

export interface DatosBranding {
  color_fondo: string;
  color_texto: string;
  color_label: string;
  // null = el comercio no usa sellos, o el dueño aún no configuró la meta. La BD exige > 0 o null.
  sello_meta: number | null;
  // Cuánto se funde la foto de fondo de la franja hacia el color de la tarjeta. Uno de
  // NIVELES_DIFUMINADO (migración 0007) — misma constante que valida el pass real, así el
  // <select> del formulario y este check nunca pueden divergir.
  difuminado_franja: string;
  // El nombre que el cliente ve arriba en su tarjeta (0033). null = sin nombre, que es como nace
  // todo programa: el pase sale como hasta ahora. NO es branding heredable — es identidad del
  // PROGRAMA, igual que sello_meta, y por eso se escribe en programas_tarjeta y no en comercios
  // (que ni siquiera tiene la columna).
  nombre_pase: string | null;
  // El encuadre de la foto de la franja, crudo desde el formulario. null = no llegó (un formulario
  // roto): las columnas del comercio son NOT NULL, así que acá null es un ERROR, no "heredá". El
  // formulario del negocio manda los cuatro campos SIEMPRE (haya foto o no).
  encuadre_franja: { modo: string; focoX: number; focoY: number; zoom: number } | null;
}

export type ResultadoBranding = { ok: true } | { ok: false; error: string };

// Guarda solo campos de TEXTO del branding del dueño. El comercio_id SIEMPRE viene del gate
// (verifyComercioOwner), nunca del formulario (spec §4.4). No toca las columnas *_url de imagen:
// esas las escribe el Server Action de subida. sello_meta se guarda aunque el tipo no sea 'sellos'
// (el pass solo lo lee cuando tipo='sellos', así que guardarlo es inofensivo).
export async function guardarBranding(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  datos: DatosBranding,
): Promise<ResultadoBranding> {
  const colores: [string, string][] = [
    ['color de fondo', datos.color_fondo.trim()],
    ['color de texto', datos.color_texto.trim()],
    ['color de etiqueta', datos.color_label.trim()],
  ];
  for (const [nombre, valor] of colores) {
    if (!validarColorRgb(valor)) {
      return { ok: false, error: `El ${nombre} debe tener el formato rgb(r, g, b) con valores de 0 a 255.` };
    }
  }

  if (datos.sello_meta !== null && (!Number.isInteger(datos.sello_meta) || datos.sello_meta <= 0)) {
    return { ok: false, error: 'La meta de sellos debe ser un número entero mayor que cero.' };
  }

  // La base tiene un CHECK, pero devuelve un 23514 mudo que acá se traduciría a "No se pudo
  // guardar el branding": el dueño no sabría qué campo corregir. Mismo criterio que el difuminado.
  const errorNombre = validarNombrePase(datos.nombre_pase);
  if (errorNombre) return { ok: false, error: errorNombre };

  if (!(NIVELES_DIFUMINADO as readonly string[]).includes(datos.difuminado_franja)) {
    // Mismo motivo que sello_meta/tipo_tarjeta en otros formularios: sin esto, un valor inválido
    // cae en el 23514 de la BD y el dueño solo ve "No se pudo guardar el branding".
    return { ok: false, error: 'El nivel de difuminado no es válido.' };
  }

  if (datos.encuadre_franja === null) {
    return { ok: false, error: 'Falta el encuadre de la foto de fondo.' };
  }
  // La misma razón que el difuminado: el CHECK de la base solo devuelve un 23514 mudo, que acá se
  // traduciría a "No se pudo guardar el branding". Esta es la defensa real y la que da el mensaje.
  const errorEncuadre = validarEncuadre(datos.encuadre_franja);
  if (errorEncuadre) return { ok: false, error: errorEncuadre };

  const { error } = await supabase
    .from('comercios')
    .update({
      color_fondo: colores[0][1],
      color_texto: colores[1][1],
      color_label: colores[2][1],
      sello_meta: datos.sello_meta,
      difuminado_franja: datos.difuminado_franja,
      encuadre_franja: datos.encuadre_franja.modo,
      foco_franja_x: datos.encuadre_franja.focoX,
      foco_franja_y: datos.encuadre_franja.focoY,
      zoom_franja: datos.encuadre_franja.zoom,
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
    console.error('[comercio] falló el update de branding:', error);
    return { ok: false, error: 'No se pudo guardar el branding.' };
  }

  // La meta TAMBIÉN va al programa principal, y no es opcional. Desde la 0024 `sello_meta` vive en
  // `programas_tarjeta` y desde el 2026-07-30 el pase lee de ahí — pero este formulario, que es el
  // ÚNICO lugar donde el dueño puede tocar la meta, seguía escribiendo solo la columna legada de
  // `comercios`. Sin esta línea, cambiar la meta no tenía ningún efecto sobre el pase: quedaba
  // congelada en el valor que dejó el backfill de la 0024.
  //
  // Va al principal porque este formulario es del COMERCIO: no tiene selector de programa. Cuando
  // exista branding por programa, la meta de cada uno se edita en su propia pantalla.
  //
  // `nombre_pase` (0033) viaja en la MISMA sentencia y por el mismo motivo, con una diferencia que
  // lo hace todavía más claro: `comercios` no tiene columna equivalente, así que este UPDATE es el
  // ÚNICO lugar donde el nombre se escribe desde el modo negocio. Se guarda RECORTADO — es el texto
  // que va al headerField de Apple y al textModulesData de Google.
  const { error: errorPrograma } = await supabase
    .from('programas_tarjeta')
    .update({ sello_meta: datos.sello_meta, nombre_pase: datos.nombre_pase?.trim() ?? null })
    .eq('comercio_id', comercioId)
    .eq('es_principal', true);
  if (errorPrograma) {
    console.error('[comercio] falló el update de sello_meta en el programa principal:', errorPrograma);
    return { ok: false, error: 'No se pudo guardar el branding.' };
  }

  return { ok: true };
}

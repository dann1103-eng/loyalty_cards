import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { validarColorRgb } from '../comercios/validarColorRgb';
import { NIVELES_DIFUMINADO } from '../apple/difuminadoFranja';

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

  if (!(NIVELES_DIFUMINADO as readonly string[]).includes(datos.difuminado_franja)) {
    // Mismo motivo que sello_meta/tipo_tarjeta en otros formularios: sin esto, un valor inválido
    // cae en el 23514 de la BD y el dueño solo ve "No se pudo guardar el branding".
    return { ok: false, error: 'El nivel de difuminado no es válido.' };
  }

  const { error } = await supabase
    .from('comercios')
    .update({
      color_fondo: colores[0][1],
      color_texto: colores[1][1],
      color_label: colores[2][1],
      sello_meta: datos.sello_meta,
      difuminado_franja: datos.difuminado_franja,
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

  return { ok: true };
}

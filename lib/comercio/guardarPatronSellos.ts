import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { esPatronSello, sanearPatronSellos, type PatronSellos } from '../tarjetas/patronSellos';

// Guarda DÓNDE va el segundo ícono de sello (migración 0041): el patrón y, si es 'casillas', las
// posiciones. Del negocio (programaId null) o de una tarjeta.
//
// Es una escritura aparte de guardarBranding / guardarBrandingPrograma a propósito: el patrón
// pertenece al segundo ícono, que se sube en la pestaña Imágenes con su propia acción, y no al
// formulario de Colores/Franja. Meterlo ahí haría que publicar colores reescribiera el patrón con
// lo que hubiera en un campo oculto.
//
// El comercioId SIEMPRE viene del gate. El programaId viaja desde el componente, y por eso el
// update se scopea por comercio_id además de por id: conocer el uuid de un programa ajeno no
// alcanza para tocarlo.

export type ResultadoPatronSellos = { ok: true; patron: PatronSellos } | { ok: false; error: string };

// Lo que llega del formulario: el patrón como texto y las casillas como "5,10". Cualquier cosa que
// no sea un entero se descarta en el saneo (no se redondea ni se adivina).
export function patronSellosDesdeFormulario(patron: string, casillas: string): { patron: string; casillas: number[] } {
  return {
    patron: patron.trim(),
    casillas: casillas
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c !== '')
      .map(Number),
  };
}

export async function guardarPatronSellos(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  programaId: string | null,
  datos: { patron: string; casillas: number[] },
): Promise<ResultadoPatronSellos> {
  // Acá un patrón desconocido es un ERROR, no "caé al de por defecto" como al leer: guardar
  // 'intercalado' cuando el dueño pidió otra cosa sería cambiarle la tarjeta sin avisarle.
  if (!esPatronSello(datos.patron)) {
    return { ok: false, error: 'Elegí dónde va el segundo sello.' };
  }
  const limpio = sanearPatronSellos(datos.patron, datos.casillas);
  if (limpio.patron === 'casillas' && limpio.casillas.length === 0) {
    return { ok: false, error: 'Elegí al menos una casilla para el segundo sello.' };
  }

  const actualizacion = {
    sello_patron: limpio.patron,
    // Las casillas se guardan solo con el patrón que las usa. Con otro patrón van en null: una
    // lista vieja guardada al lado de 'intercalado' no dibuja nada, pero confunde al que la lea.
    sello_casillas: limpio.patron === 'casillas' ? limpio.casillas : null,
  };

  // El .select().single() NO es decorativo: sin él un update de 0 filas (programa ajeno o
  // inexistente) devuelve 204 sin error y esto reportaría ok habiendo escrito cero.
  const { error } = programaId
    ? await supabase
        .from('programas_tarjeta')
        .update(actualizacion)
        .eq('id', programaId)
        .eq('comercio_id', comercioId)
        .select('id')
        .single()
    : await supabase.from('comercios').update(actualizacion).eq('id', comercioId).select('id').single();

  if (error) {
    if (error.code === 'PGRST116') {
      return { ok: false, error: programaId ? 'Ese programa no existe.' : 'Ese comercio ya no existe.' };
    }
    console.error('[comercio] no se pudo guardar el patrón de sellos:', error);
    return { ok: false, error: 'No se pudo guardar dónde va el segundo sello.' };
  }

  return { ok: true, patron: { patron: limpio.patron, casillas: actualizacion.sello_casillas ?? [] } };
}

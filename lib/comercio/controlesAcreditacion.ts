import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { esZonaHorariaValida, ZONA_HORARIA_DEFAULT } from './zonasHorarias';

// Las perillas antifraude del comercio (Tanda 1). Todas opcionales: `null` = sin límite, que es
// como nacen TODOS los comercios tras la migración 0015. Mientras nadie configure nada, el escáner
// se comporta exactamente igual que antes.
//
// Quién aplica cada cosa: la BD (acreditar_atomico) es la única que puede hacerlo sin condición de
// carrera, y lo hace. Esta capa solo lee y guarda la configuración; la validación de acá es para
// que el dueño no guarde un disparate, no para hacer cumplir el límite.

export interface ControlesAcreditacion {
  topeAcreditacionesDia: number | null;
  esperaMinimaMinutos: number | null;
  techoPuntosAcreditacion: number | null;
  topePuntosDia: number | null;
  pedirMontoCompra: boolean;
  zonaHoraria: string;
}

// Topes de cordura. No son reglas de negocio: son atajadores de typo. Sin ellos, un dueño que
// teclea "600" en "minutos de espera" pensando en segundos le bloquea el local por diez horas.
export const MAXIMO_ACREDITACIONES_DIA = 100;
export const MAXIMO_ESPERA_MINUTOS = 1440; // 24 horas
export const MAXIMO_PUNTOS = 1_000_000;

export type ResultadoControles = { ok: true } | { ok: false; error: string };

// Igual que validar() en lib/comercios/guardarComercio.ts: devuelve el PRIMER error o null. La
// validación vive en esta capa (la que tiene pruebas de integración), no en el Server Action.
function validar(datos: ControlesAcreditacion): string | null {
  const enteros: [string, number | null, number][] = [
    ['El tope de sellos por día', datos.topeAcreditacionesDia, MAXIMO_ACREDITACIONES_DIA],
    ['La espera mínima', datos.esperaMinimaMinutos, MAXIMO_ESPERA_MINUTOS],
    ['El techo de puntos por transacción', datos.techoPuntosAcreditacion, MAXIMO_PUNTOS],
    ['El tope de puntos por día', datos.topePuntosDia, MAXIMO_PUNTOS],
  ];

  for (const [etiqueta, valor, maximo] of enteros) {
    if (valor === null) continue;
    if (!Number.isInteger(valor) || valor <= 0) {
      return `${etiqueta} debe ser un número entero mayor que cero, o quedar vacío para no poner límite.`;
    }
    if (valor > maximo) {
      return `${etiqueta} no puede pasar de ${maximo}.`;
    }
  }

  // La lista de zonas es espejo del CHECK de la BD (ver lib/comercio/zonasHorarias.ts). Si esto no
  // atajara el valor, Postgres lo rechazaría con 23514 y el dueño vería un error sin explicación.
  if (!esZonaHorariaValida(datos.zonaHoraria)) {
    return 'Elegí una zona horaria de la lista.';
  }

  return null;
}

// Convierte lo que llega del formulario (strings) al shape de ControlesAcreditacion. Cadena vacía
// ⇒ null ⇒ "sin límite", que es como el dueño borra una perilla.
export function controlesDesdeFormulario(campos: {
  topeAcreditacionesDia: string;
  esperaMinimaMinutos: string;
  techoPuntosAcreditacion: string;
  topePuntosDia: string;
  pedirMontoCompra: boolean;
  zonaHoraria: string;
}): ControlesAcreditacion {
  const aEntero = (valor: string): number | null => {
    const limpio = valor.trim();
    if (!limpio) return null;
    // Number() y no parseInt(): parseInt('5x') da 5 y se tragaría un typo en silencio.
    const n = Number(limpio);
    return Number.isFinite(n) ? n : Number.NaN;
  };

  return {
    topeAcreditacionesDia: aEntero(campos.topeAcreditacionesDia),
    esperaMinimaMinutos: aEntero(campos.esperaMinimaMinutos),
    techoPuntosAcreditacion: aEntero(campos.techoPuntosAcreditacion),
    topePuntosDia: aEntero(campos.topePuntosDia),
    pedirMontoCompra: campos.pedirMontoCompra,
    zonaHoraria: campos.zonaHoraria.trim() || ZONA_HORARIA_DEFAULT,
  };
}

export async function leerControles(
  supabase: SupabaseClient<Database>,
  comercioId: string,
): Promise<ControlesAcreditacion | null> {
  const { data, error } = await supabase
    .from('comercios')
    // Un ÚNICO literal, sin concatenar: supabase-js infiere el tipo del resultado parseando esta
    // cadena en tiempo de compilación, y una concatenación la vuelve `string` genérico — el
    // resultado degrada a GenericStringError y se pierde todo el tipado.
    .select('tope_acreditaciones_dia, espera_minima_minutos, techo_puntos_acreditacion, tope_puntos_dia, pedir_monto_compra, zona_horaria')
    .eq('id', comercioId)
    .maybeSingle();

  if (error || !data) {
    console.error('[controles] no se pudieron leer los controles del comercio:', error);
    return null;
  }

  return {
    topeAcreditacionesDia: data.tope_acreditaciones_dia,
    esperaMinimaMinutos: data.espera_minima_minutos,
    techoPuntosAcreditacion: data.techo_puntos_acreditacion,
    topePuntosDia: data.tope_puntos_dia,
    pedirMontoCompra: data.pedir_monto_compra,
    zonaHoraria: data.zona_horaria,
  };
}

export async function guardarControles(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  datos: ControlesAcreditacion,
): Promise<ResultadoControles> {
  const problema = validar(datos);
  if (problema) return { ok: false, error: problema };

  const { error } = await supabase
    .from('comercios')
    .update({
      tope_acreditaciones_dia: datos.topeAcreditacionesDia,
      espera_minima_minutos: datos.esperaMinimaMinutos,
      techo_puntos_acreditacion: datos.techoPuntosAcreditacion,
      tope_puntos_dia: datos.topePuntosDia,
      pedir_monto_compra: datos.pedirMontoCompra,
      zona_horaria: datos.zonaHoraria,
    })
    .eq('id', comercioId);

  if (error) {
    console.error('[controles] no se pudieron guardar los controles:', error);
    return { ok: false, error: 'No se pudo guardar la configuración.' };
  }

  return { ok: true };
}

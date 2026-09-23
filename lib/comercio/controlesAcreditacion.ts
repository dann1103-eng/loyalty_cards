import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { esZonaHorariaValida, ZONA_HORARIA_DEFAULT } from './zonasHorarias';
import { centavosDesdeTexto, formatearCentavos } from '../tarjetas/tipos';

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
  // Las dos columnas de la migración 0039. Nacen de "solo sello consumos de $10 en adelante": el
  // dueño puede exigir el monto de la compra (no solo pedirlo, como pedirMontoCompra) y fijar un
  // mínimo para que la acreditación cuente. Ver lib/comercio/montoAcreditacion.ts, que es quien
  // aplica esto de verdad — acá solo se lee y se guarda.
  exigirMontoCompra: boolean;
  montoMinimoCompraCentavos: number | null;
  zonaHoraria: string;
}

// Topes de cordura. No son reglas de negocio: son atajadores de typo. Sin ellos, un dueño que
// teclea "600" en "minutos de espera" pensando en segundos le bloquea el local por diez horas.
export const MAXIMO_ACREDITACIONES_DIA = 100;
export const MAXIMO_ESPERA_MINUTOS = 1440; // 24 horas
export const MAXIMO_PUNTOS = 1_000_000;
// $1,000: mismo espíritu que los topes de arriba, no una regla de negocio. Un mínimo de compra más
// alto que eso es casi seguro un typo (un cero de más tecleando "10.00").
export const MAXIMO_MONTO_MINIMO_CENTAVOS = 100_000;

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

  // El mínimo de compra. `Number.isInteger` ya rechaza NaN (la marca de typo que deja
  // controlesDesdeFormulario al no poder parsear "10x" o "-5") y cualquier no-entero; `<= 0` cierra
  // el "0" (una compra de $0.00 no es un mínimo). null SÍ es válido: es "sin mínimo".
  if (datos.montoMinimoCompraCentavos !== null) {
    if (!Number.isInteger(datos.montoMinimoCompraCentavos) || datos.montoMinimoCompraCentavos <= 0) {
      return 'El mínimo de compra para sumar debe ser un monto válido mayor que cero (por ejemplo 10.00), o quedar vacío para no exigir un mínimo.';
    }
    if (datos.montoMinimoCompraCentavos > MAXIMO_MONTO_MINIMO_CENTAVOS) {
      return `El mínimo de compra para sumar no puede pasar de ${formatearCentavos(MAXIMO_MONTO_MINIMO_CENTAVOS)}.`;
    }
  }

  // Las dos implicaciones que exigen los CHECK de la 0039 (comercios_exigir_implica_pedir y
  // comercios_minimo_implica_exigir). controlesDesdeFormulario ya las resuelve solas (no hay forma
  // de armar desde el formulario una combinación que las viole), así que estos dos casos no los
  // dispara el formulario — son defensa para CUALQUIER OTRO llamador de guardarControles, para que
  // un disparate se rechace acá con un mensaje claro y no en la BD con un 23514 sin contexto.
  if (datos.exigirMontoCompra && !datos.pedirMontoCompra) {
    return 'Para exigir el monto de la compra primero tenés que pedirlo.';
  }
  if (datos.montoMinimoCompraCentavos !== null && !datos.exigirMontoCompra) {
    return 'Para fijar un mínimo de compra primero tildá "Exigir el monto para sumar".';
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
  exigirMontoCompra: boolean;
  montoMinimoCompra: string;
  zonaHoraria: string;
}): ControlesAcreditacion {
  const aEntero = (valor: string): number | null => {
    const limpio = valor.trim();
    if (!limpio) return null;
    // Number() y no parseInt(): parseInt('5x') da 5 y se tragaría un typo en silencio.
    const n = Number(limpio);
    return Number.isFinite(n) ? n : Number.NaN;
  };

  // Vacío ⇒ null ⇒ "sin mínimo". No vacío ⇒ centavosDesdeTexto (tolera "$" y centavos). Si no
  // parsea ("10x", "-5") centavosDesdeTexto devuelve null, y ACÁ se lo convierte a NaN — mismo
  // criterio que aEntero de arriba: un null en este punto se leería como "el dueño lo dejó vacío",
  // que sería tragarse el typo en silencio. NaN es lo que validar() rechaza.
  const aMinimo = (valor: string): number | null => {
    const limpio = valor.trim();
    if (!limpio) return null;
    const centavos = centavosDesdeTexto(limpio);
    return centavos === null ? Number.NaN : centavos;
  };

  const montoMinimoCompraCentavos = aMinimo(campos.montoMinimoCompra);
  // Implicaciones que la BD exige (CHECK de la 0039: comercios_exigir_implica_pedir y
  // comercios_minimo_implica_exigir), resueltas ACÁ para que el dueño no pueda armar desde el
  // formulario una combinación que la BD rechace: cargar un mínimo alcanza para exigir el monto, y
  // exigir el monto alcanza para pedirlo. `!== null` y no un chequeo de NaN: un mínimo mal tecleado
  // (NaN) también tiene que exigir el monto, para que validar() lo rechace con el mensaje del
  // mínimo y no lo deje pasar en silencio como "sin mínimo, sin exigir".
  const exigirMontoCompra = campos.exigirMontoCompra || montoMinimoCompraCentavos !== null;
  const pedirMontoCompra = campos.pedirMontoCompra || exigirMontoCompra;

  return {
    topeAcreditacionesDia: aEntero(campos.topeAcreditacionesDia),
    esperaMinimaMinutos: aEntero(campos.esperaMinimaMinutos),
    techoPuntosAcreditacion: aEntero(campos.techoPuntosAcreditacion),
    topePuntosDia: aEntero(campos.topePuntosDia),
    pedirMontoCompra,
    exigirMontoCompra,
    montoMinimoCompraCentavos,
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
    .select('tope_acreditaciones_dia, espera_minima_minutos, techo_puntos_acreditacion, tope_puntos_dia, pedir_monto_compra, exigir_monto_compra, monto_minimo_compra_centavos, zona_horaria')
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
    exigirMontoCompra: data.exigir_monto_compra,
    montoMinimoCompraCentavos: data.monto_minimo_compra_centavos,
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
      exigir_monto_compra: datos.exigirMontoCompra,
      monto_minimo_compra_centavos: datos.montoMinimoCompraCentavos,
      zona_horaria: datos.zonaHoraria,
    })
    .eq('id', comercioId);

  if (error) {
    console.error('[controles] no se pudieron guardar los controles:', error);
    return { ok: false, error: 'No se pudo guardar la configuración.' };
  }

  return { ok: true };
}

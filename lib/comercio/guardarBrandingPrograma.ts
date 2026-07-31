import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { validarColorRgb } from '../comercios/validarColorRgb';
import { NIVELES_DIFUMINADO } from '../apple/difuminadoFranja';
import { necesitaClasePropia } from './brandingEfectivo';

// Escritura del branding de UN programa de tarjeta (migración 0027). El espejo de
// guardarBranding.ts, con dos diferencias que importan:
//
//   1. Acá `null` es un valor con significado: "no lo definí, heredá el del comercio". Por eso los
//      colores son nullable y NO se copia el valor del comercio al guardar — copiarlo dejaría al
//      programa congelado en el color de hoy cuando el dueño cambie la marca del negocio.
//   2. Todo se scopea por comercio_id, que viene del gate y NUNCA del formulario. El programaId sí
//      viaja en el formulario: sin el scope, conocer el uuid de un programa ajeno alcanzaría para
//      cambiarle la marca al negocio de otro.
//
// La BD no valida NADA de esto (no hay CHECK de colores ni de difuminado en programas_tarjeta),
// así que esta función es la única defensa — mismo criterio que documenta CLAUDE.md. Se reusan
// validarColorRgb y NIVELES_DIFUMINADO, las mismas constantes que valida el pass real, para que el
// formulario y el pase no puedan divergir.
//
// No toca las columnas *_url de imagen: esas las escribe el Server Action de subida, igual que en
// el branding del comercio.

export interface DatosBrandingPrograma {
  // El interruptor maestro. Manda sobre los campos (ver brandingEfectivo): apagarlo no obliga al
  // dueño a limpiar cada columna, y volver a encenderlo le devuelve lo que había configurado.
  brandingPropio: boolean;
  colorFondo: string | null;
  colorTexto: string | null;
  colorLabel: string | null;
  difuminadoFranja: string | null;
  // OJO: sello_meta NO es branding y no se rige por brandingPropio. Es la mecánica del programa —
  // el pase la lee SIEMPRE desde programas_tarjeta (datosPassDeTarjeta.ts), mire o no el
  // interruptor. Y su `null` es un VALOR legítimo (un cupón no tiene meta), no una ausencia: nunca
  // se resuelve con `??` contra el comercio. Ese `??` fue un bug real el 2026-07-30.
  selloMeta: number | null;
}

export type ResultadoBrandingPrograma =
  // `necesitaClasePropia` viaja en el resultado para que el llamador sepa si este guardado dejó al
  // programa necesitando su propia LoyaltyClass — un recurso PERMANENTE en Google (la API no tiene
  // delete). Se decide acá, sobre la fila REAL ya escrita, y no en el llamador: logo_url y hero_url
  // los escribe el Server Action de subida, así que el formulario por sí solo no alcanza para saberlo.
  { ok: true; necesitaClasePropia: boolean } | { ok: false; error: string };

export type ResultadoAccionPrograma = { ok: true } | { ok: false; error: string };

export interface BrandingProgramaFila {
  programaId: string;
  brandingPropio: boolean;
  colorFondo: string | null;
  colorTexto: string | null;
  colorLabel: string | null;
  logoUrl: string | null;
  heroUrl: string | null;
  stripUrl: string | null;
  selloIconoUrl: string | null;
  difuminadoFranja: string | null;
  selloMeta: number | null;
}

export async function guardarBrandingPrograma(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  programaId: string,
  datos: DatosBrandingPrograma,
): Promise<ResultadoBrandingPrograma> {
  // Un color en null es "heredá": válido y no se valida. Solo se exige el formato al que SÍ vino.
  const colores: [string, string | null][] = [
    ['color de fondo', datos.colorFondo],
    ['color de texto', datos.colorTexto],
    ['color de etiqueta', datos.colorLabel],
  ];
  for (const [nombre, valor] of colores) {
    if (valor !== null && !validarColorRgb(valor)) {
      return { ok: false, error: `El ${nombre} debe tener el formato rgb(r, g, b) con valores de 0 a 255.` };
    }
  }

  if (
    datos.difuminadoFranja !== null &&
    !(NIVELES_DIFUMINADO as readonly string[]).includes(datos.difuminadoFranja)
  ) {
    return { ok: false, error: 'El nivel de difuminado no es válido.' };
  }

  if (datos.selloMeta !== null && (!Number.isInteger(datos.selloMeta) || datos.selloMeta <= 0)) {
    return { ok: false, error: 'La meta de sellos debe ser un número entero mayor que cero.' };
  }

  const { data, error } = await supabase
    .from('programas_tarjeta')
    .update({
      branding_propio: datos.brandingPropio,
      color_fondo: datos.colorFondo,
      color_texto: datos.colorTexto,
      color_label: datos.colorLabel,
      difuminado_franja: datos.difuminadoFranja,
      sello_meta: datos.selloMeta,
    })
    .eq('id', programaId)
    // El scope de seguridad. Va DENTRO del update, no en un chequeo previo: así "es de otro
    // comercio" y "ya no existe" quedan cubiertos por la MISMA sentencia atómica.
    .eq('comercio_id', comercioId)
    // Se devuelven las tres columnas que deciden la clase de Google. logo_url y hero_url NO las
    // escribe esta función (son del Server Action de subida): hay que releerlas de la fila.
    .select('branding_propio, color_fondo, logo_url, hero_url')
    .single();

  if (error) {
    // PGRST116 = la consulta no devolvió exactamente una fila: el programa no existe, o es de otro
    // comercio. El .select().single() NO es decorativo: sin él, un update de 0 filas devuelve 204
    // sin error y esto reportaría ok:true habiendo escrito cero.
    if (error.code === 'PGRST116') {
      return { ok: false, error: 'Ese programa no existe.' };
    }
    console.error('[comercio] falló el update de branding del programa:', error);
    return { ok: false, error: 'No se pudo guardar la marca del programa.' };
  }

  return {
    ok: true,
    necesitaClasePropia: necesitaClasePropia({
      brandingPropio: data.branding_propio,
      colorFondo: data.color_fondo,
      logoUrl: data.logo_url,
      heroUrl: data.hero_url,
    }),
  };
}

// La regla que decide el interruptor a partir de lo que el dueño cargó. Existe para que el dueño
// NUNCA tenga que ver ni entender `branding_propio`: el editor anterior se lo mostraba como una
// casilla "Usar marca propia" —el nombre de una columna filtrado a la interfaz— y no se entendió.
// Ahora el interruptor se DERIVA: si esta tarjeta tiene algo propio cargado, usa su diseño.
//
// `sello_meta` NO entra acá a propósito: no es marca, es la mecánica del programa, y el pase la lee
// SIEMPRE desde programas_tarjeta mire o no el interruptor (ver DatosBrandingPrograma).
export function hayMarcaPropia(campos: {
  colorFondo: string | null;
  colorTexto: string | null;
  colorLabel: string | null;
  difuminadoFranja: string | null;
  logoUrl: string | null;
  heroUrl: string | null;
  stripUrl: string | null;
  selloIconoUrl: string | null;
}): boolean {
  return Object.values(campos).some((valor) => valor !== null);
}

// El botón "Usar el mismo diseño de mi negocio". Apaga el interruptor y NO borra las columnas: es la
// promesa que ya documenta brandingEfectivo —apagarlo no obliga al dueño a limpiar cada columna— y
// hace que publicar de nuevo le devuelva el diseño que tenía en vez de obligarlo a rehacerlo.
//
// NO toca `google_class_id`: una clase ya creada en Google no se puede borrar (la API no tiene
// delete) y limpiar el id haría que reencender la marca intentara un insert sobre un id existente,
// que es un error irreparable. Ver syncClasePrograma.
export async function volverAHeredarMarca(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  programaId: string,
): Promise<ResultadoAccionPrograma> {
  const { error } = await supabase
    .from('programas_tarjeta')
    .update({ branding_propio: false })
    .eq('id', programaId)
    .eq('comercio_id', comercioId)
    .select('id')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return { ok: false, error: 'Ese programa no existe.' };
    }
    console.error('[comercio] no se pudo volver a heredar la marca:', error);
    return { ok: false, error: 'No se pudo volver al diseño del negocio.' };
  }

  return { ok: true };
}

// Lectura para la pantalla de marca. Devuelve una fila por programa del comercio; la página cruza
// esto con listarProgramas (que trae nombre/tipo/estado) por programaId.
//
// Existe como consulta aparte y no como columnas nuevas en listarProgramas a propósito: ese CAMPOS_
// PROGRAMA lo usan el registro, el escáner y el conteo del límite, y ninguno necesita cargar diez
// columnas de branding en cada request.
export async function brandingDeProgramas(
  supabase: SupabaseClient<Database>,
  comercioId: string,
): Promise<BrandingProgramaFila[]> {
  const { data, error } = await supabase
    .from('programas_tarjeta')
    .select(
      'id, branding_propio, color_fondo, color_texto, color_label, logo_url, hero_url, strip_url, sello_icono_url, difuminado_franja, sello_meta',
    )
    .eq('comercio_id', comercioId);

  if (error) {
    console.error('[comercio] no se pudo leer el branding de los programas:', error);
    return [];
  }

  return (data ?? []).map((f) => ({
    programaId: f.id,
    brandingPropio: f.branding_propio,
    colorFondo: f.color_fondo,
    colorTexto: f.color_texto,
    colorLabel: f.color_label,
    logoUrl: f.logo_url,
    heroUrl: f.hero_url,
    stripUrl: f.strip_url,
    selloIconoUrl: f.sello_icono_url,
    difuminadoFranja: f.difuminado_franja,
    selloMeta: f.sello_meta,
  }));
}

// Convierte lo que llega del formulario. Cadena vacía ⇒ null ⇒ heredar. Mismo criterio que
// configuracionProgramaDesdeFormulario (programas.ts): la conversión vive en un módulo puro y
// testeable, no adentro del Server Action.
export function brandingProgramaDesdeFormulario(campos: {
  brandingPropio: boolean;
  colorFondo: string;
  colorTexto: string;
  colorLabel: string;
  difuminadoFranja: string;
  selloMeta: string;
}): DatosBrandingPrograma {
  const aTexto = (valor: string): string | null => valor.trim() || null;

  const metaLimpia = campos.selloMeta.trim();
  return {
    brandingPropio: campos.brandingPropio,
    colorFondo: aTexto(campos.colorFondo),
    colorTexto: aTexto(campos.colorTexto),
    colorLabel: aTexto(campos.colorLabel),
    difuminadoFranja: aTexto(campos.difuminadoFranja),
    // Number() y no parseInt: parseInt('12a') devuelve 12 y se tragaría el typo del dueño en
    // silencio. NaN llega hasta la validación de arriba, que lo rechaza con un mensaje claro.
    selloMeta: metaLimpia === '' ? null : Number(metaLimpia),
  };
}

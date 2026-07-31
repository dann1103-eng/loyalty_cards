import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { normalizarReverso, type ReversoNormalizado } from './guardarReverso';

// Escritura y lectura del REVERSO de UN programa de tarjeta (migración 0029). Espejo exacto de
// guardarBrandingPrograma.ts, con las mismas tres reglas que allá:
//
//   1. `null` es un valor con significado: "no lo definí, heredá el del comercio". No se copia el
//      valor del comercio al guardar — copiarlo dejaría al programa congelado en el Instagram de
//      hoy cuando el dueño cambie el del negocio.
//   2. Todo se scopea por comercio_id, que viene del gate y NUNCA del formulario. El programaId sí
//      viaja en la URL: sin el scope, conocer el uuid de un programa ajeno alcanzaría para
//      escribirle el reverso a la tarjeta de otro negocio.
//   3. La validación (tope de caracteres, https:// obligatorio) NO se reescribe acá: se importa la
//      misma de guardarReverso, porque el texto termina en la misma tarjeta del mismo cliente.
//
// La diferencia con el branding: acá el interruptor `reverso_propio` NO llega del formulario, se
// DERIVA de lo que el dueño escribió (ver hayReversoPropio). El dueño nunca ve ni toca ese booleano
// — eso fue exactamente lo que no se entendió del editor anterior.

export interface DatosReversoPrograma {
  terminosUso: string;
  redInstagram: string;
  redFacebook: string;
  redWhatsapp: string;
  sitioWeb: string;
  // Tri-estado, y por eso NO es un checkbox en la pantalla: null = "como en mi negocio" (heredar),
  // true = mostrarla en esta tarjeta, false = ocultarla solo en esta tarjeta.
  mostrarComoFunciona: boolean | null;
}

export interface ReversoProgramaFila {
  programaId: string;
  reversoPropio: boolean;
  terminosUso: string | null;
  redInstagram: string | null;
  redFacebook: string | null;
  redWhatsapp: string | null;
  sitioWeb: string | null;
  mostrarComoFunciona: boolean | null;
}

export type ResultadoReversoPrograma = { ok: true } | { ok: false; error: string };

// El interruptor, derivado. `mostrarComoFunciona` cuenta con `!== null` y no con un truthy check:
// `false` NO es "vacío", es la decisión de apagar la sección automática SOLO en esta tarjeta, y
// tratarlo como ausencia dejaría el programa heredando la del comercio — encendida.
export function hayReversoPropio(valores: ReversoNormalizado & { mostrarComoFunciona: boolean | null }): boolean {
  return (
    valores.terminosUso !== null ||
    valores.redInstagram !== null ||
    valores.redFacebook !== null ||
    valores.redWhatsapp !== null ||
    valores.sitioWeb !== null ||
    valores.mostrarComoFunciona !== null
  );
}

export async function guardarReversoPrograma(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  programaId: string,
  datos: DatosReversoPrograma,
): Promise<ResultadoReversoPrograma> {
  const normalizado = normalizarReverso(datos);
  if (!normalizado.ok) return normalizado;
  const v = normalizado.valores;

  const { error } = await supabase
    .from('programas_tarjeta')
    .update({
      terminos_uso: v.terminosUso,
      red_instagram: v.redInstagram,
      red_facebook: v.redFacebook,
      red_whatsapp: v.redWhatsapp,
      sitio_web: v.sitioWeb,
      mostrar_como_funciona: datos.mostrarComoFunciona,
      reverso_propio: hayReversoPropio({ ...v, mostrarComoFunciona: datos.mostrarComoFunciona }),
    })
    .eq('id', programaId)
    // El scope de seguridad. Va DENTRO del update, no en un chequeo previo: así "es de otro
    // comercio" y "ya no existe" quedan cubiertos por la MISMA sentencia atómica.
    .eq('comercio_id', comercioId)
    .select('id')
    .single();

  if (error) {
    // PGRST116 = la consulta no devolvió exactamente una fila: el programa no existe, o es de otro
    // comercio. El .select().single() NO es decorativo: sin él, un update de 0 filas devuelve 204
    // sin error y esto reportaría ok:true habiendo escrito cero.
    if (error.code === 'PGRST116') {
      return { ok: false, error: 'Ese programa no existe.' };
    }
    console.error('[comercio] falló el update del reverso del programa:', error);
    return { ok: false, error: 'No se pudo guardar el reverso de esta tarjeta.' };
  }

  return { ok: true };
}

// El botón "Usar el mismo reverso de mi negocio". Apaga el interruptor y NO borra las columnas: así
// publicar de nuevo le devuelve al dueño exactamente el texto que tenía escrito, en vez de obligarlo
// a reescribirlo. Es la misma promesa que hace brandingEfectivo con el branding.
export async function volverAHeredarReverso(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  programaId: string,
): Promise<ResultadoReversoPrograma> {
  const { error } = await supabase
    .from('programas_tarjeta')
    .update({ reverso_propio: false })
    .eq('id', programaId)
    .eq('comercio_id', comercioId)
    .select('id')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return { ok: false, error: 'Ese programa no existe.' };
    }
    console.error('[comercio] no se pudo volver a heredar el reverso:', error);
    return { ok: false, error: 'No se pudo volver al reverso del negocio.' };
  }

  return { ok: true };
}

// Lectura para la pantalla de marca. Devuelve null si el programa no existe o es de otro comercio.
export async function reversoDePrograma(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  programaId: string,
): Promise<ReversoProgramaFila | null> {
  const { data, error } = await supabase
    .from('programas_tarjeta')
    .select(
      'id, reverso_propio, terminos_uso, red_instagram, red_facebook, red_whatsapp, sitio_web, mostrar_como_funciona',
    )
    .eq('id', programaId)
    .eq('comercio_id', comercioId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    programaId: data.id,
    reversoPropio: data.reverso_propio,
    terminosUso: data.terminos_uso,
    redInstagram: data.red_instagram,
    redFacebook: data.red_facebook,
    redWhatsapp: data.red_whatsapp,
    sitioWeb: data.sitio_web,
    mostrarComoFunciona: data.mostrar_como_funciona,
  };
}

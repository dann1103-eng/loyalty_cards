'use server';

import { revalidatePath } from 'next/cache';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { obtenerPrograma } from '@/lib/comercio/programas';
import {
  validarImagenSubida,
  extensionDeMime,
  rutaImagenCartel,
} from '@/lib/comercio/imagenComercio';
import { esPlantillaCartel } from '@/lib/comercio/cartel/tipos';

const BUCKET_IMAGENES = 'comercio-imagenes';

export type EstadoCartel = { error: string } | { ok: true } | undefined;

// Guarda la personalización del cartel de UN programa. `obtenerPrograma` (lib/comercio/programas.ts)
// verifica que el programaId sea del comercio de la sesión ANTES de escribir — mismo patrón que
// guardarConfiguracionPrograma/accionSubirFotoRecompensa: programaId llega de la URL del navegador y
// no se confía en él sin verificar.
//
// Se usa SELECT-then-INSERT/UPDATE explícito en vez de `.upsert()`. El plan justificaba esto
// diciendo que un upsert "podría" pisar `logo_url`; se MIDIÓ contra la base real el 2026-07-31 y esa
// versión de la historia es falsa, así que acá va la verificada:
//   · `.upsert(payload)` a secas ROMPE el segundo guardado de cada cartel: el conflict target por
//     defecto es la PK (`id`), que el payload no lleva, así que Postgres levanta
//     `duplicate key value violates unique constraint "disenos_cartel_programa_id_key"` y el dueño
//     ve "No se pudo guardar el cartel." cada vez que guarda por segunda vez;
//   · `.upsert(payload, { onConflict: 'programa_id' })` sí funciona y NO toca `logo_url` (PostgREST
//     arma el SET solo con las claves del payload) — las 13 pruebas de este archivo quedan verdes.
// O sea: el upsert bien parametrizado sería correcto hoy, pero qué columnas pisa depende de la FORMA
// del payload, no de nada escrito. Agregar mañana una clave a `campos` empezaría a sobrescribir esa
// columna en silencio. El UPDATE con lista explícita dice qué toca y qué no, y `logo_url` no está en
// la lista: un logo subido con accionSubirLogoCartel no se puede borrar al guardar colores/texto.
// La prueba "guardar colores y textos NO borra el logo propio ya subido" es la que sostiene esto.
export async function accionGuardarCartel(
  programaId: string,
  _estadoPrevio: EstadoCartel,
  formData: FormData,
): Promise<EstadoCartel> {
  const { comercioId } = await verifyComercioOwner();
  const supabase = createServiceClient();

  const programa = await obtenerPrograma(supabase, comercioId, programaId);
  if (!programa) return { error: 'Ese programa no es de tu comercio.' };

  const plantilla = String(formData.get('plantilla') ?? 'centrado');
  if (!esPlantillaCartel(plantilla)) return { error: 'Plantilla no válida.' };

  const textoCta = String(formData.get('texto_cta') ?? '').trim();
  if (!textoCta) return { error: 'El texto del llamado a la acción no puede quedar vacío.' };
  const textoTeaser = String(formData.get('texto_teaser') ?? '').trim() || null;

  // Apagar la personalización BORRA los overrides de color (no los deja ocultos): si el dueño la
  // vuelve a prender después, los selectores parten de la marca ACTUAL del comercio, nunca de un
  // valor viejo escondido (spec §6.3).
  const personalizar = formData.get('personalizar') === 'on';
  const colorFondo = personalizar ? String(formData.get('color_fondo') ?? '').trim() || null : null;
  const colorTexto = personalizar ? String(formData.get('color_texto') ?? '').trim() || null : null;
  const colorLabel = personalizar ? String(formData.get('color_label') ?? '').trim() || null : null;

  const campos = {
    plantilla,
    color_fondo: colorFondo,
    color_texto: colorTexto,
    color_label: colorLabel,
    texto_cta: textoCta,
    texto_teaser: textoTeaser,
  };

  const { data: existente } = await supabase
    .from('disenos_cartel')
    .select('id')
    .eq('programa_id', programaId)
    .maybeSingle();

  const { error } = existente
    ? await supabase.from('disenos_cartel').update(campos).eq('id', existente.id)
    : await supabase.from('disenos_cartel').insert({ ...campos, programa_id: programaId, comercio_id: comercioId });

  if (error) {
    console.error('[comercio] no se pudo guardar el cartel:', error);
    return { error: 'No se pudo guardar el cartel.' };
  }

  // No dispara notificarCambioComercio ni syncClaseComercio/syncObjetosComercio: el cartel no toca
  // el .pkpass ni el pase de Google en absoluto (spec §6.4) — es un documento aparte para imprimir.
  revalidatePath(`/comercio/programas/${programaId}/cartel`);
  return { ok: true };
}

// Sube el logo PROPIO del cartel (cuando el comercio no quiere heredar el de su marca para este
// cartel puntual). Mismo patrón que accionSubirFotoRecompensa: el programa se verifica ANTES de
// escribir en Storage.
export async function accionSubirLogoCartel(
  programaId: string,
  _estadoPrevio: EstadoCartel,
  formData: FormData,
): Promise<EstadoCartel> {
  const { comercioId } = await verifyComercioOwner();
  const supabase = createServiceClient();

  const programa = await obtenerPrograma(supabase, comercioId, programaId);
  if (!programa) return { error: 'Ese programa no es de tu comercio.' };

  const archivo = formData.get('archivo');
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { error: 'No se recibió ninguna imagen.' };
  }

  const problema = validarImagenSubida({ type: archivo.type, size: archivo.size });
  if (problema) return { error: problema };

  const ext = extensionDeMime(archivo.type);
  const ruta = rutaImagenCartel(comercioId, programaId, ext);

  const { error: errorSubida } = await supabase.storage
    .from(BUCKET_IMAGENES)
    .upload(ruta, await archivo.arrayBuffer(), { contentType: archivo.type, upsert: true });
  if (errorSubida) {
    console.error('[comercio] falló la subida del logo del cartel:', errorSubida);
    return { error: 'No se pudo subir la imagen.' };
  }

  const { data: pub } = supabase.storage.from(BUCKET_IMAGENES).getPublicUrl(ruta);
  const urlConVersion = `${pub.publicUrl}?v=${Date.now()}`;

  const { data: existente } = await supabase
    .from('disenos_cartel')
    .select('id')
    .eq('programa_id', programaId)
    .maybeSingle();

  const { error } = existente
    ? await supabase.from('disenos_cartel').update({ logo_url: urlConVersion }).eq('id', existente.id)
    : await supabase.from('disenos_cartel').insert({ programa_id: programaId, comercio_id: comercioId, logo_url: urlConVersion });

  if (error) {
    console.error('[comercio] se subió el logo pero no se pudo guardar su dirección:', error);
    return { error: 'La imagen se subió pero no se pudo guardar.' };
  }

  revalidatePath(`/comercio/programas/${programaId}/cartel`);
  return { ok: true };
}

export async function accionQuitarLogoCartel(
  programaId: string,
  _estadoPrevio: EstadoCartel,
  _formData: FormData,
): Promise<EstadoCartel> {
  const { comercioId } = await verifyComercioOwner();
  const supabase = createServiceClient();

  const programa = await obtenerPrograma(supabase, comercioId, programaId);
  if (!programa) return { error: 'Ese programa no es de tu comercio.' };

  const { error } = await supabase
    .from('disenos_cartel')
    .update({ logo_url: null })
    .eq('programa_id', programaId);
  if (error) {
    console.error('[comercio] no se pudo quitar el logo del cartel:', error);
    return { error: 'No se pudo quitar la imagen.' };
  }

  // Borrado del archivo best-effort y a ciegas sobre las tres extensiones posibles — mismo criterio
  // que accionQuitarFotoRecompensa.
  await supabase.storage
    .from(BUCKET_IMAGENES)
    .remove(['png', 'jpg', 'webp'].map((ext) => rutaImagenCartel(comercioId, programaId, ext)));

  revalidatePath(`/comercio/programas/${programaId}/cartel`);
  return { ok: true };
}

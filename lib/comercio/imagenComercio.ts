// Validación y rutas para las imágenes de branding del comercio. Puro y testeable, separado del
// Server Action de subida (I/O). El bucket es 'comercio-imagenes' (público de lectura); la ruta
// SIEMPRE deriva el comercio_id del gate, nunca del formulario (spec §4.4).

// Un mapa MIME -> extensión es también la lista blanca de tipos permitidos.
const MIME_A_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

// 2 MB: de sobra para un logo/strip/hero; corta subidas accidentales de fotos gigantes.
export const TAMANO_MAXIMO_BYTES = 2 * 1024 * 1024;

// Los cuatro campos de imagen del comercio. sello_icono solo aplica a tipo_tarjeta='sellos', pero
// la validación de campo es la misma. Nunca se confía en un nombre de campo del cliente para
// nombrar una columna: el Server Action lo valida contra esta lista.
export const CAMPOS_IMAGEN = ['logo', 'strip', 'hero', 'sello_icono'] as const;
export type CampoImagen = (typeof CAMPOS_IMAGEN)[number];

// Devuelve el primer problema, o null si la imagen es aceptable.
export function validarImagenSubida(archivo: { type: string; size: number }): string | null {
  if (!archivo.size) return 'El archivo está vacío.';
  if (!(archivo.type in MIME_A_EXT)) {
    return 'Formato no permitido. Usa PNG, JPG o WebP.';
  }
  if (archivo.size > TAMANO_MAXIMO_BYTES) {
    return 'La imagen es muy grande. El máximo es 2 MB.';
  }
  return null;
}

export function extensionDeMime(mime: string): string {
  const ext = MIME_A_EXT[mime];
  if (!ext) throw new Error(`MIME sin extensión conocida: ${mime}`);
  return ext;
}

// Ruta determinística dentro del bucket. El comercio_id lo pone el gate; el cache-busting va por
// query string (?v=timestamp) sobre la URL pública guardada, no en el path (así el re-subir pisa
// el archivo viejo en vez de acumular versiones infinitas).
export function rutaImagenComercio(comercioId: string, campo: string, ext: string): string {
  return `${comercioId}/${campo}.${ext}`;
}

// Ruta de la foto de un PREMIO dentro del mismo bucket. La validación y las extensiones se
// comparten con las imágenes de branding (arriba): es el mismo bucket, el mismo límite de 2 MB y
// los mismos tres formatos.
//
// Lleva el recompensaId en el path y no solo el campo, a diferencia de rutaImagenComercio: un
// comercio tiene UNA imagen por campo, pero N premios, así que sin el id todos se pisarían entre
// sí. El comercioId sigue siendo la carpeta raíz —viene del gate, nunca del formulario— así que
// una recompensa ajena no puede escribirse aunque se conozca su id.
export function rutaImagenRecompensa(comercioId: string, recompensaId: string, ext: string): string {
  return `${comercioId}/recompensas/${recompensaId}.${ext}`;
}

// Ruta de una imagen de branding de UN PROGRAMA (migración 0027). Mismo bucket, mismo límite de
// 2 MB y los mismos tres formatos que las dos de arriba.
//
// El programaId va en el path y no es opcional: la subida usa `upsert: true`, así que si esta ruta
// coincidiera con la de rutaImagenComercio, subirle el logo al programa secundario PISARÍA el logo
// del comercio — el dueño vería desaparecer la marca de su negocio sin un solo error. Hay una
// prueba dedicada a que las dos rutas nunca coincidan.
//
// El comercioId sigue siendo la carpeta raíz, igual que en las otras dos: viene del gate y nunca
// del formulario, así que conocer el id de un programa ajeno no permite escribir en otra carpeta.
export function rutaImagenPrograma(
  comercioId: string,
  programaId: string,
  campo: string,
  ext: string,
): string {
  return `${comercioId}/programas/${programaId}/${campo}.${ext}`;
}

// Ruta del logo PROPIO de un cartel (cuando el comercio decide no heredar el logo de su marca para
// este cartel puntual). Mismo bucket, misma validación de 2MB/png-jpg-webp que el resto — solo
// cambia el path. Un comercio tiene UN logo de cartel por programa (nunca dos), así que basta con el
// comercioId + el programaId, igual que rutaImagenRecompensa usa comercioId + recompensaId.
export function rutaImagenCartel(comercioId: string, programaId: string, ext: string): string {
  return `${comercioId}/carteles/${programaId}.${ext}`;
}

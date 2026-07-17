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

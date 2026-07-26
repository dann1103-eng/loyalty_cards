// Redimensionado de imágenes EN EL NAVEGADOR, antes de subirlas. Existe porque una foto sacada con
// el teléfono pesa 3-6 MB y la app acepta 2 MB: sin esto, el dueño que quiere poner una foto de su
// local desde el celular no puede, y encima chocaba con un error de servidor (el body de un Server
// Action se corta antes de llegar a la validación — ver serverActions.bodySizeLimit en
// next.config.ts). Reportado en producción el 2026-07-26.
//
// El formato NUNCA se cambia: el logo del pass de Apple se sube tal cual al .pkpass (generatePass
// lo agrega como logo.png con el buffer recibido), así que pasar un PNG con transparencia a JPEG le
// pondría fondo negro. Redimensionar es lo que baja el peso de verdad; recodificar de formato sería
// ganar unos KB a cambio de romper logos.

// Lado máximo del lado más largo. 1400 px cubre con holgura el uso más exigente del pass
// (strip@3x mide 1125×432) y una pantalla de escritorio; más allá de eso son píxeles que nadie ve
// y que solo engordan el pass que descarga el cliente en su teléfono.
export const LADO_MAXIMO = 1400;

// Debajo de esto no vale la pena tocar nada: recodificar una imagen ya chica puede incluso
// agrandarla (un PNG de pocos colores re-exportado por canvas pierde su paleta optimizada).
export const PESO_QUE_NO_VALE_TOCAR = 600 * 1024;

// Calidad para los formatos CON pérdida. 0.85 es el punto donde el archivo cae mucho y el ojo no
// nota nada en una tarjeta de lealtad. No aplica a PNG (canvas lo ignora: PNG es sin pérdida).
const CALIDAD = 0.85;

// PURA y testeable: qué tamaño debe tener la imagen final. Sin canvas, sin DOM.
// Nunca AGRANDA (una imagen chica se queda como está) y conserva la proporción.
export function dimensionesDestino(
  ancho: number,
  alto: number,
  ladoMaximo = LADO_MAXIMO,
): { ancho: number; alto: number } {
  const ladoMasLargo = Math.max(ancho, alto);
  if (ladoMasLargo <= ladoMaximo) return { ancho, alto };
  const factor = ladoMaximo / ladoMasLargo;
  // round y mínimo 1: un factor muy chico sobre un lado de 1 px daría 0 y el canvas lanzaría.
  return {
    ancho: Math.max(1, Math.round(ancho * factor)),
    alto: Math.max(1, Math.round(alto * factor)),
  };
}

// ¿Hace falta procesarla? PURA y testeable.
export function necesitaRedimensionar(
  archivo: { size: number },
  ancho: number,
  alto: number,
  ladoMaximo = LADO_MAXIMO,
  pesoQueNoValeTocar = PESO_QUE_NO_VALE_TOCAR,
): boolean {
  if (archivo.size <= pesoQueNoValeTocar) return false;
  return Math.max(ancho, alto) > ladoMaximo;
}

// Redimensiona en el navegador. Devuelve el archivo ORIGINAL si no hace falta tocarlo, si el
// formato no es de los que sabemos recodificar, o si algo falla: esta función NO puede ser la razón
// por la que alguien no pueda subir su imagen — ante la duda, que suba la original y decida el
// validador del servidor, que ya tiene su mensaje claro.
export async function redimensionarImagen(archivo: File): Promise<File> {
  if (typeof document === 'undefined' || !archivo.type.startsWith('image/')) return archivo;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(archivo);
    if (!necesitaRedimensionar(archivo, bitmap.width, bitmap.height)) return archivo;

    const { ancho, alto } = dimensionesDestino(bitmap.width, bitmap.height);
    const lienzo = document.createElement('canvas');
    lienzo.width = ancho;
    lienzo.height = alto;
    const ctx = lienzo.getContext('2d');
    if (!ctx) return archivo;
    ctx.drawImage(bitmap, 0, 0, ancho, alto);

    const blob = await new Promise<Blob | null>((resolver) =>
      lienzo.toBlob(resolver, archivo.type, CALIDAD),
    );
    // toBlob devuelve null si el navegador no sabe escribir ese tipo; y si el resultado pesa MÁS
    // que el original (pasa con PNG de paleta), quedarse con el original es lo correcto.
    if (!blob || blob.size >= archivo.size) return archivo;

    return new File([blob], archivo.name, { type: archivo.type, lastModified: Date.now() });
  } catch (error) {
    console.warn('[comercio] no se pudo redimensionar la imagen; se sube la original:', error);
    return archivo;
  } finally {
    bitmap?.close();
  }
}

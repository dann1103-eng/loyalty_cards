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

// Lado máximo POR CAMPO, porque cada imagen se muestra a un tamaño MUY distinto y un solo número
// para todas fue un error caro: con 1400 px parejo, un logo de 1400×933 pesaba 777 KB y entraba
// TRES veces al pass (logo, @2x y @3x) — 2,3 MB solo en logos, sobre un área de ~50 px. El pass de
// ese comercio llegó a 2,9 MB contra los 200-690 KB de los demás, y el dueño notó que sus tarjetas
// tardaban en actualizarse: el iPhone se baja el pass ENTERO en cada cambio de puntos.
// Los números salen del uso real: strip@3x mide 1125 px de ancho; el logo del pass se dibuja en un
// área chica (Apple sugiere ~480 px para @3x); el ícono del sello se ve a 44 px, así que 180 px le
// dan de sobra hasta en @3x.
export const LADOS_MAXIMOS: Record<string, number> = {
  logo: 480,
  sello_icono: 180,
  hero: 1400,
  strip: 1400,
};
export const LADO_MAXIMO_POR_DEFECTO = 1400;

export function ladoMaximoDe(campo: string): number {
  return LADOS_MAXIMOS[campo] ?? LADO_MAXIMO_POR_DEFECTO;
}

// Calidad para los formatos CON pérdida. 0.85 es el punto donde el archivo cae mucho y el ojo no
// nota nada en una tarjeta de lealtad. No aplica a PNG (canvas lo ignora: PNG es sin pérdida).
const CALIDAD = 0.85;

// PURA y testeable: qué tamaño debe tener la imagen final. Sin canvas, sin DOM.
// Nunca AGRANDA (una imagen chica se queda como está) y conserva la proporción.
export function dimensionesDestino(
  ancho: number,
  alto: number,
  ladoMaximo = LADO_MAXIMO_POR_DEFECTO,
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

// ¿Hace falta procesarla? PURA y testeable. Decide SOLO por dimensiones, no por peso: un logo de
// 1400 px que pesa 400 KB igual hay que achicarlo (se ve a 50 px y entra tres veces al pass), y el
// riesgo de "recodificar una imagen chica y que quede más grande" ya lo cubre redimensionarImagen,
// que compara el resultado contra el original y se queda con el más liviano.
export function necesitaRedimensionar(
  ancho: number,
  alto: number,
  ladoMaximo = LADO_MAXIMO_POR_DEFECTO,
): boolean {
  return Math.max(ancho, alto) > ladoMaximo;
}

// Redimensiona en el navegador. Devuelve el archivo ORIGINAL si no hace falta tocarlo, si el
// formato no es de los que sabemos recodificar, o si algo falla: esta función NO puede ser la razón
// por la que alguien no pueda subir su imagen — ante la duda, que suba la original y decida el
// validador del servidor, que ya tiene su mensaje claro.
export async function redimensionarImagen(archivo: File, campo: string): Promise<File> {
  if (typeof document === 'undefined' || !archivo.type.startsWith('image/')) return archivo;

  const ladoMaximo = ladoMaximoDe(campo);
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(archivo);
    if (!necesitaRedimensionar(bitmap.width, bitmap.height, ladoMaximo)) return archivo;

    const { ancho, alto } = dimensionesDestino(bitmap.width, bitmap.height, ladoMaximo);
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

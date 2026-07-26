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

// Campos a los que se les RECORTAN los márgenes transparentes antes de guardar. El logo y el ícono
// del sello se dibujan dentro de una caja chica y fija (el sello mide 44 px), y la app mete la
// imagen ENTERA ahí adentro con objectFit:'contain' — así que cada píxel vacío del borde le roba
// tamaño al dibujo. Caso real del 2026-07-26: un ícono en un lienzo de 180×120 cuyo dibujo ocupaba
// 87×86 (el 35%) se veía a 21 px dentro de una caja de 44, la mitad que el de otro comercio.
// Nadie exporta sus logos recortados al milímetro, así que lo hace la app.
// La foto de fondo NO se recorta: es a sangre, ocupa toda la franja y no tiene "dibujo" que centrar.
const CAMPOS_QUE_SE_RECORTAN = new Set(['logo', 'sello_icono']);

// Un píxel cuenta como "dibujo" arriba de este alfa. No es 0 para que el antialiasing casi
// invisible del borde no cuente como contenido y deje el recorte sin efecto.
const UMBRAL_ALFA = 12;

// El recorte se decide sobre una copia CHICA de la imagen: recorrer los píxeles de una foto de
// 4000×3000 son 48 MB de array en el teléfono, y para saber dónde termina un margen transparente
// sobra muchísimo menos resolución. Las coordenadas se escalan de vuelta al original para que el
// recorte real salga del bitmap en su tamaño completo, sin pérdida.
const LADO_ANALISIS = 320;

// Calidad para los formatos CON pérdida. 0.85 es el punto donde el archivo cae mucho y el ojo no
// nota nada en una tarjeta de lealtad. No aplica a PNG (canvas lo ignora: PNG es sin pérdida).
const CALIDAD = 0.85;

export interface Caja {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

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

// PURA y testeable: la caja que encierra todo lo que NO es transparente, sobre los píxeles RGBA
// que devuelve getImageData. Devuelve null si la imagen está entera por debajo del umbral (100%
// transparente): recortar eso daría un lienzo de 0 y el canvas lanzaría.
export function cajaDelContenido(
  pixeles: Uint8ClampedArray,
  ancho: number,
  alto: number,
  umbral = UMBRAL_ALFA,
): Caja | null {
  let minX = ancho;
  let minY = alto;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      if (pixeles[(y * ancho + x) * 4 + 3] <= umbral) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return null;
  return { x: minX, y: minY, ancho: maxX - minX + 1, alto: maxY - minY + 1 };
}

// PURA y testeable: lleva una caja medida sobre la copia chica a las coordenadas del original, con
// un píxel de holgura para no comerse el borde suavizado del dibujo. El resultado SIEMPRE queda
// dentro de la imagen: pasarse de los límites haría que drawImage rellene con transparente y
// reaparecería el margen que estamos sacando.
export function escalarCaja(caja: Caja, factor: number, anchoMaximo: number, altoMaximo: number): Caja {
  const x = Math.max(0, Math.floor(caja.x * factor) - 1);
  const y = Math.max(0, Math.floor(caja.y * factor) - 1);
  const ancho = Math.min(anchoMaximo - x, Math.ceil(caja.ancho * factor) + 2);
  const alto = Math.min(altoMaximo - y, Math.ceil(caja.alto * factor) + 2);
  return { x, y, ancho: Math.max(1, ancho), alto: Math.max(1, alto) };
}

// ¿Vale la pena recortar? PURA y testeable. Un margen de uno o dos píxeles no cambia nada de cómo
// se ve el sello y no justifica recodificar el archivo; lo que arruina el tamaño son los lienzos
// con el dibujo flotando en el medio. El umbral está en 5% de lado para que un recorte de verdad
// (el caso real ocupaba el 48% del ancho) entre holgado y el ruido no.
export function valeLaPenaRecortar(caja: Caja, ancho: number, alto: number): boolean {
  return caja.ancho < ancho * 0.95 || caja.alto < alto * 0.95;
}

// Mide, sobre una copia chica, qué parte del bitmap tiene dibujo. Devuelve la caja YA en
// coordenadas del original, o null si no hay nada que recortar (o si no se pudo medir: ante la
// duda, no se recorta).
function medirContenido(bitmap: ImageBitmap): Caja | null {
  const factorAnalisis = Math.min(1, LADO_ANALISIS / Math.max(bitmap.width, bitmap.height));
  const anchoAnalisis = Math.max(1, Math.round(bitmap.width * factorAnalisis));
  const altoAnalisis = Math.max(1, Math.round(bitmap.height * factorAnalisis));

  const lienzo = document.createElement('canvas');
  lienzo.width = anchoAnalisis;
  lienzo.height = altoAnalisis;
  const ctx = lienzo.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, anchoAnalisis, altoAnalisis);

  const { data } = ctx.getImageData(0, 0, anchoAnalisis, altoAnalisis);
  const caja = cajaDelContenido(data, anchoAnalisis, altoAnalisis);
  if (!caja || !valeLaPenaRecortar(caja, anchoAnalisis, altoAnalisis)) return null;

  return escalarCaja(caja, 1 / factorAnalisis, bitmap.width, bitmap.height);
}

// Redimensiona (y, en logo e ícono de sello, recorta los márgenes transparentes) en el navegador.
// Devuelve el archivo ORIGINAL si no hace falta tocarlo, si el formato no es de los que sabemos
// recodificar, o si algo falla: esta función NO puede ser la razón por la que alguien no pueda
// subir su imagen — ante la duda, que suba la original y decida el validador del servidor, que ya
// tiene su mensaje claro.
export async function redimensionarImagen(archivo: File, campo: string): Promise<File> {
  if (typeof document === 'undefined' || !archivo.type.startsWith('image/')) return archivo;

  const ladoMaximo = ladoMaximoDe(campo);
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(archivo);

    // Sin recorte, el origen es la imagen entera. Con recorte, solo la parte que tiene dibujo:
    // el redimensionado de abajo se calcula ya sobre ESE tamaño, así el dibujo llega al lado
    // máximo del campo en vez de que se lo coman los márgenes.
    const recorte = CAMPOS_QUE_SE_RECORTAN.has(campo) ? medirContenido(bitmap) : null;
    const origen: Caja = recorte ?? { x: 0, y: 0, ancho: bitmap.width, alto: bitmap.height };

    if (!recorte && !necesitaRedimensionar(origen.ancho, origen.alto, ladoMaximo)) return archivo;

    const { ancho, alto } = dimensionesDestino(origen.ancho, origen.alto, ladoMaximo);
    const lienzo = document.createElement('canvas');
    lienzo.width = ancho;
    lienzo.height = alto;
    const ctx = lienzo.getContext('2d');
    if (!ctx) return archivo;
    ctx.drawImage(bitmap, origen.x, origen.y, origen.ancho, origen.alto, 0, 0, ancho, alto);

    const blob = await new Promise<Blob | null>((resolver) =>
      lienzo.toBlob(resolver, archivo.type, CALIDAD),
    );
    // toBlob devuelve null si el navegador no sabe escribir ese tipo. Si el resultado pesa MÁS que
    // el original (pasa con PNG de paleta), quedarse con el original es lo correcto... salvo que
    // hayamos RECORTADO: ahí el archivo nuevo no es "el mismo pero más liviano" sino una imagen
    // distinta y mejor encuadrada, y descartarla por unos KB devolvería el ícono diminuto.
    if (!blob || (blob.size >= archivo.size && !recorte)) return archivo;

    return new File([blob], archivo.name, { type: archivo.type, lastModified: Date.now() });
  } catch (error) {
    console.warn('[comercio] no se pudo redimensionar la imagen; se sube la original:', error);
    return archivo;
  } finally {
    bitmap?.close();
  }
}

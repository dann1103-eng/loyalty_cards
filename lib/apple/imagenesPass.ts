import sharp from 'sharp';

// Redimensionado y compresión de las imágenes que entran al .pkpass.
//
// Se hace AL EMITIR EL PASS y no al subir la imagen, a propósito: así funciona retroactivamente con
// todos los logos ya guardados, sin que ningún comercio vuelva a subir nada. El costo en CPU es
// despreciable al lado de la composición de franjas con next/og que ya ocurre en este mismo camino.
//
// El problema que resuelve, medido en producción el 2026-07-26 (Farmacias ABC): el pass pesaba
// 1763 KB y el iPhone se lo baja ENTERO cada vez que se acredita un punto — el dueño reportó que la
// tarjeta tardaba en verse actualizada.
//
// SIEMPRE best-effort: cualquier fallo devuelve el buffer original. Ninguna optimización de peso
// puede ser la razón por la que un cliente se quede sin tarjeta.

// Los tres anchos salen del área que Wallet dibuja para el logo (160×50 pt): 160 px en @1x, el
// doble en @2x y el triple en @3x. No son un tamaño "de imagen": son el tamaño al que se VE.
export const ANCHOS_LOGO = [160, 320, 480] as const;

// `withoutEnlargement` es lo que impide que un logo chico se estire: agrandarlo no le agrega
// detalle (no hay de dónde sacarlo) y sí le agrega peso — medido, un PNG de 100 px de 30 KB sale
// en 440 KB al forzarlo a 480. Sin guarda de peso acá (la que sí tiene comprimirPng): reducir la
// resolución siempre achica, y una guarda enmascararía justamente la pérdida de withoutEnlargement.
async function redimensionarA(buf: Buffer, ancho: number): Promise<Buffer> {
  try {
    return await sharp(buf)
      .resize({ width: ancho, withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch (error) {
    console.warn(`[apple] no se pudo redimensionar el logo a ${ancho} px; va el original:`, error);
    return buf;
  }
}

// Las tres densidades del logo, cada una a su ancho real. Antes iba el MISMO buffer de 480 px en
// las tres: 331 KB × 3 = 993 KB, el 56% de un pass de 1763 KB, sobre un área de ~50 px de alto.
export async function redimensionarLogo(buf: Buffer): Promise<[Buffer, Buffer, Buffer]> {
  // Una densidad que falle no se lleva a las otras dos (cada redimensionarA cae al original por su
  // cuenta), y las tres se codifican en paralelo porque son independientes.
  return Promise.all([
    redimensionarA(buf, ANCHOS_LOGO[0]),
    redimensionarA(buf, ANCHOS_LOGO[1]),
    redimensionarA(buf, ANCHOS_LOGO[2]),
  ]);
}

// Cuantización a paleta: lo único que corta el peso de un PNG con contenido fotográfico. Apple solo
// acepta PNG en el pass, y PNG guarda una foto pésimo — las franjas eran 569 KB de los 1763.
//
// `quality` acá NO significa "cuánto degradar": en sharp es "usá la MENOR cantidad de colores que
// alcance esta calidad", y 100 (su valor por defecto) sigue siendo una paleta de 256. El plan
// proponía 80 y se midió antes de fijarlo, mirando las franjas ampliadas al triple:
//   - con foto y difuminado, a 80 el tramado se ve como grano sucio sobre el degradado;
//   - la banda de marca SIN foto (fondo liso + resplandor) tiene 114 colores, casi todos del
//     suavizado del borde del resplandor: a 80 y a 90 se queda con TRES y ese borde sale escalonado.
// A 100 la banda sin foto sale idéntica a la original (sus 114 colores entran enteros) y baja igual
// de 14.6 KB a 4.8; con foto, las tres franjas pasan de 661 KB a 145 (a 90 serían 130). Esos 15 KB
// son el seguro más barato de esta rama: media tarjeta fea no vale 15 KB.
// Cuidado con apagar el tramado (`dither`, en 1 por defecto) creyendo que ahorra: sin él el
// degradado sale con bandas francas y feas, y solo bajaba de 83 KB a 50.
export async function comprimirPng(buf: Buffer): Promise<Buffer> {
  try {
    const comprimido = await sharp(buf).png({ palette: true, quality: 100, effort: 8 }).toBuffer();
    // Con imágenes ya optimizadas o de pocos colores la tabla de paleta pesa más que lo que ahorra:
    // medido, un PNG mínimo de 90 bytes sale en 103. Sin este freno "optimizar" engordaría el pass.
    if (comprimido.length >= buf.length) return buf;
    return comprimido;
  } catch (error) {
    console.warn('[apple] no se pudo comprimir el PNG; va el original:', error);
    return buf;
  }
}

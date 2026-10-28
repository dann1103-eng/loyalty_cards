import sharp from 'sharp';
import { componerLogoCuadrado } from '@/lib/google/componerLogo';

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

// El área que Wallet dibuja para el logo es de 160×50 pt. De ahí salen los dos topes, densidad por
// densidad: 160×50 en @1x, el doble en @2x y el triple en @3x. No son un tamaño "de imagen": son el
// tamaño al que se VE.
//
// Los DOS topes importan, no solo el ancho. Acotando únicamente el ancho, un logo cuadrado de
// 480×480 se guardaba entero: 480 px de alto para pintar 50 pt, o sea el TRIPLE de píxeles de los
// que Wallet llega a dibujar. Medido el 2026-07-26 sobre el peor caso de pesoPass.test.ts, esas
// filas que nunca se ven eran 943 KB (el logo pasó de 1024 KB a 81).
export const ANCHOS_LOGO = [160, 320, 480] as const;
export const ALTOS_LOGO = [50, 100, 150] as const;

// EL TECHO DE PESO DEL PASS. Un solo número, en un solo lugar, porque lo miran dos guardias que
// tienen que estar de acuerdo: lib/apple/pesoPass.test.ts (arma el peor caso y falla antes de
// desplegar) y scripts/verificar-wallet.ts (mide el pass REAL en producción). Separados eran dos
// números que significaban lo mismo y podían divergir sin que nadie se enterara.
//
// Es un TECHO, no una meta. Los números medidos el 2026-07-26:
//   - pass real del piloto ANTES del logo por densidad: 1763 KB (el dueño reportó que la tarjeta
//     tardaba en verse actualizada — el iPhone se baja el pass ENTERO en cada punto acreditado);
//   - peor caso sintético de pesoPass.test.ts: 516 KB.
//
// Ese peor caso es lo que fija el número, y ya es más pesado que cualquier pass real: son imágenes
// de ruido puro en los topes de subida (480×480 el logo, 1400×1400 la foto), o sea el máximo
// matemático que puede pesar un PNG de ese tamaño. 600 KB le deja 16% de margen.
//
// Antes de acotar el logo por ALTO este mismo peor caso medía 1458 KB y el techo tuvo que estar en
// 1600, un número que casi no avisaba nada en producción. El tope de alto se llevó 943 KB de un
// saque y es lo que permite que el techo vuelva a ser exigente: 600 KB avisa ANTES que los 700 que
// tenía el script cuando esto empezó.
export const PRESUPUESTO_PASS_KB = 600;

// `fit: 'inside'` mete el logo DENTRO de la caja de Apple sin deformarlo: escala por el lado que
// sobra (el ancho en un logo apaisado, el alto en uno cuadrado o vertical) y conserva la proporción.
// Es la misma caja que aplica Wallet al dibujarlo, así que lo que se recorta acá es exactamente lo
// que el teléfono nunca iba a pintar. Ojo con cambiarlo por 'fill' o por un solo lado: el logo
// saldría ESTIRADO, que ya pasó en producción con el ícono de sellos (2026-07-26).
//
// `withoutEnlargement` impide que un logo chico se estire: agrandarlo no le agrega detalle (no hay
// de dónde sacarlo) y sí le agrega peso — medido, un PNG de 100 px de 30 KB sale en 440 KB al
// forzarlo a 480. Sin guarda de peso acá (la que sí tiene comprimirPng): reducir la resolución
// siempre achica, y una guarda enmascararía justamente la pérdida de withoutEnlargement.
async function redimensionarA(buf: Buffer, ancho: number, alto: number): Promise<Buffer> {
  try {
    return await sharp(buf)
      .resize({ width: ancho, height: alto, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch (error) {
    console.warn(`[apple] no se pudo redimensionar el logo a ${ancho}×${alto} px; va el original:`, error);
    return buf;
  }
}

// Las tres densidades del logo, cada una en la caja que le toca. Antes iba el MISMO buffer de
// 480 px en las tres: 331 KB × 3 = 993 KB, el 56% de un pass de 1763 KB, sobre un área de 50 pt
// de alto.
export async function redimensionarLogo(buf: Buffer): Promise<[Buffer, Buffer, Buffer]> {
  // Una densidad que falle no se lleva a las otras dos (cada redimensionarA cae al original por su
  // cuenta), y las tres se codifican en paralelo porque son independientes.
  return Promise.all([
    redimensionarA(buf, ANCHOS_LOGO[0], ALTOS_LOGO[0]),
    redimensionarA(buf, ANCHOS_LOGO[1], ALTOS_LOGO[1]),
    redimensionarA(buf, ANCHOS_LOGO[2], ALTOS_LOGO[2]),
  ]);
}

// El ícono del pase: el que iOS pone en la NOTIFICACIÓN y en la pantalla de bloqueo, al lado del
// nombre del comercio. Hasta el 2026-10-28 salía siempre el de passModels/loyalty.pass, un cuadrado
// café liso que era relleno de la plantilla: el dueño de Gama Gourmet mandó una notificación y sus
// clientes la recibieron sin su logo.
//
// 29 pt, las mismas medidas de la plantilla y las que confirmó Apple en sus foros de desarrolladores
// (hilo 773456: 29×29, 58×58, 87×87; los 38 pt que figuraron en las guías de diseño no aplican).
export const LADOS_ICONO = [29, 58, 87] as const;

// El ícono sale del cuadrado que ya se compone para el `programLogo` de Google: el logo ENTERO sobre
// el color de fondo de la tarjeta, a sangre. Así el comercio tiene la misma insignia en las dos
// billeteras, y el fondo OPACO no es un detalle: Apple pinta de blanco lo transparente del ícono en
// la notificación, y un logo blanco sin fondo quedaba blanco sobre blanco (respuesta de Apple en ese
// mismo hilo). El área segura del 70 % que se pensó para el círculo de Google le deja de sobra
// espacio a las esquinas redondeadas que le pone iOS.
//
// Best-effort como todo lo de este archivo, pero acá el respaldo no es "el original": es null, y con
// null el pase sale con el ícono de la plantilla. Un logo crudo de 480 px en icon.png no le sirve a
// nadie, y Apple rechaza el pase si falta el ícono.
export async function iconoDesdeLogo(
  logo: Buffer,
  colorFondo: string,
): Promise<[Buffer, Buffer, Buffer] | null> {
  try {
    const cuadrado = await componerLogoCuadrado(logo, colorFondo);
    const [chico, mediano, grande] = await Promise.all(
      LADOS_ICONO.map((lado) => sharp(cuadrado).resize(lado, lado).png({ compressionLevel: 9 }).toBuffer()),
    );
    return [chico, mediano, grande];
  } catch (error) {
    console.warn('[apple] no se pudo componer el ícono con el logo; va el de la plantilla:', error);
    return null;
  }
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

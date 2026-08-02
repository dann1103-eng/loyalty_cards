import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { PDFDocument, PDFDict, PDFName, PDFNumber, PDFStream } from 'pdf-lib';
import { construirCartelSvg as construirCartelSvgCon } from './plantillas';
import { dibujarTextoConInter } from './textoInter';
import { dibujarTextoConFuenteDelSistema } from './texto';
import { rasterizarCartelPng, generarCartelPdf } from './export';
import { DIMENSIONES_CARTEL } from './tipos';
import type { DatosCartel, FormatoCartel } from './tipos';
import {
  rasterizarCartelSinFuentes,
  rasterizarSvgConFuentes,
  rasterizarSvgSinFuentes,
} from '../../../test/fixtures/rasterizarSinFuentes';

const DATOS: DatosCartel = {
  nombreComercio: 'Café Sol',
  plantilla: 'centrado',
  colorFondo: '#3b2a1e',
  colorTexto: '#f5ede0',
  colorLabel: '#e8b978',
  logoDataUri: null,
  fotoDataUri: null,
  textoCta: '¡Escaneá y sumate!',
  textoTeaser: null,
  urlRegistro: 'https://www.cardly-sv.site/registro/cafe-sol',
};

// Este archivo mide el PNG/PDF que se DESCARGA, así que arma el cartel exactamente como lo arma la
// ruta de descarga: con el texto convertido a contornos. Nunca con el <text> de la vista previa —
// `rasterizarCartelPng` lo rechaza, justamente para que no vuelva el bug de los cuadraditos.
const construirCartelSvg = (datos: DatosCartel, formato: FormatoCartel) =>
  construirCartelSvgCon(datos, formato, dibujarTextoConInter);

// ── Helpers de píxeles ────────────────────────────────────────────────────────────────────────────
// Todo lo que sigue mira el PNG RESULTANTE, no el SVG de entrada. Un cartel puede tener el `<image>`
// perfecto en el SVG y salir SIN logo del rasterizador: el archivo se genera igual, pesa lo esperado,
// no hay ningún error y la vista previa del navegador se ve perfecta. Por eso esta suite cuenta
// píxeles en vez de conformarse con "el PNG no reventó".

async function pixelesDe(png: Buffer): Promise<{ data: Buffer; canales: number }> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, canales: info.channels };
}

// Magenta puro: el color testigo del logo. Ni el fondo (#3b2a1e), ni el texto (#f5ede0), ni el label
// (#e8b978), ni el QR (negro sobre blanco) se le acercan — si aparece magenta en el PNG, solo pudo
// salir del <image> del logo o de la foto. La tolerancia es ancha a propósito: la plantilla "foto"
// pinta un velo negro al 35% encima de la foto de fondo, que baja el magenta puro a ~(166, 0, 166).
function esMagenta(r: number, g: number, b: number): boolean {
  return r > 100 && b > 100 && g < 60 && Math.abs(r - b) < 30;
}

async function contarMagenta(png: Buffer): Promise<number> {
  const { data, canales } = await pixelesDe(png);
  let n = 0;
  for (let i = 0; i < data.length; i += canales) {
    if (esMagenta(data[i], data[i + 1], data[i + 2])) n += 1;
  }
  return n;
}

// Un PNG cuadrado de un solo color, listo para pasarlo como data URI de logo o de foto de fondo.
async function pngDeUnColor(color: { r: number; g: number; b: number }, lado = 120): Promise<string> {
  const png = await sharp({
    create: { width: lado, height: lado, channels: 4, background: { ...color, alpha: 1 } },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

const pngMagentaDataUri = (lado = 120) => pngDeUnColor({ r: 255, g: 0, b: 255 }, lado);
// Cian: un logo que el contador de magenta NO ve (r=0). Sirve para ocupar el hueco del logo y que
// `logoSvg` no dibuje su círculo de respaldo, que se pinta con `colorLabel` — el mismo magenta con
// el que se miden los textos.
const pngCianDataUri = (lado = 120) => pngDeUnColor({ r: 0, g: 255, b: 255 }, lado);

// Píxeles de gris INTERMEDIO (ni blanco ni negro): el rastro que deja el desenfoque. En un cartel
// nítido los únicos grises intermedios son el antialias del borde de cada módulo del QR y de las
// letras; en un raster chico AMPLIADO, cada borde se reparte entre varios píxeles y la cuenta se
// dispara. Los colores de marca de DATOS no son grises (r≠g≠b), así que ni el fondo ni los textos
// de color contaminan la medición.
async function contarGrisesIntermedios(png: Buffer): Promise<number> {
  const { data, canales } = await pixelesDe(png);
  let n = 0;
  for (let i = 0; i < data.length; i += canales) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (Math.abs(r - g) < 12 && Math.abs(g - b) < 12 && r > 60 && r < 195) n += 1;
  }
  return n;
}

// Las imágenes que la página 0 del PDF declara en sus recursos, con su tamaño real en píxeles.
// pdf-lib solo registra el XObject en los recursos de la página cuando la imagen se DIBUJA: una
// hoja en blanco devuelve [] acá.
function imagenesDeLaPagina(pdf: PDFDocument): { ancho: number; alto: number }[] {
  const recursos = pdf.getPage(0).node.Resources();
  const xobjects = recursos?.lookupMaybe(PDFName.of('XObject'), PDFDict);
  if (!xobjects) return [];
  const imagenes: { ancho: number; alto: number }[] = [];
  for (const clave of xobjects.keys()) {
    const stream = xobjects.lookupMaybe(clave, PDFStream);
    if (stream?.dict.lookupMaybe(PDFName.of('Subtype'), PDFName) !== PDFName.of('Image')) continue;
    imagenes.push({
      ancho: stream.dict.lookupMaybe(PDFName.of('Width'), PDFNumber)?.asNumber() ?? 0,
      alto: stream.dict.lookupMaybe(PDFName.of('Height'), PDFNumber)?.asNumber() ?? 0,
    });
  }
  return imagenes;
}

describe('rasterizarCartelPng', () => {
  it('el PNG del sticker mide EXACTAMENTE 1181x1181px (no un raster chico ampliado)', async () => {
    const svg = await construirCartelSvg(DATOS, 'sticker');
    const png = await rasterizarCartelPng(svg, 'sticker');
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(DIMENSIONES_CARTEL.sticker.px.ancho);
    expect(meta.height).toBe(DIMENSIONES_CARTEL.sticker.px.alto);
  });

  it('el PNG del mostrador mide EXACTAMENTE 1748x2480px', async () => {
    const svg = await construirCartelSvg(DATOS, 'mostrador');
    const png = await rasterizarCartelPng(svg, 'mostrador');
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(DIMENSIONES_CARTEL.mostrador.px.ancho);
    expect(meta.height).toBe(DIMENSIONES_CARTEL.mostrador.px.alto);
  });

  // Fija el SUPUESTO del que depende `rasterizarCartelPng`, no su implementación (la prueba arma su
  // propio `sharp(...)`): que sin fijar `density` sharp lee el width="100mm" del SVG a 72 dpi y lo
  // rasteriza a 283 px — muy por DEBAJO de los 1181 de destino, o sea que el `.resize()` sería una
  // ampliación con pérdida —, y que con `density: 300` el raster nativo pasa de largo ese destino.
  // Si una versión futura de sharp/librsvg cambiara esa lectura de los mm, esta prueba avisa.
  it('sin density el raster nativo es de 283px (la trampa); con density:300 supera el tamaño final', async () => {
    const svg = await construirCartelSvg(DATOS, 'sticker');
    const sinDensity = await sharp(Buffer.from(svg)).metadata();
    const conDensity = await sharp(Buffer.from(svg), { density: 300 }).metadata();
    expect(sinDensity.width).toBeLessThan(400);
    expect(conDensity.width).toBeGreaterThan(DIMENSIONES_CARTEL.sticker.px.ancho);
  });

  // ESTA es la prueba de la trampa de densidad que SÍ ejercita el código: compara el PNG real contra
  // el mismo SVG rasterizado por el camino MALO (72 dpi por defecto + resize de ampliación), que es
  // exactamente lo que quedaría si `rasterizarCartelPng` perdiera `{ density: 300 }`. Sin umbral
  // mágico: la referencia borrosa se construye acá y la comparación es relativa, así que no se
  // desactualiza cuando la Tarea 15 ajuste el layout de las plantillas.
  it('el PNG es NÍTIDO: mucho menos borde difuminado que el mismo SVG ampliado desde 72dpi', async () => {
    const svg = await construirCartelSvg(DATOS, 'sticker');
    const { ancho, alto } = DIMENSIONES_CARTEL.sticker.px;

    const nitido = await rasterizarCartelPng(svg, 'sticker');
    const borroso = await sharp(Buffer.from(svg)).resize(ancho, alto).png().toBuffer();

    const grisesNitido = await contarGrisesIntermedios(nitido);
    const grisesBorroso = await contarGrisesIntermedios(borroso);

    // Medido el 2026-07-31: 1318 píxeles intermedios el nítido contra 7901 el borroso (6.0x). El
    // umbral de la mitad deja muchísimo aire para cambios de layout y sigue lejísimos de poder
    // pasar si se pierde el density (ahí las dos cuentas serían LA MISMA).
    expect(grisesNitido).toBeLessThan(grisesBorroso * 0.5);
  });

  // ── El riesgo que motivó esta tarea ───────────────────────────────────────────────────────────
  // Las plantillas emiten `<image href="…">`, sintaxis de SVG 2. Si el rasterizador (librsvg, vía
  // sharp) solo entendiera el `xlink:href` de SVG 1.1, el logo y la foto DESAPARECERÍAN EN SILENCIO
  // del PNG y del PDF: sin error, con el peso esperado, y con la vista previa del navegador viéndose
  // perfecta. Probar que el PNG "no revienta" no detecta nada de eso; hay que mirar si el color del
  // logo está realmente en los píxeles.
  it('el LOGO aparece de verdad en los píxeles del PNG, no solo en el texto del SVG', async () => {
    const datos: DatosCartel = { ...DATOS, logoDataUri: await pngMagentaDataUri() };
    const svg = await construirCartelSvg(datos, 'sticker');
    expect(svg).toContain('<image');

    const png = await rasterizarCartelPng(svg, 'sticker');
    // El logo ocupa w*0.18 del diseño → ~212x212 px en el raster final; medidos 45.369 píxeles
    // magenta el 2026-07-31. Se exige un cuarto de eso: ni aprueba por unos píxeles sueltos de
    // antialias, ni se rompe si la Tarea 15 mueve o achica el logo al ajustar el layout.
    expect(await contarMagenta(png)).toBeGreaterThan(10000);
  });

  // El control que le da valor a la prueba de arriba: sin logo NO hay un solo píxel magenta. Si el
  // contador diera positivo acá, la prueba anterior estaría aprobando sola.
  it('sin logo, el PNG no tiene NI UN píxel magenta (el contador discrimina de verdad)', async () => {
    const png = await rasterizarCartelPng(await construirCartelSvg(DATOS, 'sticker'), 'sticker');
    expect(await contarMagenta(png)).toBe(0);
  });

  // El otro `<image href>` de plantillas.ts: la foto de fondo de la plantilla "foto". Mismo riesgo,
  // distinta ruta de código — acá la imagen va a lienzo completo y con un velo negro encima.
  it('la FOTO de fondo de la plantilla "foto" aparece de verdad en los píxeles', async () => {
    const datos: DatosCartel = { ...DATOS, plantilla: 'foto', fotoDataUri: await pngMagentaDataUri(400) };
    const png = await rasterizarCartelPng(await construirCartelSvg(datos, 'mostrador'), 'mostrador');
    // Fondo a lienzo completo (1748x2480 = 4,3 M px) menos la tarjeta blanca del QR: medidos
    // 2.751.242 píxeles magenta el 2026-07-31.
    expect(await contarMagenta(png)).toBeGreaterThan(500000);
  });

  // El QR va anidado como <svg> dentro del <svg> (plantillas.ts no lo pasa por un PNG intermedio).
  // Que el archivo mida lo que tiene que medir no dice NADA sobre si ese QR quedó legible: esto lo
  // decodifica con el mismo lector que usa el escáner del comercio.
  it('el QR del PNG se decodifica y apunta a la URL de registro', async () => {
    const svg = await construirCartelSvg(DATOS, 'sticker');
    const png = await rasterizarCartelPng(svg, 'sticker');
    // Se decodifica sobre una reducción a 600px: jsQR sobre 1181x1181 es lento y a 600 el módulo del
    // QR sigue midiendo varios píxeles.
    const { data, info } = await sharp(png)
      .resize(600, 600)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const leido = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    expect(leido?.data).toBe(DATOS.urlRegistro);
  });
});

// ── El TEXTO, medido donde de verdad falla ────────────────────────────────────────────────────────
// Bug de producción del 2026-08-02: el dueño imprimió el cartel y el nombre del negocio y la frase
// del CTA salieron como CUADRADITOS VACÍOS, uno por letra. El logo (una imagen) se veía perfecto:
// fallaba solo el texto. Causa: las plantillas pedían `font-family="sans-serif"` y el runtime
// serverless de Vercel no tiene NINGUNA fuente instalada, así que librsvg dibujaba el glifo
// "faltante" de cada carácter. Fallo mudo: el PNG se generaba, pesaba lo esperado, sin un error.
//
// Ninguna prueba de este archivo podía atraparlo, porque todas corren en una máquina CON fuentes.
// Por eso estas rasterizan en un proceso hijo con fontconfig aislado (test/fixtures/
// rasterizarSinFuentes.ts), que es la condición real de Vercel.
//
// El testigo vuelve a ser el magenta, como con el logo: el fondo (#3b2a1e) no se le acerca, el QR
// es negro sobre blanco y el logo de estas pruebas es cian, así que TODO píxel magenta salió de una
// letra.
const DATOS_TEXTO_MAGENTA: DatosCartel = {
  ...DATOS,
  colorTexto: '#ff00ff',
  colorLabel: '#ff00ff',
  textoTeaser: 'Tu 5to café gratis',
};

describe('el texto del cartel SIN fuentes del sistema (la condición de Vercel)', () => {
  // El control que le da sentido a todo el bloque: demuestra que el aislamiento aísla de verdad.
  // Si fontconfig empezara a ignorar FONTCONFIG_FILE, el hijo tendría las fuentes de la máquina y
  // las pruebas de abajo pasarían sin probar NADA. Es el mismo SVG, por el mismo camino, con la
  // única diferencia del entorno.
  it('el aislamiento aísla: el mismo <text> pierde casi toda su tinta sin fuentes', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="30mm" viewBox="0 0 400 120"><rect width="400" height="120" fill="#ffffff"/><text x="10" y="85" font-family="sans-serif" font-size="64" font-weight="700" fill="#ff00ff">Cafe Sol</text></svg>`;
    const conFuentes = await rasterizarSvgConFuentes(svg, 1181, 354);
    const sinFuentes = await rasterizarSvgSinFuentes(svg, 1181, 354);

    const tintaCon = await contarMagenta(conFuentes);
    const tintaSin = await contarMagenta(sinFuentes);

    // Medido el 2026-08-02: 40.881 con las fuentes de Windows contra 2.128 aislado (19x). Esos 2.128
    // son el CONTORNO de los ocho cuadraditos. El umbral relativo (un cuarto) no depende de qué
    // fuente tenga la máquina que corra la suite.
    expect(tintaCon).toBeGreaterThan(10000);
    expect(
      tintaSin,
      `sin fuentes se dibujaron ${tintaSin} píxeles contra ${tintaCon} con fuentes: el aislamiento NO está aislando y las demás pruebas de este bloque no miden nada`,
    ).toBeLessThan(tintaCon * 0.25);
  });

  // ESTA es la prueba del bug, y la única que sabe distinguir una letra de un cuadradito.
  //
  // Contar tinta NO alcanza, y conviene dejarlo escrito porque es contraintuitivo: medido el
  // 2026-08-02 sobre este mismo cartel, los cuadraditos dejan 5.789 píxeles magenta y las letras de
  // verdad 5.811 — un 0,4% de diferencia. Un umbral sobre esa cifra sería decoración. Lo que sí
  // separa un caso del otro es de QUÉ depende el dibujo: el <text> roto cambia según las fuentes que
  // tenga la máquina (5.789 aislado contra 4.688 con las de Windows, y hasta el sha del PNG cambia),
  // mientras que un contorno no consulta al sistema de fuentes porque no lo necesita.
  //
  // Así que la aserción es la propiedad que de verdad queremos: el PNG que se imprime tiene que
  // salir IDÉNTICO byte a byte con fuentes y sin ellas. Eso es exactamente "el cartel no depende de
  // que el runtime tenga fuentes", que es lo que falló en Vercel. La prueba de arriba —el control de
  // aislamiento— es la que garantiza que esta tenga dientes: si la máquina no tuviera fuentes, los
  // dos lados serían cuadraditos idénticos y esta pasaría sin querer.
  it('el PNG sale IDÉNTICO con fuentes y sin ninguna: el cartel impreso no depende del sistema', async () => {
    const datos: DatosCartel = { ...DATOS_TEXTO_MAGENTA, logoDataUri: await pngCianDataUri() };
    const { ancho, alto } = DIMENSIONES_CARTEL.sticker.px;
    const svg = await construirCartelSvg(datos, 'sticker');

    const sinFuentes = await rasterizarSvgSinFuentes(svg, ancho, alto);
    const conFuentes = await rasterizarSvgConFuentes(svg, ancho, alto);

    expect(
      sinFuentes.equals(conFuentes),
      'el mismo cartel se rasteriza distinto con fuentes que sin ellas: el texto está saliendo de una fuente del sistema, y en Vercel no hay ninguna — se imprimiría un cuadradito por letra',
    ).toBe(true);
  });

  // Que el cartel sea reproducible no dice que tenga texto: un cartel SIN una sola letra también
  // saldría idéntico con fuentes y sin ellas. Esto tapa ese agujero — hay tinta del color de los
  // textos donde tiene que haberla — y el control de más abajo prueba que el contador no aprueba
  // solo. Lo que esta prueba NO hace es distinguir letras de cuadraditos: ya quedó medido que las
  // dos cosas dejan casi la misma tinta. De eso se encarga la prueba de arriba, no esta.
  it('el NOMBRE y el CTA dejan tinta de verdad aunque no haya ni una fuente instalada', async () => {
    const datos: DatosCartel = { ...DATOS_TEXTO_MAGENTA, logoDataUri: await pngCianDataUri() };
    const png = await rasterizarCartelSinFuentes(datos, 'sticker');

    // Medidos 5.811 píxeles el 2026-08-02 (nombre en 700, CTA en 600 y teaser en 400, sobre 1181px).
    // Se exige la mitad: ni aprueba con el antialias de un par de trazos sueltos, ni se rompe si un
    // ajuste de layout mueve o achica los textos.
    const tinta = await contarMagenta(png);
    expect(tinta, `solo ${tinta} píxeles de texto en el PNG del cartel`).toBeGreaterThan(2900);
  });

  // La otra mitad del arreglo: que sea IMPOSIBLE volver a mandar un <text> al rasterizador. La
  // conversión a contornos se elige por parámetro, y un parámetro se puede pasar mal; este guardián
  // convierte ese error en un 500 visible en vez de un cartel impreso en cuadraditos. Se ejercita
  // con el dibujante de la vista previa, que es exactamente el que NO va por acá.
  it('rasterizarCartelPng RECHAZA un SVG con <text> en vez de rasterizarlo en cuadraditos', async () => {
    const svgConText = await construirCartelSvgCon(DATOS, 'sticker', dibujarTextoConFuenteDelSistema);
    expect(svgConText).toContain('<text');
    await expect(rasterizarCartelPng(svgConText, 'sticker')).rejects.toThrow(/todavía trae <text>/);
    // El mensaje tiene que explicar QUÉ pasa, no solo que algo falló: quien lo lea en un log de
    // Vercel dentro de un año necesita entender por qué un <text> es un problema.
    await expect(rasterizarCartelPng(svgConText, 'sticker')).rejects.toThrow(/cuadradito por letra/);
  });

  // El control del contador, calcado del que acompaña a la prueba del logo: sin textos NO hay ni un
  // píxel magenta. Si diera positivo, la prueba de arriba estaría aprobando sola.
  it('sin textos, el PNG no tiene NI UN píxel magenta (el contador discrimina de verdad)', async () => {
    const datos: DatosCartel = {
      ...DATOS_TEXTO_MAGENTA,
      logoDataUri: await pngCianDataUri(),
      nombreComercio: '',
      textoCta: '',
      textoTeaser: null,
    };
    expect(await contarMagenta(await rasterizarCartelSinFuentes(datos, 'sticker'))).toBe(0);
  });
});

describe('generarCartelPdf', () => {
  it('la página del PDF del sticker mide 283.46x283.46pt', async () => {
    const svg = await construirCartelSvg(DATOS, 'sticker');
    const png = await rasterizarCartelPng(svg, 'sticker');
    const pdfBytes = await generarCartelPdf(png, 'sticker');
    const pdf = await PDFDocument.load(pdfBytes);
    const { width, height } = pdf.getPage(0).getSize();
    expect(width).toBeCloseTo(DIMENSIONES_CARTEL.sticker.pt.ancho, 1);
    expect(height).toBeCloseTo(DIMENSIONES_CARTEL.sticker.pt.alto, 1);
  });

  it('la página del PDF del mostrador mide 419.53x595.28pt (A5)', async () => {
    const svg = await construirCartelSvg(DATOS, 'mostrador');
    const png = await rasterizarCartelPng(svg, 'mostrador');
    const pdfBytes = await generarCartelPdf(png, 'mostrador');
    const pdf = await PDFDocument.load(pdfBytes);
    const { width, height } = pdf.getPage(0).getSize();
    expect(width).toBeCloseTo(DIMENSIONES_CARTEL.mostrador.pt.ancho, 1);
    expect(height).toBeCloseTo(DIMENSIONES_CARTEL.mostrador.pt.alto, 1);
  });

  it('el PDF tiene exactamente 1 página', async () => {
    const svg = await construirCartelSvg(DATOS, 'sticker');
    const png = await rasterizarCartelPng(svg, 'sticker');
    const pdfBytes = await generarCartelPdf(png, 'sticker');
    const pdf = await PDFDocument.load(pdfBytes);
    expect(pdf.getPageCount()).toBe(1);
  });

  // Una hoja EN BLANCO del tamaño correcto pasaría las tres pruebas de arriba sin despeinarse (y
  // pesa 578 bytes: medir el peso tampoco alcanza — el PDF con el cartel adentro pesa 35 KB, MENOS
  // que el PNG de 57 KB, porque pdf-lib re-comprime la imagen). Lo único que distingue de verdad un
  // cartel de una hoja en blanco es que la página declare la imagen embebida, a tamaño completo.
  it('el PDF trae el cartel adentro: una sola imagen de 1181x1181 (no una hoja en blanco)', async () => {
    const svg = await construirCartelSvg(DATOS, 'sticker');
    const png = await rasterizarCartelPng(svg, 'sticker');
    const pdf = await PDFDocument.load(await generarCartelPdf(png, 'sticker'));
    expect(imagenesDeLaPagina(pdf)).toEqual([
      { ancho: DIMENSIONES_CARTEL.sticker.px.ancho, alto: DIMENSIONES_CARTEL.sticker.px.alto },
    ]);
  });
});

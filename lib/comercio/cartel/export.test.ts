import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { PDFDocument, PDFDict, PDFName, PDFNumber, PDFStream } from 'pdf-lib';
import { construirCartelSvg } from './plantillas';
import { rasterizarCartelPng, generarCartelPdf } from './export';
import { DIMENSIONES_CARTEL } from './tipos';
import type { DatosCartel } from './tipos';

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
async function pngMagentaDataUri(lado = 120): Promise<string> {
  const png = await sharp({
    create: { width: lado, height: lado, channels: 4, background: { r: 255, g: 0, b: 255, alpha: 1 } },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

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

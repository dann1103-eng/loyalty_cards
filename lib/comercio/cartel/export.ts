import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { DIMENSIONES_CARTEL, type FormatoCartel } from './tipos';

// ⚠️ TRAMPA VERIFICADA (node_modules/sharp/lib/constructor.js:156): `density` es una opción de CARGA
// para vectores (default 72dpi) que `.resize()` NO ajusta. El <svg> que arma plantillas.ts ya trae
// width/height físicos en mm, así que sin fijar `density: 300` acá sharp lo rasteriza a 72dpi y el
// `.resize()` de abajo sería una AMPLIACIÓN CON PÉRDIDA de un raster chico, no una rasterización
// nítida (spec §5.2).
//
// Medido el 2026-07-31 con sharp 0.34.5 (librsvg 2.61.2), que es de donde salen estos números y no
// de una estimación: sin density el raster nativo del sticker es de 283x283 px (y el del mostrador
// 420x595) — cuatro veces menos que el destino; el PNG sale borroso y encima MÁS pesado (98 KB
// contra 58 KB, porque el difuminado comprime peor. El peso no delata el bug: crece). Con
// density:300 el raster nativo se va POR ENCIMA del destino (4921x4921 el sticker, 7283x10335 el
// mostrador) y el `.resize()` REDUCE, que es la dirección correcta. Ojo con esa cifra: el nativo no
// queda "cerca" del destino, porque libvips aplica la escala del density sobre un tamaño que
// librsvg ya resolvió desde los mm — el factor entra dos veces. No cuesta más igual (18-48 ms y
// ~110 MB de RSS por cartel, medido para los dos formatos): libvips re-renderiza el vector a la
// escala final en vez de resamplear un bitmap gigante.
//
// La prueba que atrapa la pérdida del density es "el PNG es NÍTIDO..." de export.test.ts; las que
// miden 1181x1181 NO pueden atraparla (el `.resize()` fuerza esa salida igual, venga de donde venga
// el raster) y por eso no alcanzan solas.
export async function rasterizarCartelPng(svg: string, formato: FormatoCartel): Promise<Buffer> {
  const dim = DIMENSIONES_CARTEL[formato];
  return sharp(Buffer.from(svg), { density: 300 })
    .resize(dim.px.ancho, dim.px.alto)
    .png()
    .toBuffer();
}

// Un PNG único embebido ocupando toda la página, del tamaño físico exacto en puntos — no texto
// vectorial con las fuentes de pdf-lib (que no traen la tipografía de marca). Así el PDF es
// pixel-idéntico a la vista previa y al PNG exportado (spec §5.3).
export async function generarCartelPdf(pngBuffer: Buffer, formato: FormatoCartel): Promise<Buffer> {
  const dim = DIMENSIONES_CARTEL[formato];
  const pdf = await PDFDocument.create();
  const pagina = pdf.addPage([dim.pt.ancho, dim.pt.alto]);
  const png = await pdf.embedPng(pngBuffer);
  pagina.drawImage(png, { x: 0, y: 0, width: dim.pt.ancho, height: dim.pt.alto });
  return Buffer.from(await pdf.save());
}

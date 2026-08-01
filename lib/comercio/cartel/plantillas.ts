import QRCode from 'qrcode';
import { DIMENSIONES_CARTEL, type DatosCartel, type FormatoCartel } from './tipos';

// Se escapan los 5 caracteres especiales de XML antes de interpolar CUALQUIER texto libre (nombre
// del comercio, CTA, teaser) dentro del SVG — mismo requisito que ya estableció el spec del reverso
// de la tarjeta (docs/superpowers/specs/2026-07-26-reverso-tarjeta-configurable-design.md §7.1) para
// HTML. Sin esto, un nombre con "&" rompe el XML entero (pantalla en blanco en la vista previa).
export function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// El QR SIEMPRE en negro puro sobre blanco puro, nunca con los colores de marca — decisión de
// escaneabilidad (spec §4.2), no un descuido. `qrcode.toString` es la API pública y asíncrona (no
// hay una variante síncrona soportada públicamente); no hace ningún fetch de red — solo dibuja la
// matriz del código ya calculada — así que seguimos llamando "pura respecto de I/O" a esta función
// aunque técnicamente sea `async`.
async function construirQrSvg(url: string, lado: number): Promise<string> {
  const svg = await QRCode.toString(url, {
    type: 'svg',
    margin: 0,
    color: { dark: '#000000', light: '#ffffff' },
  });
  // El SVG que devuelve `qrcode` trae su propio <svg viewBox="0 0 N N">; se ANIDA (svg-en-svg es
  // válido) con x/y=0 en un contenedor de tamaño fijo, en vez de convertirlo a PNG intermedio — se
  // queda vectorial hasta el rasterizado final (ver export.ts).
  return `<svg x="0" y="0" width="${lado}" height="${lado}">${svg}</svg>`;
}

// Tarjeta blanca detrás del QR (mejora el contraste de escaneo sobre cualquier color de fondo) más
// un margen proporcional al lado del QR. `qrSvg` debe haberse construido con el MISMO `lado`.
function tarjetaBlancaConQr(qrSvg: string, x: number, y: number, lado: number): string {
  const margen = lado * 0.12;
  const ladoTarjeta = lado + margen * 2;
  return [
    `<rect x="${x}" y="${y}" width="${ladoTarjeta}" height="${ladoTarjeta}" rx="${ladoTarjeta * 0.08}" fill="#ffffff"/>`,
    `<g transform="translate(${x + margen}, ${y + margen})">${qrSvg}</g>`,
  ].join('');
}

// Logo del comercio si existe; si no, un círculo con la inicial del nombre (spec §7: la plantilla no
// debe romperse por falta de logo).
function logoSvg(datos: DatosCartel, x: number, y: number, lado: number): string {
  if (datos.logoDataUri) {
    return `<image href="${datos.logoDataUri}" x="${x}" y="${y}" width="${lado}" height="${lado}" preserveAspectRatio="xMidYMid slice"/>`;
  }
  const inicial = escaparXml(datos.nombreComercio.trim().charAt(0).toUpperCase() || '?');
  return [
    `<circle cx="${x + lado / 2}" cy="${y + lado / 2}" r="${lado / 2}" fill="${datos.colorLabel}"/>`,
    `<text x="${x + lado / 2}" y="${y + lado / 2 + lado * 0.13}" text-anchor="middle" font-family="sans-serif" font-size="${lado * 0.55}" font-weight="700" fill="${datos.colorFondo}">${inicial}</text>`,
  ].join('');
}

async function plantillaCentrado(datos: DatosCartel, formato: FormatoCartel): Promise<string> {
  const dim = DIMENSIONES_CARTEL[formato];
  const w = dim.viewBox.ancho;
  const h = dim.viewBox.alto;
  const cx = w / 2;

  const logoLado = w * 0.18;
  const logoY = h * 0.1;
  const nombreY = logoY + logoLado + h * 0.045;
  const qrLado = w * 0.5;
  const qrX = cx - qrLado / 2;
  const qrY = nombreY + h * 0.06;
  const ctaY = qrY + qrLado * 1.24 + h * 0.05;
  const teaserY = ctaY + h * 0.045;

  const qrSvg = await construirQrSvg(datos.urlRegistro, qrLado);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim.mm.ancho}mm" height="${dim.mm.alto}mm" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${datos.colorFondo}"/>
  ${logoSvg(datos, cx - logoLado / 2, logoY, logoLado)}
  <text x="${cx}" y="${nombreY}" text-anchor="middle" font-family="sans-serif" font-size="${h * 0.032}" font-weight="700" fill="${datos.colorTexto}">${escaparXml(datos.nombreComercio)}</text>
  ${tarjetaBlancaConQr(qrSvg, qrX, qrY, qrLado)}
  <text x="${cx}" y="${ctaY}" text-anchor="middle" font-family="sans-serif" font-size="${h * 0.026}" font-weight="600" fill="${datos.colorLabel}">${escaparXml(datos.textoCta)}</text>
  ${datos.textoTeaser ? `<text x="${cx}" y="${teaserY}" text-anchor="middle" font-family="sans-serif" font-size="${h * 0.022}" fill="${datos.colorTexto}">${escaparXml(datos.textoTeaser)}</text>` : ''}
</svg>`;
}

async function plantillaSplit(datos: DatosCartel, formato: FormatoCartel): Promise<string> {
  const dim = DIMENSIONES_CARTEL[formato];
  const w = dim.viewBox.ancho;
  const h = dim.viewBox.alto;

  if (formato === 'mostrador') {
    const anchoFranja = w * 0.32;
    const logoLado = anchoFranja * 0.5;
    const qrLado = (w - anchoFranja) * 0.55;
    const qrX = anchoFranja + (w - anchoFranja - qrLado) / 2;
    const qrY = h / 2 - qrLado * 0.62;
    const qrSvg = await construirQrSvg(datos.urlRegistro, qrLado);
    const centroDerecha = anchoFranja + (w - anchoFranja) / 2;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim.mm.ancho}mm" height="${dim.mm.alto}mm" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#ffffff"/>
  <rect width="${anchoFranja}" height="${h}" fill="${datos.colorFondo}"/>
  ${logoSvg(datos, anchoFranja / 2 - logoLado / 2, h * 0.08, logoLado)}
  <text x="${anchoFranja / 2}" y="${h * 0.08 + logoLado + h * 0.04}" text-anchor="middle" font-family="sans-serif" font-size="${h * 0.028}" font-weight="700" fill="${datos.colorTexto}">${escaparXml(datos.nombreComercio)}</text>
  ${tarjetaBlancaConQr(qrSvg, qrX, qrY, qrLado)}
  <text x="${centroDerecha}" y="${qrY + qrLado * 1.24 + h * 0.05}" text-anchor="middle" font-family="sans-serif" font-size="${h * 0.024}" font-weight="600" fill="${datos.colorLabel}">${escaparXml(datos.textoCta)}</text>
  ${datos.textoTeaser ? `<text x="${centroDerecha}" y="${qrY + qrLado * 1.24 + h * 0.09}" text-anchor="middle" font-family="sans-serif" font-size="${h * 0.02}" fill="${datos.colorTexto}">${escaparXml(datos.textoTeaser)}</text>` : ''}
</svg>`;
  }

  // Sticker: franja arriba/abajo en vez de lateral — un cuadrado angosto no le deja aire a una
  // franja lateral (validado con el usuario en el companion de brainstorming).
  const altoFranja = h * 0.34;
  const logoLado = altoFranja * 0.42;
  const qrLado = w * 0.42;
  const qrX = w / 2 - qrLado / 2;
  const qrY = altoFranja + h * 0.08;
  const qrSvg = await construirQrSvg(datos.urlRegistro, qrLado);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim.mm.ancho}mm" height="${dim.mm.alto}mm" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#ffffff"/>
  <rect width="${w}" height="${altoFranja}" fill="${datos.colorFondo}"/>
  ${logoSvg(datos, w * 0.08, altoFranja / 2 - logoLado / 2, logoLado)}
  <text x="${w * 0.08 + logoLado + w * 0.04}" y="${altoFranja / 2 + logoLado * 0.13}" text-anchor="start" font-family="sans-serif" font-size="${h * 0.032}" font-weight="700" fill="${datos.colorTexto}">${escaparXml(datos.nombreComercio)}</text>
  ${tarjetaBlancaConQr(qrSvg, qrX, qrY, qrLado)}
  <text x="${w / 2}" y="${qrY + qrLado * 1.24 + h * 0.045}" text-anchor="middle" font-family="sans-serif" font-size="${h * 0.026}" font-weight="600" fill="${datos.colorLabel}">${escaparXml(datos.textoCta)}</text>
</svg>`;
}

async function plantillaFoto(datos: DatosCartel, formato: FormatoCartel): Promise<string> {
  const dim = DIMENSIONES_CARTEL[formato];
  const w = dim.viewBox.ancho;
  const h = dim.viewBox.alto;

  const logoLado = w * 0.14;
  const qrLado = w * 0.42;
  const tarjetaAncho = w * 0.8;
  const tarjetaAlto = qrLado * 1.5;
  const tarjetaX = (w - tarjetaAncho) / 2;
  const tarjetaY = h - tarjetaAlto - h * 0.06;
  const qrX = w / 2 - qrLado / 2;
  const qrY = tarjetaY + tarjetaAlto * 0.12;

  const qrSvg = await construirQrSvg(datos.urlRegistro, qrLado);

  // Sin fotoDataUri, cae a fondo sólido (spec §7: la UI no debería ofrecer esta plantilla sin
  // hero_url, pero el renderizador no confía en que la UI lo respete siempre).
  const fondo = datos.fotoDataUri
    ? `<image href="${datos.fotoDataUri}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/><rect width="${w}" height="${h}" fill="#000000" opacity="0.35"/>`
    : `<rect width="${w}" height="${h}" fill="${datos.colorFondo}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim.mm.ancho}mm" height="${dim.mm.alto}mm" viewBox="0 0 ${w} ${h}">
  ${fondo}
  ${logoSvg(datos, w * 0.06, h * 0.06, logoLado)}
  <rect x="${tarjetaX}" y="${tarjetaY}" width="${tarjetaAncho}" height="${tarjetaAlto}" rx="${tarjetaAncho * 0.04}" fill="#ffffff"/>
  <g transform="translate(${qrX}, ${qrY})">${qrSvg}</g>
  <text x="${w / 2}" y="${qrY + qrLado * 1.22}" text-anchor="middle" font-family="sans-serif" font-size="${h * 0.026}" font-weight="600" fill="#1c1917">${escaparXml(datos.textoCta)}</text>
</svg>`;
}

export async function construirCartelSvg(datos: DatosCartel, formato: FormatoCartel): Promise<string> {
  if (datos.plantilla === 'centrado') return plantillaCentrado(datos, formato);
  if (datos.plantilla === 'split') return plantillaSplit(datos, formato);
  if (datos.plantilla === 'foto') return plantillaFoto(datos, formato);
  throw new Error(`Plantilla "${String(datos.plantilla)}" desconocida.`);
}

export { plantillaCentrado, plantillaSplit, plantillaFoto, construirQrSvg, tarjetaBlancaConQr, logoSvg };

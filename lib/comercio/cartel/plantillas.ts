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

// El dispatcher completo se termina en la Tarea 7 (agrega 'split' y 'foto'); esta tarea lo deja
// andando SOLO para 'centrado' para poder probarlo de punta a punta ya mismo.
export async function construirCartelSvg(datos: DatosCartel, formato: FormatoCartel): Promise<string> {
  if (datos.plantilla === 'centrado') return plantillaCentrado(datos, formato);
  throw new Error(`Plantilla "${datos.plantilla}" todavía no implementada (Tarea 6/7 de este plan).`);
}

export { plantillaCentrado, construirQrSvg, tarjetaBlancaConQr, logoSvg };

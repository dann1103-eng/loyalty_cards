import sharp from 'sharp';
import { rgbAHex } from './colorHex';

// Los dos logos que Google Wallet dibuja en la cabecera de la tarjeta, compuestos a partir del logo
// que subió el comercio (spec 2026-09-23, §2 "Google Wallet").
//
// Por qué hace falta componerlos: Google dibuja el `programLogo` SIEMPRE dentro de un círculo (guías de
// marca de Google Wallet: PNG cuadrado ≥ 660×660, fondo a sangre, margen de seguridad; la máscara la
// pone Google). Hasta el 2026-09-23 le mandábamos la URL cruda del logo, que llega recortado al ras
// (redimensionarImagen.ts, al subirlo) y de ≤ 480 px: el círculo se comía los costados de un logo ancho
// y lo que quedaba se veía diminuto. El caso real fue "Pulso CAFÉ", un logo ~3:1 que en Android quedaba
// cortado.
//
// Las dos funciones LANZAN si sharp no puede con la imagen: quien llama (la ruta, servirLogoClase.ts)
// decide qué servir en ese caso, y lo que sirve es el logo original — nunca un error.

// El lado del cuadrado: el mínimo que piden las guías de Google.
export const LADO_LOGO_CUADRADO = 660;

// Qué fracción del lado ocupa el logo, centrado. 0.7 no es un número redondo elegido a ojo: un cuadrado
// del 70 % del lado es (casi exactamente, 1/√2 ≈ 0.707) el más grande que entra ENTERO en el círculo
// inscrito, así que ningún logo —ni uno cuadrado, que es el que llega a las esquinas— pierde un
// píxel con la máscara. Un logo ancho ocupa todo el ancho de esa área y queda más bajo.
export const FRACCION_AREA_SEGURA = 0.7;

// El logo ancho (`wideProgramLogo`): el tamaño que piden las guías de Google para ese campo.
export const ANCHO_LOGO_ANCHO = 1280;
export const ALTO_LOGO_ANCHO = 400;

// El fondo cuando el comercio no tiene color de tarjeta. En la práctica no pasa (el alta precarga
// `color_fondo`), pero la base no lo garantiza: sin CHECK, cualquier texto que no sea `rgb(...)` también
// cae acá — rgbAHex devuelve undefined — en vez de hacer que sharp lance por un color ilegible.
const FONDO_POR_DEFECTO = '#ffffff';

// El cuadrado del `programLogo`: 660×660 con el color de fondo de la tarjeta a sangre y el logo ENTERO
// (`fit: 'inside'`, sin deformar) en el área segura central. El fondo es el de la tarjeta para que el
// círculo se lea como parte de ella, igual que el logo del pass de Apple, que se dibuja sobre ese color.
//
// El logo SE AGRANDA si es más chico que el área segura (sin `withoutEnlargement`, a diferencia de
// imagenesPass.ts): acá el tamaño final lo fija Google, y un logo de 200 px flotando en el medio del
// círculo es justo el "diminuto" que se vino a arreglar.
export async function componerLogoCuadrado(logo: Buffer, colorFondo: string | null): Promise<Buffer> {
  const area = Math.round(LADO_LOGO_CUADRADO * FRACCION_AREA_SEGURA);
  const { data, info } = await sharp(logo)
    .resize({ width: area, height: area, fit: 'inside' })
    .png()
    .toBuffer({ resolveWithObject: true });
  return sharp({
    create: {
      width: LADO_LOGO_CUADRADO,
      height: LADO_LOGO_CUADRADO,
      channels: 4,
      background: rgbAHex(colorFondo) ?? FONDO_POR_DEFECTO,
    },
  })
    .composite([
      {
        input: data,
        left: Math.round((LADO_LOGO_CUADRADO - info.width) / 2),
        top: Math.round((LADO_LOGO_CUADRADO - info.height) / 2),
      },
    ])
    .png()
    .toBuffer();
}

// El `wideProgramLogo`: 1280×400 TRANSPARENTE, con el logo entero, pegado a la izquierda y centrado en
// alto. En Android reemplaza la cabecera por defecto (círculo + nombre del emisor) por el logo completo:
// para un logo que ya dice el nombre del negocio (Pulso) es justo lo que se quiere. Transparente para
// que se vea sobre el color de la tarjeta que pinta Google; a la izquierda porque ahí va la cabecera.
//
// Solo se manda para logos anchos (esLogoAncho, logosClase.ts): uno cuadrado quedaría como un sello
// chico en la esquina y le quitaría a la tarjeta el nombre del negocio que hoy muestra la cabecera.
export async function componerLogoAncho(logo: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(logo)
    .resize({ width: ANCHO_LOGO_ANCHO, height: ALTO_LOGO_ANCHO, fit: 'inside' })
    .png()
    .toBuffer({ resolveWithObject: true });
  return sharp({
    create: {
      width: ANCHO_LOGO_ANCHO,
      height: ALTO_LOGO_ANCHO,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: data, left: 0, top: Math.round((ALTO_LOGO_ANCHO - info.height) / 2) }])
    .png()
    .toBuffer();
}

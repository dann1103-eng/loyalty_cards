// El bloque "Disponible para" + los dos botones de Wallet (Apple y Google) que lleva todo cartel. Le
// dice al cliente, ANTES de escanear, que la tarjeta vive en la billetera de su teléfono y no en una
// app que tenga que bajar.
//
// No son las insignias oficiales de Apple ni de Google (esas se descargan de sus portales y no están
// en el repo): son botones propios, negros y con el nombre de cada billetera, dibujados con el mismo
// `DibujarTexto` que el resto del cartel — así el texto sale en contornos al imprimir (textoInter.ts)
// y nunca como cuadraditos.
//
// Toda la geometría se deriva de UN número (el ancho del bloque) para que cada plantilla solo tenga
// que decidir cuánto ancho le da, y pueda reservar el alto con `geometriaBloqueWallet` ANTES de
// dibujar lo que va arriba.
import type { DibujarTexto } from './texto';

export interface GeometriaBloqueWallet {
  ancho: number;
  anchoBoton: number;
  altoBoton: number;
  hueco: number;
  tamanoEtiqueta: number;
  tamanoTextoBoton: number;
  // Desde el borde superior del bloque hasta el borde superior de los botones.
  yBotones: number;
  // Alto TOTAL del bloque (etiqueta + aire + botones): lo que cada plantilla tiene que reservar.
  alto: number;
}

// Proporciones en unidades del ALTO del botón. El texto del botón va a 0.4 de ese alto: medido con
// Inter 600 (opentype, 2026-09-26), "Google Wallet" — el más largo de los dos — avanza 6.76 em, o sea
// 2.7 altos de botón. Con el ícono (0.56) y los tres respiros (0.28 + 0.2 + 0.28) el contenido pide
// 4.02 altos; el botón mide 4.2 para dejarle margen a la fuente del sistema de la vista previa, que
// puede ser un poco más ancha que Inter.
const ANCHO_BOTON = 4.2;
const HUECO = 0.25;
const ETIQUETA = 0.45;
const AIRE_ETIQUETA = 0.35;
const TEXTO_BOTON = 0.4;
const LADO_ICONO = 0.56;
const RESPIRO = 0.28;

export function geometriaBloqueWallet(ancho: number): GeometriaBloqueWallet {
  const altoBoton = ancho / (2 * ANCHO_BOTON + HUECO);
  const tamanoEtiqueta = altoBoton * ETIQUETA;
  const yBotones = tamanoEtiqueta + altoBoton * AIRE_ETIQUETA;
  return {
    ancho,
    anchoBoton: altoBoton * ANCHO_BOTON,
    altoBoton,
    hueco: altoBoton * HUECO,
    tamanoEtiqueta,
    tamanoTextoBoton: altoBoton * TEXTO_BOTON,
    yBotones,
    alto: yBotones + altoBoton,
  };
}

// El ícono de Apple Wallet: tarjetas de colores apiladas sobre un bolsillo gris, como el de la app.
// No es el logo de Apple (ese no se dibuja en un cartel de terceros): es la billetera.
function iconoApple(x: number, y: number, lado: number): string {
  const colores = ['#34aadc', '#ffcc00', '#4cd964', '#ff3b30'];
  const alto = lado * 0.32;
  const tarjetas = colores
    .map(
      (color, i) =>
        `<rect x="${x}" y="${y + i * lado * 0.13}" width="${lado}" height="${alto}" rx="${lado * 0.08}" fill="${color}"/>`,
    )
    .join('');
  // El bolsillo va gris AZULADO y no gris neutro: export.test.ts vigila la nitidez del PNG contando
  // grises neutros (el rastro del antialias), y una superficie gris sólida le suma ~1000 píxeles
  // que no son desenfoque. Mismo motivo que el filo blanco del botón.
  const bolsillo = `<rect x="${x}" y="${y + lado * 0.55}" width="${lado}" height="${lado * 0.45}" rx="${lado * 0.1}" fill="#c0c8d8"/>`;
  return tarjetas + bolsillo;
}

// La "G" de Google, los mismos trazados que ya usa app/_ui/BotonesWallet.tsx (viewBox 24×24),
// escalados al lado del ícono.
function iconoGoogle(x: number, y: number, lado: number): string {
  return (
    `<g transform="translate(${x}, ${y}) scale(${lado / 24})">` +
    `<path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.07 5.07 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>` +
    `<path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.85A10.99 10.99 0 0 0 12 23z"/>` +
    `<path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.85z"/>` +
    `<path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1a10.99 10.99 0 0 0-9.82 6.05l3.66 2.85C6.71 7.3 9.14 5.38 12 5.38z"/>` +
    `</g>`
  );
}

function boton(
  g: GeometriaBloqueWallet,
  x: number,
  y: number,
  texto: string,
  icono: (x: number, y: number, lado: number) => string,
  dibujarTexto: DibujarTexto,
): string {
  const h = g.altoBoton;
  const ladoIcono = h * LADO_ICONO;
  const xIcono = x + h * RESPIRO;
  // El texto se CENTRA en el espacio que queda a la derecha del ícono, en vez de arrancar en una X
  // fija: así no hace falta medir su ancho (la vista previa no puede — no tiene Inter cargada), y si
  // la fuente del navegador sale un poco más ancha, se reparte a los dos lados en vez de pegarse al
  // borde derecho.
  const inicioTexto = xIcono + ladoIcono + h * 0.2;
  const finTexto = x + g.anchoBoton - h * RESPIRO;
  return [
    // El filo blanco separa el botón negro de un cartel de fondo oscuro (sin él desaparece). Blanco
    // y no el gris #a6a6a6 de las insignias oficiales: un gris neutro sólido es justo lo que
    // export.test.ts cuenta como rastro de desenfoque para vigilar la nitidez del PNG, y le robaba
    // el margen a esa prueba.
    `<rect x="${x}" y="${y}" width="${g.anchoBoton}" height="${h}" rx="${h * 0.22}" fill="#000000" stroke="#ffffff" stroke-width="${h * 0.07}"/>`,
    icono(xIcono, y + (h - ladoIcono) / 2, ladoIcono),
    dibujarTexto({
      texto,
      x: (inicioTexto + finTexto) / 2,
      // Línea base: centro del botón más ~0.36 del cuerpo (la altura de mayúscula de Inter es 0.73 em).
      y: y + h / 2 + g.tamanoTextoBoton * 0.36,
      tamano: g.tamanoTextoBoton,
      peso: 600,
      anclaje: 'centro',
      color: '#ffffff',
    }),
  ].join('');
}

// `y` es el borde SUPERIOR del bloque (no una línea base) y `cx` su centro horizontal. El bloque
// ocupa exactamente `geometriaBloqueWallet(ancho).alto` hacia abajo.
export function dibujarBloqueWallet({
  cx,
  y,
  ancho,
  colorEtiqueta,
  dibujarTexto,
}: {
  cx: number;
  y: number;
  ancho: number;
  colorEtiqueta: string;
  dibujarTexto: DibujarTexto;
}): string {
  const g = geometriaBloqueWallet(ancho);
  const x = cx - ancho / 2;
  const yBotones = y + g.yBotones;
  return [
    dibujarTexto({
      texto: 'Disponible para',
      x: cx,
      // La línea base a 0.8 del cuerpo: la "p" de "para" baja un poco por debajo y cae dentro del
      // aire que hay antes de los botones.
      y: y + g.tamanoEtiqueta * 0.8,
      tamano: g.tamanoEtiqueta,
      peso: 400,
      anclaje: 'centro',
      color: colorEtiqueta,
    }),
    boton(g, x, yBotones, 'Apple Wallet', iconoApple, dibujarTexto),
    boton(g, x + g.anchoBoton + g.hueco, yBotones, 'Google Wallet', iconoGoogle, dibujarTexto),
  ].join('');
}

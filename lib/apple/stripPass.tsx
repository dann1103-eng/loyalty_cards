import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import { stopsDifuminado } from './difuminadoFranja';
import { comprimirPng } from './imagenesPass';
import { colocarFoto, MARCO_FRANJA, type Encuadre, type Medidas } from '@/lib/comercio/encuadreFranja';
import type { Franja } from '@/lib/tarjetas/frentePase';

// Composición de la FRANJA (strip) del pass con next/og — el "pipeline de composición de
// imágenes" que la Fase 3 no tenía: llegó gratis con los íconos del portal (PWA). Tres casos:
//   1. El comercio subió su franja (strip_url) → esa imagen, ENCAJADA COMPLETA en el marco, con el
//      color de la tarjeta rellenando lo que sobre (ver franjaPropia).
//   2. Tarjeta de sellos con meta → grilla de círculos llenos/vacíos en los colores del comercio.
//   3. Cualquier otro caso → banda de marca sutil (color de fondo + resplandor del color label).
// SIEMPRE best-effort: cualquier fallo devuelve null y el pass sale sin franja (nunca se rompe
// la emisión del pass por una imagen).

export interface DatosStrip {
  tipoTarjeta: string;
  puntos: number;
  selloMeta: number | null;
  colorFondo: string;
  colorLabel: string;
  stripUrl: string | null;
  // Ícono del sello subido por el comercio (sello_icono_url): a todo color en los sellos LLENOS,
  // apagado (translúcido) en los VACÍOS — como las tarjetas de sellos físicas. Si no hay ícono
  // (o su descarga falla), se usa el estilo de círculos de siempre.
  selloIconoUrl: string | null;
  // Foto de fondo de la franja (hero_url): la grilla/banda se compone ENCIMA con un oscurecido
  // para que sellos y número sigan legibles. Sin foto, el fondo es el color del pass.
  heroUrl: string | null;
  // Cuánto se funde esa foto hacia el color de la tarjeta en los bordes (comercios.difuminado_franja,
  // migración 0007). Ver stopsDifuminado(): 'ninguno' = corte seco, sin gradiente.
  difuminadoFranja: string;
  // Qué parte de la foto se ve dentro del marco (migración 0032, lib/comercio/encuadreFranja.ts).
  // Con el default es el cover centrado de siempre.
  encuadreFranja: Encuadre;
  // Si la app va a ESCRIBIR algo sobre la franja (el nombre del pase). Decide el velo oscuro sobre la
  // foto: existe para que ese texto se lea, y sin texto solo apaga la foto del comercio (lo reportó
  // Daniel el 2026-09-17 con su membresía, que no lleva nada encima). La grilla de sellos lleva velo
  // SIEMPRE, sin mirar esto: los círculos son lo que tiene que resaltar.
  hayTextoEncima: boolean;
}

// La foto ya bajada, con sus medidas. Sin medidas (sharp no pudo leerla) la capa cae al cover
// centrado de siempre: el encuadre es best-effort como todo lo demás de la franja.
interface FotoFondo {
  dataUrl: string;
  medidas: Medidas | null;
}

export interface StripsPass {
  s1: Buffer; // 375×123 (@1x)
  s2: Buffer; // 750×246 (@2x)
  s3: Buffer; // 1125×369 (@3x)
  // QUÉ se dibujó, decidido donde se decide de verdad. El llamador no puede deducirlo de `stripUrl`:
  // si la franja del comercio no baja, acá sale la grilla o la banda, y `frentePase` tiene que
  // saberlo para volver a escribir el nombre del pase encima (ver generatePass).
  franja: Franja;
}

// Un nodo del árbol que satori dibuja (next/og acepta este objeto plano en vez de JSX). El tipo es
// laxo a propósito: acá se arman estilos que TypeScript no puede tipar contra CSSProperties.
type Nodo = { type: string; key?: string; props: Record<string, unknown> };

// Capa de fondo compartida: foto (si hay) + velo oscuro para contraste + DIFUMINADO en los
// bordes hacia el color del pass — la foto se funde con la tarjeta en vez de cortarse seca
// (referencia del usuario: así lo hace la competencia). Sin foto no hace falta nada.
function capasDeFondo(datos: DatosStrip, escala: number, foto: FotoFondo | null, conVelo: boolean) {
  if (!foto) return [];
  const marco = { ancho: MARCO_FRANJA.ancho * escala, alto: MARCO_FRANJA.alto * escala };
  // Con medidas, la foto va posicionada en absoluto por colocarFoto (la MISMA función que usa la
  // vista previa del editor): en modo 'completa' lo que sobra queda del color de la tarjeta, que ya
  // es el fondo del contenedor, y el difuminado lo funde. Sin medidas, el cover de siempre.
  const colocacion = foto.medidas ? colocarFoto(foto.medidas, marco, datos.encuadreFranja) : null;
  const capaLlena = { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' };
  const capas: Nodo[] = [
    {
      type: 'img',
      // satori no entiende objectPosition ni transform: la única forma de encuadrar es dar la caja
      // ya calculada en números (top/left/width/height) sobre el contenedor relativo.
      props: colocacion
        ? {
            src: foto.dataUrl,
            width: colocacion.ancho,
            height: colocacion.alto,
            style: { position: 'absolute', top: colocacion.top, left: colocacion.left },
          }
        : {
            src: foto.dataUrl,
            width: marco.ancho,
            height: marco.alto,
            style: { position: 'absolute', top: 0, left: 0, objectFit: 'cover' },
          },
    },
  ];

  // El velo, solo cuando hay algo escrito encima que tiene que leerse.
  if (conVelo) {
    capas.push({
      type: 'div',
      props: { style: { ...capaLlena, background: 'rgba(0, 0, 0, 0.45)' } },
    });
  }

  // Difuminado configurable por el dueño (nivel elegido en /comercio/branding). 'ninguno' →
  // stopsDifuminado devuelve null → la foto queda con corte seco (sin las dos capas de abajo).
  const stops = stopsDifuminado(datos.difuminadoFranja);
  if (stops) {
    capas.push(
      {
        type: 'div',
        props: {
          style: {
            ...capaLlena,
            background: `linear-gradient(180deg, ${datos.colorFondo} 0%, rgba(0,0,0,0) ${stops.v[0]}%, rgba(0,0,0,0) ${stops.v[1]}%, ${datos.colorFondo} 100%)`,
          },
        },
      },
      {
        type: 'div',
        props: {
          style: {
            ...capaLlena,
            background: `linear-gradient(90deg, ${datos.colorFondo} 0%, rgba(0,0,0,0) ${stops.h[0]}%, rgba(0,0,0,0) ${stops.h[1]}%, ${datos.colorFondo} 100%)`,
          },
        },
      },
    );
  }

  return capas;
}

function grillaSellos(datos: DatosStrip, escala: number, iconoDataUrl: string | null, foto: FotoFondo | null) {
  const meta = datos.selloMeta ?? 10;
  const llenos = Math.min(datos.puntos, meta);
  // Con más de 6 sellos se parte en 2 filas: círculos más grandes y legibles que una sola fila
  // apretada, y menos ancho total expuesto al recorte.
  const filas = meta > 6 ? 2 : 1;
  const porFila = Math.ceil(meta / filas);
  // ZONA SEGURA: Wallet escala la franja al ancho del dispositivo con recorte (aspect-fill), y
  // cuánto corta varía por modelo — visto en iPhone real: círculos de las puntas partidos a la
  // mitad. Los sellos se confinan al centro con márgenes anchos (56pt por lado, ~30% total) para
  // sobrevivir cualquier recorte razonable.
  const margenLateral = 56;
  const gap = 8;
  // Topes de diámetro: el sello se ve lo más grande posible sin desbordar. Se subieron de 40/34 a
  // 52/44 cuando el ícono pasó a ir suelto (sin círculo): dentro del círculo, 34 alcanzaba porque
  // el aro daba presencia; suelto, el ícono a 34 se veía diminuto en el teléfono. El alto también
  // manda: dos filas de 44 + 7 de gap = 95 sobre los 123 de la franja, con aire arriba y abajo. El
  // Math.min con el ancho disponible sigue siendo el que decide cuando hay muchos sellos por fila.
  const diametro =
    Math.min(filas === 1 ? 52 : 44, Math.floor((375 - margenLateral * 2 - (porFila - 1) * gap) / porFila)) * escala;
  const sellos = Array.from({ length: meta }, (_, i) => i);

  const filasDeSellos = {
    type: 'div',
    props: {
      style: {
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7 * escala,
      },
      children: Array.from({ length: filas }, (_, f) => ({
        type: 'div',
        key: `fila-${f}`,
        props: {
          style: { display: 'flex', gap: 8 * escala },
          children: sellos.slice(f * porFila, (f + 1) * porFila).map((i) => ({
            type: 'div',
            key: `sello-${i}`,
            props: {
              style: {
                width: diametro,
                height: diametro,
                borderRadius: 9999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                // CON ícono propio: nada de fondo ni borde — el sello ES el ícono, sobre la franja.
                // Antes el ícono iba DENTRO de un círculo relleno con colorLabel y a solo 62% de su
                // diámetro: se veía diminuto y el color del círculo tapaba el diseño del comercio
                // (reportado en producción el 2026-07-26, con la decisión de dejar el ícono suelto).
                // SIN ícono: el aro y el punto de siempre, que son los que dan la forma del sello.
                ...(iconoDataUrl
                  ? {}
                  : {
                      background: i < llenos ? datos.colorLabel : 'rgba(255, 255, 255, 0.07)',
                      border: `${2 * escala}px solid ${i < llenos ? datos.colorLabel : 'rgba(255, 255, 255, 0.35)'}`,
                    }),
              },
              // Con ícono del comercio: a todo color en los llenos, APAGADO (translúcido) en los
              // vacíos — como tacharlo pendiente en una tarjeta física (referencia del usuario).
              // Sin ícono: el punto interior en llenos y el aro vacío de siempre.
              children: iconoDataUrl
                ? [
                    {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          opacity: i < llenos ? 1 : 0.32,
                        },
                        children: [{
                          type: 'img',
                          props: {
                            src: iconoDataUrl,
                            // El ícono ocupa TODO el sello (antes 0.62, encogido dentro del círculo
                            // que ya no está). Sin recuadro alrededor, el gap entre sellos alcanza
                            // para separarlos.
                            width: diametro,
                            height: diametro,
                            // objectFit contain o el ícono se DEFORMA: width/height son una caja
                            // cuadrada y casi ningún logo lo es — se veía estirado en vertical en el
                            // pass real mientras la vista previa (que sí lo tenía) se veía bien.
                            style: { objectFit: 'contain' },
                          },
                        }],
                      },
                    },
                  ]
                : i < llenos
                  ? [{
                      type: 'div',
                      props: {
                        style: {
                          width: Math.round(diametro * 0.3),
                          height: Math.round(diametro * 0.3),
                          borderRadius: 9999,
                          background: datos.colorFondo,
                        },
                      },
                    }]
                  : [],
            },
          })),
        },
      })),
    },
  };

  return {
    type: 'div',
    props: {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        background: datos.colorFondo,
      },
      children: [...capasDeFondo(datos, escala, foto, true), filasDeSellos],
    },
  };
}

// La franja que subió el comercio, ENCAJADA COMPLETA dentro del espacio de Wallet (375×123), con
// el color de la tarjeta rellenando lo que sobre.
//
// Hasta el 2026-09-17 esos bytes se mandaban tal cual y Wallet los recortaba para llenar su marco:
// una franja más alta que 375×123 perdía los costados, y el dueño de M&M Inversiones vio su propio
// nombre cortado a la mitad ("M&M INVERSIONE") en su iPhone. Se encaja con `colocarFoto` en modo
// 'completa' —la MISMA función del encuadre de la foto y de la vista previa del editor— así que lo
// que se ve acá es lo que el dueño ve al diseñar.
//
// Sin velo, sin difuminado y sin resplandores: la imagen del comercio ES el diseño (los tres
// modelos de la portada traen su texto dibujado adentro), y oscurecerla sería pisarla.
function franjaPropia(datos: DatosStrip, escala: number, franja: FotoFondo) {
  const marco = { ancho: MARCO_FRANJA.ancho * escala, alto: MARCO_FRANJA.alto * escala };
  const colocacion = franja.medidas
    ? colocarFoto(franja.medidas, marco, { modo: 'completa', focoX: 50, focoY: 50, zoom: 100 })
    : null;
  return {
    type: 'div',
    props: {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        background: datos.colorFondo,
      },
      children: [
        {
          type: 'img',
          // satori no entiende objectFit: 'contain', así que la caja va calculada en números. Sin
          // medidas (sharp no pudo leer la imagen) se cae al comportamiento de antes: llenar y que
          // Wallet recorte, que es peor que esto pero mejor que una franja vacía.
          props: colocacion
            ? {
                src: franja.dataUrl,
                width: Math.round(colocacion.ancho),
                height: Math.round(colocacion.alto),
                style: { position: 'absolute', top: Math.round(colocacion.top), left: Math.round(colocacion.left) },
              }
            : {
                src: franja.dataUrl,
                width: marco.ancho,
                height: marco.alto,
                style: { position: 'absolute', top: 0, left: 0, objectFit: 'cover' },
              },
        },
      ],
    },
  };
}

function bandaMarca(datos: DatosStrip, escala: number, foto: FotoFondo | null) {
  return {
    type: 'div',
    props: {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        background: datos.colorFondo,
        position: 'relative',
      },
      children: [
        ...capasDeFondo(datos, escala, foto, datos.hayTextoEncima),
        // Resplandor suave del color de etiqueta hacia la derecha: da textura sin pelear con el
        // número de puntos que Wallet superpone en esta zona.
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute',
              right: -60 * escala,
              top: -40 * escala,
              width: 260 * escala,
              height: 260 * escala,
              borderRadius: 9999,
              background: datos.colorLabel,
              opacity: 0.14,
            },
          },
        },
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute',
              right: 40 * escala,
              bottom: -80 * escala,
              width: 160 * escala,
              height: 160 * escala,
              borderRadius: 9999,
              background: datos.colorLabel,
              opacity: 0.08,
            },
          },
        },
      ],
    },
  };
}

// QUÉ se dibuja, en un solo lugar: la franja propia MANDA sobre todo lo demás, incluida la grilla
// de sellos (es lo que espera el dueño que se tomó el trabajo de diseñarla), pero solo si de verdad
// bajó. Con `franja` en null el pase vuelve a su diseño de siempre.
function queFranja(datos: DatosStrip, franja: FotoFondo | null): Franja {
  if (franja) return 'propia';
  const esSellos = datos.tipoTarjeta === 'sellos' && datos.selloMeta != null && datos.selloMeta > 0;
  return esSellos ? 'grilla' : 'banda';
}

async function renderizar(
  datos: DatosStrip,
  escala: number,
  iconoDataUrl: string | null,
  foto: FotoFondo | null,
  franja: FotoFondo | null,
): Promise<Buffer> {
  const jsx =
    queFranja(datos, franja) === 'propia'
      ? franjaPropia(datos, escala, franja!)
      : queFranja(datos, franja) === 'grilla'
        ? grillaSellos(datos, escala, iconoDataUrl, foto)
        : bandaMarca(datos, escala, foto);
  const img = new ImageResponse(jsx as React.ReactElement, { width: 375 * escala, height: 123 * escala });
  // next/og escupe PNG de 24 bits sin cuantizar: con una foto de fondo, las tres franjas sumaban
  // 661 KB medidos (49 + 176 + 435). Cuantizar a paleta las deja en 145 KB sin que se note — se
  // comparó cada franja ampliada al triple contra la original antes de elegir la calidad (ver
  // comprimirPng). Va acá y no en componerStrips para que ninguna franja nueva se saltee el paso.
  return comprimirPng(Buffer.from(await img.arrayBuffer()));
}

// Baja una imagen del comercio (best-effort: null si falla — una imagen caída nunca debe romper
// la emisión del pass). Exportada porque generatePass también la usa para el logo.
export async function descargarImagen(
  url: string | null,
  proposito: string,
): Promise<{ buf: Buffer; tipo: string } | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${proposito} respondió ${res.status}`);
    const tipo = res.headers.get('content-type') ?? 'image/png';
    return { buf: Buffer.from(await res.arrayBuffer()), tipo };
  } catch (error) {
    console.warn(`[apple] no se pudo bajar ${proposito}; se sigue sin esa imagen:`, error);
    return null;
  }
}

function comoDataUrl(img: { buf: Buffer; tipo: string } | null): string | null {
  return img ? `data:${img.tipo};base64,${img.buf.toString('base64')}` : null;
}

// Mide la foto para el encuadre. Best-effort: sin medidas la franja sale con el cover de siempre.
async function medir(buf: Buffer): Promise<Medidas | null> {
  try {
    const { width, height } = await sharp(buf).metadata();
    return width && height ? { ancho: width, alto: height } : null;
  } catch (error) {
    console.warn('[apple] no se pudo medir la foto de fondo; va sin encuadre:', error);
    return null;
  }
}

// Baja el ícono y la foto UNA vez y mide la foto UNA vez: componerStrips renderiza tres escalas con
// lo mismo, y la ruta de portada de clase una sola.
async function bajarInsumos(
  datos: DatosStrip,
): Promise<{ iconoUrl: string | null; foto: FotoFondo | null; franja: FotoFondo | null }> {
  const [icono, hero, propia] = await Promise.all([
    descargarImagen(datos.selloIconoUrl, 'el ícono del sello'),
    descargarImagen(datos.heroUrl, 'la foto de fondo de la franja'),
    descargarImagen(datos.stripUrl, 'la franja del comercio'),
  ]);
  const foto = hero ? { dataUrl: comoDataUrl(hero)!, medidas: await medir(hero.buf) } : null;
  // Si la franja propia no bajó, `franja` queda null y se compone la grilla o la banda: el comercio
  // ve su diseño de siempre en vez de un pase sin franja.
  const franja = propia ? { dataUrl: comoDataUrl(propia)!, medidas: await medir(propia.buf) } : null;
  return { iconoUrl: comoDataUrl(icono), foto, franja };
}

// UNA escala. Para la portada de la clase de Google (app/api/comercios/[comercioId]/franja.png), que
// está en el camino crítico de la creación de la clase y no tiene por qué renderizar tres tamaños
// para servir uno. Respeta stripUrl igual que componerStrips (la ruta lo manda en null a propósito).
export async function componerFranja(datos: DatosStrip, escala: 1 | 2 | 3): Promise<Buffer | null> {
  try {
    const { iconoUrl, foto, franja } = await bajarInsumos(datos);
    return await renderizar(datos, escala, iconoUrl, foto, franja);
  } catch (error) {
    console.warn('[apple] no se pudo componer la franja de una escala:', error);
    return null;
  }
}

export async function componerStrips(datos: DatosStrip): Promise<StripsPass | null> {
  try {
    // Los insumos se bajan y se miden UNA vez para las tres escalas (no tres llamadas a
    // componerFranja: eso bajaría y mediría la foto tres veces).
    const { iconoUrl, foto, franja } = await bajarInsumos(datos);
    const [s1, s2, s3] = await Promise.all([1, 2, 3].map((e) => renderizar(datos, e, iconoUrl, foto, franja)));
    return { s1, s2, s3, franja: queFranja(datos, franja) };
  } catch (error) {
    console.warn('[apple] no se pudo componer la franja; el pass sale sin strip:', error);
    return null;
  }
}

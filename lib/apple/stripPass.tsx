import { ImageResponse } from 'next/og';

// Composición de la FRANJA (strip) del pass con next/og — el "pipeline de composición de
// imágenes" que la Fase 3 no tenía: llegó gratis con los íconos del portal (PWA). Tres casos:
//   1. El comercio subió su franja (strip_url) → se usa esa imagen tal cual.
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
}

export interface StripsPass {
  s1: Buffer; // 375×123 (@1x)
  s2: Buffer; // 750×246 (@2x)
  s3: Buffer; // 1125×369 (@3x)
}

// Capa de fondo compartida: foto (si hay) + velo oscuro para contraste + DIFUMINADO en los
// bordes hacia el color del pass — la foto se funde con la tarjeta en vez de cortarse seca
// (referencia del usuario: así lo hace la competencia). Sin foto no hace falta nada.
function capasDeFondo(datos: DatosStrip, escala: number, heroDataUrl: string | null) {
  if (!heroDataUrl) return [];
  const capaLlena = { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' };
  return [
    {
      type: 'img',
      props: {
        src: heroDataUrl,
        width: 375 * escala,
        height: 123 * escala,
        style: { position: 'absolute', top: 0, left: 0, objectFit: 'cover' },
      },
    },
    {
      type: 'div',
      props: { style: { ...capaLlena, background: 'rgba(0, 0, 0, 0.45)' } },
    },
    // Difuminado vertical (arriba/abajo) y horizontal (izquierda/derecha) hacia el fondo del pass.
    {
      type: 'div',
      props: {
        style: {
          ...capaLlena,
          background: `linear-gradient(180deg, ${datos.colorFondo} 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 78%, ${datos.colorFondo} 100%)`,
        },
      },
    },
    {
      type: 'div',
      props: {
        style: {
          ...capaLlena,
          background: `linear-gradient(90deg, ${datos.colorFondo} 0%, rgba(0,0,0,0) 14%, rgba(0,0,0,0) 86%, ${datos.colorFondo} 100%)`,
        },
      },
    },
  ];
}

function grillaSellos(datos: DatosStrip, escala: number, iconoDataUrl: string | null, heroDataUrl: string | null) {
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
  const diametro =
    Math.min(filas === 1 ? 40 : 34, Math.floor((375 - margenLateral * 2 - (porFila - 1) * gap) / porFila)) * escala;
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
                background:
                  i < llenos
                    ? datos.colorLabel
                    : iconoDataUrl
                      ? 'rgba(255, 255, 255, 0.06)'
                      : 'rgba(255, 255, 255, 0.07)',
                border: iconoDataUrl && i >= llenos
                  ? `${escala}px solid rgba(255, 255, 255, 0.14)`
                  : `${2 * escala}px solid ${i < llenos ? datos.colorLabel : 'rgba(255, 255, 255, 0.35)'}`,
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
                            width: Math.round(diametro * 0.62),
                            height: Math.round(diametro * 0.62),
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
      children: [...capasDeFondo(datos, escala, heroDataUrl), filasDeSellos],
    },
  };
}

function bandaMarca(datos: DatosStrip, escala: number, heroDataUrl: string | null) {
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
        ...capasDeFondo(datos, escala, heroDataUrl),
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

async function renderizar(
  datos: DatosStrip,
  escala: number,
  iconoDataUrl: string | null,
  heroDataUrl: string | null,
): Promise<Buffer> {
  const esSellos = datos.tipoTarjeta === 'sellos' && datos.selloMeta != null && datos.selloMeta > 0;
  const jsx = esSellos
    ? grillaSellos(datos, escala, iconoDataUrl, heroDataUrl)
    : bandaMarca(datos, escala, heroDataUrl);
  const img = new ImageResponse(jsx as React.ReactElement, { width: 375 * escala, height: 123 * escala });
  return Buffer.from(await img.arrayBuffer());
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

export async function componerStrips(datos: DatosStrip): Promise<StripsPass | null> {
  try {
    if (datos.stripUrl) {
      // La franja del comercio se usa tal cual en los tres tamaños (Wallet la escala/recorta).
      const res = await fetch(datos.stripUrl);
      if (!res.ok) throw new Error(`strip del comercio respondió ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return { s1: buf, s2: buf, s3: buf };
    }
    const [icono, hero] = await Promise.all([
      descargarImagen(datos.selloIconoUrl, 'el ícono del sello'),
      descargarImagen(datos.heroUrl, 'la foto de fondo de la franja'),
    ]);
    const iconoUrl = comoDataUrl(icono);
    const heroDataUrl = comoDataUrl(hero);
    const [s1, s2, s3] = await Promise.all([1, 2, 3].map((e) => renderizar(datos, e, iconoUrl, heroDataUrl)));
    return { s1, s2, s3 };
  } catch (error) {
    console.warn('[apple] no se pudo componer la franja; el pass sale sin strip:', error);
    return null;
  }
}

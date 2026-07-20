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
}

export interface StripsPass {
  s1: Buffer; // 375×123 (@1x)
  s2: Buffer; // 750×246 (@2x)
  s3: Buffer; // 1125×369 (@3x)
}

function grillaSellos(datos: DatosStrip, escala: number) {
  const meta = datos.selloMeta ?? 10;
  const llenos = Math.min(datos.puntos, meta);
  const filas = meta > 10 ? 2 : 1;
  const porFila = Math.ceil(meta / filas);
  // El círculo se achica para que la fila más larga siempre quepa en 375pt de ancho.
  const diametro = Math.min(filas === 1 ? 52 : 40, Math.floor((375 - 32 - (porFila - 1) * 10) / porFila)) * escala;
  const sellos = Array.from({ length: meta }, (_, i) => i);

  return {
    type: 'div',
    props: {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8 * escala,
        background: datos.colorFondo,
      },
      children: Array.from({ length: filas }, (_, f) => ({
        type: 'div',
        key: `fila-${f}`,
        props: {
          style: { display: 'flex', gap: 10 * escala },
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
                background: i < llenos ? datos.colorLabel : 'rgba(255, 255, 255, 0.07)',
                border: `${2 * escala}px solid ${i < llenos ? datos.colorLabel : 'rgba(255, 255, 255, 0.35)'}`,
              },
              // Punto interior del color del fondo en los llenos: lectura de "sello marcado"
              // sin depender de íconos (satori no trae fuentes de íconos).
              children:
                i < llenos
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
}

function bandaMarca(datos: DatosStrip, escala: number) {
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

async function renderizar(datos: DatosStrip, escala: number): Promise<Buffer> {
  const esSellos = datos.tipoTarjeta === 'sellos' && datos.selloMeta != null && datos.selloMeta > 0;
  const jsx = esSellos ? grillaSellos(datos, escala) : bandaMarca(datos, escala);
  const img = new ImageResponse(jsx as React.ReactElement, { width: 375 * escala, height: 123 * escala });
  return Buffer.from(await img.arrayBuffer());
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
    const [s1, s2, s3] = await Promise.all([1, 2, 3].map((e) => renderizar(datos, e)));
    return { s1, s2, s3 };
  } catch (error) {
    console.warn('[apple] no se pudo componer la franja; el pass sale sin strip:', error);
    return null;
  }
}

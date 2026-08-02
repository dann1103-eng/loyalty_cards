import { describe, expect, it } from 'vitest';
import { construirCartelSvg as construirCartelSvgCon, escaparXml } from './plantillas';
import { dibujarTextoConFuenteDelSistema } from './texto';
import { dibujarTextoConInter } from './textoInter';
import type { DatosCartel, FormatoCartel } from './tipos';

// Este archivo mira la ESTRUCTURA del SVG (lienzo, franjas, QR, logo, escapado), que es la misma con
// cualquiera de los dos dibujantes de texto. Usa el de la vista previa porque deja el texto legible
// en el markup y las aserciones dicen lo que quieren decir; el dibujante de contornos —el que corre
// en producción— lo cubren export.test.ts (contando píxeles) y el último bloque de este archivo.
const construirCartelSvg = (datos: DatosCartel, formato: FormatoCartel) =>
  construirCartelSvgCon(datos, formato, dibujarTextoConFuenteDelSistema);

const DATOS_BASE: DatosCartel = {
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
  elementos: [],
};

describe('escaparXml', () => {
  it('escapa los 5 caracteres especiales de XML', () => {
    expect(escaparXml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &apos;');
  });

  it('un nombre con & no rompe el SVG resultante', async () => {
    const datos: DatosCartel = { ...DATOS_BASE, nombreComercio: 'Café & Té' };
    const svg = await construirCartelSvg(datos, 'sticker');
    expect(svg).toContain('Café &amp; Té');
    expect(svg).not.toContain('Café & Té');
  });
});

describe('construirCartelSvg — plantilla centrado', () => {
  it('produce un <svg> bien formado con el viewBox del formato pedido', async () => {
    const svg = await construirCartelSvg(DATOS_BASE, 'sticker');
    expect(svg.trim().startsWith('<svg')).toBe(true);
    expect(svg.trim().endsWith('</svg>')).toBe(true);
    expect(svg).toContain('viewBox="0 0 400 400"');
  });

  it('usa el viewBox alto del formato mostrador (proporción A5)', async () => {
    const svg = await construirCartelSvg(DATOS_BASE, 'mostrador');
    expect(svg).toContain('viewBox="0 0 400 567.57"');
  });

  it('incluye el color de fondo elegido', async () => {
    const svg = await construirCartelSvg(DATOS_BASE, 'sticker');
    expect(svg).toContain('#3b2a1e');
    // El `toContain` suelto de arriba NO protege el fondo: colorFondo es además el `fill` de la
    // inicial que dibuja logoSvg, así que sigue verde aunque el <rect> de fondo quede en #ffffff
    // (mutación corrida y confirmada). Se ancla al rect de fondo, que es lo que la prueba promete.
    expect(svg).toContain('<rect width="400" height="400" fill="#3b2a1e"/>');
  });

  it('incluye el nombre del comercio', async () => {
    const svg = await construirCartelSvg(DATOS_BASE, 'sticker');
    expect(svg).toContain('Café Sol');
  });

  it('incluye el texto del CTA', async () => {
    const svg = await construirCartelSvg(DATOS_BASE, 'sticker');
    expect(svg).toContain('¡Escaneá y sumate!');
  });

  it('sin teaser, no agrega un segundo <text> de teaser', async () => {
    const svg = await construirCartelSvg(DATOS_BASE, 'sticker');
    const conTeaser = await construirCartelSvg({ ...DATOS_BASE, textoTeaser: 'Tu 5to café gratis' }, 'sticker');
    expect(svg).not.toContain('Tu 5to café gratis');
    expect(conTeaser).toContain('Tu 5to café gratis');
  });

  it('sin logo, dibuja un círculo con la inicial del nombre (no revienta)', async () => {
    const svg = await construirCartelSvg(DATOS_BASE, 'sticker');
    expect(svg).toContain('<circle');
    expect(svg).toContain('>C<');
  });

  it('con logo, dibuja una <image> con el data URI en vez del círculo', async () => {
    const datos: DatosCartel = { ...DATOS_BASE, logoDataUri: 'data:image/png;base64,AAAA' };
    const svg = await construirCartelSvg(datos, 'sticker');
    expect(svg).toContain('<image href="data:image/png;base64,AAAA"');
    // "en vez del círculo": si el mutante dibujara los dos, el data URI seguiría estando y la
    // aserción de arriba sobreviviría — sin esto la prueba no protege lo que su nombre promete.
    expect(svg).not.toContain('<circle');
  });

  it('embebe el QR de la URL de registro como SVG anidado, no como <img>/data URI', async () => {
    const svg = await construirCartelSvg(DATOS_BASE, 'sticker');
    // El SVG que arma `qrcode` trae su propio xmlns — si aparece dos veces, el QR quedó anidado.
    expect(svg.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g)?.length).toBe(2);
  });
});

describe('construirCartelSvg — plantilla split', () => {
  const datos: DatosCartel = { ...DATOS_BASE, plantilla: 'split' };

  it('en mostrador, la franja de color es LATERAL (ancho de franja < alto del viewBox)', async () => {
    const svg = await construirCartelSvg(datos, 'mostrador');
    // La franja lateral es el primer <rect> de color de marca (no #ffffff) con height=viewBox alto.
    expect(svg).toMatch(/<rect width="\d+(\.\d+)?" height="567\.57" fill="#3b2a1e"/);
    // Lo de arriba también matchearía una franja de ancho completo (`width="400"`), que ya no sería
    // lateral: sin esta segunda aserción la prueba no protege lo que su nombre promete (mutación
    // corrida y confirmada).
    expect(svg).not.toMatch(/<rect width="400" height="567\.57" fill="#3b2a1e"/);
  });

  it('en sticker, la franja de color es SUPERIOR (ancho de franja == viewBox ancho)', async () => {
    const svg = await construirCartelSvg(datos, 'sticker');
    expect(svg).toMatch(/<rect width="400" height="\d+(\.\d+)?" fill="#3b2a1e"/);
  });

  it('produce SVG válido y con el QR embebido en los dos formatos', async () => {
    for (const formato of ['sticker', 'mostrador'] as const) {
      const svg = await construirCartelSvg(datos, formato);
      expect(svg.trim().startsWith('<svg')).toBe(true);
      expect(svg.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g)?.length).toBe(2);
    }
  });
});

describe('construirCartelSvg — plantilla foto', () => {
  it('sin fotoDataUri, cae a un fondo sólido en vez de romperse', async () => {
    const datos: DatosCartel = { ...DATOS_BASE, plantilla: 'foto', fotoDataUri: null };
    const svg = await construirCartelSvg(datos, 'sticker');
    expect(svg).toContain(datos.colorFondo);
    expect(svg).not.toContain('<image href="" ');
    // Las dos aserciones de arriba sobreviven al mutante que emite `<image href="${null}">` igual:
    // colorFondo sigue apareciendo como fill de la inicial, y el href dice "null", no "". Con este
    // caso (sin foto Y sin logo) el cartel no debe tener NINGUNA <image>, y el fondo tiene que ser
    // el rect sólido — eso sí es lo que la prueba promete (mutación corrida y confirmada).
    expect(svg).not.toContain('<image');
    expect(svg).toContain('<rect width="400" height="400" fill="#3b2a1e"/>');
  });

  it('con fotoDataUri, la usa como fondo de imagen', async () => {
    const datos: DatosCartel = { ...DATOS_BASE, plantilla: 'foto', fotoDataUri: 'data:image/webp;base64,BBBB' };
    const svg = await construirCartelSvg(datos, 'sticker');
    expect(svg).toContain('<image href="data:image/webp;base64,BBBB"');
  });

  it('produce SVG válido y con el QR embebido en los dos formatos', async () => {
    const datos: DatosCartel = { ...DATOS_BASE, plantilla: 'foto', fotoDataUri: 'data:image/webp;base64,BBBB' };
    for (const formato of ['sticker', 'mostrador'] as const) {
      const svg = await construirCartelSvg(datos, formato);
      expect(svg.trim().startsWith('<svg')).toBe(true);
      expect(svg.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g)?.length).toBe(2);
    }
  });
});

describe('construirCartelSvg — plantilla desconocida', () => {
  it('lanza un error legible en vez de devolver un SVG vacío', async () => {
    const datos = { ...DATOS_BASE, plantilla: 'no-existe' } as unknown as DatosCartel;
    await expect(construirCartelSvg(datos, 'sticker')).rejects.toThrow(/no implementada|Plantilla/);
  });
});

// NINGUNA plantilla puede colar un <text> propio. `rasterizarCartelPng` tiene un guardián que lo
// rechaza, pero solo se dispara sobre las combinaciones que alguien se acuerde de rasterizar en una
// prueba — y export.test.ts rasteriza "centrado" y "foto", no las seis. Un <text> escrito a mano
// dentro de plantillaSplit se vería perfecto en la vista previa del navegador y saldría en
// cuadraditos recién al IMPRIMIRLO. Esto recorre las seis y no depende de que nadie se acuerde.
describe('construirCartelSvg — ninguna plantilla emite <text> al imprimir', () => {
  const PLANTILLAS = ['centrado', 'split', 'foto'] as const;
  const FORMATOS = ['sticker', 'mostrador'] as const;

  for (const plantilla of PLANTILLAS) {
    for (const formato of FORMATOS) {
      it(`${plantilla} × ${formato}: solo contornos`, async () => {
        const datos: DatosCartel = {
          ...DATOS_BASE,
          plantilla,
          textoTeaser: 'Tu 5to café gratis',
          fotoDataUri: plantilla === 'foto' ? 'data:image/png;base64,iVBORw0KGgo=' : null,
        };
        // Sin logoDataUri a propósito: así se ejercita también la inicial del círculo de respaldo,
        // que es el cuarto texto de las plantillas y el más fácil de olvidar.
        const svg = await construirCartelSvgCon(datos, formato, dibujarTextoConInter);
        expect(svg).not.toContain('<text');
        // Y el texto SIGUE ahí: un `not.toContain('<text')` lo cumpliría también una plantilla que
        // dejara de dibujar texto del todo. El CTA es el único que aparece en las seis (la plantilla
        // "foto" no lleva el nombre del negocio, solo el logo y la frase).
        expect(svg).toContain(`aria-label="${DATOS_BASE.textoCta}"`);
      });
    }
  }
});

// TODO el contenido tiene que caber DENTRO del lienzo, en las SEIS combinaciones. No es prolijidad:
// un cartel es para IMPRIMIRLO, y lo que cae fuera del viewBox no existe en el papel — sin error,
// sin aviso, y sin que la vista previa lo delate si el navegador no recorta igual que el rasterizador.
//
// Nació de un bug real (2026-07-31): en `centrado` × `sticker` la tarjeta del QR terminaba en y=402
// sobre un lienzo de 400, el "¡Escaneá y sumate!" caía en y=422 y el teaser en y=440. El dueño
// habría impreso un adhesivo SIN la frase que le dice al cliente qué hacer. La causa era
// `qrLado = w * 0.5`: en un lienzo cuadrado, la tarjeta se comía el 62% del alto.
//
// Se escribe genérica —recorre las seis combinaciones y mira TODA coordenada `y`— para que atrape
// también la próxima plantilla que alguien agregue, no solo esta.
describe('construirCartelSvg — nada se sale del lienzo', () => {
  const PLANTILLAS = ['centrado', 'split', 'foto'] as const;
  const FORMATOS = ['sticker', 'mostrador'] as const;

  for (const plantilla of PLANTILLAS) {
    for (const formato of FORMATOS) {
      it(`${plantilla} × ${formato}: toda coordenada y cae dentro del alto del viewBox`, async () => {
        const datos: DatosCartel = {
          ...DATOS_BASE,
          plantilla,
          // CON teaser a propósito: es el elemento más bajo de la plantilla centrada, así que sin
          // él la prueba dejaría pasar justo el caso que más se desborda.
          textoTeaser: 'Tu 5to café gratis',
          logoDataUri: 'data:image/png;base64,iVBORw0KGgo=',
          fotoDataUri: plantilla === 'foto' ? 'data:image/png;base64,iVBORw0KGgo=' : null,
        };
        const svg = await construirCartelSvg(datos, formato);

        const alto = Number(svg.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)![1]);
        const ys = [...svg.matchAll(/\sy="([\d.]+)"/g)].map((m) => Number(m[1]));
        const maximo = Math.max(...ys);

        expect(
          maximo,
          `el elemento más bajo cae en y=${maximo} y el lienzo mide ${alto}: se imprimiría cortado`,
        ).toBeLessThanOrEqual(alto);
      });
    }
  }
});

// En las plantillas que centran el QR, lo que tiene que quedar centrado es la TARJETA BLANCA, no el
// QR de adentro. La tarjeta mide `qrLado + 2*margen`, así que posicionarla en la coordenada
// calculada para el QR la corre TODO el margen hacia la derecha.
//
// Bug real reportado por el dueño (2026-07-31): el QR se veía corrido en el cartel. Medido: 18.6
// unidades sobre un lienzo de 400 — un 4.6% del ancho, perfectamente visible a simple vista. Fue el
// segundo reporte del mismo síntoma; la primera vez lo atribuí a las fuentes faltantes, que sí era
// otro bug pero no este.
describe('construirCartelSvg — la tarjeta del QR queda CENTRADA', () => {
  for (const formato of ['sticker', 'mostrador'] as const) {
    it(`centrado × ${formato}: el centro de la tarjeta blanca coincide con el del lienzo`, async () => {
      const svg = await construirCartelSvg(DATOS_BASE, formato);
      const ancho = Number(svg.match(/viewBox="0 0 ([\d.]+)/)![1]);

      // La tarjeta blanca es el <rect> con fill #ffffff que tiene rx (esquinas redondeadas): el
      // fondo del cartel no lleva rx, así que no se confunden.
      const tarjeta = svg.match(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"[^>]*rx="[\d.]+" fill="#ffffff"\/>/);
      expect(tarjeta, 'no se encontró la tarjeta blanca del QR en el SVG').not.toBeNull();

      const x = Number(tarjeta![1]);
      const anchoTarjeta = Number(tarjeta![2]);
      const centroTarjeta = x + anchoTarjeta / 2;

      expect(
        centroTarjeta,
        `la tarjeta del QR está centrada en ${centroTarjeta} y el lienzo en ${ancho / 2}`,
      ).toBeCloseTo(ancho / 2, 1);
    });
  }

  it('split × sticker: el QR también queda centrado', async () => {
    const svg = await construirCartelSvg({ ...DATOS_BASE, plantilla: 'split' }, 'sticker');
    const ancho = Number(svg.match(/viewBox="0 0 ([\d.]+)/)![1]);
    const tarjeta = svg.match(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"[^>]*rx="[\d.]+" fill="#ffffff"\/>/);
    const centroTarjeta = Number(tarjeta![1]) + Number(tarjeta![2]) / 2;
    expect(centroTarjeta).toBeCloseTo(ancho / 2, 1);
  });

  // Estas miden el QR MISMO y no su tarjeta, y por eso cubren también la plantilla "foto", que es la
  // única que NO usa tarjetaBlancaConQr: dibuja su propia tarjeta (ancha, con lugar para el CTA
  // adentro) y posiciona el QR pelado. Al arreglar el centrado de las otras tres se le aplicó de
  // rebote la misma fórmula y quedó corrida; las pruebas de la tarjeta blanca no lo vieron, porque
  // ahí la tarjeta ancha SÍ está centrada aunque el QR de adentro no lo esté.
  const CENTRADOS_EN_EL_LIENZO = [
    { plantilla: 'centrado', formato: 'sticker' },
    { plantilla: 'centrado', formato: 'mostrador' },
    { plantilla: 'split', formato: 'sticker' },
    { plantilla: 'foto', formato: 'sticker' },
    { plantilla: 'foto', formato: 'mostrador' },
  ] as const;

  for (const { plantilla, formato } of CENTRADOS_EN_EL_LIENZO) {
    it(`${plantilla} × ${formato}: el QR mismo queda centrado en el lienzo`, async () => {
      const svg = await construirCartelSvg({ ...DATOS_BASE, plantilla }, formato);
      const ancho = Number(svg.match(/viewBox="0 0 ([\d.]+)/)![1]);

      // El QR es el <svg> anidado que arma construirQrSvg, dentro de su <g transform="translate…">.
      const qr = svg.match(/<g transform="translate\(([\d.-]+), [\d.-]+\)"><svg x="0" y="0" width="([\d.]+)"/);
      expect(qr, 'no se encontró el QR anidado en el SVG').not.toBeNull();

      const centroQr = Number(qr![1]) + Number(qr![2]) / 2;
      expect(centroQr, `el QR está centrado en ${centroQr} y el lienzo en ${ancho / 2}`).toBeCloseTo(
        ancho / 2,
        1,
      );
    });
  }
});

describe('construirCartelSvg — elementos libres (migración 0030)', () => {
  const FRANJA = {
    tipo: 'franja' as const,
    x: 0,
    y: 80,
    ancho: 100,
    alto: 10,
    color: 'rgb(12, 200, 34)',
    radio: 0,
  };
  const TEXTO = {
    tipo: 'texto' as const,
    texto: 'Promo de julio',
    x: 50,
    y: 95,
    tamano: 4,
    color: 'rgb(255, 255, 255)',
    peso: 700 as const,
  };

  // El invariante que protege el QR: una franja se dibuja ANTES que la tarjeta blanca, así que por
  // más que el dueño la ponga justo encima del código, la tarjeta la tapa y el QR sigue escaneando.
  // Al revés se imprimirían 500 stickers preciosos que ningún teléfono lee.
  for (const plantilla of ['centrado', 'split', 'foto'] as const) {
    it(`${plantilla}: la franja se dibuja DEBAJO de la tarjeta blanca del QR`, async () => {
      const svg = await construirCartelSvg({ ...DATOS_BASE, plantilla, elementos: [FRANJA] }, 'sticker');
      const posFranja = svg.indexOf('fill="rgb(12, 200, 34)"');
      const posTarjeta = svg.search(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+"[^>]*rx="[\d.]+" fill="#ffffff"\/>/);
      expect(posFranja, 'no se dibujó la franja').toBeGreaterThan(-1);
      expect(posTarjeta, 'no se encontró la tarjeta blanca').toBeGreaterThan(-1);
      expect(posFranja).toBeLessThan(posTarjeta);
    });

    it(`${plantilla}: el texto extra se dibuja ENCIMA del CTA de la plantilla`, async () => {
      const svg = await construirCartelSvg({ ...DATOS_BASE, plantilla, elementos: [TEXTO] }, 'sticker');
      expect(svg.indexOf('Promo de julio')).toBeGreaterThan(svg.indexOf('¡Escaneá y sumate!'));
    });
  }

  it('sin elementos, el SVG es EXACTAMENTE el de antes de la 0030', async () => {
    const sinCampo = await construirCartelSvg(DATOS_BASE, 'mostrador');
    const conListaVacia = await construirCartelSvg({ ...DATOS_BASE, elementos: [] }, 'mostrador');
    expect(conListaVacia).toBe(sinCampo);
  });

  // La 0030 nace con '[]' para toda fila existente, así que ESTE es el caso de todos los carteles
  // que ya están diseñados: ni un píxel se les mueve.
  it('los porcentajes se resuelven contra el lienzo de CADA formato', async () => {
    const sticker = await construirCartelSvg({ ...DATOS_BASE, elementos: [FRANJA] }, 'sticker');
    const mostrador = await construirCartelSvg({ ...DATOS_BASE, elementos: [FRANJA] }, 'mostrador');
    // y=80% → 320 en el sticker (alto 400) y 454.06 en el mostrador (alto 567.57).
    expect(sticker).toContain('y="320.00"');
    expect(mostrador).toContain('y="454.06"');
  });
});

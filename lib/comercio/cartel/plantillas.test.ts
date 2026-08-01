import { describe, expect, it } from 'vitest';
import { construirCartelSvg, escaparXml } from './plantillas';
import type { DatosCartel } from './tipos';

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

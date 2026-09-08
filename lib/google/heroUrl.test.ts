import { describe, it, expect, afterEach } from 'vitest';
import { urlHeroTarjeta, urlFranjaClase, versionHero, versionFranjaClase, heroUrlDeClase, type DatosVersionHero } from './heroUrl';

const ORIGINAL = process.env.NEXT_PUBLIC_BASE_URL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
  else process.env.NEXT_PUBLIC_BASE_URL = ORIGINAL;
});

function datos(sobre: Partial<DatosVersionHero> = {}): DatosVersionHero {
  return {
    puntos: 3, selloMeta: 8, colorFondo: 'rgb(36, 24, 18)', colorLabel: 'rgb(214, 146, 74)',
    selloIconoUrl: 'https://ejemplo.com/icono.png', heroUrl: 'https://ejemplo.com/hero.jpg',
    stripUrl: null, difuminadoFranja: 'medio',
    encuadreFranja: { modo: 'llenar', focoX: 50, focoY: 50, zoom: 100 },
    ...sobre,
  };
}

describe('urlHeroTarjeta', () => {
  it('arma la url con la versión como query param', () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site';
    expect(urlHeroTarjeta('abc-123', 'deadbeef')).toBe('https://www.cardly-sv.site/api/tarjetas/abc-123/hero.png?v=deadbeef');
  });

  it('quita la barra final de NEXT_PUBLIC_BASE_URL si la tiene', () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site/';
    expect(urlHeroTarjeta('abc-123', 'v1')).toBe('https://www.cardly-sv.site/api/tarjetas/abc-123/hero.png?v=v1');
  });

  it('devuelve null (no lanza) si falta NEXT_PUBLIC_BASE_URL', () => {
    delete process.env.NEXT_PUBLIC_BASE_URL;
    expect(urlHeroTarjeta('abc-123', 'v1')).toBeNull();
  });
});

describe('versionHero', () => {
  it('es determinística: los mismos datos dan la misma versión', () => {
    expect(versionHero(datos())).toBe(versionHero(datos()));
  });

  // EL caso del bug real: acreditar un sello DEBE cambiar la URL, si no Google sirve la imagen
  // cacheada y la grilla se queda congelada mientras el contador sí sube.
  it('cambia cuando cambian los puntos (invalida el caché de Google al acreditar)', () => {
    expect(versionHero(datos({ puntos: 3 }))).not.toBe(versionHero(datos({ puntos: 4 })));
  });

  it('cambia cuando el comercio cambia el ícono del sello', () => {
    expect(versionHero(datos())).not.toBe(versionHero(datos({ selloIconoUrl: 'https://ejemplo.com/otro.png' })));
  });

  it('cambia cuando cambian los colores, la meta, la foto de fondo o el difuminado', () => {
    const base = versionHero(datos());
    expect(versionHero(datos({ colorFondo: 'rgb(1,2,3)' }))).not.toBe(base);
    expect(versionHero(datos({ colorLabel: 'rgb(1,2,3)' }))).not.toBe(base);
    expect(versionHero(datos({ selloMeta: 10 }))).not.toBe(base);
    expect(versionHero(datos({ heroUrl: 'https://ejemplo.com/otra.jpg' }))).not.toBe(base);
    expect(versionHero(datos({ stripUrl: 'https://ejemplo.com/franja.png' }))).not.toBe(base);
    expect(versionHero(datos({ difuminadoFranja: 'fuerte' }))).not.toBe(base);
  });

  // MUTACIÓN: quitar los cuatro campos del encuadre de la clave en versionHero deja las cuatro
  // URLs iguales a la base y esta prueba falla.
  it('cambia con cada uno de los cuatro campos del encuadre (si no, Google sirve la foto mal encuadrada para siempre)', () => {
    const base = versionHero(datos());
    expect(versionHero(datos({ encuadreFranja: { modo: 'completa', focoX: 50, focoY: 50, zoom: 100 } }))).not.toBe(base);
    expect(versionHero(datos({ encuadreFranja: { modo: 'llenar', focoX: 0, focoY: 50, zoom: 100 } }))).not.toBe(base);
    expect(versionHero(datos({ encuadreFranja: { modo: 'llenar', focoX: 50, focoY: 0, zoom: 100 } }))).not.toBe(base);
    expect(versionHero(datos({ encuadreFranja: { modo: 'llenar', focoX: 50, focoY: 50, zoom: 150 } }))).not.toBe(base);
  });

  it('es corta y apta para una URL (12 hex)', () => {
    expect(versionHero(datos())).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('urlFranjaClase', () => {
  it('sin programa: la portada del comercio', () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site';
    expect(urlFranjaClase('com-1', null, 'abc')).toBe('https://www.cardly-sv.site/api/comercios/com-1/franja.png?v=abc');
  });
  it('con programa: lleva el id del programa en la query, ANTES de la versión', () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site/';
    expect(urlFranjaClase('com-1', 'prog-9', 'abc')).toBe('https://www.cardly-sv.site/api/comercios/com-1/franja.png?programa=prog-9&v=abc');
  });
  it('devuelve null si falta NEXT_PUBLIC_BASE_URL', () => {
    delete process.env.NEXT_PUBLIC_BASE_URL;
    expect(urlFranjaClase('com-1', null, 'abc')).toBeNull();
  });
});

describe('versionFranjaClase', () => {
  it('es la versión de la banda SIN progreso ni franja propia: no cambia con puntos ni con stripUrl', () => {
    const marca = { colorFondo: 'rgb(1,1,1)', colorLabel: 'rgb(2,2,2)', heroUrl: 'https://ejemplo.com/h.jpg', difuminadoFranja: 'medio', encuadreFranja: { modo: 'llenar' as const, focoX: 50, focoY: 50, zoom: 100 } };
    expect(versionFranjaClase(marca)).toBe(versionFranjaClase(marca));
    expect(versionFranjaClase(marca)).not.toBe(versionFranjaClase({ ...marca, encuadreFranja: { ...marca.encuadreFranja, focoY: 0 } }));
    // Es EXACTAMENTE versionHero con progreso cero, sin meta, sin ícono y sin franja propia: lo que
    // dibuja la ruta franja.png. Si un sync hasheara otra cosa, la URL de la clase no coincidiría.
    expect(versionFranjaClase(marca)).toBe(
      versionHero({ ...marca, puntos: 0, selloMeta: null, selloIconoUrl: null, stripUrl: null }),
    );
  });
});

describe('heroUrlDeClase', () => {
  const marca = {
    colorFondo: 'rgb(1,1,1)', colorLabel: 'rgb(2,2,2)', heroUrl: 'https://ejemplo.com/h.jpg',
    difuminadoFranja: 'medio', encuadreFranja: { modo: 'llenar' as const, focoX: 50, focoY: 50, zoom: 100 },
  };

  it('con foto y base URL: la portada compuesta, versionada por lo que dibuja', () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site';
    expect(heroUrlDeClase('com-1', null, marca)).toBe(
      `https://www.cardly-sv.site/api/comercios/com-1/franja.png?v=${versionFranjaClase(marca)}`,
    );
  });

  // La rama `?? marca.heroUrl` sin red se rompería en silencio: la clase se quedaría SIN heroImage
  // en un entorno sin NEXT_PUBLIC_BASE_URL en vez de degradar a la foto cruda como hasta la 0032.
  it('sin NEXT_PUBLIC_BASE_URL: degrada a la foto cruda, no a null', () => {
    delete process.env.NEXT_PUBLIC_BASE_URL;
    expect(heroUrlDeClase('com-1', 'prog-9', marca)).toBe('https://ejemplo.com/h.jpg');
  });

  it('sin foto efectiva: null (la clase sale sin heroImage, como siempre)', () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site';
    expect(heroUrlDeClase('com-1', null, { ...marca, heroUrl: null })).toBeNull();
  });
});

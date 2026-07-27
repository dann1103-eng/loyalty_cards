import { describe, it, expect, afterEach } from 'vitest';
import { urlHeroTarjeta, versionHero, type DatosVersionHero } from './heroUrl';

const ORIGINAL = process.env.NEXT_PUBLIC_BASE_URL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
  else process.env.NEXT_PUBLIC_BASE_URL = ORIGINAL;
});

function datos(sobre: Partial<DatosVersionHero> = {}): DatosVersionHero {
  return {
    puntos: 3, selloMeta: 8, colorFondo: 'rgb(36, 24, 18)', colorLabel: 'rgb(214, 146, 74)',
    selloIconoUrl: 'https://ejemplo.com/icono.png', heroUrl: 'https://ejemplo.com/hero.jpg',
    stripUrl: null, difuminadoFranja: 'medio', ...sobre,
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

  it('es corta y apta para una URL (12 hex)', () => {
    expect(versionHero(datos())).toMatch(/^[0-9a-f]{12}$/);
  });
});

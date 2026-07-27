import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { urlHeroTarjeta } from './heroUrl';

const ORIGINAL = process.env.NEXT_PUBLIC_BASE_URL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
  else process.env.NEXT_PUBLIC_BASE_URL = ORIGINAL;
});

describe('urlHeroTarjeta', () => {
  it('arma la url de la grilla a partir de NEXT_PUBLIC_BASE_URL', () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://loyalty-cards-rose.vercel.app';
    expect(urlHeroTarjeta('abc-123')).toBe('https://loyalty-cards-rose.vercel.app/api/tarjetas/abc-123/hero.png');
  });

  it('quita la barra final de NEXT_PUBLIC_BASE_URL si la tiene', () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://loyalty-cards-rose.vercel.app/';
    expect(urlHeroTarjeta('abc-123')).toBe('https://loyalty-cards-rose.vercel.app/api/tarjetas/abc-123/hero.png');
  });

  it('devuelve null (no lanza) si falta NEXT_PUBLIC_BASE_URL', () => {
    delete process.env.NEXT_PUBLIC_BASE_URL;
    expect(urlHeroTarjeta('abc-123')).toBeNull();
  });
});

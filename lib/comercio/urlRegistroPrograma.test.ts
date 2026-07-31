import { describe, expect, it } from 'vitest';
import { urlRegistroPrograma } from './urlRegistroPrograma';

describe('urlRegistroPrograma', () => {
  it('arma la URL del programa principal SIN slug de programa', () => {
    expect(urlRegistroPrograma('https://www.cardly-sv.site', 'cafe-sol', 'principal', true)).toBe(
      'https://www.cardly-sv.site/registro/cafe-sol',
    );
  });

  it('arma la URL de un programa NO principal CON su slug', () => {
    expect(urlRegistroPrograma('https://www.cardly-sv.site', 'cafe-sol', 'cupon-2026', false)).toBe(
      'https://www.cardly-sv.site/registro/cafe-sol/cupon-2026',
    );
  });

  it('quita una barra final del baseUrl para no duplicarla', () => {
    expect(urlRegistroPrograma('https://www.cardly-sv.site/', 'cafe-sol', 'principal', true)).toBe(
      'https://www.cardly-sv.site/registro/cafe-sol',
    );
  });

  it('devuelve null si no hay baseUrl configurado', () => {
    expect(urlRegistroPrograma(undefined, 'cafe-sol', 'principal', true)).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { rgbAHex } from './colorHex';

describe('rgbAHex', () => {
  it('convierte un rgb() normal a #rrggbb', () => {
    expect(rgbAHex('rgb(255, 122, 69)')).toBe('#ff7a45');
  });

  it('rellena con cero componentes de un solo dígito hex (ej. 4 -> 04, no 4)', () => {
    expect(rgbAHex('rgb(4, 0, 9)')).toBe('#040009');
  });

  it('tolera espacios variables entre los componentes', () => {
    expect(rgbAHex('rgb(36,24,18)')).toBe('#241812');
  });

  it('devuelve undefined para null (comercio sin color_fondo configurado)', () => {
    expect(rgbAHex(null)).toBeUndefined();
  });

  it('devuelve undefined para un formato irreconocible en vez de lanzar', () => {
    expect(rgbAHex('#ff0000')).toBeUndefined();
    expect(rgbAHex('not-a-color')).toBeUndefined();
  });
});

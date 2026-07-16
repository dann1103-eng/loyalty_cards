import { describe, it, expect } from 'vitest';
import { validarColorRgb } from './validarColorRgb';

describe('validarColorRgb', () => {
  it('acepta el formato canónico rgb(r, g, b)', () => {
    expect(validarColorRgb('rgb(35, 24, 18)')).toBe(true);
    expect(validarColorRgb('rgb(255, 255, 255)')).toBe(true);
    expect(validarColorRgb('rgb(0,0,0)')).toBe(true);
  });

  it('rechaza valores fuera del rango 0-255', () => {
    expect(validarColorRgb('rgb(256, 0, 0)')).toBe(false);
    expect(validarColorRgb('rgb(-1, 0, 0)')).toBe(false);
  });

  it('rechaza otros formatos de color', () => {
    expect(validarColorRgb('#231812')).toBe(false);
    expect(validarColorRgb('rgba(35, 24, 18, 0.5)')).toBe(false);
    expect(validarColorRgb('red')).toBe(false);
  });

  it('rechaza basura y vacío', () => {
    expect(validarColorRgb('')).toBe(false);
    expect(validarColorRgb('rgb(35, 24)')).toBe(false);
    expect(validarColorRgb('rgb(a, b, c)')).toBe(false);
  });
});

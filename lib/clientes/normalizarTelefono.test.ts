import { describe, it, expect } from 'vitest';
import { normalizarTelefono } from './normalizarTelefono';

describe('normalizarTelefono', () => {
  it('agrega +503 a un número local de 8 dígitos', () => {
    expect(normalizarTelefono('77771234')).toBe('+50377771234');
  });

  it('quita espacios, guiones y paréntesis', () => {
    expect(normalizarTelefono('7777-1234')).toBe('+50377771234');
    expect(normalizarTelefono('7777 1234')).toBe('+50377771234');
    expect(normalizarTelefono('(7777) 1234')).toBe('+50377771234');
  });

  it('respeta un número que ya trae código de país', () => {
    expect(normalizarTelefono('+503 7777 1234')).toBe('+50377771234');
    expect(normalizarTelefono('50377771234')).toBe('+50377771234');
  });

  it('acepta otros códigos de país si vienen con +', () => {
    expect(normalizarTelefono('+1 555 123 4567')).toBe('+15551234567');
  });

  it('rechaza entradas sin suficientes dígitos', () => {
    expect(() => normalizarTelefono('1234')).toThrow();
    expect(() => normalizarTelefono('')).toThrow();
    expect(() => normalizarTelefono('abc')).toThrow();
  });
});

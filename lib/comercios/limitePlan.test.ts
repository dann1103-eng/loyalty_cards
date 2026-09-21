import { describe, it, expect } from 'vitest';
import { PLANES } from './cuentas';
import { escalonDePlan, limiteAlSubir, limiteResultante } from './limitePlan';

// MUTATION-TESTING (cada fila se corrió):
//   - quitar el chequeo de "sin tope" en limiteAlSubir → "subir NO le quita el sin-tope" falla
//   - Math.max → destino.limiteSugerido a secas       → "nunca reduce un límite negociado" falla
//   - `plan !== null` → true                          → "una cuenta recién creada toma el sugerido" falla

const starter = PLANES[0];
const growth = PLANES[1];
const pro = PLANES[2];

describe('escalonDePlan', () => {
  it('ordena el catálogo y trata "sin plan" como el escalón más bajo', () => {
    expect(escalonDePlan('starter')).toBe(0);
    expect(escalonDePlan('pro')).toBe(2);
    expect(escalonDePlan(null)).toBe(-1);
    expect(escalonDePlan('inventado')).toBe(-1);
  });
});

describe('limiteAlSubir', () => {
  it('nunca reduce un límite negociado', () => {
    expect(limiteAlSubir({ plan: 'starter', limite: 5 }, growth)).toBe(5);
  });

  it('sube al sugerido del destino cuando es mayor', () => {
    expect(limiteAlSubir({ plan: 'starter', limite: 1 }, growth)).toBe(3);
    expect(limiteAlSubir({ plan: 'growth', limite: 3 }, pro)).toBe(10);
  });

  it('a Pro le gana un cupo negociado menor', () => {
    expect(limiteAlSubir({ plan: 'growth', limite: 4 }, pro)).toBe(10);
  });

  it('subir NO le quita el sin-tope a una cuenta que ya lo tenía', () => {
    expect(limiteAlSubir({ plan: 'starter', limite: null }, growth)).toBeNull();
  });

  it('una cuenta recién creada, sin plan, toma el sugerido del destino', () => {
    expect(limiteAlSubir({ plan: null, limite: null }, starter)).toBe(1);
  });
});

describe('limiteResultante', () => {
  it('al subir aplica la regla de subir', () => {
    expect(limiteResultante({ plan: 'starter', limite: 5 }, growth)).toBe(5);
  });

  it('al bajar rige el sugerido del plan, aunque la cuenta tuviera más o no tuviera tope', () => {
    expect(limiteResultante({ plan: 'pro', limite: 10 }, starter)).toBe(1);
    expect(limiteResultante({ plan: 'growth', limite: null }, starter)).toBe(1);
  });

  it('en el mismo plan rige el sugerido', () => {
    expect(limiteResultante({ plan: 'growth', limite: 3 }, growth)).toBe(3);
  });
});

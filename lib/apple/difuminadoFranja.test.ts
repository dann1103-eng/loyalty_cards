import { describe, it, expect } from 'vitest';
import { stopsDifuminado, NIVELES_DIFUMINADO } from './difuminadoFranja';

describe('NIVELES_DIFUMINADO', () => {
  it('expone los 4 niveles en el orden esperado', () => {
    expect(NIVELES_DIFUMINADO).toEqual(['ninguno', 'sutil', 'medio', 'fuerte']);
  });
});

describe('stopsDifuminado', () => {
  it('"ninguno" no aplica difuminado (null = corte seco)', () => {
    expect(stopsDifuminado('ninguno')).toBeNull();
  });

  it('sutil < medio < fuerte: más intensidad encoge el área nítida central', () => {
    const sutil = stopsDifuminado('sutil')!;
    const medio = stopsDifuminado('medio')!;
    const fuerte = stopsDifuminado('fuerte')!;
    expect(sutil.v[0]).toBeLessThan(medio.v[0]);
    expect(medio.v[0]).toBeLessThan(fuerte.v[0]);
    expect(sutil.h[0]).toBeLessThan(medio.h[0]);
    expect(medio.h[0]).toBeLessThan(fuerte.h[0]);
  });

  it('cada nivel es simétrico: el stop final espeja al inicial (100 - inicio)', () => {
    for (const nivel of ['sutil', 'medio', 'fuerte'] as const) {
      const s = stopsDifuminado(nivel)!;
      expect(s.v[1]).toBe(100 - s.v[0]);
      expect(s.h[1]).toBe(100 - s.h[0]);
    }
  });

  it('un valor desconocido cae al nivel "medio" (fallback seguro, nunca revienta)', () => {
    expect(stopsDifuminado('lo-que-sea')).toEqual(stopsDifuminado('medio'));
    expect(stopsDifuminado('')).toEqual(stopsDifuminado('medio'));
  });
});

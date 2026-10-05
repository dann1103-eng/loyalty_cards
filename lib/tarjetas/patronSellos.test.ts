import { describe, expect, it } from 'vitest';
import { llevaSegundoIcono, sanearPatronSellos, type PatronSello } from './patronSellos';

// La grilla entera como la vería el dueño: 'A' el ícono de siempre, 'B' el segundo.
const grilla = (meta: number, patron: PatronSello, casillas: number[] = []) =>
  Array.from({ length: meta }, (_, i) => (llevaSegundoIcono(i, meta, { patron, casillas }) ? 'B' : 'A')).join('');

describe('llevaSegundoIcono', () => {
  it('intercalado: la primera casilla es el ícono de siempre y se alternan', () => {
    expect(grilla(10, 'intercalado')).toBe('ABABABABAB');
    expect(grilla(5, 'intercalado')).toBe('ABABA');
  });

  it('mitades: la segunda mitad; con meta impar la del medio queda en la primera', () => {
    expect(grilla(10, 'mitades')).toBe('AAAAABBBBB');
    expect(grilla(5, 'mitades')).toBe('AAABB');
    expect(grilla(1, 'mitades')).toBe('A');
  });

  it('ultimo: solo la casilla del premio', () => {
    expect(grilla(10, 'ultimo')).toBe('AAAAAAAAAB');
    expect(grilla(1, 'ultimo')).toBe('B');
  });

  it('casillas: las posiciones del dueño se cuentan desde 1', () => {
    expect(grilla(10, 'casillas', [5, 10])).toBe('AAAABAAAAB');
    expect(grilla(10, 'casillas', [1])).toBe('BAAAAAAAAA');
    expect(grilla(10, 'casillas', [])).toBe('AAAAAAAAAA');
  });

  it('casillas: una posición fuera de la grilla se ignora, no corre las demás', () => {
    // El dueño eligió la 5 y la 10 con meta 10 y después bajó la meta a 8.
    expect(grilla(8, 'casillas', [5, 10])).toBe('AAAABAAA');
  });

  it('las casillas guardadas NO se miran con otro patrón', () => {
    expect(grilla(4, 'ultimo', [1, 2])).toBe('AAAB');
  });
});

describe('sanearPatronSellos', () => {
  it('un patrón desconocido o nulo cae a intercalado', () => {
    expect(sanearPatronSellos(null, null)).toEqual({ patron: 'intercalado', casillas: [] });
    expect(sanearPatronSellos('zigzag', [])).toEqual({ patron: 'intercalado', casillas: [] });
    expect(sanearPatronSellos('ultimo', [])).toEqual({ patron: 'ultimo', casillas: [] });
  });

  it('de las casillas sobreviven solo enteros de 1 a 30, sin repetir y en orden', () => {
    expect(sanearPatronSellos('casillas', [10, 5, 5, 0, -1, 31, 5.7, '3', null, 30, 1]).casillas).toEqual([
      1, 5, 10, 30,
    ]);
  });

  it('casillas que no son una lista se descartan enteras', () => {
    expect(sanearPatronSellos('casillas', '5,10').casillas).toEqual([]);
    expect(sanearPatronSellos('casillas', { 0: 5 }).casillas).toEqual([]);
  });
});

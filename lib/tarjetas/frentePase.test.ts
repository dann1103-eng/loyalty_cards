import { describe, it, expect } from 'vitest';
import { frentePase } from './frentePase';

// EL frente del pass: qué va en el campo primario (sobre la franja) y qué en el secundario (debajo).
// Vivía inline en generarPassApple y la vista previa lo re-adivinaba con su propio if/else — que es
// como la vista previa de una membresía terminó diciendo "PUNTOS 0" (2026-09-08).
describe('frentePase', () => {
  it('membresía, cupón y descuento: ningún campo (el pase no lleva contador)', () => {
    for (const tipo of ['membresia', 'cupon', 'descuento']) {
      expect(frentePase({ tipoTarjeta: tipo, puntos: 0, selloMeta: null, hayGrilla: false })).toEqual({
        primario: null,
        secundario: null,
      });
    }
  });

  it('puntos: primario "PUNTOS" con el número pelado (para numberStyle)', () => {
    expect(frentePase({ tipoTarjeta: 'puntos', puntos: 120, selloMeta: null, hayGrilla: false })).toEqual({
      primario: { etiqueta: 'PUNTOS', valor: '120', numero: 120 },
      secundario: null,
    });
  });

  it('gift card: primario "SALDO" en dólares y SIN número (el entero son centavos)', () => {
    // MUTACIÓN: devolver `numero: puntos` acá reintroduce el "PUNTOS 2500" del 2026-07-30.
    expect(frentePase({ tipoTarjeta: 'gift_card', puntos: 2500, selloMeta: null, hayGrilla: false })).toEqual({
      primario: { etiqueta: 'SALDO', valor: '$25.00', numero: null },
      secundario: null,
    });
  });

  it('sellos CON grilla: nada sobre la franja (taparía los sellos) y "7 de 10" debajo', () => {
    // MUTACIÓN: ignorar `hayGrilla` (tratarlo siempre como false) sube el texto encima de la grilla.
    expect(frentePase({ tipoTarjeta: 'sellos', puntos: 7, selloMeta: 10, hayGrilla: true })).toEqual({
      primario: null,
      secundario: { etiqueta: 'SELLOS', valor: '7 de 10', numero: null },
    });
  });

  it('sellos SIN grilla (franja propia o composición fallida): primario "7 de 10 sellos"', () => {
    // MUTACIÓN: tratar `hayGrilla` siempre como true deja la franja propia sin ningún contador encima.
    expect(frentePase({ tipoTarjeta: 'sellos', puntos: 7, selloMeta: 10, hayGrilla: false })).toEqual({
      primario: { etiqueta: 'SELLOS', valor: '7 de 10 sellos', numero: null },
      secundario: null,
    });
  });

  it('sellos sin meta: cae al entero pelado, nunca "7 de null"', () => {
    expect(frentePase({ tipoTarjeta: 'sellos', puntos: 7, selloMeta: null, hayGrilla: true })).toEqual({
      primario: { etiqueta: 'SELLOS', valor: '7', numero: 7 },
      secundario: null,
    });
  });
});

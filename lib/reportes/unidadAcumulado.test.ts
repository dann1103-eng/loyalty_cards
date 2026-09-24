import { describe, it, expect } from 'vitest';
import { TIPOS } from '@/lib/tarjetas/tipos';
import {
  unidadAcumulado,
  acumuladoExcel,
  sePuedeOrdenarPorAcumulado,
  FORMATO_DOLARES,
} from './unidadAcumulado';

// Prueba PURA. La trampa (spec, "Unidad del acumulado"): `puntos_otorgados` es el contador universal
// de la tarjeta, así que en cashback y gift card son CENTAVOS, y en cupón, membresía y descuento el
// delta es siempre 0. Un Excel que escriba 1250 en la columna de un cashback le dice al dueño que
// devolvió $1250 cuando fueron $12.50.
//
// MUTATION-TESTING (corridas el 2026-09-23, con el mensaje que se vio caer):
// - `bruto / 100` → `bruto`: cae "centavos → dólares con formato $#,##0.00" con `expected 1250 to be
//   12.5`.
// - Sin la reescritura de prepago (`return unidad.plural`): caen tres, entre ellas "una palabra por
//   tipo…" con `expected 'visitas' to be 'visitas prepagadas'` y "se deriva del CATÁLOGO…" con
//   `prepago: expected 'visitas' not to be 'visitas'`.
// - Sin contador escribe el bruto (`valor: bruto` en vez de null): cae "sin contador: celda vacía…"
//   con `cupon: expected { valor: +0, formato: undefined, …(1) } to deeply equal { valor: null, …(2) }`.
// - Ordenable sin excluir la unidad nula (`unidades.size === 1`): cae "su único tipo no tiene
//   contador, o no hay tipos: no" con `expected true to be false`.

describe('unidadAcumulado', () => {
  it('una palabra por tipo; "visitas prepagadas" y no "visitas" en prepago', () => {
    expect(unidadAcumulado('puntos')).toBe('puntos');
    expect(unidadAcumulado('sellos')).toBe('sellos');
    // Al lado de la columna Visitas del Excel (que es otra cosa), "visitas" confundiría.
    expect(unidadAcumulado('prepago')).toBe('visitas prepagadas');
    expect(unidadAcumulado('gift_card')).toBe('$');
    expect(unidadAcumulado('cashback')).toBe('$');
    expect(unidadAcumulado('cupon')).toBeNull();
    expect(unidadAcumulado('membresia')).toBeNull();
    expect(unidadAcumulado('descuento')).toBeNull();
  });

  it('se deriva del CATÁLOGO: todo tipo, presente o futuro, cae en su contador', () => {
    // Un noveno tipo no puede heredar una unidad por descuido: esto lo recorre entero.
    for (const tipo of TIPOS) {
      const unidad = unidadAcumulado(tipo.valor);
      if (tipo.contador === 'ninguno') expect(unidad, tipo.valor).toBeNull();
      if (tipo.contador === 'centavos') expect(unidad, tipo.valor).toBe('$');
      if (tipo.contador === 'entero') {
        expect(unidad, tipo.valor).not.toBeNull();
        expect(unidad, tipo.valor).not.toBe('visitas');
      }
    }
  });

  it('un tipo desconocido degrada a puntos (misma política que tipoOPuntos)', () => {
    expect(unidadAcumulado('inventado')).toBe('puntos');
  });
});

describe('acumuladoExcel', () => {
  it('centavos → dólares con formato $#,##0.00', () => {
    expect(FORMATO_DOLARES).toBe('$#,##0.00');
    const celda = acumuladoExcel('cashback', 1250);
    expect(celda.valor).toBe(12.5);
    expect(celda).toEqual({ valor: 12.5, formato: '$#,##0.00', unidad: '$' });
    expect(acumuladoExcel('gift_card', 1999).valor).toBe(19.99);
  });

  it('puntos, sellos y prepago: el entero tal cual, sin formato de moneda', () => {
    expect(acumuladoExcel('puntos', 1250)).toEqual({ valor: 1250, formato: undefined, unidad: 'puntos' });
    expect(acumuladoExcel('sellos', 7)).toEqual({ valor: 7, formato: undefined, unidad: 'sellos' });
    expect(acumuladoExcel('prepago', 10)).toEqual({ valor: 10, formato: undefined, unidad: 'visitas prepagadas' });
  });

  it('sin contador: celda vacía (null) y sin unidad, no un 0 que parece dato', () => {
    for (const tipo of ['cupon', 'membresia', 'descuento']) {
      expect(acumuladoExcel(tipo, 0), tipo).toEqual({ valor: null, formato: undefined, unidad: null });
    }
  });
});

describe('sePuedeOrdenarPorAcumulado', () => {
  it('una sola unidad con contador: sí', () => {
    expect(sePuedeOrdenarPorAcumulado(['puntos'])).toBe(true);
    expect(sePuedeOrdenarPorAcumulado(['sellos', 'sellos'])).toBe(true);
    // Cashback y gift card son la MISMA unidad (dinero): ordenarlos juntos significa algo.
    expect(sePuedeOrdenarPorAcumulado(['cashback', 'gift_card'])).toBe(true);
  });

  it('unidades mezcladas: no (centavos contra sellos no significa nada)', () => {
    expect(sePuedeOrdenarPorAcumulado(['puntos', 'sellos'])).toBe(false);
    expect(sePuedeOrdenarPorAcumulado(['puntos', 'cashback'])).toBe(false);
    expect(sePuedeOrdenarPorAcumulado(['puntos', 'cupon'])).toBe(false);
  });

  it('su único tipo no tiene contador, o no hay tipos: no', () => {
    expect(sePuedeOrdenarPorAcumulado(['cupon'])).toBe(false);
    expect(sePuedeOrdenarPorAcumulado(['membresia', 'descuento'])).toBe(false);
    expect(sePuedeOrdenarPorAcumulado([])).toBe(false);
  });
});

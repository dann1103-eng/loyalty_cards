import { describe, expect, it } from 'vitest';
import { controlesDesdeFormulario } from './controlesAcreditacion';
import { formatearCentavos } from '../tarjetas/tipos';
import { ZONA_HORARIA_DEFAULT } from './zonasHorarias';

// Solo la parte PURA de la Tarea 4 (el mínimo de compra y sus implicaciones dentro de
// controlesDesdeFormulario). El resto — validar() y el guardado/lectura contra Supabase — se prueba
// en app/comercio/(protegido)/reglas/actions.test.ts, porque ahí es donde vive el formulario real
// (dibujarReglas) y porque esas rutas SÍ tocan las columnas de la migración 0039, que hoy —
// 2026-09-23, confirmado con scripts/verificar-0039.ts — todavía no está aplicada. Esas pruebas de
// Supabase están escritas y corridas para confirmar que fallan por la columna faltante (ver el
// encabezado de ese archivo); su verde y sus mutaciones quedan para la Tarea 9.
//
// Mutation-testing CONFIRMADO (2026-09-23), cada una restaurada después de corrida:
// - Cambiar el `Number.NaN` de `aMinimo` por `null` (mantener lo que devuelve centavosDesdeTexto tal
//   cual): falla "'10x' → NaN" y "'-5' → NaN" — un mínimo mal tecleado se leería como "sin mínimo"
//   en vez de como el typo que es.
// - Quitar `|| montoMinimoCompraCentavos !== null` de la implicación de exigir (dejar
//   `exigirMontoCompra = campos.exigirMontoCompra`): falla "mínimo con exigir apagado → exigir true
//   y pedir true" — cargar un mínimo sin tildar "Exigir" dejaría de exigir el monto, una
//   combinación que el CHECK comercios_minimo_implica_exigir de la 0039 rechazaría.
describe('controlesDesdeFormulario — el mínimo de compra (Tarea 4)', () => {
  // Campos base con todo lo demás vacío/apagado, para que cada prueba solo toque lo que le importa.
  function campos(extra: Partial<Parameters<typeof controlesDesdeFormulario>[0]> = {}) {
    return {
      topeAcreditacionesDia: '',
      esperaMinimaMinutos: '',
      techoPuntosAcreditacion: '',
      topePuntosDia: '',
      pedirMontoCompra: false,
      exigirMontoCompra: false,
      montoMinimoCompra: '',
      zonaHoraria: '',
      ...extra,
    };
  }

  describe('parseo del texto del mínimo', () => {
    it('vacío → null', () => {
      expect(controlesDesdeFormulario(campos({ montoMinimoCompra: '' })).montoMinimoCompraCentavos).toBeNull();
    });

    it("'10' → 1000", () => {
      expect(controlesDesdeFormulario(campos({ montoMinimoCompra: '10' })).montoMinimoCompraCentavos).toBe(1000);
    });

    it("'$10.50' → 1050 (centavosDesdeTexto tolera el símbolo)", () => {
      expect(controlesDesdeFormulario(campos({ montoMinimoCompra: '$10.50' })).montoMinimoCompraCentavos).toBe(1050);
    });

    it("'10x' → NaN, no null: un typo no se traga en silencio", () => {
      const resultado = controlesDesdeFormulario(campos({ montoMinimoCompra: '10x' })).montoMinimoCompraCentavos;
      expect(resultado).not.toBeNull();
      expect(Number.isNaN(resultado)).toBe(true);
    });

    it("'-5' → NaN: negativo tampoco es un mínimo válido", () => {
      const resultado = controlesDesdeFormulario(campos({ montoMinimoCompra: '-5' })).montoMinimoCompraCentavos;
      expect(resultado).not.toBeNull();
      expect(Number.isNaN(resultado)).toBe(true);
    });
  });

  describe('implicaciones: exigir = exigirCheckbox || mínimo !== null; pedir = pedirCheckbox || exigir', () => {
    it('mínimo cargado con "Exigir" apagado → exigirMontoCompra true y pedirMontoCompra true', () => {
      const resultado = controlesDesdeFormulario(
        campos({ exigirMontoCompra: false, pedirMontoCompra: false, montoMinimoCompra: '10.00' }),
      );
      expect(resultado.exigirMontoCompra).toBe(true);
      expect(resultado.pedirMontoCompra).toBe(true);
      expect(resultado.montoMinimoCompraCentavos).toBe(1000);
    });

    it('"Exigir" prendido con "Pedir" apagado y sin mínimo → pedirMontoCompra true igual', () => {
      const resultado = controlesDesdeFormulario(
        campos({ exigirMontoCompra: true, pedirMontoCompra: false, montoMinimoCompra: '' }),
      );
      expect(resultado.exigirMontoCompra).toBe(true);
      expect(resultado.pedirMontoCompra).toBe(true);
      expect(resultado.montoMinimoCompraCentavos).toBeNull();
    });

    it('todo apagado y mínimo vacío → todo false/null', () => {
      const resultado = controlesDesdeFormulario(campos());
      expect(resultado.exigirMontoCompra).toBe(false);
      expect(resultado.pedirMontoCompra).toBe(false);
      expect(resultado.montoMinimoCompraCentavos).toBeNull();
    });
  });

  describe('ida y vuelta: formatearCentavos(n) como texto del mínimo vuelve a parsear a n exacto', () => {
    it.each([1, 99, 1050, 100_000])('%i centavos', (centavos) => {
      const texto = formatearCentavos(centavos);
      const resultado = controlesDesdeFormulario(campos({ montoMinimoCompra: texto }));
      expect(resultado.montoMinimoCompraCentavos).toBe(centavos);
    });
  });

  it('la zona horaria por default sigue funcionando (no se tocó nada de eso)', () => {
    expect(controlesDesdeFormulario(campos()).zonaHoraria).toBe(ZONA_HORARIA_DEFAULT);
  });
});

import { describe, expect, it } from 'vitest';
import { controlesDesdeFormulario, guardarControles, MAXIMO_MONTO_MINIMO_CENTAVOS, type ControlesAcreditacion } from './controlesAcreditacion';
import { createServiceClient } from '../supabase/server';
import { formatearCentavos } from '../tarjetas/tipos';
import { ZONA_HORARIA_DEFAULT } from './zonasHorarias';

// La parte PURA de la Tarea 4: el mínimo de compra y sus implicaciones dentro de
// `controlesDesdeFormulario`, más las cuatro ramas de `validar()` que ESE formulario nunca puede
// producir (exigir sin pedir, mínimo sin exigir, el tope, el "no positivo") — esas se prueban acá
// abajo llamando a `guardarControles` con un `comercioId` que ni siquiera existe: `validar()` corre
// ANTES que cualquier consulta, así que un error de validación vuelve sin tocar Supabase, y esas
// pruebas corren en verde HOY, con o sin la migración 0039.
//
// El resto — guardar y releer de verdad, y las combinaciones que el formulario SÍ puede producir —
// se prueba en app/comercio/(protegido)/reglas/actions.test.ts, porque ahí vive el formulario real
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
// - Borrar el bloque del mínimo "no entero positivo" de `validar()`: falla "mínimo 0 → error".
// - Borrar el chequeo del tope (`> MAXIMO_MONTO_MINIMO_CENTAVOS`): falla "mínimo por encima del
//   tope → error del tope".
// - Borrar el chequeo "exigir sin pedir": falla "exigir SIN pedir → error".
// - Borrar el chequeo "mínimo sin exigir": falla "mínimo SIN exigir → error".
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

describe('guardarControles — ramas de validar() que el formulario NUNCA arma (Tarea 4)', () => {
  // `validar()` corta ANTES de tocar Supabase cuando hay un error, así que estas pruebas corren en
  // verde hoy mismo con un comercioId que ni siquiera existe: no llega a haber ninguna consulta.
  const ID_CUALQUIERA = '00000000-0000-0000-0000-000000000000';
  const supabase = createServiceClient();

  // Un ControlesAcreditacion completo, con todo lo demás en su default "sin límite" — cada prueba
  // solo pisa lo que le importa.
  function controles(extra: Partial<ControlesAcreditacion> = {}): ControlesAcreditacion {
    return {
      topeAcreditacionesDia: null,
      esperaMinimaMinutos: null,
      techoPuntosAcreditacion: null,
      topePuntosDia: null,
      pedirMontoCompra: false,
      exigirMontoCompra: false,
      montoMinimoCompraCentavos: null,
      zonaHoraria: ZONA_HORARIA_DEFAULT,
      ...extra,
    };
  }

  it('mínimo 0 (no positivo) → error del mínimo', async () => {
    const res = await guardarControles(
      supabase,
      ID_CUALQUIERA,
      controles({ exigirMontoCompra: true, pedirMontoCompra: true, montoMinimoCompraCentavos: 0 }),
    );
    expect(res).toEqual({
      ok: false,
      error: 'El mínimo de compra para sumar debe ser un monto válido mayor que cero (por ejemplo 10.00), o quedar vacío para no exigir un mínimo.',
    });
  });

  it('mínimo por encima del tope → error del tope', async () => {
    const res = await guardarControles(
      supabase,
      ID_CUALQUIERA,
      controles({
        exigirMontoCompra: true,
        pedirMontoCompra: true,
        montoMinimoCompraCentavos: MAXIMO_MONTO_MINIMO_CENTAVOS + 1,
      }),
    );
    expect(res).toEqual({
      ok: false,
      error: `El mínimo de compra para sumar no puede pasar de ${formatearCentavos(MAXIMO_MONTO_MINIMO_CENTAVOS)}.`,
    });
  });

  it('exigir SIN pedir (combinación que el formulario nunca arma) → error', async () => {
    // controlesDesdeFormulario siempre prende "Pedir" junto con "Exigir" (implicación probada
    // arriba), así que esta combinación solo la puede armar otro llamador de guardarControles.
    const res = await guardarControles(
      supabase,
      ID_CUALQUIERA,
      controles({ exigirMontoCompra: true, pedirMontoCompra: false }),
    );
    expect(res).toEqual({ ok: false, error: 'Para exigir el monto de la compra primero tenés que pedirlo.' });
  });

  it('mínimo SIN exigir (combinación que el formulario nunca arma) → error', async () => {
    // controlesDesdeFormulario siempre prende "Exigir" junto con el mínimo (implicación probada
    // arriba), así que esta combinación también es exclusiva de otro llamador.
    const res = await guardarControles(
      supabase,
      ID_CUALQUIERA,
      controles({ exigirMontoCompra: false, pedirMontoCompra: true, montoMinimoCompraCentavos: 1000 }),
    );
    expect(res).toEqual({
      ok: false,
      error: 'Para fijar un mínimo de compra primero tildá "Exigir el monto para sumar".',
    });
  });
});

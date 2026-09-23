import { describe, it, expect, afterAll } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { validarMontoAcreditacion, ofreceReglaDeMonto, leerReglaDeMonto } from './montoAcreditacion';
// aplicaReglaDeMonto vive en el catálogo (lib/tarjetas/tipos.ts), no acá: ofreceReglaDeMonto la usa
// internamente para decidir qué programas cuentan, y la probamos junto a ella por eso — el campo y
// su función ya tienen su prueba canónica en lib/tarjetas/tipos.test.ts.
import { aplicaReglaDeMonto } from '../tarjetas/tipos';

// Mutation-testing CONFIRMADO (2026-09-23), cada una restaurada después de corrida:
// - `<` → `<=` en la comparación del mínimo (montoAcreditacion.ts): falla "1000 → ok: el mínimo es
//   inclusivo" — el mínimo exacto pasa a rechazarse con el error del mínimo.
// - Quitar `&& !autorizado` de esa misma condición: falla "999 autorizado → ok: la autorización
//   saltea SOLO el mínimo" — un autorizado bajo el mínimo vuelve a rechazarse.
// - Quitar `|| montoCentavos <= 0` del paso 1: falla "monto 0 → el mismo error que null" — $0.00
//   pasa a aceptarse como si fuera una compra.
// - Agregar `bloqueoLimite: true` también en el error del paso 1 (monto faltante): falla las 4
//   pruebas que aseveran ese objeto SIN esa clave (toEqual exacto).
// - `aplicaReglaDeMonto: true` en `cashback` (lib/tarjetas/tipos.ts): falla "exactamente puntos y
//   sellos" y "los otros seis no" en tipos.test.ts, y "false para los otros seis" acá.
// - En `ofreceReglaDeMonto`, `every` en vez de `some`: falla "lista vacía → false" (vacuous truth
//   de `every` en un array vacío) y "membresía principal + sellos secundario → true".

describe('validarMontoAcreditacion', () => {
  describe('sin regla (exigir false, mínimo null)', () => {
    it('monto null → ok', () => {
      expect(validarMontoAcreditacion({ exigir: false, minimoCentavos: null, montoCentavos: null, autorizado: false }))
        .toEqual({ ok: true });
    });

    it('monto 0 → ok (nada exige monto)', () => {
      expect(validarMontoAcreditacion({ exigir: false, minimoCentavos: null, montoCentavos: 0, autorizado: false }))
        .toEqual({ ok: true });
    });
  });

  describe('exigir true, sin mínimo', () => {
    it('monto null → error de monto faltante, SIN bloqueoLimite', () => {
      expect(validarMontoAcreditacion({ exigir: true, minimoCentavos: null, montoCentavos: null, autorizado: false }))
        .toEqual({ ok: false, error: 'Escribí el monto de la compra (por ejemplo 19.99).' });
    });

    it('monto 0 → el mismo error que null: $0.00 no es una compra', () => {
      expect(validarMontoAcreditacion({ exigir: true, minimoCentavos: null, montoCentavos: 0, autorizado: false }))
        .toEqual({ ok: false, error: 'Escribí el monto de la compra (por ejemplo 19.99).' });
    });

    it('monto 1 → ok', () => {
      expect(validarMontoAcreditacion({ exigir: true, minimoCentavos: null, montoCentavos: 1, autorizado: false }))
        .toEqual({ ok: true });
    });
  });

  describe('exigir false pero mínimo 1000 (combinación que la BD prohíbe; la función no depende de eso)', () => {
    it('monto null → error de monto faltante igual: el mínimo por sí solo también lo exige', () => {
      expect(validarMontoAcreditacion({ exigir: false, minimoCentavos: 1000, montoCentavos: null, autorizado: false }))
        .toEqual({ ok: false, error: 'Escribí el monto de la compra (por ejemplo 19.99).' });
    });
  });

  describe('mínimo 1000 (sin autorizar)', () => {
    it('999 → error del mínimo, CON bloqueoLimite', () => {
      expect(validarMontoAcreditacion({ exigir: true, minimoCentavos: 1000, montoCentavos: 999, autorizado: false }))
        .toEqual({ ok: false, error: 'La compra mínima para sumar es $10.00.', bloqueoLimite: true });
    });

    it('1000 → ok: el mínimo es inclusivo', () => {
      expect(validarMontoAcreditacion({ exigir: true, minimoCentavos: 1000, montoCentavos: 1000, autorizado: false }))
        .toEqual({ ok: true });
    });

    it('1001 → ok', () => {
      expect(validarMontoAcreditacion({ exigir: true, minimoCentavos: 1000, montoCentavos: 1001, autorizado: false }))
        .toEqual({ ok: true });
    });
  });

  describe('mínimo 1000, autorizado', () => {
    it('999 autorizado → ok: la autorización saltea SOLO el mínimo', () => {
      expect(validarMontoAcreditacion({ exigir: true, minimoCentavos: 1000, montoCentavos: 999, autorizado: true }))
        .toEqual({ ok: true });
    });

    it('null autorizado → sigue siendo el error de monto faltante: la autorización NO saltea el paso 1', () => {
      expect(validarMontoAcreditacion({ exigir: true, minimoCentavos: 1000, montoCentavos: null, autorizado: true }))
        .toEqual({ ok: false, error: 'Escribí el monto de la compra (por ejemplo 19.99).' });
    });
  });

  it('el mensaje del mínimo usa formatearCentavos: 1050 → "$10.50"', () => {
    expect(validarMontoAcreditacion({ exigir: true, minimoCentavos: 1050, montoCentavos: 999, autorizado: false }))
      .toEqual({ ok: false, error: 'La compra mínima para sumar es $10.50.', bloqueoLimite: true });
  });
});

describe('aplicaReglaDeMonto (reexportada de lib/tarjetas/tipos)', () => {
  it('true para puntos y sellos', () => {
    expect(aplicaReglaDeMonto('puntos')).toBe(true);
    expect(aplicaReglaDeMonto('sellos')).toBe(true);
  });

  it('false para los otros seis', () => {
    for (const valor of ['prepago', 'gift_card', 'cashback', 'cupon', 'membresia', 'descuento']) {
      expect(aplicaReglaDeMonto(valor), valor).toBe(false);
    }
  });

  it('un tipo desconocido: lo que diga tipoOPuntos — cae a puntos, que da true', () => {
    expect(aplicaReglaDeMonto('lo-que-sea')).toBe(true);
  });
});

describe('ofreceReglaDeMonto', () => {
  it('lista vacía → false', () => {
    expect(ofreceReglaDeMonto([])).toBe(false);
  });

  it('solo cupón y membresía → false: ninguno de los dos recibe la regla', () => {
    expect(ofreceReglaDeMonto([{ tipoTarjeta: 'cupon' }, { tipoTarjeta: 'membresia' }])).toBe(false);
  });

  it('membresía principal + sellos secundario → true', () => {
    expect(ofreceReglaDeMonto([{ tipoTarjeta: 'membresia' }, { tipoTarjeta: 'sellos' }])).toBe(true);
  });

  it('un sellos DESACTIVADO también cuenta: no filtra por activo, porque sus tarjetas se siguen acreditando', () => {
    // El shape que recibe de verdad es más ancho que { tipoTarjeta } (viene de listarProgramas), así
    // que le pasamos un `activo: false` de más para dejar constancia de que la función lo ignora.
    // Por una variable tipada aparte, y no un literal directo en la llamada: un literal inline con
    // una propiedad de más rebota contra el chequeo de propiedades excedentes de TypeScript, porque
    // la firma real es { tipoTarjeta: string }[].
    const programas: { tipoTarjeta: string; activo: boolean }[] = [{ tipoTarjeta: 'sellos', activo: false }];
    expect(ofreceReglaDeMonto(programas)).toBe(true);
  });
});

// Contra Supabase de verdad. La migración 0039 (exigir_monto_compra, monto_minimo_compra_centavos)
// TODAVÍA NO está aplicada en esta base (confirmado corriendo scripts/verificar-0039.ts el
// 2026-09-23: "column comercios.exigir_monto_compra does not exist"). Esta prueba se escribe y se
// deja en rojo por ESA razón a propósito — el plan (Tarea 9) difiere su verde a cuando Daniel
// aplique la migración a mano en Supabase Studio.
describe('leerReglaDeMonto (Supabase — pendiente de la migración 0039)', () => {
  const supabase = createServiceClient();
  const entorno = crearEntorno(supabase);

  afterAll(async () => {
    await entorno.limpiar();
  });

  it('lee exigir_monto_compra y monto_minimo_compra_centavos de un comercio existente', async () => {
    const comercioId = await entorno.crearComercio();
    // Las TRES columnas juntas: pedir_monto_compra, exigir_monto_compra y
    // monto_minimo_compra_centavos, o los CHECK de la 0039 (comercios_exigir_implica_pedir,
    // comercios_minimo_implica_exigir) rechazan el update.
    const { error } = await supabase
      .from('comercios')
      .update({ pedir_monto_compra: true, exigir_monto_compra: true, monto_minimo_compra_centavos: 1000 })
      .eq('id', comercioId);
    expect(error).toBeNull();

    const resultado = await leerReglaDeMonto(supabase, comercioId);
    expect(resultado).toEqual({ exigir: true, minimoCentavos: 1000 });
  });

  it('un id inexistente → null', async () => {
    const resultado = await leerReglaDeMonto(supabase, '00000000-0000-0000-0000-000000000000');
    expect(resultado).toBeNull();
  });
});

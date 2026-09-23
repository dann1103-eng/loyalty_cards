import { describe, it, expect, afterAll } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { validarMontoAcreditacion, ofreceReglaDeMonto, leerReglaDeMonto } from './montoAcreditacion';
// aplicaReglaDeMonto vive en el catálogo (lib/tarjetas/tipos.ts), no acá: ofreceReglaDeMonto la usa
// internamente para decidir qué programas cuentan, y la probamos junto a ella por eso — el campo y
// su función ya tienen su prueba canónica en lib/tarjetas/tipos.test.ts.
import { aplicaReglaDeMonto } from '../tarjetas/tipos';
import type { Programa } from './programas';

// Mutation-testing CONFIRMADO (2026-09-23), cada una restaurada después de corrida. Las pruebas de
// leerReglaDeMonto contra Supabase están en rojo hoy por la falta de la 0039 (ver el describe de
// más abajo) y por eso aparecen listadas como "cae también" en todas: no discriminan nada todavía,
// pero se documenta igual para que quede claro que no se rompió nada nuevo en ellas.
//
// - `<` → `<=` en la comparación del mínimo (paso 2): falla "1000 → ok: el mínimo es inclusivo" — el
//   mínimo exacto pasa a rechazarse con el error del mínimo.
// - Quitar `&& !autorizado` del paso 2: falla "999 autorizado → ok: la autorización saltea SOLO el
//   mínimo" — un autorizado bajo el mínimo vuelve a rechazarse.
// - `(exigir || minimoCentavos !== null)` → solo `exigir` (paso 1): falla "exigir false pero mínimo
//   1000 ... monto null → error de monto faltante igual" — un mínimo sin exigir deja de bastar por
//   sí solo para exigir el monto.
// - Quitar `|| !(montoCentavos > 0)` del paso 1 (deja solo `montoCentavos === null`): falla "monto 0
//   → el mismo error que null", "monto -1 → error de monto faltante" y las DOS pruebas de NaN (una
//   sin mínimo, una con mínimo 1000) — 4 pruebas.
// - Volver `!(montoCentavos > 0)` a `montoCentavos <= 0` (la versión vieja, insegura ante NaN): falla
//   las DOS pruebas de NaN ("monto NaN → ..." y "NaN → error de monto faltante (paso 1) ..."),
//   porque `NaN <= 0` da `false` y el NaN se cuela como si fuera válido.
// - `!(montoCentavos > 0)` → `montoCentavos === 0`: falla "monto -1 → error de monto faltante" y las
//   DOS pruebas de NaN — 3 pruebas (0 solo sigue andando por casualidad, -1 y NaN no).
// - Agregar `bloqueoLimite: true` también en el error del paso 1 (monto faltante): falla las 7
//   pruebas que aseveran ese objeto SIN esa clave (toEqual exacto: null, 0, -1, NaN sin mínimo, NaN
//   con mínimo 1000, el caso "mínimo sin exigir", y "autorizado pero sin monto").
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

    it('monto -1 → error de monto faltante: negativo tampoco es una compra', () => {
      expect(validarMontoAcreditacion({ exigir: true, minimoCentavos: null, montoCentavos: -1, autorizado: false }))
        .toEqual({ ok: false, error: 'Escribí el monto de la compra (por ejemplo 19.99).' });
    });

    it('monto NaN → error de monto faltante: NaN no es un número positivo', () => {
      // NaN es lo que centavosDesdeTexto/aEntero usan como marca de "no parseó" (Tarea 4,
      // lib/comercio/controlesAcreditacion.ts): si esta función lo dejara pasar como si fuera un
      // monto válido, un typo del dueño quedaría acreditando sin monto real.
      expect(validarMontoAcreditacion({ exigir: true, minimoCentavos: null, montoCentavos: NaN, autorizado: false }))
        .toEqual({ ok: false, error: 'Escribí el monto de la compra (por ejemplo 19.99).' });
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

    it('NaN → error de monto faltante (paso 1), no el error del mínimo (paso 2)', () => {
      // Con un mínimo real configurado, `NaN < minimoCentavos` también da false (toda comparación
      // con NaN es false), así que sin el chequeo `!(montoCentavos > 0)` del paso 1 esto se colaría
      // como `ok: true` — ni siquiera llegaría al paso 2 a rechazarse por el mínimo.
      expect(validarMontoAcreditacion({ exigir: true, minimoCentavos: 1000, montoCentavos: NaN, autorizado: false }))
        .toEqual({ ok: false, error: 'Escribí el monto de la compra (por ejemplo 19.99).' });
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

describe('aplicaReglaDeMonto (del catálogo, lib/tarjetas/tipos)', () => {
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
    // que le pasamos un `activo: false` de más para dejar constancia de que la función lo ignora —
    // tipado con el `Programa` real (lib/comercio/programas.ts) y no un objeto inventado, para que
    // este `Pick` no se desalinee si el tipo real cambia. Por una variable aparte, y no un literal
    // directo en la llamada: un literal inline con una propiedad de más rebota contra el chequeo de
    // propiedades excedentes de TypeScript, porque la firma de ofreceReglaDeMonto es
    // { tipoTarjeta: string }[].
    const programas: Pick<Programa, 'tipoTarjeta' | 'activo'>[] = [{ tipoTarjeta: 'sellos', activo: false }];
    expect(ofreceReglaDeMonto(programas)).toBe(true);
  });
});

// Contra Supabase de verdad. Las columnas de este módulo (exigir_monto_compra,
// monto_minimo_compra_centavos) llegan con la migración 0039, TODAVÍA NO aplicada en esta base
// (confirmado corriendo scripts/verificar-0039.ts el 2026-09-23). Hoy, de las tres pruebas de este
// describe, DOS quedan en rojo por esa razón — las dos que llaman a leerReglaDeMonto sobre un
// comercio que existe de verdad — y NO con el mismo error, porque cada una dispara una operación
// distinta de supabase-js:
// - "un comercio recién creado..." (el control positivo) llama a leerReglaDeMonto directo, que hace
//   un SELECT: ese SELECT sí llega a Postgres y vuelve con el 42703 real,
//   "column comercios.exigir_monto_compra does not exist".
// - "las tres columnas seteadas..." primero hace un UPDATE crudo (para setear la regla antes de
//   leerla): ese UPDATE lo rechaza PostgREST ANTES de tocar Postgres, comparando contra su caché de
//   esquema, con PGRST204 "Could not find the 'exigir_monto_compra' column of 'comercios' in the
//   schema cache" — nunca llega a ejecutar el SELECT de leerReglaDeMonto.
// La tercera (id inexistente) queda en VERDE hoy, pero por casualidad: el mismo 42703 del SELECT de
// leerReglaDeMonto también cae en el `if (error || !data) return null` que "no existe la fila" —
// por eso va DESPUÉS del control positivo, que es la prueba que de verdad demuestra que la lectura
// funciona (y en cuanto la 0039 esté aplicada, atrapa una mutación tipo `exigir: true` fijo, que el
// caso "id inexistente" no vería nunca: acá el resultado esperado también sería null). El plan
// (Tarea 9) difiere el verde de las dos primeras a cuando Daniel aplique la migración a mano en
// Supabase Studio.
describe('leerReglaDeMonto (Supabase — pendiente de la migración 0039)', () => {
  const supabase = createServiceClient();
  const entorno = crearEntorno(supabase);

  afterAll(async () => {
    await entorno.limpiar();
  });

  it('un comercio recién creado (sin configurar nada) → los defaults: exigir false, mínimo null', async () => {
    const comercioId = await entorno.crearComercio();
    const resultado = await leerReglaDeMonto(supabase, comercioId);
    expect(resultado).toEqual({ exigir: false, minimoCentavos: null });
  });

  it('las tres columnas seteadas juntas → exigir true, mínimo 1000', async () => {
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

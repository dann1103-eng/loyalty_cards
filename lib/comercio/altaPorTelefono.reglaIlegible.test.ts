import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { altaYAcreditacionPorTelefono } from './altaPorTelefono';

// altaYAcreditacionPorTelefono falla CERRADO cuando no puede leer la regla de monto del comercio
// (lib/comercio/altaPorTelefono.ts, bloque "Regla de monto..."): si `leerReglaDeMonto` devuelve
// null, rechaza con "No se pudo verificar la regla de monto. Probá de nuevo." SIN crear nada — la
// spec lo pide explícitamente ("falla hacia lo restrictivo: una falla de lectura acá casi seguro
// tumbaría el RPC igual", sección 2).
//
// Esa rama queda SIN PROBAR por otro archivo ahora que la migración 0039 está aplicada: antes, la
// cubrían de casualidad las 6 pruebas de altaPorTelefono.test.ts que estaban en rojo por la columna
// faltante (mismo mensaje de error, pero por una causa de infraestructura — la columna no existía —
// y no por el comportamiento que esta rama existe para proteger). Con la 0039 aplicada, esas 6
// pruebas corren en verde y ya no tocan este código en absoluto — este archivo es la única prueba
// que ejercita la rama de fallo hacia lo restrictivo.
//
// El truco que usa escanear/actions.test.ts para forzar esta misma rama SIN mockear nada (un
// comercioId que no resuelve ninguna fila) no sirve acá: en altaPorTelefono.ts, `obtenerPrograma`
// está scopeado por comercio_id y rechaza con "Esa tarjeta no es de tu comercio." ANTES de llegar a
// `leerReglaDeMonto` — no hay forma de llegar a la lectura de la regla con un comercioId que no
// resuelva ningún programa de verdad.
//
// Por eso este archivo mockea `leerReglaDeMonto` directamente (con el `importOriginal` que pasa
// `vi.mock`, para conservar `validarMontoAcreditacion` y el resto del módulo real — no es lo que se
// está probando acá, y duplicarlo a mano sería otra copia de la regla que se puede desalinear).
// Corre VERDE HOY, sin depender de la 0039: no toca ninguna de las columnas nuevas.
//
// MUTACIONES CONFIRMADAS (2026-09-23):
//   - Fallar ABIERTO en vez de CERRADO (en altaPorTelefono.ts, cambiar el `if (regla === null)
//     return {...}` por algo como `const reglaEfectiva = regla ?? { exigir: false, minimoCentavos:
//     null }` y seguir de largo con esa regla vacía) hace fallar esta prueba: en vez del rechazo,
//     devuelve `{ ok: true, ... }` — el alta se acredita sin ninguna regla, que es justo el defecto
//     que la spec pide evitar.
//   - Mover la lectura de la regla (el bloque entero) a DESPUÉS de `registrarCliente` en vez de
//     antes hace fallar la aserción de que NO existe cliente: el mensaje de error sigue siendo el
//     mismo, pero el cliente ya se creó antes de que la lectura fallara.
//   Corridas y restauradas.
vi.mock('./montoAcreditacion', async (importOriginal) => {
  const original = await importOriginal<typeof import('./montoAcreditacion')>();
  return {
    ...original,
    leerReglaDeMonto: async () => null,
  };
});

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

afterEach(async () => {
  await entorno.limpiar();
});

function telefonoUnico(): string {
  return `+503${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0')}`;
}

describe('altaYAcreditacionPorTelefono — la regla de monto falla hacia lo restrictivo si no se puede leer', () => {
  it('con leerReglaDeMonto mockeada a null: rechaza con el mensaje exacto y NO crea el cliente', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    const programaId = entorno.obtenerProgramaPrincipal(comercioId);
    const telefono = telefonoUnico();

    const res = await altaYAcreditacionPorTelefono(supabase, comercioId, {
      telefono,
      nombre: 'Cliente Delivery',
      programaId,
      cantidad: 1,
    });

    expect(res).toEqual({ ok: false, error: 'No se pudo verificar la regla de monto. Probá de nuevo.' });

    const { data: cliente, error } = await supabase
      .from('clientes')
      .select('id')
      .eq('telefono', telefono)
      .maybeSingle();
    if (error) throw error;
    expect(cliente, 'la falla de lectura rechaza sin crear nada').toBeNull();
  });
});

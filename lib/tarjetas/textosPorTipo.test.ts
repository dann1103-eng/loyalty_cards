// Mutaciones CONFIRMADAS de la Tarea 6b del plan Wallet/logos (corridas y revertidas a mano el
// 2026-09-23; cada línea copia lo que VITEST imprimió en la corrida real, no lo que se esperaba):
//
// - (b) En FRASE_BILLETERA, `google: 'tu Apple Wallet'` (la frase de Google vuelve a nombrar a
//   Apple) → caen 2 pruebas: "la promesa de la tarjeta lista nombra la billetera que se le pasa,
//   con la frase exacta", con `Expected: "Agrégala a tu Google Wallet y empieza a juntar tus sellos
//   hoy."` / `Received: "Agrégala a tu Apple Wallet y empieza a juntar tus sellos hoy."`, y "con
//   Google o con los dos botones, ningún tipo dice "Apple"; …", con `puntos: expected 'Agrégala a
//   tu Apple Wallet y empieza …' not to contain 'Apple'`.
// - (d) Borrar la cola de `membresia` en COLA_TARJETA_LISTA → cae 1 prueba: "las siete tablas
//   cubren los OCHO tipos, …", con `promesa tarjeta lista de membresia con apple: expected
//   'Agrégala a tu Apple Wallet y undefined' not to contain 'undefined'`. La MISMA mutación sin el
//   renglón `not.toContain('undefined')` del guardián → 40/40 en verde: el `toBeTruthy()` solo no
//   la ve, porque la cola que falta llega interpolada.
// - (a) y (c), sobre `billeteraDeEntrada`, están en lib/clientes/plataforma.test.ts.
import { describe, it, expect } from 'vitest';
import { TIPOS } from './tipos';
import type { BilleteraDeEntrada } from '../clientes/plataforma';
import {
  textoAtajoEscanear,
  textoAtajoReglas,
  promesaRegistro,
  promesaTarjetaLista,
  placeholderInactividad,
  placeholderCercania,
  rotuloTarjeta,
} from './textosPorTipo';

// Las tres billeteras que puede nombrar `promesaTarjetaLista` (ver `billeteraDeEntrada` en
// lib/clientes/plataforma.ts). La lista es local a la prueba a propósito: la completitud de las
// FRASES ya la obliga el compilador (`Record<BilleteraDeEntrada, string>`); esta lista solo decide
// con qué billeteras se recorren los ocho tipos.
const BILLETERAS: readonly BilleteraDeEntrada[] = ['apple', 'google', 'ambas'];

// La razón de ser del módulo: hasta el 2026-09-08 estos textos estaban cableados a sellos o a
// puntos, así que los OTROS SEIS tipos leían una mecánica que su tarjeta no tiene. El caso que lo
// destapó: un comercio de membresía cuyo panel le decía "Sumá sellos/puntos o canjeá premios".
describe('textosPorTipo', () => {
  // EL guardián. Un tipo nuevo en TIPOS sin su texto acá rompe esta prueba, no la produccion.
  // Funciona porque la búsqueda en cada tabla es DIRECTA (`tabla[tipo.valor]`): el único fallback
  // es el de `tipoOPuntos`, que solo actúa sobre un valor que no está en el catálogo. Un tipo del
  // catálogo sin entrada devuelve undefined y revienta acá, en vez de heredar el texto de puntos.
  //
  // `promesaTarjetaLista` va aparte porque recibe la billetera, y porque ARMA la frase: la cola que
  // le falte a un tipo no llega como undefined sino INTERPOLADA ("… y undefined"), que es un texto
  // truthy. Por eso a ella se le exige además que no diga "undefined" —— sin ese renglón, sacarle la
  // cola a un tipo dejaba esta prueba en verde (mutación (d) del encabezado de este archivo).
  it('las siete tablas cubren los OCHO tipos, sin heredar el de puntos por descuido', () => {
    for (const tipo of TIPOS) {
      for (const [nombre, fn] of [
        ['atajo escanear', textoAtajoEscanear], ['atajo reglas', textoAtajoReglas],
        ['promesa registro', promesaRegistro],
        ['placeholder inactividad', placeholderInactividad],
        ['placeholder cercania', placeholderCercania], ['rotulo tarjeta', rotuloTarjeta],
      ] as const) {
        const texto = fn(tipo.valor);
        expect(texto, `${nombre} de ${tipo.valor}`).toBeTruthy();
      }
      for (const billetera of BILLETERAS) {
        const texto = promesaTarjetaLista(tipo.valor, billetera);
        const rotulo = `promesa tarjeta lista de ${tipo.valor} con ${billetera}`;
        expect(texto, rotulo).toBeTruthy();
        expect(texto, rotulo).not.toContain('undefined');
      }
    }
  });

  it('membresía no habla de sumar, de sellos ni de premios en ningún texto', () => {
    // MUTACIÓN: devolver el texto de 'puntos' en el default de cualquier tabla rompe esta prueba.
    const textos = [
      textoAtajoEscanear, textoAtajoReglas, promesaRegistro,
      placeholderInactividad, placeholderCercania, rotuloTarjeta,
    ].map((f) => f('membresia'));
    for (const billetera of BILLETERAS) textos.push(promesaTarjetaLista('membresia', billetera));
    for (const t of textos) {
      expect(t.toLowerCase()).not.toMatch(/sello|punto|premio|sum[áa]|acumul/);
    }
  });

  // Tarea 6b del plan de Wallet/logos. Hasta el 2026-09-23 la pantalla "Tu tarjeta está lista"
  // decía "Agrégala a tu Apple Wallet…" en TODAS las plataformas: un cliente de Android leía
  // "Apple Wallet" justo encima del único botón que veía, que era el de Google.
  it('la promesa de la tarjeta lista nombra la billetera que se le pasa, con la frase exacta', () => {
    expect(promesaTarjetaLista('sellos', 'apple')).toBe(
      'Agrégala a tu Apple Wallet y empieza a juntar tus sellos hoy.',
    );
    expect(promesaTarjetaLista('sellos', 'google')).toBe(
      'Agrégala a tu Google Wallet y empieza a juntar tus sellos hoy.',
    );
    expect(promesaTarjetaLista('sellos', 'ambas')).toBe(
      'Agrégala a la billetera de tu teléfono y empieza a juntar tus sellos hoy.',
    );
  });

  it('con Google o con los dos botones, ningún tipo dice "Apple"; con Apple, ninguno dice "Google"', () => {
    for (const tipo of TIPOS) {
      expect(promesaTarjetaLista(tipo.valor, 'google'), tipo.valor).not.toContain('Apple');
      expect(promesaTarjetaLista(tipo.valor, 'ambas'), tipo.valor).not.toContain('Apple');
      expect(promesaTarjetaLista(tipo.valor, 'ambas'), tipo.valor).not.toContain('Google');
      expect(promesaTarjetaLista(tipo.valor, 'apple'), tipo.valor).not.toContain('Google');
    }
  });

  it('cada tipo dice lo suyo: renovar en membresía, canjear en cupón, saldo en gift card', () => {
    expect(textoAtajoEscanear('membresia').toLowerCase()).toContain('renov');
    expect(textoAtajoEscanear('cupon').toLowerCase()).toContain('cup');
    expect(textoAtajoEscanear('gift_card').toLowerCase()).toContain('saldo');
    expect(rotuloTarjeta('membresia')).toBe('Membresía');
  });

  // El rótulo NO es una tabla propia: sale de `TIPOS`, que es el catálogo que el dueño ya ve al
  // elegir su programa. Si divergieran, la pantalla de registro le diría a su cliente una palabra
  // distinta de la que él eligió.
  it('el rótulo de la tarjeta es la etiqueta del catálogo, no una copia', () => {
    for (const tipo of TIPOS) {
      expect(rotuloTarjeta(tipo.valor), tipo.valor).toBe(tipo.etiqueta);
    }
  });

  it('un tipo desconocido cae al de puntos, nunca a undefined', () => {
    // Mismo criterio que tipoOPuntos: una fila vieja de la BD no puede dejar una pantalla en blanco.
    expect(textoAtajoEscanear('inventado')).toBe(textoAtajoEscanear('puntos'));
    expect(promesaRegistro('inventado')).toBe(promesaRegistro('puntos'));
    expect(promesaTarjetaLista('inventado', 'google')).toBe(promesaTarjetaLista('puntos', 'google'));
    expect(rotuloTarjeta('inventado')).toBe(rotuloTarjeta('puntos'));
  });
});

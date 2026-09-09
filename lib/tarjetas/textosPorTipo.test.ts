import { describe, it, expect } from 'vitest';
import { TIPOS } from './tipos';
import {
  textoAtajoEscanear,
  textoAtajoReglas,
  promesaRegistro,
  promesaTarjetaLista,
  placeholderInactividad,
  placeholderCercania,
  rotuloTarjeta,
} from './textosPorTipo';

// La razón de ser del módulo: hasta el 2026-09-08 estos textos estaban cableados a sellos o a
// puntos, así que los OTROS SEIS tipos leían una mecánica que su tarjeta no tiene. El caso que lo
// destapó: un comercio de membresía cuyo panel le decía "Sumá sellos/puntos o canjeá premios".
describe('textosPorTipo', () => {
  // EL guardián. Un tipo nuevo en TIPOS sin su texto acá rompe esta prueba, no la produccion.
  // Funciona porque la búsqueda en cada tabla es DIRECTA (`tabla[tipo.valor]`): el único fallback
  // es el de `tipoOPuntos`, que solo actúa sobre un valor que no está en el catálogo. Un tipo del
  // catálogo sin entrada devuelve undefined y revienta acá, en vez de heredar el texto de puntos.
  it('las siete tablas cubren los OCHO tipos, sin heredar el de puntos por descuido', () => {
    for (const tipo of TIPOS) {
      for (const [nombre, fn] of [
        ['atajo escanear', textoAtajoEscanear], ['atajo reglas', textoAtajoReglas],
        ['promesa registro', promesaRegistro], ['promesa tarjeta lista', promesaTarjetaLista],
        ['placeholder inactividad', placeholderInactividad],
        ['placeholder cercania', placeholderCercania], ['rotulo tarjeta', rotuloTarjeta],
      ] as const) {
        const texto = fn(tipo.valor);
        expect(texto, `${nombre} de ${tipo.valor}`).toBeTruthy();
      }
    }
  });

  it('membresía no habla de sumar, de sellos ni de premios en ningún texto', () => {
    // MUTACIÓN: devolver el texto de 'puntos' en el default de cualquier tabla rompe esta prueba.
    const textos = [
      textoAtajoEscanear, textoAtajoReglas, promesaRegistro, promesaTarjetaLista,
      placeholderInactividad, placeholderCercania, rotuloTarjeta,
    ].map((f) => f('membresia').toLowerCase());
    for (const t of textos) {
      expect(t).not.toMatch(/sello|punto|premio|sum[áa]|acumul/);
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
    expect(rotuloTarjeta('inventado')).toBe(rotuloTarjeta('puntos'));
  });
});

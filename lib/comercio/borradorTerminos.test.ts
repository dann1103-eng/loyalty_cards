import { describe, it, expect } from 'vitest';
import { TIPOS } from '../tarjetas/tipos';
import { borradorTerminos } from './borradorTerminos';

// El borrador de términos que el dueño inserta con un botón en Marca y que termina, tal cual, en el
// reverso de la tarjeta de cada uno de sus clientes.
//
// Hasta el 2026-08-07 era UN SOLO texto con `esSellos ? 'sellos' : 'puntos'` metido adentro. O sea
// que a un comercio de gift card le proponía escribir en la tarjeta de sus clientes:
//
//   "1. Los puntos no tienen valor monetario y no se canjean por efectivo."
//   "2. Los puntos no vencen."
//
// La primera línea es FALSA en una gift card —el saldo es plata, ese es el producto— y la segunda
// es falsa en un cupón y en una membresía, que vencen por diseño. Texto cuasi-legal equivocado en
// la tarjeta de un cliente no es un problema de redacción.

const COMERCIO = 'Cafetería La Esquina';

describe('borradorTerminos', () => {
  it('en sellos habla de sellos, y en prepago de visitas', () => {
    expect(borradorTerminos('sellos', COMERCIO)).toContain('Los sellos no tienen valor monetario');
    expect(borradorTerminos('puntos', COMERCIO)).toContain('Los puntos no tienen valor monetario');
    expect(borradorTerminos('prepago', COMERCIO)).toContain('Las visitas no tienen valor monetario');
  });

  it('una gift card NO dice que el saldo no tiene valor monetario', () => {
    // Es el producto entero: el cliente pagó por ese saldo. Lo que sí es cierto y protege al
    // comercio es que se usa solo ahí y no se devuelve en efectivo.
    const texto = borradorTerminos('gift_card', COMERCIO);

    expect(texto).not.toContain('no tienen valor monetario');
    expect(texto).not.toContain('puntos');
    expect(texto).toContain('saldo');
    expect(texto).toContain('efectivo');
  });

  it('un cupón NO dice que no vence: vence por diseño', () => {
    const texto = borradorTerminos('cupon', COMERCIO);

    expect(texto).not.toContain('no vencen');
    expect(texto).toContain('vence');
    expect(texto).not.toContain('puntos');
  });

  it('una membresía tampoco', () => {
    const texto = borradorTerminos('membresia', COMERCIO);

    expect(texto).not.toContain('no vencen');
    expect(texto).not.toContain('puntos');
  });

  it('cada línea va numerada y en orden, sin saltos', () => {
    // El dueño lo pega tal cual: una numeración con huecos se ve descuidada en la tarjeta.
    for (const tipo of TIPOS) {
      const lineas = borradorTerminos(tipo.valor, COMERCIO).split('\n');
      lineas.forEach((linea, i) => {
        expect(linea, `el tipo "${tipo.valor}" numeró mal la línea ${i + 1}`).toMatch(
          new RegExp(`^${i + 1}\\. `),
        );
      });
    }
  });

  it('TODO tipo del catálogo produce un borrador con el nombre del comercio', () => {
    // El candado contra que un tipo nuevo herede el texto de puntos en silencio, que es como nació
    // este bug.
    for (const tipo of TIPOS) {
      const texto = borradorTerminos(tipo.valor, COMERCIO);
      expect(texto.length, `el tipo "${tipo.valor}" no produjo borrador`).toBeGreaterThan(0);
      expect(texto, `el tipo "${tipo.valor}" no nombra al comercio`).toContain(COMERCIO);
    }
  });

  it('nunca promete algo que el tipo no puede cumplir', () => {
    // La regla de fondo, aplicada a los ocho de una: solo los tipos SIN vigencia pueden decir que
    // no vencen, y solo los que no son dinero pueden decir que no valen plata.
    for (const tipo of TIPOS) {
      const texto = borradorTerminos(tipo.valor, COMERCIO);
      if (tipo.usaVigencia) {
        expect(texto, `"${tipo.valor}" vence, no puede decir que no`).not.toContain('no vencen');
      }
      if (tipo.contador === 'centavos') {
        expect(texto, `"${tipo.valor}" ES dinero`).not.toContain('no tienen valor monetario');
      }
    }
  });
});

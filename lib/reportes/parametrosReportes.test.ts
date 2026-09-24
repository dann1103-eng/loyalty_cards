import { describe, it, expect } from 'vitest';
import { leerParametrosReportes } from './parametrosReportes';

// Prueba PURA (sin base). El contrato: la página (que recibe el objeto de Next) y la ruta del Excel
// (que recibe URLSearchParams) leen EXACTAMENTE lo mismo de la misma URL. Si no, la pantalla y el
// Excel filtrarían distinto: el caso real es `?comercio=a&comercio=b`, que en la ruta daría `a` con
// `.get()` y en la página caería a "Todo".
//
// MUTATION-TESTING (corridas el 2026-09-23, con el mensaje que se vio caer):
// - Rama URLSearchParams: `valores.length === 1 ? valores[0] : undefined` → `entrada.get(clave) ??
//   undefined` (la clave repetida tomada como su PRIMER valor, lo que haría `.get()`). Caen "una clave
//   repetida es inválida en URLSearchParams" con `expected { periodo: '7d', comercio: 'a' } to deeply
//   equal { periodo: '7d' }`, y "el objeto de Next y URLSearchParams dan EXACTAMENTE lo mismo" con
//   `comercio=a&comercio=b&periodo=7d: expected { periodo: '7d' } to deeply equal { periodo: '7d',
//   comercio: 'a' }`.
// - Rama objeto de Next: `valor.length === 1 ? valor[0] : undefined` → `valor[0]`. Caen "una clave
//   repetida es inválida en el objeto de Next" con `expected { periodo: '7d', comercio: 'a' } to
//   deeply equal { periodo: '7d' }`, y la de "EXACTAMENTE lo mismo" con el mismo par invertido.

// Arma el objeto que Next le pasa a una página para una querystring: una clave que aparece una vez
// llega como string; repetida, como arreglo (docs de Next 16, `searchParams`).
function comoNext(query: string): Record<string, string | string[] | undefined> {
  const usp = new URLSearchParams(query);
  const salida: Record<string, string | string[] | undefined> = {};
  for (const clave of new Set(usp.keys())) {
    const valores = usp.getAll(clave);
    salida[clave] = valores.length === 1 ? valores[0] : valores;
  }
  return salida;
}

describe('leerParametrosReportes', () => {
  const completa =
    'periodo=rango&desde=2026-09-01&hasta=2026-09-20&comercio=c-1&sucursal=s-1&cajero=u-1' +
    '&orden=premios&dir=asc&pagina=3';

  it('lee las nueve claves de URLSearchParams', () => {
    expect(leerParametrosReportes(new URLSearchParams(completa))).toEqual({
      periodo: 'rango',
      desde: '2026-09-01',
      hasta: '2026-09-20',
      comercio: 'c-1',
      sucursal: 's-1',
      cajero: 'u-1',
      orden: 'premios',
      dir: 'asc',
      pagina: '3',
    });
  });

  it('el objeto de Next y URLSearchParams dan EXACTAMENTE lo mismo', () => {
    for (const query of [completa, '', 'periodo=hoy', 'comercio=a&comercio=b&periodo=7d', 'desde=&hasta=']) {
      expect(leerParametrosReportes(comoNext(query)), query).toEqual(
        leerParametrosReportes(new URLSearchParams(query)),
      );
    }
  });

  it('una clave repetida es inválida en URLSearchParams (no se toma el primer valor)', () => {
    expect(leerParametrosReportes(new URLSearchParams('comercio=a&comercio=b&periodo=7d'))).toEqual({
      periodo: '7d',
    });
  });

  it('una clave repetida es inválida en el objeto de Next (llega como arreglo)', () => {
    expect(leerParametrosReportes({ comercio: ['a', 'b'], periodo: '7d' })).toEqual({ periodo: '7d' });
  });

  it('un arreglo de UN valor es ese valor, como URLSearchParams con la clave una sola vez', () => {
    expect(leerParametrosReportes({ comercio: ['a'] })).toEqual({ comercio: 'a' });
  });

  it('ignora las claves que no son de reportes y las ausentes', () => {
    expect(leerParametrosReportes({ otra: 'x', periodo: undefined, utm_source: ['a', 'b'] })).toEqual({});
    expect(leerParametrosReportes(new URLSearchParams('otra=x'))).toEqual({});
  });

  it('deja el texto tal cual (la validación es de resolverFiltrosReportes)', () => {
    expect(leerParametrosReportes(new URLSearchParams('periodo=cualquiera&pagina=-4&desde='))).toEqual({
      periodo: 'cualquiera',
      pagina: '-4',
      desde: '',
    });
  });
});

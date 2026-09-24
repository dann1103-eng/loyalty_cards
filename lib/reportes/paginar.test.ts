import { describe, it, expect } from 'vitest';
import { paginarPorOffset, paginarPorRango, TOPE_FILAS, type PaginaPorOffset } from './paginar';

// Prueba PURA de los dos bucles del Excel (spec §4, "Sin el tope de 1000 filas"). Son dos mecanismos
// que NO se mezclan, y cada falso de acá se comporta como el lado real:
//   - reporte_clientes se pagina SOLO con su p_offset, y la SQL ACOTA el offset con el total (una
//     página más allá del final devuelve la última otra vez). Cortar con "recibí menos que el tamaño"
//     repetiría la última página cuando el total es múltiplo exacto del tamaño.
//   - el resto, con .range() de PostgREST, que más allá del final devuelve vacío.
//
// MUTATION-TESTING (corridas el 2026-09-23, con el mensaje que se vio caer):
// - paginarPorOffset cortando con "< tamaño" (sin el chequeo de offsetEfectivo y con `if
//   (pagina.filas.length < tamano) break` en lugar del corte por total): caen "total igual al tamaño
//   de página" con `expected 50000 to be 2`, "total igual al DOBLE del tamaño" con `expected 50000 to
//   be 4` y "si la SQL devuelve otra página que la pedida" con `expected 50000 to be 2`: repite la
//   última página hasta el tope.
// - Solo sin el chequeo de offsetEfectivo (el corte por total queda): cae "si la SQL devuelve otra
//   página que la pedida…" con `expected 4 to be 2`.
// - paginarPorOffset sin el tope: cae "corta en 50000 filas y lo avisa" con `expected 60000 to be
//   50000`. paginarPorRango sin el tope: la suya, con el mismo mensaje.
// - paginarPorRango cortando solo con la página vacía (`pagina.length === 0`): cae "no múltiplo:
//   corta en la página corta" con `expected 4 to be 3` (una llamada de más).

// Un reporte_clientes falso que acota el offset EXACTAMENTE como la 0040:
//   least(greatest(p_offset, 0), greatest(((total - 1) / limite) * limite, 0))   (división entera)
// con p_limite acotado a [1, 1000]. Registra los offsets pedidos.
function clientesFalso(total: number) {
  const pedidos: number[] = [];
  const llamar = async (offset: number, limite: number): Promise<PaginaPorOffset<number>> => {
    pedidos.push(offset);
    const lim = Math.min(Math.max(limite, 1), 1000);
    const efectivo = Math.min(Math.max(offset, 0), Math.max(Math.trunc((total - 1) / lim) * lim, 0));
    const filas = Array.from({ length: Math.max(0, Math.min(lim, total - efectivo)) }, (_, i) => efectivo + i);
    return { filas, total, offsetEfectivo: efectivo };
  };
  return { llamar, pedidos };
}

// Una función con .range(inicio, fin) falsa: inclusiva en los dos bordes, vacía más allá del final.
function rangoFalso(total: number) {
  const pedidos: [number, number][] = [];
  const llamar = async (inicio: number, fin: number): Promise<number[]> => {
    pedidos.push([inicio, fin]);
    return Array.from({ length: Math.max(0, Math.min(fin, total - 1) - inicio + 1) }, (_, i) => inicio + i);
  };
  return { llamar, pedidos };
}

const secuencia = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('paginarPorOffset (reporte_clientes)', () => {
  it('total 0: una sola llamada, sin filas', async () => {
    const falso = clientesFalso(0);
    expect(await paginarPorOffset(falso.llamar, 2)).toEqual({ filas: [], alcanzoTope: false });
    expect(falso.pedidos).toEqual([0]);
  });

  it('total igual al tamaño de página: una llamada, sin repetir', async () => {
    const falso = clientesFalso(2);
    const resultado = await paginarPorOffset(falso.llamar, 2);
    expect(resultado?.filas.length).toBe(2);
    expect(resultado).toEqual({ filas: [0, 1], alcanzoTope: false });
    expect(falso.pedidos).toEqual([0]);
  });

  it('total igual al DOBLE del tamaño: dos llamadas, cada fila una vez', async () => {
    const falso = clientesFalso(4);
    const resultado = await paginarPorOffset(falso.llamar, 2);
    expect(resultado?.filas.length).toBe(4);
    expect(resultado).toEqual({ filas: [0, 1, 2, 3], alcanzoTope: false });
    expect(falso.pedidos).toEqual([0, 2]);
  });

  it('total que no es múltiplo: la última página viene corta', async () => {
    const falso = clientesFalso(5);
    expect(await paginarPorOffset(falso.llamar, 2)).toEqual({ filas: secuencia(5), alcanzoTope: false });
    expect(falso.pedidos).toEqual([0, 2, 4]);
  });

  it('si la SQL devuelve otra página que la pedida (el total bajó entre llamadas), corta sin repetir', async () => {
    // La segunda llamada ve un total de 2 (desaparecieron filas en el medio): la SQL acota el offset
    // pedido, 2, a 0, y devuelve la primera página otra vez. `offsetEfectivo !== offset` lo delata;
    // el corte por total no alcanza, porque 2 + 2 >= 2 recién se evalúa DESPUÉS de sumar las filas.
    // Desde la segunda llamada, la SQL ya ve total 2 y responde siempre así.
    let llamadas = 0;
    const llamar = async (): Promise<PaginaPorOffset<number>> => {
      llamadas += 1;
      return llamadas === 1
        ? { filas: [0, 1], total: 4, offsetEfectivo: 0 }
        : { filas: [0, 1], total: 2, offsetEfectivo: 0 };
    };
    const resultado = await paginarPorOffset(llamar, 2);
    expect(resultado?.filas.length).toBe(2);
    expect(resultado).toEqual({ filas: [0, 1], alcanzoTope: false });
  });

  it('un error en cualquier página es null (nunca un Excel a medias)', async () => {
    let llamada = 0;
    const llamar = async (): Promise<PaginaPorOffset<number> | null> => {
      llamada += 1;
      return llamada === 1 ? { filas: [0, 1], total: 4, offsetEfectivo: 0 } : null;
    };
    expect(await paginarPorOffset(llamar, 2)).toBeNull();
  });

  it(`corta en ${TOPE_FILAS} filas y lo avisa`, async () => {
    expect(TOPE_FILAS).toBe(50_000);
    const falso = clientesFalso(60_000);
    const resultado = await paginarPorOffset(falso.llamar, 1000);
    expect(resultado?.filas.length).toBe(50_000);
    expect(resultado?.filas[49_999]).toBe(49_999);
    expect(resultado?.alcanzoTope).toBe(true);
    expect(falso.pedidos.length).toBe(50); // no sigue pidiendo después del tope
  });

  it('un tamaño que no es un entero positivo es un error de programación', async () => {
    const falso = clientesFalso(3);
    await expect(paginarPorOffset(falso.llamar, 0)).rejects.toThrow('tamaño de página inválido: 0');
    await expect(paginarPorOffset(falso.llamar, 1.5)).rejects.toThrow('tamaño de página inválido: 1.5');
  });
});

describe('paginarPorRango (las demás funciones, con .range())', () => {
  it('total 0: una sola llamada, sin filas', async () => {
    const falso = rangoFalso(0);
    expect(await paginarPorRango(falso.llamar, 2)).toEqual({ filas: [], alcanzoTope: false });
    expect(falso.pedidos).toEqual([[0, 1]]);
  });

  it('múltiplo exacto: la página vacía del final corta, sin repetir', async () => {
    const falso = rangoFalso(4);
    expect(await paginarPorRango(falso.llamar, 2)).toEqual({ filas: [0, 1, 2, 3], alcanzoTope: false });
    expect(falso.pedidos).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });

  it('no múltiplo: corta en la página corta', async () => {
    const falso = rangoFalso(5);
    expect(await paginarPorRango(falso.llamar, 2)).toEqual({ filas: secuencia(5), alcanzoTope: false });
    expect(falso.pedidos.length).toBe(3);
  });

  it('un error en cualquier página es null', async () => {
    let llamada = 0;
    const llamar = async (inicio: number): Promise<number[] | null> => {
      llamada += 1;
      return llamada === 1 ? [inicio, inicio + 1] : null;
    };
    expect(await paginarPorRango(llamar, 2)).toBeNull();
  });

  it(`corta en ${TOPE_FILAS} filas y lo avisa`, async () => {
    const falso = rangoFalso(60_000);
    const resultado = await paginarPorRango(falso.llamar, 1000);
    expect(resultado?.filas.length).toBe(50_000);
    expect(resultado?.alcanzoTope).toBe(true);
    expect(falso.pedidos.length).toBe(50);
  });

  it('un tamaño que no es un entero positivo es un error de programación', async () => {
    const falso = rangoFalso(3);
    await expect(paginarPorRango(falso.llamar, -1)).rejects.toThrow('tamaño de página inválido: -1');
  });
});

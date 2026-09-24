import { describe, it, expect } from 'vitest';
import { sumarTendencias, fusionarTopClientes } from './agregados';

// MUTATION-TESTING: el contrato son dos cosas — sumar día a día entre series y devolverlas en orden
// ascendente por día. La mutación interesante es la tercera: sin la copia `{ ...fila }`, el Map se
// queda con la MISMA fila que entró y sumar la muta; como los RPC devuelven arreglos nuevos por
// request nadie lo notaría en producción hasta que dos series compartan objeto. La atrapa
// "no muta las series de entrada" (verificada: falla con acreditaciones 1 → 2).
describe('sumarTendencias', () => {
  it('suma día a día entre series y ordena ascendente', () => {
    const a = [
      { dia: '2026-07-24', operaciones: 2, canjes: 1 },
      { dia: '2026-07-25', operaciones: 3, canjes: 0 },
    ];
    const b = [
      { dia: '2026-07-25', operaciones: 1, canjes: 2 },
      { dia: '2026-07-23', operaciones: 5, canjes: 0 },
    ];
    expect(sumarTendencias([a, b])).toEqual([
      { dia: '2026-07-23', operaciones: 5, canjes: 0 },
      { dia: '2026-07-24', operaciones: 2, canjes: 1 },
      { dia: '2026-07-25', operaciones: 4, canjes: 2 },
    ]);
  });

  it('sin series devuelve vacío', () => {
    expect(sumarTendencias([])).toEqual([]);
  });

  it('no muta las series de entrada', () => {
    const a = [{ dia: '2026-07-25', operaciones: 1, canjes: 1 }];
    sumarTendencias([a, a]);
    expect(a[0]).toEqual({ dia: '2026-07-25', operaciones: 1, canjes: 1 });
  });
});

// (Las pruebas de resolverFiltrosReportes se mudaron con la función a filtrosReportes.test.ts.)

// MUTATION-TESTING: el orden es el contrato (visitas desc, puntos como desempate — el MISMO
// criterio que la SQL de reporte_top_clientes). Mutación a atrapar: invertir el sort.
describe('fusionarTopClientes', () => {
  const fila = (nombre: string, visitas: number, puntos: number) => ({
    cliente_id: `id-${nombre}`,
    cliente_nombre: nombre,
    visitas,
    puntos_totales: puntos,
  });

  it('ordena por visitas desc con puntos como desempate, corta al límite y etiqueta el comercio', () => {
    const res = fusionarTopClientes(
      [
        { comercioId: 'c-cafe', comercioNombre: 'Café', filas: [fila('Ana', 5, 10), fila('Beto', 3, 99)] },
        { comercioId: 'c-spa', comercioNombre: 'Spa', filas: [fila('Caro', 5, 20), fila('Dani', 1, 1)] },
      ],
      3,
    );
    expect(res.map((r) => [r.cliente_nombre, r.comercio_nombre])).toEqual([
      ['Caro', 'Spa'], // 5 visitas y 20 pts: gana el desempate contra Ana (5 y 10)
      ['Ana', 'Café'],
      ['Beto', 'Café'],
    ]);
  });

  it('lleva el comercio_id: dos comercios HOMÓNIMOS no colisionan en la key de React', () => {
    // comercios.nombre no tiene unique (solo el slug, migración 0001): dos comercios del mismo dueño
    // pueden llamarse igual. La página arma la key con `${comercio_id}-${cliente_id}`; si se armara
    // con el nombre, un mismo cliente en ambos daría dos filas con la MISMA key y React reciclaría
    // filas mal. Este test asserta la key COMPLETA, no solo que el campo exista.
    const res = fusionarTopClientes(
      [
        { comercioId: 'c-1', comercioNombre: 'Café', filas: [fila('Ana', 5, 10)] },
        { comercioId: 'c-2', comercioNombre: 'Café', filas: [fila('Ana', 4, 10)] },
      ],
      5,
    );
    expect(res.map((r) => `${r.comercio_id}-${r.cliente_id}`)).toEqual(['c-1-id-Ana', 'c-2-id-Ana']);
  });

  it('límite 0 devuelve vacío', () => {
    expect(
      fusionarTopClientes([{ comercioId: 'c-x', comercioNombre: 'X', filas: [fila('A', 1, 1)] }], 0),
    ).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { sumarTendencias, fusionarTopClientes, resolverFiltrosReportes } from './agregados';

// MUTATION-TESTING: el contrato son dos cosas — sumar día a día entre series y devolverlas en orden
// ascendente por día. La mutación interesante es la tercera: sin la copia `{ ...fila }`, el Map se
// queda con la MISMA fila que entró y sumar la muta; como los RPC devuelven arreglos nuevos por
// request nadie lo notaría en producción hasta que dos series compartan objeto. La atrapa
// "no muta las series de entrada" (verificada: falla con acreditaciones 1 → 2).
describe('sumarTendencias', () => {
  it('suma día a día entre series y ordena ascendente', () => {
    const a = [
      { dia: '2026-07-24', acreditaciones: 2, canjes: 1 },
      { dia: '2026-07-25', acreditaciones: 3, canjes: 0 },
    ];
    const b = [
      { dia: '2026-07-25', acreditaciones: 1, canjes: 2 },
      { dia: '2026-07-23', acreditaciones: 5, canjes: 0 },
    ];
    expect(sumarTendencias([a, b])).toEqual([
      { dia: '2026-07-23', acreditaciones: 5, canjes: 0 },
      { dia: '2026-07-24', acreditaciones: 2, canjes: 1 },
      { dia: '2026-07-25', acreditaciones: 4, canjes: 2 },
    ]);
  });

  it('sin series devuelve vacío', () => {
    expect(sumarTendencias([])).toEqual([]);
  });

  it('no muta las series de entrada', () => {
    const a = [{ dia: '2026-07-25', acreditaciones: 1, canjes: 1 }];
    sumarTendencias([a, a]);
    expect(a[0]).toEqual({ dia: '2026-07-25', acreditaciones: 1, canjes: 1 });
  });
});

// MUTATION-TESTING: resolverFiltrosReportes es el candado de la fila "Filtros de reportes validados
// contra membresías" (tabla §5 del spec). Vive acá, en una función pura, JUSTAMENTE para poder
// mutarlo — validado inline en la página no habría forma de testearlo (el repo no testea páginas).
describe('resolverFiltrosReportes', () => {
  const comercios = [
    { comercioId: 'c-mio', nombre: 'Mío' },
    { comercioId: 'c-otro-mio', nombre: 'Otro mío' },
  ];
  const sucursales = [
    { id: 's-1', nombre: 'Principal', activa: true, esPrincipal: true },
    { id: 's-2', nombre: 'Centro', activa: true, esPrincipal: false },
  ];

  it('sin params: alcance = todos los comercios owner, sin sucursal', () => {
    expect(resolverFiltrosReportes(comercios, sucursales, {})).toEqual({
      comercio: null,
      sucursal: null,
    });
  });

  it('comercio propio: se acepta', () => {
    expect(resolverFiltrosReportes(comercios, sucursales, { comercio: 'c-mio' })).toEqual({
      comercio: comercios[0],
      sucursal: null,
    });
  });

  it('comercio AJENO (no está en sus membresías): cae a Todo', () => {
    expect(resolverFiltrosReportes(comercios, sucursales, { comercio: 'c-ajeno' })).toEqual({
      comercio: null,
      sucursal: null,
    });
  });

  it('sucursal ajena al comercio filtrado: cae a "todas" sin tumbar el filtro de comercio', () => {
    expect(
      resolverFiltrosReportes(comercios, sucursales, { comercio: 'c-mio', sucursal: 's-de-otro' }),
    ).toEqual({ comercio: comercios[0], sucursal: null });
  });

  it('sucursal válida del comercio filtrado: se acepta', () => {
    expect(
      resolverFiltrosReportes(comercios, sucursales, { comercio: 'c-mio', sucursal: 's-2' }),
    ).toEqual({ comercio: comercios[0], sucursal: sucursales[1] });
  });

  it('sucursal SIN comercio filtrado: se ignora (no hay a qué comercio pertenecer)', () => {
    expect(resolverFiltrosReportes(comercios, sucursales, { sucursal: 's-1' })).toEqual({
      comercio: null,
      sucursal: null,
    });
  });
});

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

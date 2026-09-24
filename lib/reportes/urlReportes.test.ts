import { describe, it, expect } from 'vitest';
import { urlReportes, urlExcelReportes, camposOcultosRango, type FiltrosParaUrl } from './urlReportes';
import { resolverFiltrosReportes } from './filtrosReportes';
import { leerParametrosReportes } from './parametrosReportes';

// Prueba PURA. Todas las URLs de Reportes (chips, encabezados de la tabla, paginación, el Excel y el
// formulario de "Personalizado") salen de acá, así que las reglas de spec §1 y §3 viven en un solo
// lugar: se conserva lo que no cambia; cambiar de comercio o volver a "Todo" BORRA sucursal y
// cajero; cualquier cambio de filtro vuelve a la página 1.
//
// MUTATION-TESTING (corridas el 2026-09-23, con el mensaje que se vio caer):
// - Sin el borrado de la sucursal al cambiar de comercio (`… : (filtros.sucursal?.id ?? null)` sin el
//   `cambiaComercio ? null`): caen "cambiar de comercio BORRA sucursal y cajero" y "volver a Todo
//   también los borra", las dos con `expected 's-norte' to be undefined`. Lo mismo con el cajero:
//   `expected 'u-caja' to be undefined`.
// - Borrar aunque sea el mismo comercio (`cambiaComercio = cambios.comercio !== undefined`): cae
//   "tocar el comercio que ya está elegido…" con `expected [ undefined, undefined, undefined ] to
//   deeply equal [ 's-norte', 'u-caja', undefined ]`.
// - Sin volver a la página 1 (`pagina: cambios.pagina ?? filtros.pagina`): caen ocho, entre ellas
//   "otra columna: su dirección inicial… y página 1" con `expected [ 'nombre', 'asc', '3' ] to deeply
//   equal [ 'nombre', 'asc', undefined ]`.
// - Tocar la columna activa no invierte (`dir = direccionInicial(cambios.orden)`): cae "tocar la
//   columna activa invierte la dirección" con `expected [ 'nombre', 'asc' ] to deeply equal
//   [ 'nombre', 'desc' ]`. Otra columna conserva la dirección actual (`: filtros.dir`): cae "otra
//   columna: su dirección inicial…" con `expected [ 'ultima', 'asc' ] to deeply equal [ 'ultima',
//   'desc' ]`.
// - El Excel con orden, dir y página (`pares(…, true)`): cae "los filtros de la vista, sin orden, dir
//   ni página" con `expected { periodo: '7d', …(6) } to deeply equal { periodo: '7d', …(3) }`.
// - "Personalizado" sin precargar (`desde: … : null`): caen cuatro, entre ellas "un preset no lleva
//   fechas; Personalizado las lleva PRECARGADAS…" con `expected [ 'rango', undefined, '2026-09-23' ]
//   to deeply equal [ 'rango', '2026-09-17', '2026-09-23' ]`.

// Una vista con TODO puesto: Café, sucursal Norte, un cajero, 7 días, ordenada por premios asc,
// página 3.
function vista(extra: Partial<FiltrosParaUrl> = {}): FiltrosParaUrl {
  return {
    periodo: '7d',
    desde: '2026-09-17',
    hasta: '2026-09-23',
    comercio: { comercioId: 'c-cafe' },
    sucursal: { id: 's-norte' },
    cajero: { id: 'u-caja' },
    orden: 'premios',
    dir: 'asc',
    pagina: 3,
    ...extra,
  };
}

function params(url: string): Record<string, string> {
  const [, query = ''] = url.split('?');
  return Object.fromEntries(new URLSearchParams(query));
}

describe('urlReportes', () => {
  it('sin cambios: la misma vista, con todo lo que tiene', () => {
    const url = urlReportes(vista());
    expect(url.startsWith('/comercio/reportes?')).toBe(true);
    expect(params(url)).toEqual({
      periodo: '7d',
      comercio: 'c-cafe',
      sucursal: 's-norte',
      cajero: 'u-caja',
      orden: 'premios',
      dir: 'asc',
      pagina: '3',
    });
  });

  it('la vista por defecto es la URL corta (sin orden, dir ni página por defecto)', () => {
    const porDefecto = vista({
      periodo: '30d',
      comercio: null,
      sucursal: null,
      cajero: null,
      orden: 'visitas',
      dir: 'desc',
      pagina: 1,
    });
    expect(urlReportes(porDefecto)).toBe('/comercio/reportes?periodo=30d');
  });

  it('cambiar un filtro conserva el resto y vuelve a la página 1', () => {
    expect(params(urlReportes(vista(), { periodo: 'hoy' }))).toEqual({
      periodo: 'hoy',
      comercio: 'c-cafe',
      sucursal: 's-norte',
      cajero: 'u-caja',
      orden: 'premios',
      dir: 'asc',
    });
    expect(params(urlReportes(vista(), { sucursal: 's-centro' }))).toEqual({
      periodo: '7d',
      comercio: 'c-cafe',
      sucursal: 's-centro',
      cajero: 'u-caja',
      orden: 'premios',
      dir: 'asc',
    });
    // "Todas" las sucursales / "Todos" los cajeros.
    expect(params(urlReportes(vista(), { sucursal: null })).sucursal).toBeUndefined();
    expect(params(urlReportes(vista(), { cajero: null })).cajero).toBeUndefined();
    expect(params(urlReportes(vista(), { cajero: null })).sucursal).toBe('s-norte');
  });

  it('cambiar de comercio BORRA sucursal y cajero (son del comercio anterior)', () => {
    const p = params(urlReportes(vista(), { comercio: 'c-spa' }));
    expect(p.sucursal).toBeUndefined();
    expect(p.cajero).toBeUndefined();
    expect(p).toEqual({ periodo: '7d', comercio: 'c-spa', orden: 'premios', dir: 'asc' });
  });

  it('volver a "Todo" también los borra', () => {
    const p = params(urlReportes(vista(), { comercio: null }));
    expect(p.sucursal).toBeUndefined();
    expect(p.cajero).toBeUndefined();
    expect(p).toEqual({ periodo: '7d', orden: 'premios', dir: 'asc' });
  });

  it('tocar el comercio que ya está elegido no pierde sucursal ni cajero', () => {
    const p = params(urlReportes(vista(), { comercio: 'c-cafe' }));
    expect([p.sucursal, p.cajero, p.pagina]).toEqual(['s-norte', 'u-caja', undefined]);
  });

  it('un preset no lleva fechas; "Personalizado" las lleva PRECARGADAS con el período visto', () => {
    const rango = params(urlReportes(vista(), { periodo: 'rango' }));
    expect([rango.periodo, rango.desde, rango.hasta]).toEqual(['rango', '2026-09-17', '2026-09-23']);
    // "Desde siempre" no tiene desde: el formulario abre con el desde vacío.
    const deTodo = params(urlReportes(vista({ periodo: 'todo', desde: null }), { periodo: 'rango' }));
    expect([deTodo.desde, deTodo.hasta]).toEqual([undefined, '2026-09-23']);
    // Y de un rango a un preset, las fechas se van.
    const aPreset = params(urlReportes(vista({ periodo: 'rango' }), { periodo: 'mes' }));
    expect([aPreset.desde, aPreset.hasta]).toEqual([undefined, undefined]);
  });

  it('un rango conserva sus fechas al cambiar otro filtro', () => {
    const p = params(urlReportes(vista({ periodo: 'rango', desde: '2026-01-05', hasta: '2026-02-10' }), { cajero: null }));
    expect([p.periodo, p.desde, p.hasta]).toEqual(['rango', '2026-01-05', '2026-02-10']);
  });

  describe('orden de la tabla', () => {
    it('otra columna: su dirección inicial (nombre asc, el resto desc) y página 1', () => {
      const porNombre = params(urlReportes(vista(), { orden: 'nombre' }));
      expect([porNombre.orden, porNombre.dir, porNombre.pagina]).toEqual(['nombre', 'asc', undefined]);
      const porUltima = params(urlReportes(vista(), { orden: 'ultima' }));
      expect([porUltima.orden, porUltima.dir]).toEqual(['ultima', 'desc']);
    });

    it('tocar la columna activa invierte la dirección', () => {
      const p = params(urlReportes(vista({ orden: 'premios', dir: 'asc' }), { orden: 'premios' }));
      expect([p.orden, p.dir, p.pagina]).toEqual(['premios', 'desc', undefined]);
      const q = params(urlReportes(vista({ orden: 'nombre', dir: 'asc' }), { orden: 'nombre' }));
      expect([q.orden, q.dir]).toEqual(['nombre', 'desc']);
    });

    it('volver a visitas desc (el default) deja la URL sin orden ni dir', () => {
      const p = params(urlReportes(vista({ orden: 'premios' }), { orden: 'visitas' }));
      expect([p.orden, p.dir]).toEqual([undefined, undefined]);
    });
  });

  it('la paginación solo cambia la página', () => {
    expect(params(urlReportes(vista(), { pagina: 4 }))).toEqual({
      periodo: '7d',
      comercio: 'c-cafe',
      sucursal: 's-norte',
      cajero: 'u-caja',
      orden: 'premios',
      dir: 'asc',
      pagina: '4',
    });
    expect(params(urlReportes(vista(), { pagina: 1 })).pagina).toBeUndefined();
  });

  it('ida y vuelta: lo que arma, resolverFiltrosReportes lo lee igual', () => {
    const comercios = [
      { comercioId: 'c-cafe', nombre: 'Café' },
      { comercioId: 'c-spa', nombre: 'Spa' },
    ];
    const ctx = {
      zonaComercioActivo: 'America/Bogota',
      datosComercios: [{ comercioId: 'c-cafe', zonaHoraria: 'America/Bogota', tipoPrincipal: 'puntos' }],
      sucursales: [{ id: 's-norte' }],
      usuarios: [{ id: 'u-caja' }],
    };
    const ahora = new Date('2026-09-23T15:00:00Z');
    const url = urlReportes(vista({ periodo: 'rango', desde: '2026-09-01', hasta: '2026-09-10' }));
    const leido = resolverFiltrosReportes(comercios, leerParametrosReportes(new URLSearchParams(url.split('?')[1])), ctx, ahora);
    expect(leido).toMatchObject({
      periodo: 'rango',
      desde: '2026-09-01',
      hasta: '2026-09-10',
      comercio: comercios[0],
      sucursal: { id: 's-norte' },
      cajero: { id: 'u-caja' },
      orden: 'premios',
      dir: 'asc',
      pagina: 3,
    });
  });
});

describe('urlExcelReportes', () => {
  it('los filtros de la vista, sin orden, dir ni página (el Excel trae TODOS por visitas)', () => {
    const url = urlExcelReportes(vista());
    expect(url.startsWith('/comercio/reportes/exportar?')).toBe(true);
    expect(params(url)).toEqual({ periodo: '7d', comercio: 'c-cafe', sucursal: 's-norte', cajero: 'u-caja' });
  });

  it('con un rango, lleva sus fechas', () => {
    const p = params(urlExcelReportes(vista({ periodo: 'rango', desde: '2026-09-01', hasta: '2026-09-10' })));
    expect([p.periodo, p.desde, p.hasta]).toEqual(['rango', '2026-09-01', '2026-09-10']);
  });
});

describe('camposOcultosRango', () => {
  it('lo que el formulario de "Personalizado" conserva: todo menos las fechas y la página', () => {
    expect(camposOcultosRango(vista())).toEqual([
      { nombre: 'periodo', valor: 'rango' },
      { nombre: 'comercio', valor: 'c-cafe' },
      { nombre: 'sucursal', valor: 's-norte' },
      { nombre: 'cajero', valor: 'u-caja' },
      { nombre: 'orden', valor: 'premios' },
      { nombre: 'dir', valor: 'asc' },
    ]);
  });

  it('en "Todo" y con el orden por defecto, solo el período', () => {
    expect(
      camposOcultosRango(vista({ comercio: null, sucursal: null, cajero: null, orden: 'visitas', dir: 'desc' })),
    ).toEqual([{ nombre: 'periodo', valor: 'rango' }]);
  });
});

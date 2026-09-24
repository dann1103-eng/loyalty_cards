import { describe, it, expect } from 'vitest';
import {
  TAMANO_PAGINA_CLIENTES,
  offsetDePagina,
  paginacionClientes,
  textoConteoClientes,
  columnasTablaClientes,
  filasDeChips,
  tituloSerie,
  etiquetaPeriodoSerie,
  barrasSerie,
  totalesDelResumen,
  huboActividad,
  sucursalesPorComercio,
  textoSinActividad,
  etiquetaCajero,
  filtrosInvisibles,
  type FiltrosTablaClientes,
  type FiltrosConNombres,
} from './pantallaReportes';
import { resolverFiltrosReportes } from './filtrosReportes';
import { leerParametrosReportes } from './parametrosReportes';

// Prueba PURA de las reglas de la pantalla de Reportes (spec 2026-09-23 §1, §2 y §3). La página no se
// prueba (el repo no tiene pruebas de componentes): lo que decide QUÉ se dibuja vive acá.
//
// MUTATION-TESTING (corridas el 2026-09-23, 27 de 27 caen; con el mensaje que se vio caer):
// Paginación
// - La página ignorando offset_efectivo (`Math.floor(offsetEfectivo / …) + 1` → `1`): caen cinco,
//   entre ellas "la página EFECTIVA sale de offset_efectivo…" con `expected { pagina: 1, totalPaginas:
//   7, …(3) } to deeply equal { pagina: 7, totalPaginas: 7, …(3) }` y "contrato roto…" con `expected
//   'Página 1 de 7' to be 'Página 7 de 7'`.
// - `Math.floor(total / 50) + 1` en vez de `Math.ceil`: cae "un total múltiplo exacto de 50…" con
//   `expected { pagina: 2, totalPaginas: 3, …(3) } to deeply equal { pagina: 2, totalPaginas: 2, …(3) }`.
// - Sin el `return null` de total 0: cae "total 0: sin páginas (null)…" con `expected { pagina: +0,
//   totalPaginas: +0, …(3) } to be null`.
// - Sin el tope de totalPaginas: cae "contrato roto…" con `expected 'Página 20 de 7' to be 'Página 7
//   de 7'`. Sin el piso de 1: la misma, con `expected 'Página 0 de 7' to be 'Página 1 de 7'`.
// - Anterior con `pagina >= 1`: caen "312 clientes: 7 páginas; la primera no tiene Anterior" y "un solo
//   cliente…" con `expected { pagina: 1, totalPaginas: 7, …(3) } to deeply equal { pagina: 1,
//   totalPaginas: 7, …(3) }`. Siguiente con `<=`: caen tres, entre ellas "la página EFECTIVA…" con
//   `expected { pagina: 7, totalPaginas: 7, …(3) } to deeply equal { pagina: 7, totalPaginas: 7, …(3) }`.
// - offsetDePagina sin el `- 1`: caen "la página 1 es el offset 0…" con `expected 50 to be +0` e "ida y
//   vuelta…" con `expected 2 to be 1`.
// Conteo
// - "clientes" con dos comercios (`alcance.length > 2`): cae "con DOS o más: filas…" con `expected '312
//   clientes' to be '312 filas (cliente por comercio)'`.
// - Siempre plural: `expected '1 clientes' to be '1 cliente'` y `expected '1 filas (cliente por
//   comercio)' to be '1 fila (cliente por comercio)'`.
// Encabezados
// - Comercio siempre: caen tres, entre ellas "con un comercio: … (sin Comercio)" con `expected [
//   'cliente', 'comercio', …(4) ] to deeply equal [ 'cliente', 'visitas', …(3) ]`. Comercio con `> 2`:
//   caen dos, "con dos o más comercios…" con `expected [ 'Cliente', 'Visitas', …(3) ] to deeply equal [
//   'Cliente', 'Comercio', …(4) ]`.
// - Acumulado enlazando aunque no sea ordenable (`ordenable = orden !== null`): caen "Acumulado NO
//   enlaza…" con `expected [ …(2) ] to deeply equal [ null, 'none' ]` y "con los filtros de
//   resolverFiltrosReportes…" con `expected '/comercio/reportes?periodo=30d&orden=…' to be null`.
// - La activa sin mirar filtros.orden (`activa = ordenable`): cae "aria-sort…" con `expected [ [
//   'cliente', 'descending' ], …(4) ] to deeply equal [ [ 'cliente', 'none' ], …(4) ]`.
// - La activa sin el resguardo (`activa = orden === filtros.orden`, sin `ordenable &&`): cae
//   "orden=acumulado en un alcance que no lo permite…" con `expected [ null, 'descending' ] to deeply
//   equal [ null, 'none' ]`.
// - aria-sort con las direcciones cruzadas: cae "con los filtros de resolverFiltrosReportes…" con
//   `expected 'ascending' to be 'descending'` (y "aria-sort…").
// - El enlace conserva la página (`{ orden, pagina: filtros.pagina }`): caen "los enlaces…" con
//   `expected { periodo: '7d', …(4) } to deeply equal { periodo: '7d', …(3) }` y "los enlaces conservan
//   los demás filtros…".
// - La activa sin invertir (el enlace armado como si la activa fuera otra columna): cae "los enlaces…"
//   con `expected { periodo: '7d', comercio: 'c-cafe' } to deeply equal { periodo: '7d', …(3) }`.
// Chips
// - Fila de comercio con uno solo (`>= 1`): cae "el período se dibuja siempre; con un solo comercio…"
//   con `expected { periodo: true, comercio: true, …(2) } to deeply equal { Object (periodo, comercio,
//   ...) }`.
// - Fila de sucursal con una sola (`>= 1`): caen dos, entre ellas "sucursal: … DOS o más…" con
//   `expected true to be false`.
// - Fila de cajero sin mirar el rol (`usuarios.length > 0`): caen dos, entre ellas "cajero: …" con
//   `expected true to be false` (solo el dueño). Solo con cajeros ACTIVOS: cae "cajero: …" con
//   `expected false to be true`.
// - Listas sin comparar comercioDeLasListas (`listasDelComercio = filtros.comercio !== null`): cae
//   "listas de OTRO comercio…". Listas sin exigir comercio resuelto (null === null): cae "sin comercio
//   resuelto no hay sucursal ni cajero…". Las dos con `expected { periodo: true, comercio: true, …(2) }
//   to deeply equal { periodo: true, comercio: true, …(2) }`.
// Título
// - `every` en vez de `some`: cae "sin filas, 'Por día'" con `expected 'Por mes' to be 'Por día'`.
//   Siempre "Por día": cae el otro con `expected 'Por día' to be 'Por mes'`.
//
// MUTATION-TESTING de la Tarea 4b (corridas el 2026-09-24 con un script que aplica una por vez y
// restaura; 21 de 22 caen, 1 equivalente):
// Barras
// - El mes sin el `- 1` del índice: caen dos, "por mes: …" con `expected 'oct 2026' to be 'sep 2026'`.
//   Siempre dd/mm: caen dos, la misma con `expected '01/09' to be 'sep 2026'`.
// - Sin el piso de 1 en el máximo: cae "todo en cero…" con `expected [ NaN, NaN ] to deeply equal [
//   +0, +0 ]`.
// - El máximo solo con visitas: caen dos, "el ancho es visitas + premios…" con `expected [ 150, +0, 50,
//   100 ] to deeply equal [ 100, +0, 33, 67 ]`. El ancho solo con visitas: caen dos, "un período con
//   solo premios…" con `expected [ +0, 50 ] to deeply equal [ 100, 50 ]`.
// - `Math.floor` en vez de `Math.round`: cae "el ancho es…" con `expected [ 100, +0, 33, 66 ] to deeply
//   equal [ 100, +0, 33, 67 ]`.
// Cabecera
// - El total buscado por `sucursal_id === null` y no por `es_total`: cae "la actividad 'sin sucursal'…"
//   con `expected { visitas: 7, premios: 2, clientes: 4 } to deeply equal { visitas: 9, premios: 3,
//   clientes: 5 }`. Clientes leído de `operaciones`: caen dos, "lee la fila es_total…" con `expected {
//   visitas: 5, premios: 1, clientes: 5 } to deeply equal { visitas: 5, premios: 1, clientes: 1 }`.
// - Ceros en vez de null sin fila total: cae "sin fila total…" con `expected { visitas: +0, premios:
//   +0, …(1) } to be null`.
// - huboActividad solo con visitas: cae "con visitas, o con SOLO premios, sí" con `expected false to be
//   true`. Con `>= 0`: cae "sin visitas ni premios…" con `expected true to be false`.
// Por sucursal
// - Recorriendo el alcance al revés: cae "sin la fila total, agrupadas … en el orden del ALCANCE…".
// - Bloques vacíos (`suyas.length >= 0`): caen tres, "solo la fila total…" con `expected [ { comercio: {
//   …(2) }, filas: [] } ] to deeply equal []`. Sin anotar los que no operaron: caen dos, "un comercio
//   del alcance sin filas…" con `expected [] to deeply equal [ { comercioId: 'c-spa', …(1) } ]`.
// - EQUIVALENTE (corrida, sigue verde): sacar `!f.es_total` del filtro. La fila total trae comercio_id
//   null (es la del conjunto `()` de grouping sets, 0040), así que nunca coincide con un comercio del
//   alcance. Se deja: no depender de ese detalle de la SQL para no dibujar el total como una sucursal.
// - "ninguno de tus comercios" con `> 2`: cae "sin sucursal: …" con `expected 'Sin actividad en este
//   período.' to be 'Sin actividad en ninguno de tus comer…'`. Sin nombrar la sucursal: cae "con una
//   sucursal elegida…" con `expected 'Sin actividad en este período.' to be 'Sin actividad en Centro en
//   este perío…'`.
// Filtros invisibles
// - Cajero siempre por email: caen dos, "la cuenta que mira dice 'Vos'…" con `expected 'yo@cafe.com' to
//   be 'Vos'`.
// - La sucursal sin mirar su fila: caen dos, "con su fila de chips dibujada…" con `expected [ { clave:
//   'sucursal', …(3) } ] to deeply equal []`. El cajero mirando la fila de SUCURSAL: cae "?cajero=<dueño>
//   sin cajeros…" con `expected [] to have a length of 1 but got +0`.
// - "Quitar" la sucursal sin borrarla: cae "?sucursal= con una sola sucursal…" con `expected { periodo:
//   '7d', …(6) } to deeply equal { periodo: '7d', …(4) }`. "Quitar" el cajero borrando la sucursal: cae
//   "?cajero=<dueño> sin cajeros…" con `expected { periodo: '7d', …(4) } to deeply equal { periodo:
//   '7d', …(4) }`.

const cafe = { comercioId: 'c-cafe', nombre: 'Café' };
const spa = { comercioId: 'c-spa', nombre: 'Spa' };

function params(url: string): Record<string, string> {
  const [, query = ''] = url.split('?');
  return Object.fromEntries(new URLSearchParams(query));
}

describe('paginacionClientes', () => {
  it('el tamaño de página de la tabla es 50 (spec §3)', () => {
    expect(TAMANO_PAGINA_CLIENTES).toBe(50);
  });

  it('312 clientes: 7 páginas; la primera no tiene Anterior', () => {
    expect(paginacionClientes(312, 0)).toEqual({
      pagina: 1,
      totalPaginas: 7,
      anterior: null,
      siguiente: 2,
      texto: 'Página 1 de 7',
    });
  });

  it('una página del medio tiene Anterior y Siguiente', () => {
    expect(paginacionClientes(312, 50)).toEqual({
      pagina: 2,
      totalPaginas: 7,
      anterior: 1,
      siguiente: 3,
      texto: 'Página 2 de 7',
    });
  });

  it('la página EFECTIVA sale de offset_efectivo: ?pagina=999 que la SQL acotó a 300 es la 7, no la 999', () => {
    // El caso de la spec §3: la URL pidió la 999, la SQL devolvió la última (offset 300). "Anterior"
    // tiene que llevar a la 6 y no a la 998, y el texto no puede decir "Página 999 de 7".
    expect(paginacionClientes(312, 300)).toEqual({
      pagina: 7,
      totalPaginas: 7,
      anterior: 6,
      siguiente: null,
      texto: 'Página 7 de 7',
    });
  });

  it('un total múltiplo exacto de 50 no inventa una página vacía al final', () => {
    expect(paginacionClientes(100, 50)).toEqual({
      pagina: 2,
      totalPaginas: 2,
      anterior: 1,
      siguiente: null,
      texto: 'Página 2 de 2',
    });
    expect(paginacionClientes(50, 0)?.texto).toBe('Página 1 de 1');
    expect(paginacionClientes(50, 0)?.siguiente).toBeNull();
  });

  it('un solo cliente: "Página 1 de 1", sin Anterior ni Siguiente', () => {
    expect(paginacionClientes(1, 0)).toEqual({
      pagina: 1,
      totalPaginas: 1,
      anterior: null,
      siguiente: null,
      texto: 'Página 1 de 1',
    });
  });

  it('total 0: sin páginas (null), aunque la URL pidiera la 5 y el wrapper devuelva ese offset', () => {
    // Contrato de paginar.ts: de una respuesta vacía no se lee offset_efectivo, y el llamador
    // devuelve el MISMO offset que pidió. Con ?pagina=5 son 200: nada de "Página 5 de 0".
    expect(paginacionClientes(0, 0)).toBeNull();
    expect(paginacionClientes(0, offsetDePagina(5))).toBeNull();
  });

  it('contrato roto (un offset fuera del total): se acota a la última, no dice "Página 20 de 7"', () => {
    expect(paginacionClientes(312, 950)?.texto).toBe('Página 7 de 7');
    expect(paginacionClientes(312, -50)?.texto).toBe('Página 1 de 7');
  });
});

describe('offsetDePagina', () => {
  it('la página 1 es el offset 0; la 7, el 300', () => {
    expect(offsetDePagina(1)).toBe(0);
    expect(offsetDePagina(2)).toBe(50);
    expect(offsetDePagina(7)).toBe(300);
  });

  it('ida y vuelta con paginacionClientes', () => {
    for (const pagina of [1, 2, 3, 7]) {
      expect(paginacionClientes(312, offsetDePagina(pagina))?.pagina).toBe(pagina);
    }
  });
});

describe('textoConteoClientes', () => {
  it('con UN comercio en el alcance: clientes, en singular y en plural', () => {
    const uno = { alcance: [cafe] };
    expect(textoConteoClientes(312, uno)).toBe('312 clientes');
    expect(textoConteoClientes(1, uno)).toBe('1 cliente');
    expect(textoConteoClientes(0, uno)).toBe('0 clientes');
  });

  it('con DOS o más: filas (cliente por comercio), porque una persona con tarjeta en dos es dos filas', () => {
    const dos = { alcance: [cafe, spa] };
    expect(textoConteoClientes(312, dos)).toBe('312 filas (cliente por comercio)');
    expect(textoConteoClientes(1, dos)).toBe('1 fila (cliente por comercio)');
    expect(textoConteoClientes(0, dos)).toBe('0 filas (cliente por comercio)');
  });
});

// Café elegido, 7 días, ordenada por visitas desc (el default), página 3.
function filtrosTabla(extra: Partial<FiltrosTablaClientes> = {}): FiltrosTablaClientes {
  return {
    periodo: '7d',
    desde: '2026-09-17',
    hasta: '2026-09-23',
    comercio: { comercioId: 'c-cafe' },
    sucursal: null,
    cajero: null,
    orden: 'visitas',
    dir: 'desc',
    pagina: 3,
    acumuladoOrdenable: true,
    alcance: [cafe],
    ...extra,
  };
}

describe('columnasTablaClientes', () => {
  it('con un comercio: Cliente, Visitas, Acumulado, Premios, Última actividad (sin Comercio)', () => {
    const columnas = columnasTablaClientes(filtrosTabla());
    expect(columnas.map((c) => c.clave)).toEqual(['cliente', 'visitas', 'acumulado', 'premios', 'ultima']);
    expect(columnas.map((c) => c.titulo)).toEqual(['Cliente', 'Visitas', 'Acumulado', 'Premios', 'Última actividad']);
  });

  it('con dos o más comercios en el alcance, también Comercio (segunda, después de Cliente), que no enlaza', () => {
    const columnas = columnasTablaClientes(filtrosTabla({ comercio: null, alcance: [cafe, spa] }));
    expect(columnas.map((c) => c.titulo)).toEqual([
      'Cliente',
      'Comercio',
      'Visitas',
      'Acumulado',
      'Premios',
      'Última actividad',
    ]);
    const comercio = columnas.find((c) => c.clave === 'comercio')!;
    expect([comercio.href, comercio.ariaSort]).toEqual([null, 'none']);
  });

  it('aria-sort: la activa dice su dirección; el resto, none', () => {
    const porVisitas = columnasTablaClientes(filtrosTabla());
    expect(porVisitas.map((c) => [c.clave, c.ariaSort])).toEqual([
      ['cliente', 'none'],
      ['visitas', 'descending'],
      ['acumulado', 'none'],
      ['premios', 'none'],
      ['ultima', 'none'],
    ]);
    const porNombre = columnasTablaClientes(filtrosTabla({ orden: 'nombre', dir: 'asc' }));
    expect(porNombre.find((c) => c.clave === 'cliente')!.ariaSort).toBe('ascending');
    expect(porNombre.find((c) => c.clave === 'visitas')!.ariaSort).toBe('none');
    const porPremiosAsc = columnasTablaClientes(filtrosTabla({ orden: 'premios', dir: 'asc' }));
    expect(porPremiosAsc.find((c) => c.clave === 'premios')!.ariaSort).toBe('ascending');
  });

  it('los enlaces: la activa invierte, otra abre con su dirección inicial, y todos vuelven a la página 1', () => {
    const columnas = columnasTablaClientes(filtrosTabla());
    const destino = (clave: string) => {
      const href = columnas.find((c) => c.clave === clave)!.href;
      expect(href).not.toBeNull();
      return params(href!);
    };
    // Cliente ordena por `nombre`, que abre A→Z.
    expect(destino('cliente')).toEqual({ periodo: '7d', comercio: 'c-cafe', orden: 'nombre', dir: 'asc' });
    // Visitas es la activa (desc): tocarla invierte.
    expect(destino('visitas')).toEqual({ periodo: '7d', comercio: 'c-cafe', orden: 'visitas', dir: 'asc' });
    expect(destino('acumulado')).toEqual({ periodo: '7d', comercio: 'c-cafe', orden: 'acumulado', dir: 'desc' });
    expect(destino('premios')).toEqual({ periodo: '7d', comercio: 'c-cafe', orden: 'premios', dir: 'desc' });
    expect(destino('ultima')).toEqual({ periodo: '7d', comercio: 'c-cafe', orden: 'ultima', dir: 'desc' });
    // Ninguno conserva la página 3 de la vista.
    for (const c of columnas) expect(params(c.href!).pagina).toBeUndefined();
  });

  it('los enlaces conservan los demás filtros (sucursal, cajero, rango)', () => {
    const columnas = columnasTablaClientes(
      filtrosTabla({ periodo: 'rango', desde: '2026-01-05', hasta: '2026-02-10', sucursal: { id: 's-norte' }, cajero: { id: 'u-caja' } }),
    );
    expect(params(columnas.find((c) => c.clave === 'premios')!.href!)).toEqual({
      periodo: 'rango',
      desde: '2026-01-05',
      hasta: '2026-02-10',
      comercio: 'c-cafe',
      sucursal: 's-norte',
      cajero: 'u-caja',
      orden: 'premios',
      dir: 'desc',
    });
  });

  it('Acumulado NO enlaza cuando no es ordenable (unidades mezcladas o sin contador); el resto sí', () => {
    const columnas = columnasTablaClientes(filtrosTabla({ acumuladoOrdenable: false }));
    const acumulado = columnas.find((c) => c.clave === 'acumulado')!;
    expect([acumulado.href, acumulado.ariaSort]).toEqual([null, 'none']);
    for (const clave of ['cliente', 'visitas', 'premios', 'ultima']) {
      expect(columnas.find((c) => c.clave === clave)!.href).not.toBeNull();
    }
  });

  it('orden=acumulado en un alcance que no lo permite: Acumulado no se marca como ordenada ni enlaza', () => {
    // resolverFiltrosReportes nunca devuelve esta combinación (cae a visitas); esto fija el resguardo
    // para unos filtros armados a mano.
    const columnas = columnasTablaClientes(filtrosTabla({ orden: 'acumulado', acumuladoOrdenable: false }));
    const acumulado = columnas.find((c) => c.clave === 'acumulado')!;
    expect([acumulado.href, acumulado.ariaSort]).toEqual([null, 'none']);
  });

  it('con los filtros de resolverFiltrosReportes: Café en puntos y Spa en cashback no ordenan por acumulado', () => {
    // Lo que va a hacer la página: los filtros resueltos van directo, sin adaptar.
    const filtros = resolverFiltrosReportes(
      [cafe, spa],
      leerParametrosReportes({ orden: 'acumulado', pagina: '2' }),
      {
        zonaComercioActivo: 'America/El_Salvador',
        datosComercios: [
          { comercioId: 'c-cafe', zonaHoraria: 'America/El_Salvador', tipoPrincipal: 'puntos' },
          { comercioId: 'c-spa', zonaHoraria: 'America/Bogota', tipoPrincipal: 'cashback' },
        ],
        comercioDeLasListas: null,
        sucursales: [],
        usuarios: [],
      },
      new Date('2026-09-23T15:00:00Z'),
    );
    const columnas = columnasTablaClientes(filtros);
    expect(columnas.map((c) => c.clave)).toEqual(['cliente', 'comercio', 'visitas', 'acumulado', 'premios', 'ultima']);
    expect(columnas.find((c) => c.clave === 'acumulado')!.href).toBeNull();
    // El orden=acumulado de la URL cayó a visitas desc: esa es la activa.
    expect(columnas.find((c) => c.clave === 'visitas')!.ariaSort).toBe('descending');
  });
});

describe('filasDeChips', () => {
  const dueno = { rol: 'owner' };
  const cajero = { rol: 'cajero' };

  it('el período se dibuja siempre; con un solo comercio, no hay fila de comercio', () => {
    expect(
      filasDeChips([cafe], { comercio: cafe }, { comercioDeLasListas: 'c-cafe', sucursales: [{}], usuarios: [dueno] }),
    ).toEqual({ periodo: true, comercio: false, sucursal: false, cajero: false });
  });

  it('con dos comercios, fila de comercio; en "Todo", ni sucursal ni cajero', () => {
    expect(
      filasDeChips([cafe, spa], { comercio: null }, { comercioDeLasListas: null, sucursales: [], usuarios: [] }),
    ).toEqual({ periodo: true, comercio: true, sucursal: false, cajero: false });
  });

  it('sin comercio resuelto no hay sucursal ni cajero, aunque vengan listas', () => {
    expect(
      filasDeChips(
        [cafe, spa],
        { comercio: null },
        { comercioDeLasListas: null, sucursales: [{}, {}], usuarios: [dueno, cajero] },
      ),
    ).toEqual({ periodo: true, comercio: true, sucursal: false, cajero: false });
  });

  it('sucursal: con el comercio resuelto y DOS o más sucursales (una sola no es un filtro)', () => {
    const conSucursales = (n: number) =>
      filasDeChips(
        [cafe, spa],
        { comercio: cafe },
        { comercioDeLasListas: 'c-cafe', sucursales: Array.from({ length: n }, () => ({})), usuarios: [dueno] },
      ).sucursal;
    expect(conSucursales(1)).toBe(false);
    expect(conSucursales(2)).toBe(true);
    expect(conSucursales(3)).toBe(true);
  });

  it('cajero: con el comercio resuelto y al menos un usuario de rol cajero (activo o no, eso no se mira)', () => {
    const conUsuarios = (usuarios: { rol: string; activo?: boolean }[]) =>
      filasDeChips([cafe], { comercio: cafe }, { comercioDeLasListas: 'c-cafe', sucursales: [{}], usuarios }).cajero;
    // Solo el dueño (o dos dueños): filtrar por él solo no es un filtro de cajeros.
    expect(conUsuarios([dueno])).toBe(false);
    expect(conUsuarios([dueno, { rol: 'owner' }])).toBe(false);
    expect(conUsuarios([dueno, { rol: 'cajero', activo: false }])).toBe(true);
    expect(conUsuarios([dueno, { rol: 'cajero', activo: true }])).toBe(true);
  });

  it('listas de OTRO comercio que el resuelto se tratan como vacías (como en resolverFiltrosReportes)', () => {
    expect(
      filasDeChips(
        [cafe, spa],
        { comercio: cafe },
        { comercioDeLasListas: 'c-spa', sucursales: [{}, {}], usuarios: [dueno, cajero] },
      ),
    ).toEqual({ periodo: true, comercio: true, sucursal: false, cajero: false });
  });
});

describe('tituloSerie', () => {
  it('"Por mes" si la SQL agrupó por mes; "Por día" si no', () => {
    expect(tituloSerie([{ es_mes: true }, { es_mes: true }])).toBe('Por mes');
    expect(tituloSerie([{ es_mes: false }, { es_mes: false }])).toBe('Por día');
  });

  it('sin filas, "Por día"', () => {
    expect(tituloSerie([])).toBe('Por día');
  });
});

describe('etiquetaPeriodoSerie', () => {
  it('por día: dd/mm, partido a mano (sin pasar por Date y su zona)', () => {
    expect(etiquetaPeriodoSerie('2026-09-05', false)).toBe('05/09');
    expect(etiquetaPeriodoSerie('2026-01-31', false)).toBe('31/01');
  });

  it('por mes: el mes abreviado y el año ("sep 2026"), enero y diciembre en los bordes de la lista', () => {
    expect(etiquetaPeriodoSerie('2026-09-01', true)).toBe('sep 2026');
    expect(etiquetaPeriodoSerie('2026-01-01', true)).toBe('ene 2026');
    expect(etiquetaPeriodoSerie('2025-12-01', true)).toBe('dic 2025');
  });
});

describe('barrasSerie', () => {
  const fila = (periodo: string, operaciones: number, canjes: number, es_mes = false) => ({
    periodo,
    operaciones,
    canjes,
    es_mes,
  });

  it('el ancho es visitas + premios contra el período más alto (100%), redondeado', () => {
    const barras = barrasSerie([
      fila('2026-09-01', 2, 1),
      fila('2026-09-02', 0, 0),
      fila('2026-09-03', 1, 0),
      fila('2026-09-04', 2, 0),
    ]);
    // 1/3 = 33,3 → 33; 2/3 = 66,7 → 67 (redondeo, no truncado).
    expect(barras.map((b) => b.pct)).toEqual([100, 0, 33, 67]);
    expect(barras.map((b) => [b.visitas, b.premios])).toEqual([
      [2, 1],
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
  });

  it('un período con solo premios también tiene barra (los premios cuentan en el ancho)', () => {
    const barras = barrasSerie([fila('2026-09-01', 0, 4), fila('2026-09-02', 2, 0)]);
    expect(barras.map((b) => b.pct)).toEqual([100, 50]);
  });

  it('todo en cero: barras vacías, sin dividir por cero', () => {
    const barras = barrasSerie([fila('2026-09-01', 0, 0), fila('2026-09-02', 0, 0)]);
    expect(barras.map((b) => b.pct)).toEqual([0, 0]);
  });

  it('cada barra trae su etiqueta según es_mes, y el periodo como clave', () => {
    const porMes = barrasSerie([fila('2026-08-01', 5, 0, true), fila('2026-09-01', 3, 1, true)]);
    expect(porMes.map((b) => [b.clave, b.etiqueta])).toEqual([
      ['2026-08-01', 'ago 2026'],
      ['2026-09-01', 'sep 2026'],
    ]);
    const porDia = barrasSerie([fila('2026-09-23', 1, 0)]);
    expect(porDia[0].etiqueta).toBe('23/09');
  });

  it('sin filas, sin barras', () => {
    expect(barrasSerie([])).toEqual([]);
  });
});

// Filas de reporte_resumen con lo que usan las funciones de abajo.
function filaResumen(extra: {
  comercio_id: string | null;
  sucursal_id: string | null;
  operaciones?: number;
  canjes?: number;
  clientes_unicos?: number;
  es_total?: boolean;
}) {
  return { operaciones: 0, canjes: 0, clientes_unicos: 0, es_total: false, ...extra };
}

describe('totalesDelResumen', () => {
  it('lee la fila es_total, no la suma de las sucursales (Clientes es la cuenta DISTINTA)', () => {
    // Una persona que fue a las dos sucursales: 1 en cada una, 1 en el total (no 2).
    const filas = [
      filaResumen({ comercio_id: 'c-cafe', sucursal_id: 's-centro', operaciones: 3, canjes: 1, clientes_unicos: 1 }),
      filaResumen({ comercio_id: 'c-cafe', sucursal_id: 's-norte', operaciones: 2, canjes: 0, clientes_unicos: 1 }),
      filaResumen({ comercio_id: null, sucursal_id: null, operaciones: 5, canjes: 1, clientes_unicos: 1, es_total: true }),
    ];
    expect(totalesDelResumen(filas)).toEqual({ visitas: 5, premios: 1, clientes: 1 });
  });

  it('la actividad "sin sucursal" (sucursal_id null) no se confunde con el total: se mira es_total', () => {
    const filas = [
      filaResumen({ comercio_id: 'c-cafe', sucursal_id: null, operaciones: 7, canjes: 2, clientes_unicos: 4 }),
      filaResumen({ comercio_id: null, sucursal_id: null, operaciones: 9, canjes: 3, clientes_unicos: 5, es_total: true }),
    ];
    expect(totalesDelResumen(filas)).toEqual({ visitas: 9, premios: 3, clientes: 5 });
  });

  it('sin fila total (contrato roto de la 0040): null, nunca ceros inventados', () => {
    expect(totalesDelResumen([filaResumen({ comercio_id: 'c-cafe', sucursal_id: 's-centro', operaciones: 3 })])).toBeNull();
    expect(totalesDelResumen([])).toBeNull();
  });
});

describe('huboActividad', () => {
  it('sin visitas ni premios, no hubo actividad', () => {
    expect(huboActividad({ visitas: 0, premios: 0, clientes: 0 })).toBe(false);
  });

  it('con visitas, o con SOLO premios, sí', () => {
    expect(huboActividad({ visitas: 1, premios: 0, clientes: 1 })).toBe(true);
    expect(huboActividad({ visitas: 0, premios: 2, clientes: 1 })).toBe(true);
  });
});

describe('sucursalesPorComercio', () => {
  const total = filaResumen({ comercio_id: null, sucursal_id: null, operaciones: 6, es_total: true });

  it('sin la fila total, agrupadas por comercio en el orden del ALCANCE (no el del uuid de la SQL)', () => {
    const spaCentro = filaResumen({ comercio_id: 'c-spa', sucursal_id: 's-spa', operaciones: 1 });
    const cafeCentro = filaResumen({ comercio_id: 'c-cafe', sucursal_id: 's-centro', operaciones: 3 });
    const cafeSinSucursal = filaResumen({ comercio_id: 'c-cafe', sucursal_id: null, operaciones: 2 });
    const { conActividad, sinActividad } = sucursalesPorComercio([total, spaCentro, cafeCentro, cafeSinSucursal], [cafe, spa]);
    expect(conActividad).toEqual([
      { comercio: cafe, filas: [cafeCentro, cafeSinSucursal] },
      { comercio: spa, filas: [spaCentro] },
    ]);
    expect(sinActividad).toEqual([]);
  });

  it('un comercio del alcance sin filas va a sinActividad (se nombra en una línea, no con un bloque vacío)', () => {
    const cafeCentro = filaResumen({ comercio_id: 'c-cafe', sucursal_id: 's-centro', operaciones: 3 });
    const { conActividad, sinActividad } = sucursalesPorComercio([total, cafeCentro], [cafe, spa]);
    expect(conActividad.map((b) => b.comercio)).toEqual([cafe]);
    expect(sinActividad).toEqual([spa]);
  });

  it('solo la fila total (nadie operó): ningún bloque, todo el alcance sin actividad', () => {
    const { conActividad, sinActividad } = sucursalesPorComercio([total], [cafe]);
    expect(conActividad).toEqual([]);
    expect(sinActividad).toEqual([cafe]);
  });

  it('una fila de un comercio que no está en el alcance no se dibuja', () => {
    const ajena = filaResumen({ comercio_id: 'c-ajeno', sucursal_id: 's-x', operaciones: 9 });
    const { conActividad } = sucursalesPorComercio([total, ajena], [cafe]);
    expect(conActividad).toEqual([]);
  });
});

describe('textoSinActividad', () => {
  it('con una sucursal elegida, la nombra (spec §2)', () => {
    expect(textoSinActividad({ sucursal: { nombre: 'Centro' }, alcance: [cafe] })).toBe(
      'Sin actividad en Centro en este período.',
    );
  });

  it('sin sucursal: con dos o más comercios, "ninguno de tus comercios"; con uno, "en este período"', () => {
    expect(textoSinActividad({ sucursal: null, alcance: [cafe, spa] })).toBe(
      'Sin actividad en ninguno de tus comercios en este período.',
    );
    expect(textoSinActividad({ sucursal: null, alcance: [cafe] })).toBe('Sin actividad en este período.');
  });
});

describe('etiquetaCajero', () => {
  it('la cuenta que mira dice "Vos"; cualquier otra (el socio dueño incluido), su email', () => {
    expect(etiquetaCajero({ email: 'yo@cafe.com', esVos: true })).toBe('Vos');
    expect(etiquetaCajero({ email: 'socio@cafe.com', esVos: false })).toBe('socio@cafe.com');
  });
});

describe('filtrosInvisibles', () => {
  const centro = { id: 's-centro', nombre: 'Centro' };
  const yo = { id: 'u-yo', email: 'yo@cafe.com', esVos: true };
  const socio = { id: 'u-socio', email: 'socio@cafe.com', esVos: false };
  const filtrosCon = (extra: Partial<FiltrosConNombres> = {}): FiltrosConNombres => ({
    periodo: '7d',
    desde: '2026-09-17',
    hasta: '2026-09-23',
    comercio: { comercioId: 'c-cafe' },
    sucursal: null,
    cajero: null,
    orden: 'premios',
    dir: 'asc',
    pagina: 3,
    ...extra,
  });
  const sinFilas = { sucursal: false, cajero: false };

  it('sin sucursal ni cajero aplicados, nada que avisar', () => {
    expect(filtrosInvisibles(sinFilas, filtrosCon())).toEqual([]);
  });

  it('?sucursal= con una sola sucursal (su fila no se dibuja): se avisa, y quitarlo conserva el resto y vuelve a la página 1', () => {
    const avisos = filtrosInvisibles(sinFilas, filtrosCon({ sucursal: centro, cajero: socio }));
    expect(avisos[0]).toMatchObject({ clave: 'sucursal', rotulo: 'sucursal', valor: 'Centro' });
    expect(params(avisos[0].hrefQuitar)).toEqual({
      periodo: '7d',
      comercio: 'c-cafe',
      cajero: 'u-socio',
      orden: 'premios',
      dir: 'asc',
    });
  });

  it('?cajero=<dueño> sin cajeros (su fila no se dibuja): "Vos", y quitarlo conserva la sucursal', () => {
    const avisos = filtrosInvisibles({ sucursal: true, cajero: false }, filtrosCon({ sucursal: centro, cajero: yo }));
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ clave: 'cajero', rotulo: 'cajero', valor: 'Vos' });
    expect(params(avisos[0].hrefQuitar)).toEqual({
      periodo: '7d',
      comercio: 'c-cafe',
      sucursal: 's-centro',
      orden: 'premios',
      dir: 'asc',
    });
  });

  it('el socio dueño (no es "Vos") se nombra por su email', () => {
    const avisos = filtrosInvisibles(sinFilas, filtrosCon({ cajero: socio }));
    expect(avisos.map((a) => a.valor)).toEqual(['socio@cafe.com']);
  });

  it('con su fila de chips dibujada, el filtro ya se ve: no se repite', () => {
    expect(
      filtrosInvisibles({ sucursal: true, cajero: true }, filtrosCon({ sucursal: centro, cajero: socio })),
    ).toEqual([]);
  });

  it('los dos invisibles: los dos avisos, sucursal primero (el orden de las filas de chips)', () => {
    const avisos = filtrosInvisibles(sinFilas, filtrosCon({ sucursal: centro, cajero: yo }));
    expect(avisos.map((a) => a.clave)).toEqual(['sucursal', 'cajero']);
  });
});

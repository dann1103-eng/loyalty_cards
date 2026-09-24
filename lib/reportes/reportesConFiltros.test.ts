import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno, type ActividadSembrada } from '../../test/fixtures/entornoComercio';
import {
  filtrosRpc,
  reporteResumen,
  reportePorDia,
  reporteClientes,
  reporteCajerosAlcance,
  type FilaReporteResumen,
  type FilaReporteCajeroAlcance,
} from './reportes';
import { cargarContextoReportes, type SesionReportes } from './contextoReportes';
import { resolverFiltrosReportes } from './filtrosReportes';

// Los wrappers de la 0040 y el cargador compartido, CONTRA LA BASE (plan 2026-09-23, Tarea 3). La
// lógica de la SQL ya se probó y se mutó en PGlite (sql0040.pglite.test.ts); acá va lo que PGlite no
// ve: PostgREST. Los nombres de los argumentos (uno mal escrito es un PGRST202 que el wrapper
// convierte en null), el `.range()` que PostgREST aplica POR FUERA del resultado, los tipos del JSON
// y el orden explícito entre páginas. Los datos se siembran a fechas ELEGIDAS (sembrarActividad), en
// El Salvador (UTC−6) y en Bogotá (UTC−5), con los instantes escritos con su desfase: nada depende de
// la zona del proceso.
//
// Tamaño de página 2 con 4 y 5 filas: 5 atrapa la página que no avanza (o que PostgREST vacía) y 4,
// múltiplo exacto, la página repetida. Las llamadas se cuentan espiando `supabase.rpc`: con el tamaño
// FIJO en 1000 en vez del inyectado, las filas saldrían completas igual, y lo único que lo delata es
// que llegan en UNA llamada.
//
// Rojo de partida (2026-09-24, con los wrappers y el cargador escritos como stubs que devolvían null y
// `{ ok: false, error: 'TODO Tarea 3' }`): 20 de 25 caen, por ejemplo "las cuatro funciones responden"
// con `expected null not to be null`, "con tamaño de página 2: 4 días…" con `expected [] to have a
// length of 3 but got +0` y "dos comercios: ?comercio= carga las listas de ESE…" con `expected { ok:
// false, error: 'TODO Tarea 3' } to deeply equal { ok: true, contexto: { …(5) } }`. Las 5 que pasaban
// son las de "un error de la base da null" (un stub que devuelve null las cumple): lo que las hace
// valer es la mutación "null convertido en []", abajo.

const supabase = createServiceClient();

// ─────────────────────────────────────────────────────────────────────────────
// El escenario: un café en El Salvador y un spa en Bogotá, sembrados UNA vez
// ─────────────────────────────────────────────────────────────────────────────
//
// Período de las pruebas: del 09 al 12 de marzo de 2026. En el café (El Salvador, UTC−6):
//
//   cliente  visitas en el período (sucursal/cajero)          fuera del período / otras
//   t1       5 en S1/C1 (una con monto 12.50) + 1 sin sucursal  1 visita el 01/02 (primera actividad);
//            ni cajero                                          1 premio el 11 en S1/C1
//   t2       4 en S1/C1 (una FORZADA)                           1 ajuste de 2 puntos el 10 en S1/C1
//   t3       3 en S1/C2
//   t4       2 en S1/C2: el 09 a las 00:00 y el 12 a las 23:59   1 visita el 13 a las 00:00 (fuera)
//   t5       1 en S2/C2                                         1 premio el 10 en S2/C2
//
// Por día (visitas/premios): 09 → 3/0, 10 → 4/1, 11 → 5/1, 12 → 4/0. Total: 16 visitas, 2 premios,
// 5 clientes. Visitas por cliente, todas distintas (6, 4, 3, 2, 1; con S1: 5, 4, 3, 2): el orden por
// visitas no depende de ningún desempate.
//
// En el spa (Bogotá, UTC−5), una tarjeta del MISMO cliente que t1: una visita el 10 a las 23:30 (en el
// período) y otra el 13 a las 00:30 de Bogotá, que en El Salvador serían las 23:30 del 12: fuera del
// período SOLO si la SQL corta el spa en su propia zona.
const PERIODO = { desde: '2026-03-09', hasta: '2026-03-12' };
const sv = (diaHora: string) => `2026-03-${diaHora}:00-06:00`; // '10T23:59' → El Salvador
const bo = (diaHora: string) => `2026-03-${diaHora}:00-05:00`; // Bogotá

const escenario = crearEntorno(supabase);
let cafe = '';
let spa = '';
let s1 = '';
let s2 = '';
let c1 = '';
let c2 = '';
// t[0] … t[4] = t1 … t5 del cuadro.
let t: { id: string; clienteId: string }[] = [];

beforeAll(async () => {
  cafe = await escenario.crearComercio({ nombre: 'Café Reportes' }); // America/El_Salvador por defecto
  spa = await escenario.crearComercio({ nombre: 'Spa Reportes', zona_horaria: 'America/Bogota' });
  s1 = await escenario.crearSucursal(cafe);
  s2 = await escenario.crearSucursal(cafe);
  c1 = await escenario.crearCajero(cafe);
  c2 = await escenario.crearCajero(cafe);
  const premio = await escenario.crearRecompensa(cafe, 1);
  t = [];
  for (let i = 0; i < 5; i++) t.push(await escenario.crearTarjeta(cafe));
  const tSpa = await escenario.crearTarjeta(spa, 0, { clienteId: t[0].clienteId });

  const visita = (
    i: number,
    createdAt: string,
    sucursalId: string | null,
    cajeroId: string | null,
    extra: { forzado?: boolean; montoCompra?: number } = {},
  ): ActividadSembrada => ({ clase: 'visita', tarjetaId: t[i].id, createdAt, sucursalId, cajeroId, ...extra });

  await escenario.sembrarActividad([
    // t1
    visita(0, sv('09T10:00'), s1, c1, { montoCompra: 12.5 }),
    visita(0, sv('10T10:00'), s1, c1),
    visita(0, sv('10T11:00'), s1, c1),
    visita(0, sv('11T10:00'), s1, c1),
    visita(0, sv('12T10:00'), s1, c1),
    visita(0, sv('12T12:00'), null, null),
    visita(0, '2026-02-01T10:00:00-06:00', s1, c1),
    { clase: 'canje', tarjetaId: t[0].id, createdAt: sv('11T15:00'), sucursalId: s1, cajeroId: c1, recompensaId: premio },
    // t2
    visita(1, sv('09T11:00'), s1, c1),
    visita(1, sv('10T12:00'), s1, c1, { forzado: true }),
    visita(1, sv('11T11:00'), s1, c1),
    visita(1, sv('11T12:00'), s1, c1),
    { clase: 'ajuste', tarjetaId: t[1].id, createdAt: sv('10T16:00'), sucursalId: s1, cajeroId: c1, puntos: 2 },
    // t3
    visita(2, sv('10T13:00'), s1, c2),
    visita(2, sv('11T13:00'), s1, c2),
    visita(2, sv('12T13:00'), s1, c2),
    // t4: los dos bordes del período, y el primer instante FUERA
    visita(3, sv('09T00:00'), s1, c2),
    visita(3, sv('12T23:59'), s1, c2),
    visita(3, sv('13T00:00'), s1, c2),
    // t5
    visita(4, sv('11T14:00'), s2, c2),
    { clase: 'canje', tarjetaId: t[4].id, createdAt: sv('10T15:00'), sucursalId: s2, cajeroId: c2, recompensaId: premio },
    // el mismo cliente que t1, en el spa (Bogotá)
    { clase: 'visita', tarjetaId: tSpa.id, createdAt: bo('10T23:30') },
    { clase: 'visita', tarjetaId: tSpa.id, createdAt: bo('13T00:30') },
  ]);
});

afterAll(async () => {
  await escenario.limpiar();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Los filtros como los arma la página: resueltos → filtrosRpc. Por defecto, el café en el período.
function filtros(
  extra: {
    comercios?: string[];
    desde?: string | null;
    hasta?: string;
    sucursal?: string;
    cajero?: string;
  } = {},
) {
  return filtrosRpc({
    alcance: (extra.comercios ?? [cafe]).map((comercioId) => ({ comercioId })),
    desde: extra.desde === undefined ? PERIODO.desde : extra.desde,
    hasta: extra.hasta ?? PERIODO.hasta,
    sucursal: extra.sucursal ? { id: extra.sucursal } : null,
    cajero: extra.cajero ? { id: extra.cajero } : null,
  });
}

// Espía las llamadas a supabase.rpc (sin cambiarlas): nombre de la función y argumentos.
function espiarRpc() {
  const espia = vi.spyOn(supabase, 'rpc');
  return (funcion: string) =>
    espia.mock.calls
      .filter(([nombre]) => nombre === funcion)
      .map(([, argumentos]) => argumentos as Record<string, unknown>);
}

const numerosResumen = (f: FilaReporteResumen | undefined) =>
  f && { operaciones: f.operaciones, puntos_otorgados: f.puntos_otorgados, canjes: f.canjes, clientes_unicos: f.clientes_unicos };

const numerosCajero = (f: FilaReporteCajeroAlcance | undefined) =>
  f && {
    operaciones: f.operaciones,
    puntos_otorgados: f.puntos_otorgados,
    monto_total: f.monto_total,
    forzadas: f.forzadas,
    ajustes: f.ajustes,
    puntos_ajustados: f.puntos_ajustados,
    canjes: f.canjes,
    clientes_unicos: f.clientes_unicos,
  };

describe('los nombres de los argumentos llegan por PostgREST', () => {
  it('las cuatro funciones responden (un argumento mal escrito sería PGRST202 → null)', async () => {
    const llamadas = espiarRpc();
    expect(await reporteResumen(supabase, filtros())).not.toBeNull();
    expect(await reportePorDia(supabase, filtros(), 'auto')).not.toBeNull();
    expect(await reporteCajerosAlcance(supabase, filtros())).not.toBeNull();
    expect(await reporteClientes(supabase, filtros(), { modo: 'todas' })).not.toBeNull();
    expect(
      await reporteClientes(supabase, filtros(), { modo: 'pagina', pagina: 1, orden: 'visitas', dir: 'desc' }),
    ).not.toBeNull();

    // Los tamaños por defecto: 1000 (el max-rows de PostgREST) para leer todo; 50 para la pantalla.
    expect(llamadas('reporte_clientes').map((a) => [a.p_limite, a.p_offset])).toEqual([
      [1000, 0],
      [50, 0],
    ]);
    // Los filtros van con SU nombre: los ids no se cruzan de argumento.
    expect(llamadas('reporte_cajeros_alcance')).toEqual([
      { p_comercios: [cafe], p_desde: '2026-03-09', p_hasta: '2026-03-12', p_sucursal_id: null, p_cajero_id: null },
    ]);
  });
});

describe('reporteResumen', () => {
  it('con tamaño de página 2: las 4 filas (múltiplo exacto) en 3 llamadas, la fila total PRIMERA', async () => {
    const llamadas = espiarRpc();
    const resultado = await reporteResumen(supabase, filtros(), { tamanoPagina: 2 });

    expect(resultado).not.toBeNull();
    expect(resultado!.alcanzoTope).toBe(false);
    const filas = resultado!.filas;
    // 2 + 2 + 0: la tercera, vacía, es la que dice que no hay más.
    expect(llamadas('reporte_resumen')).toHaveLength(3);
    expect(filas).toHaveLength(4);
    expect(filas.map((f) => f.es_total)).toEqual([true, false, false, false]);
    // "Sin sucursal" al final de su comercio.
    expect(filas[3].sucursal_id).toBeNull();
    expect(filas[3].comercio_id).toBe(cafe);

    const total = filas.find((f) => f.es_total);
    expect(total?.comercio_id).toBeNull();
    expect(numerosResumen(total)).toEqual({ operaciones: 16, puntos_otorgados: 16, canjes: 2, clientes_unicos: 5 });
    expect(numerosResumen(filas.find((f) => f.sucursal_id === s1))).toEqual({
      operaciones: 14,
      puntos_otorgados: 14,
      canjes: 1,
      clientes_unicos: 4,
    });
    expect(numerosResumen(filas.find((f) => f.sucursal_id === s2))).toEqual({
      operaciones: 1,
      puntos_otorgados: 1,
      canjes: 1,
      clientes_unicos: 1,
    });
    expect(numerosResumen(filas.find((f) => !f.es_total && f.sucursal_id === null))).toEqual({
      operaciones: 1,
      puntos_otorgados: 1,
      canjes: 0,
      clientes_unicos: 1,
    });
    expect(filas.find((f) => f.sucursal_id === s1)?.sucursal_nombre).toBe('Sucursal Prueba');
    expect(filas.find((f) => f.sucursal_id === s1)?.sucursal_activa).toBe(true);
  });

  it('filtra por sucursal y por cajero (en visitas Y en premios)', async () => {
    const porSucursal = await reporteResumen(supabase, filtros({ sucursal: s1 }), { tamanoPagina: 2 });
    expect(porSucursal!.filas.map((f) => [f.es_total, f.sucursal_id])).toEqual([
      [true, null],
      [false, s1],
    ]);
    expect(numerosResumen(porSucursal!.filas[0])).toEqual({ operaciones: 14, puntos_otorgados: 14, canjes: 1, clientes_unicos: 4 });

    const porCajero = await reporteResumen(supabase, filtros({ cajero: c2 }));
    const total = porCajero!.filas.find((f) => f.es_total);
    // t3 (3) + t4 (2) + t5 (1), y el premio de t5 (el de t1 es de C1).
    expect(numerosResumen(total)).toEqual({ operaciones: 6, puntos_otorgados: 6, canjes: 1, clientes_unicos: 3 });
  });

  it('dos comercios en zonas distintas: el mismo cliente cuenta 1, y cada comercio se corta en su zona', async () => {
    const resultado = await reporteResumen(supabase, filtros({ comercios: [cafe, spa] }));
    const total = resultado!.filas.find((f) => f.es_total);
    // 16 del café + 1 del spa (la de las 00:30 del 13 en Bogotá queda fuera: con la zona del café
    // serían las 23:30 del 12 y darían 18). Clientes: el de t1 está en los dos comercios y cuenta 1.
    expect(numerosResumen(total)).toEqual({ operaciones: 17, puntos_otorgados: 17, canjes: 2, clientes_unicos: 5 });
    expect(resultado!.filas.filter((f) => f.comercio_id === spa).map((f) => [f.sucursal_id, f.operaciones])).toEqual([
      [null, 1],
    ]);
  });
});

describe('reportePorDia', () => {
  it('con tamaño de página 2: 4 días (múltiplo exacto) en 3 llamadas, en orden, con los bordes del día', async () => {
    const llamadas = espiarRpc();
    const resultado = await reportePorDia(supabase, filtros(), 'dia', { tamanoPagina: 2 });

    expect(llamadas('reporte_por_dia')).toHaveLength(3);
    expect(resultado).toEqual({
      filas: [
        { periodo: '2026-03-09', operaciones: 3, canjes: 0, es_mes: false },
        { periodo: '2026-03-10', operaciones: 4, canjes: 1, es_mes: false },
        { periodo: '2026-03-11', operaciones: 5, canjes: 1, es_mes: false },
        // La de las 23:59 del 12 cuenta el 12; la de las 00:00 del 13, no.
        { periodo: '2026-03-12', operaciones: 4, canjes: 0, es_mes: false },
      ],
      alcanzoTope: false,
    });
  });

  it('con tamaño de página 2: 5 días en 3 llamadas; un día sin actividad sale en cero', async () => {
    const llamadas = espiarRpc();
    const resultado = await reportePorDia(supabase, filtros({ desde: '2026-03-08' }), 'dia', { tamanoPagina: 2 });

    expect(llamadas('reporte_por_dia')).toHaveLength(3);
    expect(resultado!.filas.map((f) => [f.periodo, f.operaciones, f.canjes])).toEqual([
      ['2026-03-08', 0, 0],
      ['2026-03-09', 3, 0],
      ['2026-03-10', 4, 1],
      ['2026-03-11', 5, 1],
      ['2026-03-12', 4, 0],
    ]);
  });

  it('p_agrupar llega: por mes, el tramo arranca en la primera actividad (febrero), no en enero', async () => {
    const resultado = await reportePorDia(
      supabase,
      filtros({ desde: '2026-01-01', hasta: '2026-03-31' }),
      'mes',
    );
    // Marzo: las 16 del período + la de las 00:00 del 13.
    expect(resultado!.filas).toEqual([
      { periodo: '2026-02-01', operaciones: 1, canjes: 0, es_mes: true },
      { periodo: '2026-03-01', operaciones: 17, canjes: 2, es_mes: true },
    ]);
  });

  it('filtra por sucursal y cajero juntos', async () => {
    const resultado = await reportePorDia(supabase, filtros({ sucursal: s2, cajero: c2 }), 'dia');
    // S2/C2 es solo t5: su premio del 10 y su visita del 11. Su primera actividad es el 10: el tramo
    // arranca ahí, no en el 09.
    expect(resultado!.filas.map((f) => [f.periodo, f.operaciones, f.canjes])).toEqual([
      ['2026-03-10', 0, 1],
      ['2026-03-11', 1, 0],
      ['2026-03-12', 0, 0],
    ]);
  });
});

describe('reporteClientes', () => {
  it('todas, con tamaño de página 2: los 5 clientes en 3 llamadas por p_offset, sin repetir', async () => {
    const llamadas = espiarRpc();
    const resultado = await reporteClientes(supabase, filtros(), { modo: 'todas', tamanoPagina: 2 });

    expect(resultado).not.toBeNull();
    expect(resultado!.alcanzoTope).toBe(false);
    expect(resultado!.filas.map((f) => f.cliente_id)).toEqual(t.map((x) => x.clienteId));
    expect(resultado!.filas.map((f) => f.operaciones)).toEqual([6, 4, 3, 2, 1]);
    // Se pagina con p_limite/p_offset (nunca .range()), por visitas desc.
    expect(llamadas('reporte_clientes').map((a) => [a.p_limite, a.p_offset, a.p_orden, a.p_desc])).toEqual([
      [2, 0, 'visitas', true],
      [2, 2, 'visitas', true],
      [2, 4, 'visitas', true],
    ]);
  });

  it('todas, con tamaño de página 2 y 4 clientes (múltiplo exacto): 2 llamadas, sin la última repetida', async () => {
    const llamadas = espiarRpc();
    const resultado = await reporteClientes(supabase, filtros({ sucursal: s1 }), { modo: 'todas', tamanoPagina: 2 });

    expect(resultado!.filas.map((f) => f.cliente_id)).toEqual(t.slice(0, 4).map((x) => x.clienteId));
    expect(resultado!.filas.map((f) => f.operaciones)).toEqual([5, 4, 3, 2]);
    expect(llamadas('reporte_clientes').map((a) => a.p_offset)).toEqual([0, 2]);
  });

  it('una página: la pedida, con total y offset efectivo', async () => {
    const pagina = await reporteClientes(supabase, filtros(), {
      modo: 'pagina',
      pagina: 2,
      orden: 'visitas',
      dir: 'desc',
      tamanoPagina: 2,
    });
    expect(pagina).not.toBeNull();
    expect(pagina!.filas.map((f) => f.cliente_id)).toEqual([t[2].clienteId, t[3].clienteId]);
    expect(pagina!.total).toBe(5);
    expect(pagina!.offsetEfectivo).toBe(2);
    // Tipos del JSON: bigint llega como number y timestamptz como texto ISO.
    const t4 = pagina!.filas[1];
    expect(typeof t4.operaciones).toBe('number');
    expect(new Date(t4.ultima_actividad).toISOString()).toBe(new Date(sv('12T23:59')).toISOString());
    expect(t4.nombre).toBe('Cliente Prueba');
    expect(t4.apellido).toBeNull();
    expect(t4.telefono).toMatch(/^\+503\d+$/);
  });

  it('una página más allá del final devuelve la ÚLTIMA (offset efectivo 4)', async () => {
    const pagina = await reporteClientes(supabase, filtros(), {
      modo: 'pagina',
      pagina: 999,
      orden: 'visitas',
      dir: 'desc',
      tamanoPagina: 2,
    });
    expect(pagina).toEqual({
      filas: [expect.objectContaining({ cliente_id: t[4].clienteId, operaciones: 1, total: 5, offset_efectivo: 4 })],
      total: 5,
      offsetEfectivo: 4,
    });
  });

  it('el orden y la dirección llegan: visitas ascendente empieza por t5', async () => {
    const pagina = await reporteClientes(supabase, filtros(), {
      modo: 'pagina',
      pagina: 1,
      orden: 'visitas',
      dir: 'asc',
      tamanoPagina: 2,
    });
    expect(pagina!.filas.map((f) => f.cliente_id)).toEqual([t[4].clienteId, t[3].clienteId]);
  });

  it('sin actividad, la página 5: cero filas, total 0 y el offset PEDIDO (contrato de la página vacía)', async () => {
    const pagina = await reporteClientes(supabase, filtros({ comercios: [spa], desde: '2026-01-01', hasta: '2026-01-31' }), {
      modo: 'pagina',
      pagina: 5,
      orden: 'visitas',
      dir: 'desc',
      tamanoPagina: 2,
    });
    expect(pagina).toEqual({ filas: [], total: 0, offsetEfectivo: 8 });
  });

  it('dos comercios: el mismo cliente es DOS filas, una por comercio', async () => {
    const resultado = await reporteClientes(supabase, filtros({ comercios: [cafe, spa] }), { modo: 'todas', tamanoPagina: 2 });
    expect(resultado!.filas).toHaveLength(6);
    const deT1 = resultado!.filas.filter((f) => f.cliente_id === t[0].clienteId);
    expect(deT1.map((f) => [f.comercio_id, f.operaciones]).sort()).toEqual(
      [
        [cafe, 6],
        [spa, 1],
      ].sort(),
    );
  });
});

describe('reporteCajerosAlcance', () => {
  it('con tamaño de página 2: las 3 filas en 2 llamadas; "Sin registrar" al final', async () => {
    const llamadas = espiarRpc();
    const resultado = await reporteCajerosAlcance(supabase, filtros(), { tamanoPagina: 2 });

    expect(llamadas('reporte_cajeros_alcance')).toHaveLength(2);
    const filas = resultado!.filas;
    expect(filas).toHaveLength(3);
    expect(filas[2].cajero_usuario_id).toBeNull();
    expect(filas[2].cajero_email).toBeNull();
    expect(filas.every((f) => f.comercio_id === cafe)).toBe(true);

    // C1: t1 (5) + t2 (4, una forzada); el ajuste de t2 es Corrección, no visita; el monto es el de la
    // visita de t1 (numeric llega como number).
    expect(numerosCajero(filas.find((f) => f.cajero_usuario_id === c1))).toEqual({
      operaciones: 9,
      puntos_otorgados: 9,
      monto_total: 12.5,
      forzadas: 1,
      ajustes: 1,
      puntos_ajustados: 2,
      canjes: 1,
      clientes_unicos: 2,
    });
    expect(numerosCajero(filas.find((f) => f.cajero_usuario_id === c2))).toEqual({
      operaciones: 6,
      puntos_otorgados: 6,
      monto_total: 0,
      forzadas: 0,
      ajustes: 0,
      puntos_ajustados: 0,
      canjes: 1,
      clientes_unicos: 3,
    });
    expect(numerosCajero(filas[2])).toEqual({
      operaciones: 1,
      puntos_otorgados: 1,
      monto_total: 0,
      forzadas: 0,
      ajustes: 0,
      puntos_ajustados: 0,
      canjes: 0,
      clientes_unicos: 1,
    });
  });

  it('filtra por sucursal: en S2 solo C2, con su visita y su premio', async () => {
    const resultado = await reporteCajerosAlcance(supabase, filtros({ sucursal: s2 }));
    expect(resultado!.filas.map((f) => [f.cajero_usuario_id, f.operaciones, f.canjes, f.clientes_unicos])).toEqual([
      [c2, 1, 1, 1],
    ]);
  });
});

describe('un error de la base da null, NUNCA [] (que se leería como "sin actividad")', () => {
  // Un id que no es uuid hace fallar la llamada en Postgres (22P02): es el error que se puede provocar
  // sin tocar la base.
  const rotos = () =>
    filtrosRpc({ alcance: [{ comercioId: 'no-es-un-uuid' }], desde: null, hasta: '2026-03-12', sucursal: null, cajero: null });

  it('reporteResumen', async () => {
    expect(await reporteResumen(supabase, rotos())).toBeNull();
  });
  it('reportePorDia', async () => {
    expect(await reportePorDia(supabase, rotos(), 'dia')).toBeNull();
  });
  it('reporteCajerosAlcance', async () => {
    expect(await reporteCajerosAlcance(supabase, rotos())).toBeNull();
  });
  it('reporteClientes, todas', async () => {
    expect(await reporteClientes(supabase, rotos(), { modo: 'todas' })).toBeNull();
  });
  it('reporteClientes, una página', async () => {
    expect(
      await reporteClientes(supabase, rotos(), { modo: 'pagina', pagina: 1, orden: 'visitas', dir: 'desc' }),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// El cargador compartido (la página y la ruta del Excel)
// ─────────────────────────────────────────────────────────────────────────────

describe('cargarContextoReportes', () => {
  const entorno = crearEntorno(supabase);
  // Cuentas de Auth del dueño que mira ("Vos"). Se borran DESPUÉS de limpiar(): usuarios_comercio las
  // referencia (auth_user_id → auth.users, sin cascade). En `finally`: si limpiar() lanza, se
  // intentan borrar igual (mismo patrón que cajeros.filtroReportes.test.ts).
  const cuentasAuth: string[] = [];

  afterEach(async () => {
    try {
      await entorno.limpiar();
    } finally {
      for (const id of cuentasAuth) {
        const { error } = await supabase.auth.admin.deleteUser(id);
        if (error) console.error('[test] no se pudo borrar la cuenta de Auth:', error.message);
      }
      cuentasAuth.length = 0;
    }
  });

  const emailUnico = (prefijo: string) =>
    `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2)}@ejemplo.test`;

  it('un comercio único queda resuelto SIN ?comercio: carga su zona, su tipo, sus sucursales y sus usuarios', async () => {
    const unico = await entorno.crearComercio({
      nombre: 'Café Único',
      zona_horaria: 'America/Bogota',
      tipo_tarjeta: 'cashback',
    });
    const sActiva = await entorno.crearSucursal(unico);
    const sInactiva = await entorno.crearSucursal(unico, false);
    const cajero = await entorno.crearCajero(unico);
    const email = emailUnico('dueno');
    const { data: cuenta, error: eCuenta } = await supabase.auth.admin.createUser({ email, email_confirm: true });
    if (eCuenta) throw eCuenta;
    cuentasAuth.push(cuenta.user.id);
    const { data: dueno, error: eDueno } = await supabase
      .from('usuarios_comercio')
      .insert({ comercio_id: unico, email, rol: 'owner', auth_user_id: cuenta.user.id })
      .select('id')
      .single();
    if (eDueno) throw eDueno;

    const sesion: SesionReportes = {
      authUserId: cuenta.user.id,
      comercioId: unico,
      comercios: [{ comercioId: unico, nombre: 'Café Único' }],
    };
    const resultado = await cargarContextoReportes(supabase, sesion, {});

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    const { contexto } = resultado;
    expect(contexto.comercioDeLasListas).toBe(unico);
    expect(contexto.zonaComercioActivo).toBe('America/Bogota');
    expect(contexto.datosComercios).toEqual([
      { comercioId: unico, zonaHoraria: 'America/Bogota', tipoPrincipal: 'cashback' },
    ]);
    // Activas e inactivas.
    expect(contexto.sucursales.map((s) => s.id).sort()).toEqual([sActiva, sInactiva].sort());
    // El dueño y el cajero; "Vos" es la cuenta de la sesión.
    expect(new Map(contexto.usuarios.map((u) => [u.id, u.esVos]))).toEqual(
      new Map([
        [dueno.id, true],
        [cajero, false],
      ]),
    );

    // Y con ESE contexto el resolver acepta la sucursal y el cajero de la URL: un dueño con un solo
    // comercio puede filtrar sin haber elegido comercio.
    const filtrosResueltos = resolverFiltrosReportes(
      sesion.comercios,
      { sucursal: sInactiva, cajero },
      contexto,
      new Date(),
    );
    expect(filtrosResueltos.comercio?.comercioId).toBe(unico);
    expect(filtrosResueltos.sucursal?.id).toBe(sInactiva);
    expect(filtrosResueltos.cajero?.id).toBe(cajero);
  });

  it('dos comercios: ?comercio= carga las listas de ESE; la zona del activo sigue siendo la del ACTIVO', async () => {
    const cafeActivo = await entorno.crearComercio({ nombre: 'Café', tipo_tarjeta: 'sellos' }); // El Salvador
    const spaElegido = await entorno.crearComercio({ nombre: 'Spa', zona_horaria: 'America/Bogota' });
    await entorno.crearSucursal(cafeActivo);
    await entorno.crearCajero(cafeActivo);
    const sucursalSpa = await entorno.crearSucursal(spaElegido);
    const cajeroSpa = await entorno.crearCajero(spaElegido);

    const sesion: SesionReportes = {
      authUserId: crypto.randomUUID(),
      comercioId: cafeActivo,
      comercios: [
        { comercioId: cafeActivo, nombre: 'Café' },
        { comercioId: spaElegido, nombre: 'Spa' },
      ],
    };

    const elegido = await cargarContextoReportes(supabase, sesion, { comercio: spaElegido });
    expect(elegido).toEqual({
      ok: true,
      contexto: {
        zonaComercioActivo: 'America/El_Salvador',
        datosComercios: [{ comercioId: spaElegido, zonaHoraria: 'America/Bogota', tipoPrincipal: 'puntos' }],
        comercioDeLasListas: spaElegido,
        sucursales: [expect.objectContaining({ id: sucursalSpa })],
        usuarios: [expect.objectContaining({ id: cajeroSpa, esVos: false })],
      },
    });

    // "Todo": sin listas (no hay contra qué validar una sucursal), con los datos de los DOS comercios.
    const todo = await cargarContextoReportes(supabase, sesion, {});
    expect(todo).toEqual({
      ok: true,
      contexto: {
        zonaComercioActivo: 'America/El_Salvador',
        datosComercios: [
          { comercioId: cafeActivo, zonaHoraria: 'America/El_Salvador', tipoPrincipal: 'sellos' },
          { comercioId: spaElegido, zonaHoraria: 'America/Bogota', tipoPrincipal: 'puntos' },
        ],
        comercioDeLasListas: null,
        sucursales: [],
        usuarios: [],
      },
    });
  });

  it('un error de la base se propaga: { ok: false }, nunca un contexto con listas vacías', async () => {
    const sesion: SesionReportes = {
      authUserId: crypto.randomUUID(),
      comercioId: 'no-es-un-uuid',
      comercios: [{ comercioId: 'no-es-un-uuid', nombre: 'Roto' }],
    };
    expect(await cargarContextoReportes(supabase, sesion, {})).toEqual({
      ok: false,
      error: 'No se pudieron leer las zonas horarias de los comercios.',
    });
  });
});

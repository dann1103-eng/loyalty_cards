import { describe, it, expect, afterEach } from 'vitest';
import JSZip from 'jszip';
import leerExcel, { readSheet } from 'read-excel-file/node';
import type { Cell, CellObject } from 'write-excel-file/node';
import {
  armarHojasExcelReportes,
  escribirXlsx,
  type DatosExcelReportes,
  type FiltrosExcelReportes,
  type HojaExcel,
  type FilaClientesExcel,
  type FilaResumenExcel,
  type FilaPorDiaExcel,
  type FilaCajerosExcel,
} from './excelReportes';
import type { ComercioOwner } from './filtrosReportes';

// El Excel de Reportes (spec 2026-09-23 §4). Dos niveles:
//   1. PURO: la estructura que armarHojasExcelReportes le entrega a write-excel-file (hojas, columnas,
//      tipos de celda, formatos, textos del Resumen).
//   2. IDA Y VUELTA: el .xlsx real, escrito con write-excel-file y leído con read-excel-file (valores y
//      tipos), y abierto como zip con jszip para lo que read-excel-file no devuelve (el formato de
//      cada celda y la fila fija). Lo que importa es lo que Excel va a mostrar: el formato se busca
//      en la CELDA (su estilo → su numFmt), no "en algún lugar de styles.xml".
//
// Las fechas: comercios en America/Bogota y Europe/Madrid (no solo El Salvador), y la ida y vuelta con
// la zona del PROCESO forzada a tres zonas distintas.
//
// MUTATION-TESTING (corridas el 2026-09-23 sobre el código en verde, con el mensaje que se vio caer):
// - `/100` de acumuladoExcel (unidadAcumulado.ts) quitado: caen 6, entre ellas "acumulado según el
//   tipo…" con `expected { value: 1250, …(2) } to deeply equal { value: 12.5, …(2) }` y las tres ida y
//   vuelta con `expected 1250 to be 12.5`.
// - El Excel escribe el bruto (`valor = bruto`, sin pasar por acumuladoExcel): caen 7, las de arriba y
//   "prepago… sin contador" con `expected { value: +0, type: [Function Number] } to be null`.
// - Monto vendido dividido por 100 (es DÓLARES): cae "todas las columnas; Monto vendido…" con
//   `expected [ 'Café Central', …(9) ] to deeply equal [ 'Café Central', …(9) ]`.
// - El tipo del PRIMER comercio del alcance para todas las filas: caen 5, entre ellas "acumulado según
//   el tipo…" con `expected { value: 0.08, …(2) } to deeply equal { value: 8, type: [Function Number] }`
//   y la del zip con `expected '$#,##0.00' to be null`.
// - Sin `format` en Última actividad: caen 7; la pura con `expected { …(2) } to match object { type:
//   [Function Date], …(1) }`, y las del archivo con el error de la librería "No `format` was specified
//   for a `Date` value in a cell in row 2 column 9…".
// - Última actividad con el formato de DÍA (se pierde la hora): caen 2, la del zip con `expected
//   'dd/mm/yyyy' to be 'dd/mm/yyyy hh:mm'`.
// - Teléfono sin `format: '@'`: caen 2, la pura con `expected { value: '+50377771234', …(1) } to
//   deeply equal { value: '+50377771234', …(2) }` y la del zip con `expected null to be '@'`. (La ida y
//   vuelta sola NO lo ve: read-excel-file devuelve el mismo texto con o sin "@"; por eso se mide el
//   formato de la celda en el zip.)
// - "Por día" acepta filas por mes (sin la guarda de `es_mes`): cae "SIEMPRE por día…" con `expected
//   [Function] to throw an error`.
// - Columna Comercio con `>= 1`: cae "Clientes: la columna Comercio solo con 2 o más…" con `expected [
//   'Comercio', 'Nombre', …(7) ] to deeply equal [ 'Nombre', 'Apellido', …(6) ]`. Con `> 2`: caen 5,
//   entre ellas la misma con `expected 'Nombre' to be 'Comercio'`.
// - Sin la nota de Clientes: cae "filtros en texto…" con `expected [ 'Comercio', 'Sucursal', …(8) ]
//   to deeply equal [ 'Comercio', 'Sucursal', …(9) ]`.
// - Sin el aviso de tope: caen 2, "una hoja que alcanzó el tope…" con `expected 'Comercio' to be
//   'Aviso'` y "varias hojas…" con `el Resumen no tiene el rótulo Aviso`.
// - Última actividad con la zona de los FILTROS y no la del comercio de la fila: caen 4, la pura con
//   `expected [ 2026, 9, 23, 17, 30 ] to deeply equal [ 2026, 9, 24, +0, 30 ]`, las ida y vuelta con
//   `expected 23 to be 24`.
// - Sin `stickyRowsCount`: caen 2, la del zip con `Clientes: expected '' to contain 'state="frozen"'`.
// - La fila total = "la de sucursal_id null": caen 2, "…venga donde venga" con `expected { value: 15,
//   type: [Function Number] } to deeply equal { value: 40, … }`.
// - Por sucursal filtrando "sucursal_id no null" en vez de `!es_total`: caen 2, `expected [ 'Centro' ]
//   to deeply equal [ 'Sin sucursal', 'Centro' ]`.
// - Cajero null escrito como su email (null): caen 2, `expected null to deeply equal { value: 'Sin
//   registrar', …(1) }`. Sucursal null escrita como su nombre (null): caen 2, `expected [ null, 'Centro'
//   ] to deeply equal [ 'Sin sucursal', 'Centro' ]`.

// ─────────────────────────────────────────────────────────────────────────────
// Datos de prueba
// ─────────────────────────────────────────────────────────────────────────────

const CAFE: ComercioOwner = { comercioId: 'c-cafe', nombre: 'Café Central' };
const PAN: ComercioOwner = { comercioId: 'c-pan', nombre: 'Panadería Sol' };
const MASAJES: ComercioOwner = { comercioId: 'c-masajes', nombre: 'Masajes Zen' };
const PIZZA: ComercioOwner = { comercioId: 'c-pizza', nombre: 'Pizza Nápoles' };

// Zona y tipo del programa principal de cada uno: cashback (centavos), sellos, prepago y cupón (sin
// contador).
const DATOS_COMERCIOS = new Map([
  ['c-cafe', { zonaHoraria: 'America/Bogota', tipoPrincipal: 'cashback' }],
  ['c-pan', { zonaHoraria: 'Europe/Madrid', tipoPrincipal: 'sellos' }],
  ['c-masajes', { zonaHoraria: 'America/El_Salvador', tipoPrincipal: 'prepago' }],
  ['c-pizza', { zonaHoraria: 'America/Bogota', tipoPrincipal: 'cupon' }],
]);

function filtrosDe(alcance: ComercioOwner[], cambios: Partial<FiltrosExcelReportes> = {}): FiltrosExcelReportes {
  return {
    periodo: '30d',
    desde: '2026-08-25',
    hasta: '2026-09-23',
    zonaHoraria: 'America/Bogota',
    comercio: alcance.length === 1 ? alcance[0] : null,
    alcance,
    sucursal: null,
    cajero: null,
    datosAlcance: new Map(alcance.map((c) => [c.comercioId, DATOS_COMERCIOS.get(c.comercioId)!])),
    ...cambios,
  };
}

// La fila total: clientes_unicos 3, MENOS que la suma de las sucursales (2 + 2): una persona con
// tarjeta en los dos comercios cuenta una vez. La hoja Resumen tiene que decir 3.
const TOTAL: FilaResumenExcel = {
  comercio_id: null,
  sucursal_id: null,
  sucursal_nombre: null,
  operaciones: 40,
  puntos_otorgados: 1258,
  canjes: 5,
  clientes_unicos: 3,
  es_total: true,
};
const CENTRO_CAFE: FilaResumenExcel = {
  comercio_id: 'c-cafe',
  sucursal_id: 's-centro',
  sucursal_nombre: 'Centro',
  operaciones: 25,
  puntos_otorgados: 1250, // centavos: $12.50
  canjes: 3,
  clientes_unicos: 2,
  es_total: false,
};
// Actividad SIN sucursal (anterior a la atribución): sucursal_id null como la fila total, pero no es
// la total.
const SIN_SUCURSAL_PAN: FilaResumenExcel = {
  comercio_id: 'c-pan',
  sucursal_id: null,
  sucursal_nombre: null,
  operaciones: 15,
  puntos_otorgados: 8, // sellos
  canjes: 2,
  clientes_unicos: 2,
  es_total: false,
};

// 03:30 UTC del 23 = 22:30 del 22 en Bogotá (UTC−5).
const ANA: FilaClientesExcel = {
  comercio_id: 'c-cafe',
  nombre: 'Ana',
  apellido: 'Pérez',
  telefono: '+50377771234',
  operaciones: 12,
  puntos_otorgados: 1250,
  canjes: 1,
  ultima_actividad: '2026-09-23T03:30:00+00:00',
};
// 22:30 UTC del 23 = 00:30 del 24 en Madrid (CEST, UTC+2). Un nombre que empieza con "=": en .xlsx es
// un texto, nunca una fórmula.
const BETO: FilaClientesExcel = {
  comercio_id: 'c-pan',
  nombre: '=1+1',
  apellido: null,
  telefono: '+34600111222',
  operaciones: 3,
  puntos_otorgados: 8,
  canjes: 0,
  ultima_actividad: '2026-09-23T22:30:00.123456+00:00',
};

const DIAS: FilaPorDiaExcel[] = [
  { periodo: '2026-09-21', operaciones: 4, canjes: 1, es_mes: false },
  { periodo: '2026-09-22', operaciones: 0, canjes: 0, es_mes: false }, // sin actividad: va igual
  { periodo: '2026-09-23', operaciones: 7, canjes: 2, es_mes: false },
];

const CAJERO_CAFE: FilaCajerosExcel = {
  comercio_id: 'c-cafe',
  cajero_usuario_id: 'u-caja1',
  cajero_email: 'caja1@cafe.sv',
  operaciones: 20,
  puntos_otorgados: 1250, // centavos
  monto_total: 150.5, // DÓLARES (monto_compra): no se divide
  forzadas: 2,
  ajustes: 1,
  canjes: 3,
  clientes_unicos: 2,
};
const SIN_CAJERO_PAN: FilaCajerosExcel = {
  comercio_id: 'c-pan',
  cajero_usuario_id: null,
  cajero_email: null,
  operaciones: 15,
  puntos_otorgados: 8,
  monto_total: 0,
  forzadas: 0,
  ajustes: 0,
  canjes: 2,
  clientes_unicos: 2,
};

// 14:05 UTC del 23 = 09:05 en Bogotá.
const GENERADO = new Date('2026-09-23T14:05:40Z');

function datosDe(cambios: Partial<DatosExcelReportes> = {}): DatosExcelReportes {
  return {
    filtros: filtrosDe([CAFE, PAN]),
    nombres: { sucursal: null, cajero: null },
    generado: GENERADO,
    resumen: { filas: [TOTAL, CENTRO_CAFE, SIN_SUCURSAL_PAN], alcanzoTope: false },
    porDia: { filas: DIAS, alcanzoTope: false },
    clientes: { filas: [ANA, BETO], alcanzoTope: false },
    cajeros: { filas: [CAJERO_CAFE, SIN_CAJERO_PAN], alcanzoTope: false },
    ...cambios,
  };
}

// Solo el Café, con solo sus filas (una fila de la Panadería sería de un comercio fuera del alcance).
function datosDeSoloCafe(cambios: Partial<DatosExcelReportes> = {}): DatosExcelReportes {
  return datosDe({
    filtros: filtrosDe([CAFE]),
    resumen: { filas: [TOTAL, CENTRO_CAFE], alcanzoTope: false },
    clientes: { filas: [ANA], alcanzoTope: false },
    cajeros: { filas: [CAJERO_CAFE], alcanzoTope: false },
    ...cambios,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Lectura de la estructura
// ─────────────────────────────────────────────────────────────────────────────

function hoja(hojas: HojaExcel[], nombre: string): HojaExcel {
  const encontrada = hojas.find((h) => h.sheet === nombre);
  if (!encontrada) throw new Error(`no hay hoja ${nombre}`);
  return encontrada;
}

function valor(c: Cell): unknown {
  return c !== null && typeof c === 'object' && !(c instanceof Date) ? (c as CellObject).value : c;
}

function encabezados(h: HojaExcel): unknown[] {
  return h.data[0].map(valor);
}

// La celda de la fila `fila` (1 = la primera de datos) bajo el encabezado `titulo`.
function celda(h: HojaExcel, fila: number, titulo: string): Cell {
  const indice = encabezados(h).indexOf(titulo);
  if (indice < 0) throw new Error(`la hoja ${h.sheet} no tiene la columna ${titulo}`);
  return h.data[fila][indice];
}

// El Resumen es de dos columnas: rótulo y valor. Devuelve la celda del valor del rótulo pedido.
function resumen(h: HojaExcel, rotulo: string): Cell {
  const fila = h.data.find((f) => valor(f[0]) === rotulo);
  if (!fila) throw new Error(`el Resumen no tiene el rótulo ${rotulo}`);
  return fila[1];
}

function rotulosResumen(h: HojaExcel): unknown[] {
  return h.data.map((f) => valor(f[0]));
}

function componentesUtc(d: unknown) {
  if (!(d instanceof Date)) throw new Error(`no es un Date: ${String(d)}`);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()];
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Estructura (pura)
// ─────────────────────────────────────────────────────────────────────────────

describe('armarHojasExcelReportes: hojas y columnas (spec §4)', () => {
  it('las cinco hojas, en el orden de la spec', () => {
    expect(armarHojasExcelReportes(datosDe()).map((h) => h.sheet)).toEqual([
      'Resumen',
      'Clientes',
      'Por día',
      'Por sucursal',
      'Cajeros',
    ]);
  });

  it('las columnas EXACTAS de cada hoja tabular, con dos comercios en el alcance', () => {
    const hojas = armarHojasExcelReportes(datosDe());
    expect(encabezados(hoja(hojas, 'Clientes'))).toEqual([
      'Comercio',
      'Nombre',
      'Apellido',
      'Teléfono',
      'Visitas',
      'Acumulado',
      'Unidad',
      'Premios',
      'Última actividad',
    ]);
    expect(encabezados(hoja(hojas, 'Por día'))).toEqual(['Día', 'Visitas', 'Premios']);
    expect(encabezados(hoja(hojas, 'Por sucursal'))).toEqual([
      'Comercio',
      'Sucursal',
      'Visitas',
      'Acumulado',
      'Unidad',
      'Premios',
      'Clientes',
    ]);
    expect(encabezados(hoja(hojas, 'Cajeros'))).toEqual([
      'Comercio',
      'Cajero',
      'Visitas',
      'Acumulado',
      'Unidad',
      'Monto vendido',
      'Forzadas',
      'Correcciones',
      'Premios',
      'Clientes',
    ]);
  });

  it('encabezados en negrita, primera fila fija y un ancho por columna en las hojas tabulares', () => {
    const hojas = armarHojasExcelReportes(datosDe());
    for (const nombre of ['Clientes', 'Por día', 'Por sucursal', 'Cajeros']) {
      const h = hoja(hojas, nombre);
      for (const c of h.data[0]) expect(c).toMatchObject({ type: String, fontWeight: 'bold' });
      expect(h.stickyRowsCount).toBe(1);
      expect(h.columns).toHaveLength(h.data[0].length);
      for (const columna of h.columns) expect(columna.width).toBeGreaterThanOrEqual(8);
    }
  });

  it('Clientes: la columna Comercio solo con 2 o más comercios en el alcance', () => {
    const conUno = armarHojasExcelReportes(datosDeSoloCafe());
    expect(encabezados(hoja(conUno, 'Clientes'))).toEqual([
      'Nombre',
      'Apellido',
      'Teléfono',
      'Visitas',
      'Acumulado',
      'Unidad',
      'Premios',
      'Última actividad',
    ]);
    expect(hoja(conUno, 'Clientes').data[1].map(valor)[0]).toBe('Ana');

    const conDos = armarHojasExcelReportes(datosDe());
    expect(encabezados(hoja(conDos, 'Clientes'))[0]).toBe('Comercio');
    const clientes = hoja(conDos, 'Clientes');
    expect(celda(clientes, 1, 'Comercio')).toEqual({ value: 'Café Central', type: String });
    expect(celda(clientes, 2, 'Comercio')).toEqual({ value: 'Panadería Sol', type: String });
  });
});

describe('armarHojasExcelReportes: Clientes (spec §3 y §4)', () => {
  it('números como números, texto como texto', () => {
    const clientes = hoja(armarHojasExcelReportes(datosDe()), 'Clientes');
    expect(celda(clientes, 1, 'Nombre')).toEqual({ value: 'Ana', type: String });
    expect(celda(clientes, 1, 'Apellido')).toEqual({ value: 'Pérez', type: String });
    expect(celda(clientes, 1, 'Visitas')).toEqual({ value: 12, type: Number });
    expect(celda(clientes, 1, 'Premios')).toEqual({ value: 1, type: Number });
    // Sin apellido: celda vacía, no el texto "null".
    expect(celda(clientes, 2, 'Apellido')).toBeNull();
  });

  it('el teléfono va como TEXTO con format "@" (Excel no lo reinterpreta como número)', () => {
    const clientes = hoja(armarHojasExcelReportes(datosDe()), 'Clientes');
    expect(celda(clientes, 1, 'Teléfono')).toEqual({ value: '+50377771234', type: String, format: '@' });
    expect(celda(clientes, 2, 'Teléfono')).toEqual({ value: '+34600111222', type: String, format: '@' });
  });

  it('acumulado según el tipo del comercio de CADA fila: centavos → dólares con $#,##0.00; sellos enteros', () => {
    const clientes = hoja(armarHojasExcelReportes(datosDe()), 'Clientes');
    // Ana es del Café (cashback): 1250 centavos son $12.50.
    expect(celda(clientes, 1, 'Acumulado')).toEqual({ value: 12.5, type: Number, format: '$#,##0.00' });
    expect(celda(clientes, 1, 'Unidad')).toEqual({ value: '$', type: String });
    // Beto es de la Panadería (sellos): 8 sellos, número general.
    expect(celda(clientes, 2, 'Acumulado')).toEqual({ value: 8, type: Number });
    expect(celda(clientes, 2, 'Unidad')).toEqual({ value: 'sellos', type: String });
  });

  it('prepago dice "visitas prepagadas"; los tipos sin contador dejan Acumulado y Unidad vacíos', () => {
    const hojas = armarHojasExcelReportes(
      datosDe({
        filtros: filtrosDe([MASAJES, PIZZA]),
        clientes: {
          filas: [
            { ...ANA, comercio_id: 'c-masajes', puntos_otorgados: 6 },
            { ...BETO, comercio_id: 'c-pizza', puntos_otorgados: 0 },
          ],
          alcanzoTope: false,
        },
        resumen: { filas: [TOTAL], alcanzoTope: false },
        cajeros: { filas: [], alcanzoTope: false },
      }),
    );
    const clientes = hoja(hojas, 'Clientes');
    expect(celda(clientes, 1, 'Acumulado')).toEqual({ value: 6, type: Number });
    expect(celda(clientes, 1, 'Unidad')).toEqual({ value: 'visitas prepagadas', type: String });
    // Cupón: un 0 ahí parecería un dato.
    expect(celda(clientes, 2, 'Acumulado')).toBeNull();
    expect(celda(clientes, 2, 'Unidad')).toBeNull();
  });

  it('Última actividad: fecha de Excel con el reloj LOCAL del comercio de cada fila, formato dd/mm/yyyy hh:mm', () => {
    const clientes = hoja(armarHojasExcelReportes(datosDe()), 'Clientes');
    const deAna = celda(clientes, 1, 'Última actividad');
    const deBeto = celda(clientes, 2, 'Última actividad');
    expect(deAna).toMatchObject({ type: Date, format: 'dd/mm/yyyy hh:mm' });
    expect(deBeto).toMatchObject({ type: Date, format: 'dd/mm/yyyy hh:mm' });
    // Ana (Café, Bogotá): 22:30 del 22. Beto (Panadería, Madrid): 00:30 del 24. La zona del FILTRO
    // (Bogotá) aplicada a Beto diría 17:30 del 23.
    expect(componentesUtc(valor(deAna))).toEqual([2026, 9, 22, 22, 30]);
    expect(componentesUtc(valor(deBeto))).toEqual([2026, 9, 24, 0, 30]);
  });

  it('una fila de un comercio fuera del alcance es un error, no un Excel con la unidad inventada', () => {
    expect(() =>
      armarHojasExcelReportes(
        datosDe({ clientes: { filas: [{ ...ANA, comercio_id: 'c-ajeno' }], alcanzoTope: false } }),
      ),
    ).toThrow('excelReportes: una fila es de un comercio fuera del alcance: c-ajeno');
  });
});

describe('armarHojasExcelReportes: Por día (spec §4)', () => {
  it('un Día por fila, fecha de Excel dd/mm/yyyy, días sin actividad incluidos', () => {
    const porDia = hoja(armarHojasExcelReportes(datosDe()), 'Por día');
    expect(porDia.data).toHaveLength(1 + 3);
    expect(celda(porDia, 1, 'Día')).toMatchObject({ type: Date, format: 'dd/mm/yyyy' });
    expect(componentesUtc(valor(celda(porDia, 1, 'Día')))).toEqual([2026, 9, 21, 0, 0]);
    expect(componentesUtc(valor(celda(porDia, 3, 'Día')))).toEqual([2026, 9, 23, 0, 0]);
    expect(celda(porDia, 1, 'Visitas')).toEqual({ value: 4, type: Number });
    expect(celda(porDia, 1, 'Premios')).toEqual({ value: 1, type: Number });
    expect(celda(porDia, 2, 'Visitas')).toEqual({ value: 0, type: Number });
    expect(celda(porDia, 2, 'Premios')).toEqual({ value: 0, type: Number });
  });

  it('SIEMPRE por día: filas agrupadas por mes son un error (la ruta pidió "auto" o "mes")', () => {
    expect(() =>
      armarHojasExcelReportes(
        datosDe({
          porDia: { filas: [{ periodo: '2026-09-01', operaciones: 40, canjes: 3, es_mes: true }], alcanzoTope: false },
        }),
      ),
    ).toThrow('excelReportes: la hoja Por día recibió filas agrupadas por mes');
  });
});

describe('armarHojasExcelReportes: Por sucursal (spec §4)', () => {
  it('una fila por (comercio, sucursal), sin la fila total; "Sin sucursal" para la sucursal null', () => {
    const porSucursal = hoja(armarHojasExcelReportes(datosDe()), 'Por sucursal');
    expect(porSucursal.data).toHaveLength(1 + 2);
    expect(porSucursal.data[1].map(valor)).toEqual(['Café Central', 'Centro', 25, 12.5, '$', 3, 2]);
    expect(porSucursal.data[2].map(valor)).toEqual(['Panadería Sol', 'Sin sucursal', 15, 8, 'sellos', 2, 2]);
    expect(celda(porSucursal, 1, 'Acumulado')).toEqual({ value: 12.5, type: Number, format: '$#,##0.00' });
  });
});

describe('armarHojasExcelReportes: Cajeros (spec §4)', () => {
  it('email del cajero; "Sin registrar" para el grupo sin cajero', () => {
    const cajeros = hoja(armarHojasExcelReportes(datosDe()), 'Cajeros');
    expect(celda(cajeros, 1, 'Cajero')).toEqual({ value: 'caja1@cafe.sv', type: String });
    expect(celda(cajeros, 2, 'Cajero')).toEqual({ value: 'Sin registrar', type: String });
  });

  it('todas las columnas; Monto vendido ya está en DÓLARES (no se divide) con $#,##0.00', () => {
    const cajeros = hoja(armarHojasExcelReportes(datosDe()), 'Cajeros');
    expect(cajeros.data[1].map(valor)).toEqual(['Café Central', 'caja1@cafe.sv', 20, 12.5, '$', 150.5, 2, 1, 3, 2]);
    expect(celda(cajeros, 1, 'Monto vendido')).toEqual({ value: 150.5, type: Number, format: '$#,##0.00' });
    expect(celda(cajeros, 1, 'Acumulado')).toEqual({ value: 12.5, type: Number, format: '$#,##0.00' });
    expect(cajeros.data[2].map(valor)).toEqual(['Panadería Sol', 'Sin registrar', 15, 8, 'sellos', 0, 0, 0, 2, 2]);
  });

  it('un monto que no es número es un error, no un 0', () => {
    expect(() =>
      armarHojasExcelReportes(
        datosDe({
          cajeros: { filas: [{ ...CAJERO_CAFE, monto_total: null as unknown as number }], alcanzoTope: false },
        }),
      ),
    ).toThrow('excelReportes: Monto vendido no es un número: null');
  });
});

describe('armarHojasExcelReportes: Resumen (spec §4)', () => {
  it('filtros en texto, totales de la fila es_total (no la suma), Generado y la nota de Clientes', () => {
    const r = hoja(armarHojasExcelReportes(datosDe()), 'Resumen');
    expect(rotulosResumen(r)).toEqual([
      'Comercio',
      'Sucursal',
      'Cajero',
      'Período',
      null,
      'Visitas',
      'Premios',
      'Clientes',
      null,
      'Generado',
      'Nota',
    ]);
    expect(r.data[0][0]).toMatchObject({ type: String, fontWeight: 'bold' });
    expect(resumen(r, 'Comercio')).toEqual({ value: 'Todos (Café Central, Panadería Sol)', type: String });
    expect(resumen(r, 'Sucursal')).toEqual({ value: 'Todas', type: String });
    expect(resumen(r, 'Cajero')).toEqual({ value: 'Todos', type: String });
    expect(resumen(r, 'Período')).toEqual({ value: '30 días: del 25/08/2026 al 23/09/2026', type: String });
    expect(resumen(r, 'Visitas')).toEqual({ value: 40, type: Number });
    expect(resumen(r, 'Premios')).toEqual({ value: 5, type: Number });
    // 3 de la fila total, no 2 + 2 de las sucursales.
    expect(resumen(r, 'Clientes')).toEqual({ value: 3, type: Number });
    expect(resumen(r, 'Nota')).toEqual({
      value:
        'Clientes = quien tuvo al menos una visita o un premio. La pantalla de cajeros del panel los cuenta de otra forma.',
      type: String,
    });
  });

  it('"Generado": fecha y hora LOCALES de la zona de los filtros', () => {
    const r = hoja(armarHojasExcelReportes(datosDe()), 'Resumen');
    expect(resumen(r, 'Generado')).toMatchObject({ type: Date, format: 'dd/mm/yyyy hh:mm' });
    // 14:05 UTC = 09:05 en Bogotá.
    expect(componentesUtc(valor(resumen(r, 'Generado')))).toEqual([2026, 9, 23, 9, 5]);
    const enMadrid = hoja(
      armarHojasExcelReportes(datosDe({ filtros: filtrosDe([CAFE, PAN], { zonaHoraria: 'Europe/Madrid' }) })),
      'Resumen',
    );
    expect(componentesUtc(valor(resumen(enMadrid, 'Generado')))).toEqual([2026, 9, 23, 16, 5]);
  });

  it('un comercio, una sucursal y un cajero elegidos: sus nombres', () => {
    const r = hoja(
      armarHojasExcelReportes(
        datosDeSoloCafe({
          filtros: filtrosDe([CAFE], { sucursal: { id: 's-centro' }, cajero: { id: 'u-caja1' } }),
          nombres: { sucursal: 'Centro', cajero: 'caja1@cafe.sv' },
        }),
      ),
      'Resumen',
    );
    expect(resumen(r, 'Comercio')).toEqual({ value: 'Café Central', type: String });
    expect(resumen(r, 'Sucursal')).toEqual({ value: 'Centro', type: String });
    expect(resumen(r, 'Cajero')).toEqual({ value: 'caja1@cafe.sv', type: String });
  });

  it('el período con sus fechas: un día, sin borde inferior, personalizado', () => {
    const periodo = (cambios: Partial<FiltrosExcelReportes>) =>
      valor(resumen(hoja(armarHojasExcelReportes(datosDe({ filtros: filtrosDe([CAFE, PAN], cambios) })), 'Resumen'), 'Período'));
    expect(periodo({ periodo: 'hoy', desde: '2026-09-23', hasta: '2026-09-23' })).toBe('Hoy: 23/09/2026');
    expect(periodo({ periodo: 'todo', desde: null, hasta: '2026-09-23' })).toBe('Desde siempre: hasta el 23/09/2026');
    expect(periodo({ periodo: 'rango', desde: '2026-01-05', hasta: '2026-02-10' })).toBe(
      'Personalizado: del 05/01/2026 al 10/02/2026',
    );
  });

  it('una sucursal o un cajero filtrados sin su nombre son un error: nunca "Todas" con un filtro puesto', () => {
    expect(() =>
      armarHojasExcelReportes(datosDeSoloCafe({ filtros: filtrosDe([CAFE], { sucursal: { id: 's-centro' } }) })),
    ).toThrow('excelReportes: falta el nombre de la sucursal filtrada');
    expect(() =>
      armarHojasExcelReportes(datosDeSoloCafe({ filtros: filtrosDe([CAFE], { cajero: { id: 'u-caja1' } }) })),
    ).toThrow('excelReportes: falta el nombre del cajero filtrado');
  });

  it('la fila total se reconoce por es_total, venga donde venga (no por "sucursal null")', () => {
    // La fila "sin sucursal" PRIMERO: un "la de sucursal_id null" tomaría esa (15 visitas) como total
    // y la sacaría de Por sucursal.
    const hojas = armarHojasExcelReportes(
      datosDe({ resumen: { filas: [SIN_SUCURSAL_PAN, CENTRO_CAFE, TOTAL], alcanzoTope: false } }),
    );
    expect(resumen(hoja(hojas, 'Resumen'), 'Visitas')).toEqual({ value: 40, type: Number });
    expect(hoja(hojas, 'Por sucursal').data.slice(1).map((f) => valor(f[1]))).toEqual(['Sin sucursal', 'Centro']);
  });

  it('sin la fila total es un error, no un Resumen en cero', () => {
    expect(() =>
      armarHojasExcelReportes(datosDe({ resumen: { filas: [CENTRO_CAFE, SIN_SUCURSAL_PAN], alcanzoTope: false } })),
    ).toThrow('excelReportes: reporte_resumen no trajo la fila total');
  });

  it('sin tope alcanzado no hay aviso', () => {
    expect(rotulosResumen(hoja(armarHojasExcelReportes(datosDe()), 'Resumen'))).not.toContain('Aviso');
  });

  it('una hoja que alcanzó el tope: el aviso, ARRIBA de todo', () => {
    const r = hoja(armarHojasExcelReportes(datosDe({ clientes: { filas: [ANA, BETO], alcanzoTope: true } })), 'Resumen');
    expect(rotulosResumen(r)[0]).toBe('Aviso');
    expect(resumen(r, 'Aviso')).toEqual({
      value: 'La hoja Clientes llegó al tope de 50 000 filas: está incompleta.',
      type: String,
    });
  });

  it('varias hojas en el tope: todas, en el orden de las hojas', () => {
    const r = hoja(
      armarHojasExcelReportes(
        datosDe({
          resumen: { filas: [TOTAL, CENTRO_CAFE], alcanzoTope: true },
          porDia: { filas: DIAS, alcanzoTope: true },
          cajeros: { filas: [CAJERO_CAFE], alcanzoTope: true },
        }),
      ),
      'Resumen',
    );
    expect(valor(resumen(r, 'Aviso'))).toBe(
      'Las hojas Por día, Por sucursal y Cajeros llegaron al tope de 50 000 filas: están incompletas.',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Ida y vuelta: el .xlsx real
// ─────────────────────────────────────────────────────────────────────────────

const tzOriginal = process.env.TZ;
const zonaOriginal = Intl.DateTimeFormat().resolvedOptions().timeZone;

function zonaDelProceso(zona: string) {
  process.env.TZ = zona;
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zona);
}

afterEach(() => {
  process.env.TZ = zonaOriginal;
  if (tzOriginal === undefined) delete process.env.TZ;
});

// El xml de una hoja del zip, por su NOMBRE (workbook.xml → r:id → rels → archivo), sin suponer que la
// segunda hoja es sheet2.xml.
async function abrirZip(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const leer = async (ruta: string) => {
    const archivo = zip.file(ruta);
    if (!archivo) throw new Error(`el zip no tiene ${ruta}`);
    return archivo.async('string');
  };
  const workbook = await leer('xl/workbook.xml');
  const relaciones = await leer('xl/_rels/workbook.xml.rels');
  const estilos = await leer('xl/styles.xml');
  async function xmlDeHoja(nombre: string): Promise<string> {
    const elemento = [...workbook.matchAll(/<sheet\b[^>]*\/>/g)].map((m) => m[0]).find((e) => e.includes(`name="${nombre}"`));
    const rid = elemento?.match(/\br:id="([^"]+)"/)?.[1];
    const relacion = [...relaciones.matchAll(/<Relationship\b[^>]*\/>/g)]
      .map((m) => m[0])
      .find((e) => e.includes(`Id="${rid}"`));
    const destino = relacion?.match(/\bTarget="([^"]+)"/)?.[1];
    if (!destino) throw new Error(`no encontré el xml de la hoja ${nombre}`);
    return leer(`xl/${destino}`);
  }
  // El formato que Excel le aplica a una celda: su `s` → el xf de cellXfs → su numFmt. null = General.
  function formatoDeCelda(xmlHoja: string, referencia: string): string | null {
    const elemento = xmlHoja.match(new RegExp(`<c\\b[^>]*\\br="${referencia}"[^>]*>`))?.[0];
    if (!elemento) throw new Error(`no hay celda ${referencia}`);
    const indice = Number(elemento.match(/\bs="(\d+)"/)?.[1] ?? 0);
    const xfs = [...(estilos.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '').matchAll(/<xf\b[^>]*>/g)].map(
      (m) => m[0],
    );
    const numFmtId = xfs[indice]?.match(/\bnumFmtId="(\d+)"/)?.[1];
    if (numFmtId === undefined) return null;
    const numFmt = estilos.match(new RegExp(`<numFmt\\b[^>]*\\bnumFmtId="${numFmtId}"[^>]*/>`))?.[0];
    return numFmt?.match(/\bformatCode="([^"]*)"/)?.[1] ?? `integrado:${numFmtId}`;
  }
  return { xmlDeHoja, formatoDeCelda, nombresDeHojas: () => [...workbook.matchAll(/<sheet\b[^>]*\bname="([^"]+)"/g)].map((m) => m[1]) };
}

// "A", "B", … para la columna de índice `i` (alcanza: ninguna hoja pasa de 26 columnas).
function letra(i: number): string {
  return String.fromCharCode(65 + i);
}

// Una fecha LEÍDA del .xlsx, redondeada al segundo. El archivo guarda el número de serie EXACTO que
// Excel mismo guardaría para esa hora (lo asierta "el número de serie de Generado…" abajo), pero
// read-excel-file lo vuelve a Date con error de coma flotante SIN redondear: 09:05 vuelve como
// 09:04:59.999 (se midió: 448 de los 1440 minutos de un día vuelven 1 ms antes). Redondear al segundo
// absorbe ese milisegundo del LECTOR y no esconde nada que importe: una hora o un minuto mal escritos
// siguen fallando.
function alSegundo(d: unknown): Date {
  if (!(d instanceof Date)) throw new Error(`no es un Date: ${String(d)}`);
  return new Date(Math.round(d.getTime() / 1000) * 1000);
}

describe('escribirXlsx: ida y vuelta con write-excel-file y read-excel-file', () => {
  it.each(['UTC', 'America/El_Salvador', 'Asia/Tokyo'])(
    'hojas, encabezados, números, fechas y teléfonos, con el proceso en %s',
    async (zona) => {
      zonaDelProceso(zona);
      const buffer = await escribirXlsx(armarHojasExcelReportes(datosDe()));

      const todas = await leerExcel(buffer, { trim: false });
      expect(todas.map((h) => h.sheet)).toEqual(['Resumen', 'Clientes', 'Por día', 'Por sucursal', 'Cajeros']);

      const clientes = await readSheet(buffer, 'Clientes', { trim: false });
      expect(clientes[0]).toEqual([
        'Comercio',
        'Nombre',
        'Apellido',
        'Teléfono',
        'Visitas',
        'Acumulado',
        'Unidad',
        'Premios',
        'Última actividad',
      ]);
      const [, ana, beto] = clientes;
      // Números como números.
      expect(ana[4]).toBe(12);
      expect(ana[5]).toBe(12.5);
      // El teléfono vuelve como texto intacto, con su +.
      expect(ana[3]).toBe('+50377771234');
      expect(beto[3]).toBe('+34600111222');
      // Un nombre con "=" vuelve como el texto que era, no como el resultado de una fórmula.
      expect(beto[1]).toBe('=1+1');
      // La fecha vuelve como Date con el reloj del comercio, en cualquier zona del proceso.
      expect(ana[8]).toBeInstanceOf(Date);
      expect(alSegundo(ana[8]).getUTCDate()).toBe(22);
      expect(alSegundo(ana[8]).getUTCHours()).toBe(22);
      expect(alSegundo(beto[8]).getUTCDate()).toBe(24);
      expect(alSegundo(beto[8]).getUTCHours()).toBe(0);

      const porDia = await readSheet(buffer, 'Por día', { trim: false });
      expect(porDia[0]).toEqual(['Día', 'Visitas', 'Premios']);
      expect(porDia[1][0]).toBeInstanceOf(Date);
      expect(componentesUtc(alSegundo(porDia[1][0]))).toEqual([2026, 9, 21, 0, 0]);
      expect(porDia[2]).toEqual([expect.any(Date), 0, 0]);

      const r = await readSheet(buffer, 'Resumen', { trim: false });
      const generado = r.find((f) => f[0] === 'Generado')?.[1];
      expect(componentesUtc(alSegundo(generado))).toEqual([2026, 9, 23, 9, 5]);
      expect(r.find((f) => f[0] === 'Clientes')?.[1]).toBe(3);
    },
  );

  it('el formato que Excel aplica a cada celda: $#,##0.00, "@" en el teléfono y las fechas', async () => {
    const buffer = await escribirXlsx(armarHojasExcelReportes(datosDe()));
    const zip = await abrirZip(buffer);
    const clientes = await readSheet(buffer, 'Clientes', { trim: false });
    const columna = (titulo: string) => letra(clientes[0].indexOf(titulo));
    const xml = await zip.xmlDeHoja('Clientes');
    // Fila 2 = Ana (Café, cashback).
    expect(zip.formatoDeCelda(xml, `${columna('Acumulado')}2`)).toBe('$#,##0.00');
    expect(zip.formatoDeCelda(xml, `${columna('Teléfono')}2`)).toBe('@');
    expect(zip.formatoDeCelda(xml, `${columna('Última actividad')}2`)).toBe('dd/mm/yyyy hh:mm');
    // Fila 3 = Beto (Panadería, sellos): número general, sin formato de dólares.
    expect(zip.formatoDeCelda(xml, `${columna('Acumulado')}3`)).toBeNull();

    const cajeros = await readSheet(buffer, 'Cajeros', { trim: false });
    const xmlCajeros = await zip.xmlDeHoja('Cajeros');
    expect(zip.formatoDeCelda(xmlCajeros, `${letra(cajeros[0].indexOf('Monto vendido'))}2`)).toBe('$#,##0.00');

    const xmlPorDia = await zip.xmlDeHoja('Por día');
    expect(zip.formatoDeCelda(xmlPorDia, 'A2')).toBe('dd/mm/yyyy');
  });

  it('el número de serie de "Generado" es EXACTAMENTE el de las 09:05 del 23/09/2026 (lo que Excel muestra)', async () => {
    const buffer = await escribirXlsx(armarHojasExcelReportes(datosDe()));
    const zip = await abrirZip(buffer);
    const r = await readSheet(buffer, 'Resumen', { trim: false });
    const referencia = `B${r.findIndex((f) => f[0] === 'Generado') + 1}`;
    const xml = await zip.xmlDeHoja('Resumen');
    const serie = xml.match(new RegExp(`<c\\b[^>]*\\br="${referencia}"[^>]*>\\s*<v>([^<]+)</v>`))?.[1];
    // Días desde el 30/12/1899 (el cero de Excel) más la fracción del día: 09:05 = 545 de 1440 minutos.
    expect(Number(serie)).toBe(46288 + 545 / 1440);
    expect(zip.formatoDeCelda(xml, referencia)).toBe('dd/mm/yyyy hh:mm');
  });

  it('la primera fila fija en las hojas tabulares, y ni una fórmula en todo el archivo', async () => {
    const buffer = await escribirXlsx(armarHojasExcelReportes(datosDe()));
    const zip = await abrirZip(buffer);
    for (const nombre of ['Clientes', 'Por día', 'Por sucursal', 'Cajeros']) {
      const panel = (await zip.xmlDeHoja(nombre)).match(/<pane\b[^>]*\/>/)?.[0] ?? '';
      expect(panel, nombre).toContain('state="frozen"');
      expect(panel, nombre).toContain('ySplit="1"');
    }
    for (const nombre of zip.nombresDeHojas()) {
      expect(await zip.xmlDeHoja(nombre), nombre).not.toMatch(/<f[\s>]/);
    }
  });
});

import writeXlsxFile from 'write-excel-file/node';
import type { Cell, Row, SheetData } from 'write-excel-file/node';
import type { Database } from '../supabase/types';
import type { FiltrosReportes } from './filtrosReportes';
import { fechaExcel, diaExcel, FORMATO_DIA_EXCEL, FORMATO_FECHA_HORA_EXCEL } from './fechaExcel';
import { acumuladoExcel, FORMATO_DOLARES } from './unidadAcumulado';
import { ETIQUETA_PERIODO } from './rangoFechas';
import { TOPE_FILAS, type Paginado } from './paginar';

// El Excel de Reportes (spec 2026-09-23 §4): las cinco hojas, armadas a partir de filas YA LEÍDAS.
//
// armarHojasExcelReportes es PURA: no lee la base ni escribe el archivo, así que las reglas (columnas,
// tipos de celda, unidad del acumulado, fechas, textos del Resumen) se prueban sin montar nada. La ruta
// (Tarea 5, segunda mitad) lee con los wrappers, llama a esto y le pasa el resultado a escribirXlsx.
//
// NUNCA UN ARCHIVO QUE PAREZCA CIERTO Y NO LO SEA. Todo lo que no cierra LANZA (y la ruta responde 500):
// una fila de un comercio fuera del alcance (¿con qué unidad se escribe su acumulado?), un número que
// no es número, un Resumen sin fila total, "Por día" con filas por mes. Mismo criterio que fechaExcel:
// un dato ilegible no se convierte en uno inventado. (Un filtro de sucursal o cajero sin su nombre ni
// siquiera llega acá: lo rechaza el tipo, ver FiltrosExcelReportes.)

type Funciones = Database['public']['Functions'];

// Lo que cada hoja usa de cada función de la 0040. Pick y no la fila entera: las filas completas que
// devuelven los wrappers son asignables a estas, y las pruebas no tienen que inventar columnas que el
// Excel no lee (total, offset_efectivo, cliente_id…).
export type FilaResumenExcel = Pick<
  Funciones['reporte_resumen']['Returns'][number],
  | 'comercio_id'
  | 'sucursal_id'
  | 'sucursal_nombre'
  | 'operaciones'
  | 'puntos_otorgados'
  | 'canjes'
  | 'clientes_unicos'
  | 'es_total'
>;
export type FilaPorDiaExcel = Pick<
  Funciones['reporte_por_dia']['Returns'][number],
  'periodo' | 'operaciones' | 'canjes' | 'es_mes'
>;
export type FilaClientesExcel = Pick<
  Funciones['reporte_clientes']['Returns'][number],
  'comercio_id' | 'nombre' | 'apellido' | 'telefono' | 'operaciones' | 'puntos_otorgados' | 'canjes' | 'ultima_actividad'
>;
export type FilaCajerosExcel = Pick<
  Funciones['reporte_cajeros_alcance']['Returns'][number],
  | 'comercio_id'
  | 'cajero_usuario_id'
  | 'cajero_email'
  | 'operaciones'
  | 'puntos_otorgados'
  | 'monto_total'
  | 'forzadas'
  | 'ajustes'
  | 'canjes'
  | 'clientes_unicos'
>;

// Lo que el Excel usa de los filtros resueltos (resolverFiltrosReportes). El resolver es genérico en la
// sucursal y el usuario (solo valida el id); el Excel NO: tiene que escribir en el Resumen el nombre de
// la sucursal filtrada y el email del cajero filtrado, así que los exige EN EL TIPO. Un filtro puesto
// sin su nombre no compila, en vez de lanzar en tiempo de ejecución (o de decir "Todas" sobre un Excel
// filtrado). Las listas reales ya los traen: SucursalListada tiene `nombre` y UsuarioDelComercio,
// `email` (NOT NULL), así que un FiltrosReportes<SucursalListada, UsuarioDelComercio> se pasa tal cual.
// El email y no "Vos": el archivo se reenvía, y en manos de un socio "Vos" no dice quién.
// (El comercio no hace falta: filtros.comercio y filtros.alcance ya traen su nombre.)
export type FiltrosExcelReportes = Pick<
  FiltrosReportes<{ id: string; nombre: string }, { id: string; email: string }>,
  'periodo' | 'desde' | 'hasta' | 'zonaHoraria' | 'comercio' | 'alcance' | 'sucursal' | 'cajero' | 'datosAlcance'
>;

export interface DatosExcelReportes {
  filtros: FiltrosExcelReportes;
  // El instante en que se generó (la ruta pasa new Date()); se muestra en la zona de los filtros.
  generado: Date;
  // Las cuatro lecturas, como las devuelven paginarPorOffset/paginarPorRango: sus filas y si se cortaron
  // en TOPE_FILAS. `resumen` alimenta dos hojas: su fila total, el Resumen; las otras, Por sucursal.
  resumen: Paginado<FilaResumenExcel>;
  // Pedido con p_agrupar = 'dia', NUNCA 'auto': la hoja es SIEMPRE por día (lanza si llega por mes).
  porDia: Paginado<FilaPorDiaExcel>;
  clientes: Paginado<FilaClientesExcel>;
  cajeros: Paginado<FilaCajerosExcel>;
}

// Una hoja en el formato de write-excel-file (varias hojas = un arreglo de estas; ver su README).
export interface HojaExcel {
  sheet: string;
  data: SheetData;
  // Ancho de cada columna, en caracteres.
  columns: { width: number }[];
  // 1 = la fila de encabezados queda fija al scrollear. El Resumen no tiene encabezados: sin fijar.
  stickyRowsCount?: number;
}

// Los nombres de las hojas, en el orden de la spec (y del archivo).
const HOJA = {
  resumen: 'Resumen',
  clientes: 'Clientes',
  porDia: 'Por día',
  porSucursal: 'Por sucursal',
  cajeros: 'Cajeros',
} as const;

// La definición de Clientes de la 0040 (visita O premio) no es la de la pantalla de cajeros, que sigue
// con reporte_cajeros (cualquier fila del ledger, ajustes incluidos, sin canjes): el Resumen lo aclara.
const NOTA_CLIENTES =
  'Clientes = quien tuvo al menos una visita o un premio. La pantalla de cajeros del panel los cuenta de otra forma.';

const SIN_SUCURSAL = 'Sin sucursal';
const SIN_CAJERO = 'Sin registrar';

// ─────────────────────────────────────────────────────────────────────────────
// Celdas
// ─────────────────────────────────────────────────────────────────────────────

function texto(valor: string | null): Cell {
  return valor === null ? null : { value: valor, type: String };
}

function negrita(valor: string): Cell {
  return { value: valor, type: String, fontWeight: 'bold' };
}

// Un número de la base. Number() y no el valor crudo porque `numeric` (monto_total) podría llegar como
// texto; pero un null, un texto vacío o algo ilegible LANZA: Number(null) es 0, y un 0 inventado en una
// columna de montos es justo el Excel "con ceros por un error" que la spec prohíbe.
function numero(valor: number | string, columna: string): number {
  const n = typeof valor === 'number' || (typeof valor === 'string' && valor.trim() !== '') ? Number(valor) : NaN;
  if (!Number.isFinite(n)) throw new Error(`excelReportes: ${columna} no es un número: ${String(valor)}`);
  return n;
}

function celdaNumero(valor: number | string, columna: string): Cell {
  return { value: numero(valor, columna), type: Number };
}

function celdaDolares(valor: number | string, columna: string): Cell {
  return { value: numero(valor, columna), type: Number, format: FORMATO_DOLARES };
}

// El teléfono va como TEXTO (conserva el +503) con formato "@": sin él, Excel "ayuda" y reinterpreta
// una cadena de dígitos como número. Un texto que empieza con "=" es un string en .xlsx (en
// write-excel-file solo es fórmula un valor con type 'Formula'): no hace falta el apóstrofo del CSV.
function celdaTelefono(valor: string): Cell {
  return { value: valor, type: String, format: '@' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Comercios del alcance
// ─────────────────────────────────────────────────────────────────────────────

interface ComercioDeFila {
  nombre: string;
  zonaHoraria: string;
  tipoPrincipal: string;
}

// El nombre, la zona y el tipo del comercio de UNA fila. La zona y el tipo son los de ESE comercio y
// no los de los filtros: con "Todo", un cashback en Bogotá y unos sellos en Madrid van en la misma
// hoja, y cada fila tiene su unidad y su reloj.
function comercioDeFila(filtros: FiltrosExcelReportes, comercioId: string | null): ComercioDeFila {
  const comercio = filtros.alcance.find((c) => c.comercioId === comercioId);
  const datos = comercioId === null ? undefined : filtros.datosAlcance.get(comercioId);
  if (!comercio || !datos) {
    throw new Error(`excelReportes: una fila es de un comercio fuera del alcance: ${String(comercioId)}`);
  }
  return { nombre: comercio.nombre, ...datos };
}

// Acumulado y Unidad (spec, "Unidad del acumulado"): en centavos, `bruto / 100` con $#,##0.00; en
// puntos, sellos y prepago, el entero; en los tipos sin contador, las dos celdas vacías (un 0 ahí
// parecería un dato). La regla vive en acumuladoExcel: acá solo se la pasa a celdas.
function celdaAcumulado(tipo: string, bruto: number): Cell {
  const { valor, formato } = acumuladoExcel(tipo, numero(bruto, 'Acumulado'));
  if (valor === null) return null;
  return formato === undefined ? { value: valor, type: Number } : { value: valor, type: Number, format: formato };
}

function celdaUnidad(tipo: string, bruto: number): Cell {
  return texto(acumuladoExcel(tipo, numero(bruto, 'Acumulado')).unidad);
}

// ─────────────────────────────────────────────────────────────────────────────
// Hojas tabulares
// ─────────────────────────────────────────────────────────────────────────────

// Cada columna junta su encabezado, su ancho y su celda: no hay forma de que un encabezado quede
// corrido respecto de sus datos.
interface Columna<F> {
  titulo: string;
  ancho: number;
  celda: (fila: F) => Cell;
}

function hojaTabular<F>(nombre: string, columnas: Columna<F>[], filas: F[]): HojaExcel {
  return {
    sheet: nombre,
    data: [columnas.map((c) => negrita(c.titulo)), ...filas.map((f): Row => columnas.map((c) => c.celda(f)))],
    columns: columnas.map((c) => ({ width: c.ancho })),
    stickyRowsCount: 1,
  };
}

function hojaClientes(filtros: FiltrosExcelReportes, filas: FilaClientesExcel[]): HojaExcel {
  const de = (f: FilaClientesExcel) => comercioDeFila(filtros, f.comercio_id);
  const columnas: Columna<FilaClientesExcel>[] = [
    // Comercio solo con 2 o más en el ALCANCE (no los del dueño: con uno elegido de entre dos, no va).
    // Mismo umbral que la tabla de la pantalla (columnasTablaClientes).
    ...(filtros.alcance.length >= 2
      ? [{ titulo: 'Comercio', ancho: 24, celda: (f: FilaClientesExcel) => texto(de(f).nombre) }]
      : []),
    { titulo: 'Nombre', ancho: 18, celda: (f) => texto(f.nombre) },
    { titulo: 'Apellido', ancho: 18, celda: (f) => texto(f.apellido) },
    { titulo: 'Teléfono', ancho: 16, celda: (f) => celdaTelefono(f.telefono) },
    { titulo: 'Visitas', ancho: 9, celda: (f) => celdaNumero(f.operaciones, 'Visitas') },
    { titulo: 'Acumulado', ancho: 12, celda: (f) => celdaAcumulado(de(f).tipoPrincipal, f.puntos_otorgados) },
    { titulo: 'Unidad', ancho: 19, celda: (f) => celdaUnidad(de(f).tipoPrincipal, f.puntos_otorgados) },
    { titulo: 'Premios', ancho: 9, celda: (f) => celdaNumero(f.canjes, 'Premios') },
    {
      titulo: 'Última actividad',
      ancho: 17,
      // El reloj del comercio de la fila (no el de los filtros).
      celda: (f) => ({
        value: fechaExcel(f.ultima_actividad, de(f).zonaHoraria),
        type: Date,
        format: FORMATO_FECHA_HORA_EXCEL,
      }),
    },
  ];
  return hojaTabular(HOJA.clientes, columnas, filas);
}

function hojaPorDia(filas: FilaPorDiaExcel[]): HojaExcel {
  // La hoja dice "Día": filas por mes (una ruta que pidió 'auto' o 'mes') escribirían el día 1 de cada
  // mes con los totales del mes entero, y parecerían días.
  if (filas.some((f) => f.es_mes)) {
    throw new Error('excelReportes: la hoja Por día recibió filas agrupadas por mes');
  }
  return hojaTabular(
    HOJA.porDia,
    [
      // El día ya viene LOCAL de su comercio (lo cortó la SQL): diaExcel no convierte nada.
      { titulo: 'Día', ancho: 12, celda: (f) => ({ value: diaExcel(f.periodo), type: Date, format: FORMATO_DIA_EXCEL }) },
      { titulo: 'Visitas', ancho: 9, celda: (f) => celdaNumero(f.operaciones, 'Visitas') },
      { titulo: 'Premios', ancho: 9, celda: (f) => celdaNumero(f.canjes, 'Premios') },
    ],
    filas,
  );
}

function hojaPorSucursal(filtros: FiltrosExcelReportes, filas: FilaResumenExcel[]): HojaExcel {
  const de = (f: FilaResumenExcel) => comercioDeFila(filtros, f.comercio_id);
  return hojaTabular(
    HOJA.porSucursal,
    [
      { titulo: 'Comercio', ancho: 24, celda: (f) => texto(de(f).nombre) },
      {
        titulo: 'Sucursal',
        ancho: 24,
        // La actividad sin sucursal también tiene sucursal_id null: la anterior a la atribución, y la
        // de un dueño que escanea con "Sin especificar" en el selector del escáner (Escaner.tsx: ''
        // → null). La fila TOTAL ya se sacó por `es_total`, así que acá null es "sin sucursal".
        celda: (f) => texto(f.sucursal_id === null ? SIN_SUCURSAL : (f.sucursal_nombre ?? SIN_SUCURSAL)),
      },
      { titulo: 'Visitas', ancho: 9, celda: (f) => celdaNumero(f.operaciones, 'Visitas') },
      { titulo: 'Acumulado', ancho: 12, celda: (f) => celdaAcumulado(de(f).tipoPrincipal, f.puntos_otorgados) },
      { titulo: 'Unidad', ancho: 19, celda: (f) => celdaUnidad(de(f).tipoPrincipal, f.puntos_otorgados) },
      { titulo: 'Premios', ancho: 9, celda: (f) => celdaNumero(f.canjes, 'Premios') },
      { titulo: 'Clientes', ancho: 9, celda: (f) => celdaNumero(f.clientes_unicos, 'Clientes') },
    ],
    filas,
  );
}

function hojaCajeros(filtros: FiltrosExcelReportes, filas: FilaCajerosExcel[]): HojaExcel {
  const de = (f: FilaCajerosExcel) => comercioDeFila(filtros, f.comercio_id);
  return hojaTabular(
    HOJA.cajeros,
    [
      { titulo: 'Comercio', ancho: 24, celda: (f) => texto(de(f).nombre) },
      {
        titulo: 'Cajero',
        ancho: 30,
        // cajero_usuario_id null = actividad anterior a la atribución de cajero.
        celda: (f) => texto(f.cajero_usuario_id === null ? SIN_CAJERO : (f.cajero_email ?? SIN_CAJERO)),
      },
      { titulo: 'Visitas', ancho: 9, celda: (f) => celdaNumero(f.operaciones, 'Visitas') },
      { titulo: 'Acumulado', ancho: 12, celda: (f) => celdaAcumulado(de(f).tipoPrincipal, f.puntos_otorgados) },
      { titulo: 'Unidad', ancho: 19, celda: (f) => celdaUnidad(de(f).tipoPrincipal, f.puntos_otorgados) },
      // monto_compra se guarda en DÓLARES (numeric, lo que teclea el cajero): no se divide, a diferencia
      // del acumulado de cashback y gift card, que son centavos.
      { titulo: 'Monto vendido', ancho: 14, celda: (f) => celdaDolares(f.monto_total, 'Monto vendido') },
      { titulo: 'Forzadas', ancho: 10, celda: (f) => celdaNumero(f.forzadas, 'Forzadas') },
      { titulo: 'Correcciones', ancho: 13, celda: (f) => celdaNumero(f.ajustes, 'Correcciones') },
      { titulo: 'Premios', ancho: 9, celda: (f) => celdaNumero(f.canjes, 'Premios') },
      { titulo: 'Clientes', ancho: 9, celda: (f) => celdaNumero(f.clientes_unicos, 'Clientes') },
    ],
    filas,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Resumen
// ─────────────────────────────────────────────────────────────────────────────

// 'AAAA-MM-DD' → 'dd/mm/yyyy', como lo muestran las celdas de fecha. Pasa por diaExcel para validar:
// una fecha ilegible lanza en vez de escribirse cruda.
function diaLegible(dia: string): string {
  const fecha = diaExcel(dia);
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${dos(fecha.getUTCDate())}/${dos(fecha.getUTCMonth() + 1)}/${fecha.getUTCFullYear()}`;
}

// "30 días: del 25/08/2026 al 23/09/2026"; "Hoy: 23/09/2026"; "Desde siempre: hasta el 23/09/2026".
function textoPeriodo(filtros: FiltrosExcelReportes): string {
  const etiqueta = ETIQUETA_PERIODO[filtros.periodo];
  const hasta = diaLegible(filtros.hasta);
  if (filtros.desde === null) return `${etiqueta}: hasta el ${hasta}`;
  if (filtros.desde === filtros.hasta) return `${etiqueta}: ${hasta}`;
  return `${etiqueta}: del ${diaLegible(filtros.desde)} al ${hasta}`;
}

// "50 000": el tope con separador de miles fijo (toLocaleString depende del ICU del proceso).
const TOPE_LEGIBLE = String(TOPE_FILAS).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

// El aviso de las hojas cortadas en TOPE_FILAS, en el orden de las hojas; null si ninguna. Dice QUÉ
// HACER, no solo qué pasó: achicar el período siempre sirve; elegir un comercio, solo con "Todo" (con
// uno ya elegido, mandarlo a elegir un comercio no tendría sentido).
function avisoTope(datos: DatosExcelReportes): string | null {
  const hojas: { hoja: string; corto: boolean }[] = [
    { hoja: HOJA.clientes, corto: datos.clientes.alcanzoTope },
    { hoja: HOJA.porDia, corto: datos.porDia.alcanzoTope },
    // Las filas de reporte_resumen que se cortan son las de Por sucursal: la fila total la calcula la
    // SQL sobre TODO el alcance, así que los números del Resumen siguen siendo completos.
    { hoja: HOJA.porSucursal, corto: datos.resumen.alcanzoTope },
    { hoja: HOJA.cajeros, corto: datos.cajeros.alcanzoTope },
  ];
  const cortadas = hojas.filter((h) => h.corto).map((h) => h.hoja);
  if (cortadas.length === 0) return null;
  const queHacer = datos.filtros.comercio === null ? 'achicá el período o elegí un comercio' : 'achicá el período';
  if (cortadas.length === 1) {
    return `La hoja ${cortadas[0]} llegó al tope de ${TOPE_LEGIBLE} filas y está incompleta: ${queHacer}.`;
  }
  const lista = `${cortadas.slice(0, -1).join(', ')} y ${cortadas[cortadas.length - 1]}`;
  return `Las hojas ${lista} llegaron al tope de ${TOPE_LEGIBLE} filas y están incompletas: ${queHacer}.`;
}

function hojaResumen(datos: DatosExcelReportes, total: FilaResumenExcel): HojaExcel {
  const { filtros } = datos;
  const fila = (rotulo: string, valor: Cell): Row => [negrita(rotulo), valor];
  const separador: Row = [null, null];

  const comercio = filtros.comercio
    ? filtros.comercio.nombre
    : `Todos (${filtros.alcance.map((c) => c.nombre).join(', ')})`;
  const aviso = avisoTope(datos);

  const data: SheetData = [
    // El aviso ARRIBA de todo: es lo primero que el dueño tiene que leer si el archivo está incompleto.
    ...(aviso === null ? [] : [fila('Aviso', texto(aviso)), separador]),
    fila('Comercio', texto(comercio)),
    // El nombre y el email vienen en los propios filtros: el tipo no deja pasar uno sin ellos.
    fila('Sucursal', texto(filtros.sucursal?.nombre ?? 'Todas')),
    fila('Cajero', texto(filtros.cajero?.email ?? 'Todos')),
    fila('Período', texto(textoPeriodo(filtros))),
    separador,
    // De la fila TOTAL, nunca la suma de las sucursales: quien fue a dos (o tiene tarjeta en dos
    // comercios) es UN cliente.
    fila('Visitas', celdaNumero(total.operaciones, 'Visitas')),
    fila('Premios', celdaNumero(total.canjes, 'Premios')),
    fila('Clientes', celdaNumero(total.clientes_unicos, 'Clientes')),
    separador,
    // En la zona en que se resolvieron los filtros (la del comercio elegido, o la del activo con "Todo").
    fila('Generado', { value: fechaExcel(datos.generado, filtros.zonaHoraria), type: Date, format: FORMATO_FECHA_HORA_EXCEL }),
    fila('Nota', texto(NOTA_CLIENTES)),
  ];
  return { sheet: HOJA.resumen, data, columns: [{ width: 12 }, { width: 70 }] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Entrada pública
// ─────────────────────────────────────────────────────────────────────────────

// Las cinco hojas, en el orden de la spec: Resumen, Clientes, Por día, Por sucursal, Cajeros.
export function armarHojasExcelReportes(datos: DatosExcelReportes): HojaExcel[] {
  // La fila total se reconoce por `es_total`, NUNCA por "los ids son null": la actividad sin sucursal
  // también tiene sucursal_id null (ver la 0040). La SQL la devuelve SIEMPRE, con ceros si no hubo
  // actividad: si falta, algo se rompió y no se escribe un Resumen en cero.
  const total = datos.resumen.filas.find((f) => f.es_total);
  if (!total) throw new Error('excelReportes: reporte_resumen no trajo la fila total');

  return [
    hojaResumen(datos, total),
    hojaClientes(datos.filtros, datos.clientes.filas),
    hojaPorDia(datos.porDia.filas),
    hojaPorSucursal(
      datos.filtros,
      datos.resumen.filas.filter((f) => !f.es_total),
    ),
    hojaCajeros(datos.filtros, datos.cajeros.filas),
  ];
}

// El .xlsx. Lo único de este módulo que toca la librería; se importa de 'write-excel-file/node' (el
// paquete no tiene export raíz) y sale con .toBuffer() (API 4.x).
export async function escribirXlsx(hojas: HojaExcel[]): Promise<Buffer> {
  return writeXlsxFile(hojas).toBuffer();
}

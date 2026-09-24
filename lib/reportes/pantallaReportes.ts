import { urlReportes, type FiltrosParaUrl } from './urlReportes';
import type { ComercioOwner, DatosComercioResueltos, OrdenClientes } from './filtrosReportes';
import { PERIODOS, ETIQUETA_PERIODO } from './rangoFechas';
import { fechaExcel } from './fechaExcel';
import { describirCosto } from '@/lib/tarjetas/unidadPrograma';
import { nombreCompleto } from '@/lib/clientes/nombreCompleto';
import { formatearTelefono } from '@/lib/clientes/formatearTelefono';

// Las reglas de QUÉ dibuja la pantalla de Reportes (spec 2026-09-23 §1, §2 y §3). Módulo PURO: el repo
// no tiene pruebas de componentes, así que toda decisión que no sea puro markup se saca de la página a
// este módulo y se prueba con mutación. Los componentes (Tareas 4b y 4c) solo leen lo que devuelve.
//
// Recibe los filtros YA RESUELTOS (resolverFiltrosReportes): FiltrosReportes es asignable a los tipos
// de entrada de acá, así que la página los pasa sin adaptar nada.

// ─────────────────────────────────────────────────────────────────────────────
// Paginación de la tabla de clientes (spec §3)
// ─────────────────────────────────────────────────────────────────────────────

// Filas por página de la tabla. Es el `p_limite` que la pantalla le manda a reporte_clientes: las dos
// cuentas de abajo (página → offset y offset → página) usan ESTE número, así que no pueden desalinearse.
export const TAMANO_PAGINA_CLIENTES = 50;

// El `p_offset` que se le pide a reporte_clientes para la página de la URL (1 = la primera).
export function offsetDePagina(pagina: number): number {
  return (pagina - 1) * TAMANO_PAGINA_CLIENTES;
}

export interface PaginacionClientes {
  // La página que se está MOSTRANDO (1 = la primera), que puede no ser la que pidió la URL.
  pagina: number;
  totalPaginas: number;
  // A qué página llevan "Anterior" y "Siguiente"; null = ese enlace no se dibuja.
  anterior: number | null;
  siguiente: number | null;
  // "Página 2 de 7".
  texto: string;
}

// La página se calcula con el `offset_efectivo` que devolvió la SQL, NUNCA con la `pagina` de la URL.
// Una página más allá del final (`?pagina=999`, un enlace viejo, una lista que se achicó con otro
// filtro) no da error ni una tabla vacía: la SQL acota el offset con el total y devuelve la ÚLTIMA
// (spec §3). Si la pantalla creyera a la URL diría "Página 999 de 7", y su "Anterior" llevaría a la
// 998, que la SQL volvería a acotar a la 7: el dueño no podría retroceder nunca.
//
// Por eso esta función ni siquiera recibe la página pedida: no hay cómo usarla por error.
//
// null con total 0: no hay páginas, y la pantalla muestra el estado vacío. Tampoco hay de dónde leer un
// offset (una respuesta sin filas no trae `offset_efectivo`; el wrapper devuelve el que pidió, ver el
// contrato de paginar.ts), así que con `?pagina=5` en un comercio sin actividad no puede salir
// "Página 5 de 0".
export function paginacionClientes(total: number, offsetEfectivo: number): PaginacionClientes | null {
  if (!(total > 0)) return null;
  const totalPaginas = Math.ceil(total / TAMANO_PAGINA_CLIENTES);
  // Acotada a [1, totalPaginas]: la SQL ya lo garantiza, pero un contrato roto (un wrapper que
  // devuelva otro offset) tiene que verse como la última página, no como "Página 20 de 7".
  const pagina = Math.min(Math.max(Math.floor(offsetEfectivo / TAMANO_PAGINA_CLIENTES) + 1, 1), totalPaginas);
  return {
    pagina,
    totalPaginas,
    anterior: pagina > 1 ? pagina - 1 : null,
    siguiente: pagina < totalPaginas ? pagina + 1 : null,
    texto: `Página ${pagina} de ${totalPaginas}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Conteo de la tabla (spec §3)
// ─────────────────────────────────────────────────────────────────────────────

// "312 clientes" con un comercio en el alcance; "312 filas (cliente por comercio)" con dos o más. La
// tabla tiene una fila por (comercio, cliente): una persona con tarjeta en dos comercios es 1 en la
// cabecera y 2 filas acá, y llamarlas "clientes" haría que los dos números no cierren.
//
// Recibe los filtros y no un número suelto a propósito: lo que cuenta es el ALCANCE (los comercios que
// se consultaron), no los comercios del dueño. Con el Café elegido de entre dos, el alcance es uno.
export function textoConteoClientes(total: number, filtros: { alcance: readonly unknown[] }): string {
  if (filtros.alcance.length >= 2) {
    return `${total} ${total === 1 ? 'fila' : 'filas'} (cliente por comercio)`;
  }
  return `${total} ${total === 1 ? 'cliente' : 'clientes'}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Encabezados de la tabla (spec §3)
// ─────────────────────────────────────────────────────────────────────────────

export type ClaveColumnaClientes = 'cliente' | 'comercio' | 'visitas' | 'acumulado' | 'premios' | 'ultima';
export type AriaSort = 'ascending' | 'descending' | 'none';

export interface ColumnaTablaClientes {
  clave: ClaveColumnaClientes;
  titulo: string;
  // El destino del encabezado; null = el encabezado es texto, no un enlace.
  href: string | null;
  // Para el `aria-sort` del <th>. Solo la columna por la que está ordenada la tabla dice su dirección;
  // las demás, 'none' (que es el valor por defecto de ARIA: equivale a no ponerlo).
  ariaSort: AriaSort;
}

// Lo que hace falta de FiltrosReportes (que es asignable a esto).
export interface FiltrosTablaClientes extends FiltrosParaUrl {
  acumuladoOrdenable: boolean;
  alcance: readonly unknown[];
}

// En orden de dibujo. Cliente va primera porque es la columna fija a 375 px (spec §3); Comercio, justo
// después, para que se vea sin scrollear, junto al cliente. (Comercio NO es fija: al scrollear de
// costado se va de la pantalla como las demás.)
const COLUMNAS: readonly { clave: ClaveColumnaClientes; titulo: string; orden: OrdenClientes | null }[] = [
  { clave: 'cliente', titulo: 'Cliente', orden: 'nombre' },
  { clave: 'comercio', titulo: 'Comercio', orden: null },
  { clave: 'visitas', titulo: 'Visitas', orden: 'visitas' },
  { clave: 'acumulado', titulo: 'Acumulado', orden: 'acumulado' },
  { clave: 'premios', titulo: 'Premios', orden: 'premios' },
  { clave: 'ultima', titulo: 'Última actividad', orden: 'ultima' },
];

export function columnasTablaClientes(filtros: FiltrosTablaClientes): ColumnaTablaClientes[] {
  return COLUMNAS.filter((columna) => columna.clave !== 'comercio' || filtros.alcance.length >= 2).map(
    ({ clave, titulo, orden }) => {
      // Comercio no se ordena (no está en ORDENES_CLIENTES). Acumulado, solo si el alcance habla UNA
      // unidad y la tiene: ordenar centavos contra sellos no significa nada, y en los tipos sin
      // contador la columna va vacía (spec, "Unidad del acumulado").
      const ordenable = orden !== null && (orden !== 'acumulado' || filtros.acumuladoOrdenable);
      // `ordenable &&`: unos filtros con orden=acumulado en un alcance que no lo permite no deben
      // marcar Acumulado como ordenada (resolverFiltrosReportes ya lo hace caer a visitas; esto es el
      // resguardo por si llegan filtros armados a mano).
      const activa = ordenable && orden === filtros.orden;
      return {
        clave,
        titulo,
        // urlReportes aplica las reglas de §3: la activa se invierte, otra abre con su dirección
        // inicial, y ordenar vuelve a la página 1.
        href: ordenable ? urlReportes(filtros, { orden }) : null,
        ariaSort: activa ? (filtros.dir === 'asc' ? 'ascending' : 'descending') : 'none',
      };
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Filas de la tabla de clientes (spec §3, "Unidad del acumulado")
// ─────────────────────────────────────────────────────────────────────────────

// "23/09 14:05": la fecha y la hora de pared del COMERCIO en `zonaHoraria`, para "Última actividad".
// Con un año distinto de `anioDelPeriodo` (el del final del período que se mira), "15/11/2025 12:00":
// con "Desde siempre" la última actividad de un cliente puede ser del año pasado, y "15/11" a secas
// no dice de cuál.
//
// Los componentes salen de fechaExcel (Intl con la zona explícita, un formateador por zona): NUNCA
// de getHours() y compañía, que leen el reloj del PROCESO — UTC en Vercel, UTC−6 en la PC de Daniel —
// y la misma fila diría una hora distinta según dónde se dibujó. El año también es el local: las 21:00
// del 31/12 en El Salvador ya son 2026 en UTC.
//
// Un instante ilegible (la SQL nunca lo manda: `ultima_actividad` es un timestamptz no nulo) deja la
// celda vacía. fechaExcel lanza, a propósito, para que el Excel no salga con una fecha inventada;
// acá una fila rara no puede tumbar la página de Reportes entera.
export function fechaHoraLocal(instante: string, zonaHoraria: string, anioDelPeriodo: number): string {
  if (Number.isNaN(new Date(instante).getTime())) return '';
  const local = fechaExcel(instante, zonaHoraria);
  const dos = (n: number) => String(n).padStart(2, '0');
  const anio = local.getUTCFullYear();
  const dia = `${dos(local.getUTCDate())}/${dos(local.getUTCMonth() + 1)}`;
  const hora = `${dos(local.getUTCHours())}:${dos(local.getUTCMinutes())}`;
  return anio === anioDelPeriodo ? `${dia} ${hora}` : `${dia}/${anio} ${hora}`;
}

// Lo que se usa de una fila de reporte_clientes (FilaReporteCliente es asignable a esto).
export interface FilaClienteReporte {
  comercio_id: string;
  cliente_id: string;
  nombre: string;
  apellido: string | null;
  telefono: string;
  operaciones: number;
  puntos_otorgados: number;
  canjes: number;
  ultima_actividad: string;
}

// Una fila de la tabla, ya en texto. El componente solo la pone en celdas.
export interface FilaTablaClientes {
  // La key de React. Una fila es un (comercio, cliente): la misma persona con tarjeta en dos comercios
  // es DOS filas, así que el cliente_id solo repetiría la key. Va el id del comercio y no su nombre:
  // comercios.nombre no es único (0001) y dos homónimos del mismo dueño chocarían.
  clave: string;
  cliente: string; // nombre y apellido (nombreCompleto)
  telefono: string; // partido para leerlo (formatearTelefono)
  comercio: string; // el nombre; solo se muestra con dos o más comercios (columnasTablaClientes)
  visitas: number;
  acumulado: string; // en la unidad de SU comercio; vacío en los tipos sin contador
  premios: number;
  ultima: string; // "23/09 14:05" en la zona de SU comercio (fechaHoraLocal)
  // Para el `dateTime` de <time>, en ISO con milisegundos ("2026-09-23T20:05:00.123Z"). No el
  // timestamptz crudo: PostgREST manda MICROsegundos (".123456+00:00") y la fecha válida de HTML admite
  // hasta tres decimales. Vacío, como `ultima`, si el instante es ilegible.
  ultimaInstante: string;
}

// Lo que hace falta de los filtros (FiltrosReportes es asignable a esto).
export interface FiltrosFilasClientes {
  alcance: readonly ComercioOwner[];
  // Zona y tipo YA RESUELTOS de cada comercio del alcance (resolverFiltrosReportes).
  datosAlcance: ReadonlyMap<string, DatosComercioResueltos>;
  zonaHoraria: string; // la de la vista: la de los presets
  hasta: string; // AAAA-MM-DD: su año decide si "Última actividad" lleva el año
}

// Con "Todo" la tabla mezcla comercios, y cada fila se dice con los datos de SU comercio:
//   - el Acumulado con describirCosto(tipo principal de ESE comercio): "8 sellos", "$12.50" (cashback y
//     gift card cuentan CENTAVOS) o vacío (cupón, membresía, descuento: sin contador). Escrito con la
//     unidad de otro comercio, 1250 centavos se leerían "1250 puntos".
//   - la Última actividad en la zona de ESE comercio: con uno en Bogotá y otro en El Salvador, el mismo
//     instante son dos horas de pared distintas.
// Una fila de un comercio que no está en el alcance (contrato roto: p_comercios ES el alcance) no se
// descarta —el conteo de abajo dejaría de cerrar—, pero tampoco se le inventa nada: sin nombre, sin
// acumulado (el 'puntos' de respaldo sería una unidad inventada) y con la hora en la zona de la vista.
export function filasTablaClientes(
  filas: readonly FilaClienteReporte[],
  filtros: FiltrosFilasClientes,
): FilaTablaClientes[] {
  const nombres = new Map(filtros.alcance.map((c) => [c.comercioId, c.nombre] as const));
  const anioDelPeriodo = Number(filtros.hasta.slice(0, 4));
  return filas.map((f) => {
    const datos = filtros.datosAlcance.get(f.comercio_id);
    // El mismo chequeo que fechaHoraLocal: toISOString() LANZA con una fecha inválida.
    const instante = new Date(f.ultima_actividad);
    const legible = !Number.isNaN(instante.getTime());
    return {
      clave: `${f.comercio_id}:${f.cliente_id}`,
      cliente: nombreCompleto(f.nombre, f.apellido),
      telefono: formatearTelefono(f.telefono),
      comercio: nombres.get(f.comercio_id) ?? '',
      visitas: f.operaciones,
      acumulado: datos ? describirCosto(datos.tipoPrincipal, f.puntos_otorgados) : '',
      premios: f.canjes,
      ultima: fechaHoraLocal(f.ultima_actividad, datos?.zonaHoraria ?? filtros.zonaHoraria, anioDelPeriodo),
      ultimaInstante: legible ? instante.toISOString() : '',
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// El bloque "Clientes" entero (spec §3)
// ─────────────────────────────────────────────────────────────────────────────

// Lo que hace falta de FiltrosReportes para el bloque (que es asignable a esto).
export interface FiltrosBloqueClientes extends Omit<FiltrosTablaClientes, 'alcance'>, FiltrosFilasClientes {}

export type EstadoTablaClientes =
  | { tipo: 'error' }
  | { tipo: 'vacio' }
  | {
      tipo: 'tabla';
      columnas: ColumnaTablaClientes[];
      filas: FilaTablaClientes[];
      // "Página 2 de 7 · 312 clientes"
      pie: string;
      // Los enlaces de "Anterior" y "Siguiente"; null = ese enlace no se dibuja.
      hrefAnterior: string | null;
      hrefSiguiente: string | null;
    };

// Qué dibuja el bloque, ya decidido (como estadoPorDia):
//   - la lectura falló (reporteClientes devolvió null): 'error'. Nunca una tabla vacía, que diría "no
//     hubo clientes" cuando lo que pasó es que no se pudo leer.
//   - total 0: 'vacio'. Se pregunta a paginacionClientes porque devuelve null EXACTAMENTE con total 0:
//     el vacío queda decidido por el total que la SQL dice de sí misma, y la rama 'tabla' siempre
//     tiene una paginación que dibujar (el tipo lo garantiza, sin un `!`). Preguntar por
//     `filas.length === 0` daría lo mismo mientras se cumpla el contrato (cero filas ⇔ total 0,
//     paginar.ts), pero dejaría un null posible en la rama de la tabla.
//   - si no, la tabla. La paginación sale del offset que la SQL dice que DEVOLVIÓ (paginacionClientes),
//     y Anterior/Siguiente se arman con urlReportes, que conserva los filtros y el orden y solo cambia
//     la página (la 1 no se escribe en la URL: es el default).
export function estadoTablaClientes(
  pagina: { filas: readonly FilaClienteReporte[]; total: number; offsetEfectivo: number } | null,
  filtros: FiltrosBloqueClientes,
): EstadoTablaClientes {
  if (pagina === null) return { tipo: 'error' };
  const paginacion = paginacionClientes(pagina.total, pagina.offsetEfectivo);
  if (paginacion === null) return { tipo: 'vacio' };
  return {
    tipo: 'tabla',
    columnas: columnasTablaClientes(filtros),
    filas: filasTablaClientes(pagina.filas, filtros),
    pie: `${paginacion.texto} · ${textoConteoClientes(pagina.total, filtros)}`,
    hrefAnterior: paginacion.anterior === null ? null : urlReportes(filtros, { pagina: paginacion.anterior }),
    hrefSiguiente: paginacion.siguiente === null ? null : urlReportes(filtros, { pagina: paginacion.siguiente }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Filas de chips de filtro (spec §1, "Interfaz")
// ─────────────────────────────────────────────────────────────────────────────

export interface FilasDeChips {
  periodo: true;
  comercio: boolean;
  sucursal: boolean;
  cajero: boolean;
}

// Qué filas de chips se dibujan, en este orden: período; comercio; sucursal; cajero.
//   - período: siempre.
//   - comercio: si el DUEÑO tiene dos o más (con uno solo, ese es el elegido y no hay qué elegir).
//   - sucursal: con un comercio resuelto que tenga dos o más sucursales, activas o no (con una sola,
//     "Todas" y esa dan lo mismo).
//   - cajero: con un comercio resuelto que tenga al menos un usuario de rol `cajero`, activo o no (un
//     cajero dado de baja operó y su historial se consulta). Con solo el dueño no es un filtro.
//
// "Comercio resuelto" es lo mismo que exige resolverFiltrosReportes para aceptar una sucursal o un
// cajero: un comercio elegido Y listas cargadas de ESE comercio. Unas listas de otro comercio (un
// cargador que trajera las del comercio ACTIVO) se tratan como vacías: si no, se dibujarían chips
// cuyos ids el resolver después descarta, y tocarlos no filtraría nada.
export function filasDeChips(
  comercios: readonly ComercioOwner[],
  filtros: { comercio: { comercioId: string } | null },
  contexto: { comercioDeLasListas: string | null; sucursales: readonly unknown[]; usuarios: readonly { rol: string }[] },
): FilasDeChips {
  const listasDelComercio = filtros.comercio !== null && contexto.comercioDeLasListas === filtros.comercio.comercioId;
  return {
    periodo: true,
    comercio: comercios.length >= 2,
    sucursal: listasDelComercio && contexto.sucursales.length >= 2,
    cajero: listasDelComercio && contexto.usuarios.some((u) => u.rol === 'cajero'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Título del bloque de barras (spec §2)
// ─────────────────────────────────────────────────────────────────────────────

// reporte_por_dia, en modo `auto`, agrupa por mes cuando el tramo pasa de 62 días, y cada fila lo dice
// en `es_mes` (todas iguales). Sin filas —un alcance que nunca operó— no se agrupó nada: "Por día".
export function tituloSerie(filas: readonly { es_mes: boolean }[]): 'Por día' | 'Por mes' {
  return filas.some((f) => f.es_mes) ? 'Por mes' : 'Por día';
}

// ─────────────────────────────────────────────────────────────────────────────
// Barras de "Por día" / "Por mes" (spec §2)
// ─────────────────────────────────────────────────────────────────────────────

// Lista fija y no Intl: según la versión de ICU, el `short` de septiembre en español sale "sep" o
// "sept", y la etiqueta de la barra no puede depender del Node donde corre.
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const;

// La etiqueta de una barra a partir del `periodo` de reporte_por_dia (texto "AAAA-MM-DD"): por mes,
// "sep 2026" (el periodo es el día 1 de ese mes); por día, "05/09". Se parte el texto a mano y no se
// pasa por `new Date`: la SQL ya cortó el día en la zona de cada comercio, y un Date lo correría a la
// zona del proceso (en Vercel, UTC: el 05/09 se leería como la noche del 04).
export function etiquetaPeriodoSerie(periodo: string, esMes: boolean): string {
  const [aaaa, mm, dd] = periodo.split('-');
  return esMes ? `${MESES_CORTOS[Number(mm) - 1]} ${aaaa}` : `${dd}/${mm}`;
}

export interface BarraSerie {
  clave: string; // el periodo: único por fila
  etiqueta: string;
  visitas: number;
  premios: number;
  // El ancho del relleno, de 0 a 100.
  pct: number;
}

// Lo que se usa de una fila de reporte_por_dia.
export interface FilaSerie {
  periodo: string;
  operaciones: number;
  canjes: number;
  es_mes: boolean;
}

// Cada barra mide visitas + premios contra el período más alto de la serie. El piso de 1 en el
// máximo es para una serie entera en cero (un alcance que ya operaba y no tuvo nada en el período):
// barras vacías, no NaN.
export function barrasSerie(filas: readonly FilaSerie[]): BarraSerie[] {
  const maximo = Math.max(1, ...filas.map((f) => f.operaciones + f.canjes));
  return filas.map((f) => ({
    clave: f.periodo,
    etiqueta: etiquetaPeriodoSerie(f.periodo, f.es_mes),
    visitas: f.operaciones,
    premios: f.canjes,
    pct: Math.round(((f.operaciones + f.canjes) / maximo) * 100),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Cabecera y "sin actividad" (spec §2)
// ─────────────────────────────────────────────────────────────────────────────

export interface TotalesResumen {
  visitas: number;
  premios: number;
  clientes: number;
}

// Las tres cartas de la cabecera salen de la fila `es_total` de reporte_resumen, nunca de sumar las
// sucursales: Clientes es la cuenta DISTINTA del alcance, y quien fue a dos sucursales sumaría 2. Se
// busca por `es_total` y no por "los ids son null": la actividad sin sucursal también tiene
// sucursal_id null (0040, comentario de reporte_resumen).
//
// null si la fila no está: la 0040 la devuelve SIEMPRE (con ceros si no hubo nada), así que su
// ausencia es un contrato roto, y la pantalla lo trata como un error del bloque — no inventa ceros.
export function totalesDelResumen(
  filas: readonly { es_total: boolean; operaciones: number; canjes: number; clientes_unicos: number }[],
): TotalesResumen | null {
  const total = filas.find((f) => f.es_total);
  return total ? { visitas: total.operaciones, premios: total.canjes, clientes: total.clientes_unicos } : null;
}

// "Sin actividad en el período" se decide con los totales del resumen, NUNCA con que reporte_por_dia
// devolvió cero filas: un alcance que ya operaba devuelve el tramo entero con filas en cero, y uno que
// nunca operó, cero filas (contrato de la 0040). Un período con solo premios SÍ tuvo actividad.
export function huboActividad(totales: TotalesResumen): boolean {
  return totales.visitas + totales.premios > 0;
}

// Lo que dibuja el bloque "Por día" / "Por mes", ya decidido. Título y subtítulo en los tres casos (el
// encabezado del bloque se ve siempre).
interface BaseEstadoPorDia {
  titulo: 'Por día' | 'Por mes';
  subtitulo: string;
}
export type EstadoPorDia =
  | (BaseEstadoPorDia & { tipo: 'error' })
  | (BaseEstadoPorDia & { tipo: 'vacio' })
  | (BaseEstadoPorDia & { tipo: 'barras'; barras: BarraSerie[] });

// ══ LA REGLA DEL BLOQUE: el vacío sale de la fila TOTAL del resumen, nunca de `filas.length` ══
// Contrato de la 0040: reporte_por_dia devuelve el tramo entero con filas en CERO para un alcance que
// ya operaba (un "Hoy" sin movimientos trae una fila en cero), y cero filas para uno que nunca operó.
// Decidir con `filas.length === 0` dibujaría barras vacías en el primer caso. Por eso el bloque
// depende de LAS DOS lecturas: con cualquiera en null (falló), 'error' — no se sabe si está vacío.
export function estadoPorDia(filas: readonly FilaSerie[] | null, totales: TotalesResumen | null): EstadoPorDia {
  const titulo = filas ? tituloSerie(filas) : 'Por día';
  const subtitulo = `Visitas / premios de cada ${titulo === 'Por mes' ? 'mes' : 'día'}.`;
  if (filas === null || totales === null) return { tipo: 'error', titulo, subtitulo };
  if (!huboActividad(totales)) return { tipo: 'vacio', titulo, subtitulo };
  return { tipo: 'barras', titulo, subtitulo, barras: barrasSerie(filas) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bloque "Por sucursal" (spec §2)
// ─────────────────────────────────────────────────────────────────────────────

export interface BloqueComercio<F> {
  comercio: ComercioOwner;
  filas: F[];
}

// Las filas de reporte_resumen por comercio, SIN la fila total, en el orden del ALCANCE (el de los
// comercios del dueño) y no en el de la SQL, que ordena por comercio_id: un uuid no le dice nada al
// dueño. Dentro de cada comercio se respeta el orden en que llegaron (sucursales por nombre, "sin
// sucursal" al final: reporteResumen).
//
// La 0040 arma las filas desde la ACTIVIDAD (grouping sets sobre el CTE `actividad`): un comercio sin
// movimientos en el período no tiene filas. Esos van aparte, en `sinActividad`, para nombrarlos juntos
// en una línea en vez de repetir un "sin actividad" por comercio. Una fila de un comercio que no está
// en el alcance no se dibuja (no debería llegar: p_comercios ES el alcance).
export function sucursalesPorComercio<F extends { es_total: boolean; comercio_id: string | null }>(
  filas: readonly F[],
  alcance: readonly ComercioOwner[],
): { conActividad: BloqueComercio<F>[]; sinActividad: ComercioOwner[] } {
  const conActividad: BloqueComercio<F>[] = [];
  const sinActividad: ComercioOwner[] = [];
  for (const comercio of alcance) {
    const suyas = filas.filter((f) => !f.es_total && f.comercio_id === comercio.comercioId);
    if (suyas.length > 0) conActividad.push({ comercio, filas: suyas });
    else sinActividad.push(comercio);
  }
  return { conActividad, sinActividad };
}

// El estado vacío del bloque. Con una sucursal elegida la nombra (spec §2: "Sin actividad en
// <sucursal> en este período", no un hueco); si no, dice si son todos los comercios o el único.
export function textoSinActividad(filtros: {
  sucursal: { nombre: string } | null;
  alcance: readonly unknown[];
}): string {
  if (filtros.sucursal) return `Sin actividad en ${filtros.sucursal.nombre} en este período.`;
  return filtros.alcance.length >= 2
    ? 'Sin actividad en ninguno de tus comercios en este período.'
    : 'Sin actividad en este período.';
}

// ─────────────────────────────────────────────────────────────────────────────
// Filtros aplicados que no tienen fila de chips (spec §1; nota de la Tarea 4a para la 4b)
// ─────────────────────────────────────────────────────────────────────────────

// El chip de un usuario en la fila de cajeros, y el mismo texto en el aviso de abajo: la cuenta que
// mira es "Vos"; cualquier otra —el socio dueño incluido—, su email.
export function etiquetaCajero(usuario: { email: string; esVos: boolean }): string {
  return usuario.esVos ? 'Vos' : usuario.email;
}

// FiltrosParaUrl con lo que hace falta para NOMBRAR la sucursal y el cajero (FiltrosReportes con las
// filas del cargador es asignable a esto).
export interface FiltrosConNombres extends Omit<FiltrosParaUrl, 'sucursal' | 'cajero'> {
  sucursal: { id: string; nombre: string } | null;
  cajero: { id: string; email: string; esVos: boolean } | null;
}

export interface FiltroInvisible {
  clave: 'sucursal' | 'cajero';
  rotulo: string;
  valor: string;
  // La vista sin ese filtro (y en la página 1, como todo cambio de filtro: urlReportes).
  hrefQuitar: string;
}

// Un filtro que está APLICADO pero cuya fila de chips no se dibuja (filasDeChips): `?sucursal=` en un
// comercio con una sola sucursal, o `?cajero=<un dueño>` en uno sin cajeros. El resolver los acepta
// (el id es de ese comercio) y los números salen filtrados, así que la pantalla tiene que decirlo:
// nunca un filtro aplicado e invisible. Y no da lo mismo: con una sola sucursal, "todas" incluye la
// actividad "sin sucursal" (sucursal_id null) y la sucursal no.
//
// Uno por filtro, en el orden de las filas de chips (sucursal, cajero).
export function filtrosInvisibles(
  filas: Pick<FilasDeChips, 'sucursal' | 'cajero'>,
  filtros: FiltrosConNombres,
): FiltroInvisible[] {
  const avisos: FiltroInvisible[] = [];
  if (filtros.sucursal && !filas.sucursal) {
    avisos.push({
      clave: 'sucursal',
      rotulo: 'sucursal',
      valor: filtros.sucursal.nombre,
      hrefQuitar: urlReportes(filtros, { sucursal: null }),
    });
  }
  if (filtros.cajero && !filas.cajero) {
    avisos.push({
      clave: 'cajero',
      rotulo: 'cajero',
      valor: etiquetaCajero(filtros.cajero),
      hrefQuitar: urlReportes(filtros, { cajero: null }),
    });
  }
  return avisos;
}

// ─────────────────────────────────────────────────────────────────────────────
// Todo lo que dibujan los filtros (spec §1, "Interfaz")
// ─────────────────────────────────────────────────────────────────────────────

export interface ChipFiltro {
  // La key de React: el período, el id, o 'todos' para "Todo"/"Todas"/"Todos" (los ids son uuid).
  clave: string;
  etiqueta: string;
  href: string;
  activo: boolean;
  // El texto entero, para el `title` de los chips que pueden cortarse con puntos suspensivos (nombres
  // y emails). undefined en los fijos, que son cortos.
  titulo?: string;
}

export interface FiltrosEnPantalla {
  periodo: ChipFiltro[];
  // null = la fila no se dibuja (filasDeChips).
  comercio: ChipFiltro[] | null;
  sucursal: ChipFiltro[] | null;
  cajero: ChipFiltro[] | null;
  // El formulario de fechas de "Personalizado": abierto solo con periodo=rango.
  formularioRango: boolean;
  // Los filtros aplicados cuya fila no se dibuja (filtrosInvisibles).
  invisibles: FiltroInvisible[];
}

// Cada chip de cada fila, con su destino y si es el activo, más el formulario y los avisos. El
// componente (FiltrosReportes.tsx) solo arma el markup de esto: qué filas, qué chip está activo, a
// dónde lleva cada uno y qué filtro está aplicado sin verse se decide acá, con prueba.
//
// El `activo` compara contra los filtros RESUELTOS, no contra la URL: un id ajeno que se descartó no
// deja marcado ningún chip, y "Todo"/"Todas"/"Todos" quedan activos. Los chips de sucursal y cajero
// salen de las listas del contexto solo cuando son del comercio resuelto (lo exige filasDeChips): son
// exactamente los ids que el resolver acepta.
export function filtrosEnPantalla(
  comercios: readonly ComercioOwner[],
  filtros: FiltrosConNombres,
  contexto: {
    comercioDeLasListas: string | null;
    sucursales: readonly { id: string; nombre: string }[];
    usuarios: readonly { id: string; email: string; rol: string; esVos: boolean }[];
  },
): FiltrosEnPantalla {
  const filas = filasDeChips(comercios, filtros, contexto);
  return {
    // "Personalizado" también es un enlace: urlReportes conserva el desde/hasta de la vista, así el
    // formulario abre PRECARGADO con el período que se estaba viendo y nunca vacío.
    periodo: PERIODOS.map((periodo) => ({
      clave: periodo,
      etiqueta: ETIQUETA_PERIODO[periodo],
      href: urlReportes(filtros, { periodo }),
      activo: filtros.periodo === periodo,
    })),
    comercio: filas.comercio
      ? [
          {
            clave: 'todos',
            etiqueta: 'Todo',
            href: urlReportes(filtros, { comercio: null }),
            activo: filtros.comercio === null,
          },
          ...comercios.map((c) => ({
            clave: c.comercioId,
            etiqueta: c.nombre,
            titulo: c.nombre,
            href: urlReportes(filtros, { comercio: c.comercioId }),
            activo: filtros.comercio?.comercioId === c.comercioId,
          })),
        ]
      : null,
    sucursal: filas.sucursal
      ? [
          {
            clave: 'todos',
            etiqueta: 'Todas',
            href: urlReportes(filtros, { sucursal: null }),
            activo: filtros.sucursal === null,
          },
          ...contexto.sucursales.map((s) => ({
            clave: s.id,
            etiqueta: s.nombre,
            titulo: s.nombre,
            href: urlReportes(filtros, { sucursal: s.id }),
            activo: filtros.sucursal?.id === s.id,
          })),
        ]
      : null,
    cajero: filas.cajero
      ? [
          {
            clave: 'todos',
            etiqueta: 'Todos',
            href: urlReportes(filtros, { cajero: null }),
            activo: filtros.cajero === null,
          },
          // El email entero en el title también en el chip "Vos": dice con qué cuenta está atendiendo.
          ...contexto.usuarios.map((u) => ({
            clave: u.id,
            etiqueta: etiquetaCajero(u),
            titulo: u.email,
            href: urlReportes(filtros, { cajero: u.id }),
            activo: filtros.cajero?.id === u.id,
          })),
        ]
      : null,
    formularioRango: filtros.periodo === 'rango',
    invisibles: filtrosInvisibles(filas, filtros),
  };
}

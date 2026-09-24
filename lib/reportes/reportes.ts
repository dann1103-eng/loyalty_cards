import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { direccionInicial, type DireccionOrden, type OrdenClientes } from './filtrosReportes';
import {
  paginarPorOffset,
  paginarPorRango,
  validarTamano,
  MAXIMO_POR_PAGINA,
  type Paginado,
  type PaginaPorOffset,
} from './paginar';
import { TAMANO_PAGINA_CLIENTES } from './pantallaReportes';

// Capa de datos de reportes/BI (Fase 10). Wrappers tipados sobre las funciones SQL de reporte
// (SECURITY INVOKER, execute solo para service_role). Cada función es `returns table(...)`, así que
// `.rpc()` devuelve `data` como ARRAY de filas.
//
// SCOPE: los ids de comercio van SIEMPRE explícitos y vienen del gate de sesión (verifyComercioOwner),
// nunca de un campo del cliente — igual que el resto del proyecto, para que un dueño no pueda leer los
// reportes de otro comercio aunque conozca el id. Las funciones de la 0040 reciben además sucursal y
// cajero: esos ids tienen que venir YA VALIDADOS por resolverFiltrosReportes (filtrosRpc los toma de
// ahí), nunca de la URL cruda.
//
// CRITERIO ANTE ERROR — NO es el mismo en todo el archivo:
//   - Los wrappers VIEJOS descriptivos (reporteSucursales, reporteFmComercios) registran el error con
//     console.error ACÁ y devuelven `[]`. Fue la decisión de fail-soft del piloto: una pantalla de
//     reportes rota no debía tumbar el panel, y la pantalla no distingue "vacío real" de "error".
//     Siguen así mientras los usen el panel (reporte_sucursales) y el FM (reporte_fm_comercios). Los
//     wrappers de reporte_top_clientes y reporte_tendencia se retiraron con la Tarea 4c del plan
//     2026-09-23, cuando Reportes pasó a las funciones de la 0040 (las funciones SQL siguen: las
//     retira una migración posterior).
//   - reporteCajeros y los CUATRO de la 0040 (reporteResumen, reportePorDia, reporteClientes,
//     reporteCajerosAlcance) devuelven `null` ante un error, NUNCA `[]`. En la pantalla de cajeros un
//     vacío diría "nadie hizo nada raro" (ver reporteCajeros). En Reportes con filtros, un `[]` se
//     vería como "sin actividad en este período" y el Excel saldría con ceros que parecen ciertos
//     (spec 2026-09-23 §4, "nunca un archivo con ceros por un error"): la pantalla muestra un aviso en
//     el bloque que falló y la ruta del Excel responde 500. Y si falla CUALQUIER página de una lectura
//     paginada, la lectura entera es `null` (paginar.ts): nunca media lista que parezca completa.

// Los tipos de fila se DERIVAN de Database (fuente de verdad transcrita de la migración): si el shape
// de una función cambia en types.ts, estos tipos y las pantallas se enteran en compilación.
export type FilaReporteSucursal = Database['public']['Functions']['reporte_sucursales']['Returns'][number];
export type FilaFmComercio = Database['public']['Functions']['reporte_fm_comercios']['Returns'][number];
export type FilaReporteCajero = Database['public']['Functions']['reporte_cajeros']['Returns'][number];
export type FilaReporteResumen = Database['public']['Functions']['reporte_resumen']['Returns'][number];
export type FilaReportePorDia = Database['public']['Functions']['reporte_por_dia']['Returns'][number];
export type FilaReporteCliente = Database['public']['Functions']['reporte_clientes']['Returns'][number];
export type FilaReporteCajeroAlcance = Database['public']['Functions']['reporte_cajeros_alcance']['Returns'][number];

// ─────────────────────────────────────────────────────────────────────────────
// Reportes con filtros (migración 0040, spec 2026-09-23 §5)
// ─────────────────────────────────────────────────────────────────────────────

// Los filtros que reciben las cuatro funciones de la 0040, ya como ids. Se arman con filtrosRpc a
// partir de los filtros RESUELTOS: ese es el punto donde un id ajeno ya se descartó.
export interface FiltrosRpcReportes {
  // p_comercios: el alcance ("Todo" = todos los del dueño, en UNA llamada).
  comercioIds: readonly string[];
  // AAAA-MM-DD, inclusivas, en la zona de CADA comercio (la SQL corta los días). null = sin ese borde.
  desde: string | null;
  hasta: string | null;
  sucursalId: string | null;
  cajeroId: string | null;
}

// De los filtros resueltos (resolverFiltrosReportes) a los argumentos de las RPC. FiltrosReportes es
// asignable a la entrada, así que la página y la ruta del Excel pasan `filtros` tal cual. El `hasta`
// sale no nulo porque el resolver siempre lo trae: reportePorDia lo exige.
export function filtrosRpc(filtros: {
  alcance: readonly { comercioId: string }[];
  desde: string | null;
  hasta: string;
  sucursal: { id: string } | null;
  cajero: { id: string } | null;
}): FiltrosRpcReportes & { hasta: string } {
  return {
    comercioIds: filtros.alcance.map((c) => c.comercioId),
    desde: filtros.desde,
    hasta: filtros.hasta,
    sucursalId: filtros.sucursal?.id ?? null,
    cajeroId: filtros.cajero?.id ?? null,
  };
}

// El tamaño de página es INYECTABLE para que las pruebas contra la base paginen de a 2 con cinco
// filas sembradas. En producción, el `max-rows` de PostgREST (1000): ninguna respuesta trae más.
export interface OpcionesPaginado {
  tamanoPagina?: number;
}

function argumentosComunes(filtros: FiltrosRpcReportes) {
  return {
    p_comercios: [...filtros.comercioIds],
    p_desde: filtros.desde,
    p_hasta: filtros.hasta,
    p_sucursal_id: filtros.sucursalId,
    p_cajero_id: filtros.cajeroId,
  };
}

// Resumen, por día y cajeros se paginan con `.range()` + un `.order()` EXPLÍCITO (paginarPorRango).
// El orden es el que manda entre páginas: PostgREST aplica su `order by … limit … offset` POR FUERA de
// la función, así que el `order by` de adentro de la SQL no cuenta, y sin uno explícito y TOTAL (que
// no empate nunca) dos páginas pueden solaparse o saltearse filas. Cada `.order()` de abajo cierra con
// la clave de la fila por eso.

// La cabecera (fila `es_total`) y las cartas por sucursal, TODAS las filas. La fila total sale
// siempre, con ceros si no hubo actividad: "sin actividad" se decide con ella, no con "cero filas".
//
// Orden: `es_total desc` PRIMERO (la fila total va antes que cualquier corte: el aviso de tope del
// Excel lo supone); después por comercio, y dentro de cada uno sus sucursales por nombre con "sin
// sucursal" al final — el mismo orden que la SQL (0040, `(sucursal_id is null), s.nombre,
// sucursal_id`): el nombre es null EXACTAMENTE en la fila sin sucursal (las sucursales no se borran,
// se apagan), así que `nullsFirst: false` sobre el nombre reemplaza al `is null` que PostgREST no
// puede expresar. Es total: la fila es única por (es_total, comercio_id, sucursal_id).
export async function reporteResumen(
  supabase: SupabaseClient<Database>,
  filtros: FiltrosRpcReportes,
  opciones: OpcionesPaginado = {},
): Promise<Paginado<FilaReporteResumen> | null> {
  const argumentos = argumentosComunes(filtros);
  return paginarPorRango(async (inicio, fin) => {
    const { data, error } = await supabase
      .rpc('reporte_resumen', argumentos)
      .order('es_total', { ascending: false })
      .order('comercio_id', { ascending: true })
      .order('sucursal_nombre', { ascending: true, nullsFirst: false })
      .order('sucursal_id', { ascending: true, nullsFirst: false })
      .range(inicio, fin);
    if (error) {
      console.error('[reportes] falló reporte_resumen:', error);
      return null;
    }
    return data ?? [];
  }, opciones.tamanoPagina ?? MAXIMO_POR_PAGINA);
}

export type AgruparPorDia = 'dia' | 'mes' | 'auto';

// La serie de barras (y la hoja "Por día" del Excel, que la pide con 'dia'), TODAS las filas, en
// orden de `periodo` (único por fila). `hasta` es OBLIGATORIO en el tipo: con null la SQL devuelve
// cero filas. OJO con el contrato de la 0040: cero filas NO quiere decir "sin actividad en el
// período" (un alcance que ya operaba devuelve el tramo en ceros); eso se decide con la fila total de
// reporteResumen.
export async function reportePorDia(
  supabase: SupabaseClient<Database>,
  filtros: FiltrosRpcReportes & { hasta: string },
  agrupar: AgruparPorDia,
  opciones: OpcionesPaginado = {},
): Promise<Paginado<FilaReportePorDia> | null> {
  const argumentos = { ...argumentosComunes(filtros), p_agrupar: agrupar };
  return paginarPorRango(async (inicio, fin) => {
    const { data, error } = await supabase
      .rpc('reporte_por_dia', argumentos)
      .order('periodo', { ascending: true })
      .range(inicio, fin);
    if (error) {
      console.error('[reportes] falló reporte_por_dia:', error);
      return null;
    }
    return data ?? [];
  }, opciones.tamanoPagina ?? MAXIMO_POR_PAGINA);
}

// La hoja "Cajeros" del Excel, TODAS las filas, en el orden ANTIFRAUDE de la SQL (ordenReporteCajeros).
//
// Dos órdenes, a propósito:
//   - para PAGINAR, el `.order()` de PostgREST: por comercio, email y cajero_usuario_id (nulls al
//     final). Es total —la fila es única por (comercio_id, cajero_usuario_id)—, que es lo único que
//     paginar exige. No puede ser el de la SQL: PostgREST no ordena por una suma (forzadas + ajustes).
//   - para DEVOLVER, el de la SQL (0040, reporte_cajeros_alcance), restaurado acá con un `sort`
//     después de juntar las páginas: dentro de cada comercio, primero quien tiene más forzadas +
//     correcciones. Es el orden que pone arriba al sospechoso, y paginar no puede romperlo.
// Con `alcanzoTope` solo se reordena lo que entró: las filas que quedaron afuera las eligió el orden
// de paginar (por email), no el de sospecha. (Con los pilotos, órdenes de magnitud por debajo del tope.)
export async function reporteCajerosAlcance(
  supabase: SupabaseClient<Database>,
  filtros: FiltrosRpcReportes,
  opciones: OpcionesPaginado = {},
): Promise<Paginado<FilaReporteCajeroAlcance> | null> {
  const argumentos = argumentosComunes(filtros);
  const resultado = await paginarPorRango(async (inicio, fin) => {
    const { data, error } = await supabase
      .rpc('reporte_cajeros_alcance', argumentos)
      .order('comercio_id', { ascending: true })
      .order('cajero_email', { ascending: true, nullsFirst: false })
      .order('cajero_usuario_id', { ascending: true, nullsFirst: false })
      .range(inicio, fin);
    if (error) {
      console.error('[reportes] falló reporte_cajeros_alcance:', error);
      return null;
    }
    return data ?? [];
  }, opciones.tamanoPagina ?? MAXIMO_POR_PAGINA);
  if (resultado === null) return null;
  // Array.prototype.sort es estable (ES2019): lo que el comparador empata conserva el orden de paginar.
  resultado.filas.sort(ordenReporteCajeros);
  return resultado;
}

// El orden de reporte_cajeros_alcance (0040): `comercio_id, (cajero_usuario_id is null), forzadas +
// ajustes desc, email, cajero_usuario_id`. Dentro de cada comercio, el grupo "Sin registrar" (cajero
// null) va AL FINAL aunque tenga más forzadas que nadie: no es una persona a quien pedirle cuentas; y
// entre los cajeros, primero el que más se salteó límites o corrigió (las dos señales de la pantalla
// de cajeros, 0033).
//
// Comparador PURO, para `sort`. Los textos se comparan por unidad de código (`<`), NO con
// localeCompare: da lo mismo en cualquier máquina. Para los ids (uuid en minúscula, hex y guiones en
// posiciones fijas) coincide con el orden de Postgres. Para el email es solo un DESEMPATE entre
// cajeros igual de sospechosos, y puede diferir de la collation de la base con mayúsculas, acentos o
// puntuación (la base ordena con la suya); no cambia quién va primero por sospecha.
export function ordenReporteCajeros(
  a: Pick<FilaReporteCajeroAlcance, 'comercio_id' | 'cajero_usuario_id' | 'cajero_email' | 'forzadas' | 'ajustes'>,
  b: Pick<FilaReporteCajeroAlcance, 'comercio_id' | 'cajero_usuario_id' | 'cajero_email' | 'forzadas' | 'ajustes'>,
): number {
  return (
    compararTexto(a.comercio_id, b.comercio_id) ||
    Number(a.cajero_usuario_id === null) - Number(b.cajero_usuario_id === null) ||
    b.forzadas + b.ajustes - (a.forzadas + a.ajustes) ||
    compararTexto(a.cajero_email, b.cajero_email) ||
    compararTexto(a.cajero_usuario_id, b.cajero_usuario_id)
  );
}

// Ascendente por unidad de código, con null al final (como `asc` en Postgres).
function compararTexto(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

// Los dos modos de reporteClientes.
//   - 'pagina': la tabla de la pantalla. UNA llamada, `tamanoPagina` filas (por defecto
//     TAMANO_PAGINA_CLIENTES, el mismo número con el que paginacionClientes convierte el offset en
//     "Página X de Y") en la página pedida, con el orden de la URL.
//   - 'todas': el Excel (y la lista de clientes de la Tarea 6). TODAS las filas, con paginarPorOffset.
//     Por defecto por visitas desc (spec §4: el Excel no lleva orden/dir/pagina); `orden` elige otra
//     columna, siempre con su dirección inicial (direccionInicial: nombre A→Z, el resto desc).
export interface ModoPaginaClientes {
  modo: 'pagina';
  pagina: number; // 1 = la primera; más allá del final, la SQL devuelve la última
  orden: OrdenClientes;
  dir: DireccionOrden;
  tamanoPagina?: number;
}
export interface ModoTodasClientes {
  modo: 'todas';
  // Por defecto 'visitas' (el Excel de Reportes). Leer TODO paginando con un orden que se mueve con la
  // actividad tiene una carrera: un cliente de la página 2 o siguientes que recibe una visita MIENTRAS
  // se pagina sube a una página ya leída y queda afuera. Quien necesita a cada cliente sí o sí (la
  // lista de clientes, que si no le pone 0 visitas) pide 'nombre' (0040: nombre, apellido, cliente_id):
  // una visita no mueve a nadie, y un cliente nuevo solo corre las filas una posición (una fila
  // repetida en el corte, nunca salteada). Solo un cambio de nombre en ese mismo instante movería a uno.
  orden?: OrdenClientes;
  tamanoPagina?: number;
}

// La tabla de clientes. Se pagina SOLO con p_limite/p_offset, NUNCA con .range() (ver pedirPaginaClientes).
//
// En modo 'pagina' devuelve la página con lo que la SQL dice de sí misma: `total` (filas antes de
// paginar) y `offsetEfectivo` (la página que llegó DE VERDAD: pedir más allá del final devuelve la
// última). Con cero filas, `{ filas: [], total: 0, offsetEfectivo: <el offset pedido> }` (contrato de
// la página vacía, paginar.ts). La pantalla calcula "Página X de Y" con offsetEfectivo, nunca con la
// página de la URL (pantallaReportes.ts, paginacionClientes).
export function reporteClientes(
  supabase: SupabaseClient<Database>,
  filtros: FiltrosRpcReportes,
  modo: ModoPaginaClientes,
): Promise<PaginaPorOffset<FilaReporteCliente> | null>;
export function reporteClientes(
  supabase: SupabaseClient<Database>,
  filtros: FiltrosRpcReportes,
  modo: ModoTodasClientes,
): Promise<Paginado<FilaReporteCliente> | null>;
export async function reporteClientes(
  supabase: SupabaseClient<Database>,
  filtros: FiltrosRpcReportes,
  modo: ModoPaginaClientes | ModoTodasClientes,
): Promise<PaginaPorOffset<FilaReporteCliente> | Paginado<FilaReporteCliente> | null> {
  if (modo.modo === 'todas') {
    const orden = modo.orden ?? 'visitas';
    const descendente = direccionInicial(orden) === 'desc';
    return paginarPorOffset(
      (offset, limite) => pedirPaginaClientes(supabase, filtros, orden, descendente, limite, offset),
      modo.tamanoPagina ?? MAXIMO_POR_PAGINA,
    );
  }
  const tamano = modo.tamanoPagina ?? TAMANO_PAGINA_CLIENTES;
  validarTamano(tamano);
  // La página 1 es el offset 0. Una página más allá del final no se corrige acá (no se sabe el
  // total): la SQL acota el offset y devuelve la última.
  return pedirPaginaClientes(supabase, filtros, modo.orden, modo.dir === 'desc', tamano, (modo.pagina - 1) * tamano);
}

// UNA página de reporte_clientes, la única puerta a esa función.
//
// NUNCA `.range()` acá: la función ya pagina ADENTRO con p_limite/p_offset, y el limit/offset que
// agregaría PostgREST iría POR FUERA de un resultado que ya es una página: con .range(2, 3) sobre las
// filas 2 y 3 que devolvió la SQL, PostgREST salta DOS filas más y la segunda página sale vacía (0040,
// comentario de reporte_clientes). Tampoco hace falta un `.order()`: el orden es total adentro de la
// SQL (termina en cliente_id, comercio_id), que es la que corta la página.
//
// Contrato de la página vacía (paginar.ts): de cero filas no se pueden leer `total` ni
// `offset_efectivo` (no hay primera fila), y se devuelve el offset PEDIDO con total 0. Es exacto: la
// SQL acota el offset con el total, así que cero filas significa total 0.
async function pedirPaginaClientes(
  supabase: SupabaseClient<Database>,
  filtros: FiltrosRpcReportes,
  orden: OrdenClientes,
  descendente: boolean,
  limite: number,
  offset: number,
): Promise<PaginaPorOffset<FilaReporteCliente> | null> {
  const { data, error } = await supabase.rpc('reporte_clientes', {
    ...argumentosComunes(filtros),
    p_orden: orden,
    p_desc: descendente,
    p_limite: limite,
    p_offset: offset,
  });
  if (error) {
    console.error('[reportes] falló reporte_clientes:', error);
    return null;
  }
  const filas = data ?? [];
  if (filas.length === 0) return { filas: [], total: 0, offsetEfectivo: offset };
  return { filas, total: filas[0].total, offsetEfectivo: filas[0].offset_efectivo };
}

// Por cajero, dentro de un rango de fechas: acreditaciones, puntos otorgados, monto vendido,
// FORZADAS, ajustes y canjes. Es el reporte que realmente delata la anomalía — el resto de los
// reportes agregan por sucursal o por cliente, y ahí un cajero que regala sellos queda diluido.
//
// EXCEPCIÓN DELIBERADA al fail-soft de los wrappers viejos: devuelve `null` ante un error, no `[]`.
// El criterio fail-soft ("una pantalla de reportes rota no debe tumbar el panel") vale para
// reportes descriptivos, donde un vacío es cosmético. Acá NO: en una pantalla de auditoría
// antifraude, una tabla vacía le dice al dueño "ningún cajero hizo nada raro", que es la conclusión
// exactamente opuesta a la verdad si lo que pasó fue que falló la consulta. La pantalla tiene que
// poder distinguir los dos casos, y el comentario original de este archivo ya lo anticipaba: "si
// algún día importa distinguirlos, se agregaría un canal de error explícito en el retorno". Este fue
// ese día (y los cuatro de la 0040 siguieron el mismo camino).
//
// `desde`/`hasta` son fechas AAAA-MM-DD INCLUSIVAS, interpretadas en la zona horaria del comercio
// por la propia función SQL. `null` en cualquiera = sin ese borde.
export async function reporteCajeros(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  desde: string | null,
  hasta: string | null,
): Promise<FilaReporteCajero[] | null> {
  const { data, error } = await supabase.rpc('reporte_cajeros', {
    p_comercio_id: comercioId,
    p_desde: desde,
    p_hasta: hasta,
  });
  if (error) {
    console.error('[reportes] falló reporte_cajeros:', error);
    return null;
  }
  return data ?? [];
}

// Por sucursal del comercio: acreditaciones, puntos otorgados, canjes y clientes únicos. Incluye el
// bucket de actividad SIN sucursal (fila con sucursal_id null, p. ej. demos previos a la atribución).
export async function reporteSucursales(
  supabase: SupabaseClient<Database>,
  comercioId: string,
): Promise<FilaReporteSucursal[]> {
  const { data, error } = await supabase.rpc('reporte_sucursales', { p_comercio_id: comercioId });
  if (error) {
    console.error('[reportes] falló reporte_sucursales:', error);
    return [];
  }
  return data ?? [];
}

// Vista agregada cross-comercio para el panel FM: por comercio, con su cuenta (bucket "sin cuenta" para
// los que no tienen cuenta_id). NO toma comercioId — es una vista global, solo para el gate de FM.
export async function reporteFmComercios(
  supabase: SupabaseClient<Database>,
): Promise<FilaFmComercio[]> {
  const { data, error } = await supabase.rpc('reporte_fm_comercios');
  if (error) {
    console.error('[reportes] falló reporte_fm_comercios:', error);
    return [];
  }
  return data ?? [];
}

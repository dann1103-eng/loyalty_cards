import type { ParametrosReportes } from './parametrosReportes';
import { esPeriodo, resolverPeriodo, PERIODO_POR_DEFECTO, type Periodo } from './rangoFechas';
import { sePuedeOrdenarPorAcumulado } from './unidadAcumulado';

// Los filtros de Reportes, resueltos. Módulo PURO: la página y la ruta del Excel (que no se pueden
// probar) llaman EXACTAMENTE a estas funciones, en este orden:
//
//   const parametros = leerParametrosReportes(searchParams);          // parametrosReportes.ts
//   const elegido    = comercioAConsultar(comercios, parametros);      // ANTES de cargar nada
//   const contexto   = await cargarContextoReportes(…, elegido);       // Tarea 3: zonas, tipos,
//                                                                      //   sucursales y usuarios
//   const filtros    = resolverFiltrosReportes(comercios, parametros, contexto, new Date());
//
// CONTROL DE SEGURIDAD (spec 2026-07-25 §5 y 2026-09-23 §1): los filtros llegan por querystring —input
// del cliente—. El comercio DEBE estar entre las membresías owner de la sesión; la sucursal y el cajero
// DEBEN pertenecer al comercio resuelto. Lo que no valida cae a su default ("Todo", "todas", "todos"):
// nunca llega un id ajeno a un RPC, y nunca un error por un parámetro raro.

export interface ComercioOwner {
  comercioId: string;
  nombre: string;
}

// Lo que el cargador sabe de cada comercio del alcance: su zona (para cortar los días) y el tipo de su
// programa PRINCIPAL (para la unidad del acumulado; ver unidadAcumulado.ts).
export interface DatosComercioReportes {
  comercioId: string;
  zonaHoraria: string;
  tipoPrincipal: string;
}

// Lo que cargarContextoReportes (Tarea 3) trae de la base para poder resolver. Genérico en la
// sucursal y el usuario: lo único que se valida es el `id`, y exigir la fila entera acoplaría esta
// función a la forma de la tabla (cada columna nueva obligaría a rellenar campos en las pruebas).
export interface ContextoReportes<S extends { id: string }, U extends { id: string }> {
  // La zona del comercio ACTIVO (el del switcher del header): con "Todo", los presets se resuelven
  // ahí. verifyComercioOwner no la trae: una consulta.
  zonaComercioActivo: string;
  // Al menos los comercios del alcance. Si falta alguno, se asume lo conservador: no se ordena por
  // acumulado, y la zona es la del activo.
  datosComercios: DatosComercioReportes[];
  // Del comercio que devolvió comercioAConsultar ([] si fue null): activas e inactivas.
  sucursales: S[];
  // Los usuarios_comercio de ese mismo comercio: cajeros y dueño, activos o no ([] si fue null).
  usuarios: U[];
}

// Columnas por las que se ordena la tabla de clientes (spec §3). La SQL (reporte_clientes, 0040) valida
// contra la MISMA lista cerrada; un valor fuera de ella ordena por visitas.
export const ORDENES_CLIENTES = ['visitas', 'acumulado', 'premios', 'ultima', 'nombre'] as const;
export type OrdenClientes = (typeof ORDENES_CLIENTES)[number];
export type DireccionOrden = 'asc' | 'desc';

export const PAGINA_MAXIMA = 10_000;

// Dirección con la que abre cada columna: nombre A→Z; el resto, de mayor a menor (lo que el dueño
// quiere ver primero es quién más vino, más acumuló, más canjeó o vino más recién).
export function direccionInicial(orden: OrdenClientes): DireccionOrden {
  return orden === 'nombre' ? 'asc' : 'desc';
}

// Todo resuelto: lo que usan la pantalla, las RPC y el Excel.
export interface FiltrosReportes<S extends { id: string }, U extends { id: string }> {
  periodo: Periodo;
  desde: string | null; // null = sin borde inferior ("Desde siempre", o un rango sin desde)
  hasta: string; // SIEMPRE: la app lo manda (reporte_por_dia lo exige); nunca pasa de hoy
  zonaHoraria: string; // en la que se resolvieron los presets
  comercio: ComercioOwner | null; // null = "Todo"
  alcance: ComercioOwner[]; // los comercios a consultar (p_comercios)
  sucursal: S | null;
  cajero: U | null;
  orden: OrdenClientes;
  dir: DireccionOrden;
  pagina: number;
  // Si la columna Acumulado se puede ordenar en este alcance (su encabezado es un enlace).
  acumuladoOrdenable: boolean;
}

// El comercio resuelto, ANTES de cargar sus sucursales y usuarios. "Un solo comercio = ese comercio
// elegido" (spec §1): si el dueño tiene uno, es ese aunque la URL no lo traiga. Si tiene varios, el de
// la URL si es SUYO; si no, null ("Todo").
//
// Existe aparte, y la usan la página, la ruta y el cargador, porque el prechequeo que hacía la página
// (mirar solo `params.comercio`) no conocía esta regla: un dueño con un comercio no habría cargado sus
// sucursales, y los filtros de sucursal y cajero no le habrían funcionado nunca.
export function comercioAConsultar(
  comercios: ComercioOwner[],
  parametros: Pick<ParametrosReportes, 'comercio'>,
): ComercioOwner | null {
  if (comercios.length === 1) return comercios[0];
  return comercios.find((c) => c.comercioId === parametros.comercio) ?? null;
}

export function resolverFiltrosReportes<S extends { id: string }, U extends { id: string }>(
  comercios: ComercioOwner[],
  parametros: ParametrosReportes,
  contexto: ContextoReportes<S, U>,
  ahora: Date,
): FiltrosReportes<S, U> {
  const comercio = comercioAConsultar(comercios, parametros);
  const alcance = comercio ? [comercio] : comercios;

  // Sucursal y cajero solo contra las listas del comercio RESUELTO: con "Todo" no hay contra qué
  // verificar pertenencia, y se ignoran aunque el cargador hubiera traído algo.
  const sucursal = comercio ? (contexto.sucursales.find((s) => s.id === parametros.sucursal) ?? null) : null;
  const cajero = comercio ? (contexto.usuarios.find((u) => u.id === parametros.cajero) ?? null) : null;

  // Los días se cortan en la zona del comercio elegido; con "Todo", en la del ACTIVO. (Con varias
  // zonas en "Todo", "Hoy" puede quedar corrido un día en algún comercio cerca de la medianoche:
  // limitación documentada en la spec; hoy todos los pilotos están en America/El_Salvador.)
  const datosDe = (id: string) => contexto.datosComercios.find((d) => d.comercioId === id);
  const zonaHoraria = (comercio && datosDe(comercio.comercioId)?.zonaHoraria) || contexto.zonaComercioActivo;

  const periodo = esPeriodo(parametros.periodo) ? parametros.periodo : PERIODO_POR_DEFECTO;
  const { desde, hasta } = resolverPeriodo(
    periodo,
    { desde: parametros.desde, hasta: parametros.hasta },
    ahora,
    zonaHoraria,
  );

  // Acumulado se ordena solo si TODO el alcance habla la misma unidad (y la tiene). Un comercio del
  // alcance sin datos en el contexto cuenta como "no se sabe": no se ordena.
  const tiposAlcance = alcance.map((c) => datosDe(c.comercioId)?.tipoPrincipal);
  const acumuladoOrdenable =
    tiposAlcance.every((t): t is string => t !== undefined) && sePuedeOrdenarPorAcumulado(tiposAlcance);

  // Un orden inválido, o acumulado donde no se puede (un enlace guardado de cuando el alcance era
  // otro), cae a la vista por defecto ENTERA: visitas desc. La dirección que venía con él describía
  // otra columna. Con un orden válido, una dirección inválida cae a la inicial de esa columna.
  const ordenPedido = ORDENES_CLIENTES.find((o) => o === parametros.orden);
  const ordenValido = ordenPedido !== undefined && (ordenPedido !== 'acumulado' || acumuladoOrdenable);
  const orden: OrdenClientes = ordenValido ? ordenPedido : 'visitas';
  const dir: DireccionOrden =
    ordenValido && (parametros.dir === 'asc' || parametros.dir === 'desc')
      ? parametros.dir
      : direccionInicial(orden);

  return {
    periodo,
    desde,
    hasta,
    zonaHoraria,
    comercio,
    alcance,
    sucursal,
    cajero,
    orden,
    dir,
    pagina: leerPagina(parametros.pagina),
    acumuladoOrdenable,
  };
}

// Entero de 1 a PAGINA_MAXIMA escrito solo con dígitos; cualquier otra cosa ("2.5", "1e3", "-1", "")
// es la página 1. Una página más allá del final NO se corrige acá (no se sabe el total): la SQL acota
// el offset y devuelve la última (spec §3).
function leerPagina(valor: string | undefined): number {
  if (!valor || !/^\d{1,5}$/.test(valor)) return 1;
  const pagina = Number(valor);
  return pagina >= 1 && pagina <= PAGINA_MAXIMA ? pagina : 1;
}

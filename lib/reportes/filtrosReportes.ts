import type { ParametrosReportes } from './parametrosReportes';
import { esPeriodo, resolverPeriodo, PERIODO_POR_DEFECTO, type Periodo } from './rangoFechas';
import { sePuedeOrdenarPorAcumulado } from './unidadAcumulado';
import { esZonaHorariaValida, ZONA_HORARIA_DEFAULT } from '@/lib/comercio/zonasHorarias';

// Los filtros de Reportes, resueltos. Módulo PURO: la página (que no se prueba: el repo no tiene
// pruebas de componentes) y la ruta del Excel (cuya prueba, de la Tarea 5, mockea el gate) llaman
// EXACTAMENTE a estas funciones, en este orden, y las reglas se prueban UNA vez, acá:
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
  // ahí. verifyComercioOwner no la trae: una consulta. Si no es una zona válida (una consulta que
  // falló y dejó ''), cae a ZONA_HORARIA_DEFAULT: nunca lanza.
  zonaComercioActivo: string;
  // Al menos los comercios del alcance. Si falta alguno, se asume lo conservador: no se ordena por
  // acumulado, su zona es la del activo y su tipo 'puntos'.
  datosComercios: DatosComercioReportes[];
  // De QUÉ comercio son las dos listas de abajo: el id que devolvió comercioAConsultar, o null si fue
  // null. El resolver lo compara con el comercio que resuelve y, si no coincide, trata las listas
  // como vacías: un cargador que trajera las del comercio ACTIVO dejaría validar una sucursal de otro
  // comercio contra el elegido.
  comercioDeLasListas: string | null;
  // Las sucursales de ese comercio: activas e inactivas.
  sucursales: S[];
  // Los usuarios_comercio de ese mismo comercio: cajeros y dueño, activos o no.
  usuarios: U[];
}

// La zona y el tipo YA RESUELTOS de un comercio del alcance, con el respaldo aplicado. La tabla (la
// hora local de cada fila) y el Excel (fechas y unidad por comercio) leen de acá y no reimplementan
// el respaldo cada uno a su manera.
export interface DatosComercioResueltos {
  zonaHoraria: string;
  tipoPrincipal: string;
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
  // Zona y tipo resueltos de CADA comercio del alcance (y solo de esos), por id.
  datosAlcance: ReadonlyMap<string, DatosComercioResueltos>;
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

  // Sucursal y cajero solo contra las listas del comercio RESUELTO, y solo si el cargador las trajo
  // de ESE comercio: con "Todo" no hay contra qué verificar pertenencia, y unas listas de otro
  // comercio (o sin comercio declarado) se tratan como vacías.
  const listasDelComercio = comercio !== null && contexto.comercioDeLasListas === comercio.comercioId;
  const sucursal = listasDelComercio
    ? (contexto.sucursales.find((s) => s.id === parametros.sucursal) ?? null)
    : null;
  const cajero = listasDelComercio ? (contexto.usuarios.find((u) => u.id === parametros.cajero) ?? null) : null;

  // ZONAS. Intl lanza RangeError con una zona que no conoce, y un reporte no puede dar 500 porque la
  // consulta de zona falló y dejó ''. Respaldo en cascada, igual para todos: la zona de cada comercio
  // si es válida (de la lista cerrada de zonasHorarias.ts, la del CHECK de la 0015); si no, la del
  // ACTIVO si es válida; si no, ZONA_HORARIA_DEFAULT. Una zona vacía es una inválida más: el mismo
  // respaldo, no otro.
  const zonaActiva = esZonaHorariaValida(contexto.zonaComercioActivo)
    ? contexto.zonaComercioActivo
    : ZONA_HORARIA_DEFAULT;
  const datosDe = (id: string) => contexto.datosComercios.find((d) => d.comercioId === id);
  const resueltos = (id: string): DatosComercioResueltos => {
    const datos = datosDe(id);
    return {
      zonaHoraria: datos && esZonaHorariaValida(datos.zonaHoraria) ? datos.zonaHoraria : zonaActiva,
      // Sin datos, 'puntos': la misma degradación de tipoOPuntos en todo el proyecto (y la de la
      // pantalla de Reportes hasta hoy cuando un comercio no tiene programa principal).
      tipoPrincipal: datos?.tipoPrincipal ?? 'puntos',
    };
  };
  const datosAlcance = new Map(alcance.map((c) => [c.comercioId, resueltos(c.comercioId)] as const));

  // Los días se cortan en la zona del comercio elegido; con "Todo", en la del ACTIVO. (Con varias
  // zonas en "Todo", "Hoy" puede quedar corrido un día en algún comercio cerca de la medianoche:
  // limitación documentada en la spec; hoy todos los pilotos están en America/El_Salvador.)
  const zonaHoraria = comercio ? resueltos(comercio.comercioId).zonaHoraria : zonaActiva;

  const periodo = esPeriodo(parametros.periodo) ? parametros.periodo : PERIODO_POR_DEFECTO;
  const { desde, hasta } = resolverPeriodo(
    periodo,
    { desde: parametros.desde, hasta: parametros.hasta },
    ahora,
    zonaHoraria,
  );

  // Acumulado se ordena solo si TODO el alcance habla la misma unidad (y la tiene). Un comercio del
  // alcance sin datos en el contexto cuenta como "no se sabe": no se ordena (acá NO se usa el
  // 'puntos' de respaldo de datosAlcance, que sirve para mostrar, no para decidir un orden).
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
    datosAlcance,
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

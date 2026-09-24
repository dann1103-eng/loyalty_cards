import type { Periodo } from './rangoFechas';
import { direccionInicial, type DireccionOrden, type OrdenClientes } from './filtrosReportes';

// Las URLs de Reportes. Módulo PURO. Todo enlace de la pantalla —los chips de filtro, los encabezados
// de la tabla, Anterior/Siguiente, "Descargar Excel"— y los campos ocultos del formulario de
// "Personalizado" salen de acá, así que las reglas de spec 2026-09-23 §1 y §3 viven en un solo lugar:
//   - se conserva lo que no cambia;
//   - cambiar de comercio, o volver a "Todo", BORRA sucursal y cajero (eran del comercio anterior);
//   - cualquier cambio de filtro, y ordenar, vuelven a la página 1;
//   - tocar la columna activa invierte la dirección; otra columna abre con su dirección inicial.
//
// Se arman desde los filtros YA RESUELTOS (resolverFiltrosReportes), nunca desde la querystring cruda:
// un id ajeno que llegó en la URL y se descartó no reaparece en los enlaces.

export const RUTA_REPORTES = '/comercio/reportes';
export const RUTA_EXCEL_REPORTES = '/comercio/reportes/exportar';

// Lo que hace falta de FiltrosReportes (que es asignable a esto): solo los ids.
export interface FiltrosParaUrl {
  periodo: Periodo;
  desde: string | null;
  hasta: string;
  comercio: { comercioId: string } | null;
  sucursal: { id: string } | null;
  cajero: { id: string } | null;
  orden: OrdenClientes;
  dir: DireccionOrden;
  pagina: number;
}

// Un cambio respecto de la vista actual. `null` en comercio, sucursal o cajero = "Todo"/"todas"/
// "todos". `orden` = se tocó ese encabezado. Solo `pagina` conserva el resto sin volver a la 1.
export interface CambiosUrlReportes {
  periodo?: Periodo;
  desde?: string | null;
  hasta?: string;
  comercio?: string | null;
  sucursal?: string | null;
  cajero?: string | null;
  orden?: OrdenClientes;
  pagina?: number;
}

interface Estado {
  periodo: Periodo;
  desde: string | null;
  hasta: string;
  comercio: string | null;
  sucursal: string | null;
  cajero: string | null;
  orden: OrdenClientes;
  dir: DireccionOrden;
  pagina: number;
}

export function urlReportes(filtros: FiltrosParaUrl, cambios: CambiosUrlReportes = {}): string {
  return armar(RUTA_REPORTES, pares(aplicar(filtros, cambios), true));
}

// La descarga del Excel: los filtros de la vista, SIN orden, dir ni página (el Excel trae TODOS los
// clientes por visitas, spec §4).
export function urlExcelReportes(filtros: FiltrosParaUrl): string {
  return armar(RUTA_EXCEL_REPORTES, pares(aplicar(filtros, {}), false));
}

// Los <input type="hidden"> del formulario de "Personalizado": lo mismo que conservaría un enlace a
// `periodo=rango`, menos las fechas (son los dos <input type="date"> visibles) y la página (cambiar
// el rango vuelve a la 1).
export function camposOcultosRango(filtros: FiltrosParaUrl): { nombre: string; valor: string }[] {
  return pares(aplicar(filtros, { periodo: 'rango' }), true)
    .filter(([nombre]) => nombre !== 'desde' && nombre !== 'hasta')
    .map(([nombre, valor]) => ({ nombre, valor }));
}

function aplicar(filtros: FiltrosParaUrl, cambios: CambiosUrlReportes): Estado {
  const comercioActual = filtros.comercio?.comercioId ?? null;
  const comercio = cambios.comercio !== undefined ? cambios.comercio : comercioActual;
  // Cambiar de comercio (o volver a "Todo") borra sucursal y cajero: eran del comercio anterior. Tocar
  // el mismo comercio que ya está elegido no los pierde.
  const cambiaComercio = comercio !== comercioActual;
  const sucursal =
    cambios.sucursal !== undefined ? cambios.sucursal : cambiaComercio ? null : (filtros.sucursal?.id ?? null);
  const cajero =
    cambios.cajero !== undefined ? cambios.cajero : cambiaComercio ? null : (filtros.cajero?.id ?? null);

  // Ordenar: la columna activa se invierte; otra abre con su dirección inicial.
  let orden = filtros.orden;
  let dir = filtros.dir;
  if (cambios.orden !== undefined) {
    const invertida: DireccionOrden = filtros.dir === 'asc' ? 'desc' : 'asc';
    dir = cambios.orden === filtros.orden ? invertida : direccionInicial(cambios.orden);
    orden = cambios.orden;
  }

  // Cualquier cambio que no sea solo de página vuelve a la 1. Se miran los VALORES y no las claves:
  // `{ comercio: undefined }` no cambia nada.
  const cambiaFiltroUOrden = (Object.keys(cambios) as (keyof CambiosUrlReportes)[]).some(
    (clave) => clave !== 'pagina' && cambios[clave] !== undefined,
  );

  // Las fechas de la vista se conservan: al pasar a "Personalizado" el formulario abre PRECARGADO con
  // el período que se está viendo (spec §1), y un rango las mantiene al cambiar otro filtro.
  return {
    periodo: cambios.periodo ?? filtros.periodo,
    desde: cambios.desde !== undefined ? cambios.desde : filtros.desde,
    hasta: cambios.hasta ?? filtros.hasta,
    comercio,
    sucursal,
    cajero,
    orden,
    dir,
    pagina: cambios.pagina ?? (cambiaFiltroUOrden ? 1 : filtros.pagina),
  };
}

// Los pares clave/valor, en orden fijo. Lo que es default se omite (URL corta y estable), salvo el
// período, que va siempre: es lo primero que se lee de un enlace guardado.
function pares(estado: Estado, conTabla: boolean): [string, string][] {
  const salida: [string, string][] = [['periodo', estado.periodo]];
  // Las fechas solo significan algo con "rango": un preset se recalcula con el reloj.
  if (estado.periodo === 'rango') {
    if (estado.desde !== null) salida.push(['desde', estado.desde]);
    salida.push(['hasta', estado.hasta]);
  }
  if (estado.comercio !== null) salida.push(['comercio', estado.comercio]);
  if (estado.sucursal !== null) salida.push(['sucursal', estado.sucursal]);
  if (estado.cajero !== null) salida.push(['cajero', estado.cajero]);
  if (conTabla) {
    // El orden por defecto (visitas desc) no se escribe; cualquier otro, con sus dos claves.
    if (estado.orden !== 'visitas' || estado.dir !== direccionInicial('visitas')) {
      salida.push(['orden', estado.orden], ['dir', estado.dir]);
    }
    if (estado.pagina > 1) salida.push(['pagina', String(estado.pagina)]);
  }
  return salida;
}

function armar(ruta: string, lista: [string, string][]): string {
  return `${ruta}?${new URLSearchParams(lista).toString()}`;
}

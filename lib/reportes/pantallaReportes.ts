import { urlReportes, type FiltrosParaUrl } from './urlReportes';
import type { ComercioOwner, OrdenClientes } from './filtrosReportes';

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
// después, para que al scrollear de costado se siga viendo de quién es cada fila.
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

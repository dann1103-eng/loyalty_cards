// Los dos bucles de paginación del Excel (spec 2026-09-23 §4, "Sin el tope de 1000 filas"). Módulo
// PURO: el llamador inyecta la función que pide UNA página y el tamaño, así se prueban con un falso
// que se comporta como el lado real y un tamaño de 2.
//
// PostgREST corta cada respuesta en 1000 filas SIN avisar (`max-rows`). Son dos mecanismos que NO se
// mezclan, porque las funciones no se comportan igual más allá del final:
//
//   - paginarPorOffset, SOLO para reporte_clientes. Esa función ya pagina adentro (p_limite, p_offset)
//     y ACOTA el offset con el total: pedir más allá del final devuelve la ÚLTIMA página otra vez. Por
//     eso NO sirve cortar con "recibí menos que el tamaño": con un total múltiplo exacto del tamaño,
//     la página siguiente vuelve llena (es la última repetida) y el bucle duplicaría filas. Corta con
//     lo que la función dice de sí misma: `offset_efectivo !== p_offset` (la SQL acotó: no hay más) o
//     `p_offset + filas >= total`. Y NUNCA `.range()` sobre ella: PostgREST aplicaría su limit/offset
//     POR FUERA de un resultado que ya viene con 1000 o menos, y la segunda página saldría vacía.
//   - paginarPorRango, para las demás (resumen, por día, cajeros): `.range(inicio, fin)` con un
//     `.order(...)` explícito (sin orden, dos páginas pueden solaparse). Más allá del final PostgREST
//     devuelve vacío, así que "recibí menos que el tamaño" sí es el final (siempre que el tamaño no
//     pase del max-rows de PostgREST: por eso validarTamano lo rechaza).
//
// Los dos devuelven null si CUALQUIER página falla: nunca un Excel a medias que parezca completo
// (spec §4, "nunca un archivo con ceros por un error"). Y los dos se detienen en TOPE_FILAS: si
// había más, lo avisan (`alcanzoTope`) y la hoja Resumen lo dice.

// Tope de seguridad por hoja (spec §4). Con los pilotos, órdenes de magnitud por debajo.
export const TOPE_FILAS = 50_000;

// El `max-rows` de PostgREST en Supabase: ninguna respuesta trae más filas, pida lo que pida.
export const MAXIMO_POR_PAGINA = 1000;

// Filas por página de la tabla de clientes de Reportes (spec §3). Vive en la capa de paginación y no en
// la de pantalla porque la usan las DOS puntas: el wrapper que pide la página (reportes.ts,
// reporteClientes) y la pantalla que convierte el offset en "Página X de Y" (pantallaReportes.ts). Con
// un solo número y una sola cuenta, las dos no pueden desalinearse.
export const TAMANO_PAGINA_CLIENTES = 50;

// El `p_offset` de la página `pagina` (1 = la primera) con páginas de `tamano` filas.
export function offsetDePagina(pagina: number, tamano: number = TAMANO_PAGINA_CLIENTES): number {
  return (pagina - 1) * tamano;
}

export interface Paginado<T> {
  filas: T[];
  // true = había MÁS de TOPE_FILAS y se cortó ahí: falta información, y la hoja Resumen lo dice. Con
  // exactamente TOPE_FILAS no falta nada y es false (saberlo cuesta a lo sumo una llamada más).
  alcanzoTope: boolean;
}

// Una página de reporte_clientes, con lo que la SQL dice de sí misma: las columnas `total` y
// `offset_efectivo` vienen repetidas en cada fila, y el llamador las saca de la primera.
//
// CONTRATO DE LA PÁGINA VACÍA: de una respuesta sin filas no se pueden leer (no hay primera fila), y
// el llamador devuelve `{ filas: [], total: 0, offsetEfectivo: offset }`, con el MISMO offset que
// pidió. Es exacto, no una suposición: la SQL acota el offset con el total, así que cero filas
// significa total 0 (spec §5.3). Con otro offsetEfectivo el bucle creería que la SQL acotó y cortaría
// igual, pero por la razón equivocada.
export interface PaginaPorOffset<T> {
  filas: T[];
  total: number;
  offsetEfectivo: number;
}

// Exportada para el modo 'pagina' de reporteClientes (reportes.ts), que pide UNA página sin pasar por
// estos bucles y tiene que rechazar el mismo tamaño que ellos.
export function validarTamano(tamano: number): void {
  // Error de programación, no de datos. Con 0 el bucle no avanzaría nunca. Y por encima del max-rows
  // de PostgREST cada página llegaría con 1000 filas: paginarPorRango leería "menos que el tamaño"
  // como la última página y el Excel saldría cortado EN SILENCIO, que es justo el defecto que estos
  // bucles existen para arreglar.
  if (!Number.isInteger(tamano) || tamano < 1 || tamano > MAXIMO_POR_PAGINA) {
    throw new Error(`paginar: tamaño de página inválido: ${tamano} (entero de 1 a ${MAXIMO_POR_PAGINA})`);
  }
}

export async function paginarPorOffset<T>(
  llamar: (offset: number, limite: number) => Promise<PaginaPorOffset<T> | null>,
  tamano: number,
): Promise<Paginado<T> | null> {
  validarTamano(tamano);
  const filas: T[] = [];
  let offset = 0;
  for (;;) {
    const pagina = await llamar(offset, tamano);
    if (pagina === null) return null;
    // La SQL devolvió otra página que la pedida: acotó el offset porque no hay más filas desde ahí
    // (el total cambió entre llamadas). Lo que trae ya está en `filas`.
    if (pagina.offsetEfectivo !== offset) break;
    filas.push(...pagina.filas);
    if (filas.length > TOPE_FILAS) return { filas: filas.slice(0, TOPE_FILAS), alcanzoTope: true };
    // Se avanza por lo que llegó y no por `tamano`: si la SQL acotara el límite más abajo que lo
    // pedido, avanzar por `tamano` se saltearía filas. Y una página vacía antes del total cortaría un
    // bucle que si no, no terminaría.
    if (pagina.filas.length === 0 || offset + pagina.filas.length >= pagina.total) break;
    offset += pagina.filas.length;
  }
  return { filas, alcanzoTope: false };
}

export async function paginarPorRango<T>(
  llamar: (inicio: number, fin: number) => Promise<T[] | null>,
  tamano: number,
): Promise<Paginado<T> | null> {
  validarTamano(tamano);
  const filas: T[] = [];
  for (let inicio = 0; ; inicio += tamano) {
    // `fin` inclusivo, como `.range(inicio, fin)` de supabase-js.
    const pagina = await llamar(inicio, inicio + tamano - 1);
    if (pagina === null) return null;
    filas.push(...pagina);
    if (filas.length > TOPE_FILAS) return { filas: filas.slice(0, TOPE_FILAS), alcanzoTope: true };
    if (pagina.length < tamano) break;
  }
  return { filas, alcanzoTope: false };
}

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
//     devuelve vacío, así que "recibí menos que el tamaño" sí es el final.
//
// Los dos devuelven null si CUALQUIER página falla: nunca un Excel a medias que parezca completo
// (spec §4, "nunca un archivo con ceros por un error"). Y los dos se detienen en TOPE_FILAS: si se
// alcanza, la hoja Resumen lo dice.

// Tope de seguridad por hoja (spec §4). Con los pilotos, órdenes de magnitud por debajo.
export const TOPE_FILAS = 50_000;

export interface Paginado<T> {
  filas: T[];
  // true = se llegó a TOPE_FILAS y se dejó de pedir: puede faltar información.
  alcanzoTope: boolean;
}

// Una página de reporte_clientes, con lo que la SQL dice de sí misma (columnas `total` y
// `offset_efectivo`, repetidas en cada fila; el llamador las saca de la primera, o de ninguna si vino
// vacía: gracias al acotado, cero filas significa total 0).
export interface PaginaPorOffset<T> {
  filas: T[];
  total: number;
  offsetEfectivo: number;
}

function validarTamano(tamano: number): void {
  if (!Number.isInteger(tamano) || tamano < 1) {
    // Error de programación, no de datos: con 0 el bucle no avanzaría nunca.
    throw new Error(`paginar: tamaño de página inválido: ${tamano}`);
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
    if (filas.length >= TOPE_FILAS) return { filas: filas.slice(0, TOPE_FILAS), alcanzoTope: true };
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
    if (filas.length >= TOPE_FILAS) return { filas: filas.slice(0, TOPE_FILAS), alcanzoTope: true };
    if (pagina.length < tamano) break;
  }
  return { filas, alcanzoTope: false };
}

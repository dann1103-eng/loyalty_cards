// Qué ícono lleva cada casilla de la grilla de sellos cuando el comercio subió DOS (migración 0041).
// Puro — sin Supabase ni DOM — porque lo consumen el pase de Apple, el hero de Google y las dos
// vistas previas (editor de marca y registro), y los cuatro tienen que dibujar lo mismo.

export const PATRONES_SELLO = ['intercalado', 'mitades', 'ultimo', 'casillas'] as const;
export type PatronSello = (typeof PATRONES_SELLO)[number];

// NULL en la base se lee como este: es lo que el dueño ve elegido al subir el segundo ícono.
export const PATRON_POR_DEFECTO: PatronSello = 'intercalado';

// El mismo tope que el CHECK de la 0041. No es la meta de sellos (esa cambia por programa): es la
// cota que impide guardar una lista absurda.
export const MAX_CASILLAS = 30;

export function esPatronSello(valor: unknown): valor is PatronSello {
  return typeof valor === 'string' && (PATRONES_SELLO as readonly string[]).includes(valor);
}

export interface PatronSellos {
  patron: PatronSello;
  // Posiciones desde 1, como las cuenta el dueño ("la casilla 5"). Solo se miran con 'casillas'.
  casillas: number[];
}

// Lo que da una fila con las dos columnas en NULL. Para los lugares que arman una marca sin leer la
// base (pruebas, el portal, la portada de clase).
export const SIN_PATRON: PatronSellos = { patron: PATRON_POR_DEFECTO, casillas: [] };

// Lo que sale de la base o de un formulario es dato hostil: un patrón desconocido cae al de por
// defecto, y de las casillas sobreviven solo los enteros de 1 a MAX_CASILLAS, sin repetir y en
// orden. Se DESCARTA lo ilegible en vez de arreglarlo ("5.7" no es la casilla 5 ni la 6).
export function sanearPatronSellos(patron: unknown, casillas: unknown): PatronSellos {
  const lista = Array.isArray(casillas) ? casillas : [];
  const validas = lista.filter(
    (c): c is number => typeof c === 'number' && Number.isInteger(c) && c >= 1 && c <= MAX_CASILLAS,
  );
  return {
    patron: esPatronSello(patron) ? patron : PATRON_POR_DEFECTO,
    casillas: [...new Set(validas)].sort((a, b) => a - b),
  };
}

// El patrón de una fila de `comercios` o de `programas_tarjeta`, ya saneado. Un solo lugar para que
// los consumidores de la marca no repitan (ni se olviden) el saneo.
export function patronDeFila(fila: { sello_patron: string | null; sello_casillas: number[] | null }): PatronSellos {
  return sanearPatronSellos(fila.sello_patron, fila.sello_casillas);
}

// ¿La casilla `indice` (desde 0, como la recorre la grilla) lleva el SEGUNDO ícono?
//
// `meta` es el total de casillas. Una posición guardada que quedó fuera de la grilla (el dueño bajó
// la meta de 10 a 8 después de elegir la casilla 10) simplemente no coincide con ningún índice: no
// hay que limpiarla, y si vuelve a subir la meta, reaparece.
export function llevaSegundoIcono(indice: number, meta: number, { patron, casillas }: PatronSellos): boolean {
  if (patron === 'intercalado') return indice % 2 === 1;
  // Con meta impar la casilla del medio queda en la PRIMERA mitad: 5 sellos = 3 + 2. Es el mismo
  // corte que hace la grilla al partirse en dos filas (Math.ceil), así que con más de 6 sellos
  // "mitades" coincide con "la fila de abajo".
  if (patron === 'mitades') return indice >= Math.ceil(meta / 2);
  if (patron === 'ultimo') return indice === meta - 1;
  return casillas.includes(indice + 1);
}

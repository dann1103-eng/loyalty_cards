import { tipoOPuntos } from '@/lib/tarjetas/tipos';
import { unidadPrograma } from '@/lib/tarjetas/unidadPrograma';

// La unidad del ACUMULADO de Reportes (spec 2026-09-23, "Unidad del acumulado"). Módulo PURO.
//
// `puntos_otorgados` suma `puntos_delta` de las acreditaciones, y ese es el contador universal de la
// tarjeta (0018): en cashback y gift card son CENTAVOS, y en cupón, membresía y descuento el delta es
// siempre 0. La trampa ya se pisó una vez (exportarClientes.ts): un 1250 escrito crudo en la columna
// de un cashback le dice al dueño que devolvió $1250 cuando fueron $12.50.
//
// Todo se DERIVA del campo `contador` del catálogo (tipos.ts) y de unidadPrograma, no de una tabla
// escrita acá: un noveno tipo cae solo en su contador, y la prueba recorre el catálogo entero.
//
// En PANTALLA no hace falta nada de esto: describirCosto(tipo, valor) ya dice "8 sellos", "$12.50" o
// vacío. Esto es para el Excel, donde el valor, su formato y la unidad van en celdas separadas, y para
// decidir si la columna se puede ordenar.

// El formato de celda de los montos en dólares (spec §4).
export const FORMATO_DOLARES = '$#,##0.00';

// La palabra de la columna Unidad: "puntos", "sellos", "visitas prepagadas" o "$"; null en los tipos
// sin contador (la celda va vacía).
//
// Prepago dice "visitas prepagadas" y no "visitas" (lo que dice unidadPrograma): en el Excel va al
// lado de la columna Visitas, que cuenta OTRA cosa (las veces que se atendió al cliente), y la misma
// palabra en las dos confundiría. Se reescribe por la palabra y no por el tipo, porque el choque es de
// la palabra: cualquier tipo cuya unidad se llame "visitas" tendría el mismo problema.
export function unidadAcumulado(tipoTarjeta: string): string | null {
  const contador = tipoOPuntos(tipoTarjeta).contador;
  if (contador === 'centavos') return '$';
  const unidad = unidadPrograma(tipoTarjeta);
  if (!unidad) return null;
  return unidad.plural === 'visitas' ? 'visitas prepagadas' : unidad.plural;
}

// Lo que va en las celdas del acumulado de una fila del Excel.
export interface CeldaAcumulado {
  // null = celda vacía (tipos sin contador): un 0 ahí parecería un dato.
  valor: number | null;
  // undefined = número general (enteros).
  formato: string | undefined;
  unidad: string | null;
}

export function acumuladoExcel(tipoTarjeta: string, bruto: number): CeldaAcumulado {
  const contador = tipoOPuntos(tipoTarjeta).contador;
  if (contador === 'centavos') return { valor: bruto / 100, formato: FORMATO_DOLARES, unidad: '$' };
  if (contador === 'ninguno') return { valor: null, formato: undefined, unidad: null };
  return { valor: bruto, formato: undefined, unidad: unidadAcumulado(tipoTarjeta) };
}

// ¿Tiene sentido ordenar la tabla por Acumulado en este alcance? `tipos` = el tipo principal de CADA
// comercio del alcance. No, si mezcla unidades (ordenar centavos contra sellos no significa nada) o si
// su única unidad es "ninguna" (la columna va vacía). Cashback con gift card sí: los dos son dólares.
export function sePuedeOrdenarPorAcumulado(tipos: string[]): boolean {
  const unidades = new Set(tipos.map(unidadAcumulado));
  return unidades.size === 1 && !unidades.has(null);
}

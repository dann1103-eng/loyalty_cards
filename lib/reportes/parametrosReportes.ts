// Lectura de la querystring de Reportes. Módulo PURO.
//
// Dos lugares leen la misma URL: la página (Next le entrega un objeto plano, donde una clave repetida
// llega como ARREGLO) y la ruta del Excel (lee `request.nextUrl.searchParams`, un URLSearchParams,
// donde `.get()` devolvería el PRIMER valor). Si cada una la leyera a su manera,
// `?comercio=a&comercio=b` filtraría por `a` en el Excel y por "Todo" en la pantalla: el dueño
// bajaría un archivo que no es lo que está viendo. Esta función es la única puerta, y trata una clave
// repetida como inválida en las dos formas (spec 2026-09-23 §1: "un parámetro repetido cae a su valor
// por defecto").
//
// Solo NORMALIZA la forma: devuelve el texto tal cual llegó. Validarlo (que el período exista, que el
// comercio sea del dueño, que la página sea un entero) es de resolverFiltrosReportes.

export const CLAVES_REPORTES = [
  'periodo',
  'desde',
  'hasta',
  'comercio',
  'sucursal',
  'cajero',
  'orden',
  'dir',
  'pagina',
] as const;

export type ClaveReportes = (typeof CLAVES_REPORTES)[number];

// Cada clave presente UNA sola vez, con su texto crudo. Ausente o repetida = no está.
export type ParametrosReportes = Partial<Record<ClaveReportes, string>>;

// Lo que reciben la página (`await searchParams`) y la ruta (`searchParams` de la request).
export type EntradaParametrosReportes = URLSearchParams | Record<string, string | string[] | undefined>;

export function leerParametrosReportes(entrada: EntradaParametrosReportes): ParametrosReportes {
  const salida: ParametrosReportes = {};
  for (const clave of CLAVES_REPORTES) {
    const valor = unicoValor(entrada, clave);
    if (valor !== undefined) salida[clave] = valor;
  }
  return salida;
}

// El valor de una clave que aparece exactamente una vez. Un arreglo de UN elemento vale como ese
// elemento: es lo que URLSearchParams devolvería para la misma clave escrita una vez, y las dos formas
// tienen que dar lo mismo.
function unicoValor(entrada: EntradaParametrosReportes, clave: string): string | undefined {
  if (entrada instanceof URLSearchParams) {
    const valores = entrada.getAll(clave);
    return valores.length === 1 ? valores[0] : undefined;
  }
  const valor = entrada[clave];
  if (Array.isArray(valor)) return valor.length === 1 ? valor[0] : undefined;
  return valor;
}

import type { FilaTendencia, FilaTopCliente } from './reportes';

// Merges PUROS para la vista conglomerado de /comercio/reportes (plan 2026-07-25 §4.7): los RPC de
// la 0010 son POR comercio; acá se agregan en memoria — cero DDL nuevo, escala de sobra para el
// volumen del piloto. Puros para testearlos sin BD.

// Suma serie a serie por día. Cada serie ya viene con sus días en 0 (la SQL los rellena); días que
// solo existen en una serie igual entran. Orden ascendente por día — con "YYYY-MM-DD" el orden
// lexicográfico ES el cronológico.
export function sumarTendencias(series: FilaTendencia[][]): FilaTendencia[] {
  const porDia = new Map<string, FilaTendencia>();
  for (const serie of series) {
    for (const fila of serie) {
      const acumulado = porDia.get(fila.dia);
      if (acumulado) {
        acumulado.acreditaciones += fila.acreditaciones;
        acumulado.canjes += fila.canjes;
      } else {
        porDia.set(fila.dia, { ...fila }); // copia: no mutar la fila de entrada
      }
    }
  }
  return [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia));
}

export interface ComercioOwner {
  comercioId: string;
  nombre: string;
}

// CONTROL DE SEGURIDAD (tabla §5 del spec): los filtros llegan por querystring — input del cliente.
// El comercio DEBE estar entre las membresías owner de la sesión; la sucursal DEBE pertenecer al
// comercio filtrado. Lo que no valida cae a "Todo"/"todas" — nunca llega un id ajeno a un RPC.
// Puro a propósito: la página no puede testearse, esta función sí (ver MUTATION-TESTING en el
// .test.ts). Una sucursal sin comercio filtrado se ignora: no hay contra qué verificar pertenencia.
// Genérica sobre la sucursal en vez de exigir SucursalListada completa: lo único que esta función
// toca es `id`. Pedir el tipo entero acoplaba una función de filtrado de querystring a la forma de
// la fila de la BD — cada columna nueva en sucursales (el geopush de la 0016, por ejemplo) obligaba
// a rellenar campos irrelevantes en sus pruebas.
export function resolverFiltrosReportes<S extends { id: string }>(
  comerciosOwner: ComercioOwner[],
  sucursalesDelComercio: S[],
  params: { comercio?: string; sucursal?: string },
): { comercio: ComercioOwner | null; sucursal: S | null } {
  const comercio = comerciosOwner.find((c) => c.comercioId === params.comercio) ?? null;
  if (!comercio) return { comercio: null, sucursal: null };
  const sucursal = sucursalesDelComercio.find((s) => s.id === params.sucursal) ?? null;
  return { comercio, sucursal };
}

export type TopClienteConComercio = FilaTopCliente & { comercio_id: string; comercio_nombre: string };

// Fusiona los tops por comercio en un top global: visitas desc, puntos como desempate (el MISMO
// criterio que la SQL de reporte_top_clientes), cortado a `limite`. Cada fila conserva la etiqueta
// del comercio: en la vista "Todo" una misma persona puede aparecer por dos comercios distintos —
// son tarjetas distintas a propósito, no se fusionan.
//
// Va el ID además del nombre porque comercios.nombre NO tiene unique (solo el slug, migración 0001):
// dos comercios del mismo dueño pueden llamarse igual, y una key de React armada con el nombre les
// daría la MISMA key a las dos filas del mismo cliente. El id es lo que las separa.
export function fusionarTopClientes(
  porComercio: { comercioId: string; comercioNombre: string; filas: FilaTopCliente[] }[],
  limite: number,
): TopClienteConComercio[] {
  return porComercio
    .flatMap((c) =>
      c.filas.map((f) => ({ ...f, comercio_id: c.comercioId, comercio_nombre: c.comercioNombre })),
    )
    .sort((a, b) => b.visitas - a.visitas || b.puntos_totales - a.puntos_totales)
    .slice(0, Math.max(0, limite));
}

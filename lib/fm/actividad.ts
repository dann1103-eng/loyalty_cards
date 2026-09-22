// Fusiona los tres orígenes de "actividad reciente" del dashboard de FM (pagos aplicados, cuentas
// nuevas, solicitudes de plan) en una sola lista ordenada. PURA: no toca la base — quien arma las
// tres listas de entrada (5 filas de cada tabla) es `actividadReciente` (dashboard.ts).

export type EventoActividad =
  | { tipo: 'pago'; fecha: string; cuentaNombre: string | null; monto: number; cuentaId: string | null }
  | { tipo: 'cuenta_nueva'; fecha: string; cuentaNombre: string; cuentaId: string }
  | { tipo: 'solicitud'; fecha: string; cuentaNombre: string | null; planSolicitado: string; cuentaId: string };

// Ordena por `fecha` DESCENDENTE (más reciente primero) y recorta a `limite`. Los `created_at` de
// las tres fuentes son timestamps ISO 8601: comparables como texto sin parsear (mismo criterio de
// fechas-como-texto que el resto del proyecto, p. ej. `estadoDeCobranza`).
//
// Un empate de `fecha` conserva el orden de ENTRADA: no hace falta desempate explícito porque
// `Array.prototype.sort` es ESTABLE desde ES2019 (todos los motores modernos, incluido V8/Node, ya
// lo garantizan) — dos elementos que el comparador considera iguales (devuelve 0) NUNCA cambian su
// posición relativa. Si algún día esto corriera en un motor pre-ES2019, dejaría de valer.
export function fusionarActividad(eventos: EventoActividad[], limite: number): EventoActividad[] {
  return [...eventos].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0)).slice(0, limite);
}

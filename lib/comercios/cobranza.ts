import { diasInclusive, hastaDelPeriodo, type PeriodoPagado } from './prorrateo';
import { formatearFecha, sumarDias } from '../tarjetas/vigencia';

// Cobranza por cuenta (spec 2026-09-21-cobranza-design.md, "Estado de cobranza" y "Perdonar el
// ciclo"). PURO: no toca la base, no lee el reloj. Todo lo que necesita "hoy" lo recibe por
// parámetro, igual que prorrateo.ts — mismo criterio de fechas AAAA-MM-DD comparadas como texto.

// Si una cuenta no paga tantos días después de que venció su ciclo (o de `cobranza_desde` si nunca
// pagó), se bloquea.
export const DIAS_GRACIA_COBRANZA = 15;

export type EstadoCobranza =
  | { tipo: 'exenta' }
  | { tipo: 'pospuesta'; hasta: string }
  | { tipo: 'al_dia'; hasta: string; diasRestantes: number }
  | { tipo: 'vencida'; diasVencida: number; diasParaBloqueo: number; esPrimerPago: boolean }
  | { tipo: 'bloqueada'; diasVencida: number };

export interface EntradaEstadoCobranza {
  cobranza: 'normal' | 'exenta';
  desde: string;
  pospuestaHasta: string | null;
  periodosPagados: PeriodoPagado[];
  hoy: string;
}

// El `hasta` MÁS LEJANO de TODOS los períodos pagados, sin filtrar por fecha. A propósito NO
// reusa `estadoDelPeriodo` (prorrateo.ts): esa función filtra `pagados.hasta >= hoy` ANTES de
// calcular nada, así que en el caso central de esta spec (`hoy` ya pasó el `hasta` de todos los
// períodos — exactamente `vencida`/`bloqueada`) devolvería `{ tipo: 'sin_periodo' }` sin
// `cubiertoHasta`, justo cuando más importa. Acá se recorren TODOS los períodos, pasados o no.
function calcularCubiertoHasta(periodosPagados: PeriodoPagado[]): string | null {
  if (periodosPagados.length === 0) return null;
  return periodosPagados.reduce((max, p) => (p.hasta > max ? p.hasta : max), '');
}

// Se evalúa en este orden (tabla de la spec): exenta, pospuesta, al_dia, vencida, bloqueada.
export function estadoDeCobranza(entrada: EntradaEstadoCobranza): EstadoCobranza {
  const { cobranza, desde, pospuestaHasta, periodosPagados, hoy } = entrada;

  if (cobranza === 'exenta') return { tipo: 'exenta' };

  // Inclusivo: el último día de la posposición TODAVÍA no bloquea.
  if (pospuestaHasta !== null && hoy <= pospuestaHasta) {
    return { tipo: 'pospuesta', hasta: pospuestaHasta };
  }

  const cubiertoHasta = calcularCubiertoHasta(periodosPagados);
  const esPrimerPago = cubiertoHasta === null;

  if (!esPrimerPago && hoy <= cubiertoHasta) {
    return { tipo: 'al_dia', hasta: cubiertoHasta, diasRestantes: diasInclusive(hoy, cubiertoHasta) };
  }

  // El vencimiento: el último período pagado si lo hay, o `desde` (cobranza_desde) si nunca pagó.
  const vencimiento = cubiertoHasta ?? desde;
  // `hoy` es el primer día vencido, así que el día siguiente al vencimiento cuenta como día 1.
  const diasVencida = diasInclusive(vencimiento, hoy) - 1;

  if (diasVencida <= DIAS_GRACIA_COBRANZA) {
    return {
      tipo: 'vencida',
      diasVencida,
      diasParaBloqueo: DIAS_GRACIA_COBRANZA - diasVencida,
      esPrimerPago,
    };
  }

  return { tipo: 'bloqueada', diasVencida };
}

// Unificación con `licencia_estado` (spec 2026-09-21-rework-admin-comercio-design.md, "Unificación
// con licencia_estado", línea 206+). `licencia_estado = 'inactivo'` es el interruptor manual de
// corte inmediato: se evalúa ANTES que `estadoDeCobranza` y sin mirar nada de lo que esa función
// mira (fechas, `cobranza`) — ni una cuenta exenta se salva de un corte manual explícito. Si la
// licencia está activa, delega sin cambios.
export function estadoEfectivo(
  entrada: EntradaEstadoCobranza & { licenciaEstado: string },
): EstadoCobranza {
  if (entrada.licenciaEstado === 'inactivo') return { tipo: 'bloqueada', diasVencida: 0 };
  return estadoDeCobranza(entrada);
}

// Texto largo del estado (spec cobranza, "Pantallas → FM": "Al día hasta …", "Vencida hace N días",
// "Bloqueada", "Exenta", "Pospuesta hasta …"). PURA: recibe el `EstadoCobranza` YA CALCULADO, no
// fechas ni acceso a datos. `formatearFecha` (mismo formateador largo que ya usa el banner del
// dueño, app/comercio/(protegido)/layout.tsx) para las fechas, y el mismo truco de pluralización
// ("1 día" / "2 días") que ese banner. Vive acá y no en la pantalla porque la reusan DOS lugares:
// la ficha de cuenta (texto principal de "Estado") y la lista de cuentas (tooltip de la pastilla) —
// ver `pastillaDeCobranza` abajo.
export function describirEstadoCobranza(estado: EstadoCobranza): string {
  const dias = (n: number) => `${n} día${n === 1 ? '' : 's'}`;
  switch (estado.tipo) {
    case 'exenta':
      return 'Exenta';
    case 'pospuesta':
      return `Pospuesta hasta ${formatearFecha(estado.hasta)}`;
    case 'al_dia':
      return `Al día hasta ${formatearFecha(estado.hasta)}`;
    case 'vencida':
      return `Vencida hace ${dias(estado.diasVencida)}`;
    case 'bloqueada':
      return 'Bloqueada';
  }
}

// Clase CSS + etiqueta CORTA para la pastilla de la lista de cuentas (rework del admin, "Lista de
// cuentas"): las 4 clases (.pastilla-activo/.pastilla-inactivo/.pastilla-advertencia/
// .pastilla-neutral) ya viven en app/globals.css desde la Tarea 8. El texto largo de
// `describirEstadoCobranza` va como `title` (tooltip) de esa misma pastilla, no acá — un texto de
// "Vencida hace 12 días" no entra en una pastilla de lista sin romper el layout de la fila.
export interface PastillaCobranza {
  clase: 'pastilla-neutral' | 'pastilla-activo' | 'pastilla-advertencia' | 'pastilla-inactivo';
  texto: string;
}

export function pastillaDeCobranza(estado: EstadoCobranza): PastillaCobranza {
  switch (estado.tipo) {
    case 'exenta':
      return { clase: 'pastilla-neutral', texto: 'Exenta' };
    case 'pospuesta':
      return { clase: 'pastilla-neutral', texto: 'Pospuesta' };
    case 'al_dia':
      return { clase: 'pastilla-activo', texto: 'Al día' };
    case 'vencida':
      return { clase: 'pastilla-advertencia', texto: 'Vencida' };
    case 'bloqueada':
      return { clase: 'pastilla-inactivo', texto: 'Bloqueada' };
  }
}

export interface EntradaPeriodoAPerdonar {
  periodosPagados: PeriodoPagado[];
  cobranzaDesde: string;
  hoy: string;
}

// El ciclo que venció: arranca el día siguiente al último período pagado, o en `cobranzaDesde` si
// la cuenta nunca pagó. Termina con `hastaDelPeriodo` (un mes calendario), igual que un período
// nuevo pagado de verdad.
export function periodoAPerdonar(entrada: EntradaPeriodoAPerdonar): { desde: string; hasta: string } {
  const cubiertoHasta = calcularCubiertoHasta(entrada.periodosPagados);
  const desde = cubiertoHasta !== null ? sumarDias(cubiertoHasta, 1) : entrada.cobranzaDesde;
  return { desde, hasta: hastaDelPeriodo(desde) };
}

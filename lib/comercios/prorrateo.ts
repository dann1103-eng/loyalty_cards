import { sumarDias } from '../tarjetas/vigencia';

// Aritmética de fechas y de dinero del cobro de planes (spec 2026-09-21-pasarela-wompi-design.md,
// "Cuánto se cobra"). PURO: no toca la base, no lee el reloj, no importa nada de servidor. Todo lo
// que necesita "hoy" lo recibe por parámetro (el llamador usa `hoyEnZona`, de tarjetas/vigencia.ts).
//
// Fechas: AAAA-MM-DD, que comparadas como texto ordenan igual que como fechas. Los días son de
// calendario, sin instantes: `new Date('2026-09-30')` cae en el 29 en cualquier huso al oeste de
// UTC, y por eso acá nunca se construye una fecha desde un texto sin pasar por Date.UTC.
//
// Dinero: en CENTAVOS ENTEROS. En punto flotante, 20 × 16 ÷ 30 y los precios negociados con
// centavos se desvían de a uno, y en un cobro un centavo de menos es un pago que no coincide.

// Los últimos N días de un período son la ventana en la que el dueño renueva. Es la MISMA cifra que
// va a usar el aviso de "pago próximo" de la Fase 2.
export const DIAS_VENTANA_RENOVACION = 7;

// La fórmula del prorrateo solo vale para un período de un mes. Un cobro manual de FM por tres
// meses, prorrateado con su cantidad real de días, subcobraría a un tercio.
export const DIAS_MAXIMOS_PERIODO_MENSUAL = 31;

const MS_POR_DIA = 86_400_000;

function partes(fecha: string): [number, number, number] {
  const [anio, mes, dia] = fecha.slice(0, 10).split('-').map(Number);
  return [anio, mes, dia];
}

function formatear(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

// Días de calendario entre dos fechas, LAS DOS INCLUIDAS: del 15 al 30 de septiembre son 16.
export function diasInclusive(desde: string, hasta: string): number {
  const [a1, m1, d1] = partes(desde);
  const [a2, m2, d2] = partes(hasta);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / MS_POR_DIA) + 1;
}

function ultimoDiaDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate(); // `mes` es 1-12: el día 0 del siguiente
}

// El fin de un período que empieza en `desde`: el MISMO DÍA del mes siguiente (con tope al último
// día de ese mes) MENOS UN DÍA. El 15 de septiembre termina el 14 de octubre; el 31 de enero termina
// el 27 de febrero (28 en año bisiesto). Un período que arranca el 29, 30 o 31 "deriva" hacia el 28
// en los siguientes; es lo esperado, no un error.
export function hastaDelPeriodo(desde: string): string {
  const [anio, mes, dia] = partes(desde);
  const anioSig = mes === 12 ? anio + 1 : anio;
  const mesSig = mes === 12 ? 1 : mes + 1;
  const diaSig = Math.min(dia, ultimoDiaDelMes(anioSig, mesSig));
  return sumarDias(formatear(anioSig, mesSig, diaSig), -1);
}

export function aCentavos(precio: number): number {
  return Math.round(precio * 100);
}

export function deCentavos(centavos: number): number {
  return centavos / 100;
}

export type MotivoSinAjuste = 'sin_diferencia' | 'fuera_de_periodo' | 'muy_chico' | 'no_mensual';

export type ResultadoAjuste =
  | { ok: true; monto: number; centavos: number; diasRestantes: number; diasPeriodo: number }
  | { ok: false; motivo: MotivoSinAjuste };

export interface EntradaAjuste {
  precioActual: number;
  precioNuevo: number;
  periodoDesde: string;
  periodoHasta: string;
  hoy: string;
}

// La diferencia de precio, prorrateada por los días que le quedan al período. HOY CUENTA como día
// restante (el plan nuevo rige desde hoy). Redondea al centavo, hacia arriba en la mitad exacta,
// con enteros: `floor((2n + d) / 2d)` es el redondeo a la mitad hacia arriba de n / d.
export function calcularAjuste(entrada: EntradaAjuste): ResultadoAjuste {
  const diasPeriodo = diasInclusive(entrada.periodoDesde, entrada.periodoHasta);
  if (diasPeriodo > DIAS_MAXIMOS_PERIODO_MENSUAL) return { ok: false, motivo: 'no_mensual' };
  if (entrada.hoy < entrada.periodoDesde || entrada.hoy > entrada.periodoHasta) {
    return { ok: false, motivo: 'fuera_de_periodo' };
  }

  const diferencia = aCentavos(entrada.precioNuevo) - aCentavos(entrada.precioActual);
  if (diferencia <= 0) return { ok: false, motivo: 'sin_diferencia' };

  const diasRestantes = diasInclusive(entrada.hoy, entrada.periodoHasta);
  const numerador = diferencia * diasRestantes;
  const centavos = Math.floor((2 * numerador + diasPeriodo) / (2 * diasPeriodo));
  if (centavos < 1) return { ok: false, motivo: 'muy_chico' };

  return { ok: true, monto: deCentavos(centavos), centavos, diasRestantes, diasPeriodo };
}

export interface PeriodoPagado {
  desde: string;
  hasta: string;
}

// En qué momento de su ciclo está la cuenta. Sale de los períodos PAGADOS (cobros tipo 'periodo'):
// un ajuste no abre período, así que no entra acá.
//
// `cubiertoHasta` es el `hasta` MÁS LEJANO de todos los pagados, no el del período que contiene hoy:
// si el dueño ya renovó el siguiente, lo cubierto llega más allá del actual, y calcular la ventana o
// el próximo período desde el actual le dejaría renovar dos veces las mismas fechas.
export type EstadoPeriodo =
  | { tipo: 'sin_periodo' }
  | { tipo: 'futuro'; desde: string }
  | {
      tipo: 'en_curso';
      desde: string;
      hasta: string;
      cubiertoHasta: string;
      diasRestantes: number;
      diasPeriodo: number;
      // mitad: se puede SUBIR con prorrateo. ventana: se puede RENOVAR. ya_renovado y no_mensual: no
      // se ofrece nada por cuenta propia.
      fase: 'mitad' | 'ventana' | 'ya_renovado' | 'no_mensual';
    };

export function estadoDelPeriodo(pagados: PeriodoPagado[], hoy: string): EstadoPeriodo {
  const vigentes = pagados.filter((p) => p.hasta >= hoy);
  if (vigentes.length === 0) return { tipo: 'sin_periodo' };

  const conHoy = vigentes.filter((p) => p.desde <= hoy);
  if (conHoy.length === 0) {
    const proximo = vigentes.reduce((a, b) => (a.desde <= b.desde ? a : b));
    return { tipo: 'futuro', desde: proximo.desde };
  }

  const actual = conHoy.reduce((a, b) => (a.hasta >= b.hasta ? a : b));
  const cubiertoHasta = pagados.reduce((max, p) => (p.hasta > max ? p.hasta : max), actual.hasta);
  const diasRestantes = diasInclusive(hoy, actual.hasta);
  const diasPeriodo = diasInclusive(actual.desde, actual.hasta);

  let fase: 'mitad' | 'ventana' | 'ya_renovado' | 'no_mensual';
  if (cubiertoHasta > actual.hasta) fase = 'ya_renovado';
  else if (diasRestantes <= DIAS_VENTANA_RENOVACION) fase = 'ventana';
  else if (diasPeriodo > DIAS_MAXIMOS_PERIODO_MENSUAL) fase = 'no_mensual';
  else fase = 'mitad';

  return { tipo: 'en_curso', desde: actual.desde, hasta: actual.hasta, cubiertoHasta, diasRestantes, diasPeriodo, fase };
}

// El período que abre un pago completo. Arranca el día siguiente a lo ya cubierto, o hoy si no hay
// nada cubierto (o ya venció): nunca en el pasado, y nunca encima de fechas ya pagadas.
export function periodoNuevo(cubiertoHasta: string | null, hoy: string): { desde: string; hasta: string } {
  const desde = cubiertoHasta !== null && cubiertoHasta >= hoy ? sumarDias(cubiertoHasta, 1) : hoy;
  return { desde, hasta: hastaDelPeriodo(desde) };
}

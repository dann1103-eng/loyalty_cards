import { sumarDias } from '../tarjetas/vigencia';
import { PLANES } from './cuentas';
import { escalonDePlan, limiteResultante, type PlanCatalogo } from './limitePlan';
import {
  aCentavos,
  calcularAjuste,
  deCentavos,
  estadoDelPeriodo,
  periodoNuevo,
  type EstadoPeriodo,
  type PeriodoPagado,
} from './prorrateo';

// Qué puede pagar el dueño y cuánto (spec 2026-09-21-pasarela-wompi-design.md, "Cuánto se cobra").
//
// PURO, y es la ÚNICA fuente de verdad de dos consumidores: la pantalla /comercio/plan, que dibuja
// estas opciones, y la acción de servidor que inicia el pago, que NO acepta montos del navegador: valida
// que lo pedido esté entre estas opciones y toma el importe de acá. Si los dos calcularan por su
// cuenta, la pantalla podría prometer un precio que el servidor después no cobra.
//
// Las situaciones NO se pisan a propósito:
//   - a mitad de período solo se ofrece SUBIR, con prorrateo;
//   - en la ventana (últimos 7 días) solo se ofrece RENOVAR, con cualquier plan y al precio completo;
//   - sin período, elegir un plan al precio completo.
// Si se ofrecieran las dos cosas a la vez, el último día del período un ajuste de $0.67 dejaría el plan
// alto para siempre, y "renovar y después subir con prorrateo" daría el plan más caro a mitad de precio.

export interface CuentaParaPagos {
  plan: string | null;
  // `licencia_monto_mensual`: el precio REAL de la cuenta, que FM puede haber negociado.
  precioActual: number | null;
  // `limite_negocios`: null = sin tope.
  limite: number | null;
  unidadesUsadas: number;
  periodosPagados: PeriodoPagado[];
}

export type AccionPago = 'activar' | 'cambiar' | 'renovar';

export interface OpcionPago {
  accion: AccionPago;
  plan: string;
  etiquetaPlan: string;
  tipo: 'periodo' | 'ajuste';
  monto: number;
  periodoDesde: string;
  periodoHasta: string;
  // La cuenta hecha de un ajuste ("Starter → Growth, 16 de 30 días"). null en un período completo.
  nota: string | null;
  // Cambiar de plan cobra el precio del catálogo: una cuenta con precio negociado lo pierde. La pantalla lo avisa.
  reiniciaPrecio: boolean;
  bloqueadaPor: string | null;
}

export interface OpcionesDePago {
  estado: EstadoPeriodo;
  opciones: OpcionPago[];
  // Por qué no hay nada que ofrecer, cuando es un caso que el dueño tiene que entender.
  aviso: string | null;
  // La fecha siguiente a lo cubierto. null si no hay nada cubierto.
  proximoPago: string | null;
}

const ESCRIBINOS = 'escribinos';

function catalogoDe(plan: string | null): PlanCatalogo | null {
  return PLANES.find((p) => p.valor === plan) ?? null;
}

// Renovar el MISMO plan no cambia nada en la cuenta (`aplicarPlanDestino` sale sin tocar el límite), así
// que no puede bloquearse por cupo: comparar contra el límite SUGERIDO del plan le prohibiría pagar su
// propio plan a una cuenta con un límite negociado mayor, o a una Pro heredada "sin tope".
function bloqueoPorCupo(cuenta: CuentaParaPagos, destino: PlanCatalogo): string | null {
  if (destino.valor === cuenta.plan) return null;
  const limite = limiteResultante(cuenta, destino);
  if (limite === null || cuenta.unidadesUsadas <= limite) return null;
  const unidades = cuenta.unidadesUsadas === 1 ? 'unidad' : 'unidades';
  return `Tu cuenta usa ${cuenta.unidadesUsadas} ${unidades} y el plan ${destino.etiqueta} permite ${limite}. Desactivá negocios o sucursales antes de elegirlo.`;
}

// Renovar el MISMO plan respeta el precio negociado (si es mayor que cero); cambiar de plan cobra el del catálogo.
// El importe se lleva a CENTAVOS: `licencia_monto_mensual` es un numeric sin escala y admite 12.345, que
// Wompi redondearía por su lado y la conciliación vería como "monto distinto" en un cobro legítimo.
function precioDePeriodo(cuenta: CuentaParaPagos, destino: PlanCatalogo): number {
  const mismoPlan = destino.valor === cuenta.plan;
  const precio =
    mismoPlan && cuenta.precioActual !== null && cuenta.precioActual > 0 ? cuenta.precioActual : destino.montoMensual;
  return deCentavos(aCentavos(precio));
}

export function calcularOpcionesPago(cuenta: CuentaParaPagos, hoy: string): OpcionesDePago {
  const estado = estadoDelPeriodo(cuenta.periodosPagados, hoy);
  const actual = catalogoDe(cuenta.plan);
  const negociado =
    actual !== null &&
    cuenta.precioActual !== null &&
    aCentavos(cuenta.precioActual) !== aCentavos(actual.montoMensual);

  const vacio = { estado, opciones: [] as OpcionPago[], aviso: null as string | null, proximoPago: null as string | null };

  const opcionDePeriodo = (
    accion: 'activar' | 'renovar',
    destino: PlanCatalogo,
    cubiertoHasta: string | null,
  ): OpcionPago => {
    const { desde, hasta } = periodoNuevo(cubiertoHasta, hoy);
    return {
      accion,
      plan: destino.valor,
      etiquetaPlan: destino.etiqueta,
      tipo: 'periodo',
      monto: precioDePeriodo(cuenta, destino),
      periodoDesde: desde,
      periodoHasta: hasta,
      nota: null,
      reiniciaPrecio: negociado && destino.valor !== cuenta.plan,
      bloqueadaPor: bloqueoPorCupo(cuenta, destino),
    };
  };

  if (estado.tipo === 'sin_periodo') {
    return { ...vacio, opciones: PLANES.map((p) => opcionDePeriodo('activar', p, null)) };
  }

  if (estado.tipo === 'futuro') {
    return { ...vacio, aviso: 'Tu próximo período ya está pagado.', proximoPago: estado.desde };
  }

  const proximoPago = sumarDias(estado.cubiertoHasta, 1);

  if (estado.fase === 'ya_renovado') {
    return {
      ...vacio,
      proximoPago,
      aviso: `Ya pagaste el próximo período. Si querés cambiar de plan, ${ESCRIBINOS}.`,
    };
  }

  if (estado.fase === 'no_mensual') {
    return {
      ...vacio,
      proximoPago,
      aviso: `Tu período actual no es mensual. Si querés cambiar de plan, ${ESCRIBINOS}.`,
    };
  }

  if (estado.fase === 'ventana') {
    return {
      ...vacio,
      proximoPago,
      opciones: PLANES.map((p) => opcionDePeriodo('renovar', p, estado.cubiertoHasta)),
    };
  }

  // A mitad de período: solo subir, con prorrateo, contra el precio REAL de la cuenta.
  const precioBase = cuenta.precioActual ?? actual?.montoMensual ?? null;
  if (actual === null || precioBase === null) {
    return {
      ...vacio,
      proximoPago,
      aviso: 'No podemos calcular el cambio de tu plan desde acá. Escribinos.',
    };
  }

  const opciones: OpcionPago[] = [];
  for (const destino of PLANES) {
    if (escalonDePlan(destino.valor) <= escalonDePlan(cuenta.plan)) continue;
    const ajuste = calcularAjuste({
      precioActual: precioBase,
      precioNuevo: destino.montoMensual,
      periodoDesde: estado.desde,
      periodoHasta: estado.hasta,
      hoy,
    });
    if (!ajuste.ok) continue;
    opciones.push({
      accion: 'cambiar',
      plan: destino.valor,
      etiquetaPlan: destino.etiqueta,
      tipo: 'ajuste',
      monto: ajuste.monto,
      periodoDesde: hoy,
      periodoHasta: estado.hasta,
      nota: `${actual.etiqueta} → ${destino.etiqueta}, ${ajuste.diasRestantes} de ${ajuste.diasPeriodo} días`,
      reiniciaPrecio: negociado,
      bloqueadaPor: bloqueoPorCupo(cuenta, destino),
    });
  }
  return { ...vacio, proximoPago, opciones };
}

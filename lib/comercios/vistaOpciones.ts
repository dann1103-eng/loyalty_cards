import { formatearFecha } from '../tarjetas/vigencia';
import { PLANES } from './cuentas';
import type { AccionPago, OpcionesDePago } from './opcionesPago';

// El TEXTO de /comercio/plan para pagar: títulos, importes y la explicación de cada opción. Puro y
// probado a parte porque es lo que el dueño lee para decidir cuánto paga, y un texto que promete un
// precio distinto del que cobra el servidor es peor que un error. El componente que lo dibuja
// (OpcionesDePago.tsx) no decide nada.

export interface VistaOpcion {
  // Identifica la opción en la lista (plan + acción).
  clave: string;
  accion: AccionPago;
  plan: string;
  titulo: string;
  // Lo que se paga HOY, ya formateado ("$10.67").
  importe: string;
  detalle: string;
  bloqueadaPor: string | null;
}

export interface VistaPagos {
  titulo: string;
  explicacion: string;
  opciones: VistaOpcion[];
  // Una línea suelta ("Tu próximo pago es el 1 de octubre de 2026"), o null.
  proximoPago: string | null;
  // Por qué no hay opciones, cuando el dueño tiene que entenderlo.
  aviso: string | null;
}

export function dinero(monto: number): string {
  return Number.isInteger(monto) ? `$${monto}` : `$${monto.toFixed(2)}`;
}

function mensualDe(plan: string): number | null {
  return PLANES.find((p) => p.valor === plan)?.montoMensual ?? null;
}

export function describirOpciones(calculo: OpcionesDePago, planActual: string | null): VistaPagos {
  const { estado } = calculo;

  let titulo: string;
  let explicacion: string;
  if (estado.tipo === 'en_curso' && estado.fase === 'mitad') {
    titulo = '¿Necesitás más lugar?';
    explicacion =
      'Pagás solo la diferencia por los días que le quedan a tu período. El plan cambia apenas se confirma el pago.';
  } else if (estado.tipo === 'en_curso' && estado.fase === 'ventana') {
    titulo = 'Renová tu plan';
    explicacion = `Tu período termina el ${formatearFecha(estado.hasta)}. Renovando pagás el mes completo del plan que elijas, y podés cambiar de plan al hacerlo.`;
  } else if (estado.tipo === 'sin_periodo') {
    titulo = planActual === null ? 'Elegí tu plan' : 'Renová tu plan';
    explicacion = 'Pagás con tarjeta y tu plan se activa apenas se confirma el pago.';
  } else {
    titulo = 'Tu plan';
    explicacion = '';
  }

  const opciones = calculo.opciones.map((o): VistaOpcion => {
    let tituloOpcion: string;
    let detalle: string;

    if (o.accion === 'cambiar') {
      const mensual = mensualDe(o.plan);
      tituloOpcion = `Pasar a ${o.etiquetaPlan}`;
      detalle =
        `Diferencia por los días que faltan (${o.nota}).` +
        (calculo.proximoPago && mensual !== null
          ? ` Desde el ${formatearFecha(calculo.proximoPago)}, ${dinero(mensual)}/mes.`
          : '');
    } else if (o.accion === 'renovar') {
      tituloOpcion = `Renovar con ${o.etiquetaPlan}`;
      detalle = `Del ${formatearFecha(o.periodoDesde)} al ${formatearFecha(o.periodoHasta)}.`;
    } else {
      tituloOpcion = `Elegir ${o.etiquetaPlan}`;
      detalle = `Un mes, del ${formatearFecha(o.periodoDesde)} al ${formatearFecha(o.periodoHasta)}.`;
    }
    if (o.reiniciaPrecio) detalle += ' Tu precio pactado pasa al del plan.';

    return {
      clave: `${o.accion}:${o.plan}`,
      accion: o.accion,
      plan: o.plan,
      titulo: tituloOpcion,
      importe: dinero(o.monto),
      detalle,
      bloqueadaPor: o.bloqueadaPor,
    };
  });

  return {
    titulo,
    explicacion,
    opciones,
    proximoPago: calculo.proximoPago ? `Tu próximo pago es el ${formatearFecha(calculo.proximoPago)}.` : null,
    aviso: calculo.aviso,
  };
}

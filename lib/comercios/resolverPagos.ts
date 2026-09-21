import {
  confirmarPagoCobro,
  type CobroParaPago,
  type Conciliacion,
  type EntradaPago,
  type RepositorioPagos,
} from './confirmarPago';
import { accionesDisponibles, entradaParaReintentar, etiquetaConciliacion, type PagoAdmin } from './pagosAdmin';

// Lo que FM puede hacer con un pago desde /admin/pagos. Todo pasa por `confirmarPagoCobro` (la única
// puerta que aplica un plan y marca un cobro pagado), con el repositorio inyectado: así se prueba con el
// falso, y la acción de servidor queda en autenticar, leer y delegar.
//
// Cada operación REVALIDA en el servidor que la acción corresponde al estado del evento
// (`accionesDisponibles`): el botón de la pantalla puede estar viejo, y un formulario se puede armar a mano.

export type ResultadoResolucion =
  | { ok: true; conciliacion: Conciliacion; mensaje: string }
  | { ok: false; error: string };

export interface DependenciasResolver {
  repo: RepositorioPagos;
  hoy: string;
  aceptarPruebas: boolean;
  // Se llama UNA vez si esta operación reclamó un cobro de período (ver `confirmarPagoCobro`).
  alReclamar?: (cobro: CobroParaPago) => void;
  // Deja un evento como revisado con una nota (lo usa el reproceso de un evento sin identificador).
  marcarRevisado: (eventoId: string, detalle: string) => Promise<void>;
}

function mensajeDe(conciliacion: Conciliacion, detalle: string | null): string {
  if (conciliacion === 'aplicado') return 'Listo: el pago quedó aplicado.';
  return `Quedó como «${etiquetaConciliacion(conciliacion)}»${detalle ? `: ${detalle}` : '.'}`;
}

async function confirmar(deps: DependenciasResolver, entrada: EntradaPago): Promise<ResultadoResolucion> {
  try {
    const r = await confirmarPagoCobro(deps.repo, entrada, {
      aceptarPruebas: deps.aceptarPruebas,
      hoy: deps.hoy,
      alReclamar: deps.alReclamar,
    });
    return { ok: true, conciliacion: r.conciliacion, mensaje: mensajeDe(r.conciliacion, r.detalle) };
  } catch (error) {
    // `confirmarPagoCobro` ya dejó el evento en `error`; acá solo se le dice a FM que no salió.
    return { ok: false, error: `No se pudo procesar: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// Vuelve a procesar un evento que quedó en `error`. Es seguro repetirlo: el servicio se aplica primero y
// es idempotente, y el cobro solo lo reclama una llamada.
//
// Se re-lee el CUERPO guardado (ver `entradaParaReintentar`). Si el cuerpo trae un id de transacción
// distinto del del evento (el caso de un webhook que llegó irreconocible con id `sin-id-…` y que un parser
// arreglado ahora entiende), el reproceso nace como un evento NUEVO, y el viejo se deja revisado con una
// nota: si no, quedaría para siempre en "necesita atención".
export async function reintentarPago(deps: DependenciasResolver, evento: PagoAdmin): Promise<ResultadoResolucion> {
  if (!accionesDisponibles(evento).includes('reintentar')) {
    return { ok: false, error: 'Este pago no se puede reintentar: solo se reintentan los que quedaron en error.' };
  }
  const entrada = entradaParaReintentar(evento);
  if ('error' in entrada) return { ok: false, error: entrada.error };

  const resultado = await confirmar(deps, entrada);
  if (resultado.ok && entrada.idTransaccion !== evento.idTransaccion) {
    try {
      await deps.marcarRevisado(evento.id, `Reprocesado como la transacción ${entrada.idTransaccion}.`);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return resultado;
}

// FM acepta un pago que el sistema no aplicó solo: el monto no coincidía, o el cobro estaba anulado.
// `forzar` saltea justo esas dos comprobaciones (y deja reclamar un cobro anulado); todo lo demás
// (firma, prueba vs real, aprobado) sigue valiendo.
export async function aplicarPagoAMano(deps: DependenciasResolver, evento: PagoAdmin): Promise<ResultadoResolucion> {
  if (!accionesDisponibles(evento).includes('aplicar')) {
    return { ok: false, error: 'Este pago no se puede aplicar a mano: solo los de monto distinto o cobro anulado.' };
  }
  const entrada = entradaParaReintentar(evento);
  if ('error' in entrada) return { ok: false, error: entrada.error };
  return confirmar(deps, { ...entrada, forzar: true });
}

// FM marca pagado un cobro de la app que cobró por fuera de Wompi (o cuyo webhook no llegó). Deja un
// evento sintético `manual-<cobroId>`: el mismo cobro no se puede marcar dos veces, y queda rastro en el
// panel de pagos. Si Wompi después informa la transacción real, cae como «Doble pago» y FM lo ve.
export async function marcarCobroPagadoAMano(deps: DependenciasResolver, cobro: CobroParaPago): Promise<ResultadoResolucion> {
  if (cobro.estado !== 'pendiente') {
    return { ok: false, error: 'Solo se puede marcar como pagado un cobro pendiente.' };
  }
  return confirmar(deps, {
    fuente: 'manual',
    idTransaccion: `manual-${cobro.id}`,
    monto: cobro.monto,
    esReal: true,
    aprobada: true,
    identificadorEnlace: cobro.id,
    fecha: null,
    payload: { manual: true, cobroId: cobro.id },
  });
}

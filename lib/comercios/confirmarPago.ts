import { aCentavos } from './prorrateo';

// Aplicar un pago de Wompi a un cobro (spec 2026-09-21-pasarela-wompi-design.md, "Conciliación" y
// "Aplicar el pago"). Lo llaman TRES caminos y los tres pasan por acá:
//   - el webhook de Wompi (camino principal),
//   - la página de vuelta del dueño (respaldo, tras confirmar con la API),
//   - FM, a mano, desde /admin/pagos.
//
// La lógica no toca la base: recibe un REPOSITORIO con las operaciones. Así se prueba entera, con
// mutaciones, sin Supabase; `repositorioPagosSupabase.ts` es el adaptador real.
//
// ══ EL ORDEN IMPORTA ══ Primero se da el SERVICIO (plan y licencia, idempotentes) y DESPUÉS se registra
// el pago (se reclama el cobro). Si algo falla en el medio, lo peor que puede pasar es "plan aplicado y
// cobro todavía pendiente", que el reintento completa sin daño. El orden inverso deja "cobro pagado y
// plan sin aplicar": plata tomada sin servicio, que el reintento tendría que adivinar.
//
// ══ IDEMPOTENCIA ══ Wompi reintenta y el redirect también puede llegar dos veces. Una transacción se
// procesa UNA vez de efecto: el reclamo del cobro es una sola sentencia condicional (`where estado =
// 'pendiente'`), y la transacción que pagó queda anotada en el cobro (`wompiIdTransaccion`) para
// distinguir el REINTENTO de la misma transacción (se reaplica sin miedo y sin avisar dos veces a Meta)
// de un DOBLE PAGO con otra transacción (`ya_pagado`).

export const CONCILIACIONES = [
  'pendiente',
  'aplicado',
  'prueba',
  'sin_cobro',
  'cobro_anulado',
  'monto_distinto',
  'ya_pagado',
  'plan_no_aplicable',
  'no_aprobada',
  'error',
] as const;
export type Conciliacion = (typeof CONCILIACIONES)[number];

// Un evento ya resuelto no se vuelve a procesar. `pendiente` y `error` SÍ: son los que un reintento
// tiene que completar.
const REPROCESABLES: ReadonlySet<Conciliacion> = new Set(['pendiente', 'error']);

// Los que dejan algo para que FM decida, y se quedan en "necesita atención" hasta que lo marque revisado.
export const NECESITAN_ATENCION: ReadonlySet<Conciliacion> = new Set([
  'cobro_anulado',
  'monto_distinto',
  'ya_pagado',
  'plan_no_aplicable',
  'error',
]);

export type FuentePago = 'webhook' | 'redirect' | 'manual';

export interface CobroParaPago {
  id: string;
  cuentaId: string;
  tipo: 'periodo' | 'ajuste';
  estado: string;
  monto: number;
  planDestino: string | null;
  wompiIdTransaccion: string | null;
}

export interface EventoPago {
  id: string;
  conciliacion: Conciliacion;
}

export interface NuevoEvento {
  idTransaccion: string;
  fuente: FuentePago;
  identificadorEnlace: string | null;
  monto: number;
  esReal: boolean;
  fecha: string | null;
  payload: unknown;
  // Para guardar de entrada un evento que ya se sabe que no se puede procesar (cuerpo irreconocible).
  conciliacion?: Conciliacion;
  detalle?: string | null;
}

export type ResultadoAplicarPlan =
  | { ok: true; cambio: boolean }
  | { ok: false; motivo: 'cupo' | 'error'; error: string };

export interface RepositorioPagos {
  obtenerCobro(id: string): Promise<CobroParaPago | null>;
  // Idempotente por `idTransaccion`: si ya existía, devuelve el evento que había, con su conciliación.
  registrarEvento(evento: NuevoEvento): Promise<EventoPago>;
  // Un campo ausente (`undefined`) no se toca.
  actualizarEvento(
    id: string,
    cambios: { conciliacion: Conciliacion; detalle?: string | null; cobroId?: string | null; cuentaId?: string | null },
  ): Promise<void>;
  aplicarPlan(cuentaId: string, planDestino: string, tipo: 'periodo' | 'ajuste'): Promise<ResultadoAplicarPlan>;
  activarLicencia(cuentaId: string, hoy: string): Promise<void>;
  // ATÓMICO: pasa el cobro a pagado solo si su estado está entre los permitidos. Devuelve el cobro tal
  // como quedó (o tal como está, si no lo reclamó).
  reclamarCobro(
    cobroId: string,
    datos: { hoy: string; idTransaccion: string; estadosPermitidos: string[] },
  ): Promise<{ reclamado: boolean; cobro: CobroParaPago | null }>;
}

export interface EntradaPago {
  fuente: FuentePago;
  idTransaccion: string;
  monto: number;
  esReal: boolean;
  aprobada: boolean;
  identificadorEnlace: string | null;
  fecha: string | null;
  payload: unknown;
  // Solo FM a mano: acepta un pago con monto distinto y revive un cobro anulado.
  forzar?: boolean;
}

export interface OpcionesConfirmacion {
  aceptarPruebas: boolean;
  hoy: string;
  // Se llama UNA vez, cuando ESTA llamada fue la que reclamó un cobro de tipo 'periodo': ahí va el
  // aviso a Meta. Un reintento o un ajuste no lo dispara.
  alReclamar?: (cobro: CobroParaPago) => void;
}

export interface ResultadoConfirmacion {
  conciliacion: Conciliacion;
  // `true` si el evento ya estaba resuelto y se devolvió lo guardado sin volver a procesar.
  repetido: boolean;
  detalle: string | null;
}

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function confirmarPagoCobro(
  repo: RepositorioPagos,
  entrada: EntradaPago,
  opciones: OpcionesConfirmacion,
): Promise<ResultadoConfirmacion> {
  const evento = await repo.registrarEvento({
    idTransaccion: entrada.idTransaccion,
    fuente: entrada.fuente,
    identificadorEnlace: entrada.identificadorEnlace,
    monto: entrada.monto,
    esReal: entrada.esReal,
    fecha: entrada.fecha,
    payload: entrada.payload,
  });

  if (!entrada.forzar && !REPROCESABLES.has(evento.conciliacion)) {
    return { conciliacion: evento.conciliacion, repetido: true, detalle: null };
  }

  try {
    return await procesar(repo, evento, entrada, opciones);
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    // Si esto también falla no se puede hacer más: el error original es el que importa.
    await repo
      .actualizarEvento(evento.id, { conciliacion: 'error', detalle: mensaje.slice(0, 300) })
      .catch(() => undefined);
    throw error;
  }
}

async function procesar(
  repo: RepositorioPagos,
  evento: EventoPago,
  entrada: EntradaPago,
  opciones: OpcionesConfirmacion,
): Promise<ResultadoConfirmacion> {
  const terminar = async (
    conciliacion: Conciliacion,
    detalle: string | null,
    cobro?: CobroParaPago | null,
  ): Promise<ResultadoConfirmacion> => {
    await repo.actualizarEvento(evento.id, {
      conciliacion,
      detalle,
      cobroId: cobro?.id,
      cuentaId: cobro?.cuentaId,
    });
    return { conciliacion, repetido: false, detalle };
  };

  if (!entrada.aprobada) {
    return terminar('no_aprobada', 'Wompi informó un resultado distinto de aprobado.');
  }
  if (!entrada.esReal && !opciones.aceptarPruebas) {
    return terminar('prueba', 'Pago de prueba: no aplica nada.');
  }

  // El UUID se valida ANTES de consultar la base: un identificador de un enlace hecho a mano en el
  // panel de Wompi no es un UUID, y consultarlo daría un error de sintaxis de Postgres (que se
  // trataría como falla interna y Wompi reintentaría para siempre).
  const cobro =
    entrada.identificadorEnlace !== null && ES_UUID.test(entrada.identificadorEnlace)
      ? await repo.obtenerCobro(entrada.identificadorEnlace)
      : null;
  if (cobro === null) {
    return terminar('sin_cobro', 'El identificador no corresponde a un cobro de la app.');
  }

  if (cobro.estado === 'anulado' && !entrada.forzar) {
    return terminar('cobro_anulado', 'El cobro estaba anulado cuando llegó el pago.', cobro);
  }
  if (aCentavos(cobro.monto) !== aCentavos(entrada.monto) && !entrada.forzar) {
    return terminar(
      'monto_distinto',
      `Wompi cobró ${entrada.monto} y el cobro era de ${cobro.monto}.`,
      cobro,
    );
  }

  // 1) EL SERVICIO. Idempotente: aplicar dos veces el mismo plan no cambia nada.
  let avisoPlan: string | null = null;
  if (cobro.planDestino !== null) {
    const plan = await repo.aplicarPlan(cobro.cuentaId, cobro.planDestino, cobro.tipo);
    if (!plan.ok) {
      // Cupo: el dueño agregó negocios entre el cobro y el pago. La plata entró, así que se sigue y se
      // deja constancia para que FM lo resuelva. Cualquier otra falla es interna: se lanza.
      if (plan.motivo === 'cupo') avisoPlan = plan.error;
      else throw new Error(plan.error);
    }
  }
  await repo.activarLicencia(cobro.cuentaId, opciones.hoy);

  // 2) EL PAGO.
  const reclamo = await repo.reclamarCobro(cobro.id, {
    hoy: opciones.hoy,
    idTransaccion: entrada.idTransaccion,
    estadosPermitidos: entrada.forzar ? ['pendiente', 'anulado'] : ['pendiente'],
  });

  if (!reclamo.reclamado) {
    // ¿Lo pagó ESTA misma transacción en un intento anterior que se cayó a medias? Entonces es un
    // reintento propio y se completa. ¿Lo pagó otra? Es un doble pago.
    if (reclamo.cobro?.wompiIdTransaccion !== entrada.idTransaccion) {
      return terminar('ya_pagado', 'El cobro ya lo había pagado otra transacción.', cobro);
    }
  } else if (cobro.tipo === 'periodo') {
    opciones.alReclamar?.(cobro);
  }

  return avisoPlan !== null
    ? terminar('plan_no_aplicable', avisoPlan, cobro)
    : terminar('aplicado', null, cobro);
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { PLANES, cupoDeCuenta } from './cuentas';
import type { ResultadoAplicarPlan } from './confirmarPago';
import { escalonDePlan, limiteResultante } from './limitePlan';

// Autogestión de plan (migración 0017). El dueño ve y SOLICITA; FM aprueba.
//
// BAJAR de plan a mitad de período sigue siendo una solicitud que FM resuelve: ahí FM tiene un interés
// legítimo en la conversación (entender por qué se va, ofrecerle algo). SUBIR y RENOVAR pasan por el
// pago (migración 0037): el plan se aplica cuando Wompi confirma el cobro, con `aplicarPlanDestino`
// (abajo), que llama `confirmarPagoCobro` (confirmarPago.ts). Ya no existe un camino que suba el plan
// SIN INTERVENCIÓN DE FM y sin cobrar: hasta el 2026-09-21 lo hacía `subirPlanPorElDueno`, y se borró.
// Lo que sigue existiendo es la solicitud de cambio (`FormularioSolicitud`): el dueño la pide y FM la
// aprueba con `resolverSolicitud`, y ese camino aplica el plan sin pasar por el pago.

export const ESTADOS_SOLICITUD = ['pendiente', 'aprobada', 'rechazada'] as const;

// `cuentas_comercio.plan` es NULL a propósito en las cuentas que vienen del piloto: la migración
// 0011 no las mapeó a starter/growth/pro para no inventar un dato que no existía. O sea que "sin
// plan asignado" NO es un caso borde — es el estado de todas las cuentas actuales, y la pantalla
// tiene que tratarlo como el caso normal.
//
// `solicitudes_plan.plan_actual` es NOT NULL, así que hace falta un valor para guardarlo.
export const SIN_PLAN = 'sin_plan';
export const ETIQUETA_SIN_PLAN = 'Sin plan asignado';

export interface ResumenPlan {
  // `null` = la cuenta todavía no tiene plan asignado (ver SIN_PLAN).
  plan: string | null;
  etiquetaPlan: string;
  montoMensual: number | null;
  licenciaEstado: string;
  licenciaActivaDesde: string | null;
  // `null` = sin tope (Pro).
  limite: number | null;
  usadas: number;
  solicitudPendiente: SolicitudPlan | null;
}

export interface SolicitudPlan {
  id: string;
  cuentaId: string;
  cuentaNombre?: string;
  planActual: string;
  planSolicitado: string;
  motivo: string | null;
  estado: string;
  comentarioFm: string | null;
  resueltaEn: string | null;
  creadaEn: string;
}

export type ResultadoSolicitud = { ok: true } | { ok: false; error: string };

export function etiquetaDePlan(plan: string | null): string {
  if (plan === null || plan === SIN_PLAN) return ETIQUETA_SIN_PLAN;
  return PLANES.find((p) => p.valor === plan)?.etiqueta ?? plan;
}

export async function resumenPlan(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
): Promise<ResumenPlan | null> {
  const { data: cuenta, error } = await supabase
    .from('cuentas_comercio')
    .select('plan, licencia_estado, licencia_monto_mensual, licencia_activa_desde')
    .eq('id', cuentaId)
    .maybeSingle();

  if (error || !cuenta) {
    console.error('[plan] no se pudo leer la cuenta:', error);
    return null;
  }

  // El cupo se reusa de cuentas.ts en vez de recontarse acá: es la MISMA definición que aplica el
  // bloqueo al crear un comercio o una sucursal (comercios + sucursales no principales). Dos
  // conteos distintos del mismo número terminan divergiendo, y el dueño vería un cupo libre que
  // el sistema después le niega.
  const cupo = await cupoDeCuenta(supabase, cuentaId);

  const { data: pendiente } = await supabase
    .from('solicitudes_plan')
    .select('id, cuenta_id, plan_actual, plan_solicitado, motivo, estado, comentario_fm, resuelta_en, created_at')
    .eq('cuenta_id', cuentaId)
    .eq('estado', 'pendiente')
    .maybeSingle();

  return {
    plan: cuenta.plan,
    etiquetaPlan: etiquetaDePlan(cuenta.plan),
    montoMensual: cuenta.licencia_monto_mensual,
    licenciaEstado: cuenta.licencia_estado,
    licenciaActivaDesde: cuenta.licencia_activa_desde,
    limite: cupo.ok ? cupo.limite : null,
    usadas: cupo.ok ? cupo.usadas : 0,
    solicitudPendiente: pendiente
      ? {
          id: pendiente.id,
          cuentaId: pendiente.cuenta_id,
          planActual: pendiente.plan_actual,
          planSolicitado: pendiente.plan_solicitado,
          motivo: pendiente.motivo,
          estado: pendiente.estado,
          comentarioFm: pendiente.comentario_fm,
          resueltaEn: pendiente.resuelta_en,
          creadaEn: pendiente.created_at,
        }
      : null,
  };
}

export async function solicitarCambioPlan(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
  planSolicitado: string,
  motivo: string,
): Promise<ResultadoSolicitud> {
  if (!PLANES.some((p) => p.valor === planSolicitado)) {
    return { ok: false, error: 'Ese plan no existe.' };
  }

  const { data: cuenta } = await supabase
    .from('cuentas_comercio')
    .select('plan')
    .eq('id', cuentaId)
    .maybeSingle();
  if (!cuenta) return { ok: false, error: 'No se pudo leer tu cuenta.' };
  if (cuenta.plan === planSolicitado) {
    return { ok: false, error: 'Ya estás en ese plan.' };
  }

  const { error } = await supabase.from('solicitudes_plan').insert({
    cuenta_id: cuentaId,
    plan_actual: cuenta.plan ?? SIN_PLAN,
    plan_solicitado: planSolicitado,
    motivo: motivo.trim() || null,
  });

  if (error) {
    // 23505 = el índice único parcial de "una sola pendiente por cuenta". No es un fallo: es la
    // regla haciendo su trabajo, y merece un mensaje que el dueño entienda.
    if (error.code === '23505') {
      return { ok: false, error: 'Ya tenés una solicitud pendiente. Esperá a que la revisemos.' };
    }
    console.error('[plan] no se pudo crear la solicitud:', error);
    return { ok: false, error: 'No se pudo enviar la solicitud.' };
  }

  return { ok: true };
}

// Lado FM. `soloPendientes` es lo que usa la bandeja; el historial completo sirve para auditar.
export async function listarSolicitudes(
  supabase: SupabaseClient<Database>,
  soloPendientes = true,
): Promise<SolicitudPlan[] | null> {
  let consulta = supabase
    .from('solicitudes_plan')
    .select('id, cuenta_id, plan_actual, plan_solicitado, motivo, estado, comentario_fm, resuelta_en, created_at, cuentas_comercio(nombre)')
    .order('created_at', { ascending: false });
  if (soloPendientes) consulta = consulta.eq('estado', 'pendiente');

  const { data, error } = await consulta;
  if (error) {
    console.error('[plan] no se pudieron leer las solicitudes:', error);
    return null;
  }

  return (data ?? []).map((s) => ({
    id: s.id,
    cuentaId: s.cuenta_id,
    cuentaNombre: s.cuentas_comercio?.nombre,
    planActual: s.plan_actual,
    planSolicitado: s.plan_solicitado,
    motivo: s.motivo,
    estado: s.estado,
    comentarioFm: s.comentario_fm,
    resueltaEn: s.resuelta_en,
    creadaEn: s.created_at,
  }));
}

// Aprobar APLICA el plan del catálogo (monto y límite sugeridos). FM puede ajustarlos después desde
// la ficha de la cuenta — el límite siempre fue un default negociable (ver CLAUDE.md).
export async function resolverSolicitud(
  supabase: SupabaseClient<Database>,
  solicitudId: string,
  aprobar: boolean,
  comentario: string,
): Promise<ResultadoSolicitud> {
  const { data: solicitud } = await supabase
    .from('solicitudes_plan')
    .select('id, cuenta_id, plan_solicitado, estado')
    .eq('id', solicitudId)
    .maybeSingle();

  if (!solicitud) return { ok: false, error: 'La solicitud no existe.' };
  if (solicitud.estado !== 'pendiente') {
    return { ok: false, error: 'Esa solicitud ya fue resuelta.' };
  }

  if (aprobar) {
    const destino = PLANES.find((p) => p.valor === solicitud.plan_solicitado);
    if (!destino) return { ok: false, error: 'El plan solicitado ya no existe en el catálogo.' };

    // BAJAR de plan puede dejar a la cuenta por encima de su nuevo cupo. Se bloquea con un mensaje
    // que dice exactamente qué hacer, en vez de aplicarlo y dejar una cuenta en un estado que el
    // propio sistema considera inválido (verificarLimiteCuenta la bloquearía en la siguiente alta).
    // Antes esto estaba envuelto en `if (destino.limiteSugerido !== null)`, porque Pro no tenía
    // tope y no había nada contra qué comparar. Desde que los tres planes tienen tope (2026-08-13)
    // la comparación aplica siempre.
    const cupo = await cupoDeCuenta(supabase, solicitud.cuenta_id);
    if (cupo.ok && cupo.usadas > destino.limiteSugerido) {
      return {
        ok: false,
        error: `La cuenta usa ${cupo.usadas} unidades y el plan ${destino.etiqueta} permite ${destino.limiteSugerido}. Pedile que desactive negocios o sucursales antes de bajar de plan.`,
      };
    }

    const { error: eCuenta } = await supabase
      .from('cuentas_comercio')
      .update({
        plan: destino.valor,
        licencia_monto_mensual: destino.montoMensual,
        limite_negocios: destino.limiteSugerido,
      })
      .eq('id', solicitud.cuenta_id);
    if (eCuenta) {
      console.error('[plan] no se pudo aplicar el plan:', eCuenta);
      return { ok: false, error: 'No se pudo aplicar el plan.' };
    }
  }

  const { error } = await supabase
    .from('solicitudes_plan')
    .update({
      estado: aprobar ? 'aprobada' : 'rechazada',
      comentario_fm: comentario.trim() || null,
      resuelta_en: new Date().toISOString(),
    })
    .eq('id', solicitudId);

  if (error) {
    console.error('[plan] no se pudo resolver la solicitud:', error);
    return { ok: false, error: 'No se pudo resolver la solicitud.' };
  }

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Aplicar el plan de un cobro pagado (migración 0037)
// ─────────────────────────────────────────────────────────────────────────────
// Lo llama `confirmarPagoCobro` cuando Wompi confirma un cobro con `plan_destino`. Tiene que ser
// IDEMPOTENTE: el webhook se reintenta, el redirect puede llegar dos veces, y FM puede reintentar a mano.
//
// La DIRECCIÓN (subir o bajar) la decide la INTENCIÓN del cobro, no solo el plan que la cuenta tiene al
// confirmar:
//   - Un AJUSTE (subir a mitad de período) NUNCA baja. Si la cuenta ya está en ese plan o en uno más caro
//     (FM se lo subió a mano mientras el dueño pagaba, o pagó otro ajuste antes), no hace nada: convertir
//     un ajuste pagado en una bajada le quitaría al dueño lo que acaba de pagar.
//   - Un PERÍODO (renovar) fija el plan exacto, sea más caro, más chico o el mismo.
//
// El límite lo decide `limiteResultante` (limitePlan.ts): al subir nunca baja (un límite negociado por FM
// se respeta, y el "sin tope" de las cuentas viejas sobrevive); al bajar rige el sugerido del plan. Y en
// AMBOS casos se comprueba que la cuenta quepa, porque entre el cobro y el pago el dueño pudo agregar
// negocios. Si no cabe devuelve `motivo: 'cupo'`: la plata ya entró, y `confirmarPagoCobro` lo deja como
// `plan_no_aplicable` para que FM lo resuelva, en vez de dejar una cuenta que el propio sistema considera
// inválida (`verificarLimiteCuenta` la bloquearía en la siguiente alta).
export async function aplicarPlanDestino(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
  planDestino: string,
  tipo: 'periodo' | 'ajuste',
): Promise<ResultadoAplicarPlan> {
  const destino = PLANES.find((p) => p.valor === planDestino);
  if (!destino) return { ok: false, motivo: 'error', error: 'Ese plan no existe.' };

  const { data: cuenta, error: eLeer } = await supabase
    .from('cuentas_comercio')
    .select('plan, limite_negocios')
    .eq('id', cuentaId)
    .maybeSingle();
  if (eLeer) {
    console.error('[plan] no se pudo leer la cuenta para aplicar el plan:', eLeer);
    return { ok: false, motivo: 'error', error: 'No se pudo leer la cuenta.' };
  }
  if (!cuenta) return { ok: false, motivo: 'error', error: 'La cuenta no existe.' };

  if (cuenta.plan === destino.valor) return { ok: true, cambio: false };
  if (tipo === 'ajuste' && escalonDePlan(cuenta.plan) >= escalonDePlan(destino.valor)) {
    return { ok: true, cambio: false };
  }

  const limiteNuevo = limiteResultante({ plan: cuenta.plan, limite: cuenta.limite_negocios }, destino);
  const cupo = await cupoDeCuenta(supabase, cuentaId);
  if (!cupo.ok) return { ok: false, motivo: 'error', error: cupo.error };
  if (limiteNuevo !== null && cupo.usadas > limiteNuevo) {
    return {
      ok: false,
      motivo: 'cupo',
      error: `La cuenta usa ${cupo.usadas} unidades y el plan ${destino.etiqueta} permite ${limiteNuevo}.`,
    };
  }

  const { error } = await supabase
    .from('cuentas_comercio')
    .update({
      plan: destino.valor,
      licencia_monto_mensual: destino.montoMensual,
      limite_negocios: limiteNuevo,
    })
    .eq('id', cuentaId);
  if (error) {
    console.error('[plan] no se pudo aplicar el plan:', error);
    return { ok: false, motivo: 'error', error: 'No se pudo cambiar el plan.' };
  }
  return { ok: true, cambio: true };
}

// La licencia queda activa desde el primer pago. Idempotente: `licencia_activa_desde` solo se llena si
// estaba vacía, así un pago posterior (una renovación, o el reintento de este) no le corre la fecha de
// alta al dueño. LANZA si algo falla: `confirmarPagoCobro` la llama antes de reclamar el cobro, y un
// error acá tiene que cortar el flujo para que el reintento lo complete.
export async function activarLicencia(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
  hoy: string,
): Promise<void> {
  const { data: cuenta, error: eLeer } = await supabase
    .from('cuentas_comercio')
    .select('licencia_activa_desde')
    .eq('id', cuentaId)
    .maybeSingle();
  if (eLeer || !cuenta) {
    throw new Error(`No se pudo leer la cuenta para activar la licencia${eLeer ? `: ${eLeer.message}` : ''}`);
  }

  const { error } = await supabase
    .from('cuentas_comercio')
    .update({ licencia_estado: 'activo', licencia_activa_desde: cuenta.licencia_activa_desde ?? hoy })
    .eq('id', cuentaId);
  if (error) throw new Error(`No se pudo activar la licencia: ${error.message}`);
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { PLANES, cupoDeCuenta } from './cuentas';

// Autogestión de plan (migración 0017). El dueño ve y SOLICITA; FM aprueba.
//
// Por qué no se aplica solo: no hay cobro automático detrás (Stripe no acepta negocios de El
// Salvador y N1co espera la personería jurídica). Sin cobro, un cambio inmediato dejaría que
// cualquiera pase a Pro sin pagarlo. Cuando exista la pasarela, este flujo ya está construido y
// solo cambia quién aprueba.

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
    if (destino.limiteSugerido !== null) {
      const cupo = await cupoDeCuenta(supabase, solicitud.cuenta_id);
      if (cupo.ok && cupo.usadas > destino.limiteSugerido) {
        return {
          ok: false,
          error: `La cuenta usa ${cupo.usadas} unidades y el plan ${destino.etiqueta} permite ${destino.limiteSugerido}. Pedile que desactive negocios o sucursales antes de bajar de plan.`,
        };
      }
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
// Autogestión: el dueño sube de plan sin esperar a FM
// ─────────────────────────────────────────────────────────────────────────────
// Hasta acá TODO cambio de plan pasaba por la bandeja de FM. Eso significa que un comercio que
// llega a su tope un sábado a las nueve de la noche —justo cuando quiere abrir otro local y pagar
// más— queda bloqueado hasta que alguien vea su solicitud.
//
// ══ POR QUÉ SOLO SUBIR ══
// Subir es el dueño pidiendo MÁS capacidad y aceptando pagar MÁS: no hay nada que negociar y
// hacerlo esperar solo cuesta plata de los dos lados. Bajar es lo contrario, y ahí FM tiene un
// interés legítimo en la conversación (entender por qué se va, ofrecerle algo). Por eso bajar sigue
// pasando por `solicitarCambioPlan` y esta función lo rechaza nombrando el camino.
//
// ══ SIN PASARELA, Y ESO ESTÁ BIEN ══
// El cobro no cambia: el monto de la cuenta se actualiza y FM factura como siempre. El pago online
// depende de una entidad legal que todavía no existe (ver lib/comercios/cobros.ts), y atar la
// autogestión a esa espera sería dejar bloqueado al cliente por un trámite ajeno a él.

// Cuánto vale un plan según el catálogo, para poder ordenarlos. Una cuenta SIN plan vale -1: desde
// ahí cualquier plano del catálogo es "subir".
function escalonDe(plan: string | null): number {
  const i = PLANES.findIndex((p) => p.valor === plan);
  return i < 0 ? -1 : i;
}

export async function subirPlanPorElDueno(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
  planDestino: string,
): Promise<ResultadoSolicitud> {
  const destino = PLANES.find((p) => p.valor === planDestino);
  if (!destino) return { ok: false, error: 'Ese plan no existe.' };

  const { data: cuenta, error: eLeer } = await supabase
    .from('cuentas_comercio')
    .select('plan, limite_negocios')
    .eq('id', cuentaId)
    .maybeSingle();
  if (eLeer) {
    console.error('[plan] no se pudo leer la cuenta para subir de plan:', eLeer);
    return { ok: false, error: 'No se pudo cambiar tu plan.' };
  }
  if (!cuenta) return { ok: false, error: 'No se pudo leer tu cuenta.' };

  if (cuenta.plan === destino.valor) return { ok: false, error: 'Ya estás en ese plan.' };

  if (escalonDe(destino.valor) < escalonDe(cuenta.plan)) {
    return {
      ok: false,
      error: 'Para bajar de plan mandanos una solicitud desde esta misma pantalla y lo vemos con vos.',
    };
  }

  // El límite NUNCA baja al subir de plan. `limite_negocios` es un DEFAULT sugerido por plan y FM lo
  // ajusta por cuenta en tratos negociados (decisión cerrada del proyecto): a un Starter con cupo 5
  // negociado, aplicarle el sugerido de Growth —que es 2— le quitaría capacidad justo cuando acaba
  // de aceptar pagar más. Gana el mayor, y `null` (sin tope, Pro) le gana a cualquier número.
  const limiteNuevo =
    destino.limiteSugerido === null
      ? null
      : Math.max(destino.limiteSugerido, cuenta.limite_negocios ?? 0);

  const { error } = await supabase
    .from('cuentas_comercio')
    .update({
      plan: destino.valor,
      licencia_monto_mensual: destino.montoMensual,
      limite_negocios: limiteNuevo,
    })
    .eq('id', cuentaId);

  if (error) {
    console.error('[plan] no se pudo subir el plan:', error);
    return { ok: false, error: 'No se pudo cambiar tu plan.' };
  }
  return { ok: true };
}

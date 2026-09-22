import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { METODO_PEDIDO_FM, validarCobro, type ResultadoRegistroCobro } from './cobros';

// FM le pide un pago al cliente cuando quiera, no solo al vencer el ciclo (spec
// 2026-09-21-cobranza-design.md, "Acciones de FM" #4 — sirve, entre otras cosas, para probar con $1).
//
// A diferencia de `crearCobroPendiente` (cobros.ts, lo usa la app cuando el DUEÑO inicia su propio pago
// desde /comercio/plan): acá el monto y el plan los elige FM a mano, y el monto puede NO coincidir con
// ningún plan del catálogo A PROPÓSITO, así que no se valida contra opcionesPago.ts. El insert es
// DIRECTO a `cobros` (no crearCobroPendiente, que fuerza metodo: METODO_WOMPI y planDestino no-nullable).
//
// `tipo` va SIEMPRE 'periodo', nunca 'ajuste': el CHECK `cobros_ajuste_con_plan` (migración 0037) exige
// `plan_destino` no nulo en un 'ajuste', y acá el plan puede ser null (pedir un pago sin tocar el plan).
// 'periodo' sí admite plan_destino: null — mismo criterio que ya usa confirmarPagoCobro (aplica el plan
// solo si cobro.planDestino !== null, sin mirar `tipo` para esa decisión).
export interface DatosPedirPago {
  monto: number;
  plan: string | null;
  periodoDesde: string;
  periodoHasta: string;
}

export async function pedirPago(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
  datos: DatosPedirPago,
): Promise<ResultadoRegistroCobro> {
  const problema = validarCobro({
    periodoDesde: datos.periodoDesde,
    periodoHasta: datos.periodoHasta,
    monto: datos.monto,
    estado: 'pendiente',
    metodo: METODO_PEDIDO_FM,
    nota: null,
    pagadoEn: null,
  });
  if (problema) return { ok: false, error: problema };

  const { data, error } = await supabase
    .from('cobros')
    .insert({
      cuenta_id: cuentaId,
      tipo: 'periodo',
      periodo_desde: datos.periodoDesde,
      periodo_hasta: datos.periodoHasta,
      monto: datos.monto,
      estado: 'pendiente',
      metodo: METODO_PEDIDO_FM,
      plan_destino: datos.plan,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('[pedirPago] no se pudo crear el cobro:', error);
    return { ok: false, error: 'No se pudo crear el cobro.' };
  }
  return { ok: true, id: data.id };
}

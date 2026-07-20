import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

export type ResultadoCanje =
  | { ok: true; puntosActuales: number; nombreRecompensa: string }
  | { ok: false; error: string };

// Canjea una recompensa: resta su costo del saldo y deja la fila en `canjes` (el historial
// auditable por el que recompensas usa soft-delete). Todo scopeado por comercio_id.
//
// El decremento usa un guard condicional (.gte en el WHERE): si otra operación gastó los puntos
// entre la lectura y la escritura, el update matchea 0 filas y el canje se rechaza — nunca deja
// saldo negativo. La pareja decremento+insert sigue sin transacción (sin precedente de RPC en el
// proyecto); si el insert del canje fallara tras el decremento, se intenta la reversa y se deja
// rastro. Con un cajero por comercio (piloto), la ventana real es ~0.
export async function canjearRecompensa(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  tarjetaId: string,
  recompensaId: string,
): Promise<ResultadoCanje> {
  const { data: recompensa, error: errorRecompensa } = await supabase
    .from('recompensas')
    .select('nombre, costo_puntos, activa')
    .eq('id', recompensaId)
    .eq('comercio_id', comercioId)
    .maybeSingle();

  if (errorRecompensa) {
    console.error('[canje] falló la lectura de la recompensa:', errorRecompensa);
    return { ok: false, error: 'No se pudo leer la recompensa.' };
  }
  if (!recompensa || !recompensa.activa) {
    // Inexistente, de otro comercio o desactivada: para el cajero es lo mismo.
    return { ok: false, error: 'Esa recompensa no está disponible.' };
  }

  const { data: tarjeta, error: errorTarjeta } = await supabase
    .from('tarjetas')
    .select('puntos_actuales')
    .eq('id', tarjetaId)
    .eq('comercio_id', comercioId)
    .maybeSingle();

  if (errorTarjeta) {
    console.error('[canje] falló la lectura de la tarjeta:', errorTarjeta);
    return { ok: false, error: 'No se pudo leer la tarjeta.' };
  }
  if (!tarjeta) {
    return { ok: false, error: 'Esa tarjeta no existe en tu comercio.' };
  }
  if (tarjeta.puntos_actuales < recompensa.costo_puntos) {
    const faltan = recompensa.costo_puntos - tarjeta.puntos_actuales;
    return { ok: false, error: `No le alcanzan los puntos: le faltan ${faltan}.` };
  }

  // Decremento con guard: el .gte re-verifica el saldo AL ESCRIBIR. Si ya no alcanza (carrera),
  // matchea 0 filas → PGRST116 → se rechaza sin tocar nada.
  const nuevoSaldo = tarjeta.puntos_actuales - recompensa.costo_puntos;
  const { error: errorUpdate } = await supabase
    .from('tarjetas')
    .update({ puntos_actuales: nuevoSaldo })
    .eq('id', tarjetaId)
    .eq('comercio_id', comercioId)
    .gte('puntos_actuales', recompensa.costo_puntos)
    .select('id')
    .single();

  if (errorUpdate) {
    if (errorUpdate.code === 'PGRST116') {
      return { ok: false, error: 'No le alcanzan los puntos.' };
    }
    console.error('[canje] falló el decremento del saldo:', errorUpdate);
    return { ok: false, error: 'No se pudo canjear.' };
  }

  const { error: errorCanje } = await supabase.from('canjes').insert({
    tarjeta_id: tarjetaId,
    recompensa_id: recompensaId,
    puntos_gastados: recompensa.costo_puntos,
  });

  if (errorCanje) {
    // Reversa best-effort: el saldo ya bajó pero el canje no quedó registrado. Se devuelven los
    // puntos y se deja rastro; si la reversa también falla, el ledger manual (Studio) es el
    // recurso — por eso ambos errores se loguean con todo el contexto.
    console.error('[canje] el canje no se pudo registrar; se intenta revertir el saldo:', errorCanje);
    const { error: errorReversa } = await supabase
      .from('tarjetas')
      .update({ puntos_actuales: tarjeta.puntos_actuales })
      .eq('id', tarjetaId)
      .eq('comercio_id', comercioId);
    if (errorReversa) {
      console.error(
        `[canje] REVERSA FALLIDA tarjeta=${tarjetaId} saldo_esperado=${tarjeta.puntos_actuales}:`,
        errorReversa,
      );
    }
    return { ok: false, error: 'No se pudo registrar el canje. No se descontaron puntos.' };
  }

  return { ok: true, puntosActuales: nuevoSaldo, nombreRecompensa: recompensa.nombre };
}

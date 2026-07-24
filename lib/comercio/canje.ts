import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

export type ResultadoCanje =
  | { ok: true; puntosActuales: number; nombreRecompensa: string }
  | { ok: false; error: string };

// Atribución opcional del canje (Fase 8): en qué sucursal y qué cajero lo registró. Ambos nullable
// — los consumidores del walking skeleton (actions) llaman sin opciones y el RPC guarda null. La
// sucursal solo se valida cuando viene: debe ser del comercio y estar activa.
export interface OpcionesCanje {
  sucursalId?: string | null;
  cajeroUsuarioId?: string | null;
}

// Canjea una recompensa de forma ATÓMICA vía el RPC canjear_recompensa_atomico (0009): una sola
// transacción con lock de fila que valida recompensa+sucursal, descuenta el saldo con guard
// (puntos_actuales >= costo) E inserta la fila en `canjes` (el historial auditable por el que
// recompensas usa soft-delete) con la atribución sucursal/cajero. Al ser atómico, ya no hace falta
// la reversa best-effort del patrón anterior: si algo falla, nada se escribe.
export async function canjearRecompensa(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  tarjetaId: string,
  recompensaId: string,
  opciones?: OpcionesCanje,
): Promise<ResultadoCanje> {
  const { data, error } = await supabase.rpc('canjear_recompensa_atomico', {
    p_comercio_id: comercioId,
    p_tarjeta_id: tarjetaId,
    p_recompensa_id: recompensaId,
    p_sucursal_id: opciones?.sucursalId ?? null,
    p_cajero_usuario_id: opciones?.cajeroUsuarioId ?? null,
  });

  // `returns table(...)` → data es un arreglo; la fila de estado es la primera.
  const fila = data?.[0];
  if (error || !fila) {
    console.error('[canje] falló el RPC canjear_recompensa_atomico:', error);
    return { ok: false, error: 'No se pudo canjear.' };
  }

  if (fila.estado === 'ok') {
    return { ok: true, puntosActuales: fila.saldo, nombreRecompensa: fila.nombre_recompensa };
  }
  if (fila.estado === 'recompensa_no_disponible') {
    // Inexistente, de otro comercio o desactivada: para el cajero es lo mismo.
    return { ok: false, error: 'Esa recompensa no está disponible.' };
  }
  if (fila.estado === 'saldo_insuficiente') {
    // El RPC devuelve saldo=saldo actual y costo=costo de la recompensa: la resta da lo que falta.
    return { ok: false, error: `No le alcanzan los puntos: le faltan ${fila.costo - fila.saldo}.` };
  }
  if (fila.estado === 'tarjeta_no_encontrada') {
    return { ok: false, error: 'Esa tarjeta no existe en tu comercio.' };
  }
  if (fila.estado === 'sucursal_invalida') {
    return { ok: false, error: 'La sucursal no es válida.' };
  }

  // Estado inesperado (no debería ocurrir con el RPC vigente): se trata como fallo genérico.
  console.error('[canje] estado inesperado del RPC canjear_recompensa_atomico:', fila.estado);
  return { ok: false, error: 'No se pudo canjear.' };
}

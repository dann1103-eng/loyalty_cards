import type { EstadoCobranza } from '../comercios/cobranza';

// El gate de bloqueo (spec 2026-09-21-cobranza-design.md, "Cómo se bloquea"): dado el
// EstadoCobranza YA CALCULADO (estadoEfectivo, lib/comercios/cobranza.ts) y el rol de quien entra,
// decide a dónde redirigir — o null si no hay que bloquear.
//
// PURO a propósito: separado del wiring que arma `EstadoCobranza` desde la base (verifyComercioAcceso.ts,
// que SÍ toca Supabase y next/navigation) para poder probarlo sin DB ni request context de Next. Solo
// `bloqueada` bloquea — `vencida` todavía tiene sus días de gracia (DIAS_GRACIA_COBRANZA, cobranza.ts), y
// exenta/pospuesta/al_dia nunca bloquean.
export function decidirRedireccion(estado: EstadoCobranza, rol: 'owner' | 'cajero'): string | null {
  if (estado.tipo !== 'bloqueada') return null;
  return rol === 'owner' ? '/comercio/plan?suspendida=1' : '/comercio/suspendida';
}

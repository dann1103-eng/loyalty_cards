import type { Membresia } from './membresiasDeUsuario';

// Resolución PURA del "comercio activo" — sin cookies() ni redirect(), para poder testear la
// política sin un contexto de request de Next. La cookie es INPUT DEL CLIENTE (no confiable): la
// lista de membresías es la fuente de verdad, y la cookie solo elige ENTRE ellas. Una cookie que
// apunta a un comercio del que el usuario NO es miembro se ignora → se manda a elegir.
export type ResultadoComercioActivo =
  | { tipo: 'sin-acceso' }
  | { tipo: 'elegir' }
  | { tipo: 'resuelto'; membresia: Membresia };

export function resolverComercioActivo(
  membresias: Membresia[],
  cookieComercioId: string | undefined,
): ResultadoComercioActivo {
  if (membresias.length === 0) {
    return { tipo: 'sin-acceso' };
  }
  if (membresias.length === 1) {
    // Una sola membresía: la cookie es irrelevante, se resuelve directo.
    return { tipo: 'resuelto', membresia: membresias[0] };
  }
  // 2+: la cookie DEBE coincidir con una membresía real. Si falta o apunta a un ajeno → elegir.
  const elegida = membresias.find((m) => m.comercioId === cookieComercioId);
  if (!elegida) {
    return { tipo: 'elegir' };
  }
  return { tipo: 'resuelto', membresia: elegida };
}

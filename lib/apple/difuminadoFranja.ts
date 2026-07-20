// Fuente única de verdad de los niveles de difuminado de la franja: la BD tiene
// check (difuminado_franja in (...4 valores...)) en la migración 0007. Puro (sin next/og ni
// dependencias de servidor) a propósito: lo importan tanto stripPass.tsx (server, compone el PNG
// real) como FormularioBranding.tsx (client, la vista previa) — un solo lugar define los 4
// niveles, así preview y pass real nunca pueden divergir.
export const NIVELES_DIFUMINADO = ['ninguno', 'sutil', 'medio', 'fuerte'] as const;
export type NivelDifuminado = (typeof NIVELES_DIFUMINADO)[number];

export interface StopsDifuminado {
  // [inicio, fin] en % de cada eje: fuera de ese rango el gradiente es opaco (funde hacia el
  // color de la tarjeta); dentro es transparente (se ve la foto nítida). Cuanto más grande
  // `inicio`, más chico el centro nítido — o sea, más "fuerte" se ve el difuminado.
  v: [number, number];
  h: [number, number];
}

// null = sin difuminado: la foto corta seca contra el color de la tarjeta (comportamiento previo
// a este ajuste). Cualquier valor no reconocido cae a 'medio' — nunca revienta el render del pass
// por un dato corrupto o un nivel que ya no exista.
export function stopsDifuminado(nivel: string): StopsDifuminado | null {
  switch (nivel) {
    case 'ninguno':
      return null;
    case 'sutil':
      return { v: [10, 90], h: [6, 94] };
    case 'fuerte':
      return { v: [36, 64], h: [26, 74] };
    case 'medio':
    default:
      return { v: [22, 78], h: [14, 86] };
  }
}

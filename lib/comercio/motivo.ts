// El motivo es el dato que convierte una operación sensible en una operación auditable. Lo exigen
// dos caminos distintos —quitar sellos (ajuste.ts) y forzar una acreditación bloqueada por un
// límite (acreditar.ts)— y la regla tiene que ser IDÉNTICA en los dos: si uno aceptara un motivo
// en blanco, ese sería el camino que usaría quien no quiere dejar rastro.
//
// La BD tiene su propio CHECK (transacciones_puntos_motivo_obligatorio, migración 0015) como
// candado de último recurso. Esta capa es la que da el mensaje en español.

export const LARGO_MAXIMO_MOTIVO = 300;

export type MotivoValidado = { ok: true; motivo: string } | { ok: false; error: string };

// `queEs` completa la frase "Escribí el motivo de ___" — por ejemplo 'la corrección'.
export function validarMotivo(motivo: string, queEs: string): MotivoValidado {
  const limpio = motivo.trim();

  if (!limpio) {
    return { ok: false, error: `Escribí el motivo de ${queEs}.` };
  }
  if (limpio.length > LARGO_MAXIMO_MOTIVO) {
    return { ok: false, error: `El motivo no puede pasar de ${LARGO_MAXIMO_MOTIVO} caracteres.` };
  }

  return { ok: true, motivo: limpio };
}

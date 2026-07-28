import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { validarMotivo } from './motivo';

// Re-exportado para que los consumidores del ajuste (formulario, pruebas) no tengan que conocer
// motivo.ts: el largo máximo es parte del contrato de esta función.
export { LARGO_MAXIMO_MOTIVO } from './motivo';

// Corrección manual del saldo de una tarjeta (Tanda 1 — antifraude). Nace de un caso concreto:
// el cajero puso 5 sellos en vez de 1 y hasta ahora no había forma de deshacerlo (la única resta
// del sistema era canjear una recompensa concreta, con su costo fijo).
//
// TODO scopeado por comercio_id del gate de sesión, nunca del cliente, igual que acreditar.ts.

export type ResultadoAjuste = { ok: true; puntosActuales: number } | { ok: false; error: string };

export interface OpcionesAjuste {
  sucursalId?: string | null;
  cajeroUsuarioId?: string | null;
}

// SOLO RESTA, y eso es una decisión de seguridad, no una limitación.
//
// El RPC ajustar_puntos_atomico acepta cualquier signo a propósito (la política vive en TS, que es
// donde este proyecto pone la validación). Pero si desde acá se pudiera sumar, un cajero bloqueado
// por el tope diario tendría una puerta trasera: "ajuste +5" con cualquier motivo, y todo el
// sistema de límites quedaría en nada. Por eso la corrección hacia ARRIBA no pasa por acá — pasa
// por acreditar_forzado_atomico, que solo el dueño puede invocar y que deja la fila marcada como
// forzada.
//
// `cantidad` es POSITIVA (cuántos sellos/puntos quitar). El delta negativo se arma acá adentro para
// que ningún caller pueda equivocarse de signo.
export async function quitarPuntos(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  tarjetaId: string,
  cantidad: number,
  motivo: string,
  opciones?: OpcionesAjuste,
): Promise<ResultadoAjuste> {
  if (!Number.isInteger(cantidad) || cantidad <= 0 || cantidad > 1_000_000) {
    return { ok: false, error: 'La cantidad a quitar debe ser un número entero mayor que cero.' };
  }

  const revision = validarMotivo(motivo, 'la corrección');
  if (!revision.ok) return revision;
  const motivoLimpio = revision.motivo;

  const { data, error } = await supabase.rpc('ajustar_puntos_atomico', {
    p_comercio_id: comercioId,
    p_tarjeta_id: tarjetaId,
    p_delta: -cantidad,
    p_sucursal_id: opciones?.sucursalId ?? null,
    p_cajero_usuario_id: opciones?.cajeroUsuarioId ?? null,
    p_motivo: motivoLimpio,
  });

  // `returns table(...)` → data es un arreglo; la fila de estado es la primera.
  const fila = data?.[0];
  if (error || !fila) {
    console.error('[ajuste] no se pudo registrar la corrección:', error);
    return { ok: false, error: 'No se pudo registrar la corrección.' };
  }

  if (fila.estado === 'ok') {
    return { ok: true, puntosActuales: fila.saldo };
  }
  if (fila.estado === 'saldo_insuficiente') {
    // fila.saldo trae el saldo actual intacto: se le dice al cajero cuánto hay realmente, que es
    // lo único accionable ("querés quitar 5 y solo tiene 3").
    return {
      ok: false,
      error: `No se puede quitar esa cantidad: la tarjeta solo tiene ${fila.saldo}.`,
    };
  }
  if (fila.estado === 'tarjeta_no_encontrada') {
    // Inexistente o de otro comercio: mismo mensaje (no se filtra cuál de los dos).
    return { ok: false, error: 'Esa tarjeta no existe en tu comercio.' };
  }
  if (fila.estado === 'sucursal_invalida') {
    return { ok: false, error: 'La sucursal no es válida.' };
  }
  if (fila.estado === 'motivo_requerido') {
    // El motivo vacío ya se atajó arriba; llegar acá significa que la validación de TS y la del RPC
    // se desincronizaron.
    return { ok: false, error: 'Escribí el motivo de la corrección.' };
  }

  // Estado inesperado (no debería ocurrir con el RPC vigente): se trata como fallo genérico.
  console.error('[ajuste] estado inesperado del RPC ajustar_puntos_atomico:', fila.estado);
  return { ok: false, error: 'No se pudo registrar la corrección.' };
}

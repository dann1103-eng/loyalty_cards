import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

// Máx. intentos permitidos por IP dentro de la ventana. Exportados para que las pruebas y
// cualquier futuro consumidor no dupliquen los números mágicos.
export const LIMITE_INTENTOS = 10;
export const VENTANA_MINUTOS = 15;

// Cuenta los intentos PREVIOS de esta IP en la ventana, REGISTRA el intento actual (exitoso o no)
// y devuelve si se permite continuar. Contar antes de insertar hace que el intento nº (límite+1)
// vea `límite` previos y se bloquee — o sea, máximo `LIMITE_INTENTOS` por ventana.
//
// Se registra SIEMPRE, aun al bloquear: así hostigar el endpoint mantiene la IP por encima del
// límite (ventana deslizante) en vez de darle un cupo nuevo cada vez.
export async function verificarYRegistrarIntento(
  supabase: SupabaseClient<Database>,
  ip: string,
): Promise<boolean> {
  const desde = new Date(Date.now() - VENTANA_MINUTOS * 60_000).toISOString();

  const { count, error: errorConteo } = await supabase
    .from('intentos_consulta_portal')
    .select('*', { count: 'exact', head: true })
    .eq('ip', ip)
    .gte('created_at', desde);

  const { error: errorInsert } = await supabase.from('intentos_consulta_portal').insert({ ip });
  if (errorInsert) {
    // El registro es best-effort: si falla, no reventamos la consulta del cliente por eso, pero
    // dejamos rastro (un fallo sistemático de inserts anularía el límite en silencio).
    console.error('[portal] no se pudo registrar el intento de consulta:', errorInsert);
  }

  if (errorConteo) {
    // Fallar CERRADO: si no podemos contar, negamos. Un atacante no debe poder habilitar la
    // enumeración tumbando el conteo. El costo (bloquear a un cliente legítimo durante una caída
    // de BD, con un dato de bajo riesgo) es tolerable; fallar abierto reabriría justo el raspado
    // que este límite existe para frenar.
    console.error('[portal] no se pudo contar intentos; se bloquea por seguridad:', errorConteo);
    return false;
  }

  return (count ?? 0) < LIMITE_INTENTOS;
}

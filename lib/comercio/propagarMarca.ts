import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { notificarCambioPrograma } from '../apple/notificarCambioComercio';
import { syncObjetosPrograma } from '../google/syncComercio';
import { syncClasePrograma } from '../google/syncClasePrograma';

// Empuja la marca de UN programa a los pases ya emitidos, por los TRES canales que existen. Vivía
// como función privada dentro de la Server Action de branding y se extrajo acá el 2026-07-31 para
// poder probarla: sin cobertura, le faltaba el canal más importante y nadie se enteraba.
//
// EL BUG QUE ESTO CIERRA: faltaba `syncClasePrograma`. Google guarda logo y colores en la
// LoyaltyCLASS, no en el objeto — así que el dueño cambiaba el color de su tarjeta secundaria, lo
// veía en el iPhone (donde el .pkpass se regenera entero en cada emisión) y en Android NO PASABA
// NADA. Sin error, sin aviso.
//
// Best-effort a propósito, igual que el resto de la integración con wallets: la marca ya quedó
// guardada en la base cuando esto corre, así que un fallo de Google o de APNs no puede tumbar una
// operación que para el dueño ya fue exitosa. El próximo guardado reintenta.
export async function propagarMarcaPrograma(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  programaId: string,
): Promise<void> {
  try {
    // Apple primero: es el canal que el dueño mira para confirmar que su cambio funcionó.
    await notificarCambioPrograma(supabase, comercioId, programaId);

    // La CLASE antes que los objetos, y el orden no es cosmético: si el programa acaba de estrenar
    // marca propia, syncClasePrograma es quien CREA su clase. Al revés, los objetos apuntarían a un
    // classId que todavía no existe del lado de Google.
    await syncClasePrograma(supabase, comercioId, programaId);
    await syncObjetosPrograma(supabase, comercioId, programaId);
  } catch (err) {
    console.error('[comercio] falló la propagación de la marca del programa:', err);
  }
}

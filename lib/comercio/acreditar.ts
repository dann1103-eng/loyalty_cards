import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

// Capa de datos del escáner del cajero (Fase 4). TODO scopeado por comercio_id (del gate de
// sesión, nunca del cliente): un dueño no puede leer ni acreditar tarjetas de otro comercio
// aunque conozca el token o el id.

export interface TarjetaEscaneada {
  tarjetaId: string;
  puntosActuales: number;
  nombreCliente: string;
  telefono: string | null;
}

// Resuelve el QR escaneado (el qr_token que codifica el barcode del pass y el QR impreso del
// panel) a la tarjeta DE ESTE comercio. Un token ajeno o inexistente da null — indistinguibles a
// propósito, para no filtrar si un token existe en otro local.
export async function buscarTarjetaPorToken(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  qrToken: string,
): Promise<TarjetaEscaneada | null> {
  const token = qrToken.trim();
  if (!token) return null;

  const { data, error } = await supabase
    .from('tarjetas')
    .select('id, puntos_actuales, clientes(nombre, telefono)')
    .eq('qr_token', token)
    .eq('comercio_id', comercioId)
    .maybeSingle();

  if (error) {
    // maybeSingle() devuelve error:null cuando no hay filas: un error aquí es infraestructura.
    console.error('[escaner] falló la búsqueda por token:', error);
    return null;
  }
  if (!data) return null;

  return {
    tarjetaId: data.id,
    puntosActuales: data.puntos_actuales,
    nombreCliente: data.clientes?.nombre ?? 'Cliente',
    telefono: data.clientes?.telefono ?? null,
  };
}

export type ResultadoAcreditar =
  | { ok: true; puntosActuales: number }
  | { ok: false; error: string };

// Suma puntos/sellos: primero el LEDGER (transacciones_puntos, la fuente de verdad auditable),
// después el saldo. Mismo patrón no-atómico documentado del endpoint del walking skeleton: con un
// cajero por comercio la concurrencia es ~0 y una divergencia se reconstruye desde el ledger. El
// reemplazo atómico (RPC de Postgres) queda para cuando haya más de un cajero simultáneo.
export async function acreditarPuntos(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  tarjetaId: string,
  delta: number,
): Promise<ResultadoAcreditar> {
  if (!Number.isInteger(delta) || delta <= 0 || delta > 1_000_000) {
    return { ok: false, error: 'La cantidad debe ser un número entero mayor que cero.' };
  }

  const { data: tarjeta, error: errorTarjeta } = await supabase
    .from('tarjetas')
    .select('puntos_actuales')
    .eq('id', tarjetaId)
    .eq('comercio_id', comercioId)
    .maybeSingle();

  if (errorTarjeta) {
    console.error('[escaner] falló la lectura de la tarjeta:', errorTarjeta);
    return { ok: false, error: 'No se pudo leer la tarjeta.' };
  }
  if (!tarjeta) {
    // Inexistente o de otro comercio: mismo mensaje (no se filtra cuál de los dos).
    return { ok: false, error: 'Esa tarjeta no existe en tu comercio.' };
  }

  const { error: errorLedger } = await supabase
    .from('transacciones_puntos')
    .insert({ tarjeta_id: tarjetaId, puntos_delta: delta });
  if (errorLedger) {
    console.error('[escaner] no se pudo registrar la transacción:', errorLedger);
    return { ok: false, error: 'No se pudo registrar la transacción.' };
  }

  const nuevoSaldo = tarjeta.puntos_actuales + delta;
  const { error: errorUpdate } = await supabase
    .from('tarjetas')
    .update({ puntos_actuales: nuevoSaldo })
    .eq('id', tarjetaId)
    .eq('comercio_id', comercioId);
  if (errorUpdate) {
    console.error('[escaner] no se pudo actualizar el saldo:', errorUpdate);
    return { ok: false, error: 'No se pudo actualizar el saldo.' };
  }

  return { ok: true, puntosActuales: nuevoSaldo };
}

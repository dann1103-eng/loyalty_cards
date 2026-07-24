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

// Atribución opcional del movimiento (Fase 8): en qué sucursal y qué cajero lo registró. Ambos
// nullable — los consumidores del walking skeleton (route/actions/seed) llaman sin opciones y el
// RPC guarda null. La sucursal solo se valida cuando viene: debe ser del comercio y estar activa.
export interface OpcionesAcreditar {
  sucursalId?: string | null;
  cajeroUsuarioId?: string | null;
}

// Suma puntos/sellos de forma ATÓMICA vía el RPC acreditar_puntos_atomico (0009): una sola
// transacción con lock de fila que actualiza el saldo E inserta el ledger (transacciones_puntos)
// con la atribución sucursal/cajero. Reemplaza el patrón read+insert+update no-atómico anterior.
export async function acreditarPuntos(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  tarjetaId: string,
  delta: number,
  opciones?: OpcionesAcreditar,
): Promise<ResultadoAcreditar> {
  if (!Number.isInteger(delta) || delta <= 0 || delta > 1_000_000) {
    return { ok: false, error: 'La cantidad debe ser un número entero mayor que cero.' };
  }

  const { data, error } = await supabase.rpc('acreditar_puntos_atomico', {
    p_comercio_id: comercioId,
    p_tarjeta_id: tarjetaId,
    p_delta: delta,
    p_sucursal_id: opciones?.sucursalId ?? null,
    p_cajero_usuario_id: opciones?.cajeroUsuarioId ?? null,
  });

  // `returns table(...)` → data es un arreglo; la fila de estado es la primera.
  const fila = data?.[0];
  if (error || !fila) {
    console.error('[escaner] no se pudo registrar la transacción:', error);
    return { ok: false, error: 'No se pudo registrar la transacción.' };
  }

  if (fila.estado === 'ok') {
    return { ok: true, puntosActuales: fila.saldo };
  }
  if (fila.estado === 'tarjeta_no_encontrada') {
    // Inexistente o de otro comercio: mismo mensaje (no se filtra cuál de los dos).
    return { ok: false, error: 'Esa tarjeta no existe en tu comercio.' };
  }
  if (fila.estado === 'sucursal_invalida') {
    return { ok: false, error: 'La sucursal no es válida.' };
  }

  // Estado inesperado (no debería ocurrir con el RPC vigente): se trata como fallo genérico.
  console.error('[escaner] estado inesperado del RPC acreditar_puntos_atomico:', fila.estado);
  return { ok: false, error: 'No se pudo registrar la transacción.' };
}

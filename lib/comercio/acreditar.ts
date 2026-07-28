import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { validarMotivo } from './motivo';

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
  // `bloqueoLimite` distingue "una de las perillas antifraude frenó esto" de "algo salió mal".
  // La UI lo necesita para decidir entre mostrar un error rojo y ofrecerle al dueño el panel de
  // autorización: son dos situaciones muy distintas para el que está en el mostrador.
  | { ok: false; error: string; bloqueoLimite?: boolean };

// Atribución opcional del movimiento (Fase 8): en qué sucursal y qué cajero lo registró. Ambos
// nullable — los consumidores del walking skeleton (route/actions/seed) llaman sin opciones y el
// RPC guarda null. La sucursal solo se valida cuando viene: debe ser del comercio y estar activa.
export interface OpcionesAcreditar {
  sucursalId?: string | null;
  cajeroUsuarioId?: string | null;
  // Monto de la compra (Tanda 1). Solo llega si el comercio activó pedir_monto_compra. Es el dato
  // que convierte una sospecha en evidencia: "5 sellos por $2 de compras".
  montoCompra?: number | null;
}

// Mensajes de las cuatro perillas antifraude (migración 0015). Redactados para que sirvan igual en
// una tarjeta de sellos y en una de puntos, porque esta capa no conoce el tipo_tarjeta.
const MENSAJES_LIMITE: Record<string, string> = {
  limite_diario_alcanzado: 'Este cliente ya llegó al máximo permitido por hoy.',
  espera_minima_no_cumplida: 'Todavía es muy pronto para volver a acreditarle a este cliente.',
  techo_puntos_excedido: 'Esa cantidad pasa el máximo permitido en una sola transacción.',
  tope_puntos_dia_alcanzado: 'Este cliente ya llegó al máximo de puntos permitido por hoy.',
};

// Suma puntos/sellos de forma ATÓMICA vía el RPC acreditar_atomico (0015): una sola transacción
// que toma el lock de la tarjeta, aplica las cuatro perillas antifraude, actualiza el saldo E
// inserta el ledger (transacciones_puntos) con la atribución sucursal/cajero.
//
// Llama a acreditar_atomico y NO a acreditar_puntos_atomico: esta última quedó en la 0015 como
// wrapper de compatibilidad de 5 argumentos, para que el código ya desplegado siguiera funcionando
// mientras se aplicaba la migración. No acepta el monto de compra y se borra en una migración
// posterior.
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

  const { data, error } = await supabase.rpc('acreditar_atomico', {
    p_comercio_id: comercioId,
    p_tarjeta_id: tarjetaId,
    p_delta: delta,
    p_sucursal_id: opciones?.sucursalId ?? null,
    p_cajero_usuario_id: opciones?.cajeroUsuarioId ?? null,
    p_monto_compra: opciones?.montoCompra ?? null,
  });

  return interpretar(data, error, 'acreditar_atomico');
}

// Acredita SALTÁNDOSE las perillas, dejando la fila marcada como forzada y con su motivo.
//
// Es un RPC distinto (acreditar_forzado_atomico) y no un parámetro del anterior, y esa separación
// es de seguridad: acreditar_atomico es FÍSICAMENTE incapaz de escribir forzado=true, así que un
// bug en el camino del cajero no puede forzar aunque quiera. El chequeo de que quien llama es el
// dueño vive en el Server Action; este es el segundo candado, independiente.
export async function acreditarForzado(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  tarjetaId: string,
  delta: number,
  motivo: string,
  opciones?: OpcionesAcreditar,
): Promise<ResultadoAcreditar> {
  if (!Number.isInteger(delta) || delta <= 0 || delta > 1_000_000) {
    return { ok: false, error: 'La cantidad debe ser un número entero mayor que cero.' };
  }

  const revision = validarMotivo(motivo, 'la autorización');
  if (!revision.ok) return revision;

  const { data, error } = await supabase.rpc('acreditar_forzado_atomico', {
    p_comercio_id: comercioId,
    p_tarjeta_id: tarjetaId,
    p_delta: delta,
    p_sucursal_id: opciones?.sucursalId ?? null,
    p_cajero_usuario_id: opciones?.cajeroUsuarioId ?? null,
    p_monto_compra: opciones?.montoCompra ?? null,
    p_motivo: revision.motivo,
  });

  return interpretar(data, error, 'acreditar_forzado_atomico');
}

// Traduce la fila de estado del RPC a un ResultadoAcreditar. Compartida por los dos caminos para
// que un estado nuevo no quede mapeado en uno y sin mapear en el otro.
function interpretar(
  data: { estado: string; saldo: number }[] | null,
  error: unknown,
  queRpc: string,
): ResultadoAcreditar {
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
  if (fila.estado === 'motivo_requerido') {
    // El motivo vacío ya se atajó arriba; llegar acá significa que la validación de TS y la del
    // RPC se desincronizaron.
    return { ok: false, error: 'Escribí el motivo de la autorización.' };
  }
  const mensajeLimite = MENSAJES_LIMITE[fila.estado];
  if (mensajeLimite) {
    return { ok: false, error: mensajeLimite, bloqueoLimite: true };
  }

  // Estado inesperado (no debería ocurrir con el RPC vigente): se trata como fallo genérico.
  console.error(`[escaner] estado inesperado del RPC ${queRpc}:`, fila.estado);
  return { ok: false, error: 'No se pudo registrar la transacción.' };
}

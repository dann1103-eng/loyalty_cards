'use server';

import { verifyComercioAcceso } from '@/lib/comercio/verifyComercioAcceso';
import { createServiceClient } from '@/lib/supabase/server';
import { buscarTarjetaPorToken, acreditarPuntos } from '@/lib/comercio/acreditar';
import { canjearRecompensa } from '@/lib/comercio/canje';
import { resolverSucursalDeAccion } from '@/lib/comercio/atribucionEscaner';
import { sucursalPerteneceAComercio } from '@/lib/comercio/sucursales';
import { formatearSaldo } from '@/lib/portal/buscarTarjetas';
import { notificarCambioTarjeta } from '@/lib/apple/notificarCambioTarjeta';
import { syncObjetoTarjeta } from '@/lib/google/syncObjeto';

export interface RecompensaEscaner {
  id: string;
  nombre: string;
  costoPuntos: number;
}

export interface ResultadoEscaneo {
  encontrado: boolean;
  tarjetaId?: string;
  nombreCliente?: string;
  telefono?: string | null;
  puntosActuales?: number;
  saldoTexto?: string;
  esSellos?: boolean;
  recompensas?: RecompensaEscaner[];
}

// Resuelve un QR escaneado (o pegado desde /comercio/clientes) a la tarjeta del comercio de la
// sesión, con su saldo formateado y las recompensas activas canjeables. comercio_id SIEMPRE del
// gate — el token es lo único que viene del cliente. Gate COMPARTIDO (owner O cajero): el cajero
// también debe poder buscar la tarjeta que va a acreditar.
export async function accionBuscarPorToken(qrToken: string): Promise<ResultadoEscaneo> {
  const { comercioId } = await verifyComercioAcceso();
  const supabase = createServiceClient();

  const tarjeta = await buscarTarjetaPorToken(supabase, comercioId, qrToken);
  if (!tarjeta) return { encontrado: false };

  const { data: comercio } = await supabase
    .from('comercios')
    .select('tipo_tarjeta, sello_meta')
    .eq('id', comercioId)
    .maybeSingle();

  const { data: recompensas } = await supabase
    .from('recompensas')
    .select('id, nombre, costo_puntos')
    .eq('comercio_id', comercioId)
    .eq('activa', true)
    .order('costo_puntos');

  const tipo = comercio?.tipo_tarjeta ?? 'puntos';
  return {
    encontrado: true,
    tarjetaId: tarjeta.tarjetaId,
    nombreCliente: tarjeta.nombreCliente,
    telefono: tarjeta.telefono,
    puntosActuales: tarjeta.puntosActuales,
    saldoTexto: formatearSaldo(tipo, tarjeta.puntosActuales, comercio?.sello_meta ?? null),
    esSellos: tipo === 'sellos',
    recompensas: (recompensas ?? []).map((r) => ({ id: r.id, nombre: r.nombre, costoPuntos: r.costo_puntos })),
  };
}

export type RespuestaOperacion =
  | { ok: true; puntosActuales: number; saldoTexto: string; mensaje: string }
  | { ok: false; error: string };

async function saldoTextoDe(comercioId: string, puntos: number): Promise<string> {
  const supabase = createServiceClient();
  const { data: comercio } = await supabase
    .from('comercios')
    .select('tipo_tarjeta, sello_meta')
    .eq('id', comercioId)
    .maybeSingle();
  return formatearSaldo(comercio?.tipo_tarjeta ?? 'puntos', puntos, comercio?.sello_meta ?? null);
}

// Solo los campos del gate que necesita la atribución (evita atar el helper al shape completo).
type SesionAtribucion = { rol: string; sucursalId: string | null; comercioId: string };
type SucursalAtribuida = { ok: true; valor: string | null } | { ok: false; error: string };

// Resuelve —server-side— a qué sucursal se atribuye la operación, compartido por acreditar y canjear.
// Para un CAJERO la sucursal la fija su sesión (resolverSucursalDeAccion ignora el valor del cliente);
// para un OWNER es la que eligió en el picker, y SOLO en ese caso se valida que sea de su comercio
// (sucursalPerteneceAComercio). El RPC vuelve a chequear que la sucursal exista y esté activa: doble
// candado. Devuelve el valor ya resuelto (posiblemente null = sin atribución) o un error de rechazo.
async function resolverSucursalAtribuida(
  supabase: ReturnType<typeof createServiceClient>,
  sesion: SesionAtribucion,
  sucursalIdCliente: string | null,
): Promise<SucursalAtribuida> {
  const sucursalId = resolverSucursalDeAccion(sesion.rol, sesion.sucursalId, sucursalIdCliente);
  if (sesion.rol === 'owner' && sucursalId !== null) {
    const pertenece = await sucursalPerteneceAComercio(supabase, sucursalId, sesion.comercioId);
    if (!pertenece) return { ok: false, error: 'Esa sucursal no es de tu comercio.' };
  }
  return { ok: true, valor: sucursalId };
}

// Suma sellos/puntos a la tarjeta escaneada y empuja la actualización al pass del cliente. Gate
// COMPARTIDO (owner O cajero). La atribución (sucursal + cajero) se arma acá, en el servidor, NUNCA
// se confía en el cliente para ella: resolverSucursalDeAccion fuerza la sucursal de la sesión para
// un cajero, y el cajero_usuario_id sale SIEMPRE de sesion.usuarioComercioId.
export async function accionAcreditar(
  tarjetaId: string,
  delta: number,
  sucursalIdCliente: string | null,
): Promise<RespuestaOperacion> {
  const sesion = await verifyComercioAcceso();
  const supabase = createServiceClient();

  const atribucion = await resolverSucursalAtribuida(supabase, sesion, sucursalIdCliente);
  if (atribucion.ok === false) return { ok: false, error: atribucion.error };

  const res = await acreditarPuntos(supabase, sesion.comercioId, tarjetaId, delta, {
    sucursalId: atribucion.valor,
    cajeroUsuarioId: sesion.usuarioComercioId,
  });
  if (!res.ok) return { ok: false, error: res.error };

  // El pass del cliente se refresca solo (mismo push que usa el cambio de branding).
  await notificarCambioTarjeta(supabase, tarjetaId);
  await syncObjetoTarjeta(supabase, tarjetaId);

  return {
    ok: true,
    puntosActuales: res.puntosActuales,
    saldoTexto: await saldoTextoDe(sesion.comercioId, res.puntosActuales),
    mensaje: delta === 1 ? 'Sello agregado.' : `${delta} puntos agregados.`,
  };
}

// Canjea una recompensa: descuenta el costo y deja el registro en el historial de canjes. Gate
// COMPARTIDO (owner O cajero) y misma atribución server-side que accionAcreditar.
export async function accionCanjear(
  tarjetaId: string,
  recompensaId: string,
  sucursalIdCliente: string | null,
): Promise<RespuestaOperacion> {
  const sesion = await verifyComercioAcceso();
  const supabase = createServiceClient();

  const atribucion = await resolverSucursalAtribuida(supabase, sesion, sucursalIdCliente);
  if (atribucion.ok === false) return { ok: false, error: atribucion.error };

  const res = await canjearRecompensa(supabase, sesion.comercioId, tarjetaId, recompensaId, {
    sucursalId: atribucion.valor,
    cajeroUsuarioId: sesion.usuarioComercioId,
  });
  if (!res.ok) return { ok: false, error: res.error };

  await notificarCambioTarjeta(supabase, tarjetaId);
  await syncObjetoTarjeta(supabase, tarjetaId);

  return {
    ok: true,
    puntosActuales: res.puntosActuales,
    saldoTexto: await saldoTextoDe(sesion.comercioId, res.puntosActuales),
    mensaje: `Canjeado: ${res.nombreRecompensa}. Entregá el premio al cliente.`,
  };
}

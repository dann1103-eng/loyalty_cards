'use server';

import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { buscarTarjetaPorToken, acreditarPuntos } from '@/lib/comercio/acreditar';
import { canjearRecompensa } from '@/lib/comercio/canje';
import { formatearSaldo } from '@/lib/portal/buscarTarjetas';
import { notificarCambioTarjeta } from '@/lib/apple/notificarCambioTarjeta';

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
// gate — el token es lo único que viene del cliente.
export async function accionBuscarPorToken(qrToken: string): Promise<ResultadoEscaneo> {
  const { comercioId } = await verifyComercioOwner();
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

// Suma sellos/puntos a la tarjeta escaneada y empuja la actualización al pass del cliente.
export async function accionAcreditar(tarjetaId: string, delta: number): Promise<RespuestaOperacion> {
  const { comercioId } = await verifyComercioOwner();
  const supabase = createServiceClient();

  const res = await acreditarPuntos(supabase, comercioId, tarjetaId, delta);
  if (!res.ok) return { ok: false, error: res.error };

  // El pass del cliente se refresca solo (mismo push que usa el cambio de branding).
  await notificarCambioTarjeta(supabase, tarjetaId);

  return {
    ok: true,
    puntosActuales: res.puntosActuales,
    saldoTexto: await saldoTextoDe(comercioId, res.puntosActuales),
    mensaje: delta === 1 ? 'Sello agregado.' : `${delta} puntos agregados.`,
  };
}

// Canjea una recompensa: descuenta el costo y deja el registro en el historial de canjes.
export async function accionCanjear(tarjetaId: string, recompensaId: string): Promise<RespuestaOperacion> {
  const { comercioId } = await verifyComercioOwner();
  const supabase = createServiceClient();

  const res = await canjearRecompensa(supabase, comercioId, tarjetaId, recompensaId);
  if (!res.ok) return { ok: false, error: res.error };

  await notificarCambioTarjeta(supabase, tarjetaId);

  return {
    ok: true,
    puntosActuales: res.puntosActuales,
    saldoTexto: await saldoTextoDe(comercioId, res.puntosActuales),
    mensaje: `Canjeado: ${res.nombreRecompensa}. Entregá el premio al cliente.`,
  };
}

import type { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

export interface RegistrarClienteResult {
  clienteId: string;
  tarjetaId: string;
  qrToken: string;
  esNuevoCliente: boolean;
  esNuevaTarjeta: boolean;
}

export async function registrarCliente(
  supabase: SupabaseClient,
  comercioId: string,
  nombre: string,
  telefono: string,
): Promise<RegistrarClienteResult> {
  const { data: clienteExistente, error: buscarClienteError } = await supabase
    .from('clientes')
    .select('id')
    .eq('telefono', telefono)
    .maybeSingle();
  if (buscarClienteError) throw buscarClienteError;

  let clienteId: string;
  let esNuevoCliente = false;

  if (clienteExistente) {
    clienteId = clienteExistente.id;
  } else {
    const { data: nuevoCliente, error: crearClienteError } = await supabase
      .from('clientes')
      .insert({ nombre, telefono })
      .select('id')
      .single();
    if (crearClienteError) throw crearClienteError;
    clienteId = nuevoCliente.id;
    esNuevoCliente = true;
  }

  const { data: tarjetaExistente, error: buscarTarjetaError } = await supabase
    .from('tarjetas')
    .select('id, qr_token')
    .eq('cliente_id', clienteId)
    .eq('comercio_id', comercioId)
    .maybeSingle();
  if (buscarTarjetaError) throw buscarTarjetaError;

  if (tarjetaExistente) {
    return {
      clienteId,
      tarjetaId: tarjetaExistente.id,
      qrToken: tarjetaExistente.qr_token,
      esNuevoCliente,
      esNuevaTarjeta: false,
    };
  }

  const qrToken = crypto.randomBytes(16).toString('hex');
  const { data: nuevaTarjeta, error: crearTarjetaError } = await supabase
    .from('tarjetas')
    .insert({ cliente_id: clienteId, comercio_id: comercioId, qr_token: qrToken })
    .select('id, qr_token')
    .single();
  if (crearTarjetaError) throw crearTarjetaError;

  return {
    clienteId,
    tarjetaId: nuevaTarjeta.id,
    qrToken: nuevaTarjeta.qr_token,
    esNuevoCliente,
    esNuevaTarjeta: true,
  };
}

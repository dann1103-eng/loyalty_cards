import type { SupabaseClient } from '@supabase/supabase-js';

export interface RegistrarClienteResult {
  clienteId: string;
  tarjetaId: string;
  qrToken: string;
  esNuevoCliente: boolean;
  esNuevaTarjeta: boolean;
}

// Semántica de `nombre`: si el cliente ya existe (búsqueda por teléfono), su nombre NO se
// actualiza — gana el primer registro (el spec define la búsqueda por teléfono; no define
// semántica de actualización).
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
    if (crearClienteError) {
      // 23505 = unique_violation: un registro concurrente creó el cliente entre nuestra
      // búsqueda y nuestro insert. Releemos por teléfono y convergemos en esa identidad.
      if (crearClienteError.code !== '23505') throw crearClienteError;
      const { data: clienteGanador, error: relecturaClienteError } = await supabase
        .from('clientes')
        .select('id')
        .eq('telefono', telefono)
        .maybeSingle();
      if (relecturaClienteError) throw relecturaClienteError;
      if (!clienteGanador) throw crearClienteError;
      clienteId = clienteGanador.id;
    } else {
      clienteId = nuevoCliente.id;
      esNuevoCliente = true;
    }
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

  // qr_token lo genera la base de datos: default encode(gen_random_bytes(16), 'hex')
  // (migración 0001); aquí solo lo leemos de vuelta.
  const { data: nuevaTarjeta, error: crearTarjetaError } = await supabase
    .from('tarjetas')
    .insert({ cliente_id: clienteId, comercio_id: comercioId })
    .select('id, qr_token')
    .single();
  if (crearTarjetaError) {
    // Misma carrera que arriba, ahora sobre el unique (cliente_id, comercio_id):
    // recuperamos la tarjeta que ganó y conservamos su qr_token ya emitido.
    if (crearTarjetaError.code !== '23505') throw crearTarjetaError;
    const { data: tarjetaGanadora, error: relecturaTarjetaError } = await supabase
      .from('tarjetas')
      .select('id, qr_token')
      .eq('cliente_id', clienteId)
      .eq('comercio_id', comercioId)
      .maybeSingle();
    if (relecturaTarjetaError) throw relecturaTarjetaError;
    if (!tarjetaGanadora) throw crearTarjetaError;
    return {
      clienteId,
      tarjetaId: tarjetaGanadora.id,
      qrToken: tarjetaGanadora.qr_token,
      esNuevoCliente,
      esNuevaTarjeta: false,
    };
  }

  return {
    clienteId,
    tarjetaId: nuevaTarjeta.id,
    qrToken: nuevaTarjeta.qr_token,
    esNuevoCliente,
    esNuevaTarjeta: true,
  };
}

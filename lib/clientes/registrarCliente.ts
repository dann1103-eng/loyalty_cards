import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { hoyEnZona, vencimientoInicialCupon } from '../tarjetas/vigencia';

export interface RegistrarClienteResult {
  clienteId: string;
  tarjetaId: string;
  qrToken: string;
  esNuevoCliente: boolean;
  esNuevaTarjeta: boolean;
}

// Qué fecha de vencimiento le toca a la tarjeta que se está por emitir. Solo el tipo `cupon` tiene
// una; el resto nace en null (la membresía la estrena su primera renovación, y los tipos con
// contador no usan la columna).
//
// BEST-EFFORT deliberado: si la lectura falla, la tarjeta se emite igual con `null`. Un cliente sin
// tarjeta es peor que un cupón sin vencimiento, y el error queda en el log para que se vea.
async function vigenciaInicial(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  programaId: string,
): Promise<string | null> {
  const { data: programa, error } = await supabase
    .from('programas_tarjeta')
    .select('tipo_tarjeta, cupon_vigencia_dias')
    .eq('id', programaId)
    .eq('comercio_id', comercioId)
    .maybeSingle();

  if (error) {
    console.error('[registro] no se pudo leer el programa para la vigencia del cupón:', error);
    return null;
  }
  if (!programa || programa.tipo_tarjeta !== 'cupon') return null;

  // La zona del comercio y no la del servidor: un cupón emitido a las 7 de la tarde en El Salvador
  // ya es del día siguiente en UTC, y esa diferencia le regala o le quita un día al cliente.
  const { data: comercio } = await supabase
    .from('comercios')
    .select('zona_horaria')
    .eq('id', comercioId)
    .maybeSingle();

  return vencimientoInicialCupon(hoyEnZona(comercio?.zona_horaria ?? null), programa.cupon_vigencia_dias);
}

// Semántica de `nombre`: si el cliente ya existe (búsqueda por teléfono), su nombre NO se
// actualiza — gana el primer registro (el spec define la búsqueda por teléfono; no define
// semántica de actualización).
//
// `comercioId` y `programaId` viajan los DOS (migración 0024): el segundo identifica el programa
// concreto (para el nuevo unique y para qué motor le corresponde a la tarjeta), pero
// `tarjetas.comercio_id` sigue siendo una columna propia — el caller ya resolvió el programa
// (resolverProgramaPorSlug) y de ahí sale el comercioId, así que pasar ambos evita releerlo acá.
export async function registrarCliente(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  programaId: string,
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

  // Migración 0024: la unicidad es (cliente_id, programa_id), no (cliente_id, comercio_id) — un
  // cliente puede tener una tarjeta de "Sellos" Y otra de "Cupón de bienvenida" en el MISMO
  // comercio, siempre que sean programas distintos.
  const { data: tarjetaExistente, error: buscarTarjetaError } = await supabase
    .from('tarjetas')
    .select('id, qr_token')
    .eq('cliente_id', clienteId)
    .eq('programa_id', programaId)
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

  // Un cupón nace con su fecha de vencimiento (0018: "cuántos días vale desde que el cliente se
  // registra"). Se resuelve ACÁ y no en el caller para que ningún camino de alta futuro pueda
  // olvidárselo: una tarjeta de cupón sin `vigencia_hasta` es canjeable para siempre, y el número
  // que el dueño configuró en Programas no valdría nada. Ver lib/tarjetas/tiposFuncionales.test.ts.
  const vigenciaHasta = await vigenciaInicial(supabase, comercioId, programaId);

  // qr_token lo genera la base de datos: default encode(gen_random_bytes(16), 'hex')
  // (migración 0001); aquí solo lo leemos de vuelta.
  const { data: nuevaTarjeta, error: crearTarjetaError } = await supabase
    .from('tarjetas')
    .insert({
      cliente_id: clienteId,
      comercio_id: comercioId,
      programa_id: programaId,
      // null en todo tipo que no sea cupón, que es el default de la columna: se pasa explícito para
      // que el insert sea uno solo y no dos ramas que puedan divergir.
      vigencia_hasta: vigenciaHasta,
    })
    .select('id, qr_token')
    .single();
  if (crearTarjetaError) {
    // Misma carrera que arriba, ahora sobre el unique (cliente_id, programa_id):
    // recuperamos la tarjeta que ganó y conservamos su qr_token ya emitido.
    if (crearTarjetaError.code !== '23505') throw crearTarjetaError;
    const { data: tarjetaGanadora, error: relecturaTarjetaError } = await supabase
      .from('tarjetas')
      .select('id, qr_token')
      .eq('cliente_id', clienteId)
      .eq('programa_id', programaId)
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

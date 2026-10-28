import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { hoyEnZona, vencimientoInicialCupon } from '../tarjetas/vigencia';

export interface RegistrarClienteResult {
  clienteId: string;
  tarjetaId: string;
  qrToken: string;
  esNuevoCliente: boolean;
  esNuevaTarjeta: boolean;
  // Cuántos sellos de regalo trajo la tarjeta al nacer (0043). Es lo que devolvió emitir_tarjeta, y
  // 0 en los DOS caminos de tarjeta que ya existía (la que se encontró y la que ganó la carrera):
  // el regalo se da UNA vez, cuando nace la tarjeta, y quien vuelve a registrarse no recibe nada.
  // Lo lee la pantalla de "Tu tarjeta está lista", que solo menciona el regalo si de verdad llegó.
  sellosRegalo: number;
  // El saldo REAL de la tarjeta (`tarjetas.puntos_actuales`) en este momento: en una tarjeta nueva es
  // con lo que nació (el regalo que devolvió emitir_tarjeta, o 0), y en las DOS rutas de tarjeta que ya
  // existía es lo que esa tarjeta tiene hoy. Es DISTINTO de `sellosRegalo`: quien vuelve a registrarse
  // con 7 sellos recibe `sellosRegalo: 0` (no ganó nada ahora) pero su tarjeta vale 7, y la tarjeta de
  // muestra de "Tu tarjeta está lista" tiene que decir lo mismo que el pase que se va a instalar. Lo
  // mismo para quien pierde una carrera entre dos pestañas: la tarjeta que ganó ya tiene su regalo.
  puntosActuales: number;
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

// Deja la tarjeta EMITIBLE como pase de Apple. Sin `apple_serial_number`, la ruta
// /api/tarjetas/<id>/pass.pkpass responde 404: el cliente encuentra su tarjeta en el portal pero el
// botón de agregarla a la billetera no hace nada.
//
// Vivía en `app/api/registro/route.ts`, o sea en el ÚNICO llamador. Mientras hubo uno solo no se
// notó — pero cualquier camino de alta nuevo (dar de alta a un cliente de delivery desde el panel,
// por ejemplo) habría emitido tarjetas imposibles de instalar, y el dueño no tendría cómo
// diagnosticarlo. Es el mismo patrón que ya apareció con `sello_meta` y con la vigencia del cupón:
// un paso imprescindible que vive en quien llama en vez de en lo llamado.
//
// El guard `.is('apple_serial_number', null)` hace dos cosas: es idempotente (una tarjeta ya
// inicializada matchea 0 filas y NUNCA se le pisa un token ya emitido, lo que sería seguro incluso
// ante concurrencia porque el WHERE se re-evalúa tras el commit del otro escritor) y auto-repara una
// tarjeta que quedó a medias por un fallo anterior.
//
// BEST-EFFORT: un fallo acá no cancela el alta. El cliente prefiere tener su tarjeta y reintentar la
// instalación —el próximo registro la repara— antes que quedarse sin tarjeta.
async function inicializarApple(
  supabase: SupabaseClient<Database>,
  tarjetaId: string,
): Promise<void> {
  const { error } = await supabase
    .from('tarjetas')
    .update({
      apple_auth_token: crypto.randomBytes(16).toString('hex'),
      apple_serial_number: tarjetaId,
    })
    .eq('id', tarjetaId)
    .is('apple_serial_number', null);
  if (error) {
    console.error('[registro] la tarjeta quedó sin poder emitirse como pase:', tarjetaId, error);
  }
}

// Semántica de `nombre`: si el cliente ya existe (búsqueda por teléfono), su nombre NO se
// actualiza — gana el primer registro (el spec define la búsqueda por teléfono; no define
// semántica de actualización).
//
// `apellido` (0036) sigue la MISMA regla: se escribe solo al CREAR el cliente. Un cliente que ya
// existe no lo recibe ni siquiera si lo tiene vacío (decisión 6 del spec del 2026-09-17):
// completarlo dejaría que cualquiera que conozca un teléfono le escriba un apellido a otra persona,
// y ese apellido se vería en su tarjeta de TODOS los comercios.
//
// Es obligatorio en la firma (y no opcional) para que cada llamador decida: el registro público lo
// exige, el alta por teléfono del panel no. Llega YA LIMPIO —recortado, y null si quedó vacío—
// porque la columna tiene un CHECK (`btrim(apellido) <> ''`): un '' que llegara acá tumbaría el
// alta entera con 23514.
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
  apellido: string | null,
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
      .insert({ nombre, apellido, telefono })
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
    .select('id, qr_token, puntos_actuales')
    .eq('cliente_id', clienteId)
    .eq('programa_id', programaId)
    .maybeSingle();
  if (buscarTarjetaError) throw buscarTarjetaError;

  if (tarjetaExistente) {
    await inicializarApple(supabase, tarjetaExistente.id);
    return {
      clienteId,
      tarjetaId: tarjetaExistente.id,
      qrToken: tarjetaExistente.qr_token,
      esNuevoCliente,
      esNuevaTarjeta: false,
      sellosRegalo: 0,
      puntosActuales: tarjetaExistente.puntos_actuales,
    };
  }

  // Un cupón nace con su fecha de vencimiento (0018: "cuántos días vale desde que el cliente se
  // registra"). Se resuelve ACÁ y no en el caller para que ningún camino de alta futuro pueda
  // olvidárselo: una tarjeta de cupón sin `vigencia_hasta` es canjeable para siempre, y el número
  // que el dueño configuró en Programas no valdría nada. Ver lib/tarjetas/tiposFuncionales.test.ts.
  const vigenciaHasta = await vigenciaInicial(supabase, comercioId, programaId);

  // La tarjeta se emite con la función emitir_tarjeta (0043) y no con un insert: la tarjeta y su
  // regalo de bienvenida tienen que nacer en UNA sola transacción. Dos escrituras desde acá (el
  // insert con el saldo inicial y la fila del ledger) podían dejar una tarjeta con sellos que el
  // historial no explica, y el historial es lo que mira el dueño cuando un cliente reclama.
  //
  // El regalo NO viaja por parámetro: la función lo lee del programa, y solo si es de sellos. Así
  // este llamador no puede regalar de más, y no hay que acordarse de preguntarle nada al programa.
  // qr_token lo genera la base de datos (default encode(gen_random_bytes(16), 'hex'), migración
  // 0001); la función lo devuelve y aquí solo lo leemos.
  //
  // `vigencia_hasta` null en todo tipo que no sea cupón, que es el default de la columna: se pasa
  // explícito para que la emisión sea una sola y no dos ramas que puedan divergir.
  const { data: filasEmitidas, error: crearTarjetaError } = await supabase.rpc('emitir_tarjeta', {
    p_comercio_id: comercioId,
    p_programa_id: programaId,
    p_cliente_id: clienteId,
    p_vigencia_hasta: vigenciaHasta,
  });
  if (crearTarjetaError) {
    // Misma carrera que arriba, ahora sobre el unique (cliente_id, programa_id): la función lanza
    // 23505 cuando el insert de la tarjeta choca, y PostgREST devuelve ese SQLSTATE en `code` igual
    // que con un insert directo. Como la excepción aborta la función entera, no queda ningún regalo
    // suelto: recuperamos la tarjeta que ganó (que ya recibió el suyo) y conservamos su qr_token.
    if (crearTarjetaError.code !== '23505') throw crearTarjetaError;
    const { data: tarjetaGanadora, error: relecturaTarjetaError } = await supabase
      .from('tarjetas')
      .select('id, qr_token, puntos_actuales')
      .eq('cliente_id', clienteId)
      .eq('programa_id', programaId)
      .maybeSingle();
    if (relecturaTarjetaError) throw relecturaTarjetaError;
    if (!tarjetaGanadora) throw crearTarjetaError;
    await inicializarApple(supabase, tarjetaGanadora.id);
    return {
      clienteId,
      tarjetaId: tarjetaGanadora.id,
      qrToken: tarjetaGanadora.qr_token,
      esNuevoCliente,
      esNuevaTarjeta: false,
      sellosRegalo: 0,
      puntosActuales: tarjetaGanadora.puntos_actuales,
    };
  }

  // Una función `returns table` llega como arreglo, aunque devuelva una sola fila. Sin fila, algo
  // salió mal en la base sin lanzar nada: no se inventa una tarjeta.
  const nuevaTarjeta = filasEmitidas?.[0];
  if (!nuevaTarjeta) throw new Error('emitir_tarjeta no devolvió la tarjeta emitida');

  await inicializarApple(supabase, nuevaTarjeta.id_tarjeta);

  return {
    clienteId,
    tarjetaId: nuevaTarjeta.id_tarjeta,
    qrToken: nuevaTarjeta.token_qr,
    esNuevoCliente,
    esNuevaTarjeta: true,
    sellosRegalo: nuevaTarjeta.sellos_regalados,
    // La tarjeta recién nació: su saldo ES el regalo con el que la creó la función (0 si no regala).
    puntosActuales: nuevaTarjeta.sellos_regalados,
  };
}

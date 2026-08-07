import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { normalizarTelefono } from '../clientes/normalizarTelefono';
import { registrarCliente } from '../clientes/registrarCliente';
import { acreditarPuntos, type OpcionesAcreditar } from './acreditar';
import { obtenerPrograma } from './programas';
import { tipoOPuntos, describirSaldo } from '../tarjetas/tipos';
import { describirCosto } from '../tarjetas/unidadPrograma';

// Dar de alta y acreditar por TELÉFONO, desde el panel del comercio.
//
// ══ QUÉ PROBLEMA RESUELVE ══
// `registrarCliente` tenía UN solo llamador: el formulario que abre el cliente después de escanear
// el QR del local. O sea que un comercio no podía darle una tarjeta a alguien que no estaba parado
// enfrente — y el cliente que pide a domicilio nunca lo está.
//
// Es la v1 del spec de delivery (specs/2026-08-07-puntos-por-delivery-design.md). Cubre los pedidos
// donde el comercio SÍ sabe quién compró —llamada, WhatsApp, app propia, apps de delivery que
// comparten el número—, que son la mayoría. El código al portador resuelve el otro caso, el del
// cliente anónimo, y es otra feature con otro riesgo.
//
// ══ POR QUÉ REUSA acreditarPuntos ══
// No es ahorro de tipeo: es lo que hace que una acreditación por delivery herede la atribución de
// sucursal y cajero, el asiento en el ledger y los CUATRO controles antifraude de la Tanda 1. Un
// update propio sería una puerta trasera al tope diario — exactamente lo que esos controles vinieron
// a cerrar. Mismo criterio que `venderPaquete`.

export interface DatosAltaPorTelefono {
  telefono: string;
  // Prefijo de país del selector, si la pantalla lo ofrece. Ausente ⇒ el default de
  // normalizarTelefono, que es el mismo comportamiento del registro público.
  clavePais?: string;
  nombre: string;
  programaId: string;
  // En la unidad del programa. OJO: en gift card y cashback son CENTAVOS, como en todo el resto del
  // sistema (ver el encabezado de lib/tarjetas/tipos.ts).
  cantidad: number;
}

export type ResultadoAltaPorTelefono =
  | { ok: true; tarjetaId: string; esNuevaTarjeta: boolean; puntosActuales: number; mensaje: string }
  | { ok: false; error: string; bloqueoLimite?: boolean };

export async function altaYAcreditacionPorTelefono(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  datos: DatosAltaPorTelefono,
  opciones?: OpcionesAcreditar,
): Promise<ResultadoAltaPorTelefono> {
  const nombre = datos.nombre.trim();
  if (!nombre) return { ok: false, error: 'Escribí el nombre del cliente.' };

  if (!Number.isInteger(datos.cantidad) || datos.cantidad <= 0) {
    return { ok: false, error: 'La cantidad tiene que ser un número entero mayor que cero.' };
  }

  // El programa se lee ANTES de tocar nada: `obtenerPrograma` está scopeado por comercio_id, así
  // que conocer el id de un programa ajeno no alcanza para acreditar en él.
  const programa = await obtenerPrograma(supabase, comercioId, datos.programaId);
  if (!programa) return { ok: false, error: 'Esa tarjeta no es de tu comercio.' };
  if (!programa.activo) {
    // Dar de alta en un programa desactivado deja al cliente con una tarjeta que nadie más puede
    // sacar y que el dueño ya decidió no ofrecer.
    return { ok: false, error: `“${programa.nombre}” está desactivado. Activalo o elegí otra tarjeta.` };
  }

  const tipo = tipoOPuntos(programa.tipoTarjeta);
  if (tipo.contador === 'ninguno') {
    // Cupón, membresía y descuento: su estado es una fecha o un nivel, no un número. Acreditar acá
    // movería una columna que ninguna pantalla lee, y el dueño creería que le dio algo a su cliente.
    return {
      ok: false,
      error: `Una tarjeta de ${tipo.etiqueta.toLowerCase()} no acumula: se usa desde el escáner, con el cliente presente.`,
    };
  }

  // try/catch obligatorio: `clientes.telefono` se guarda SIEMPRE canónico, y normalizarTelefono
  // LANZA con un formato irreconocible. Sin esto, un número mal dictado tumba la pantalla en vez de
  // devolver un mensaje; y sin normalizar, el mismo cliente tecleado de dos formas distintas
  // terminaría con dos tarjetas y los sellos partidos en dos.
  let telefonoCanonico: string;
  try {
    telefonoCanonico = normalizarTelefono(datos.telefono, datos.clavePais);
  } catch {
    return { ok: false, error: 'Ese teléfono no se entiende. Escribilo con 8 dígitos, por ejemplo 7777-1234.' };
  }

  // registrarCliente es idempotente por (cliente, programa): si ese teléfono ya tiene su tarjeta,
  // devuelve la que existe en vez de crear una segunda. Y desde el 2026-08-07 deja la tarjeta
  // instalable (serial + token de Apple), así que la que nace por acá sirve igual que la del QR.
  const alta = await registrarCliente(supabase, comercioId, programa.id, nombre, telefonoCanonico);

  const res = await acreditarPuntos(supabase, comercioId, alta.tarjetaId, datos.cantidad, opciones);
  if (!res.ok) {
    // La tarjeta YA quedó creada aunque la acreditación se haya bloqueado, y está bien: el cliente
    // existe y el dueño puede acreditarle después (o autorizarlo, si fue una perilla antifraude).
    // Borrarla sería peor — le quitaría la tarjeta a alguien que ya la tiene.
    return { ok: false, error: res.error, bloqueoLimite: res.bloqueoLimite };
  }

  // Los dos textos salen de los módulos compartidos: `describirCosto` dice cuánto se acreditó en la
  // moneda del programa ("1 sello", "$2.50") y `describirSaldo` cómo queda. `describirSaldo` no
  // necesita fecha ni nivel acá porque los tipos que los usan ya se rechazaron arriba, y por eso
  // recibe hoyIso vacío.
  const acreditado = describirCosto(programa.tipoTarjeta, datos.cantidad);
  const queda = describirSaldo(
    { tipo: programa.tipoTarjeta, contador: res.puntosActuales, selloMeta: programa.selloMeta },
    '',
  );

  return {
    ok: true,
    tarjetaId: alta.tarjetaId,
    esNuevaTarjeta: alta.esNuevaTarjeta,
    puntosActuales: res.puntosActuales,
    mensaje: alta.esNuevaTarjeta
      ? `Listo: ${nombre} ya tiene su tarjeta con ${acreditado}. Ahora tiene ${queda}.`
      : `Listo: le acreditaste ${acreditado} a ${nombre}. Ahora tiene ${queda}.`,
  };
}

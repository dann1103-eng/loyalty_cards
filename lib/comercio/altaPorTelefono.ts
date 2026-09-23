import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { normalizarTelefono } from '../clientes/normalizarTelefono';
import { registrarCliente } from '../clientes/registrarCliente';
import { acreditarPuntos, type OpcionesAcreditar } from './acreditar';
import { obtenerPrograma } from './programas';
import { leerReglaDeMonto, validarMontoAcreditacion, type ResultadoMontoAcreditacion } from './montoAcreditacion';
import { tipoOPuntos, describirSaldo, aplicaReglaDeMonto } from '../tarjetas/tipos';
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
  // OPCIONAL, a diferencia del registro público: quien toma un pedido por teléfono muchas veces solo
  // sabe el nombre, y exigirlo sería obligarlo a inventar uno. Ausente o en blanco ⇒ null.
  apellido?: string;
  programaId: string;
  // En la unidad del programa. OJO: en gift card y cashback son CENTAVOS, como en todo el resto del
  // sistema (ver el encabezado de lib/tarjetas/tipos.ts).
  cantidad: number;
  // Monto de la compra, en CENTAVOS (regla de monto mínimo, migración 0039,
  // lib/comercio/montoAcreditacion.ts). OPCIONAL a propósito: ausente o null significa que no vino
  // ningún monto, así los llamadores y pruebas que existían antes de esta regla siguen compilando
  // sin tocarlas. Con la regla del comercio activa para el tipo del programa elegido
  // (aplicaReglaDeMonto), un monto ausente se rechaza como "falta el monto" — decisión 7 de la
  // spec: sin esto, "Agregar cliente" sería el camino para esquivar el mínimo que el escáner ya
  // exige (Tarea 5).
  montoCompraCentavos?: number | null;
}

export type ResultadoAltaPorTelefono =
  | { ok: true; tarjetaId: string; esNuevaTarjeta: boolean; puntosActuales: number; mensaje: string }
  | { ok: false; error: string; bloqueoLimite?: boolean };

export async function altaYAcreditacionPorTelefono(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  datos: DatosAltaPorTelefono,
  // Sin 'montoCompra': esta función ya tiene su PROPIO canal para el monto (datos.
  // montoCompraCentavos, arriba), calculado desde la regla del comercio y no desde lo que mande el
  // llamador. Si `opciones` admitiera montoCompra, un `{ ...opciones, montoCompra: ... }` más abajo
  // pisaría en silencio cualquier valor que el llamador hubiera puesto ahí — un solo canal para el
  // monto, sin una segunda puerta que se pueda ignorar por accidente.
  opciones?: Omit<OpcionesAcreditar, 'montoCompra'>,
): Promise<ResultadoAltaPorTelefono> {
  const nombre = datos.nombre.trim();
  if (!nombre) return { ok: false, error: 'Escribí el nombre del cliente.' };

  // Se limpia ACÁ y no en registrarCliente, que lo recibe ya limpio: `clientes.apellido` tiene un
  // CHECK (0036) de `btrim(apellido) <> ''` y hasta 120, y lo que no entre tumbaría el alta entera
  // con 23514 en vez de devolverle un mensaje al dueño. Por eso un blanco viaja como null, y el tope
  // se revisa antes de crear nada.
  const apellido = (datos.apellido ?? '').trim() || null;
  if (apellido !== null && apellido.length > 120) {
    return { ok: false, error: 'El apellido puede tener hasta 120 caracteres.' };
  }

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

  // Regla de monto obligatorio / mínimo de compra del comercio (migración 0039,
  // lib/comercio/montoAcreditacion.ts). Va DESPUÉS de validar nombre/apellido/cantidad/programa/
  // tipo/teléfono (el orden de arriba, sin tocar) y ANTES de registrarCliente: solo se lee si el
  // TIPO del programa elegido la usa (aplicaReglaDeMonto: puntos y sellos) — en el resto no hay
  // nada que gatear, y leerla sería una consulta de más. Se valida ACÁ, antes de tocar la base, para
  // poder separar los dos pasos de validarMontoAcreditacion: el monto FALTANTE se resuelve
  // tecleando el dato, así que rechaza sin crear nada ("una validación que falla no crea nada",
  // igual que el resto de las validaciones de arriba); el mínimo, en cambio, es un bloqueoLimite que
  // se rechaza recién DESPUÉS de registrarCliente (ver más abajo), con la tarjeta ya creada — mismo
  // contrato que las perillas antifraude: el dueño la autoriza con motivo desde el MISMO panel del
  // escáner (decisión 6 de la spec), y "Agregar cliente" no tiene ese panel. No hace falta leer la
  // regla dos veces: se guarda el resultado de esta única validación y se lo vuelve a mirar después
  // de crear el cliente.
  const montoCentavos = datos.montoCompraCentavos ?? null;
  let chequeoMonto: ResultadoMontoAcreditacion | null = null;
  if (aplicaReglaDeMonto(tipo.valor)) {
    const regla = await leerReglaDeMonto(supabase, comercioId);
    if (regla === null) {
      // Falla CERRADA, igual que el escáner (spec, "La regla, en una función pura"): sin la 0039
      // aplicada, esta lectura SIEMPRE falla, y esta rama rechaza TODA alta de puntos/sellos por
      // teléfono — no es un caso raro, es la medida de lo que rompería publicar sin la migración.
      return { ok: false, error: 'No se pudo verificar la regla de monto. Probá de nuevo.' };
    }
    chequeoMonto = validarMontoAcreditacion({
      exigir: regla.exigir,
      minimoCentavos: regla.minimoCentavos,
      montoCentavos,
      autorizado: false,
    });
    if (!chequeoMonto.ok && !chequeoMonto.bloqueoLimite) {
      // Paso 1 (monto faltante): nada que autorizar sobre una compra que nadie describió.
      return { ok: false, error: chequeoMonto.error };
    }
  }

  // registrarCliente es idempotente por (cliente, programa): si ese teléfono ya tiene su tarjeta,
  // devuelve la que existe en vez de crear una segunda. Y desde el 2026-08-07 deja la tarjeta
  // instalable (serial + token de Apple), así que la que nace por acá sirve igual que la del QR.
  const alta = await registrarCliente(supabase, comercioId, programa.id, nombre, apellido, telefonoCanonico);

  // Paso 2 (mínimo de compra): recién ACÁ, con la tarjeta ya creada. `chequeoMonto` solo puede
  // seguir en `!ok` por el mínimo — el monto faltante ya cortó arriba antes de crear nada.
  if (chequeoMonto && !chequeoMonto.ok) {
    return { ok: false, error: chequeoMonto.error, bloqueoLimite: true };
  }

  const res = await acreditarPuntos(supabase, comercioId, alta.tarjetaId, datos.cantidad, {
    ...opciones,
    // Evidencia del monto en el ledger (transacciones_puntos.monto_compra), en DÓLARES: es el
    // contrato de OpcionesAcreditar (lib/comercio/acreditar.ts:65-67), que este camino hasta ahora
    // no mandaba. Vale aunque la regla no esté activa para este tipo, si vino el monto: acá solo es
    // evidencia, lo que gatea la acreditación es el chequeo de arriba.
    montoCompra: montoCentavos !== null ? montoCentavos / 100 : null,
  });
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

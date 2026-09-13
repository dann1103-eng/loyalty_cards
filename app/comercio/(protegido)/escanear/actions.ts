'use server';

import { verifyComercioAcceso } from '@/lib/comercio/verifyComercioAcceso';
import { createServiceClient } from '@/lib/supabase/server';
import { buscarTarjetaPorToken, acreditarPuntos, acreditadorForzado } from '@/lib/comercio/acreditar';
import { validarMotivo } from '@/lib/comercio/motivo';
import { canjearRecompensa } from '@/lib/comercio/canje';
import { quitarPuntos } from '@/lib/comercio/ajuste';
import { resolverSucursalDeAccion } from '@/lib/comercio/atribucionEscaner';
import { sucursalPerteneceAComercio } from '@/lib/comercio/sucursales';
import { resolverProgramaDeTarjeta } from '@/lib/comercio/programas';
import { notificarCambioTarjeta } from '@/lib/apple/notificarCambioTarjeta';
import { syncObjetoTarjeta } from '@/lib/google/syncObjeto';
import { tipoOPuntos, describirSaldo, centavosDesdeTexto, nivelParaAcumulado, puedeCanjearRecompensas, usaMontoDeCompra, type AccionPrincipal } from '@/lib/tarjetas/tipos';
import { usarCupon, renovarMembresia, hoyEnZona } from '@/lib/tarjetas/vigencia';
import { unidadPrograma, describirCosto, mensajeAcreditacion, type Unidad } from '@/lib/tarjetas/unidadPrograma';
import { usarVisita, venderPaquete } from '@/lib/tarjetas/prepago';
import { acreditarCashback, cargarGiftCard, consumirSaldo } from '@/lib/tarjetas/dinero';
import { registrarCompra, listarNiveles } from '@/lib/tarjetas/descuento';

export interface RecompensaEscaner {
  id: string;
  nombre: string;
  costoPuntos: number;
  costoTexto: string;
  // Foto del premio: ayuda al cajero a identificar qué entregar sin leer el nombre, que en un
  // mostrador con cola es la diferencia entre dos segundos y diez.
  fotoUrl: string | null;
}

export interface ResultadoEscaneo {
  encontrado: boolean;
  tarjetaId?: string;
  nombreCliente?: string;
  telefono?: string | null;
  puntosActuales?: number;
  saldoTexto?: string;
  // Como se llama lo que cuenta ESTE programa. Reemplaza al viejo `esSellos`, que obligaba a cada
  // texto del componente a hacer `esSellos ? sellos : puntos` — y por eso el cajero de un prepago
  // leia "Corregir: quitar puntos" cuando estaba quitando una VISITA. null = este tipo no cuenta
  // enteros (dinero o sin contador), y entonces no hay nada que corregir a mano.
  unidad?: Unidad | null;
  recompensas?: RecompensaEscaner[];
  // Si el comercio activó pedir_monto_compra Y la operación de ESTA tarjeta recibe el monto, el
  // escáner muestra el campo de monto (Tanda 1).
  pedirMontoCompra?: boolean;
  // Mecánica del tipo de tarjeta (migraciones 0018-0023). El escáner dibuja SUS botones a partir de
  // esto en vez de tener un `if` por tipo repartido por el componente.
  tipoTarjeta?: string;
  accionPrincipal?: AccionPrincipal;
  etiquetaAccion?: string;
  // null = este tipo no tiene segunda operación.
  etiquetaSecundaria?: string | null;
  // El monto es obligatorio en cashback, gift card y descuento: sin él no hay porcentaje que
  // calcular, saldo que descontar ni gasto que acumular.
  requiereMonto?: boolean;
  // El contador tiene sentido para el cajero (sellos, visitas, plata) o no existe (cupón, membresía).
  tieneContador?: boolean;
}

// Qué dicen los botones de cada tipo. Viven del lado del SERVIDOR, junto a la lógica que realmente
// ejecuta, para que el texto y la acción no puedan desincronizarse — un botón que dice "Usar cupón"
// y ejecuta otra cosa es peor que uno mal escrito.
const ETIQUETA_PRINCIPAL: Record<string, string> = {
  puntos: 'Sumar puntos',
  sellos: '+1 sello',
  prepago: 'Usar una visita',
  gift_card: 'Cobrar con su saldo',
  cashback: 'Acreditar cashback',
  cupon: 'Usar cupón',
  membresia: 'Renovar membresía',
  descuento: 'Registrar compra',
};

// Solo dos tipos tienen una SEGUNDA operación. El resto no muestra este botón.
const ETIQUETA_SECUNDARIA: Record<string, string> = {
  gift_card: 'Cargar saldo',
  prepago: 'Vender paquete',
};

// Resuelve un QR escaneado (o pegado desde /comercio/clientes) a la tarjeta del comercio de la
// sesión, con su saldo formateado y las recompensas activas canjeables. comercio_id SIEMPRE del
// gate — el token es lo único que viene del cliente. Gate COMPARTIDO (owner O cajero): el cajero
// también debe poder buscar la tarjeta que va a acreditar.
export async function accionBuscarPorToken(qrToken: string): Promise<ResultadoEscaneo> {
  const { comercioId } = await verifyComercioAcceso();
  const supabase = createServiceClient();

  const tarjeta = await buscarTarjetaPorToken(supabase, comercioId, qrToken);
  if (!tarjeta) return { encontrado: false };

  // El tipo, la config (cashback%, visitas del paquete, …) y la META DE SELLOS salen del PROGRAMA
  // de la tarjeta desde la migración 0024, no del comercio — un comercio puede tener varios
  // programas de tipos distintos a la vez, y la meta es justamente lo que dibuja la grilla del pase.
  // `pedir_monto_compra` SÍ sigue siendo del comercio: es una perilla antifraude (Tanda 1) y es
  // política del local, no del programa.
  const [{ data: comercio }, programa, { data: estado }] = await Promise.all([
    supabase.from('comercios').select('pedir_monto_compra, zona_horaria').eq('id', comercioId).maybeSingle(),
    resolverProgramaDeTarjeta(supabase, comercioId, tarjeta.tarjetaId),
    // Estado propio de los tipos con vigencia o con nivel. Se lee acá y no en buscarTarjetaPorToken
    // para no cargar de columnas el camino que usan los tipos con contador.
    supabase.from('tarjetas').select('vigencia_hasta, usado_en, acumulado_centavos').eq('id', tarjeta.tarjetaId).maybeSingle(),
  ]);

  const tipoValor = programa?.tipoTarjeta ?? 'puntos';
  const tipo = tipoOPuntos(tipoValor);

  // Las recompensas salieron del Promise.all de arriba a propósito: para saber si vale la pena
  // traerlas hay que conocer primero el tipo. Un premio se canjea descontando `puntos_actuales`, y
  // en cupón, membresía y descuento ese contador es 0 para siempre —— el cajero veía el bloque
  // "Canjear recompensa" completo con el botón deshabilitado en TODOS los premios, en la pantalla
  // más usada del mostrador y sin ninguna forma de que eso cambie nunca.
  //
  // El costo es un round-trip en serie en los tipos que sí canjean. Se paga: la alternativa era
  // traer siempre una lista que en tres de los ocho tipos solo sirve para estorbar.
  const recompensas = puedeCanjearRecompensas(tipo.valor)
    ? (
        await supabase
          .from('recompensas')
          .select('id, nombre, costo_puntos, foto_url')
          .eq('comercio_id', comercioId)
          .eq('activa', true)
          .order('costo_puntos')
      ).data
    : null;

  // El nivel de descuento se calcula acá, al leer, nunca se guarda: cambiar los umbrales tiene que
  // reordenar a todos los clientes de inmediato.
  let porcentajeDescuento: number | null = null;
  if (tipo.valor === 'descuento') {
    const niveles = (await listarNiveles(supabase, comercioId)) ?? [];
    porcentajeDescuento = nivelParaAcumulado(Number(estado?.acumulado_centavos ?? 0), niveles);
  }

  // La zona del COMERCIO, no la del servidor. Vercel corre en UTC: a las 7 de la tarde en El
  // Salvador ya es el dia siguiente en UTC, asi que un cupon que vence HOY se leeria "Vencio" en
  // esta pantalla mientras usar_cupon_atomico —que si usa la zona del comercio— lo sigue aceptando.
  // El cajero le diria al cliente que no y el sistema habria dicho que si.
  const hoyIso = hoyEnZona(comercio?.zona_horaria ?? null);

  return {
    encontrado: true,
    tarjetaId: tarjeta.tarjetaId,
    nombreCliente: tarjeta.nombreCliente,
    telefono: tarjeta.telefono,
    puntosActuales: tarjeta.puntosActuales,
    // describirSaldo y no el entero pelado: es EL único lugar que sabe que un 1250 puede ser "$12.50"
    // o "1250 puntos" según el tipo.
    saldoTexto: describirSaldo(
      {
        tipo: tipo.valor,
        contador: tarjeta.puntosActuales,
        selloMeta: programa?.selloMeta ?? null,
        vigenciaHasta: estado?.vigencia_hasta ?? null,
        usadoEn: estado?.usado_en ?? null,
        porcentajeDescuento,
      },
      hoyIso,
    ),
    tipoTarjeta: tipo.valor,
    accionPrincipal: tipo.accionPrincipal,
    etiquetaAccion: ETIQUETA_PRINCIPAL[tipo.valor] ?? 'Acreditar',
    etiquetaSecundaria: ETIQUETA_SECUNDARIA[tipo.valor] ?? null,
    requiereMonto: tipo.requiereMonto,
    tieneContador: tipo.contador !== 'ninguno',
    unidad: unidadPrograma(tipo.valor),
    recompensas: (recompensas ?? []).map((r) => ({
      id: r.id,
      nombre: r.nombre,
      costoPuntos: r.costo_puntos,
      // Ya formateado del lado del SERVIDOR, donde se conoce el tipo: "8 sellos", "$2.50", o vacio
      // en los tipos sin contador. Antes el componente escribia "puntos" a mano.
      costoTexto: describirCosto(tipo.valor, r.costo_puntos),
      fotoUrl: r.foto_url,
    })),
    // La perilla es del comercio, pero el campo es de ESTA tarjeta: un comercio de puntos con la
    // perilla prendida puede tener también un programa de cupón o membresía, cuya operación no
    // recibe monto (ver `usaMontoDeCompra` en lib/tarjetas/tipos.ts). Sin el tipo, el cajero
    // tecleaba sobre el cupón un monto que se descartaba.
    pedirMontoCompra: (comercio?.pedir_monto_compra ?? false) && usaMontoDeCompra(tipo.valor),
  };
}

export type RespuestaOperacion =
  | { ok: true; puntosActuales: number; saldoTexto: string; mensaje: string }
  // `bloqueoLimite` viaja hasta el cliente para que el escáner distinga "una perilla antifraude
  // frenó esto" (⇒ ofrecerle al dueño el panel de autorización) de "algo salió mal" (⇒ error rojo).
  | { ok: false; error: string; bloqueoLimite?: boolean };

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

// (Acá vivía `accionAcreditar`, retirada el 2026-09-13. Nadie la llamaba desde que el escáner pasó a
// accionOperacionPrincipal, pero una Server Action exportada es un endpoint vivo aunque ningún botón
// la use: recibía un `delta` crudo del navegador y lo acreditaba en CUALQUIER tipo de tarjeta —en una
// gift card, centavos arbitrarios sin pasar por cargarGiftCard—. La misma trampa que
// accionAcreditarForzado. Toda acreditación del mostrador entra por ejecutarOperacion, donde cuánto
// vale la operación lo decide el servidor.)

// Qué operación del escáner se intentó, con lo que el cajero TECLEÓ para ella. El cliente dice cuál
// botón apretó; qué hace ese botón lo decide el servidor según el tipo de la tarjeta.
//
// Es también lo que el escáner GUARDA cuando una perilla antifraude bloquea, para que el dueño
// autorice esa misma operación (accionAutorizarOperacion) y no un número suelto.
export type OperacionEscaner =
  | { tipo: 'principal'; cantidad: number; montoTexto: string }
  | { tipo: 'secundaria'; montoTexto: string };

// Autoriza una operación que una perilla antifraude bloqueó, SALTÁNDOSE las perillas. Solo el dueño.
//
// No recibe un delta: recibe QUÉ operación era y la REPITE en el servidor con el escritor forzado
// (ver Acreditador en lib/comercio/acreditar.ts). Corre la misma función que la operación normal
// (ejecutarOperacion), así que las visitas del paquete y el porcentaje de cashback salen del
// PROGRAMA y los centavos salen del monto, exactamente igual. Antes esta acción recibía un `delta`
// crudo que calculaba el navegador y que valía 1 en todo lo que no fuera puntos: el dueño autorizaba
// un paquete de 10 visitas y se acreditaba 1 visita; $25.00 de gift card, 1 centavo. El cliente
// pagaba y recibía casi nada, sin ningún error a la vista.
//
// El gate es verifyComercioAcceso() + chequeo explícito de rol, y NO verifyComercioOwner(): ese
// redirige a un cajero a /comercio/escanear (verifyComercioOwner.ts:24), o sea a la página en la
// que ya está — perdería el resultado del escaneo y navegaría a la misma pantalla sin ninguna
// explicación. Acá le devolvemos un mensaje que puede leer.
//
// Este es el primero de dos candados independientes: el segundo es que el RPC del camino normal
// (acreditar_atomico) es físicamente incapaz de escribir forzado=true.
export async function accionAutorizarOperacion(
  tarjetaId: string,
  operacion: OperacionEscaner,
  motivo: string,
  sucursalIdCliente: string | null,
): Promise<RespuestaOperacion> {
  const sesion = await verifyComercioAcceso();
  if (sesion.rol !== 'owner') {
    return { ok: false, error: 'Solo el dueño puede autorizar una acreditación por encima del límite.' };
  }

  // Antes de tocar nada: sin motivo no hay autorización. acreditarForzado lo vuelve a validar, y el
  // RPC una tercera vez, pero acá el error no depende de hasta dónde llegue cada operación.
  const revision = validarMotivo(motivo, 'la autorización');
  if (!revision.ok) return { ok: false, error: revision.error };

  const res = await ejecutarOperacion(sesion, tarjetaId, sucursalIdCliente, operacion, {
    motivo: revision.motivo,
  });
  if (!res.ok) return { ok: false, error: res.error };

  // El mensaje de la operación va ADENTRO ("Paquete de 10 visitas cargado…"): el dueño lee lo que
  // efectivamente se acreditó, no una confirmación genérica que taparía un monto equivocado.
  return { ...res, mensaje: `Autorizado. ${res.mensaje} Queda registrado en el historial del cliente.` };
}

// Quita sellos/puntos con motivo obligatorio. Gate COMPARTIDO (owner O cajero): el cajero que se
// equivocó tiene que poder corregirlo en el momento, sin esperar al dueño. Queda auditado con su
// nombre, su hora y su motivo, y suma a su columna de "ajustes" en el reporte por cajero.
//
// quitarPuntos SOLO resta (ver lib/comercio/ajuste.ts): si desde acá se pudiera sumar, un cajero
// bloqueado por el tope tendría una puerta trasera y el sistema de límites no valdría nada.
export async function accionQuitar(
  tarjetaId: string,
  cantidad: number,
  motivo: string,
  sucursalIdCliente: string | null,
): Promise<RespuestaOperacion> {
  const sesion = await verifyComercioAcceso();
  const supabase = createServiceClient();

  const atribucion = await resolverSucursalAtribuida(supabase, sesion, sucursalIdCliente);
  if (atribucion.ok === false) return { ok: false, error: atribucion.error };

  const res = await quitarPuntos(supabase, sesion.comercioId, tarjetaId, cantidad, motivo, {
    sucursalId: atribucion.valor,
    cajeroUsuarioId: sesion.usuarioComercioId,
  });
  if (!res.ok) return { ok: false, error: res.error };

  // El saldo cambió: sin esto el pass del cliente sigue mostrando el número viejo.
  await notificarCambioTarjeta(supabase, tarjetaId);
  await syncObjetoTarjeta(supabase, tarjetaId);

  return {
    ok: true,
    puntosActuales: res.puntosActuales,
    saldoTexto: await saldoTextoActual(sesion.comercioId, tarjetaId),
    mensaje: cantidad === 1 ? 'Se quitó 1. Queda registrado.' : `Se quitaron ${cantidad}. Queda registrado.`,
  };
}

// Canjea una recompensa: descuenta el costo y deja el registro en el historial de canjes. Gate
// COMPARTIDO (owner O cajero) y misma atribución server-side que ejecutarOperacion.
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
    saldoTexto: await saldoTextoActual(sesion.comercioId, tarjetaId),
    mensaje: `Canjeado: ${res.nombreRecompensa}. Entregá el premio al cliente.`,
  };
}

// Vuelve a leer el estado completo y lo describe. Se re-lee en vez de calcular el texto a partir de
// lo que devolvió la operación porque cada tipo devuelve una cosa distinta (saldo, fecha, acumulado)
// y armar el texto en siete ramas sería siete oportunidades de mostrar plata equivocada.
async function saldoTextoActual(comercioId: string, tarjetaId: string): Promise<string> {
  const supabase = createServiceClient();
  const [{ data: comercio }, programa, { data: t }] = await Promise.all([
    supabase.from('comercios').select('zona_horaria').eq('id', comercioId).maybeSingle(),
    resolverProgramaDeTarjeta(supabase, comercioId, tarjetaId),
    supabase
      .from('tarjetas')
      .select('puntos_actuales, vigencia_hasta, usado_en, acumulado_centavos')
      .eq('id', tarjetaId)
      .maybeSingle(),
  ]);

  const tipo = tipoOPuntos(programa?.tipoTarjeta ?? 'puntos');
  let porcentaje: number | null = null;
  if (tipo.valor === 'descuento') {
    const niveles = (await listarNiveles(supabase, comercioId)) ?? [];
    porcentaje = nivelParaAcumulado(Number(t?.acumulado_centavos ?? 0), niveles);
  }

  return describirSaldo(
    {
      tipo: tipo.valor,
      contador: t?.puntos_actuales ?? 0,
      selloMeta: programa?.selloMeta ?? null,
      vigenciaHasta: t?.vigencia_hasta ?? null,
      usadoEn: t?.usado_en ?? null,
      porcentajeDescuento: porcentaje,
    },
    hoyEnZona(comercio?.zona_horaria ?? null),
  );
}

// LA acción del escáner. El cliente manda lo que TECLEÓ (cantidad, monto); el SERVIDOR decide qué
// operación corresponde según el tipo de tarjeta del comercio.
//
// Que el navegador no elija la operación no es solo prolijidad: si mandara "consumir saldo" y el
// servidor le hiciera caso, se podría gastar el saldo de una tarjeta de sellos. Acá el tipo manda.
export async function accionOperacionPrincipal(
  tarjetaId: string,
  sucursalIdCliente: string | null,
  cantidad: number,
  montoTexto: string,
): Promise<RespuestaOperacion> {
  const sesion = await verifyComercioAcceso();
  return ejecutarOperacion(sesion, tarjetaId, sucursalIdCliente, { tipo: 'principal', cantidad, montoTexto }, null);
}

// La segunda operación, que solo tienen dos tipos: cargar saldo en una gift card y vender un paquete
// de visitas. Las dos SUMAN valor, así que pasan por el camino de acreditar y heredan el techo por
// transacción — que es lo que impide que un cajero cargue una gift card de $500 sin autorización.
export async function accionOperacionSecundaria(
  tarjetaId: string,
  sucursalIdCliente: string | null,
  montoTexto: string,
): Promise<RespuestaOperacion> {
  const sesion = await verifyComercioAcceso();
  return ejecutarOperacion(sesion, tarjetaId, sucursalIdCliente, { tipo: 'secundaria', montoTexto }, null);
}

type SesionEscaner = Awaited<ReturnType<typeof verifyComercioAcceso>>;

// La autorización del dueño, con el motivo ya validado. null = la operación normal del mostrador,
// con las cuatro perillas antifraude.
type Autorizacion = { motivo: string } | null;

type ResultadoMotor = { ok: true; mensaje: string } | { ok: false; error: string; bloqueoLimite?: boolean };

// Las operaciones con RPC propio (gastar saldo, usar una visita o un cupón, renovar, registrar una
// compra) no pasan por acreditar_atomico: ninguna perilla las bloquea. Correrlas "autorizadas" las
// ejecutaría de verdad bajo un motivo de autorización que no levantó ningún límite.
const SIN_LIMITE_QUE_AUTORIZAR: ResultadoMotor = {
  ok: false,
  error: 'Esa operación no tiene ningún límite que autorizar.',
};

// El cuerpo compartido de la operación normal y de la autorizada. Lo ÚNICO que cambia entre las dos
// es QUIÉN escribe (`acreditar`); cuánto se acredita lo decide la misma rama en los dos casos. Tener
// dos copias de este switch es cómo nació el defecto de la autorización: una de las copias vivía en
// el navegador y decía `1`.
async function ejecutarOperacion(
  sesion: SesionEscaner,
  tarjetaId: string,
  sucursalIdCliente: string | null,
  operacion: OperacionEscaner,
  autorizacion: Autorizacion,
): Promise<RespuestaOperacion> {
  const supabase = createServiceClient();

  const atribucion = await resolverSucursalAtribuida(supabase, sesion, sucursalIdCliente);
  if (atribucion.ok === false) return { ok: false, error: atribucion.error };

  const programa = await resolverProgramaDeTarjeta(supabase, sesion.comercioId, tarjetaId);
  const tipo = tipoOPuntos(programa?.tipoTarjeta ?? 'puntos');

  // La atribución sale SIEMPRE de la sesión, también en la autorizada: queda a nombre de quien
  // autorizó y de la sucursal donde se hizo.
  const opciones = {
    sucursalId: atribucion.valor,
    cajeroUsuarioId: sesion.usuarioComercioId,
  };

  const acreditar = autorizacion ? acreditadorForzado(autorizacion.motivo) : acreditarPuntos;

  let resultado: ResultadoMotor;

  if (operacion.tipo === 'principal') {
    const { cantidad, montoTexto } = operacion;

    // El monto se convierte UNA vez, acá, con la función que no pasa por punto flotante.
    const centavos = montoTexto.trim() ? centavosDesdeTexto(montoTexto) : null;
    if (tipo.requiereMonto && centavos === null) {
      return { ok: false, error: 'Escribí el monto de la compra (por ejemplo 19.99).' };
    }

    switch (tipo.valor) {
      case 'cashback':
        resultado = await acreditarCashback(supabase, sesion.comercioId, tarjetaId, centavos!, opciones, acreditar);
        break;
      case 'gift_card':
        resultado = autorizacion
          ? SIN_LIMITE_QUE_AUTORIZAR
          : await consumirSaldo(supabase, sesion.comercioId, tarjetaId, centavos!, opciones);
        break;
      case 'descuento':
        resultado = autorizacion
          ? SIN_LIMITE_QUE_AUTORIZAR
          : await registrarCompra(supabase, sesion.comercioId, tarjetaId, centavos!, opciones);
        break;
      case 'prepago':
        resultado = autorizacion
          ? SIN_LIMITE_QUE_AUTORIZAR
          : await usarVisita(supabase, sesion.comercioId, tarjetaId, opciones);
        break;
      case 'cupon':
        resultado = autorizacion
          ? SIN_LIMITE_QUE_AUTORIZAR
          : await usarCupon(supabase, sesion.comercioId, tarjetaId, opciones);
        break;
      case 'membresia':
        resultado = autorizacion
          ? SIN_LIMITE_QUE_AUTORIZAR
          : await renovarMembresia(supabase, sesion.comercioId, tarjetaId, opciones);
        break;
      default: {
        // puntos y sellos: el camino de siempre. El monto viaja si el comercio lo pide (Tanda 1),
        // aunque este tipo no lo necesite para calcular nada.
        const res = await acreditar(supabase, sesion.comercioId, tarjetaId, cantidad, {
          ...opciones,
          montoCompra: centavos !== null ? centavos / 100 : null,
        });
        resultado = res.ok
          ? { ok: true, mensaje: mensajeAcreditacion(tipo.valor, cantidad) }
          : { ok: false, error: res.error, bloqueoLimite: res.bloqueoLimite };
      }
    }
  } else if (operacion.tipo === 'secundaria') {
    if (tipo.valor === 'gift_card') {
      const centavos = centavosDesdeTexto(operacion.montoTexto);
      if (centavos === null) {
        return { ok: false, error: 'Escribí cuánto saldo cargar (por ejemplo 25.00).' };
      }
      resultado = await cargarGiftCard(supabase, sesion.comercioId, tarjetaId, centavos, opciones, acreditar);
    } else if (tipo.valor === 'prepago') {
      resultado = await venderPaquete(supabase, sesion.comercioId, tarjetaId, opciones, acreditar);
    } else {
      // Defensa por si el cliente pidiera esta acción en un tipo que no la tiene.
      return { ok: false, error: 'Esta tarjeta no admite esa operación.' };
    }
  } else {
    // `operacion` viene del navegador: un `tipo` que no es ninguno de los dos no ejecuta nada.
    return { ok: false, error: 'Esta tarjeta no admite esa operación.' };
  }

  if (!resultado.ok) {
    return { ok: false, error: resultado.error, bloqueoLimite: resultado.bloqueoLimite };
  }

  // El pass del cliente se refresca solo, igual que en cualquier movimiento de saldo.
  await notificarCambioTarjeta(supabase, tarjetaId);
  await syncObjetoTarjeta(supabase, tarjetaId);

  const { data: t } = await supabase
    .from('tarjetas')
    .select('puntos_actuales')
    .eq('id', tarjetaId)
    .maybeSingle();

  return {
    ok: true,
    puntosActuales: t?.puntos_actuales ?? 0,
    saldoTexto: await saldoTextoActual(sesion.comercioId, tarjetaId),
    mensaje: resultado.mensaje,
  };
}

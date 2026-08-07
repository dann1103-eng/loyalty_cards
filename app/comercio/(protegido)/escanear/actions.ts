'use server';

import { verifyComercioAcceso } from '@/lib/comercio/verifyComercioAcceso';
import { createServiceClient } from '@/lib/supabase/server';
import { buscarTarjetaPorToken, acreditarPuntos, acreditarForzado } from '@/lib/comercio/acreditar';
import { canjearRecompensa } from '@/lib/comercio/canje';
import { quitarPuntos } from '@/lib/comercio/ajuste';
import { resolverSucursalDeAccion } from '@/lib/comercio/atribucionEscaner';
import { sucursalPerteneceAComercio } from '@/lib/comercio/sucursales';
import { resolverProgramaDeTarjeta } from '@/lib/comercio/programas';
import { notificarCambioTarjeta } from '@/lib/apple/notificarCambioTarjeta';
import { syncObjetoTarjeta } from '@/lib/google/syncObjeto';
import { tipoOPuntos, describirSaldo, centavosDesdeTexto, nivelParaAcumulado, type AccionPrincipal } from '@/lib/tarjetas/tipos';
import { usarCupon, renovarMembresia, hoyEnZona } from '@/lib/tarjetas/vigencia';
import { usarVisita, venderPaquete } from '@/lib/tarjetas/prepago';
import { acreditarCashback, cargarGiftCard, consumirSaldo } from '@/lib/tarjetas/dinero';
import { registrarCompra, listarNiveles } from '@/lib/tarjetas/descuento';

export interface RecompensaEscaner {
  id: string;
  nombre: string;
  costoPuntos: number;
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
  esSellos?: boolean;
  recompensas?: RecompensaEscaner[];
  // Si el comercio activó pedir_monto_compra, el escáner muestra el campo de monto (Tanda 1).
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
  const [{ data: comercio }, programa, { data: estado }, { data: recompensas }] = await Promise.all([
    supabase.from('comercios').select('pedir_monto_compra, zona_horaria').eq('id', comercioId).maybeSingle(),
    resolverProgramaDeTarjeta(supabase, comercioId, tarjeta.tarjetaId),
    // Estado propio de los tipos con vigencia o con nivel. Se lee acá y no en buscarTarjetaPorToken
    // para no cargar de columnas el camino que usan los tipos con contador.
    supabase.from('tarjetas').select('vigencia_hasta, usado_en, acumulado_centavos').eq('id', tarjeta.tarjetaId).maybeSingle(),
    supabase.from('recompensas').select('id, nombre, costo_puntos, foto_url').eq('comercio_id', comercioId).eq('activa', true).order('costo_puntos'),
  ]);

  const tipoValor = programa?.tipoTarjeta ?? 'puntos';
  const tipo = tipoOPuntos(tipoValor);

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
    esSellos: tipo.valor === 'sellos',
    recompensas: (recompensas ?? []).map((r) => ({
      id: r.id,
      nombre: r.nombre,
      costoPuntos: r.costo_puntos,
      fotoUrl: r.foto_url,
    })),
    pedirMontoCompra: comercio?.pedir_monto_compra ?? false,
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

// Suma sellos/puntos a la tarjeta escaneada y empuja la actualización al pass del cliente. Gate
// COMPARTIDO (owner O cajero). La atribución (sucursal + cajero) se arma acá, en el servidor, NUNCA
// se confía en el cliente para ella: resolverSucursalDeAccion fuerza la sucursal de la sesión para
// un cajero, y el cajero_usuario_id sale SIEMPRE de sesion.usuarioComercioId.
export async function accionAcreditar(
  tarjetaId: string,
  delta: number,
  sucursalIdCliente: string | null,
  montoCompra: number | null = null,
): Promise<RespuestaOperacion> {
  const sesion = await verifyComercioAcceso();
  const supabase = createServiceClient();

  const atribucion = await resolverSucursalAtribuida(supabase, sesion, sucursalIdCliente);
  if (atribucion.ok === false) return { ok: false, error: atribucion.error };

  const res = await acreditarPuntos(supabase, sesion.comercioId, tarjetaId, delta, {
    sucursalId: atribucion.valor,
    cajeroUsuarioId: sesion.usuarioComercioId,
    montoCompra,
  });
  if (!res.ok) return { ok: false, error: res.error, bloqueoLimite: res.bloqueoLimite };

  // El pass del cliente se refresca solo (mismo push que usa el cambio de branding).
  await notificarCambioTarjeta(supabase, tarjetaId);
  await syncObjetoTarjeta(supabase, tarjetaId);

  return {
    ok: true,
    puntosActuales: res.puntosActuales,
    saldoTexto: await saldoTextoActual(sesion.comercioId, tarjetaId),
    mensaje: delta === 1 ? 'Sello agregado.' : `${delta} puntos agregados.`,
  };
}

// Acredita SALTÁNDOSE las perillas antifraude. Solo el dueño.
//
// El gate es verifyComercioAcceso() + chequeo explícito de rol, y NO verifyComercioOwner(): ese
// redirige a un cajero a /comercio/escanear (verifyComercioOwner.ts:24), o sea a la página en la
// que ya está — perdería el resultado del escaneo y navegaría a la misma pantalla sin ninguna
// explicación. Acá le devolvemos un mensaje que puede leer.
//
// Este es el primero de dos candados independientes: el segundo es que el RPC del camino normal
// (acreditar_atomico) es físicamente incapaz de escribir forzado=true.
export async function accionAcreditarForzado(
  tarjetaId: string,
  delta: number,
  motivo: string,
  sucursalIdCliente: string | null,
  montoCompra: number | null = null,
): Promise<RespuestaOperacion> {
  const sesion = await verifyComercioAcceso();
  if (sesion.rol !== 'owner') {
    return { ok: false, error: 'Solo el dueño puede autorizar una acreditación por encima del límite.' };
  }
  const supabase = createServiceClient();

  const atribucion = await resolverSucursalAtribuida(supabase, sesion, sucursalIdCliente);
  if (atribucion.ok === false) return { ok: false, error: atribucion.error };

  const res = await acreditarForzado(supabase, sesion.comercioId, tarjetaId, delta, motivo, {
    sucursalId: atribucion.valor,
    cajeroUsuarioId: sesion.usuarioComercioId,
    montoCompra,
  });
  if (!res.ok) return { ok: false, error: res.error };

  await notificarCambioTarjeta(supabase, tarjetaId);
  await syncObjetoTarjeta(supabase, tarjetaId);

  return {
    ok: true,
    puntosActuales: res.puntosActuales,
    saldoTexto: await saldoTextoActual(sesion.comercioId, tarjetaId),
    mensaje: 'Autorizado y acreditado. Queda registrado en el historial del cliente.',
  };
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
  const supabase = createServiceClient();

  const atribucion = await resolverSucursalAtribuida(supabase, sesion, sucursalIdCliente);
  if (atribucion.ok === false) return { ok: false, error: atribucion.error };

  const programa = await resolverProgramaDeTarjeta(supabase, sesion.comercioId, tarjetaId);
  const tipo = tipoOPuntos(programa?.tipoTarjeta ?? 'puntos');

  const opciones = {
    sucursalId: atribucion.valor,
    cajeroUsuarioId: sesion.usuarioComercioId,
  };

  // El monto se convierte UNA vez, acá, con la función que no pasa por punto flotante.
  const centavos = montoTexto.trim() ? centavosDesdeTexto(montoTexto) : null;
  if (tipo.requiereMonto && centavos === null) {
    return { ok: false, error: 'Escribí el monto de la compra (por ejemplo 19.99).' };
  }

  let resultado: { ok: true; mensaje: string } | { ok: false; error: string; bloqueoLimite?: boolean };

  switch (tipo.valor) {
    case 'cashback':
      resultado = await acreditarCashback(supabase, sesion.comercioId, tarjetaId, centavos!, opciones);
      break;
    case 'gift_card':
      resultado = await consumirSaldo(supabase, sesion.comercioId, tarjetaId, centavos!, opciones);
      break;
    case 'descuento':
      resultado = await registrarCompra(supabase, sesion.comercioId, tarjetaId, centavos!, opciones);
      break;
    case 'prepago':
      resultado = await usarVisita(supabase, sesion.comercioId, tarjetaId, opciones);
      break;
    case 'cupon':
      resultado = await usarCupon(supabase, sesion.comercioId, tarjetaId, opciones);
      break;
    case 'membresia':
      resultado = await renovarMembresia(supabase, sesion.comercioId, tarjetaId, opciones);
      break;
    default: {
      // puntos y sellos: el camino de siempre. El monto viaja si el comercio lo pide (Tanda 1),
      // aunque este tipo no lo necesite para calcular nada.
      const res = await acreditarPuntos(supabase, sesion.comercioId, tarjetaId, cantidad, {
        ...opciones,
        montoCompra: centavos !== null ? centavos / 100 : null,
      });
      resultado = res.ok
        ? { ok: true, mensaje: cantidad === 1 ? 'Sello agregado.' : `${cantidad} puntos agregados.` }
        : { ok: false, error: res.error, bloqueoLimite: res.bloqueoLimite };
    }
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

// La segunda operación, que solo tienen dos tipos: cargar saldo en una gift card y vender un paquete
// de visitas. Las dos SUMAN valor, así que pasan por el camino de acreditar y heredan el techo por
// transacción — que es lo que impide que un cajero cargue una gift card de $500 sin autorización.
export async function accionOperacionSecundaria(
  tarjetaId: string,
  sucursalIdCliente: string | null,
  montoTexto: string,
): Promise<RespuestaOperacion> {
  const sesion = await verifyComercioAcceso();
  const supabase = createServiceClient();

  const atribucion = await resolverSucursalAtribuida(supabase, sesion, sucursalIdCliente);
  if (atribucion.ok === false) return { ok: false, error: atribucion.error };

  const programa = await resolverProgramaDeTarjeta(supabase, sesion.comercioId, tarjetaId);
  const tipo = tipoOPuntos(programa?.tipoTarjeta ?? 'puntos');

  const opciones = {
    sucursalId: atribucion.valor,
    cajeroUsuarioId: sesion.usuarioComercioId,
  };

  let resultado: { ok: true; mensaje: string } | { ok: false; error: string; bloqueoLimite?: boolean };

  if (tipo.valor === 'gift_card') {
    const centavos = centavosDesdeTexto(montoTexto);
    if (centavos === null) {
      return { ok: false, error: 'Escribí cuánto saldo cargar (por ejemplo 25.00).' };
    }
    resultado = await cargarGiftCard(supabase, sesion.comercioId, tarjetaId, centavos, opciones);
  } else if (tipo.valor === 'prepago') {
    resultado = await venderPaquete(supabase, sesion.comercioId, tarjetaId, opciones);
  } else {
    // Defensa por si el cliente pidiera esta acción en un tipo que no la tiene.
    return { ok: false, error: 'Esta tarjeta no admite esa operación.' };
  }

  if (!resultado.ok) {
    return { ok: false, error: resultado.error, bloqueoLimite: resultado.bloqueoLimite };
  }

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

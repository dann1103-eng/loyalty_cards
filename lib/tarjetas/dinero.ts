import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { acreditarPuntos, type OpcionesAcreditar } from '../comercio/acreditar';
import { formatearCentavos } from './tipos';

// Gift card y cashback: los dos tipos cuyo contador son CENTAVOS (ver el encabezado de tipos.ts).
//
// Cargar una gift card y acreditar cashback reusan acreditarPuntos, así que heredan la atribución,
// el historial y los cuatro límites antifraude — incluido el techo por transacción, que para estos
// tipos se interpreta en centavos y es lo que impide que un cajero regale una gift card de $500.
// Solo GASTAR necesitó función propia (migración 0022).

export type ResultadoDinero =
  | { ok: true; saldoCentavos: number; mensaje: string }
  | { ok: false; error: string; bloqueoLimite?: boolean };

// Cuánto cashback deja una compra. PURA para poder probar los bordes: un centavo de diferencia
// repetido diez mil veces es una discusión con un contador.
//
// Redondeo al centavo más cercano, y el medio hacia ARRIBA — a favor del cliente. Es una decisión,
// no un accidente: si un comercio quiere lo contrario, esto es lo único que hay que cambiar.
export function calcularCashback(montoCentavos: number, porcentaje: number): number {
  if (!Number.isFinite(montoCentavos) || montoCentavos <= 0) return 0;
  if (!Number.isFinite(porcentaje) || porcentaje <= 0) return 0;
  return Math.round((montoCentavos * porcentaje) / 100);
}

// Acredita el cashback de una compra. El monto es OBLIGATORIO: sin él no hay porcentaje que
// calcular, y acreditar cero sería peor que fallar — el cajero creería que quedó registrado.
export async function acreditarCashback(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  tarjetaId: string,
  montoCompraCentavos: number,
  opciones?: OpcionesAcreditar,
): Promise<ResultadoDinero> {
  if (!Number.isInteger(montoCompraCentavos) || montoCompraCentavos <= 0) {
    return { ok: false, error: 'Escribí el monto de la compra para calcular el cashback.' };
  }

  const { data: comercio } = await supabase
    .from('comercios')
    .select('cashback_porcentaje')
    .eq('id', comercioId)
    .maybeSingle();

  const porcentaje = comercio?.cashback_porcentaje ?? null;
  if (!porcentaje || porcentaje <= 0) {
    return {
      ok: false,
      error: 'Todavía no configuraste el porcentaje de cashback. Andá a Reglas y ponelo.',
    };
  }

  const devolucion = calcularCashback(montoCompraCentavos, porcentaje);
  if (devolucion <= 0) {
    // Una compra tan chica que su cashback redondea a cero. No es un error del sistema: se dice tal
    // cual para que el cajero no quede esperando un movimiento que nunca va a existir.
    return { ok: false, error: 'La compra es muy chica: el cashback redondea a cero.' };
  }

  // El monto de la compra se guarda en el ledger junto con el cashback acreditado. Es lo que después
  // permite auditar "cuánto se vendió por cada dólar devuelto".
  const res = await acreditarPuntos(supabase, comercioId, tarjetaId, devolucion, {
    ...opciones,
    montoCompra: montoCompraCentavos / 100,
  });
  if (!res.ok) return { ok: false, error: res.error, bloqueoLimite: res.bloqueoLimite };

  return {
    ok: true,
    saldoCentavos: res.puntosActuales,
    mensaje: `Le devolviste ${formatearCentavos(devolucion)}. Ahora tiene ${formatearCentavos(res.puntosActuales)}.`,
  };
}

// Carga saldo en una gift card. Reusa acreditarPuntos, o sea que el techo por transacción del
// comercio (en centavos) aplica solo: si el cajero intenta cargar más, queda bloqueado y solo el
// dueño puede autorizarlo con motivo.
export async function cargarGiftCard(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  tarjetaId: string,
  centavos: number,
  opciones?: OpcionesAcreditar,
): Promise<ResultadoDinero> {
  if (!Number.isInteger(centavos) || centavos <= 0) {
    return { ok: false, error: 'Escribí cuánto saldo cargar.' };
  }

  const res = await acreditarPuntos(supabase, comercioId, tarjetaId, centavos, opciones);
  if (!res.ok) return { ok: false, error: res.error, bloqueoLimite: res.bloqueoLimite };

  return {
    ok: true,
    saldoCentavos: res.puntosActuales,
    mensaje: `Cargaste ${formatearCentavos(centavos)}. Ahora tiene ${formatearCentavos(res.puntosActuales)}.`,
  };
}

// Gasta saldo en una compra. Sirve para gift card y para cashback: en los dos el cliente paga con
// lo que tiene acumulado.
export async function consumirSaldo(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  tarjetaId: string,
  centavos: number,
  opciones?: OpcionesAcreditar,
): Promise<ResultadoDinero> {
  if (!Number.isInteger(centavos) || centavos <= 0) {
    return { ok: false, error: 'Escribí cuánto va a pagar con su saldo.' };
  }

  const { data, error } = await supabase.rpc('consumir_saldo_atomico', {
    p_comercio_id: comercioId,
    p_tarjeta_id: tarjetaId,
    p_monto: centavos,
    p_sucursal_id: opciones?.sucursalId ?? null,
    p_cajero_usuario_id: opciones?.cajeroUsuarioId ?? null,
  });

  const fila = data?.[0];
  if (error || !fila) {
    console.error('[dinero] no se pudo consumir el saldo:', error);
    return { ok: false, error: 'No se pudo registrar el pago con saldo.' };
  }

  if (fila.estado === 'ok') {
    return {
      ok: true,
      saldoCentavos: fila.saldo,
      mensaje: `Pagó ${formatearCentavos(centavos)} con su saldo. Le quedan ${formatearCentavos(fila.saldo)}.`,
    };
  }
  if (fila.estado === 'saldo_insuficiente') {
    // Se dice CUÁNTO tiene para que el cajero cobre la diferencia en el momento, en vez de un error
    // genérico que deja la venta trabada.
    return {
      ok: false,
      error: `Solo tiene ${formatearCentavos(fila.saldo)}. Cobrá la diferencia por otro medio.`,
    };
  }
  if (fila.estado === 'monto_invalido') {
    return { ok: false, error: 'Escribí cuánto va a pagar con su saldo.' };
  }
  if (fila.estado === 'tarjeta_no_encontrada') {
    return { ok: false, error: 'Esa tarjeta no existe en tu comercio.' };
  }
  if (fila.estado === 'sucursal_invalida') {
    return { ok: false, error: 'La sucursal no es válida.' };
  }

  console.error('[dinero] estado inesperado del RPC consumir_saldo_atomico:', fila.estado);
  return { ok: false, error: 'No se pudo registrar el pago con saldo.' };
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { historialTarjeta, type ClaseMovimiento } from '../comercio/historial';

// Historial que ve el CLIENTE en su portal (/mi-tarjeta). Es una proyección REDUCIDA del mismo
// historial que ve el dueño, y la reducción es el punto de este módulo.
//
// Qué se omite y por qué:
//   - `cajeroEmail`: el correo del empleado es dato interno del comercio. El cliente no tiene por
//     qué saber quién lo atendió, y menos aún tener una lista de las cuentas del negocio.
//   - `motivo`: lo escribe el dueño o el cajero para el dueño, no para el cliente. Un motivo como
//     "el cajero nuevo se equivocó otra vez" no puede terminar en la pantalla del cliente.
//   - `forzado`: que una acreditación se haya autorizado por encima de un límite es política
//     interna. Para el cliente, el sello llegó y punto.
//   - `monto`: no aporta nada al cliente y expone cómo se registra la venta.
//
// Lo que SÍ ve es lo que lo convierte en el mejor detector de sellos fantasma que tenemos: cuándo,
// dónde y cuánto. Si aparece un sello que él no recibió, o desaparece uno que sí, lo nota él antes
// que nadie.

export interface MovimientoPortal {
  id: string;
  ocurrioEn: string;
  clase: ClaseMovimiento;
  delta: number;
  saldoResultante: number;
  sucursalNombre: string | null;
  recompensaNombre: string | null;
}

// Cuántos movimientos ve el cliente. No es su libro contable: es para reconocer lo reciente.
export const MOVIMIENTOS_PORTAL = 20;

export async function historialParaCliente(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  tarjetaId: string,
): Promise<MovimientoPortal[]> {
  const movimientos = await historialTarjeta(supabase, comercioId, tarjetaId, {
    limite: MOVIMIENTOS_PORTAL,
  });

  // Fail-soft a [] acá SÍ es correcto, al revés que en la pantalla del dueño: el cliente ya ve su
  // saldo real arriba (que es el número autoritativo), así que una lista vacía es una molestia, no
  // una conclusión falsa. En la ficha del dueño una lista vacía diría "tu cajero no hizo nada".
  if (movimientos === null) return [];

  return movimientos.map((m) => ({
    id: m.id,
    ocurrioEn: m.ocurrioEn,
    clase: m.clase,
    delta: m.delta,
    saldoResultante: m.saldoResultante,
    sucursalNombre: m.sucursalNombre,
    recompensaNombre: m.recompensaNombre,
  }));
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

// Historial de movimientos de UNA tarjeta (Tanda 1 — antifraude). Es la pantalla forense: con qué
// hora, en qué sucursal y con qué cajero se movió cada sello.
//
// Los datos no viven en una tabla nueva: transacciones_puntos y canjes ya los tenían desde la 0001.
// Lo que faltaba era la consulta (historial_tarjeta, migración 0015) y la pantalla.

export type ClaseMovimiento = 'acreditacion' | 'ajuste' | 'canje';

export interface MovimientoHistorial {
  id: string;
  ocurrioEn: string;
  clase: ClaseMovimiento;
  delta: number;
  saldoResultante: number;
  sucursalNombre: string | null;
  cajeroEmail: string | null;
  motivo: string | null;
  forzado: boolean;
  monto: number | null;
  recompensaNombre: string | null;
}

export interface OpcionesHistorial {
  limite?: number;
  desde?: string | null;
}

function normalizarClase(valor: string): ClaseMovimiento {
  return valor === 'ajuste' || valor === 'canje' ? valor : 'acreditacion';
}

// Devuelve `null` ante un error de infraestructura, NUNCA `[]`.
//
// Esto se aparta a propósito del fail-soft de lib/reportes/reportes.ts, que ante un error loguea y
// devuelve `[]` para no tumbar la pantalla. Ahí es cosmético; acá sería peligroso: en una pantalla
// de auditoría, una lista vacía le dice al dueño "tu cajero no hizo nada", que es la conclusión
// EXACTAMENTE OPUESTA a la verdad. La pantalla tiene que poder distinguir "no hay movimientos" de
// "no se pudieron leer los movimientos" y mostrar un error explícito en el segundo caso.
export async function historialTarjeta(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  tarjetaId: string,
  opciones?: OpcionesHistorial,
): Promise<MovimientoHistorial[] | null> {
  const { data, error } = await supabase.rpc('historial_tarjeta', {
    p_comercio_id: comercioId,
    p_tarjeta_id: tarjetaId,
    p_limite: opciones?.limite ?? null,
    p_desde: opciones?.desde ?? null,
  });

  if (error || !data) {
    console.error('[historial] no se pudo leer el historial de la tarjeta:', error);
    return null;
  }

  return data.map((fila) => ({
    id: fila.movimiento_id,
    ocurrioEn: fila.ocurrio_en,
    clase: normalizarClase(fila.clase),
    delta: fila.delta,
    saldoResultante: fila.saldo_resultante,
    sucursalNombre: fila.sucursal_nombre,
    cajeroEmail: fila.cajero_email,
    motivo: fila.motivo_texto,
    forzado: fila.fue_forzado,
    monto: fila.monto,
    recompensaNombre: fila.recompensa_nombre,
  }));
}

// Etiqueta de una clase de movimiento, para la UI del dueño.
export function etiquetaClase(clase: ClaseMovimiento): string {
  if (clase === 'ajuste') return 'Corrección';
  if (clase === 'canje') return 'Canje';
  return 'Acreditación';
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

// Cupón y membresía: los dos tipos cuyo estado es una FECHA y no un número (migración 0019).
//
// No pasan por acreditar_atomico ni por ajustar_puntos_atomico — no hay contador que mover. Cada
// uno tiene su RPC, y las dos razones por las que son RPC y no un update desde acá están escritas
// en la migración: un cupón no puede usarse dos veces bajo concurrencia, y una renovación calculada
// leyendo-y-después-escribiendo pierde un período pagado si dos cajeros coinciden.

export interface OpcionesVigencia {
  sucursalId?: string | null;
  cajeroUsuarioId?: string | null;
}

export type ResultadoVigencia =
  | { ok: true; fecha: string | null; mensaje: string }
  | { ok: false; error: string };

function formatearFecha(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('es-SV', { dateStyle: 'long' }).format(
    new Date(`${iso.slice(0, 10)}T12:00:00Z`),
  );
}

export async function usarCupon(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  tarjetaId: string,
  opciones?: OpcionesVigencia,
): Promise<ResultadoVigencia> {
  const { data, error } = await supabase.rpc('usar_cupon_atomico', {
    p_comercio_id: comercioId,
    p_tarjeta_id: tarjetaId,
    p_sucursal_id: opciones?.sucursalId ?? null,
    p_cajero_usuario_id: opciones?.cajeroUsuarioId ?? null,
  });

  const fila = data?.[0];
  if (error || !fila) {
    console.error('[cupon] no se pudo usar el cupón:', error);
    return { ok: false, error: 'No se pudo registrar el uso del cupón.' };
  }

  if (fila.estado === 'ok') {
    return { ok: true, fecha: fila.vencia, mensaje: 'Cupón usado. Entregá el beneficio al cliente.' };
  }
  if (fila.estado === 'cupon_ya_usado') {
    // Se dice CUÁNDO no, pero sí que ya se usó: el cajero tiene que poder distinguir "no insistas"
    // de "hubo un error", o termina entregando el beneficio dos veces.
    return { ok: false, error: 'Este cupón ya fue usado.' };
  }
  if (fila.estado === 'cupon_vencido') {
    return {
      ok: false,
      error: fila.vencia ? `Este cupón venció el ${formatearFecha(fila.vencia)}.` : 'Este cupón está vencido.',
    };
  }
  if (fila.estado === 'tarjeta_no_encontrada') {
    return { ok: false, error: 'Esa tarjeta no existe en tu comercio.' };
  }
  if (fila.estado === 'sucursal_invalida') {
    return { ok: false, error: 'La sucursal no es válida.' };
  }

  console.error('[cupon] estado inesperado del RPC usar_cupon_atomico:', fila.estado);
  return { ok: false, error: 'No se pudo registrar el uso del cupón.' };
}

export async function renovarMembresia(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  tarjetaId: string,
  opciones?: OpcionesVigencia,
): Promise<ResultadoVigencia> {
  const { data, error } = await supabase.rpc('renovar_membresia_atomico', {
    p_comercio_id: comercioId,
    p_tarjeta_id: tarjetaId,
    p_sucursal_id: opciones?.sucursalId ?? null,
    p_cajero_usuario_id: opciones?.cajeroUsuarioId ?? null,
  });

  const fila = data?.[0];
  if (error || !fila) {
    console.error('[membresia] no se pudo renovar:', error);
    return { ok: false, error: 'No se pudo renovar la membresía.' };
  }

  if (fila.estado === 'ok') {
    return {
      ok: true,
      fecha: fila.vence,
      mensaje: `Membresía renovada hasta el ${formatearFecha(fila.vence)}.`,
    };
  }
  if (fila.estado === 'membresia_sin_configurar') {
    // Explícito a propósito: si el cajero cobra y después ve que la tarjeta no se movió, el
    // problema pasa a ser del cliente. Mejor frenarlo antes con el motivo real.
    return {
      ok: false,
      error: 'Todavía no configuraste cuántos días dura la membresía. Andá a Reglas y ponelo.',
    };
  }
  if (fila.estado === 'tarjeta_no_encontrada') {
    return { ok: false, error: 'Esa tarjeta no existe en tu comercio.' };
  }
  if (fila.estado === 'sucursal_invalida') {
    return { ok: false, error: 'La sucursal no es válida.' };
  }

  console.error('[membresia] estado inesperado del RPC renovar_membresia_atomico:', fila.estado);
  return { ok: false, error: 'No se pudo renovar la membresía.' };
}

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

// ─────────────────────────────────────────────────────────────────────────────
// La vigencia con la que NACE un cupón
// ─────────────────────────────────────────────────────────────────────────────
// La 0018 lo definió así: `cupon_vigencia_dias` es "cuántos días vale DESDE QUE EL CLIENTE SE
// REGISTRA". Nunca se había cableado: hasta este arreglo, `tarjetas.vigencia_hasta` quedaba en null
// en el alta y `usar_cupon_atomico` deja pasar `vigencia_hasta is null` — o sea que una campaña de
// 7 días era canjeable para siempre, y el número que el dueño escribía en Programas no hacía nada.
//
// Se fija AL EMITIR y no se recalcula nunca más: si el dueño cambia el plazo, las tarjetas ya
// entregadas conservan la fecha con la que se prometieron. Un cupón que se acorta después de
// entregado es una promesa rota al cliente que ya lo tiene.

// AAAA-MM-DD + N días. Aritmética en UTC a propósito: el servidor de Vercel corre en UTC y la
// máquina del dueño no, y `new Date('2026-08-07')` interpretado en huso local puede caer un día
// antes. Acá no hay instantes, solo días de calendario.
export function sumarDias(fechaIso: string, dias: number): string {
  const [anio, mes, dia] = fechaIso.slice(0, 10).split('-').map(Number);
  const base = new Date(Date.UTC(anio, mes - 1, dia));
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}

// Qué fecha le toca a un cupón que se emite hoy. `null` (sin plazo configurado) ⇒ null, que es
// "no vence nunca" y es una decisión válida del dueño.
//
// `hoy + dias` y no `hoy + dias - 1`: es la MISMA convención que ya usa renovar_membresia_atomico
// (`greatest(vigencia_hasta, hoy) + v_dias`), y el día de gracia cae a favor del cliente — igual
// criterio que el redondeo del cashback.
export function vencimientoInicialCupon(hoyIso: string, dias: number | null): string | null {
  if (dias === null || !Number.isInteger(dias) || dias <= 0) return null;
  return sumarDias(hoyIso, dias);
}

// El "hoy" del comercio, no el del servidor. Un cupón emitido a las 7 de la tarde en El Salvador
// ya es del día siguiente en UTC, y esa diferencia le regalaría o le quitaría un día entero.
export function hoyEnZona(zonaHoraria: string | null): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zonaHoraria || 'America/El_Salvador',
  }).format(new Date());
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
    // "Programas" y no "Reglas": el campo se mudó de pantalla con la 0024 y el mensaje viejo mandaba
    // al dueño a buscar algo que ahí ya no está.
    return {
      ok: false,
      error: 'Todavía no configuraste cuántos días dura la membresía. Andá a Programas y ponelo.',
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

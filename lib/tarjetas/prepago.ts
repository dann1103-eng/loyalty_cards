import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { acreditarPuntos, type OpcionesAcreditar } from '../comercio/acreditar';

// Prepago: el cliente compra un paquete de visitas y las va usando.
//
// `tarjetas.puntos_actuales` guarda las visitas que QUEDAN (ver el encabezado de lib/tarjetas/tipos.ts:
// es el contador universal y su significado depende del tipo).

export type ResultadoVisita =
  | { ok: true; visitasRestantes: number; mensaje: string }
  | { ok: false; error: string; sinVisitas?: boolean };

export async function usarVisita(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  tarjetaId: string,
  opciones?: OpcionesAcreditar,
): Promise<ResultadoVisita> {
  const { data, error } = await supabase.rpc('usar_visita_atomico', {
    p_comercio_id: comercioId,
    p_tarjeta_id: tarjetaId,
    p_sucursal_id: opciones?.sucursalId ?? null,
    p_cajero_usuario_id: opciones?.cajeroUsuarioId ?? null,
  });

  const fila = data?.[0];
  if (error || !fila) {
    console.error('[multipass] no se pudo registrar la visita:', error);
    return { ok: false, error: 'No se pudo registrar la visita.' };
  }

  if (fila.estado === 'ok') {
    const quedan = fila.saldo;
    return {
      ok: true,
      visitasRestantes: quedan,
      mensaje:
        quedan === 0
          ? 'Visita registrada. Era la última de su paquete.'
          : `Visita registrada. Le quedan ${quedan}.`,
    };
  }
  if (fila.estado === 'sin_visitas') {
    // `sinVisitas` viaja aparte del texto para que el escáner pueda ofrecerle al cajero vender otro
    // paquete en el momento, en vez de dejarlo en un callejón sin salida.
    return { ok: false, error: 'A este cliente se le acabaron las visitas.', sinVisitas: true };
  }
  if (fila.estado === 'tarjeta_no_encontrada') {
    return { ok: false, error: 'Esa tarjeta no existe en tu comercio.' };
  }
  if (fila.estado === 'sucursal_invalida') {
    return { ok: false, error: 'La sucursal no es válida.' };
  }

  console.error('[multipass] estado inesperado del RPC usar_visita_atomico:', fila.estado);
  return { ok: false, error: 'No se pudo registrar la visita.' };
}

export type ResultadoPaquete =
  | { ok: true; visitasRestantes: number; mensaje: string }
  | { ok: false; error: string; bloqueoLimite?: boolean };

// Vender un paquete es SUMAR al contador, así que reusa acreditarPuntos tal cual: mismo RPC, misma
// atribución de sucursal y cajero, mismos cuatro límites antifraude. Escribir una función propia
// habría duplicado esas reglas, y dos copias de una regla terminan divergiendo.
export async function venderPaquete(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  tarjetaId: string,
  opciones?: OpcionesAcreditar,
): Promise<ResultadoPaquete> {
  const { data: comercio } = await supabase
    .from('comercios')
    .select('multipass_visitas')
    .eq('id', comercioId)
    .maybeSingle();

  const visitas = comercio?.multipass_visitas ?? null;
  if (!visitas || visitas <= 0) {
    // Explícito antes de cobrar: si el cajero cobra el paquete y después ve que la tarjeta no se
    // movió, el problema pasa a ser del cliente.
    return {
      ok: false,
      error: 'Todavía no configuraste cuántas visitas trae el paquete. Andá a Reglas y ponelo.',
    };
  }

  const res = await acreditarPuntos(supabase, comercioId, tarjetaId, visitas, opciones);
  if (!res.ok) return { ok: false, error: res.error, bloqueoLimite: res.bloqueoLimite };

  return {
    ok: true,
    visitasRestantes: res.puntosActuales,
    mensaje: `Paquete de ${visitas} visitas cargado. Ahora tiene ${res.puntosActuales}.`,
  };
}

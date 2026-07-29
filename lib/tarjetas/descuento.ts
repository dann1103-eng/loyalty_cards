import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { nivelParaAcumulado, formatearCentavos } from './tipos';

// Descuento por nivel: entre más gasta el cliente, mayor su descuento permanente.
//
// El nivel NO se guarda: se calcula al leer, desde `tarjetas.acumulado_centavos` y los niveles del
// comercio. Guardarlo dejaría a los clientes viejos con el nivel viejo para siempre cuando el dueño
// cambie los umbrales — y peor, con un nivel que ya nadie sabría de dónde salió.

export interface NivelDescuento {
  id: string;
  desdeCentavos: number;
  porcentaje: number;
}

export type ResultadoNivel = { ok: true } | { ok: false; error: string };

export async function listarNiveles(
  supabase: SupabaseClient<Database>,
  comercioId: string,
): Promise<NivelDescuento[] | null> {
  const { data, error } = await supabase
    .from('niveles_descuento')
    .select('id, desde_centavos, porcentaje')
    .eq('comercio_id', comercioId)
    .order('desde_centavos');

  if (error) {
    console.error('[descuento] no se pudieron leer los niveles:', error);
    return null;
  }
  return (data ?? []).map((n) => ({
    id: n.id,
    desdeCentavos: Number(n.desde_centavos),
    porcentaje: Number(n.porcentaje),
  }));
}

export async function crearNivel(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  desdeCentavos: number,
  porcentaje: number,
): Promise<ResultadoNivel> {
  if (!Number.isInteger(desdeCentavos) || desdeCentavos < 0) {
    return { ok: false, error: 'El monto desde el que aplica tiene que ser válido.' };
  }
  if (!Number.isFinite(porcentaje) || porcentaje <= 0 || porcentaje > 100) {
    return { ok: false, error: 'El porcentaje tiene que estar entre 0 y 100.' };
  }

  const { error } = await supabase
    .from('niveles_descuento')
    .insert({ comercio_id: comercioId, desde_centavos: desdeCentavos, porcentaje });

  if (error) {
    // 23505 = el unique (comercio_id, desde_centavos). Dos niveles con el mismo umbral harían
    // ambiguo qué descuento aplica, y merece un mensaje que el dueño entienda.
    if (error.code === '23505') {
      return {
        ok: false,
        error: `Ya tenés un nivel que arranca en ${formatearCentavos(desdeCentavos)}. Editá ese o elegí otro monto.`,
      };
    }
    console.error('[descuento] no se pudo crear el nivel:', error);
    return { ok: false, error: 'No se pudo crear el nivel.' };
  }
  return { ok: true };
}

export async function eliminarNivel(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  nivelId: string,
): Promise<ResultadoNivel> {
  // Scope por comercio_id: conocer el id de un nivel ajeno no debe permitir borrarlo.
  const { error } = await supabase
    .from('niveles_descuento')
    .delete()
    .eq('id', nivelId)
    .eq('comercio_id', comercioId);

  if (error) {
    console.error('[descuento] no se pudo eliminar el nivel:', error);
    return { ok: false, error: 'No se pudo eliminar el nivel.' };
  }
  return { ok: true };
}

export type ResultadoCompra =
  | { ok: true; acumuladoCentavos: number; porcentaje: number | null; mensaje: string }
  | { ok: false; error: string };

// Registra una compra: suma al gasto histórico y devuelve el nivel que le corresponde AHORA.
export async function registrarCompra(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  tarjetaId: string,
  montoCentavos: number,
  opciones?: { sucursalId?: string | null; cajeroUsuarioId?: string | null },
): Promise<ResultadoCompra> {
  if (!Number.isInteger(montoCentavos) || montoCentavos <= 0) {
    return { ok: false, error: 'Escribí el monto de la compra.' };
  }

  const { data, error } = await supabase.rpc('registrar_compra_atomico', {
    p_comercio_id: comercioId,
    p_tarjeta_id: tarjetaId,
    p_monto_centavos: montoCentavos,
    p_sucursal_id: opciones?.sucursalId ?? null,
    p_cajero_usuario_id: opciones?.cajeroUsuarioId ?? null,
  });

  const fila = data?.[0];
  if (error || !fila) {
    console.error('[descuento] no se pudo registrar la compra:', error);
    return { ok: false, error: 'No se pudo registrar la compra.' };
  }

  if (fila.estado !== 'ok') {
    if (fila.estado === 'tarjeta_no_encontrada') {
      return { ok: false, error: 'Esa tarjeta no existe en tu comercio.' };
    }
    if (fila.estado === 'sucursal_invalida') {
      return { ok: false, error: 'La sucursal no es válida.' };
    }
    if (fila.estado === 'monto_invalido') {
      return { ok: false, error: 'Escribí el monto de la compra.' };
    }
    console.error('[descuento] estado inesperado del RPC registrar_compra_atomico:', fila.estado);
    return { ok: false, error: 'No se pudo registrar la compra.' };
  }

  const acumulado = Number(fila.acumulado);
  const niveles = (await listarNiveles(supabase, comercioId)) ?? [];
  const porcentaje = nivelParaAcumulado(acumulado, niveles);

  return {
    ok: true,
    acumuladoCentavos: acumulado,
    porcentaje,
    mensaje: porcentaje
      ? `Compra registrada. Lleva ${formatearCentavos(acumulado)} y le toca ${porcentaje}% de descuento.`
      : `Compra registrada. Lleva ${formatearCentavos(acumulado)} acumulados.`,
  };
}

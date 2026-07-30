import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { tarjetasActivasDelComercio } from './programas';
import { enviarMensajeTarjeta } from './enviarMensajeTarjeta';

export const MAXIMO_DIFUSIONES_30_DIAS = 4;

export interface DatosDifusion {
  mensaje: string;
  vigenteHasta: string;
  programaId: string | null;
}

export interface DifusionListada {
  id: string;
  mensaje: string;
  vigenteHasta: string;
  creadaEn: string;
  destinatarios: number;
}

export type ResultadoDifusion = { ok: true; id: string } | { ok: false; error: string };

// Check-then-act deliberado, NO un RPC atómico — ver "Concurrencia" en el spec: el único actor que
// puede correr una carrera acá es el propio dueño haciendo doble clic sobre su propio tope, y el
// peor resultado es mandar una o dos campañas de más en un mes. Mismo criterio que crearPrograma.
export async function crearDifusion(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  creadaPor: string,
  datos: DatosDifusion,
): Promise<ResultadoDifusion> {
  const mensaje = datos.mensaje.trim();
  if (!mensaje) return { ok: false, error: 'El mensaje es obligatorio.' };

  const hace30dias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count, error: errorConteo } = await supabase
    .from('difusiones')
    .select('id', { count: 'exact', head: true })
    .eq('comercio_id', comercioId)
    .gte('creada_en', hace30dias);
  if (errorConteo) {
    console.error('[comercio] no se pudo contar las difusiones recientes:', errorConteo);
    return { ok: false, error: 'No se pudo crear la campaña.' };
  }
  if ((count ?? 0) >= MAXIMO_DIFUSIONES_30_DIAS) {
    return {
      ok: false,
      error: `Ya mandaste ${MAXIMO_DIFUSIONES_30_DIAS} campañas en los últimos 30 días. Esperá a que se libere cupo.`,
    };
  }

  const { data: difusion, error: errorInsert } = await supabase
    .from('difusiones')
    .insert({
      comercio_id: comercioId,
      programa_id: datos.programaId,
      mensaje,
      vigente_hasta: datos.vigenteHasta,
      creada_por: creadaPor,
    })
    .select('id')
    .single();
  if (errorInsert) {
    console.error('[comercio] no se pudo crear la difusión:', errorInsert);
    return { ok: false, error: 'No se pudo crear la campaña.' };
  }

  const tarjetas = await tarjetasActivasDelComercio(supabase, comercioId, datos.programaId);
  let destinatarios = 0;
  for (const t of tarjetas) {
    const resultado = await enviarMensajeTarjeta(
      supabase,
      t.id,
      mensaje,
      datos.vigenteHasta,
      'campana',
      difusion.id,
    );
    if (resultado.enviadoApple || resultado.enviadoGoogle) destinatarios += 1;
  }

  await supabase.from('difusiones').update({ destinatarios }).eq('id', difusion.id);

  return { ok: true, id: difusion.id };
}

export async function listarDifusiones(
  supabase: SupabaseClient<Database>,
  comercioId: string,
): Promise<DifusionListada[] | null> {
  const { data, error } = await supabase
    .from('difusiones')
    .select('id, mensaje, vigente_hasta, creada_en, destinatarios')
    .eq('comercio_id', comercioId)
    .order('creada_en', { ascending: false });

  if (error) {
    console.error('[comercio] no se pudieron listar las difusiones:', error);
    return null;
  }
  return data.map((d) => ({
    id: d.id,
    mensaje: d.mensaje,
    vigenteHasta: d.vigente_hasta,
    creadaEn: d.creada_en,
    destinatarios: d.destinatarios,
  }));
}

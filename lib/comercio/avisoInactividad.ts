import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { tarjetasActivasDelComercio } from './programas';
import { sigueVigente } from '../tarjetas/tipos';
import { hoyEnZona } from '../tarjetas/vigencia';
import { enviarMensajeTarjeta } from './enviarMensajeTarjeta';

// Topes de cordura — mismo criterio que MAXIMO_ACREDITACIONES_DIA en controlesAcreditacion.ts.
export const MAXIMO_DIAS_INACTIVIDAD = 365;
// Cuánto dura el aviso de inactividad en el reverso — a diferencia de la campaña (donde el dueño
// elige vigente_hasta), este es un valor fijo del sistema: el dueño ya configuró el umbral y el
// mensaje, una TERCERA perilla solo para esto es configurabilidad que nadie pidió.
export const DURACION_AVISO_INACTIVIDAD_DIAS = 14;

export interface ConfiguracionAvisoInactividad {
  activo: boolean;
  dias: number | null;
  mensaje: string | null;
}

export type ResultadoConfiguracion = { ok: true } | { ok: false; error: string };

function validar(datos: ConfiguracionAvisoInactividad): string | null {
  if (!datos.activo) return null; // apagado: no valida el resto, igual que las perillas antifraude
  if (datos.dias === null) return 'Poné cada cuántos días de inactividad se manda el aviso.';
  if (!Number.isInteger(datos.dias) || datos.dias <= 0 || datos.dias > MAXIMO_DIAS_INACTIVIDAD) {
    return `Los días de inactividad tienen que ser un número entero entre 1 y ${MAXIMO_DIAS_INACTIVIDAD}.`;
  }
  if (!datos.mensaje || !datos.mensaje.trim()) return 'Escribí el mensaje que va a recibir el cliente.';
  return null;
}

export function configuracionDesdeFormulario(campos: {
  activo: string | boolean;
  dias: string;
  mensaje: string;
}): ConfiguracionAvisoInactividad {
  const diasLimpio = campos.dias.trim();
  return {
    activo: campos.activo === 'on' || campos.activo === true,
    dias: diasLimpio ? Number(diasLimpio) : null,
    mensaje: campos.mensaje.trim() || null,
  };
}

export async function leerConfiguracionAvisoInactividad(
  supabase: SupabaseClient<Database>,
  comercioId: string,
): Promise<ConfiguracionAvisoInactividad | null> {
  const { data, error } = await supabase
    .from('comercios')
    .select('aviso_inactividad_activo, aviso_inactividad_dias, aviso_inactividad_mensaje')
    .eq('id', comercioId)
    .maybeSingle();
  if (error || !data) {
    console.error('[comercio] no se pudo leer la configuración de aviso de inactividad:', error);
    return null;
  }
  return {
    activo: data.aviso_inactividad_activo,
    dias: data.aviso_inactividad_dias,
    mensaje: data.aviso_inactividad_mensaje,
  };
}

export async function guardarConfiguracionAvisoInactividad(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  datos: ConfiguracionAvisoInactividad,
): Promise<ResultadoConfiguracion> {
  const problema = validar(datos);
  if (problema) return { ok: false, error: problema };

  const { error } = await supabase
    .from('comercios')
    .update({
      aviso_inactividad_activo: datos.activo,
      aviso_inactividad_dias: datos.dias,
      aviso_inactividad_mensaje: datos.mensaje,
    })
    .eq('id', comercioId);
  if (error) {
    console.error('[comercio] no se pudo guardar la configuración de aviso de inactividad:', error);
    return { ok: false, error: 'No se pudo guardar la configuración.' };
  }
  return { ok: true };
}

export interface ResumenAvisoInactividad {
  comerciosRevisados: number;
  avisadas: string[]; // ids de tarjetas avisadas, para pruebas y logging
}

// El cron diario. Mismo espíritu que apagarCampanasVencidas (lib/comercio/campanasVencidas.ts):
// lee ampliamente, filtra en TS (el corte de "última actividad" es por tarjeta, no expresable en
// una sola condición SQL simple dado el fallback a created_at), y sale temprano si no hay nada
// que hacer. A diferencia de esa función, ACÁ el envío es por tarjeta individual, no un
// re-sync por comercio — cada tarjeta inactiva es un destinatario distinto con su propio mensaje.
export async function procesarAvisosInactividad(
  supabase: SupabaseClient<Database>,
): Promise<ResumenAvisoInactividad> {
  const { data: comercios, error } = await supabase
    .from('comercios')
    .select('id, aviso_inactividad_dias, aviso_inactividad_mensaje, zona_horaria')
    .eq('aviso_inactividad_activo', true)
    .not('aviso_inactividad_dias', 'is', null)
    .not('aviso_inactividad_mensaje', 'is', null);

  if (error) {
    console.error('[inactividad] no se pudieron leer los comercios con aviso activo:', error);
    return { comerciosRevisados: 0, avisadas: [] };
  }
  if (!comercios || comercios.length === 0) {
    return { comerciosRevisados: 0, avisadas: [] };
  }

  const avisadas: string[] = [];
  const hoy = Date.now();
  const vigenteHasta = new Date(hoy + DURACION_AVISO_INACTIVIDAD_DIAS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  for (const comercio of comercios) {
    // La fecha de HOY en la zona del comercio, para decidir si un cupón sigue vigente con el mismo
    // criterio que usa el RPC que lo canjea.
    const hoyDelComercio = hoyEnZona(comercio.zona_horaria);
    const dias = comercio.aviso_inactividad_dias!;
    const mensaje = comercio.aviso_inactividad_mensaje!;
    const umbralMs = hoy - dias * 24 * 60 * 60 * 1000;

    const tarjetas = await tarjetasActivasDelComercio(supabase, comercio.id, null);
    for (const t of tarjetas) {
      // Cupón ya usado: no tiene "volver" — ver decisión 5 / la nota de "cupón ya usado" del spec.
      const { data: fila } = await supabase
        .from('tarjetas')
        .select('created_at, usado_en, vigencia_hasta, aviso_inactividad_enviado_en')
        .eq('id', t.id)
        .single();
      if (!fila) continue;
      // Un cupón muere de DOS formas y hay que saltear las dos. Usado ya estaba; VENCIDO faltaba, y
      // era el peor de los dos: `usar_cupon_atomico` rechaza un cupón vencido con 'cupon_vencido',
      // así que el push le pedía al cliente que volviera por algo que el cajero no le iba a poder
      // entregar. El cliente se va con las manos vacías y el que queda mal es el comercio.
      //
      // La comparación es por TEXTO contra la fecha local del comercio, igual que sigueVigente y que
      // el propio RPC: "vence el 30" significa el 30 completo en el local, y comparar instantes lo
      // mataría a medianoche UTC — las seis de la tarde del 29 en El Salvador.
      if (t.tipoTarjeta === 'cupon') {
        if (fila.usado_en !== null) continue;
        if (fila.vigencia_hasta !== null && !sigueVigente(fila.vigencia_hasta, hoyDelComercio)) continue;
      }

      const { data: ultimaTransaccion } = await supabase
        .from('transacciones_puntos')
        .select('created_at')
        .eq('tarjeta_id', t.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: ultimoCanje } = await supabase
        .from('canjes')
        .select('created_at')
        .eq('tarjeta_id', t.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const candidatas = [ultimaTransaccion?.created_at, ultimoCanje?.created_at, fila.created_at]
        .filter((v): v is string => v !== null && v !== undefined)
        .map((v) => new Date(v).getTime());
      const ultimaActividadMs = Math.max(...candidatas);

      if (ultimaActividadMs > umbralMs) continue; // todavía no cruza el umbral

      if (fila.aviso_inactividad_enviado_en) {
        const ultimoAvisoMs = new Date(fila.aviso_inactividad_enviado_en).getTime();
        if (ultimaActividadMs <= ultimoAvisoMs) continue; // ya se avisó y no hubo actividad nueva
      }

      await enviarMensajeTarjeta(supabase, t.id, mensaje, vigenteHasta, 'inactividad');
      await supabase.from('tarjetas').update({ aviso_inactividad_enviado_en: new Date().toISOString() }).eq('id', t.id);
      avisadas.push(t.id);
    }
  }

  return { comerciosRevisados: comercios.length, avisadas };
}

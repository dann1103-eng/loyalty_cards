import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { notificarCambioComercio } from '../apple/notificarCambioComercio';
import { syncClaseComercio } from '../google/syncClase';

// Apaga las campañas de cercanía que ya vencieron (migración 0021).
//
// Por qué hace falta un trabajo que corra solo: el mensaje va GRABADO dentro del pase de cada
// cliente. Que "venza" no ocurre por sí mismo — alguien tiene que empujar una actualización. Sin
// esto, la promoción de julio seguiría en el teléfono de un cliente que no vuelve a pasar por caja
// en agosto, y la fecha de fin sería decorativa.

export interface ResumenApagado {
  revisadas: number;
  apagadas: number;
  comerciosResincronizados: number;
}

function hoyEnZona(zona: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function apagarCampanasVencidas(
  supabase: SupabaseClient<Database>,
): Promise<ResumenApagado> {
  // Se traen TODAS las que tienen campaña y se filtra en TS, en vez de comparar contra una fecha en
  // SQL: cada comercio tiene su propia zona horaria, así que "ya venció" no es una sola fecha. El
  // volumen es de decenas de filas — no vale la pena una consulta más lista.
  const { data, error } = await supabase
    .from('sucursales')
    .select('id, comercio_id, campana_hasta, comercios(zona_horaria)')
    .not('campana_hasta', 'is', null);

  if (error) {
    console.error('[campanas] no se pudieron leer las campañas:', error);
    return { revisadas: 0, apagadas: 0, comerciosResincronizados: 0 };
  }

  const vencidas = (data ?? []).filter((s) => {
    const zona = s.comercios?.zona_horaria ?? 'America/El_Salvador';
    // Estrictamente MENOR: el día del vencimiento la campaña todavía se muestra, igual que en
    // resolverMensajeCercania. Si acá se usara <=, la promoción moriría un día antes de lo que dice
    // la pantalla.
    return (s.campana_hasta ?? '') < hoyEnZona(zona);
  });

  if (vencidas.length === 0) {
    // Salida temprana deliberada: sin esto, el trabajo re-emitiría pases todos los días porque sí.
    // Un push innecesario a todos los clientes de un comercio es tráfico y batería de gente real.
    return { revisadas: data?.length ?? 0, apagadas: 0, comerciosResincronizados: 0 };
  }

  // Se LIMPIA el campo, no solo se ignora. Si quedara puesto, el trabajo volvería a encontrarlo
  // mañana y re-sincronizaría los mismos pases todos los días para siempre.
  const { error: errorLimpieza } = await supabase
    .from('sucursales')
    .update({ mensaje_campana: null, campana_hasta: null })
    .in('id', vencidas.map((s) => s.id));

  if (errorLimpieza) {
    console.error('[campanas] no se pudieron limpiar las campañas vencidas:', errorLimpieza);
    return { revisadas: data?.length ?? 0, apagadas: 0, comerciosResincronizados: 0 };
  }

  // Un comercio puede tener varias sucursales con campañas que vencen el mismo día: se re-sincroniza
  // UNA vez por comercio, no una por sucursal.
  const comercios = [...new Set(vencidas.map((s) => s.comercio_id))];
  for (const comercioId of comercios) {
    // Apple: el texto vive dentro de cada .pkpass, así que hay que empujar a todos los dispositivos.
    await notificarCambioComercio(supabase, comercioId);
    // Google: las ubicaciones viven en la CLASE, una sola llamada para todos los clientes.
    await syncClaseComercio(supabase, comercioId);
  }

  return {
    revisadas: data?.length ?? 0,
    apagadas: vencidas.length,
    comerciosResincronizados: comercios.length,
  };
}

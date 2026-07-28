import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

// Geolocalización por sucursal (migración 0016). Las plataformas resuelven ELLAS la notificación de
// cercanía a partir de ubicaciones grabadas dentro del pase: acá solo cargamos y mantenemos el dato.
//
// Asimetría verificada contra la documentación de ambas (2026-07-28), y conviene tenerla presente al
// leer este módulo:
//   - iPhone: la tarjeta se sugiere en la pantalla de bloqueo con NUESTRO texto, radio ~100 m,
//     MÁXIMO 10 UBICACIONES POR PASE, sin sonido.
//   - Android: notificación real con sonido, radio ~150 m, tope de 4 por usuario por día, pero el
//     texto lo pone Google y `mensaje_cercania` se ignora.

// Límite duro de PassKit. Apple no rechaza un pase con más: ignora de la 11 en adelante EN
// SILENCIO. Por eso el dueño elige explícitamente cuáles participan.
export const MAXIMO_UBICACIONES_APPLE = 10;

// Límite duro de relevantText. Apple tampoco rechaza un texto más largo: lo CORTA en silencio.
export const LARGO_MAXIMO_MENSAJE_CERCANIA = 128;

export interface DatosGeopush {
  latitud: number | null;
  longitud: number | null;
  mensajeCercania: string | null;
  geopushActivo: boolean;
}

export interface UbicacionGeopush {
  sucursalId: string;
  nombre: string;
  latitud: number;
  longitud: number;
  mensajeCercania: string | null;
}

export type ResultadoGeopush = { ok: true } | { ok: false; error: string };

// Devuelve el PRIMER error o null, igual que validar() en guardarComercio.ts. El chequeo del cupo
// no está acá porque necesita consultar la BD: vive en guardarGeopushSucursal.
function validar(datos: DatosGeopush): string | null {
  const tieneCoordenadas = datos.latitud !== null && datos.longitud !== null;

  if ((datos.latitud === null) !== (datos.longitud === null)) {
    return 'Hacen falta las dos coordenadas, o ninguna.';
  }
  if (datos.latitud !== null && (!Number.isFinite(datos.latitud) || datos.latitud < -90 || datos.latitud > 90)) {
    return 'La latitud tiene que estar entre -90 y 90.';
  }
  if (datos.longitud !== null && (!Number.isFinite(datos.longitud) || datos.longitud < -180 || datos.longitud > 180)) {
    return 'La longitud tiene que estar entre -180 y 180.';
  }
  if (datos.mensajeCercania !== null && datos.mensajeCercania.length > LARGO_MAXIMO_MENSAJE_CERCANIA) {
    return `El mensaje no puede pasar de ${LARGO_MAXIMO_MENSAJE_CERCANIA} caracteres.`;
  }
  if (datos.geopushActivo && !tieneCoordenadas) {
    return 'Para activar el aviso por cercanía hace falta la ubicación del local.';
  }

  return null;
}

export async function guardarGeopushSucursal(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  sucursalId: string,
  datos: DatosGeopush,
): Promise<ResultadoGeopush> {
  const problema = validar(datos);
  if (problema) return { ok: false, error: problema };

  // Scope por comercio_id ANTES de tocar nada: conocer el id de una sucursal ajena no debe permitir
  // moverla de lugar. Mismo criterio que el resto del panel.
  const { data: propia, error: errorPropia } = await supabase
    .from('sucursales')
    .select('id')
    .eq('id', sucursalId)
    .eq('comercio_id', comercioId)
    .maybeSingle();
  if (errorPropia) {
    console.error('[geopush] no se pudo verificar la sucursal:', errorPropia);
    return { ok: false, error: 'No se pudo guardar la ubicación.' };
  }
  if (!propia) return { ok: false, error: 'Esa sucursal no es de tu comercio.' };

  // El tope de 10 se cuenta sobre las OTRAS sucursales: si esta ya estaba activa y sigue activa, no
  // debe contarse a sí misma y bloquear un simple cambio de mensaje.
  if (datos.geopushActivo) {
    const { count, error: errorCuenta } = await supabase
      .from('sucursales')
      .select('id', { count: 'exact', head: true })
      .eq('comercio_id', comercioId)
      .eq('geopush_activo', true)
      .neq('id', sucursalId);

    if (errorCuenta) {
      console.error('[geopush] no se pudo contar las sucursales con aviso:', errorCuenta);
      return { ok: false, error: 'No se pudo guardar la ubicación.' };
    }
    if ((count ?? 0) >= MAXIMO_UBICACIONES_APPLE) {
      return {
        ok: false,
        error: `Apple permite ${MAXIMO_UBICACIONES_APPLE} ubicaciones por tarjeta y ya tenés esa cantidad con el aviso activo. Desactivá otra sucursal para activar esta.`,
      };
    }
  }

  const { error } = await supabase
    .from('sucursales')
    .update({
      latitud: datos.latitud,
      longitud: datos.longitud,
      mensaje_cercania: datos.mensajeCercania,
      geopush_activo: datos.geopushActivo,
    })
    .eq('id', sucursalId)
    .eq('comercio_id', comercioId);

  if (error) {
    console.error('[geopush] no se pudo guardar la ubicación:', error);
    return { ok: false, error: 'No se pudo guardar la ubicación.' };
  }

  return { ok: true };
}

// Las ubicaciones que van DENTRO del pase. Filtra por activa Y geopush_activo Y coordenadas
// presentes: una sucursal desactivada no debería seguir llamando clientes a su puerta.
//
// El `limit` es una red de seguridad, no la regla: el tope real lo hace cumplir
// guardarGeopushSucursal al activar. Está acá porque si alguna vez se colaran 11 filas (un cambio
// hecho a mano en la BD, un import), un pase con 11 ubicaciones no falla — Apple ignora la de más
// en silencio, y preferimos que el corte sea nuestro y predecible.
export async function listarUbicacionesGeopush(
  supabase: SupabaseClient<Database>,
  comercioId: string,
): Promise<UbicacionGeopush[]> {
  const { data, error } = await supabase
    .from('sucursales')
    .select('id, nombre, latitud, longitud, mensaje_cercania')
    .eq('comercio_id', comercioId)
    .eq('activa', true)
    .eq('geopush_activo', true)
    .not('latitud', 'is', null)
    .not('longitud', 'is', null)
    .order('es_principal', { ascending: false })
    .order('nombre')
    .limit(MAXIMO_UBICACIONES_APPLE);

  if (error) {
    console.error('[geopush] no se pudieron leer las ubicaciones:', error);
    return [];
  }

  return (data ?? [])
    .filter((s) => s.latitud !== null && s.longitud !== null)
    .map((s) => ({
      sucursalId: s.id,
      nombre: s.nombre,
      latitud: Number(s.latitud),
      longitud: Number(s.longitud),
      mensajeCercania: s.mensaje_cercania,
    }));
}

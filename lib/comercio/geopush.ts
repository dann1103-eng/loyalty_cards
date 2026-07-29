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
  // Mensaje BASE: permanente, describe al negocio.
  mensajeCercania: string | null;
  // Campaña temporal (migración 0021): tapa al base mientras vive y se apaga sola al vencer.
  mensajeCampana: string | null;
  campanaHasta: string | null;
  geopushActivo: boolean;
}

// Qué mensaje se graba en el pase HOY. Función PURA y con `hoyIso` por argumento para poder probar
// el borde del vencimiento sin congelar el reloj.
//
// La campaña TAPA al base mientras vive; al vencer se vuelve al base sin que el dueño tenga que
// acordarse de limpiarla — que es justo lo que nadie hace.
export function resolverMensajeCercania(
  base: string | null,
  campana: string | null,
  campanaHasta: string | null,
  hoyIso: string,
): string | null {
  // Se compara como TEXTO, igual que el vencimiento de un cupón: "hasta el 30" es el 30 completo en
  // el local, y comparar instantes lo mataría a medianoche UTC — las 6 de la tarde del 29 acá.
  const campanaVigente =
    campana !== null && campanaHasta !== null && campanaHasta.slice(0, 10) >= hoyIso.slice(0, 10);
  return campanaVigente ? campana : base;
}

export interface UbicacionGeopush {
  sucursalId: string;
  nombre: string;
  latitud: number;
  longitud: number;
  // YA resuelto entre base y campaña: quien construye el pase no tiene que saber que existen dos.
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
  if (datos.mensajeCampana !== null && datos.mensajeCampana.length > LARGO_MAXIMO_MENSAJE_CERCANIA) {
    return `El mensaje de la campaña no puede pasar de ${LARGO_MAXIMO_MENSAJE_CERCANIA} caracteres.`;
  }
  // Espejo del CHECK de la BD, para dar el mensaje en español en vez de un 23514 crudo. Una campaña
  // sin fecha nunca terminaría (el problema que la 0021 vino a resolver) y una fecha sin mensaje no
  // muestra nada.
  if ((datos.mensajeCampana === null) !== (datos.campanaHasta === null)) {
    return 'La campaña necesita un mensaje Y una fecha de fin, o ninguno de los dos.';
  }
  if (datos.campanaHasta !== null && !/^\d{4}-\d{2}-\d{2}$/.test(datos.campanaHasta)) {
    return 'La fecha de fin de la campaña no es válida.';
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
      mensaje_campana: datos.mensajeCampana,
      campana_hasta: datos.campanaHasta,
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
  // La zona horaria del comercio decide qué día es "hoy" para el vencimiento de la campaña. Es una
  // consulta extra en el camino de emisión de cada pase, y vale la pena: sin ella el corte sería en
  // UTC y una campaña salvadoreña moriría a las 6 de la tarde del día anterior.
  const { data: comercio } = await supabase
    .from('comercios')
    .select('zona_horaria')
    .eq('id', comercioId)
    .maybeSingle();
  const hoyIso = new Intl.DateTimeFormat('en-CA', {
    timeZone: comercio?.zona_horaria ?? 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const { data, error } = await supabase
    .from('sucursales')
    .select('id, nombre, latitud, longitud, mensaje_cercania, mensaje_campana, campana_hasta')
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
      mensajeCercania: resolverMensajeCercania(
        s.mensaje_cercania,
        s.mensaje_campana,
        s.campana_hasta,
        hoyIso,
      ),
    }));
}

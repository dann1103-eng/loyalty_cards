'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import {
  crearSucursal,
  renombrarSucursal,
  cambiarEstadoSucursal,
} from '@/lib/comercio/sucursales';
import { crearComercioPropio } from '@/lib/comercios/crearComercioPropio';
import { guardarGeopushSucursal } from '@/lib/comercio/geopush';
import { resolverCoordenadas } from '@/lib/comercio/coordenadas';
import { notificarCambioComercio } from '@/lib/apple/notificarCambioComercio';
import { syncClaseComercio } from '@/lib/google/syncClase';
import {
  COOKIE_COMERCIO_ACTIVO,
  COOKIE_SUCURSAL_ACTIVA,
  opcionesCookieComercio,
} from '@/lib/comercio/cookieComercio';

export type EstadoSucursal = { error: string } | undefined;

// El alta tiene su propio estado (no el EstadoSucursal compartido): el modal se cierra al ver
// {ok:true}, y un `undefined` de éxito sería indistinguible del estado inicial.
export type EstadoCrearSucursal = { error: string } | { ok: true } | undefined;

// CADA acción re-verifica el gate (verifyComercioOwner() FUERA de try/catch — lanza NEXT_REDIRECT)
// y toma el comercioId de la SESIÓN, nunca del formulario: un comercio_id del cliente dejaría a un
// dueño tocar sucursales de OTRO comercio.

export async function accionCrearSucursal(
  _estadoPrevio: EstadoCrearSucursal,
  formData: FormData,
): Promise<EstadoCrearSucursal> {
  const { comercioId } = await verifyComercioOwner();

  const res = await crearSucursal(createServiceClient(), comercioId, {
    nombre: String(formData.get('nombre') ?? ''),
  });
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/sucursales');
  return { ok: true };
}

export async function accionRenombrarSucursal(
  id: string,
  _estadoPrevio: EstadoSucursal,
  formData: FormData,
): Promise<EstadoSucursal> {
  const { comercioId } = await verifyComercioOwner();

  const res = await renombrarSucursal(createServiceClient(), id, comercioId, {
    nombre: String(formData.get('nombre') ?? ''),
  });
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/sucursales');
  return undefined;
}

// Toggle activar/desactivar (soft, NUNCA borra). El estado destino lo decide el botón según cómo
// está la fila hoy; la función de datos garantiza que sea un update, no un delete.
export async function accionCambiarEstado(
  id: string,
  activa: boolean,
  _estadoPrevio: EstadoSucursal,
  _formData: FormData,
): Promise<EstadoSucursal> {
  const { comercioId } = await verifyComercioOwner();

  const res = await cambiarEstadoSucursal(createServiceClient(), id, comercioId, activa);
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/sucursales');
  return undefined;
}

export type EstadoComercioPropio = { error: string } | undefined;

// Alta self-serve de comercio (modal "¿Qué estás creando?"). Gate owner FUERA de try/catch. Al
// éxito fija el comercio NUEVO como activo (su membresía owner se acaba de crear — válido por
// construcción, mismo criterio que fijar tras elegir), resetea la sucursal a "todas" y aterriza
// en /marca para terminar la identidad. redirect() LANZA NEXT_REDIRECT: nada de try/catch acá.
export async function accionCrearComercioPropio(
  _estadoPrevio: EstadoComercioPropio,
  formData: FormData,
): Promise<EstadoComercioPropio> {
  const { authUserId, comercioId } = await verifyComercioOwner();

  const res = await crearComercioPropio(
    createServiceClient(),
    { authUserId, comercioActivoId: comercioId },
    {
      nombre: String(formData.get('nombre') ?? ''),
      tipoTarjeta: String(formData.get('tipoTarjeta') ?? ''),
    },
  );
  if (!res.ok) return { error: res.error };

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_COMERCIO_ACTIVO, res.id, opcionesCookieComercio());
  cookieStore.delete(COOKIE_SUCURSAL_ACTIVA);
  revalidatePath('/comercio', 'layout');
  redirect('/comercio/branding?nuevo=1');
}

export type EstadoGeopush = { error: string } | { ok: true } | undefined;

// Guarda la ubicación y el mensaje de cercanía de una sucursal.
//
// Las coordenadas NO se piden como dos números: ningún dueño sabe su latitud. Se acepta lo que
// tenga a mano —el link de Google Maps, incluido el acortador del botón Compartir, o las
// coordenadas copiadas del mapa— y resolverCoordenadas se encarga. Ver lib/comercio/coordenadas.ts.
export async function accionGuardarGeopush(
  sucursalId: string,
  _estadoPrevio: EstadoGeopush,
  formData: FormData,
): Promise<EstadoGeopush> {
  const { comercioId } = await verifyComercioOwner();
  const supabase = createServiceClient();

  const pegado = String(formData.get('ubicacion') ?? '').trim();
  const mensaje = String(formData.get('mensaje_cercania') ?? '').trim();
  const mensajeCampana = String(formData.get('mensaje_campana') ?? '').trim();
  const campanaHasta = String(formData.get('campana_hasta') ?? '').trim();
  const activar = formData.get('geopush_activo') === 'on';

  // Los dos campos de la campaña viajan juntos o ninguno: si el dueño escribió solo uno, la capa de
  // datos lo rechaza con un mensaje en español en vez de dejar que la BD tire un 23514.

  let latitud: number | null = null;
  let longitud: number | null = null;
  if (pegado) {
    const coords = await resolverCoordenadas(pegado);
    if (!coords) {
      return {
        error:
          'No se pudo leer la ubicación. Pegá el link de Google Maps de tu local, o las coordenadas separadas por coma (ej.: 13.6989, -89.1914).',
      };
    }
    latitud = coords.latitud;
    longitud = coords.longitud;
  }

  const res = await guardarGeopushSucursal(supabase, comercioId, sucursalId, {
    latitud,
    longitud,
    mensajeCercania: mensaje || null,
    mensajeCampana: mensajeCampana || null,
    campanaHasta: campanaHasta || null,
    geopushActivo: activar,
  });
  if (!res.ok) return { error: res.error };

  // Las ubicaciones van GRABADAS dentro de cada .pkpass ya emitido: sin el push, los clientes que
  // ya tienen la tarjeta nunca reciben las coordenadas nuevas y el geopush no funciona para ellos —
  // solo para los que se registren de ahora en adelante. Es el mismo motivo por el que el reverso
  // configurable necesita este push.
  await notificarCambioComercio(supabase, comercioId);
  // Google guarda las ubicaciones en la CLASE, o sea una sola llamada para todos los clientes.
  await syncClaseComercio(supabase, comercioId);

  revalidatePath('/comercio/sucursales');
  return { ok: true };
}

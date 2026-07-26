'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import {
  crearComercio,
  actualizarComercio,
  eliminarComercio,
  type DatosComercio,
} from '@/lib/comercios/guardarComercio';
import { generarAccesoDueno } from '@/lib/comercio/accesoDueno';
import { notificarCambioComercio } from '@/lib/apple/notificarCambioComercio';
import { syncClaseComercio } from '@/lib/google/syncClase';

export type EstadoFormulario = { error: string } | undefined;

// El link vuelve junto al correo al que corresponde: la misma acción la disparan varios formularios
// (el alta por correo y un "Regenerar link" por cada dueño), así que sin el correo el bloque de
// resultado no podría decir de quién es el link que está mostrando.
export type EstadoAcceso = { link: string; email: string } | { error: string } | undefined;

function textoONull(valor: FormDataEntryValue | null): string | null {
  const s = String(valor ?? '').trim();
  return s === '' ? null : s;
}

function leerDatos(formData: FormData): DatosComercio {
  return {
    nombre: String(formData.get('nombre') ?? '').trim(),
    slug: String(formData.get('slug') ?? '').trim(),
    color_fondo: String(formData.get('color_fondo') ?? '').trim(),
    color_texto: String(formData.get('color_texto') ?? '').trim(),
    color_label: String(formData.get('color_label') ?? '').trim(),
    logo_url: textoONull(formData.get('logo_url')),
    strip_url: textoONull(formData.get('strip_url')),
    hero_url: textoONull(formData.get('hero_url')),
    tipo_tarjeta: String(formData.get('tipo_tarjeta') ?? 'puntos'),
    cuenta_id: String(formData.get('cuenta_id') ?? ''),
  };
}

// Las acciones NO validan: toda la validación vive en validar(), dentro de guardarComercio.ts,
// que es la capa con tests de integración. Aquí solo: autenticar, parsear, delegar.
export async function accionCrearComercio(
  _estadoPrevio: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  // Cada Server Action verifica por su cuenta: son POST a la ruta donde se usan, no rutas
  // propias, y los docs de Next dicen explícitamente que no hay que confiar solo en el Proxy.
  // OJO: verifyFmAdmin() usa redirect(), que funciona LANZANDO. Nunca lo envuelvas en try/catch.
  await verifyFmAdmin();

  const res = await crearComercio(createServiceClient(), leerDatos(formData));
  if (!res.ok) return { error: res.error };

  revalidatePath('/admin/comercios');
  redirect('/admin/comercios');
}

export async function accionActualizarComercio(
  id: string,
  _estadoPrevio: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  await verifyFmAdmin();

  const supabase = createServiceClient();
  const res = await actualizarComercio(supabase, id, leerDatos(formData));
  if (!res.ok) return { error: res.error };

  // Los passes ya emitidos renderizan tipo_tarjeta y colores: sin este push, un cambio de FM
  // (ej. puntos → sellos) deja los passes viejos mostrando el diseño anterior para siempre.
  await notificarCambioComercio(supabase, id);
  await syncClaseComercio(supabase, id);

  revalidatePath('/admin/comercios');
  redirect('/admin/comercios');
}

export async function accionEliminarComercio(
  id: string,
  _estadoPrevio: EstadoFormulario,
  _formData: FormData,
): Promise<EstadoFormulario> {
  await verifyFmAdmin();

  const res = await eliminarComercio(createServiceClient(), id);
  if (!res.ok) return { error: res.error };

  revalidatePath('/admin/comercios');
  redirect('/admin/comercios');
}

// Da de alta (o rehabilita) el acceso del DUEÑO de un comercio: crea su cuenta de Auth si no
// existe, le asegura la membresía owner y devuelve un link de un solo uso para que él mismo defina
// su contraseña. FM lo comparte por WhatsApp. Sirve igual para un dueño nuevo, para un link vencido
// y para una contraseña olvidada — no hay otro camino de recuperación en el producto.
//
// SEGURIDAD: solo FM genera accesos → verifyFmAdmin() FUERA de try/catch (redirect() LANZA
// NEXT_REDIRECT). El link es una credencial temporal: NO se loguea acá ni se persiste en ninguna
// tabla; vive solo en el estado del formulario de quien lo generó.
export async function accionGenerarAcceso(
  comercioId: string,
  _estadoPrevio: EstadoAcceso,
  formData: FormData,
): Promise<EstadoAcceso> {
  await verifyFmAdmin();

  // Sin base URL el link apuntaría a "undefined/comercio/activar": inservible, y FM no se daría
  // cuenta hasta que el cliente reportara que no abre. Se corta acá con un mensaje que dice qué
  // falta. Mismo `.replace(/\/$/, '')` que el resto del proyecto (evita el doble '//').
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '');
  if (!baseUrl) {
    return { error: 'Falta configurar NEXT_PUBLIC_BASE_URL: sin ella el link no apuntaría a ningún lado.' };
  }

  // La acción NO valida el correo: eso vive en generarAccesoDueno, que es la capa con tests. El
  // trim+lowercase es solo para MOSTRAR el mismo correo que la capa lib va a canonizar y guardar.
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const res = await generarAccesoDueno(createServiceClient(), comercioId, email, baseUrl);
  if (!res.ok) return { error: res.error };

  // A propósito SIN revalidatePath: revalidar remonta la página y se llevaría puesto el único
  // lugar donde existe el link (el estado de useActionState). La lista de dueños se actualiza en
  // la próxima visita — la página es force-dynamic.
  return { link: res.link, email };
}

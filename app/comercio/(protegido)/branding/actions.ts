'use server';

import { revalidatePath } from 'next/cache';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { guardarBranding } from '@/lib/comercio/guardarBranding';
import { notificarCambioComercio } from '@/lib/apple/notificarCambioComercio';
import { syncClaseComercio } from '@/lib/google/syncClase';
import {
  validarImagenSubida,
  extensionDeMime,
  rutaImagenComercio,
  CAMPOS_IMAGEN,
} from '@/lib/comercio/imagenComercio';
import type { Database } from '@/lib/supabase/types';

const BUCKET = 'comercio-imagenes';

export type EstadoBranding = { error: string } | { ok: true } | undefined;

// Guarda colores + sello_meta. comercio_id SIEMPRE del gate, nunca del formulario.
export async function accionGuardarBranding(
  _estadoPrevio: EstadoBranding,
  formData: FormData,
): Promise<EstadoBranding> {
  const { comercioId } = await verifyComercioOwner();

  const montoMeta = String(formData.get('sello_meta') ?? '').trim();
  const res = await guardarBranding(createServiceClient(), comercioId, {
    color_fondo: String(formData.get('color_fondo') ?? ''),
    color_texto: String(formData.get('color_texto') ?? ''),
    color_label: String(formData.get('color_label') ?? ''),
    // '' → null; "12" → 12; "12a" → NaN, que guardarBranding rechaza con mensaje claro.
    sello_meta: montoMeta === '' ? null : Number(montoMeta),
    difuminado_franja: String(formData.get('difuminado_franja') ?? 'medio'),
  });

  if (!res.ok) return { error: res.error };

  // Colores y meta de sellos se renderizan en el pass: se avisa a los passes ya emitidos para
  // que Wallet los re-descargue (sin esto, muestran el diseño viejo hasta el próximo cambio de
  // puntos — bug visto en el piloto al pasar a sellos).
  await notificarCambioComercio(createServiceClient(), comercioId);
  // Google Wallet: una sola llamada actualiza la clase para TODOS los clientes de este comercio
  // (a diferencia de Apple, que necesita un push por tarjeta). Best-effort, igual que arriba.
  await syncClaseComercio(createServiceClient(), comercioId);

  revalidatePath('/comercio/branding');
  return { ok: true };
}

// Sube UNA imagen. El campo (logo/strip/hero/sello_icono) se valida contra la lista blanca: nunca
// se confía en el cliente para nombrar una columna. comercio_id del gate → la ruta del archivo.
export async function accionSubirImagen(
  _estadoPrevio: EstadoBranding,
  formData: FormData,
): Promise<EstadoBranding> {
  const { comercioId } = await verifyComercioOwner();

  const campo = String(formData.get('campo') ?? '');
  if (!(CAMPOS_IMAGEN as readonly string[]).includes(campo)) {
    return { error: 'Campo de imagen no válido.' };
  }

  const archivo = formData.get('archivo');
  if (!(archivo instanceof File)) {
    return { error: 'No se recibió ninguna imagen.' };
  }

  const problema = validarImagenSubida({ type: archivo.type, size: archivo.size });
  if (problema) return { error: problema };

  const ext = extensionDeMime(archivo.type);
  const ruta = rutaImagenComercio(comercioId, campo, ext);
  const supabase = createServiceClient();

  const { error: errorSubida } = await supabase.storage
    .from(BUCKET)
    .upload(ruta, await archivo.arrayBuffer(), { contentType: archivo.type, upsert: true });
  if (errorSubida) {
    console.error('[comercio] falló la subida de imagen:', errorSubida);
    return { error: 'No se pudo subir la imagen.' };
  }

  // URL pública + cache-busting: la ruta es determinística y el CDN cachea, así que re-subir al
  // mismo path serviría la imagen vieja sin el ?v=. La columna es {campo}_url.
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(ruta);
  const urlConVersion = `${pub.publicUrl}?v=${Date.now()}`;

  // `campo` ya se validó contra CAMPOS_IMAGEN arriba, así que `${campo}_url` es una de las cuatro
  // columnas reales (logo_url/strip_url/hero_url/sello_icono_url). El cast es necesario porque una
  // llave computada de tipo unión ensancha el objeto a { [x: string]: string }, que el tipo Update
  // (estricto, sin index signature) rechazaría; el cast lo alinea sin perder seguridad en runtime.
  const actualizacion = { [`${campo}_url`]: urlConVersion } as Database['public']['Tables']['comercios']['Update'];

  const { error: errorUpdate } = await supabase
    .from('comercios')
    .update(actualizacion)
    .eq('id', comercioId)
    .select('id')
    .single();
  if (errorUpdate) {
    console.error('[comercio] falló el guardado de la URL de imagen:', errorUpdate);
    return { error: 'La imagen se subió pero no se pudo guardar su dirección.' };
  }

  // Solo logo/hero alimentan la LoyaltyClass de Google (strip y sello_icono son exclusivos del
  // pipeline visual de Apple). El logo es además el gatillo típico que recién HABILITA Google
  // Wallet para un comercio que antes no lo tenía (programLogo es obligatorio ahí).
  if (campo === 'logo' || campo === 'hero') {
    await syncClaseComercio(supabase, comercioId);
  }

  revalidatePath('/comercio/branding');
  return { ok: true };
}

// Quita una imagen subida por error: vacía la columna, borra el archivo del bucket (best-effort)
// y empuja la actualización a los passes (que ahora renderizan estas imágenes). El campo se valida
// contra la lista blanca, igual que en la subida.
export async function accionQuitarImagen(
  campo: string,
  _estadoPrevio: EstadoBranding,
  _formData: FormData,
): Promise<EstadoBranding> {
  const { comercioId } = await verifyComercioOwner();

  if (!(CAMPOS_IMAGEN as readonly string[]).includes(campo)) {
    return { error: 'Campo de imagen no válido.' };
  }

  const supabase = createServiceClient();

  const actualizacion = { [`${campo}_url`]: null } as Database['public']['Tables']['comercios']['Update'];
  const { error: errorUpdate } = await supabase
    .from('comercios')
    .update(actualizacion)
    .eq('id', comercioId)
    .select('id')
    .single();
  if (errorUpdate) {
    console.error('[comercio] no se pudo quitar la imagen:', errorUpdate);
    return { error: 'No se pudo quitar la imagen.' };
  }

  // El archivo pudo subirse con cualquiera de las tres extensiones permitidas; borrar de más no
  // falla (remove ignora rutas inexistentes) y es best-effort: la referencia en la BD ya no existe.
  const rutas = ['png', 'jpg', 'webp'].map((ext) => rutaImagenComercio(comercioId, campo, ext));
  const { error: errorStorage } = await supabase.storage.from(BUCKET).remove(rutas);
  if (errorStorage) console.warn('[comercio] no se pudo borrar el archivo del bucket:', errorStorage);

  await notificarCambioComercio(supabase, comercioId);
  if (campo === 'logo' || campo === 'hero') {
    await syncClaseComercio(supabase, comercioId);
  }

  revalidatePath('/comercio/branding');
  return { ok: true };
}

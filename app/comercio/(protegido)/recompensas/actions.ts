'use server';

import { revalidatePath } from 'next/cache';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { crearRecompensa, desactivarRecompensa, guardarFotoRecompensa } from '@/lib/comercio/recompensas';
import {
  validarImagenSubida,
  extensionDeMime,
  rutaImagenRecompensa,
} from '@/lib/comercio/imagenComercio';

// Mismo bucket que las imágenes de branding: público de lectura, escritura solo por Server Action
// con service role.
const BUCKET_IMAGENES = 'comercio-imagenes';
import { notificarCambioComercio } from '@/lib/apple/notificarCambioComercio';

export type EstadoRecompensa = { error: string } | undefined;

export async function accionCrearRecompensa(
  _estadoPrevio: EstadoRecompensa,
  formData: FormData,
): Promise<EstadoRecompensa> {
  const { comercioId } = await verifyComercioOwner();

  const costoTexto = String(formData.get('costo_puntos') ?? '').trim();
  const res = await crearRecompensa(createServiceClient(), comercioId, {
    nombre: String(formData.get('nombre') ?? ''),
    descripcion: String(formData.get('descripcion') ?? '') || null,
    costo_puntos: costoTexto === '' ? NaN : Number(costoTexto),
    tipo: String(formData.get('tipo') ?? ''),
    valor: String(formData.get('valor') ?? '') || null,
  });
  if (!res.ok) return { error: res.error };

  // El catálogo de recompensas se imprime en el reverso del pass: se avisa a los passes ya emitidos
  // para que Wallet los re-descargue (sin esto, muestran el catálogo viejo hasta el próximo cambio
  // de puntos — bug visto en el piloto al pasar a sellos).
  await notificarCambioComercio(createServiceClient(), comercioId);

  revalidatePath('/comercio/recompensas');
  return undefined;
}

// Desactiva (soft-delete), NO borra. La función de datos ya lo garantiza; la acción solo delega.
export async function accionDesactivarRecompensa(
  id: string,
  _estadoPrevio: EstadoRecompensa,
  _formData: FormData,
): Promise<EstadoRecompensa> {
  const { comercioId } = await verifyComercioOwner();

  const res = await desactivarRecompensa(createServiceClient(), id, comercioId);
  if (!res.ok) return { error: res.error };

  // Mismo motivo que al crear: sin el push, el reverso de los passes ya emitidos sigue ofreciendo
  // una recompensa que el dueño ya no canjea.
  await notificarCambioComercio(createServiceClient(), comercioId);

  revalidatePath('/comercio/recompensas');
  return undefined;
}

export type EstadoFotoRecompensa = { error: string } | { ok: true } | undefined;

// Sube (o quita) la foto de un premio. Reusa el bucket, la validación y el cache-busting del
// branding del comercio: es el mismo bucket público de lectura, con la escritura mediada por este
// Server Action con service role — nunca por políticas de Storage (ver seed-storage-bucket.ts).
//
// NO dispara notificarCambioComercio, a diferencia de crear/desactivar una recompensa: el reverso
// del pass es solo TEXTO, así que la foto no cambia nada de lo que ve el cliente en su billetera.
// Empujar un refresco a todos los passes emitidos por un cambio que no se ve ahí sería tráfico
// puro. La foto se ve en el escáner del cajero y en el portal del cliente.
export async function accionSubirFotoRecompensa(
  recompensaId: string,
  _estadoPrevio: EstadoFotoRecompensa,
  formData: FormData,
): Promise<EstadoFotoRecompensa> {
  const { comercioId } = await verifyComercioOwner();
  const supabase = createServiceClient();

  const archivo = formData.get('archivo');
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { error: 'No se recibió ninguna imagen.' };
  }

  const problema = validarImagenSubida({ type: archivo.type, size: archivo.size });
  if (problema) return { error: problema };

  // La recompensa se verifica ANTES de escribir en Storage: sin esto, alguien con el id de una
  // recompensa ajena podría dejar archivos en la carpeta de otro comercio aunque el update de la
  // fila después fallara por el scope.
  const { data: propia } = await supabase
    .from('recompensas')
    .select('id')
    .eq('id', recompensaId)
    .eq('comercio_id', comercioId)
    .maybeSingle();
  if (!propia) return { error: 'Esa recompensa no es de tu comercio.' };

  const ext = extensionDeMime(archivo.type);
  const ruta = rutaImagenRecompensa(comercioId, recompensaId, ext);

  const { error: errorSubida } = await supabase.storage
    .from(BUCKET_IMAGENES)
    .upload(ruta, await archivo.arrayBuffer(), { contentType: archivo.type, upsert: true });
  if (errorSubida) {
    console.error('[comercio] falló la subida de la foto del premio:', errorSubida);
    return { error: 'No se pudo subir la imagen.' };
  }

  // La ruta es determinística (re-subir pisa el archivo viejo en vez de acumular versiones), así
  // que el CDN serviría la imagen anterior sin el ?v=.
  const { data: pub } = supabase.storage.from(BUCKET_IMAGENES).getPublicUrl(ruta);
  const res = await guardarFotoRecompensa(supabase, comercioId, recompensaId, `${pub.publicUrl}?v=${Date.now()}`);
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/recompensas');
  return { ok: true };
}

export async function accionQuitarFotoRecompensa(
  recompensaId: string,
  _estadoPrevio: EstadoFotoRecompensa,
  _formData: FormData,
): Promise<EstadoFotoRecompensa> {
  const { comercioId } = await verifyComercioOwner();
  const supabase = createServiceClient();

  const res = await guardarFotoRecompensa(supabase, comercioId, recompensaId, null);
  if (!res.ok) return { error: res.error };

  // Borrado del archivo best-effort y a ciegas sobre las tres extensiones posibles: no sabemos con
  // cuál se subió y un archivo huérfano en el bucket es inofensivo, mientras que fallar acá dejaría
  // la columna sin limpiar. Mismo criterio que accionQuitarImagen del branding.
  await supabase.storage
    .from(BUCKET_IMAGENES)
    .remove(['png', 'jpg', 'webp'].map((ext) => rutaImagenRecompensa(comercioId, recompensaId, ext)));

  revalidatePath('/comercio/recompensas');
  return { ok: true };
}

'use server';

import { revalidatePath } from 'next/cache';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import {
  crearPrograma,
  guardarConfiguracionPrograma,
  desactivarPrograma,
  configuracionProgramaDesdeFormulario,
} from '@/lib/comercio/programas';
import {
  guardarBrandingPrograma,
  brandingProgramaDesdeFormulario,
} from '@/lib/comercio/guardarBrandingPrograma';
import { notificarCambioPrograma } from '@/lib/apple/notificarCambioComercio';
import { syncObjetosPrograma } from '@/lib/google/syncComercio';
import {
  validarImagenSubida,
  extensionDeMime,
  rutaImagenPrograma,
  CAMPOS_IMAGEN,
} from '@/lib/comercio/imagenComercio';
import type { Database } from '@/lib/supabase/types';

const BUCKET = 'comercio-imagenes';

export type EstadoPrograma = { error: string } | { ok: true } | undefined;

function configuracionDeFormData(formData: FormData) {
  return configuracionProgramaDesdeFormulario({
    cashbackPorcentaje: String(formData.get('cashback_porcentaje') ?? ''),
    multipassVisitas: String(formData.get('multipass_visitas') ?? ''),
    membresiaDias: String(formData.get('membresia_dias') ?? ''),
    cuponVigenciaDias: String(formData.get('cupon_vigencia_dias') ?? ''),
  });
}

// El alta y la configuración de tipo no empujan nada a los teléfonos: crear un programa todavía no
// tiene tarjetas emitidas, y la configuración del tipo (porcentaje, visitas, días) no se dibuja en
// el pase. La MARCA sí se dibuja, y por eso accionGuardarBrandingPrograma —abajo— es la única de
// este archivo que propaga.

export async function accionCrearPrograma(
  _estadoPrevio: EstadoPrograma,
  formData: FormData,
): Promise<EstadoPrograma> {
  const { comercioId } = await verifyComercioOwner();

  const res = await crearPrograma(createServiceClient(), comercioId, {
    nombre: String(formData.get('nombre') ?? ''),
    tipoTarjeta: String(formData.get('tipo_tarjeta') ?? ''),
    ...configuracionDeFormData(formData),
  });
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/programas');
  return { ok: true };
}

export async function accionGuardarConfiguracionPrograma(
  programaId: string,
  _estadoPrevio: EstadoPrograma,
  formData: FormData,
): Promise<EstadoPrograma> {
  const { comercioId } = await verifyComercioOwner();

  const res = await guardarConfiguracionPrograma(
    createServiceClient(),
    comercioId,
    programaId,
    configuracionDeFormData(formData),
  );
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/programas');
  return { ok: true };
}

export async function accionDesactivarPrograma(
  programaId: string,
  _estadoPrevio: EstadoPrograma,
  _formData: FormData,
): Promise<EstadoPrograma> {
  const { comercioId } = await verifyComercioOwner();

  const res = await desactivarPrograma(createServiceClient(), comercioId, programaId);
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/programas');
  return { ok: true };
}

// Marca del programa: colores, difuminado, meta y el interruptor de branding propio. El comercioId
// SIEMPRE del gate; el programaId viaja bindeado desde el formulario y guardarBrandingPrograma lo
// scopea por comercio, así que un id ajeno no escribe nada.
export async function accionGuardarBrandingPrograma(
  programaId: string,
  _estadoPrevio: EstadoPrograma,
  formData: FormData,
): Promise<EstadoPrograma> {
  const { comercioId } = await verifyComercioOwner();
  const supabase = createServiceClient();

  const res = await guardarBrandingPrograma(
    supabase,
    comercioId,
    programaId,
    brandingProgramaDesdeFormulario({
      // Un checkbox HTML manda 'on' cuando está marcado y NO manda NADA cuando no lo está: la
      // AUSENCIA de la clave es el false (mismo criterio que mostrar_como_funciona en el reverso).
      brandingPropio: formData.get('branding_propio') !== null,
      colorFondo: String(formData.get('color_fondo') ?? ''),
      colorTexto: String(formData.get('color_texto') ?? ''),
      colorLabel: String(formData.get('color_label') ?? ''),
      difuminadoFranja: String(formData.get('difuminado_franja') ?? ''),
      selloMeta: String(formData.get('sello_meta') ?? ''),
    }),
  );
  if (!res.ok) return { error: res.error };

  await propagarMarcaPrograma(supabase, comercioId, programaId);

  revalidatePath('/comercio/programas');
  return { ok: true };
}

// Sube UNA imagen de UN programa. Mismo esqueleto que el de branding del comercio, con dos
// diferencias que no son cosméticas:
//   - la ruta lleva el programaId (rutaImagenPrograma): la subida usa upsert:true, así que con la
//     ruta del comercio el logo del programa PISARÍA el logo del negocio;
//   - el update se scopea por comercio_id además de por id, igual que el resto del módulo.
export async function accionSubirImagenPrograma(
  programaId: string,
  _estadoPrevio: EstadoPrograma,
  formData: FormData,
): Promise<EstadoPrograma> {
  const { comercioId } = await verifyComercioOwner();

  const campo = String(formData.get('campo') ?? '');
  if (!(CAMPOS_IMAGEN as readonly string[]).includes(campo)) {
    return { error: 'Campo de imagen no válido.' };
  }

  const archivo = formData.get('archivo');
  if (!(archivo instanceof File)) return { error: 'No se recibió ninguna imagen.' };

  const problema = validarImagenSubida({ type: archivo.type, size: archivo.size });
  if (problema) return { error: problema };

  const ext = extensionDeMime(archivo.type);
  const ruta = rutaImagenPrograma(comercioId, programaId, campo, ext);
  const supabase = createServiceClient();

  const { error: errorSubida } = await supabase.storage
    .from(BUCKET)
    .upload(ruta, await archivo.arrayBuffer(), { contentType: archivo.type, upsert: true });
  if (errorSubida) {
    console.error('[comercio] falló la subida de imagen de programa:', errorSubida);
    return { error: 'No se pudo subir la imagen.' };
  }

  // URL pública + cache-busting: la ruta es determinística y el CDN cachea, así que re-subir al
  // mismo path serviría la imagen vieja sin el ?v=.
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(ruta);
  const urlConVersion = `${pub.publicUrl}?v=${Date.now()}`;

  const actualizacion = {
    [`${campo}_url`]: urlConVersion,
  } as Database['public']['Tables']['programas_tarjeta']['Update'];

  const { error: errorUpdate } = await supabase
    .from('programas_tarjeta')
    .update(actualizacion)
    .eq('id', programaId)
    .eq('comercio_id', comercioId)
    .select('id')
    .single();
  if (errorUpdate) {
    console.error('[comercio] falló el guardado de la URL de imagen del programa:', errorUpdate);
    return { error: 'La imagen se subió pero no se pudo guardar su dirección.' };
  }

  await propagarMarcaPrograma(supabase, comercioId, programaId);

  revalidatePath('/comercio/programas');
  return { ok: true };
}

// Quita una imagen del programa: vacía la columna y borra el archivo del bucket (best-effort).
export async function accionQuitarImagenPrograma(
  programaId: string,
  campo: string,
  _estadoPrevio: EstadoPrograma,
  _formData: FormData,
): Promise<EstadoPrograma> {
  const { comercioId } = await verifyComercioOwner();

  if (!(CAMPOS_IMAGEN as readonly string[]).includes(campo)) {
    return { error: 'Campo de imagen no válido.' };
  }

  const supabase = createServiceClient();
  const actualizacion = {
    [`${campo}_url`]: null,
  } as Database['public']['Tables']['programas_tarjeta']['Update'];

  const { error: errorUpdate } = await supabase
    .from('programas_tarjeta')
    .update(actualizacion)
    .eq('id', programaId)
    .eq('comercio_id', comercioId)
    .select('id')
    .single();
  if (errorUpdate) {
    console.error('[comercio] no se pudo quitar la imagen del programa:', errorUpdate);
    return { error: 'No se pudo quitar la imagen.' };
  }

  // El archivo pudo subirse con cualquiera de las tres extensiones permitidas; borrar de más no
  // falla (remove ignora rutas inexistentes) y es best-effort: la referencia en la BD ya no existe.
  const rutas = ['png', 'jpg', 'webp'].map((ext) => rutaImagenPrograma(comercioId, programaId, campo, ext));
  const { error: errorStorage } = await supabase.storage.from(BUCKET).remove(rutas);
  if (errorStorage) console.warn('[comercio] no se pudo borrar el archivo del bucket:', errorStorage);

  await propagarMarcaPrograma(supabase, comercioId, programaId);

  revalidatePath('/comercio/programas');
  return { ok: true };
}

// Sin esto el dueño guarda la marca y NO PASA NADA VISIBLE: Wallet solo re-descarga el .pkpass
// cuando recibe un push, y Google tiene la grilla de cada tarjeta cacheada por URL. Las dos son
// best-effort (tragan y loguean sus fallos) y van acotadas al programa: las tarjetas del OTRO
// programa no cambiaron de aspecto y no tienen por qué re-descargar nada.
//
// PENDIENTE (Task 6 del plan): cuando el programa pueda tener su propia LoyaltyClass, acá va
// también su sincronización — guardarBrandingPrograma ya devuelve `necesitaClasePropia` para eso.
// Hoy logo y colores de cabecera siguen viniendo de la clase del COMERCIO.
async function propagarMarcaPrograma(
  supabase: ReturnType<typeof createServiceClient>,
  comercioId: string,
  programaId: string,
): Promise<void> {
  await notificarCambioPrograma(supabase, comercioId, programaId);
  await syncObjetosPrograma(supabase, comercioId, programaId);
}

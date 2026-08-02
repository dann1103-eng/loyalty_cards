'use server';

import { revalidatePath } from 'next/cache';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { guardarBranding } from '@/lib/comercio/guardarBranding';
import { guardarReverso } from '@/lib/comercio/guardarReverso';
import {
  guardarBrandingPrograma,
  brandingProgramaDesdeFormulario,
  volverAHeredarMarca,
  hayMarcaPropia,
} from '@/lib/comercio/guardarBrandingPrograma';
import {
  guardarReversoPrograma,
  volverAHeredarReverso,
  mostrarComoFuncionaDesdeFormulario,
} from '@/lib/comercio/guardarReversoPrograma';
import { notificarCambioComercio, notificarCambioPrograma } from '@/lib/apple/notificarCambioComercio';
import { syncClaseComercio } from '@/lib/google/syncClase';
import { syncObjetosComercio } from '@/lib/google/syncComercio';
import { propagarMarcaPrograma } from '@/lib/comercio/propagarMarca';
import {
  validarImagenSubida,
  extensionDeMime,
  rutaImagenComercio,
  rutaImagenPrograma,
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
  // Google Wallet: la clase lleva logo/nombre/colores de cabecera (una sola llamada para todos
  // los clientes); la GRILLA de sellos, en cambio, se compone por tarjeta y Google la cachea por
  // URL, así que los objetos hay que re-sincronizarlos uno por uno o los passes ya guardados se
  // quedan con la grilla vieja. Best-effort las dos.
  await syncClaseComercio(createServiceClient(), comercioId);
  await syncObjetosComercio(createServiceClient(), comercioId);

  revalidatePath('/comercio/branding');
  return { ok: true };
}

// Guarda el reverso del pass: términos de uso, redes y el interruptor de la sección automática.
// comercio_id SIEMPRE del gate, nunca del formulario. verifyComercioOwner() va FUERA de todo
// try/catch: redirige LANZANDO NEXT_REDIRECT, y un catch alrededor desactivaría el gate.
export async function accionGuardarReverso(
  _estadoPrevio: EstadoBranding,
  formData: FormData,
): Promise<EstadoBranding> {
  const { comercioId } = await verifyComercioOwner();

  const supabase = createServiceClient();
  const res = await guardarReverso(supabase, comercioId, {
    terminos_uso: String(formData.get('terminos_uso') ?? ''),
    red_instagram: String(formData.get('red_instagram') ?? ''),
    red_facebook: String(formData.get('red_facebook') ?? ''),
    red_whatsapp: String(formData.get('red_whatsapp') ?? ''),
    sitio_web: String(formData.get('sitio_web') ?? ''),
    // Un checkbox HTML manda 'on' cuando está marcado y NO manda NADA cuando no lo está: la
    // AUSENCIA de la clave es el false. La conversión vive acá, que es quien conoce el FormData;
    // guardarReverso recibe el booleano ya resuelto y no adivina.
    mostrar_como_funciona: formData.get('mostrar_como_funciona') !== null,
  });

  if (!res.ok) return { error: res.error };

  // El reverso viaja DENTRO del .pkpass: sin este aviso el dueño guarda su Instagram y las tarjetas
  // ya emitidas siguen mostrando el reverso viejo hasta el próximo cambio de puntos. Best-effort,
  // igual que en el branding: notificarCambioComercio traga sus fallos y nunca revierte el guardado.
  await notificarCambioComercio(supabase, comercioId);

  // Google Wallet queda fuera de alcance (spec §11): su equivalente de reverso —textModulesData y
  // linksModuleData— no se toca, así que acá no hay syncClaseComercio.

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

  // logo/hero alimentan la LoyaltyClass (cabecera del pass). El logo es además el gatillo que
  // recién HABILITA Google Wallet para un comercio que antes no lo tenía (programLogo es
  // obligatorio ahí).
  if (campo === 'logo' || campo === 'hero') {
    await syncClaseComercio(supabase, comercioId);
  }
  // hero/sello_icono/strip entran en la GRILLA compuesta por tarjeta: hay que re-sincronizar los
  // objetos o los passes ya guardados siguen mostrando la imagen cacheada por Google.
  if (campo === 'hero' || campo === 'sello_icono' || campo === 'strip') {
    await syncObjetosComercio(supabase, comercioId);
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
  if (campo === 'hero' || campo === 'sello_icono' || campo === 'strip') {
    await syncObjetosComercio(supabase, comercioId);
  }

  revalidatePath('/comercio/branding');
  return { ok: true };
}

// =================================================================================================
// LO MISMO, PERO PARA UNA TARJETA (un programa) EN VEZ DE PARA TODO EL NEGOCIO.
//
// Estas acciones vivían en app/comercio/(protegido)/programas/actions.ts, junto a un editor de marca
// propio que duplicaba el formulario y perdía la vista previa en vivo. El diseño de tarjetas vive en
// Marca; Programas quedó con tipo, configuración y QR.
//
// Dos reglas que valen para las cuatro:
//   - el comercioId SIEMPRE del gate y el programaId bindeado desde el componente, pero cada función
//     de lib scopea el update por comercio_id: un id de programa ajeno no escribe nada;
//   - el dueño NUNCA manda `branding_propio`/`reverso_propio`. Se DERIVAN de lo que cargó. El editor
//     anterior se los mostraba como una casilla "Usar marca propia" y no se entendió — es el nombre
//     de una columna filtrado a la interfaz.
// =================================================================================================

export async function accionGuardarBrandingDePrograma(
  programaId: string,
  _estadoPrevio: EstadoBranding,
  formData: FormData,
): Promise<EstadoBranding> {
  const { comercioId } = await verifyComercioOwner();
  const supabase = createServiceClient();

  const campos = brandingProgramaDesdeFormulario({
    // Placeholder: se recalcula abajo con hayMarcaPropia. Este booleano NO viaja en el formulario.
    brandingPropio: false,
    colorFondo: String(formData.get('color_fondo') ?? ''),
    colorTexto: String(formData.get('color_texto') ?? ''),
    colorLabel: String(formData.get('color_label') ?? ''),
    difuminadoFranja: String(formData.get('difuminado_franja') ?? ''),
    selloMeta: String(formData.get('sello_meta') ?? ''),
  });

  // Las imágenes NO las escribe este formulario (cada una es su propio Server Action de subida), así
  // que para saber si esta tarjeta tiene diseño propio hay que mirarlas en la fila. Sin esto, una
  // tarjeta con logo propio y sin colores propios volvería a heredar al guardar y el logo que el
  // dueño subió dejaría de verse.
  const { data: imagenes } = await supabase
    .from('programas_tarjeta')
    .select('logo_url, hero_url, strip_url, sello_icono_url')
    .eq('id', programaId)
    .eq('comercio_id', comercioId)
    .maybeSingle();

  const res = await guardarBrandingPrograma(supabase, comercioId, programaId, {
    ...campos,
    brandingPropio: hayMarcaPropia({
      colorFondo: campos.colorFondo,
      colorTexto: campos.colorTexto,
      colorLabel: campos.colorLabel,
      difuminadoFranja: campos.difuminadoFranja,
      logoUrl: imagenes?.logo_url ?? null,
      heroUrl: imagenes?.hero_url ?? null,
      stripUrl: imagenes?.strip_url ?? null,
      selloIconoUrl: imagenes?.sello_icono_url ?? null,
    }),
  });
  if (!res.ok) return { error: res.error };

  await propagarMarcaPrograma(supabase, comercioId, programaId);

  revalidatePath('/comercio/branding');
  return { ok: true };
}

// El botón "Usar el mismo diseño de mi negocio". No borra nada: apaga el interruptor y deja las
// columnas, así publicar de nuevo le devuelve al dueño el diseño que tenía.
export async function accionUsarDisenoDelNegocio(
  programaId: string,
  _estadoPrevio: EstadoBranding,
  _formData: FormData,
): Promise<EstadoBranding> {
  const { comercioId } = await verifyComercioOwner();
  const supabase = createServiceClient();

  const res = await volverAHeredarMarca(supabase, comercioId, programaId);
  if (!res.ok) return { error: res.error };

  await propagarMarcaPrograma(supabase, comercioId, programaId);

  revalidatePath('/comercio/branding');
  return { ok: true };
}

export async function accionGuardarReversoDePrograma(
  programaId: string,
  _estadoPrevio: EstadoBranding,
  formData: FormData,
): Promise<EstadoBranding> {
  const { comercioId } = await verifyComercioOwner();
  const supabase = createServiceClient();

  const res = await guardarReversoPrograma(supabase, comercioId, programaId, {
    terminosUso: String(formData.get('terminos_uso') ?? ''),
    redInstagram: String(formData.get('red_instagram') ?? ''),
    redFacebook: String(formData.get('red_facebook') ?? ''),
    redWhatsapp: String(formData.get('red_whatsapp') ?? ''),
    sitioWeb: String(formData.get('sitio_web') ?? ''),
    // Un <select> de tres opciones y no una casilla: acá el campo es tri-estado (heredar del
    // negocio / mostrar / ocultar) y una casilla solo tiene dos posiciones.
    mostrarComoFunciona: mostrarComoFuncionaDesdeFormulario(
      String(formData.get('mostrar_como_funciona') ?? ''),
    ),
  });
  if (!res.ok) return { error: res.error };

  // Solo Apple: el reverso viaja DENTRO del .pkpass. Google queda fuera de alcance igual que en el
  // reverso del comercio (su equivalente —textModulesData/linksModuleData— no se toca).
  await notificarCambioPrograma(supabase, comercioId, programaId);

  revalidatePath('/comercio/branding');
  return { ok: true };
}

export async function accionUsarReversoDelNegocio(
  programaId: string,
  _estadoPrevio: EstadoBranding,
  _formData: FormData,
): Promise<EstadoBranding> {
  const { comercioId } = await verifyComercioOwner();
  const supabase = createServiceClient();

  const res = await volverAHeredarReverso(supabase, comercioId, programaId);
  if (!res.ok) return { error: res.error };

  await notificarCambioPrograma(supabase, comercioId, programaId);

  revalidatePath('/comercio/branding');
  return { ok: true };
}

// Sube UNA imagen de UNA tarjeta. Mismo esqueleto que el del comercio, con tres diferencias que no
// son cosméticas:
//   - la ruta lleva el programaId (rutaImagenPrograma): la subida usa upsert:true, así que con la
//     ruta del comercio el logo de la tarjeta PISARÍA el logo del negocio;
//   - el update se scopea por comercio_id además de por id;
//   - enciende `branding_propio`. Subirle una imagen a UNA tarjeta es la intención inequívoca de
//     que se vea distinta: sin esta línea, la imagen queda guardada y el cliente sigue viendo la
//     del negocio, que es exactamente el "guardé y no pasó nada" del editor anterior.
export async function accionSubirImagenDePrograma(
  programaId: string,
  _estadoPrevio: EstadoBranding,
  formData: FormData,
): Promise<EstadoBranding> {
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
    branding_propio: true,
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

  revalidatePath('/comercio/branding');
  return { ok: true };
}

// Quita una imagen de la tarjeta: vacía la columna y borra el archivo del bucket (best-effort).
//
// A propósito NO recalcula `branding_propio`: quitar una imagen es sacar UNA cosa, no pedir volver
// al diseño del negocio. Para eso está el botón "Usar el mismo diseño de mi negocio", que es
// explícito. Recalcular acá también significaría que quitar la última imagen de una tarjeta que el
// dueño había mandado a heredar la devolviera a diseño propio sin que él lo pidiera.
export async function accionQuitarImagenDePrograma(
  programaId: string,
  campo: string,
  _estadoPrevio: EstadoBranding,
  _formData: FormData,
): Promise<EstadoBranding> {
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

  revalidatePath('/comercio/branding');
  return { ok: true };
}

// Sin esto el dueño publica el diseño y NO PASA NADA VISIBLE: Wallet solo re-descarga el .pkpass
// cuando recibe un push, y Google tiene la grilla de cada tarjeta cacheada por URL. Las dos son
// best-effort (tragan y loguean sus fallos) y van acotadas al programa: las tarjetas del OTRO
// programa no cambiaron de aspecto y no tienen por qué re-descargar nada.
//
// La LoyaltyClass propia del programa NO se sincroniza acá, y es deliberado: se crea perezosamente
// en linkGuardar, cuando un cliente toca "guardar en Google Wallet". Una clase de Google no se
// puede borrar (la API no tiene delete), así que crearla al guardar el formulario dejaría un recurso
// permanente en el emisor por cada tarjeta que el dueño solo estaba probando.


import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { walletClient, issuerId } from './walletClient';
import { idClasePrograma } from './ids';
import { construirClase } from './construirRecursos';
import { listarUbicacionesGeopush } from '../comercio/geopush';
import { brandingEfectivo, necesitaClasePropia } from '../comercio/brandingEfectivo';

export type ResultadoSyncClasePrograma =
  // classId null = este programa NO tiene clase propia y sus objetos siguen colgando de la del
  // comercio. No es un error: es el estado normal de casi todos los programas.
  { ok: true; classId: string | null } | { ok: false; error: string };

// Crea o actualiza la LoyaltyClass PROPIA de un programa. Best-effort, igual que syncClaseComercio.
//
// LO MÁS IMPORTANTE DE ESTE MÓDULO: cada clase que se crea es PERMANENTE. La API de Google no tiene
// `delete` para LoyaltyClass (verificado contra el SDK instalado: addmessage/get/insert/list/patch/
// update, y nada más). Una clase creada por error queda para siempre en el emisor de producción y
// la ve el revisor de Google. Por eso:
//
//   1. Solo se crea si `necesitaClasePropia` da true, o sea si el programa define alguno de los
//      TRES campos que Google guarda en la clase (color de fondo, logo, imagen de portada). Los
//      otros cinco campos de branding viven en el .pkpass y en el heroImage del objeto, así que un
//      dueño que solo cambia el ícono del sello NO genera una clase.
//   2. `google_class_id` NUNCA vuelve a null una vez seteado. Apagar el branding propio deja la
//      clase existiendo y le hace `patch` con lo heredado. Si se borrara el id, reencender haría un
//      `insert` sobre un id que ya existe — un error irreparable, porque no se puede limpiar
//      borrando la clase.
export async function syncClasePrograma(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  programaId: string,
): Promise<ResultadoSyncClasePrograma> {
  const { data: programa, error } = await supabase
    .from('programas_tarjeta')
    .select(
      'id, branding_propio, google_class_id, color_fondo, color_texto, color_label, logo_url, hero_url, strip_url, sello_icono_url, difuminado_franja, comercios(nombre, color_fondo, color_texto, color_label, logo_url, hero_url, strip_url, sello_icono_url, difuminado_franja)',
    )
    .eq('id', programaId)
    // Scope por comercio: conocer el id de un programa ajeno no debe permitir tocarle la clase.
    .eq('comercio_id', comercioId)
    .maybeSingle();

  if (error || !programa || !programa.comercios) {
    console.error('[google] no se pudo leer el programa para sincronizar su clase:', error);
    return { ok: false, error: 'No se pudo leer el programa.' };
  }

  const c = programa.comercios;

  // Si nunca creó clase Y no la necesita, no se hace NADA. Es el camino de la enorme mayoría de los
  // programas y el que mantiene limpio el emisor.
  const necesita = necesitaClasePropia({
    brandingPropio: programa.branding_propio,
    colorFondo: programa.color_fondo,
    logoUrl: programa.logo_url,
    heroUrl: programa.hero_url,
  });
  if (!necesita && !programa.google_class_id) {
    return { ok: true, classId: null };
  }

  const marca = brandingEfectivo(
    {
      colorFondo: c.color_fondo,
      colorTexto: c.color_texto,
      colorLabel: c.color_label,
      logoUrl: c.logo_url,
      heroUrl: c.hero_url,
      stripUrl: c.strip_url,
      selloIconoUrl: c.sello_icono_url,
      difuminadoFranja: c.difuminado_franja,
    },
    {
      // Si el branding propio está apagado pero la clase YA existe, se le hace patch con lo
      // heredado: la clase queda mostrando la marca del comercio en vez de desaparecer (no puede).
      brandingPropio: programa.branding_propio,
      colorFondo: programa.color_fondo,
      colorTexto: programa.color_texto,
      colorLabel: programa.color_label,
      logoUrl: programa.logo_url,
      heroUrl: programa.hero_url,
      stripUrl: programa.strip_url,
      selloIconoUrl: programa.sello_icono_url,
      difuminadoFranja: programa.difuminado_franja ?? undefined,
    },
  );

  // Google EXIGE programLogo. Sin logo efectivo no hay clase posible — el mismo criterio que
  // syncClaseComercio, que directamente no crea la clase de un comercio sin logo.
  if (!marca.logoUrl) {
    return { ok: false, error: 'El programa no tiene logo (ni propio ni heredado); Google lo requiere.' };
  }

  try {
    const classId = programa.google_class_id ?? idClasePrograma(issuerId(), programaId);
    // Las ubicaciones del geopush viven en la CLASE, así que la clase del programa también las
    // necesita: sin esto, los clientes de un programa con marca propia pierden el aviso por
    // cercanía que sí tienen los del programa principal.
    const ubicaciones = await listarUbicacionesGeopush(supabase, comercioId);

    const cuerpo = construirClase(classId, {
      // El nombre sigue siendo el del COMERCIO a propósito (decisión 9 del spec): el cliente tiene
      // que reconocer de qué negocio es la tarjeta. Lo que distingue a los programas es la marca.
      nombre: c.nombre,
      colorFondo: marca.colorFondo,
      logoUrl: marca.logoUrl,
      heroUrl: marca.heroUrl,
      ubicaciones,
    });
    const client = walletClient();

    if (programa.google_class_id) {
      await client.loyaltyclass.patch({ resourceId: classId, requestBody: cuerpo });
    } else {
      await client.loyaltyclass.insert({ requestBody: cuerpo });
      // Guard de una sola escritura, igual que en syncClaseComercio: bajo dos llamadas
      // concurrentes, Google es idempotente por id pero solo la primera escritura en BD gana.
      const { error: errorUpdate } = await supabase
        .from('programas_tarjeta')
        .update({ google_class_id: classId })
        .eq('id', programaId)
        .is('google_class_id', null);
      if (errorUpdate) {
        console.error('[google] la clase del programa se creó pero no se pudo guardar su id:', errorUpdate);
      }
    }
    return { ok: true, classId };
  } catch (err) {
    console.error('[google] falló la sincronización de la clase del programa:', err);
    return { ok: false, error: 'No se pudo sincronizar con Google Wallet.' };
  }
}

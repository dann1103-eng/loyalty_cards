import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import { brandingEfectivo } from '../brandingEfectivo';
import { urlRegistroPrograma } from '../urlRegistroPrograma';
import { combinarDatosCartel } from './combinarDatos';
import type { DatosCartel } from './tipos';

// Descarga una imagen pública (Storage) y la convierte a data: URI. NUNCA se pasa una URL remota a
// construirCartelSvg (spec §4.1): un renderizador SVG del lado servidor puede no resolver
// referencias externas, y el logo/foto desaparecerían en silencio del PNG/PDF exportado.
// Best-effort: si falla, el cartel se arma igual sin esa imagen (spec §7) — una imagen faltante no
// puede tumbar la descarga entera de un cartel.
async function aDataUri(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const respuesta = await fetch(url);
    if (!respuesta.ok) return null;
    const tipo = respuesta.headers.get('content-type') ?? 'image/webp';
    const bytes = Buffer.from(await respuesta.arrayBuffer());
    return `data:${tipo};base64,${bytes.toString('base64')}`;
  } catch (error) {
    console.warn('[comercio] no se pudo convertir una imagen del cartel a data URI:', error);
    return null;
  }
}

export interface CartelResuelto {
  datos: DatosCartel;
  // Sigue siendo accesible con un programa desactivado (spec §7 — el dueño puede querer archivar el
  // diseño); esto es solo lo que la UI necesita para mostrar el aviso de que el QR ya no registra
  // clientes. No forma parte de DatosCartel a propósito: construirCartelSvg no lo necesita para
  // nada, es puramente informativo para la pantalla.
  programaActivo: boolean;
  // La marca EFECTIVA del programa (0027), SIN los overrides del cartel: es a lo que vuelve el
  // toggle "usar mi logo y colores de marca" cuando el dueño lo prende (spec §6.3), y por eso no
  // puede salir de una segunda consulta a `comercios` — un programa con marca propia tiene que
  // volver a SU marca, no a la del negocio. Se devuelve desde acá porque ya está calculada: cuesta
  // cero consultas extra y evita que la pantalla la recalcule mal por su cuenta.
  marcaEfectiva: { colorFondo: string; colorTexto: string; colorLabel: string };
  // El tipo del PROGRAMA. No forma parte de DatosCartel porque construirCartelSvg no lo necesita —
  // para cuando el cartel se dibuja, el tipo ya se convirtió en la frase del CTA. Lo usa la pantalla
  // para ofrecer "usar la frase sugerida" después de que el dueño la editó.
  tipoTarjeta: string;
}

// Punto de entrada único para leer todo lo que necesita el cartel de un programa. El chequeo de
// propiedad vive ACÁ (el filtro .eq('comercio_id', comercioId) sobre programas_tarjeta): si el
// programaId no es de este comercio, `programa` viene null y la función devuelve null ANTES de usar
// nada más — así el Server Component, el Route Handler de descarga y cualquier otro llamador quedan
// protegidos por el mismo código, sin tener que repetir el chequeo cada uno por su cuenta.
export async function resolverDatosCartel(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  programaId: string,
): Promise<CartelResuelto | null> {
  const [{ data: comercio, error: eComercio }, { data: programa, error: ePrograma }, { data: diseno, error: eDiseno }] =
    await Promise.all([
      supabase
        .from('comercios')
        // strip_url/sello_icono_url/difuminado_franja no se dibujan en ningún cartel: se leen
        // porque brandingEfectivo pide el branding COMPLETO, y rellenar esos tres con literales
        // inventados dejaría un `stripUrl: null` mentiroso a la espera de que alguien lo lea.
        // Cuesta cero round-trips.
        .select('nombre, slug, color_fondo, color_texto, color_label, logo_url, hero_url, strip_url, sello_icono_url, difuminado_franja')
        .eq('id', comercioId)
        .maybeSingle(),
      supabase
        .from('programas_tarjeta')
        .select(
          'slug, es_principal, activo, tipo_tarjeta, branding_propio, color_fondo, color_texto, color_label, logo_url, hero_url, strip_url, sello_icono_url, difuminado_franja',
        )
        .eq('id', programaId)
        .eq('comercio_id', comercioId)
        .maybeSingle(),
      supabase
        .from('disenos_cartel')
        .select('plantilla, color_fondo, color_texto, color_label, logo_url, texto_cta, texto_teaser, elementos')
        .eq('programa_id', programaId)
        .maybeSingle(),
    ]);

  if (eComercio || !comercio || ePrograma || !programa) {
    if (eComercio) console.error('[comercio] no se pudo leer el comercio para el cartel:', eComercio);
    if (ePrograma) console.error('[comercio] no se pudo leer el programa para el cartel:', ePrograma);
    return null;
  }
  // eDiseno: la ausencia de fila NO es un error (spec §3, "sin personalizar"). Solo se registra un
  // error real de consulta, y se trata como "sin fila" para no bloquear el cartel por esto.
  if (eDiseno) console.error('[comercio] no se pudo leer el diseño de cartel guardado:', eDiseno);

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  const urlRegistro = urlRegistroPrograma(baseUrl, comercio.slug, programa.slug, programa.es_principal);
  if (!urlRegistro) {
    console.error('[comercio] falta NEXT_PUBLIC_BASE_URL: no se puede armar el QR del cartel');
    return null;
  }

  // La base de la herencia es la marca EFECTIVA del programa (migración 0027), no las columnas
  // crudas de `comercios`: un programa con marca propia tiene que imprimir SU logo y SUS colores,
  // igual que su pase de Apple y su clase de Google. El plan de esta tarea leía `comercios` a secas
  // —quedó escrito antes de que existiera el branding por programa— y con eso el cartel de un
  // cupón con marca propia habría salido con la marca del negocio. La 0028 ya lo dice en su propio
  // comentario: "null = heredá del branding efectivo del programa (que a su vez hereda del
  // comercio, 0027)". Toda esa lógica vive en brandingEfectivo para que los consumidores no puedan
  // divergir — este es uno más de ellos.
  const marca = brandingEfectivo(
    {
      colorFondo: comercio.color_fondo,
      colorTexto: comercio.color_texto,
      colorLabel: comercio.color_label,
      logoUrl: comercio.logo_url,
      heroUrl: comercio.hero_url,
      stripUrl: comercio.strip_url,
      selloIconoUrl: comercio.sello_icono_url,
      difuminadoFranja: comercio.difuminado_franja,
    },
    {
      brandingPropio: programa.branding_propio,
      colorFondo: programa.color_fondo,
      colorTexto: programa.color_texto,
      colorLabel: programa.color_label,
      logoUrl: programa.logo_url,
      heroUrl: programa.hero_url,
      stripUrl: programa.strip_url,
      selloIconoUrl: programa.sello_icono_url,
      // `?? undefined` porque en el programa esta columna es nullable y en BrandingBase no:
      // undefined activa el `??` de brandingEfectivo y hereda.
      difuminadoFranja: programa.difuminado_franja ?? undefined,
    },
  );

  // combinarDatosCartel recibe la marca ya resuelta con los nombres de columna de `comercios`: es
  // la capa pura de override-vs-heredado (Tarea 8) y no sabe —ni tiene por qué— si esos valores
  // vinieron del negocio o del programa.
  const marcaParaCartel = {
    nombre: comercio.nombre,
    color_fondo: marca.colorFondo,
    color_texto: marca.colorTexto,
    color_label: marca.colorLabel,
    logo_url: marca.logoUrl,
    hero_url: marca.heroUrl,
  };
  // `tipo_tarjeta` sale del PROGRAMA y no de `comercios`: son columnas distintas que pueden
  // divergir (el panel de FM cambia la del comercio sin propagarla), y el cartel imprime el QR de
  // ESTE programa. Solo decide la frase que se PROPONE cuando todavía no hay una guardada.
  const combinados = combinarDatosCartel(marcaParaCartel, eDiseno ? null : diseno, programa.tipo_tarjeta);
  // La misma combinación pero SIN el diseño guardado: es la marca a la que vuelve el toggle de la
  // pantalla. Se saca de combinarDatosCartel y no de `marca` directo para que aplique sus mismos
  // defaults del sistema — así el toggle no puede ofrecer un color distinto del que dibujaría el
  // cartel de un comercio que nunca configuró su marca.
  const sinOverrides = combinarDatosCartel(marcaParaCartel, null, programa.tipo_tarjeta);

  const [logoDataUri, fotoDataUri] = await Promise.all([
    aDataUri(combinados.logoUrl),
    aDataUri(combinados.fotoUrl),
  ]);

  return {
    datos: {
      nombreComercio: combinados.nombreComercio,
      plantilla: combinados.plantilla,
      colorFondo: combinados.colorFondo,
      colorTexto: combinados.colorTexto,
      colorLabel: combinados.colorLabel,
      logoDataUri,
      fotoDataUri,
      textoCta: combinados.textoCta,
      textoTeaser: combinados.textoTeaser,
      urlRegistro,
      elementos: combinados.elementos,
    },
    programaActivo: programa.activo,
    tipoTarjeta: programa.tipo_tarjeta,
    marcaEfectiva: {
      colorFondo: sinOverrides.colorFondo,
      colorTexto: sinOverrides.colorTexto,
      colorLabel: sinOverrides.colorLabel,
    },
  };
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import { brandingEfectivo } from '@/lib/comercio/brandingEfectivo';
import { encuadreDelComercio, encuadreDelPrograma } from '@/lib/comercio/encuadreFranja';

// La marca que el CLIENTE FINAL ve al escanear el QR del mostrador.
//
// ══ POR QUÉ EXISTE ══
// Hasta el 2026-09-08 la pantalla de registro solo recibía el NOMBRE del comercio: la tarjeta de
// muestra se dibujaba con un degradado marrón cableado en el componente. O sea que el dueño
// personalizaba su marca en el editor y la PRIMERA pantalla que su cliente ve —el momento de la
// conversión— no la usaba. El caso que lo destapó: el dueño de un comercio de membresía escaneó su
// propio QR después de configurar su azul con logo y se encontró una tarjeta café.
//
// Vive en un módulo aparte y no adentro de cada `page.tsx` porque son DOS páginas de registro (el
// QR viejo sin programa y el QR de un programa no principal, migración 0024) y las dos tienen que
// resolver la marca igual. Duplicado, alcanzaba con tocar una para que el cliente de un QR viera
// una marca y el del otro viera otra.
export interface MarcaRegistro {
  colorFondo: string | null;
  colorTexto: string | null;
  colorLabel: string | null;
  logoUrl: string | null;
}

// Neutro: los cuatro nulos. El componente tiene su propio fallback, así que un error de consulta
// deja la tarjeta de muestra con los colores del sistema y el FORMULARIO SIGUE EN PIE — que es lo
// único que esta pantalla tiene que lograr sí o sí.
const SIN_MARCA: MarcaRegistro = { colorFondo: null, colorTexto: null, colorLabel: null, logoUrl: null };

// Las mismas columnas que lee el editor de marca (branding/page.tsx) y el resto de los consumidores
// de brandingEfectivo. `hero_url`, `strip_url`, `sello_icono_url` y `difuminado_franja` no se
// dibujan en esta tarjeta de muestra: se leen porque brandingEfectivo pide el branding COMPLETO, y
// rellenarlos con literales inventados dejaría un `stripUrl: null` mentiroso esperando a que
// alguien lo lea. Cuesta cero round-trips extra —— mismo criterio que resolverDatosCartel.
const COLUMNAS_MARCA =
  'color_fondo, color_texto, color_label, logo_url, hero_url, strip_url, sello_icono_url, difuminado_franja, encuadre_franja, foco_franja_x, foco_franja_y, zoom_franja';

export async function marcaDelRegistro(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  programaId: string,
): Promise<MarcaRegistro> {
  const [{ data: comercio, error: eComercio }, { data: programa, error: ePrograma }] = await Promise.all([
    supabase.from('comercios').select(COLUMNAS_MARCA).eq('id', comercioId).maybeSingle(),
    supabase
      .from('programas_tarjeta')
      .select(`branding_propio, ${COLUMNAS_MARCA}`)
      // Scope por comercio como en todo el módulo de programas, aunque el id venga de
      // resolverProgramaPorSlug —que ya filtró por este comercio—: es más simple mantener "todo
      // scopeado siempre" que recordar cuáles lecturas son internas.
      .eq('id', programaId)
      .eq('comercio_id', comercioId)
      .maybeSingle(),
  ]);

  if (eComercio || ePrograma || !comercio) {
    if (eComercio) console.error('[registro] no se pudo leer la marca del comercio:', eComercio);
    if (ePrograma) console.error('[registro] no se pudo leer la marca del programa:', ePrograma);
    return SIN_MARCA;
  }

  // La marca EFECTIVA del programa, no las columnas crudas de `comercios` (migración 0027): una
  // tarjeta con marca propia tiene que registrarse con SU logo y SUS colores, los mismos que va a
  // llevar su pase. Toda la herencia vive en brandingEfectivo para que los consumidores no puedan
  // divergir; este es uno más de ellos.
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
      encuadreFranja: encuadreDelComercio(comercio),
    },
    programa
      ? {
          brandingPropio: programa.branding_propio,
          colorFondo: programa.color_fondo,
          colorTexto: programa.color_texto,
          colorLabel: programa.color_label,
          logoUrl: programa.logo_url,
          heroUrl: programa.hero_url,
          stripUrl: programa.strip_url,
          selloIconoUrl: programa.sello_icono_url,
          // undefined activa el `??` de brandingEfectivo y hereda.
          difuminadoFranja: programa.difuminado_franja ?? undefined,
          encuadreFranja: encuadreDelPrograma(programa),
        }
      : null,
  );

  return {
    colorFondo: marca.colorFondo,
    colorTexto: marca.colorTexto,
    colorLabel: marca.colorLabel,
    logoUrl: marca.logoUrl,
  };
}

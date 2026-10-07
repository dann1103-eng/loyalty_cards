import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { componerFranja } from '@/lib/apple/stripPass';
import { brandingEfectivo } from '@/lib/comercio/brandingEfectivo';
import { encuadreDelComercio, encuadreDelPrograma } from '@/lib/comercio/encuadreFranja';
import { patronDeFila, SIN_PATRON } from '@/lib/tarjetas/patronSellos';

export const runtime = 'nodejs';

const COLUMNAS_MARCA =
  'color_fondo, color_texto, color_label, logo_url, hero_url, strip_url, sello_icono_url, sello_icono_2_url, sello_patron, sello_casillas, difuminado_franja, encuadre_franja, oscurecer_franja, foco_franja_x, foco_franja_y, zoom_franja';

// La portada (heroImage) de la LoyaltyClass de Google: la MISMA banda de marca que va en el pass de
// Apple (velo, difuminado, resplandor, encuadre). Hasta la 0032 la clase apuntaba a la foto cruda y
// en Android la portada no se parecía a la del iPhone. Es de TODOS los clientes del programa, así
// que nunca lleva progreso (tipo 'puntos', 0, sin meta) ni ícono de sello; y la franja personalizada
// queda afuera a propósito (stripUrl null): componerFranja con strip devuelve bytes crudos de
// formato y tamaño arbitrarios, que es lo que Google rechaza al validar la clase.
//
// Está en el camino crítico de la creación de la clase (Google descarga la imagen al insertar), por
// eso renderiza UNA escala y no tres.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ comercioId: string }> },
) {
  const { comercioId } = await params;
  const programaId = request.nextUrl.searchParams.get('programa');
  const supabase = createServiceClient();

  const [{ data: c }, { data: programa }] = await Promise.all([
    supabase.from('comercios').select(COLUMNAS_MARCA).eq('id', comercioId).maybeSingle(),
    programaId
      ? supabase
          .from('programas_tarjeta')
          .select(`branding_propio, ${COLUMNAS_MARCA}`)
          .eq('id', programaId)
          // Scope por comercio: un programa ajeno o inexistente es 404, no "el comercio a secas".
          .eq('comercio_id', comercioId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (!c || (programaId && !programa)) {
    return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
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
      selloIcono2Url: c.sello_icono_2_url,
      patronSellos: patronDeFila(c),
      difuminadoFranja: c.difuminado_franja,
      encuadreFranja: encuadreDelComercio(c),
      oscurecerFranja: c.oscurecer_franja,
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
          selloIcono2Url: programa.sello_icono_2_url,
          patronSellos: patronDeFila(programa),
          difuminadoFranja: programa.difuminado_franja ?? undefined,
          encuadreFranja: encuadreDelPrograma(programa),
          oscurecerFranja: programa.oscurecer_franja,
        }
      : null,
  );

  if (!marca.heroUrl) {
    return NextResponse.json({ error: 'Sin foto de fondo' }, { status: 404 });
  }

  const png = await componerFranja(
    {
      tipoTarjeta: 'puntos',
      puntos: 0,
      selloMeta: null,
      colorFondo: marca.colorFondo ?? 'rgb(35, 24, 18)',
      colorLabel: marca.colorLabel ?? 'rgb(255, 255, 255)',
      stripUrl: null,
      selloIconoUrl: null,
      selloIcono2Url: null,
      patronSellos: SIN_PATRON,
      heroUrl: marca.heroUrl,
      difuminadoFranja: marca.difuminadoFranja,
      encuadreFranja: marca.encuadreFranja,
      // No dibuja grilla (es la portada de la clase), así que esto no se mira.
      oscurecerFranja: true,
      // La portada de la CLASE no lleva nada escrito encima: sin velo sobre la foto.
      hayTextoEncima: false,
    },
    3,
  );
  if (!png) {
    return NextResponse.json({ error: 'No se pudo componer la imagen' }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(png), {
    status: 200,
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
  });
}

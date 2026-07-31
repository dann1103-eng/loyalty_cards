import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { componerStrips } from '@/lib/apple/stripPass';
import { brandingEfectivo } from '@/lib/comercio/brandingEfectivo';

export const runtime = 'nodejs';

// Sirve la MISMA grilla de sellos que ya se compone para la franja del pass de Apple
// (lib/apple/stripPass.tsx), pero como una imagen pública independiente — es lo que permite
// usarla como heroImage de un LoyaltyObject de Google (que exige una URL, no bytes incrustados
// como hace passkit-generator). Pensada para reflejar el progreso de ESTA tarjeta puntual: el
// llamador (construirObjeto) decide si corresponde usarla (solo sellos con meta).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tarjetaId: string }> },
) {
  const { tarjetaId } = await params;
  const supabase = createServiceClient();

  const { data: tarjeta } = await supabase
    .from('tarjetas')
    // programas_tarjeta trae el tipo y la meta REALES (0024). Esta ruta es la que DIBUJA la grilla,
    // y su fallo es SILENCIOSO: con el tipo del comercio, un programa de sellos bajo un comercio de
    // puntos hacía que componerStrips cayera en la banda de marca en vez de la grilla, y Google
    // cacheaba esa imagen equivocada. Peor: el cache-busting de heroUrl.ts hashea el branding, así
    // que la URL cambiaba y Google re-descargaba… la misma imagen mal dibujada.
    .select(
      'puntos_actuales, programas_tarjeta(tipo_tarjeta, sello_meta, branding_propio, color_fondo, color_texto, color_label, logo_url, hero_url, strip_url, sello_icono_url, difuminado_franja), comercios(tipo_tarjeta, sello_meta, color_fondo, color_texto, color_label, logo_url, strip_url, sello_icono_url, hero_url, difuminado_franja)',
    )
    .eq('id', tarjetaId)
    .maybeSingle();

  if (!tarjeta || !tarjeta.comercios) {
    return NextResponse.json({ error: 'Tarjeta no encontrada' }, { status: 404 });
  }

  // Cuelga del PROGRAMA entero, no de cada campo (ver datosPassDeTarjeta.ts).
  const programa = tarjeta.programas_tarjeta;
  const c = tarjeta.comercios;

  // El branding con el que se DIBUJA tiene que ser el mismo que versionHero hashea para el `?v=`.
  // Si divergen, la URL cambia, Google re-descarga, y recibe la imagen de siempre: cache-busting
  // perfecto entregando lo incorrecto, sin un solo error.
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
          difuminadoFranja: programa.difuminado_franja ?? undefined,
        }
      : null,
  );

  const strips = await componerStrips({
    tipoTarjeta: programa ? programa.tipo_tarjeta : c.tipo_tarjeta,
    puntos: tarjeta.puntos_actuales,
    selloMeta: programa ? programa.sello_meta : c.sello_meta,
    colorFondo: marca.colorFondo ?? 'rgb(35, 24, 18)',
    colorLabel: marca.colorLabel ?? 'rgb(255, 255, 255)',
    stripUrl: marca.stripUrl,
    selloIconoUrl: marca.selloIconoUrl,
    heroUrl: marca.heroUrl,
    difuminadoFranja: marca.difuminadoFranja,
  });

  if (!strips) {
    return NextResponse.json({ error: 'No se pudo componer la imagen' }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(strips.s2), {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      // El saldo cambia con cada acreditación/canje: nunca debe quedar cacheada.
      'Cache-Control': 'no-store',
    },
  });
}

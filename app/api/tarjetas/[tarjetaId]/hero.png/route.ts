import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { componerStrips } from '@/lib/apple/stripPass';

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
      'puntos_actuales, programas_tarjeta(tipo_tarjeta, sello_meta), comercios(tipo_tarjeta, sello_meta, color_fondo, color_label, strip_url, sello_icono_url, hero_url, difuminado_franja)',
    )
    .eq('id', tarjetaId)
    .maybeSingle();

  if (!tarjeta || !tarjeta.comercios) {
    return NextResponse.json({ error: 'Tarjeta no encontrada' }, { status: 404 });
  }

  // Cuelga del PROGRAMA entero, no de cada campo (ver datosPassDeTarjeta.ts).
  const programa = tarjeta.programas_tarjeta;

  const strips = await componerStrips({
    tipoTarjeta: programa ? programa.tipo_tarjeta : tarjeta.comercios.tipo_tarjeta,
    puntos: tarjeta.puntos_actuales,
    selloMeta: programa ? programa.sello_meta : tarjeta.comercios.sello_meta,
    colorFondo: tarjeta.comercios.color_fondo ?? 'rgb(35, 24, 18)',
    colorLabel: tarjeta.comercios.color_label ?? 'rgb(255, 255, 255)',
    stripUrl: tarjeta.comercios.strip_url,
    selloIconoUrl: tarjeta.comercios.sello_icono_url,
    heroUrl: tarjeta.comercios.hero_url,
    difuminadoFranja: tarjeta.comercios.difuminado_franja,
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

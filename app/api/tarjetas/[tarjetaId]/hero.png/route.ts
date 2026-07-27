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
    .select(
      'puntos_actuales, comercios(tipo_tarjeta, sello_meta, color_fondo, color_label, strip_url, sello_icono_url, hero_url, difuminado_franja)',
    )
    .eq('id', tarjetaId)
    .maybeSingle();

  if (!tarjeta || !tarjeta.comercios) {
    return NextResponse.json({ error: 'Tarjeta no encontrada' }, { status: 404 });
  }

  const strips = await componerStrips({
    tipoTarjeta: tarjeta.comercios.tipo_tarjeta,
    puntos: tarjeta.puntos_actuales,
    selloMeta: tarjeta.comercios.sello_meta,
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

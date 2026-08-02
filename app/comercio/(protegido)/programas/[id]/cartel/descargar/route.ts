import { NextRequest, NextResponse } from 'next/server';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { resolverDatosCartel } from '@/lib/comercio/cartel/resolverDatosCartel';
import { construirCartelSvg } from '@/lib/comercio/cartel/plantillas';
import { dibujarTextoConInter } from '@/lib/comercio/cartel/textoInter';
import { rasterizarCartelPng, generarCartelPdf } from '@/lib/comercio/cartel/export';
import { FORMATOS_CARTEL, type FormatoCartel } from '@/lib/comercio/cartel/tipos';

// `sharp`/`pdf-lib` necesitan el runtime de Node (no Edge) — mismo requisito que ya declara
// hero.png/route.ts para sharp.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Descarga del cartel ya diseñado, en PNG o PDF. Es un Route Handler y no un Server Action porque
// devuelve un ARCHIVO — mismo motivo que clientes/exportar/route.ts.
//
// Gate de DUEÑO: verifyComercioOwner() FUERA de cualquier try/catch (redirect() lanza NEXT_REDIRECT).
// resolverDatosCartel verifica que el programaId de la URL sea del comercioId de la sesión — un
// programa ajeno da null, y acá se traduce a 404 (nunca 403: no hay que confirmarle a nadie que el
// id existe).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: programaId } = await params;
  const { comercioId } = await verifyComercioOwner();

  const formatoParam = request.nextUrl.searchParams.get('formato');
  const tipo = request.nextUrl.searchParams.get('tipo');
  if (!FORMATOS_CARTEL.includes(formatoParam as FormatoCartel) || (tipo !== 'png' && tipo !== 'pdf')) {
    return NextResponse.json({ error: 'Parámetros de descarga inválidos.' }, { status: 400 });
  }
  const formato = formatoParam as FormatoCartel;

  const supabase = createServiceClient();
  const resuelto = await resolverDatosCartel(supabase, comercioId, programaId);
  if (!resuelto) {
    return NextResponse.json({ error: 'No encontrado.' }, { status: 404 });
  }
  // programaActivo no importa para la descarga: si el dueño quiere igual el archivo de un programa
  // desactivado (para archivo, por ejemplo), la ruta no se lo impide — el aviso de §7 es informativo
  // en la pantalla del editor (Tarea 12), no un bloqueo de descarga.
  const { datos } = resuelto;

  // `dibujarTextoConInter` y no el <text> de la vista previa: acá el SVG lo rasteriza librsvg dentro
  // de un lambda SIN NINGUNA fuente instalada, donde un <text> sale como un cuadradito por letra
  // (bug del 2026-08-02). Los contornos no dependen del sistema de fuentes.
  const svg = await construirCartelSvg(datos, formato, dibujarTextoConInter);
  const png = await rasterizarCartelPng(svg, formato);

  if (tipo === 'png') {
    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `attachment; filename="cartel-${formato}.png"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  const pdf = await generarCartelPdf(png, formato);
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="cartel-${formato}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}

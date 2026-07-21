import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { generarLinkGuardar } from '@/lib/google/linkGuardar';

export const runtime = 'nodejs';

// Mismo patrón que pass.pkpass: un simple GET que el botón "Agregar a Google Wallet" enlaza
// directo (sin fetch de por medio). Redirige a la URL firmada de Google; 404 si el comercio
// todavía no tiene Google Wallet habilitado (sin logo, o sin sincronizar).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tarjetaId: string }> },
) {
  const { tarjetaId } = await params;
  const supabase = createServiceClient();

  const url = await generarLinkGuardar(supabase, tarjetaId);
  if (!url) {
    return NextResponse.json({ error: 'Google Wallet no está disponible para esta tarjeta' }, { status: 404 });
  }

  return NextResponse.redirect(url, { headers: { 'Cache-Control': 'no-store' } });
}

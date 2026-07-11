import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { generarPassApple } from '@/lib/apple/generatePass';
import { datosPassDeTarjeta } from '@/lib/apple/datosPassDeTarjeta';
import { verificarApplePassToken } from '@/lib/apple/authToken';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ passTypeIdentifier: string; serialNumber: string }> },
) {
  const { serialNumber } = await params;
  const supabase = createServiceClient();

  const resultado = await datosPassDeTarjeta(supabase, serialNumber);
  if (!resultado) {
    return new NextResponse(null, { status: 401 });
  }

  if (!verificarApplePassToken(request.headers.get('authorization'), resultado.authTokenAlmacenado)) {
    return new NextResponse(null, { status: 401 });
  }

  const buffer = await generarPassApple(resultado.datos);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.apple.pkpass',
      'Cache-Control': 'no-store',
    },
  });
}

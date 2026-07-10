import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { generarPassApple } from '@/lib/apple/generatePass';
import { datosPassDeTarjeta } from '@/lib/apple/datosPassDeTarjeta';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tarjetaId: string }> },
) {
  const { tarjetaId } = await params;
  const supabase = createServiceClient();

  const { data: tarjeta } = await supabase
    .from('tarjetas')
    .select('apple_serial_number')
    .eq('id', tarjetaId)
    .maybeSingle();
  if (!tarjeta?.apple_serial_number) {
    return NextResponse.json({ error: 'Tarjeta no encontrada' }, { status: 404 });
  }

  const resultado = await datosPassDeTarjeta(supabase, tarjeta.apple_serial_number);
  if (!resultado) {
    return NextResponse.json({ error: 'Tarjeta no encontrada' }, { status: 404 });
  }

  const buffer = await generarPassApple(resultado.datos);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': 'attachment; filename="tarjeta.pkpass"',
      // El cuerpo incrusta qr_token y apple_auth_token — no debe quedar en cachés.
      'Cache-Control': 'no-store',
    },
  });
}

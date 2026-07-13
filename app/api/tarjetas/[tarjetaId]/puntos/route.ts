import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { notificarCambioTarjeta } from '@/lib/apple/notificarCambioTarjeta';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tarjetaId: string }> },
) {
  const { tarjetaId } = await params;

  let puntosDelta: unknown;
  try {
    ({ puntosDelta } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  if (typeof puntosDelta !== 'number' || !Number.isFinite(puntosDelta) || puntosDelta <= 0) {
    return NextResponse.json({ error: 'puntosDelta debe ser un número positivo' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: tarjeta, error: tarjetaError } = await supabase
    .from('tarjetas')
    .select('puntos_actuales')
    .eq('id', tarjetaId)
    .maybeSingle();
  if (tarjetaError || !tarjeta) {
    return NextResponse.json({ error: 'Tarjeta no encontrada' }, { status: 404 });
  }

  const nuevoSaldo = tarjeta.puntos_actuales + puntosDelta;

  const { error: txError } = await supabase
    .from('transacciones_puntos')
    .insert({ tarjeta_id: tarjetaId, puntos_delta: puntosDelta });
  if (txError) {
    return NextResponse.json({ error: 'No se pudo registrar la transacción' }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from('tarjetas')
    .update({ puntos_actuales: nuevoSaldo })
    .eq('id', tarjetaId);
  if (updateError) {
    return NextResponse.json({ error: 'No se pudo actualizar el saldo' }, { status: 500 });
  }

  await notificarCambioTarjeta(supabase, tarjetaId);

  return NextResponse.json({ puntosActuales: nuevoSaldo });
}

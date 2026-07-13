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

  if (
    typeof puntosDelta !== 'number' ||
    !Number.isInteger(puntosDelta) ||
    puntosDelta <= 0 ||
    puntosDelta > 1_000_000
  ) {
    return NextResponse.json({ error: 'puntosDelta debe ser un entero positivo razonable' }, { status: 400 });
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

  // NOTA (diferido a Fase 3/4): este read-modify-write NO es atómico y la inserción del ledger
  // + el update del saldo no comparten transacción. Con un solo cajero en el piloto el riesgo
  // es nulo (concurrencia ~0) y la divergencia es recuperable (el ledger es la fuente de
  // verdad). En Fase 3/4 se reemplaza por un RPC de Postgres `sumar_puntos` que hace insert +
  // `update ... set puntos_actuales = puntos_actuales + delta returning` en un solo statement
  // atómico. Ver review de calidad de la Tarea 11.
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

  // TODO(Fase 4): mover el push a segundo plano (p. ej. after() de next/server) para que la
  // confirmación del cajero no espere a APNs. Hoy se await-ea, aceptable para el curl de Tarea 12.
  await notificarCambioTarjeta(supabase, tarjetaId);

  return NextResponse.json({ puntosActuales: nuevoSaldo });
}

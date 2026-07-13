import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ deviceLibraryIdentifier: string; passTypeIdentifier: string }> },
) {
  const { deviceLibraryIdentifier } = await params;
  const supabase = createServiceClient();

  // Simplificación deliberada de MVP: NO filtramos por `passesUpdatedSince`; devolvemos todos
  // los seriales registrados de este dispositivo. Apple pedirá cada pass y comparará — más
  // tráfico, pero nunca se pierde una actualización. Optimizar solo vale si el volumen crece.
  const { data: registros } = await supabase
    .from('apple_push_registrations')
    .select('tarjetas(apple_serial_number)')
    .eq('device_library_identifier', deviceLibraryIdentifier);

  const serialNumbers = (registros ?? [])
    .map((r) => r.tarjetas?.apple_serial_number)
    .filter((s): s is string => Boolean(s));

  if (serialNumbers.length === 0) {
    return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }

  // no-store: la lista de seriales es por-dispositivo y mutable; un intermediario que la
  // cachee podría ocultar brevemente una tarjeta recién registrada.
  return NextResponse.json(
    {
      serialNumbers,
      lastUpdated: String(Math.floor(Date.now() / 1000)),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

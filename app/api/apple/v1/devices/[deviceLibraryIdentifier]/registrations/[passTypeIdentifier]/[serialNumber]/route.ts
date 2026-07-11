import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

type Params = { deviceLibraryIdentifier: string; passTypeIdentifier: string; serialNumber: string };

function tokensCoinciden(recibido: string, almacenado: string): boolean {
  const a = Buffer.from(recibido);
  const b = Buffer.from(almacenado);
  // timingSafeEqual exige buffers de igual longitud, si no, lanza. La comparación de
  // longitud no filtra el contenido del token, solo su tamaño (constante en la práctica).
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function verificarAutenticacion(request: NextRequest, serialNumber: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { data: tarjeta } = await supabase
    .from('tarjetas')
    .select('apple_auth_token')
    .eq('apple_serial_number', serialNumber)
    .maybeSingle();

  if (!tarjeta?.apple_auth_token) return false;

  const authHeader = request.headers.get('authorization') ?? '';
  const tokenRecibido = authHeader.replace(/^ApplePass\s+/i, '');

  return tokensCoinciden(tokenRecibido, tarjeta.apple_auth_token);
}

export async function POST(request: NextRequest, { params }: { params: Promise<Params> }) {
  const { deviceLibraryIdentifier, serialNumber } = await params;

  if (!(await verificarAutenticacion(request, serialNumber))) {
    return new NextResponse(null, { status: 401 });
  }

  let pushToken: unknown;
  try {
    ({ pushToken } = await request.json());
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (typeof pushToken !== 'string' || pushToken.length === 0) {
    return new NextResponse(null, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: tarjeta } = await supabase
    .from('tarjetas').select('id').eq('apple_serial_number', serialNumber).single();

  const { data: existente } = await supabase
    .from('apple_push_registrations')
    .select('id')
    .eq('tarjeta_id', tarjeta!.id)
    .eq('device_library_identifier', deviceLibraryIdentifier)
    .maybeSingle();

  if (existente) {
    return new NextResponse(null, { status: 200 });
  }

  const { error } = await supabase.from('apple_push_registrations').insert({
    tarjeta_id: tarjeta!.id,
    device_library_identifier: deviceLibraryIdentifier,
    push_token: pushToken,
  });
  if (error) {
    return new NextResponse(null, { status: 500 });
  }

  return new NextResponse(null, { status: 201 });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<Params> }) {
  const { deviceLibraryIdentifier, serialNumber } = await params;

  if (!(await verificarAutenticacion(request, serialNumber))) {
    return new NextResponse(null, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data: tarjeta } = await supabase
    .from('tarjetas').select('id').eq('apple_serial_number', serialNumber).single();

  await supabase
    .from('apple_push_registrations')
    .delete()
    .eq('tarjeta_id', tarjeta!.id)
    .eq('device_library_identifier', deviceLibraryIdentifier);

  return new NextResponse(null, { status: 200 });
}

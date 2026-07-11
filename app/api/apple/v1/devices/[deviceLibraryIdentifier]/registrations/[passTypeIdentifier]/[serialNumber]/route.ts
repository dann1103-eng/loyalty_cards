import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { verificarApplePassToken } from '@/lib/apple/authToken';

export const runtime = 'nodejs';

type Params = { deviceLibraryIdentifier: string; passTypeIdentifier: string; serialNumber: string };

// Autentica el header `Authorization: ApplePass <token>` contra el apple_auth_token de la
// tarjeta. Si coincide, devuelve el id de la tarjeta (una sola consulta, sin segundo lookup);
// devuelve null si la tarjeta no existe o el token no coincide.
async function autenticarTarjeta(request: NextRequest, serialNumber: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data: tarjeta } = await supabase
    .from('tarjetas')
    .select('id, apple_auth_token')
    .eq('apple_serial_number', serialNumber)
    .maybeSingle();

  if (!tarjeta?.apple_auth_token) return null;

  return verificarApplePassToken(request.headers.get('authorization'), tarjeta.apple_auth_token)
    ? tarjeta.id
    : null;
}

export async function POST(request: NextRequest, { params }: { params: Promise<Params> }) {
  const { deviceLibraryIdentifier, serialNumber } = await params;

  const tarjetaId = await autenticarTarjeta(request, serialNumber);
  if (!tarjetaId) {
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

  const { data: existente } = await supabase
    .from('apple_push_registrations')
    .select('id')
    .eq('tarjeta_id', tarjetaId)
    .eq('device_library_identifier', deviceLibraryIdentifier)
    .maybeSingle();

  if (existente) {
    // Ya registrado: refrescamos el push_token por si APNs lo rotó (mismo dispositivo, token
    // nuevo). Sin esto, un token viejo haría que los push se pierdan en silencio. Apple espera
    // 200 cuando ya estaba registrado.
    const { error } = await supabase
      .from('apple_push_registrations')
      .update({ push_token: pushToken })
      .eq('id', existente.id);
    if (error) {
      return new NextResponse(null, { status: 500 });
    }
    return new NextResponse(null, { status: 200 });
  }

  const { error } = await supabase.from('apple_push_registrations').insert({
    tarjeta_id: tarjetaId,
    device_library_identifier: deviceLibraryIdentifier,
    push_token: pushToken,
  });
  if (error) {
    if (error.code === '23505') {
      // Carrera: otro registro concurrente del mismo dispositivo ganó el insert. La fila ya
      // existe; convergemos refrescando el token y devolvemos 200 (no 500).
      const { error: updateError } = await supabase
        .from('apple_push_registrations')
        .update({ push_token: pushToken })
        .eq('tarjeta_id', tarjetaId)
        .eq('device_library_identifier', deviceLibraryIdentifier);
      if (updateError) {
        return new NextResponse(null, { status: 500 });
      }
      return new NextResponse(null, { status: 200 });
    }
    return new NextResponse(null, { status: 500 });
  }

  return new NextResponse(null, { status: 201 });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<Params> }) {
  const { deviceLibraryIdentifier, serialNumber } = await params;

  const tarjetaId = await autenticarTarjeta(request, serialNumber);
  if (!tarjetaId) {
    return new NextResponse(null, { status: 401 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('apple_push_registrations')
    .delete()
    .eq('tarjeta_id', tarjetaId)
    .eq('device_library_identifier', deviceLibraryIdentifier);
  if (error) {
    return new NextResponse(null, { status: 500 });
  }

  // 0 filas borradas (dispositivo no registrado) NO es error — desregistro idempotente → 200.
  return new NextResponse(null, { status: 200 });
}

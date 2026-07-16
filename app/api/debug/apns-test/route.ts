// DIAGNÓSTICO TEMPORAL — borrar después de usar. Envía un push real (sin tocar puntos_actuales
// ni transacciones_puntos) y devuelve la respuesta cruda de APNs para ver el motivo exacto de
// cualquier rechazo, ya que notificarCambioTarjeta() solo registra errores que lanzan excepción,
// no fallos "silenciosos" de APNs con reason distinto a BadDeviceToken/Unregistered/ExpiredToken.
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { enviarPushActualizacion } from '@/lib/apple/enviarPush';
import { requireEnv } from '@/lib/env';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const tarjetaId = request.nextUrl.searchParams.get('tarjetaId');
  if (!tarjetaId) {
    return NextResponse.json({ error: 'falta ?tarjetaId=' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: registros } = await supabase
    .from('apple_push_registrations')
    .select('push_token, device_library_identifier')
    .eq('tarjeta_id', tarjetaId);

  if (!registros || registros.length === 0) {
    return NextResponse.json({ error: 'sin dispositivos registrados para esta tarjeta' }, { status: 404 });
  }

  const passTypeIdentifier = requireEnv('APPLE_PASS_TYPE_IDENTIFIER');
  const resultados = [];

  for (const r of registros) {
    try {
      const resultado = await enviarPushActualizacion(r.push_token, passTypeIdentifier);
      resultados.push({
        device: r.device_library_identifier,
        sent: resultado.sent,
        failed: resultado.failed,
      });
    } catch (err) {
      resultados.push({
        device: r.device_library_identifier,
        excepcion: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ passTypeIdentifier, resultados });
}

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { registrarCliente } from '@/lib/clientes/registrarCliente';
import { normalizarTelefono } from '@/lib/clientes/normalizarTelefono';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  const { comercioSlug, nombre, telefono } = (body ?? {}) as Record<string, unknown>;

  if (
    typeof comercioSlug !== 'string' ||
    typeof nombre !== 'string' ||
    typeof telefono !== 'string' ||
    !comercioSlug ||
    !nombre ||
    !telefono
  ) {
    return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });
  }

  const nombreLimpio = nombre.trim();
  if (nombreLimpio.length === 0 || nombreLimpio.length > 120) {
    return NextResponse.json({ error: 'Nombre inválido' }, { status: 400 });
  }

  let telefonoCanonico: string;
  try {
    telefonoCanonico = normalizarTelefono(telefono);
  } catch {
    return NextResponse.json({ error: 'Teléfono inválido' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: comercio, error: comercioError } = await supabase
    .from('comercios')
    .select('id')
    .eq('slug', comercioSlug)
    .single();
  if (comercioError || !comercio) {
    return NextResponse.json({ error: 'Comercio no encontrado' }, { status: 404 });
  }

  const resultado = await registrarCliente(supabase, comercio.id, nombreLimpio, telefonoCanonico);

  // Init de Apple SIEMPRE (no solo cuando la tarjeta es nueva) y con chequeo de error.
  // El guard .is('apple_serial_number', null) hace que una tarjeta ya inicializada
  // matchee 0 filas (no-op: nunca pisa un token ya emitido — seguro ante concurrencia,
  // el WHERE se re-evalúa tras el commit de un escritor concurrente), y una tarjeta que
  // quedó a medias por un fallo anterior se auto-repara en el siguiente registro.
  const authToken = crypto.randomBytes(16).toString('hex');
  const { error: initError } = await supabase
    .from('tarjetas')
    .update({ apple_auth_token: authToken, apple_serial_number: resultado.tarjetaId })
    .eq('id', resultado.tarjetaId)
    .is('apple_serial_number', null);
  if (initError) {
    return NextResponse.json({ error: 'Error al preparar la tarjeta' }, { status: 500 });
  }

  return NextResponse.json({ tarjetaId: resultado.tarjetaId });
}

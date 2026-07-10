import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { registrarCliente } from '@/lib/clientes/registrarCliente';
import { normalizarTelefono } from '@/lib/clientes/normalizarTelefono';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const { comercioSlug, nombre, telefono } = await request.json();

  if (!comercioSlug || !nombre || !telefono) {
    return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });
  }

  let telefonoCanonico: string;
  try {
    telefonoCanonico = normalizarTelefono(String(telefono));
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

  const resultado = await registrarCliente(supabase, comercio.id, String(nombre).trim(), telefonoCanonico);

  if (resultado.esNuevaTarjeta) {
    const authToken = crypto.randomBytes(16).toString('hex');
    await supabase
      .from('tarjetas')
      .update({ apple_auth_token: authToken, apple_serial_number: resultado.tarjetaId })
      .eq('id', resultado.tarjetaId);
  }

  return NextResponse.json({ tarjetaId: resultado.tarjetaId });
}

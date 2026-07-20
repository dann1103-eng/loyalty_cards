import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { obtenerIp } from '@/lib/portal/obtenerIp';
import { verificarYRegistrarIntento } from '@/lib/portal/limiteIntentos';
import { buscarTarjetasPorTelefono } from '@/lib/portal/buscarTarjetas';

// Route Handler (no Server Action) por consistencia con el endpoint hermano
// /api/tarjetas/[id]/puntos, no por una limitación técnica. Público con límite de intentos.
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const supabase = createServiceClient();

  // Límite de intentos ANTES de tocar clientes (spec §3): registra el intento (exitoso o no) y
  // decide si se permite. Un exceso responde 429 sin llegar nunca a la búsqueda por teléfono.
  const ip = obtenerIp(request);
  const permitido = await verificarYRegistrarIntento(supabase, ip);
  if (!permitido) {
    return NextResponse.json(
      { error: 'Demasiados intentos, intenta de nuevo más tarde.' },
      { status: 429 },
    );
  }

  let telefono: unknown;
  try {
    ({ telefono } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }
  if (typeof telefono !== 'string' || !telefono.trim()) {
    return NextResponse.json({ error: 'El teléfono es obligatorio' }, { status: 400 });
  }

  const resultado = await buscarTarjetasPorTelefono(supabase, telefono);
  return NextResponse.json(resultado);
}

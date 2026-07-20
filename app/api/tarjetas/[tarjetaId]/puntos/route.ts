import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { notificarCambioTarjeta } from '@/lib/apple/notificarCambioTarjeta';
import { ownerDeSesion } from '@/lib/comercio/ownerDeSesion';
import { acreditarPuntos } from '@/lib/comercio/acreditar';

export const runtime = 'nodejs';

// Fase 4: el endpoint del walking skeleton quedó PROTEGIDO. Antes era público (cualquiera con un
// tarjetaId podía inflar puntos); ahora exige sesión de dueño y solo opera sobre tarjetas de SU
// comercio. La lógica (ledger + saldo) vive en lib/comercio/acreditar.ts, compartida con el
// escáner del panel. El curl manual del piloto ya no aplica: el flujo es /comercio/escanear.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tarjetaId: string }> },
) {
  const { tarjetaId } = await params;

  // Validación ANTES del auth: las reglas de formato son públicas (no filtran nada) y así los
  // errores de cliente responden 400 sin costear consultas de sesión.
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

  const sesion = await ownerDeSesion();
  if (!sesion) {
    return NextResponse.json({ error: 'Requiere sesión de comercio' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const res = await acreditarPuntos(supabase, sesion.comercioId, tarjetaId, puntosDelta);
  if (!res.ok) {
    const status = /no existe/i.test(res.error) ? 404 : 500;
    return NextResponse.json({ error: res.error }, { status });
  }

  // TODO(Fase 4+): mover el push a segundo plano (after() de next/server) para que la
  // confirmación del cajero no espere a APNs.
  await notificarCambioTarjeta(supabase, tarjetaId);

  return NextResponse.json({ puntosActuales: res.puntosActuales });
}

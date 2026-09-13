import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { procesarAvisosVencimiento } from '@/lib/comercio/avisoVencimiento';
import { procesarAvisosInactividad } from '@/lib/comercio/avisoInactividad';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Trabajo diario que manda los avisos automáticos a UNA tarjeta puntual: el de antes del vencimiento
// y el de inactividad. Se llamaba /api/cron/inactividad; pasó a llamarse por lo que hace el día que
// empezó a mandar también el de vencimiento (decisión 6 del spec 2026-09-09).
//
// Mismos dos candados que /api/cron/campanas (CRON_SECRET + no-op si no hay nada que avisar) — ver
// ese archivo para el razonamiento completo. El no-op vive en cada recorrido: los dos salen sin tocar
// nada si no hay programas/comercios con el aviso encendido.
export async function GET(request: NextRequest) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    console.error('[cron] CRON_SECRET no está configurado');
    return NextResponse.json({ error: 'No configurado' }, { status: 500 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const supabase = createServiceClient();
  // El ORDEN importa (decisión 7). procesarAvisosInactividad saltea la tarjeta que ya tiene un aviso
  // vigente en el reverso, así que tiene que correr DESPUÉS de que el de vencimiento haya escrito el
  // del día. Al revés, una membresía inactiva y por vencer recibiría los dos push hoy, y el de
  // inactividad le pisaría la fecha del reverso.
  const vencimiento = await procesarAvisosVencimiento(supabase);
  const inactividad = await procesarAvisosInactividad(supabase);

  const resumen = { vencimiento, inactividad };
  console.log('[cron] avisos:', resumen);
  return NextResponse.json(resumen);
}

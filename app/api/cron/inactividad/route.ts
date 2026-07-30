import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { procesarAvisosInactividad } from '@/lib/comercio/avisoInactividad';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Trabajo diario que manda el aviso de inactividad. Mismos dos candados que /api/cron/campanas
// (CRON_SECRET + no-op si no hay nada que avisar) — ver ese archivo para el razonamiento completo.
export async function GET(request: NextRequest) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    console.error('[cron] CRON_SECRET no está configurado');
    return NextResponse.json({ error: 'No configurado' }, { status: 500 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const resumen = await procesarAvisosInactividad(createServiceClient());
  console.log('[cron] avisos de inactividad:', resumen);
  return NextResponse.json(resumen);
}

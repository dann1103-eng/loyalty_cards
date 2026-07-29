import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { apagarCampanasVencidas } from '@/lib/comercio/campanasVencidas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Trabajo diario que apaga las campañas de cercanía vencidas. Es lo PRIMERO del proyecto que corre
// solo, sin que ninguna persona lo dispare, así que va con dos candados.
//
// CANDADO 1 — el secreto. La ruta es pública (Vercel la invoca por HTTP), así que sin esto
// cualquiera podría dispararla y provocar un push a todos los clientes de todos los comercios.
// Vercel manda `Authorization: Bearer <CRON_SECRET>` en sus invocaciones programadas.
//
// CANDADO 2 — no hacer nada si no hay nada que hacer. Vive en apagarCampanasVencidas: si ninguna
// campaña venció, sale sin tocar un solo pase. Un push innecesario a todos los clientes de un
// comercio es tráfico y batería de gente real.
export async function GET(request: NextRequest) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    // Falla CERRADO: sin secreto configurado la ruta no corre, en vez de quedar abierta al mundo.
    console.error('[cron] CRON_SECRET no está configurado');
    return NextResponse.json({ error: 'No configurado' }, { status: 500 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const resumen = await apagarCampanasVencidas(createServiceClient());
  console.log('[cron] campañas revisadas:', resumen);
  return NextResponse.json(resumen);
}

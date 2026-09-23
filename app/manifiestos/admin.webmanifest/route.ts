import { NextResponse } from 'next/server';
import { manifiestoAdmin } from '@/lib/manifiestos';

// Vive en /manifiestos/*, FUERA de /admin/*, a propósito: el navegador pide el manifest SIN
// cookies, y el proxy (lib/supabase/proxy.ts, matcher '/admin/:path*') redirige al login toda ruta
// sin sesión de esa rama — servido desde /admin/manifest.webmanifest, el navegador habría recibido
// el HTML del login en vez del JSON. Así no hace falta tocar el proxy.
//
// Mismo patrón de carpeta con punto que app/api/tarjetas/[tarjetaId]/pass.pkpass/route.ts: el
// nombre de la carpeta ES la URL.
//
// Los Route Handlers NO se cachean por default (node_modules/next/dist/docs/01-app/01-getting-
// started/15-route-handlers.md, sección "Caching"): sin `dynamic = 'force-static'` cada visita
// recalcularía este objeto fijo. Con él, Next lo genera una vez en build y lo sirve cacheado.
export const dynamic = 'force-static';

export function GET() {
  return NextResponse.json(manifiestoAdmin(), {
    headers: { 'Content-Type': 'application/manifest+json' },
  });
}

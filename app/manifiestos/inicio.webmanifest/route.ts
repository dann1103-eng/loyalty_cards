import { NextResponse } from 'next/server';
import { manifiestoInicio } from '@/lib/manifiestos';

// El manifest de la página de inicio (`/`): instala el panel del comercio. Mismo patrón y mismos
// motivos que app/manifiestos/comercio.webmanifest/route.ts (carpeta con punto = la URL; fuera de
// /comercio/* para que el proxy no lo redirija al login; force-static porque el objeto es fijo).
export const dynamic = 'force-static';

export function GET() {
  return NextResponse.json(manifiestoInicio(), {
    headers: { 'Content-Type': 'application/manifest+json' },
  });
}

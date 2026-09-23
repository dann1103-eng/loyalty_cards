import { NextResponse } from 'next/server';
import { manifiestoComercio } from '@/lib/manifiestos';

// Vive en /manifiestos/*, FUERA de /comercio/*, a propósito: el navegador pide el manifest SIN
// cookies, y el proxy (lib/supabase/proxy.ts, matcher '/comercio/:path*') redirige al login toda
// ruta sin sesión de esa rama — servido desde /comercio/manifest.webmanifest, el navegador habría
// recibido el HTML del login en vez del JSON. Así no hace falta tocar el proxy.
//
// Mismo patrón de carpeta con punto que app/api/tarjetas/[tarjetaId]/pass.pkpass/route.ts: el
// nombre de la carpeta ES la URL.
//
// Sin datos de request => Next lo optimiza estáticamente (se genera en build y se cachea), igual
// que app/mi-tarjeta/icono-192/route.tsx.
export function GET() {
  return NextResponse.json(manifiestoComercio(), {
    headers: { 'Content-Type': 'application/manifest+json' },
  });
}

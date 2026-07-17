import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

// Next.js 16 renombró Middleware a Proxy. Corre en runtime Node (Edge no es soportado aquí).
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Los paneles de FM y del dueño necesitan sesión. El resto del sitio (registro público,
  // endpoints de Apple Wallet) es público y no debe pagar este costo.
  matcher: ['/admin/:path*', '/comercio/:path*'],
};

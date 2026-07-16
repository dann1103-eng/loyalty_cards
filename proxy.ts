import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

// Next.js 16 renombró Middleware a Proxy. Corre en runtime Node (Edge no es soportado aquí).
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Solo el panel de FM necesita sesión. El resto del sitio (registro público, endpoints de
  // Apple Wallet) es público y no debe pagar este costo.
  matcher: '/admin/:path*',
};

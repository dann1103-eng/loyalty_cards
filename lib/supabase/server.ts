import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from './types';
import { requireEnv } from '@/lib/env';

// Cliente con SERVICE ROLE: ignora RLS por completo y no tiene sesión de usuario. Solo para
// código de servidor que legítimamente necesita saltarse RLS. Para operar como el usuario
// autenticado, usa createClienteServidor().
export function createServiceClient() {
  return createClient<Database>(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
  );
}

// Cliente de servidor ATADO A LA SESIÓN del usuario (lee cookies). Distinto del service
// client de arriba, que ignora RLS y no tiene sesión.
export async function createClienteServidor() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch (error) {
            // Escribir cookies lanza durante el render de un Server Component (limitación de
            // Next): ahí se ignora a propósito porque proxy.ts refresca la sesión en cada
            // request a /admin/*. OJO: en Server Actions y Route Handlers (login/logout) el
            // write SÍ es legal — proxy.ts NO es respaldo ahí: no puede crear una sesión que
            // nunca se escribió ni cerrar una que nunca se borró. Por eso se registra en vez
            // de tragarse en silencio.
            console.warn('[supabase] no se pudieron escribir las cookies de sesión:', error);
          }
        },
      },
    },
  );
}

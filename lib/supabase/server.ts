import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from './types';
import { requireEnv } from '@/lib/env';

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
          } catch {
            // Escribir cookies lanza durante el render de un Server Component (limitación de
            // Next). Se ignora a propósito: el proxy.ts es quien persiste el refresco.
          }
        },
      },
    },
  );
}

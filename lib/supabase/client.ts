import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './types';

// Cliente de Supabase para el NAVEGADOR (usa la anon key, respeta RLS).
// OJO: debe ser createBrowserClient de @supabase/ssr, NO el createClient plano de
// @supabase/supabase-js — el cliente equivocado guarda la sesión en localStorage en vez de
// cookies, y entonces el servidor nunca la ve (los chequeos de auth fallarían en silencio).
export function createClienteNavegador() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

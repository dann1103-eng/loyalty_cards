import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from './types';
import { requireEnv } from '@/lib/env';

// Refresca la cookie de sesión de Supabase en cada request a /admin/*. Esto NO puede vivir
// solo en las páginas: los Server Components no pueden escribir cookies (limitación de Next),
// así que sin este paso la sesión expira y el usuario es expulsado al azar.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
          // 2º argumento: cache-headers. Sin esto, un CDN podría cachear una respuesta con
          // tokens refrescados y filtrar la sesión a otro usuario.
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value),
          );
        },
      },
    },
  );

  // No metas código entre createServerClient y getClaims(): un error aquí es dificilísimo de
  // depurar (usuarios deslogueados al azar). getClaims() — NO getSession(), que no garantiza
  // revalidar el token en servidor.
  const { data } = await supabase.auth.getClaims();
  const usuario = data?.claims;

  // Primera barrera (rápida). El gate real es verifyFmAdmin() en layout/página/acción.
  // /admin/login se excluye o se cicla infinitamente contra sí mismo.
  if (!usuario && !request.nextUrl.pathname.startsWith('/admin/login')) {
    const url = request.nextUrl.clone();
    url.pathname = '/admin/login';
    return NextResponse.redirect(url);
  }

  // Devolver supabaseResponse tal cual: si lo reemplazas por otro NextResponse sin copiar las
  // cookies, navegador y servidor se desincronizan y la sesión muere antes de tiempo.
  return supabaseResponse;
}

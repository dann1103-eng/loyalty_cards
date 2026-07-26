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

  // Rutas EXENTAS de la barrera de sesión (ya no son solo las de login — ver /comercio/activar).
  //
  // Anclado a propósito: un startsWith suelto también eximiría a /admin/login-sso o
  // /admin/loginXYZ, heredando una exención que nadie pidió. Así solo se eximen /admin/login
  // y sus sub-rutas legítimas (p. ej. un futuro /admin/login/reset).
  //
  // /comercio/activar se exime —con el MISMO anclado, nada de startsWith('/comercio/activar') a
  // secas, que también eximiría /comercio/activarXYZ— porque el dueño invitado NO tiene sesión
  // cuando abre su link: entra ahí justamente para canjear el token por una. Sin esta exención su
  // link cae en /comercio/login y el alta del dueño se rompe entera antes de empezar.
  //
  // /comercio/clave NO necesita exención y no debe tenerla: cuando el dueño llega a definir su
  // contraseña la activación ya le creó la sesión, así que pasa la barrera por su cuenta. Eximirla
  // abriría esa pantalla a cualquiera sin sesión.
  const ruta = request.nextUrl.pathname;
  const esRutaExenta =
    ruta === '/admin/login' || ruta.startsWith('/admin/login/') ||
    ruta === '/comercio/login' || ruta.startsWith('/comercio/login/') ||
    ruta === '/comercio/activar' || ruta.startsWith('/comercio/activar/');

  // Primera barrera (rápida). El gate real es verifyFmAdmin() en layout/página/acción.
  // /admin/login se excluye o se cicla infinitamente contra sí mismo.
  if (!usuario && !esRutaExenta) {
    // El destino del redirect se DERIVA del prefijo, no es fijo: una visita sin sesión a
    // /comercio/panel debe caer en /comercio/login (la pantalla del dueño), no en /admin/login
    // (la de FM). El matcher solo enruta /admin/* y /comercio/*, así que `ruta` siempre empieza
    // por uno de los dos; startsWith('/comercio') es seguro aquí.
    const prefijo = ruta.startsWith('/comercio') ? '/comercio' : '/admin';
    const url = request.nextUrl.clone();
    url.pathname = `${prefijo}/login`;
    // clone() conserva el query string y cambiar .pathname no lo limpia: sin esto,
    // /admin/comercios?error=sin-permiso mostraría "sin permiso" a alguien que solo no tiene
    // sesión. Nada necesita preservarlo: el login redirige a un destino fijo.
    url.search = '';
    const respuesta = NextResponse.redirect(url);
    // Si getClaims() detectó un token muerto, setAll ya escribió las cookies de borrado en
    // supabaseResponse; devolver un redirect nuevo sin copiarlas las tiraría — justo lo que
    // advierte el comentario del final de esta función.
    supabaseResponse.cookies.getAll().forEach((c) => respuesta.cookies.set(c));
    return respuesta;
  }

  // Devolver supabaseResponse tal cual: si lo reemplazas por otro NextResponse sin copiar las
  // cookies, navegador y servidor se desincronizan y la sesión muere antes de tiempo.
  return supabaseResponse;
}

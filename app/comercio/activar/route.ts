import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createClienteServidor } from '@/lib/supabase/server';
import { COOKIE_COMERCIO_ACTIVO, COOKIE_SUCURSAL_ACTIVA } from '@/lib/comercio/cookieComercio';

export const runtime = 'nodejs';

// Canje del link de invitación que FM le comparte al dueño por WhatsApp (Tarea 3 del plan
// 2026-07-26-acceso-dueno-invitacion). El invitado llega SIN sesión: por eso proxy.ts exime esta
// ruta — sin la exención el link caería en /comercio/login y el flujo se rompe entero.
// verifyOtp() canjea el token por una sesión y de ahí el cliente pasa a definir su contraseña.
//
// Escribir cookies acá SÍ es legal: es un Route Handler, no el render de un Server Component (lo
// explica el comentario de lib/supabase/server.ts). Next mergea al response las cookies que el
// handler haya escrito con cookies(), incluso cuando ese response es un redirect.
//
// SEGURIDAD: `token_hash` es una credencial temporal. NUNCA se loguea (de un error de Auth solo
// sale error.message) y el querystring se LIMPIA en cada redirect — ver redirigir().

// Los dos únicos tipos que emite generarAccesoDueno: 'invite' para un dueño nuevo en Auth,
// 'recovery' para uno que ya existía. Whitelist a propósito: sin ella esta ruta canjearía
// cualquier OTP que alguien le pegue en el querystring (un 'email_change', por ejemplo).
const TIPOS_ACEPTADOS = ['invite', 'recovery'] as const;
type TipoAceptado = (typeof TIPOS_ACEPTADOS)[number];

function esTipoAceptado(valor: string | null): valor is TipoAceptado {
  return valor !== null && (TIPOS_ACEPTADOS as readonly string[]).includes(valor);
}

// URL absoluta DERIVADA del request (nunca un dominio hardcodeado): el mismo link tiene que
// funcionar en producción y en local.
function redirigir(request: NextRequest, pathname: string, error?: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  // clone() CONSERVA el querystring —que acá trae el token_hash— y cambiar .pathname no lo
  // limpia. Vaciarlo no es cosmético: es lo que evita que la credencial viaje al destino y quede
  // en el historial del teléfono, en el header Referer y en los logs. Mismo criterio que proxy.ts.
  url.search = '';
  if (error) url.searchParams.set('error', error);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const tipo = request.nextUrl.searchParams.get('tipo');

  if (!tokenHash || !esTipoAceptado(tipo)) {
    return redirigir(request, '/comercio/login', 'link-vencido');
  }

  const supabase = await createClienteServidor();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: tipo });

  if (error) {
    // Solo error.message: el objeto completo del error puede arrastrar lo que se envió.
    console.warn('[comercio] no se pudo canjear el link de acceso:', error.message);

    // El token es de UN SOLO USO y vence a las 24 h, así que "falló" incluye el caso más común de
    // todos: el cliente volvió a tocar el link de WhatsApp después de canjearlo. Si ya tiene
    // sesión (la creó el primer toque) mandarlo al login sería absurdo — sigue a definir su clave,
    // que es donde estaba. verifyOtp NO borra la sesión existente cuando falla (solo guarda sesión
    // en el camino de éxito), así que este getClaims es confiable.
    const { data } = await supabase.auth.getClaims();
    if (data?.claims?.sub) {
      return redirigir(request, '/comercio/clave');
    }
    return redirigir(request, '/comercio/login', 'link-vencido');
  }

  // Sesión nueva = contexto de comercio/sucursal en blanco. En un teléfono compartido estas
  // cookies pueden ser del dueño ANTERIOR; los gates igual las revalidan contra las membresías
  // reales, pero se limpian acá por la misma razón que en iniciarSesionComercio.
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_COMERCIO_ACTIVO);
  cookieStore.delete(COOKIE_SUCURSAL_ACTIVA);

  return redirigir(request, '/comercio/clave');
}

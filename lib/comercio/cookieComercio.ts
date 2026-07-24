// Nombre de la cookie del "comercio activo", en UN solo lugar. La leen los gates de Fase 3
// (verifyComercioAcceso, ownerDeSesion) y la escriben los setters de Fase 4 (elegir, cambiar y el
// login). Un literal repetido en 4+ sitios se desincroniza con un typo silencioso; la constante lo
// vuelve un error de compilación.
export const COOKIE_COMERCIO_ACTIVO = 'fm_comercio_activo';

// Opciones de la cookie, también en UN solo lugar (todos los setters deben coincidir). `secure` solo
// en producción: en prod el sitio es HTTPS (Vercel), pero en dev local es HTTP y una cookie `secure`
// no se enviaría. httpOnly: no la lee JS del cliente. sameSite lax: no viaja en requests cross-site.
// (No es un secreto: siempre se revalida contra las membresías reales, pero se endurece igual.)
export function opcionesCookieComercio() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  };
}

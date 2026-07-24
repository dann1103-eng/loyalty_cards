// Nombre de la cookie del "comercio activo", en UN solo lugar. La leen los gates de Fase 3
// (verifyComercioAcceso, ownerDeSesion) y la escriben los setters de Fase 4 (elegir, cambiar y el
// login). Un literal repetido en 4+ sitios se desincroniza con un typo silencioso; la constante lo
// vuelve un error de compilación.
export const COOKIE_COMERCIO_ACTIVO = 'fm_comercio_activo';

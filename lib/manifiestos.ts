import type { MetadataRoute } from 'next';

// Manifests PWA del panel del comercio y del admin. Existen porque app/manifest.ts (el único
// manifest.ts que Next 16.2.10 admite: el archivo especial solo se reconoce en la raíz de app/, no
// anidado por carpeta) es el del portal del CLIENTE — y como Next lo inyecta en TODAS las páginas
// del sitio, un dueño que en Android tocaba "Agregar a pantalla de inicio" desde su propio login
// instalaba el portal del cliente en vez de su panel (onboarding real, 2026-09-22).
//
// Estos objetos los sirven los Route Handlers en app/manifiestos/*.webmanifest/route.ts, y cada
// pantalla del dueño o de FM pide el suyo con `metadata.manifest` (el campo SÍ es por segmento: el
// más profundo gana sobre el de la raíz). Ver docs/superpowers/specs/2026-09-23-onboarding-manifest-monto-resena-design.md, sección 1.

// Rutas donde responden los Route Handlers — una constante y no un literal repetido en cada
// `metadata.manifest`, para que cambiar la ruta sea una sola edición y el guardarraíl de archivos
// (manifiestos.test.ts) pueda matchear contra el nombre exacto en vez de un string suelto.
export const URL_MANIFIESTO_COMERCIO = '/manifiestos/comercio.webmanifest';
export const URL_MANIFIESTO_ADMIN = '/manifiestos/admin.webmanifest';

// Mismos íconos que app/manifest.ts: /mi-tarjeta/icono-192 y -512 dibujan el ícono genérico de la
// marca Cardly (renderIconoCardly, lib/portal/iconoCardly.tsx), son públicos y no hay todavía nada
// propio del comercio o del admin que dibujar ahí. Duplicados a propósito y NO importados de
// app/manifest.ts —los tres manifests quedan independientes entre sí—; lib/manifiestos.test.ts
// compara estos valores contra el default de app/manifest.ts para que la duplicación no se
// desincronice en silencio.
const ICONOS: NonNullable<MetadataRoute.Manifest['icons']> = [
  { src: '/mi-tarjeta/icono-192', sizes: '192x192', type: 'image/png' },
  { src: '/mi-tarjeta/icono-512', sizes: '512x512', type: 'image/png' },
];

// Mismo fondo/tema que app/manifest.ts (#e7e6f0, el claro por defecto). Duplicado por el mismo
// motivo que ICONOS, y sincronizado por la misma prueba.
const FONDO = '#e7e6f0';

export function manifiestoComercio(): MetadataRoute.Manifest {
  return {
    name: 'Cardly SV — Panel del comercio',
    short_name: 'Cardly',
    // /comercio/panel es la página que comparten el dueño y el cajero (gate
    // verifyComercioAcceso); sin sesión, el proxy la manda a /comercio/login. No existe página en
    // /comercio a secas, así que no hay otro candidato para el atajo instalado.
    start_url: '/comercio/panel',
    id: '/comercio/panel',
    // CON barra final: todo lo que cuelga de /comercio/ es del panel, incluidas las pantallas que
    // no cuelgan del layout de (protegido) —login, activar, clave, elegir, suspendida— y por eso
    // declaran su propio manifest en vez de heredarlo. Ver la invariante
    // start_url.startsWith(scope) en manifiestos.test.ts.
    scope: '/comercio/',
    display: 'standalone',
    background_color: FONDO,
    theme_color: FONDO,
    icons: ICONOS,
  };
}

export function manifiestoAdmin(): MetadataRoute.Manifest {
  return {
    name: 'Cardly SV — Admin',
    short_name: 'Cardly Admin',
    // app/admin/(protegido)/page.tsx sirve /admin (el paréntesis de un route group no cuenta para
    // la URL): el start_url tiene un destino real, la home del panel de FM.
    start_url: '/admin',
    id: '/admin',
    // SIN barra final, a diferencia del de comercio: '/admin' no empieza con '/admin/', y un
    // start_url fuera del scope hace que el navegador descarte el scope entero.
    scope: '/admin',
    display: 'standalone',
    background_color: FONDO,
    theme_color: FONDO,
    icons: ICONOS,
  };
}

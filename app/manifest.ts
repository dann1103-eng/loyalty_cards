import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Mi Tarjeta — FM Lealtad',
    short_name: 'Mi Tarjeta',
    description: 'Consulta el saldo de tus tarjetas de lealtad y las recompensas que puedes canjear.',
    start_url: '/mi-tarjeta',
    display: 'standalone',
    background_color: '#131313',
    theme_color: '#131313',
    icons: [
      // Rutas estables servidas por los Route Handlers (PNG real cada una). El campo
      // `type` le dice al navegador el MIME aunque la URL no termine en .png.
      { src: '/mi-tarjeta/icono-192', sizes: '192x192', type: 'image/png' },
      { src: '/mi-tarjeta/icono-512', sizes: '512x512', type: 'image/png' },
    ],
  };
}

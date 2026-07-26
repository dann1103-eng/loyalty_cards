// Enlaces de la nav inferior del panel comercio y qué ve cada rol. Módulo puro (sin JSX ni
// 'use client') para poder testear la política sin montar el componente.
export interface EnlaceNav {
  href: string;
  icono: string;
  etiqueta: string;
}

export const ENLACES_NAV: readonly EnlaceNav[] = [
  { href: '/comercio/panel', icono: 'dashboard', etiqueta: 'Resumen' },
  { href: '/comercio/escanear', icono: 'qr_code_scanner', etiqueta: 'Escanear' },
  { href: '/comercio/branding', icono: 'palette', etiqueta: 'Marca' },
  { href: '/comercio/recompensas', icono: 'redeem', etiqueta: 'Premios' },
  { href: '/comercio/reglas', icono: 'rule', etiqueta: 'Reglas' },
  { href: '/comercio/sucursales', icono: 'store', etiqueta: 'Sucursales' },
  { href: '/comercio/cajeros', icono: 'badge', etiqueta: 'Cajeros' },
  { href: '/comercio/clientes', icono: 'group', etiqueta: 'Clientes' },
  { href: '/comercio/reportes', icono: 'insights', etiqueta: 'Reportes' },
];

// Qué secciones ve el CAJERO en su nav (plan 2026-07-25 §4.8): Resumen, Escanear y Clientes. Las
// demás lo rebotarían en su gate igual — esto evita mostrarle puertas cerradas.
const RUTAS_CAJERO = ['/comercio/panel', '/comercio/escanear', '/comercio/clientes'];

export function enlacesPorRol(rol: string): EnlaceNav[] {
  if (rol === 'owner') return [...ENLACES_NAV];
  if (rol === 'cajero') return ENLACES_NAV.filter((e) => RUTAS_CAJERO.includes(e.href));
  // Rol desconocido: degrada al comportamiento previo (solo el escáner).
  return ENLACES_NAV.filter((e) => e.href === '/comercio/escanear');
}

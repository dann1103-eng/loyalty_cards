// Enlaces del panel comercio y qué ve cada rol. Módulo puro (sin JSX ni 'use client') para poder
// testear la política sin montar el componente.
//
// Reparto en DOS superficies (decisión del dueño, 2026-07-26): la barra inferior lleva EXACTAMENTE
// 5 destinos y el resto vive en el menú de "más opciones" del header. Antes eran 9 en un carrusel
// deslizable: no entraban en un teléfono y casi nadie descubría que se podía deslizar, así que las
// últimas cuatro secciones eran invisibles en la práctica.
export interface EnlaceNav {
  href: string;
  icono: string;
  etiqueta: string;
}

// Escanear es la acción que un cajero repite decenas de veces por día: va al CENTRO y destacada.
// El ORDEN de este arreglo es la posición en pantalla, y el centro sale de la posición 3 de 5 —
// reordenar aquí (o meter un sexto destino) descentra el botón sin que nada más se queje.
export const HREF_ESCANEAR = '/comercio/escanear';

export const ENLACES_BARRA: readonly EnlaceNav[] = [
  { href: '/comercio/panel', icono: 'dashboard', etiqueta: 'Resumen' },
  { href: '/comercio/branding', icono: 'palette', etiqueta: 'Marca' },
  { href: HREF_ESCANEAR, icono: 'qr_code_scanner', etiqueta: 'Escanear' },
  { href: '/comercio/recompensas', icono: 'redeem', etiqueta: 'Premios' },
  { href: '/comercio/clientes', icono: 'group', etiqueta: 'Clientes' },
];

// Menú de "más opciones". Reportes ENCABEZA la lista a propósito: de las secciones que no entran en
// la barra es la que más se consulta, y al final de una lista de cuatro se vuelve invisible — que es
// justo el problema que este rediseño vino a resolver. No la bajes por "orden alfabético" ni por
// "agrupar los ajustes juntos".
export const ENLACES_MENU: readonly EnlaceNav[] = [
  { href: '/comercio/reportes', icono: 'insights', etiqueta: 'Reportes' },
  { href: '/comercio/reglas', icono: 'rule', etiqueta: 'Reglas' },
  { href: '/comercio/sucursales', icono: 'store', etiqueta: 'Sucursales' },
  { href: '/comercio/cajeros', icono: 'badge', etiqueta: 'Cajeros' },
  // Mi plan va al MENÚ, no a la barra: la barra lleva exactamente 5 destinos y el centro sale de la
  // posición 3 de 5 (ver arriba). El menú no tiene esa restricción — es una lista vertical.
  { href: '/comercio/plan', icono: 'workspace_premium', etiqueta: 'Mi plan' },
];

// Qué secciones ve el CAJERO (plan 2026-07-25 §4.8): Resumen, Escanear y Clientes. Las demás lo
// rebotarían en su gate igual — esto evita mostrarle puertas cerradas. Consecuencia buscada del
// reparto en dos superficies: NINGUNA de las cuatro del menú está acá, así que al cajero el menú le
// queda sin enlaces (solo el selector de tema). Eso es correcto, no un bug a "rellenar".
const RUTAS_CAJERO = ['/comercio/panel', HREF_ESCANEAR, '/comercio/clientes'];

function filtrarPorRol(enlaces: readonly EnlaceNav[], rol: string): EnlaceNav[] {
  if (rol === 'owner') return [...enlaces];
  if (rol === 'cajero') return enlaces.filter((e) => RUTAS_CAJERO.includes(e.href));
  // Rol desconocido: degrada al comportamiento previo (solo el escáner).
  return enlaces.filter((e) => e.href === HREF_ESCANEAR);
}

export function enlacesBarraPorRol(rol: string): EnlaceNav[] {
  return filtrarPorRol(ENLACES_BARRA, rol);
}

export function enlacesMenuPorRol(rol: string): EnlaceNav[] {
  return filtrarPorRol(ENLACES_MENU, rol);
}

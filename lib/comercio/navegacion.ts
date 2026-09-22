import { puedeCanjearRecompensas } from '../tarjetas/tipos';

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
  grupo?: 'programa' | 'equipo' | 'cuenta';
}

// Escanear es la acción que un cajero repite decenas de veces por día: va al CENTRO y destacada.
// El ORDEN de este arreglo es la posición en pantalla, y el centro sale de la posición 3 de 5 —
// reordenar aquí (o meter un sexto destino) descentra el botón sin que nada más se queje.
export const HREF_ESCANEAR = '/comercio/escanear';

// Los dos destinos que INTERCAMBIAN superficie según el tipo (ver `intercambiarSiNoHayCanje`).
// Están fuera de los arreglos porque cada uno tiene que poder aparecer en el otro con SU ícono y SU
// etiqueta, no con los del que reemplaza.
// `grupo: 'programa'` en ENLACE_PREMIOS es a propósito aunque hoy solo viva en la barra (que no se
// agrupa): cuando `intercambiarSiNoHayCanje` lo sube al MENÚ en lugar de Programas, necesita traer
// su propio `grupo` para agruparse bajo "Tu programa" junto a Reglas y Notificaciones — si no lo
// trajera, quedaría huérfano, sin sección, en vez de agrupado (ver navegacion.test.ts).
const ENLACE_PREMIOS: EnlaceNav = {
  href: '/comercio/recompensas',
  icono: 'redeem',
  etiqueta: 'Premios',
  grupo: 'programa',
};
const ENLACE_PROGRAMAS: EnlaceNav = {
  href: '/comercio/programas',
  icono: 'style',
  etiqueta: 'Programas',
  grupo: 'programa',
};

export const ENLACES_BARRA: readonly EnlaceNav[] = [
  { href: '/comercio/panel', icono: 'dashboard', etiqueta: 'Resumen' },
  { href: '/comercio/branding', icono: 'palette', etiqueta: 'Marca' },
  { href: HREF_ESCANEAR, icono: 'qr_code_scanner', etiqueta: 'Escanear' },
  ENLACE_PREMIOS,
  { href: '/comercio/clientes', icono: 'group', etiqueta: 'Clientes' },
];

// Menú de "más opciones". Reportes ENCABEZA la lista a propósito: de las secciones que no entran en
// la barra es la que más se consulta, y al final de una lista de cuatro se vuelve invisible — que es
// justo el problema que este rediseño vino a resolver. No la bajes por "orden alfabético" ni por
// "agrupar los ajustes juntos".
export const ENLACES_MENU: readonly EnlaceNav[] = [
  // Reportes se queda SIN `grupo` a propósito: es el "destacado" aparte, arriba de las secciones
  // agrupadas (ver MenuOpciones.tsx). No entra en ninguna de las tres secciones de abajo.
  { href: '/comercio/reportes', icono: 'insights', etiqueta: 'Reportes' },
  { href: '/comercio/reglas', icono: 'rule', etiqueta: 'Reglas', grupo: 'programa' },
  // Justo después de Reglas (migración 0024): absorbió la configuración por tipo que antes vivía
  // ahí (cashback%, visitas del paquete, …), así que es la sección hermana más cercana.
  ENLACE_PROGRAMAS,
  // Notificaciones (migración 0026): la perilla del aviso AUTOMÁTICO de inactividad vive en
  // Reglas, así que esta pantalla —la campaña MANUAL y su historial— es la sección hermana más
  // cercana de ese bloque Reglas/Programas.
  { href: '/comercio/notificaciones', icono: 'campaign', etiqueta: 'Notificaciones', grupo: 'programa' },
  { href: '/comercio/sucursales', icono: 'store', etiqueta: 'Sucursales', grupo: 'equipo' },
  { href: '/comercio/cajeros', icono: 'badge', etiqueta: 'Cajeros', grupo: 'equipo' },
  // Mi plan va al MENÚ, no a la barra: la barra lleva exactamente 5 destinos y el centro sale de la
  // posición 3 de 5 (ver arriba). El menú no tiene esa restricción — es una lista vertical.
  { href: '/comercio/plan', icono: 'workspace_premium', etiqueta: 'Mi plan', grupo: 'cuenta' },
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

// Premios y Programas CAMBIAN de superficie —en la misma posición— cuando el tipo del programa
// principal no puede canjear recompensas (spec 2026-09-08, decisión 5). En cupón, membresía y
// descuento (contador 'ninguno') un canje descuenta de `puntos_actuales`, que en esos tipos nunca
// se mueve: ninguna recompensa se puede canjear jamás, y esa sección muerta ocupaba uno de los cinco
// lugares de la barra. Programas, en cambio, es donde ese dueño configura lo que sí usa.
//
// POR QUÉ ES UN INTERCAMBIO Y NO UN OCULTAMIENTO: la barra lleva exactamente 5 destinos y Escanear
// se centra por estar en la posición 3 de 5 (ver arriba). Sacar Premios y dejar cuatro lo descentra
// sin que nada se queje.
//
// POR QUÉ UNA SOLA FUNCIÓN PARA LAS DOS SUPERFICIES: hoy Premios vive SOLO en la barra y Programas
// SOLO en el menú, así que el intercambio tiene que ser simultáneo — subir uno sin bajar el otro
// duplica el destino. Con este `map` simétrico aplicado a los dos arreglos, media mudanza no se
// puede escribir por descuido: el que sale de una superficie es siempre el que entra en la otra.
function intercambiarSiNoHayCanje(enlaces: readonly EnlaceNav[], tipoTarjeta: string): EnlaceNav[] {
  // La regla se pregunta, no se reescribe: puedeCanjearRecompensas ya es la única definición de
  // "este tipo puede canjear" y degrada un tipo desconocido a 'puntos', o sea que ante un dato raro
  // se conserva el reparto de hoy y nunca queda una barra descentrada.
  if (puedeCanjearRecompensas(tipoTarjeta)) return [...enlaces];
  return enlaces.map((e) => {
    if (e.href === ENLACE_PREMIOS.href) return ENLACE_PROGRAMAS;
    if (e.href === ENLACE_PROGRAMAS.href) return ENLACE_PREMIOS;
    return e;
  });
}

export function enlacesBarraPorRol(rol: string, tipoTarjeta: string): EnlaceNav[] {
  return filtrarPorRol(intercambiarSiNoHayCanje(ENLACES_BARRA, tipoTarjeta), rol);
}

export function enlacesMenuPorRol(rol: string, tipoTarjeta: string): EnlaceNav[] {
  return filtrarPorRol(intercambiarSiNoHayCanje(ENLACES_MENU, tipoTarjeta), rol);
}

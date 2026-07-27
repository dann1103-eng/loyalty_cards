// Tema visual del panel (oscuro / claro / alto contraste). Es PREFERENCIA DE INTERFAZ, no dato de
// negocio: vive en localStorage del dispositivo, no en la BD — el mismo dueño puede querer alto
// contraste en la tablet del mostrador (bajo el sol) y oscuro en su teléfono.
//
// El módulo se importa TAMBIÉN desde el layout raíz (Server Component) para armar el script
// anti-destello, así que nada de tocar `document`/`localStorage` en el nivel superior: solo dentro
// de funciones que el navegador llama.

export const TEMAS = ['oscuro', 'claro', 'alto-contraste'] as const;
export type Tema = (typeof TEMAS)[number];

export const TEMA_POR_DEFECTO: Tema = 'oscuro';
export const CLAVE_TEMA = 'cardly-tema';

export const ETIQUETAS_TEMA: Record<Tema, { nombre: string; ayuda: string; icono: string }> = {
  oscuro: { nombre: 'Oscuro', ayuda: 'El de siempre', icono: 'dark_mode' },
  claro: { nombre: 'Claro', ayuda: 'Fondo blanco', icono: 'light_mode' },
  'alto-contraste': { nombre: 'Alto contraste', ayuda: 'Para usar bajo el sol', icono: 'contrast' },
};

export function esTema(valor: unknown): valor is Tema {
  return typeof valor === 'string' && (TEMAS as readonly string[]).includes(valor);
}

// Normaliza CUALQUIER cosa que salga de localStorage (o del atributo del DOM, que un usuario puede
// editar a mano en el inspector) al tema por defecto. Puro a propósito: es lo que se puede probar
// sin navegador.
export function normalizarTema(valor: unknown): Tema {
  return esTema(valor) ? valor : TEMA_POR_DEFECTO;
}

// ---------- store mínimo para useSyncExternalStore ----------
// No hay Context ni provider: el estado REAL es el atributo data-tema del <html> (lo que se está
// pintando), y este set de oyentes solo existe para que el selector se repinte cuando cambia. Un
// provider obligaría a envolver el layout y no resolvería el destello — ese lo resuelve el script
// en línea del <head>, no React.
const oyentes = new Set<() => void>();

export function suscribirTema(alCambiar: () => void): () => void {
  oyentes.add(alCambiar);
  return () => {
    oyentes.delete(alCambiar);
  };
}

// getSnapshot: lee del DOM, NO de localStorage. El DOM es lo que el usuario está VIENDO (el script
// del <head> ya lo fijó antes del primer pintado); localStorage es solo de dónde salió. Si algún día
// se desincronizan, el selector debe marcar lo que se ve.
export function leerTema(): Tema {
  if (typeof document === 'undefined') return TEMA_POR_DEFECTO;
  return normalizarTema(document.documentElement.dataset.tema);
}

export function leerTemaServidor(): Tema {
  return TEMA_POR_DEFECTO;
}

export function aplicarTema(tema: Tema): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.tema = tema;
  try {
    localStorage.setItem(CLAVE_TEMA, tema);
  } catch {
    // Safari en navegación privada tira al escribir. El tema igual queda aplicado en esta sesión:
    // perder la persistencia es mucho menos grave que tumbar el panel con una excepción.
  }
  oyentes.forEach((avisar) => avisar());
}

// Script que corre SÍNCRONO en el <head>, antes del primer pintado, para evitar el destello del
// tema por defecto (con SSR el HTML llega mucho antes de que hidrate el JS que sabe leer
// localStorage). No usa este módulo en tiempo de ejecución — se serializa a texto — pero sí sus
// constantes, para que la clave de almacenamiento no se escriba dos veces y se desincronice.
export const SCRIPT_TEMA =
  `(function(){try{var t=localStorage.getItem(${JSON.stringify(CLAVE_TEMA)});` +
  `if(${JSON.stringify(TEMAS)}.indexOf(t)>-1)document.documentElement.dataset.tema=t}catch(e){}})()`;

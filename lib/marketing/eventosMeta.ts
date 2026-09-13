// Pegamento del píxel de Meta con el navegador. Solo se importa desde componentes de cliente: toca
// `window` y `document`. Las reglas (rutas, ID, una sola vez) viven puras en ./pixelMeta.ts.

import { reclamarEvento, rutaAdmitePixel } from './pixelMeta';

// Los eventos estándar que usa Cardly, y ninguno más: un nombre mal escrito en Meta no da error,
// crea un evento personalizado que nadie mira. Con el tipo cerrado, no compila.
export type EventoMeta = 'PageView' | 'ViewContent' | 'Lead' | 'CompleteRegistration' | 'Contact' | 'Subscribe';

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  push: Fbq;
  loaded: boolean;
  version: string;
  disablePushState?: boolean;
  allowDuplicatePageViews?: boolean;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

// Instala el código base del píxel: transcripción del fragmento oficial de Meta (cola en `fbq`
// hasta que llega fbevents.js, script async en el <head>), más dos ajustes que el fragmento no trae
// y que son la razón de escribirlo acá en vez de pegarlo tal cual:
//
// 1. `disablePushState`: sin esto el píxel manda un PageView SOLO cada vez que cambia el historial.
//    En una app de Next la navegación es del lado del cliente, así que al pasar de la portada al
//    panel del dueño (con <Link>, sin recargar) el script seguiría vivo y reportaría las URLs del
//    panel. El PageView lo manda PixelMeta a mano, y solo en rutas que lo admiten.
// 2. `autoConfig` apagado: la configuración automática escucha los clics de TODOS los botones y lee
//    los metadatos de la página. Por la misma navegación del lado del cliente, eso incluiría los
//    botones del panel. Los eventos que medimos son los que disparamos nosotros.
// 3. `allowDuplicatePageViews`: por defecto el píxel ignora un PageView con la misma URL que el
//    anterior. Visto en el navegador: portada → "Buscá tu tarjeta" (sin píxel) → atrás, y la vuelta
//    a la portada no se contaba. La guarda contra duplicados es la de PixelMeta (una vez por ruta).
//
// Idempotente: si ya está instalado, no hace nada.
export function instalarPixel(idPixel: string): void {
  if (window.fbq) return;

  const fbq = function (...args: unknown[]) {
    // Con `fbq` como `this`, igual que el `apply` del fragmento oficial: fbevents.js lo necesita.
    if (fbq.callMethod) fbq.callMethod.call(fbq, ...args);
    else fbq.queue.push(args);
  } as Fbq;
  if (!window._fbq) window._fbq = fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = '2.0';
  fbq.queue = [];
  fbq.disablePushState = true;
  fbq.allowDuplicatePageViews = true;
  window.fbq = fbq;

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://connect.facebook.net/en_US/fbevents.js';
  document.head.appendChild(script);

  fbq('set', 'autoConfig', false, idPixel);
  fbq('init', idPixel);
}

// Dispara un evento estándar si el píxel está instalado y la página actual lo admite. Sin píxel
// (falta la variable de entorno, o es una ruta excluida) no hace nada: medir nunca rompe la página.
//
// El chequeo de ruta se repite acá a propósito, además del que hace PixelMeta al instalar: el
// script sobrevive a la navegación del lado del cliente, y un evento disparado desde una página
// excluida viajaría con la URL de esa página.
export function dispararEvento(
  evento: EventoMeta,
  datos?: Record<string, string | number>,
  opciones?: { eventID: string },
): void {
  if (typeof window === 'undefined' || !window.fbq) return;
  if (!rutaAdmitePixel(window.location.pathname)) return;
  window.fbq('track', evento, datos ?? {}, opciones ?? {});
}

const reclamadosEnEstaPagina = new Set<string>();

function almacenLocal(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Para el `eventID`, que Meta usa para descartar duplicados. `crypto.randomUUID` solo existe en
// contextos seguros (https o localhost); fuera de eso, cualquier valor único alcanza.
export function idEventoAleatorio(evento: EventoMeta): string {
  const aleatorio =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${evento}-${aleatorio}`;
}

// Una sola vez por acción real, también si la página se recarga. `idAccion` identifica la acción
// (el comercio recién creado, por ejemplo) y SOLO se usa como clave de la guarda en este navegador:
// no viaja a Meta, porque es un identificador interno del sistema. El `eventID` es aleatorio.
export function dispararEventoUnico(
  evento: EventoMeta,
  idAccion: string,
  datos?: Record<string, string | number>,
): void {
  if (typeof window === 'undefined' || !window.fbq) return;
  if (!rutaAdmitePixel(window.location.pathname)) return;
  if (!reclamarEvento(almacenLocal(), reclamadosEnEstaPagina, evento, idAccion)) return;
  dispararEvento(evento, datos, { eventID: idEventoAleatorio(evento) });
}

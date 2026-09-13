// Reglas PURAS del píxel de Meta: dónde puede cargarse, qué ID es aceptable y la guarda de "una sola
// vez por acción". Sin DOM ni `window`, para poder probarlas con mutación (el repo no tiene pruebas
// de componentes). El pegamento con el navegador vive en lib/marketing/eventosMeta.ts.

// ══ DÓNDE NO VA EL PÍXEL ══ (2026-09-13)
//
// El pedido fue "en todas las páginas menos el registro del cliente final", con una condición más
// fuerte encima: a Meta no va NINGÚN dato del panel del negocio ni de los clientes de los comercios.
// Cargar el píxel en esas páginas ya es mandar datos: cada evento viaja con la URL completa, y hay
// URLs que llevan cosas que no son nuestras (el token de un solo uso de /comercio/activar, el
// comercio y el programa del cliente en /registro). Por eso la lista cubre las cuatro superficies:
//
// - /registro      el cliente final escanea el QR y deja nombre y teléfono.
// - /mi-tarjeta    el cliente final busca su tarjeta por teléfono.
// - /comercio      el panel del dueño, incluidas login, activar y clave (sin sesión, pero del panel).
// - /admin         el panel interno de FM.
//
// Es lista de EXCLUSIÓN por prefijo, así que una página nueva bajo esas rutas nace sin píxel.
// OJO: una superficie nueva para clientes finales FUERA de estos prefijos lo cargaría — hay que
// agregarla acá.
export const PREFIJOS_SIN_PIXEL = ['/registro', '/mi-tarjeta', '/comercio', '/admin'] as const;

export function rutaAdmitePixel(ruta: string): boolean {
  // Con la barra: "/registro-comercio" empieza con "/registro" y es justo la página del alta.
  return !PREFIJOS_SIN_PIXEL.some((prefijo) => ruta === prefijo || ruta.startsWith(`${prefijo}/`));
}

// Los IDs de conjunto de datos de Meta son solo dígitos (15 o 16 hoy). Se exige eso y nada más
// porque el valor viene de una variable de entorno y termina dentro de llamadas al píxel: un valor
// raro se trata como "sin píxel", no se intenta arreglar.
const FORMATO_ID_PIXEL = /^\d{10,20}$/;

export function idPixelValido(valor: string | undefined): string | null {
  const limpio = valor?.trim() ?? '';
  return FORMATO_ID_PIXEL.test(limpio) ? limpio : null;
}

// wa.me pide el número internacional sin "+", espacios ni guiones. Se aceptan esos adornos al
// escribir la variable, pero se exige el código de país (al menos 11 dígitos: 503 + 8 del número):
// un "7000-1234" suelto armaría un enlace que abre WhatsApp sobre un número que no existe.
const FORMATO_WHATSAPP = /^\+?[\d\s-]+$/;

export function numeroWhatsAppValido(valor: string | undefined): string | null {
  const texto = valor?.trim() ?? '';
  if (!FORMATO_WHATSAPP.test(texto)) return null;
  const digitos = texto.replace(/\D/g, '');
  return digitos.length >= 11 && digitos.length <= 15 ? digitos : null;
}

export interface AlmacenEventos {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
}

// "Una sola vez por acción real": devuelve true SOLO la primera vez que se reclama el par
// (evento, acción), y lo marca. El almacén (localStorage) es la guarda contra recargas; la memoria
// de la página cubre los navegadores que lanzan al tocar el almacén (Safari privado, datos del sitio
// bloqueados), donde lo mejor posible es una vez mientras la página no se recargue.
export function reclamarEvento(
  almacen: AlmacenEventos | null,
  memoria: Set<string>,
  evento: string,
  idAccion: string,
): boolean {
  const clave = `cardly:meta:${evento}:${idAccion}`;
  if (memoria.has(clave)) return false;
  memoria.add(clave);

  try {
    if (almacen?.getItem(clave)) return false;
    almacen?.setItem(clave, '1');
  } catch {
    // Sin almacén usable: vale la memoria, que ya quedó marcada arriba.
  }
  return true;
}

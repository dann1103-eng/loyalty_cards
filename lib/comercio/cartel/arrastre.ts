// La aritmética de arrastrar un elemento sobre la vista previa del cartel. Puro — sin DOM, sin
// React: recibe números y devuelve números. El componente pone el `getBoundingClientRect` y los
// eventos de puntero; acá vive lo que se puede probar.
//
// Todo entra en PÍXELES de pantalla y sale en PORCENTAJES del lienzo, que es como se guardan los
// elementos (ver elementos.ts): la vista previa mide ~260 px de ancho y el cartel impreso 100 o
// 148 mm, así que un desplazamiento solo tiene sentido como fracción.

// La caja de la vista previa en coordenadas de pantalla — exactamente lo que devuelve
// getBoundingClientRect() sobre el contenedor del SVG.
export interface CajaVista {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Punto {
  x: number;
  y: number;
}

function porcentaje(punteroPx: number, origenPx: number, ladoPx: number): number {
  return ((punteroPx - origenPx) / ladoPx) * 100;
}

function acotar(valor: number): number {
  return Math.min(100, Math.max(0, valor));
}

// Una caja sin área es un contenedor que todavía no se midió (el primer render, o el panel oculto).
// Dividir por cero daría NaN, y un NaN en las coordenadas rompe el SVG de la vista previa entero:
// mejor que el arrastre no haga nada a que el cartel desaparezca.
function sinArea(caja: CajaVista): boolean {
  return !(caja.width > 0) || !(caja.height > 0);
}

// Cuánto hay entre el ancla del elemento y el punto exacto donde el dueño lo agarró. Se calcula UNA
// vez, al apoyar el dedo, y se conserva durante todo el arrastre.
//
// Sin esto el elemento SALTA en el primer movimiento para meter su ancla debajo del dedo: agarrás
// una franja por el borde derecho y se te va media pantalla a la izquierda. Es la diferencia entre
// "arrastrar" y "teletransportar".
export function desfaseDeAgarre(puntero: Punto, caja: CajaVista, ancla: Punto): Punto {
  if (sinArea(caja)) return { x: 0, y: 0 };
  return {
    x: ancla.x - porcentaje(puntero.x, caja.left, caja.width),
    y: ancla.y - porcentaje(puntero.y, caja.top, caja.height),
  };
}

// Dónde queda el elemento con el puntero acá. `actual` es su posición de ahora: es lo que se
// devuelve cuando la caja todavía no tiene medidas, para que el elemento se quede quieto en vez de
// irse al origen.
//
// El recorte a 0–100 es el mismo rango que aceptan los deslizadores y `sanearElementos`: arrastrar
// fuera de la vista previa deja el elemento pegado al borde, no lo manda fuera del papel.
export function posicionArrastrada(
  puntero: Punto,
  caja: CajaVista,
  desfase: Punto,
  actual: Punto,
): Punto {
  if (sinArea(caja)) return actual;
  return {
    x: acotar(porcentaje(puntero.x, caja.left, caja.width) + desfase.x),
    y: acotar(porcentaje(puntero.y, caja.top, caja.height) + desfase.y),
  };
}

// Cuánto se mueve un elemento por cada flecha del teclado. La manija es enfocable a propósito: el
// arrastre con el dedo es el camino rápido, pero no puede ser el ÚNICO — los deslizadores de cada
// tarjeta y estas flechas son lo que hace que la pantalla se pueda usar sin apuntar con precisión.
export const PASO_TECLADO = 1;
export const PASO_TECLADO_GRANDE = 5;

export function moverConTeclado(
  actual: Punto,
  tecla: string,
  conMayuscula: boolean,
): Punto | null {
  const paso = conMayuscula ? PASO_TECLADO_GRANDE : PASO_TECLADO;
  if (tecla === 'ArrowLeft') return { x: acotar(actual.x - paso), y: actual.y };
  if (tecla === 'ArrowRight') return { x: acotar(actual.x + paso), y: actual.y };
  if (tecla === 'ArrowUp') return { x: actual.x, y: acotar(actual.y - paso) };
  if (tecla === 'ArrowDown') return { x: actual.x, y: acotar(actual.y + paso) };
  // null = esta tecla no es mía. Quien llama NO debe cancelar el evento: si se tragara todo,
  // Tab dejaría de mover el foco y la manija sería una trampa para quien navega con teclado.
  return null;
}

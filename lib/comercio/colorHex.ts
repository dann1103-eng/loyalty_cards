// Traductor entre el formato de color que guarda la BD y el que habla el selector nativo del
// navegador. La BD guarda SIEMPRE "rgb(r, g, b)" (es lo único que aprueban validarColorRgb en
// lib/comercios/guardarComercio.ts y guardarBranding), y un `<input type="color">` SOLO acepta
// "#rrggbb": darle un rgb() es un valor inválido que el DOM normaliza a #000000 en silencio, y ese
// negro es lo que termina en el formulario si el dueño guarda sin tocar el selector.
//
// Vivía duplicado dentro de FormularioBranding.tsx. Se movió acá cuando el editor de cartel pasó a
// necesitar la misma traducción: dos copias de esto divergen (una recorta a 255 y la otra no, y el
// selector de una pantalla muestra otro color que el de la otra) sin que nada avise.

// Lo que ve el dueño de un comercio que jamás configuró su marca — mismo literal que
// COLOR_FONDO_DEFECTO en lib/comercio/cartel/combinarDatos.ts.
const GRIS_DEL_SISTEMA = '#131315';

export function hexDesdeRgb(rgb: string): string {
  const m = rgb.match(/rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/i);
  if (!m) return /^#[0-9a-f]{6}$/i.test(rgb.trim()) ? rgb.trim() : GRIS_DEL_SISTEMA;
  // El recorte a 255 no es defensivo de más: un "300" guardado a mano daría '12c', y el hex
  // resultante tendría 7 dígitos — inválido para el selector, que volvería a #000000.
  const [r, g, b] = [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)));
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

// null significa "esto todavía no es un color" (el dueño está a medio escribir en el campo de
// texto), no "negro": quien llama se queda con el valor anterior.
export function rgbDesdeTexto(valor: string): string | null {
  const v = valor.trim();
  if (/^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i.test(v)) return v;
  const hex = v.match(/^#?([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
  }
  return null;
}

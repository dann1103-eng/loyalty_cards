// Contraste WCAG 2.x entre los colores de los tokens de tema. Puro a propósito (sin DOM, sin I/O):
// así la prueba de app/globals.css corre en Node y mide lo mismo que va a ver el usuario.
//
// Solo entiende los formatos que usan los tokens de tema: hex y rgb()/rgba() con comas. Cualquier
// otra cosa LANZA en vez de devolver un valor aproximado — una prueba de contraste que se saltea en
// silencio el color que no sabe leer certifica justo lo que no midió.

export type Rgba = { r: number; g: number; b: number; a: number };

const HEX_CORTO = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/;
const HEX_LARGO = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/;
const FUNCION_RGB = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/;

export function parsearColor(valor: string): Rgba {
  const texto = valor.trim();
  const v = texto.toLowerCase();
  if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  const corto = HEX_CORTO.exec(v);
  if (corto) {
    return {
      r: parseInt(corto[1] + corto[1], 16),
      g: parseInt(corto[2] + corto[2], 16),
      b: parseInt(corto[3] + corto[3], 16),
      a: 1,
    };
  }
  const largo = HEX_LARGO.exec(v);
  if (largo) {
    return { r: parseInt(largo[1], 16), g: parseInt(largo[2], 16), b: parseInt(largo[3], 16), a: 1 };
  }
  const rgb = FUNCION_RGB.exec(v);
  if (rgb) {
    const color = {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
      a: rgb[4] === undefined ? 1 : Number(rgb[4]),
    };
    if ([color.r, color.g, color.b, color.a].some(Number.isNaN)) {
      throw new Error(`formato de color no soportado: ${texto}`);
    }
    if ([color.r, color.g, color.b].some((c) => c > 255) || color.a > 1) {
      throw new Error(`color fuera de rango: ${texto}`);
    }
    return color;
  }
  throw new Error(`formato de color no soportado: ${texto}`);
}

// Capas de ARRIBA hacia ABAJO: la primera es la que se pinta encima. Se compone de abajo hacia
// arriba en sRGB 0-255, SIN redondear a 8 bits en el medio — es la convención de la spec, y las
// predicciones de su tabla de mutaciones se calcularon así.
export function componer(capas: Rgba[]): Rgba {
  const base = capas[capas.length - 1];
  if (!base || base.a !== 1) throw new Error('la pila de fondo no termina en un color opaco');
  let { r, g, b } = base;
  for (let i = capas.length - 2; i >= 0; i--) {
    const capa = capas[i];
    r = capa.r * capa.a + r * (1 - capa.a);
    g = capa.g * capa.a + g * (1 - capa.a);
    b = capa.b * capa.a + b * (1 - capa.a);
  }
  return { r, g, b, a: 1 };
}

function lineal(canal: number): number {
  const s = canal / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminancia(color: Rgba): number {
  if (color.a !== 1) throw new Error('la luminancia solo existe para un color opaco: componelo primero');
  return 0.2126 * lineal(color.r) + 0.7152 * lineal(color.g) + 0.0722 * lineal(color.b);
}

export function razon(a: Rgba, b: Rgba): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

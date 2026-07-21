// La BD guarda colores como 'rgb(r, g, b)' (mismo formato que exige el PKPass de Apple).
// Google Wallet exige '#rrggbb'. undefined (no null) a propósito: se usa con el spread
// `...(rgbAHex(x) ? { hexBackgroundColor: rgbAHex(x) } : {})`, que omite la clave si no hay color.
const PATRON_RGB = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i;

function componenteAHex(n: number): string {
  return Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
}

export function rgbAHex(rgb: string | null | undefined): string | undefined {
  if (!rgb) return undefined;
  const m = rgb.trim().match(PATRON_RGB);
  if (!m) return undefined;
  const [, r, g, b] = m;
  return `#${componenteAHex(Number(r))}${componenteAHex(Number(g))}${componenteAHex(Number(b))}`;
}

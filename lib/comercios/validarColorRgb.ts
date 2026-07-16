/**
 * ¿Es un color en el formato canónico `rgb(r, g, b)` con r/g/b entre 0 y 255?
 *
 * Es el ÚNICO formato que el spec de Apple garantiza para un pass. Un valor inválido no falla
 * aquí: falla al firmar el pass, en producción, cuando un cliente intenta agregar su tarjeta.
 * Por eso se valida antes de guardar.
 */
export function validarColorRgb(valor: string): boolean {
  const match = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(valor.trim());
  if (!match) return false;

  // El límite inferior lo impone la regex: \d no matchea el signo, así que "rgb(-1, 0, 0)" ni
  // llega hasta aquí. El superior no se expresa limpio en regex, así que va numérico.
  return match.slice(1).every((n) => Number(n) <= 255);
}

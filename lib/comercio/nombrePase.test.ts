import { describe, it, expect } from 'vitest';
import { validarNombrePase, LARGO_MAXIMO_NOMBRE_PASE } from './nombrePase';

describe('validarNombrePase', () => {
  it('null es válido: es como nace todo programa (sin nombre, el pase sale como hasta ahora)', () => {
    expect(validarNombrePase(null)).toBeNull();
  });

  it('acepta un nombre normal', () => {
    expect(validarNombrePase('Socio Oro')).toBeNull();
  });

  it('rechaza el blanco, que es lo que también rechaza el CHECK de la base', () => {
    // MUTACIÓN: sacar esta guarda deja que un '   ' llegue a Postgres y vuelva como un 23514 mudo,
    // que la pantalla traduce a "No se pudo guardar el branding" — sin decir qué campo.
    expect(validarNombrePase('   ')).toBe('El nombre del pase no puede quedar en blanco.');
  });

  it(`rechaza más de ${LARGO_MAXIMO_NOMBRE_PASE} caracteres, y mide DESPUÉS de recortar`, () => {
    // MUTACIÓN: medir `nombrePase.length` en vez del recortado rechaza un nombre de 40 caracteres
    // con un espacio al final, que es válido y que el guardado va a escribir recortado.
    const justo = 'a'.repeat(LARGO_MAXIMO_NOMBRE_PASE);
    expect(validarNombrePase(`  ${justo}  `)).toBeNull();
    expect(validarNombrePase(`${justo}b`)).toBe(
      'El nombre del pase no puede pasar de 40 caracteres.',
    );
  });
});

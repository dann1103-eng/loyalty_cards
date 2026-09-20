import { describe, it, expect } from 'vitest';
import { componer, luminancia, parsearColor, razon } from './contraste';

// MUTATION-TESTING: lo que protege este archivo es la MATEMÁTICA de la prueba de contraste de
// app/globals.css — si la fórmula está mal, esa prueba certifica contrastes que la pantalla no
// muestra. Mutaciones que deben fallar:
// (1) permutar los coeficientes .2126/.7152/.0722 → un gris no lo nota (r = g = b), por eso están
//     el azul, el rojo y el verde puros;
// (2) cambiar el exponente 2.4 → cambian #777 y #767676;
// (3) sacar el +0.05 → negro contra blanco deja de dar 21;
// (4) componer de arriba hacia abajo en vez de abajo hacia arriba → la pila de tres capas;
// (5) redondear a 8 bits dentro de componer → 127.5 pasa a 128 y el gris da 3.95, no 3.98;
// (6) que parsearColor devuelva algo para un formato que no conoce → oklch, hsl, nombres.
// Mutante equivalente, no vale la pena: 0.04045 → 0.03928 no altera ningún valor de 8 bits.

describe('parsearColor', () => {
  it('lee hex corto, hex largo, rgb, rgba y transparent', () => {
    expect(parsearColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parsearColor('#181849')).toEqual({ r: 24, g: 24, b: 73, a: 1 });
    expect(parsearColor('  #E7E6F0 ')).toEqual({ r: 231, g: 230, b: 240, a: 1 });
    expect(parsearColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parsearColor('rgba(24, 24, 73, 0.2)')).toEqual({ r: 24, g: 24, b: 73, a: 0.2 });
    expect(parsearColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('lanza ante un formato que no sabe leer, en vez de aproximarlo', () => {
    const noSoportados = [
      'oklch(45% 0.13 280)',
      'hsl(0 0% 50%)',
      'currentColor',
      'red',
      'var(--fondo)',
      'rgb(1 2 3)',
      'rgba(1.2.3, 0, 0)',
    ];
    for (const valor of noSoportados) {
      expect(() => parsearColor(valor)).toThrow(`formato de color no soportado: ${valor}`);
    }
    expect(() => parsearColor('rgba(300, 0, 0, 1)')).toThrow('color fuera de rango: rgba(300, 0, 0, 1)');
  });
});

describe('componer', () => {
  it('mezcla el alpha sobre el fondo, sin redondear a 8 bits', () => {
    expect(componer([parsearColor('rgba(0, 0, 0, 0.5)'), parsearColor('#ffffff')])).toEqual({
      r: 127.5,
      g: 127.5,
      b: 127.5,
      a: 1,
    });
  });

  it('apila de abajo hacia arriba: la primera capa es la de encima', () => {
    // Negro al 50% sobre rojo = (127.5, 0, 0); blanco al 50% encima de eso = (191.25, 127.5, 127.5).
    // Al revés (de arriba hacia abajo) daría (127.5, 63.75, 63.75).
    const capas = [
      parsearColor('rgba(255, 255, 255, 0.5)'),
      parsearColor('rgba(0, 0, 0, 0.5)'),
      parsearColor('#ff0000'),
    ];
    expect(componer(capas)).toEqual({ r: 191.25, g: 127.5, b: 127.5, a: 1 });
  });

  it('lanza si la pila no termina en un color opaco', () => {
    expect(() => componer([parsearColor('rgba(0, 0, 0, 0.5)')])).toThrow(
      'la pila de fondo no termina en un color opaco',
    );
    expect(() => componer([])).toThrow('la pila de fondo no termina en un color opaco');
  });
});

describe('razon (WCAG 2.x)', () => {
  it('da los valores de referencia de los grises', () => {
    expect(razon(parsearColor('#000'), parsearColor('#fff'))).toBe(21);
    expect(razon(parsearColor('#777'), parsearColor('#fff'))).toBeCloseTo(4.48, 2);
    expect(razon(parsearColor('#767676'), parsearColor('#fff'))).toBeCloseTo(4.54, 2);
    const gris = componer([parsearColor('rgba(0, 0, 0, 0.5)'), parsearColor('#fff')]);
    expect(razon(gris, parsearColor('#fff'))).toBeCloseTo(3.98, 2);
  });

  it('pesa cada canal con su coeficiente (un gris no lo notaría)', () => {
    expect(razon(parsearColor('#0000ff'), parsearColor('#fff'))).toBeCloseTo(8.59, 2);
    expect(razon(parsearColor('#ff0000'), parsearColor('#fff'))).toBeCloseTo(4.0, 2);
    expect(razon(parsearColor('#00ff00'), parsearColor('#000'))).toBeCloseTo(15.3, 2);
  });

  it('es simétrica', () => {
    const a = parsearColor('#514ba8');
    const b = parsearColor('#e7e6f0');
    expect(razon(a, b)).toBe(razon(b, a));
  });

  it('la luminancia exige un color opaco', () => {
    expect(() => luminancia(parsearColor('rgba(0, 0, 0, 0.5)'))).toThrow(
      'la luminancia solo existe para un color opaco',
    );
  });
});

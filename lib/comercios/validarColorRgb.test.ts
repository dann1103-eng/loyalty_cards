import { describe, it, expect } from 'vitest';
import { validarColorRgb } from './validarColorRgb';

describe('validarColorRgb', () => {
  it('acepta el formato canónico rgb(r, g, b)', () => {
    expect(validarColorRgb('rgb(35, 24, 18)')).toBe(true);
    expect(validarColorRgb('rgb(255, 255, 255)')).toBe(true);
    expect(validarColorRgb('rgb(0,0,0)')).toBe(true);
  });

  it('rechaza valores fuera del rango 0-255', () => {
    expect(validarColorRgb('rgb(256, 0, 0)')).toBe(false);
    expect(validarColorRgb('rgb(-1, 0, 0)')).toBe(false);
  });

  it('rechaza otros formatos de color', () => {
    expect(validarColorRgb('#231812')).toBe(false);
    expect(validarColorRgb('rgba(35, 24, 18, 0.5)')).toBe(false);
    expect(validarColorRgb('red')).toBe(false);
  });

  it('rechaza basura y vacío', () => {
    expect(validarColorRgb('')).toBe(false);
    expect(validarColorRgb('rgb(35, 24)')).toBe(false);
    expect(validarColorRgb('rgb(a, b, c)')).toBe(false);
  });

  // Los tres tests de abajo fijan el EJE DE FORMA. Los de arriba cubren el de valor (rangos), y
  // ninguno usa una tripleta bien formada dentro de un envoltorio malo — por eso, sin estos, se
  // puede aflojar la regex y la suite sigue verde.

  it('rechaza un rgb() válido envuelto en basura', () => {
    // Fija los anclajes ^ y $. Importa más de lo que parece: la regex de passkit-generator NO
    // está anclada (es un test de subcadena), así que la librería aceptaría estos tres y el
    // string malformado llegaría a Wallet dentro de un pass firmado. Esta es la única defensa.
    //
    // Hacen falta las dos formas: los primeros dos NO terminan en una tripleta válida, así que
    // el $ los rechaza solo y el ^ nunca se ejercita. El tercero (basura ANTES, tripleta al
    // final) es el único que fija el ^.
    expect(validarColorRgb('garbage rgb(0,0,0) garbage')).toBe(false);
    expect(validarColorRgb('rgb(0,0,0); background: url(x)')).toBe(false);
    expect(validarColorRgb('javascript:alert(1) rgb(0,0,0)')).toBe(false);
  });

  it('rechaza canales con relleno de ceros', () => {
    // Fija el \d{1,3}. El chequeo numérico NO lo cubre: Number('0000000255') === 255, así que
    // pasaría el <= 255. passkit-generator lanza con esta entrada.
    expect(validarColorRgb('rgb(0000000255,0,0)')).toBe(false);
  });

  it('rechaza RGB en mayúsculas', () => {
    // Decisión deliberada, no estilo: passkit-generator lanza con RGB(...) — el .regex() de Joi
    // distingue mayúsculas y el literal es 'rgb\(' en minúscula.
    expect(validarColorRgb('RGB(0,0,0)')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { cajaLogo } from './cajaLogo';

describe('cajaLogo', () => {
  it('sin medidas, la caja es cuadrada (lado × lado)', () => {
    expect(cajaLogo(72, 240, null)).toEqual({ ancho: 72, alto: 72 });
  });

  it('logo cuadrado (1:1), la caja es cuadrada', () => {
    expect(cajaLogo(72, 240, { ancho: 300, alto: 300 })).toEqual({ ancho: 72, alto: 72 });
  });

  // Un logo circular se sube como un PNG cuadrado (el círculo va DIBUJADO adentro del cuadrado, no
  // es la forma del archivo): mide 1:1 igual que uno cuadrado, así que le toca la misma caja.
  it('logo circular (imagen cuadrada con el círculo dibujado adentro), la caja es cuadrada', () => {
    expect(cajaLogo(72, 240, { ancho: 512, alto: 512 })).toEqual({ ancho: 72, alto: 72 });
  });

  it('logo 3:1 (ancho), la caja crece en ancho sin tocar el alto', () => {
    // lado × proporción = 72 × 3 = 216, bien por debajo del máximo (240): no se acota.
    expect(cajaLogo(72, 240, { ancho: 300, alto: 100 })).toEqual({ ancho: 216, alto: 72 });
  });

  it('logo 3:1, el ancho se acota al máximo cuando lo excede', () => {
    // 72 × 3 = 216 > 128: se acota a 128, el máximo que le da split × mostrador.
    expect(cajaLogo(64, 128, { ancho: 300, alto: 100 })).toEqual({ ancho: 128, alto: 64 });
  });

  it('logo 1:3 (alto), la caja se angosta — NO queda cuadrada', () => {
    // 72 × (1/3) = 24: más angosta que el lado, y el máximo (240) no entra en juego porque el
    // resultado ya está por debajo de él.
    expect(cajaLogo(72, 240, { ancho: 100, alto: 300 })).toEqual({ ancho: 24, alto: 72 });
  });

  it('split × sticker (anchoMaximo = lado): un logo 3:1 se acota EXACTO al cuadrado', () => {
    expect(cajaLogo(60, 60, { ancho: 300, alto: 100 })).toEqual({ ancho: 60, alto: 60 });
  });

  it('split × sticker (anchoMaximo = lado): un logo 1:3 se angosta igual que en cualquier otra combinación', () => {
    // La regla de "nunca crecer" no fuerza lo angosto a volverse cuadrado: acá el máximo ni siquiera
    // se toca, porque 20 < 60.
    expect(cajaLogo(60, 60, { ancho: 100, alto: 300 })).toEqual({ ancho: 20, alto: 60 });
  });

  it('medidas degeneradas (alto en 0) se tratan como si no hubiera medidas', () => {
    expect(cajaLogo(72, 240, { ancho: 300, alto: 0 })).toEqual({ ancho: 72, alto: 72 });
  });
});

import { describe, it, expect } from 'vitest';
import {
  dimensionesDestino,
  necesitaRedimensionar,
  LADO_MAXIMO,
  PESO_QUE_NO_VALE_TOCAR,
} from './redimensionarImagen';

// MUTATION-TESTING: estas dos son las decisiones que evitan que el dueño quede sin poder subir una
// foto desde el teléfono (una foto de celular pesa 3-6 MB y la app acepta 2). Mutaciones a atrapar:
// que dimensionesDestino AGRANDE una imagen chica (subiría el peso en vez de bajarlo), que deforme
// la proporción (el logo del pass saldría estirado), y que necesitaRedimensionar toque archivos que
// no hace falta tocar — recodificar un PNG chico puede AGRANDARLO.
describe('dimensionesDestino', () => {
  it('no agranda: una imagen más chica que el máximo se queda igual', () => {
    expect(dimensionesDestino(800, 600)).toEqual({ ancho: 800, alto: 600 });
    expect(dimensionesDestino(LADO_MAXIMO, 200)).toEqual({ ancho: LADO_MAXIMO, alto: 200 });
  });

  it('reduce por el lado MÁS LARGO y conserva la proporción', () => {
    // Foto típica de celular en horizontal (4:3).
    expect(dimensionesDestino(4032, 3024)).toEqual({ ancho: 1400, alto: 1050 });
    // La misma en vertical: el máximo tiene que aplicarse al ALTO, no al ancho.
    expect(dimensionesDestino(3024, 4032)).toEqual({ ancho: 1050, alto: 1400 });
  });

  it('una franja muy ancha y bajita conserva su forma', () => {
    // Proporción del strip del pass (1125x432 ≈ 2.6:1) pero al doble de tamaño.
    const r = dimensionesDestino(2250, 864);
    expect(r.ancho).toBe(1400);
    expect(r.alto).toBe(538); // 864 * (1400/2250) = 537.6 → 538
    expect(Math.abs(r.ancho / r.alto - 2250 / 864)).toBeLessThan(0.01);
  });

  it('nunca devuelve un lado en 0 (el canvas lanzaría)', () => {
    expect(dimensionesDestino(10000, 1, 100)).toEqual({ ancho: 100, alto: 1 });
  });
});

describe('necesitaRedimensionar', () => {
  it('no toca un archivo liviano aunque tenga muchos píxeles', () => {
    // Un PNG de pocos colores puede ser enorme en píxeles y pesar poco: recodificarlo lo agranda.
    expect(necesitaRedimensionar({ size: 100 * 1024 }, 4000, 4000)).toBe(false);
  });

  it('no toca un archivo pesado que ya está dentro del lado máximo', () => {
    expect(necesitaRedimensionar({ size: 3 * 1024 * 1024 }, 1200, 900)).toBe(false);
  });

  it('sí toca la foto de celular: pesada Y grande', () => {
    expect(necesitaRedimensionar({ size: 4 * 1024 * 1024 }, 4032, 3024)).toBe(true);
  });

  it('el umbral de peso es exclusivo: justo en el límite no se toca', () => {
    expect(necesitaRedimensionar({ size: PESO_QUE_NO_VALE_TOCAR }, 4000, 3000)).toBe(false);
    expect(necesitaRedimensionar({ size: PESO_QUE_NO_VALE_TOCAR + 1 }, 4000, 3000)).toBe(true);
  });
});

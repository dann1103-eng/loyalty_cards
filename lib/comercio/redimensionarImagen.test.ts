import { describe, it, expect } from 'vitest';
import {
  dimensionesDestino,
  necesitaRedimensionar,
  ladoMaximoDe,
  LADO_MAXIMO_POR_DEFECTO as LADO_MAXIMO,
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
  it('no toca lo que ya está dentro del lado máximo', () => {
    expect(necesitaRedimensionar(1200, 900)).toBe(false);
    expect(necesitaRedimensionar(LADO_MAXIMO, 900)).toBe(false);
  });

  it('sí toca la foto de celular', () => {
    expect(necesitaRedimensionar(4032, 3024)).toBe(true);
  });

  it('decide por DIMENSIONES, no por peso: un logo liviano pero enorme se achica igual', () => {
    // El caso real que motivó todo: un logo de 1400×933 que pesaba 777 KB se mostraba a ~50 px y
    // entraba TRES veces al pass (logo, @2x, @3x). Si esta función mirara el peso y lo dejara pasar,
    // el pass volvería a irse a 2,9 MB y las tarjetas del cliente tardarían en actualizarse.
    expect(necesitaRedimensionar(1400, 933, ladoMaximoDe('logo'))).toBe(true);
  });
});

// MUTATION-TESTING: si todos los campos compartieran un lado máximo (el error original), un logo y
// un ícono de sello se guardarían a 1400 px para mostrarse a 50 y 44 px. Los tests de abajo fallan
// si alguien "simplifica" la tabla a un número único.
describe('ladoMaximoDe', () => {
  it('cada campo tiene el suyo, acorde a cómo se VE en el pass', () => {
    expect(ladoMaximoDe('logo')).toBe(480);
    expect(ladoMaximoDe('sello_icono')).toBe(180);
    expect(ladoMaximoDe('hero')).toBe(1400);
  });

  it('el logo y el ícono son MUY menores que la foto de fondo', () => {
    expect(ladoMaximoDe('logo')).toBeLessThan(ladoMaximoDe('hero') / 2);
    expect(ladoMaximoDe('sello_icono')).toBeLessThan(ladoMaximoDe('logo') / 2);
  });

  it('un campo desconocido cae al máximo por defecto, no a 0 ni a undefined', () => {
    expect(ladoMaximoDe('campo_que_no_existe')).toBe(LADO_MAXIMO);
  });
});

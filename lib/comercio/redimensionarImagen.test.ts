import { describe, it, expect } from 'vitest';
import {
  dimensionesDestino,
  necesitaRedimensionar,
  ladoMaximoDe,
  cajaDelContenido,
  escalarCaja,
  valeLaPenaRecortar,
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

// Arma los píxeles RGBA que devolvería getImageData, con el alfa que dicte `alfaEn`.
function pixeles(ancho: number, alto: number, alfaEn: (x: number, y: number) => number) {
  const px = new Uint8ClampedArray(ancho * alto * 4);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      px[(y * ancho + x) * 4 + 3] = alfaEn(x, y);
    }
  }
  return px;
}

// Un rectángulo opaco (de `x0,y0` a `x1,y1`, inclusive) sobre un fondo transparente.
function conDibujoEn(ancho: number, alto: number, x0: number, y0: number, x1: number, y1: number) {
  return pixeles(ancho, alto, (x, y) => (x >= x0 && x <= x1 && y >= y0 && y <= y1 ? 255 : 0));
}

// MUTATION-TESTING: esto es lo que hace que el sello se vea del tamaño que corresponde. El caso
// real (2026-07-26): un ícono en un lienzo de 180×120 con el dibujo ocupando 87×86 salía a 21 px
// dentro de la caja de 44 del sello, la mitad que el de otro comercio. Mutaciones a atrapar: que la
// caja se quede corta y recorte el dibujo, que devuelva el lienzo entero (el recorte no haría nada
// y el ícono seguiría diminuto), y que una imagen 100% transparente devuelva una caja de lado 0
// —el canvas lanza con width 0 y el dueño se quedaría sin poder subir su imagen—.
describe('cajaDelContenido', () => {
  it('encuentra el dibujo que flota en un lienzo casi vacío', () => {
    // El caso real, a escala: dibujo de 87×86 metido en un lienzo de 180×120.
    const px = conDibujoEn(180, 120, 46, 17, 132, 102);
    expect(cajaDelContenido(px, 180, 120)).toEqual({ x: 46, y: 17, ancho: 87, alto: 86 });
  });

  it('una imagen sin margen devuelve el lienzo entero (y así no se recorta nada)', () => {
    const px = pixeles(40, 30, () => 255);
    expect(cajaDelContenido(px, 40, 30)).toEqual({ x: 0, y: 0, ancho: 40, alto: 30 });
  });

  it('una imagen 100% transparente devuelve null, no una caja de lado 0', () => {
    const px = pixeles(40, 30, () => 0);
    expect(cajaDelContenido(px, 40, 30)).toBeNull();
  });

  it('el antialiasing casi invisible del borde no cuenta como dibujo', () => {
    // Un halo de alfa 12 alrededor del dibujo: si contara, la caja sería el lienzo entero y el
    // recorte no serviría de nada justo en las imágenes que más lo necesitan (los PNG exportados
    // con sombra o brillo suave llevan un halo así por todo el lienzo).
    const px = pixeles(20, 20, (x, y) => (x >= 8 && x <= 11 && y >= 8 && y <= 11 ? 255 : 12));
    expect(cajaDelContenido(px, 20, 20)).toEqual({ x: 8, y: 8, ancho: 4, alto: 4 });
    // Un alfa apenas por encima del umbral SÍ es dibujo.
    const visible = pixeles(20, 20, () => 13);
    expect(cajaDelContenido(visible, 20, 20)).toEqual({ x: 0, y: 0, ancho: 20, alto: 20 });
  });
});

// MUTATION-TESTING: la caja se mide sobre una copia CHICA (recorrer una foto de 4000×3000 son 48 MB
// de array en el teléfono) y hay que llevarla de vuelta al original. Si se pasa de los límites,
// drawImage rellena con transparente y reaparece el margen que estábamos sacando.
describe('escalarCaja', () => {
  it('lleva la caja al tamaño del original y deja un píxel de holgura', () => {
    // Medido en una copia al 50%: en el original todo vale el doble.
    expect(escalarCaja({ x: 10, y: 10, ancho: 20, alto: 20 }, 2, 200, 200)).toEqual({
      x: 19, // 20 - 1 de holgura
      y: 19,
      ancho: 42, // 40 + 2 (la holgura de cada lado)
      alto: 42,
    });
  });

  it('nunca se sale de la imagen', () => {
    // Dibujo a sangre: la holgura no puede empujar la caja fuera del original.
    expect(escalarCaja({ x: 0, y: 0, ancho: 50, alto: 50 }, 2, 100, 100)).toEqual({
      x: 0,
      y: 0,
      ancho: 100,
      alto: 100,
    });
  });
});

// MUTATION-TESTING: sin este freno, CUALQUIER imagen se recodificaría por un margen de un píxel.
describe('valeLaPenaRecortar', () => {
  it('sí en el caso real (el dibujo ocupa la mitad del ancho)', () => {
    expect(valeLaPenaRecortar({ x: 46, y: 17, ancho: 87, alto: 86 }, 180, 120)).toBe(true);
  });

  it('no por uno o dos píxeles de borde', () => {
    expect(valeLaPenaRecortar({ x: 1, y: 1, ancho: 178, alto: 118 }, 180, 120)).toBe(false);
  });

  it('alcanza con que UN lado sobre para recortar (un lienzo ancho con el dibujo al centro)', () => {
    // Alto a sangre, ancho con márgenes: es exactamente la forma del ícono que se veía chico.
    expect(valeLaPenaRecortar({ x: 40, y: 0, ancho: 100, alto: 120 }, 180, 120)).toBe(true);
  });
});

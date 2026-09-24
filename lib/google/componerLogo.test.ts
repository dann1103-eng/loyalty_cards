import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  componerLogoCuadrado,
  componerLogoAncho,
  LADO_LOGO_CUADRADO,
  ANCHO_LOGO_ANCHO,
  ALTO_LOGO_ANCHO,
} from './componerLogo';

// Se mide sobre los PÍXELES de la imagen que sale, no sobre los argumentos que se le pasan a sharp: lo
// que le importa al dueño es dónde queda SU logo dentro del círculo de Google (CLAUDE.md, "medí la cosa
// que le importa al usuario, no un intermediario").
//
// Un "logo" de prueba es un rectángulo rojo liso del tamaño pedido: todo píxel rojo del resultado es
// logo, y todo lo demás es fondo.
//
// MUTACIONES corridas el 2026-09-23 (cada una restaurada y comparada con el índice de git):
//   (a) FRACCION_AREA_SEGURA = 0.8 → FALLAN "un logo 3:1 entra ENTERO en el área segura central…"
//       (`expected 66 to be 99`) y "un logo cuadrado queda dentro del círculo inscrito…" (`expected
//       373.3523804664971 to be less than 330`: sus esquinas quedan fuera del círculo de Google).
//   (b) El logo ancho CENTRADO en vez de a la izquierda → FALLA "el logo va pegado a la IZQUIERDA y lo
//       que sobra a la derecha es transparente" con `expected 240 to be +0`.
async function logoRojo(ancho: number, alto: number, formato: 'png' | 'jpeg' = 'png'): Promise<Buffer> {
  const img = sharp({ create: { width: ancho, height: alto, channels: 3, background: '#ff0000' } });
  return formato === 'png' ? img.png().toBuffer() : img.jpeg().toBuffer();
}

interface Pixeles {
  ancho: number;
  alto: number;
  canales: number;
  datos: Buffer;
}

async function pixeles(png: Buffer): Promise<Pixeles> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  return { ancho: info.width, alto: info.height, canales: info.channels, datos: data };
}

function pixel(p: Pixeles, x: number, y: number): number[] {
  const i = (y * p.ancho + x) * p.canales;
  return [...p.datos.subarray(i, i + p.canales)];
}

// La caja que encierra los píxeles del logo (rojos y opacos) y cuántos son.
function cajaDelLogo(p: Pixeles) {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, cantidad = 0;
  for (let y = 0; y < p.alto; y++) {
    for (let x = 0; x < p.ancho; x++) {
      const [r, g, b, a = 255] = pixel(p, x, y);
      if (r > 200 && g < 60 && b < 60 && a > 200) {
        cantidad++;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
  }
  return { minX, minY, maxX, maxY, ancho: maxX - minX + 1, alto: maxY - minY + 1, cantidad };
}

describe('componerLogoCuadrado (programLogo, el que Google recorta en círculo)', () => {
  it('sale un PNG de 660×660', async () => {
    const png = await componerLogoCuadrado(await logoRojo(300, 100), 'rgb(10, 20, 30)');
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe('png');
    expect([meta.width, meta.height]).toEqual([LADO_LOGO_CUADRADO, LADO_LOGO_CUADRADO]);
  });

  it('el fondo es el color de la tarjeta, a sangre (las esquinas)', async () => {
    const p = await pixeles(await componerLogoCuadrado(await logoRojo(300, 100), 'rgb(10, 20, 30)'));
    expect(pixel(p, 0, 0).slice(0, 3)).toEqual([10, 20, 30]);
    expect(pixel(p, 659, 659).slice(0, 3)).toEqual([10, 20, 30]);
  });

  it('sin color de tarjeta, o con uno ilegible, el fondo es blanco (no lanza)', async () => {
    for (const color of [null, 'no-es-un-color']) {
      const p = await pixeles(await componerLogoCuadrado(await logoRojo(100, 100), color));
      expect(pixel(p, 0, 0).slice(0, 3)).toEqual([255, 255, 255]);
    }
  });

  // EL caso de Pulso: un logo 3:1. Tiene que entrar ENTERO dentro del área segura central (el 70 % del
  // lado: de 99 a 560) — que es la que el círculo de Google nunca toca — y ocupar todo su ancho.
  it('un logo 3:1 entra ENTERO en el área segura central, sin deformarse, y ocupa todo su ancho', async () => {
    const p = await pixeles(await componerLogoCuadrado(await logoRojo(300, 100), 'rgb(10, 20, 30)'));
    const caja = cajaDelLogo(p);
    expect(caja.minX).toBe(99);
    expect(caja.maxX).toBe(560);
    // Centrado en alto: 462 × 154, de 253 a 406.
    expect(caja.minY).toBe(253);
    expect(caja.maxY).toBe(406);
    // Entero: el rectángulo está completo, no recortado ni con huecos (proporción 3:1 intacta).
    expect(caja.cantidad).toBe(caja.ancho * caja.alto);
    expect(caja.ancho / caja.alto).toBeCloseTo(3, 1);
  });

  // El peor caso para el círculo: un cuadrado llega a las esquinas del área segura. Con 70 % del lado,
  // la esquina queda a 231·√2 ≈ 326.7 px del centro, dentro del radio de 330.
  it('un logo cuadrado queda dentro del círculo inscrito (sus esquinas no pasan el radio)', async () => {
    const p = await pixeles(await componerLogoCuadrado(await logoRojo(480, 480), 'rgb(10, 20, 30)'));
    const caja = cajaDelLogo(p);
    const centro = LADO_LOGO_CUADRADO / 2;
    const radio = LADO_LOGO_CUADRADO / 2;
    for (const [x, y] of [[caja.minX, caja.minY], [caja.maxX + 1, caja.minY], [caja.minX, caja.maxY + 1], [caja.maxX + 1, caja.maxY + 1]]) {
      expect(Math.hypot(x - centro, y - centro)).toBeLessThan(radio);
    }
  });

  it('un logo JPEG (sin transparencia) también se compone', async () => {
    const p = await pixeles(await componerLogoCuadrado(await logoRojo(300, 100, 'jpeg'), 'rgb(10, 20, 30)'));
    expect(p.ancho).toBe(LADO_LOGO_CUADRADO);
    expect(cajaDelLogo(p).ancho).toBeGreaterThan(450);
  });

  it('bytes que no son una imagen: LANZA (la ruta decide qué servir; nunca un PNG vacío en silencio)', async () => {
    await expect(componerLogoCuadrado(Buffer.from('esto no es una imagen'), null)).rejects.toThrow();
  });
});

describe('componerLogoAncho (wideProgramLogo)', () => {
  it('sale un PNG de 1280×400 con canal alfa', async () => {
    const png = await componerLogoAncho(await logoRojo(300, 100));
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe('png');
    expect([meta.width, meta.height]).toEqual([ANCHO_LOGO_ANCHO, ALTO_LOGO_ANCHO]);
    expect(meta.hasAlpha).toBe(true);
  });

  it('el logo va pegado a la IZQUIERDA y lo que sobra a la derecha es transparente', async () => {
    // 2:1 → 800×400: sobran 480 px a la derecha.
    const p = await pixeles(await componerLogoAncho(await logoRojo(200, 100)));
    const caja = cajaDelLogo(p);
    expect(caja.minX).toBe(0);
    expect(caja.maxX).toBe(799);
    expect(pixel(p, 1279, 200)[3]).toBe(0);
    expect(pixel(p, 900, 0)[3]).toBe(0);
  });

  it('un logo MÁS ancho que 3.2:1 queda centrado en alto, entero', async () => {
    // 4:1 → 1280×320: sobran 80 px de alto, 40 arriba y 40 abajo.
    const p = await pixeles(await componerLogoAncho(await logoRojo(400, 100)));
    const caja = cajaDelLogo(p);
    expect([caja.minX, caja.maxX]).toEqual([0, 1279]);
    expect([caja.minY, caja.maxY]).toEqual([40, 359]);
    expect(caja.cantidad).toBe(caja.ancho * caja.alto);
    expect(pixel(p, 640, 0)[3]).toBe(0);
  });

  it('bytes que no son una imagen: LANZA', async () => {
    await expect(componerLogoAncho(Buffer.from('esto no es una imagen'))).rejects.toThrow();
  });
});

import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
import { ANCHOS_LOGO, redimensionarLogo, comprimirPng } from './imagenesPass';

// Las imágenes de prueba se generan acá y no se guardan como fixtures: lo que hay que probar es
// cómo reacciona sharp a píxeles REALES, y un PNG de 1×1 no ejercita ni el redimensionado ni la
// cuantización. Ruido criptográfico a todo color = el peor caso para PNG (no hay nada que
// predecir), que es justo el terreno donde estas dos funciones tienen que ganar peso.
async function pngDeRuido(ancho: number, alto: number, canales: 3 | 4 = 3): Promise<Buffer> {
  const px = randomBytes(ancho * alto * canales);
  return sharp(px, { raw: { width: ancho, height: alto, channels: canales } }).png().toBuffer();
}

async function anchoDe(buf: Buffer): Promise<number | undefined> {
  return (await sharp(buf).metadata()).width;
}

// MUTATION-TESTING: acá vive el 56% del peso del pass medido en producción el 2026-07-26 (993 KB de
// 1763). El bug era meter EL MISMO buffer de 480 px en las tres densidades. Mutaciones a atrapar:
// devolver el mismo buffer tres veces (vuelve el bug original), perder `withoutEnlargement` (un
// logo chico se estiraría a 480 px y PESARÍA MÁS que el original — medido: 30 KB → 440 KB), y que
// el redimensionado tire la transparencia (el logo saldría con un recuadro negro en la tarjeta).
describe('redimensionarLogo', () => {
  it('devuelve las tres densidades con su ancho real, y cada una más liviana que la siguiente', async () => {
    const logo = await pngDeRuido(480, 480);
    const [chico, mediano, grande] = await redimensionarLogo(logo);

    expect(await anchoDe(chico)).toBe(160);
    expect(await anchoDe(mediano)).toBe(320);
    expect(await anchoDe(grande)).toBe(480);

    // Lo que de verdad se estaba pagando: @1x y @2x viajaban al peso de @3x.
    expect(chico.length).toBeLessThan(mediano.length);
    expect(mediano.length).toBeLessThan(grande.length);
  });

  it('los anchos son los del área del logo de Apple, en orden y sin huecos', () => {
    // 160×50 pt es el área que Wallet dibuja: 160 px en @1x, el doble en @2x, el triple en @3x.
    // Si alguien "redondea" estos números el pass deja de verse nítido o vuelve a pesar de más.
    expect(ANCHOS_LOGO).toEqual([160, 320, 480]);
  });

  it('conserva la transparencia (un logo sin fondo sigue sin fondo)', async () => {
    // Casi todo logo de comercio es un PNG con alfa. Si el redimensionado lo aplanara, en la
    // tarjeta aparecería un rectángulo opaco alrededor del logo sobre el color de la marca.
    const conAlfa = await pngDeRuido(480, 480, 4);
    for (const densidad of await redimensionarLogo(conAlfa)) {
      expect((await sharp(densidad).metadata()).hasAlpha).toBe(true);
    }
  });

  it('NO agranda: un logo de 100 px se queda en 100 px en las tres densidades', async () => {
    // Estirar un logo chico no le agrega detalle (no hay de dónde sacarlo) y sí le agrega peso:
    // medido, ese mismo PNG de 100 px pasa de 30 KB a 440 KB al forzarlo a 480. Sería pagar por
    // píxeles inventados justo en la función que existe para bajar el peso del pass.
    const chico = await pngDeRuido(100, 100);
    for (const densidad of await redimensionarLogo(chico)) {
      expect(await anchoDe(densidad)).toBe(100);
    }
  });

  it('ante un buffer que no es una imagen devuelve el original, sin lanzar', async () => {
    // BEST-EFFORT: ninguna optimización de peso puede ser la razón por la que un cliente se quede
    // sin tarjeta. Si el logo guardado está corrupto, el pass sale con ese logo roto (Wallet lo
    // ignora) — pero sale.
    const basura = Buffer.from('esto no es una imagen');
    const densidades = await redimensionarLogo(basura);
    for (const densidad of densidades) {
      expect(densidad).toBe(basura);
    }
  });
});

// MUTATION-TESTING: las franjas eran 569 KB de los 1763 del pass — un PNG de una foto, y PNG es
// pésimo formato para fotos (Apple no acepta otro). La cuantización a paleta es lo único que corta
// ese peso. Mutaciones a atrapar: que no cuantice (vuelven los 569 KB) y que se quede con el
// resultado aunque pese MÁS que el original (pasa con imágenes ya optimizadas o de pocos colores:
// medido, un PNG de 90 bytes sale en 103 al recodificarlo).
describe('comprimirPng', () => {
  it('achica un PNG fotográfico', async () => {
    const foto = await pngDeRuido(375, 123);
    const comprimido = await comprimirPng(foto);
    expect(comprimido.length).toBeLessThan(foto.length);
  });

  it('devuelve el ORIGINAL cuando comprimir lo dejaría más pesado', async () => {
    // Un PNG mínimo ya está en su piso: la tabla de paleta que agrega la cuantización pesa más que
    // lo que ahorra. Sin este freno, "optimizar" engordaría el pass.
    const minimo = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } })
      .png()
      .toBuffer();
    const resultado = await comprimirPng(minimo);
    // El peso primero (falla legible: "103 no es <= 90") y la identidad después — `toBe` exige que
    // sea EL MISMO buffer, así un resultado recodificado que por casualidad pesara igual no cuela.
    expect(resultado.length).toBeLessThanOrEqual(minimo.length);
    expect(resultado).toBe(minimo);
  });

  it('ante un buffer que no es una imagen devuelve el original, sin lanzar', async () => {
    const basura = Buffer.from('esto tampoco es una imagen');
    expect(await comprimirPng(basura)).toBe(basura);
  });

  it('el resultado sigue siendo un PNG que Wallet puede leer, del mismo tamaño', async () => {
    // Cuantizar cambia los colores, NO las dimensiones ni el formato: un .pkpass con una franja que
    // no sea PNG, o con otras medidas, se ve roto en el teléfono y no hay prueba en el iPhone que
    // corramos en cada despliegue.
    const foto = await pngDeRuido(375, 123);
    const meta = await sharp(await comprimirPng(foto)).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(375);
    expect(meta.height).toBe(123);
  });
});

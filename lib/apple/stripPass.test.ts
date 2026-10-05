import { describe, it, expect, vi, afterEach } from 'vitest';
import sharp from 'sharp';
import { componerStrips } from './stripPass';

// LA prueba de que la franja del comercio no se CORTA.
//
// Hasta el 2026-09-17 los bytes de `strip_url` se mandaban tal cual y Wallet los recortaba para
// llenar su marco de 375×123: el dueño de M&M Inversiones vio su propio nombre partido a la mitad
// en su iPhone. Ahora se encaja completa y lo que sobra queda del color de la tarjeta.
//
// Se mide la imagen RESULTANTE con sharp en vez de asertar sobre el JSX: lo que le importa al dueño
// es que su diseño se vea entero, no cómo se arma.

const datosBase = {
  tipoTarjeta: 'membresia',
  puntos: 0,
  selloMeta: null,
  colorFondo: 'rgb(0, 0, 0)',
  colorLabel: 'rgb(255, 255, 255)',
  stripUrl: 'https://ejemplo.com/franja.png',
  selloIconoUrl: null,
  selloIcono2Url: null,
  patronSellos: { patron: 'intercalado' as const, casillas: [] },
  heroUrl: null,
  difuminadoFranja: 'ninguno',
  encuadreFranja: { modo: 'llenar' as const, focoX: 50, focoY: 50, zoom: 100 },
  hayTextoEncima: false,
};

// Una franja CUADRADA (el peor caso: el marco es casi tres veces más ancho que alto).
async function franjaCuadrada(): Promise<Buffer> {
  return sharp({
    create: { width: 600, height: 600, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
}

// Solo se intercepta la URL de la franja: next/og carga su propio wasm con fetch, y devolverle un
// PNG lo hace reventar con "expected magic word 00 61 73 6d".
function soloLaFranja(responder: () => Response): typeof fetch {
  const real = globalThis.fetch;
  return (async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input instanceof Request ? input.url : input).includes('ejemplo.com')
      ? responder()
      : real(input as RequestInfo, init)) as typeof fetch;
}

function responderCon(buf: Buffer): typeof fetch {
  return soloLaFranja(
    () => new Response(new Uint8Array(buf), { status: 200, headers: { 'content-type': 'image/png' } }),
  );
}

// Color del píxel (x, y) de un PNG.
async function pixel(png: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}

afterEach(() => vi.unstubAllGlobals());

describe('componerStrips con franja propia', () => {
  it('encaja la franja COMPLETA y rellena los costados con el color de la tarjeta', async () => {
    vi.stubGlobal('fetch', responderCon(await franjaCuadrada()));

    const strips = await componerStrips(datosBase);

    expect(strips, 'la composición no debería fallar').not.toBeNull();
    const s1 = await sharp(strips!.s1).metadata();
    expect([s1.width, s1.height], 'la franja @1x mide 375×123').toEqual([375, 123]);

    // El centro es la franja (roja): entra entera, con su alto completo.
    const [r, g, b] = await pixel(strips!.s1, 187, 61);
    expect([r, g, b], 'el centro tiene que ser la imagen del comercio').toEqual([255, 0, 0]);

    // Los costados son el color de la tarjeta, no un recorte de la imagen. MUTACIÓN: volver a
    // mandar los bytes crudos (o usar objectFit 'cover') deja rojo también acá y esta prueba falla.
    const izquierda = await pixel(strips!.s1, 2, 61);
    const derecha = await pixel(strips!.s1, 372, 61);
    expect(izquierda, 'el costado izquierdo es el color de la tarjeta').toEqual([0, 0, 0]);
    expect(derecha, 'el costado derecho es el color de la tarjeta').toEqual([0, 0, 0]);
  }, 30_000);

  it('la foto de fondo NO se oscurece cuando no se escribe nada encima, y sí cuando se escribe', async () => {
    // El velo existe para que el texto sobre la franja se lea. En una membresía sin nombre de pase
    // no va nada encima, así que solo apagaba la foto del comercio (reportado con una tarjeta real
    // el 2026-09-17). MUTACIÓN: pintar el velo siempre hace fallar la primera mitad de esta prueba.
    const foto = await franjaCuadrada();
    const datosConFoto = { ...datosBase, stripUrl: null, heroUrl: 'https://ejemplo.com/foto.jpg' };

    vi.stubGlobal('fetch', responderCon(foto));
    const limpia = await componerStrips(datosConFoto);
    const [r] = await pixel(limpia!.s1, 187, 61);
    expect(r, 'sin texto encima, el rojo de la foto queda intacto').toBe(255);

    vi.stubGlobal('fetch', responderCon(foto));
    const conVelo = await componerStrips({ ...datosConFoto, hayTextoEncima: true });
    const [rVelo] = await pixel(conVelo!.s1, 187, 61);
    expect(rVelo, 'con texto encima, la foto se oscurece para que se lea').toBeLessThan(200);
  }, 30_000);

  it('si la franja propia no baja, compone la banda de marca en vez de quedarse sin franja', async () => {
    vi.stubGlobal('fetch', soloLaFranja(() => new Response('no', { status: 404 })));

    const strips = await componerStrips(datosBase);

    expect(strips).not.toBeNull();
    const meta = await sharp(strips!.s2).metadata();
    expect([meta.width, meta.height], 'la banda @2x mide 750×246').toEqual([750, 246]);
  }, 30_000);
});

// ── La grilla con DOS íconos de sello (migración 0041) ────────────────────────────────────────────
// Se mira el PÍXEL del centro de cada casilla en el PNG, no el árbol que se le pasa a next/og: lo que
// le importa al dueño es qué dibujo sale en qué casilla.
//
// 4 sellos llenos en una fila: cada uno mide 52 y hay 8 de separación, así que la fila ocupa 232 y
// arranca en (375 − 232) / 2 = 71.5. Los centros caen en x = 97, 157, 217 y 277, a media altura.
describe('componerStrips — grilla con dos íconos de sello', () => {
  const CENTROS = [97, 157, 217, 277];
  const ROJO: [number, number, number] = [255, 0, 0];
  const AZUL: [number, number, number] = [0, 0, 255];

  const cuadrado = (color: { r: number; g: number; b: number }) =>
    sharp({ create: { width: 120, height: 120, channels: 3, background: color } }).png().toBuffer();

  // El primer ícono es ROJO y el segundo AZUL; cada URL responde con el suyo. `sinSegundo` hace que
  // el segundo dé 404, como una imagen borrada del bucket.
  async function grilla(sobre: Partial<typeof datosBase> & Record<string, unknown>, sinSegundo = false) {
    const [rojo, azul] = [await cuadrado({ r: 255, g: 0, b: 0 }), await cuadrado({ r: 0, g: 0, b: 255 })];
    const real = globalThis.fetch;
    const png = (buf: Buffer) =>
      new Response(new Uint8Array(buf), { status: 200, headers: { 'content-type': 'image/png' } });
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('ejemplo.com/a.png')) return png(rojo);
      if (url.includes('ejemplo.com/b.png')) return sinSegundo ? new Response('no', { status: 404 }) : png(azul);
      return real(input as RequestInfo, init);
    }) as typeof fetch);

    const strips = await componerStrips({
      ...datosBase,
      tipoTarjeta: 'sellos',
      puntos: 4,
      selloMeta: 4,
      stripUrl: null,
      selloIconoUrl: 'https://ejemplo.com/a.png',
      selloIcono2Url: 'https://ejemplo.com/b.png',
      ...sobre,
    });
    expect(strips, 'la composición no debería fallar').not.toBeNull();
    return Promise.all(CENTROS.map((x) => pixel(strips!.s1, x, 61)));
  }

  it('intercalado: rojo, azul, rojo, azul', async () => {
    expect(await grilla({ patronSellos: { patron: 'intercalado', casillas: [] } })).toEqual([ROJO, AZUL, ROJO, AZUL]);
  }, 30_000);

  it('ultimo: solo la casilla del premio lleva el segundo ícono', async () => {
    expect(await grilla({ patronSellos: { patron: 'ultimo', casillas: [] } })).toEqual([ROJO, ROJO, ROJO, AZUL]);
  }, 30_000);

  it('casillas elegidas: la 1 y la 3', async () => {
    expect(await grilla({ patronSellos: { patron: 'casillas', casillas: [1, 3] } })).toEqual([AZUL, ROJO, AZUL, ROJO]);
  }, 30_000);

  it('sin segundo ícono, el patrón no se mira: la grilla de siempre', async () => {
    expect(await grilla({ selloIcono2Url: null, patronSellos: { patron: 'intercalado', casillas: [] } })).toEqual([
      ROJO, ROJO, ROJO, ROJO,
    ]);
  }, 30_000);

  it('si el segundo ícono no baja, todas las casillas llevan el primero (nunca una casilla vacía)', async () => {
    expect(await grilla({ patronSellos: { patron: 'intercalado', casillas: [] } }, true)).toEqual([
      ROJO, ROJO, ROJO, ROJO,
    ]);
  }, 30_000);

  it('solo segundo ícono (sin primero): las demás casillas llevan el aro de siempre, no un hueco', async () => {
    const px = await grilla({ selloIconoUrl: null, patronSellos: { patron: 'ultimo', casillas: [] } });
    expect(px[3], 'la última es el ícono').toEqual(AZUL);
    // Un sello lleno SIN ícono es un círculo del color de etiqueta con un punto del color de fondo
    // en el medio: el centro exacto es ese punto (negro), no el fondo de la franja ni el ícono.
    expect(px[0]).toEqual([0, 0, 0]);
    expect(px[0]).not.toEqual(AZUL);
  }, 30_000);
});

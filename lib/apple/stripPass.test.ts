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
  heroUrl: null,
  difuminadoFranja: 'ninguno',
  encuadreFranja: { modo: 'llenar' as const, focoX: 50, focoY: 50, zoom: 100 },
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

  it('si la franja propia no baja, compone la banda de marca en vez de quedarse sin franja', async () => {
    vi.stubGlobal('fetch', soloLaFranja(() => new Response('no', { status: 404 })));

    const strips = await componerStrips(datosBase);

    expect(strips).not.toBeNull();
    const meta = await sharp(strips!.s2).metadata();
    expect([meta.width, meta.height], 'la banda @2x mide 750×246').toEqual([750, 246]);
  }, 30_000);
});

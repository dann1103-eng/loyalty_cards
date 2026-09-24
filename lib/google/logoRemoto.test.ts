import { describe, it, expect, afterEach, vi } from 'vitest';
import sharp from 'sharp';
import { bajarLogo, medidasLogo, TIEMPO_MAXIMO_MEDICION_MS } from './logoRemoto';

// `fetch` stubeado: acá no hay Supabase, y ninguna prueba baja un logo de verdad.
//
// MUTACIONES corridas el 2026-09-23, después de agregar la ventana de fallos y la deduplicación (cada
// una restaurada y comparada con el índice de git):
//   (a) Sin la ventana (sin la línea `if (fallo !== undefined && Date.now() - fallo < VENTANA_FALLO_MS)`)
//       → FALLAN "un fallo se recuerda 30 s…" (`expected "vi.fn()" to be called 1 times, but got 2
//       times`) y "bytes que no son una imagen → null, y cuentan como fallo…" (`expected { ancho: 120,
//       alto: 60 } to be null`).
//   (b) Ventana infinita (`Date.now() - fallo < Infinity`) → FALLAN "pasados 30 s vuelve a intentar y,
//       si anda, mide" (`expected null to deeply equal { ancho: 300, alto: 100 }`) y la de los bytes que
//       no son una imagen (`expected null to deeply equal { ancho: 120, alto: 60 }`).
//   (c) Sin la deduplicación (sin `if (enCurso) return enCurso;`) → FALLA "dos llamadas simultáneas a la
//       misma URL hacen UNA sola descarga" con `expected "vi.fn()" to be called 1 times, but got 2 times`.
//   (d) Sin cachear los éxitos (sin el `set` de la medición exitosa) → FALLA "caché por URL…" con
//       `expected "vi.fn()" to be called 1 times, but got 2 times`.
//   (e) `fetch(url)` sin el `signal` del tiempo máximo → FALLA "timeout: un bucket que no responde da
//       null en ~2 s, no cuelga" con `Error: Test timed out in 8000ms.`
//
// Las pruebas de la ventana mueven solo el reloj (`vi.useFakeTimers({ toFake: ['Date'] })`): los
// timers quedan reales, así el AbortSignal.timeout de la prueba del timeout no se entera.
//
// La caché de medidasLogo es del MÓDULO y vive toda la corrida: cada prueba usa una URL propia para
// que lo que cacheó una no le conteste a otra.
let contador = 0;
function urlNueva(): string {
  contador += 1;
  return `https://ejemplo.com/storage/logo-${contador}.png?v=${Date.now()}`;
}

async function pngDe(ancho: number, alto: number): Promise<Buffer> {
  return sharp({ create: { width: ancho, height: alto, channels: 4, background: '#ff0000' } }).png().toBuffer();
}

function respuestaPng(bytes: Buffer): Response {
  return new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': 'image/png' } });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('medidasLogo', () => {
  it('devuelve ancho y alto en píxeles del logo', async () => {
    const png = await pngDe(300, 100);
    vi.stubGlobal('fetch', vi.fn(async () => respuestaPng(png)));
    expect(await medidasLogo(urlNueva())).toEqual({ ancho: 300, alto: 100 });
  });

  it('caché por URL: la segunda llamada con la MISMA URL no vuelve a descargar', async () => {
    const png = await pngDe(300, 100);
    const fetchMock = vi.fn(async () => respuestaPng(png));
    vi.stubGlobal('fetch', fetchMock);
    const url = urlNueva();

    expect(await medidasLogo(url)).toEqual({ ancho: 300, alto: 100 });
    expect(await medidasLogo(url)).toEqual({ ancho: 300, alto: 100 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Los fallos se recuerdan 30 s (VENTANA_FALLO_MS) y no más. Sin la ventana, con el bucket lento cada
  // camino volvía a medir: +2 s en cada registro y hasta +4 a 6 s en linkGuardar, que mide el mismo logo
  // dos veces seguidas. Sin el límite, un null (p. ej. un arranque en frío justo después de subir el
  // logo) dejaría el logo ancho apagado hasta que la instancia reinicie.
  it('un fallo se recuerda 30 s: dentro de la ventana devuelve null SIN volver a descargar', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-23T12:00:00.000Z'));
    const fetchMock = vi.fn(async () => new Response('caído', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const url = urlNueva();

    expect(await medidasLogo(url)).toBeNull();
    vi.setSystemTime(new Date('2026-09-23T12:00:29.999Z'));
    expect(await medidasLogo(url)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('pasados 30 s vuelve a intentar y, si anda, mide', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-23T12:00:00.000Z'));
    const png = await pngDe(300, 100);
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('red caída'))
      .mockResolvedValueOnce(respuestaPng(png));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const url = urlNueva();

    expect(await medidasLogo(url)).toBeNull();
    vi.setSystemTime(new Date('2026-09-23T12:00:30.000Z'));
    expect(await medidasLogo(url)).toEqual({ ancho: 300, alto: 100 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('bytes que no son una imagen → null, y cuentan como fallo (30 s, no para siempre)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-23T12:00:00.000Z'));
    const png = await pngDe(120, 60);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('<html>no soy un logo</html>', { status: 200 }))
      .mockResolvedValueOnce(respuestaPng(png));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const url = urlNueva();

    expect(await medidasLogo(url)).toBeNull();
    expect(await medidasLogo(url)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-09-23T12:00:31.000Z'));
    expect(await medidasLogo(url)).toEqual({ ancho: 120, alto: 60 });
  });

  // linkGuardar mide el mismo logo dos veces seguidas (syncClasePrograma y después resolverLogosClase),
  // y dos registros casi a la vez miden el mismo logo del comercio: con una medición EN CURSO para esa
  // URL, se reusa su promesa en vez de bajar el logo otra vez.
  it('dos llamadas simultáneas a la misma URL hacen UNA sola descarga', async () => {
    const png = await pngDe(300, 100);
    let entregar!: (r: Response) => void;
    const respuesta = new Promise<Response>((resolver) => {
      entregar = resolver;
    });
    const fetchMock = vi.fn(() => respuesta);
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const url = urlNueva();

    const primera = medidasLogo(url);
    const segunda = medidasLogo(url);
    entregar(respuestaPng(png));
    const resultados = await Promise.all([primera, segunda]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resultados).toEqual([{ ancho: 300, alto: 100 }, { ancho: 300, alto: 100 }]);
  });

  // El bucket que no contesta no puede colgar el registro de un cliente: a los ~2 s, null.
  it('timeout: un bucket que no responde da null en ~2 s, no cuelga', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolver, rechazar) => {
            init?.signal?.addEventListener('abort', () => rechazar(init.signal!.reason));
          }),
      ),
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const inicio = Date.now();
    expect(await medidasLogo(urlNueva())).toBeNull();
    const demora = Date.now() - inicio;
    expect(demora).toBeGreaterThanOrEqual(TIEMPO_MAXIMO_MEDICION_MS - 100);
    expect(demora).toBeLessThan(TIEMPO_MAXIMO_MEDICION_MS + 2000);
  }, 8_000);
});

describe('bajarLogo', () => {
  it('devuelve los bytes y el content-type', async () => {
    const png = await pngDe(10, 10);
    vi.stubGlobal('fetch', vi.fn(async () => respuestaPng(png)));
    const logo = await bajarLogo(urlNueva(), 1000);
    expect(logo?.tipo).toBe('image/png');
    expect(logo?.bytes.equals(png)).toBe(true);
  });

  it('una respuesta de error → null (no lanza)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no está', { status: 404 })));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await bajarLogo(urlNueva(), 1000)).toBeNull();
  });
});

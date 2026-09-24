import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import sharp from 'sharp';
import { createServiceClient } from '@/lib/supabase/server';
import { crearEntorno } from '../../../../../test/fixtures/entornoComercio';

// El programLogo de la clase de Google. La composición es la REAL (componerLogo.ts): se mide la imagen
// que sale, no lo que se le pidió a sharp. Se mockea solo para poder forzarla a fallar, que es el caso
// que esta ruta tiene prohibido convertir en un error.
//
// MUTACIONES corridas el 2026-09-23 sobre lib/google/servirLogoClase.ts (cada una restaurada y
// comparada con el índice de git):
//   (a) Responder 500 si la composición falla, en vez del original → FALLAN "si la composición FALLA,
//       sirve el logo ORIGINAL…" y "si la composición falla y el original NO es PNG…" con `expected 500
//       to be 200`, y la misma de logo-ancho.png (3 en total).
//   (b) Servir el original SIN convertirlo a PNG → FALLA "…NO es PNG, lo sirve convertido a PNG" con
//       `expected [ 'jpeg', 300, 100 ] to deeply equal [ 'png', 300, 100 ]`.
//   (c) Sin el scope `.eq('comercio_id', comercioId)` sobre el programa → FALLA "un ?programa= de OTRO
//       comercio → 404, no cae al comercio en silencio" con `expected 200 to be 404` (y la de
//       logo-ancho.png, igual).
//   (d) 404 en vez de 502 cuando el bucket no responde → FALLA "si el bucket no responde → 502" con
//       `expected 404 to be 502`.
//   (e) Volver a reenviar los bytes crudos con su tipo de origen cuando sharp no puede convertirlos
//       (`status: 200`, `'Content-Type': tipo ?? 'application/octet-stream'`) → FALLA "si el "logo" es
//       HTML (sharp no lo compone ni lo convierte) → 502, nunca text/html" con `expected 200 to be 502`.
const componerMock = vi.fn();
vi.mock('@/lib/google/componerLogo', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/google/componerLogo')>();
  return { ...real, componerLogoCuadrado: (...args: unknown[]) => componerMock(...args) };
});

// Los logos "del bucket" se sirven desde este mapa: `fetch` se stubea para las URLs de ejemplo.com y
// deja pasar todo lo demás (el cliente de Supabase también usa fetch). Nada baja de internet.
const fetchReal = globalThis.fetch;
const bucket = new Map<string, { bytes: Buffer; tipo: string } | 'caido'>();

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

beforeEach(async () => {
  const real = await vi.importActual<typeof import('@/lib/google/componerLogo')>('@/lib/google/componerLogo');
  componerMock.mockReset().mockImplementation(real.componerLogoCuadrado);
  bucket.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn((entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
      if (!url.startsWith('https://ejemplo.com/')) return fetchReal(entrada, init);
      const logo = bucket.get(url);
      if (!logo) return Promise.resolve(new Response('no está', { status: 404 }));
      if (logo === 'caido') return Promise.resolve(new Response('caído', { status: 503 }));
      return Promise.resolve(new Response(new Uint8Array(logo.bytes), { status: 200, headers: { 'content-type': logo.tipo } }));
    }),
  );
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await entorno.limpiar();
});

async function logoRojo(ancho: number, alto: number, formato: 'png' | 'jpeg' = 'png'): Promise<Buffer> {
  const img = sharp({ create: { width: ancho, height: alto, channels: 3, background: '#ff0000' } });
  return formato === 'png' ? img.png().toBuffer() : img.jpeg().toBuffer();
}

async function pedir(comercioId: string, programaId?: string) {
  const { GET } = await import('./route');
  const url = `http://localhost/api/comercios/${comercioId}/logo.png${programaId ? `?programa=${programaId}` : ''}`;
  const { NextRequest } = await import('next/server');
  return GET(new NextRequest(url), { params: Promise.resolve({ comercioId }) });
}

async function cuerpo(res: Response): Promise<Buffer> {
  return Buffer.from(await res.arrayBuffer());
}

describe('GET /api/comercios/[comercioId]/logo.png', () => {
  it('compone el cuadrado de 660×660 en PNG, con el color de la tarjeta a sangre', async () => {
    bucket.set('https://ejemplo.com/logo-pulso.png', { bytes: await logoRojo(300, 100), tipo: 'image/png' });
    const comercioId = await entorno.crearComercio({ logo_url: 'https://ejemplo.com/logo-pulso.png', color_fondo: 'rgb(10, 20, 30)' });

    const res = await pedir(comercioId);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const imagen = sharp(await cuerpo(res));
    const meta = await imagen.metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 660, 660]);
    const { data, info } = await imagen.raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([10, 20, 30]);
    // Y en el centro, el logo.
    const centro = (330 * info.width + 330) * info.channels;
    expect([...data.subarray(centro, centro + 3)]).toEqual([255, 0, 0]);
  }, 30_000);

  it('con ?programa= compone con el logo y el color EFECTIVOS del programa', async () => {
    bucket.set('https://ejemplo.com/logo-comercio.png', { bytes: await logoRojo(100, 100), tipo: 'image/png' });
    const logoPrograma = await logoRojo(300, 100);
    bucket.set('https://ejemplo.com/logo-programa.png', { bytes: logoPrograma, tipo: 'image/png' });
    const comercioId = await entorno.crearComercio({ logo_url: 'https://ejemplo.com/logo-comercio.png', color_fondo: 'rgb(10, 20, 30)' });
    const programaId = entorno.obtenerProgramaPrincipal(comercioId);
    await supabase
      .from('programas_tarjeta')
      .update({ branding_propio: true, logo_url: 'https://ejemplo.com/logo-programa.png', color_fondo: 'rgb(200, 100, 0)' })
      .eq('id', programaId);

    const res = await pedir(comercioId, programaId);

    expect(res.status).toBe(200);
    const [bytes, colorFondo] = componerMock.mock.calls[0];
    expect((bytes as Buffer).equals(logoPrograma)).toBe(true);
    expect(colorFondo).toBe('rgb(200, 100, 0)');
  }, 30_000);

  it('comercio sin logo → 404, sin componer nada', async () => {
    const comercioId = await entorno.crearComercio({ logo_url: null });
    const res = await pedir(comercioId);
    expect(res.status).toBe(404);
    expect(componerMock).not.toHaveBeenCalled();
  }, 30_000);

  it('un ?programa= de OTRO comercio → 404, no cae al comercio en silencio', async () => {
    bucket.set('https://ejemplo.com/logo.png', { bytes: await logoRojo(100, 100), tipo: 'image/png' });
    const comercioId = await entorno.crearComercio({ logo_url: 'https://ejemplo.com/logo.png' });
    const otroId = await entorno.crearComercio({ logo_url: 'https://ejemplo.com/logo.png' });
    const res = await pedir(comercioId, entorno.obtenerProgramaPrincipal(otroId));
    expect(res.status).toBe(404);
    expect(componerMock).not.toHaveBeenCalled();
  }, 30_000);

  // LA prueba de la ruta. Google rechaza el patch ENTERO de la clase si no puede bajar el programLogo:
  // un error acá dejaría al comercio sin Google Wallet. El original se ve como antes, pero anda.
  it('si la composición FALLA, sirve el logo ORIGINAL (200, PNG, los mismos bytes)', async () => {
    const original = await logoRojo(300, 100);
    bucket.set('https://ejemplo.com/logo-pulso.png', { bytes: original, tipo: 'image/png' });
    const comercioId = await entorno.crearComercio({ logo_url: 'https://ejemplo.com/logo-pulso.png' });
    componerMock.mockRejectedValueOnce(new Error('sharp se quedó sin memoria'));

    const res = await pedir(comercioId);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect((await cuerpo(res)).equals(original)).toBe(true);
  }, 30_000);

  it('si la composición falla y el original NO es PNG, lo sirve convertido a PNG', async () => {
    bucket.set('https://ejemplo.com/logo.jpg', { bytes: await logoRojo(300, 100, 'jpeg'), tipo: 'image/jpeg' });
    const comercioId = await entorno.crearComercio({ logo_url: 'https://ejemplo.com/logo.jpg' });
    componerMock.mockRejectedValueOnce(new Error('sharp se quedó sin memoria'));

    const res = await pedir(comercioId);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const meta = await sharp(await cuerpo(res)).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 300, 100]);
  }, 30_000);

  // La URL del logo la puede escribir cualquiera con acceso al admin de FM: si apuntara a una página,
  // reenviar sus bytes con el tipo de origen serviría `text/html` desde NUESTRO dominio. Y lo que sharp
  // no lee, Google tampoco: el reenvío no salvaba ningún patch.
  it('si el "logo" es HTML (sharp no lo compone ni lo convierte) → 502, nunca text/html', async () => {
    bucket.set('https://ejemplo.com/no-es-un-logo', {
      bytes: Buffer.from('<html><body><script>alert(1)</script></body></html>'),
      tipo: 'text/html',
    });
    const comercioId = await entorno.crearComercio({ logo_url: 'https://ejemplo.com/no-es-un-logo' });

    const res = await pedir(comercioId);

    expect(res.status).toBe(502);
    expect(res.headers.get('content-type') ?? '').not.toContain('text/html');
  }, 30_000);

  // Sin bytes no hay nada que servir. 502 (pasajero), no 404, y nunca una redirección al logo crudo:
  // Google lo cachearía bajo esta URL versionada.
  it('si el bucket no responde → 502', async () => {
    bucket.set('https://ejemplo.com/logo-caido.png', 'caido');
    const comercioId = await entorno.crearComercio({ logo_url: 'https://ejemplo.com/logo-caido.png' });
    const res = await pedir(comercioId);
    expect(res.status).toBe(502);
    expect(componerMock).not.toHaveBeenCalled();
  }, 30_000);
});

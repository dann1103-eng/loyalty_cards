import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import sharp from 'sharp';
import { createServiceClient } from '@/lib/supabase/server';
import { crearEntorno } from '../../../../../test/fixtures/entornoComercio';

// El wideProgramLogo de la clase de Google. Mismo armado que la prueba de logo.png (la lógica común vive
// en lib/google/servirLogoClase.ts y se prueba entera allá): la composición REAL, mockeada solo para
// poder forzarla a fallar; los logos "del bucket" salen de un mapa y nada baja de internet.
//
// MUTACIONES corridas el 2026-09-23 sobre lib/google/servirLogoClase.ts (restauradas y comparadas con el
// índice de git): responder 500 si la composición falla → FALLA "si la composición FALLA, sirve el logo
// ORIGINAL…" con `expected 500 to be 200`; sin el scope por comercio del `?programa=` → FALLA "un
// ?programa= de OTRO comercio → 404" con `expected 200 to be 404`.
const componerMock = vi.fn();
vi.mock('@/lib/google/componerLogo', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/google/componerLogo')>();
  return { ...real, componerLogoAncho: (...args: unknown[]) => componerMock(...args) };
});

const fetchReal = globalThis.fetch;
const bucket = new Map<string, Buffer>();

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

beforeEach(async () => {
  const real = await vi.importActual<typeof import('@/lib/google/componerLogo')>('@/lib/google/componerLogo');
  componerMock.mockReset().mockImplementation(real.componerLogoAncho);
  bucket.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn((entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
      if (!url.startsWith('https://ejemplo.com/')) return fetchReal(entrada, init);
      const bytes = bucket.get(url);
      if (!bytes) return Promise.resolve(new Response('no está', { status: 404 }));
      return Promise.resolve(new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': 'image/png' } }));
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

async function logoRojo(ancho: number, alto: number): Promise<Buffer> {
  return sharp({ create: { width: ancho, height: alto, channels: 3, background: '#ff0000' } }).png().toBuffer();
}

async function pedir(comercioId: string, programaId?: string) {
  const { GET } = await import('./route');
  const url = `http://localhost/api/comercios/${comercioId}/logo-ancho.png${programaId ? `?programa=${programaId}` : ''}`;
  const { NextRequest } = await import('next/server');
  return GET(new NextRequest(url), { params: Promise.resolve({ comercioId }) });
}

describe('GET /api/comercios/[comercioId]/logo-ancho.png', () => {
  it('compone el logo ancho de 1280×400 en PNG transparente', async () => {
    bucket.set('https://ejemplo.com/logo-pulso.png', await logoRojo(300, 100));
    const comercioId = await entorno.crearComercio({ logo_url: 'https://ejemplo.com/logo-pulso.png', color_fondo: 'rgb(10, 20, 30)' });

    const res = await pedir(comercioId);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([meta.format, meta.width, meta.height, meta.hasAlpha]).toEqual(['png', 1280, 400, true]);
  }, 30_000);

  it('comercio sin logo → 404', async () => {
    const comercioId = await entorno.crearComercio({ logo_url: null });
    expect((await pedir(comercioId)).status).toBe(404);
    expect(componerMock).not.toHaveBeenCalled();
  }, 30_000);

  it('un ?programa= de OTRO comercio → 404', async () => {
    // El logo SÍ está en el bucket: sin el scope por comercio, la ruta respondería 200 con él.
    bucket.set('https://ejemplo.com/logo.png', await logoRojo(100, 100));
    const comercioId = await entorno.crearComercio({ logo_url: 'https://ejemplo.com/logo.png' });
    const otroId = await entorno.crearComercio({ logo_url: 'https://ejemplo.com/logo.png' });
    expect((await pedir(comercioId, entorno.obtenerProgramaPrincipal(otroId))).status).toBe(404);
    expect(componerMock).not.toHaveBeenCalled();
  }, 30_000);

  // Google rechaza el patch ENTERO de la clase si no puede bajar una de sus imágenes.
  it('si la composición FALLA, sirve el logo ORIGINAL (200, PNG, los mismos bytes)', async () => {
    const original = await logoRojo(300, 100);
    bucket.set('https://ejemplo.com/logo-pulso.png', original);
    const comercioId = await entorno.crearComercio({ logo_url: 'https://ejemplo.com/logo-pulso.png' });
    componerMock.mockRejectedValueOnce(new Error('sharp se quedó sin memoria'));

    const res = await pedir(comercioId);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await res.arrayBuffer()).equals(original)).toBe(true);
  }, 30_000);
});

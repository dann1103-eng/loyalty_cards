import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { syncClaseComercio } from './syncClase';

const insertMock = vi.fn();
const patchMock = vi.fn();

vi.mock('./walletClient', () => ({
  issuerId: () => 'issuer-test',
  walletClient: () => ({
    loyaltyclass: { insert: insertMock, patch: patchMock },
  }),
}));

// La medición del logo, mockeada: el logo del comercio de prueba es una URL falsa
// (https://ejemplo.com/logo.png) y ninguna prueba baja nada de la red. Por defecto "no se pudo medir".
const medidasLogoMock = vi.fn();
vi.mock('./logoRemoto', () => ({
  medidasLogo: (...args: unknown[]) => medidasLogoMock(...args),
}));

const supabase = createServiceClient();
let comercioId: string | null = null;

// NEXT_PUBLIC_BASE_URL lo fijan las pruebas de la portada compuesta (la URL la lleva dentro): se
// restaura para no filtrar el valor a los demás archivos de la suite.
const BASE_ORIGINAL = process.env.NEXT_PUBLIC_BASE_URL;

async function crearComercio(datos: Partial<{ logo_url: string | null; google_class_id: string | null; nombre: string; color_fondo: string; hero_url: string | null }>) {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase
    .from('comercios')
    .insert({
      nombre: datos.nombre ?? 'Comercio Google Test',
      slug: `test-google-clase-${sufijo}`,
      logo_url: datos.logo_url === undefined ? 'https://ejemplo.com/logo.png' : datos.logo_url,
      google_class_id: datos.google_class_id ?? null,
      color_fondo: datos.color_fondo ?? 'rgb(10, 20, 30)',
      hero_url: datos.hero_url ?? null,
    })
    .select('id')
    .single();
  if (error) throw error;
  comercioId = data.id;
  return data.id;
}

beforeEach(() => {
  insertMock.mockReset().mockResolvedValue({});
  patchMock.mockReset().mockResolvedValue({});
  medidasLogoMock.mockReset().mockResolvedValue(null);
});

afterEach(async () => {
  if (BASE_ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
  else process.env.NEXT_PUBLIC_BASE_URL = BASE_ORIGINAL;
  if (!comercioId) return;
  await supabase.from('comercios').delete().eq('id', comercioId);
  comercioId = null;
});

describe('syncClaseComercio', () => {
  it('sin logo: no llama a Google y devuelve error claro (Google no tiene fallback de texto)', async () => {
    const id = await crearComercio({ logo_url: null });
    const res = await syncClaseComercio(supabase, id);
    expect(res.ok).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('primera vez (sin google_class_id): inserta en Google y guarda el id en la BD', async () => {
    const id = await crearComercio({ google_class_id: null });
    const res = await syncClaseComercio(supabase, id);
    expect(res.ok).toBe(true);
    expect(insertMock).toHaveBeenCalledOnce();
    expect(patchMock).not.toHaveBeenCalled();

    const { data } = await supabase.from('comercios').select('google_class_id').eq('id', id).single();
    expect(data?.google_class_id).toBe('issuer-test.comercio_' + id);
  });

  it('ya tiene google_class_id: actualiza (patch), nunca vuelve a insertar', async () => {
    const idExistente = 'issuer-test.comercio_ya-existe';
    const id = await crearComercio({ google_class_id: idExistente });
    const res = await syncClaseComercio(supabase, id);
    expect(res.ok).toBe(true);
    expect(patchMock).toHaveBeenCalledOnce();
    expect(patchMock).toHaveBeenCalledWith(expect.objectContaining({ resourceId: idExistente }));
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('con foto: la clase apunta a la portada COMPUESTA con versión, no a la foto cruda', async () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site';
    const id = await crearComercio({ google_class_id: null, hero_url: 'https://ejemplo.com/hero.jpg' });
    await syncClaseComercio(supabase, id);
    const uri = insertMock.mock.calls[0][0].requestBody.heroImage.sourceUri.uri;
    expect(uri).toMatch(new RegExp(`^https://www\\.cardly-sv\\.site/api/comercios/${id}/franja\\.png\\?v=[0-9a-f]{12}$`));
  });

  it('cambiar el encuadre cambia la versión de la portada (Google la re-descarga)', async () => {
    // MUTACIÓN: hashear sin el encuadre deja la URL igual y Google sirve la portada vieja para siempre.
    process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site';
    const id = await crearComercio({ google_class_id: 'clase-existente', hero_url: 'https://ejemplo.com/hero.jpg' });
    await syncClaseComercio(supabase, id);
    await supabase.from('comercios').update({ foco_franja_y: 0 }).eq('id', id);
    await syncClaseComercio(supabase, id);
    const [a, b] = patchMock.mock.calls.map((c) => c[0].requestBody.heroImage.sourceUri.uri);
    expect(a).not.toBe(b);
  });

  // Los logos de la clase (spec 2026-09-23): el cuadrado compuesto para el círculo de Google y, según
  // las medidas, el ancho. El sync hace `patch`, y en un patch un campo omitido conserva su valor VIEJO.
  //
  // MUTACIÓN corrida el 2026-09-23 (restaurada y comparada con el índice de git): mandar el logo CRUDO,
  // `logos: { programLogo: comercio.logo_url }` → FALLAN "con base pública: programLogo apunta al logo
  // COMPUESTO…" (`expected 'https://ejemplo.com/logo.png' to match …`), "logo medido y NO ancho…"
  // (`expected false to be true`), "logo ancho (3:1)…" (`TypeError: Cannot read properties of undefined
  // (reading 'sourceUri')`) y la de la clase del comercio en linkGuardar.test.ts (4 en total). La del
  // null cae además con la mutación de construirRecursos.test.ts y con la (a) de logosClase.test.ts.
  describe('logos', () => {
    const ID_EXISTENTE = 'issuer-test.comercio_ya-existe';

    it('con base pública: programLogo apunta al logo COMPUESTO con versión, no al logo crudo', async () => {
      process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site';
      const id = await crearComercio({ google_class_id: null });
      await syncClaseComercio(supabase, id);
      const uri = insertMock.mock.calls[0][0].requestBody.programLogo.sourceUri.uri;
      expect(uri).toMatch(new RegExp(`^https://www\\.cardly-sv\\.site/api/comercios/${id}/logo\\.png\\?v=[0-9a-f]{12}$`));
      // Mide el logo del COMERCIO (el crudo, del bucket).
      expect(medidasLogoMock).toHaveBeenCalledWith('https://ejemplo.com/logo.png');
    });

    // El comercio que cambia su logo ancho por uno cuadrado: sin el null en el cuerpo del PATCH, el
    // ancho viejo se quedaría en cada Android.
    it('logo medido y NO ancho: el requestBody del patch lleva wideProgramLogo === null', async () => {
      process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site';
      medidasLogoMock.mockResolvedValue({ ancho: 300, alto: 300 });
      const id = await crearComercio({ google_class_id: ID_EXISTENTE });
      await syncClaseComercio(supabase, id);
      const cuerpo = patchMock.mock.calls[0][0].requestBody;
      expect('wideProgramLogo' in cuerpo).toBe(true);
      expect(cuerpo.wideProgramLogo).toBeNull();
    });

    it('logo ancho (3:1): el patch lleva wideProgramLogo con la ruta del logo ancho', async () => {
      process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site';
      medidasLogoMock.mockResolvedValue({ ancho: 480, alto: 160 });
      const id = await crearComercio({ google_class_id: ID_EXISTENTE });
      await syncClaseComercio(supabase, id);
      expect(patchMock.mock.calls[0][0].requestBody.wideProgramLogo.sourceUri.uri).toMatch(
        new RegExp(`^https://www\\.cardly-sv\\.site/api/comercios/${id}/logo-ancho\\.png\\?v=[0-9a-f]{12}$`),
      );
    });

    it('medición fallida: el patch NO lleva la clave (no agrega ni quita el logo ancho)', async () => {
      process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site';
      const id = await crearComercio({ google_class_id: ID_EXISTENTE });
      await syncClaseComercio(supabase, id);
      expect('wideProgramLogo' in patchMock.mock.calls[0][0].requestBody).toBe(false);
    });

    // El dev server: con una imagen a localhost Google rechaza el patch ENTERO.
    it('con la base de desarrollo: el logo crudo, sin medir y sin logo ancho', async () => {
      process.env.NEXT_PUBLIC_BASE_URL = 'http://localhost:3000';
      const id = await crearComercio({ google_class_id: ID_EXISTENTE, hero_url: 'https://ejemplo.com/hero.jpg' });
      await syncClaseComercio(supabase, id);
      const cuerpo = patchMock.mock.calls[0][0].requestBody;
      expect(cuerpo.programLogo.sourceUri.uri).toBe('https://ejemplo.com/logo.png');
      expect('wideProgramLogo' in cuerpo).toBe(false);
      // Y la portada tampoco apunta a localhost: la foto cruda.
      expect(cuerpo.heroImage.sourceUri.uri).toBe('https://ejemplo.com/hero.jpg');
      expect(medidasLogoMock).not.toHaveBeenCalled();
    });
  });

  it('sin foto: la clase sale sin heroImage, como siempre', async () => {
    const id = await crearComercio({ google_class_id: null, hero_url: null });
    await syncClaseComercio(supabase, id);
    expect(insertMock.mock.calls[0][0].requestBody.heroImage).toBeUndefined();
  });

  it('si Google Wallet falla, no revienta y deja un resultado ok:false (best-effort)', async () => {
    insertMock.mockRejectedValueOnce(new Error('Google caído'));
    const id = await crearComercio({ google_class_id: null });
    const res = await syncClaseComercio(supabase, id);
    expect(res.ok).toBe(false);

    const { data } = await supabase.from('comercios').select('google_class_id').eq('id', id).single();
    expect(data?.google_class_id).toBeNull();
  });
});

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

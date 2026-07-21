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

async function crearComercio(datos: Partial<{ logo_url: string | null; google_class_id: string | null; nombre: string; color_fondo: string }>) {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase
    .from('comercios')
    .insert({
      nombre: datos.nombre ?? 'Comercio Google Test',
      slug: `test-google-clase-${sufijo}`,
      logo_url: datos.logo_url === undefined ? 'https://ejemplo.com/logo.png' : datos.logo_url,
      google_class_id: datos.google_class_id ?? null,
      color_fondo: datos.color_fondo ?? 'rgb(10, 20, 30)',
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

  it('si Google Wallet falla, no revienta y deja un resultado ok:false (best-effort)', async () => {
    insertMock.mockRejectedValueOnce(new Error('Google caído'));
    const id = await crearComercio({ google_class_id: null });
    const res = await syncClaseComercio(supabase, id);
    expect(res.ok).toBe(false);

    const { data } = await supabase.from('comercios').select('google_class_id').eq('id', id).single();
    expect(data?.google_class_id).toBeNull();
  });
});

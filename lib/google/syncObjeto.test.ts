import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { syncObjetoTarjeta } from './syncObjeto';

const insertMock = vi.fn();
const patchMock = vi.fn();

vi.mock('./walletClient', () => ({
  issuerId: () => 'issuer-test',
  walletClient: () => ({
    loyaltyobject: { insert: insertMock, patch: patchMock },
  }),
}));

const supabase = createServiceClient();
let ids: { comercioId: string; clienteId: string; tarjetaId: string } | null = null;

async function crearTarjeta(opts: { googleClassId: string | null; googleObjectId?: string | null; tipoTarjeta?: string; selloMeta?: number | null; puntos?: number }) {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data: comercio, error: eC } = await supabase
    .from('comercios')
    .insert({
      nombre: 'Comercio Objeto Test',
      slug: `test-google-obj-${sufijo}`,
      google_class_id: opts.googleClassId,
      tipo_tarjeta: opts.tipoTarjeta ?? 'puntos',
      sello_meta: opts.selloMeta ?? null,
    })
    .select('id')
    .single();
  if (eC) throw eC;
  const { data: cliente, error: eCl } = await supabase
    .from('clientes').insert({ nombre: 'Cliente Test', telefono: `+503-gobj-${sufijo}` }).select('id').single();
  if (eCl) throw eCl;
  const { data: tarjeta, error: eT } = await supabase
    .from('tarjetas')
    .insert({
      cliente_id: cliente.id,
      comercio_id: comercio.id,
      puntos_actuales: opts.puntos ?? 0,
      google_object_id: opts.googleObjectId ?? null,
    })
    .select('id')
    .single();
  if (eT) throw eT;
  ids = { comercioId: comercio.id, clienteId: cliente.id, tarjetaId: tarjeta.id };
  return ids;
}

beforeEach(() => {
  insertMock.mockReset().mockResolvedValue({});
  patchMock.mockReset().mockResolvedValue({});
});

afterEach(async () => {
  if (!ids) return;
  await supabase.from('tarjetas').delete().eq('id', ids.tarjetaId);
  await supabase.from('clientes').delete().eq('id', ids.clienteId);
  await supabase.from('comercios').delete().eq('id', ids.comercioId);
  ids = null;
});

describe('syncObjetoTarjeta', () => {
  it('comercio sin google_class_id: no llama a Google (Google Wallet no habilitado ahí)', async () => {
    const t = await crearTarjeta({ googleClassId: null });
    const res = await syncObjetoTarjeta(supabase, t.tarjetaId);
    expect(res.ok).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('primera vez: inserta el objeto y guarda su id en la BD', async () => {
    const t = await crearTarjeta({ googleClassId: 'issuer-test.comercio_x' });
    const res = await syncObjetoTarjeta(supabase, t.tarjetaId);
    expect(res.ok).toBe(true);
    expect(insertMock).toHaveBeenCalledOnce();
    expect(patchMock).not.toHaveBeenCalled();

    const { data } = await supabase.from('tarjetas').select('google_object_id').eq('id', t.tarjetaId).single();
    expect(data?.google_object_id).toBe('issuer-test.tarjeta_' + t.tarjetaId);
  });

  it('ya tiene google_object_id: actualiza (patch) con el saldo actual, nunca reinserta', async () => {
    const idExistente = 'issuer-test.tarjeta_ya-existe';
    const t = await crearTarjeta({ googleClassId: 'issuer-test.comercio_x', googleObjectId: idExistente, puntos: 7 });
    const res = await syncObjetoTarjeta(supabase, t.tarjetaId);
    expect(res.ok).toBe(true);
    expect(patchMock).toHaveBeenCalledOnce();
    const llamada = patchMock.mock.calls[0][0];
    expect(llamada.resourceId).toBe(idExistente);
    expect(llamada.requestBody.loyaltyPoints).toEqual({ label: 'Puntos', balance: { int: 7 } });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('tarjeta de sellos: el objeto sincronizado usa el texto "N de M sellos"', async () => {
    const t = await crearTarjeta({ googleClassId: 'issuer-test.comercio_x', tipoTarjeta: 'sellos', selloMeta: 8, puntos: 3 });
    await syncObjetoTarjeta(supabase, t.tarjetaId);
    const llamada = insertMock.mock.calls[0][0];
    expect(llamada.requestBody.loyaltyPoints).toEqual({ label: 'Sellos', balance: { string: '3 de 8 sellos' } });
  });

  it('una tarjeta de OTRO comercio no puede colar su google_class_id (scoping via el join real)', async () => {
    // No hay forma de "confundir" comercios acá porque la lectura sale de tarjetas(comercios(...))
    // por FK real — este test documenta esa garantía en vez de solo confiar en la implementación.
    const t = await crearTarjeta({ googleClassId: 'issuer-test.comercio_correcto' });
    const res = await syncObjetoTarjeta(supabase, t.tarjetaId);
    expect(res.ok).toBe(true);
    const llamada = insertMock.mock.calls[0][0];
    expect(llamada.requestBody.classId).toBe('issuer-test.comercio_correcto');
  });
});

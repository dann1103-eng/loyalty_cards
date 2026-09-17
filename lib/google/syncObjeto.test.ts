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
let ids: { comercioId: string; programaId: string; clienteId: string; tarjetaId: string } | null = null;

async function crearTarjeta(opts: {
  googleClassId: string | null;
  googleObjectId?: string | null;
  tipoTarjeta?: string;
  selloMeta?: number | null;
  puntos?: number;
  nombreCliente?: string;
  apellidoCliente?: string | null;
  nombrePase?: string | null;
  stripUrl?: string | null;
}) {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data: comercio, error: eC } = await supabase
    .from('comercios')
    .insert({
      nombre: 'Comercio Objeto Test',
      slug: `test-google-obj-${sufijo}`,
      google_class_id: opts.googleClassId,
      tipo_tarjeta: opts.tipoTarjeta ?? 'puntos',
      sello_meta: opts.selloMeta ?? null,
      strip_url: opts.stripUrl ?? null,
    })
    .select('id, nombre, tipo_tarjeta, sello_meta, cashback_porcentaje, multipass_visitas, membresia_dias, cupon_vigencia_dias')
    .single();
  if (eC) throw eC;
  const { data: programa, error: eP } = await supabase
    .from('programas_tarjeta')
    .insert({
      comercio_id: comercio.id,
      nombre: comercio.nombre,
      slug: 'principal',
      tipo_tarjeta: comercio.tipo_tarjeta,
      es_principal: true,
      sello_meta: comercio.sello_meta,
      cashback_porcentaje: comercio.cashback_porcentaje,
      multipass_visitas: comercio.multipass_visitas,
      membresia_dias: comercio.membresia_dias,
      cupon_vigencia_dias: comercio.cupon_vigencia_dias,
      nombre_pase: opts.nombrePase ?? null,
    })
    .select('id')
    .single();
  if (eP) throw eP;
  const { data: cliente, error: eCl } = await supabase
    .from('clientes')
    .insert({
      nombre: opts.nombreCliente ?? 'Cliente Test',
      apellido: opts.apellidoCliente ?? null,
      telefono: `+503-gobj-${sufijo}`,
    })
    .select('id')
    .single();
  if (eCl) throw eCl;
  const { data: tarjeta, error: eT } = await supabase
    .from('tarjetas')
    .insert({
      cliente_id: cliente.id,
      comercio_id: comercio.id,
      programa_id: programa.id,
      puntos_actuales: opts.puntos ?? 0,
      google_object_id: opts.googleObjectId ?? null,
    })
    .select('id')
    .single();
  if (eT) throw eT;
  ids = { comercioId: comercio.id, programaId: programa.id, clienteId: cliente.id, tarjetaId: tarjeta.id };
  return ids;
}

beforeEach(() => {
  insertMock.mockReset().mockResolvedValue({});
  patchMock.mockReset().mockResolvedValue({});
});

// NEXT_PUBLIC_BASE_URL lo fijan las pruebas del hero (viaja dentro de la URL): se restaura para no
// filtrarlo al resto de la suite.
const BASE_ORIGINAL = process.env.NEXT_PUBLIC_BASE_URL;

afterEach(async () => {
  if (BASE_ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
  else process.env.NEXT_PUBLIC_BASE_URL = BASE_ORIGINAL;
  if (!ids) return;
  await supabase.from('tarjetas').delete().eq('id', ids.tarjetaId);
  await supabase.from('clientes').delete().eq('id', ids.clienteId);
  await supabase.from('programas_tarjeta').delete().eq('id', ids.programaId);
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

  it('tarjeta de sellos: incluye heroImage apuntando a /api/tarjetas/<id>/hero.png (grilla por cliente)', async () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site';
    const t = await crearTarjeta({ googleClassId: 'issuer-test.comercio_x', tipoTarjeta: 'sellos', selloMeta: 8, puntos: 3 });
    await syncObjetoTarjeta(supabase, t.tarjetaId);
    const llamada = insertMock.mock.calls[0][0];
    expect(llamada.requestBody.heroImage.sourceUri.uri).toContain(`/api/tarjetas/${t.tarjetaId}/hero.png`);
  });

  // INVERTIDA a propósito (spec 2026-09-17, decisión 8). Antes afirmaba que puntos NUNCA llevaba hero
  // propio: los diseños de los tipos que no son sellos no existían en Android.
  it('tarjeta de puntos: TAMBIÉN incluye heroImage apuntando a /api/tarjetas/<id>/hero.png (su banda o su franja)', async () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site';
    const t = await crearTarjeta({ googleClassId: 'issuer-test.comercio_x', tipoTarjeta: 'puntos', puntos: 40 });
    await syncObjetoTarjeta(supabase, t.tarjetaId);
    const llamada = insertMock.mock.calls[0][0];
    expect(llamada.requestBody.heroImage.sourceUri.uri).toMatch(
      new RegExp(`^https://www\\.cardly-sv\\.site/api/tarjetas/${t.tarjetaId}/hero\\.png\\?v=[0-9a-f]{12}$`),
    );
  });

  // Fuera de la grilla la imagen no cambia al operar: con los puntos en el `?v=`, Google volvería a
  // bajar la misma banda (o una franja propia de hasta 2 MB) en cada compra.
  // MUTACIÓN corrida: en syncObjeto.ts, `versionHero({ ...marca, puntos: tarjeta.puntos_actuales,
  // selloMeta })` en vez de versionHeroTarjeta → FALLA con `expected 'https://www.cardly-sv.site/
  // api/tarjet…' to be 'https://www.cardly-sv.site/api/tarjet…'` (el `?v=` rotó con el saldo).
  it('tarjeta de puntos: acreditar NO cambia el ?v= del hero (versionHeroTarjeta)', async () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site';
    const t = await crearTarjeta({ googleClassId: 'issuer-test.comercio_x', tipoTarjeta: 'puntos', puntos: 40 });
    await syncObjetoTarjeta(supabase, t.tarjetaId);
    await supabase.from('tarjetas').update({ puntos_actuales: 55 }).eq('id', t.tarjetaId);
    await syncObjetoTarjeta(supabase, t.tarjetaId);

    const antes = insertMock.mock.calls[0][0].requestBody.heroImage.sourceUri.uri;
    // La segunda vuelta ya tiene google_object_id: es un patch, con el saldo nuevo.
    const despues = patchMock.mock.calls[0][0].requestBody;
    expect(despues.loyaltyPoints).toEqual({ label: 'Puntos', balance: { int: 55 } });
    expect(despues.heroImage.sourceUri.uri).toBe(antes);
  });

  // El frente de los diseños (spec 2026-09-17): NOMBRE y APELLIDO salen de `clientes`, que este
  // select no traía. MUTACIÓN corrida: `apellidoCliente: null` en syncObjeto.ts → FALLA con
  // `expected [ { id: 'nombre_pase', …(2) }, …(2) ] to deeply equal [ { id: 'nombre_pase', …(2) },
  // …(3) ]` (falta el módulo APELLIDO).
  it('el cuerpo mandado lleva los módulos del frente (nombre del pase, estado, NOMBRE, APELLIDO) y el pie del QR', async () => {
    const t = await crearTarjeta({
      googleClassId: 'issuer-test.comercio_x',
      googleObjectId: `issuer-test.tarjeta_con-frente-${Date.now()}`,
      tipoTarjeta: 'puntos',
      puntos: 7,
      nombreCliente: 'María',
      apellidoCliente: 'Rivera',
      nombrePase: 'Club Puntos',
    });
    await syncObjetoTarjeta(supabase, t.tarjetaId);
    const cuerpo = patchMock.mock.calls[0][0].requestBody;
    expect(cuerpo.textModulesData).toEqual([
      { id: 'nombre_pase', header: 'Tarjeta', body: 'Club Puntos' },
      { id: 'estado', header: 'PUNTOS', body: '7' },
      { id: 'nombre', header: 'NOMBRE', body: 'María' },
      { id: 'apellido', header: 'APELLIDO', body: 'Rivera' },
    ]);
    expect(cuerpo.barcode).toEqual({ type: 'QR_CODE', value: expect.any(String), alternateText: 'Powered by Cardly' });
  });

  // `stripUrl: marca.stripUrl` es lo que le dice a construirObjeto que la franja es PROPIA (la imagen
  // trae su texto). MUTACIÓN corrida: `stripUrl: null` en syncObjeto.ts → el objeto se cree banda y
  // FALLA con `expected [ { id: 'nombre_pase', …(2) }, …(2) ] to deeply equal [ { id: 'estado',
  // …(2) }, …(1) ]` (nombre del pase escrito encima de la franja del comercio).
  it('con franja propia del comercio y hero: NO manda el nombre del pase (la imagen ya trae su texto)', async () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site';
    const t = await crearTarjeta({
      googleClassId: 'issuer-test.comercio_x',
      tipoTarjeta: 'gift_card',
      puntos: 5000,
      nombreCliente: 'Ana',
      nombrePase: 'Gift Card Estudio',
      stripUrl: 'https://ejemplo.com/storage/franja.png',
    });
    await syncObjetoTarjeta(supabase, t.tarjetaId);
    const cuerpo = insertMock.mock.calls[0][0].requestBody;
    expect(cuerpo.textModulesData).toEqual([
      { id: 'estado', header: 'SALDO', body: '$50.00' },
      { id: 'nombre', header: 'NOMBRE', body: 'Ana' },
    ]);
    expect(cuerpo.heroImage.sourceUri.uri).toContain(`/api/tarjetas/${t.tarjetaId}/hero.png`);
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

  // Branding por programa (0027): si el programa tiene su propia LoyaltyClass, el objeto tiene que
  // colgar de ESA y no de la del comercio. Es lo que hace que el color propio se vea en Android —
  // Google guarda logo y colores en la CLASE, no en el objeto.
  it('si el programa tiene clase propia, el objeto cuelga de ESA clase', async () => {
    const t = await crearTarjeta({ googleClassId: 'issuer-test.comercio_base' });
    await supabase
      .from('programas_tarjeta')
      .update({
        branding_propio: true,
        color_fondo: 'rgb(255,0,0)',
        google_class_id: 'issuer-test.programa_propia',
      })
      .eq('id', t.programaId);

    const res = await syncObjetoTarjeta(supabase, t.tarjetaId);

    expect(res.ok).toBe(true);
    expect(insertMock.mock.calls[0][0].requestBody.classId).toBe('issuer-test.programa_propia');
  });

  it('sin clase propia del programa, sigue colgando de la del comercio', async () => {
    // El camino de la enorme mayoría de los programas: no se creó ninguna clase y todo hereda.
    const t = await crearTarjeta({ googleClassId: 'issuer-test.comercio_base' });

    await syncObjetoTarjeta(supabase, t.tarjetaId);

    expect(insertMock.mock.calls[0][0].requestBody.classId).toBe('issuer-test.comercio_base');
  });

  it('la guarda de "Google Wallet habilitado" sigue colgando del COMERCIO, no del programa', async () => {
    // Sin google_class_id del COMERCIO no hay Google Wallet para nadie de ese negocio, tenga el
    // programa la clase que tenga. Si esta guarda mirara el programa, un comercio sin Wallet
    // habilitado empezaría a emitir objetos sueltos colgando de una clase de programa.
    const t = await crearTarjeta({ googleClassId: null });
    await supabase
      .from('programas_tarjeta')
      .update({ branding_propio: true, google_class_id: 'issuer-test.programa_propia' })
      .eq('id', t.programaId);

    const res = await syncObjetoTarjeta(supabase, t.tarjetaId);

    expect(res.ok).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });
});

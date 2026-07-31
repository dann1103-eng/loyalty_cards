import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { guardarBranding } from './guardarBranding';

const supabase = createServiceClient();
const idsDePrueba: string[] = [];

afterEach(async () => {
  if (!idsDePrueba.length) return;
  // programas_tarjeta ANTES que comercios: la FK no tiene cascada, y sin esto el borrado falla con
  // 23503 y deja comercios huérfanos en la base REAL — el incidente del 2026-07-30 documentado en
  // test/fixtures/entornoComercio.ts. Se borra por comercio_id, no por ids rastreados, para que
  // caiga también cualquier programa que una prueba haya creado por su cuenta.
  const { error: eProgramas } = await supabase
    .from('programas_tarjeta')
    .delete()
    .in('comercio_id', idsDePrueba);
  if (eProgramas) console.error('[test] no se pudieron borrar los programas de prueba:', eProgramas);
  const { error } = await supabase.from('comercios').delete().in('id', idsDePrueba);
  if (error) console.error('[test] no se pudieron borrar los comercios de prueba:', error);
  idsDePrueba.length = 0;
});

async function crearComercio(): Promise<string> {
  const slug = `test-branding-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase
    .from('comercios')
    .insert({ nombre: 'Comercio Branding', slug, tipo_tarjeta: 'sellos' })
    .select('id')
    .single();
  if (error) throw error;
  idsDePrueba.push(data.id);
  return data.id;
}

describe('guardarBranding', () => {
  it('guarda colores y sello_meta de un comercio existente', async () => {
    const id = await crearComercio();
    const res = await guardarBranding(supabase, id, {
      color_fondo: 'rgb(10, 20, 30)',
      color_texto: 'rgb(255, 255, 255)',
      color_label: 'rgb(200, 200, 200)',
      sello_meta: 10,
      difuminado_franja: 'fuerte',
    });

    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('comercios')
      .select('color_fondo, sello_meta, difuminado_franja')
      .eq('id', id)
      .single();
    expect(data!.color_fondo).toBe('rgb(10, 20, 30)');
    expect(data!.sello_meta).toBe(10);
    expect(data!.difuminado_franja).toBe('fuerte');
  });

  it('rechaza un color con formato inválido', async () => {
    const id = await crearComercio();
    const res = await guardarBranding(supabase, id, {
      color_fondo: '#231812',
      color_texto: 'rgb(255, 255, 255)',
      color_label: 'rgb(255, 255, 255)',
      sello_meta: null,
      difuminado_franja: 'medio',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/color/i);
  });

  it('rechaza un sello_meta menor o igual a cero', async () => {
    const id = await crearComercio();
    const res = await guardarBranding(supabase, id, {
      color_fondo: 'rgb(10, 20, 30)',
      color_texto: 'rgb(255, 255, 255)',
      color_label: 'rgb(255, 255, 255)',
      sello_meta: 0,
      difuminado_franja: 'medio',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/meta|sellos/i);
  });

  it('rechaza un nivel de difuminado que no es uno de los 4 válidos', async () => {
    const id = await crearComercio();
    const res = await guardarBranding(supabase, id, {
      color_fondo: 'rgb(10, 20, 30)',
      color_texto: 'rgb(255, 255, 255)',
      color_label: 'rgb(255, 255, 255)',
      sello_meta: null,
      difuminado_franja: 'extremo',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/difuminado/i);
  });

  // REGRESIÓN del 2026-07-30, y de las peores: silenciosa. Ese día el pase pasó a leer
  // programas_tarjeta.sello_meta (correcto, la 0024 mudó la config al programa), pero este
  // formulario —el ÚNICO lugar donde el dueño puede tocar la meta— seguía escribiendo solo la
  // columna legada de comercios. Efecto: cambiar la meta de sellos no tenía NINGÚN efecto sobre la
  // tarjeta del cliente; quedaba congelada en el valor del backfill. Sin error, sin aviso.
  it('la meta de sellos también se guarda en el programa principal, que es de donde la lee el pase', async () => {
    const comercioId = await crearComercio();
    const { data: programa, error: eP } = await supabase
      .from('programas_tarjeta')
      .insert({
        comercio_id: comercioId,
        nombre: 'Principal',
        slug: 'principal',
        tipo_tarjeta: 'sellos',
        es_principal: true,
        sello_meta: 5,
      })
      .select('id')
      .single();
    if (eP) throw eP;

    const res = await guardarBranding(supabase, comercioId, {
      color_fondo: 'rgb(10, 20, 30)',
      color_texto: 'rgb(255, 255, 255)',
      color_label: 'rgb(255, 255, 255)',
      sello_meta: 12,
      difuminado_franja: 'medio',
    });

    expect(res.ok).toBe(true);
    const { data: fila } = await supabase
      .from('programas_tarjeta')
      .select('sello_meta')
      .eq('id', programa.id)
      .single();
    expect(fila!.sello_meta, 'el programa principal tiene que quedar con la meta nueva').toBe(12);
  });

  it('falla si el comercio ya no existe, en vez de reportar éxito', async () => {
    // Sin el .select('id').single(), un update de 0 filas devolvería ok:true habiendo escrito cero.
    const res = await guardarBranding(supabase, '00000000-0000-0000-0000-000000000000', {
      color_fondo: 'rgb(10, 20, 30)',
      color_texto: 'rgb(255, 255, 255)',
      color_label: 'rgb(255, 255, 255)',
      sello_meta: null,
      difuminado_franja: 'medio',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/no existe/i);
  });
});

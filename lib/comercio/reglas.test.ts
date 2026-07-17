import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearRegla, eliminarRegla } from './reglas';

const supabase = createServiceClient();
const comerciosDePrueba: string[] = [];

afterEach(async () => {
  if (!comerciosDePrueba.length) return;
  // reglas_puntos apunta a comercios sin cascade: borrar reglas antes que su comercio.
  await supabase.from('reglas_puntos').delete().in('comercio_id', comerciosDePrueba);
  const { error } = await supabase.from('comercios').delete().in('id', comerciosDePrueba);
  if (error) console.error('[test] no se pudieron borrar los comercios de prueba:', error);
  comerciosDePrueba.length = 0;
});

async function crearComercio(): Promise<string> {
  const slug = `test-reglas-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase.from('comercios').insert({ nombre: 'Reglas', slug }).select('id').single();
  if (error) throw error;
  comerciosDePrueba.push(data.id);
  return data.id;
}

describe('crearRegla', () => {
  it('crea una regla por_visita', async () => {
    const comercioId = await crearComercio();
    const res = await crearRegla(supabase, comercioId, { tipo: 'por_visita', valor: 1 });

    expect(res.ok).toBe(true);
    const { data } = await supabase.from('reglas_puntos').select('tipo, valor').eq('comercio_id', comercioId).single();
    expect(data!.tipo).toBe('por_visita');
    expect(data!.valor).toBe(1);
  });

  it('rechaza un tipo que la BD no acepta', async () => {
    const comercioId = await crearComercio();
    const res = await crearRegla(supabase, comercioId, { tipo: 'por_lo_que_sea', valor: 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/tipo/i);
  });

  it('rechaza un valor no positivo', async () => {
    const comercioId = await crearComercio();
    const res = await crearRegla(supabase, comercioId, { tipo: 'por_monto', valor: 0 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/valor/i);
  });
});

describe('eliminarRegla', () => {
  it('elimina una regla del comercio', async () => {
    const comercioId = await crearComercio();
    const creada = await crearRegla(supabase, comercioId, { tipo: 'por_visita', valor: 1 });
    if (!creada.ok) throw new Error('el setup falló');

    const res = await eliminarRegla(supabase, creada.id, comercioId);
    expect(res.ok).toBe(true);
    const { data } = await supabase.from('reglas_puntos').select('id').eq('id', creada.id).maybeSingle();
    expect(data).toBeNull();
  });

  it('no elimina una regla de OTRO comercio', async () => {
    // El .eq('comercio_id', comercioId) evita que un dueño borre reglas ajenas manipulando el id.
    const comercioA = await crearComercio();
    const comercioB = await crearComercio();
    const creada = await crearRegla(supabase, comercioA, { tipo: 'por_visita', valor: 1 });
    if (!creada.ok) throw new Error('el setup falló');

    const res = await eliminarRegla(supabase, creada.id, comercioB);
    expect(res.ok).toBe(false);

    const { data } = await supabase.from('reglas_puntos').select('id').eq('id', creada.id).maybeSingle();
    expect(data).not.toBeNull(); // sigue existiendo: no era de comercioB
  });
});

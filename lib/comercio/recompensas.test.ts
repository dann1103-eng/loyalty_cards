import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearRecompensa, desactivarRecompensa } from './recompensas';

const supabase = createServiceClient();
const comerciosDePrueba: string[] = [];

afterEach(async () => {
  if (!comerciosDePrueba.length) return;
  // recompensas apunta a comercios sin cascade: borrar recompensas antes que su comercio.
  await supabase.from('recompensas').delete().in('comercio_id', comerciosDePrueba);
  const { error } = await supabase.from('comercios').delete().in('id', comerciosDePrueba);
  if (error) console.error('[test] no se pudieron borrar los comercios de prueba:', error);
  comerciosDePrueba.length = 0;
});

async function crearComercio(): Promise<string> {
  const slug = `test-recomp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase.from('comercios').insert({ nombre: 'Recomp', slug }).select('id').single();
  if (error) throw error;
  comerciosDePrueba.push(data.id);
  return data.id;
}

function datosValidos() {
  return { nombre: 'Café gratis', descripcion: 'Un café de la casa', costo_puntos: 100, tipo: 'articulo_gratis', valor: null as string | null };
}

describe('crearRecompensa', () => {
  it('crea una recompensa', async () => {
    const comercioId = await crearComercio();
    const res = await crearRecompensa(supabase, comercioId, datosValidos());

    expect(res.ok).toBe(true);
    const { data } = await supabase.from('recompensas').select('nombre, activa').eq('comercio_id', comercioId).single();
    expect(data!.nombre).toBe('Café gratis');
    expect(data!.activa).toBe(true);
  });

  it('rechaza un tipo inválido', async () => {
    const comercioId = await crearComercio();
    const res = await crearRecompensa(supabase, comercioId, { ...datosValidos(), tipo: 'inventado' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/tipo/i);
  });

  it('rechaza un costo_puntos no positivo', async () => {
    const comercioId = await crearComercio();
    const res = await crearRecompensa(supabase, comercioId, { ...datosValidos(), costo_puntos: 0 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/costo|puntos/i);
  });
});

describe('desactivarRecompensa', () => {
  it('desactiva con SOFT-DELETE: la fila SIGUE existiendo con activa=false', async () => {
    // ESTE es el test linchpin. Si alguien implementa desactivar con .delete() en vez de
    // update({activa:false}), este test falla: data sería null. El historial de canjes.recompensa_id
    // depende de que la fila NO desaparezca.
    const comercioId = await crearComercio();
    const creada = await crearRecompensa(supabase, comercioId, datosValidos());
    if (!creada.ok) throw new Error('el setup falló');

    const res = await desactivarRecompensa(supabase, creada.id, comercioId);
    expect(res.ok).toBe(true);

    const { data } = await supabase.from('recompensas').select('activa').eq('id', creada.id).maybeSingle();
    expect(data).not.toBeNull();      // NO se borró la fila
    expect(data!.activa).toBe(false); // se marcó inactiva
  });

  it('no desactiva una recompensa de OTRO comercio', async () => {
    const comercioA = await crearComercio();
    const comercioB = await crearComercio();
    const creada = await crearRecompensa(supabase, comercioA, datosValidos());
    if (!creada.ok) throw new Error('el setup falló');

    const res = await desactivarRecompensa(supabase, creada.id, comercioB);
    expect(res.ok).toBe(false);

    const { data } = await supabase.from('recompensas').select('activa').eq('id', creada.id).maybeSingle();
    expect(data!.activa).toBe(true); // intacta: no era de comercioB
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearRecompensa, desactivarRecompensa, recompensaActivaMasBarata } from './recompensas';

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

// La recompensa más barata que lee Marca para avisar cuando el regalo de bienvenida ya alcanza un
// premio. Se prueba contra la base real porque lo que puede fallar vive en la CONSULTA (el orden, el
// filtro de activas, el de comercio), no en el mapeo. Las recompensas se cargan por crearRecompensa y
// se desactivan por desactivarRecompensa, los caminos de producción.
//
// MUTACIONES CONFIRMADAS (2026-10-28), cada una corrida contra la base real y restaurada después:
//   - orden descendente (`ascending: false`): falla "devuelve la de menor costo" (`expected { Object
//     (nombre, costoPuntos) } to deeply equal { nombre: 'Café', costoPuntos: 50 }`).
//   - sin `.eq('activa', true)`: fallan "ignora las desactivadas" (`Café` en vez de `Postre`) y "con
//     todas desactivadas" (`expected { nombre: 'Café', costoPuntos: 50 } to be null`).
//   - sin `.eq('comercio_id', comercioId)`: fallan 6 de 6 (devuelve la recompensa de otro comercio de
//     la base compartida, p. ej. `Arreglo de barba`).
//   - sin el desempate por nombre: falla "con dos al mismo costo" (`Zumo` en vez de `Agua`).
//   - sin `.limit(1)`: fallan "devuelve la de menor costo" y "con dos al mismo costo" (`maybeSingle`
//     con varias filas da error y la función devuelve `null`).
//   - `costoPuntos: 0` fijo en el mapeo: fallan 4 (`costoPuntos: +0` en vez de 50 / 80).
describe('recompensaActivaMasBarata', () => {
  async function cargar(comercioId: string, nombre: string, costo: number): Promise<string> {
    const res = await crearRecompensa(supabase, comercioId, { ...datosValidos(), nombre, costo_puntos: costo });
    if (!res.ok) throw new Error('el setup falló: ' + res.error);
    return res.id;
  }

  it('sin recompensas → null', async () => {
    const comercioId = await crearComercio();
    expect(await recompensaActivaMasBarata(supabase, comercioId)).toBeNull();
  });

  it('devuelve la de menor costo aunque no sea la primera ni la última que se creó', async () => {
    const comercioId = await crearComercio();
    await cargar(comercioId, 'Almuerzo', 100);
    await cargar(comercioId, 'Café', 50);
    await cargar(comercioId, 'Postre', 80);

    expect(await recompensaActivaMasBarata(supabase, comercioId)).toEqual({ nombre: 'Café', costoPuntos: 50 });
  });

  it('ignora las desactivadas: si la más barata se desactivó, la siguiente toma su lugar', async () => {
    const comercioId = await crearComercio();
    const barata = await cargar(comercioId, 'Café', 50);
    await cargar(comercioId, 'Postre', 80);
    expect((await desactivarRecompensa(supabase, barata, comercioId)).ok).toBe(true);

    expect(await recompensaActivaMasBarata(supabase, comercioId)).toEqual({ nombre: 'Postre', costoPuntos: 80 });
  });

  it('con todas desactivadas → null', async () => {
    const comercioId = await crearComercio();
    const unica = await cargar(comercioId, 'Café', 50);
    expect((await desactivarRecompensa(supabase, unica, comercioId)).ok).toBe(true);

    expect(await recompensaActivaMasBarata(supabase, comercioId)).toBeNull();
  });

  it('no mira las recompensas de OTRO comercio, aunque sean más baratas', async () => {
    const comercioA = await crearComercio();
    const comercioB = await crearComercio();
    await cargar(comercioA, 'Postre', 80);
    await cargar(comercioB, 'Ajena', 1);

    expect(await recompensaActivaMasBarata(supabase, comercioA)).toEqual({ nombre: 'Postre', costoPuntos: 80 });
    expect(await recompensaActivaMasBarata(supabase, comercioB)).toEqual({ nombre: 'Ajena', costoPuntos: 1 });
  });

  it('con dos al mismo costo desempata por nombre: el aviso dice siempre el mismo premio', async () => {
    const comercioId = await crearComercio();
    // La que alfabéticamente va segunda se crea PRIMERA: sin el desempate saldría en orden de creación.
    await cargar(comercioId, 'Zumo', 50);
    await cargar(comercioId, 'Agua', 50);

    expect(await recompensaActivaMasBarata(supabase, comercioId)).toEqual({ nombre: 'Agua', costoPuntos: 50 });
  });
});

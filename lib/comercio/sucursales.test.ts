import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import {
  crearSucursal,
  renombrarSucursal,
  cambiarEstadoSucursal,
  listarSucursales,
  sucursalPerteneceAComercio,
} from './sucursales';

const supabase = createServiceClient();
const comerciosDePrueba: string[] = [];

afterEach(async () => {
  if (!comerciosDePrueba.length) return;
  // sucursales apunta a comercios sin cascade: borrar sucursales antes que su comercio (orden FK).
  await supabase.from('sucursales').delete().in('comercio_id', comerciosDePrueba);
  const { error } = await supabase.from('comercios').delete().in('id', comerciosDePrueba);
  if (error) console.error('[test] no se pudieron borrar los comercios de prueba:', error);
  comerciosDePrueba.length = 0;
});

async function crearComercio(): Promise<string> {
  // comercios.cuenta_id es nullable (0008): insertamos directo, sin crear cuenta para el fixture.
  const slug = `test-suc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase.from('comercios').insert({ nombre: 'Suc', slug }).select('id').single();
  if (error) throw error;
  comerciosDePrueba.push(data.id);
  return data.id;
}

describe('crearSucursal', () => {
  it('crea una sucursal activa', async () => {
    const comercioId = await crearComercio();
    const res = await crearSucursal(supabase, comercioId, { nombre: 'Sucursal Centro' });

    expect(res.ok).toBe(true);
    const { data } = await supabase.from('sucursales').select('nombre, activa').eq('comercio_id', comercioId).single();
    expect(data!.nombre).toBe('Sucursal Centro');
    expect(data!.activa).toBe(true);
  });

  it('rechaza un nombre vacío', async () => {
    const comercioId = await crearComercio();
    const res = await crearSucursal(supabase, comercioId, { nombre: '   ' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/nombre/i);
  });
});

describe('renombrarSucursal', () => {
  it('renombra una sucursal propia', async () => {
    const comercioId = await crearComercio();
    const creada = await crearSucursal(supabase, comercioId, { nombre: 'Vieja' });
    if (!creada.ok) throw new Error('el setup falló');

    const res = await renombrarSucursal(supabase, creada.id, comercioId, { nombre: 'Nueva' });
    expect(res.ok).toBe(true);

    const { data } = await supabase.from('sucursales').select('nombre').eq('id', creada.id).single();
    expect(data!.nombre).toBe('Nueva');
  });

  it('rechaza un nombre vacío al renombrar', async () => {
    const comercioId = await crearComercio();
    const creada = await crearSucursal(supabase, comercioId, { nombre: 'Centro' });
    if (!creada.ok) throw new Error('el setup falló');

    const res = await renombrarSucursal(supabase, creada.id, comercioId, { nombre: '   ' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/nombre/i);
  });

  it('no renombra una sucursal de OTRO comercio', async () => {
    const comercioA = await crearComercio();
    const comercioB = await crearComercio();
    const creada = await crearSucursal(supabase, comercioA, { nombre: 'De A' });
    if (!creada.ok) throw new Error('el setup falló');

    const res = await renombrarSucursal(supabase, creada.id, comercioB, { nombre: 'Robada' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/ya no existe/i);

    const { data } = await supabase.from('sucursales').select('nombre').eq('id', creada.id).single();
    expect(data!.nombre).toBe('De A'); // intacta: no era de comercioB
  });
});

describe('cambiarEstadoSucursal', () => {
  it('desactiva con SOFT-DELETE: la fila SIGUE existiendo con activa=false', async () => {
    // Linchpin: cajeros/transacciones/canjes apuntan a sucursal_id (0008). Si alguien implementa
    // el "desactivar" con .delete() en vez de update({activa:false}), esas FKs quedan colgando.
    const comercioId = await crearComercio();
    const creada = await crearSucursal(supabase, comercioId, { nombre: 'Centro' });
    if (!creada.ok) throw new Error('el setup falló');

    const res = await cambiarEstadoSucursal(supabase, creada.id, comercioId, false);
    expect(res.ok).toBe(true);

    const { data } = await supabase.from('sucursales').select('activa').eq('id', creada.id).maybeSingle();
    expect(data).not.toBeNull();      // NO se borró la fila
    expect(data!.activa).toBe(false); // se marcó inactiva
  });

  it('reactiva una sucursal desactivada', async () => {
    const comercioId = await crearComercio();
    const creada = await crearSucursal(supabase, comercioId, { nombre: 'Centro' });
    if (!creada.ok) throw new Error('el setup falló');

    await cambiarEstadoSucursal(supabase, creada.id, comercioId, false);
    const res = await cambiarEstadoSucursal(supabase, creada.id, comercioId, true);
    expect(res.ok).toBe(true);

    const { data } = await supabase.from('sucursales').select('activa').eq('id', creada.id).single();
    expect(data!.activa).toBe(true);
  });

  it('no cambia el estado de una sucursal de OTRO comercio', async () => {
    const comercioA = await crearComercio();
    const comercioB = await crearComercio();
    const creada = await crearSucursal(supabase, comercioA, { nombre: 'De A' });
    if (!creada.ok) throw new Error('el setup falló');

    const res = await cambiarEstadoSucursal(supabase, creada.id, comercioB, false);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/ya no existe/i); // scoping da el mismo mensaje que renombrar

    const { data } = await supabase.from('sucursales').select('activa').eq('id', creada.id).single();
    expect(data!.activa).toBe(true); // intacta: no era de comercioB
  });
});

describe('listarSucursales', () => {
  it('devuelve solo las sucursales del comercio', async () => {
    const comercioA = await crearComercio();
    const comercioB = await crearComercio();
    await crearSucursal(supabase, comercioA, { nombre: 'A1' });
    await crearSucursal(supabase, comercioA, { nombre: 'A2' });
    await crearSucursal(supabase, comercioB, { nombre: 'B1' });

    const lista = await listarSucursales(supabase, comercioA);
    expect(lista).not.toBeNull(); // null = error de BD, distinto de [] = vacío
    expect(lista!.length).toBe(2);
    const nombres = lista!.map((s) => s.nombre).sort();
    expect(nombres).toEqual(['A1', 'A2']);
  });
});

describe('sucursalPerteneceAComercio', () => {
  it('true para una sucursal del comercio', async () => {
    const comercioId = await crearComercio();
    const creada = await crearSucursal(supabase, comercioId, { nombre: 'Propia' });
    if (!creada.ok) throw new Error('el setup falló');

    expect(await sucursalPerteneceAComercio(supabase, creada.id, comercioId)).toBe(true);
  });

  it('false para una sucursal ajena', async () => {
    // MUTATION-TESTING apunta a este caso: es el control de seguridad del picker del dueño y del
    // escáner. Si sucursalPerteneceAComercio pierde el .eq('comercio_id'), una sucursal ajena
    // pasaría como válida y este test debe FALLAR.
    const comercioA = await crearComercio();
    const comercioB = await crearComercio();
    const creada = await crearSucursal(supabase, comercioA, { nombre: 'De A' });
    if (!creada.ok) throw new Error('el setup falló');

    // sucursalId real, pero consultada con el comercio EQUIVOCADO → debe dar false.
    expect(await sucursalPerteneceAComercio(supabase, creada.id, comercioB)).toBe(false);
  });
});

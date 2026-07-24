import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import {
  verificarLimiteCuenta,
  crearCuenta,
  actualizarCuenta,
  asignarComercioACuenta,
  eliminarCuenta,
} from './cuentas';

const supabase = createServiceClient();
const cuentasDePrueba: string[] = [];
const comerciosDePrueba: string[] = [];

afterEach(async () => {
  // Orden FK: los comercios apuntan a cuentas_comercio vía cuenta_id, así que se borran ANTES
  // que las cuentas (borrar la cuenta primero daría un 23503).
  if (comerciosDePrueba.length) {
    const { error } = await supabase.from('comercios').delete().in('id', comerciosDePrueba);
    if (error) console.error('[test] no se pudieron borrar los comercios de prueba:', error);
    comerciosDePrueba.length = 0;
  }
  if (cuentasDePrueba.length) {
    const { error } = await supabase.from('cuentas_comercio').delete().in('id', cuentasDePrueba);
    if (error) console.error('[test] no se pudieron borrar las cuentas de prueba:', error);
    cuentasDePrueba.length = 0;
  }
});

async function crearCuentaFixture(limite: number): Promise<string> {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase
    .from('cuentas_comercio')
    .insert({ nombre: `Cuenta Test ${sufijo}`, limite_negocios: limite })
    .select('id')
    .single();
  if (error) throw error;
  cuentasDePrueba.push(data.id);
  return data.id;
}

async function crearComercioFixture(cuentaId: string): Promise<string> {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase
    .from('comercios')
    .insert({ nombre: 'Comercio Cuenta Test', slug: `test-cuenta-${sufijo}`, cuenta_id: cuentaId })
    .select('id')
    .single();
  if (error) throw error;
  comerciosDePrueba.push(data.id);
  return data.id;
}

describe('verificarLimiteCuenta', () => {
  it('permite crear cuando la cuenta no tiene comercios (0 < 2)', async () => {
    const cuentaId = await crearCuentaFixture(2);
    const res = await verificarLimiteCuenta(supabase, cuentaId);
    expect(res.ok).toBe(true);
  });

  it('permite crear cuando la cuenta tiene 1 comercio (1 < 2)', async () => {
    const cuentaId = await crearCuentaFixture(2);
    await crearComercioFixture(cuentaId);
    const res = await verificarLimiteCuenta(supabase, cuentaId);
    expect(res.ok).toBe(true);
  });

  it('bloquea cuando la cuenta ya alcanzó su límite (2 == 2) y el mensaje menciona el límite', async () => {
    // MUTATION A: cambiar `>=` por `>` en verificarLimiteCuenta hace que count(2) > limite(2) sea
    // false → devolvería {ok:true} y este expect(res.ok).toBe(false) FALLA.
    const cuentaId = await crearCuentaFixture(2);
    await crearComercioFixture(cuentaId);
    await crearComercioFixture(cuentaId);
    const res = await verificarLimiteCuenta(supabase, cuentaId);
    expect(res.ok).toBe(false);
    // El mensaje tiene que decir CUÁL es el límite, no solo "se alcanzó el límite": el número 2.
    if (!res.ok) expect(res.error).toContain('2');
  });

  it('excluye el comercio indicado del conteo (2 comercios, excluyendo 1 → cuenta 1 < 2)', async () => {
    const cuentaId = await crearCuentaFixture(2);
    await crearComercioFixture(cuentaId);
    const comercioId = await crearComercioFixture(cuentaId);
    const res = await verificarLimiteCuenta(supabase, cuentaId, { excluyendoComercioId: comercioId });
    expect(res.ok).toBe(true);
  });
});

describe('crearCuenta', () => {
  it('crea una cuenta y devuelve su id', async () => {
    const res = await crearCuenta(supabase, { nombre: 'Grupo Aurora', limiteNegocios: 3 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      cuentasDePrueba.push(res.id);
      const { data } = await supabase
        .from('cuentas_comercio')
        .select('nombre, limite_negocios')
        .eq('id', res.id)
        .single();
      expect(data!.nombre).toBe('Grupo Aurora');
      expect(data!.limite_negocios).toBe(3);
    }
  });

  it('rechaza un nombre vacío', async () => {
    const res = await crearCuenta(supabase, { nombre: '   ', limiteNegocios: 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/nombre/i);
  });

  it('rechaza un límite menor a 1', async () => {
    const res = await crearCuenta(supabase, { nombre: 'Grupo X', limiteNegocios: 0 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/l[íi]mite/i);
  });
});

describe('actualizarCuenta', () => {
  it('actualiza el nombre y el límite de una cuenta existente', async () => {
    const cuentaId = await crearCuentaFixture(1);
    const res = await actualizarCuenta(supabase, cuentaId, { nombre: 'Nombre Nuevo', limiteNegocios: 5 });
    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('cuentas_comercio')
      .select('nombre, limite_negocios')
      .eq('id', cuentaId)
      .single();
    expect(data!.nombre).toBe('Nombre Nuevo');
    expect(data!.limite_negocios).toBe(5);
  });

  it('falla si la cuenta ya no existe, en vez de reportar éxito', async () => {
    const res = await actualizarCuenta(
      supabase,
      '00000000-0000-0000-0000-000000000000',
      { nombre: 'Fantasma', limiteNegocios: 1 },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/no existe/i);
  });
});

describe('asignarComercioACuenta', () => {
  it('NO reasigna cuando la cuenta destino ya alcanzó su límite', async () => {
    // MUTATION B: quitar la llamada a verificarLimiteCuenta (asignar directo) hace que esto
    // reasigne igual → res.ok sería true y este expect(res.ok).toBe(false) FALLA.
    const cuentaOrigen = await crearCuentaFixture(2);
    const cuentaDestino = await crearCuentaFixture(2);
    await crearComercioFixture(cuentaDestino);
    await crearComercioFixture(cuentaDestino);
    const tercero = await crearComercioFixture(cuentaOrigen);

    const res = await asignarComercioACuenta(supabase, tercero, cuentaDestino);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('2');
    // Y el comercio NO quedó reasignado: sigue en la cuenta de origen.
    const { data } = await supabase.from('comercios').select('cuenta_id').eq('id', tercero).single();
    expect(data!.cuenta_id).toBe(cuentaOrigen);
  });

  it('reasigna cuando la cuenta destino tiene cupo', async () => {
    const cuentaOrigen = await crearCuentaFixture(1);
    const cuentaDestino = await crearCuentaFixture(2);
    const comercio = await crearComercioFixture(cuentaOrigen);

    const res = await asignarComercioACuenta(supabase, comercio, cuentaDestino);

    expect(res.ok).toBe(true);
    const { data } = await supabase.from('comercios').select('cuenta_id').eq('id', comercio).single();
    expect(data!.cuenta_id).toBe(cuentaDestino);
  });
});

describe('eliminarCuenta', () => {
  it('elimina una cuenta sin negocios', async () => {
    const cuentaId = await crearCuentaFixture(1);
    const res = await eliminarCuenta(supabase, cuentaId);
    expect(res.ok).toBe(true);
    const { data } = await supabase.from('cuentas_comercio').select('id').eq('id', cuentaId).maybeSingle();
    expect(data).toBeNull();
    // Ya no existe: sacarla del teardown para no intentar borrarla de nuevo.
    const i = cuentasDePrueba.indexOf(cuentaId);
    if (i >= 0) cuentasDePrueba.splice(i, 1);
  });

  it('rechaza eliminar una cuenta con negocios y NO la borra', async () => {
    const cuentaId = await crearCuentaFixture(2);
    await crearComercioFixture(cuentaId);

    const res = await eliminarCuenta(supabase, cuentaId);

    expect(res.ok).toBe(false);
    // El FK (23503) es la defensa real; el mensaje se ancla a "negocios asignados" para que el
    // genérico de respaldo ("No se pudo eliminar la cuenta.") no haga pasar esta prueba por error.
    if (!res.ok) expect(res.error).toMatch(/negocios asignados/i);

    // La cuenta SIGUE existiendo: borrarla habría dejado su comercio con un cuenta_id colgando.
    const { data } = await supabase.from('cuentas_comercio').select('id').eq('id', cuentaId).maybeSingle();
    expect(data).not.toBeNull();
  });
});

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
  // Orden FK: sucursales → comercios (vía cuenta_id) → cuentas_comercio.
  if (comerciosDePrueba.length) {
    await supabase.from('sucursales').delete().in('comercio_id', comerciosDePrueba);
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
    // MUTATION A: este test protege que una cuenta LLENA rechace un alta nueva. Lo atrapan las
    // mutaciones que desarman el chequeo entero (borrar el `if`, o poner `unidadesAAgregar` en 0:
    // 2 > 2 es false → devolvería {ok:true} y este expect(res.ok).toBe(false) FALLA).
    // OJO — ya NO atrapa la mutación de operador (`>` → `>=`): con la fórmula actual
    // `total + unidades > limite`, acá da 2+1=3, que bloquea con ambos operadores. Esa mutación la
    // atrapan los tres tests que quedan JUSTO en el borde (existente+1 == limite): 'permite crear
    // cuando la cuenta tiene 1 comercio', 'excluye el comercio indicado del conteo' y 'permite
    // cuando el combinado de comercios + sucursales no llega al límite'. Verificado a mano al
    // reescribir verificarLimiteCuenta (la fórmula vieja era `total >= limite`, y ahí el borde SÍ
    // caía en este test).
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

  it('cuenta sucursales JUNTO con comercios hacia el mismo límite', async () => {
    // MUTATION: si verificarLimiteCuenta deja de sumar sucursales (vuelve a contar solo
    // comercios), este test pasaría con ok:true indebidamente — 1 comercio + 1 sucursal ya
    // llenan un límite de 2, así que debe bloquear.
    const cuentaId = await crearCuentaFixture(2);
    const comercioId = await crearComercioFixture(cuentaId);
    const { error } = await supabase.from('sucursales').insert({ comercio_id: comercioId, nombre: 'Sucursal Test' });
    if (error) throw error;

    const res = await verificarLimiteCuenta(supabase, cuentaId);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('2');
  });

  it('permite cuando el combinado de comercios + sucursales no llega al límite', async () => {
    const cuentaId = await crearCuentaFixture(3);
    const comercioId = await crearComercioFixture(cuentaId);
    const { error } = await supabase.from('sucursales').insert({ comercio_id: comercioId, nombre: 'Sucursal Test' });
    if (error) throw error;

    // 1 comercio + 1 sucursal = 2 < 3.
    const res = await verificarLimiteCuenta(supabase, cuentaId);
    expect(res.ok).toBe(true);
  });

  it('una cuenta sin límite (null, plan Pro) siempre permite, sin importar cuántos comercios/sucursales tenga', async () => {
    // MUTATION: si se quita el corte temprano por limite_negocios===null, `total >= null` coacciona
    // null a 0 en JS y SIEMPRE bloquearía (hasta el primer comercio) — lo opuesto de "sin límite".
    const { data, error } = await supabase
      .from('cuentas_comercio').insert({ nombre: `Cuenta Sin Límite ${Date.now()}`, limite_negocios: null })
      .select('id').single();
    if (error) throw error;
    cuentasDePrueba.push(data.id);
    const comercioId = await crearComercioFixture(data.id);
    await supabase.from('sucursales').insert({ comercio_id: comercioId, nombre: 'Sucursal Test' });

    const res = await verificarLimiteCuenta(supabase, data.id);
    expect(res.ok).toBe(true);
  });
});

const CUENTA_BASE = {
  plan: 'starter',
  licenciaEstado: 'activo',
  licenciaMontoMensual: 29,
  licenciaActivaDesde: '2026-07-25',
};

describe('crearCuenta', () => {
  it('crea una cuenta y devuelve su id', async () => {
    const res = await crearCuenta(supabase, { nombre: 'Grupo Aurora', limiteNegocios: 3, ...CUENTA_BASE });
    expect(res.ok).toBe(true);
    if (res.ok) {
      cuentasDePrueba.push(res.id);
      const { data } = await supabase
        .from('cuentas_comercio')
        .select('nombre, limite_negocios, plan, licencia_estado, licencia_monto_mensual, licencia_activa_desde')
        .eq('id', res.id)
        .single();
      expect(data!.nombre).toBe('Grupo Aurora');
      expect(data!.limite_negocios).toBe(3);
      expect(data!.plan).toBe('starter');
      expect(data!.licencia_estado).toBe('activo');
      expect(data!.licencia_monto_mensual).toBe(29);
      expect(data!.licencia_activa_desde).toBe('2026-07-25');
    }
  });

  it('crea una cuenta sin límite (Pro, limiteNegocios null)', async () => {
    const res = await crearCuenta(supabase, { nombre: 'Grupo Pro', limiteNegocios: null, ...CUENTA_BASE, plan: 'pro' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      cuentasDePrueba.push(res.id);
      const { data } = await supabase.from('cuentas_comercio').select('limite_negocios').eq('id', res.id).single();
      expect(data!.limite_negocios).toBeNull();
    }
  });

  it('rechaza un nombre vacío', async () => {
    const res = await crearCuenta(supabase, { nombre: '   ', limiteNegocios: 1, ...CUENTA_BASE });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/nombre/i);
  });

  it('rechaza un límite menor a 1 (pero permite null)', async () => {
    const res = await crearCuenta(supabase, { nombre: 'Grupo X', limiteNegocios: 0, ...CUENTA_BASE });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/l[íi]mite/i);
  });

  it('rechaza un plan que no está en el catálogo', async () => {
    // MUTATION: quitar este chequeo deja pasar cualquier string a una columna con CHECK en la BD —
    // el insert fallaría con un 23514 genérico en vez de este mensaje claro.
    const res = await crearCuenta(supabase, { nombre: 'Grupo Y', limiteNegocios: 1, ...CUENTA_BASE, plan: 'enterprise' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/plan/i);
  });

  it('rechaza un monto mensual negativo', async () => {
    const res = await crearCuenta(supabase, { nombre: 'Grupo Z', limiteNegocios: 1, ...CUENTA_BASE, licenciaMontoMensual: -10 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/monto/i);
  });

  it('rechaza un monto que no es un número', async () => {
    // Portado de guardarComercio.test.ts ('rechaza un monto que no es un número'): la Tarea 9 del
    // formulario hace Number(monto), así que un "25a" llega como NaN. Sin el Number.isFinite,
    // JSON.stringify(NaN) es "null" y el monto se guardaría VACÍO en silencio.
    const res = await crearCuenta(supabase, { nombre: 'Grupo NaN', limiteNegocios: 1, ...CUENTA_BASE, licenciaMontoMensual: NaN });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/monto/i);
  });

  it('rechaza una fecha inválida', async () => {
    const res = await crearCuenta(supabase, { nombre: 'Grupo W', limiteNegocios: 1, ...CUENTA_BASE, licenciaActivaDesde: '31/07/2026' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/fecha/i);
  });

  it('rechaza un estado de licencia que la BD no acepta', async () => {
    // Portado de guardarComercio.test.ts ('rechaza un estado de licencia que la BD no acepta').
    // MUTATION: quitar este chequeo de validarDatosCuenta deja pasar cualquier string a una
    // columna con CHECK en la BD — el insert fallaría con un 23514 genérico en vez de este mensaje.
    const res = await crearCuenta(supabase, { nombre: 'Grupo Suspendido', limiteNegocios: 1, ...CUENTA_BASE, licenciaEstado: 'suspendido' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/estado/i);
  });
});

describe('actualizarCuenta', () => {
  it('actualiza el nombre, límite y datos de licencia de una cuenta existente', async () => {
    const cuentaId = await crearCuentaFixture(1);
    const res = await actualizarCuenta(supabase, cuentaId, { nombre: 'Nombre Nuevo', limiteNegocios: 5, ...CUENTA_BASE, plan: 'growth' });
    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('cuentas_comercio')
      .select('nombre, limite_negocios, plan')
      .eq('id', cuentaId)
      .single();
    expect(data!.nombre).toBe('Nombre Nuevo');
    expect(data!.limite_negocios).toBe(5);
    expect(data!.plan).toBe('growth');
  });

  it('falla si la cuenta ya no existe, en vez de reportar éxito', async () => {
    const res = await actualizarCuenta(
      supabase,
      '00000000-0000-0000-0000-000000000000',
      { nombre: 'Fantasma', limiteNegocios: 1, ...CUENTA_BASE },
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

  it('cuenta las sucursales del comercio que se está moviendo, no solo lo que YA hay en destino', async () => {
    // MUTATION: este es el hueco que motivó este fix (caso real "Verde Raíz"). Si
    // asignarComercioACuenta deja de sumar las sucursales PROPIAS del comercio que se mueve al
    // unidadesAAgregar, este test pasa con ok:true indebidamente. Destino: límite 3, ya tiene 2
    // comercios (0 sucursales) = 2 unidades usadas, 1 de cupo libre. El comercio que se mueve trae
    // 1 (él mismo) + 2 sucursales propias = 3 unidades → 2+3=5 > 3, debe rechazar.
    const cuentaDestino = await crearCuentaFixture(3);
    await crearComercioFixture(cuentaDestino);
    await crearComercioFixture(cuentaDestino);

    const cuentaOrigen = await crearCuentaFixture(99);
    const comercioAMover = await crearComercioFixture(cuentaOrigen);
    await supabase.from('sucursales').insert([
      { comercio_id: comercioAMover, nombre: 'Sucursal 1' },
      { comercio_id: comercioAMover, nombre: 'Sucursal 2' },
    ]);

    const res = await asignarComercioACuenta(supabase, comercioAMover, cuentaDestino);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('3');
    // Y NO quedó reasignado: sigue en la cuenta de origen.
    const { data } = await supabase.from('comercios').select('cuenta_id').eq('id', comercioAMover).single();
    expect(data!.cuenta_id).toBe(cuentaOrigen);
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

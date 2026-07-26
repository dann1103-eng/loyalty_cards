import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import {
  crearSucursal,
  crearSucursalPrincipal,
  renombrarSucursal,
  cambiarEstadoSucursal,
  listarSucursales,
  sucursalPerteneceAComercio,
} from './sucursales';

const supabase = createServiceClient();
const comerciosDePrueba: string[] = [];
const cuentasDePrueba: string[] = [];

afterEach(async () => {
  if (comerciosDePrueba.length) {
    // sucursales apunta a comercios sin cascade: borrar sucursales antes que su comercio.
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

async function crearComercio(): Promise<string> {
  // comercios.cuenta_id es nullable (0008): insertamos directo, sin crear cuenta para el fixture.
  const slug = `test-suc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase.from('comercios').insert({ nombre: 'Suc', slug }).select('id').single();
  if (error) throw error;
  comerciosDePrueba.push(data.id);
  return data.id;
}

async function crearCuentaFixture(limite: number | null): Promise<string> {
  const { data, error } = await supabase
    .from('cuentas_comercio')
    .insert({ nombre: `Cuenta Test ${Date.now()}-${Math.random().toString(36).slice(2)}`, limite_negocios: limite })
    .select('id').single();
  if (error) throw error;
  cuentasDePrueba.push(data.id);
  return data.id;
}

async function crearComercioConCuenta(cuentaId: string | null): Promise<string> {
  const slug = `test-suc-cuenta-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase
    .from('comercios').insert({ nombre: 'Suc Cuenta', slug, cuenta_id: cuentaId }).select('id').single();
  if (error) throw error;
  comerciosDePrueba.push(data.id); // mismo array/afterEach que crearComercio(): comparten teardown.
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
    // La PRIMERA sucursal nace principal (0012) y no se puede desactivar: creamos esa antes y
    // probamos el soft-delete sobre una ADICIONAL, que es la única desactivable.
    const comercioId = await crearComercio();
    await crearSucursal(supabase, comercioId, { nombre: 'Principal' });
    const creada = await crearSucursal(supabase, comercioId, { nombre: 'Centro' });
    if (!creada.ok) throw new Error('el setup falló');

    const res = await cambiarEstadoSucursal(supabase, creada.id, comercioId, false);
    expect(res.ok).toBe(true);

    const { data } = await supabase.from('sucursales').select('activa').eq('id', creada.id).maybeSingle();
    expect(data).not.toBeNull();      // NO se borró la fila
    expect(data!.activa).toBe(false); // se marcó inactiva
  });

  it('reactiva una sucursal desactivada', async () => {
    // Sobre una ADICIONAL, igual que el test de arriba: si se hiciera sobre la principal (que ya no
    // se puede apagar), el apagado fallaría y las dos aserciones pasarían TRIVIALMENTE —
    // "reactiva" no probaría nada porque la fila nunca habría estado inactiva.
    const comercioId = await crearComercio();
    await crearSucursal(supabase, comercioId, { nombre: 'Principal' });
    const creada = await crearSucursal(supabase, comercioId, { nombre: 'Centro' });
    if (!creada.ok) throw new Error('el setup falló');

    const apagada = await cambiarEstadoSucursal(supabase, creada.id, comercioId, false);
    expect(apagada.ok).toBe(true); // sin este apagado real, el "reactiva" de abajo es decoración
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

  it('no REACTIVA una sucursal de OTRO comercio', async () => {
    // El gemelo de arriba llama con activa=false y hoy corta en el CANDADO de la principal (que
    // hace su propio pre-read scopeado), así que ya no cubre el .eq('comercio_id') del UPDATE. En
    // el camino activa=true el candado ni corre: ese .eq es la ÚNICA defensa contra que un comercio
    // reactive una sucursal ajena — y es lo que este test protege (ver MUTATION-TESTING).
    const comercioA = await crearComercio();
    const comercioB = await crearComercio();
    await crearSucursal(supabase, comercioA, { nombre: 'Principal' });
    const extra = await crearSucursal(supabase, comercioA, { nombre: 'Centro' });
    if (!extra.ok) throw new Error('el setup falló');
    expect((await cambiarEstadoSucursal(supabase, extra.id, comercioA, false)).ok).toBe(true);

    const res = await cambiarEstadoSucursal(supabase, extra.id, comercioB, true);
    expect(res).toEqual({ ok: false, error: 'Esa sucursal ya no existe.' });

    const { data } = await supabase.from('sucursales').select('activa').eq('id', extra.id).single();
    expect(data!.activa).toBe(false); // sigue apagada: comercioB no pudo tocarla
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

// Desde la 0012 el cupo SOLO aplica a las sucursales ADICIONALES (la primera nace principal y es
// gratis), así que los cuatro tests de este bloque crean primero la principal: sin ese paso previo
// todos pegarían contra el atajo de primera-gratis y ninguno tocaría la verificación de límite.
describe('crearSucursal — límite combinado de la cuenta', () => {
  it('rechaza cuando la cuenta del comercio ya alcanzó su límite combinado', async () => {
    // MUTATION: quitar la llamada a verificarLimiteCuenta en crearSucursal deja pasar esto con
    // ok:true indebidamente — el comercio YA consume el único cupo (límite 1).
    const cuentaId = await crearCuentaFixture(1);
    const comercioId = await crearComercioConCuenta(cuentaId);
    await crearSucursal(supabase, comercioId, { nombre: 'Principal' });

    const res = await crearSucursal(supabase, comercioId, { nombre: 'Sucursal Nueva' });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/límite/i);
  });

  it('permite crear cuando la cuenta tiene cupo, y la sucursal queda registrada', async () => {
    const cuentaId = await crearCuentaFixture(3);
    const comercioId = await crearComercioConCuenta(cuentaId);
    await crearSucursal(supabase, comercioId, { nombre: 'Principal' });

    const res = await crearSucursal(supabase, comercioId, { nombre: 'Sucursal Nueva' });

    expect(res.ok).toBe(true);
    if (res.ok) {
      // Limpieza vía afterEach existente: borra sucursales por comercio_id, no hace falta trackear.
      const { data } = await supabase.from('sucursales').select('nombre').eq('id', res.id).single();
      expect(data!.nombre).toBe('Sucursal Nueva');
    }
  });

  it('permite crear sin límite cuando la cuenta tiene limite_negocios null (plan Pro)', async () => {
    const cuentaId = await crearCuentaFixture(null);
    const comercioId = await crearComercioConCuenta(cuentaId);
    await crearSucursal(supabase, comercioId, { nombre: 'Principal' });

    const res = await crearSucursal(supabase, comercioId, { nombre: 'Sucursal Sin Tope' });

    expect(res.ok).toBe(true);
  });

  it('degrada con gracia cuando el comercio no tiene cuenta_id (sin límite que verificar)', async () => {
    const comercioId = await crearComercioConCuenta(null);
    await crearSucursal(supabase, comercioId, { nombre: 'Principal' });

    const res = await crearSucursal(supabase, comercioId, { nombre: 'Sucursal Sin Cuenta' });

    expect(res.ok).toBe(true);
  });
});

describe('sucursal principal (0012)', () => {
  it('la PRIMERA sucursal de un comercio nace principal y no verifica cupo', async () => {
    // Cuenta LLENA (limite 1, ya consumido por el comercio): sin la regla de primera-gratis esto
    // rechazaría — es la auto-reparación de un comercio que quedó sin principal.
    // MUTATION-TESTING (a): con `const esPrimera = false;` en crearSucursal, este test FALLA con
    // el error de límite ("Esta cuenta ya alcanzó su límite de 1 negocio(s)/sucursal(es).").
    const cuentaId = await crearCuentaFixture(1);
    const comercioId = await crearComercioConCuenta(cuentaId);

    const res = await crearSucursal(supabase, comercioId, { nombre: 'Casa matriz' });
    // Shape completo, no `res.ok === true`: si esto se rompe, el diff imprime el `error` recibido y
    // se ve si el motivo fue el cupo (la mutación (a)) o cualquier otro fallo.
    expect(res).toEqual({ ok: true, id: expect.any(String) });
    const { data } = await supabase
      .from('sucursales').select('nombre, activa, es_principal').eq('comercio_id', comercioId);
    expect(data).toEqual([{ nombre: 'Casa matriz', activa: true, es_principal: true }]);
  });

  it('con principal existente, la siguiente es adicional y el cupo aplica', async () => {
    const cuentaId = await crearCuentaFixture(1);
    const comercioId = await crearComercioConCuenta(cuentaId);
    await crearSucursal(supabase, comercioId, { nombre: 'Principal' });

    const res = await crearSucursal(supabase, comercioId, { nombre: 'Centro' });
    expect(res).toEqual({ ok: false, error: 'Esta cuenta ya alcanzó su límite de 1 negocio(s)/sucursal(es).' });
  });

  it('con cupo, la adicional nace es_principal=false', async () => {
    const cuentaId = await crearCuentaFixture(2);
    const comercioId = await crearComercioConCuenta(cuentaId);
    await crearSucursal(supabase, comercioId, { nombre: 'Principal' });

    const res = await crearSucursal(supabase, comercioId, { nombre: 'Centro' });
    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('sucursales').select('es_principal').eq('comercio_id', comercioId).eq('nombre', 'Centro');
    expect(data).toEqual([{ es_principal: false }]);
  });

  it('la principal no se puede desactivar (mensaje exacto)', async () => {
    // MUTATION-TESTING (b): borrando `if (fila.es_principal) return ...` de cambiarEstadoSucursal,
    // este test FALLA — recibe { ok: true } y la fila queda activa=false.
    const comercioId = await crearComercio();
    const principal = await crearSucursal(supabase, comercioId, { nombre: 'Principal' });
    if (!principal.ok) throw new Error('fixture');

    const res = await cambiarEstadoSucursal(supabase, principal.id, comercioId, false);
    expect(res).toEqual({ ok: false, error: 'La sucursal principal no se puede desactivar.' });
    const { data } = await supabase.from('sucursales').select('activa').eq('id', principal.id).single();
    expect(data?.activa).toBe(true);
  });

  it('una adicional sí se puede desactivar', async () => {
    const comercioId = await crearComercio();
    await crearSucursal(supabase, comercioId, { nombre: 'Principal' });
    const extra = await crearSucursal(supabase, comercioId, { nombre: 'Centro' });
    if (!extra.ok) throw new Error('fixture');

    expect(await cambiarEstadoSucursal(supabase, extra.id, comercioId, false)).toEqual({ ok: true });
  });

  it('listarSucursales expone esPrincipal y ordena la principal primera', async () => {
    // Inserts DIRECTOS (dos statements separados, para que created_at difiera) en vez de
    // crearSucursal: con crearSucursal la principal es siempre la MÁS VIEJA, así que el orden
    // esperado coincidiría con el `ORDER BY created_at` y borrar el .order('es_principal') no
    // rompería nada. Acá la principal es la más NUEVA: sin ese order, el resultado sale [Alfa, Zeta].
    const comercioId = await crearComercio();
    const { error: eAlfa } = await supabase
      .from('sucursales').insert({ comercio_id: comercioId, nombre: 'Alfa', es_principal: false });
    if (eAlfa) throw eAlfa;
    const { error: eZeta } = await supabase
      .from('sucursales').insert({ comercio_id: comercioId, nombre: 'Zeta', es_principal: true });
    if (eZeta) throw eZeta;

    const lista = await listarSucursales(supabase, comercioId);
    expect(lista?.map((s) => ({ nombre: s.nombre, esPrincipal: s.esPrincipal }))).toEqual([
      { nombre: 'Zeta', esPrincipal: true },
      { nombre: 'Alfa', esPrincipal: false },
    ]);
  });

  it('crearSucursalPrincipal inserta la fila Principal activa', async () => {
    const comercioId = await crearComercio();
    const res = await crearSucursalPrincipal(supabase, comercioId);
    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('sucursales').select('nombre, activa, es_principal').eq('comercio_id', comercioId);
    expect(data).toEqual([{ nombre: 'Principal', activa: true, es_principal: true }]);
  });
});

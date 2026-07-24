import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearSucursal } from './sucursales';
import { crearCajero, listarCajeros, desactivarCajero } from './cajeros';

const supabase = createServiceClient();
const comerciosDePrueba: string[] = [];

// Teardown en orden FK: usuarios_comercio (apunta a comercios, sucursales y auth.users sin cascade)
// va PRIMERO; luego se borran los Auth users de esas filas, luego sucursales, luego comercios.
afterEach(async () => {
  if (!comerciosDePrueba.length) return;

  // Recolectar los auth_user_id de las filas antes de borrarlas, para limpiar también Auth.
  const { data: filas } = await supabase
    .from('usuarios_comercio')
    .select('auth_user_id')
    .in('comercio_id', comerciosDePrueba);

  await supabase.from('usuarios_comercio').delete().in('comercio_id', comerciosDePrueba);

  for (const f of filas ?? []) {
    if (f.auth_user_id) {
      const { error } = await supabase.auth.admin.deleteUser(f.auth_user_id);
      if (error) console.error('[test] no se pudo borrar el usuario de auth:', error.message);
    }
  }

  await supabase.from('sucursales').delete().in('comercio_id', comerciosDePrueba);
  const { error } = await supabase.from('comercios').delete().in('id', comerciosDePrueba);
  if (error) console.error('[test] no se pudieron borrar los comercios de prueba:', error);
  comerciosDePrueba.length = 0;
});

// Email único por caso: evita colisiones con datos reales o con restos de corridas fallidas.
function emailUnico(): string {
  return `cajero-${Date.now()}-${Math.random().toString(36).slice(2)}@ejemplo.test`;
}

async function crearComercio(): Promise<string> {
  const slug = `test-caj-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase.from('comercios').insert({ nombre: 'Caj', slug }).select('id').single();
  if (error) throw error;
  comerciosDePrueba.push(data.id);
  return data.id;
}

// Comercio + una sucursal activa, listos para dar de alta un cajero.
async function armar(): Promise<{ comercioId: string; sucursalId: string; sucursalNombre: string }> {
  const comercioId = await crearComercio();
  const sucursalNombre = 'Sucursal Centro';
  const creada = await crearSucursal(supabase, comercioId, { nombre: sucursalNombre });
  if (!creada.ok) throw new Error('el setup de sucursal falló');
  return { comercioId, sucursalId: creada.id, sucursalNombre };
}

describe('crearCajero', () => {
  it('rechaza un email inválido', async () => {
    const { comercioId, sucursalId } = await armar();
    const res = await crearCajero(supabase, comercioId, {
      email: 'no-es-email',
      password: 'contrasena-de-prueba-1234',
      sucursalId,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/correo/i);
  });

  it('rechaza una contraseña corta', async () => {
    const { comercioId, sucursalId } = await armar();
    const res = await crearCajero(supabase, comercioId, {
      email: emailUnico(),
      password: 'corta',
      sucursalId,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/contraseña/i);
  });

  it('rechaza una sucursal de OTRO comercio, sin crear la cuenta de Auth', async () => {
    // MUTATION-TESTING apunta a este caso: si crearCajero pierde la validación
    // sucursalPerteneceAComercio, ataría un cajero a la sucursal de otro comercio y este test
    // debe FALLAR (res.ok pasaría a true y ADEMÁS se crearía la cuenta de Auth).
    const a = await armar();
    const b = await armar();
    const email = emailUnico();

    // sucursal de A, pero se intenta atar a un cajero de B.
    const res = await crearCajero(supabase, b.comercioId, {
      email,
      password: 'contrasena-de-prueba-1234',
      sucursalId: a.sucursalId,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/sucursal/i);

    // No se creó NADA: ni fila de cajero, ni cuenta huérfana en Auth con ese correo.
    const { data: lista } = await supabase.auth.admin.listUsers();
    expect(lista?.users.some((u) => u.email === email)).toBe(false);
    const { data: filas } = await supabase
      .from('usuarios_comercio')
      .select('id')
      .eq('comercio_id', b.comercioId)
      .eq('rol', 'cajero');
    expect(filas ?? []).toHaveLength(0);
  });

  it('crea el cajero: cuenta de Auth + fila usuarios_comercio atada a la sucursal', async () => {
    const { comercioId, sucursalId } = await armar();
    const email = emailUnico();
    const res = await crearCajero(supabase, comercioId, {
      email,
      password: 'contrasena-de-prueba-1234',
      sucursalId,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.error);

    const { data } = await supabase
      .from('usuarios_comercio')
      .select('email, rol, sucursal_id, auth_user_id')
      .eq('id', res.id)
      .single();
    expect(data!.rol).toBe('cajero');
    expect(data!.sucursal_id).toBe(sucursalId);
    expect(data!.email).toBe(email);
    expect(data!.auth_user_id).not.toBeNull();
  });
});

describe('listarCajeros', () => {
  it('lista los cajeros del comercio con el nombre de su sucursal', async () => {
    const { comercioId, sucursalId, sucursalNombre } = await armar();
    const email = emailUnico();
    const creado = await crearCajero(supabase, comercioId, {
      email,
      password: 'contrasena-de-prueba-1234',
      sucursalId,
    });
    if (!creado.ok) throw new Error('el setup falló');

    const lista = await listarCajeros(supabase, comercioId);
    expect(lista).not.toBeNull(); // null = error de BD, distinto de [] = vacío
    expect(lista!.length).toBe(1);
    expect(lista![0].email).toBe(email);
    expect(lista![0].sucursalId).toBe(sucursalId);
    expect(lista![0].sucursalNombre).toBe(sucursalNombre);
  });

  it('no incluye cajeros de OTRO comercio ni a los owners', async () => {
    const { comercioId, sucursalId } = await armar();
    const otro = await armar();
    await crearCajero(supabase, comercioId, { email: emailUnico(), password: 'contrasena-de-prueba-1234', sucursalId });
    await crearCajero(supabase, otro.comercioId, {
      email: emailUnico(),
      password: 'contrasena-de-prueba-1234',
      sucursalId: otro.sucursalId,
    });

    // Un owner del mismo comercio no debe aparecer en la lista de cajeros.
    const { error: eOwner } = await supabase
      .from('usuarios_comercio')
      .insert({ comercio_id: comercioId, email: emailUnico(), rol: 'owner' });
    if (eOwner) throw eOwner;

    const lista = await listarCajeros(supabase, comercioId);
    expect(lista).not.toBeNull();
    expect(lista!.length).toBe(1); // solo el cajero de ESTE comercio, sin el owner ni el ajeno
  });
});

describe('desactivarCajero', () => {
  it('borra la fila del cajero (pierde el acceso)', async () => {
    const { comercioId, sucursalId } = await armar();
    const creado = await crearCajero(supabase, comercioId, {
      email: emailUnico(),
      password: 'contrasena-de-prueba-1234',
      sucursalId,
    });
    if (!creado.ok) throw new Error('el setup falló');

    const res = await desactivarCajero(supabase, creado.id, comercioId);
    expect(res.ok).toBe(true);

    const { data } = await supabase.from('usuarios_comercio').select('id').eq('id', creado.id).maybeSingle();
    expect(data).toBeNull(); // la fila se borró
  });

  it('no borra un cajero de OTRO comercio', async () => {
    const a = await armar();
    const b = await armar();
    const creado = await crearCajero(supabase, a.comercioId, {
      email: emailUnico(),
      password: 'contrasena-de-prueba-1234',
      sucursalId: a.sucursalId,
    });
    if (!creado.ok) throw new Error('el setup falló');

    const res = await desactivarCajero(supabase, creado.id, b.comercioId);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/ya no existe/i);

    const { data } = await supabase.from('usuarios_comercio').select('id').eq('id', creado.id).maybeSingle();
    expect(data).not.toBeNull(); // intacto: no era de comercioB
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { esOwnerDeComercio } from './esOwnerDeComercio';

const supabase = createServiceClient();
const usuariosCreados: string[] = [];
const slugsDePrueba: string[] = [];

afterEach(async () => {
  // Orden: filas de usuarios_comercio (por auth_user_id) → auth.users → comercios.
  // usuarios_comercio apunta a comercios y a auth.users sin cascade, así que el hijo va antes
  // que ambos padres.
  for (const id of usuariosCreados) {
    const { error: e1 } = await supabase.from('usuarios_comercio').delete().eq('auth_user_id', id);
    if (e1) console.error('[test] no se pudo borrar la fila de usuarios_comercio:', e1);
    const { error: e2 } = await supabase.auth.admin.deleteUser(id);
    if (e2) console.error('[test] no se pudo borrar el usuario de auth:', e2);
  }
  usuariosCreados.length = 0;
  if (slugsDePrueba.length) {
    const { error } = await supabase.from('comercios').delete().in('slug', slugsDePrueba);
    if (error) console.error('[test] no se pudieron borrar los comercios de prueba:', error);
    slugsDePrueba.length = 0;
  }
});

async function crearUsuarioAuth(): Promise<string> {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase.auth.admin.createUser({
    email: `test-owner-${sufijo}@ejemplo.test`,
    password: 'contrasena-de-prueba-1234',
    email_confirm: true,
  });
  if (error) throw error;
  usuariosCreados.push(data.user.id);
  return data.user.id;
}

async function crearComercio(nombre: string): Promise<string> {
  const slug = `test-owner-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  slugsDePrueba.push(slug);
  const { data, error } = await supabase
    .from('comercios')
    .insert({ nombre, slug })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function ligar(authUserId: string, comercioId: string, rol: 'owner' | 'cajero') {
  const { error } = await supabase
    .from('usuarios_comercio')
    .insert({ comercio_id: comercioId, email: `uc-${authUserId}@ejemplo.test`, rol, auth_user_id: authUserId });
  if (error) throw error;
}

describe('esOwnerDeComercio', () => {
  it('devuelve UN comercio (id y nombre) cuando el usuario es owner de uno', async () => {
    const id = await crearUsuarioAuth();
    const comercioId = await crearComercio('Comercio del Owner');
    await ligar(id, comercioId, 'owner');

    const res = await esOwnerDeComercio(supabase, id);
    expect(res).toHaveLength(1);
    expect(res[0].comercioId).toBe(comercioId);
    expect(res[0].nombre).toBe('Comercio del Owner');
  });

  it('devuelve AMBOS comercios cuando el usuario es owner de dos', async () => {
    const id = await crearUsuarioAuth();
    const comercioA = await crearComercio('Comercio A');
    const comercioB = await crearComercio('Comercio B');
    await ligar(id, comercioA, 'owner');
    await ligar(id, comercioB, 'owner');

    const res = await esOwnerDeComercio(supabase, id);
    expect(res).toHaveLength(2);
    expect(res.map((c) => c.comercioId).sort()).toEqual([comercioA, comercioB].sort());
  });

  it('devuelve lista vacía cuando el usuario existe pero NO tiene fila en usuarios_comercio', async () => {
    const id = await crearUsuarioAuth();
    expect(await esOwnerDeComercio(supabase, id)).toEqual([]);
  });

  it('devuelve lista vacía para un id que no existe', async () => {
    expect(await esOwnerDeComercio(supabase, '00000000-0000-0000-0000-000000000000')).toEqual([]);
  });

  it('devuelve lista vacía para un usuario con rol cajero (no owner)', async () => {
    // El filtro rol==='owner' NO es decorativo: un cajero tiene fila en usuarios_comercio pero no
    // debe entrar al panel del dueño. Sin el filtro, este test devolvería un cajero como owner.
    const id = await crearUsuarioAuth();
    const comercioId = await crearComercio('Comercio con Cajero');
    await ligar(id, comercioId, 'cajero');

    expect(await esOwnerDeComercio(supabase, id)).toEqual([]);
  });

  it('devuelve SOLO los comercios donde es owner, ignorando los de cajero', async () => {
    // Con una cuenta que es owner de uno y cajero de otro, la lista trae únicamente el de owner.
    const id = await crearUsuarioAuth();
    const comercioOwner = await crearComercio('Comercio Propio');
    const comercioCajero = await crearComercio('Comercio Ajeno');
    await ligar(id, comercioOwner, 'owner');
    await ligar(id, comercioCajero, 'cajero');

    const res = await esOwnerDeComercio(supabase, id);
    expect(res).toHaveLength(1);
    expect(res[0].comercioId).toBe(comercioOwner);
  });
});

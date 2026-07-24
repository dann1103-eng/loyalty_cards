import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { membresiasDeUsuario } from './membresiasDeUsuario';

const supabase = createServiceClient();
const usuariosCreados: string[] = [];
const slugsDePrueba: string[] = [];

afterEach(async () => {
  // Orden FK: filas de usuarios_comercio (por auth_user_id) → auth.users → comercios.
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
    email: `test-membresia-${sufijo}@ejemplo.test`,
    password: 'contrasena-de-prueba-1234',
    email_confirm: true,
  });
  if (error) throw error;
  usuariosCreados.push(data.user.id);
  return data.user.id;
}

async function crearComercio(nombre: string): Promise<string> {
  const slug = `test-membresia-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  slugsDePrueba.push(slug);
  const { data, error } = await supabase
    .from('comercios')
    .insert({ nombre, slug })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function ligar(authUserId: string, comercioId: string, rol: 'owner' | 'cajero'): Promise<string> {
  const { data, error } = await supabase
    .from('usuarios_comercio')
    .insert({ comercio_id: comercioId, email: `uc-${authUserId}-${comercioId}@ejemplo.test`, rol, auth_user_id: authUserId })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

describe('membresiasDeUsuario', () => {
  it('devuelve AMBAS membresías cuando una cuenta es owner de dos comercios', async () => {
    // El caso que .maybeSingle() rompía: dos filas owner con el mismo auth_user_id lanzaban
    // PGRST116 y bloqueaban al dueño. La consulta base debe devolver la LISTA completa.
    const id = await crearUsuarioAuth();
    const comercioA = await crearComercio('Comercio A');
    const comercioB = await crearComercio('Comercio B');
    const filaA = await ligar(id, comercioA, 'owner');
    await ligar(id, comercioB, 'owner');

    const res = await membresiasDeUsuario(supabase, id);
    expect(res).toHaveLength(2);
    expect(res.map((m) => m.comercioId).sort()).toEqual([comercioA, comercioB].sort());

    // Shape completo de una membresía: protege el map() contra swaps de campos (usuarioComercioId
    // ← id de la fila, NO comercio_id; sucursalId null para un owner). Estos dos alimentarán la
    // atribución de ledger/sucursal en fases próximas, así que se asertan explícitamente.
    const membresiaA = res.find((m) => m.comercioId === comercioA)!;
    expect(membresiaA).toEqual({
      usuarioComercioId: filaA,
      comercioId: comercioA,
      nombre: 'Comercio A',
      rol: 'owner',
      sucursalId: null,
    });
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { esAdminFm } from './esAdminFm';

const supabase = createServiceClient();
const usuariosCreados: string[] = [];

afterEach(async () => {
  // Orden importante: la FK usuarios_fm.auth_user_id -> auth.users NO tiene cascade, así que la
  // fila va antes que el usuario. Los fallos se registran en vez de tragarse: un borrado que
  // falla deja basura que ninguna prueba volvería a sacar a la luz.
  for (const id of usuariosCreados) {
    const { error: errorFila } = await supabase.from('usuarios_fm').delete().eq('auth_user_id', id);
    if (errorFila) console.error('[test] no se pudo borrar la fila de usuarios_fm:', errorFila);
    const { error: errorUsuario } = await supabase.auth.admin.deleteUser(id);
    if (errorUsuario) console.error('[test] no se pudo borrar el usuario de auth:', errorUsuario);
  }
  usuariosCreados.length = 0;
});

async function crearUsuarioAuth(): Promise<string> {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase.auth.admin.createUser({
    email: `test-fm-${sufijo}@ejemplo.test`,
    password: 'contrasena-de-prueba-1234',
    email_confirm: true,
  });
  if (error) throw error;
  usuariosCreados.push(data.user.id);
  return data.user.id;
}

async function hacerAdmin(id: string) {
  const { error } = await supabase
    .from('usuarios_fm')
    .insert({ auth_user_id: id, email: `fm-${id}@ejemplo.test` });
  if (error) throw error;
}

describe('esAdminFm', () => {
  it('devuelve true cuando el usuario tiene fila en usuarios_fm', async () => {
    const id = await crearUsuarioAuth();
    await hacerAdmin(id);

    expect(await esAdminFm(supabase, id)).toBe(true);
  });

  it('devuelve false cuando el usuario existe pero NO tiene fila en usuarios_fm', async () => {
    const id = await crearUsuarioAuth();

    expect(await esAdminFm(supabase, id)).toBe(false);
  });

  it('devuelve false para un id que no existe', async () => {
    expect(await esAdminFm(supabase, '00000000-0000-0000-0000-000000000000')).toBe(false);
  });

  // Esta prueba existe por el .eq('auth_user_id', ...) de esAdminFm. Con la tabla vacía, un
  // maybeSingle() SIN filtro devuelve lo mismo que uno con filtro, así que las tres pruebas de
  // arriba siguen pasando aunque se borre el .eq(). Aquí hay una fila de OTRO usuario: sin el
  // filtro, maybeSingle() la devolvería y el intruso pasaría como admin.
  it('devuelve false para un usuario sin fila aunque OTRO usuario sí sea admin', async () => {
    const idAdmin = await crearUsuarioAuth();
    await hacerAdmin(idAdmin);
    const idIntruso = await crearUsuarioAuth();

    expect(await esAdminFm(supabase, idIntruso)).toBe(false);
  });
});

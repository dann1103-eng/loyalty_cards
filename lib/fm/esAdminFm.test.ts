import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { esAdminFm } from './esAdminFm';

const supabase = createServiceClient();
let authUserId: string | null = null;

afterEach(async () => {
  if (!authUserId) return;
  await supabase.from('usuarios_fm').delete().eq('auth_user_id', authUserId);
  await supabase.auth.admin.deleteUser(authUserId);
  authUserId = null;
});

async function crearUsuarioAuth(): Promise<string> {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase.auth.admin.createUser({
    email: `test-fm-${sufijo}@ejemplo.test`,
    password: 'contrasena-de-prueba-1234',
    email_confirm: true,
  });
  if (error) throw error;
  authUserId = data.user.id;
  return data.user.id;
}

describe('esAdminFm', () => {
  it('devuelve true cuando el usuario tiene fila en usuarios_fm', async () => {
    const id = await crearUsuarioAuth();
    await supabase.from('usuarios_fm').insert({ auth_user_id: id, email: `fm-${id}@ejemplo.test` });

    expect(await esAdminFm(supabase, id)).toBe(true);
  });

  it('devuelve false cuando el usuario existe pero NO tiene fila en usuarios_fm', async () => {
    const id = await crearUsuarioAuth();

    expect(await esAdminFm(supabase, id)).toBe(false);
  });

  it('devuelve false para un id que no existe', async () => {
    expect(await esAdminFm(supabase, '00000000-0000-0000-0000-000000000000')).toBe(false);
  });
});

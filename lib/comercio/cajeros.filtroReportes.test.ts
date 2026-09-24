import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { listarUsuariosDelComercio } from './cajeros';

// Prueba CONTRA LA BASE de la lista de usuarios para el filtro de cajero de Reportes (spec 2026-09-23
// §1). No sirve listarCajeros: filtra activo=true y excluye al dueño, y el filtro necesita a los dos
// (un cajero dado de baja operó y su historial se consulta; el dueño también atiende, y es "Vos").
//
// Rojo de partida (2026-09-23): con la semántica de listarCajeros (rol cajero, activo=true) caían
// tres: "trae cajeros activos e INACTIVOS y al dueño…" con `expected [ Array(1) ] to deeply equal [
// …(4) ]`, "'Vos' es por la cuenta que mira…" con `expected [] to deeply equal [ false ]` y "ordenada
// por email" con `expected [ Array(1) ] to deeply equal [ …(3) ]`.
//
// MUTATION-TESTING (corridas el 2026-09-23, 6 de 6 caen; con el mensaje que se vio caer):
// - Filtrar `.eq('activo', true)`: caen "trae cajeros activos e INACTIVOS…" con `expected [ …(3) ] to
//   deeply equal [ …(4) ]` y "ordenada por email" con `expected [ …(2) ] to deeply equal [ …(3) ]`.
// - Excluir al dueño (`.eq('rol', 'cajero')`): caen tres, "trae cajeros activos e INACTIVOS…" con
//   `expected [ …(2) ] to deeply equal [ …(4) ]`, "'Vos' es por la cuenta que mira…" con `expected []
//   to deeply equal [ false ]` y "ordenada por email" con `expected [ …(2) ] to deeply equal [ …(3) ]`.
// - Sin `.eq('comercio_id', comercioId)`: caen las cinco (trae los usuarios de TODA la base), entre
//   ellas "trae cajeros activos e INACTIVOS…" con `expected [ …(20) ] to deeply equal [ …(4) ]` y "un
//   comercio sin usuarios da []" con `expected [ { …(5) }, { …(5) }, { …(5) }, …(12) ] to deeply
//   equal []`.
// - "Vos" por rol (`esVos: f.rol === 'owner'`): caen "trae cajeros…" con `expected { …(5) } to deeply
//   equal { …(5) }` (el socio) y "'Vos' es por la cuenta que mira…" con `expected [ true ] to deeply
//   equal [ false ]`.
// - Un error de BD como `[]`: cae "un error de la base da null…" con `expected [] to be null`.
// - Sin `.order('email')`: cae "ordenada por email" con `expected [ …(3) ] to deeply equal [ …(3) ]`.

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);
// Cuentas de Auth creadas para el dueño que mira. Se borran DESPUÉS de limpiar(): usuarios_comercio
// las referencia (auth_user_id → auth.users, sin cascade) y limpiar() borra esas filas por comercio_id.
const cuentasAuth: string[] = [];

afterEach(async () => {
  await entorno.limpiar();
  for (const id of cuentasAuth) {
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) console.error('[test] no se pudo borrar la cuenta de Auth:', error.message);
  }
  cuentasAuth.length = 0;
});

function emailUnico(prefijo: string): string {
  return `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2)}@ejemplo.test`;
}

// La cuenta de Auth del dueño que mira la pantalla (lo que verifyComercioOwner devuelve como
// authUserId). Sin contraseña: nadie inicia sesión con ella.
async function crearCuentaAuth(): Promise<{ id: string; email: string }> {
  const email = emailUnico('dueno');
  const { data, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  cuentasAuth.push(data.user.id);
  return { id: data.user.id, email };
}

// Filas que el fixture no sabe crear (un owner, un usuario con email elegido). Van directo a
// usuarios_comercio y las borra igual limpiar(), que borra por comercio_id.
async function insertarUsuario(fila: {
  comercio_id: string;
  email: string;
  rol: 'owner' | 'cajero';
  auth_user_id?: string;
  activo?: boolean;
}): Promise<string> {
  const { data, error } = await supabase.from('usuarios_comercio').insert(fila).select('id').single();
  if (error) throw error;
  return data.id;
}

describe('listarUsuariosDelComercio', () => {
  it('trae cajeros activos e INACTIVOS y al dueño, solo de ESE comercio; "Vos" es la cuenta que mira', async () => {
    const cafe = await entorno.crearComercio();
    const spa = await entorno.crearComercio();
    const cuenta = await crearCuentaAuth();

    const idDueno = await insertarUsuario({ comercio_id: cafe, email: cuenta.email, rol: 'owner', auth_user_id: cuenta.id });
    // Otro dueño del mismo comercio (sin cuenta de Auth): aparece, pero no es "Vos".
    const emailSocio = emailUnico('socio');
    const idSocio = await insertarUsuario({ comercio_id: cafe, email: emailSocio, rol: 'owner' });
    const idActivo = await entorno.crearCajero(cafe);
    const idInactivo = await entorno.crearCajero(cafe);
    const { error: eBaja } = await supabase.from('usuarios_comercio').update({ activo: false }).eq('id', idInactivo);
    if (eBaja) throw eBaja;
    // Un cajero de OTRO comercio del mismo dueño: no es de esta lista.
    const idAjeno = await entorno.crearCajero(spa);

    const lista = await listarUsuariosDelComercio(supabase, cafe, cuenta.id);
    expect(lista).not.toBeNull();
    expect(lista!.map((u) => u.id).sort()).toEqual([idDueno, idSocio, idActivo, idInactivo].sort());
    expect(lista!.some((u) => u.id === idAjeno)).toBe(false);

    const porId = new Map(lista!.map((u) => [u.id, u]));
    expect(porId.get(idDueno)).toEqual({ id: idDueno, email: cuenta.email, rol: 'owner', activo: true, esVos: true });
    expect(porId.get(idSocio)).toEqual({ id: idSocio, email: emailSocio, rol: 'owner', activo: true, esVos: false });
    expect(porId.get(idActivo)).toMatchObject({ rol: 'cajero', activo: true, esVos: false });
    expect(porId.get(idInactivo)).toMatchObject({ rol: 'cajero', activo: false, esVos: false });
  });

  it('"Vos" es por la cuenta que mira, no por ser owner: mirando otra cuenta, nadie es "Vos"', async () => {
    const cafe = await entorno.crearComercio();
    const cuenta = await crearCuentaAuth();
    const otra = await crearCuentaAuth();
    await insertarUsuario({ comercio_id: cafe, email: cuenta.email, rol: 'owner', auth_user_id: cuenta.id });

    const lista = await listarUsuariosDelComercio(supabase, cafe, otra.id);
    expect(lista).not.toBeNull();
    expect(lista!.map((u) => u.esVos)).toEqual([false]);
  });

  it('ordenada por email', async () => {
    // Emails que difieren en la PRIMERA letra: el orden no depende de la collation de la base (con
    // guiones y dígitos, glibc e ICU pueden no ordenar como JS).
    const cafe = await entorno.crearComercio();
    const zeta = emailUnico('zeta');
    const alfa = emailUnico('alfa');
    const medio = emailUnico('medio');
    await insertarUsuario({ comercio_id: cafe, email: zeta, rol: 'cajero' });
    await insertarUsuario({ comercio_id: cafe, email: alfa, rol: 'owner' });
    await insertarUsuario({ comercio_id: cafe, email: medio, rol: 'cajero', activo: false });

    const lista = await listarUsuariosDelComercio(supabase, cafe, '00000000-0000-0000-0000-000000000000');
    expect(lista!.map((u) => u.email)).toEqual([alfa, medio, zeta]);
  });

  it('un comercio sin usuarios da [] (no null)', async () => {
    const cafe = await entorno.crearComercio();
    expect(await listarUsuariosDelComercio(supabase, cafe, '00000000-0000-0000-0000-000000000000')).toEqual([]);
  });

  it('un error de la base da null (no [], que diría "no hay cajeros")', async () => {
    // Un id que no es uuid hace fallar la consulta en Postgres (22P02): es el error que se puede
    // provocar sin tocar la base.
    expect(await listarUsuariosDelComercio(supabase, 'no-es-un-uuid', '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

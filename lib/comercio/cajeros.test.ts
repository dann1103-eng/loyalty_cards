import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearSucursal } from './sucursales';
import { crearCajero, listarCajeros, desactivarCajero } from './cajeros';

const supabase = createServiceClient();
const comerciosDePrueba: string[] = [];
// Correos de casos que NO deberían crear cuenta de Auth. Se registran igual: si una MUTACIÓN rompe
// un candado y la cuenta sí se crea, el assert falla y corta el test, pero el teardown la borra
// lo mismo — esta es la BD real donde el usuario hace QA, no se le dejan cuentas sueltas.
const emailsDePrueba: string[] = [];

// Teardown en orden FK: usuarios_comercio (apunta a comercios, sucursales y auth.users sin cascade)
// va PRIMERO; luego se borran los Auth users de esas filas, luego sucursales, luego comercios.
afterEach(async () => {
  if (comerciosDePrueba.length) {
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
  }

  // Red de seguridad para las cuentas que "no debían existir" (va DESPUÉS del borrado de filas: si
  // una todavía apuntara al Auth user, la FK bloquearía el deleteUser). perPage alto a propósito:
  // listUsers pagina de a 50 por default y esta BD tiene cuentas reales del usuario.
  if (emailsDePrueba.length) {
    const { data: lista } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const email of emailsDePrueba) {
      const sobrante = lista?.users.find((u) => u.email === email);
      if (!sobrante) continue;
      const { error } = await supabase.auth.admin.deleteUser(sobrante.id);
      if (error) console.error('[test] no se pudo borrar la cuenta de auth sobrante:', error.message);
    }
    emailsDePrueba.length = 0;
  }
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
    emailsDePrueba.push(email); // si una mutación SÍ crea la cuenta, el teardown la borra igual

    // sucursal de A, pero se intenta atar a un cajero de B.
    const res = await crearCajero(supabase, b.comercioId, {
      email,
      password: 'contrasena-de-prueba-1234',
      sucursalId: a.sucursalId,
    });
    expect(res.ok).toBe(false);
    // Mensaje EXACTO, no /sucursal/i: ahora hay DOS rechazos de sucursal (ajena y desactivada) y una
    // regex floja los confundiría — el dueño necesita saber cuál de los dos le pasó.
    if (!res.ok) expect(res.error).toBe('Esa sucursal no es de tu comercio.');

    // No se creó NADA: ni fila de cajero, ni cuenta huérfana en Auth con ese correo. perPage alto:
    // con el default (50) esta búsqueda podría no ver la cuenta y "pasar" sin haber verificado nada.
    const { data: lista } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    expect(lista?.users.some((u) => u.email === email)).toBe(false);
    const { data: filas } = await supabase
      .from('usuarios_comercio')
      .select('id')
      .eq('comercio_id', b.comercioId)
      .eq('rol', 'cajero');
    expect(filas ?? []).toHaveLength(0);
  });

  it('rechaza una sucursal DESACTIVADA del propio comercio, sin crear la cuenta de Auth', async () => {
    // MUTATION-TESTING apunta a este caso: si el candado vuelve a chequear SOLO la pertenencia
    // (sucursalPerteneceAComercio NO filtra por `activa`, a propósito: sus otros callers dependen
    // de eso), el alta pasa y este test debe FALLAR. La UI ya ofrece solo sucursales activas, pero
    // un POST armado a mano ataría el cajero a una apagada: no podría operar (el escáner lo
    // bloquea) y el dueño no lo vería en su lista si tiene contexto de sucursal.
    const { comercioId } = await armar();

    // La sucursal de armar() es la PRIMERA del comercio → nace principal, y la principal no se
    // puede desactivar. Por eso hace falta una segunda. Se apaga con un UPDATE directo para no
    // atar el setup al comportamiento de cambiarEstadoSucursal (que se prueba en sucursales.test.ts).
    const segunda = await crearSucursal(supabase, comercioId, { nombre: 'Sucursal Apagada' });
    if (!segunda.ok) throw new Error('el setup de la segunda sucursal falló');
    const { error: eApagar } = await supabase.from('sucursales').update({ activa: false }).eq('id', segunda.id);
    if (eApagar) throw eApagar;

    const email = emailUnico();
    emailsDePrueba.push(email); // si una mutación SÍ crea la cuenta, el teardown la borra igual

    const res = await crearCajero(supabase, comercioId, {
      email,
      password: 'contrasena-de-prueba-1234',
      sucursalId: segunda.id,
    });
    expect(res.ok).toBe(false);
    // Mensaje EXACTO y distinto del de pertenencia: la sucursal SÍ es suya, la apagó él mismo.
    if (!res.ok) expect(res.error).toBe('Esa sucursal está desactivada.');

    // No se creó NADA: ni cuenta huérfana en Auth con ese correo, ni fila de cajero.
    const { data: lista } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    expect(lista?.users.some((u) => u.email === email)).toBe(false);
    const { data: filas } = await supabase
      .from('usuarios_comercio')
      .select('id')
      .eq('comercio_id', comercioId)
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
    expect(lista![0].sucursalActiva).toBe(true); // sucursal operando: la fila no lleva aviso
  });

  it('marca al cajero cuya sucursal fue DESACTIVADA, sin sacarlo de la lista', async () => {
    // El dueño apaga una sucursal donde ya trabajaba un cajero. Ese cajero DEBE seguir en la lista
    // —es la única vista desde donde puede darlo de baja— pero MARCADO: sin la marca se ve idéntico
    // a uno que sí puede cobrar, y el dueño no entiende por qué su cajero no puede trabajar.
    //
    // MUTATION-TESTING apunta a este caso por partida doble: si el map deja de leer `activa` del
    // join (p. ej. `sucursalActiva: true` fijo, o sacar la columna del select), la marca desaparece
    // y este test debe FALLAR; si en cambio la consulta empezara a filtrar por sucursal activa, el
    // cajero desaparecería de la lista y también FALLA (expect(enNorte).toBeDefined()).
    const { comercioId, sucursalId } = await armar();
    const segunda = await crearSucursal(supabase, comercioId, { nombre: 'Sucursal Norte' });
    if (!segunda.ok) throw new Error('el setup de la segunda sucursal falló');

    const emailPrincipal = emailUnico();
    const emailNorte = emailUnico();
    const enPrincipalCreado = await crearCajero(supabase, comercioId, {
      email: emailPrincipal,
      password: 'contrasena-de-prueba-1234',
      sucursalId,
    });
    const enNorteCreado = await crearCajero(supabase, comercioId, {
      email: emailNorte,
      password: 'contrasena-de-prueba-1234',
      sucursalId: segunda.id,
    });
    if (!enPrincipalCreado.ok || !enNorteCreado.ok) throw new Error('el setup de cajeros falló');

    // Se apaga DESPUÉS del alta, como en la vida real: crearCajero ya no deja atar un cajero a una
    // sucursal apagada, así que este estado solo se alcanza desactivando una que ya tenía gente.
    const { error: eApagar } = await supabase.from('sucursales').update({ activa: false }).eq('id', segunda.id);
    if (eApagar) throw eApagar;

    const lista = await listarCajeros(supabase, comercioId);
    expect(lista).not.toBeNull();
    const enPrincipal = lista!.find((c) => c.email === emailPrincipal);
    const enNorte = lista!.find((c) => c.email === emailNorte);

    expect(enNorte).toBeDefined(); // si desaparece, el dueño se queda sin poder darlo de baja
    expect(enNorte!.sucursalNombre).toBe('Sucursal Norte'); // el nombre se sigue viendo
    expect(enNorte!.sucursalActiva).toBe(false); // …y la fila puede avisar que no puede operar
    expect(enPrincipal).toBeDefined();
    expect(enPrincipal!.sucursalActiva).toBe(true); // el de la sucursal viva no se contagia
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

  it('no incluye cajeros dados de baja (soft-delete, activo=false)', async () => {
    const { comercioId, sucursalId } = await armar();
    const creado = await crearCajero(supabase, comercioId, {
      email: emailUnico(),
      password: 'contrasena-de-prueba-1234',
      sucursalId,
    });
    if (!creado.ok) throw new Error('el setup falló');

    await desactivarCajero(supabase, creado.id, comercioId);

    const lista = await listarCajeros(supabase, comercioId);
    expect(lista).not.toBeNull();
    expect(lista!.length).toBe(0); // el dado de baja no aparece en la lista
  });
});

describe('desactivarCajero', () => {
  it('soft-delete: la fila NO se borra y queda activo=false (preserva el ledger)', async () => {
    const { comercioId, sucursalId } = await armar();
    const creado = await crearCajero(supabase, comercioId, {
      email: emailUnico(),
      password: 'contrasena-de-prueba-1234',
      sucursalId,
    });
    if (!creado.ok) throw new Error('el setup falló');

    const res = await desactivarCajero(supabase, creado.id, comercioId);
    expect(res.ok).toBe(true);

    const { data } = await supabase
      .from('usuarios_comercio')
      .select('id, activo')
      .eq('id', creado.id)
      .maybeSingle();
    expect(data).not.toBeNull(); // la fila SIGUE existiendo (soft-delete, no DELETE)
    expect(data!.activo).toBe(false); // queda inactiva → sin acceso, pero el ledger la conserva
  });

  it('no da de baja un cajero de OTRO comercio', async () => {
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

    const { data } = await supabase
      .from('usuarios_comercio')
      .select('id, activo')
      .eq('id', creado.id)
      .maybeSingle();
    expect(data).not.toBeNull(); // intacto: no era de comercioB
    expect(data!.activo).toBe(true); // y sigue activo: la baja ajena no lo tocó
  });
});

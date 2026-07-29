import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearComercioPropio } from './crearComercioPropio';

const supabase = createServiceClient();
const cuentasDePrueba: string[] = [];
const comerciosDePrueba: string[] = [];
const usuariosAuthDePrueba: string[] = [];

afterEach(async () => {
  // Orden FK: usuarios_comercio y sucursales → comercios → cuentas → auth.users (el FK de
  // auth_user_id bloquea el deleteUser si quedan membresías).
  //
  // Cada delete LOGUEA su error (convención de guardarComercio.test.ts): un fallo silencioso acá
  // —típicamente un 23503— arrastra a todos los siguientes y deja basura en la base real de QA sin
  // dejar rastro. Ya pasó una vez: un mutation-test creó un comercio que el caso no registraba, su
  // membresía bloqueó el deleteUser y solo se supo por el log de Auth, el único que sí miraba.
  if (comerciosDePrueba.length) {
    const { error: eMembresias } = await supabase
      .from('usuarios_comercio').delete().in('comercio_id', comerciosDePrueba);
    if (eMembresias) console.error('[test] no se pudieron borrar las membresías de prueba:', eMembresias);
    const { error: eSucursales } = await supabase
      .from('sucursales').delete().in('comercio_id', comerciosDePrueba);
    if (eSucursales) console.error('[test] no se pudieron borrar las sucursales de prueba:', eSucursales);
    // programas_tarjeta (0024): crearComercio le crea su principal a TODO comercio ahora — mismo
    // riesgo de fuga silenciosa que las sucursales de arriba, mismo criterio.
    const { error: eProgramas } = await supabase
      .from('programas_tarjeta').delete().in('comercio_id', comerciosDePrueba);
    if (eProgramas) console.error('[test] no se pudieron borrar los programas de prueba:', eProgramas);
    const { error: eComercios } = await supabase.from('comercios').delete().in('id', comerciosDePrueba);
    if (eComercios) console.error('[test] no se pudieron borrar los comercios de prueba:', eComercios);
    comerciosDePrueba.length = 0;
  }
  if (cuentasDePrueba.length) {
    const { error: eCuentas } = await supabase.from('cuentas_comercio').delete().in('id', cuentasDePrueba);
    if (eCuentas) console.error('[test] no se pudieron borrar las cuentas de prueba:', eCuentas);
    cuentasDePrueba.length = 0;
  }
  for (const id of usuariosAuthDePrueba) {
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) console.error('[test] no se pudo borrar el usuario de Auth de prueba:', error.message);
  }
  usuariosAuthDePrueba.length = 0;
});

// Sufijo ACOTADO A LA CORRIDA para el nombre de cada comercio. Sin él, un nombre fijo como
// 'Mi Segunda Marca' se brickea solo: basta UNA fuga (un crash, un timeout, un Ctrl-C, o el propio
// camino donde una aserción lanza antes del registro para el teardown) para que el slug base quede
// tomado, la corrida siguiente reciba 'mi-segunda-marca-2' de generarSlugUnico y el toEqual del slug
// falle PARA SIEMPRE por un resto viejo, no por un bug — y a las 5 fugas el error cambia por
// completo, porque el generador se agota. Con el sufijo, cada corrida tiene su propio espacio de
// slugs y las consultas de verificación no pueden tocar filas que la corrida no creó.
//
// Solo produce [0-9a-z], así que slugificar el nombre lo deja intacto: el slug esperado se escribe
// A MANO (`mi-segunda-marca-${sufijo}`) en vez de llamar al slugificador de producción — una
// aserción que use la misma función que prueba no asertaría nada.
function sufijoUnico(): string {
  return `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

async function crearCuentaFixture(limite: number): Promise<string> {
  const { data, error } = await supabase
    .from('cuentas_comercio')
    .insert({ nombre: `Cuenta Propio ${Date.now()}`, limite_negocios: limite })
    .select('id').single();
  if (error) throw error;
  cuentasDePrueba.push(data.id);
  return data.id;
}

async function crearComercioActivoFixture(cuentaId: string | null): Promise<string> {
  const { data, error } = await supabase
    .from('comercios')
    .insert({ nombre: 'Activo', slug: `activo-${Date.now()}-${Math.random().toString(36).slice(2)}`, cuenta_id: cuentaId })
    .select('id').single();
  if (error) throw error;
  comerciosDePrueba.push(data.id);
  return data.id;
}

async function crearOwnerFixture(comercioId: string): Promise<{ authUserId: string; email: string }> {
  const email = `owner-propio-${Date.now()}-${Math.random().toString(36).slice(2)}@test.fm`;
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: 'secreta-de-test-123',
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error('sin usuario de Auth');
  usuariosAuthDePrueba.push(data.user.id);
  const { error: eMembresia } = await supabase.from('usuarios_comercio').insert({
    comercio_id: comercioId,
    auth_user_id: data.user.id,
    email,
    rol: 'owner',
  });
  if (eMembresia) throw eMembresia;
  return { authUserId: data.user.id, email };
}

// Un SEGUNDO usuario de Auth sobre el MISMO comercio activo, con la membresía a medida (rol/activo)
// que pide cada caso del candado del paso 2. Convive con el owner real sin chocar: el unique de
// usuarios_comercio es (comercio_id, email) desde la 0008 y el email es distinto.
async function crearUsuarioConMembresiaFixture(
  comercioId: string,
  membresia: { rol: string; activo: boolean },
): Promise<string> {
  const email = `owner-propio-otro-${Date.now()}-${Math.random().toString(36).slice(2)}@test.fm`;
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: 'secreta-de-test-123',
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error('sin usuario de Auth');
  usuariosAuthDePrueba.push(data.user.id);
  const { error: eMembresia } = await supabase.from('usuarios_comercio').insert({
    comercio_id: comercioId,
    auth_user_id: data.user.id,
    email,
    rol: membresia.rol,
    activo: membresia.activo,
  });
  if (eMembresia) throw eMembresia;
  return data.user.id;
}

// Registra para el teardown lo que la función crea (el id vuelve en el resultado).
function registrar(id: string) {
  comerciosDePrueba.push(id);
}

// Los casos de RECHAZO no deberían crear nada — pero si el candado que prueban se rompe (eso es
// exactamente lo que hace un mutation-test), el comercio SÍ nace y hay que poder limpiarlo: esta es
// la base real donde el usuario hace QA, y la membresía del comercio huérfano además bloquea por FK
// el deleteUser del afterEach, dejando también un usuario de Auth colgado. Se llama ANTES de asertar
// para que el registro ocurra aunque la aserción falle (que es el punto de la mutación).
function registrarSiCreo(res: { ok: true; id: string } | { ok: false; error: string }) {
  if (res.ok) registrar(res.id);
}

describe('crearComercioPropio', () => {
  it('crea comercio + Principal + membresía owner, con la cuenta DERIVADA de la sesión', async () => {
    const cuentaId = await crearCuentaFixture(2);
    const activoId = await crearComercioActivoFixture(cuentaId);
    const { authUserId, email } = await crearOwnerFixture(activoId);
    const sufijo = sufijoUnico();
    const nombre = `Mi Segunda Marca ${sufijo}`;

    const res = await crearComercioPropio(
      supabase,
      { authUserId, comercioActivoId: activoId },
      { nombre, tipoTarjeta: 'sellos' },
    );
    registrarSiCreo(res); // antes de la primera aserción: si esta lanza, el teardown igual limpia
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const { data: comercio } = await supabase
      .from('comercios')
      .select('nombre, slug, tipo_tarjeta, cuenta_id, sello_meta, color_fondo, color_texto, color_label')
      .eq('id', res.id).single();
    expect(comercio).toEqual({
      nombre,
      slug: `mi-segunda-marca-${sufijo}`,
      tipo_tarjeta: 'sellos',
      cuenta_id: cuentaId, // CONTROL: derivada del comercio activo, nunca de un input
      sello_meta: null, // se configura en /marca
      // Los defaults del editor de marca, NO los placeholder del form de FM: con blanco sobre
      // blanco la tarjeta nace ilegible, que es la razón de ser de COLORES_DEFAULT.
      color_fondo: 'rgb(19, 19, 21)',
      color_texto: 'rgb(245, 245, 240)',
      color_label: 'rgb(255, 157, 66)',
    });

    const { data: principal } = await supabase
      .from('sucursales').select('nombre, activa, es_principal').eq('comercio_id', res.id);
    expect(principal).toEqual([{ nombre: 'Principal', activa: true, es_principal: true }]);

    const { data: membresia } = await supabase
      .from('usuarios_comercio').select('email, rol, activo').eq('comercio_id', res.id);
    expect(membresia).toEqual([{ email, rol: 'owner', activo: true }]);
  });

  it('cuenta llena: rechaza con el error de límite', async () => {
    const cuentaId = await crearCuentaFixture(1); // el comercio activo ya la llena
    const activoId = await crearComercioActivoFixture(cuentaId);
    const { authUserId } = await crearOwnerFixture(activoId);

    const res = await crearComercioPropio(
      supabase,
      { authUserId, comercioActivoId: activoId },
      { nombre: `No Cabe ${sufijoUnico()}`, tipoTarjeta: 'puntos' },
    );
    registrarSiCreo(res);
    expect(res).toEqual({ ok: false, error: 'Esta cuenta ya alcanzó su límite de 1 negocio(s)/sucursal(es).' });
  });

  it('comercio activo sin cuenta: error claro', async () => {
    const activoId = await crearComercioActivoFixture(null);
    const { authUserId } = await crearOwnerFixture(activoId);

    const res = await crearComercioPropio(
      supabase,
      { authUserId, comercioActivoId: activoId },
      { nombre: `Sin Cuenta ${sufijoUnico()}`, tipoTarjeta: 'puntos' },
    );
    registrarSiCreo(res);
    // El mensaje nombra al canal de soporte y NO a "FM": el dueño de un comercio no sabe quién es
    // FM. Ver lib/marca.test.ts, que impide que el nombre viejo reaparezca en lo que ve el usuario.
    expect(res).toEqual({
      ok: false,
      error: 'Tu comercio no está asociado a una cuenta. Escribinos a soporte@cardly-sv.site.',
    });
  });

  it('un tipo de tarjeta INEXISTENTE es rechazado', async () => {
    // Hasta las migraciones 0018-0023 este caso usaba 'cashback', que entonces estaba marcado como
    // "Próximamente". Ahora los ocho tipos del catálogo tienen su motor construido, así que el caso
    // real que hay que seguir protegiendo es otro: un valor que NO está en el catálogo. Sin este
    // candado llegaría a la BD y lo rechazaría el CHECK de la 0005 con un 23514 crudo.
    const cuentaId = await crearCuentaFixture(5);
    const activoId = await crearComercioActivoFixture(cuentaId);
    const { authUserId } = await crearOwnerFixture(activoId);

    const res = await crearComercioPropio(
      supabase,
      { authUserId, comercioActivoId: activoId },
      { nombre: `Inventado ${sufijoUnico()}`, tipoTarjeta: 'multipass' },
    );
    registrarSiCreo(res);
    expect(res).toEqual({ ok: false, error: 'El tipo de tarjeta no es válido.' });
  });

  it('un tipo del catálogo que antes decía "Próximamente" ahora SÍ se acepta', async () => {
    // El otro lado del cambio: cashback era rechazado y ahora tiene que crearse bien. Sin esta
    // prueba, alguien podría "arreglar" el catálogo volviendo disponible a false y nadie se
    // enteraría hasta que un comercio no pudiera elegir su tipo.
    const cuentaId = await crearCuentaFixture(5);
    const activoId = await crearComercioActivoFixture(cuentaId);
    const { authUserId } = await crearOwnerFixture(activoId);

    const res = await crearComercioPropio(
      supabase,
      { authUserId, comercioActivoId: activoId },
      { nombre: `Cash ${sufijoUnico()}`, tipoTarjeta: 'cashback' },
    );
    registrarSiCreo(res);
    expect(res.ok).toBe(true);
  });

  // CANDADO DE MEMBRESÍA (paso 2 de la función). Dentro de esta función es lo único que impide
  // crear un comercio en una cuenta AJENA si el comercioActivoId llegara mal: sin él, cualquier
  // sesión podría apuntar al comercio de otro y quedarse con su cupo. El caller lo toma del gate,
  // pero cada capa revalida (defensa en profundidad).
  //
  // Hacen falta DOS casos, no uno, porque cada uno cubre `.eq` distintos y ninguno los cubre los
  // tres: el intruso debe tener UNA membresía que falle por rol (y no por activo) en un caso, y
  // una que falle por activo (y no por rol) en el otro — no pueden ser la misma fila. En ambos, el
  // comercio activo SÍ tiene su owner legítimo (otro usuario), que es lo que atrapa la mutación de
  // `.eq('auth_user_id')`: sin ese filtro el select encuentra la membresía del owner ajeno y sigue.
  for (const caso of [
    { etiqueta: 'cajero activo', membresia: { rol: 'cajero', activo: true } }, // atrapa auth_user_id + rol
    { etiqueta: 'owner dado de baja', membresia: { rol: 'owner', activo: false } }, // atrapa auth_user_id + activo
  ]) {
    it(`sin membresía owner activa de la sesión (${caso.etiqueta}): rechaza sin crear nada`, async () => {
      const cuentaId = await crearCuentaFixture(5);
      const activoId = await crearComercioActivoFixture(cuentaId);
      await crearOwnerFixture(activoId); // el owner LEGÍTIMO del comercio activo, otra persona
      const intrusoId = await crearUsuarioConMembresiaFixture(activoId, caso.membresia);
      const sufijo = sufijoUnico();
      const nombre = `Intruso ${sufijo}`;

      const res = await crearComercioPropio(
        supabase,
        { authUserId: intrusoId, comercioActivoId: activoId },
        { nombre, tipoTarjeta: 'puntos' },
      );
      registrarSiCreo(res);
      expect(res).toEqual({ ok: false, error: 'No se pudo crear el comercio.' });

      // Y no quedó NADA: el mensaje correcto con el comercio creado igual sería un agujero.
      const { data: creados } = await supabase
        .from('comercios').select('id').eq('slug', `intruso-${sufijo}`);
      expect(creados).toEqual([]);
    });
  }

  it('si la membresía falla, COMPENSA: borra comercio y principal, y devuelve error', async () => {
    const cuentaId = await crearCuentaFixture(5);
    const activoId = await crearComercioActivoFixture(cuentaId);
    const { authUserId } = await crearOwnerFixture(activoId);
    const sufijo = sufijoUnico();

    // Inyección puntual: el insert de usuarios_comercio falla; el SELECT (membresía actual) sigue
    // real. Todo lo demás pega a la BD de verdad — la compensación borra filas reales.
    const real = createServiceClient();
    const conMembresiasRotas = {
      from(tabla: string) {
        const builder = real.from(tabla as never);
        if (tabla !== 'usuarios_comercio') return builder;
        return {
          select: builder.select.bind(builder),
          insert: () => ({ error: { message: 'roto a propósito' } }),
        } as never;
      },
      // `as unknown as` y no un cast directo: el objeto solo implementa `from`, así que TS lo
      // rechaza con TS2352 ("no se superponen lo suficiente") contra el cliente completo.
    } as unknown as ReturnType<typeof createServiceClient>;

    const res = await crearComercioPropio(
      conMembresiasRotas,
      { authUserId, comercioActivoId: activoId },
      { nombre: `Huerfano Imposible ${sufijo}`, tipoTarjeta: 'puntos' },
    );
    expect(res).toEqual({ ok: false, error: 'No se pudo crear el comercio. Intentá de nuevo.' });

    // Ni el comercio ni su principal sobrevivieron. La consulta va por el slug EXACTO de esta
    // corrida: acotada así, no puede encontrar (ni el registro de abajo borrar) filas ajenas.
    const { data: huerfanos } = await real
      .from('comercios').select('id').eq('slug', `huerfano-imposible-${sufijo}`);
    // Registrar ANTES de asertar: si la compensación se rompe (mutation-test a), el comercio
    // sobrevive y esta es la BD real donde el usuario hace QA — el teardown tiene que poder
    // limpiarlo igual. La aserción de abajo sigue fallando, que es el punto de la mutación.
    for (const c of huerfanos ?? []) registrar(c.id);
    expect(huerfanos).toEqual([]);
  });
});

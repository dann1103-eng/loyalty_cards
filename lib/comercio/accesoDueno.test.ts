import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { generarAccesoDueno } from './accesoDueno';

const supabase = createServiceClient();

// Base ficticia: ningún test ABRE el link (canjearlo es la ruta de activación, otra tarea); solo se
// verifica cómo se arma. SEGURIDAD: ningún test imprime el link ni el token_hash — son credenciales
// temporales. Se leen con URL/searchParams y se asertan por presencia, nunca por contenido.
const BASE = 'https://ejemplo.test';

const comerciosDePrueba: string[] = [];
// TODO correo que esta corrida pudo haber creado en Auth: los que crea la función bajo prueba y
// también los de casos que NO deberían crear cuenta. Se registran ANTES de llamar: si una MUTACIÓN
// rompe un candado y la cuenta sí se crea, el assert falla y corta el test, pero el teardown la
// borra lo mismo — esta es la BD real donde el usuario hace QA, no se le dejan cuentas sueltas.
const emailsDePrueba: string[] = [];

// Teardown en orden FK: usuarios_comercio (apunta a comercios y a auth.users sin cascade) va
// PRIMERO; después los Auth users de esas filas; después los comercios.
afterEach(async () => {
  if (comerciosDePrueba.length) {
    const { data: filas } = await supabase
      .from('usuarios_comercio')
      .select('auth_user_id')
      .in('comercio_id', comerciosDePrueba);

    await supabase.from('usuarios_comercio').delete().in('comercio_id', comerciosDePrueba);

    // Set: un mismo dueño puede tener membresía en DOS comercios de prueba (el caso del correo que
    // ya existe en Auth) y borrarlo dos veces solo produciría un error confuso en el log.
    const idsAuth = new Set((filas ?? []).map((f) => f.auth_user_id).filter((id) => id !== null));
    for (const id of idsAuth) {
      const { error } = await supabase.auth.admin.deleteUser(id);
      if (error) console.error('[test] no se pudo borrar el usuario de auth:', error.message);
    }

    const { error } = await supabase.from('comercios').delete().in('id', comerciosDePrueba);
    if (error) console.error('[test] no se pudieron borrar los comercios de prueba:', error.message);
    comerciosDePrueba.length = 0;
  }

  // Red de seguridad para cuentas sin fila que las apunte (las crea generateLink antes del insert de
  // la membresía, y también las crearía una mutación que se saltara un candado). Va DESPUÉS del
  // borrado de filas: si una todavía apuntara al Auth user, la FK bloquearía el deleteUser. perPage
  // alto a propósito: listUsers pagina de a 50 por default y esta BD tiene cuentas reales.
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

// Correo único por corrida: evita colisionar con datos reales o con restos de corridas fallidas.
function emailUnico(): string {
  return `dueno-${Date.now()}-${Math.random().toString(36).slice(2)}@ejemplo.test`;
}

async function crearComercio(): Promise<string> {
  const slug = `test-acc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase
    .from('comercios')
    .insert({ nombre: 'Acc', slug })
    .select('id')
    .single();
  if (error) throw error;
  comerciosDePrueba.push(data.id);
  return data.id;
}

// Cuenta de Auth YA CONFIRMADA, que es como las crean seed-usuario-comercio.ts y crearCajero()
// (createUser con email_confirm: true). La confirmación es lo que hace que `invite` falle después
// — ver el caso "correo que ya existe en Auth".
async function crearUsuarioAuthConfirmado(email: string): Promise<string> {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: 'contrasena-de-prueba-1234',
    email_confirm: true,
  });
  if (error) throw error;
  return data.user.id;
}

describe('generarAccesoDueno', () => {
  it('dueño nuevo: crea la cuenta de Auth, la membresía owner y devuelve el link de invitación', async () => {
    const comercioId = await crearComercio();
    const correo = emailUnico();
    emailsDePrueba.push(correo);

    // Se pasa con espacios y en MAYÚSCULAS: la función normaliza (trim + minúsculas) antes de todo,
    // así el correo queda canónico en Auth y en la fila (si no, el mismo dueño entraría dos veces
    // con dos escrituras distintas del mismo correo).
    const res = await generarAccesoDueno(supabase, comercioId, `  ${correo.toUpperCase()}  `, BASE);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.error);

    const url = new URL(res.link);
    expect(`${url.origin}${url.pathname}`).toBe(`${BASE}/comercio/activar`);
    expect(url.searchParams.get('tipo')).toBe('invite'); // correo nuevo → invitación, no recuperación
    expect(url.searchParams.get('token_hash')).toBeTruthy(); // presencia, NUNCA el valor

    const { data: filas } = await supabase
      .from('usuarios_comercio')
      .select('email, rol, auth_user_id, activo')
      .eq('comercio_id', comercioId);
    expect(filas ?? []).toHaveLength(1);
    expect(filas![0].email).toBe(correo); // normalizado, no `  CORREO  `
    expect(filas![0].rol).toBe('owner');
    expect(filas![0].activo).toBe(true); // sin esto la membresía no pasa el gate (membresiasDeUsuario)
    expect(filas![0].auth_user_id).not.toBeNull();

    // La fila apunta a la cuenta de Auth REAL de ese correo (no a un id inventado): es lo que une la
    // sesión que creará el link con la membresía del comercio.
    const { data: usuario } = await supabase.auth.admin.getUserById(filas![0].auth_user_id!);
    expect(usuario.user?.email).toBe(correo);
  });

  it('rechaza un correo inválido sin crear nada', async () => {
    // MUTATION-TESTING apunta a este caso: si se quita la validación de correo, el texto inválido
    // llega a Auth, que lo rechaza con SU propio error → la función devolvería ok:false igual. Por
    // eso el assert es sobre el mensaje EXACTO: es lo único que distingue "lo rechazamos nosotros,
    // antes de tocar nada" de "lo rechazó Supabase después de la llamada".
    const comercioId = await crearComercio();
    const res = await generarAccesoDueno(supabase, comercioId, 'no-es-email', BASE);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('El correo no es válido.');

    const { data: filas } = await supabase
      .from('usuarios_comercio')
      .select('id')
      .eq('comercio_id', comercioId);
    expect(filas ?? []).toHaveLength(0);
  });

  it('rechaza un comercio inexistente sin crear la cuenta de Auth', async () => {
    // El comercio se verifica ANTES de tocar Auth: si el id no existe, no debe quedar una cuenta
    // huérfana que nadie va a reclamar. Se registra el correo igual por si una mutación invierte el
    // orden y sí la crea.
    const correo = emailUnico();
    emailsDePrueba.push(correo);

    const res = await generarAccesoDueno(supabase, crypto.randomUUID(), correo, BASE);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('Ese comercio ya no existe.');

    const { data: lista } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    expect(lista?.users.some((u) => u.email === correo)).toBe(false);
  });

  it('rechaza el correo que ya es CAJERO de ese comercio, sin tocar Auth ni ascenderlo', async () => {
    // MUTATION-TESTING apunta a este caso: sin el candado de rol, el insert de la membresía choca
    // contra el unique (comercio_id, email), el 23505 se lee como éxito y FM se lleva un link
    // válido para alguien que entra sin poder administrar nada. El "salió bien" mentiría y Daniel
    // no tendría cómo diagnosticarlo: la persona SÍ puede entrar, pero como cajero.
    const comercioId = await crearComercio();
    const correo = emailUnico();
    emailsDePrueba.push(correo); // si la mutación llega a Auth, la cuenta que cree se borra igual

    // Fila de cajero directa (sin crearCajero): este caso no depende de sucursales ni de cómo se
    // den de alta los cajeros, solo de que el par (comercio, correo) ya esté ocupado por un cajero.
    const { error: eCajero } = await supabase
      .from('usuarios_comercio')
      .insert({ comercio_id: comercioId, email: correo, rol: 'cajero' });
    if (eCajero) throw eCajero;

    const res = await generarAccesoDueno(supabase, comercioId, correo, BASE);
    expect(res.ok).toBe(false);
    // Mensaje EXACTO: es lo único que separa este rechazo del genérico "No se pudo generar el
    // acceso.". Y NO dice "dalo de baja y reintentá" a propósito — la baja de cajeros es SOFT
    // (activo=false, la fila se conserva para el ledger), así que el correo seguiría ocupado.
    if (!res.ok) {
      expect(res.error).toBe(
        'Ese correo ya está registrado como cajero de este comercio. Usá otro correo para el dueño: ' +
          'dar de baja al cajero no libera el correo, su fila se conserva para el historial.',
      );
    }

    // El candado corta ANTES de generateLink: no queda ninguna cuenta de Auth colgando.
    const { data: lista } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    expect(lista?.users.some((u) => u.email === correo)).toBe(false);

    // Y el cajero sigue siendo cajero: nada de ascenderlo a owner en silencio.
    const { data: filas } = await supabase
      .from('usuarios_comercio')
      .select('rol, auth_user_id')
      .eq('comercio_id', comercioId);
    expect(filas ?? []).toHaveLength(1);
    expect(filas![0].rol).toBe('cajero');
    expect(filas![0].auth_user_id).toBeNull();
  });

  it('correo que YA existe en Auth: cae en recovery y crea la membresía del comercio nuevo', async () => {
    // MUTATION-TESTING apunta a este caso: sin el fallback a `recovery`, un dueño que ya administra
    // otro comercio (o que ya definió su clave) NO puede recibir un link nunca más.
    const comercioViejo = await crearComercio();
    const comercioNuevo = await crearComercio();
    const correo = emailUnico();
    emailsDePrueba.push(correo);

    // El dueño ya existe: cuenta confirmada + membresía en el comercio viejo.
    const authUserId = await crearUsuarioAuthConfirmado(correo);
    const { error: eMembresia } = await supabase
      .from('usuarios_comercio')
      .insert({ comercio_id: comercioViejo, email: correo, rol: 'owner', auth_user_id: authUserId });
    if (eMembresia) throw eMembresia;

    // Forma EXACTA del error que dispara el fallback, verificada contra el proyecto real. Es un
    // canario: si Supabase cambia el `code`, este assert avisa ANTES de que el fallback deje de
    // dispararse en silencio (y el dueño se quede sin poder entrar). Ojo: con una cuenta SIN
    // confirmar `invite` NO falla —devuelve un token nuevo—, por eso el setup la confirma.
    const intento = await supabase.auth.admin.generateLink({ type: 'invite', email: correo });
    expect(intento.error?.name).toBe('AuthApiError');
    expect(intento.error?.status).toBe(422);
    expect(intento.error?.code).toBe('email_exists');
    expect(intento.error?.message).toBe('A user with this email address has already been registered');

    const res = await generarAccesoDueno(supabase, comercioNuevo, correo, BASE);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.error);

    const url = new URL(res.link);
    expect(`${url.origin}${url.pathname}`).toBe(`${BASE}/comercio/activar`);
    expect(url.searchParams.get('tipo')).toBe('recovery'); // no 'invite': ese correo ya no se invita
    expect(url.searchParams.get('token_hash')).toBeTruthy();

    // Membresía del comercio NUEVO, atada a la MISMA cuenta de Auth (no una cuenta duplicada).
    const { data: filas } = await supabase
      .from('usuarios_comercio')
      .select('rol, auth_user_id')
      .eq('comercio_id', comercioNuevo);
    expect(filas ?? []).toHaveLength(1);
    expect(filas![0].rol).toBe('owner');
    expect(filas![0].auth_user_id).toBe(authUserId);
  });

  it('idempotente: generar el acceso dos veces no duplica la membresía', async () => {
    // MUTATION-TESTING apunta a este caso: si el duplicado del unique (comercio_id, email) se trata
    // como error, "Regenerar link" —el camino para un link vencido o una clave olvidada— falla justo
    // para los dueños que ya están dados de alta, que son todos los que lo necesitan.
    const comercioId = await crearComercio();
    const correo = emailUnico();
    emailsDePrueba.push(correo);

    const uno = await generarAccesoDueno(supabase, comercioId, correo, BASE);
    expect(uno.ok).toBe(true);

    const dos = await generarAccesoDueno(supabase, comercioId, correo, BASE);
    expect(dos.ok).toBe(true);
    if (!dos.ok) throw new Error(dos.error);
    // Sigue siendo `invite`: la cuenta existe pero NO está confirmada (el dueño nunca abrió el
    // primer link), y a un correo sin confirmar Auth sí lo deja invitar de nuevo.
    expect(new URL(dos.link).searchParams.get('tipo')).toBe('invite');

    const { data: filas } = await supabase
      .from('usuarios_comercio')
      .select('id')
      .eq('comercio_id', comercioId)
      .eq('email', correo);
    expect(filas ?? []).toHaveLength(1); // una sola fila, no dos
  });
});

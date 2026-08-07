import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearCuentaAutoservicio } from './altaAutoservicio';

// El alta que hoy no existe: un comercio que se da de alta SOLO, sin que FM toque nada.
//
// Lo que tiene que quedar armado en una sola operación, porque si falta una pieza el dueño entra a
// un panel roto y no tiene a quién pedirle ayuda:
//   cuenta → comercio → sucursal principal → programa principal → membresía owner → cuenta de Auth.
//
// El programa principal en particular NO es un detalle: sin él `registrarCliente` no puede resolver
// ningún programa y el alta de clientes queda rota desde el primer minuto (fue un incidente real —
// ver la migración 0025).
const supabase = createServiceClient();

const cuentas: string[] = [];
const comercios: string[] = [];
const usuariosAuth: string[] = [];

function correoUnico(): string {
  return `alta-${Date.now()}-${Math.random().toString(36).slice(2)}@ejemplo.test`;
}

afterEach(async () => {
  // Orden por FKs: membresías y programas/sucursales cuelgan del comercio; el comercio, de la
  // cuenta. Las cuentas de Auth se borran aparte (no son una tabla del esquema).
  for (const id of comercios) {
    await supabase.from('usuarios_comercio').delete().eq('comercio_id', id);
    await supabase.from('programas_tarjeta').delete().eq('comercio_id', id);
    await supabase.from('sucursales').delete().eq('comercio_id', id);
    await supabase.from('comercios').delete().eq('id', id);
  }
  for (const id of cuentas) await supabase.from('cuentas_comercio').delete().eq('id', id);
  for (const id of usuariosAuth) await supabase.auth.admin.deleteUser(id).catch(() => {});
  comercios.length = 0;
  cuentas.length = 0;
  usuariosAuth.length = 0;
});

async function rastrear(comercioId: string, authUserId: string) {
  comercios.push(comercioId);
  usuariosAuth.push(authUserId);
  const { data } = await supabase.from('comercios').select('cuenta_id').eq('id', comercioId).single();
  if (data?.cuenta_id) cuentas.push(data.cuenta_id);
}

describe('crearCuentaAutoservicio', () => {
  it('deja el negocio listo para operar: cuenta, comercio, sucursal, programa y dueño', async () => {
    const email = correoUnico();
    const res = await crearCuentaAutoservicio(supabase, {
      nombreComercio: 'Cafetería Autoservicio',
      email,
      password: 'una-clave-larga-123',
      plan: 'starter',
      tipoTarjeta: 'sellos',
    });

    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    if (!res.ok) return;
    await rastrear(res.comercioId, res.authUserId);

    const [{ data: comercio }, { data: sucursales }, { data: programas }, { data: membresias }] =
      await Promise.all([
        supabase.from('comercios').select('nombre, slug, cuenta_id, tipo_tarjeta').eq('id', res.comercioId).single(),
        supabase.from('sucursales').select('id, es_principal').eq('comercio_id', res.comercioId),
        supabase.from('programas_tarjeta').select('id, es_principal, tipo_tarjeta').eq('comercio_id', res.comercioId),
        supabase.from('usuarios_comercio').select('rol, email, auth_user_id').eq('comercio_id', res.comercioId),
      ]);

    expect(comercio!.nombre).toBe('Cafetería Autoservicio');
    expect(comercio!.slug, 'el slug se autogenera: el dueño no tiene por qué inventarlo').toBeTruthy();
    expect(comercio!.cuenta_id).not.toBeNull();
    expect(sucursales!.filter((s) => s.es_principal)).toHaveLength(1);
    // Sin programa principal, registrarCliente no resuelve nada y nadie puede sacar una tarjeta.
    expect(programas!.filter((p) => p.es_principal)).toHaveLength(1);
    expect(programas![0].tipo_tarjeta).toBe('sellos');
    // La membresía tiene que apuntar a la cuenta de Auth: sin auth_user_id el dueño entra con
    // sesión pero el gate lo expulsa (membresiasDeUsuario matchea por ese campo).
    expect(membresias).toHaveLength(1);
    expect(membresias![0].rol).toBe('owner');
    expect(membresias![0].email).toBe(email);
    expect(membresias![0].auth_user_id).toBe(res.authUserId);
  });

  it('la cuenta nace con el plan elegido y su monto del catálogo, y SIN licencia activa', async () => {
    // 'inactivo' es lo correcto y es seguro: el dueño todavía no pagó, y hoy licencia_estado no
    // gatea ningún flujo del panel comercio — así FM ve en su bandeja quién falta cobrar sin que
    // nadie quede afuera de su propio panel.
    const res = await crearCuentaAutoservicio(supabase, {
      nombreComercio: 'Negocio Growth',
      email: correoUnico(),
      password: 'una-clave-larga-123',
      plan: 'growth',
      tipoTarjeta: 'puntos',
    });
    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    if (!res.ok) return;
    await rastrear(res.comercioId, res.authUserId);

    const { data: comercio } = await supabase
      .from('comercios').select('cuenta_id').eq('id', res.comercioId).single();
    const { data: cuenta } = await supabase
      .from('cuentas_comercio')
      .select('plan, licencia_monto_mensual, limite_negocios, licencia_estado')
      .eq('id', comercio!.cuenta_id!)
      .single();

    expect(cuenta!.plan).toBe('growth');
    expect(Number(cuenta!.licencia_monto_mensual)).toBe(49);
    expect(cuenta!.limite_negocios).toBe(2);
    expect(cuenta!.licencia_estado).toBe('inactivo');
  });

  it('un correo que ya tiene cuenta se rechaza SIN dejar comercio huérfano', async () => {
    // El residuo peor de todos: un comercio sin membresía es invisible para su dueño, le come cupo
    // del plan a la cuenta y le retiene el slug. Solo FM puede limpiarlo a mano.
    const email = correoUnico();
    const primera = await crearCuentaAutoservicio(supabase, {
      nombreComercio: 'Primero',
      email,
      password: 'una-clave-larga-123',
      plan: 'starter',
      tipoTarjeta: 'sellos',
    });
    expect(primera.ok).toBe(true);
    if (!primera.ok) return;
    await rastrear(primera.comercioId, primera.authUserId);

    const { count: comerciosAntes } = await supabase
      .from('comercios').select('id', { count: 'exact', head: true });

    const segunda = await crearCuentaAutoservicio(supabase, {
      nombreComercio: 'Segundo',
      email,
      password: 'otra-clave-larga-456',
      plan: 'starter',
      tipoTarjeta: 'sellos',
    });

    expect(segunda.ok).toBe(false);
    if (!segunda.ok) expect(segunda.error).toContain('ya tiene una cuenta');

    const { count: comerciosDespues } = await supabase
      .from('comercios').select('id', { count: 'exact', head: true });
    expect(comerciosDespues).toBe(comerciosAntes);
  });

  it('rechaza una clave corta antes de crear nada', async () => {
    const { count: antes } = await supabase
      .from('comercios').select('id', { count: 'exact', head: true });

    const res = await crearCuentaAutoservicio(supabase, {
      nombreComercio: 'Clave Corta',
      email: correoUnico(),
      password: 'corta',
      plan: 'starter',
      tipoTarjeta: 'sellos',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('8 caracteres');

    const { count: despues } = await supabase
      .from('comercios').select('id', { count: 'exact', head: true });
    expect(despues, 'una validación que falla no debe dejar rastro').toBe(antes);
  });

  it('rechaza un plan que no está en el catálogo', async () => {
    const res = await crearCuentaAutoservicio(supabase, {
      nombreComercio: 'Plan Inventado',
      email: correoUnico(),
      password: 'una-clave-larga-123',
      plan: 'enterprise',
      tipoTarjeta: 'sellos',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('plan');
  });
});

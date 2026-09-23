import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { PLANES, crearCuenta } from './cuentas';
import { TIPOS_TARJETA, crearComercio } from './guardarComercio';
import { generarSlugUnico } from './slugComercio';
import { COLORES_DEFAULT } from './crearComercioPropio';
import { EMAIL_RE } from '../comercio/cajeros';

// ALTA SELF-SERVICE: un comercio se da de alta solo, desde el sitio público, sin que FM toque nada.
//
// Hasta ahora el camino era: formulario de interés → tabla `prospectos` → FM crea la cuenta y el
// comercio a mano → FM manda un link de invitación por WhatsApp → el dueño define su clave. Cuatro
// pasos manuales entre "conozco Cardly" y "estoy usando mi panel".
//
// Esta función arma TODO de una vez. Se diferencia de sus dos primas:
//   - `crearComercioPropio` exige una sesión con comercio activo — es "agregar OTRO comercio a mi
//     cuenta", no darse de alta desde cero.
//   - `generarAccesoDueno` crea la cuenta de Auth pero deja que FM comparta el link a mano, y
//     necesita un comercio que ya exista.
//
// ══ POR QUÉ NACE 'activo' + 'exenta' (no 'inactivo') ══
// Regla de negocio (memoria de sesión "cobranza: mes gratis a usuarios reales"): el registro es
// gratis y da un mes de prueba ANTES de cobrar; el cobro real espera a tener Wompi probado en
// producción, y pasar una cuenta de 'exenta' a 'normal' es SIEMPRE manual, cuenta por cuenta — nunca
// automático al vencer el mes.
//
// Hasta la Tarea 3 del plan de cobranza (2026-09-21-cobranza-y-rework-admin.md) esta cuenta nacía con
// `licencia_estado: 'inactivo'` y era seguro: esa columna no gateaba ningún flujo del panel del
// comercio, solo la leía el admin de FM. Ya NO es así — `estadoEfectivo` (lib/comercios/cobranza.ts)
// trata 'inactivo' como el interruptor de corte MANUAL de FM y bloquea el panel entero sin mirar
// nada más. Si esta función siguiera creando cuentas 'inactivo', TODO alta self-service quedaría
// bloqueada desde el minuto uno — exactamente el bug que un recorrido real con clientes reveló el
// 2026-09-22. Por eso: `licenciaEstado: 'activo'` (el dueño entra a su panel) y `cobranza: 'exenta'`
// (no se le pide pagar durante el mes de prueba). `licenciaActivaDesde` se deja `null` a propósito:
// ese campo significa "fecha del PRIMER PAGO" (ver planCuenta.ts, marcarPagado) — llenarlo acá le
// mentiría a esa semántica antes de que exista ningún cobro real.

// Mínimo de Supabase Auth es 6; se pide 8 porque esta clave protege la base de clientes de un
// negocio, no un foro.
export const LARGO_MINIMO_CLAVE = 8;

export interface DatosAltaAutoservicio {
  nombreComercio: string;
  email: string;
  password: string;
  plan: string;
  tipoTarjeta: string;
}

export type ResultadoAlta =
  | { ok: true; comercioId: string; authUserId: string }
  | { ok: false; error: string };

export async function crearCuentaAutoservicio(
  supabase: SupabaseClient<Database>,
  datos: DatosAltaAutoservicio,
): Promise<ResultadoAlta> {
  // ── 1. Validación COMPLETA antes de tocar nada ────────────────────────────────────────────────
  // Todo lo que se pueda rechazar sin escribir, se rechaza acá: cada recurso creado es un recurso
  // que habría que compensar si falla el siguiente.
  const nombre = datos.nombreComercio.trim();
  if (!nombre) return { ok: false, error: 'Escribí el nombre de tu negocio.' };

  // El MISMO EMAIL_RE que cajeros y que el acceso de dueño, importado y no copiado: dos reglas de
  // correo distintas en el repo aceptarían dueños que otro alta rechaza, y al revés.
  const correo = datos.email.trim().toLowerCase();
  if (!EMAIL_RE.test(correo)) return { ok: false, error: 'El correo no es válido.' };

  if (datos.password.length < LARGO_MINIMO_CLAVE) {
    return { ok: false, error: `La contraseña tiene que tener al menos ${LARGO_MINIMO_CLAVE} caracteres.` };
  }

  const plan = PLANES.find((p) => p.valor === datos.plan);
  if (!plan) return { ok: false, error: 'Elegí un plan de la lista.' };

  // Solo los tipos con motor construido. Mismo criterio que crearComercioPropio: el <select> del
  // navegador nunca es la barrera.
  const tipo = TIPOS_TARJETA.find((t) => t.valor === datos.tipoTarjeta && t.disponible);
  if (!tipo) return { ok: false, error: 'Elegí un tipo de tarjeta de la lista.' };

  const slug = await generarSlugUnico(supabase, nombre);
  if (!slug.ok) return { ok: false, error: slug.error };

  // ── 2. Cuenta de Auth PRIMERO ─────────────────────────────────────────────────────────────────
  // Va primera a propósito, aunque sea la más incómoda de compensar: el rechazo más probable de
  // todos es "ese correo ya existe", y descubrirlo DESPUÉS de crear cuenta y comercio dejaría el
  // residuo peor del sistema — un comercio sin membresía, invisible para su dueño, comiéndose un
  // cupo del plan y reteniendo el slug (ver la compensación de crearComercioPropio).
  //
  // `email_confirm: true` porque el dueño acaba de elegir su propia clave en el formulario: no hay
  // nada que confirmar por correo, y este proyecto no tiene servicio de email para hacerlo.
  const { data: creado, error: eAuth } = await supabase.auth.admin.createUser({
    email: correo,
    password: datos.password,
    email_confirm: true,
  });
  if (eAuth || !creado?.user) {
    // Se discrimina por `code` y no por el texto del mensaje, que Supabase puede reescribir sin
    // avisar (mismo criterio que generarAccesoDueno).
    if (eAuth?.code === 'email_exists') {
      return { ok: false, error: 'Ese correo ya tiene una cuenta. Iniciá sesión en vez de registrarte.' };
    }
    // SOLO el message: la respuesta de Auth puede traer material sensible.
    console.error('[alta] no se pudo crear la cuenta de acceso:', eAuth?.message);
    return { ok: false, error: 'No se pudo crear tu cuenta. Intentá de nuevo.' };
  }
  const authUserId = creado.user.id;

  // Compensación compartida: cualquier salida por error a partir de acá tiene que pasar por este
  // camino. Escribirla en cada `return` es exactamente el bug que ya se cometió una vez en
  // eliminarComercio — una rama devolvía el error ANTES de reponer.
  async function revertir(hasta: { cuentaId?: string; comercioId?: string }) {
    if (hasta.comercioId) {
      // programas_tarjeta y sucursales son las dos FKs hacia comercios: sin retirarlas primero, el
      // delete del comercio falla con 23503 y el residuo queda igual.
      const { error: eP } = await supabase.from('programas_tarjeta').delete().eq('comercio_id', hasta.comercioId);
      if (eP) console.error('[alta] no se pudo revertir el programa principal:', eP.message);
      const { error: eS } = await supabase.from('sucursales').delete().eq('comercio_id', hasta.comercioId);
      if (eS) console.error('[alta] no se pudo revertir la sucursal principal:', eS.message);
      const { error: eC } = await supabase.from('comercios').delete().eq('id', hasta.comercioId);
      if (eC) console.error('[alta] QUEDÓ UN COMERCIO HUÉRFANO tras un alta fallida:', hasta.comercioId, eC.message);
    }
    if (hasta.cuentaId) {
      const { error } = await supabase.from('cuentas_comercio').delete().eq('id', hasta.cuentaId);
      if (error) console.error('[alta] no se pudo revertir la cuenta:', error.message);
    }
    const { error: eUser } = await supabase.auth.admin.deleteUser(authUserId);
    if (eUser) console.error('[alta] quedó una cuenta de Auth sin negocio:', correo, eUser.message);
  }

  // ── 3. Cuenta de facturación ──────────────────────────────────────────────────────────────────
  // El límite y el monto salen del CATÁLOGO, no del formulario: son valores de negocio y el
  // navegador no puede proponerlos. FM los ajusta después por cuenta (siempre fueron negociables).
  const cuenta = await crearCuenta(supabase, {
    nombre,
    limiteNegocios: plan.limiteSugerido,
    plan: plan.valor,
    licenciaEstado: 'activo',
    licenciaMontoMensual: plan.montoMensual,
    // null y no la fecha de hoy: `licenciaActivaDesde` es la fecha del PRIMER PAGO (planCuenta.ts),
    // no la de registro — todavía no hay ningún cobro real.
    licenciaActivaDesde: null,
  }, 'exenta');
  if (!cuenta.ok) {
    await revertir({});
    return { ok: false, error: cuenta.error };
  }

  // ── 4. Comercio ───────────────────────────────────────────────────────────────────────────────
  // crearComercio es el MISMO camino del alta de FM: valida, verifica el cupo de la cuenta y crea
  // la sucursal Principal y el programa principal. Reusarlo es lo que garantiza que un negocio
  // nacido self-service sea indistinguible de uno dado de alta a mano.
  const comercio = await crearComercio(supabase, {
    nombre,
    slug: slug.slug,
    ...COLORES_DEFAULT,
    logo_url: null,
    strip_url: null,
    hero_url: null,
    tipo_tarjeta: tipo.valor,
    cuenta_id: cuenta.id,
  });
  if (!comercio.ok) {
    await revertir({ cuentaId: cuenta.id });
    return { ok: false, error: comercio.error };
  }

  // ── 5. Membresía owner ────────────────────────────────────────────────────────────────────────
  // Sin ella el dueño entra con sesión pero sin permisos: membresiasDeUsuario matchea por
  // auth_user_id y el gate lo expulsa a una pantalla que no explica nada.
  const { error: eMembresia } = await supabase.from('usuarios_comercio').insert({
    comercio_id: comercio.id,
    auth_user_id: authUserId,
    email: correo,
    rol: 'owner',
  });
  if (eMembresia) {
    console.error('[alta] falló la membresía del dueño; se revierte el alta:', eMembresia.message);
    await revertir({ cuentaId: cuenta.id, comercioId: comercio.id });
    return { ok: false, error: 'No se pudo crear tu cuenta. Intentá de nuevo.' };
  }

  return { ok: true, comercioId: comercio.id, authUserId };
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { obtenerSucursalActiva, sucursalPerteneceAComercio } from './sucursales';

// Capa de datos de cajeros (Fase 7). Espeja sucursales.ts: TODA operación se scopea por comercio_id
// (que viene SIEMPRE del gate, nunca del formulario) y la validación vive acá, en la capa lib — es la
// única defensa real (la BD solo respalda el CHECK de rol y las FKs).
//
// SEGURIDAD: la contraseña del cajero NUNCA se loguea. Ante un error de Auth se registra solo
// error.message (o un mensaje propio), jamás el objeto de credenciales ni `datos`.

export interface DatosCajero {
  email: string;
  password: string;
  sucursalId: string;
}

export interface CajeroListado {
  id: string;
  email: string;
  sucursalId: string | null;
  sucursalNombre: string | null;
  // Si la sucursal del cajero sigue ACTIVA. El dueño lo necesita para entender por qué ese cajero no
  // puede trabajar: con la sucursal apagada, el escáner lo bloquea. null = no tiene sucursal
  // asignada (fila legada) — no es lo mismo que "desactivada" y la UI no lo señala como tal.
  sucursalActiva: boolean | null;
}

export type ResultadoCajero = { ok: true; id: string } | { ok: false; error: string };
export type ResultadoAccion = { ok: true } | { ok: false; error: string };

// Validación mínima local (la BD no valida ni el formato del correo ni el largo de la contraseña).
// EMAIL_RE se exporta para que accesoDueno.ts use ESTE criterio y no otro: dos reglas de correo
// divergentes en el mismo repo aceptarían dueños que el alta de cajeros rechaza, y al revés.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// PASSWORD_MIN se exporta por la misma razón: la pantalla donde el DUEÑO define su clave
// (app/comercio/clave/actions.ts) tiene que exigir el mismo largo que el alta de cajeros. Con dos
// literales sueltos, subir el mínimo en un lado dejaría el otro flojo sin que nada lo marque.
export const PASSWORD_MIN = 8;

// Da de alta un cajero: valida, crea (o reutiliza) la cuenta de Auth y la fila usuarios_comercio
// atada a la sucursal. El candado de seguridad —que la sucursal sea de ESTE comercio y esté
// ACTIVA— se verifica ANTES de tocar Auth: si falla, no se crea NADA (ni una cuenta huérfana en
// Auth).
export async function crearCajero(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  datos: DatosCajero,
): Promise<ResultadoCajero> {
  const email = datos.email.trim().toLowerCase();
  const { password, sucursalId } = datos;

  if (!EMAIL_RE.test(email)) return { ok: false, error: 'El correo no es válido.' };
  if (password.length < PASSWORD_MIN) {
    return { ok: false, error: `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.` };
  }

  // Candado: la sucursal DEBE pertenecer al comercio de la sesión Y estar ACTIVA. Antes de crear el
  // Auth user. obtenerSucursalActiva resuelve las DOS condiciones en una sola consulta
  // (id + comercio_id + activa=true); solo cuando falla se pregunta por la pertenencia, para poder
  // decir CUÁL de las dos falló — un dueño al que le decimos "no es de tu comercio" cuando en
  // realidad la apagó él mismo no sabe qué arreglar. La UI ya ofrece solo activas, pero esta capa es
  // la única defensa real: sin el candado, un POST armado a mano ata un cajero a una sucursal
  // apagada — no podría operar (el escáner lo bloquea) y el dueño no lo vería en su lista si tiene
  // contexto de sucursal. Ambas consultas fallan CERRADO ante un error de infra (y lo loguean).
  const sucursalActiva = await obtenerSucursalActiva(supabase, sucursalId, comercioId);
  if (!sucursalActiva) {
    const perteneceSucursal = await sucursalPerteneceAComercio(supabase, sucursalId, comercioId);
    return perteneceSucursal
      ? { ok: false, error: 'Esa sucursal está desactivada.' }
      : { ok: false, error: 'Esa sucursal no es de tu comercio.' };
  }

  // Crear la cuenta de Auth (o reutilizar si el correo ya existe en Auth), igual que
  // scripts/seed-usuario-comercio.ts. OJO seguridad: solo se loguea error.message, NUNCA el error
  // completo ni la contraseña.
  const { data: creado, error: errorCrear } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  let authUserId = creado?.user?.id;

  if (errorCrear) {
    const { data: lista, error: errorLista } = await supabase.auth.admin.listUsers();
    if (errorLista) {
      console.error('[comercio] falló listUsers al dar de alta un cajero:', errorLista.message);
      return { ok: false, error: 'No se pudo crear la cuenta del cajero.' };
    }
    const existente = lista.users.find((u) => u.email === email);
    if (!existente) {
      console.error('[comercio] falló createUser al dar de alta un cajero:', errorCrear.message);
      return { ok: false, error: 'No se pudo crear la cuenta del cajero.' };
    }
    authUserId = existente.id;
  }

  if (!authUserId) return { ok: false, error: 'No se pudo crear la cuenta del cajero.' };

  const { data, error } = await supabase
    .from('usuarios_comercio')
    .insert({
      comercio_id: comercioId,
      email,
      rol: 'cajero',
      auth_user_id: authUserId,
      sucursal_id: sucursalId,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[comercio] falló el insert de la fila del cajero:', error.message);
    return { ok: false, error: 'No se pudo registrar el cajero.' };
  }
  return { ok: true, id: data.id };
}

// Lista los cajeros ACTIVOS del comercio con el nombre de su sucursal Y si esa sucursal sigue activa
// (join embebido por sucursal_id: dos columnas, una sola consulta). Filtra activo=true: los dados de
// baja (soft-delete) NO aparecen. Devuelve null ante un ERROR de BD (distinto de [] = "no hay
// cajeros"), igual que listarSucursales: sin esa distinción la página mostraría el vacío ante un
// fallo transitorio, invitando a duplicar.
//
// El join NO filtra por sucursal activa a propósito: un cajero cuya sucursal apagaron tiene que
// seguir apareciendo en la lista del dueño (es la única vista donde puede darlo de baja), pero
// marcado — ver el aviso en cajeros/page.tsx.
export async function listarCajeros(
  supabase: SupabaseClient<Database>,
  comercioId: string,
): Promise<CajeroListado[] | null> {
  const { data, error } = await supabase
    .from('usuarios_comercio')
    .select('id, email, sucursal_id, sucursales(nombre, activa)')
    .eq('comercio_id', comercioId)
    .eq('rol', 'cajero')
    .eq('activo', true)
    .order('created_at');

  if (error) {
    console.error('[comercio] falló la consulta de cajeros:', error.message);
    return null;
  }
  return (data ?? []).map((f) => ({
    id: f.id,
    email: f.email,
    sucursalId: f.sucursal_id,
    sucursalNombre: f.sucursales?.nombre ?? null,
    sucursalActiva: f.sucursales?.activa ?? null,
  }));
}

// Da de baja a un cajero con SOFT-delete —update({activo:false}), NUNCA .delete()—: la cuenta de Auth
// y la fila usuarios_comercio siguen existiendo, pero la fila queda inactiva → pierde la membresía →
// pierde el acceso (membresiasDeUsuario y listarCajeros filtran activo=true). Espeja el soft-delete de
// sucursales (cambiarEstadoSucursal). Scopeado por comercio_id (del gate) y por rol='cajero' para que
// esta ruta nunca pueda dar de baja a un owner. id de otro comercio → 0 filas → PGRST116 → "ya no existe".
//
// POR QUÉ soft y no DELETE (Fase 9): el ledger atribuye por usuario_comercio_id —
// `transacciones_puntos.cajero_usuario_id` y `canjes.cajero_usuario_id` son FK a usuarios_comercio(id)
// SIN ON DELETE (migración 0001). Ahora que el escáner puebla cajero_usuario_id, un DELETE físico de un
// cajero que ya operó lanzaría 23503; el soft-delete preserva ese historial. La columna `activo`
// (default true) la agregó la migración 0009.
export async function desactivarCajero(
  supabase: SupabaseClient<Database>,
  id: string,
  comercioId: string,
): Promise<ResultadoAccion> {
  const { error } = await supabase
    .from('usuarios_comercio')
    .update({ activo: false })
    .eq('id', id)
    .eq('comercio_id', comercioId)
    .eq('rol', 'cajero')
    .select('id')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return { ok: false, error: 'Ese cajero ya no existe.' };
    }
    console.error('[comercio] falló la baja del cajero:', error.message);
    return { ok: false, error: 'No se pudo dar de baja al cajero.' };
  }
  return { ok: true };
}

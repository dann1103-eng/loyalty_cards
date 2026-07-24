import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { sucursalPerteneceAComercio } from './sucursales';

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
}

export type ResultadoCajero = { ok: true; id: string } | { ok: false; error: string };
export type ResultadoAccion = { ok: true } | { ok: false; error: string };

// Validación mínima local (la BD no valida ni el formato del correo ni el largo de la contraseña).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;

// Da de alta un cajero: valida, crea (o reutiliza) la cuenta de Auth y la fila usuarios_comercio
// atada a la sucursal. El candado de seguridad —que la sucursal sea de ESTE comercio— se verifica
// ANTES de tocar Auth: si no pertenece, no se crea NADA (ni una cuenta huérfana en Auth).
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

  // Candado: la sucursal DEBE pertenecer al comercio de la sesión. Antes de crear el Auth user.
  const perteneceSucursal = await sucursalPerteneceAComercio(supabase, sucursalId, comercioId);
  if (!perteneceSucursal) return { ok: false, error: 'Esa sucursal no es de tu comercio.' };

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

// Lista los cajeros del comercio con el nombre de su sucursal (join embebido por sucursal_id).
// Devuelve null ante un ERROR de BD (distinto de [] = "no hay cajeros"), igual que listarSucursales:
// sin esa distinción la página mostraría el vacío ante un fallo transitorio, invitando a duplicar.
export async function listarCajeros(
  supabase: SupabaseClient<Database>,
  comercioId: string,
): Promise<CajeroListado[] | null> {
  const { data, error } = await supabase
    .from('usuarios_comercio')
    .select('id, email, sucursal_id, sucursales(nombre)')
    .eq('comercio_id', comercioId)
    .eq('rol', 'cajero')
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
  }));
}

// Da de baja a un cajero borrando su fila usuarios_comercio: la cuenta de Auth sigue existiendo pero
// pierde la membresía → pierde el acceso. Scopeado por comercio_id (del gate) y por rol='cajero' para
// que esta ruta nunca pueda borrar a un owner. id de otro comercio → 0 filas → PGRST116 → "ya no existe".
//
// OJO (deuda conocida, se resuelve en Fase 9): el ledger SÍ atribuye por usuario_comercio_id —
// `transacciones_puntos.cajero_usuario_id` y `canjes.cajero_usuario_id` son FK a usuarios_comercio(id)
// SIN ON DELETE (migración 0001). HOY esas columnas están VACÍAS (nadie las escribe todavía), así que
// el DELETE siempre funciona. Cuando la Fase 9 empiece a poblar cajero_usuario_id, dar de baja a un
// cajero que ya operó lanzaría 23503 (abajo se traduce a un mensaje claro). Por eso la Fase 9 cambia
// esto a SOFT-delete (columna usuarios_comercio.activo en la migración 0009) ANTES de escribir la
// atribución — así se preserva el historial del ledger, igual que el soft-delete de sucursales.
export async function desactivarCajero(
  supabase: SupabaseClient<Database>,
  id: string,
  comercioId: string,
): Promise<ResultadoAccion> {
  const { error } = await supabase
    .from('usuarios_comercio')
    .delete()
    .eq('id', id)
    .eq('comercio_id', comercioId)
    .eq('rol', 'cajero')
    .select('id')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return { ok: false, error: 'Ese cajero ya no existe.' };
    }
    if (error.code === '23503') {
      // El cajero ya registró operaciones (el ledger lo referencia). Hasta que la Fase 9 introduzca
      // el soft-delete, no se puede borrar sin perder ese historial — mensaje claro en vez de genérico.
      return { ok: false, error: 'Este cajero ya registró operaciones y no se puede eliminar todavía.' };
    }
    console.error('[comercio] falló la baja del cajero:', error.message);
    return { ok: false, error: 'No se pudo dar de baja al cajero.' };
  }
  return { ok: true };
}

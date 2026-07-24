import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

export type ResultadoCuenta =
  | { ok: true; id: string }
  | { ok: false; error: string };

// ¿Cabe un negocio más en esta cuenta? El límite (cuentas_comercio.limite_negocios) se APLICA
// aquí, en la capa app — la BD solo garantiza el rango del propio límite con un CHECK, no cuántos
// comercios lo respetan. Se cuenta con head:true (sin traer filas) los comercios con este
// cuenta_id; `excluyendoComercioId` deja fuera del conteo al comercio que se está reasignando a su
// PROPIA cuenta (editar sin moverlo no debe contar contra su cupo).
export async function verificarLimiteCuenta(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
  opciones?: { excluyendoComercioId?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: cuenta, error: eCuenta } = await supabase
    .from('cuentas_comercio').select('limite_negocios').eq('id', cuentaId).maybeSingle();
  if (eCuenta) { console.error('[fm] no se pudo leer la cuenta:', eCuenta); return { ok: false, error: 'No se pudo verificar el límite de la cuenta.' }; }
  if (!cuenta) return { ok: false, error: 'La cuenta no existe.' };

  let q = supabase.from('comercios').select('id', { count: 'exact', head: true }).eq('cuenta_id', cuentaId);
  if (opciones?.excluyendoComercioId) q = q.neq('id', opciones.excluyendoComercioId);
  const { count, error } = await q;
  if (error) { console.error('[fm] no se pudo contar comercios de la cuenta:', error); return { ok: false, error: 'No se pudo verificar el límite de la cuenta.' }; }

  if ((count ?? 0) >= cuenta.limite_negocios) {
    return { ok: false, error: `Esta cuenta ya alcanzó su límite de ${cuenta.limite_negocios} negocio(s).` };
  }
  return { ok: true };
}

// Valida en la capa lib (única capa con tests), igual que guardarComercio.ts: la BD solo respalda
// el rango del límite con un CHECK, no el nombre.
function validarDatosCuenta(nombre: string, limiteNegocios: number): string | null {
  if (!nombre) return 'El nombre de la cuenta es obligatorio.';
  if (!Number.isInteger(limiteNegocios) || limiteNegocios < 1) {
    return 'El límite de negocios debe ser un número entero mayor o igual a 1.';
  }
  return null;
}

export async function crearCuenta(
  supabase: SupabaseClient<Database>,
  datos: { nombre: string; limiteNegocios: number },
): Promise<ResultadoCuenta> {
  const nombre = datos.nombre.trim();
  const problema = validarDatosCuenta(nombre, datos.limiteNegocios);
  if (problema) return { ok: false, error: problema };

  const { data, error } = await supabase
    .from('cuentas_comercio')
    .insert({ nombre, limite_negocios: datos.limiteNegocios })
    .select('id')
    .single();

  if (error) {
    console.error('[fm] falló el insert de cuenta:', error);
    return { ok: false, error: 'No se pudo crear la cuenta.' };
  }
  return { ok: true, id: data.id };
}

export async function actualizarCuenta(
  supabase: SupabaseClient<Database>,
  id: string,
  datos: { nombre: string; limiteNegocios: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const nombre = datos.nombre.trim();
  const problema = validarDatosCuenta(nombre, datos.limiteNegocios);
  if (problema) return { ok: false, error: problema };

  const { error } = await supabase
    .from('cuentas_comercio')
    .update({ nombre, limite_negocios: datos.limiteNegocios })
    .eq('id', id)
    .select('id')
    .single();

  if (error) {
    // PGRST116 = la consulta no devolvió exactamente una fila (mismo patrón que actualizarComercio):
    // el .select('id').single() convierte un update que no tocó nada en un error explícito en vez
    // de un ok:true habiendo escrito cero.
    if (error.code === 'PGRST116') {
      return { ok: false, error: 'Esa cuenta ya no existe.' };
    }
    console.error('[fm] falló el update de cuenta:', error);
    return { ok: false, error: 'No se pudo actualizar la cuenta.' };
  }
  return { ok: true };
}

// Reasigna un comercio a otra cuenta, respetando el límite de la cuenta DESTINO. Excluye el propio
// comercio del conteo para que reguardarlo en su cuenta actual nunca se bloquee a sí mismo.
export async function asignarComercioACuenta(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  cuentaId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const limite = await verificarLimiteCuenta(supabase, cuentaId, { excluyendoComercioId: comercioId });
  if (!limite.ok) return limite;

  const { error } = await supabase
    .from('comercios')
    .update({ cuenta_id: cuentaId })
    .eq('id', comercioId)
    .select('id')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return { ok: false, error: 'Ese comercio ya no existe.' };
    }
    console.error('[fm] falló la reasignación de comercio a cuenta:', error);
    return { ok: false, error: 'No se pudo reasignar el comercio a la cuenta.' };
  }
  return { ok: true };
}

// comercios.cuenta_id apunta aquí SIN cascada (migración 0008), así que borrar una cuenta con
// negocios asignados da un 23503 — igual que eliminarComercio, solo traducimos ese código a un
// mensaje legible y dejamos que Postgres sea quien haga cumplir la regla (fuente única de verdad).
export async function eliminarCuenta(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from('cuentas_comercio').delete().eq('id', id);

  if (error) {
    if (error.code === '23503') {
      return {
        ok: false,
        error: 'No se puede eliminar: la cuenta todavía tiene negocios asignados. Reasigná o eliminá esos negocios primero.',
      };
    }
    console.error('[fm] falló el borrado de cuenta:', error);
    return { ok: false, error: 'No se pudo eliminar la cuenta.' };
  }

  return { ok: true };
}

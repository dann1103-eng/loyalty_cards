import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

// Catálogo de planes de Cardly (fm-ai-website.vercel.app/productos/cardly). Fuente única de verdad
// de nombre/monto/límite sugerido: el <select> de FormularioCuenta se construye desde esta MISMA
// constante para que el formulario y el validador no puedan divergir (mismo patrón que
// TIPOS_TARJETA en guardarComercio.ts). `limiteSugerido: null` en 'pro' = sin tope — ver
// verificarLimiteCuenta más abajo.
export const PLANES = [
  { valor: 'starter', etiqueta: 'Starter', montoMensual: 29, limiteSugerido: 1 },
  { valor: 'growth', etiqueta: 'Growth', montoMensual: 49, limiteSugerido: 2 },
  { valor: 'pro', etiqueta: 'Pro', montoMensual: 89, limiteSugerido: null },
] as const;
export type Plan = (typeof PLANES)[number]['valor'];

// Fuente única de verdad: la BD tiene check (licencia_estado in ('activo','inactivo')) en la
// migración 0011 (antes vivía en comercios, migración 0003 — Fase 6 la movió acá).
export const ESTADOS_LICENCIA = ['activo', 'inactivo'] as const;
export type EstadoLicencia = (typeof ESTADOS_LICENCIA)[number];

export interface DatosCuenta {
  nombre: string;
  // null = sin límite (Pro). La capa app (validarDatosCuenta) es la única defensa del rango — la
  // BD solo garantiza limite_negocios > 0 CUANDO no es null (migración 0011).
  limiteNegocios: number | null;
  plan: string;
  licenciaEstado: string;
  licenciaMontoMensual: number | null;
  licenciaActivaDesde: string | null;
}

export type ResultadoCuenta =
  | { ok: true; id: string }
  | { ok: false; error: string };

// ¿Es una fecha real en formato AAAA-MM-DD? Movida acá desde guardarComercio.ts (Fase 6): licencia_
// activa_desde ahora es de la cuenta, no del comercio. Ver el comentario original en el historial
// de guardarComercio.ts para el detalle de por qué existe el (?!0000) y el round-trip.
function esFechaValida(valor: string): boolean {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}

function validarDatosCuenta(datos: DatosCuenta): string | null {
  if (!datos.nombre) return 'El nombre de la cuenta es obligatorio.';
  if (datos.limiteNegocios !== null && (!Number.isInteger(datos.limiteNegocios) || datos.limiteNegocios < 1)) {
    return 'El límite de negocios/sucursales debe ser un número entero mayor o igual a 1 (o vacío para "sin límite").';
  }
  if (!(PLANES as readonly { valor: string }[]).some((p) => p.valor === datos.plan)) {
    return 'El plan no es válido.';
  }
  if (!(ESTADOS_LICENCIA as readonly string[]).includes(datos.licenciaEstado)) {
    return 'El estado de la licencia debe ser "activo" o "inactivo".';
  }
  const monto = datos.licenciaMontoMensual;
  if (monto !== null && !Number.isFinite(monto)) return 'El monto mensual debe ser un número.';
  if (monto !== null && monto < 0) return 'El monto mensual no puede ser negativo.';
  const fecha = datos.licenciaActivaDesde;
  if (fecha !== null && !esFechaValida(fecha)) {
    return 'La fecha de inicio de la licencia debe ser una fecha real en formato AAAA-MM-DD.';
  }
  return null;
}

// Conteo compartido de unidades de una cuenta: comercios + sucursales ADICIONALES. La sucursal
// PRINCIPAL de cada comercio no consume cupo (0012: representa el mismo local que el comercio —
// sin esta exclusión, una cuenta Starter con su comercio y su Principal ya estaría 2/1 y el
// callejón "Starter sin cajeros" volvería). Lo usan verificarLimiteCuenta (aplicar el tope) y
// cupoDeCuenta (mostrarlo): UNA implementación — dos copias divergirían.
//
// El límite cubre comercios DISTINTOS y SUCURSALES juntos (decisión revisada 2026-07-25 — antes
// solo contaba comercios; QA manual sobre "Verde Raíz" encontró que las sucursales no tenían
// NINGÚN tope). sucursales no tiene cuenta_id directo (solo comercio_id), así que se cuentan vía
// los ids de comercio de esta cuenta.
// Exportado: la UI (página Sucursales, switcher de comercio) recibe el cupo como prop y necesita
// poder nombrar este tipo.
export type ConteoUnidades =
  | { ok: true; limite: number | null; usadas: number }
  | { ok: false; error: string };

async function contarUnidadesCuenta(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
  excluyendoComercioId?: string,
): Promise<ConteoUnidades> {
  const { data: cuenta, error: eCuenta } = await supabase
    .from('cuentas_comercio').select('limite_negocios').eq('id', cuentaId).maybeSingle();
  if (eCuenta) { console.error('[fm] no se pudo leer la cuenta:', eCuenta); return { ok: false, error: 'No se pudo verificar el límite de la cuenta.' }; }
  if (!cuenta) return { ok: false, error: 'La cuenta no existe.' };

  // count Y data en la misma llamada: count trae el total de comercios de la cuenta, data trae sus
  // ids (para contar sucursales vía el .in() de abajo) — un solo round-trip para las dos cosas.
  let qComercios = supabase.from('comercios').select('id', { count: 'exact' }).eq('cuenta_id', cuentaId);
  if (excluyendoComercioId) qComercios = qComercios.neq('id', excluyendoComercioId);
  const { data: comerciosDeCuenta, count: countComercios, error: eComercios } = await qComercios;
  if (eComercios) { console.error('[fm] no se pudo contar comercios de la cuenta:', eComercios); return { ok: false, error: 'No se pudo verificar el límite de la cuenta.' }; }

  let countSucursales = 0;
  const ids = (comerciosDeCuenta ?? []).map((c) => c.id);
  if (ids.length > 0) {
    const { count, error: eSucursales } = await supabase
      .from('sucursales').select('id', { count: 'exact', head: true })
      .in('comercio_id', ids)
      .eq('es_principal', false); // CONTROL: la principal es gratis; las adicionales consumen cupo
    if (eSucursales) { console.error('[fm] no se pudo contar sucursales de la cuenta:', eSucursales); return { ok: false, error: 'No se pudo verificar el límite de la cuenta.' }; }
    countSucursales = count ?? 0;
  }

  return { ok: true, limite: cuenta.limite_negocios, usadas: (countComercios ?? 0) + countSucursales };
}

// Cupo para la UI (página Sucursales, switcher): cuántas unidades usa la cuenta y cuál es su tope.
// `limite: null` = sin tope (Pro). NO aplica el tope — eso es de verificarLimiteCuenta.
export async function cupoDeCuenta(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
): Promise<ConteoUnidades> {
  return contarUnidadesCuenta(supabase, cuentaId);
}

// ¿Cabe un negocio/sucursal más en esta cuenta? El límite se APLICA acá, en la capa app —
// la BD solo garantiza el rango del propio límite (o que sea null) con un CHECK, no cuántas filas
// lo respetan.
//
// `unidadesAAgregar` (default 1): cuántas unidades va a sumar la operación que está preguntando.
// Un alta nueva (comercio o sucursal) siempre agrega 1. PERO mover un comercio EXISTENTE a esta
// cuenta (asignarComercioACuenta) no solo agrega el comercio: también arrastra sus propias
// sucursales, que hasta el momento del move NO están bajo cuenta_id=cuentaId (así que
// excluyendoComercioId no las excluye — nunca se contaron, ni tampoco llegan a sumarse solas). Sin
// este parámetro, mover un comercio con sucursales a una cuenta casi llena la deja MUY por encima
// de su límite sin ningún bloqueo — el mismo tipo de hueco que este fix existe para cerrar.
export async function verificarLimiteCuenta(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
  opciones?: { excluyendoComercioId?: string; unidadesAAgregar?: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const conteo = await contarUnidadesCuenta(supabase, cuentaId, opciones?.excluyendoComercioId);
  if (!conteo.ok) return conteo;

  // null = plan sin tope (Pro): nada que aplicar.
  if (conteo.limite === null) return { ok: true };

  const unidades = opciones?.unidadesAAgregar ?? 1;
  if (conteo.usadas + unidades > conteo.limite) {
    return { ok: false, error: `Esta cuenta ya alcanzó su límite de ${conteo.limite} negocio(s)/sucursal(es).` };
  }
  return { ok: true };
}

export async function crearCuenta(
  supabase: SupabaseClient<Database>,
  datos: DatosCuenta,
): Promise<ResultadoCuenta> {
  const nombre = datos.nombre.trim();
  const limpios: DatosCuenta = { ...datos, nombre };
  const problema = validarDatosCuenta(limpios);
  if (problema) return { ok: false, error: problema };

  const { data, error } = await supabase
    .from('cuentas_comercio')
    .insert({
      nombre: limpios.nombre,
      limite_negocios: limpios.limiteNegocios,
      plan: limpios.plan,
      licencia_estado: limpios.licenciaEstado,
      licencia_monto_mensual: limpios.licenciaMontoMensual,
      licencia_activa_desde: limpios.licenciaActivaDesde,
    })
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
  datos: DatosCuenta,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const nombre = datos.nombre.trim();
  const limpios: DatosCuenta = { ...datos, nombre };
  const problema = validarDatosCuenta(limpios);
  if (problema) return { ok: false, error: problema };

  const { error } = await supabase
    .from('cuentas_comercio')
    .update({
      nombre: limpios.nombre,
      limite_negocios: limpios.limiteNegocios,
      plan: limpios.plan,
      licencia_estado: limpios.licenciaEstado,
      licencia_monto_mensual: limpios.licenciaMontoMensual,
      licencia_activa_desde: limpios.licenciaActivaDesde,
    })
    .eq('id', id)
    .select('id')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return { ok: false, error: 'Esa cuenta ya no existe.' };
    }
    console.error('[fm] falló el update de cuenta:', error);
    return { ok: false, error: 'No se pudo actualizar la cuenta.' };
  }
  return { ok: true };
}

// Reasigna un comercio a otra cuenta, respetando el límite combinado de la cuenta DESTINO. El
// comercio movido trae SUS PROPIAS sucursales con él — hay que contarlas y pasarlas como
// unidadesAAgregar (1 por el comercio + N por sus sucursales), porque en el momento de este
// chequeo esas sucursales todavía cuelgan del comercio con su cuenta_id VIEJO: el conteo interno
// de verificarLimiteCuenta (que solo mira comercios YA en cuentaId) nunca las ve.
export async function asignarComercioACuenta(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  cuentaId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { count: sucursalesPropias, error: eSucursales } = await supabase
    .from('sucursales').select('id', { count: 'exact', head: true }).eq('comercio_id', comercioId)
    .eq('es_principal', false); // CONTROL: la principal viaja gratis con su comercio
  if (eSucursales) {
    console.error('[fm] no se pudo contar las sucursales del comercio a reasignar:', eSucursales);
    return { ok: false, error: 'No se pudo reasignar el comercio a la cuenta.' };
  }

  const limite = await verificarLimiteCuenta(supabase, cuentaId, {
    excluyendoComercioId: comercioId,
    unidadesAAgregar: 1 + (sucursalesPropias ?? 0),
  });
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

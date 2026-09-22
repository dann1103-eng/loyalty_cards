import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { estadoEfectivo, type EstadoCobranza } from '../comercios/cobranza';
import type { PeriodoPagado } from '../comercios/prorrateo';
import { fusionarActividad, type EventoActividad } from './actividad';

// Capa de datos del dashboard de FM (`/admin`, spec 2026-09-21-rework-admin-comercio-design.md, "El
// dashboard"). Sin JSX — mismo criterio que `reporteCajeros` (lib/reportes/reportes.ts): `null` ante
// un error, NUNCA un cero falso. Es la EXCEPCIÓN deliberada al fail-soft del resto de reportes.ts
// (que devuelve `[]`), elegida a propósito acá también: un dashboard con un cero falso engaña
// exactamente igual que un reporte de auditoría vacío.

// El primer día del mes de `hoy` (AAAA-MM-DD → AAAA-MM-01). Se calcula a partir del `hoy` que
// RECIBE la función, nunca de `new Date()`: mismo criterio de fechas-como-parámetro que el resto del
// proyecto (prorrateo.ts, cobranza.ts) — quien llama calcula `hoy` con `hoyEnZona(null)`
// (lib/tarjetas/vigencia.ts, zona El Salvador) y se lo pasa.
function primerDiaDelMes(hoy: string): string {
  return `${hoy.slice(0, 7)}-01`;
}

// Suma de `cobros.monto` con `estado = 'pagado'` y `pagado_en` entre el primero del mes de `hoy` y
// `hoy`, inclusive. `null` ante cualquier error de lectura (nunca 0, que sería un ingreso falso).
export async function ingresosDelMes(supabase: SupabaseClient<Database>, hoy: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('cobros')
    .select('monto')
    .eq('estado', 'pagado')
    .gte('pagado_en', primerDiaDelMes(hoy))
    .lte('pagado_en', hoy);
  if (error) {
    console.error('[fm/dashboard] no se pudieron leer los ingresos del mes:', error);
    return null;
  }
  return (data ?? []).reduce((total, fila) => total + Number(fila.monto), 0);
}

export interface TamanoCartera {
  cuentas: number;
  comercios: number;
  clientes: number;
}

// Tres conteos directos (`select('id', { count: 'exact', head: true })`).
//
// `clientes` es un `count` DIRECTO sobre la tabla `clientes`, NO un "distinct sobre
// tarjetas.cliente_id" (que la spec deja como duda a confirmar): `lib/clientes/registrarCliente.ts`
// es el ÚNICO camino de producción que crea una fila de `clientes`, y SIEMPRE la crea junto con al
// menos una `tarjeta` en la misma operación; no hay ningún camino de producción que borre una
// `tarjeta` dejando huérfano su `cliente`. Por lo tanto `count(clientes)` es exactamente igual a
// `count(distinct tarjetas.cliente_id)`, y es más barato (sin agregación). Verificado contra el
// esquema real al escribir esta función (2026-09-22) — si algún día aparece un camino que cree un
// `cliente` sin `tarjeta`, o que borre la última tarjeta de un cliente sin borrar al cliente, hay que
// volver a mirar este atajo antes de seguir confiando en él.
//
// Si CUALQUIERA de los 3 conteos falla, devuelve `null` (nunca un objeto parcial: un tamaño de
// cartera a medias es tan engañoso como uno en cero).
export async function tamanoDeCartera(supabase: SupabaseClient<Database>): Promise<TamanoCartera | null> {
  const [cuentas, comercios, clientes] = await Promise.all([
    supabase.from('cuentas_comercio').select('id', { count: 'exact', head: true }),
    supabase.from('comercios').select('id', { count: 'exact', head: true }),
    supabase.from('clientes').select('id', { count: 'exact', head: true }),
  ]);
  if (cuentas.error || comercios.error || clientes.error) {
    console.error(
      '[fm/dashboard] no se pudo contar el tamaño de la cartera:',
      cuentas.error,
      comercios.error,
      clientes.error,
    );
    return null;
  }
  return { cuentas: cuentas.count ?? 0, comercios: comercios.count ?? 0, clientes: clientes.count ?? 0 };
}

// Mismo criterio EXACTO que `contarPagosAtencion` (lib/comercios/pagosAdmin.ts).
export async function contarSolicitudesPendientes(supabase: SupabaseClient<Database>): Promise<number | null> {
  const { count, error } = await supabase
    .from('solicitudes_plan')
    .select('id', { count: 'exact', head: true })
    .eq('estado', 'pendiente');
  if (error) {
    console.error('[fm/dashboard] no se pudieron contar las solicitudes pendientes:', error);
    return null;
  }
  return count ?? 0;
}

// Junta 5 filas de cada una de las tres fuentes y llama a la función PURA `fusionarActividad`
// (actividad.ts) para ordenar y recortar el total a `limite`. `null` si CUALQUIERA de las tres
// consultas falla: una actividad a medias es peor que ninguna — parecería que no pasó nada.
export async function actividadReciente(
  supabase: SupabaseClient<Database>,
  limite: number,
): Promise<EventoActividad[] | null> {
  const [pagos, cuentas, solicitudes] = await Promise.all([
    supabase
      .from('pagos_wompi')
      .select('created_at, monto, cuenta_id, cuentas_comercio(nombre)')
      .eq('conciliacion', 'aplicado')
      .order('created_at', { ascending: false })
      .limit(5),
    supabase.from('cuentas_comercio').select('id, nombre, created_at').order('created_at', { ascending: false }).limit(5),
    supabase
      .from('solicitudes_plan')
      .select('created_at, plan_solicitado, cuenta_id, cuentas_comercio(nombre)')
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  if (pagos.error || cuentas.error || solicitudes.error) {
    console.error('[fm/dashboard] no se pudo leer la actividad reciente:', pagos.error, cuentas.error, solicitudes.error);
    return null;
  }

  const eventos: EventoActividad[] = [
    ...(pagos.data ?? []).map(
      (f): EventoActividad => ({
        tipo: 'pago',
        fecha: f.created_at,
        cuentaNombre: f.cuentas_comercio?.nombre ?? null,
        monto: Number(f.monto),
        cuentaId: f.cuenta_id,
      }),
    ),
    ...(cuentas.data ?? []).map(
      (f): EventoActividad => ({
        tipo: 'cuenta_nueva',
        fecha: f.created_at,
        cuentaNombre: f.nombre,
        cuentaId: f.id,
      }),
    ),
    ...(solicitudes.data ?? []).map(
      (f): EventoActividad => ({
        tipo: 'solicitud',
        fecha: f.created_at,
        cuentaNombre: f.cuentas_comercio?.nombre ?? null,
        planSolicitado: f.plan_solicitado,
        cuentaId: f.cuenta_id,
      }),
    ),
  ];

  return fusionarActividad(eventos, limite);
}

// El estado de cobranza EFECTIVO de CADA cuenta, en un mapa `cuenta_id → EstadoCobranza` (migración
// 0038 aplicada, Tarea 11). DOS consultas (no una por cuenta): una trae TODAS las cuentas con sus
// columnas de cobranza + `licencia_estado`, la otra trae TODOS los cobros `pagado`/`periodo` de una
// vez y arma un mapa `cuenta_id → periodosPagados[]` en memoria, antes de llamar a `estadoEfectivo`
// por cuenta. `null` ante cualquier error de las dos consultas.
//
// Compartida por `contarCuentasEnRiesgo` (abajo) y la lista de cuentas del admin
// (app/admin/(protegido)/cuentas/page.tsx): las dos necesitan el estado de TODAS las cuentas a la
// vez, así que separarla evita que cada pantalla repita las mismas dos consultas y el mismo armado
// de mapa — antes vivía duplicada dentro de `contarCuentasEnRiesgo` únicamente.
export async function estadosDeCobranzaPorCuenta(
  supabase: SupabaseClient<Database>,
  hoy: string,
): Promise<Map<string, EstadoCobranza> | null> {
  const [cuentas, cobros] = await Promise.all([
    supabase.from('cuentas_comercio').select('id, cobranza, cobranza_desde, cobranza_pospuesta_hasta, licencia_estado'),
    supabase.from('cobros').select('cuenta_id, periodo_desde, periodo_hasta').eq('tipo', 'periodo').eq('estado', 'pagado'),
  ]);

  if (cuentas.error || cobros.error) {
    console.error('[fm/dashboard] no se pudo leer el estado de cobranza por cuenta:', cuentas.error, cobros.error);
    return null;
  }

  const periodosPorCuenta = new Map<string, PeriodoPagado[]>();
  for (const c of cobros.data ?? []) {
    const lista = periodosPorCuenta.get(c.cuenta_id) ?? [];
    lista.push({ desde: c.periodo_desde, hasta: c.periodo_hasta });
    periodosPorCuenta.set(c.cuenta_id, lista);
  }

  const estados = new Map<string, EstadoCobranza>();
  for (const cuenta of cuentas.data ?? []) {
    estados.set(
      cuenta.id,
      estadoEfectivo({
        cobranza: cuenta.cobranza as 'normal' | 'exenta',
        desde: cuenta.cobranza_desde,
        pospuestaHasta: cuenta.cobranza_pospuesta_hasta,
        periodosPagados: periodosPorCuenta.get(cuenta.id) ?? [],
        hoy,
        licenciaEstado: cuenta.licencia_estado,
      }),
    );
  }

  return estados;
}

// "Cuentas vencidas o bloqueadas": cuenta las que `estadoEfectivo` da `vencida` O `bloqueada` (las
// dos cuentan, no solo las ya bloqueadas). `null` ante cualquier error de `estadosDeCobranzaPorCuenta`
// — mismo criterio de "nunca un cero falso" que el resto de este archivo.
export async function contarCuentasEnRiesgo(supabase: SupabaseClient<Database>, hoy: string): Promise<number | null> {
  const estados = await estadosDeCobranzaPorCuenta(supabase, hoy);
  if (estados === null) return null;

  let enRiesgo = 0;
  for (const estado of estados.values()) {
    if (estado.tipo === 'vencida' || estado.tipo === 'bloqueada') enRiesgo++;
  }

  return enRiesgo;
}

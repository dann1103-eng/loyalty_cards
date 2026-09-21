import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '../supabase/server';
import type { Database } from '../supabase/types';
import { hoyEnZona } from '../tarjetas/vigencia';
import { clienteWompi } from '../wompi/cliente';
import {
  anularCobroPendiente,
  anularIntentosPendientes,
  crearCobroPendiente,
  guardarEnlaceDelCobro,
  listarPeriodosPagados,
  obtenerIntentoAbierto,
} from './cobros';
import { cupoDeCuenta } from './cuentas';
import {
  iniciarPagoPlan,
  type RepositorioIniciarPago,
  type ResultadoIniciarPago,
} from './iniciarPagoPlan';
import type { AccionPago, CuentaParaPagos } from './opcionesPago';

// El cableado REAL de `iniciarPagoPlan` (iniciarPagoPlan.ts): la base, la API de Wompi y el reloj.

// Todo lo que `opcionesPago.ts` necesita saber de la cuenta, leído de la base. `null` ante CUALQUIER
// falla de lectura: con un dato a medias (los períodos pagados en una lista vacía, o el cupo en cero) se
// ofrecería pagar de nuevo un mes ya pagado, o un plan que no cabe.
export async function cargarCuentaParaPagos(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
): Promise<CuentaParaPagos | null> {
  const { data: cuenta, error } = await supabase
    .from('cuentas_comercio')
    .select('plan, licencia_monto_mensual, limite_negocios')
    .eq('id', cuentaId)
    .maybeSingle();
  if (error || !cuenta) {
    if (error) console.error('[pagos] no se pudo leer la cuenta:', error);
    return null;
  }

  const [cupo, periodos] = await Promise.all([
    cupoDeCuenta(supabase, cuentaId),
    listarPeriodosPagados(supabase, cuentaId),
  ]);
  if (!cupo.ok || periodos === null) return null;

  return {
    plan: cuenta.plan,
    // numeric de Postgres puede llegar como texto según el driver.
    precioActual: cuenta.licencia_monto_mensual === null ? null : Number(cuenta.licencia_monto_mensual),
    limite: cuenta.limite_negocios,
    unidadesUsadas: cupo.usadas,
    periodosPagados: periodos,
  };
}

export function repositorioIniciarPagoSupabase(supabase: SupabaseClient<Database>): RepositorioIniciarPago {
  return {
    cargarCuenta: (cuentaId) => cargarCuentaParaPagos(supabase, cuentaId),
    intentoAbierto: (cuentaId) => obtenerIntentoAbierto(supabase, cuentaId),
    anularIntentos: (cuentaId) => anularIntentosPendientes(supabase, cuentaId),
    crearCobro: (cuentaId, datos) => crearCobroPendiente(supabase, cuentaId, datos),
    guardarEnlace: (cobroId, enlace) => guardarEnlaceDelCobro(supabase, cobroId, enlace),
    anularCobro: (cobroId) => anularCobroPendiente(supabase, cobroId),
  };
}

// `https://www.cardly-sv.site`, sin barra final. Sin ella los enlaces apuntarían a "undefined/...".
export function baseUrlDeLaApp(): string {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '');
  if (!baseUrl) throw new Error('NEXT_PUBLIC_BASE_URL no está configurada — requerida para los enlaces de pago');
  return baseUrl;
}

export async function iniciarPagoPlanDelDueno(
  cuentaId: string,
  plan: string,
  accion: AccionPago,
): Promise<ResultadoIniciarPago> {
  return iniciarPagoPlan(
    {
      repo: repositorioIniciarPagoSupabase(createServiceClient()),
      wompi: clienteWompi(),
      ahora: () => new Date(),
      fechaDe: (instante) => hoyEnZona(null, instante),
      baseUrl: baseUrlDeLaApp(),
    },
    { cuentaId, plan, accion },
  );
}

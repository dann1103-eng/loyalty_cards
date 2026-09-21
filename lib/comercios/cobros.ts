import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import type { CobroParaPago } from './confirmarPago';
import type { IntentoAbierto, ResultadoCrearCobro } from './iniciarPagoPlan';
import type { PeriodoPagado } from './prorrateo';

// Seguimiento de cobros (migración 0017). NO es contabilidad ni facturación fiscal: sin personería
// jurídica no hay DTE, y el comprobante que se imprime lo dice en el propio documento.
//
// Lo que resuelve: hoy el comercio no tiene forma de ver qué pagó y cuándo, y FM lleva ese registro
// fuera del sistema.

export const ESTADOS_COBRO = ['pendiente', 'pagado', 'anulado'] as const;

export interface Cobro {
  id: string;
  numero: number;
  cuentaId: string;
  periodoDesde: string;
  periodoHasta: string;
  monto: number;
  estado: string;
  metodo: string | null;
  nota: string | null;
  pagadoEn: string | null;
  // Migración 0037. 'periodo' = un mes completo; 'ajuste' = la diferencia prorrateada de subir de plan.
  tipo: 'periodo' | 'ajuste';
  planDestino: string | null;
  wompiIdEnlace: number | null;
  wompiUrlEnlace: string | null;
  wompiEnlaceVence: string | null;
  wompiIdTransaccion: string | null;
  creadoEn: string;
  // La URL para SEGUIR este intento de pago, o null si no corresponde (ver urlParaContinuarPago). Depende
  // de la hora: se calcula al leer el cobro.
  continuarUrl: string | null;
}

export interface DatosCobro {
  periodoDesde: string;
  periodoHasta: string;
  monto: number;
  estado: string;
  metodo: string | null;
  nota: string | null;
  pagadoEn: string | null;
}

export type ResultadoCobro = { ok: true } | { ok: false; error: string };

// El alta devuelve el id del cobro creado: quien registra un pago lo necesita para avisarle a Meta
// (Subscribe, ver lib/marketing/conversionesMeta.ts) con un `event_id` que no se repita.
export type ResultadoRegistroCobro = { ok: true; id: string } | { ok: false; error: string };

const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function validarCobro(datos: DatosCobro): string | null {
  if (!FORMATO_FECHA.test(datos.periodoDesde) || !FORMATO_FECHA.test(datos.periodoHasta)) {
    return 'Las fechas del período son obligatorias.';
  }
  if (datos.periodoHasta < datos.periodoDesde) {
    return 'El período termina antes de empezar.';
  }
  if (!Number.isFinite(datos.monto) || datos.monto < 0) {
    return 'El monto debe ser un número mayor o igual que cero.';
  }
  if (!(ESTADOS_COBRO as readonly string[]).includes(datos.estado)) {
    return 'El estado del cobro no es válido.';
  }
  // Espejo del CHECK de la BD. Se valida acá también para dar el mensaje en español: sin esto el
  // dueño vería un 23514 crudo.
  if (datos.estado === 'pagado' && !datos.pagadoEn) {
    return 'Un cobro marcado como pagado necesita su fecha de pago.';
  }
  if (datos.estado !== 'pagado' && datos.pagadoEn) {
    return 'Solo un cobro pagado lleva fecha de pago.';
  }
  if (datos.pagadoEn && !FORMATO_FECHA.test(datos.pagadoEn)) {
    return 'La fecha de pago no es válida.';
  }
  return null;
}

// La validación del cobro que FM registra A MANO. Suma una regla a `validarCobro`: `metodo = 'Wompi'` +
// pendiente es lo que marca un intento de pago de LA APP (ocupa el único lugar abierto de la cuenta, la app
// lo anula al crear otro y ofrece "Marcar pagado"), así que un pendiente que FM registre con ese método se
// confundiría con uno. Uno YA PAGADO con ese método sí es válido: es como FM deja constancia de un cobro
// que hizo con un enlace de Wompi por fuera de la app.
//
// Es una función APARTE, no una regla de `validarCobro`, a propósito: `crearCobroPendiente` (el cobro que
// crea la propia app) valida con `estado: 'pendiente'` y `metodo: 'Wompi'`, y una regla compartida
// rechazaría todos los pagos de la app.
export function validarCobroManual(datos: DatosCobro): string | null {
  const problema = validarCobro(datos);
  if (problema) return problema;
  if (datos.estado === 'pendiente' && datos.metodo?.trim().toLowerCase() === METODO_WOMPI.toLowerCase()) {
    return 'El método «Wompi» lo reserva la app para los pagos que inicia el dueño. Usá otro método, o registrá el cobro ya pagado.';
  }
  return null;
}

// Los cobros que crea la app llevan este `metodo` mientras están pendientes: así se distinguen de los que
// registra FM a mano, que la app NUNCA anula ni toca (ver la sección de la pasarela, más abajo).
export const METODO_WOMPI = 'Wompi';

// Un intento de pago de la app con su enlace TODAVÍA VIGENTE se puede seguir desde el mismo cobro. Uno ya
// pagado o anulado, uno que registró FM a mano (`metodo` distinto de 'Wompi'), uno sin enlace, o uno con el
// enlace vencido, no: se vuelve a empezar desde las opciones de /comercio/plan. La hora entra por
// parámetro para poder probarlo, y porque una función de una página no puede leer el reloj.
export function urlParaContinuarPago(
  cobro: { estado: string; metodo: string | null; wompiUrlEnlace: string | null; wompiEnlaceVence: string | null },
  ahoraMs: number,
): string | null {
  if (cobro.estado !== 'pendiente' || cobro.metodo !== METODO_WOMPI) return null;
  if (cobro.wompiUrlEnlace === null || cobro.wompiEnlaceVence === null) return null;
  return new Date(cobro.wompiEnlaceVence).getTime() > ahoraMs ? cobro.wompiUrlEnlace : null;
}

function mapear(fila: Database['public']['Tables']['cobros']['Row']): Cobro {
  return {
    id: fila.id,
    numero: fila.numero,
    cuentaId: fila.cuenta_id,
    periodoDesde: fila.periodo_desde,
    periodoHasta: fila.periodo_hasta,
    // numeric de Postgres puede llegar como string según el driver: se normaliza para que la UI no
    // termine concatenando en vez de sumando.
    monto: Number(fila.monto),
    estado: fila.estado,
    metodo: fila.metodo,
    nota: fila.nota,
    pagadoEn: fila.pagado_en,
    tipo: fila.tipo === 'ajuste' ? 'ajuste' : 'periodo',
    planDestino: fila.plan_destino,
    wompiIdEnlace: fila.wompi_id_enlace,
    wompiUrlEnlace: fila.wompi_url_enlace,
    wompiEnlaceVence: fila.wompi_enlace_vence,
    wompiIdTransaccion: fila.wompi_id_transaccion,
    creadoEn: fila.created_at,
    continuarUrl: urlParaContinuarPago(
      { estado: fila.estado, metodo: fila.metodo, wompiUrlEnlace: fila.wompi_url_enlace, wompiEnlaceVence: fila.wompi_enlace_vence },
      Date.now(),
    ),
  };
}

// Devuelve `null` ante un error, no `[]`: en una pantalla de cobros, una lista vacía significa "no
// te hemos cobrado nada" — decírselo por un fallo de consulta sería peor que mostrar un error.
export async function listarCobros(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
): Promise<Cobro[] | null> {
  const { data, error } = await supabase
    .from('cobros')
    .select('*')
    .eq('cuenta_id', cuentaId)
    .order('periodo_desde', { ascending: false });

  if (error) {
    console.error('[cobros] no se pudieron leer los cobros:', error);
    return null;
  }
  return (data ?? []).map(mapear);
}

export async function obtenerCobro(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
  cobroId: string,
): Promise<Cobro | null> {
  // Scopeado por cuenta: conocer el id de un cobro ajeno no debe permitir ver el comprobante de
  // otro cliente, que lleva su nombre y sus montos.
  const { data, error } = await supabase
    .from('cobros')
    .select('*')
    .eq('id', cobroId)
    .eq('cuenta_id', cuentaId)
    .maybeSingle();

  if (error || !data) return null;
  return mapear(data);
}

export async function registrarCobro(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
  datos: DatosCobro,
): Promise<ResultadoRegistroCobro> {
  const problema = validarCobroManual(datos);
  if (problema) return { ok: false, error: problema };

  const { data, error } = await supabase.from('cobros').insert({
    cuenta_id: cuentaId,
    periodo_desde: datos.periodoDesde,
    periodo_hasta: datos.periodoHasta,
    monto: datos.monto,
    estado: datos.estado,
    metodo: datos.metodo?.trim() || null,
    nota: datos.nota?.trim() || null,
    pagado_en: datos.pagadoEn,
  }).select('id').single();

  if (error || !data) {
    console.error('[cobros] no se pudo registrar el cobro:', error);
    return { ok: false, error: 'No se pudo registrar el cobro.' };
  }
  return { ok: true, id: data.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pasarela Wompi (migración 0037)
// ─────────────────────────────────────────────────────────────────────────────
// Los cobros que crea la app llevan `metodo = 'Wompi'` mientras están pendientes: así se distinguen de
// los que registra FM a mano, que la app NUNCA anula ni toca. El índice único parcial
// `cobros_un_intento_pendiente` garantiza como máximo uno abierto por cuenta.
//
// Reemplaza a `marcarCobroPagado`, que nadie llamaba y actualizaba SIN condición de estado: podía
// "pagar" un cobro anulado o pisar la fecha de uno ya pagado, y no aplicaba el plan ni avisaba a Meta.
// El camino de pago es `reclamarCobroPagado`, llamado por `confirmarPagoCobro` (confirmarPago.ts).

export async function crearCobroPendiente(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
  datos: {
    tipo: 'periodo' | 'ajuste';
    periodoDesde: string;
    periodoHasta: string;
    monto: number;
    planDestino: string;
    nota: string | null;
  },
): Promise<ResultadoCrearCobro> {
  const problema = validarCobro({
    periodoDesde: datos.periodoDesde,
    periodoHasta: datos.periodoHasta,
    monto: datos.monto,
    estado: 'pendiente',
    metodo: METODO_WOMPI,
    nota: datos.nota,
    pagadoEn: null,
  });
  if (problema) return { ok: false, error: problema };

  const { data, error } = await supabase
    .from('cobros')
    .insert({
      cuenta_id: cuentaId,
      tipo: datos.tipo,
      periodo_desde: datos.periodoDesde,
      periodo_hasta: datos.periodoHasta,
      monto: datos.monto,
      estado: 'pendiente',
      metodo: METODO_WOMPI,
      plan_destino: datos.planDestino,
      nota: datos.nota,
    })
    .select('id')
    .single();

  // 23505 = el índice único parcial de "un solo intento abierto por cuenta": dos toques a la vez, o dos
  // pestañas. No es un fallo, es la regla haciendo su trabajo.
  if (error?.code === '23505') {
    return { ok: false, error: 'Ya hay un pago en curso.', intentoAbierto: true };
  }
  if (error || !data) {
    console.error('[cobros] no se pudo crear el cobro pendiente:', error);
    return { ok: false, error: 'No se pudo registrar el cobro.' };
  }
  return { ok: true, id: data.id };
}

// LANZA si falla: quien llama (iniciarPagoPlan) lo trata como "no se pudo generar el enlace".
export async function guardarEnlaceDelCobro(
  supabase: SupabaseClient<Database>,
  cobroId: string,
  enlace: { idEnlace: number; url: string; vence: string },
): Promise<void> {
  const { error } = await supabase
    .from('cobros')
    .update({ wompi_id_enlace: enlace.idEnlace, wompi_url_enlace: enlace.url, wompi_enlace_vence: enlace.vence })
    .eq('id', cobroId);
  if (error) throw new Error(`No se pudo guardar el enlace del cobro: ${error.message}`);
}

// Anula los intentos pendientes de la APP de una cuenta (`metodo = 'Wompi'`), nunca los de FM. Un pago
// que llegue después a uno de estos cobros queda como `cobro_anulado` en /admin/pagos.
export async function anularIntentosPendientes(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
): Promise<void> {
  const { error } = await supabase
    .from('cobros')
    .update({ estado: 'anulado' })
    .eq('cuenta_id', cuentaId)
    .eq('estado', 'pendiente')
    .eq('metodo', METODO_WOMPI);
  if (error) throw new Error(`No se pudieron anular los intentos pendientes: ${error.message}`);
}

// Anula UN cobro, solo si sigue pendiente (uno que ya se pagó no se toca).
export async function anularCobroPendiente(
  supabase: SupabaseClient<Database>,
  cobroId: string,
): Promise<void> {
  const { error } = await supabase
    .from('cobros')
    .update({ estado: 'anulado' })
    .eq('id', cobroId)
    .eq('estado', 'pendiente');
  if (error) throw new Error(`No se pudo anular el cobro: ${error.message}`);
}

export async function obtenerIntentoAbierto(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
): Promise<IntentoAbierto | null> {
  const { data, error } = await supabase
    .from('cobros')
    .select('id, tipo, plan_destino, monto, periodo_desde, created_at, wompi_url_enlace, wompi_enlace_vence')
    .eq('cuenta_id', cuentaId)
    .eq('estado', 'pendiente')
    .eq('metodo', METODO_WOMPI)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el intento abierto: ${error.message}`);
  if (!data) return null;
  return {
    cobroId: data.id,
    tipo: data.tipo === 'ajuste' ? 'ajuste' : 'periodo',
    planDestino: data.plan_destino,
    monto: Number(data.monto),
    periodoDesde: data.periodo_desde,
    creadoEn: data.created_at,
    enlaceUrl: data.wompi_url_enlace,
    enlaceVence: data.wompi_enlace_vence,
  };
}

// Los períodos PAGADOS (cobros `tipo = 'periodo'`): de ellos sale en qué momento de su ciclo está la
// cuenta. Un ajuste no abre período, así que no entra. `null` ante un error (no `[]`): una lista vacía
// diría "esta cuenta nunca pagó" y le ofrecería pagar de nuevo un mes que ya pagó.
export async function listarPeriodosPagados(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
): Promise<PeriodoPagado[] | null> {
  const { data, error } = await supabase
    .from('cobros')
    .select('periodo_desde, periodo_hasta')
    .eq('cuenta_id', cuentaId)
    .eq('estado', 'pagado')
    .eq('tipo', 'periodo');
  if (error) {
    console.error('[cobros] no se pudieron leer los períodos pagados:', error);
    return null;
  }
  return (data ?? []).map((f) => ({ desde: f.periodo_desde, hasta: f.periodo_hasta }));
}

const COLUMNAS_PARA_PAGO = 'id, cuenta_id, tipo, estado, monto, plan_destino, wompi_id_transaccion';

function paraPago(fila: {
  id: string;
  cuenta_id: string;
  tipo: string;
  estado: string;
  monto: number;
  plan_destino: string | null;
  wompi_id_transaccion: string | null;
}): CobroParaPago {
  return {
    id: fila.id,
    cuentaId: fila.cuenta_id,
    tipo: fila.tipo === 'ajuste' ? 'ajuste' : 'periodo',
    estado: fila.estado,
    monto: Number(fila.monto),
    planDestino: fila.plan_destino,
    wompiIdTransaccion: fila.wompi_id_transaccion,
  };
}

// Un cobro por id, SIN acotar por cuenta: lo usa el flujo del webhook, que no tiene sesión y que resuelve
// la cuenta desde el propio cobro. La página del dueño usa `obtenerCobro`, que sí acota.
export async function obtenerCobroParaPago(
  supabase: SupabaseClient<Database>,
  cobroId: string,
): Promise<CobroParaPago | null> {
  const { data, error } = await supabase.from('cobros').select(COLUMNAS_PARA_PAGO).eq('id', cobroId).maybeSingle();
  if (error) throw new Error(`No se pudo leer el cobro: ${error.message}`);
  return data ? paraPago(data) : null;
}

// El mismo cobro, PERO solo si es de esta cuenta. Lo usa la página de vuelta del dueño: el id llega por la
// URL, y uno ajeno no puede aplicar ni consultar el cobro de otra cuenta.
export async function obtenerCobroParaPagoDeLaCuenta(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
  cobroId: string,
): Promise<CobroParaPago | null> {
  const { data, error } = await supabase
    .from('cobros')
    .select(COLUMNAS_PARA_PAGO)
    .eq('id', cobroId)
    .eq('cuenta_id', cuentaId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el cobro: ${error.message}`);
  return data ? paraPago(data) : null;
}

// EL CANDADO. Pasa el cobro a pagado solo si su estado está entre los permitidos, en UNA sentencia: dos
// llamadas simultáneas no pueden reclamar los dos. Devuelve el cobro tal como quedó, o tal como está si
// no lo reclamó (así quien llama distingue un reintento propio, `wompiIdTransaccion` igual al suyo, de un
// doble pago con otra transacción).
//
// 23505 = el índice único de `wompi_id_transaccion`: ESTA transacción ya pagó OTRO cobro. Tampoco es una
// falla interna: se devuelve "no reclamado" y `confirmarPagoCobro` lo clasifica como ya_pagado. Lanzarlo
// haría que Wompi reintentara para siempre algo que no se arregla reintentando.
export async function reclamarCobroPagado(
  supabase: SupabaseClient<Database>,
  cobroId: string,
  datos: { hoy: string; idTransaccion: string; estadosPermitidos: string[] },
): Promise<{ reclamado: boolean; cobro: CobroParaPago | null }> {
  if (!FORMATO_FECHA.test(datos.hoy)) throw new Error('La fecha de pago no es válida.');

  const { data, error } = await supabase
    .from('cobros')
    .update({ estado: 'pagado', pagado_en: datos.hoy, wompi_id_transaccion: datos.idTransaccion })
    .eq('id', cobroId)
    .in('estado', datos.estadosPermitidos)
    .select(COLUMNAS_PARA_PAGO);

  if (error && error.code !== '23505') {
    throw new Error(`No se pudo reclamar el cobro: ${error.message}`);
  }
  if (!error && data && data.length === 1) return { reclamado: true, cobro: paraPago(data[0]) };

  return { reclamado: false, cobro: await obtenerCobroParaPago(supabase, cobroId) };
}

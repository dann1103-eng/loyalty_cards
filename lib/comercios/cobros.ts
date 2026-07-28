import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

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

const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function validar(datos: DatosCobro): string | null {
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
): Promise<ResultadoCobro> {
  const problema = validar(datos);
  if (problema) return { ok: false, error: problema };

  const { error } = await supabase.from('cobros').insert({
    cuenta_id: cuentaId,
    periodo_desde: datos.periodoDesde,
    periodo_hasta: datos.periodoHasta,
    monto: datos.monto,
    estado: datos.estado,
    metodo: datos.metodo?.trim() || null,
    nota: datos.nota?.trim() || null,
    pagado_en: datos.pagadoEn,
  });

  if (error) {
    console.error('[cobros] no se pudo registrar el cobro:', error);
    return { ok: false, error: 'No se pudo registrar el cobro.' };
  }
  return { ok: true };
}

export async function marcarCobroPagado(
  supabase: SupabaseClient<Database>,
  cobroId: string,
  pagadoEn: string,
  metodo: string,
): Promise<ResultadoCobro> {
  if (!FORMATO_FECHA.test(pagadoEn)) {
    return { ok: false, error: 'La fecha de pago no es válida.' };
  }

  const { error } = await supabase
    .from('cobros')
    .update({ estado: 'pagado', pagado_en: pagadoEn, metodo: metodo.trim() || null })
    .eq('id', cobroId);

  if (error) {
    console.error('[cobros] no se pudo marcar como pagado:', error);
    return { ok: false, error: 'No se pudo marcar el cobro como pagado.' };
  }
  return { ok: true };
}

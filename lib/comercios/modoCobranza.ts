import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { hoyEnZona } from '../tarjetas/vigencia';
import { VALORES_COBRANZA } from './cuentas';
import { periodoAPerdonar } from './cobranza';
import {
  listarPeriodosPagados,
  registrarCobro,
  type ResultadoCobro,
  type ResultadoRegistroCobro,
} from './cobros';

// Acciones de FM sobre la cobranza de una cuenta YA EXISTENTE (spec 2026-09-21-cobranza-design.md,
// "Acciones de FM" #1-3). Aparte de `cuentas.ts` a propósito: cambiar el modo de una cuenta que YA
// EXISTE tiene efectos secundarios reales (fija `cobranza_desde`, limpia la posposición) que el ALTA
// (crearCuenta, Tarea 3b) no tiene — ver el comentario de `VALORES_COBRANZA` en cuentas.ts.

// El método con el que se distingue un cobro perdonado por FM de un pago real (Wompi, "Pedido por
// FM") en la lista de cobros del dueño. No vive en cobros.ts junto a METODO_WOMPI/METODO_PEDIDO_FM
// porque esta tarea no toca ese archivo — si otro módulo llega a necesitarlo, se puede mover ahí sin
// romper a nadie (es un string literal, no un tipo).
export const METODO_PERDONADO_FM = 'Perdonado por FM';

// Mismo criterio liviano que `validarCobro` (cobros.ts, `FORMATO_FECHA`): solo la FORMA AAAA-MM-DD,
// sin validar que sea un día de calendario real (a diferencia de `esFechaValida` en cuentas.ts, que
// además reconstruye la fecha para rechazar un "2026-02-30"). Se decide así porque el único otro
// llamador de una fecha de cobranza (`validarCobro`) ya usa este mismo nivel de validación, y
// duplicar la variante estricta acá sin que la spec la pida sería agregar una regla que nadie probó.
const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Cambia el modo de cobranza de una cuenta existente (spec cobranza, "Acciones de FM" #1). `modo`
// llega SUELTO (no como el literal 'normal' | 'exenta'): mismo patrón que `crearCuenta(supabase,
// datos, cobranza?: string)` en cuentas.ts — la Server Action lee `formData.get('modo')` crudo y lo
// pasa tal cual, sin cast ni validación en la capa acción; la validación real (contra
// VALORES_COBRANZA, reusada de cuentas.ts para no duplicar la lista) vive acá.
//
// Pasar a 'normal' fija `cobranza_desde = hoy`: el plazo de 15 días arranca DESDE HOY, igual que una
// cuenta nueva — no desde que la cuenta se creó hace tiempo. Pasar a 'exenta' limpia
// `cobranza_pospuesta_hasta`: una cuenta exenta nunca se bloquea, así que una posposición ahí sería
// un dato muerto que además confundiría si la cuenta vuelve a pasar a 'normal' más tarde sin que
// nadie la haya tocado a propósito.
export async function cambiarModoCobranza(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
  modo: string,
): Promise<ResultadoCobro> {
  if (!(VALORES_COBRANZA as readonly string[]).includes(modo)) {
    return { ok: false, error: 'El modo de cobranza debe ser "normal" o "exenta".' };
  }

  const cambios: Database['public']['Tables']['cuentas_comercio']['Update'] =
    modo === 'normal'
      ? { cobranza: 'normal', cobranza_desde: hoyEnZona('America/El_Salvador') }
      : { cobranza: 'exenta', cobranza_pospuesta_hasta: null };

  // .select('id').single() a propósito: sin esto, un update cuyo .eq() no matchea NINGUNA fila
  // (cuentaId inexistente, borrada en una carrera con eliminarCuenta, un typo) devuelve éxito igual
  // — PostgREST no distingue "actualicé 0 filas" de "actualicé 1 fila" salvo que se le pida de
  // vuelta la fila. Mismo patrón que actualizarCuenta (cuentas.ts): PGRST116 = "no matcheó ninguna
  // fila" (el .single() sobre un resultado vacío).
  const { error } = await supabase
    .from('cuentas_comercio')
    .update(cambios)
    .eq('id', cuentaId)
    .select('id')
    .single();
  if (error) {
    if (error.code === 'PGRST116') {
      return { ok: false, error: 'Esa cuenta ya no existe.' };
    }
    console.error('[cobranza] no se pudo cambiar el modo de cobranza:', error);
    return { ok: false, error: 'No se pudo cambiar el modo de cobranza.' };
  }
  return { ok: true };
}

// Pone o quita la posposición de pago de una cuenta (spec cobranza, "Acciones de FM" #2). `hasta:
// null` quita la posposición (vuelve a regir la regla normal de 15 días desde el vencimiento real).
// La spec NO exige validar que la fecha sea estrictamente futura en el servidor — el `<input
// type="date">` del formulario ya lo acota — así que no se agrega esa regla acá (YAGNI).
export async function posponerPago(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
  hasta: string | null,
): Promise<ResultadoCobro> {
  if (hasta !== null && !FORMATO_FECHA.test(hasta)) {
    return { ok: false, error: 'La fecha de posposición debe tener el formato AAAA-MM-DD.' };
  }

  // Mismo motivo que en cambiarModoCobranza: sin .select('id').single(), un cuentaId inexistente
  // devolvería éxito sin haber tocado ninguna fila.
  const { error } = await supabase
    .from('cuentas_comercio')
    .update({ cobranza_pospuesta_hasta: hasta })
    .eq('id', cuentaId)
    .select('id')
    .single();
  if (error) {
    if (error.code === 'PGRST116') {
      return { ok: false, error: 'Esa cuenta ya no existe.' };
    }
    console.error('[cobranza] no se pudo posponer el pago:', error);
    return { ok: false, error: 'No se pudo posponer el pago.' };
  }
  return { ok: true };
}

// Perdona el ciclo que venció (spec cobranza, "Acciones de FM" #3): crea un cobro $0 `pagado` que
// cubre EXACTAMENTE ese ciclo (Tarea 1, `periodoAPerdonar`) — arranca el día siguiente al último
// período pagado, o en `cobranza_desde` si la cuenta nunca pagó.
//
// `hoy` llega por parámetro: quien llama (la Server Action) lo calcula con `hoyEnZona` del lado del
// servidor — esta función no lee el reloj, igual que el resto de la cobranza.
//
// Reusa `registrarCobro` (cobros.ts) tal cual para el insert: `validarCobroManual` solo bloquea
// `metodo: 'Wompi'` cuando `estado: 'pendiente'`, y acá el cobro va `pagado` con un método distinto,
// así que pasa sin rechazos. NO se llama a `notificarPagoAMeta`: ese aviso es solo para pagos
// REALES (Wompi o "Marcar pagado" de un cobro pedido por FM) — perdonar un ciclo no es un pago real.
export async function perdonarCiclo(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
  hoy: string,
): Promise<ResultadoRegistroCobro> {
  const periodosPagados = await listarPeriodosPagados(supabase, cuentaId);
  if (periodosPagados === null) {
    return { ok: false, error: 'No se pudieron leer los períodos pagados de la cuenta.' };
  }

  const { data: cuenta, error: eCuenta } = await supabase
    .from('cuentas_comercio')
    .select('cobranza_desde')
    .eq('id', cuentaId)
    .maybeSingle();
  if (eCuenta || !cuenta) {
    console.error('[cobranza] no se pudo leer cobranza_desde de la cuenta:', eCuenta);
    return { ok: false, error: 'No se pudo leer la cuenta.' };
  }

  const { desde, hasta } = periodoAPerdonar({
    periodosPagados,
    cobranzaDesde: cuenta.cobranza_desde,
    hoy,
  });

  return registrarCobro(supabase, cuentaId, {
    periodoDesde: desde,
    periodoHasta: hasta,
    monto: 0,
    estado: 'pagado',
    metodo: METODO_PERDONADO_FM,
    nota: null,
    pagadoEn: hoy,
  });
}

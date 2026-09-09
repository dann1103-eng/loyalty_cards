import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { tipoOPuntos } from '../tarjetas/tipos';
import { describirCosto } from '../tarjetas/unidadPrograma';

// Historial de movimientos de UNA tarjeta (Tanda 1 — antifraude). Es la pantalla forense: con qué
// hora, en qué sucursal y con qué cajero se movió cada sello.
//
// Los datos no viven en una tabla nueva: transacciones_puntos y canjes ya los tenían desde la 0001.
// Lo que faltaba era la consulta (historial_tarjeta, migración 0015) y la pantalla.

// Las cinco clases de movimiento que puede tener una tarjeta. Cuatro salen del CHECK de
// transacciones_puntos (migración 0019: acreditacion, ajuste, uso, renovacion) y 'canje' de la otra
// tabla del ledger, que historial_tarjeta une en la misma lista.
export type ClaseMovimiento = 'acreditacion' | 'ajuste' | 'canje' | 'uso' | 'renovacion';

export interface MovimientoHistorial {
  id: string;
  ocurrioEn: string;
  clase: ClaseMovimiento;
  delta: number;
  saldoResultante: number;
  sucursalNombre: string | null;
  cajeroEmail: string | null;
  motivo: string | null;
  forzado: boolean;
  monto: number | null;
  recompensaNombre: string | null;
}

export interface OpcionesHistorial {
  limite?: number;
  desde?: string | null;
}

const CLASES: readonly string[] = ['acreditacion', 'ajuste', 'canje', 'uso', 'renovacion'];

function normalizarClase(valor: string): ClaseMovimiento {
  // Hasta el 2026-09-08 esto era `valor === 'ajuste' || valor === 'canje' ? valor : 'acreditacion'`,
  // o sea que 'uso' y 'renovacion' —clases legítimas desde la 0019— se colapsaban en acreditación.
  // El dueño y el cliente veían "Acreditación +0" en una renovación de membresía y
  // "Acreditación -1250" en un cobro de gift card: un hecho falso, y con la unidad equivocada.
  //
  // El fallback no se retira, se acota a lo DESCONOCIDO: una fila con un tipo que esta versión del
  // código no conoce no puede dejar la pantalla forense sin dibujar (misma política que tipoOPuntos).
  return CLASES.includes(valor) ? (valor as ClaseMovimiento) : 'acreditacion';
}

// Devuelve `null` ante un error de infraestructura, NUNCA `[]`.
//
// Esto se aparta a propósito del fail-soft de lib/reportes/reportes.ts, que ante un error loguea y
// devuelve `[]` para no tumbar la pantalla. Ahí es cosmético; acá sería peligroso: en una pantalla
// de auditoría, una lista vacía le dice al dueño "tu cajero no hizo nada", que es la conclusión
// EXACTAMENTE OPUESTA a la verdad. La pantalla tiene que poder distinguir "no hay movimientos" de
// "no se pudieron leer los movimientos" y mostrar un error explícito en el segundo caso.
export async function historialTarjeta(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  tarjetaId: string,
  opciones?: OpcionesHistorial,
): Promise<MovimientoHistorial[] | null> {
  const { data, error } = await supabase.rpc('historial_tarjeta', {
    p_comercio_id: comercioId,
    p_tarjeta_id: tarjetaId,
    p_limite: opciones?.limite ?? null,
    p_desde: opciones?.desde ?? null,
  });

  if (error || !data) {
    console.error('[historial] no se pudo leer el historial de la tarjeta:', error);
    return null;
  }

  return data.map((fila) => ({
    id: fila.movimiento_id,
    ocurrioEn: fila.ocurrio_en,
    clase: normalizarClase(fila.clase),
    delta: fila.delta,
    saldoResultante: fila.saldo_resultante,
    sucursalNombre: fila.sucursal_nombre,
    cajeroEmail: fila.cajero_email,
    motivo: fila.motivo_texto,
    forzado: fila.fue_forzado,
    monto: fila.monto,
    recompensaNombre: fila.recompensa_nombre,
  }));
}

// Etiqueta de una clase de movimiento. La leen las DOS pantallas que muestran el mismo movimiento
// —la ficha del dueño y el portal del cliente—, así que cada palabra tiene que servirle a los dos:
// "Uso" cubre el cupón que se usó, la visita de prepago consumida y el cobro de una gift card.
//
// Es un Record y no un if encadenado a propósito: una clase nueva en ClaseMovimiento sin su
// etiqueta acá no compila. El if encadenado hacía lo contrario — devolvía 'Acreditación' para todo
// lo que no reconocía, que es exactamente el defecto que se cerró el 2026-09-08.
const ETIQUETAS: Record<ClaseMovimiento, string> = {
  acreditacion: 'Acreditación',
  ajuste: 'Corrección',
  canje: 'Canje',
  uso: 'Uso',
  renovacion: 'Renovación',
};

export function etiquetaClase(clase: ClaseMovimiento): string {
  return ETIQUETAS[clase];
}

// ─────────────────────────────────────────────────────────────────────────────
// Cómo se LEE un movimiento
// ─────────────────────────────────────────────────────────────────────────────
// Las dos funciones de abajo viven acá y no en cada pantalla porque la ficha del dueño y el portal
// del cliente muestran EL MISMO movimiento, y las dos imprimían el contador crudo: "-1250" para un
// cobro de $12.50 y "-1" para una visita de prepago.
//
// Devuelven cadena VACÍA cuando el programa no cuenta nada (cupón, membresía, descuento: contador
// 'ninguno'). La pantalla tiene que tratar ese vacío como "no hay línea que imprimir" — ni el
// número ni la palabra que lo acompaña. Un "queda " colgado es peor que no mostrar nada.

// El delta con su signo. La magnitud se pide en ABSOLUTO y el signo se pega afuera: describirCosto
// pluraliza por la cantidad, así que con -1 diría "-1 visitas", y en un contador de centavos el
// menos quedaría adentro del dinero.
export function describirDeltaMovimiento(tipoTarjeta: string, delta: number): string {
  const magnitud = describirCosto(tipoTarjeta, Math.abs(delta));
  if (!magnitud) return '';
  return `${delta < 0 ? '-' : '+'}${magnitud}`;
}

// El saldo que quedó DESPUÉS del movimiento. En sellos incluye la meta, que es lo que le da sentido
// al número: "3 de 8 sellos" dice algo que "3 sellos" no dice.
export function describirSaldoMovimiento(
  tipoTarjeta: string,
  saldo: number,
  selloMeta?: number | null,
): string {
  if (tipoOPuntos(tipoTarjeta).valor === 'sellos' && selloMeta != null) {
    return `${saldo} de ${selloMeta} sellos`;
  }
  return describirCosto(tipoTarjeta, saldo);
}

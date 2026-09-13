import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { TIPOS, sigueVigente, tipoOPuntos } from '../tarjetas/tipos';
import { formatearFecha, hoyEnZona, sumarDias } from '../tarjetas/vigencia';
import { enviarMensajeTarjeta } from './enviarMensajeTarjeta';

// El aviso ANTES del vencimiento (spec 2026-09-09). Hermano de avisoInactividad.ts, pero con otro
// disparador: un socio que renovó ayer y viene todas las semanas no está inactivo, y su membresía se
// le vence igual. El momento en que el aviso vale plata es antes de la fecha.
//
// La configuración vive en el PROGRAMA (decisión 3), no en el comercio: "renová tu membresía" y
// "usá tu cupón" son mensajes distintos, y es donde ya vive el plazo que se está por vencer.

// Espejo del CHECK de la 0034 (`aviso_vencimiento_dias` entre 1 y 90).
export const MAXIMO_DIAS_AVISO_VENCIMIENTO = 90;
// Espejo del CHECK de la 0034 (`char_length(aviso_vencimiento_mensaje) <= 200`).
export const MAXIMO_CARACTERES_AVISO_VENCIMIENTO = 200;
// Cuánto queda, COMO MÁXIMO, el aviso en el reverso del pase. Valor fijo del sistema por el mismo
// motivo que DURACION_AVISO_INACTIVIDAD_DIAS. Nunca pasa de la fecha de vencimiento: ver
// `vigenciaDelAviso`.
export const DURACION_AVISO_VENCIMIENTO_DIAS = 14;

export interface ConfiguracionAvisoVencimiento {
  activo: boolean;
  dias: number | null;
  mensaje: string | null; // null o vacío = el texto por defecto del tipo
}

// ─────────────────────────────────────────────────────────────────────────────
// La ventana
// ─────────────────────────────────────────────────────────────────────────────

// Días de calendario entre dos AAAA-MM-DD. Aritmética en UTC por la misma razón que sumarDias: acá
// no hay instantes, y un `new Date('2026-09-13')` en huso local puede caer un día antes.
function diasEntre(desdeIso: string, hastaIso: string): number {
  const aUtc = (iso: string) => {
    const [anio, mes, dia] = iso.slice(0, 10).split('-').map(Number);
    return Date.UTC(anio, mes - 1, dia);
  };
  return Math.round((aUtc(hastaIso) - aUtc(desdeIso)) / 86_400_000);
}

// ¿Le toca el aviso a esta tarjeta HOY? Pura: la fecha entra por argumento (la de la zona del
// comercio), nunca un new Date() adentro.
//
// A diferencia del aviso de inactividad, acá la guarda de "ya venció" es la MISMA para cupón y
// membresía, y no es un descuido: el comentario largo de avisoInactividad.ts explica que ante una
// fecha vencida esos dos tipos necesitan cosas OPUESTAS (el cupón vencido se saltea, la membresía
// vencida se avisa). Ese reparto sigue en pie: el socio vencido lo atiende el aviso de INACTIVIDAD.
// Este aviso habla de lo que está POR vencer, y "está por vencer" es falso para los dos tipos una vez
// pasada la fecha (decisión 5).
export function correspondeAvisar(
  t: { vigenciaHasta: string | null; usadoEn: string | null; avisoVencimientoPara: string | null },
  diasAntes: number,
  hoyIso: string,
): boolean {
  // 1. Sin fecha no hay vencimiento: una membresía sin activar, o un cupón sin plazo.
  if (!t.vigenciaHasta) return false;
  // 2. Un cupón ya usado no tiene nada que aprovechar (decisión 2). `usado_en` solo lo escribe
  // usar_cupon_atomico, así que en una membresía es siempre null.
  if (t.usadoEn) return false;
  const vence = t.vigenciaHasta.slice(0, 10);
  // 3. Ya se avisó para ESTE vencimiento. Es una fecha y no un booleano (decisión 4): al renovar,
  // vigencia_hasta cambia, deja de coincidir con la marca y el aviso del período nuevo sale solo.
  if (t.avisoVencimientoPara && t.avisoVencimientoPara.slice(0, 10) === vence) return false;
  // 4. Ya venció. El día del vencimiento todavía cuenta (misma comparación que el RPC que canjea).
  if (!sigueVigente(vence, hoyIso)) return false;
  // 5. "Faltan N días O MENOS", nunca "exactamente N": si el cron no corre justo ese día, un aviso
  // de igualdad estricta se pierde para siempre y nadie se entera. Con "o menos" sale al día
  // siguiente; la marca del paso 3 es la que impide que salga dos veces.
  return diasEntre(hoyIso, vence) <= diasAntes;
}

// ─────────────────────────────────────────────────────────────────────────────
// El texto
// ─────────────────────────────────────────────────────────────────────────────

// El texto por defecto cuando el dueño deja el mensaje vacío, por tipo (tabla, no `if`: decisión 1).
// Una prueba recorre los tipos con `usaVigencia` y falla si alguno no tiene el suyo.
export const AVISO_VENCIMIENTO_POR_TIPO: Readonly<Record<string, string>> = {
  membresia: 'Tu membresía está por vencer. Renovala en el local.',
  cupon: 'Tu cupón está por vencer. Aprovechalo antes de que se te pase.',
};

const AVISO_VENCIMIENTO_GENERICO = 'Tu tarjeta está por vencer.';

// Lo que recibe el cliente: el mensaje del dueño (o el del tipo) MÁS la fecha real de ESA tarjeta.
// La fecha la pone la app, nunca el dueño: un mensaje guardado con una fecha escrita a mano sería la
// misma fecha para clientes que vencen en días distintos (decisión 1).
export function textoAviso(mensaje: string | null, tipoTarjeta: string, vigenciaHasta: string): string {
  const propio = mensaje?.trim();
  const base = propio || AVISO_VENCIMIENTO_POR_TIPO[tipoTarjeta] || AVISO_VENCIMIENTO_GENERICO;
  // Si el dueño no cerró la frase, se cierra acá: si no, se lee "Te esperamos Vence el 12…".
  const cerrada = /[.!?…]$/u.test(base) ? base : `${base}.`;
  return `${cerrada} Vence el ${formatearFecha(vigenciaHasta)}.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// La validación
// ─────────────────────────────────────────────────────────────────────────────

// `plazoDias` es el plazo del PROGRAMA según su tipo: `membresia_dias` o `cupon_vigencia_dias`.
//
// NO es una copia del `validar` de inactividad: aquel exige el mensaje, y acá el mensaje es opcional
// (vacío = el texto del tipo). Lo que sí se exige con el interruptor encendido son los días y el
// cruce contra el plazo (decisión 8), que no puede ser un CHECK: son dos columnas de la misma fila y
// depende del tipo.
export function validarAvisoVencimiento(
  datos: ConfiguracionAvisoVencimiento,
  tipoTarjeta: string,
  plazoDias: number | null,
): string | null {
  const rangoDias = `Los días de anticipación tienen que ser un número entero entre 1 y ${MAXIMO_DIAS_AVISO_VENCIMIENTO}.`;
  const diasFueraDeRango = (dias: number) =>
    !Number.isInteger(dias) || dias <= 0 || dias > MAXIMO_DIAS_AVISO_VENCIMIENTO;

  // Lo que el CHECK de la base rechaza se rechaza SIEMPRE, con el interruptor apagado también: el
  // CHECK no mira el interruptor, y dejarlo pasar solo cambiaría este motivo por un "No se pudo
  // guardar" genérico. `[...texto].length` cuenta caracteres como `char_length` (un emoji es uno),
  // no unidades UTF-16 como `.length`.
  if (datos.mensaje !== null && [...datos.mensaje].length > MAXIMO_CARACTERES_AVISO_VENCIMIENTO) {
    return `El mensaje del aviso puede tener hasta ${MAXIMO_CARACTERES_AVISO_VENCIMIENTO} caracteres.`;
  }
  if (datos.dias !== null && diasFueraDeRango(datos.dias)) return rangoDias;

  if (!datos.activo) return null; // apagado: el resto son reglas del aviso encendido

  const tipo = tipoOPuntos(tipoTarjeta);
  if (!tipo.usaVigencia) return 'Este tipo de tarjeta no tiene fecha de vencimiento: no hay aviso que mandar.';

  const sinPlazo = plazoDias === null || !Number.isInteger(plazoDias) || plazoDias <= 0;
  if (sinPlazo) {
    // En cupón, sin plazo es una decisión válida del dueño (el cupón no vence nunca), así que el
    // mensaje explica por qué el aviso no tiene sentido. En membresía es configuración incompleta.
    return tipo.valor === 'cupon'
      ? 'Este cupón no vence nunca (no tiene días de vigencia), así que no hay vencimiento que avisar. Poné los días de vigencia o apagá el aviso.'
      : 'Poné cuántos días dura cada renovación antes de encender el aviso.';
  }

  if (datos.dias === null) return 'Poné cuántos días antes del vencimiento se manda el aviso.';

  // Decisión 8. Con membresía de 30 días y aviso a 30, renovar deja vigencia_hasta = hoy + 30: al
  // día siguiente de PAGAR el socio recibe "tu membresía está por vencer". Estrictamente menor.
  if (!(datos.dias < plazoDias)) {
    const plazo =
      tipo.valor === 'cupon'
        ? `el cupón vale ${plazoDias} días desde que se entrega`
        : `cada renovación dura ${plazoDias} días`;
    const quien = tipo.valor === 'cupon' ? 'al cliente apenas lo recibe' : 'al socio apenas termina de pagar';
    return `El aviso tiene que salir con menos de ${plazoDias} días de anticipación: ${plazo}, así que avisar ${datos.dias} días antes le diría "está por vencer" ${quien}.`;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// El recorrido (cron diario)
// ─────────────────────────────────────────────────────────────────────────────

export interface ResumenAvisoVencimiento {
  programasRevisados: number;
  avisadas: string[]; // tarjetas a las que el aviso LLEGÓ por al menos un canal, y quedaron marcadas
  sinEntregar: string[]; // les tocaba, pero no tenían dónde recibirlo: se reintenta en la próxima corrida
}

// Hasta cuándo queda el aviso en el reverso: DURACION días, pero nunca más allá del vencimiento.
// Pasada la fecha, "Vence el 16" ya describe algo que pasó, y un aviso todavía vigente en el reverso
// frena al de inactividad (decisión 7), que es justamente el que le corresponde al socio vencido.
function vigenciaDelAviso(hoyIso: string, venceIso: string): string {
  const tope = sumarDias(hoyIso, DURACION_AVISO_VENCIMIENTO_DIAS);
  const vence = venceIso.slice(0, 10);
  return vence < tope ? vence : tope;
}

export async function procesarAvisosVencimiento(
  supabase: SupabaseClient<Database>,
): Promise<ResumenAvisoVencimiento> {
  // Los tipos salen del catálogo, no de una lista escrita acá: un tipo nuevo con vigencia entra solo.
  const tiposConVigencia = TIPOS.filter((t) => t.usaVigencia).map((t) => t.valor);

  // SIN filtro por mensaje nulo, a diferencia del cron de inactividad: acá el mensaje vacío es
  // válido y significa "el texto del tipo". Filtrarlo dejaría sin aviso justo al dueño que no quiso
  // escribir nada.
  const { data: programas, error } = await supabase
    .from('programas_tarjeta')
    .select('id, comercio_id, tipo_tarjeta, aviso_vencimiento_dias, aviso_vencimiento_mensaje, comercios(zona_horaria)')
    .eq('activo', true)
    .eq('aviso_vencimiento_activo', true)
    .not('aviso_vencimiento_dias', 'is', null)
    .in('tipo_tarjeta', tiposConVigencia);

  if (error) {
    console.error('[vencimiento] no se pudieron leer los programas con aviso activo:', error);
    return { programasRevisados: 0, avisadas: [], sinEntregar: [] };
  }
  if (!programas || programas.length === 0) {
    return { programasRevisados: 0, avisadas: [], sinEntregar: [] };
  }

  const avisadas: string[] = [];
  const sinEntregar: string[] = [];

  for (const programa of programas) {
    // El "hoy" del comercio, no el del servidor: es con el que el RPC decide si algo venció.
    const hoy = hoyEnZona(programa.comercios?.zona_horaria ?? null);
    const dias = programa.aviso_vencimiento_dias!;

    // La consulta ACOTA a la ventana para no traer a todos los socios del programa; la decisión
    // sigue siendo de correspondeAvisar, que además mira el uso y la marca.
    const { data: tarjetas, error: errorTarjetas } = await supabase
      .from('tarjetas')
      .select('id, vigencia_hasta, usado_en, aviso_vencimiento_para')
      .eq('comercio_id', programa.comercio_id)
      .eq('programa_id', programa.id)
      .gte('vigencia_hasta', hoy)
      .lte('vigencia_hasta', sumarDias(hoy, dias));
    if (errorTarjetas) {
      console.error('[vencimiento] no se pudieron leer las tarjetas del programa:', programa.id, errorTarjetas);
      continue;
    }

    for (const t of tarjetas ?? []) {
      const corresponde = correspondeAvisar(
        { vigenciaHasta: t.vigencia_hasta, usadoEn: t.usado_en, avisoVencimientoPara: t.aviso_vencimiento_para },
        dias,
        hoy,
      );
      if (!corresponde || !t.vigencia_hasta) continue;

      const envio = await enviarMensajeTarjeta(
        supabase,
        t.id,
        textoAviso(programa.aviso_vencimiento_mensaje, programa.tipo_tarjeta, t.vigencia_hasta),
        vigenciaDelAviso(hoy, t.vigencia_hasta),
        'vencimiento',
      );

      // La marca SOLO si el aviso llegó a algún lado — el mismo criterio de "alcanzada" que documenta
      // enviarMensajeTarjeta. Grabarla sin haber entregado nada dejaría a este cliente sin aviso
      // para siempre: la marca dice "ya se avisó para esta fecha" y ninguna corrida lo volvería a
      // intentar. Sin marca, la de mañana lo reintenta (por ejemplo, si ya instaló el pase).
      if (!(envio.enviadoApple || envio.enviadoGoogle)) {
        sinEntregar.push(t.id);
        continue;
      }

      const { error: errorMarca } = await supabase
        .from('tarjetas')
        .update({ aviso_vencimiento_para: t.vigencia_hasta })
        .eq('id', t.id);
      if (errorMarca) {
        // El aviso ya llegó. Sin marca, mañana se repite: un push de más es mejor que uno de menos.
        console.error('[vencimiento] se avisó pero no se pudo grabar la marca de la tarjeta:', t.id, errorMarca);
      }
      avisadas.push(t.id);
    }
  }

  return { programasRevisados: programas.length, avisadas, sinEntregar };
}

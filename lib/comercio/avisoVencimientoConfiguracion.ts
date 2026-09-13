import { tipoOPuntos } from '../tarjetas/tipos';
import { formatearFecha } from '../tarjetas/vigencia';

// La parte del aviso antes del vencimiento que el DUEÑO configura: los topes, el texto y la
// validación. Vive separada de avisoVencimiento.ts (el recorrido del cron) por UNA razón: la
// pantalla de Programas la usa desde el NAVEGADOR —la vista previa en vivo del mensaje llama a
// `textoAviso`— y avisoVencimiento.ts importa `enviarMensajeTarjeta`, que arrastra el cliente de
// Apple y `googleapis`. Importar de allá en un componente 'use client' metería las billeteras al
// bundle del navegador.
//
// Por eso este archivo NO puede importar nada con efectos de servidor: solo tipos.ts y vigencia.ts,
// que no tienen imports de runtime (ver el comentario de `formatearFecha`). avisoVencimiento.ts
// reexporta todo lo de acá, así que el recorrido y sus pruebas siguen importando de un solo lugar.

// Espejo del CHECK de la 0034 (`aviso_vencimiento_dias` entre 1 y 90).
export const MAXIMO_DIAS_AVISO_VENCIMIENTO = 90;
// Espejo del CHECK de la 0034 (`char_length(aviso_vencimiento_mensaje) <= 200`).
export const MAXIMO_CARACTERES_AVISO_VENCIMIENTO = 200;

export interface ConfiguracionAvisoVencimiento {
  activo: boolean;
  dias: number | null;
  mensaje: string | null; // null o vacío = el texto por defecto del tipo
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

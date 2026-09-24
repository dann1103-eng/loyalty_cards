import { esFechaValida } from './rangoFechas';

// Las fechas del Excel (spec 2026-09-23 §4). Módulo PURO.
//
// Excel no tiene zonas horarias: guarda un número de serie y muestra esa hora "de pared".
// `write-excel-file` convierte un `Date` a ese número con base UTC (su propio ejemplo usa `Date.UTC`),
// así que para que la celda diga las 22:30 de Bogotá hay que entregarle un Date cuyos componentes UTC
// SEAN 22:30. Los componentes salen del reloj LOCAL DEL COMERCIO, con Intl y su zona explícita.
//
// Nunca de `getHours()` y compañía: esos leen el reloj del PROCESO, que es UTC en Vercel y UTC−6 en la
// PC de Daniel, y el mismo Excel diría una hora distinta según dónde se generó.

// Formatos de celda (spec §4). Una celda Date de write-excel-file EXIGE `format`.
export const FORMATO_DIA_EXCEL = 'dd/mm/yyyy';
export const FORMATO_FECHA_HORA_EXCEL = 'dd/mm/yyyy hh:mm';

// UN formateador por zona, creado la primera vez que se lo pide y reusado después. El Excel llama a
// fechaExcel una vez por fila, y construir un Intl.DateTimeFormat es lo caro: medido el 2026-09-23 con
// 50 000 filas (el tope por hoja), 9,6 s creando uno por llamada contra 0,4 s reusándolo. El resultado
// es el mismo: la zona va explícita en el formateador, que no depende de la del proceso. Una zona
// inválida lanza RangeError al construirlo, así que nunca queda guardada. Las claves son zonas (una
// lista cerrada, zonasHorarias.ts): el Map no crece sin límite.
const formateadores = new Map<string, Intl.DateTimeFormat>();

function formateadorDe(zonaHoraria: string): Intl.DateTimeFormat {
  let formateador = formateadores.get(zonaHoraria);
  if (!formateador) {
    // hourCycle h23: con `hour12: false` algunos motores escriben la medianoche como "24".
    formateador = new Intl.DateTimeFormat('en-US', {
      timeZone: zonaHoraria,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formateadores.set(zonaHoraria, formateador);
  }
  return formateador;
}

// Un instante (un `timestamptz` de PostgREST, o un Date) → el Date que Excel muestra como la fecha y
// hora local del comercio en esa zona. Sin segundos: la celda es dd/mm/yyyy hh:mm.
export function fechaExcel(instante: Date | string, zonaHoraria: string): Date {
  const fecha = typeof instante === 'string' ? new Date(instante) : instante;
  if (Number.isNaN(fecha.getTime())) {
    // Un dato ilegible no se convierte en una fecha inventada: que falle la exportación (500) y no
    // salga un Excel con una fecha que parece cierta.
    throw new Error(`fechaExcel: instante inválido: ${String(instante)}`);
  }
  const partes = formateadorDe(zonaHoraria).formatToParts(fecha);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) => Number(partes.find((p) => p.type === tipo)?.value);
  return new Date(Date.UTC(parte('year'), parte('month') - 1, parte('day'), parte('hour'), parte('minute')));
}

// Un día que YA es local (el `periodo date` de reporte_por_dia, cortado en la zona de su comercio por
// la SQL, o un hoyEnZona(zona, instante) de vigencia.ts) → su Date de Excel. No se convierte nada: solo se arma en UTC.
export function diaExcel(dia: string): Date {
  if (!esFechaValida(dia)) throw new Error(`diaExcel: día inválido: ${dia}`);
  const [anio, mes, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, d));
}

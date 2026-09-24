import { describe, it, expect, afterEach } from 'vitest';
import { fechaExcel, diaExcel, FORMATO_DIA_EXCEL, FORMATO_FECHA_HORA_EXCEL } from './fechaExcel';

// Prueba PURA de las fechas del Excel (spec §4). Excel no tiene zonas: guarda un número de serie y
// muestra esa hora "de pared". `write-excel-file` convierte un `Date` a ese número con base UTC, así
// que para que Excel muestre las 22:30 de Bogotá hay que entregarle un Date cuyos componentes UTC
// SEAN 22:30. Si los componentes salieran del reloj del PROCESO, el mismo Excel diría una hora en la
// PC de Daniel (UTC−6) y otra en Vercel (UTC).
//
// Por eso las aserciones son sobre getUTC*() y corren con la zona del proceso FORZADA a tres zonas
// distintas (mismo mecanismo que lib/tarjetas/formatearFecha.test.ts, con el chequeo de que tomó).
//
// MUTATION-TESTING (corridas el 2026-09-23, con el mensaje que se vio caer):
// - Componentes del reloj del PROCESO (`Date.UTC(fecha.getFullYear(), fecha.getMonth(),
//   fecha.getDate(), fecha.getHours(), fecha.getMinutes())` en vez de Intl): caen 9 de 16. Con el
//   proceso en UTC (Vercel), "America/Bogota…" con `expected [ 2026, 9, 23, 3, 30 ] to deeply equal
//   [ 2026, 9, 22, 22, 30 ]`; con el proceso en America/El_Salvador (la PC de Daniel), la misma con
//   `expected [ 2026, 9, 22, 21, 30 ]…`, y "Europe/Madrid… cruza al día siguiente" con `expected
//   [ 2026, 9, 23, 16, 30 ] to deeply equal [ 2026, 9, 24, +0, 30 ]`.
// - (Tarea 5, re-corrida el 2026-09-24 tras la revisión) El formateador cacheado con UNA clave para
//   todas las zonas (el de la primera zona pedida sirve a las demás). Lo atrapa la prueba
//   AUTOCONTENIDA "cada zona con SU formateador…" corrida SOLA (`-t "cada zona con SU formateador"`):
//   `expected [ 2026, 9, 23, 17, 30 ] to deeply equal [ 2026, 9, 24, +0, 30 ]` (Madrid con el
//   formateador de Bogotá). Las cuatro viejas de Madrid solo caían por el ORDEN del archivo: corridas
//   solas (`-t "Europe/Madrid"`) la mutación SOBREVIVE (4 passed), porque la primera zona que se pide
//   es la suya. Con el archivo entero caen 5 (las cuatro de Madrid y la autocontenida).

const tzOriginal = process.env.TZ;
const zonaOriginal = Intl.DateTimeFormat().resolvedOptions().timeZone;

function zonaDelProceso(zona: string) {
  process.env.TZ = zona;
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zona);
}

afterEach(() => {
  process.env.TZ = zonaOriginal;
  if (tzOriginal === undefined) delete process.env.TZ;
});

const ZONAS_DE_PROCESO = ['UTC', 'America/El_Salvador', 'Asia/Tokyo'];

function componentesUtc(d: Date) {
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()];
}

describe('fechaExcel', () => {
  it.each(ZONAS_DE_PROCESO)('America/Bogota con el proceso en %s: el reloj de Bogotá', (zona) => {
    zonaDelProceso(zona);
    // 03:30 UTC del 23 = 22:30 del 22 en Bogotá (UTC−5).
    expect(componentesUtc(fechaExcel(new Date('2026-09-23T03:30:00Z'), 'America/Bogota'))).toEqual([
      2026, 9, 22, 22, 30,
    ]);
  });

  it.each(ZONAS_DE_PROCESO)('Europe/Madrid con el proceso en %s: cruza al día siguiente', (zona) => {
    zonaDelProceso(zona);
    // 22:30 UTC del 23 = 00:30 del 24 en Madrid (CEST, UTC+2).
    expect(componentesUtc(fechaExcel(new Date('2026-09-23T22:30:00Z'), 'Europe/Madrid'))).toEqual([
      2026, 9, 24, 0, 30,
    ]);
  });

  it('Europe/Madrid el día del atraso de hora: las dos 02:30 son 02:30', () => {
    // A las 03:00 CEST del 25 de octubre el reloj vuelve a las 02:00 CET: la hora de pared 02:30
    // existe dos veces. Excel muestra la de pared, así que las dos dicen 02:30.
    expect(componentesUtc(fechaExcel(new Date('2026-10-25T00:30:00Z'), 'Europe/Madrid'))).toEqual([
      2026, 10, 25, 2, 30,
    ]);
    expect(componentesUtc(fechaExcel(new Date('2026-10-25T01:30:00Z'), 'Europe/Madrid'))).toEqual([
      2026, 10, 25, 2, 30,
    ]);
  });

  it('cada zona con SU formateador: Bogotá, Madrid y Bogotá otra vez, en una misma prueba', () => {
    // fechaExcel guarda un formateador por zona. Autocontenida a propósito: si el caché le sirviera a
    // una zona el formateador de otra, al menos una de las tres llamadas daría la hora de la otra
    // zona, corra esta prueba sola (`-t`) o después de cualquier otra.
    const instante = new Date('2026-09-23T22:30:00Z');
    // 17:30 del 23 en Bogotá (UTC−5); 00:30 del 24 en Madrid (CEST, UTC+2).
    expect(componentesUtc(fechaExcel(instante, 'America/Bogota'))).toEqual([2026, 9, 23, 17, 30]);
    expect(componentesUtc(fechaExcel(instante, 'Europe/Madrid'))).toEqual([2026, 9, 24, 0, 30]);
    expect(componentesUtc(fechaExcel(instante, 'America/Bogota'))).toEqual([2026, 9, 23, 17, 30]);
  });

  it('acepta el texto timestamptz de PostgREST (con microsegundos y offset)', () => {
    expect(componentesUtc(fechaExcel('2026-09-23T03:30:59.123456+00:00', 'America/Bogota'))).toEqual([
      2026, 9, 22, 22, 30,
    ]);
  });

  it('medianoche local es 00, no 24', () => {
    // Algunos motores devuelven "24" con hour12: false; hourCycle h23 lo evita.
    expect(componentesUtc(fechaExcel(new Date('2026-09-23T05:00:00Z'), 'America/Bogota'))).toEqual([
      2026, 9, 23, 0, 0,
    ]);
  });

  it('segundos y milisegundos en cero (la celda es dd/mm/yyyy hh:mm)', () => {
    const d = fechaExcel(new Date('2026-09-23T03:30:59.999Z'), 'America/Bogota');
    expect([d.getUTCSeconds(), d.getUTCMilliseconds()]).toEqual([0, 0]);
  });

  it('un instante ilegible es un error, no una fecha inventada', () => {
    expect(() => fechaExcel('no-es-fecha', 'America/Bogota')).toThrow('fechaExcel: instante inválido');
  });
});

describe('diaExcel', () => {
  it.each(ZONAS_DE_PROCESO)('un día AAAA-MM-DD es ese día, con el proceso en %s', (zona) => {
    zonaDelProceso(zona);
    // El día ya viene LOCAL (la SQL lo cortó en la zona del comercio): no se convierte nada.
    expect(componentesUtc(diaExcel('2026-09-23'))).toEqual([2026, 9, 23, 0, 0]);
    expect(componentesUtc(diaExcel('2027-01-01'))).toEqual([2027, 1, 1, 0, 0]);
  });

  it('un día ilegible es un error', () => {
    expect(() => diaExcel('2026-02-31')).toThrow('diaExcel: día inválido');
    expect(() => diaExcel('23/09/2026')).toThrow('diaExcel: día inválido');
  });
});

describe('formatos', () => {
  it('los de la spec', () => {
    expect(FORMATO_DIA_EXCEL).toBe('dd/mm/yyyy');
    expect(FORMATO_FECHA_HORA_EXCEL).toBe('dd/mm/yyyy hh:mm');
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { formatearFecha, formatearFechaCorta } from './vigencia';

// Prueba PURA, en archivo aparte de vigencia.test.ts a propósito: aquel tiene un afterEach que limpia
// la base, y esto no toca Supabase.
//
// El borde que importa es la ZONA. `Intl.DateTimeFormat` sin `timeZone` formatea en la zona del
// proceso: en la máquina de Daniel es America/El_Salvador, pero en Vercel (y en cualquier CI) es UTC,
// y en UTC la mutación de abajo NO se ve — `2026-10-12T00:00:00Z` sigue siendo el 12. Por eso la
// prueba fuerza la zona con `process.env.TZ` (Node la relee al asignarla) y además VERIFICA que el
// cambio tomó: si algún día el runner deja de respetarlo, la prueba se cae en vez de quedar verde
// formateando en UTC.

const tzOriginal = process.env.TZ;
const zonaOriginal = Intl.DateTimeFormat().resolvedOptions().timeZone;

function enZona(zona: string) {
  process.env.TZ = zona;
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zona);
}

afterEach(() => {
  // `delete process.env.TZ` NO le avisa a Node (se verificó: la zona queda en la última asignada),
  // así que primero se reasigna la zona que tenía el proceso y recién después se borra la variable si
  // no existía.
  process.env.TZ = zonaOriginal;
  if (tzOriginal === undefined) delete process.env.TZ;
});

describe('formatearFecha', () => {
  it('escribe la fecha larga en español', () => {
    enZona('America/El_Salvador');
    expect(formatearFecha('2026-10-12')).toBe('12 de octubre de 2026');
  });

  it('ignora la hora si le llega un timestamp completo', () => {
    enZona('America/El_Salvador');
    expect(formatearFecha('2026-10-12T23:59:59.000Z')).toBe('12 de octubre de 2026');
  });

  it('null o vacío ⇒ texto vacío', () => {
    expect(formatearFecha(null)).toBe('');
    expect(formatearFecha('')).toBe('');
  });

  // MUTACIÓN (vigencia.ts, formatearFecha): `T12:00:00Z` → `T00:00:00Z`. Medianoche UTC es la tarde
  // del día ANTERIOR en toda América (las 6 de la tarde del 11 en El Salvador), así que el socio
  // leería "Vence el 11 de octubre" cuando le queda todo el 12. Esta prueba cae en las cinco zonas
  // americanas; en UTC sigue verde, que es justamente por qué se fuerza la zona.
  it.each([
    'America/El_Salvador', // UTC-6, la del producto
    'America/Mexico_City',
    'America/New_York',
    'America/Los_Angeles',
    'America/Adak', // UTC-10/-9, la más al oeste de América
    'UTC',
  ])('no corre el día en %s', (zona) => {
    enZona(zona);
    expect(formatearFecha('2026-10-12')).toBe('12 de octubre de 2026');
    // Fin de año: si se corriera, cambiaría también el AÑO.
    expect(formatearFecha('2027-01-01')).toBe('1 de enero de 2027');
  });
});

// La fecha CORTA de la esquina del pase ("VÁLIDO HASTA 16/10/2026"): la larga de formatearFecha no
// entra al lado del logo. Se arma recortando el texto, sin `Date`, así que no hay zona que la corra;
// las pruebas de zona igual se quedan, porque "sin Date" es un detalle de implementación que alguien
// puede cambiar por un `toLocaleDateString` que se ve igual en UTC.
describe('formatearFechaCorta', () => {
  it('AAAA-MM-DD → dd/mm/aaaa, con los ceros a la izquierda', () => {
    expect(formatearFechaCorta('2026-10-16')).toBe('16/10/2026');
    expect(formatearFechaCorta('2026-08-03')).toBe('03/08/2026');
  });

  it('con un timestamp completo toma solo los primeros 10 caracteres', () => {
    expect(formatearFechaCorta('2026-10-16T23:59:59.000Z')).toBe('16/10/2026');
    expect(formatearFechaCorta('2026-10-16T00:00:00+00:00')).toBe('16/10/2026');
  });

  // MUTACIÓN (vigencia.ts, formatearFechaCorta): armarla con
  // `new Date(iso.slice(0, 10)).toLocaleDateString('es-SV', { day: '2-digit', month: '2-digit', year: 'numeric' })`.
  // `new Date('2026-10-16')` es medianoche UTC, que en América todavía es el 15: la esquina del pase
  // diría "VÁLIDO HASTA 15/10/2026" y el socio perdería un día. Cae en las cinco zonas americanas con
  // `expected '15/10/2026' to be '16/10/2026'`; en UTC sigue verde.
  it.each([
    'America/El_Salvador',
    'America/Mexico_City',
    'America/New_York',
    'America/Los_Angeles',
    'America/Adak',
    'UTC',
  ])('no corre el día en %s', (zona) => {
    enZona(zona);
    expect(formatearFechaCorta('2026-10-16')).toBe('16/10/2026');
    expect(formatearFechaCorta('2027-01-01')).toBe('01/01/2027');
  });
});

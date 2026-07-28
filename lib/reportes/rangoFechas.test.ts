import { describe, it, expect } from 'vitest';
import { esFechaValida, resolverRangoFechas, rangoUltimosDias } from './rangoFechas';

// Módulo puro: sin BD, sin reloj propio. Todo lo que depende del tiempo entra por argumento.

describe('esFechaValida', () => {
  it('acepta una fecha real en formato AAAA-MM-DD', () => {
    expect(esFechaValida('2026-07-28')).toBe(true);
    expect(esFechaValida('2024-02-29')).toBe(true); // bisiesto real
  });

  it('rechaza fechas que el calendario no tiene', () => {
    // El round-trip por Date es lo que atrapa esto: `new Date('2026-02-31')` no falla, JS lo
    // "corrige" a marzo en silencio. Sin el round-trip, un filtro imposible pasaría al RPC.
    expect(esFechaValida('2026-02-31')).toBe(false);
    expect(esFechaValida('2026-13-01')).toBe(false);
    expect(esFechaValida('2025-02-29')).toBe(false); // 2025 no es bisiesto
  });

  it('rechaza formatos que no son AAAA-MM-DD', () => {
    // El mensaje nombra el valor: sin él, un fallo dice "expected true to be false" y hay que
    // adivinar cuál de los seis lo causó (pasó al escribir esta prueba, con '0000-01-01').
    for (const valor of ['', '28/07/2026', '2026-7-28', '2026-07-28T10:00:00', 'ayer', '0000-01-01']) {
      expect(esFechaValida(valor), `"${valor}" debería rechazarse`).toBe(false);
    }
  });
});

describe('resolverRangoFechas', () => {
  it('deja pasar un rango válido tal cual', () => {
    expect(resolverRangoFechas('2026-07-01', '2026-07-28')).toEqual({
      desde: '2026-07-01',
      hasta: '2026-07-28',
    });
  });

  it('descarta una fecha ilegible en vez de rechazar la pantalla entera', () => {
    // Un filtro mal tecleado no debería dejar al dueño sin poder ver nada: se cae ese borde y el
    // otro sigue aplicando.
    expect(resolverRangoFechas('no-es-fecha', '2026-07-28')).toEqual({
      desde: null,
      hasta: '2026-07-28',
    });
  });

  it('trata undefined y vacío como "sin ese borde"', () => {
    expect(resolverRangoFechas(undefined, undefined)).toEqual({ desde: null, hasta: null });
    expect(resolverRangoFechas('  ', '')).toEqual({ desde: null, hasta: null });
  });

  it('intercambia un rango invertido en vez de vaciarlo', () => {
    // Es casi siempre un error de tecleo. Devolver el rango que el dueño evidentemente quiso ver
    // es mejor que devolverle una tabla vacía sin explicación.
    expect(resolverRangoFechas('2026-07-28', '2026-07-01')).toEqual({
      desde: '2026-07-01',
      hasta: '2026-07-28',
    });
  });

  it('no intercambia cuando desde y hasta son el mismo día', () => {
    // El borde del `>`: con `>=` un rango de un solo día seguiría funcionando, pero conviene que
    // quede fijado que un solo día es legítimo (ver la actividad de hoy).
    expect(resolverRangoFechas('2026-07-28', '2026-07-28')).toEqual({
      desde: '2026-07-28',
      hasta: '2026-07-28',
    });
  });
});

describe('rangoUltimosDias', () => {
  it('cuenta HOY como uno de los días', () => {
    // 30 días termina hoy y empieza 29 días atrás, no 30: si contara 30 hacia atrás, el rango
    // tendría 31 días y no coincidiría con lo que dice la pantalla.
    const hoy = new Date('2026-07-28T18:00:00Z');
    expect(rangoUltimosDias(hoy, 30, 'America/El_Salvador')).toEqual({
      desde: '2026-06-29',
      hasta: '2026-07-28',
    });
  });

  it('un rango de un día es solo hoy', () => {
    const hoy = new Date('2026-07-28T18:00:00Z');
    expect(rangoUltimosDias(hoy, 1, 'America/El_Salvador')).toEqual({
      desde: '2026-07-28',
      hasta: '2026-07-28',
    });
  });

  it('usa la zona del comercio, no la del servidor', () => {
    // 2026-07-28 a las 03:00 UTC es todavía el 27 en El Salvador (UTC-6). Un servidor en UTC
    // —Vercel— diría 28 y el reporte arrancaría un día corrido. Esta es exactamente la clase de
    // error que en una pantalla de auditoría hace desaparecer movimientos.
    const madrugadaUtc = new Date('2026-07-28T03:00:00Z');
    expect(rangoUltimosDias(madrugadaUtc, 1, 'America/El_Salvador')).toEqual({
      desde: '2026-07-27',
      hasta: '2026-07-27',
    });
    expect(rangoUltimosDias(madrugadaUtc, 1, 'UTC')).toEqual({
      desde: '2026-07-28',
      hasta: '2026-07-28',
    });
  });

  it('satura un número de días absurdo en 1', () => {
    const hoy = new Date('2026-07-28T18:00:00Z');
    expect(rangoUltimosDias(hoy, 0, 'America/El_Salvador').desde).toBe('2026-07-28');
    expect(rangoUltimosDias(hoy, -5, 'America/El_Salvador').desde).toBe('2026-07-28');
  });
});

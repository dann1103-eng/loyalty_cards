import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { validarUrlResenaGoogle, leerResenaGoogle, guardarResenaGoogle } from './resenaGoogle';

// Mutation-testing de la parte PURA (validarUrlResenaGoogle) CONFIRMADO (2026-09-23), cada una
// restaurada después de corrida:
// - `host.endsWith(\`.${sufijo}\`)` → `host.endsWith(sufijo)` (sin el punto): falla "google.com.malo…
//   no, espera" — en concreto, falla "malogoogle.com → rechazado" (pasa a aceptarse: termina en las
//   diez letras "google.com" sin ser un subdominio).
// - `host === sufijo || host.endsWith(...)` → `host.includes(sufijo)`: falla "google.com.malo.com →
//   rechazado" (lo contiene en el medio y pasa a aceptarse).
// - Quitar el chequeo `url.protocol !== 'https:'`: falla "http://g.page/r/abc → rechazado: no https".
//
// Las de leerResenaGoogle/guardarResenaGoogle (contra Supabase) y su mutación de la revalidación al
// leer quedan PENDIENTES: la migración 0039 todavía no está aplicada en esta base (confirmado con
// scripts/verificar-0039.ts el 2026-09-23), así que hoy ninguna puede correr en verde. Se corrieron
// para confirmar que fallan por "column comercios.pedir_resena_google does not exist" (42703) y
// ninguna otra razón. Verde y esa mutación: Tarea 9.

describe('validarUrlResenaGoogle', () => {
  describe('aceptados', () => {
    const casos: Array<[string, string]> = [
      ['https://g.page/r/abc/review', 'https://g.page/r/abc/review'],
      ['https://goo.gl/maps/x', 'https://goo.gl/maps/x'],
      ['https://maps.app.goo.gl/x', 'https://maps.app.goo.gl/x'],
      ['https://www.google.com/maps/place/x', 'https://www.google.com/maps/place/x'],
      [
        'https://search.google.com/local/writereview?placeid=x',
        'https://search.google.com/local/writereview?placeid=x',
      ],
      ['https://google.com/x', 'https://google.com/x'],
      ['https://www.google.com.sv/maps/x', 'https://www.google.com.sv/maps/x'],
    ];

    for (const [entrada, esperado] of casos) {
      it(`${entrada} → válido`, () => {
        expect(validarUrlResenaGoogle(entrada)).toEqual({ ok: true, url: esperado });
      });
    }

    it('recorta espacios alrededor', () => {
      expect(validarUrlResenaGoogle('   https://g.page/r/abc/review   ')).toEqual({
        ok: true,
        url: 'https://g.page/r/abc/review',
      });
    });

    it('vacío → válido, sin link', () => {
      expect(validarUrlResenaGoogle('')).toEqual({ ok: true, url: null });
    });

    it('solo espacios → válido, sin link', () => {
      expect(validarUrlResenaGoogle('   ')).toEqual({ ok: true, url: null });
    });
  });

  describe('rechazados', () => {
    it('http:// (no https) → error de protocolo', () => {
      expect(validarUrlResenaGoogle('http://g.page/r/abc')).toEqual({
        ok: false,
        error: 'El link tiene que empezar con https://.',
      });
    });

    it('google.com.malo.com (contiene el sufijo en el medio) → error de host', () => {
      expect(validarUrlResenaGoogle('https://google.com.malo.com/x')).toEqual({
        ok: false,
        error: 'Ese link no es de Google. Pegá el link para dejar reseña que te da Google (empieza con https://g.page/…).',
      });
    });

    it('malogoogle.com (termina en las letras sin ser subdominio) → error de host', () => {
      expect(validarUrlResenaGoogle('https://malogoogle.com/x')).toEqual({
        ok: false,
        error: 'Ese link no es de Google. Pegá el link para dejar reseña que te da Google (empieza con https://g.page/…).',
      });
    });

    it('g.page.malo.com (imita g.page como prefijo) → error de host', () => {
      expect(validarUrlResenaGoogle('https://g.page.malo.com/x')).toEqual({
        ok: false,
        error: 'Ese link no es de Google. Pegá el link para dejar reseña que te da Google (empieza con https://g.page/…).',
      });
    });

    it('javascript:alert(1) → error de protocolo (no es https)', () => {
      expect(validarUrlResenaGoogle('javascript:alert(1)')).toEqual({
        ok: false,
        error: 'El link tiene que empezar con https://.',
      });
    });

    it('"no es un link" → error de link inválido (new URL no parsea)', () => {
      expect(validarUrlResenaGoogle('no es un link')).toEqual({
        ok: false,
        error: 'Ese texto no es un link. Pegá el link para dejar reseña que te da Google (empieza con https://g.page/…).',
      });
    });

    it('instagram.com → error de host (no es Google)', () => {
      expect(validarUrlResenaGoogle('https://instagram.com/negocio')).toEqual({
        ok: false,
        error: 'Ese link no es de Google. Pegá el link para dejar reseña que te da Google (empieza con https://g.page/…).',
      });
    });
  });
});

describe('guardarResenaGoogle / leerResenaGoogle (contra Supabase — migración 0039 pendiente)', () => {
  const supabase = createServiceClient();
  const entorno = crearEntorno(supabase);

  afterEach(() => entorno.limpiar());

  it('guarda pedir + link válido, y se relee igual', async () => {
    const comercioId = await entorno.crearComercio();

    const res = await guardarResenaGoogle(supabase, comercioId, {
      pedir: true,
      urlTexto: 'https://g.page/r/abc/review',
    });
    expect(res).toEqual({ ok: true });

    const leido = await leerResenaGoogle(supabase, comercioId);
    expect(leido).toEqual({ pedir: true, url: 'https://g.page/r/abc/review' });
  });

  it('pedir SIN link → el error exacto, y no guarda nada', async () => {
    const comercioId = await entorno.crearComercio();

    const res = await guardarResenaGoogle(supabase, comercioId, { pedir: true, urlTexto: '' });

    expect(res).toEqual({ ok: false, error: 'Pegá el link para dejar reseña en Google.' });
    const leido = await leerResenaGoogle(supabase, comercioId);
    expect(leido).toEqual({ pedir: false, url: null });
  });

  it('guarda el link con pedir APAGADO (queda listo para prenderlo después), y se relee', async () => {
    const comercioId = await entorno.crearComercio();

    const res = await guardarResenaGoogle(supabase, comercioId, {
      pedir: false,
      urlTexto: 'https://goo.gl/maps/x',
    });

    expect(res).toEqual({ ok: true });
    const leido = await leerResenaGoogle(supabase, comercioId);
    expect(leido).toEqual({ pedir: false, url: 'https://goo.gl/maps/x' });
  });

  it('un link inválido escrito por UPDATE directo (bypass de esta capa) se relee como url: null', async () => {
    // Simula un dato que quedó de un estado anterior (p. ej. la lista de hosts se endureció después
    // de guardado) — nunca pasaría por guardarResenaGoogle en la UI real, que lo hubiera rechazado.
    // pedir_resena_google en false para no chocar con el CHECK comercios_resena_con_link (exige
    // pedir → url no nulo; acá el problema es la VALIDEZ del link, no si es nulo).
    const comercioId = await entorno.crearComercio();
    const { error } = await supabase
      .from('comercios')
      .update({ pedir_resena_google: false, resena_google_url: 'https://instagram.com/negocio' })
      .eq('id', comercioId);
    expect(error).toBeNull();

    const leido = await leerResenaGoogle(supabase, comercioId);

    expect(leido).toEqual({ pedir: false, url: null });
  });

  it('resena_google_url guardado como "" (la base lo acepta) se relee como url: null', async () => {
    const comercioId = await entorno.crearComercio();
    const { error } = await supabase
      .from('comercios')
      .update({ pedir_resena_google: false, resena_google_url: '' })
      .eq('id', comercioId);
    expect(error).toBeNull();

    const leido = await leerResenaGoogle(supabase, comercioId);

    expect(leido).toEqual({ pedir: false, url: null });
  });
});

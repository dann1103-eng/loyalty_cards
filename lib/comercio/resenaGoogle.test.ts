import { describe, it, expect, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import {
  validarUrlResenaGoogle,
  leerResenaGoogle,
  guardarResenaGoogle,
  MAXIMO_LARGO_URL_RESENA,
} from './resenaGoogle';

// Mutation-testing de la parte PURA (validarUrlResenaGoogle) CONFIRMADO (2026-09-23), cada una
// restaurada después de corrida:
// - Volver a aceptar el sufijo abierto `*.google.com` (la versión anterior a la revisión del commit
//   455b165: `host === 'google.com' || host.endsWith('.google.com')`): falla "sites.google.com → …
//   rechazado" (pasa a aceptarse).
// - Quitar el chequeo de ruta `/url`/`/amp` (`esRutaDeRedireccion`) dentro de un host de Google:
//   falla "google.com/url?q=… → rechazado (redirección abierta)" y "…/amp/… → rechazado".
// - Quitar el chequeo `url.username || url.password || url.port`: falla las tres pruebas de
//   credenciales/puerto ("usuario antes del host permitido", "usuario que imita un host permitido",
//   "puerto").
// - Quitar el chequeo de largo (`url.href.length > MAXIMO_LARGO_URL_RESENA`): falla "501 caracteres
//   → rechazado por largo".
// - Devolver `limpio` (el texto tal como se tecleó) en vez de `url.href`: falla "mayúsculas se
//   normalizan" (HTTPS://G.PAGE/r/abc no vuelve como https://g.page/r/abc si se devuelve el texto
//   crudo sin normalizar).
//
// Las de leerResenaGoogle/guardarResenaGoogle CONTRA SUPABASE (más abajo), con la migración 0039
// aplicada y verificada (2026-09-23), corren en verde.
//
// Mutation-testing CONFIRMADO (2026-09-23, con la 0039 aplicada), restaurada después de corrida:
// - Quitar la revalidación en `leerResenaGoogle` (devolver `data.resena_google_url` crudo en vez de
//   `revalidado.url`): falla "un link inválido escrito por UPDATE directo (bypass de esta capa) se
//   relee como url: null" — el link inválido volvía tal cual, sin pasar de nuevo por
//   `validarUrlResenaGoogle`. (El caso "guardado como '' se relee como url: null" no discrimina esta
//   mutación: `'' || null` también da `null`.)

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
      // Los dos hosts nuevos de la lista corregida (antes solo cubiertos por el sufijo abierto).
      ['https://maps.google.com/place/x', 'https://maps.google.com/place/x'],
      ['https://search.google.com.sv/local/writereview?placeid=x', 'https://search.google.com.sv/local/writereview?placeid=x'],
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

    it('mayúsculas se normalizan: se guarda url.href, no el texto tal como se tecleó', () => {
      // Discrimina la mutación "devolver `limpio` en vez de `url.href`": el texto recortado
      // conserva las mayúsculas, url.href no.
      expect(validarUrlResenaGoogle('HTTPS://G.PAGE/r/abc')).toEqual({
        ok: true,
        url: 'https://g.page/r/abc',
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

    it('goo.gl SIN /maps/ → error de host: el acortador genérico puede apuntar a cualquier sitio', () => {
      expect(validarUrlResenaGoogle('https://goo.gl/abc')).toEqual({
        ok: false,
        error: 'Ese link no es de Google. Pegá el link para dejar reseña que te da Google (empieza con https://g.page/…).',
      });
    });

    it('sites.google.com → rechazado: páginas que publica cualquiera, no un sufijo abierto', () => {
      expect(validarUrlResenaGoogle('https://sites.google.com/view/x')).toEqual({
        ok: false,
        error: 'Ese link no es de Google. Pegá el link para dejar reseña que te da Google (empieza con https://g.page/…).',
      });
    });

    it('docs.google.com/forms → rechazado: le pediría datos al cliente con la marca de Google', () => {
      expect(validarUrlResenaGoogle('https://docs.google.com/forms/d/x')).toEqual({
        ok: false,
        error: 'Ese link no es de Google. Pegá el link para dejar reseña que te da Google (empieza con https://g.page/…).',
      });
    });

    it('google.com/url?q=… → rechazado (redirección abierta)', () => {
      expect(validarUrlResenaGoogle('https://www.google.com/url?q=https://malo.com')).toEqual({
        ok: false,
        error: 'Ese link no es de Google. Pegá el link para dejar reseña que te da Google (empieza con https://g.page/…).',
      });
    });

    it('google.com/amp/… → rechazado (visor AMP, misma vía de redirección abierta)', () => {
      expect(validarUrlResenaGoogle('https://www.google.com/amp/s/malo.com')).toEqual({
        ok: false,
        error: 'Ese link no es de Google. Pegá el link para dejar reseña que te da Google (empieza con https://g.page/…).',
      });
    });

    it('usuario que imita un host permitido (g.page@malo.com: el host de verdad es malo.com) → error de credenciales', () => {
      // `new URL('https://g.page@malo.com')`: username = "g.page", host = "malo.com". El chequeo de
      // usuario/contraseña/puerto corre ANTES que el de host, así que el error es el de credenciales
      // y no el de "host ajeno" — aunque los dos rechazarían este link de todos modos.
      expect(validarUrlResenaGoogle('https://g.page@malo.com')).toEqual({
        ok: false,
        error: 'Ese link no puede llevar usuario, contraseña ni puerto. Pegá el link tal como te lo da Google.',
      });
    });

    it('usuario antes de un host permitido (malo.com@g.page/r/x: el host SÍ es g.page) → error de credenciales', () => {
      // Acá el host de verdad ES g.page (permitido) y el usuario es "malo.com" — sin el chequeo de
      // username/password/port, este caso pasaría el chequeo de host y se colaría.
      expect(validarUrlResenaGoogle('https://malo.com@g.page/r/x')).toEqual({
        ok: false,
        error: 'Ese link no puede llevar usuario, contraseña ni puerto. Pegá el link tal como te lo da Google.',
      });
    });

    it('puerto en un host permitido (g.page:8080) → error de credenciales/puerto', () => {
      expect(validarUrlResenaGoogle('https://g.page:8080/r/x')).toEqual({
        ok: false,
        error: 'Ese link no puede llevar usuario, contraseña ni puerto. Pegá el link tal como te lo da Google.',
      });
    });

    it('501+ caracteres → rechazado por largo (el CHECK de la 0039 es <= 500)', () => {
      // Host válido (g.page, ruta libre) para que el único motivo de rechazo sea el largo.
      const largo = `https://g.page/${'a'.repeat(500)}`;
      expect(largo.length).toBeGreaterThan(MAXIMO_LARGO_URL_RESENA);
      expect(validarUrlResenaGoogle(largo)).toEqual({
        ok: false,
        error: 'Ese link es muy largo. Usá el de "Pedir reseñas" de tu Perfil de Empresa de Google (https://g.page/…).',
      });
    });
  });
});

// Item 7(a) de la revisión: estas dos pruebas corren en VERDE hoy, sin depender de la migración 0039
// — el `from` del stub TIRA si algo lo llama, así que confirman que guardarResenaGoogle corta ANTES
// de tocar la base en los dos casos donde la validación ya alcanza para decidir el resultado.
describe('guardarResenaGoogle — corta antes de tocar la base', () => {
  function supabaseQueNuncaDebeTocarLaBase(): SupabaseClient<Database> {
    return {
      from: () => {
        throw new Error('[test] guardarResenaGoogle no debería tocar la base en este caso');
      },
    } as unknown as SupabaseClient<Database>;
  }

  it('pedir SIN link → el error exacto, sin llamar a supabase.from', async () => {
    const res = await guardarResenaGoogle(supabaseQueNuncaDebeTocarLaBase(), 'comercio-de-prueba', {
      pedir: true,
      urlTexto: '',
    });
    expect(res).toEqual({ ok: false, error: 'Pegá el link para dejar reseña en Google.' });
  });

  it('link inválido → el error de la validación, sin llamar a supabase.from', async () => {
    const res = await guardarResenaGoogle(supabaseQueNuncaDebeTocarLaBase(), 'comercio-de-prueba', {
      pedir: false,
      urlTexto: 'https://instagram.com/negocio',
    });
    expect(res).toEqual({
      ok: false,
      error: 'Ese link no es de Google. Pegá el link para dejar reseña que te da Google (empieza con https://g.page/…).',
    });
  });
});

describe('guardarResenaGoogle / leerResenaGoogle (contra Supabase)', () => {
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
    // de guardado — como pasó de verdad el 2026-09-23) — nunca pasaría por guardarResenaGoogle en la
    // UI real, que lo hubiera rechazado. pedir_resena_google en false para no chocar con el CHECK
    // comercios_resena_con_link (exige pedir → url no nulo; acá el problema es la VALIDEZ del link,
    // no si es nulo).
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

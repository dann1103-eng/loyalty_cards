import { describe, expect, it } from 'vitest';
import {
  combinarDatosCartel,
  type ComercioParaCartel,
  type FilaDisenoCartel,
} from './combinarDatos';

// Módulo PURO (sin Supabase, sin fetch, sin DOM): se prueba con objetos planos. Es la lógica de
// override-vs-heredado del cartel, que el spec §7 marca como la de más superficie de bug silencioso
// —mostrarle a un comercio el logo o el color de OTRO sería el peor caso posible— y que en este
// repo ya se rompió dos veces en julio de 2026 (brandingEfectivo/reversoEfectivo, y sello_meta en
// lib/apple/datosPassDeTarjeta.ts). Por eso cada campo tiene su prueba con el razonamiento escrito.
const COMERCIO: ComercioParaCartel = {
  nombre: 'Café Sol',
  color_fondo: 'rgb(59, 42, 30)',
  color_texto: 'rgb(245, 237, 224)',
  color_label: 'rgb(232, 185, 120)',
  logo_url: 'https://ejemplo.test/logo.webp',
  hero_url: 'https://ejemplo.test/hero.webp',
};

// Fila de diseño que EXISTE pero no pisa nada. Los dos textos no son null porque en la migración
// 0028 `texto_cta` es NOT NULL con default: una fila recién creada trae el CTA del sistema.
const DISENO_SIN_OVERRIDES: FilaDisenoCartel = {
  plantilla: 'centrado',
  color_fondo: null,
  color_texto: null,
  color_label: null,
  logo_url: null,
  texto_cta: '¡Escaneá y sumate!',
  texto_teaser: null,
};

describe('combinarDatosCartel', () => {
  it('SIN fila de diseño, hereda TODO de comercios y usa los defaults del sistema', () => {
    const r = combinarDatosCartel(COMERCIO, null);
    expect(r).toEqual({
      nombreComercio: 'Café Sol',
      plantilla: 'centrado',
      colorFondo: 'rgb(59, 42, 30)',
      colorTexto: 'rgb(245, 237, 224)',
      colorLabel: 'rgb(232, 185, 120)',
      logoUrl: 'https://ejemplo.test/logo.webp',
      fotoUrl: 'https://ejemplo.test/hero.webp',
      textoCta: '¡Escaneá y sumate!',
      textoTeaser: null,
    });
  });

  it('CON fila de diseño pero todos sus overrides en null, el resultado es IDÉNTICO a sin fila', () => {
    const sinFila = combinarDatosCartel(COMERCIO, null);
    const conFilaVacia = combinarDatosCartel(COMERCIO, DISENO_SIN_OVERRIDES);
    expect(conFilaVacia).toEqual(sinFila);
  });

  it('un override no-nulo GANA sobre el valor de comercios', () => {
    const r = combinarDatosCartel(COMERCIO, {
      plantilla: 'split',
      color_fondo: '#000000',
      color_texto: null,
      color_label: null,
      logo_url: 'https://ejemplo.test/logo-cartel.webp',
      texto_cta: 'Sumate al club',
      texto_teaser: 'Tu 5to café gratis',
    });
    expect(r.plantilla).toBe('split');
    expect(r.colorFondo).toBe('#000000');
    expect(r.colorTexto).toBe('rgb(245, 237, 224)'); // no overrideado: hereda
    expect(r.logoUrl).toBe('https://ejemplo.test/logo-cartel.webp');
    expect(r.textoCta).toBe('Sumate al club');
    expect(r.textoTeaser).toBe('Tu 5to café gratis');
  });

  it('fotoUrl SIEMPRE viene de comercios.hero_url — no existe override de foto', () => {
    // El diseño trae un logo propio A PROPÓSITO. Con `logo_url: null` esta prueba pasaría igual
    // aunque fotoUrl leyera `diseno.logo_url ?? comercio.hero_url` (el null se cae solo y termina en
    // el hero de todas formas): no probaría nada. Se verificó con mutation-testing — esa mutación
    // SOBREVIVE con un logo en null y muere con este.
    const r = combinarDatosCartel(COMERCIO, {
      ...DISENO_SIN_OVERRIDES,
      plantilla: 'foto',
      logo_url: 'https://ejemplo.test/logo-cartel.webp',
    });
    expect(r.fotoUrl, 'la foto no puede leer la columna del logo').toBe(
      'https://ejemplo.test/hero.webp',
    );
    expect(r.logoUrl).toBe('https://ejemplo.test/logo-cartel.webp');
  });

  it('un comercio SIN marca configurada cae en los defaults del sistema, no en null/undefined', () => {
    const comercioNuevo: ComercioParaCartel = {
      nombre: 'Negocio Nuevo',
      color_fondo: null,
      color_texto: null,
      color_label: null,
      logo_url: null,
      hero_url: null,
    };
    const r = combinarDatosCartel(comercioNuevo, null);
    expect(r.colorFondo).toBe('rgb(19, 19, 21)');
    expect(r.colorTexto).toBe('rgb(245, 245, 240)');
    expect(r.colorLabel).toBe('rgb(255, 157, 66)');
    expect(r.logoUrl).toBeNull();
    expect(r.fotoUrl).toBeNull();
  });

  it('una plantilla guardada inválida (dato corrupto) cae a "centrado" en vez de propagarse', () => {
    const r = combinarDatosCartel(COMERCIO, {
      ...DISENO_SIN_OVERRIDES,
      plantilla: 'esto-no-es-una-plantilla',
    });
    expect(r.plantilla).toBe('centrado');
    // La cadena vacía tampoco es una plantilla: mismo camino, sin excepción.
    expect(combinarDatosCartel(COMERCIO, { ...DISENO_SIN_OVERRIDES, plantilla: '' }).plantilla).toBe(
      'centrado',
    );
  });

  // ── Campo por campo: ¿qué significa `null` acá? ────────────────────────────────────────────────
  //
  // Esta es la pregunta que se contestó mal con `sello_meta` (lib/apple/datosPassDeTarjeta.ts): ahí
  // null era un valor LEGÍTIMO —un cupón no tiene meta de sellos— y el `?? comercio.sello_meta` le
  // hacía heredar la meta ajena, así que el pase le dibujaba una grilla que nadie pidió. La prueba
  // lo atrapó con "expected 8 to be null".
  //
  // Acá la respuesta es la contraria, y no es una intuición: lo dicen dos fuentes independientes.
  // (1) El spec §2.3: "Los campos de color/logo del cartel nacen en `null` (= heredar de
  //     `comercios`) y el comercio los puede pisar explícitamente".
  // (2) La pantalla: el único botón que escribe `logo_url = null` se llama, textualmente, "Quitar
  //     (volver al logo de marca)" — o sea que null ES el pedido de heredar.
  // No existe, ni en la tabla ni en la UI, una manera de decir "este cartel no lleva logo": si
  // algún día hiciera falta, necesita su propia columna (un booleano), NUNCA reinterpretar el null.
  it('logo_url en null significa "volvé al logo de marca", NO "cartel sin logo"', () => {
    const r = combinarDatosCartel(COMERCIO, { ...DISENO_SIN_OVERRIDES, logo_url: null });
    expect(r.logoUrl, 'null = heredá; un "sin logo" necesitaría su propia columna').toBe(
      'https://ejemplo.test/logo.webp',
    );
  });

  it('texto_teaser en null es "sin teaser", no hay nada que heredar (comercios no tiene teaser)', () => {
    const r = combinarDatosCartel(COMERCIO, { ...DISENO_SIN_OVERRIDES, texto_teaser: null });
    expect(r.textoTeaser).toBeNull();
  });

  // ── Cadena vacía: ausencia, NUNCA una decisión ────────────────────────────────────────────────
  //
  // El otro medio del bug de julio: `??` y `||` solo se comportan distinto cuando el valor es
  // falsy-pero-presente. En `reversoEfectivo` ese valor es un BOOLEANO (`false` = "no quiero la
  // sección") y por eso ahí `||` está prohibido. En esta función no hay booleanos ni números: el
  // único falsy posible en `string | null` es `''`, y `''` no es una decisión de nadie —
  // `accionGuardarCartel` guarda `String(...).trim() || null`, o sea que el propio sistema declara
  // que "en blanco" quiere decir "heredá". Un `''` guardado a mano se dibujaría como
  // `<rect fill="">` (cartel negro) o un CTA invisible, sin que el dueño lo haya elegido nunca.
  it('un override en blanco ("" o solo espacios) hereda igual que null, no pisa con vacío', () => {
    const r = combinarDatosCartel(COMERCIO, {
      ...DISENO_SIN_OVERRIDES,
      color_fondo: '',
      color_texto: '   ',
      logo_url: '',
    });
    expect(r.colorFondo, 'un color en blanco no es un color elegido').toBe('rgb(59, 42, 30)');
    expect(r.colorTexto, 'solo espacios tampoco es un color elegido').toBe('rgb(245, 237, 224)');
    expect(r.logoUrl, 'una URL en blanco no es un logo propio').toBe('https://ejemplo.test/logo.webp');
  });

  it('un texto_cta en blanco cae al CTA del sistema, nunca a un llamado a la acción invisible', () => {
    const r = combinarDatosCartel(COMERCIO, { ...DISENO_SIN_OVERRIDES, texto_cta: '   ' });
    expect(r.textoCta).toBe('¡Escaneá y sumate!');
  });

  it('un texto_teaser en blanco se normaliza a null, no a una segunda línea vacía', () => {
    const r = combinarDatosCartel(COMERCIO, { ...DISENO_SIN_OVERRIDES, texto_teaser: '  ' });
    expect(r.textoTeaser).toBeNull();
  });

  it('si el comercio tiene un color en blanco (dato viejo), tampoco gana: cae al del sistema', () => {
    const comercioCorrupto: ComercioParaCartel = { ...COMERCIO, color_fondo: '', hero_url: '  ' };
    const r = combinarDatosCartel(comercioCorrupto, null);
    expect(r.colorFondo).toBe('rgb(19, 19, 21)');
    expect(r.fotoUrl).toBeNull();
  });
});

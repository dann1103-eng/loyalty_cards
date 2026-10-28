import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServiceClient } from '@/lib/supabase/server';
import { crearEntorno } from '@/test/fixtures/entornoComercio';
import { obtenerPrograma } from '@/lib/comercio/programas';
import { SIN_PATRON } from '@/lib/tarjetas/patronSellos';

// El gate del dueño se mockea porque necesita cookies de una request real; se prueba aparte en
// verifyComercioOwner. Mismo criterio que las pruebas de sucursales y del cartel.
const { sesion } = vi.hoisted(() => ({ sesion: { comercioId: '' } }));
vi.mock('@/lib/comercio/verifyComercioOwner', () => ({
  verifyComercioOwner: async () => ({ comercioId: sesion.comercioId }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

// Los efectos de propagación se mockean: lo que se prueba acá NO es qué le mandan a Apple o a
// Google (eso vive en sus propios archivos), sino que la acción los LLAME. Google no se toca nunca
// desde las pruebas (CLAUDE.md).
const { apple, appleprograma, claseGoogle, objetosGoogle, objetosPrograma, barrido, claseDePrograma } = vi.hoisted(() => ({
  apple: vi.fn(),
  appleprograma: vi.fn(),
  claseGoogle: vi.fn(),
  objetosGoogle: vi.fn(),
  objetosPrograma: vi.fn(),
  barrido: vi.fn(),
  claseDePrograma: vi.fn(),
}));
vi.mock('@/lib/apple/notificarCambioComercio', () => ({
  notificarCambioComercio: (...a: unknown[]) => apple(...a),
  notificarCambioPrograma: (...a: unknown[]) => appleprograma(...a),
}));
vi.mock('@/lib/google/syncClase', () => ({
  syncClaseComercio: (...a: unknown[]) => claseGoogle(...a),
}));
vi.mock('@/lib/google/syncComercio', () => ({
  syncObjetosComercio: (...a: unknown[]) => objetosGoogle(...a),
  syncObjetosPrograma: (...a: unknown[]) => objetosPrograma(...a),
}));
// Los DOS exports, no solo el que usa la acción: actions.ts importa propagarMarcaPrograma, que
// importa syncClasePrograma del mismo módulo, y el proxy de vitest LANZA al acceder a un export
// ausente del mock.
vi.mock('@/lib/google/syncClasePrograma', () => ({
  syncClasesDeProgramasConClase: (...a: unknown[]) => barrido(...a),
  syncClasePrograma: (...a: unknown[]) => claseDePrograma(...a),
}));

const { accionGuardarBranding, accionGuardarBrandingDePrograma } = await import('./actions');
const { default: FormularioBranding } = await import('./FormularioBranding');

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

beforeEach(() => {
  apple.mockReset().mockResolvedValue(undefined);
  appleprograma.mockReset().mockResolvedValue(undefined);
  claseGoogle.mockReset().mockResolvedValue(undefined);
  objetosGoogle.mockReset().mockResolvedValue(undefined);
  objetosPrograma.mockReset().mockResolvedValue(undefined);
  barrido.mockReset().mockResolvedValue(undefined);
  claseDePrograma.mockReset().mockResolvedValue(undefined);
});

afterEach(() => entorno.limpiar());

function formulario(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [clave, valor] of Object.entries(campos)) fd.append(clave, valor);
  return fd;
}

const VALIDO = {
  color_fondo: 'rgb(10, 20, 30)',
  color_texto: 'rgb(255, 255, 255)',
  color_label: 'rgb(200, 150, 90)',
  sello_meta: '8',
  difuminado_franja: 'medio',
  encuadre_franja: 'llenar',
  foco_franja_x: '50',
  foco_franja_y: '20',
  zoom_franja: '140',
};

describe('accionGuardarBranding', () => {
  it('barre las clases de los programas que ya tienen una (si no, en Android quedan con el ?v= viejo)', async () => {
    const comercioId = await entorno.crearComercio();
    sesion.comercioId = comercioId;

    const res = await accionGuardarBranding(undefined, formulario(VALIDO));

    expect(res).toEqual({ ok: true });
    // El comercioId del GATE, nunca uno del formulario.
    expect(barrido).toHaveBeenCalledOnce();
    expect(barrido.mock.calls[0][1]).toBe(comercioId);
    // Y el resto de la propagación sigue viva: el barrido se suma, no reemplaza.
    expect(claseGoogle).toHaveBeenCalledOnce();
    expect(objetosGoogle).toHaveBeenCalledOnce();
    expect(apple).toHaveBeenCalledOnce();
  }, 40_000);

  it('con un guardado inválido no propaga nada: primero se guarda, después se avisa', async () => {
    const comercioId = await entorno.crearComercio();
    sesion.comercioId = comercioId;

    const res = await accionGuardarBranding(undefined, formulario({ ...VALIDO, zoom_franja: '999' }));

    expect(res).toEqual({ error: 'El zoom debe ser un entero de 100 a 300.' });
    expect(barrido).not.toHaveBeenCalled();
    expect(claseGoogle).not.toHaveBeenCalled();
  }, 40_000);
});

// Los SELLOS DE REGALO (migración 0043) por las dos Server Actions de Marca. Plan:
// docs/superpowers/plans/2026-10-28-sellos-de-regalo.md, sección 3.3.
//
// El envío de estas pruebas se arma a mano, como el resto de este archivo. Lo que prueban es el lado
// de la ACCIÓN: que lee el campo `sellos_regalo`, que AUSENTE es 0 (no "no tocar") y que un valor
// ilegible se rechaza en vez de leerse a medias. El otro lado, el de la PANTALLA (que el formulario
// dibuje un campo con ESE nombre), lo cubre el último bloque de este archivo, que arma el envío desde
// el HTML real del formulario: un FormData escrito a mano pasaría igual con un `name` mal tipeado.
//
// Estas pruebas NECESITAN la 0043 aplicada (sin ella fallan con "column ... does not exist").
//
// MUTACIONES CONFIRMADAS (2026-10-28), cada una corrida contra la base real (con la 0043 aplicada) y
// restaurada después. Lo que la prueba recibió al fallar va entre acentos graves:
//   - en accionGuardarBranding, `sellos_regalo: 0` fijo en vez de leer el formulario: fallan 3 pruebas.
//     "guarda el regalo que llega" con `expected +0 to be 3`; "un regalo igual a la meta" y "un regalo
//     ilegible ('2a')" con `{ ok: true }` en vez del mensaje de error esperado.
//   - leer otro nombre de campo (`formData.get('sellos_regalos')`) en accionGuardarBranding: las mismas
//     tres pruebas, con los mismos valores (`expected +0 to be 3`, y `{ ok: true }` en las otras dos).
//     En accionGuardarBrandingDePrograma: fallan "guarda el regalo que llega" (`expected +0 to be 2`)
//     y "un regalo igual a la meta" (`{ ok: true }` en vez del mensaje exacto). Es la deriva de nombre
//     que la Tarea 6 tiene que cerrar del lado de la pantalla.
//   - ausente = "no escribir", en guardarBranding.ts (`sellos_regalo: datos.sellos_regalo ||
//     undefined`) y, por separado, en guardarBrandingPrograma.ts (`sellos_regalo: datos.sellosRegalo ||
//     undefined`): en cada caso falla SOLO "sin el campo escribe 0" de la acción que corresponde, con
//     `expected 3 to be +0` (el regalo anterior se queda). Cada mutación la atrapa una sola acción.
//   - `parseInt(String(valor), 10)` en vez de `Number(valor)` en sellosRegaloDesdeFormulario
//     (lib/tarjetas/sellosRegalo.ts; '2a' se leería como 2): falla SOLO "un regalo ilegible ('2a') se
//     rechaza", con `{ ok: true }` en vez de `{ error: 'Los sellos de regalo tienen que ser un número
//     entero, 0 o más.' }`.
//   - sacar `sellosRegalo` del objeto que arma accionGuardarBrandingDePrograma (queda undefined):
//     fallan sus tres pruebas. Las dos que esperan `{ ok: true }` reciben `{ error: 'Los sellos de
//     regalo tienen que ser un número entero, 0 o más.' }` (validarSellosRegalo rechaza el undefined),
//     y la del regalo igual a la meta recibe ese mismo mensaje en vez del de "menos que la meta (8)".
describe('accionGuardarBranding: sellos de regalo', () => {
  const LEIDO = 'Los sellos de regalo tienen que ser un número entero, 0 o más.';

  const principalDe = async (comercioId: string) =>
    (await obtenerPrograma(supabase, comercioId, entorno.obtenerProgramaPrincipal(comercioId)))!;

  it('guarda el regalo que llega en el campo sellos_regalo, junto a la meta', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    sesion.comercioId = comercioId;

    const res = await accionGuardarBranding(undefined, formulario({ ...VALIDO, sello_meta: '10', sellos_regalo: '3' }));

    expect(res).toEqual({ ok: true });
    const principal = await principalDe(comercioId);
    expect(principal.selloMeta).toBe(10);
    expect(principal.sellosRegalo).toBe(3);
  }, 40_000);

  it('sin el campo escribe 0: no deja el regalo anterior, porque ausente no es "no tocar"', async () => {
    // El campo solo se dibuja cuando el programa es de sellos. Si el FM le cambia el tipo y el campo
    // desaparece del formulario, "ausente = no tocar" dejaría meta null con regalo 3 y el CHECK de la
    // base tumbaría el guardado de Marca ENTERO. Por eso ausente es 0.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    sesion.comercioId = comercioId;
    expect(await accionGuardarBranding(undefined, formulario({ ...VALIDO, sello_meta: '10', sellos_regalo: '3' }))).toEqual({ ok: true });

    const res = await accionGuardarBranding(undefined, formulario({ ...VALIDO, sello_meta: '10' }));

    expect(res).toEqual({ ok: true });
    expect((await principalDe(comercioId)).sellosRegalo).toBe(0);
  }, 40_000);

  it('un regalo igual a la meta devuelve el mensaje exacto y no propaga nada', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    sesion.comercioId = comercioId;

    const res = await accionGuardarBranding(undefined, formulario({ ...VALIDO, sello_meta: '8', sellos_regalo: '8' }));

    expect(res).toEqual({
      error: 'Los sellos de regalo tienen que ser menos que la meta (8): si no, la tarjeta nacería completa.',
    });
    expect(apple).not.toHaveBeenCalled();
    expect(claseGoogle).not.toHaveBeenCalled();
    expect(objetosGoogle).not.toHaveBeenCalled();
  }, 40_000);

  it('un regalo ilegible ("2a") se rechaza, no se lee como 2', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    sesion.comercioId = comercioId;

    const res = await accionGuardarBranding(undefined, formulario({ ...VALIDO, sello_meta: '8', sellos_regalo: '2a' }));

    expect(res).toEqual({ error: LEIDO });
    expect((await principalDe(comercioId)).sellosRegalo).toBe(0);
  }, 40_000);
});

describe('accionGuardarBrandingDePrograma: sellos de regalo', () => {
  const programaDe = async (comercioId: string, programaId: string) =>
    (await obtenerPrograma(supabase, comercioId, programaId))!;

  it('guarda el regalo que llega en el campo sellos_regalo, junto a la meta', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    const programaId = entorno.obtenerProgramaPrincipal(comercioId);
    sesion.comercioId = comercioId;

    const res = await accionGuardarBrandingDePrograma(
      programaId,
      undefined,
      formulario({ sello_meta: '10', sellos_regalo: '2' }),
    );

    expect(res).toEqual({ ok: true });
    const programa = await programaDe(comercioId, programaId);
    expect(programa.selloMeta).toBe(10);
    expect(programa.sellosRegalo).toBe(2);
    // Y avisa a los pases: la acción de tarjeta propaga siempre, y el regalo no la hace distinta.
    expect(appleprograma).toHaveBeenCalledOnce();
  }, 40_000);

  it('sin el campo escribe 0: no deja el regalo anterior, porque ausente no es "no tocar"', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    const programaId = entorno.obtenerProgramaPrincipal(comercioId);
    sesion.comercioId = comercioId;
    expect(
      await accionGuardarBrandingDePrograma(programaId, undefined, formulario({ sello_meta: '10', sellos_regalo: '3' })),
    ).toEqual({ ok: true });

    const res = await accionGuardarBrandingDePrograma(programaId, undefined, formulario({ sello_meta: '10' }));

    expect(res).toEqual({ ok: true });
    expect((await programaDe(comercioId, programaId)).sellosRegalo).toBe(0);
  }, 40_000);

  it('un regalo igual a la meta devuelve el mensaje exacto y no propaga nada', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    const programaId = entorno.obtenerProgramaPrincipal(comercioId);
    sesion.comercioId = comercioId;

    const res = await accionGuardarBrandingDePrograma(
      programaId,
      undefined,
      formulario({ sello_meta: '8', sellos_regalo: '8' }),
    );

    expect(res).toEqual({
      error: 'Los sellos de regalo tienen que ser menos que la meta (8): si no, la tarjeta nacería completa.',
    });
    expect(appleprograma).not.toHaveBeenCalled();
    expect(claseDePrograma).not.toHaveBeenCalled();
    expect(objetosPrograma).not.toHaveBeenCalled();
  }, 40_000);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Los sellos de regalo DESDE EL HTML DEL FORMULARIO (Tarea 6 del plan de sellos de regalo)
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// POR QUÉ ESTAS PRUEBAS DIBUJAN EL FORMULARIO (mismo motivo que programas/actions.test.ts): lo que
// protegen vive en el PEGAMENTO entre el marcado y la acción. Las pruebas de arriba arman el
// FormData con la clave `sellos_regalo` escrita a mano, así que pasarían igual si el componente
// dibujara el campo con otro `name` (`sellos_regalos`, `regalo`...): el dueño escribiría su regalo,
// apretaría Publicar, la acción leería "ausente" (= 0) y el regalo se guardaría en silencio como 0.
// Acá el envío sale del `renderToStaticMarkup` de FormularioBranding, como lo mandaría el navegador.
//
// Lo que NO cubren (se mira en el navegador): el texto en vivo al teclear, que necesita estado de
// cliente, y la precarga de `page.tsx` (que arma `inicial` desde el programa), porque esa página es un
// Server Component que depende de la sesión real. El HTML dibujado sí deja ver el estado inicial.
//
// MUTACIONES CONFIRMADAS (2026-10-28), cada una corrida contra la base real y restaurada después, en
// FormularioBranding.tsx. Lo que la prueba recibió al fallar va entre acentos graves:
//   - renombrar `name="sellos_regalo"` por `name="sellos_regalos"`: fallan las TRES pruebas que
//     dibujan el campo (las dos de guardado y la de los atributos) con `[test] el formulario no dibuja
//     ningún campo "sellos_regalo"`. Es la que un FormData armado a mano no atrapa.
//   - `max` igual a la meta en vez de meta - 1: `expected '10' to be '9'`.
//   - sacar `validarSellosRegalo(...) === null` de la condición del efecto en vivo: `regalo igual a la
//     meta: expected true to be false`.
//   - mostrar el efecto también con regalo 0 (`>= 0`): `regalo 0: expected true to be false`.
//   - quitar el chequeo de entero de la meta (`metaEscrita > 0` a secas): `meta decimal: expected true
//     to be false`.
//   - dibujar el campo en cualquier tipo (sacar `esSellos &&`): falla "un programa que no es de
//     sellos no dibuja el campo" con `el input: expected true to be false`.
//   - el `value` del input fijo en "0" en vez de `valores.sellos_regalo`: `expected '0' to be '2'`.
//   - `min="1"` en vez de `min="0"`: `expected '1' to be '0'`.
//   - el estado inicial en '' en vez de `inicial.sellos_regalo`: `expected '' to be '2'`.

type PropsFormulario = Parameters<typeof FormularioBranding>[0];

const COLORES = {
  color_fondo: 'rgb(10, 20, 30)',
  color_texto: 'rgb(255, 255, 255)',
  color_label: 'rgb(200, 150, 90)',
  difuminado_franja: 'medio',
};

// Las props con las que page.tsx monta el formulario en MODO NEGOCIO para un programa de sellos sin
// foto ni franja propias. `sello_meta` y `sellos_regalo` entran como los lee page.tsx (String del
// número del programa).
function propsNegocio(selloMeta: string, sellosRegalo: string): PropsFormulario {
  return {
    nombreComercio: 'Café de prueba',
    tipoTarjeta: 'sellos',
    hoyIso: '2026-10-28',
    programaId: null,
    nombreTarjeta: 'Café de prueba',
    inicial: { ...COLORES, sello_meta: selloMeta, sellos_regalo: sellosRegalo, nombre_pase: '' },
    heredado: null,
    encuadreInicial: { modo: 'llenar', focoX: 50, focoY: 50, zoom: 100 },
    oscurecerInicial: true,
    fotoPropia: false,
    usaDisenoPropio: false,
    tieneDisenoGuardado: false,
    urls: { logo: null, hero: null, strip: null, selloIcono: null, selloIcono2: null },
    patronSellos: SIN_PATRON,
    subidas: null,
    seccionActiva: 'colores',
  };
}

// Lo mismo en MODO TARJETA: el diseño de un programa, donde vacío = heredá del negocio.
function propsTarjeta(programaId: string, selloMeta: string, sellosRegalo: string): PropsFormulario {
  return {
    ...propsNegocio(selloMeta, sellosRegalo),
    programaId,
    nombreTarjeta: 'Principal',
    inicial: {
      color_fondo: '',
      color_texto: '',
      color_label: '',
      difuminado_franja: '',
      sello_meta: selloMeta,
      sellos_regalo: sellosRegalo,
      nombre_pase: '',
    },
    heredado: COLORES,
  };
}

function dibujar(props: PropsFormulario): string {
  return renderToStaticMarkup(createElement(FormularioBranding, props));
}

// Lo que el navegador enviaría al apretar Publicar: cada campo con nombre en orden de documento
// (los <select> con su opción elegida, los <input> con su value), menos los deshabilitados.
// `cambios` es lo que el dueño tecleó antes de enviar. Un cambio sobre un campo que el HTML NO
// dibuja LANZA: callarlo dejaría el campo ausente y la prueba fallaría más lejos, en el valor
// guardado, sin decir que el culpable es el marcado.
function enviarFormulario(html: string, cambios: Record<string, string> = {}): FormData {
  const decodificar = (texto: string) =>
    texto
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  const atributos = (etiqueta: string) => {
    const mapa = new Map<string, string>();
    for (const [, nombre, valor] of etiqueta.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
      mapa.set(nombre, decodificar(valor ?? ''));
    }
    return mapa;
  };

  const fd = new FormData();
  const dibujados = new Set<string>();
  for (const [bloque] of html.matchAll(/<input\b[^>]*>|<select\b[^>]*>[\s\S]*?<\/select>/g)) {
    const apertura = bloque.match(/^<\w+\b[^>]*>/)![0];
    const attrs = atributos(apertura.slice(apertura.indexOf(' ')));
    const nombre = attrs.get('name');
    if (!nombre || attrs.has('disabled')) continue;
    dibujados.add(nombre);

    if (bloque.startsWith('<select')) {
      const opciones = [...bloque.matchAll(/<option\b[^>]*>/g)].map((o) => atributos(o[0].slice(o[0].indexOf(' '))));
      const elegida = opciones.find((o) => o.has('selected')) ?? opciones[0];
      fd.append(nombre, cambios[nombre] ?? elegida?.get('value') ?? '');
      continue;
    }

    // Las casillas y los radios sin nombre o sin marcar no viajan; este formulario solo tiene
    // radios cuando se edita una foto propia, que estas pruebas no usan.
    if (attrs.get('type') === 'checkbox' || attrs.get('type') === 'radio') continue;

    fd.append(nombre, cambios[nombre] ?? attrs.get('value') ?? '');
  }

  for (const nombre of Object.keys(cambios)) {
    if (!dibujados.has(nombre)) throw new Error(`[test] el formulario no dibuja ningún campo "${nombre}"`);
  }
  return fd;
}

// El <input name="sellos_regalo"> tal como quedó dibujado, para mirar sus atributos.
function inputDeRegalo(html: string): Map<string, string> {
  const etiqueta = html.match(/<input\b[^>]*\bname="sellos_regalo"[^>]*>/);
  if (!etiqueta) throw new Error('[test] el formulario no dibuja ningún campo "sellos_regalo"');
  const mapa = new Map<string, string>();
  for (const [, nombre, valor] of etiqueta[0].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) mapa.set(nombre, valor ?? '');
  return mapa;
}

describe('FormularioBranding: el campo de sellos de regalo, desde el HTML real', () => {
  it('modo negocio: el regalo que el dueño teclea en el formulario dibujado se guarda en el programa principal', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    sesion.comercioId = comercioId;
    const programaId = entorno.obtenerProgramaPrincipal(comercioId);
    // La meta 10 se guarda por el camino de producción, no con un update directo.
    expect(await accionGuardarBranding(undefined, formulario({ ...VALIDO, sello_meta: '10' }))).toEqual({ ok: true });
    const antes = (await obtenerPrograma(supabase, comercioId, programaId))!;
    expect(antes.selloMeta).toBe(10);
    expect(antes.sellosRegalo).toBe(0);

    // El formulario como lo sirve page.tsx con lo guardado, y el dueño pone 2 en el campo.
    const html = dibujar(propsNegocio(String(antes.selloMeta), String(antes.sellosRegalo)));
    const res = await accionGuardarBranding(undefined, enviarFormulario(html, { sellos_regalo: '2' }));

    expect(res).toEqual({ ok: true });
    const despues = (await obtenerPrograma(supabase, comercioId, programaId))!;
    expect(despues.sellosRegalo).toBe(2);
    // Viajó en el mismo envío que la meta, que el formulario también mandó desde su HTML.
    expect(despues.selloMeta).toBe(10);
  }, 60_000);

  it('modo tarjeta: el mismo campo, enviado a la acción del programa', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    sesion.comercioId = comercioId;
    const programaId = entorno.obtenerProgramaPrincipal(comercioId);
    expect(
      await accionGuardarBrandingDePrograma(programaId, undefined, formulario({ sello_meta: '10' })),
    ).toEqual({ ok: true });
    const antes = (await obtenerPrograma(supabase, comercioId, programaId))!;
    expect(antes.sellosRegalo).toBe(0);

    const html = dibujar(propsTarjeta(programaId, String(antes.selloMeta), String(antes.sellosRegalo)));
    const res = await accionGuardarBrandingDePrograma(programaId, undefined, enviarFormulario(html, { sellos_regalo: '2' }));

    expect(res).toEqual({ ok: true });
    const despues = (await obtenerPrograma(supabase, comercioId, programaId))!;
    expect(despues.sellosRegalo).toBe(2);
    expect(despues.selloMeta).toBe(10);
  }, 60_000);

  it('el campo se dibuja debajo de la meta con su tope, y el efecto en vivo aparece solo con un regalo válido', () => {
    const dibujado = (meta: string, regalo: string) => dibujar(propsNegocio(meta, regalo));
    // Un booleano y no `not.toContain(html)`: si falla, el mensaje de vitest volcaría el HTML entero.
    const hayEfecto = (html: string) => html.includes('Un cliente nuevo arranca');
    const EFECTO =
      'Un cliente nuevo arranca con 2 de 10 sellos: le faltan 8. Es un regalo de verdad, y las tarjetas que ya existen no cambian.';

    // Meta 10 y regalo 2: el campo trae el valor guardado, el tope es meta - 1 y el efecto se lee entero.
    const conRegalo = dibujado('10', '2');
    const campo = inputDeRegalo(conRegalo);
    expect(campo.get('value')).toBe('2');
    expect(campo.get('type')).toBe('number');
    expect(campo.get('min')).toBe('0');
    expect(campo.get('max')).toBe('9');
    expect(campo.get('step')).toBe('1');
    expect(campo.get('placeholder')).toBe('0');
    expect(conRegalo.includes('Sellos de regalo al registrarse')).toBe(true);
    expect(conRegalo.includes(EFECTO)).toBe(true);
    // Debajo de la meta, no encima.
    expect(conRegalo.indexOf('name="sello_meta"')).toBeLessThan(conRegalo.indexOf('name="sellos_regalo"'));

    // Sin regalo (0): el campo dice 0 y no hay efecto que mostrar.
    expect(inputDeRegalo(dibujado('10', '0')).get('value')).toBe('0');
    expect(hayEfecto(dibujado('10', '0')), 'regalo 0').toBe(false);
    // Regalo igual a la meta (inválido): nada en vivo; el mensaje lo da el servidor al guardar.
    expect(hayEfecto(dibujado('10', '10')), 'regalo igual a la meta').toBe(false);
    // Una meta que no es entera positiva (vacía, o decimal que el servidor rechazaría primero): nada
    // en vivo, y sin tope.
    expect(hayEfecto(dibujado('', '2')), 'meta vacía').toBe(false);
    expect(inputDeRegalo(dibujado('', '2')).has('max'), 'meta vacía').toBe(false);
    expect(hayEfecto(dibujado('2.5', '1')), 'meta decimal').toBe(false);
    expect(inputDeRegalo(dibujado('2.5', '1')).has('max'), 'meta decimal').toBe(false);
  });

  it('un programa que no es de sellos no dibuja el campo (su ausencia en el envío es 0 a propósito)', () => {
    const html = dibujar({ ...propsNegocio('', '0'), tipoTarjeta: 'puntos' });
    // Booleanos y no `not.toContain(html)`: si falla, el mensaje volcaría el HTML entero.
    expect(html.includes('name="sellos_regalo"'), 'el input').toBe(false);
    expect(html.includes('Sellos de regalo al registrarse'), 'el rótulo').toBe(false);
  });
});

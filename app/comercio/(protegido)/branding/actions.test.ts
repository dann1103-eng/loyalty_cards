import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServiceClient } from '@/lib/supabase/server';
import { crearEntorno } from '@/test/fixtures/entornoComercio';
import { obtenerPrograma } from '@/lib/comercio/programas';

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
// El envío se arma a mano, como el resto de este archivo, y NO desde el HTML del formulario: el campo
// `sellos_regalo` todavía no se dibuja (lo agrega la Tarea 6 del plan), así que no hay HTML del que
// armarlo. La Tarea 6 suma la prueba que lo arma desde el formulario renderizado, que es la que
// atrapa un `name` mal escrito del lado de la pantalla. Lo que se prueba acá es el lado de la acción:
// que lee el campo `sellos_regalo`, que AUSENTE es 0 (no "no tocar") y que un valor ilegible se
// rechaza en vez de leerse a medias.
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

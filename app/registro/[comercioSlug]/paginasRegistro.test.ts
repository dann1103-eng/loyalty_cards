import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { createServiceClient } from '@/lib/supabase/server';
import { crearEntorno } from '@/test/fixtures/entornoComercio';
import { guardarBranding } from '@/lib/comercio/guardarBranding';

// Las DOS páginas de registro (la del QR sin programa y la del QR de un programa) le prometen al cliente
// los sellos de regalo con la misma regla: solo un programa de sellos regala (sellosRegaloDelPrograma,
// probada aparte en lib/tarjetas/sellosRegalo.test.ts). Esta prueba cubre el PEGAMENTO que la unidad
// pura no ve: que cada página la llame, y con el tipo y el regalo del programa. Antes la regla era un
// ternario copiado en las dos páginas, sin ninguna prueba.
//
// Las páginas son Server Components async: se las llama como funciones y devuelven el elemento
// <RegistroCliente …/> sin dibujarlo, así que se lee la prop `sellosRegalo` tal como la recibiría el
// componente de cliente. Solo se reemplaza `next/headers` (necesita una request real); el comercio, el
// programa y la marca son la base real, y el regalo se carga por el camino de producción
// (guardarBranding), nunca con un update a `sellos_regalo`. La única excepción es el cambio de tipo del
// FM (un update directo de `tipo_tarjeta`, que es justo lo que propagarTipoAlProgramaPrincipal hace).
//
// MUTACIONES CONFIRMADAS (2026-10-28), cada una corrida contra la base real y restaurada después:
//   - en la página sin programa (page.tsx), `sellosRegalo={programa.sellosRegalo}` a secas (la regla
//     quitada): falla SOLO "la página sin programa, con un programa que ya no es de sellos" con
//     `expected 2 to be +0`.
//   - lo mismo en la página del programa ([programaSlug]/page.tsx): falla SOLO "la página del programa,
//     con un programa que ya no es de sellos" con `expected 2 to be +0`.
//   - `sellosRegalo={0}` fijo en cualquiera de las dos: falla "un programa de sellos con regalo 2" con
//     `la página sin programa: expected +0 to be 2` o `la página del programa: expected +0 to be 2`,
//     según cuál se rompió.
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

const { default: PaginaRegistro } = await import('./page');
const { default: PaginaRegistroPrograma } = await import('./[programaSlug]/page');
const { default: RegistroCliente } = await import('./RegistroCliente');

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

afterEach(() => entorno.limpiar());

// Un comercio de sellos con meta 10 y el regalo dado, cargados por guardarBranding (modo negocio:
// escribe al programa principal). Devuelve lo que las páginas necesitan para encontrarlo.
async function comercioConRegalo(sellosRegalo: number): Promise<{ comercioSlug: string; programaId: string }> {
  const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
  const guardado = await guardarBranding(supabase, comercioId, {
    color_fondo: 'rgb(10, 20, 30)',
    color_texto: 'rgb(255, 255, 255)',
    color_label: 'rgb(255, 255, 255)',
    sello_meta: 10,
    sellos_regalo: sellosRegalo,
    difuminado_franja: 'medio',
    nombre_pase: null,
    encuadre_franja: { modo: 'llenar', focoX: 50, focoY: 50, zoom: 100 },
    oscurecer_franja: true,
  });
  expect(guardado.ok, guardado.ok ? '' : guardado.error).toBe(true);
  const { data, error } = await supabase.from('comercios').select('slug').eq('id', comercioId).single();
  if (error) throw error;
  return { comercioSlug: data.slug, programaId: entorno.obtenerProgramaPrincipal(comercioId) };
}

// La prop `sellosRegalo` con la que cada página monta RegistroCliente. Si la página devolvió otra cosa
// (la pantalla de "comercio no encontrado"), lanza: leer `undefined` y fallar más lejos escondería que
// el culpable es el comercio o el programa de la prueba.
function sellosRegaloDe(pagina: unknown): number {
  const elemento = pagina as ReactElement<{ sellosRegalo: number }>;
  if (elemento.type !== RegistroCliente) {
    throw new Error('[test] la página no montó RegistroCliente: ¿no encontró el comercio o el programa?');
  }
  return elemento.props.sellosRegalo;
}

const paginaSinPrograma = async (comercioSlug: string) =>
  sellosRegaloDe(await PaginaRegistro({ params: Promise.resolve({ comercioSlug }) }));

// El slug del programa principal es 'principal' (lo crea el fixture igual que el backfill de la 0024).
const paginaDelPrograma = async (comercioSlug: string) =>
  sellosRegaloDe(
    await PaginaRegistroPrograma({ params: Promise.resolve({ comercioSlug, programaSlug: 'principal' }) }),
  );

describe('las páginas de registro prometen el regalo del programa', () => {
  it('un programa de sellos con regalo 2: las dos páginas le prometen 2', async () => {
    const { comercioSlug } = await comercioConRegalo(2);

    expect(await paginaSinPrograma(comercioSlug), 'la página sin programa').toBe(2);
    expect(await paginaDelPrograma(comercioSlug), 'la página del programa').toBe(2);
  }, 60_000);

  it('un programa de sellos sin regalo: las dos prometen 0', async () => {
    const { comercioSlug } = await comercioConRegalo(0);

    expect(await paginaSinPrograma(comercioSlug), 'la página sin programa').toBe(0);
    expect(await paginaDelPrograma(comercioSlug), 'la página del programa').toBe(0);
  }, 60_000);

  it('la página sin programa, con un programa que ya no es de sellos: 0 aunque el regalo siga guardado', async () => {
    const { comercioSlug, programaId } = await comercioConRegalo(2);
    // El FM le cambió el tipo: la columna `sellos_regalo` queda en 2, pero emitir_tarjeta ya no regala.
    const { error } = await supabase.from('programas_tarjeta').update({ tipo_tarjeta: 'puntos' }).eq('id', programaId);
    if (error) throw error;

    expect(await paginaSinPrograma(comercioSlug)).toBe(0);
  }, 60_000);

  it('la página del programa, con un programa que ya no es de sellos: 0 aunque el regalo siga guardado', async () => {
    const { comercioSlug, programaId } = await comercioConRegalo(2);
    const { error } = await supabase.from('programas_tarjeta').update({ tipo_tarjeta: 'puntos' }).eq('id', programaId);
    if (error) throw error;

    expect(await paginaDelPrograma(comercioSlug)).toBe(0);
  }, 60_000);
});

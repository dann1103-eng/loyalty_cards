import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import type { Programa } from '../comercio/programas';
import type { SucursalListada } from '../comercio/sucursales';
import type { UsuarioDelComercio } from '../comercio/cajeros';

// Cada lista que el cargador lee devuelve null ante un error, y el cargador tiene que PROPAGARLO. Acá
// se provoca un error en UNA lista por vez, con las demás sanas: contra la base real no se puede (un
// id inválido rompe las cuatro consultas a la vez y la primera que se revisa tapa a las demás). La
// prueba contra la base (reportesConFiltros.test.ts) cubre el camino feliz y un error real.
//
// Por qué importa: si el cargador convirtiera en [] el null de listarSucursales o de
// listarUsuariosDelComercio, resolverFiltrosReportes no encontraría el `?sucursal=`/`?cajero=` de la
// URL y lo descartaría EN SILENCIO: la pantalla mostraría los números sin filtrar como si fueran los
// de la sucursal, y el Excel saldría igual. Con `{ ok: false }` la página muestra un aviso y la ruta
// del Excel responde 500.
//
// Rojo de partida (2026-09-24, con el cargador como stub `{ ok: false, error: 'TODO Tarea 3' }`): caen
// las 6, por ejemplo "las sucursales fallan…" con `expected { ok: false, error: 'TODO Tarea 3' } to
// deeply equal { ok: false, …(1) }` (asierta el mensaje EXACTO, no solo `ok: false`).
//
// MUTATION-TESTING (corridas el 2026-09-24, una por vez y restauradas; con el mensaje que se vio caer):
// cada lectura con su null convertido en vacío (`.then((x) => x ?? [])`, o el error de las zonas
// ignorado) deja pasar un contexto "sano", y cae SOLO la prueba de esa lectura, con `expected { ok:
// true, contexto: { …(5) } } to deeply equal { ok: false, …(1) }`:
// - `listarSucursales(…) ?? []` → "las sucursales fallan (null)…";
// - `listarUsuariosDelComercio(…) ?? []` → "los usuarios fallan (null)…";
// - `listarProgramas(…) ?? []` → "los programas de UNO de los comercios fallan…";
// - la consulta de zonas con su `error` ignorado → "la consulta de zonas falla…".
// Además: la zona del activo tomada del comercio ELEGIDO tira "con todo sano…" con `expected { ok: true,
// contexto: { …(5) } } to deeply equal { ok: true, contexto: { …(5) } }`, y listarUsuariosDelComercio
// con el comercioId en lugar del authUserId, con `expected "vi.fn()" to be called with arguments: [
// Anything, …(2) ]`.

vi.mock('../comercio/sucursales', () => ({ listarSucursales: vi.fn() }));
vi.mock('../comercio/cajeros', () => ({ listarUsuariosDelComercio: vi.fn() }));
vi.mock('../comercio/programas', () => ({ listarProgramas: vi.fn() }));

import { listarSucursales } from '../comercio/sucursales';
import { listarUsuariosDelComercio } from '../comercio/cajeros';
import { listarProgramas } from '../comercio/programas';
import { cargarContextoReportes, type SesionReportes } from './contextoReportes';

const CAFE = '11111111-1111-4111-8111-111111111111';
const SPA = '22222222-2222-4222-8222-222222222222';

const sesion: SesionReportes = {
  authUserId: '33333333-3333-4333-8333-333333333333',
  comercioId: CAFE,
  comercios: [
    { comercioId: CAFE, nombre: 'Café' },
    { comercioId: SPA, nombre: 'Spa' },
  ],
};

const sucursal = { id: 'suc-1', nombre: 'Centro' } as SucursalListada;
const usuario = { id: 'usu-1', email: 'caja@ejemplo.test', rol: 'cajero', activo: true, esVos: false } as UsuarioDelComercio;
const principal = (tipoTarjeta: string) => [{ esPrincipal: true, tipoTarjeta } as Programa];

// La única consulta que el cargador hace por su cuenta: las zonas, `comercios.select(...).in('id', …)`.
function supabaseFalso(respuesta: { data: { id: string; zona_horaria: string }[] | null; error: { message: string } | null }) {
  const cliente = {
    from: (tabla: string) => {
      if (tabla !== 'comercios') throw new Error(`[test] consulta inesperada a ${tabla}`);
      return { select: () => ({ in: async () => respuesta }) };
    },
  };
  return cliente as unknown as SupabaseClient<Database>;
}

const zonasSanas = () =>
  supabaseFalso({
    data: [
      { id: CAFE, zona_horaria: 'America/El_Salvador' },
      { id: SPA, zona_horaria: 'America/Bogota' },
    ],
    error: null,
  });

beforeEach(() => {
  vi.mocked(listarSucursales).mockReset().mockResolvedValue([sucursal]);
  vi.mocked(listarUsuariosDelComercio).mockReset().mockResolvedValue([usuario]);
  vi.mocked(listarProgramas)
    .mockReset()
    .mockImplementation(async (_supabase, comercioId) => principal(comercioId === CAFE ? 'sellos' : 'puntos'));
});

describe('cargarContextoReportes: los errores se propagan', () => {
  it('con todo sano, el contexto sale entero (los falsos están bien conectados)', async () => {
    expect(await cargarContextoReportes(zonasSanas(), sesion, { comercio: SPA })).toEqual({
      ok: true,
      contexto: {
        zonaComercioActivo: 'America/El_Salvador',
        datosComercios: [{ comercioId: SPA, zonaHoraria: 'America/Bogota', tipoPrincipal: 'puntos' }],
        comercioDeLasListas: SPA,
        sucursales: [sucursal],
        usuarios: [usuario],
      },
    });
    expect(listarSucursales).toHaveBeenCalledWith(expect.anything(), SPA);
    expect(listarUsuariosDelComercio).toHaveBeenCalledWith(expect.anything(), SPA, sesion.authUserId);
  });

  it('las sucursales fallan (null) → { ok: false }, no una lista vacía', async () => {
    vi.mocked(listarSucursales).mockResolvedValue(null);
    expect(await cargarContextoReportes(zonasSanas(), sesion, { comercio: SPA })).toEqual({
      ok: false,
      error: 'No se pudieron leer las sucursales del comercio.',
    });
  });

  it('los usuarios fallan (null) → { ok: false }, no una lista vacía', async () => {
    vi.mocked(listarUsuariosDelComercio).mockResolvedValue(null);
    expect(await cargarContextoReportes(zonasSanas(), sesion, { comercio: SPA })).toEqual({
      ok: false,
      error: 'No se pudieron leer los usuarios del comercio.',
    });
  });

  it('los programas de UNO de los comercios fallan → { ok: false }, no un tipo inventado', async () => {
    vi.mocked(listarProgramas).mockImplementation(async (_supabase, comercioId) =>
      comercioId === SPA ? null : principal('sellos'),
    );
    expect(await cargarContextoReportes(zonasSanas(), sesion, {})).toEqual({
      ok: false,
      error: 'No se pudieron leer los programas de los comercios.',
    });
  });

  it('la consulta de zonas falla → { ok: false }, no una zona inventada', async () => {
    const roto = supabaseFalso({ data: null, error: { message: 'se cayó' } });
    expect(await cargarContextoReportes(roto, sesion, { comercio: SPA })).toEqual({
      ok: false,
      error: 'No se pudieron leer las zonas horarias de los comercios.',
    });
  });

  it('con "Todo" no hay listas que leer: vacías sin preguntar (y sin error)', async () => {
    const resultado = await cargarContextoReportes(zonasSanas(), sesion, {});
    expect(resultado).toMatchObject({ ok: true, contexto: { comercioDeLasListas: null, sucursales: [], usuarios: [] } });
    expect(listarSucursales).not.toHaveBeenCalled();
    expect(listarUsuariosDelComercio).not.toHaveBeenCalled();
  });
});

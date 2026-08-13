import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServiceClient } from '@/lib/supabase/server';
import { crearEntorno } from '@/test/fixtures/entornoComercio';

// El gate del dueño se mockea porque necesita cookies de una request real; se prueba aparte en
// verifyComercioOwner. Mismo criterio que las pruebas de la acción del cartel.
const { sesion } = vi.hoisted(() => ({ sesion: { comercioId: '' } }));
vi.mock('@/lib/comercio/verifyComercioOwner', () => ({
  verifyComercioOwner: async () => ({ comercioId: sesion.comercioId }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

// Los tres efectos de propagación se mockean: lo que se prueba acá NO es qué le mandan a Apple o a
// Google (eso vive en sus propios archivos), sino que la acción los LLAME a los tres. Google no se
// toca nunca desde las pruebas (CLAUDE.md).
const { apple, claseGoogle, objetosGoogle } = vi.hoisted(() => ({
  apple: vi.fn(),
  claseGoogle: vi.fn(),
  objetosGoogle: vi.fn(),
}));
vi.mock('@/lib/apple/notificarCambioComercio', () => ({
  notificarCambioComercio: (...a: unknown[]) => apple(...a),
}));
vi.mock('@/lib/google/syncClase', () => ({
  syncClaseComercio: (...a: unknown[]) => claseGoogle(...a),
}));
vi.mock('@/lib/google/syncComercio', () => ({
  syncObjetosComercio: (...a: unknown[]) => objetosGoogle(...a),
}));

const { accionGuardarGeopush } = await import('./actions');

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

beforeEach(() => {
  apple.mockReset().mockResolvedValue(undefined);
  claseGoogle.mockReset().mockResolvedValue(undefined);
  objetosGoogle.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  await entorno.limpiar();
});

function formulario(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [clave, valor] of Object.entries(campos)) fd.append(clave, valor);
  return fd;
}

describe('accionGuardarGeopush', () => {
  it('propaga las ubicaciones a Apple, a la CLASE de Google y a los OBJETOS ya emitidos', async () => {
    const comercioId = await entorno.crearComercio();
    sesion.comercioId = comercioId;
    const sucursalId = await entorno.crearSucursal(comercioId);

    const res = await accionGuardarGeopush(
      sucursalId,
      undefined,
      formulario({
        ubicacion: '13.6989, -89.1914',
        mensaje_cercania: 'Pasá por tu café',
        mensaje_campana: '',
        campana_hasta: '',
        geopush_activo: 'on',
      }),
    );

    expect(res).toEqual({ ok: true });

    // Que haya guardado de verdad: el valor de retorno puede decir ok sin haber escrito la fila.
    const { data } = await supabase
      .from('sucursales')
      .select('latitud, longitud, mensaje_cercania, geopush_activo')
      .eq('id', sucursalId)
      .single();
    expect(data?.geopush_activo).toBe(true);
    expect(Number(data?.latitud)).toBeCloseTo(13.6989, 4);
    expect(data?.mensaje_cercania).toBe('Pasá por tu café');

    // Los tres caminos de propagación. El de OBJETOS es el que faltaba hasta el 2026-08-13: la
    // clase sola deja a las tarjetas YA EMITIDAS con las coordenadas viejas, y `merchantLocations`
    // del objeto es lo que hace que a un Android le llegue el aviso (ver construirRecursos.ts).
    expect(apple).toHaveBeenCalledWith(expect.anything(), comercioId);
    expect(claseGoogle).toHaveBeenCalledWith(expect.anything(), comercioId);
    expect(objetosGoogle).toHaveBeenCalledWith(expect.anything(), comercioId);
  });

  it('no propaga nada si el guardado falló', async () => {
    const comercioId = await entorno.crearComercio();
    sesion.comercioId = comercioId;
    const sucursalId = await entorno.crearSucursal(comercioId);

    // Activar el aviso SIN coordenadas: lo rechaza validar() en geopush.ts.
    const res = await accionGuardarGeopush(
      sucursalId,
      undefined,
      formulario({
        ubicacion: '',
        mensaje_cercania: '',
        mensaje_campana: '',
        campana_hasta: '',
        geopush_activo: 'on',
      }),
    );

    expect(res).toHaveProperty('error');
    expect(apple).not.toHaveBeenCalled();
    expect(claseGoogle).not.toHaveBeenCalled();
    expect(objetosGoogle).not.toHaveBeenCalled();
  });
});

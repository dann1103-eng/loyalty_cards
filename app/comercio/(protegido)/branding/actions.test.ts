import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServiceClient } from '@/lib/supabase/server';
import { crearEntorno } from '@/test/fixtures/entornoComercio';

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

const { accionGuardarBranding } = await import('./actions');

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

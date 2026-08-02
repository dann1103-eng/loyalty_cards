import { describe, it, expect, beforeEach, vi } from 'vitest';
import { propagarMarcaPrograma } from './propagarMarca';

// Los tres canales de propagación, mockeados: lo que se prueba acá es QUE SE LLAMEN LOS TRES, no
// qué hace cada uno (eso ya lo cubren sus propios archivos). Google jamás se toca de verdad desde
// una prueba: las LoyaltyClass no se pueden borrar y cada corrida dejaría basura permanente.
const notificarMock = vi.fn();
const syncObjetosMock = vi.fn();
const syncClaseMock = vi.fn();

vi.mock('../apple/notificarCambioComercio', () => ({
  notificarCambioPrograma: (...a: unknown[]) => notificarMock(...a),
}));
vi.mock('../google/syncComercio', () => ({
  syncObjetosPrograma: (...a: unknown[]) => syncObjetosMock(...a),
}));
vi.mock('../google/syncClasePrograma', () => ({
  syncClasePrograma: (...a: unknown[]) => syncClaseMock(...a),
}));

beforeEach(() => {
  notificarMock.mockReset().mockResolvedValue(undefined);
  syncObjetosMock.mockReset().mockResolvedValue(undefined);
  syncClaseMock.mockReset().mockResolvedValue({ ok: true, classId: null });
});

const supabase = {} as never;

describe('propagarMarcaPrograma', () => {
  // LA prueba de este módulo. Google guarda logo y colores en la CLASE, no en el objeto: sin
  // sincronizar la clase del programa, el dueño cambia su color, ve el cambio en el iPhone (donde
  // el .pkpass se regenera entero) y en Android NO PASA NADA. Sin error, sin aviso — el clásico de
  // este proyecto. El hueco existía porque esta función no tenía ninguna prueba.
  it('sincroniza la CLASE del programa, no solo sus objetos', async () => {
    await propagarMarcaPrograma(supabase, 'com-1', 'prog-9');

    expect(syncClaseMock, 'sin esto el color propio nunca llega a Android').toHaveBeenCalledWith(
      supabase,
      'com-1',
      'prog-9',
    );
  });

  it('propaga por los TRES canales: Apple, la clase de Google y sus objetos', async () => {
    await propagarMarcaPrograma(supabase, 'com-1', 'prog-9');

    expect(notificarMock).toHaveBeenCalledOnce();
    expect(syncClaseMock).toHaveBeenCalledOnce();
    expect(syncObjetosMock).toHaveBeenCalledOnce();
  });

  // La clase ANTES que los objetos: un objeto puede apuntar a la clase recién creada, y si los
  // objetos se sincronizaran primero, ese classId todavía no existiría del lado de Google.
  it('sincroniza la clase ANTES que los objetos', async () => {
    const orden: string[] = [];
    syncClaseMock.mockImplementation(async () => {
      orden.push('clase');
      return { ok: true, classId: 'issuer.programa_9' };
    });
    syncObjetosMock.mockImplementation(async () => {
      orden.push('objetos');
    });

    await propagarMarcaPrograma(supabase, 'com-1', 'prog-9');

    expect(orden).toEqual(['clase', 'objetos']);
  });

  // Best-effort, igual que el resto de la integración con wallets: un fallo de Google no puede
  // tumbar el guardado que el dueño ya hizo. Su marca quedó bien en la base; lo que falla es la
  // propagación, y el próximo guardado la reintenta.
  it('un fallo de Google no se propaga hacia afuera', async () => {
    syncClaseMock.mockRejectedValue(new Error('Google caído'));

    await expect(propagarMarcaPrograma(supabase, 'com-1', 'prog-9')).resolves.toBeUndefined();
  });
});

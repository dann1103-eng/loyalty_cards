import { describe, expect, it } from 'vitest';
import { urlParaContinuarPago } from './cobros';

// Pura: la hora entra por parámetro.
//
// MUTATION-TESTING (cada fila se corrió):
//   - ignorar el vencimiento del enlace                    → falla "un enlace vencido no se puede seguir"
//   - no exigir que el cobro siga pendiente                → falla "un cobro pagado o anulado no se sigue"
//   - no exigir que sea un intento de la app               → falla "un cobro que registró FM a mano no se sigue"
//   - vencer exactamente en el instante y seguir aceptándolo → falla "al vencer, no antes ni después"

const AHORA = new Date('2026-09-15T18:00:00.000Z').getTime();

const intento = (extra: Partial<Parameters<typeof urlParaContinuarPago>[0]> = {}) => ({
  estado: 'pendiente',
  metodo: 'Wompi',
  wompiUrlEnlace: 'https://lk.wompi.sv/yhDt',
  wompiEnlaceVence: '2026-09-15T19:00:00.000Z',
  ...extra,
});

describe('urlParaContinuarPago', () => {
  it('un intento pendiente de la app con el enlace vigente se puede seguir', () => {
    expect(urlParaContinuarPago(intento(), AHORA)).toBe('https://lk.wompi.sv/yhDt');
  });

  it('un enlace vencido no se puede seguir', () => {
    expect(urlParaContinuarPago(intento({ wompiEnlaceVence: '2026-09-15T17:59:59.000Z' }), AHORA)).toBeNull();
  });

  it('al vencer, no antes ni después: un milisegundo antes se puede, en el instante no', () => {
    expect(urlParaContinuarPago(intento({ wompiEnlaceVence: '2026-09-15T18:00:00.001Z' }), AHORA)).not.toBeNull();
    expect(urlParaContinuarPago(intento({ wompiEnlaceVence: '2026-09-15T18:00:00.000Z' }), AHORA)).toBeNull();
  });

  it('un cobro pagado o anulado no se sigue', () => {
    expect(urlParaContinuarPago(intento({ estado: 'pagado' }), AHORA)).toBeNull();
    expect(urlParaContinuarPago(intento({ estado: 'anulado' }), AHORA)).toBeNull();
  });

  it('un cobro que registró FM a mano no se sigue', () => {
    expect(urlParaContinuarPago(intento({ metodo: 'Transferencia' }), AHORA)).toBeNull();
    expect(urlParaContinuarPago(intento({ metodo: null }), AHORA)).toBeNull();
  });

  it('sin enlace guardado no hay nada que seguir', () => {
    expect(urlParaContinuarPago(intento({ wompiUrlEnlace: null }), AHORA)).toBeNull();
    expect(urlParaContinuarPago(intento({ wompiEnlaceVence: null }), AHORA)).toBeNull();
  });
});

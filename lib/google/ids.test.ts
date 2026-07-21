import { describe, it, expect } from 'vitest';
import { idClaseGoogle, idObjetoGoogle } from './ids';

describe('idClaseGoogle / idObjetoGoogle', () => {
  it('arma el id de clase como issuerId.comercio_<uuid>', () => {
    expect(idClaseGoogle('3388000000023174173', 'a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c6')).toBe(
      '3388000000023174173.comercio_a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c6',
    );
  });

  it('arma el id de objeto como issuerId.tarjeta_<uuid>', () => {
    expect(idObjetoGoogle('3388000000023174173', 'f6e5d4c3-b2a1-4321-8765-1234567890ab')).toBe(
      '3388000000023174173.tarjeta_f6e5d4c3-b2a1-4321-8765-1234567890ab',
    );
  });

  it('clase y objeto de ids distintos nunca colisionan entre sí (prefijos distintos)', () => {
    const mismoUuid = '11111111-2222-3333-4444-555555555555';
    expect(idClaseGoogle('X', mismoUuid)).not.toBe(idObjetoGoogle('X', mismoUuid));
  });
});

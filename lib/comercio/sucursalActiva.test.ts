import { describe, it, expect } from 'vitest';
import { resolverSucursalActiva } from './sucursalActiva';

// MUTATION-TESTING: el candado es que para un CAJERO la cookie se IGNORA SIEMPRE (su sucursal es la
// de su membresía, que viene del gate). Mutación a atrapar: devolver la cookie para rol 'cajero' —
// un cajero elegiría contexto ajeno con una cookie armada a mano.
describe('resolverSucursalActiva', () => {
  it('cajero: SIEMPRE su sucursal de membresía, la cookie se ignora', () => {
    expect(resolverSucursalActiva('cajero', 'suc-mia', 'suc-ajena')).toEqual({
      tipo: 'fija-de-membresia',
      sucursalId: 'suc-mia',
    });
  });

  it('cajero sin sucursal en la membresía: todas (sin contexto)', () => {
    expect(resolverSucursalActiva('cajero', null, 'suc-ajena')).toEqual({ tipo: 'todas' });
  });

  it('owner sin cookie: todas', () => {
    expect(resolverSucursalActiva('owner', null, undefined)).toEqual({ tipo: 'todas' });
  });

  it('owner con cookie: pide validarla (el id NO está verificado todavía)', () => {
    expect(resolverSucursalActiva('owner', null, 'suc-1')).toEqual({
      tipo: 'validar-cookie',
      sucursalId: 'suc-1',
    });
  });
});

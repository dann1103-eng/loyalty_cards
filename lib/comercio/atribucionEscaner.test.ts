import { describe, it, expect } from 'vitest';
import { resolverSucursalDeAccion } from './atribucionEscaner';

// Función PURA: sin BD ni contexto de request. Fija QUÉ sucursal se atribuye a una operación del
// escáner (acreditar/canjear) según el rol. Es el CONTROL DE SEGURIDAD que impide que un cajero
// atribuya visitas a una sucursal que no es la suya: para un cajero la sucursal sale SIEMPRE de su
// sesión (su membresía), nunca de lo que mande el cliente.

describe('resolverSucursalDeAccion', () => {
  it('cajero → SIEMPRE la sucursal de su sesión (ignora la del cliente)', () => {
    expect(resolverSucursalDeAccion('cajero', 'A', 'A')).toBe('A');
    expect(resolverSucursalDeAccion('cajero', 'A', null)).toBe('A');
  });

  it('SEGURIDAD: cajero con sesión en A y cliente pidiendo B → A', () => {
    // EL control: un cajero no puede atribuir a otra sucursal aunque el cliente mande otra distinta.
    expect(resolverSucursalDeAccion('cajero', 'A', 'B')).toBe('A');
  });

  it('owner → la sucursal que eligió en el picker (la validación de pertenencia la hace la acción)', () => {
    expect(resolverSucursalDeAccion('owner', null, 'B')).toBe('B');
  });

  it('owner sin elegir sucursal → null (sin atribución)', () => {
    expect(resolverSucursalDeAccion('owner', null, null)).toBe(null);
  });
});

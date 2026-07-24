import { describe, it, expect } from 'vitest';
import { resolverComercioActivo } from './comercioActivo';
import type { Membresia } from './membresiasDeUsuario';

// Función PURA: sin BD ni cookies(). Fija la política de resolución del "comercio activo" a partir
// de la lista real de membresías (fuente de verdad) y la cookie (input del cliente, NO confiable).

function m(comercioId: string, rol = 'owner'): Membresia {
  return {
    usuarioComercioId: `uc-${comercioId}`,
    comercioId,
    nombre: `Comercio ${comercioId}`,
    rol,
    sucursalId: null,
  };
}

describe('resolverComercioActivo', () => {
  it('sin membresías → sin-acceso', () => {
    expect(resolverComercioActivo([], undefined)).toEqual({ tipo: 'sin-acceso' });
    expect(resolverComercioActivo([], 'c1')).toEqual({ tipo: 'sin-acceso' });
  });

  it('una sola membresía → resuelto (ignora la cookie)', () => {
    const uno = m('c1');
    expect(resolverComercioActivo([uno], undefined)).toEqual({ tipo: 'resuelto', membresia: uno });
    // Cookie apuntando a otra cosa: con una sola membresía la cookie es irrelevante.
    expect(resolverComercioActivo([uno], 'c-ajeno')).toEqual({ tipo: 'resuelto', membresia: uno });
  });

  it('2+ y cookie ∈ membresías → resuelto con la de la cookie', () => {
    const a = m('c1');
    const b = m('c2');
    expect(resolverComercioActivo([a, b], 'c2')).toEqual({ tipo: 'resuelto', membresia: b });
    expect(resolverComercioActivo([a, b], 'c1')).toEqual({ tipo: 'resuelto', membresia: a });
  });

  it('2+ y cookie ausente → elegir', () => {
    const a = m('c1');
    const b = m('c2');
    expect(resolverComercioActivo([a, b], undefined)).toEqual({ tipo: 'elegir' });
  });

  it('SEGURIDAD: 2+ y cookie a un comercio ajeno (no en la lista) → elegir', () => {
    // La cookie es input del cliente. Si apunta a un comercio del que NO es miembro, NO se confía
    // en ella: se manda a elegir, nunca se resuelve al ajeno.
    const a = m('c1');
    const b = m('c2');
    expect(resolverComercioActivo([a, b], 'c-ajeno')).toEqual({ tipo: 'elegir' });
  });
});

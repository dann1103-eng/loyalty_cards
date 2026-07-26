import { describe, it, expect } from 'vitest';
import { enlacesPorRol } from './navegacion';

// MUTATION-TESTING: enlacesPorRol es el control de acceso VISUAL de la nav (la barrera real son los
// gates de cada página). Mutaciones que estos tests deben atrapar: (1) devolver todos los enlaces
// para 'cajero' — el cajero vería secciones owner-only en su nav; (2) un typo en cualquier href de
// ENLACES_NAV (p. ej. '/comercio/brandingg') — sería un 404 en el teléfono. Por (2) los hrefs
// esperados se escriben LITERALES abajo: compararlos contra ENLACES_NAV sería una tautología que
// pasa en verde con la constante rota.
describe('enlacesPorRol', () => {
  it('owner ve las 9 secciones (incluida Reglas, nueva en la nav)', () => {
    const hrefs = enlacesPorRol('owner').map((e) => e.href);
    expect(hrefs).toEqual([
      '/comercio/panel',
      '/comercio/escanear',
      '/comercio/branding',
      '/comercio/recompensas',
      '/comercio/reglas',
      '/comercio/sucursales',
      '/comercio/cajeros',
      '/comercio/clientes',
      '/comercio/reportes',
    ]);
    expect(hrefs).toContain('/comercio/reglas');
    expect(hrefs).toHaveLength(9);
  });

  it('cajero ve EXACTAMENTE Resumen, Escanear y Clientes', () => {
    expect(enlacesPorRol('cajero').map((e) => e.href)).toEqual([
      '/comercio/panel',
      '/comercio/escanear',
      '/comercio/clientes',
    ]);
  });

  it('un rol desconocido degrada a solo Escanear', () => {
    expect(enlacesPorRol('lo-que-sea').map((e) => e.href)).toEqual(['/comercio/escanear']);
  });
});

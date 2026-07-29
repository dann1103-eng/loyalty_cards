import { describe, it, expect } from 'vitest';
import { ENLACES_BARRA, enlacesBarraPorRol, enlacesMenuPorRol } from './navegacion';

// MUTATION-TESTING: este módulo es el control de acceso VISUAL de la nav (la barrera real son los
// gates de cada página). Mutaciones que estos tests deben atrapar: (1) devolver todos los enlaces
// para 'cajero' — vería secciones owner-only en su barra y un menú lleno de puertas cerradas;
// (2) un typo en cualquier href (p. ej. '/comercio/brandingg') — sería un 404 en el teléfono;
// (3) reordenar ENLACES_BARRA y sacar Escanear del centro, que es la única razón por la que la
// barra tiene 5 y no 4 o 6 destinos. Por (2) y (3) los hrefs esperados se escriben LITERALES y EN
// ORDEN abajo: compararlos contra la constante sería una tautología que pasa en verde con la
// constante rota.
describe('enlacesBarraPorRol', () => {
  it('owner ve 5 destinos con Escanear EN EL CENTRO', () => {
    const hrefs = enlacesBarraPorRol('owner').map((e) => e.href);
    expect(hrefs).toEqual([
      '/comercio/panel',
      '/comercio/branding',
      '/comercio/escanear',
      '/comercio/recompensas',
      '/comercio/clientes',
    ]);
    // La posición ES el requisito (pulgar al centro), no un detalle de presentación: con 5 destinos
    // el centro es el índice 2. Si algún día la barra crece, este cálculo falla y avisa.
    expect(hrefs).toHaveLength(5);
    expect(hrefs[Math.floor(hrefs.length / 2)]).toBe('/comercio/escanear');
  });

  it('cajero ve EXACTAMENTE Resumen, Escanear y Clientes, con Escanear al centro', () => {
    const hrefs = enlacesBarraPorRol('cajero').map((e) => e.href);
    expect(hrefs).toEqual(['/comercio/panel', '/comercio/escanear', '/comercio/clientes']);
    expect(hrefs[Math.floor(hrefs.length / 2)]).toBe('/comercio/escanear');
  });

  it('un rol desconocido degrada a solo Escanear', () => {
    expect(enlacesBarraPorRol('lo-que-sea').map((e) => e.href)).toEqual(['/comercio/escanear']);
  });

  it('cada destino de la barra trae ícono y etiqueta (la barra es solo-ícono+texto)', () => {
    for (const e of ENLACES_BARRA) {
      expect(e.icono, `${e.href} sin ícono`).toBeTruthy();
      expect(e.etiqueta, `${e.href} sin etiqueta`).toBeTruthy();
    }
  });
});

describe('enlacesMenuPorRol', () => {
  it('owner ve las 5 secciones restantes con Reportes PRIMERO', () => {
    const hrefs = enlacesMenuPorRol('owner').map((e) => e.href);
    expect(hrefs).toEqual([
      '/comercio/reportes',
      '/comercio/reglas',
      // Programas (0024): justo después de Reglas, la sección hermana de la que heredó la
      // configuración por tipo.
      '/comercio/programas',
      '/comercio/sucursales',
      '/comercio/cajeros',
      // Mi plan (0017). Va al final a propósito: es configuración ocasional, no operación diaria.
      '/comercio/plan',
    ]);
    // Aserción aparte y explícita: Reportes es la sección más consultada de las que quedaron fuera
    // de la barra; enterrarla al final del menú la vuelve invisible.
    expect(hrefs[0]).toBe('/comercio/reportes');
  });

  it('cajero no ve NINGUNA sección en el menú (ninguna es suya)', () => {
    expect(enlacesMenuPorRol('cajero')).toEqual([]);
  });

  it('un rol desconocido tampoco ve secciones en el menú', () => {
    expect(enlacesMenuPorRol('lo-que-sea')).toEqual([]);
  });

  it('barra y menú no repiten destinos: cada sección vive en UNA sola superficie', () => {
    const barra = enlacesBarraPorRol('owner').map((e) => e.href);
    const menu = enlacesMenuPorRol('owner').map((e) => e.href);
    expect(barra.filter((h) => menu.includes(h))).toEqual([]);
    // Las 11 secciones del panel siguen alcanzables entre las dos superficies: si alguien mueve una
    // sección de la barra al menú (o al revés) esto sigue verde, pero si la BORRA de ambas, no.
    // (Eran 9 hasta que la 0017 sumó "Mi plan"; 10 hasta que la 0024 sumó "Programas".)
    expect(new Set([...barra, ...menu]).size).toBe(11);
  });
});

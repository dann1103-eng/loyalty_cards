import { describe, it, expect } from 'vitest';
import { ENLACES_BARRA, enlacesBarraPorRol, enlacesMenuPorRol } from './navegacion';
import { TIPOS } from '../tarjetas/tipos';

// MUTATION-TESTING: este módulo es el control de acceso VISUAL de la nav (la barrera real son los
// gates de cada página). Mutaciones que estos tests deben atrapar: (1) devolver todos los enlaces
// para 'cajero' — vería secciones owner-only en su barra y un menú lleno de puertas cerradas;
// (2) un typo en cualquier href (p. ej. '/comercio/brandingg') — sería un 404 en el teléfono;
// (3) reordenar ENLACES_BARRA y sacar Escanear del centro, que es la única razón por la que la
// barra tiene 5 y no 4 o 6 destinos. Por (2) y (3) los hrefs esperados se escriben LITERALES y EN
// ORDEN abajo: compararlos contra la constante sería una tautología que pasa en verde con la
// constante rota.

// "Escanear al centro" NO es `hrefs[Math.floor(largo / 2)]`. Con CUATRO destinos ese índice sigue
// dando Escanear (el 2 de [0,1,2,3]) aunque tenga dos vecinos a la izquierda y uno solo a la
// derecha: descentrado en pantalla y verde en la prueba. La invariante real es que haya la MISMA
// cantidad de destinos de cada lado, y es así como esta prueba atrapa la mutación de sacar Premios
// sin subir Programas en su lugar.
function esperarEscanearAlCentro(hrefs: string[]) {
  const i = hrefs.indexOf('/comercio/escanear');
  expect(i, `Escanear no está en [${hrefs.join(', ')}]`).toBeGreaterThanOrEqual(0);
  expect(hrefs.length - 1 - i, `Escanear descentrado en [${hrefs.join(', ')}]`).toBe(i);
}

describe('enlacesBarraPorRol', () => {
  it('owner ve 5 destinos con Escanear EN EL CENTRO', () => {
    const hrefs = enlacesBarraPorRol('owner', 'puntos').map((e) => e.href);
    expect(hrefs).toEqual([
      '/comercio/panel',
      '/comercio/branding',
      '/comercio/escanear',
      '/comercio/recompensas',
      '/comercio/clientes',
    ]);
    // La posición ES el requisito (pulgar al centro), no un detalle de presentación.
    expect(hrefs).toHaveLength(5);
    esperarEscanearAlCentro(hrefs);
  });

  it('cajero ve EXACTAMENTE Resumen, Escanear y Clientes, con Escanear al centro', () => {
    const hrefs = enlacesBarraPorRol('cajero', 'puntos').map((e) => e.href);
    expect(hrefs).toEqual(['/comercio/panel', '/comercio/escanear', '/comercio/clientes']);
    esperarEscanearAlCentro(hrefs);
  });

  it('un rol desconocido degrada a solo Escanear', () => {
    expect(enlacesBarraPorRol('lo-que-sea', 'puntos').map((e) => e.href)).toEqual([
      '/comercio/escanear',
    ]);
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
    const hrefs = enlacesMenuPorRol('owner', 'puntos').map((e) => e.href);
    expect(hrefs).toEqual([
      '/comercio/reportes',
      '/comercio/reglas',
      // Programas (0024): justo después de Reglas, la sección hermana de la que heredó la
      // configuración por tipo.
      '/comercio/programas',
      // Notificaciones (0026): la perilla del aviso AUTOMÁTICO de inactividad vive en Reglas
      // (FormularioAvisoInactividad), así que esta pantalla —la campaña MANUAL y su historial— es
      // la sección hermana más cercana de ese bloque Reglas/Programas, antes de las operativas
      // de abajo (Sucursales/Cajeros).
      '/comercio/notificaciones',
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
    expect(enlacesMenuPorRol('cajero', 'puntos')).toEqual([]);
  });

  it('un rol desconocido tampoco ve secciones en el menú', () => {
    expect(enlacesMenuPorRol('lo-que-sea', 'puntos')).toEqual([]);
  });

  it('barra y menú no repiten destinos: cada sección vive en UNA sola superficie', () => {
    // Para TODOS los tipos, no solo el de hoy: el intercambio de Premios y Programas mueve dos
    // destinos entre las dos superficies, y hacer solo la mitad del intercambio (subir Programas
    // a la barra sin bajarlo del menú) duplicaría el destino. Con un solo tipo probado, esa
    // mutación pasa en verde.
    for (const t of TIPOS) {
      const barra = enlacesBarraPorRol('owner', t.valor).map((e) => e.href);
      const menu = enlacesMenuPorRol('owner', t.valor).map((e) => e.href);
      expect(barra.filter((h) => menu.includes(h)), `duplicados en ${t.valor}`).toEqual([]);
      // Las 12 secciones del panel siguen alcanzables entre las dos superficies: si alguien mueve
      // una sección de la barra al menú (o al revés) esto sigue verde, pero si la BORRA de ambas,
      // no. (Eran 9 hasta que la 0017 sumó "Mi plan"; 10 hasta que la 0024 sumó "Programas"; 11
      // hasta que la 0026 sumó "Notificaciones".)
      expect(new Set([...barra, ...menu]).size, `secciones alcanzables en ${t.valor}`).toBe(12);
    }
  });
});

// Decisión 5 del spec 2026-09-08: en los tipos con contador 'ninguno' (cupón, membresía, descuento)
// un canje descuenta de `puntos_actuales`, que en esos tipos NUNCA se mueve — ninguna recompensa se
// puede canjear jamás. Premios deja de ocupar un lugar en la barra, pero es un INTERCAMBIO: baja al
// menú y Programas sube a la barra EN SU MISMA POSICIÓN, porque la barra lleva exactamente cinco
// destinos y Escanear se centra por estar en la posición 3 de 5.
describe('Premios y Programas intercambian superficie según el tipo', () => {
  it('con contador "ninguno" la barra lleva Programas EN EL LUGAR de Premios', () => {
    const enlaces = enlacesBarraPorRol('owner', 'membresia');
    expect(enlaces.map((e) => e.href)).toEqual([
      '/comercio/panel',
      '/comercio/branding',
      '/comercio/escanear',
      '/comercio/programas',
      '/comercio/clientes',
    ]);
    // El destino que sube trae SU ícono y SU etiqueta, no los de Premios.
    expect(enlaces[3]).toEqual({ href: '/comercio/programas', icono: 'style', etiqueta: 'Programas' });
    esperarEscanearAlCentro(enlaces.map((e) => e.href));
  });

  it('con contador "ninguno" el menú lleva Premios EN EL LUGAR de Programas', () => {
    const enlaces = enlacesMenuPorRol('owner', 'membresia');
    expect(enlaces.map((e) => e.href)).toEqual([
      '/comercio/reportes',
      '/comercio/reglas',
      '/comercio/recompensas',
      '/comercio/notificaciones',
      '/comercio/sucursales',
      '/comercio/cajeros',
      '/comercio/plan',
    ]);
    expect(enlaces[2]).toEqual({ href: '/comercio/recompensas', icono: 'redeem', etiqueta: 'Premios' });
    // Reportes sigue encabezando el menú: el intercambio no puede reordenar lo demás.
    expect(enlaces[0].href).toBe('/comercio/reportes');
  });

  it('intercambian EXACTAMENTE los tipos sin contador, y ninguno de los otros', () => {
    for (const t of TIPOS) {
      const barra = enlacesBarraPorRol('owner', t.valor).map((e) => e.href);
      const menu = enlacesMenuPorRol('owner', t.valor).map((e) => e.href);
      const sinCanje = t.contador === 'ninguno';
      expect(barra.includes('/comercio/programas'), `Programas en la barra de ${t.valor}`).toBe(sinCanje);
      expect(barra.includes('/comercio/recompensas'), `Premios en la barra de ${t.valor}`).toBe(!sinCanje);
      expect(menu.includes('/comercio/recompensas'), `Premios en el menú de ${t.valor}`).toBe(sinCanje);
      expect(menu.includes('/comercio/programas'), `Programas en el menú de ${t.valor}`).toBe(!sinCanje);
    }
  });

  it('un tipo desconocido conserva el reparto de hoy (degrada a puntos, como tipoOPuntos)', () => {
    expect(enlacesBarraPorRol('owner', 'lo-que-sea').map((e) => e.href)).toEqual(
      enlacesBarraPorRol('owner', 'puntos').map((e) => e.href),
    );
    expect(enlacesMenuPorRol('owner', 'lo-que-sea').map((e) => e.href)).toEqual(
      enlacesMenuPorRol('owner', 'puntos').map((e) => e.href),
    );
  });

  it('Escanear queda al centro con CUALQUIER tipo y CUALQUIER rol', () => {
    for (const t of TIPOS) {
      for (const rol of ['owner', 'cajero', 'lo-que-sea']) {
        esperarEscanearAlCentro(enlacesBarraPorRol(rol, t.valor).map((e) => e.href));
      }
    }
  });

  it('al cajero el tipo no le cambia nada: no ve ni Premios ni Programas', () => {
    // RUTAS_CAJERO no incluye ninguno de los dos destinos que se intercambian, así que su barra y
    // su menú tienen que salir idénticos para los ocho tipos. Es lo que habilita al layout a no
    // consultar los programas cuando el que entra es un cajero.
    for (const t of TIPOS) {
      expect(enlacesBarraPorRol('cajero', t.valor).map((e) => e.href), t.valor).toEqual([
        '/comercio/panel',
        '/comercio/escanear',
        '/comercio/clientes',
      ]);
      expect(enlacesMenuPorRol('cajero', t.valor), t.valor).toEqual([]);
    }
  });
});

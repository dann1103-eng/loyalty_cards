import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  manifiestoComercio,
  manifiestoAdmin,
  URL_MANIFIESTO_COMERCIO,
  URL_MANIFIESTO_ADMIN,
} from './manifiestos';

// Mutaciones corridas a mano (romper, confirmar el mensaje de fallo, restaurar) — ver el reporte
// de la tarea para la transcripción completa de cada corrida:
// - `scope: '/admin/'` (con barra) en manifiestoAdmin() → CONFIRMADA: falla
//   "invariante: start_url está dentro de scope" en el describe de admin.
// - `start_url: '/mi-tarjeta'` en manifiestoComercio() → CONFIRMADA: falla "apunta a /comercio/panel
//   como start_url e id" Y "no es el manifest del cliente".
// - Borrar `export const metadata` de app/comercio/elegir/page.tsx dejando el `import` →
//   CONFIRMADA: el guardarraíl lista `app/comercio/elegir/page.tsx` en el mensaje de fallo.
// - Borrar la clave `manifest` de app/registro-comercio/page.tsx dejando el `import` → CONFIRMADA:
//   el guardarraíl lista `app/registro-comercio/page.tsx`.
// - Comentar la línea `manifest: URL_MANIFIESTO_ADMIN` de app/admin/login/page.tsx → CONFIRMADA:
//   el guardarraíl lista `app/admin/login/page.tsx`.

const RAIZ = join(__dirname, '..');

describe('manifiestoComercio()', () => {
  const m = manifiestoComercio();

  it('arranca e identifica la instalación en /comercio/panel: la página que comparten dueño y cajero', () => {
    expect(m.start_url).toBe('/comercio/panel');
    expect(m.id).toBe('/comercio/panel');
  });

  it('el scope cubre todo /comercio/ (con barra final)', () => {
    expect(m.scope).toBe('/comercio/');
  });

  it('se instala como app standalone', () => {
    expect(m.display).toBe('standalone');
  });

  it('usa el ícono genérico de Cardly en 192 y 512, servido por los Route Handlers públicos', () => {
    expect(m.icons).toEqual([
      { src: '/mi-tarjeta/icono-192', sizes: '192x192', type: 'image/png' },
      { src: '/mi-tarjeta/icono-512', sizes: '512x512', type: 'image/png' },
    ]);
  });

  // Invariante del spec: un start_url fuera del scope hace que el navegador descarte el scope
  // completo (el manifest queda "roto" en silencio, sin error visible).
  it('invariante: start_url está dentro de scope', () => {
    expect(m.start_url!.startsWith(m.scope!)).toBe(true);
  });

  // El bug original (2026-09-22): el dueño instalaba el portal del CLIENTE desde su propio login.
  it('no es el manifest del cliente: start_url no empieza con /mi-tarjeta', () => {
    expect(m.start_url!.startsWith('/mi-tarjeta')).toBe(false);
  });
});

describe('manifiestoAdmin()', () => {
  const m = manifiestoAdmin();

  it('arranca e identifica la instalación en /admin', () => {
    expect(m.start_url).toBe('/admin');
    expect(m.id).toBe('/admin');
  });

  // SIN barra final a propósito: '/admin' no empieza con '/admin/' — con barra, la invariante de
  // abajo fallaría y el navegador descartaría el scope.
  it('el scope es /admin, sin barra final', () => {
    expect(m.scope).toBe('/admin');
  });

  it('invariante: start_url está dentro de scope', () => {
    expect(m.start_url!.startsWith(m.scope!)).toBe(true);
  });

  it('no es el manifest del cliente: start_url no empieza con /mi-tarjeta', () => {
    expect(m.start_url!.startsWith('/mi-tarjeta')).toBe(false);
  });
});

// Guardarraíl de archivos, mismo estilo que lib/marca.test.ts: un barrido a mano responde "ya les
// puse el manifest a todos" una vez; esta prueba lo responde siempre. Sin ella, una pantalla nueva
// del dueño (o de FM) vuelve a heredar en silencio el manifest del portal del CLIENTE —el mismo bug
// que originó esta tarea— porque next inyecta el manifest de la raíz salvo que el segmento diga lo
// contrario.

// Quita comentarios de línea y de bloque, igual que sinComentarios() en lib/marca.test.ts: sin esto,
// un archivo que menciona la constante solo en un comentario ("TODO: declarar manifest:
// URL_MANIFIESTO_ADMIN acá") pasaría la prueba sin haber declarado nada de verdad.
function sinComentarios(contenido: string): string {
  return contenido
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((linea) => !/^\s*(\/\/|\*)/.test(linea))
    .map((linea) => linea.replace(/\/\/.*$/, ''))
    .join('\n');
}

// Recorre una carpeta de app/ y junta los archivos que TIENEN que declarar su propio manifest:
// - todo page.tsx que NO cuelgue de una carpeta (protegido) (esas páginas no tienen sesión: son
//   login, activar, clave, elegir, suspendida — el manifest tiene que estar ahí para que el primer
//   atajo que instala alguien ya sea el correcto);
// - el layout.tsx de cada carpeta (protegido) (cubre a TODAS las páginas del panel de una sola vez,
//   por herencia de metadata — no hace falta tocar cada page.tsx de adentro).
function archivosQueNecesitanManifest(raizRelativa: string): string[] {
  const encontrados: string[] = [];

  function recorrer(dir: string, dentroDeProtegido: boolean): void {
    let entradas: string[];
    try {
      entradas = readdirSync(dir);
    } catch {
      return; // La carpeta puede no existir todavía; no es motivo para romper la prueba.
    }
    for (const entrada of entradas) {
      const completa = join(dir, entrada);
      if (statSync(completa).isDirectory()) {
        const esProtegido = entrada === '(protegido)';
        if (esProtegido) {
          const layout = join(completa, 'layout.tsx');
          if (existsSync(layout)) encontrados.push(layout);
        }
        recorrer(completa, dentroDeProtegido || esProtegido);
      } else if (entrada === 'page.tsx' && !dentroDeProtegido) {
        encontrados.push(completa);
      }
    }
  }

  recorrer(join(RAIZ, raizRelativa), false);
  return encontrados;
}

describe('todas las pantallas del dueño y de FM declaran su propio manifest', () => {
  const archivosComercio = archivosQueNecesitanManifest('app/comercio');
  const archivosAdmin = archivosQueNecesitanManifest('app/admin');

  it('el barrido encontró de verdad las carpetas del proyecto (6 de comercio + 2 de admin)', () => {
    // Si esto diera menos de 8, la prueba de abajo podría pasar sin haber mirado nada —el error
    // más silencioso posible, igual que el expect(archivos.length) de lib/marca.test.ts.
    expect(archivosComercio.length + archivosAdmin.length).toBeGreaterThanOrEqual(8);
  });

  it('cada archivo referencia la constante de SU manifest (no el nombre suelto, la clave completa)', () => {
    // app/registro-comercio/page.tsx vive fuera de app/comercio y app/admin (es el alta
    // self-service del dueño, no un archivo del panel), así que el recorrido de arriba no lo
    // encuentra: se agrega a mano, como pide el diseño.
    const objetivos: { archivo: string; constante: 'URL_MANIFIESTO_COMERCIO' | 'URL_MANIFIESTO_ADMIN' }[] = [
      ...archivosComercio.map((archivo) => ({ archivo, constante: 'URL_MANIFIESTO_COMERCIO' as const })),
      ...archivosAdmin.map((archivo) => ({ archivo, constante: 'URL_MANIFIESTO_ADMIN' as const })),
      { archivo: join(RAIZ, 'app/registro-comercio/page.tsx'), constante: 'URL_MANIFIESTO_COMERCIO' as const },
    ];

    const culpables: string[] = [];
    for (const { archivo, constante } of objetivos) {
      const codigo = sinComentarios(readFileSync(archivo, 'utf-8'));
      // "Declarar" = la CLAVE manifest apuntando a la constante, no el import suelto: un archivo
      // que conserva `import { URL_MANIFIESTO_COMERCIO } from '@/lib/manifiestos'` pero perdió la
      // clave `manifest` dentro de `metadata` pasaría un match contra el nombre solo, y ese es
      // justo el caso que rompe el atajo sin que nadie se entere.
      const regex = new RegExp(`manifest:\\s*${constante}\\b`);
      if (!regex.test(codigo)) {
        culpables.push(relative(RAIZ, archivo));
      }
    }

    expect(
      culpables,
      `No declaran su manifest (o perdieron la clave "manifest: ${'URL_MANIFIESTO_…'}"):\n${culpables.join('\n')}`,
    ).toEqual([]);
  });
});

describe('las constantes de URL son las que sirven los Route Handlers', () => {
  // app/manifiestos/comercio.webmanifest/route.ts y .../admin.webmanifest/route.ts responden en
  // exactamente estas rutas (el nombre de carpeta ES la URL, como pass.pkpass). Si estas
  // constantes cambiaran sin tocar esas carpetas, el `<link rel="manifest">` de cada pantalla
  // apuntaría a un 404.
  it('comercio', () => {
    expect(URL_MANIFIESTO_COMERCIO).toBe('/manifiestos/comercio.webmanifest');
  });

  it('admin', () => {
    expect(URL_MANIFIESTO_ADMIN).toBe('/manifiestos/admin.webmanifest');
  });
});

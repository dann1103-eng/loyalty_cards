import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MetadataRoute } from 'next';
import manifestoRaiz from '@/app/manifest';
import {
  manifiestoComercio,
  manifiestoAdmin,
  URL_MANIFIESTO_COMERCIO,
  URL_MANIFIESTO_ADMIN,
} from './manifiestos';

// MUTATION-TESTING (cada fila se corrió el 2026-09-23: romper, confirmar el mensaje de fallo
// exacto, restaurar). Detalle completo al final del archivo.

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

// lib/manifiestos.ts duplica a propósito el fondo y los íconos de app/manifest.ts (no los importa:
// los tres manifests quedan independientes entre sí). Esta prueba es lo que mantiene esa
// duplicación honesta: si alguien cambia el color o el ícono en uno de los tres lugares y se
// olvida de los otros dos, esto falla en vez de quedar desincronizado en silencio.
describe('background_color, theme_color e icons no se desincronizan de app/manifest.ts', () => {
  const raiz = manifestoRaiz();

  it('comercio', () => {
    const m = manifiestoComercio();
    expect(m.background_color).toBe(raiz.background_color);
    expect(m.theme_color).toBe(raiz.theme_color);
    expect(m.icons).toEqual(raiz.icons);
  });

  it('admin', () => {
    const m = manifiestoAdmin();
    expect(m.background_color).toBe(raiz.background_color);
    expect(m.theme_color).toBe(raiz.theme_color);
    expect(m.icons).toEqual(raiz.icons);
  });
});

// Guardarraíl de archivos, mismo estilo que lib/marca.test.ts: un barrido a mano responde "ya les
// puse el manifest a todos" una vez; esta prueba lo responde siempre. Sin ella, una pantalla nueva
// del dueño (o de FM) vuelve a heredar en silencio el manifest del portal del CLIENTE —el mismo bug
// que originó esta tarea— porque next inyecta el manifest de la raíz salvo que el segmento diga lo
// contrario.

// Quita comentarios de línea y de bloque, igual que sinComentarios() en lib/marca.test.ts —con UN
// arreglo: split(/\r?\n/) y no split('\n'). El working tree de este repo es CRLF (core.autocrlf,
// ver CLAUDE.md). Con split('\n') cada "línea" le queda un '\r' colgando al final; `.` no matchea
// '\r' y `$` sin bandera `m` es fin de STRING, así que `/\/\/.*$/` nunca encuentra dónde matchear y
// el comentario queda SIN quitar. Eso deja pasar un caso real: una `metadata` vacía con un
// comentario tramposo al final de la línea, tipo
// `export const metadata: Metadata = {};  // manifest: URL_MANIFIESTO_ADMIN`, donde no hay ninguna
// declaración de verdad pero el texto del comentario matchea el regex de abajo igual. Confirmado
// con mutación (ver M6 al final del archivo).
function sinComentarios(contenido: string): string {
  return contenido
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((linea) => !/^\s*(\/\/|\*)/.test(linea))
    .map((linea) => linea.replace(/\/\/.*$/, ''))
    .join('\n');
}

// Recorre una carpeta de app/ y junta los archivos que TIENEN que declarar su propio manifest:
// - todo page.tsx que NO cuelgue de una carpeta (protegido) (esas páginas no heredan metadata de
//   ningún layout del panel —login, activar, clave, elegir, suspendida—, así que sin su propia
//   declaración el manifest que reciben es el de la raíz, el del portal del CLIENTE);
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

// Normaliza a formato POSIX ('/') para que las aserciones no dependan del separador de rutas del
// SO (join() usa '\' en Windows).
function normalizar(rutaAbsoluta: string): string {
  return relative(RAIZ, rutaAbsoluta).replace(/\\/g, '/');
}

describe('todas las pantallas del dueño y de FM declaran su propio manifest', () => {
  const archivosComercio = archivosQueNecesitanManifest('app/comercio');
  const archivosAdmin = archivosQueNecesitanManifest('app/admin');
  // app/registro-comercio es el alta self-service del dueño: vive fuera de app/comercio, pero es
  // una pantalla suya igual, y la misma función sirve para recorrerla (no tiene carpeta
  // (protegido) adentro, así que encuentra únicamente su page.tsx).
  const archivosRegistroComercio = archivosQueNecesitanManifest('app/registro-comercio');

  it('el barrido encontró de verdad las carpetas del proyecto (6 de comercio + 2 de admin + 1 de registro-comercio)', () => {
    // Si esto diera menos de 9, la prueba de abajo podría pasar sin haber mirado nada —el error
    // más silencioso posible, igual que el expect(archivos.length) de lib/marca.test.ts.
    expect(archivosComercio.length + archivosAdmin.length + archivosRegistroComercio.length).toBeGreaterThanOrEqual(9);
  });

  it('encontró los dos layouts de (protegido) (confirma que esa rama del recorrido corrió de verdad)', () => {
    expect(archivosComercio.map(normalizar)).toContain('app/comercio/(protegido)/layout.tsx');
    expect(archivosAdmin.map(normalizar)).toContain('app/admin/(protegido)/layout.tsx');
  });

  it('cada archivo declara su manifest con export (no el nombre suelto, la clave completa)', () => {
    const objetivos: { archivo: string; constante: 'URL_MANIFIESTO_COMERCIO' | 'URL_MANIFIESTO_ADMIN' }[] = [
      ...archivosComercio.map((archivo) => ({ archivo, constante: 'URL_MANIFIESTO_COMERCIO' as const })),
      ...archivosAdmin.map((archivo) => ({ archivo, constante: 'URL_MANIFIESTO_ADMIN' as const })),
      ...archivosRegistroComercio.map((archivo) => ({ archivo, constante: 'URL_MANIFIESTO_COMERCIO' as const })),
    ];

    // "export const metadata" o "export function/async function generateMetadata": sin exigir el
    // `export`, `const metadata = { manifest: … }` a secas matchea el regex de la clave de abajo
    // pero Next lo ignora en silencio (no es una export reconocida) — pasaría la prueba sin que el
    // manifest se aplique de verdad.
    const regexExportMetadata = /export\s+const\s+metadata\b|export\s+(async\s+)?function\s+generateMetadata\b/;

    const culpables: string[] = [];
    for (const { archivo, constante } of objetivos) {
      const codigo = sinComentarios(readFileSync(archivo, 'utf-8'));
      // "Declarar" = la CLAVE manifest apuntando a la constante, no el import suelto: un archivo
      // que conserva `import { URL_MANIFIESTO_COMERCIO } from '@/lib/manifiestos'` pero perdió la
      // clave `manifest` dentro de `metadata` pasaría un match contra el nombre solo, y ese es
      // justo el caso que rompe el atajo sin que nadie se entere.
      const regexClave = new RegExp(`manifest:\\s*${constante}\\b`);
      if (!regexClave.test(codigo) || !regexExportMetadata.test(codigo)) {
        culpables.push(normalizar(archivo));
      }
    }

    expect(
      culpables,
      `No declaran su manifest con export (o perdieron la clave "manifest: URL_MANIFIESTO_…"):\n${culpables.join('\n')}`,
    ).toEqual([]);
  });
});

// Los Route Handlers responden en /manifiestos/*.webmanifest (el nombre de la carpeta ES la URL,
// igual que pass.pkpass). Esto NO lo cubre ninguna prueba de arriba: manifiestoComercio() y
// manifiestoAdmin() son funciones puras, pero nada probaba todavía que la ruta de admin sirviera el
// de admin y no el de comercio (o que la carpeta exista con el nombre correcto).
const RUTAS_MANIFIESTOS: { url: string; manifiestoEsperado: () => MetadataRoute.Manifest }[] = [
  { url: URL_MANIFIESTO_COMERCIO, manifiestoEsperado: manifiestoComercio },
  { url: URL_MANIFIESTO_ADMIN, manifiestoEsperado: manifiestoAdmin },
];

describe.each(RUTAS_MANIFIESTOS)('el Route Handler de $url', ({ url, manifiestoEsperado }) => {
  // 'manifiestos/comercio.webmanifest/route.ts' — sin la barra inicial de la URL.
  const archivoRuta = join(RAIZ, 'app', ...url.split('/').filter(Boolean), 'route.ts');

  it('existe en disco', () => {
    expect(existsSync(archivoRuta)).toBe(true);
  });

  it('el GET responde ese manifest exacto con el content-type de manifest', async () => {
    const modulo = await import(pathToFileURL(archivoRuta).href);
    const respuesta = await modulo.GET();
    expect(respuesta.headers.get('content-type')).toBe('application/manifest+json');
    expect(await respuesta.json()).toEqual(manifiestoEsperado());
  });
});

describe('las constantes de URL son las que sirven los Route Handlers', () => {
  it('comercio', () => {
    expect(URL_MANIFIESTO_COMERCIO).toBe('/manifiestos/comercio.webmanifest');
  });

  it('admin', () => {
    expect(URL_MANIFIESTO_ADMIN).toBe('/manifiestos/admin.webmanifest');
  });
});

// MUTATION-TESTING — transcripción completa, cada fila corrida el 2026-09-23 (romper, confirmar el
// mensaje de fallo exacto, restaurar):
//
//   M1. `scope: '/admin/'` (con barra) en manifiestoAdmin()
//       → fallan 2 pruebas, ambas del describe de manifiestoAdmin(): "el scope es /admin, sin
//         barra final" (expected '/admin/' to be '/admin') y "invariante: start_url está dentro de
//         scope" (expected false to be true).
//
//   M2. `start_url: '/mi-tarjeta'` en manifiestoComercio()
//       → fallan 3 pruebas, las tres del describe de manifiestoComercio(): "arranca e identifica la
//         instalación en /comercio/panel: la página que comparten dueño y cajero" (expected
//         '/mi-tarjeta' to be '/comercio/panel'), "invariante: start_url está dentro de scope"
//         (expected false to be true) y "no es el manifest del cliente: start_url no empieza con
//         /mi-tarjeta" (expected true to be false).
//
//   M3. Borrar `export const metadata` de app/comercio/elegir/page.tsx dejando el `import`
//       → falla "cada archivo declara su manifest con export (no el nombre suelto, la clave
//         completa)"; el mensaje lista `app/comercio/elegir/page.tsx`.
//
//   M4. Borrar la clave `manifest` de app/registro-comercio/page.tsx dejando el `import`
//       → falla la misma prueba; el mensaje lista `app/registro-comercio/page.tsx`.
//
//   M5. Comentar la línea `manifest: URL_MANIFIESTO_ADMIN` de app/admin/login/page.tsx
//       → falla la misma prueba; el mensaje lista `app/admin/login/page.tsx`.
//
//   M6. El bug de CRLF en sinComentarios(), en dos pasos:
//       (a) con `split('\n')` (sin la alternativa `\r?`) Y `export const metadata: Metadata = {};
//           // manifest: URL_MANIFIESTO_ADMIN` en app/admin/login/page.tsx (CRLF real: `git
//           ls-files --eol` da `w/crlf`; metadata vacía, la clave real NO está) → LAS 21 PRUEBAS
//           PASAN: el `\r` final de cada línea hace que `/\/\/.*$/` nunca matchee, el comentario
//           queda sin quitar, y su texto matchea el regex de la clave por accidente. Falso negativo
//           confirmado.
//       (b) mismo archivo roto, con `split(/\r?\n/)` (el arreglo) → AHORA SÍ falla "cada archivo
//           declara su manifest con export (no el nombre suelto, la clave completa)"; el mensaje
//           lista `app/admin/login/page.tsx`. Confirma que el arreglo atrapa lo que el bug dejaba
//           pasar.
//
//   M7. El GET de app/manifiestos/admin.webmanifest/route.ts responde manifiestoComercio() en vez
//       de manifiestoAdmin()
//       → falla "el GET responde ese manifest exacto con el content-type de manifest" en la fila
//         `el Route Handler de '/manifiestos/admin.webmanifest'` (el body no matchea: trae
//         start_url/scope/id/name/short_name de comercio).
//
//   M8. Renombrar la carpeta app/manifiestos/comercio.webmanifest (a comercio-temp.webmanifest)
//       → fallan las 2 pruebas de la fila `el Route Handler de '/manifiestos/comercio.webmanifest'`:
//         "existe en disco" (expected false to be true) y "el GET responde ese manifest exacto..."
//         (Error: Cannot find module — ya no puede importar el archivo movido).
//
//   M9. Quitar el `export` de `export const metadata` en app/comercio/login/page.tsx (queda
//       `const metadata = …`, con la clave `manifest` intacta)
//       → falla "cada archivo declara su manifest con export (no el nombre suelto, la clave
//         completa)"; el mensaje lista `app/comercio/login/page.tsx`. Sin el chequeo de `export`
//         nuevo (regexExportMetadata) esta mutación NO se detecta: la clave sigue matcheando.

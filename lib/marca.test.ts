import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MARCA } from './marca';

// Guarda contra el rebranding a medias. El producto se llamaba "FM Lealtad" y pasó a "Cardly SV",
// pero el nombre viejo quedó repartido por textos de interfaz: un dueño llegó a ver
// "Hablá con FM para ampliarlo" en su panel —un nombre que para él no significa nada— y el ícono
// que el cliente instala en su teléfono decía literalmente "FM".
//
// Un barrido a mano responde "los cambiamos todos" una vez; esta prueba lo responde siempre. Sin
// ella, la próxima pantalla que alguien escriba copiando el estilo de otra vuelve a meter el nombre
// viejo y nadie se entera hasta que un cliente lo ve.
//
// NO cubre `app/admin`: ese es el panel interno del operador, donde "FM" es el nombre correcto de
// quien lo usa. Tampoco cubre comentarios de código, que describen ese mismo rol.

// Todo lo que un COMERCIO o un CLIENTE puede leer. `app/admin` queda afuera a propósito.
const CARPETAS_VISIBLES = [
  'app/comercio',
  'app/registro',
  'app/mi-tarjeta',
  // La página pública y su formulario de demo: el primer texto que lee un comercio que todavía no
  // es cliente. Va la carpeta entera y no archivo por archivo para que una pantalla nueva quede
  // cubierta sin que nadie tenga que acordarse de anotarla acá.
  'app/_inicio',
  'lib/comercio',
  'lib/comercios',
  'lib/portal',
  'lib/prospectos',
];
const ARCHIVOS_SUELTOS = ['app/page.tsx'];

const RAIZ = join(__dirname, '..');

function archivosDe(rutaRelativa: string): string[] {
  const ruta = join(RAIZ, rutaRelativa);
  let entradas: string[];
  try {
    entradas = readdirSync(ruta);
  } catch {
    return []; // La carpeta puede no existir todavía; no es motivo para romper la prueba.
  }
  const encontrados: string[] = [];
  for (const entrada of entradas) {
    const completa = join(ruta, entrada);
    if (statSync(completa).isDirectory()) {
      encontrados.push(...archivosDe(join(rutaRelativa, entrada)));
    } else if (/\.tsx?$/.test(entrada) && !/\.test\.tsx?$/.test(entrada)) {
      encontrados.push(completa);
    }
  }
  return encontrados;
}

// Quita comentarios de línea y de bloque: hablan del ROL de FM como operador y son correctos.
// Lo que buscamos es "FM" en texto que se renderiza.
function sinComentarios(contenido: string): string {
  return contenido
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((linea) => !/^\s*(\/\/|\*)/.test(linea))
    .map((linea) => linea.replace(/\/\/.*$/, ''))
    .join('\n');
}

describe('el rebranding a Cardly SV no dejó "FM" a la vista', () => {
  it('ninguna pantalla que ve un comercio o un cliente menciona FM', () => {
    const archivos = [
      ...CARPETAS_VISIBLES.flatMap(archivosDe),
      ...ARCHIVOS_SUELTOS.map((f) => join(RAIZ, f)),
    ];
    // Si esto diera 0, la prueba pasaría sin haber mirado nada: el error más silencioso posible.
    expect(archivos.length).toBeGreaterThan(20);

    const culpables: string[] = [];
    for (const archivo of archivos) {
      const codigo = sinComentarios(readFileSync(archivo, 'utf-8'));
      // \bFM\b: la palabra suelta. No matchea `confirm`, `FormData` ni `fmAdmin`.
      for (const [i, linea] of codigo.split('\n').entries()) {
        if (/\bFM\b/.test(linea)) {
          culpables.push(`${relative(RAIZ, archivo)}:${i + 1}  ${linea.trim()}`);
        }
      }
    }

    expect(culpables, `Quedó "FM" a la vista del usuario:\n${culpables.join('\n')}`).toEqual([]);
  });

  it('el correo de soporte que se muestra es el del dominio propio', () => {
    // Si alguien cambia el dominio y se olvida de acá, el dueño escribe a un buzón que no existe.
    expect(MARCA.correoSoporte).toBe('soporte@cardly-sv.site');
    expect(MARCA.correoSoporte.endsWith('@cardly-sv.site')).toBe(true);
  });

  it('el sitio lleva www: sin él, el dominio raíz redirige y rompe el registro de passes', () => {
    expect(MARCA.sitio.startsWith('www.')).toBe(true);
  });
});

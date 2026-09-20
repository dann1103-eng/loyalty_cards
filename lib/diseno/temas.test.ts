import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { TEMAS, type Tema } from '../tema';
import { componer, parsearColor, razon, type Rgba } from './contraste';
import { mapaDeTema, regla, reglas, resolver } from './tokensCss';

// Contraste de los tres temas de app/globals.css, con la fórmula WCAG 2.x.
//
// Existe porque el rediseño neumórfico (docs/superpowers/specs/2026-09-20-rediseno-neumorfico-
// design.md) tiene un riesgo principal: comerse el contraste. Y porque antes de esta prueba las
// razones vivían en comentarios calculados a mano: uno estaba mal, y el botón "Acreditar" del
// escáner llegó a producción a 2.31:1 sin que nada lo notara.
//
// MUTATION-TESTING: la tabla completa (qué romper y con qué mensaje falla) está en la spec, sección
// "Mutation-testing". Cada fila se corrió: romper, ver fallar con ESE mensaje, restaurar.

const css = readFileSync(fileURLToPath(new URL('../../app/globals.css', import.meta.url)), 'utf8');

type Par = { frente: string; fondo: string[]; minimo: number; texto: boolean; uso: string };

// Pares de tokens: el frente sobre una pila de fondo escrita de arriba hacia abajo.
const PARES: Par[] = [
  { frente: '--texto', fondo: ['--fondo'], minimo: 7, texto: true, uso: 'todo el texto principal' },
  { frente: '--texto-2', fondo: ['--fondo'], minimo: 4.5, texto: true, uso: 'rótulos y subtítulos de fila' },
  { frente: '--texto-2', fondo: ['--superficie-3'], minimo: 4.5, texto: true, uso: 'la fila activa' },
  {
    frente: '--texto-3',
    fondo: ['--fondo'],
    minimo: 4.5,
    texto: true,
    uso: 'notas, código bajo el QR, etiquetas de la barra',
  },
  { frente: '--acento', fondo: ['--fondo'], minimo: 4.5, texto: true, uso: 'kickers, títulos de sección, links' },
  { frente: '--sobre-acento', fondo: ['--acento'], minimo: 4.5, texto: true, uso: 'barra y chip activos' },
  {
    frente: '--sobre-acento',
    fondo: ['--acento-fuerte'],
    minimo: 4.5,
    texto: true,
    uso: 'botón Acreditar, círculo de Escanear',
  },
  { frente: '--sobre-menta', fondo: ['--menta'], minimo: 4.5, texto: true, uso: 'el check' },
  {
    frente: '--btn-primario-texto',
    fondo: ['--btn-primario-fondo'],
    minimo: 7,
    texto: true,
    uso: 'el botón más tocado de la app',
  },
  { frente: '--menta', fondo: ['--fondo'], minimo: 4.5, texto: true, uso: 'mensajes de éxito' },
  { frente: '--error', fondo: ['--fondo'], minimo: 4.5, texto: true, uso: 'avisos de campo' },
  // Los tintes translúcidos se apoyan en la SUPERFICIE QUE LOS CONTIENE, no en la página: ninguna
  // .pastilla declara fondo propio y todas viven dentro de una .admin-fila (--superficie-2) o de un
  // .panel (--superficie-1). Medirlas sobre --fondo mide una pila que en pantalla no existe, y da
  // más contraste del real: en alto contraste, la pastilla inactiva daba 7.52 sobre --fondo y 6.78
  // sobre la fila. Es el mismo error que medir la tarjeta en vez del QR.
  {
    frente: '--menta',
    fondo: ['--menta-suave', '--superficie-2'],
    minimo: 4.5,
    texto: true,
    uso: 'pastilla activa, sobre la fila que la contiene',
  },
  {
    frente: '--error',
    fondo: ['--error-suave', '--superficie-2'],
    minimo: 4.5,
    texto: true,
    uso: 'pastilla inactiva, sobre la fila que la contiene',
  },
  { frente: '--texto', fondo: ['--error-fondo', '--superficie-1'], minimo: 7, texto: true, uso: 'alerta, dentro del panel' },
  {
    frente: '--acento',
    fondo: ['--acento-suave', '--superficie-2'],
    minimo: 3,
    texto: false,
    uso: 'glifo de ícono, sobre la fila que lo contiene (WCAG 1.4.11)',
  },
];

// Solo alto contraste: sin sombras, el borde es la única separación que queda.
const PARES_ALTO_CONTRASTE: Par[] = [
  { frente: '--linea', fondo: ['--fondo'], minimo: 3, texto: false, uso: 'bordes: la única separación bajo el sol' },
];

// Pares por regla: el color y el fondo se leen DE LA REGLA CSS, para medir lo que ve el usuario y no
// un token intermediario. Al migrar una familia, su selector se actualiza en el mismo commit.
type ParRegla = { color: string; fondo: string; minimo: number; texto: boolean; uso: string };

const PARES_REGLA: ParRegla[] = [
  { color: '.field input', fondo: '.field input', minimo: 7, texto: true, uso: 'lo que se escribe en un campo' },
  { color: '.field input::placeholder', fondo: '.field input', minimo: 4.5, texto: true, uso: 'el ejemplo del campo' },
  { color: '.btn-primary', fondo: '.btn-primary', minimo: 7, texto: true, uso: 'botón primario' },
  { color: '.btn-acento', fondo: '.btn-acento', minimo: 4.5, texto: true, uso: 'Acreditar, Publicar cambios' },
  { color: '.nav-inferior a', fondo: '.nav-inferior', minimo: 4.5, texto: true, uso: 'destinos de la barra' },
  {
    color: '.nav-inferior a.activo:not(.nav-destacado)',
    fondo: '.nav-inferior a.activo:not(.nav-destacado)',
    minimo: 4.5,
    texto: true,
    uso: 'destino activo de la barra',
  },
  { color: '.nav-destacado .icono', fondo: '.nav-destacado .icono', minimo: 3, texto: false, uso: 'círculo de Escanear' },
  { color: '.filtro-chip', fondo: '.filtro-chip', minimo: 4.5, texto: true, uso: 'filtro inactivo' },
  { color: '.filtro-chip.activo', fondo: '.filtro-chip.activo', minimo: 4.5, texto: true, uso: 'filtro activo' },
  { color: '.pastilla-activo', fondo: '.pastilla-activo', minimo: 4.5, texto: true, uso: 'pastilla activa' },
  { color: '.pastilla-inactivo', fondo: '.pastilla-inactivo', minimo: 4.5, texto: true, uso: 'pastilla inactiva' },
  { color: '.alerta', fondo: '.alerta', minimo: 7, texto: true, uso: 'alerta' },
  { color: '.metric-carta.naranja', fondo: '.metric-carta.naranja', minimo: 4.5, texto: true, uso: 'métrica' },
  { color: '.metric-carta.menta', fondo: '.metric-carta.menta', minimo: 4.5, texto: true, uso: 'métrica' },
];

// Alto contraste existe para atender bajo el sol: todo texto sube a 7:1 (AAA).
function minimoDe(tema: Tema, minimo: number, texto: boolean): number {
  return tema === 'alto-contraste' && texto ? Math.max(minimo, 7) : minimo;
}

function colorDeToken(mapa: Map<string, string>, token: string): Rgba {
  return parsearColor(resolver(token, mapa));
}

// El frente compuesto sobre una pila de fondo. Si la última capa no es opaca, se apoya sobre
// --fondo — lo que queda debajo de todo es la página — y la etiqueta lo dice.
function medir(mapa: Map<string, string>, frente: string, capas: string[]): { razon: number; fondo: string } {
  const color = (c: string) => (c === 'transparent' ? parsearColor(c) : colorDeToken(mapa, c));
  const pila = [...capas];
  const colores = pila.map(color);
  if (colores[colores.length - 1].a !== 1) {
    pila.push('--fondo');
    colores.push(colorDeToken(mapa, '--fondo'));
  }
  const fondo = componer(colores);
  return { razon: razon(componer([color(frente), fondo]), fondo), fondo: pila.join('∘') };
}

// El token con que una regla pinta una propiedad. Tiene que ser un var() solo o transparent: un
// literal en una regla es un color que ningún tema controla, y justo lo que esta prueba no puede
// medir en los tres temas.
// Una referencia a un token. El charset legal de una custom property incluye mayúsculas y guion
// bajo, y puede haber espacios adentro del var(): con una regex más estrecha, `var( --x )` se
// saltea EN SILENCIO — que es justo lo que estas pruebas existen para no hacer.
const REFERENCIA = /var\(\s*(--[\w-]+)\s*\)/g;

function tokenDeRegla(selector: string, propiedades: string[]): string {
  const declaraciones = regla(css, selector);
  const declaradas = propiedades.filter((p) => declaraciones.has(p));
  // `background` y `background-color` en la misma regla: gana la última del archivo, y este Map ya
  // perdió ese orden. Antes que adivinar mal y medir un color que no se pinta, lo decimos.
  if (declaradas.length > 1) {
    throw new Error(`la regla ${selector} declara ${declaradas.join(' y ')}: no se sabe cuál gana`);
  }
  const propiedad = declaradas[0];
  if (propiedad === undefined) throw new Error(`la regla ${selector} no pinta ${propiedades.join(' ni ')}`);
  const valor = declaraciones.get(propiedad) ?? '';
  if (valor === 'transparent') return valor;
  const token = new RegExp(`^${REFERENCIA.source}$`).exec(valor);
  if (!token) throw new Error(`la regla ${selector} pinta ${propiedad} con ${valor}, no con un token`);
  return token[1];
}

describe.each(TEMAS)('tema %s', (tema) => {
  it('pares de tokens', () => {
    const mapa = mapaDeTema(css, tema);
    const pares = tema === 'alto-contraste' ? [...PARES, ...PARES_ALTO_CONTRASTE] : PARES;
    const fallas: string[] = [];
    for (const par of pares) {
      const minimo = minimoDe(tema, par.minimo, par.texto);
      const { razon: r, fondo } = medir(mapa, par.frente, par.fondo);
      if (r < minimo) fallas.push(`[tema ${tema}] ${par.frente} sobre ${fondo}: ${r.toFixed(2)}:1 < ${minimo} (${par.uso})`);
    }
    expect(fallas).toEqual([]);
  });

  it('pares por regla: lo que ve el usuario, leído de la regla CSS real', () => {
    const mapa = mapaDeTema(css, tema);
    const fallas: string[] = [];
    for (const par of PARES_REGLA) {
      // Cada par en su propio try: si un selector desaparece (y las tareas del rediseño renombran
      // familias enteras), el throw cortaría el bucle y se comería las fallas de contraste ya
      // acumuladas, obligando a arreglar de a una por corrida.
      try {
        const minimo = minimoDe(tema, par.minimo, par.texto);
        const frente = tokenDeRegla(par.color, ['color']);
        const { razon: r, fondo } = medir(mapa, frente, [tokenDeRegla(par.fondo, ['background', 'background-color'])]);
        if (r < minimo) {
          fallas.push(`[tema ${tema}] regla ${par.color}: ${frente} sobre ${fondo}: ${r.toFixed(2)}:1 < ${minimo} (${par.uso})`);
        }
      } catch (error) {
        fallas.push(`[tema ${tema}] regla ${par.color}: ${(error as Error).message}`);
      }
    }
    expect(fallas).toEqual([]);
  });
});

describe('composición de sombras', () => {
  it('ninguna box-shadow mete en una lista un token que vale none en algún tema', () => {
    // `none, 0 0 0 3px x` es una declaración inválida: se cae la sombra ENTERA, y en alto contraste
    // (donde valen none) el estado desaparece justo en el tema que más lo necesita.
    const nulos = new Map<string, Tema>();
    for (const tema of TEMAS) {
      const mapa = mapaDeTema(css, tema);
      for (const token of mapa.keys()) {
        if (!nulos.has(token) && resolver(token, mapa) === 'none') nulos.set(token, tema);
      }
    }
    expect(nulos.size, 'ningún token vale none: esta prueba no estaría midiendo nada').toBeGreaterThan(0);

    // Compone si la declaración es algo MÁS que ese var() solo. Se comparan sin espacios porque
    // `var( --x )` es la misma referencia que `var(--x)`.
    const componeAlgoMas = (valor: string, token: string) => valor.replace(/\s+/g, '') !== `var(${token})`;

    const fallas: string[] = [];
    for (const r of reglas(css)) {
      const sombra = r.declaraciones.get('box-shadow');
      if (sombra === undefined) continue;
      for (const [, token] of sombra.matchAll(REFERENCIA)) {
        const tema = nulos.get(token);
        if (tema && componeAlgoMas(sombra, token)) {
          fallas.push(`[composición] ${r.selectores.join(', ')} compone var(${token}), que vale none en ${tema}`);
        }
      }
    }

    // Y los TOKENS que componen otros tokens. `--x: 0 0 0 3px var(--a), var(--shadow-2)` no es una
    // box-shadow de ninguna regla, así que el bucle de arriba no lo ve — pero el día que alguien
    // escriba `box-shadow: var(--x)` se cae igual. El rediseño introduce tokens de esta forma.
    for (const tema of TEMAS) {
      const mapa = mapaDeTema(css, tema);
      for (const [nombre, valor] of mapa) {
        for (const [, token] of valor.matchAll(REFERENCIA)) {
          const nulo = nulos.get(token);
          if (nulo && componeAlgoMas(valor, token)) {
            fallas.push(`[composición] el token ${nombre} compone var(${token}), que vale none en ${nulo}`);
          }
        }
      }
    }
    expect(fallas).toEqual([]);
  });
});

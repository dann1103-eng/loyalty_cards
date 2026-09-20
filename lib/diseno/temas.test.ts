import { existsSync, readFileSync } from 'node:fs';
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
  { frente: '--borde-relieve', fondo: ['--fondo'], minimo: 3, texto: false, uso: 'el borde de toda superficie con relieve' },
];

// Pares por regla: el color y el fondo se leen DE LA REGLA CSS, para medir lo que ve el usuario y no
// un token intermediario. Al migrar una familia, su selector se actualiza en el mismo commit.
// `contenedor` es la superficie sobre la que se apoya la regla cuando su propio fondo es
// translúcido. Sin él, la pila cae en --fondo (la página) y mide algo que no está en pantalla: la
// pastilla vive dentro de una fila y la alerta dentro de un panel.
type ParRegla = {
  color: string;
  fondo: string;
  minimo: number;
  texto: boolean;
  uso: string;
  contenedor?: string;
};

const PARES_REGLA: ParRegla[] = [
  {
    color: '.field :is(input, select, textarea):not([type="checkbox"], [type="radio"], [type="range"], [type="file"], [type="color"])',
    fondo: '.field :is(input, select, textarea):not([type="checkbox"], [type="radio"], [type="range"], [type="file"], [type="color"])',
    minimo: 7,
    texto: true,
    uso: 'lo que se escribe en un campo',
  },
  {
    color: '.field :is(input, textarea)::placeholder',
    fondo: '.field :is(input, select, textarea):not([type="checkbox"], [type="radio"], [type="range"], [type="file"], [type="color"])',
    minimo: 4.5,
    texto: true,
    uso: 'el ejemplo del campo',
  },
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
  {
    color: '.pastilla-activo',
    fondo: '.pastilla-activo',
    contenedor: '--superficie-2',
    minimo: 4.5,
    texto: true,
    uso: 'pastilla activa, dentro de una fila',
  },
  {
    color: '.pastilla-inactivo',
    fondo: '.pastilla-inactivo',
    contenedor: '--superficie-2',
    minimo: 4.5,
    texto: true,
    uso: 'pastilla inactiva, dentro de una fila',
  },
  { color: '.alerta', fondo: '.alerta', contenedor: '--superficie-1', minimo: 7, texto: true, uso: 'alerta, dentro del panel' },
  // Las filas de una hoja (menú de opciones, selector de contexto, selector de tema). Se miden POR
  // REGLA y no con pares de tokens: estos pares vivían como tokens (el acento sobre --superficie-3 y
  // -4) y quedaron decorativos cuando la fila activa pasó al pozo (--superficie-0): medían superficies
  // donde el tick ya no estaba, y las pruebas seguían verdes con el tick a 1:1.
  { color: '.sheet-fila', fondo: '.sheet-fila-activa', minimo: 4.5, texto: true, uso: 'texto de la fila activa de una hoja' },
  { color: '.menu-tick', fondo: '.sheet-fila-activa', minimo: 3, texto: false, uso: 'tick de la fila activa (glifo)' },
  {
    color: '.sheet-fila',
    fondo: '.sheet-fila:not(.sheet-fila-activa):hover:not(:disabled)',
    minimo: 4.5,
    texto: true,
    uso: 'fila de una hoja con el mouse encima',
  },
  // Las cinco métricas de la app llevan .naranja o .menta: medir la regla base (.metric-carta,
  // neutra) mediría un color que nunca se ve. Por variante y no por la regla base, y por elemento
  // coloreado, sobre el fondo real que las contiene: .metric-carta. Mínimo 4.5 también para
  // .metric-valor: el número es texto grande, pero adentro lleva la unidad ("con 8 sellos"), que es
  // 0.95rem en negrita y NO cuenta como texto grande para WCAG. .metric-sub no lleva color de
  // variante: se mide en la regla base, que es la que se ve.
  {
    color: '.metric-carta.naranja .metric-valor',
    fondo: '.metric-carta',
    minimo: 4.5,
    texto: true,
    uso: 'valor de métrica naranja',
  },
  { color: '.metric-sub', fondo: '.metric-carta', minimo: 4.5, texto: true, uso: 'subtítulo de una métrica' },
  {
    color: '.metric-carta.menta .metric-valor',
    fondo: '.metric-carta',
    minimo: 4.5,
    texto: true,
    uso: 'valor de métrica menta',
  },
  {
    color: '.metric-carta.naranja .metric-etiqueta',
    fondo: '.metric-carta',
    minimo: 4.5,
    texto: true,
    uso: 'etiqueta de métrica naranja',
  },
  {
    color: '.metric-carta.menta .metric-etiqueta',
    fondo: '.metric-carta',
    minimo: 4.5,
    texto: true,
    uso: 'etiqueta de métrica menta',
  },
  { color: '.campo-suelto', fondo: '.campo-suelto', minimo: 7, texto: true, uso: 'lo que se escribe en un campo suelto' },
  {
    color: '.campo-suelto::placeholder',
    fondo: '.campo-suelto',
    minimo: 4.5,
    texto: true,
    uso: 'el ejemplo del campo suelto',
  },
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
        const capas = [tokenDeRegla(par.fondo, ['background', 'background-color'])];
        if (par.contenedor) capas.push(par.contenedor);
        const { razon: r, fondo } = medir(mapa, frente, capas);
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

const RELIEVES = ['--relieve-1', '--relieve-2', '--relieve-3', '--hundido-1', '--hundido-2'];
const CON_RELIEVE = TEMAS.filter((t) => t !== 'alto-contraste');

describe('relieve', () => {
  it('alto contraste es plano a propósito; claro y oscuro no', () => {
    const fallas: string[] = [];
    const alto = mapaDeTema(css, 'alto-contraste');
    for (const token of RELIEVES) {
      const valor = resolver(token, alto);
      if (valor !== 'none') fallas.push(`[alto-contraste] ${token} debe ser none (tema plano a propósito) y vale "${valor}"`);
    }
    for (const token of ['--luz', '--sombra-relieve']) {
      const valor = resolver(token, alto);
      if (valor !== 'transparent') fallas.push(`[alto-contraste] ${token} debe ser transparent y vale "${valor}"`);
    }
    for (const tema of CON_RELIEVE) {
      const mapa = mapaDeTema(css, tema);
      for (const token of RELIEVES) {
        if (resolver(token, mapa) === 'none') fallas.push(`[tema ${tema}] ${token} vale none: sin relieve no hay neumorfismo`);
      }
    }
    expect(fallas).toEqual([]);
  });

  it('piso de relieve: la luz y la sombra se tienen que ver contra el fondo', () => {
    const fallas: string[] = [];
    for (const tema of CON_RELIEVE) {
      const mapa = mapaDeTema(css, tema);
      for (const token of ['--luz', '--sombra-relieve']) {
        const { razon: r, fondo } = medir(mapa, token, ['--fondo']);
        if (r < 1.12) fallas.push(`[tema ${tema}] piso de relieve: ${token}∘${fondo} ${r.toFixed(2)}:1 < 1.12`);
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

describe('el tablero de revisión', () => {
  it('su copia del CSS está sincronizada con app/globals.css', () => {
    // public/tablero-neumorfico/propuesta.css es una copia byte a byte del sistema, servida como
    // página suelta para revisar el rediseño. Un espejo que nada obliga a sincronizar vuelve
    // DECORATIVA la revisión que cuelga de él: se aprueba un diseño distinto del que se publica.
    // Es el mismo modo de falla que el fixture que copiaba la config del comercio al programa.
    // El tablero se borra antes de integrar a master; cuando no exista, no hay nada que comparar.
    const copia = fileURLToPath(new URL('../../public/tablero-neumorfico/propuesta.css', import.meta.url));
    if (!existsSync(copia)) return;
    const sinFinDeLinea = (texto: string) => texto.replace(/\r\n/g, '\n');
    expect(sinFinDeLinea(readFileSync(copia, 'utf8'))).toBe(sinFinDeLinea(css));
  });
});

describe('foco', () => {
  it('el foco se dibuja con outline, y ninguna regla de :focus vuelve a pintar un anillo con box-shadow', () => {
    // Antes el foco era `box-shadow: var(--ring)`. En un campo hundido eso REEMPLAZA al hundido (el
    // pozo se aplana al enfocarlo), y en forced-colors el box-shadow desaparece. La regla global con
    // outline es la red: sin esta prueba se la podía borrar entera y las demás seguían verdes.
    const todas = reglas(css);
    const global = todas.find(
      (r) => !r.dentroDeArroba && r.selectores.some((s) => s.startsWith(':where(') && s.endsWith(':focus-visible')),
    );
    expect(global, 'falta la regla global :where(…):focus-visible').toBeDefined();
    expect(global?.declaraciones.get('outline')).toBe('2px solid var(--acento)');

    // Un :focus PUEDE declarar box-shadow si conserva el relieve del elemento, pero no un ANILLO: ni
    // el token --ring ni una sombra de expansión `0 0 0 Npx`.
    const fallas = todas
      .filter((r) => r.selectores.some((s) => s.includes(':focus')))
      .flatMap((r) => {
        const sombra = r.declaraciones.get('box-shadow');
        if (sombra === undefined) return [];
        return /var\(\s*--ring\s*\)|\b0 0 0 \d/.test(sombra)
          ? [`${r.selectores.join(', ')} dibuja el foco con un anillo de box-shadow: ${sombra}`]
          : [];
      });
    expect(fallas).toEqual([]);
  });
});

describe('estados que se marcan con outline', () => {
  it('cada uno tiene su regla :focus-visible, o el foco queda indistinguible del estado', () => {
    // La regla global de foco (:where(…):focus-visible) tiene especificidad (0,1,0) y EMPATA con una
    // clase de estado como .sheet-fila-activa, que declara su propio outline después y le gana. Sin
    // una regla :focus-visible propia, la fila activa enfocada se ve igual que sin foco. Se probó
    // borrando la de .portal-cuenta-activa: las demás pruebas seguían verdes.
    // Excepción explícita: .opcion-plan-activa es un <label>, y el foco cae en su <input> radio,
    // que dibuja su propio outline.
    const SIN_FOCO_PROPIO = new Set(['.opcion-plan-activa']);
    const todas = reglas(css).filter((r) => !r.dentroDeArroba);
    const fallas: string[] = [];
    for (const r of todas) {
      if (!r.declaraciones.has('outline')) continue;
      for (const selector of r.selectores) {
        // Solo clases de estado: un selector con pseudo-clase (:hover, :focus…) no es un estado.
        if (selector.includes(':') || SIN_FOCO_PROPIO.has(selector)) continue;
        const guarda = todas.some((g) => g.selectores.includes(`${selector}:focus-visible`));
        if (!guarda) fallas.push(`${selector} marca su estado con outline y no tiene regla ${selector}:focus-visible`);
      }
    }
    expect(fallas).toEqual([]);
  });
});

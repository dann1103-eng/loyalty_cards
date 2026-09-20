# Rediseño neumórfico de la app — plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usá superpowers:subagent-driven-development (recomendado)
> o superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan casillas
> (`- [ ]`) para el seguimiento.

**Objetivo:** pasar las 34 pantallas de la app a un sistema neumórfico con el tema claro por
defecto, y agregar la prueba de contraste WCAG que hoy no existe.

**Arquitectura:** todo el estilo de la app vive en `app/globals.css` (CSS puro con variables, tres
temas). Se reescriben sus tokens y unas 25 familias de clases, más seis archivos TSX con estilos
inline. Una prueba nueva (`lib/diseno/`) lee ese CSS, resuelve los tokens de cada tema y mide
contraste con la fórmula WCAG 2.x. Un tablero HTML en `public/` muestra todos los componentes en los
tres temas, antes y después, para la revisión de Daniel.

**Tecnología:** Next.js 16 (App Router), CSS puro con custom properties, Vitest 4, TypeScript
estricto.

**Spec:** `docs/superpowers/specs/2026-09-20-rediseno-neumorfico-design.md`. **Leela antes de
cualquier tarea.** Este plan dice QUÉ hacer y en qué orden; la spec dice POR QUÉ y tiene la tabla de
migración por familia (sección "Migración por familia de clases") que las Tareas 7 a 9 aplican fila
por fila.

---

## Antes de empezar (todas las tareas)

**Dónde se trabaja.** En el worktree
`C:\Users\Daniel\Desktop\Proyectos\Loyalty Cards\.claude\worktrees\focused-aryabhata-28e859`, rama
`claude/app-neumorphism-redesign-f8c05a`. Verificalo con
`cd "C:\Users\Daniel\Desktop\Proyectos\Loyalty Cards\.claude\worktrees\focused-aryabhata-28e859" && git branch --show-current`
antes de tocar nada. Rutas absolutas siempre (Read/Write/Edit), y `cd` a ese directorio en cada
comando de shell.

**Cómo correr las pruebas.** Las de diseño son puras (no tocan Supabase):

```bash
npx vitest run lib/diseno lib/tema.test.ts
```

Eso necesita `.env.local`, porque `vitest.setup.ts` lanza si falta. **El worktree no lo tiene y
nadie lo copia salvo Daniel.** Mientras no esté, el controlador te pasa la ruta de una config
temporal sin `setupFiles` (vive fuera del repo); se usa así:

```bash
npx vitest run --config "<ruta que te pasa el controlador>/vitest.diseno.config.mjs"
```

Esa config corre `lib/diseno/**/*.test.ts` y `lib/tema.test.ts`. No la copies al repo.

**Mutation-testing es obligatorio.** Cada tarea lista sus mutaciones: romper la línea, correr,
confirmar que falla **con ese mensaje**, restaurar, confirmar verde. Reportá cada una con el mensaje
real que viste. Una prueba verde que sigue verde con la lógica rota es decoración.

**Commits.** Identidad `Daniel <268727888+dann1103-eng@users.noreply.github.com>` (ya está en la
config del repo). Mensaje con `-m` plano, sin here-strings, y el trailer
`-m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"`. **Nunca `git push`.**

**No inicies el dev server** (deja el puerto 3000 tomado). La verificación en el navegador la hace
el controlador.

**Qué se puede verificar hoy en el navegador, y qué no.** Comprobado el 2026-09-20 en este worktree:
el dev server arranca sin `.env.local` y sirve el `public/` **del worktree** (se verificó con un
archivo marcador), pero **ninguna pantalla de la app renderiza**: el proxy de Next
(`proxy.ts` → `lib/supabase/proxy.ts:13`) lanza `Falta la variable de entorno
NEXT_PUBLIC_SUPABASE_URL` en toda ruta. Por eso el tablero es el único vehículo de verificación
visual hasta que Daniel copie `.env.local`, y por eso su marcado se copia de los TSX reales en vez
de inventarse. El recorrido de las pantallas reales y de `/` queda como pendiente de Daniel, anotado
en la Tarea 10.

**Reglas de redacción del CSS** (las exige el parser): tokens con exactamente dos espacios de
indentación; nada de `var(--x, respaldo)` en los bloques de tema.

---

## Mapa de archivos

| Archivo | Tarea | Responsabilidad |
|---|---|---|
| `lib/diseno/contraste.ts` (nuevo) | 1 | Parseo de color, composición de alpha, luminancia y razón WCAG. Puro. |
| `lib/diseno/contraste.test.ts` (nuevo) | 1 | Valores de referencia de la fórmula. |
| `lib/diseno/tokensCss.ts` (nuevo) | 2 | El único parser de `globals.css`: reglas, bloques de tema, cascada de tokens, `var()`. |
| `lib/diseno/tokensCss.test.ts` (nuevo) | 2 | Con una fixture chica: comentarios, `@media`, paréntesis, ciclos, indentación. |
| `lib/tema.test.ts` | 3, 6 | Pasa a usar el parser nuevo; `color-scheme` contra un mapa fuente de verdad. |
| `lib/diseno/temas.test.ts` (nuevo) | 4, 6, 7, 9 | Contraste de los tres temas: pares de tokens, pares por regla, composición, relieve. |
| `app/globals.css` | 4, 6, 7, 8, 9 | Tokens y clases. |
| `public/tablero-neumorfico/*` (nuevo) | 5, y se sincroniza en 6-9 | Herramienta de revisión de Daniel. Se borra antes de integrar a `master`. |
| `lib/tema.ts` | 6 | Default `claro` y etiquetas. |
| `app/manifest.ts`, `app/mi-tarjeta/layout.tsx` | 6 | Color del PWA y barra de estado. |
| `FormularioReverso.tsx` | 7 | Quitar el parche inline del textarea. |
| `SelectorTema.tsx`, `MenuOpciones.tsx`, `SelectorContexto.tsx`, `ModalAgregarLocal.tsx` | 8 | Solo comentarios. |
| `reportes/page.tsx`, `Escaner.tsx`, `FormularioAccesoDueno.tsx`, `FormularioConfiguracionPrograma.tsx`, `FormularioRegistro.tsx` | 9 | Estilos inline → clases nuevas. |
| `DESIGN.md`, `PRODUCT.md`, `docs/superpowers/ESTADO-Y-PLAN-2026-07-28.md` | 10 | Documentación. |

---

### Tarea 1: el módulo de contraste

**Archivos:**
- Crear: `lib/diseno/contraste.ts`
- Crear: `lib/diseno/contraste.test.ts`

- [ ] **Paso 1: escribir la prueba**

`lib/diseno/contraste.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { componer, luminancia, parsearColor, razon } from './contraste';

// MUTATION-TESTING: lo que protege este archivo es la MATEMÁTICA de la prueba de contraste de
// app/globals.css — si la fórmula está mal, esa prueba certifica contrastes que la pantalla no
// muestra. Mutaciones que deben fallar:
// (1) permutar los coeficientes .2126/.7152/.0722 → un gris no lo nota (r = g = b), por eso están
//     el azul, el rojo y el verde puros;
// (2) cambiar el exponente 2.4 → cambian #777 y #767676;
// (3) sacar el +0.05 → negro contra blanco deja de dar 21;
// (4) componer de arriba hacia abajo en vez de abajo hacia arriba → la pila de tres capas;
// (5) redondear a 8 bits dentro de componer → 127.5 pasa a 128 y el gris da 3.95, no 3.98;
// (6) que parsearColor devuelva algo para un formato que no conoce → oklch, hsl, nombres;
// (7) permutar los canales del hex CORTO → lo atrapa `#f0a`, que no es gris (los grises `#fff`,
//     `#000` y `#777` no notan ninguna permutación, por eso hace falta uno de color);
// (8) sacar la guarda de alpha fuera de rango, o la de canal fuera de rango de luminancia → las
//     atrapan `rgba(0, 0, 0, 5)` y el color armado a mano.
// Mutante equivalente, no vale la pena: 0.04045 → 0.03928. No altera ningún valor de 8 bits, y con
// un canal compuesto entre los dos umbrales mueve la razón en la sexta cifra decimal.

describe('parsearColor', () => {
  it('lee hex corto, hex largo, rgb, rgba y transparent', () => {
    expect(parsearColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    // De color a propósito: un hex corto gris no delata una permutación de canales.
    expect(parsearColor('#f0a')).toEqual({ r: 255, g: 0, b: 170, a: 1 });
    expect(parsearColor('#181849')).toEqual({ r: 24, g: 24, b: 73, a: 1 });
    expect(parsearColor('  #E7E6F0 ')).toEqual({ r: 231, g: 230, b: 240, a: 1 });
    expect(parsearColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parsearColor('rgba(24, 24, 73, 0.2)')).toEqual({ r: 24, g: 24, b: 73, a: 0.2 });
    expect(parsearColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('lanza ante un formato que no sabe leer, en vez de aproximarlo', () => {
    const noSoportados = [
      'oklch(45% 0.13 280)',
      'hsl(0 0% 50%)',
      'currentColor',
      'red',
      'var(--fondo)',
      'rgb(1 2 3)',
      'rgba(1.2.3, 0, 0)',
    ];
    for (const valor of noSoportados) {
      expect(() => parsearColor(valor)).toThrow(`formato de color no soportado: ${valor}`);
    }
    expect(() => parsearColor('rgba(300, 0, 0, 1)')).toThrow('color fuera de rango: rgba(300, 0, 0, 1)');
    expect(() => parsearColor('rgba(0, 0, 0, 5)')).toThrow('color fuera de rango: rgba(0, 0, 0, 5)');
  });
});

describe('componer', () => {
  it('mezcla el alpha sobre el fondo, sin redondear a 8 bits', () => {
    expect(componer([parsearColor('rgba(0, 0, 0, 0.5)'), parsearColor('#ffffff')])).toEqual({
      r: 127.5,
      g: 127.5,
      b: 127.5,
      a: 1,
    });
  });

  it('apila de abajo hacia arriba: la primera capa es la de encima', () => {
    // Negro al 50% sobre rojo = (127.5, 0, 0); blanco al 50% encima de eso = (191.25, 127.5, 127.5).
    // Al revés (de arriba hacia abajo) daría (127.5, 63.75, 63.75).
    const capas = [
      parsearColor('rgba(255, 255, 255, 0.5)'),
      parsearColor('rgba(0, 0, 0, 0.5)'),
      parsearColor('#ff0000'),
    ];
    expect(componer(capas)).toEqual({ r: 191.25, g: 127.5, b: 127.5, a: 1 });
  });

  it('lanza si la pila no termina en un color opaco', () => {
    expect(() => componer([parsearColor('rgba(0, 0, 0, 0.5)')])).toThrow(
      'la pila de fondo no termina en un color opaco',
    );
    expect(() => componer([])).toThrow('la pila de fondo no termina en un color opaco');
  });
});

describe('razon (WCAG 2.x)', () => {
  it('da los valores de referencia de los grises', () => {
    expect(razon(parsearColor('#000'), parsearColor('#fff'))).toBe(21);
    expect(razon(parsearColor('#777'), parsearColor('#fff'))).toBeCloseTo(4.48, 2);
    expect(razon(parsearColor('#767676'), parsearColor('#fff'))).toBeCloseTo(4.54, 2);
    const gris = componer([parsearColor('rgba(0, 0, 0, 0.5)'), parsearColor('#fff')]);
    expect(razon(gris, parsearColor('#fff'))).toBeCloseTo(3.98, 2);
  });

  it('pesa cada canal con su coeficiente (un gris no lo notaría)', () => {
    expect(razon(parsearColor('#0000ff'), parsearColor('#fff'))).toBeCloseTo(8.59, 2);
    expect(razon(parsearColor('#ff0000'), parsearColor('#fff'))).toBeCloseTo(4.0, 2);
    expect(razon(parsearColor('#00ff00'), parsearColor('#000'))).toBeCloseTo(15.3, 2);
  });

  it('es simétrica', () => {
    const a = parsearColor('#514ba8');
    const b = parsearColor('#e7e6f0');
    expect(razon(a, b)).toBe(razon(b, a));
  });

  it('la luminancia exige un color opaco', () => {
    expect(() => luminancia(parsearColor('rgba(0, 0, 0, 0.5)'))).toThrow(
      'la luminancia solo existe para un color opaco',
    );
  });

  it('la luminancia rechaza un canal fuera de rango, aunque el color no venga de parsearColor', () => {
    // Rgba es un tipo exportado: un color armado a mano se saltea toda la validación del parseo.
    expect(() => luminancia({ r: 999, g: 0, b: 0, a: 1 })).toThrow('canal fuera de rango: 999');
    expect(() => luminancia({ r: 0, g: -50, b: 0, a: 1 })).toThrow('canal fuera de rango: -50');
  });
});
```

- [ ] **Paso 2: correr y ver que falla**

Corré las pruebas de diseño (ver "Cómo correr las pruebas"). Esperado: FALLA con
`Failed to resolve import "./contraste"` (el módulo no existe).

- [ ] **Paso 3: escribir el módulo**

`lib/diseno/contraste.ts`:

```ts
// Contraste WCAG 2.x entre los colores de los tokens de tema. Puro a propósito (sin DOM, sin I/O):
// así la prueba de app/globals.css corre en Node y mide lo mismo que va a ver el usuario.
//
// Solo entiende los formatos que usan los tokens de tema: hex y rgb()/rgba() con comas. Cualquier
// otra cosa LANZA en vez de devolver un valor aproximado — una prueba de contraste que se saltea en
// silencio el color que no sabe leer certifica justo lo que no midió.
//
// Mide el color SIN cuantizar a 8 bits, y el navegador sí cuantiza el color que compone. Se comparó
// par por par contra una versión que redondea cada paso, sobre el CSS de hoy y el del rediseño: la
// diferencia llega a 0.05 en la razón, va para los DOS lados (no es un sesgo optimista) y no cambia
// el veredicto de ningún par en los tres temas. Con los márgenes actuales — el más ajustado es
// 4.76 contra 4.5 — no compensa imitar el redondeo del compositor.

export type Rgba = { r: number; g: number; b: number; a: number };

const HEX_CORTO = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/;
const HEX_LARGO = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/;
const FUNCION_RGB = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/;

export function parsearColor(valor: string): Rgba {
  const texto = valor.trim();
  const v = texto.toLowerCase();
  if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  const corto = HEX_CORTO.exec(v);
  if (corto) {
    return {
      r: parseInt(corto[1] + corto[1], 16),
      g: parseInt(corto[2] + corto[2], 16),
      b: parseInt(corto[3] + corto[3], 16),
      a: 1,
    };
  }
  const largo = HEX_LARGO.exec(v);
  if (largo) {
    return { r: parseInt(largo[1], 16), g: parseInt(largo[2], 16), b: parseInt(largo[3], 16), a: 1 };
  }
  const rgb = FUNCION_RGB.exec(v);
  if (rgb) {
    const color = {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
      a: rgb[4] === undefined ? 1 : Number(rgb[4]),
    };
    if ([color.r, color.g, color.b, color.a].some(Number.isNaN)) {
      throw new Error(`formato de color no soportado: ${texto}`);
    }
    if ([color.r, color.g, color.b].some((c) => c > 255) || color.a > 1) {
      throw new Error(`color fuera de rango: ${texto}`);
    }
    return color;
  }
  throw new Error(`formato de color no soportado: ${texto}`);
}

// Capas de ARRIBA hacia ABAJO: la primera es la que se pinta encima. Se compone de abajo hacia
// arriba en sRGB 0-255, SIN redondear a 8 bits en el medio — es la convención de la spec, y las
// predicciones de su tabla de mutaciones se calcularon así.
export function componer(capas: Rgba[]): Rgba {
  const base = capas[capas.length - 1];
  if (!base || base.a !== 1) throw new Error('la pila de fondo no termina en un color opaco');
  let { r, g, b } = base;
  for (let i = capas.length - 2; i >= 0; i--) {
    const capa = capas[i];
    r = capa.r * capa.a + r * (1 - capa.a);
    g = capa.g * capa.a + g * (1 - capa.a);
    b = capa.b * capa.a + b * (1 - capa.a);
  }
  return { r, g, b, a: 1 };
}

function lineal(canal: number): number {
  const s = canal / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminancia(color: Rgba): number {
  if (color.a !== 1) throw new Error('la luminancia solo existe para un color opaco: componelo primero');
  // Rgba es un tipo exportado, así que un color armado a mano no pasó por parsearColor y puede traer
  // cualquier cosa. Sin esta guarda, un canal fuera de rango devuelve un número igual y se certifica
  // un contraste inventado, que es exactamente lo que este módulo existe para evitar.
  for (const canal of [color.r, color.g, color.b]) {
    if (canal < 0 || canal > 255) throw new Error(`canal fuera de rango: ${canal}`);
  }
  return 0.2126 * lineal(color.r) + 0.7152 * lineal(color.g) + 0.0722 * lineal(color.b);
}

export function razon(a: Rgba, b: Rgba): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
```

- [ ] **Paso 4: correr y ver que pasa**

Esperado: `lib/diseno/contraste.test.ts` en verde (9 pruebas), `lib/tema.test.ts` sigue en verde.

- [ ] **Paso 5: mutaciones**

Las seis del comentario del archivo de prueba. Para cada una: romper, correr, anotar qué prueba
falla y con qué, restaurar. Ejemplos de lo que se espera:
(1) `0.2126`↔`0.0722` → falla "pesa cada canal…" (azul da ≈4.00, no 8.59);
(4) cambiar el `for` para que recorra de `0` a `length - 2` → falla "apila de abajo hacia arriba";
(5) `Math.round` en `componer` → fallan las dos pruebas que esperan 127.5 / 3.98.

- [ ] **Paso 6: commit**

```bash
git add lib/diseno/contraste.ts lib/diseno/contraste.test.ts
git commit -m "Diseno: modulo de contraste WCAG 2.x (parseo, composicion, luminancia)" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Tarea 2: el parser del CSS

**Archivos:**
- Crear: `lib/diseno/tokensCss.ts`
- Crear: `lib/diseno/tokensCss.test.ts`

- [ ] **Paso 1: escribir la prueba**

`lib/diseno/tokensCss.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TEMAS, TEMA_POR_DEFECTO } from '../tema';
import { bloque, mapaDeTema, normalizarSelector, regla, reglas, resolver, sinComentarios } from './tokensCss';

// MUTATION-TESTING: este parser es lo único que hay entre app/globals.css y las pruebas de diseño;
// si lee mal, las pruebas miden otra cosa. Mutaciones que deben fallar:
// (1) no quitar comentarios → el `}` del comentario de la fixture cierra una llave nunca abierta;
// (2) partir los SELECTORES por coma adentro de paréntesis → se rompe `.b:is(x, y)`. Ojo: el mismo
//     guardia en el split de `;` (el de las declaraciones) es defensivo y NINGUNA prueba lo cubre,
//     porque hoy ningún valor de globals.css tiene un `;` adentro de un paréntesis;
// (3) contar como de primer nivel una regla de adentro de un @media → `.a` tomaría el `red`;
// (4) que la segunda regla `.a` no pise a la primera → background no sería transparent;
// (5) sacar el chequeo de indentación → el token con cuatro espacios pasa en silencio;
// (7) sacar cualquiera de las guardas de "lo que no sé leer, lo lanzo" (anidamiento, paréntesis sin
//     balancear, token que no abre su propia línea) → el parser lee MAL en silencio, que es peor
//     que romperse: inventa reglas, pierde declaraciones o deja un token fuera del grep de DESIGN.md;
// (8) angostar la regex de var() a `[a-z0-9-]` → `var( --b )`, `var(--Fondo)` y `var(--x_y)` se
//     devuelven crudos y el error sale después, desde el parseo de color, apuntando al lugar
//     equivocado;
// (9) que sinComentarios borre el comentario en vez de espaciarlo → las posiciones dejan de
//     corresponder al archivo y los errores mandan a una línea que no es;
// (6) que resolver no detecte ciclos → el bucle es SÍNCRONO, así que el timeout de vitest no
//     dispara nunca: `camino` crece hasta que el worker muere sin memoria (~30 s) y se cae la
//     corrida entera, no solo esta prueba. Falla igual, pero si alguien la corre en CI con un
//     límite de tiempo corto, lo va a ver como un cuelgue y no como lo que es.

// El tema que NO es el default: la fixture no puede fijar cuál es, porque el default cambia (era
// oscuro, pasa a claro) y esta prueba tiene que seguir midiendo lo mismo.
const OTRO = TEMAS.filter((t) => t !== TEMA_POR_DEFECTO)[0];

const CSS = `
/* Un comentario con } y con :root { adentro no puede cortar ni confundir el bloque. */
:root {
  --fondo: #131313;
  --blanco: #f5f5f0;
  --texto: var(--blanco); /* comentario al final de la línea */
  --sombra:
    0 0 0 1px rgba(0, 0, 0, 0.5),
    0 2px 4px var(--fondo);
}

:root[data-tema="${OTRO}"] {
  color-scheme: light;
  --fondo: #f4f1ec;
}

.a,
.b:is(x, y) {
  color: var(--texto);
  background: var(--fondo);
}

@media (min-width: 760px) {
  .a {
    color: red;
  }
}

.a {
  background: transparent;
}
`;

describe('bloque', () => {
  it('lee los tokens sin cortarse por un } ni confundirse por un :root { de un comentario', () => {
    const raiz = bloque(CSS, ':root');
    expect([...raiz.keys()]).toEqual(['--fondo', '--blanco', '--texto', '--sombra']);
    expect(raiz.get('--texto')).toBe('var(--blanco)');
    // Un valor de varias líneas queda en una sola, con los espacios normalizados.
    expect(raiz.get('--sombra')).toBe('0 0 0 1px rgba(0, 0, 0, 0.5), 0 2px 4px var(--fondo)');
  });

  it('devuelve solo tokens: color-scheme no es un token', () => {
    expect([...bloque(CSS, `:root[data-tema="${OTRO}"]`).keys()]).toEqual(['--fondo']);
  });

  it('lanza si un token no tiene exactamente dos espacios de indentación', () => {
    const css = ':root {\n  --a: #000;\n    --b: #fff;\n}';
    expect(() => bloque(css, ':root')).toThrow('indentación distinta de dos espacios en --b');
  });

  it('lanza si el bloque no existe o aparece dos veces', () => {
    expect(() => bloque(CSS, ':root[data-tema="sepia"]')).toThrow(
      'el bloque :root[data-tema="sepia"] aparece 0 veces',
    );
    expect(() => bloque(`${CSS}\n:root {\n  --x: #000;\n}`, ':root')).toThrow('el bloque :root aparece 2 veces');
  });
});

describe('mapaDeTema', () => {
  it('el default es :root; otro tema es :root más su bloque, como la cascada en <html>', () => {
    expect(mapaDeTema(CSS, TEMA_POR_DEFECTO).get('--fondo')).toBe('#131313');
    const otro = mapaDeTema(CSS, OTRO);
    expect(otro.get('--fondo')).toBe('#f4f1ec'); // lo pisa su bloque
    expect(otro.get('--texto')).toBe('var(--blanco)'); // lo hereda de :root
  });
});

describe('resolver', () => {
  const mapa = new Map([
    ['--blanco', '#f5f5f0'],
    ['--texto', 'var(--blanco)'],
    ['--alias', 'var(--texto)'],
    ['--a', 'var(--b)'],
    ['--b', 'var(--a)'],
    ['--con-respaldo', 'var(--blanco, #fff)'],
    ['--roto', 'var(--no-existe)'],
    ['--lista', '0 0 0 1px var(--blanco)'],
  ]);

  it('sigue cadenas de var() hasta un valor', () => {
    expect(resolver('--alias', mapa)).toBe('#f5f5f0');
  });

  it('devuelve tal cual un valor que no es un var() solo', () => {
    expect(resolver('--lista', mapa)).toBe('0 0 0 1px var(--blanco)');
  });

  it('resuelve un var() con espacios, mayúsculas o guion bajo, en vez de devolverlo crudo', () => {
    // El charset legal de una custom property es más ancho que [a-z0-9-]. Devolver el var() crudo
    // hacía que el error saliera después, desde el parseo de color, apuntando al lugar equivocado.
    const otros = new Map([
      ['--Fondo', '#131313'],
      ['--x_y', 'var( --Fondo )'],
    ]);
    expect(resolver('--x_y', otros)).toBe('#131313');
  });

  it('lanza ante un ciclo, un token que no existe o un valor de respaldo', () => {
    expect(() => resolver('--a', mapa)).toThrow('referencia circular: --a → --b → --a');
    expect(() => resolver('--roto', mapa)).toThrow('el token --no-existe no está definido');
    expect(() => resolver('--con-respaldo', mapa)).toThrow(
      'var() con valor de respaldo no soportado: --con-respaldo',
    );
  });
});

describe('regla', () => {
  it('fusiona las reglas de primer nivel en orden (la última gana) e ignora las de un @media', () => {
    const a = regla(CSS, '.a');
    expect(a.get('color')).toBe('var(--texto)'); // el `red` de adentro del @media no cuenta
    expect(a.get('background')).toBe('transparent'); // la segunda regla .a pisa a la primera
  });

  it('encuentra un selector con una coma adentro de :is(), sin importar los espacios', () => {
    expect(regla(CSS, '.b:is(x,y)').get('background')).toBe('var(--fondo)');
  });

  it('lanza si la regla no existe', () => {
    expect(() => regla(CSS, '.c')).toThrow('no existe la regla .c');
  });
});

describe('reglas', () => {
  it('marca las reglas que viven adentro de un @media', () => {
    const deA = reglas(CSS).filter((r) => r.selectores.includes('.a'));
    expect(deA.map((r) => r.dentroDeArroba)).toEqual([false, true, false]);
  });
});

describe('sinComentarios', () => {
  it('espacia cada comentario en vez de borrarlo, para no mover las posiciones del archivo', () => {
    const css = '.a {\n  /* un comentario con } adentro */\n  color: red;\n}';
    const limpio = sinComentarios(css);
    expect(limpio).toHaveLength(css.length);
    expect(limpio).not.toContain('/*');
    expect(regla(css, '.a').get('color')).toBe('red');
  });
});

describe('lo que no sabe leer, lo lanza', () => {
  it('lanza ante el anidamiento nativo de CSS, en vez de inventar una regla fantasma', () => {
    expect(() => reglas('.a {\n  color: red;\n  &:hover { color: blue; }\n}')).toThrow(
      'anidamiento no soportado en ".a"',
    );
  });

  it('lanza ante un paréntesis sin balancear, en vez de tragarse lo que sigue', () => {
    expect(() => reglas('.a { color: rgb(0, 0, 0; background: red; }')).toThrow('paréntesis sin balancear');
  });

  it('dice en qué línea está la llave sin cerrar, o la de más', () => {
    expect(() => reglas('.a {\n  color: red;\n')).toThrow('quedó sin cerrar ".a"');
    expect(() => reglas('/* }\n */\n.a { color: red; }\n}')).toThrow('llave de cierre sin abrir en línea 4');
  });

  it('lanza si un token no abre su propia línea, aunque lleve dos espacios adelante', () => {
    expect(() => bloque(':root {\n  --a: #000; --b: #fff;\n}', ':root')).toThrow('--b no abre su propia línea');
  });

  it('avisa cuando el bloque existe pero comparte su regla con otros selectores', () => {
    expect(() => bloque(':root, .panel {\n  --a: #000;\n}', ':root')).toThrow(
      'pero existe compartiendo regla con otros selectores',
    );
  });
});

describe('normalizarSelector', () => {
  it('colapsa espacios y los quita alrededor de comas y combinadores', () => {
    expect(normalizarSelector('.field  :is(input , select)')).toBe('.field :is(input,select)');
    expect(normalizarSelector('.a  >  .b')).toBe('.a>.b');
  });
});
```

- [ ] **Paso 2: correr y ver que falla**

Esperado: FALLA con `Failed to resolve import "./tokensCss"`.

- [ ] **Paso 3: escribir el módulo**

`lib/diseno/tokensCss.ts`:

```ts
import { TEMA_POR_DEFECTO, type Tema } from '../tema';

// Lectura de app/globals.css para las pruebas de diseño. Es el ÚNICO parser del CSS en el repo: lo
// usan lib/tema.test.ts y lib/diseno/temas.test.ts. Si cada prueba tuviera el suyo, podrían leer el
// mismo archivo de dos maneras distintas sin que ninguna se enterara.
//
// No es un parser de CSS general. Entiende lo que hay en globals.css — reglas planas, y @media /
// @keyframes que las envuelven, sin anidamiento — y LANZA ante lo que no sabe leer.

export type Regla = {
  selectores: string[]; // ya normalizados
  declaraciones: Map<string, string>;
  cuerpo: string; // el texto crudo entre las llaves, sin comentarios
  dentroDeArroba: boolean; // vive dentro de un @media, @keyframes, @supports…
};

// Reemplaza cada comentario por espacios en vez de borrarlo: así las posiciones del texto limpio
// siguen coincidiendo con las del archivo en disco y un error puede decir en qué línea está. Con
// ~100 líneas de comentario en globals.css, un offset sobre el texto recortado no sirve para nada.
export function sinComentarios(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comentario) => comentario.replace(/[^\n]/g, ' '));
}

function ubicacion(texto: string, posicion: number): string {
  const antes = texto.slice(0, posicion);
  return `línea ${antes.split('\n').length}, columna ${posicion - antes.lastIndexOf('\n')}`;
}

// Parte en `separador` solo FUERA de paréntesis: `:is(a, b)` es un selector, no dos, y
// `rgba(0, 0, 0, 0.5)` es un valor, no cuatro.
function partirFueraDeParentesis(texto: string, separador: ',' | ';'): string[] {
  const partes: string[] = [];
  let profundidad = 0;
  let desde = 0;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === '(') profundidad++;
    else if (c === ')') profundidad--;
    else if (c === separador && profundidad === 0) {
      partes.push(texto.slice(desde, i));
      desde = i + 1;
    }
  }
  // Un paréntesis sin cerrar deja la profundidad arriba de cero y se traga todo lo que sigue: sin
  // esta guarda, `rgb(0, 0, 0; background: red` devuelve UNA declaración ilegible y el background
  // desaparece en silencio.
  if (profundidad !== 0) throw new Error(`paréntesis sin balancear en: ${texto.trim().slice(0, 70)}`);
  partes.push(texto.slice(desde));
  return partes;
}

// Colapsa espacios y los quita alrededor de comas y combinadores, para que `.a > .b` y `.a>.b`, o
// `:is(a, b)` y `:is(a,b)`, sean el mismo selector.
export function normalizarSelector(selector: string): string {
  return selector
    .replace(/\s+/g, ' ')
    .replace(/\s*([,>+~])\s*/g, '$1')
    .trim();
}

function leerDeclaraciones(cuerpo: string, selector: string): Map<string, string> {
  const declaraciones = new Map<string, string>();
  for (const cruda of partirFueraDeParentesis(cuerpo, ';')) {
    const declaracion = cruda.trim();
    if (!declaracion) continue;
    const dosPuntos = declaracion.indexOf(':');
    if (dosPuntos < 0) throw new Error(`declaración ilegible en "${selector}": ${declaracion}`);
    const nombre = declaracion.slice(0, dosPuntos).trim();
    const propiedad = nombre.startsWith('--') ? nombre : nombre.toLowerCase();
    declaraciones.set(propiedad, declaracion.slice(dosPuntos + 1).replace(/\s+/g, ' ').trim());
  }
  return declaraciones;
}

// Todas las reglas de estilo del archivo, en orden, a cualquier profundidad.
export function reglas(css: string): Regla[] {
  const limpio = sinComentarios(css);
  const resultado: Regla[] = [];
  const abiertos: Array<{ arroba: boolean; prelude: string; cuerpoDesde: number }> = [];
  let desde = 0;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (c === '{') {
      const prelude = limpio.slice(desde, i).trim();
      abiertos.push({ arroba: prelude.startsWith('@'), prelude, cuerpoDesde: i + 1 });
      desde = i + 1;
    } else if (c === '}') {
      const abierto = abiertos.pop();
      if (!abierto) throw new Error(`llave de cierre sin abrir en ${ubicacion(limpio, i)}`);
      if (!abierto.arroba) {
        const cuerpo = limpio.slice(abierto.cuerpoDesde, i);
        // El anidamiento nativo de CSS (`.a { &:hover { … } }`) no se soporta, y sin esta guarda no
        // se rompe: se lee MAL en silencio, inventando una regla con un selector basura y perdiendo
        // declaraciones. El contrato de este módulo es lanzar ante lo que no sabe leer.
        if (cuerpo.includes('{')) {
          throw new Error(
            `anidamiento no soportado en "${abierto.prelude}" (${ubicacion(limpio, abierto.cuerpoDesde)})`,
          );
        }
        resultado.push({
          selectores: partirFueraDeParentesis(abierto.prelude, ',').map(normalizarSelector),
          declaraciones: leerDeclaraciones(cuerpo, abierto.prelude),
          cuerpo,
          dentroDeArroba: abiertos.some((a) => a.arroba),
        });
      }
      desde = i + 1;
    }
  }
  const sinCerrar = abiertos[abiertos.length - 1];
  if (sinCerrar) {
    throw new Error(`quedó sin cerrar "${sinCerrar.prelude}" (${ubicacion(limpio, sinCerrar.cuerpoDesde)})`);
  }
  return resultado;
}

// Las declaraciones de la regla de primer nivel (fuera de @media / @keyframes) cuya lista de
// selectores contiene EXACTAMENTE `selector`. Si hay varias, se fusionan en orden y la última gana,
// igual que en la cascada entre reglas de la misma especificidad.
export function regla(css: string, selector: string): Map<string, string> {
  const buscado = normalizarSelector(selector);
  const encontradas = reglas(css).filter((r) => !r.dentroDeArroba && r.selectores.includes(buscado));
  if (encontradas.length === 0) throw new Error(`no existe la regla ${selector}`);
  return new Map(encontradas.flatMap((r) => [...r.declaraciones]));
}

// Los tokens (--x) de un bloque de tema. El bloque tiene que existir UNA vez, con ese selector solo.
//
// Exige dos espacios de indentación: es la forma que documenta DESIGN.md, y la que permite
// encontrar todos los tokens con un grep de `^  --`. Con el parser viejo, un token con otra
// indentación era invisible para la prueba sin que nadie se enterara; con este, lanza.
export function bloque(css: string, selector: string): Map<string, string> {
  const buscado = normalizarSelector(selector);
  const candidatos = reglas(css).filter(
    (r) => !r.dentroDeArroba && r.selectores.length === 1 && r.selectores[0] === buscado,
  );
  if (candidatos.length !== 1) {
    const enGrupo = reglas(css).some((r) => !r.dentroDeArroba && r.selectores.includes(buscado));
    const detalle = enGrupo && candidatos.length === 0 ? ', pero existe compartiendo regla con otros selectores' : '';
    throw new Error(
      `el bloque ${selector} aparece ${candidatos.length} veces en el CSS (se esperaba 1)${detalle}`,
    );
  }
  const [unico] = candidatos;
  const enSuPropiaLinea = new Set<string>();
  for (const linea of unico.cuerpo.split(/\r?\n/)) {
    const token = /^(\s*)(--[\w-]+)\s*:/.exec(linea);
    if (!token) continue;
    if (token[1] !== '  ') throw new Error(`indentación distinta de dos espacios en ${token[2]}`);
    enSuPropiaLinea.add(token[2]);
  }
  const tokens = new Map([...unico.declaraciones].filter(([nombre]) => nombre.startsWith('--')));
  // El lint de arriba solo mira el token que ABRE cada línea. Sin este cruce contra lo que de verdad
  // se devuelve, `--a: #000; --b: #fff;` en una sola línea pasa, y `--b` queda invisible para el
  // grep de `^  --` que documenta DESIGN.md: justo lo que el lint existe para impedir.
  for (const nombre of tokens.keys()) {
    if (!enSuPropiaLinea.has(nombre)) {
      throw new Error(`${nombre} no abre su propia línea: un grep de "^  --" no lo encontraría`);
    }
  }
  return tokens;
}

// Los tokens tal como los ve el <html> con ese tema aplicado: el default es :root; cualquier otro
// es :root más su bloque, que pisa lo que redefine (la misma cascada que en el navegador).
export function mapaDeTema(css: string, tema: Tema): Map<string, string> {
  const raiz = bloque(css, ':root');
  if (tema === TEMA_POR_DEFECTO) return raiz;
  return new Map([...raiz, ...bloque(css, `:root[data-tema="${tema}"]`)]);
}

// Sigue una cadena de var(--x) hasta un valor que no es un var() solo (p. ej. --texto → --blanco →
// #f5f5f0). Un valor compuesto (`4px 4px 10px var(--x), …`) se devuelve tal cual.
export function resolver(nombre: string, mapa: Map<string, string>): string {
  const camino: string[] = [];
  let actual = nombre;
  for (;;) {
    if (camino.includes(actual)) throw new Error(`referencia circular: ${[...camino, actual].join(' → ')}`);
    camino.push(actual);
    const valor = mapa.get(actual);
    if (valor === undefined) throw new Error(`el token ${actual} no está definido`);
    // `[\w-]+` y no `[a-z0-9-]+`: el charset legal de una custom property incluye mayúsculas y guion
    // bajo, y con la regex estrecha un `var(--Fondo)` o un `var( --b )` no encajaba, se devolvía
    // CRUDO y el error terminaba saliendo desde el parseo de color, apuntando al lugar equivocado.
    const referencia = /^var\(\s*(--[\w-]+)\s*(,[\s\S]*)?\)$/.exec(valor);
    if (!referencia) return valor;
    if (referencia[2] !== undefined) {
      throw new Error(`var() con valor de respaldo no soportado: ${actual}: ${valor}`);
    }
    actual = referencia[1];
  }
}
```

- [ ] **Paso 4: correr y ver que pasa**

Esperado: `tokensCss.test.ts` en verde (13 pruebas); `contraste.test.ts` (9) y `lib/tema.test.ts`
(7) siguen en verde. Total 29.

- [ ] **Paso 5: mutaciones**

Las seis del comentario del archivo de prueba. Reportá, para cada una, qué prueba falla y con qué
mensaje. La (1) debe fallar con `llave de cierre sin abrir`; la (6) mata el worker por falta de
memoria a los ~30 s (el bucle es síncrono: el timeout de vitest no llega a dispararse).

- [ ] **Paso 6: commit**

```bash
git add lib/diseno/tokensCss.ts lib/diseno/tokensCss.test.ts
git commit -m "Diseno: parser unico de globals.css (reglas, bloques de tema, cascada, var)" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Tarea 3: `lib/tema.test.ts` sobre el parser nuevo

**Archivos:**
- Modificar: `lib/tema.test.ts` (el segundo `describe`, L65-137)

Las aserciones de la primera mitad no se tocan. En la segunda, el helper `tokensDe` pasa a usar
`bloque()` (que quita comentarios y lanza ante la indentación), y la prueba de `color-scheme` pasa a
compararse contra un mapa escrito en la prueba, no contra el CSS mismo.

- [ ] **Paso 1: imports**

Reemplazar la línea 4:

```ts
import { CLAVE_TEMA, SCRIPT_TEMA, TEMAS, TEMA_POR_DEFECTO, esTema, normalizarTema } from './tema';
```

por:

```ts
import { CLAVE_TEMA, SCRIPT_TEMA, TEMAS, TEMA_POR_DEFECTO, esTema, normalizarTema, type Tema } from './tema';
import { bloque, regla } from './diseno/tokensCss';
```

- [ ] **Paso 2: el helper y la prueba de bloques**

Reemplazar el helper `tokensDe` (L73-81, con su comentario) por:

```ts
  // Los tokens de un bloque, leídos con el parser único (lib/diseno/tokensCss.ts): quita los
  // comentarios, así que un `}` adentro de uno ya no corta el bloque, y lanza ante un token con
  // otra indentación en vez de no verlo.
  const tokensDe = (selector: string): Set<string> => new Set(bloque(css, selector).keys());
```

Y el cuerpo de `it('cada tema que no es el default tiene su bloque :root[data-tema=…]'` por:

```ts
    for (const t of TEMAS) {
      if (t === TEMA_POR_DEFECTO) continue; // el default ES :root, no lleva bloque propio
      // El mensaje NO afirma la causa: bloque() lanza por tres motivos (no existe, está repetido, o
      // tiene un token mal indentado), y el suyo es más preciso que cualquier cosa que digamos acá.
      expect(() => bloque(css, `:root[data-tema="${t}"]`), `no se pudo leer el bloque del tema "${t}"`).not.toThrow();
    }
```

- [ ] **Paso 3: la prueba de `color-scheme`**

Reemplazar el `it('color-scheme se declara en cada tema …'` completo (L125-136) por:

```ts
  // La fuente de verdad del esquema de cada tema es ESTE mapa, no el CSS: comparar el CSS contra sí
  // mismo seguiría verde con html en dark y el default en claro.
  const ESQUEMA: Record<Tema, 'light' | 'dark'> = { oscuro: 'dark', claro: 'light', 'alto-contraste': 'dark' };

  it('color-scheme: cada bloque el de su tema, y html el del default', () => {
    // Sin esto el navegador pinta los <select>, los scrollbars y el autofill con el esquema del
    // tema anterior: campos oscuros dentro de un panel claro.
    for (const t of TEMAS) {
      if (t === TEMA_POR_DEFECTO) continue;
      const esquema = regla(css, `:root[data-tema="${t}"]`).get('color-scheme');
      expect(esquema, `el tema "${t}" declara color-scheme ${esquema} y debería ser ${ESQUEMA[t]}`).toBe(
        ESQUEMA[t],
      );
    }
    const html = regla(css, 'html').get('color-scheme');
    expect(
      html,
      `html declara color-scheme ${html} y el default (${TEMA_POR_DEFECTO}) es ${ESQUEMA[TEMA_POR_DEFECTO]}`,
    ).toBe(ESQUEMA[TEMA_POR_DEFECTO]);
    // El del default vive en `html` (0,0,1) y NO en `:root` (0,1,0), que le ganaría por
    // especificidad: si alguien lo agregara ahí, el navegador usaría ese y la aserción de arriba
    // seguiría verde mirando una declaración que ya no manda.
    expect(
      regla(css, ':root').get('color-scheme'),
      ':root declara color-scheme y le gana a html por especificidad: el default se declara en html',
    ).toBeUndefined();
  });
```

**Y corregí el comentario de cabecera del segundo `describe`** (L66-70), que afirma que agregar un
tema a `TEMAS` y olvidar el CSS "compila": ya no es cierto — `ETIQUETAS_TEMA` es un
`Record<Tema, …>` y `ESQUEMA` suma otro, así que `tsc` obliga a llenar las dos tablas. Lo que sigue
sin estar atado es el bloque de CSS, y eso es lo que la prueba atrapa.

- [ ] **Paso 4: correr**

Esperado: `lib/tema.test.ts` en verde, 7 pruebas (las mismas que antes).

- [ ] **Paso 5: mutaciones** (contra `app/globals.css`, restaurando cada vez)

| Romper | Falla con |
|---|---|
| `html { color-scheme: dark }` (L271) → `light` | `html declara color-scheme light y el default (oscuro) es dark` |
| en el bloque claro (L129) `color-scheme: light` → `dark` | `el tema "claro" declara color-scheme dark y es light` |
| declarar un token del bloque claro con 4 espacios | `indentación distinta de dos espacios en --x` — ojo: fallan **dos** pruebas, porque la de bloques y la de tokens pasan las dos por `bloque()` |
| agregar `color-scheme: dark` al bloque `:root` | `:root declara color-scheme y le gana a html por especificidad` |
| borrar `--menta` del bloque de alto contraste | `el tema "alto-contraste" no redefine estos tokens` con `--menta` en la lista |

- [ ] **Paso 6: commit**

```bash
git add lib/tema.test.ts
git commit -m "tema.test: usa el parser unico y fija color-scheme contra un mapa, no contra el CSS" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Tarea 4: la prueba de contraste de los tres temas, y los dos fallos vivos

**Archivos:**
- Crear: `lib/diseno/temas.test.ts`
- Modificar: `app/globals.css` (L48 y L253)

Esta tarea es la que se puede publicar sola (con el OK de Daniel): arregla el botón "Acreditar" del
escáner, que hoy sale a 2.31:1.

- [ ] **Paso 1: escribir la prueba**

`lib/diseno/temas.test.ts`:

```ts
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
```

- [ ] **Paso 2: correr y ver la falla ESPERADA**

Esperado: rojo, con exactamente estas cinco fallas (dos pruebas de `tema oscuro` y dos de
`tema alto-contraste` en rojo; todo lo demás verde):

```
[tema oscuro] --sobre-acento sobre --acento-fuerte: 2.31:1 < 4.5 (botón Acreditar, círculo de Escanear)
[tema oscuro] regla .btn-acento: --sobre-acento sobre --acento-fuerte: 2.31:1 < 4.5 (Acreditar, Publicar cambios)
[tema oscuro] regla .nav-destacado .icono: --sobre-acento sobre --acento-fuerte: 2.31:1 < 3 (círculo de Escanear)
[tema alto-contraste] --error sobre --error-suave∘--superficie-2: 5.97:1 < 7 (pastilla inactiva, sobre la fila que la contiene)
[tema alto-contraste] regla .pastilla-inactivo: --error sobre --error-suave∘--superficie-2: 5.97:1 < 7 (pastilla inactiva, dentro de una fila)
```

Si aparece cualquier otra falla, o alguna de estas no aparece, **pará y reportalo**: la predicción
se calculó con un prototipo de este mismo código contra el CSS de `3db8bf0`.

- [ ] **Paso 3: arreglar los dos tokens**

En `app/globals.css`, bloque `:root` (hoy el oscuro), L47-49. Reemplazar:

```css
  --acento-fuerte: #514ba8; /* --violeta oficial */
```

por:

```css
  /* Lavanda, más CLARO que el acento: en un tema oscuro, "fuerte" es más lejos del fondo. El
     #514ba8 que tenía dejaba --sobre-acento (Deep) a 2.31:1 en el botón Acreditar del escáner. */
  --acento-fuerte: #a49df0;
```

En el bloque `:root[data-tema="alto-contraste"]`, L253. Reemplazar:

```css
  --error-suave: rgba(255, 138, 122, 0.22);
```

por:

```css
  /* 12% y no 22%: la pastilla "inactivo" (su único uso) no se apoya en el fondo de la página sino
     en la fila que la contiene (--superficie-2). Medida ahí, con 22% daba 5.97:1 y con 16% daba
     6.78:1; en este tema todo texto pide 7:1. Con 12% da 7.31:1. */
  --error-suave: rgba(255, 138, 122, 0.12);
```

- [ ] **Paso 4: correr y ver verde**

Esperado: todas las pruebas de diseño en verde.

- [ ] **Paso 5: mutaciones**

Todas las filas de la tabla "Mutation-testing" de la spec que no están marcadas F3+ ni F3: son las
que corren contra el CSS de hoy. Reportá el mensaje real de cada una. Si un número difiere de la
predicción en el segundo decimal, anotalo; si difiere más, pará y reportalo.

- [ ] **Paso 6: commit**

```bash
git add lib/diseno/temas.test.ts app/globals.css
git commit -m "Contraste medido en los tres temas; arregla Acreditar (2.31:1) y la pastilla inactiva en alto contraste" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Tarea 5: el tablero de componentes (con el CSS de hoy)

**Archivos:**
- Crear: `public/tablero-neumorfico/index.html`, `componentes.html`, `tablero.css`, `medir.js`
- Crear: `public/tablero-neumorfico/antes.css` (copia de `app/globals.css` en `3db8bf0`)
- Crear: `public/tablero-neumorfico/propuesta.css` (copia de `app/globals.css` actual)

`antes.css` es el CSS **anterior al rediseño**, del commit base, e incluye a propósito los dos
defectos de contraste que arregla la Tarea 4: así el interruptor "Antes" muestra desde el principio
una diferencia real (el botón "Acreditar" y la pastilla inactiva), y no dos archivos idénticos.

Es la herramienta de revisión de Daniel: todos los componentes en los tres temas, con un
interruptor "antes / después". **Se borra antes de integrar a `master`** (en `public/` se serviría
en producción).

- [ ] **Paso 1: las dos copias del CSS**

```bash
mkdir -p public/tablero-neumorfico
git show 3db8bf0:app/globals.css > public/tablero-neumorfico/antes.css
cp app/globals.css public/tablero-neumorfico/propuesta.css
```

- [ ] **Paso 2: `tablero.css`**

```css
/* Solo para el tablero: lo que en la app inyecta next/font (app/layout.tsx) y el marco de las
   secciones. Nada de acá es parte del sistema: el sistema es antes.css / propuesta.css. */
:root {
  --font-display: 'Outfit', system-ui, sans-serif;
  --font-body: 'Hanken Grotesk', system-ui, sans-serif;
  --font-mono: 'Geist Mono', ui-monospace, monospace;
}
body {
  padding-bottom: 120px; /* la barra inferior es fixed y taparía lo último */
}
.tablero-seccion {
  padding: 20px 20px 8px;
}
.tablero-seccion > h2 {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--texto-3);
  margin: 0 0 14px;
}
.tablero-fila {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
}
/* Una hoja (bottom sheet) es fixed en la app; acá se muestra en su lugar para poder verla. */
.tablero-estatico {
  position: static !important;
  transform: none !important;
}
```

- [ ] **Paso 3: `medir.js`**

```js
// Mide el contraste de cada [data-par] de los tres iframes con la cascada REAL del navegador
// (getComputedStyle), para contrastar con lo que calcula lib/diseno/temas.test.ts leyendo el CSS.
// Misma fórmula que lib/diseno/contraste.ts (WCAG 2.x); copiada porque esta página es suelta.
(function () {
  function rgba(texto) {
    var m = texto.match(/rgba?\(([^)]+)\)/);
    if (!m) throw new Error('color que no se puede medir: ' + texto);
    var p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function sobre(arriba, abajo) {
    var a = arriba.a;
    return {
      r: arriba.r * a + abajo.r * (1 - a),
      g: arriba.g * a + abajo.g * (1 - a),
      b: arriba.b * a + abajo.b * (1 - a),
      a: 1,
    };
  }
  function lineal(c) {
    var s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }
  function luminancia(c) {
    return 0.2126 * lineal(c.r) + 0.7152 * lineal(c.g) + 0.0722 * lineal(c.b);
  }
  function razon(x, y) {
    var a = luminancia(x);
    var b = luminancia(y);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }
  // El fondo efectivo: se suben los ancestros juntando capas hasta encontrar una opaca.
  function fondoDe(el, win) {
    var capas = [];
    for (var n = el; n; n = n.parentElement) {
      var c = rgba(win.getComputedStyle(n).backgroundColor);
      if (c.a > 0) capas.push(c);
      if (c.a === 1) break;
    }
    var base = capas.length && capas[capas.length - 1].a === 1 ? capas.pop() : { r: 255, g: 255, b: 255, a: 1 };
    while (capas.length) base = sobre(capas.pop(), base);
    return base;
  }
  window.medirTablero = function () {
    var filas = [];
    document.querySelectorAll('iframe[data-tema]').forEach(function (marco) {
      var win = marco.contentWindow;
      marco.contentDocument.querySelectorAll('[data-par]').forEach(function (el) {
        var fondo = fondoDe(el, win);
        var estilo = win.getComputedStyle(el, el.getAttribute('data-pseudo') || null);
        var r = razon(sobre(rgba(estilo.color), fondo), fondo);
        var minimo = Number(el.getAttribute('data-min') || 4.5);
        filas.push({
          tema: marco.getAttribute('data-tema'),
          par: el.getAttribute('data-par'),
          razon: Math.round(r * 100) / 100,
          minimo: minimo,
          ok: r >= minimo,
        });
      });
    });
    return filas;
  };
})();
```

- [ ] **Paso 4: `index.html`**

```html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tablero neumórfico — Cardly</title>
<style>
  body { margin: 0; font-family: system-ui, sans-serif; background: #f2f2f2; color: #111; }
  .barra { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; gap: 8px 20px;
    align-items: center; padding: 10px 16px; background: #fff; border-bottom: 1px solid #ddd; }
  .temas { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 390px), 1fr));
    gap: 16px; padding: 16px; }
  .tema h2 { font-size: 14px; margin: 0 0 8px; }
  iframe { display: block; width: 100%; height: 2600px; border: 1px solid #ccc; border-radius: 12px; }
  body.sol iframe { filter: contrast(0.6) brightness(1.2); }
  body.grises iframe { filter: grayscale(1); }
  body.sol.grises iframe { filter: contrast(0.6) brightness(1.2) grayscale(1); }
</style>
</head>
<body>
  <div class="barra">
    <strong>Tablero neumórfico</strong>
    <label><input type="radio" name="version" value="propuesta" checked> Después</label>
    <label><input type="radio" name="version" value="antes"> Antes</label>
    <label><input type="checkbox" id="sol"> Sol (contraste 0.6, brillo 1.2)</label>
    <label><input type="checkbox" id="grises"> Escala de grises</label>
  </div>
  <div class="temas">
    <section class="tema"><h2>Claro</h2>
      <iframe data-tema="claro" src="componentes.html?tema=claro" title="Tema claro"></iframe></section>
    <section class="tema"><h2>Oscuro</h2>
      <iframe data-tema="oscuro" src="componentes.html?tema=oscuro" title="Tema oscuro"></iframe></section>
    <section class="tema"><h2>Alto contraste</h2>
      <iframe data-tema="alto-contraste" src="componentes.html?tema=alto-contraste" title="Tema alto contraste"></iframe></section>
  </div>
  <script src="medir.js"></script>
  <script>
    ['sol', 'grises'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', function (e) {
        document.body.classList.toggle(id, e.target.checked);
      });
    });
    document.querySelectorAll('input[name="version"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        document.querySelectorAll('iframe[data-tema]').forEach(function (marco) {
          marco.src = 'componentes.html?tema=' + marco.getAttribute('data-tema') + '&css=' + radio.value;
        });
      });
    });
  </script>
</body>
</html>
```

- [ ] **Paso 5: `componentes.html`**

La cabecera es fija:

```html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Componentes</title>
<script>
  // Igual que SCRIPT_TEMA (lib/tema.ts): el tema se fija ANTES del primer pintado. Y la hoja de
  // estilos sale de ?css= (antes | propuesta), para comparar.
  (function () {
    var q = new URLSearchParams(location.search);
    var t = q.get('tema');
    if (['oscuro', 'claro', 'alto-contraste'].indexOf(t) > -1) document.documentElement.dataset.tema = t;
    var hoja = q.get('css') === 'antes' ? 'antes.css' : 'propuesta.css';
    document.write('<link rel="stylesheet" href="' + hoja + '">');
  })();
</script>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&family=Hanken+Grotesk:wght@400;600&family=Geist+Mono:wght@400;700&display=swap">
<link rel="stylesheet" href="tablero.css">
</head>
```

Agregá también el `<link>` de Material Symbols **copiado tal cual** de `app/layout.tsx`.
Ojo con el orden: `tablero.css` va después de la hoja del sistema en el documento, pero no declara
nada que ella declare (solo las fuentes y el marco).

El cuerpo se arma **copiando el marcado real de los TSX** (className → class, sin handlers ni
estado; los datos, inventados pero verosímiles: "Pupusería La Esquina", teléfonos `+503 7…`). Cada
sección es un `<section class="tablero-seccion">` con un `<h2>` que la nombra. Secciones mínimas,
cada una con la fuente de donde se copió:

1. Cabecera de la app: `.admin-top` con la marca, `.contexto-pastilla`, `.menu-boton` y
   `.admin-salir` (de `app/comercio/(protegido)/layout.tsx` y `app/admin/(protegido)/layout.tsx`).
2. Títulos: `.kicker`, `.title`, `.lede`, `.titulo-seccion`.
3. `.panel` con un formulario: un `.field` por **cada tipo de control que usa la app** (sacá la
   lista con `grep -rhoE 'type="[a-z-]+"' app --include=*.tsx | sort | uniq -c`, más `<select>` y
   `<textarea>`), con label, placeholder donde aplique, y uno en estado de error con `.field-aviso`.
4. Botones: `.btn-primary`, `.btn-acento`, `.btn-borde`, cada uno normal y `disabled`; `.wallet-btn`.
5. `.alerta` y `.nota`.
6. Lista: `.admin-lista` con una `.admin-fila` que es `<a>` y otra que es `<div>`, cada una con
   `.icono-circulo`, `.admin-fila-nombre`, `.admin-fila-slug` y una `.pastilla-activo` /
   `.pastilla-inactivo`.
7. Métricas: `.metric-pila` con `.metric-carta.naranja` y `.metric-carta.menta` (de
   `app/comercio/(protegido)/panel/page.tsx`).
8. Filtros: `.filtro-chips` con dos `.filtro-chip` inactivos y uno `.activo` (de reportes).
9. `.subida-imagen` (de branding).
10. Portal del cliente: `.portal-cuentas` con dos `.portal-cuenta` (una activa) y una
    `.portal-recompensa` (de `app/mi-tarjeta/PortalCliente.tsx`).
11. Escáner: `.escaner-marco` con un `<div>` gris del tamaño del video en lugar del `<video>`, y la
    fila "Puntos a sumar + Acreditar" tal como está en `Escaner.tsx:407-428`.
12. Pase: una `.cardface` con `.sello` y `.sello.lleno`, y un `.qr-tile`.
13. Hoja: el `.sheet-panel` de `MenuOpciones.tsx` con una `.sheet-fila` y una `.sheet-fila-activa`,
    con la clase `tablero-estatico` agregada.
14. Barra inferior: la `.nav-inferior` de `NavInferior.tsx` con los 5 destinos, el del centro
    `.nav-destacado`, y uno `.activo`. Va al final (es fixed).

Marcá con `data-par="<nombre>"` (y `data-min` si el mínimo no es 4.5) el texto de: un campo, un
placeholder (con `data-pseudo="::placeholder"` sobre el `<input>`), cada botón, la alerta, cada
pastilla, cada chip, el destino activo y uno inactivo de la barra, y el valor de cada métrica
(`data-min="3"`).

- [ ] **Paso 6: revisar sin navegador**

Abrí `componentes.html` en tu cabeza contra el checklist de secciones: las 14 están, cada una con
su fuente. No arranques ningún servidor: la verificación visual la hace el controlador.

- [ ] **Paso 7: commit**

```bash
git add public/tablero-neumorfico
git commit -m "Tablero de componentes para revisar el rediseno (antes y despues, tres temas)" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Verificación del controlador:** `preview_start` con `dev` y abrir `/tablero-neumorfico/`; si el
dev server no arranca sin `.env.local`, servir `public/` con otra entrada de `.claude/launch.json`.
Acá el tablero muestra el CSS de HOY: solo se sacan las **capturas del "antes"** a 375px en los tres
temas. La verificación visual del rediseño (medir.js, Tab, "sol", "grises") corre al cierre de la
Tarea 9, sobre el CSS nuevo — correrla acá mediría el vidrio viejo.

---

### Tarea 6: tokens nuevos y claro por defecto

**Archivos:**
- Modificar: `app/globals.css` (L1-259 y la regla `html`)
- Modificar: `lib/tema.ts`, `lib/tema.test.ts`, `lib/diseno/temas.test.ts`
- Modificar: `app/manifest.ts`, `app/mi-tarjeta/layout.tsx`
- Sincronizar: `public/tablero-neumorfico/propuesta.css`

- [ ] **Paso 1: las pruebas nuevas primero (rojo)**

En `lib/tema.test.ts`:
- L29: `expect(TEMA_POR_DEFECTO).toBe('oscuro'); // el default NO cambia: es el tema que ya tenían`
  → `expect(TEMA_POR_DEFECTO).toBe('claro'); // el default desde el rediseño neumórfico (2026-09-20)`.
- L24: el título `'normalizarTema degrada a oscuro cualquier valor que no sea un tema'` →
  `'normalizarTema degrada al default cualquier valor que no sea un tema'`.
- L8-9, comentario de la mutación (1): "…el tema volvería a oscuro en cada recarga…" → "…el tema
  volvería al default en cada recarga…".
- L60: `// sin atributo → :root, que es el tema oscuro` → `// sin atributo → :root, que es el default (claro)`.
- En `CONSTANTES`, después de `'--radius-field',` agregar `'--radius-control',`.

En `lib/diseno/temas.test.ts`, agregar al final del archivo:

```ts
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
```

Y en `PARES_ALTO_CONTRASTE`, agregar:

```ts
  { frente: '--borde-relieve', fondo: ['--fondo'], minimo: 3, texto: false, uso: 'el borde de toda superficie con relieve' },
```

Esperado al correr: rojo. Ojo con la forma del rojo: la prueba de `TEMA_POR_DEFECTO` **falla** con
una aserción, pero las de `relieve` y la de pares de alto contraste **lanzan**
(`el token --relieve-1 no está definido`, `el token --borde-relieve no está definido`) porque esos
tokens todavía no existen. Es rojo igual; no es un defecto.

- [ ] **Paso 2: reescribir los bloques de tema**

En `app/globals.css`, reemplazar **todo** desde la L1 hasta el `}` que cierra el bloque
`:root[data-tema="alto-contraste"]` (L259; con el cambio de la Tarea 4 son un par de líneas más)
por el contenido exacto de abajo. Es el bloque que se validó con un prototipo de la prueba: 0 fallas
en los tres temas, simetría completa, relieve plano en alto contraste, pisos 1.21/1.50 (claro) y
1.22/1.17 (oscuro).

```css
/* ============================================================
   Cardly SV — sistema visual v3 "neumórfico" (2026-09-20)
   Antes: v2 "Stitch dark". El porqué de cada decisión vive en
   DESIGN.md y en docs/superpowers/specs/2026-09-20-rediseno-
   neumorfico-design.md.
   - Lo que se levanta es DEL MISMO COLOR que la página: la forma
     sale del relieve (luz arriba-izquierda, sombra abajo-derecha),
     no de un borde ni de otro color.
   - El relieve comunica FORMA, nunca ESTADO. Activo, elegido y con
     foco se marcan con el acento (relleno, borde, outline): un
     chip que solo "se hunde" desaparece bajo el sol.
   - UN solo acento (violeta de marca), solo en lo interactivo
     activo. El menta queda como secundario de datos/éxito.
   Tipografía: Outfit (display) + Hanken Grotesk (cuerpo) +
   Geist Mono (números/códigos), inyectadas por next/font.

   TRES TEMAS: claro (el default desde el 2026-09-20), oscuro y
   alto contraste. Se implementan REDEFINIENDO estas mismas
   variables en :root[data-tema=…] — ninguna pantalla sabe qué
   tema está activo. Regla de oro para código nuevo: si escribís
   un color literal fuera de este bloque, en dos de los tres temas
   va a estar mal. Las únicas excepciones son las que representan
   algo del mundo real y NO del panel (la tarjeta de la billetera,
   el QR, el botón de Apple Wallet, la guía sobre el video de la
   cámara); están marcadas una por una.
   ============================================================ */

/* ============================================================
   TEMA CLARO (el default)
   Escena: el dueño configura su tarjeta de día, con la vidriera
   abierta a la calle; el cajero cobra en el mostrador.
   Toda razón de contraste de este bloque la verifica
   lib/diseno/temas.test.ts: si tocás un valor, corré la prueba en
   vez de recalcular a mano (los comentarios a mano se desvían).
   ============================================================ */
:root {
  /* ---------- superficies ----------
     El truco del neumorfismo: lo que se levanta (--superficie-1/-2) es del MISMO color que la
     página, y se distingue solo por el relieve. --superficie-0 es el pozo (campos, chips inactivos,
     pistas), un escalón más oscuro: 1.11:1 contra el fondo. --superficie-3/-4 son el escalón de la
     fila activa y su hover (1.15 y 1.14:1). El fondo es gris-lavanda y no blanco porque la luz del
     relieve necesita margen para verse: sobre el hueso #f4f1ec de antes quedaba en 1.13:1. */
  --fondo: #e7e6f0;
  --superficie-0: #dcdbe8;
  --superficie-1: var(--fondo);
  --superficie-2: var(--fondo);
  --superficie-3: #d8d7e5;
  --superficie-4: #cbcadb;

  /* ---------- texto: Deep del kit, jerarquía por alpha ----------
     OJO: --blanco es una CONSTANTE DE MARCA (el hueso #F5F5F0), no un token de tema. Los otros
     temas NO la redefinen: sus usos (.cardface y .cardface-logo, y el texto del oscuro) son la
     tarjeta de la billetera y el hueso de siempre. --texto-3 va al 66% y no al 62%: con 0.62 da
     4.42:1 sobre este fondo. */
  --blanco: #f5f5f0;
  --texto: #181849;
  --texto-2: rgba(24, 24, 73, 0.75);
  --texto-3: rgba(24, 24, 73, 0.66);

  /* ---------- bordes ---------- */
  --linea: rgba(24, 24, 73, 0.12);
  --linea-fuerte: rgba(24, 24, 73, 0.24);

  /* ---------- acento único: violeta de marca ---------- */
  --acento: #514ba8; /* --violeta oficial: el Soft no llega a 4.5:1 sobre claro */
  --acento-fuerte: #3d3880; /* violeta más oscuro, hover/press */
  --sobre-acento: #f5f4fc;

  /* ---------- secundario menta (datos/éxito) ----------
     #0b6645 y no el #0d6e4a de antes: dentro de .pastilla-activo, sobre su propio tinte, el viejo
     daba 4.27:1. */
  --menta: #0b6645;
  --sobre-menta: #eefff7;

  /* ---------- error ---------- */
  --error: #a4231c;
  --error-fondo: rgba(164, 35, 28, 0.08);
  --error-borde: rgba(164, 35, 28, 0.32);

  /* ---------- tipografía ----------
     OJO: --font-display / --font-body / --font-mono las INYECTA next/font en <html>
     (app/layout.tsx). NO redeclararlas aquí: `--x: var(--x, …)` es una referencia circular
     que invalida la variable y tira toda la tipografía al serif del navegador. */

  /* ---------- forma (constantes: no cambian con el tema) ----------
     --radius-control es el radio de los controles (campos, .btn-acento, alertas). No se cambió
     --radius-field porque la portada lo usa y está fuera de este rediseño. */
  --radius: 20px;
  --radius-field: 12px;
  --radius-control: 16px;
  --radius-pill: 999px;

  /* ---------- espaciado ---------- */
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 24px;
  --sp-6: 32px;
  --sp-7: 48px;

  /* ---------- sombras de lo que FLOTA ----------
     La tarjeta del pase, el botón de Wallet, la vista previa: objetos que flotan SOBRE la página.
     Lo que se levanta o se hunde DE la página usa el relieve, más abajo. */
  --shadow-1: 0 6px 18px -10px rgba(24, 24, 73, 0.28);
  --shadow-2: 0 18px 44px -20px rgba(24, 24, 73, 0.32);
  --shadow-3: 0 26px 60px -18px rgba(24, 24, 73, 0.36);
  --shadow-card: var(--shadow-2); /* alias de compatibilidad */
  --ring: 0 0 0 4px rgba(81, 75, 168, 0.22);
  --sombra-acento: 0 8px 20px -8px rgba(61, 56, 128, 0.45);
  --sombra-menta: 0 10px 22px -10px rgba(11, 102, 69, 0.45);

  /* ---------- relieve ----------
     --luz y --sombra-relieve son COLORES: se pueden usar dentro de una lista de sombras, porque en
     alto contraste valen transparent, que es un color válido. Los --relieve-* y --hundido-* son
     COMPUESTOS: van SOLOS en su box-shadow, nunca en una lista. En alto contraste valen none, y
     `none, 0 0 0 3px x` es una declaración inválida que tira la sombra entera (lo verifica
     lib/diseno/temas.test.ts). --borde-relieve es el borde de 1px que lleva toda superficie con
     relieve: casi no se ve acá, pero mantiene la caja del mismo tamaño en los tres temas y es el
     único límite que queda en forced-colors. */
  --luz: rgba(255, 255, 255, 0.9);
  --sombra-relieve: rgba(24, 24, 73, 0.2);
  --relieve-1: 4px 4px 10px var(--sombra-relieve), -4px -4px 10px var(--luz);
  --relieve-2: 6px 6px 14px var(--sombra-relieve), -6px -6px 14px var(--luz);
  --relieve-3: 0 -1px 0 var(--luz), 0 -8px 24px -12px var(--sombra-relieve);
  --hundido-1: inset 3px 3px 6px var(--sombra-relieve), inset -3px -3px 6px var(--luz);
  --hundido-2: inset 5px 5px 10px var(--sombra-relieve), inset -5px -5px 10px var(--luz);
  --borde-relieve: rgba(24, 24, 73, 0.06);

  /* ---------- vidrio (EN RETIRO) ----------
     El vidrio esmerilado no convive con el neumorfismo: una superficie translúcida no puede ser
     del mismo color que la página. Mientras sus tres consumidores (.panel, .admin-top,
     .nav-inferior) no migren, valen el fondo; después se borran de los tres temas. */
  --vidrio-top: var(--fondo);
  --vidrio-nav: var(--fondo);
  --vidrio-panel: var(--fondo);
  --velo: rgba(24, 24, 73, 0.45); /* fondo detrás de los bottom sheets */

  /* ---------- tintes suaves (fondos de chip / ícono-círculo / hover) ----------
     Un alpha del color de texto NO sobrevive el cambio de tema: cada tema declara el suyo. */
  --hover-suave: rgba(24, 24, 73, 0.05);
  --neutro-suave: rgba(24, 24, 73, 0.07);
  --acento-suave: rgba(81, 75, 168, 0.12);
  --acento-borde: rgba(81, 75, 168, 0.4);
  --menta-suave: rgba(11, 102, 69, 0.12);
  --error-suave: rgba(164, 35, 28, 0.1);

  /* ---------- botón primario: Deep sólido ---------- */
  --btn-primario-fondo: #181849;
  --btn-primario-texto: #f5f4fc;

  /* ---------- atmósfera (EN RETIRO) ----------
     Cualquier degradado debajo de una superficie con relieve rompe el truco de que la superficie
     tenga el color de la página. Se borra junto con el background-image del body. */
  --atmosfera: none;
}

/* ============================================================
   TEMA OSCURO
   Escena: el dueño revisa las ventas del día a las once de la
   noche, en la cama, con el brillo al mínimo.
   Azul marino sacado de Deep, no carbón: el neumorfismo necesita
   un fondo con algo de luminancia para que la luz del relieve se
   vea. #1c1e3a es el techo: el acento #8f86e0 se usa como texto y
   con un fondo más claro (#25284d) ya cae a 4.47:1.
   ============================================================ */
:root[data-tema="oscuro"] {
  color-scheme: dark;

  --fondo: #1c1e3a;
  --superficie-0: #15172e;
  --superficie-1: var(--fondo);
  --superficie-2: var(--fondo);
  --superficie-3: #262947;
  --superficie-4: #303455;

  /* 0.56 y no el 0.48 de antes: este fondo es más claro que #131313, y con 0.48 da 4.44:1. */
  --texto: var(--blanco);
  --texto-2: rgba(245, 245, 240, 0.74);
  --texto-3: rgba(245, 245, 240, 0.56);

  --linea: rgba(245, 245, 240, 0.1);
  --linea-fuerte: rgba(245, 245, 240, 0.18);

  /* --acento-fuerte es lavanda, más CLARO que el acento: en un tema oscuro, "fuerte" es más lejos
     del fondo. El #514ba8 que tenía llevaba --sobre-acento (Deep) a 2.31:1 en el botón Acreditar
     del escáner. */
  --acento: #8f86e0; /* Soft */
  --acento-fuerte: #a49df0;
  --sobre-acento: #181849; /* Deep */

  --menta: #8bd6b4;
  --sobre-menta: #00351f;

  --error: #ffb4ab;
  --error-fondo: rgba(147, 0, 10, 0.22);
  --error-borde: rgba(255, 180, 171, 0.35);

  --shadow-1: 0 6px 18px -10px rgba(4, 5, 18, 0.6);
  --shadow-2: 0 18px 44px -20px rgba(4, 5, 18, 0.65);
  --shadow-3: 0 26px 60px -18px rgba(4, 5, 18, 0.75);
  --ring: 0 0 0 4px rgba(143, 134, 224, 0.3);
  --sombra-acento: 0 0 24px rgba(143, 134, 224, 0.3);
  --sombra-menta: 0 10px 22px -10px rgba(139, 214, 180, 0.6);

  /* La luz apenas se insinúa (7%): en oscuro, un brillo fuerte se lee como un borde blanco. */
  --luz: rgba(255, 255, 255, 0.07);
  --sombra-relieve: rgba(4, 5, 18, 0.6);
  --relieve-1: 4px 4px 10px var(--sombra-relieve), -3px -3px 8px var(--luz);
  --relieve-2: 6px 6px 16px var(--sombra-relieve), -5px -5px 12px var(--luz);
  --relieve-3: 0 -1px 0 var(--luz), 0 -10px 28px -12px var(--sombra-relieve);
  --hundido-1: inset 3px 3px 7px var(--sombra-relieve), inset -2px -2px 5px var(--luz);
  --hundido-2: inset 5px 5px 12px var(--sombra-relieve), inset -4px -4px 8px var(--luz);
  --borde-relieve: rgba(245, 245, 240, 0.05);

  --vidrio-top: var(--fondo);
  --vidrio-nav: var(--fondo);
  --vidrio-panel: var(--fondo);
  --velo: rgba(6, 7, 20, 0.6);

  --hover-suave: rgba(245, 245, 240, 0.05);
  --neutro-suave: rgba(245, 245, 240, 0.08);
  --acento-suave: rgba(143, 134, 224, 0.12);
  --acento-borde: rgba(143, 134, 224, 0.4);
  --menta-suave: rgba(139, 214, 180, 0.13);
  --error-suave: rgba(255, 180, 171, 0.12);

  --btn-primario-fondo: var(--blanco);
  --btn-primario-texto: var(--superficie-0);

  --atmosfera: none;
}

/* ============================================================
   TEMA ALTO CONTRASTE
   No es decorativo: es el modo para atender bajo el sol (local
   con vidriera, puesto al aire libre), donde el gris sobre gris
   directamente desaparece. Por eso:
   - negro PURO de fondo (un #131313 ya refleja y lava);
   - la jerarquía por opacidad casi se elimina — --texto-2 y
     --texto-3 se acercan al blanco en vez de desvanecerse;
   - los bordes suben a alpha alto: son la única separación que
     queda cuando el brillo del sol come las diferencias sutiles;
   - los acentos se SATURAN (lima/verde puros sobre negro);
   - es PLANO a propósito: sin relieve, sin sombras ni glows. Bajo
     el sol no aportan profundidad, solo ensucian el borde. Las
     mismas reglas que en claro y oscuro dibujan relieve, acá
     dibujan un borde blanco (--borde-relieve) y nada más.
   ============================================================ */
:root[data-tema="alto-contraste"] {
  color-scheme: dark;

  --fondo: #000000;
  --superficie-0: #000000;
  --superficie-1: #000000;
  --superficie-2: #0b0b0b;
  --superficie-3: #1c1c1c;
  --superficie-4: #2e2e2e;

  --texto: #ffffff;
  --texto-2: #ededed;
  --texto-3: #d4d4d4;

  --linea: rgba(255, 255, 255, 0.55);
  --linea-fuerte: rgba(255, 255, 255, 0.82);

  --acento: #c9ec5e; /* Lima */
  --acento-fuerte: #a9d13a; /* lima más oscuro, hover/press */
  --sobre-acento: #000000;

  --menta: #00e58c;
  --sobre-menta: #000000;

  --error: #ff8a7a;
  --error-fondo: rgba(255, 138, 122, 0.18);
  --error-borde: rgba(255, 138, 122, 0.75);

  /* `none` y no un rgba transparente: una sombra invisible sigue costando pintura por scroll en el
     teléfono barato del mostrador, que es justo donde se usa este tema. */
  --shadow-1: none;
  --shadow-2: none;
  --shadow-3: none;
  --ring: 0 0 0 4px rgba(201, 236, 94, 0.6);
  --sombra-acento: none;
  --sombra-menta: none;

  /* Plano: los colores valen transparent (se pueden componer) y los compuestos, none (van solos). */
  --luz: transparent;
  --sombra-relieve: transparent;
  --relieve-1: none;
  --relieve-2: none;
  --relieve-3: none;
  --hundido-1: none;
  --hundido-2: none;
  --borde-relieve: rgba(255, 255, 255, 0.55);

  /* Sin translucidez: el vidrio esmerilado es lo primero que se pierde con reflejo en pantalla. */
  --vidrio-top: #000000;
  --vidrio-nav: #000000;
  --vidrio-panel: #000000;
  --velo: rgba(0, 0, 0, 0.85);

  /* 12% y no 22%: la pastilla "inactivo" (su único uso) no se apoya en el fondo de la página sino
     en la fila que la contiene (--superficie-2). Medida ahí, con 22% daba 5.97:1 y con 16% daba
     6.78:1; en este tema todo texto pide 7:1. Con 12% da 7.31:1. */
  --hover-suave: rgba(255, 255, 255, 0.18);
  --neutro-suave: rgba(255, 255, 255, 0.18);
  --acento-suave: rgba(201, 236, 94, 0.22);
  --acento-borde: rgba(201, 236, 94, 0.85);
  --menta-suave: rgba(0, 229, 140, 0.22);
  --error-suave: rgba(255, 138, 122, 0.12);

  --btn-primario-fondo: #ffffff;
  --btn-primario-texto: #000000;

  --atmosfera: none;
}
```

- [ ] **Paso 3: la regla `html`**

Reemplazar el cuerpo de la primera regla `html` (L267-272 originales):

```css
html {
  height: 100%;
  /* El del tema por defecto (claro). Los bloques :root[data-tema=…] de arriba lo pisan por
     especificidad (0,2,0 contra 0,0,1), así que el orden en el archivo no importa acá. Si cambia
     el default, cambia esto: lo verifica lib/tema.test.ts. */
  color-scheme: light;
}
```

- [ ] **Paso 4: fuera de la hoja**

`lib/tema.ts`:

```ts
export const TEMA_POR_DEFECTO: Tema = 'claro';
```

y en `ETIQUETAS_TEMA`: `oscuro: { nombre: 'Oscuro', ayuda: 'Para usar de noche', icono: 'dark_mode' }`,
`claro: { nombre: 'Claro', ayuda: 'El predeterminado', icono: 'light_mode' }`. El ORDEN de `TEMAS`
no se toca.

`app/manifest.ts` L10-11: `'#131313'` → `'#e7e6f0'` en `background_color` y `theme_color`.

`app/mi-tarjeta/layout.tsx` L12: `statusBarStyle: 'black-translucent'` → `statusBarStyle: 'default'`,
con este comentario encima de la línea:

```ts
    // 'default' (íconos oscuros) y no 'black-translucent' (íconos blancos): desde el 2026-09-20 el
    // tema por defecto es claro, y los íconos blancos sobre un fondo claro no se ven.
```

- [ ] **Paso 5: correr y ver verde**

Todas las pruebas de diseño en verde. `npm run typecheck` limpio.

- [ ] **Paso 6: mutaciones**

Las filas de la spec marcadas **(F3+)** y **(F3)**: alto contraste plano, piso de relieve,
`color-scheme`, default, y las tres de "valores nuevos". Reportá el mensaje real de cada una.

- [ ] **Paso 7: sincronizar el tablero y commit**

```bash
cp app/globals.css public/tablero-neumorfico/propuesta.css
git add app/globals.css lib/tema.ts lib/tema.test.ts lib/diseno/temas.test.ts app/manifest.ts app/mi-tarjeta/layout.tsx public/tablero-neumorfico/propuesta.css
git commit -m "Tokens neumorficos en los tres temas; el claro pasa a ser el default" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Verificación del controlador:** en el tablero, `getComputedStyle(document.documentElement)` de
cada token en los tres iframes contra lo que da el parser; capturas a 375px. Recorrer `/` en los
tres temas (el formulario de demo sigue al tema: se anota si se ve distinto, bloquea si queda
ilegible).

---

### Tarea 7: primitivas

**Archivos:**
- Modificar: `app/globals.css`
- Modificar: `app/comercio/(protegido)/branding/FormularioReverso.tsx`
- Modificar: `lib/diseno/temas.test.ts` (selectores de `.field`)
- Sincronizar: `public/tablero-neumorfico/propuesta.css`

Aplicá las filas de la tabla de migración de la spec para: `.panel`, `.field`, `.btn-primary`,
`.btn-acento`, `.btn-borde`, `.admin-lista`, `.admin-fila`, `.icono-circulo` (sin cambio),
`.pastilla` (sin cambio), `.alerta`/`.nota`, `body`. Lo que sigue es lo que la tabla no deja
escrito del todo.

- [ ] **Paso 1: `.field`**

Buscá TODAS las reglas que nombran `.field input` o `.field select`:
`grep -n "\.field input\|\.field select" app/globals.css`. Reemplazá las tres reglas base
(`.field input, .field select { … }`, `.field input::placeholder { … }` y
`.field input:focus, .field select:focus { … }`) por:

```css
/* El hundido: el campo es un pozo en la superficie. Los :not() dejan afuera los controles que no
   son un campo de texto (radios, checkboxes, rangos, archivos, colores), que viven dentro de un
   .field pero no son un pozo. */
.field :is(input, select, textarea):not([type="checkbox"], [type="radio"], [type="range"], [type="file"], [type="color"]) {
  font-family: var(--font-body);
  font-size: 1rem;
  color: var(--texto);
  background: var(--superficie-0);
  border: 1px solid var(--borde-relieve);
  border-radius: var(--radius-control);
  box-shadow: var(--hundido-1);
  padding: 13px 14px;
  transition: border-color 0.18s ease;
}
.field textarea {
  resize: vertical;
  line-height: 1.55;
}
.field :is(input, textarea)::placeholder {
  color: var(--texto-3);
}
/* Al enfocar cambia SOLO el borde: el pozo sigue hundido, y el anillo lo dibuja el outline global
   de :focus-visible. */
.field :is(input, select, textarea):focus {
  border-color: var(--acento);
}
```

Las demás reglas que nombran `.field input[...]` se dejan: ya no compiten con la regla base, porque
esta las excluye con los `:not()`. Son estas cinco, y tenés que decir en el reporte qué hiciste con
cada una: L1118 (`.subida-imagen .field input[type='file']`), L1142 y L1150 (los resets de
`type="file"`), L1154 (`::file-selector-button`, que sí cambia — ver abajo) y L445
(`.field select option`). **Y corregí el comentario de L1345-1346**, que dice que `.field input` le
pone borde, fondo y 13px de padding a *todo* input: con los `:not()` deja de ser cierto.

La única que sí cambia es `::file-selector-button` (L1154-1165): pasa a elevada, y como queda del
color de la página lleva borde, con el padding compensado para que la caja no crezca.

```css
.field input[type="file"]::file-selector-button {
  font-family: var(--font-body);
  font-weight: 600;
  font-size: 0.8rem;
  color: var(--texto);
  background: var(--superficie-1);
  border: 1px solid var(--borde-relieve);
  border-radius: var(--radius-pill);
  box-shadow: var(--relieve-1);
  padding: 6px 13px;
  margin-right: 10px;
  cursor: pointer;
}
```

En `lib/diseno/temas.test.ts`, en `PARES_REGLA`, reemplazar las dos entradas de `.field`:

```ts
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
```

- [ ] **Paso 2: el foco global y `body`**

Justo después de la regla `a { … }` de la base:

```css
/* Foco: outline y no box-shadow. No pelea con el relieve ni con el hundido, no se compone con
   ningún token que valga none, y sobrevive a forced-colors. Especificidad 0 (:where): la regla de
   foco de cualquier componente le gana. */
:where(a, button, input, select, textarea, summary, [tabindex]):focus-visible {
  outline: 2px solid var(--acento);
  outline-offset: 2px;
}
```

En `body`: borrar `background-image: var(--atmosfera);`, `background-attachment: fixed;` y su
comentario, y agregar `accent-color: var(--acento);` (radios, checkboxes y rangos nativos en
violeta).

- [ ] **Paso 3: el resto de las primitivas**

Fila por fila, de la tabla de la spec. Precisiones:
- `.btn-primary`: `box-shadow: var(--relieve-1)` en reposo; sumá `box-shadow 0.18s ease` a su
  `transition`; `:active` → `transform: scale(0.98); box-shadow: none;`; `:disabled` suma
  `box-shadow: none;`.
- `.btn-acento`: `border-radius: var(--radius-control)`; `box-shadow: var(--relieve-1)` en reposo;
  el hover conserva `box-shadow: var(--sombra-acento)`; `:active` suma `box-shadow: none;`.
- `.btn-borde`: `background: var(--superficie-1)`; `border: 1px solid var(--borde-relieve)`;
  `box-shadow: var(--relieve-1)` en reposo; hover `box-shadow: var(--relieve-2)` (sin el cambio de
  `background` de hoy); `:active` `box-shadow: var(--hundido-2); transform: scale(0.97);`; sumá
  `box-shadow` a su `transition`.
- `.admin-fila`: el hover y el active de hoy pasan a `:is(a, button).admin-fila:hover` /
  `:is(a, button).admin-fila:active`. Usá la curva `cubic-bezier(0.22, 1, 0.36, 1)` para el
  `transform`.
- `.alerta` y `.nota`: `border-radius: var(--radius-control)`.
- `.panel`: además, borrar `--vidrio-panel` y `--atmosfera` de los **tres** bloques de tema.

- [ ] **Paso 4: `FormularioReverso.tsx`**

Borrar `textareaEnfocado`, `estiloTextarea` y su comentario (L139-157), los `onFocus`/`onBlur` del
textarea (L265-266) y su `style={estiloTextarea}` (L275). Quitar `type CSSProperties` del import de
L3, y `useState` si queda sin uso. Correr `npm run lint -- "app/comercio/(protegido)/branding/FormularioReverso.tsx"` y
`npm run typecheck`.

- [ ] **Paso 5: correr, mutar, sincronizar y commit**

Pruebas de diseño en verde. Mutaciones:
- en `.field :is(…)::placeholder`, `color: var(--texto-3)` → `var(--linea-fuerte)` → debe fallar el
  par por regla del placeholder en **claro y oscuro** (≈1.6:1 y ≈1.7:1). **No falla en
  alto-contraste**, y está bien: ahí `--linea-fuerte` es blanco al 82% sobre negro, que por sí solo
  da contraste de sobra. La mutación protege los dos temas donde ese token es tenue;
- en `.btn-borde:active:not(:disabled)` (ese es el selector real, L538), escribir
  `box-shadow: var(--hundido-2), 0 0 0 2px var(--acento)` → debe fallar la prueba de composición con
  `[composición] .btn-borde:active:not(:disabled) compone var(--hundido-2), que vale none en
  alto-contraste` (el mensaje imprime el selector completo).

```bash
cp app/globals.css public/tablero-neumorfico/propuesta.css
git add app/globals.css lib/diseno/temas.test.ts "app/comercio/(protegido)/branding/FormularioReverso.tsx" public/tablero-neumorfico/propuesta.css
git commit -m "Primitivas neumorficas: panel, campos hundidos, botones, filas y foco con outline" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Verificación del controlador:** tablero en los tres temas (campos de todos los tipos, botones,
filas); recorrido con Tab; en la app, `/comercio/login`, `/registro-comercio` y lo que cargue sin
`.env.local`.

---

### Tarea 8: header, barra y hojas

**Archivos:**
- Modificar: `app/globals.css`
- Modificar (solo comentarios): `app/_ui/SelectorTema.tsx:53-59`,
  `app/comercio/(protegido)/MenuOpciones.tsx:70-76`, `app/comercio/(protegido)/SelectorContexto.tsx:90-96`,
  `app/comercio/(protegido)/sucursales/ModalAgregarLocal.tsx:135`
- Sincronizar: `public/tablero-neumorfico/propuesta.css`

- [ ] **Paso 1: medir antes**

Antes de tocar nada, el controlador mide en el tablero el ancho de `.contexto-etiqueta` a 360 y
320px con `getBoundingClientRect`. Se puede medir en cualquier momento de esta tarea con el
interruptor **"Antes"** del tablero, porque ninguna tarea anterior toca `.contexto-pastilla`. Esos
números tienen que quedar idénticos al final.

- [ ] **Paso 2: CSS**

Filas de la tabla de la spec para `.admin-top`, `.admin-salir`, `.nav-inferior`/`.nav-destacado`,
`.menu-boton`, `.menu-destacado`, `.sheet-panel`, `.sheet-fila`, `.contexto-pastilla`,
`.filtro-chip` y `.filtro-chips` (gap 12).

**Los hovers que hoy oscurecen pasan a subir:** `.admin-salir:hover` (L885-888) y
`.menu-boton:hover` (L1478-1481) usan `background: var(--superficie-4)`, y `.menu-destacado:hover`
(L1499-1502) usa `var(--superficie-3)`. En los tres, el `background` deja de cambiar y el hover pasa
a `box-shadow: var(--relieve-2)`: oscurecer contradice que la superficie sea del color de la página. Borrar los `backdrop-filter` y `-webkit-backdrop-filter`
de `.admin-top` y `.nav-inferior`, y `--vidrio-top` y `--vidrio-nav` de los **tres** bloques de tema.
El comentario de `.admin-top` (L849-851) se reescribe: el header ya no es translúcido.

Nuevo, después de las reglas de `.sheet-fila`:

```css
/* La fila activa ya dibuja un outline de 2px (marca el estado). Sin esto, el outline global de
   :focus-visible empata en especificidad y el foco quedaría indistinguible del estado. */
.sheet-fila-activa:focus-visible {
  outline-width: 3px;
  outline-offset: 2px;
}
```

- [ ] **Paso 3: comentarios de los portales**

En `SelectorTema.tsx`, `MenuOpciones.tsx` y `SelectorContexto.tsx`: el comentario explica que el
portal existe porque el header tiene `backdrop-filter`. El portal **se mantiene**; el comentario
pasa a decir que, si vuelve un `backdrop-filter`, `transform` o `filter` al header, el
`position: fixed` de adentro dejaría de ser relativo a la ventana. En `ModalAgregarLocal.tsx` solo
cambia la última cláusula (L135): la razón principal (el `transform` de `.reveal`) sigue siendo
cierta.

- [ ] **Paso 4: correr, mutar, sincronizar y commit**

Pruebas de diseño en verde (el par `.nav-inferior a` ahora mide sobre `--fondo` opaco). Mutación:
en `.nav-inferior`, `box-shadow: var(--relieve-3)` → `var(--relieve-3), 0 -1px 0 var(--linea)` →
debe fallar la composición.

```bash
cp app/globals.css public/tablero-neumorfico/propuesta.css
git add app/globals.css app/_ui/SelectorTema.tsx "app/comercio/(protegido)/MenuOpciones.tsx" "app/comercio/(protegido)/SelectorContexto.tsx" "app/comercio/(protegido)/sucursales/ModalAgregarLocal.tsx" public/tablero-neumorfico/propuesta.css
git commit -m "Header, barra inferior y hojas sin vidrio: relieve hacia arriba y fila activa con acento" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Verificación del controlador:** ancho de `.contexto-etiqueta` idéntico a 360 y 320px; la barra en
el tablero; abrir y cerrar con Escape las hojas que carguen en la app.

---

### Tarea 9: pantallas específicas y estilos inline

**Archivos:**
- Modificar: `app/globals.css`, `lib/diseno/temas.test.ts`
- Modificar: `app/comercio/(protegido)/reportes/page.tsx`, `app/comercio/(protegido)/escanear/Escaner.tsx`,
  `app/admin/(protegido)/comercios/FormularioAccesoDueno.tsx`,
  `app/comercio/(protegido)/programas/FormularioConfiguracionPrograma.tsx`,
  `app/registro-comercio/FormularioRegistro.tsx`
- Modificar: `public/tablero-neumorfico/componentes.html` (las clases nuevas)
- Sincronizar: `public/tablero-neumorfico/propuesta.css`

- [ ] **Paso 1: CSS de las familias**

Filas de la spec para `.metric-carta` (y `.metric-etiqueta`/`.metric-sub`: `opacity` → `color`),
`.portal-cuenta` (con `.portal-cuenta-activa:focus-visible { outline-width: 3px; outline-offset: 2px; }`),
`.portal-recompensa`, `.escaner-marco`, `.subida-imagen`, y los gaps (`.panel-atajos` 14,
`.portal-cuentas`/`.portal-recompensas` 12, `.metric-pila` 20 en L1010 **y** en el `@media` de
L1067). En `.subida-imagen`: borrar el literal naranja (L1111) y reescribir su comentario (L1105-1110)
con la razón nueva (el `box-shadow` del hover reemplazaba al hundido y aplanaba el pozo); el hover
conserva `box-shadow: var(--hundido-1)`.

- [ ] **Paso 2: clases nuevas**

Al final de la sección de formularios:

```css
/* ---------- piezas hundidas sueltas ----------
   El hundido de .field para un control que no vive dentro de un .field (el "Puntos a sumar" del
   escáner, el link de acceso del dueño). Sin font-family A PROPÓSITO: el del escáner lleva además
   .dato-mono, y con la misma especificidad la que apareciera después en el archivo le pisaría la
   tipografía a los puntos. */
.campo-suelto {
  font-size: 1rem;
  color: var(--texto);
  background: var(--superficie-0);
  border: 1px solid var(--borde-relieve);
  border-radius: var(--radius-control);
  box-shadow: var(--hundido-1);
  padding: 13px 14px;
  transition: border-color 0.18s ease;
}
.campo-suelto::placeholder {
  color: var(--texto-3);
}
.campo-suelto:focus {
  border-color: var(--acento);
}

/* Contenedor hundido de solo lectura: algo que se muestra pero no se edita ahí. */
.pozo {
  background: var(--superficie-0);
  border: 1px solid var(--borde-relieve);
  border-radius: var(--radius-control);
  box-shadow: var(--hundido-1);
  padding: 12px 14px;
}

/* Barra de progreso o de gráfico: la pista hundida, el relleno de acento. El ancho del relleno lo
   pone el JSX: es un dato, no un estilo. */
.pista {
  height: 10px;
  border-radius: var(--radius-pill);
  background: var(--superficie-0);
  box-shadow: var(--hundido-1);
  overflow: hidden;
}
.pista-relleno {
  height: 100%;
  border-radius: inherit;
  background: var(--acento);
}

/* Una opción elegible (el plan en el alta de comercio). La elegida se marca con el acento y no con
   el relieve: el relieve comunica forma, nunca estado. */
.opcion-plan {
  background: var(--superficie-1);
  border: 1px solid var(--borde-relieve);
  border-radius: var(--radius-control);
  box-shadow: var(--relieve-1);
  padding: 12px 14px;
  cursor: pointer;
}
.opcion-plan-activa {
  border-color: var(--acento);
  outline: 1px solid var(--acento);
}
```

- [ ] **Paso 3: JSX**

`reportes/page.tsx` L320-322:

```tsx
                      <div className="pista" style={{ flex: 1 }}>
                        <div className="pista-relleno" style={{ width: `${pct}%` }} />
                      </div>
```

`Escaner.tsx` L408-424: el `<input>` queda con `className="dato-mono campo-suelto"` y
`style={{ width: 90, padding: '0 12px' }}` (el `padding` vertical 0 se conserva: la fila estira el
campo a la altura del botón).

`FormularioAccesoDueno.tsx` L134-142: `className="campo-suelto"` y
`style={{ width: '100%', fontSize: '0.78rem', padding: '10px 12px' }}`.

`FormularioConfiguracionPrograma.tsx` L219-228: el `<div aria-live="polite">` queda con
`className="pozo"` y `style={{ marginBottom: 16 }}`.

`FormularioRegistro.tsx` L142-157: el contenedor pasa de `gap: 8` a `gap: 12` (con 8 la sombra de
una opción pisa la siguiente), y cada `<label>` queda con
`className={`opcion-plan${plan === p.valor ? ' opcion-plan-activa' : ''}`}` y
`style={{ display: 'flex', alignItems: 'center', gap: 10 }}`.

Después: `grep -rn "var(--superficie" app --include=*.tsx | grep -v _inicio` tiene que quedar
**vacío**. Hoy devuelve exactamente los 6 archivos que tocan esta tarea y la 7 (ningún TSX del pase
ni del QR usa `var(--superficie`), así que al terminar no debe quedar ninguno. Reportá la salida.

- [ ] **Paso 4: pruebas**

En `PARES_REGLA`, reemplazar las dos entradas de `.metric-carta.naranja` / `.metric-carta.menta` por
cuatro, **por variante y no por la regla base**: `.metric-carta.naranja .metric-valor` y
`.metric-carta.menta .metric-valor` sobre `.metric-carta` (mínimo 3, texto grande), y lo mismo con
`.metric-etiqueta` (4.5). Las cuatro con `texto: true` (en alto contraste suben a 7:1, y pasan: el
acento lima sobre negro da 15.64:1). Las cinco métricas de la app llevan `.naranja` o `.menta`, así
que medir la regla base mediría un color que nunca se ve. Escribí los selectores exactos que dejaste
en el CSS. Agregá los pares por regla de `.campo-suelto` (7) y `.campo-suelto::placeholder` (4.5).

Mutaciones: `.metric-etiqueta` con `color: var(--linea-fuerte)` → falla su par; `.campo-suelto`
con `background: #ffffff` → lanza `la regla .campo-suelto pinta background con #ffffff, no con un
token`.

- [ ] **Paso 5: tablero, lint, sincronizar y commit**

Agregá a `componentes.html` una sección con `.campo-suelto`, `.pozo`, `.pista` (con relleno al 60%)
y dos `.opcion-plan` (una activa), con `data-par` en el campo suelto.

```bash
npm run lint
npm run typecheck
cp app/globals.css public/tablero-neumorfico/propuesta.css
git add -A app lib public/tablero-neumorfico
git commit -m "Metricas neutras, portal, escaner y estilos inline a clases (pista, pozo, campo suelto, opcion de plan)" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

(Revisá `git status` antes del `add -A`: nada fuera de esos directorios, y ningún `.env*`.)

**Verificación visual del rediseño (controlador), acá y no antes** — es la mitigación del riesgo
principal y recién ahora el tablero muestra el CSS nuevo:
`window.medirTablero()` en los tres iframes y comparar contra lo que calcula la prueba desde el CSS
(si difieren, gana el navegador y hay un defecto en el parser); capturas a 375 y 320px en los tres
temas; recorrido con Tab (el foco se ve en los tres); interruptores "sol" y "grises" — los estados
activos tienen que seguir distinguiéndose sin el relieve.

---

### Tarea 10: cierre

**Archivos:**
- Modificar: `DESIGN.md`, `PRODUCT.md`, `docs/superpowers/ESTADO-Y-PLAN-2026-07-28.md`

- [ ] **Paso 1: verificación formal del tablero**

```bash
git diff --no-index --ignore-cr-at-eol public/tablero-neumorfico/propuesta.css app/globals.css
```

Esperado: sin salida.

- [ ] **Paso 2: documentación**

`DESIGN.md`, según la sección "Documentos a actualizar al cierre" de la spec: identidad, tabla de
tokens con los valores reales de los tres temas (hoy describe el naranja), una sección "Relieve" con
las cinco reglas del sistema, el contrato de la prueba nueva (qué mide y cómo se corre), las
excepciones (el literal de `.subida-imagen` ya no existe), la regla de hex/rgba en lugar de oklch
para tokens de tema, y la escena física del claro como default.

`PRODUCT.md`: "claro por defecto"; revisar la anti-referencia "navy y gris" frente al azul marino
del oscuro, y decir por qué no la contradice (o ajustarla).

`docs/superpowers/ESTADO-Y-PLAN-2026-07-28.md`: sección nueva al final, con lo hecho, lo pendiente
de Daniel (copiar `.env.local` y correr la suite completa; revisar el tablero; QA en teléfono real
a pleno sol; avisar a los pilotos; decidir si la Tarea 4 se publica sola) y que **el tablero se
borra antes de integrar a `master`**.

- [ ] **Paso 3: comprobaciones**

```bash
npm run lint
npm run typecheck
npx next build
```

`/` tiene que seguir saliendo `○ (Static)`. Si el build falla por falta de `.env.local`, anotalo
como pendiente de Daniel con el comando exacto; si falla por otra cosa, es un defecto.

- [ ] **Paso 4: commit**

```bash
git add DESIGN.md PRODUCT.md docs/superpowers/ESTADO-Y-PLAN-2026-07-28.md
git commit -m "Docs: sistema neumorfico, prueba de contraste y pendientes de revision" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

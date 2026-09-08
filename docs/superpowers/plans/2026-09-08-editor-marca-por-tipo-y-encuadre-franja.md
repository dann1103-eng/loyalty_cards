# Editor de marca por tipo de tarjeta y encuadre de la foto de la franja — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la vista previa del editor de marca replique el pass real para los ocho tipos de tarjeta, y que el dueño pueda encuadrar la foto de fondo de la franja (modo, posición, zoom, arrastre) y ese encuadre llegue al pass de Apple, a las dos imágenes de Google y al cartel.

**Architecture:** Un módulo puro (`lib/comercio/encuadreFranja.ts`) decide qué parte de la foto se ve dado el marco; lo consumen la vista previa (CSS), la composición del pass (next/og), la ruta nueva de portada de clase de Google y el SVG del cartel. El encuadre vive en cuatro columnas nuevas (migración 0032) en `comercios` (NOT NULL con default) y `programas_tarjeta` (nullable), y **viaja con la foto** dentro de `brandingEfectivo`. El frente del pass (campo primario/secundario) se extrae a `lib/tarjetas/frentePase.ts` y lo comparten `generatePass` y la vista previa.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, TypeScript, Supabase (Postgres, sin DDL desde el asistente), next/og (satori) + sharp para imágenes, vitest (integración contra la BD remota, `environment: 'node'`, sin pruebas de componentes).

**Spec:** `docs/superpowers/specs/2026-09-08-editor-marca-por-tipo-y-encuadre-franja-design.md` — leelo antes de cada tarea; manda sobre este plan si difieren.

---

## Reglas para TODAS las tareas

- **Checkout:** el trabajo vive en el worktree
  `C:\Users\Daniel\Desktop\Proyectos\Loyalty Cards\.claude\worktrees\brand-editor-preview-adjustments-e82e88`
  (rama `claude/brand-editor-preview-adjustments-e82e88`). Verificalo con
  `git -C "<esa ruta>" branch --show-current` ANTES de tocar nada. Prefijá cada comando con `cd "<esa ruta>" &&` y usá rutas absolutas en Read/Write/Edit. `node_modules` es una junction al checkout principal y `.env.local` ya está copiado: `npx vitest run <archivo>` y `npx tsc --noEmit` funcionan ahí.
- **Español** en identificadores, comentarios y mensajes. Comentarios que digan POR QUÉ, no qué.
- **TDD:** prueba en rojo → mínimo para verde → mutación en las ramas críticas (romper la línea, confirmar que la prueba FALLA por el motivo correcto, restaurar). Anotá en el comentario de la prueba qué mutación atrapa.
- **Pruebas de integración** usan `test/fixtures/entornoComercio.ts` (`crearEntorno`, `entorno.crearComercio`, `entorno.obtenerProgramaPrincipal`, `entorno.limpiar()` en `afterEach`). Nunca toques Google real: mockeá `./walletClient` como en `lib/google/syncClase.test.ts`.
- **No inicies el dev server** (`npm run dev`) desde un subagente. La verificación en navegador la hace el controlador.
- **Commits:** `git -c user.name="Daniel" -c user.email="268727888+dann1103-eng@users.noreply.github.com" commit -m "<titulo sin acentos>" -m "<cuerpo>" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`. Títulos en español SIN tildes (así están los commits del repo). Nunca `git add -A`: listá los archivos.
- **Typecheck al final de cada tarea:** `npx tsc --noEmit` tiene que salir limpio. Si una tarea deja un tipo obligatorio nuevo que rompe consumidores que la tarea no cubre, la tarea NO está terminada: arreglalos en la misma tarea (es lo que el spec pide del compilador).
- **Migración 0032:** hasta que el usuario la aplique en Studio, las pruebas que ESCRIBEN o LEEN las columnas nuevas contra la BD fallan. Las tareas están ordenadas para que las puras (1, 2, 4) no dependan de eso. La tarea 3 produce el SQL; el controlador se lo pasa al usuario.

---

### Task 1: `frentePase` — el frente del pass en un solo lugar

**Files:**
- Create: `lib/tarjetas/frentePase.ts`
- Create: `lib/tarjetas/frentePase.test.ts`
- Modify: `lib/apple/generatePass.ts:157-192`

- [ ] **Step 1: Escribir las pruebas (rojo)**

```ts
// lib/tarjetas/frentePase.test.ts
import { describe, it, expect } from 'vitest';
import { frentePase } from './frentePase';

// EL frente del pass: qué va en el campo primario (sobre la franja) y qué en el secundario (debajo).
// Vivía inline en generarPassApple y la vista previa lo re-adivinaba con su propio if/else — que es
// como la vista previa de una membresía terminó diciendo "PUNTOS 0" (2026-09-08).
describe('frentePase', () => {
  it('membresía, cupón y descuento: ningún campo (el pase no lleva contador)', () => {
    for (const tipo of ['membresia', 'cupon', 'descuento']) {
      expect(frentePase({ tipoTarjeta: tipo, puntos: 0, selloMeta: null, hayGrilla: false })).toEqual({
        primario: null,
        secundario: null,
      });
    }
  });

  it('puntos: primario "PUNTOS" con el número pelado (para numberStyle)', () => {
    expect(frentePase({ tipoTarjeta: 'puntos', puntos: 120, selloMeta: null, hayGrilla: false })).toEqual({
      primario: { etiqueta: 'PUNTOS', valor: '120', numero: 120 },
      secundario: null,
    });
  });

  it('gift card: primario "SALDO" en dólares y SIN número (el entero son centavos)', () => {
    // MUTACIÓN: devolver `numero: puntos` acá reintroduce el "PUNTOS 2500" del 2026-07-30.
    expect(frentePase({ tipoTarjeta: 'gift_card', puntos: 2500, selloMeta: null, hayGrilla: false })).toEqual({
      primario: { etiqueta: 'SALDO', valor: '$25.00', numero: null },
      secundario: null,
    });
  });

  it('sellos CON grilla: nada sobre la franja (taparía los sellos) y "7 de 10" debajo', () => {
    // MUTACIÓN: ignorar `hayGrilla` (tratarlo siempre como false) sube el texto encima de la grilla.
    expect(frentePase({ tipoTarjeta: 'sellos', puntos: 7, selloMeta: 10, hayGrilla: true })).toEqual({
      primario: null,
      secundario: { etiqueta: 'SELLOS', valor: '7 de 10', numero: null },
    });
  });

  it('sellos SIN grilla (franja propia o composición fallida): primario "7 de 10 sellos"', () => {
    // MUTACIÓN: tratar `hayGrilla` siempre como true deja la franja propia sin ningún contador encima.
    expect(frentePase({ tipoTarjeta: 'sellos', puntos: 7, selloMeta: 10, hayGrilla: false })).toEqual({
      primario: { etiqueta: 'SELLOS', valor: '7 de 10 sellos', numero: null },
      secundario: null,
    });
  });

  it('sellos sin meta: cae al entero pelado, nunca "7 de null"', () => {
    expect(frentePase({ tipoTarjeta: 'sellos', puntos: 7, selloMeta: null, hayGrilla: true })).toEqual({
      primario: { etiqueta: 'SELLOS', valor: '7', numero: 7 },
      secundario: null,
    });
  });
});
```

- [ ] **Step 2: Correr y ver el rojo**

Run: `npx vitest run lib/tarjetas/frentePase.test.ts`
Expected: FALLA — `Cannot find module './frentePase'`.

- [ ] **Step 3: Implementar el módulo**

```ts
// lib/tarjetas/frentePase.ts
import { contadorPase } from './contadorPase';

// Qué va en el FRENTE del pass: el campo primario (Apple lo dibuja SOBRE la franja de un storeCard)
// y el secundario (debajo). Puro y compartido por generatePass y la vista previa del editor de
// marca: hasta el 2026-09-08 la vista previa tenía su propio if/else y le mostraba "PUNTOS 0" a una
// membresía, que en el pass real no lleva ningún contador.
export interface CampoFrente {
  etiqueta: string;
  valor: string;
  // El mismo dato como número pelado, o null cuando `valor` es texto compuesto. Es lo que decide si
  // Apple recibe `numberStyle` (ver generatePass).
  numero: number | null;
}

export interface FrentePase {
  primario: CampoFrente | null;
  secundario: CampoFrente | null;
}

export function frentePase(d: {
  tipoTarjeta: string;
  puntos: number;
  selloMeta: number | null;
  // Si la grilla de sellos EXISTE en la franja. En el pass depende de que la composición haya
  // tenido éxito y de que no haya franja propia; la vista previa asume composición exitosa.
  hayGrilla: boolean;
}): FrentePase {
  const esSellos = d.tipoTarjeta === 'sellos' && d.selloMeta != null && d.selloMeta > 0;

  if (esSellos && d.hayGrilla) {
    // La grilla se VE en la franja; texto encima taparía los círculos. El contador baja al secundario.
    return {
      primario: null,
      secundario: { etiqueta: 'SELLOS', valor: `${d.puntos} de ${d.selloMeta}`, numero: null },
    };
  }
  if (esSellos) {
    // Sin grilla el texto vuelve al primario, con la palabra: es lo único que dice qué se cuenta.
    return {
      primario: { etiqueta: 'SELLOS', valor: `${d.puntos} de ${d.selloMeta} sellos`, numero: null },
      secundario: null,
    };
  }

  // contadorPase decide etiqueta y formato SEGÚN EL TIPO, y devuelve null para los que no tienen
  // contador: ahí el pase no lleva número, en vez de un "PUNTOS 0" que no dice nada.
  const contador = contadorPase(d.tipoTarjeta, d.puntos, d.selloMeta);
  return {
    primario: contador ? { etiqueta: contador.etiqueta, valor: contador.valor, numero: contador.numero } : null,
    secundario: null,
  };
}
```

- [ ] **Step 4: Verde**

Run: `npx vitest run lib/tarjetas/frentePase.test.ts`
Expected: 6 passed.

- [ ] **Step 5: `generatePass` consume `frentePase`**

Reemplazar el bloque de `lib/apple/generatePass.ts` que va desde `const esSellos = datos.tipoTarjeta === 'sellos' && ...` hasta el cierre del `else { ... }` del contador (líneas 157–192) por:

```ts
  // Qué va en el frente del pass lo decide frentePase, compartido con la vista previa del editor de
  // marca: así la vista previa no puede decir algo distinto del pass ni en una palabra. `hayGrilla`
  // es "la composición tuvo éxito y no hay franja propia": con franja del comercio o composición
  // fallida, el texto vuelve al campo primario (mismo fallback seguro de siempre).
  const esSellos = datos.tipoTarjeta === 'sellos' && datos.selloMeta != null && datos.selloMeta > 0;
  const frente = frentePase({
    tipoTarjeta: datos.tipoTarjeta,
    puntos: datos.puntos,
    selloMeta: datos.selloMeta,
    hayGrilla: esSellos && strips !== null && !datos.stripUrl,
  });
  if (frente.secundario) {
    pass.secondaryFields.push({
      key: 'puntos',
      label: frente.secundario.etiqueta,
      value: frente.secundario.valor,
    });
  }
  if (frente.primario) {
    pass.primaryFields.push({
      key: 'puntos',
      label: frente.primario.etiqueta,
      // Número pelado → va como number CON numberStyle, para que iOS le ponga los separadores de
      // miles del teléfono. Valor ya formateado ("$25.00") → va como string y sin numberStyle:
      // aplicárselo haría que iOS intente reformatear lo que ya está formateado.
      ...(frente.primario.numero !== null
        ? { value: frente.primario.numero, numberStyle: 'PKNumberStyleDecimal' as const }
        : { value: frente.primario.valor }),
    });
  }
```

Agregar el import: `import { frentePase } from '@/lib/tarjetas/frentePase';` y quitar el de `contadorPase` si queda sin uso.

- [ ] **Step 6: Las pruebas existentes de generatePass siguen verdes**

Run: `npx vitest run lib/apple/generatePass.test.ts`
Expected: todo verde (cubren sellos con grilla → secondary, sellos sin meta → número, franja propia).

- [ ] **Step 7: Typecheck y commit**

Run: `npx tsc --noEmit` → limpio.

```bash
git add lib/tarjetas/frentePase.ts lib/tarjetas/frentePase.test.ts lib/apple/generatePass.ts
git commit -m "El frente del pass (primario/secundario) sale de un solo modulo" -m "frentePase es puro y lo compartiran generatePass y la vista previa del editor de marca, que hasta ahora re-adivinaba la regla con su propio if/else y le mostraba PUNTOS 0 a una membresia."
```

---

### Task 2: Módulo puro del encuadre

**Files:**
- Create: `lib/comercio/encuadreFranja.ts`
- Create: `lib/comercio/encuadreFranja.test.ts`

- [ ] **Step 1: Escribir las pruebas (rojo)**

```ts
// lib/comercio/encuadreFranja.test.ts
import { describe, it, expect } from 'vitest';
import {
  ENCUADRE_POR_DEFECTO,
  MARCO_FRANJA,
  colocarFoto,
  rectanguloVisible,
  focoTrasArrastre,
  validarEncuadre,
  encuadreDesdeFormulario,
  encuadreDelComercio,
  encuadreDelPrograma,
  porcentajesDeColocacion,
  type Encuadre,
} from './encuadreFranja';

// Foto apaisada 2:1 sobre el marco de la franja (375:123 ≈ 3.05:1): en 'llenar' sobra ALTO, en
// 'completa' sobra ANCHO. Con estos dos números todos los casos tienen holgura en un solo eje, lo
// que hace las aserciones exactas.
const FOTO = { ancho: 200, alto: 100 };
const MARCO = MARCO_FRANJA;

function encuadre(sobre: Partial<Encuadre> = {}): Encuadre {
  return { ...ENCUADRE_POR_DEFECTO, ...sobre };
}

describe('colocarFoto', () => {
  it('con el default reproduce el object-fit: cover centrado de siempre', () => {
    // escala = 375/200 = 1.875; alto escalado = 187.5; holgura vertical = 123 − 187.5 = −64.5
    const c = colocarFoto(FOTO, MARCO, encuadre());
    expect(c.ancho).toBeCloseTo(375);
    expect(c.alto).toBeCloseTo(187.5);
    expect(c.left).toBeCloseTo(0);
    expect(c.top).toBeCloseTo(-32.25);
  });

  it('focoY 0 muestra el borde superior y 100 el inferior', () => {
    // MUTACIÓN: invertir el signo de la holgura hace que 0 y 100 se crucen.
    expect(colocarFoto(FOTO, MARCO, encuadre({ focoY: 0 })).top).toBeCloseTo(0);
    expect(colocarFoto(FOTO, MARCO, encuadre({ focoY: 100 })).top).toBeCloseTo(-64.5);
  });

  it("'completa' deja la foto entera dentro del marco y el foco reparte la holgura sobrante", () => {
    // escala = min(375/200, 123/100) = 1.23; ancho escalado = 246; holgura horizontal = 129
    const izquierda = colocarFoto(FOTO, MARCO, encuadre({ modo: 'completa', focoX: 0 }));
    expect(izquierda.ancho).toBeCloseTo(246);
    expect(izquierda.alto).toBeCloseTo(123);
    expect(izquierda.left).toBeCloseTo(0);
    expect(colocarFoto(FOTO, MARCO, encuadre({ modo: 'completa', focoX: 100 })).left).toBeCloseTo(129);
  });

  it('zoom 200 duplica el tamaño sobre la escala base del modo', () => {
    // MUTACIÓN: aplicar el zoom como suma o ignorarlo deja el ancho en 375.
    expect(colocarFoto(FOTO, MARCO, encuadre({ zoom: 200 })).ancho).toBeCloseTo(750);
    expect(colocarFoto(FOTO, MARCO, encuadre({ modo: 'completa', zoom: 200 })).ancho).toBeCloseTo(492);
  });

  it('medidas no positivas: el marco entero, nunca NaN ni Infinity', () => {
    // naturalWidth es 0 hasta el onLoad; un NaN en una coordenada rompe el SVG del cartel entero.
    expect(colocarFoto({ ancho: 0, alto: 0 }, MARCO, encuadre())).toEqual({ left: 0, top: 0, ancho: 375, alto: 123 });
    expect(colocarFoto(FOTO, { ancho: 0, alto: 123 }, encuadre())).toEqual({ left: 0, top: 0, ancho: 0, alto: 123 });
  });
});

describe('rectanguloVisible', () => {
  it('es la inversa de colocarFoto: la ventana de la foto que ocupa el marco', () => {
    // Con default: escala 1.875; ventana = 375/1.875 × 123/1.875 = 200 × 65.6, centrada en Y.
    const r = rectanguloVisible(FOTO, MARCO, encuadre());
    expect(r.x).toBeCloseTo(0);
    expect(r.ancho).toBeCloseTo(200);
    expect(r.alto).toBeCloseTo(65.6);
    expect(r.y).toBeCloseTo(17.2);
  });

  it("en 'completa' la ventana es MÁS GRANDE que la foto (queda fondo alrededor)", () => {
    const r = rectanguloVisible(FOTO, MARCO, encuadre({ modo: 'completa', focoX: 50 }));
    expect(r.ancho).toBeGreaterThan(FOTO.ancho);
    expect(r.x).toBeLessThan(0);
  });

  it('conserva la proporción del marco (por eso el <svg> anidado puede usar preserveAspectRatio="none")', () => {
    const r = rectanguloVisible(FOTO, MARCO, encuadre({ zoom: 175, focoX: 20, focoY: 80 }));
    expect(r.ancho / r.alto).toBeCloseTo(MARCO.ancho / MARCO.alto);
  });

  it('medidas no positivas: la ventana 0 0 marco', () => {
    expect(rectanguloVisible({ ancho: 0, alto: 50 }, MARCO, encuadre())).toEqual({ x: 0, y: 0, ancho: 375, alto: 123 });
  });
});

describe('focoTrasArrastre', () => {
  // Marco de pantalla de 750×246 (el doble del de la franja): holgura vertical = 246 − 375 = −129 px.
  const MARCO_PX = { ancho: 750, alto: 246 };

  it('arrastrar hacia abajo con la foto desbordando BAJA el foco (la foto sigue al dedo)', () => {
    // MUTACIÓN: dividir por |holgura| en vez de por holgura invierte la dirección del arrastre.
    const foco = focoTrasArrastre(encuadre({ focoY: 50 }), { x: 0, y: 12.9 }, FOTO, MARCO_PX);
    expect(foco.focoY).toBeCloseTo(40);
    expect(foco.focoX).toBe(50);
  });

  it("en 'completa' la holgura es positiva y arrastrar a la derecha SUBE el foco", () => {
    // ancho escalado = 200 × 2.46 = 492; holgura horizontal = 258 px
    const foco = focoTrasArrastre(encuadre({ modo: 'completa', focoX: 50 }), { x: 25.8, y: 0 }, FOTO, MARCO_PX);
    expect(foco.focoX).toBeCloseTo(60);
  });

  it('en un eje sin holgura el foco no cambia', () => {
    // 'llenar' con esta foto no deja holgura horizontal (ancho escalado = 750).
    const foco = focoTrasArrastre(encuadre({ focoX: 50 }), { x: 300, y: 0 }, FOTO, MARCO_PX);
    expect(foco.focoX).toBe(50);
  });

  it('más allá del borde se acota a 0 o a 100', () => {
    expect(focoTrasArrastre(encuadre({ focoY: 90 }), { x: 0, y: -100 }, FOTO, MARCO_PX).focoY).toBe(100);
    expect(focoTrasArrastre(encuadre({ focoY: 10 }), { x: 0, y: 100 }, FOTO, MARCO_PX).focoY).toBe(0);
  });

  it('sin medidas de la foto, devuelve el foco tal cual', () => {
    expect(focoTrasArrastre(encuadre({ focoX: 33, focoY: 66 }), { x: 10, y: 10 }, { ancho: 0, alto: 0 }, MARCO_PX)).toEqual({
      focoX: 33,
      focoY: 66,
    });
  });
});

describe('porcentajesDeColocacion', () => {
  it('convierte la colocación a porcentajes del marco (para CSS)', () => {
    const p = porcentajesDeColocacion({ left: -37.5, top: 0, ancho: 750, alto: 123 }, MARCO);
    expect(p).toEqual({ left: -10, top: 0, ancho: 200, alto: 100 });
  });
});

describe('validarEncuadre', () => {
  const valido = { modo: 'llenar', focoX: 50, focoY: 50, zoom: 100 };

  it('acepta un encuadre válido', () => {
    expect(validarEncuadre(valido)).toBeNull();
    expect(validarEncuadre({ modo: 'completa', focoX: 0, focoY: 100, zoom: 300 })).toBeNull();
  });

  it('rechaza cada campo con SU mensaje', () => {
    expect(validarEncuadre({ ...valido, modo: 'estirar' })).toBe('El modo de encuadre no es válido.');
    expect(validarEncuadre({ ...valido, focoX: 101 })).toBe('La posición horizontal debe ser un entero de 0 a 100.');
    expect(validarEncuadre({ ...valido, focoY: -1 })).toBe('La posición vertical debe ser un entero de 0 a 100.');
    expect(validarEncuadre({ ...valido, zoom: 99 })).toBe('El zoom debe ser un entero de 100 a 300.');
    expect(validarEncuadre({ ...valido, zoom: 301 })).toBe('El zoom debe ser un entero de 100 a 300.');
  });

  it('rechaza decimales y NaN (Number("") es 0 y pasaría como válido: por eso el formulario manda NaN)', () => {
    expect(validarEncuadre({ ...valido, focoX: 50.5 })).toBe('La posición horizontal debe ser un entero de 0 a 100.');
    expect(validarEncuadre({ ...valido, zoom: NaN })).toBe('El zoom debe ser un entero de 100 a 300.');
  });
});

describe('encuadreDesdeFormulario', () => {
  it('cuatro vacíos → null (el programa hereda)', () => {
    expect(encuadreDesdeFormulario({ modo: '', focoX: '', focoY: '', zoom: '' })).toBeNull();
  });

  it('convierte a números crudos; un vacío suelto llega como NaN para que validarEncuadre lo rechace', () => {
    // MUTACIÓN: `Number(campo)` a secas convierte '' en 0, que es un foco válido: el error se traga.
    expect(encuadreDesdeFormulario({ modo: 'llenar', focoX: '10', focoY: '20', zoom: '150' })).toEqual({
      modo: 'llenar',
      focoX: 10,
      focoY: 20,
      zoom: 150,
    });
    const parcial = encuadreDesdeFormulario({ modo: 'llenar', focoX: '', focoY: '20', zoom: '150' });
    expect(parcial).not.toBeNull();
    expect(Number.isNaN(parcial!.focoX)).toBe(true);
  });
});

describe('encuadreDelComercio / encuadreDelPrograma', () => {
  const fila = { encuadre_franja: 'completa', foco_franja_x: 10, foco_franja_y: 90, zoom_franja: 250 };

  it('lee una fila válida tal cual', () => {
    expect(encuadreDelComercio(fila)).toEqual({ modo: 'completa', focoX: 10, focoY: 90, zoom: 250 });
    expect(encuadreDelPrograma(fila)).toEqual({ modo: 'completa', focoX: 10, focoY: 90, zoom: 250 });
  });

  it('un valor fuera de rango o un modo desconocido hace caer el encuadre ENTERO al default', () => {
    // Lo que sale de la BD es dato hostil (CLAUDE.md). Se lee como unidad: no se "arregla" un campo.
    expect(encuadreDelComercio({ ...fila, zoom_franja: 999 })).toEqual(ENCUADRE_POR_DEFECTO);
    expect(encuadreDelComercio({ ...fila, encuadre_franja: 'raro' })).toEqual(ENCUADRE_POR_DEFECTO);
  });

  it('programa: una sola columna null → null (sin encuadre propio)', () => {
    expect(encuadreDelPrograma({ ...fila, foco_franja_y: null })).toBeNull();
    expect(encuadreDelPrograma({ encuadre_franja: null, foco_franja_x: null, foco_franja_y: null, zoom_franja: null })).toBeNull();
  });
});
```

- [ ] **Step 2: Rojo**

Run: `npx vitest run lib/comercio/encuadreFranja.test.ts`
Expected: FALLA — módulo inexistente.

- [ ] **Step 3: Implementar**

```ts
// lib/comercio/encuadreFranja.ts
// El ENCUADRE de la foto de fondo de la franja: qué parte de la foto se ve dentro del marco. Puro —
// sin DOM, sin React, sin sharp, sin next/og — porque lo consumen cinco dibujantes distintos: la vista
// previa del editor (CSS en el navegador), la franja del pass de Apple (next/og), la grilla de sellos
// y la portada de clase de Google (la misma composición) y el cartel (SVG). Una sola función decide;
// si cada uno hiciera su propia cuenta, el dueño vería un encuadre en la pantalla y otro en el
// teléfono.

export const MODOS_ENCUADRE = ['llenar', 'completa'] as const;
export type ModoEncuadre = (typeof MODOS_ENCUADRE)[number];

export interface Encuadre {
  // 'llenar': la foto cubre el marco y se recorta. 'completa': entra entera y el color de fondo de
  // la tarjeta rellena lo que sobra.
  modo: ModoEncuadre;
  // Enteros 0–100 con la semántica de object-position: dónde se alinea la holgura entre la foto
  // escalada y el marco. 50/50 es centrado.
  focoX: number;
  focoY: number;
  // Entero 100–300, en porcentaje sobre la escala base del modo.
  zoom: number;
}

export const ZOOM_MINIMO = 100;
export const ZOOM_MAXIMO = 300;

// Con el default TODO lo existente se ve exactamente igual que antes de que existiera el encuadre:
// es el `objectFit: 'cover'` centrado que la franja tuvo desde siempre.
export const ENCUADRE_POR_DEFECTO: Encuadre = { modo: 'llenar', focoX: 50, focoY: 50, zoom: 100 };

export interface Medidas {
  ancho: number;
  alto: number;
}

// El marco de la franja del pass de Apple, en puntos (@1x). Apple fija esta proporción.
export const MARCO_FRANJA: Medidas = { ancho: 375, alto: 123 };

// Dónde y a qué tamaño va la foto DENTRO del marco, en las unidades del marco.
export interface Colocacion {
  left: number;
  top: number;
  ancho: number;
  alto: number;
}

// Qué ventana de la FOTO (en píxeles de la foto) ocupa el marco entero. Puede ser más chica que la
// foto (recorte) o más grande (foto completa con fondo alrededor).
export interface Rectangulo {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

// naturalWidth/naturalHeight son 0 hasta que la imagen carga, y una foto corrupta puede medir 0.
// Dividir por eso da NaN/Infinity, y un NaN en una coordenada rompe el SVG del cartel entero.
function medidasValidas(m: Medidas): boolean {
  return m.ancho > 0 && m.alto > 0;
}

function escalaDe(foto: Medidas, marco: Medidas, encuadre: Encuadre): number {
  const porAncho = marco.ancho / foto.ancho;
  const porAlto = marco.alto / foto.alto;
  // 'llenar' escala por el lado que SOBRA (cover); 'completa' por el que FALTA (contain).
  const base = encuadre.modo === 'completa' ? Math.min(porAncho, porAlto) : Math.max(porAncho, porAlto);
  return (base * encuadre.zoom) / 100;
}

// EL cálculo. Todo lo demás deriva de acá.
export function colocarFoto(foto: Medidas, marco: Medidas, encuadre: Encuadre): Colocacion {
  if (!medidasValidas(foto) || !medidasValidas(marco)) {
    return { left: 0, top: 0, ancho: marco.ancho, alto: marco.alto };
  }
  const escala = escalaDe(foto, marco, encuadre);
  const ancho = foto.ancho * escala;
  const alto = foto.alto * escala;
  // La holgura (marco − foto escalada) es negativa cuando la foto desborda y positiva cuando le
  // falta; el foco la reparte igual en los dos casos, que es exactamente lo que hace object-position.
  return {
    left: ((marco.ancho - ancho) * encuadre.focoX) / 100,
    top: ((marco.alto - alto) * encuadre.focoY) / 100,
    ancho,
    alto,
  };
}

export function rectanguloVisible(foto: Medidas, marco: Medidas, encuadre: Encuadre): Rectangulo {
  if (!medidasValidas(foto) || !medidasValidas(marco)) {
    return { x: 0, y: 0, ancho: marco.ancho, alto: marco.alto };
  }
  const escala = escalaDe(foto, marco, encuadre);
  const c = colocarFoto(foto, marco, encuadre);
  return { x: -c.left / escala, y: -c.top / escala, ancho: marco.ancho / escala, alto: marco.alto / escala };
}

// Para la vista previa en el navegador: la colocación como porcentajes del marco, así el mismo
// cálculo sirve para un contenedor de cualquier ancho (responsive) sin medirlo.
export function porcentajesDeColocacion(c: Colocacion, marco: Medidas): Colocacion {
  return {
    left: (c.left / marco.ancho) * 100,
    top: (c.top / marco.alto) * 100,
    ancho: (c.ancho / marco.ancho) * 100,
    alto: (c.alto / marco.alto) * 100,
  };
}

function acotarFoco(valor: number): number {
  return Math.min(100, Math.max(0, valor));
}

// Por debajo de medio píxel de holgura la foto no puede moverse en ese eje, y dividir por algo tan
// chico mandaría el foco a un extremo con el mínimo temblor del dedo.
const HOLGURA_MINIMA_PX = 0.5;

// Arrastre en la vista previa: mover la foto `deltaPx` (píxeles de pantalla, INCREMENTALES desde el
// último pointermove) cambia el foco en `delta / holgura × 100`. El signo de la holgura hace que la
// foto siga al dedo tanto cuando desborda como cuando le falta. Devuelve floats acotados a 0–100: el
// componente redondea al soltar (redondear en cada movimiento perdería los desplazamientos chicos).
export function focoTrasArrastre(
  encuadre: Encuadre,
  deltaPx: { x: number; y: number },
  foto: Medidas,
  marcoPx: Medidas,
): { focoX: number; focoY: number } {
  if (!medidasValidas(foto) || !medidasValidas(marcoPx)) {
    return { focoX: encuadre.focoX, focoY: encuadre.focoY };
  }
  const c = colocarFoto(foto, marcoPx, encuadre);
  const holguraX = marcoPx.ancho - c.ancho;
  const holguraY = marcoPx.alto - c.alto;
  return {
    focoX: Math.abs(holguraX) < HOLGURA_MINIMA_PX ? encuadre.focoX : acotarFoco(encuadre.focoX + (deltaPx.x / holguraX) * 100),
    focoY: Math.abs(holguraY) < HOLGURA_MINIMA_PX ? encuadre.focoY : acotarFoco(encuadre.focoY + (deltaPx.y / holguraY) * 100),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validación y lectura
// ─────────────────────────────────────────────────────────────────────────────

function esEnteroEntre(valor: number, minimo: number, maximo: number): boolean {
  return Number.isInteger(valor) && valor >= minimo && valor <= maximo;
}

// La BD solo tiene CHECKs baratos; esta es la defensa real. null = válido; string = mensaje al dueño.
export function validarEncuadre(e: { modo: string; focoX: number; focoY: number; zoom: number }): string | null {
  if (!(MODOS_ENCUADRE as readonly string[]).includes(e.modo)) return 'El modo de encuadre no es válido.';
  if (!esEnteroEntre(e.focoX, 0, 100)) return 'La posición horizontal debe ser un entero de 0 a 100.';
  if (!esEnteroEntre(e.focoY, 0, 100)) return 'La posición vertical debe ser un entero de 0 a 100.';
  if (!esEnteroEntre(e.zoom, ZOOM_MINIMO, ZOOM_MAXIMO)) return 'El zoom debe ser un entero de 100 a 300.';
  return null;
}

// Lo que llega del formulario (strings). Cuatro vacíos → null (el programa hereda). Si no, números
// crudos para que validarEncuadre los rechace con mensaje claro. Un vacío suelto va como NaN y NO
// como Number('') (que es 0, un foco válido): así el error no se traga.
export function encuadreDesdeFormulario(c: {
  modo: string;
  focoX: string;
  focoY: string;
  zoom: string;
}): { modo: string; focoX: number; focoY: number; zoom: number } | null {
  const aNumero = (v: string): number => (v.trim() === '' ? NaN : Number(v.trim()));
  if ([c.modo, c.focoX, c.focoY, c.zoom].every((v) => v.trim() === '')) return null;
  return { modo: c.modo.trim(), focoX: aNumero(c.focoX), focoY: aNumero(c.focoY), zoom: aNumero(c.zoom) };
}

// Lo que sale de la BD es dato hostil: un valor fuera de rango hace caer el encuadre ENTERO al
// default (se lee como unidad), nunca un campo "arreglado". Las cuatro columnas del comercio son
// NOT NULL, así que acá no hay null que contemplar.
export function encuadreDelComercio(fila: {
  encuadre_franja: string;
  foco_franja_x: number;
  foco_franja_y: number;
  zoom_franja: number;
}): Encuadre {
  const candidato = { modo: fila.encuadre_franja, focoX: fila.foco_franja_x, focoY: fila.foco_franja_y, zoom: fila.zoom_franja };
  if (validarEncuadre(candidato) !== null) return ENCUADRE_POR_DEFECTO;
  return { modo: candidato.modo as ModoEncuadre, focoX: candidato.focoX, focoY: candidato.focoY, zoom: candidato.zoom };
}

// En el programa las cuatro nacen null ("no lo toqué"). Una sola null → sin encuadre propio.
export function encuadreDelPrograma(fila: {
  encuadre_franja: string | null;
  foco_franja_x: number | null;
  foco_franja_y: number | null;
  zoom_franja: number | null;
}): Encuadre | null {
  if (
    fila.encuadre_franja === null ||
    fila.foco_franja_x === null ||
    fila.foco_franja_y === null ||
    fila.zoom_franja === null
  ) {
    return null;
  }
  return encuadreDelComercio({
    encuadre_franja: fila.encuadre_franja,
    foco_franja_x: fila.foco_franja_x,
    foco_franja_y: fila.foco_franja_y,
    zoom_franja: fila.zoom_franja,
  });
}
```

- [ ] **Step 4: Verde + mutación**

Run: `npx vitest run lib/comercio/encuadreFranja.test.ts` → todo verde.

Mutaciones obligatorias (una por vez, correr, confirmar el FALLO por el motivo correcto, restaurar):
1. En `colocarFoto`, `(marco.alto - alto)` → `(alto - marco.alto)`: falla "focoY 0 muestra el borde superior".
2. En `escalaDe`, `(base * encuadre.zoom) / 100` → `base`: falla "zoom 200 duplica".
3. En `focoTrasArrastre`, `deltaPx.y / holguraY` → `deltaPx.y / Math.abs(holguraY)`: falla "arrastrar hacia abajo… BAJA el foco".
4. En `encuadreDesdeFormulario`, `aNumero` → `Number(v)`: falla "un vacío suelto llega como NaN".
5. En `encuadreDelComercio`, quitar el `if (validarEncuadre...)`: falla "fuera de rango… default".

- [ ] **Step 5: Commit**

```bash
git add lib/comercio/encuadreFranja.ts lib/comercio/encuadreFranja.test.ts
git commit -m "Modulo puro del encuadre de la foto de la franja (modo, foco, zoom, arrastre)" -m "Una sola funcion decide que parte de la foto se ve dado el marco; la consumiran la vista previa, el pass de Apple, las imagenes de Google y el cartel. Mutaciones corridas: signo de la holgura, zoom, direccion del arrastre, NaN del formulario y default entero al leer."
```

---

### Task 3: Migración 0032, tipos de Supabase y script de verificación

**Files:**
- Create: `supabase/migrations/0032_encuadre_franja.sql`
- Modify: `lib/supabase/types.ts` (Row/Insert/Update de `comercios` y `programas_tarjeta`; lista de migraciones del encabezado)
- Create: `scripts/verificar-0032.ts`

- [ ] **Step 1: SQL**

```sql
-- 0032: encuadre de la foto de fondo de la franja (modo, foco y zoom).
--
-- Ver docs/superpowers/specs/2026-09-08-editor-marca-por-tipo-y-encuadre-franja-design.md. Con los
-- defaults, todo lo existente se ve exactamente igual que hoy (cover centrado). Los CHECK son la
-- defensa barata; la real es validarEncuadre/encuadreDelComercio en lib/comercio/encuadreFranja.ts.
begin;

alter table comercios
  add column encuadre_franja text not null default 'llenar'
    check (encuadre_franja in ('llenar', 'completa')),
  add column foco_franja_x smallint not null default 50 check (foco_franja_x between 0 and 100),
  add column foco_franja_y smallint not null default 50 check (foco_franja_y between 0 and 100),
  add column zoom_franja smallint not null default 100 check (zoom_franja between 100 and 300);

-- En el programa las cuatro nacen null: "no lo toqué". Se leen como UNIDAD (encuadreDelPrograma):
-- si alguna es null, el programa no tiene encuadre propio. El encuadre VIAJA CON LA FOTO: solo
-- cuenta cuando el programa tiene hero_url propio (ver brandingEfectivo).
alter table programas_tarjeta
  add column encuadre_franja text check (encuadre_franja in ('llenar', 'completa')),
  add column foco_franja_x smallint check (foco_franja_x between 0 and 100),
  add column foco_franja_y smallint check (foco_franja_y between 0 and 100),
  add column zoom_franja smallint check (zoom_franja between 100 and 300);

commit;
```

- [ ] **Step 2: `lib/supabase/types.ts`**

En `comercios.Row`, después de `difuminado_franja: string;`:
```ts
          // Encuadre de la foto de fondo de la franja (migración 0032). NOT NULL con default: el
          // comercio siempre tiene un encuadre; con el default se ve como antes (cover centrado).
          encuadre_franja: string;
          foco_franja_x: number;
          foco_franja_y: number;
          zoom_franja: number;
```
En `comercios.Insert` y `comercios.Update`, después de `difuminado_franja?: string;`:
```ts
          encuadre_franja?: string;
          foco_franja_x?: number;
          foco_franja_y?: number;
          zoom_franja?: number;
```
En `programas_tarjeta.Row`, después de `difuminado_franja: string | null;`:
```ts
          // Encuadre propio (0032). Las cuatro se leen como unidad: una null = sin encuadre propio.
          encuadre_franja: string | null;
          foco_franja_x: number | null;
          foco_franja_y: number | null;
          zoom_franja: number | null;
```
En `programas_tarjeta.Insert` y `Update`, después de `difuminado_franja?: string | null;`:
```ts
          encuadre_franja?: string | null;
          foco_franja_x?: number | null;
          foco_franja_y?: number | null;
          zoom_franja?: number | null;
```
Y en la lista del encabezado agregar la línea:
`//   - supabase/migrations/0032_encuadre_franja.sql (encuadre_franja/foco_franja_x/foco_franja_y/zoom_franja en comercios y programas_tarjeta)`

- [ ] **Step 3: Script de verificación** (mismo esqueleto que `scripts/verificar-0027.ts`)

```ts
// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0032.ts
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

let fallas = 0;
const ok = (m: string) => console.log(`OK: ${m}`);
const fallo = (m: string, d?: string) => {
  console.error(`FALLO: ${m}${d ? ` — ${d}` : ''}`);
  fallas += 1;
};

async function main() {
  const supabase = createServiceClient();

  const comercios = await supabase
    .from('comercios')
    .select('id, encuadre_franja, foco_franja_x, foco_franja_y, zoom_franja')
    .limit(1);
  if (comercios.error) {
    fallo('a comercios le faltan columnas de la 0032', comercios.error.message);
    process.exit(1);
  }
  ok('comercios tiene las 4 columnas de encuadre.');

  const c = comercios.data?.[0];
  if (!c) {
    console.log('AVISO: no hay comercios en la base, no se pudo verificar el default.');
  } else if (c.encuadre_franja === 'llenar' && c.foco_franja_x === 50 && c.foco_franja_y === 50 && c.zoom_franja === 100) {
    ok('un comercio existente nace con el default (llenar, 50, 50, 100): se ve igual que antes.');
  } else {
    fallo('el default del comercio no es el esperado', JSON.stringify(c));
  }

  const programas = await supabase
    .from('programas_tarjeta')
    .select('id, encuadre_franja, foco_franja_x, foco_franja_y, zoom_franja')
    .limit(1);
  if (programas.error) {
    fallo('a programas_tarjeta le faltan columnas de la 0032', programas.error.message);
    process.exit(1);
  }
  ok('programas_tarjeta tiene las 4 columnas de encuadre.');

  const p = programas.data?.[0];
  if (!p) {
    console.log('AVISO: no hay programas en la base, no se pudo verificar que nazcan null.');
  } else if (p.encuadre_franja === null && p.foco_franja_x === null && p.foco_franja_y === null && p.zoom_franja === null) {
    ok('un programa existente nace con las 4 en null (sin encuadre propio).');
  } else {
    console.log('AVISO: algún programa ya tiene encuadre propio cargado; no es un error.');
  }

  // El CHECK tiene que rechazar un zoom fuera de rango: sin él, la única defensa sería TypeScript.
  if (c) {
    const { error } = await supabase.from('comercios').update({ zoom_franja: 999 }).eq('id', c.id);
    if (error && error.code === '23514') ok('el CHECK de zoom_franja rechaza 999.');
    else if (error) fallo('el update de prueba falló por otro motivo', error.message);
    else {
      fallo('el CHECK de zoom_franja NO existe: aceptó 999');
      await supabase.from('comercios').update({ zoom_franja: c.zoom_franja }).eq('id', c.id);
    }
  }

  if (fallas > 0) {
    console.error(`\n${fallas} verificación(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nMigración 0032 verificada.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 4: Typecheck y commit**

Run: `npx tsc --noEmit` → limpio (los tipos nuevos son aditivos).

```bash
git add supabase/migrations/0032_encuadre_franja.sql lib/supabase/types.ts scripts/verificar-0032.ts
git commit -m "Migracion 0032: encuadre de la foto de la franja en comercios y programas" -m "Cuatro columnas (modo, foco x, foco y, zoom). NOT NULL con default en comercios para que nada existente cambie de aspecto; nullable en programas_tarjeta porque el encuadre viaja con la foto propia."
```

**Checkpoint del controlador:** pasarle el SQL al usuario para que lo corra en Studio; después `npx tsx --conditions=react-server scripts/verificar-0032.ts`. Las tareas 5 en adelante lo necesitan.

---

### Task 4: `brandingEfectivo` hereda el encuadre con la foto; `versionHero` lo hashea

**Files:**
- Modify: `lib/comercio/brandingEfectivo.ts`
- Modify: `lib/comercio/brandingEfectivo.test.ts`
- Modify: `lib/google/heroUrl.ts`
- Modify: `lib/google/heroUrl.test.ts`

- [ ] **Step 1: Pruebas nuevas (rojo)** — en `brandingEfectivo.test.ts`, agregar `encuadreFranja` a `COMERCIO`:

```ts
import { ENCUADRE_POR_DEFECTO } from './encuadreFranja';
// …
const COMERCIO: BrandingBase = {
  // … lo que ya está …
  difuminadoFranja: 'medio',
  encuadreFranja: { modo: 'completa', focoX: 10, focoY: 90, zoom: 150 },
};
```

y dentro de `describe('brandingEfectivo')` agregar:

```ts
  // EL ENCUADRE VIAJA CON LA FOTO, no campo por campo como los colores: la posición de una foto solo
  // tiene sentido para ESA foto, y heredar el foco del negocio sobre otra foto daría siempre un
  // resultado sin sentido (decisión 4 del spec).
  it('encuadre: programa CON foto propia usa su encuadre propio', () => {
    const propio = { modo: 'llenar' as const, focoX: 0, focoY: 0, zoom: 200 };
    const r = brandingEfectivo(COMERCIO, { brandingPropio: true, heroUrl: 'https://ejemplo.com/hero-programa.png', encuadreFranja: propio });
    expect(r.encuadreFranja).toEqual(propio);
  });

  it('encuadre: programa CON foto propia y sin encuadre tocado usa el DEFAULT, no el del negocio', () => {
    // MUTACIÓN: `programa.encuadreFranja ?? comercio.encuadreFranja` pone el foco de la foto del
    // negocio sobre la foto nueva del programa.
    const r = brandingEfectivo(COMERCIO, { brandingPropio: true, heroUrl: 'https://ejemplo.com/hero-programa.png', encuadreFranja: null });
    expect(r.encuadreFranja).toEqual(ENCUADRE_POR_DEFECTO);
  });

  it('encuadre: programa que HEREDA la foto hereda también el encuadre, aunque tenga uno guardado', () => {
    const r = brandingEfectivo(COMERCIO, { brandingPropio: true, colorFondo: 'rgb(1,2,3)', encuadreFranja: { modo: 'llenar', focoX: 0, focoY: 0, zoom: 300 } });
    expect(r.heroUrl).toBe(COMERCIO.heroUrl);
    expect(r.encuadreFranja).toEqual(COMERCIO.encuadreFranja);
  });

  it('encuadre: con branding_propio APAGADO se ignora el encuadre propio aunque haya foto propia', () => {
    const r = brandingEfectivo(COMERCIO, { brandingPropio: false, heroUrl: 'https://ejemplo.com/hero-programa.png', encuadreFranja: { modo: 'llenar', focoX: 0, focoY: 0, zoom: 300 } });
    expect(r.encuadreFranja).toEqual(COMERCIO.encuadreFranja);
  });
```

En `heroUrl.test.ts`, en `datos()` agregar `encuadreFranja: { modo: 'llenar', focoX: 50, focoY: 50, zoom: 100 },` y agregar dentro de `describe('versionHero')`:

```ts
  it('cambia con cada uno de los cuatro campos del encuadre (si no, Google sirve la foto mal encuadrada para siempre)', () => {
    const base = versionHero(datos());
    expect(versionHero(datos({ encuadreFranja: { modo: 'completa', focoX: 50, focoY: 50, zoom: 100 } }))).not.toBe(base);
    expect(versionHero(datos({ encuadreFranja: { modo: 'llenar', focoX: 0, focoY: 50, zoom: 100 } }))).not.toBe(base);
    expect(versionHero(datos({ encuadreFranja: { modo: 'llenar', focoX: 50, focoY: 0, zoom: 100 } }))).not.toBe(base);
    expect(versionHero(datos({ encuadreFranja: { modo: 'llenar', focoX: 50, focoY: 50, zoom: 150 } }))).not.toBe(base);
  });
```

Y un `describe('urlFranjaClase')` nuevo:

```ts
describe('urlFranjaClase', () => {
  it('sin programa: la portada del comercio', () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site';
    expect(urlFranjaClase('com-1', null, 'abc')).toBe('https://www.cardly-sv.site/api/comercios/com-1/franja.png?v=abc');
  });
  it('con programa: lleva el id del programa en la query, ANTES de la versión', () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site/';
    expect(urlFranjaClase('com-1', 'prog-9', 'abc')).toBe('https://www.cardly-sv.site/api/comercios/com-1/franja.png?programa=prog-9&v=abc');
  });
  it('devuelve null si falta NEXT_PUBLIC_BASE_URL', () => {
    delete process.env.NEXT_PUBLIC_BASE_URL;
    expect(urlFranjaClase('com-1', null, 'abc')).toBeNull();
  });
});

describe('versionFranjaClase', () => {
  it('es la versión de la banda SIN progreso ni franja propia: no cambia con puntos ni con stripUrl', () => {
    const marca = { colorFondo: 'rgb(1,1,1)', colorLabel: 'rgb(2,2,2)', heroUrl: 'https://ejemplo.com/h.jpg', difuminadoFranja: 'medio', encuadreFranja: { modo: 'llenar' as const, focoX: 50, focoY: 50, zoom: 100 } };
    expect(versionFranjaClase(marca)).toBe(versionFranjaClase(marca));
    expect(versionFranjaClase(marca)).not.toBe(versionFranjaClase({ ...marca, encuadreFranja: { ...marca.encuadreFranja, focoY: 0 } }));
  });
});
```

(Ajustar el import: `import { urlHeroTarjeta, urlFranjaClase, versionHero, versionFranjaClase, type DatosVersionHero } from './heroUrl';`.)

- [ ] **Step 2: Rojo**

Run: `npx vitest run lib/comercio/brandingEfectivo.test.ts lib/google/heroUrl.test.ts` → fallan por tipos/funciones inexistentes.

- [ ] **Step 3: Implementar**

`lib/comercio/brandingEfectivo.ts`:

```ts
import { ENCUADRE_POR_DEFECTO, type Encuadre } from './encuadreFranja';

export interface BrandingBase {
  colorFondo: string | null;
  colorTexto: string | null;
  colorLabel: string | null;
  logoUrl: string | null;
  heroUrl: string | null;
  stripUrl: string | null;
  selloIconoUrl: string | null;
  difuminadoFranja: string;
  // Obligatorio a propósito (como `reverso` y `ubicaciones` en DatosPass): el compilador obliga a
  // cada consumidor a decidir, en vez de que uno nuevo se lo olvide en silencio.
  encuadreFranja: Encuadre;
}

// El programa define lo que quiera y hereda el resto. `brandingPropio` es el interruptor maestro.
// `encuadreFranja` va aparte del Partial porque en el programa `null` es un valor ("no lo toqué"),
// mismo patrón que `mostrarComoFunciona` en ReversoPrograma.
export type BrandingPrograma = Partial<Omit<BrandingBase, 'encuadreFranja'>> & {
  brandingPropio: boolean;
  encuadreFranja?: Encuadre | null;
};

export function brandingEfectivo(comercio: BrandingBase, programa: BrandingPrograma | null): BrandingBase {
  if (!programa || !programa.brandingPropio) return comercio;

  return {
    colorFondo: programa.colorFondo ?? comercio.colorFondo,
    colorTexto: programa.colorTexto ?? comercio.colorTexto,
    colorLabel: programa.colorLabel ?? comercio.colorLabel,
    logoUrl: programa.logoUrl ?? comercio.logoUrl,
    heroUrl: programa.heroUrl ?? comercio.heroUrl,
    stripUrl: programa.stripUrl ?? comercio.stripUrl,
    selloIconoUrl: programa.selloIconoUrl ?? comercio.selloIconoUrl,
    difuminadoFranja: programa.difuminadoFranja ?? comercio.difuminadoFranja,
    // EL ENCUADRE VIAJA CON LA FOTO, y NO es `programa.encuadreFranja ?? comercio.encuadreFranja`:
    // la posición de una foto solo tiene sentido para ESA foto. Con foto propia, su encuadre (o el
    // default si nunca lo tocó); heredando la foto, se hereda el encuadre del negocio aunque el
    // programa tenga uno guardado de una foto anterior.
    encuadreFranja: programa.heroUrl ? (programa.encuadreFranja ?? ENCUADRE_POR_DEFECTO) : comercio.encuadreFranja,
  };
}
```
(Conservar los comentarios existentes del archivo que siguen vigentes; `necesitaClasePropia` y `reversoEfectivo` no cambian.)

`lib/google/heroUrl.ts`:

```ts
import crypto from 'node:crypto';
import type { Encuadre } from '../comercio/encuadreFranja';

export function urlHeroTarjeta(tarjetaId: string, version: string): string | null { /* igual que hoy */ }

// URL pública de la BANDA DE MARCA compuesta para la portada de la LoyaltyClass (ver
// app/api/comercios/[comercioId]/franja.png). Mismo `?v=` de cache-busting que urlHeroTarjeta y por
// el mismo motivo: Google descarga la imagen una vez y la cachea por URL. `programa` va ANTES de `v`
// para que la URL sea estable y comparable en las pruebas.
export function urlFranjaClase(comercioId: string, programaId: string | null, version: string): string | null {
  const base = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '');
  if (!base) return null;
  const programa = programaId ? `programa=${encodeURIComponent(programaId)}&` : '';
  return `${base}/api/comercios/${comercioId}/franja.png?${programa}v=${version}`;
}

export interface DatosVersionHero {
  puntos: number;
  selloMeta: number | null;
  colorFondo: string | null;
  colorLabel: string | null;
  selloIconoUrl: string | null;
  heroUrl: string | null;
  stripUrl: string | null;
  difuminadoFranja: string;
  encuadreFranja: Encuadre;
}

export function versionHero(d: DatosVersionHero): string {
  const clave = JSON.stringify([
    d.puntos, d.selloMeta, d.colorFondo, d.colorLabel,
    d.selloIconoUrl, d.heroUrl, d.stripUrl, d.difuminadoFranja,
    d.encuadreFranja.modo, d.encuadreFranja.focoX, d.encuadreFranja.focoY, d.encuadreFranja.zoom,
  ]);
  return crypto.createHash('sha1').update(clave).digest('hex').slice(0, 12);
}

// La versión de la portada de CLASE: la misma banda que dibuja la ruta franja.png, o sea sin
// progreso (puntos 0, sin meta), sin ícono de sello y sin franja propia. Vive acá y no en cada sync
// para que la ruta y los dos syncs no puedan hashear cosas distintas.
export function versionFranjaClase(marca: {
  colorFondo: string | null;
  colorLabel: string | null;
  heroUrl: string | null;
  difuminadoFranja: string;
  encuadreFranja: Encuadre;
}): string {
  return versionHero({
    puntos: 0,
    selloMeta: null,
    colorFondo: marca.colorFondo,
    colorLabel: marca.colorLabel,
    selloIconoUrl: null,
    heroUrl: marca.heroUrl,
    stripUrl: null,
    difuminadoFranja: marca.difuminadoFranja,
    encuadreFranja: marca.encuadreFranja,
  });
}
```

- [ ] **Step 4: Verde, y arreglar TODOS los consumidores que el compilador señale**

Run: `npx vitest run lib/comercio/brandingEfectivo.test.ts lib/google/heroUrl.test.ts` → verde.

Run: `npx tsc --noEmit` → va a fallar en cada llamador de `brandingEfectivo` y `versionHero`. Arreglarlos en ESTA tarea, leyendo las columnas nuevas de la BD (la migración ya tiene que estar aplicada para que los tests de integración pasen; el typecheck no la necesita):

- `lib/apple/datosPassDeTarjeta.ts`: al `select` de `programas_tarjeta(...)` agregar `encuadre_franja, foco_franja_x, foco_franja_y, zoom_franja` (el de `comercios(*)` ya trae todo). En el `BrandingBase` del comercio: `encuadreFranja: encuadreDelComercio(c)`; en el del programa: `encuadreFranja: encuadreDelPrograma(programa)`. `DatosPass` gana `encuadreFranja: Encuadre` (Task 6 lo usa) y acá se pasa `encuadreFranja: marca.encuadreFranja`.
- `app/api/tarjetas/[tarjetaId]/hero.png/route.ts`: agregar las 4 columnas a los dos selects y los dos `encuadreDel…`; en la llamada a `componerStrips` pasar `encuadreFranja: marca.encuadreFranja` (Task 6 le da uso; hasta entonces `DatosStrip` no lo tiene — ver nota abajo).
- `lib/google/syncObjeto.ts`, `lib/google/linkGuardar.ts`: idem selects + `encuadreDel…`; en `versionHero({...})` agregar `encuadreFranja: marca.encuadreFranja`.
- `lib/google/syncClasePrograma.ts`, `lib/comercio/cartel/resolverDatosCartel.ts`: idem selects + `encuadreDel…` (el uso del encuadre llega en Tasks 7 y 8).
- `lib/portal/buscarTarjetas.ts`: `encuadreFranja: ENCUADRE_POR_DEFECTO,` con el mismo comentario que ya tiene `difuminadoFranja: 'medio'` (el portal no dibuja la franja).
- `lib/comercio/guardarBrandingPrograma.ts`: `BrandingProgramaFila` gana `encuadreFranja: Encuadre | null` y `brandingDeProgramas` lo lee con `encuadreDelPrograma` (agregar las 4 columnas al select).
- `app/comercio/(protegido)/branding/page.tsx`: agregar las 4 columnas al select de `comercios` (Task 9 las usa).
- Cualquier `scripts/*.ts` que construya `DatosVersionHero` o `BrandingBase` (buscar con grep `versionHero(` y `brandingEfectivo(`).

**Nota sobre `DatosStrip`:** para no dejar el typecheck roto entre tareas, en ESTA tarea agregá `encuadreFranja: Encuadre` a `DatosStrip` (`lib/apple/stripPass.tsx`) y a `DatosPass` (`lib/apple/generatePass.ts`), pasalo desde `generatePass` a `componerStrips`, y en `generatePass.test.ts` agregá `encuadreFranja: ENCUADRE_POR_DEFECTO` a `datosBase()`. **`lib/apple/pesoPass.test.ts` construye un `DatosPass` completo a mano** (no usa `datosBase()`): agregarle `encuadreFranja: ENCUADRE_POR_DEFECTO` también, y sumarlo al commit. `stripPass` todavía NO lo usa para dibujar: eso es Task 6.

Run: `npx tsc --noEmit` → limpio. `npx vitest run lib/comercio lib/google lib/apple lib/portal` → verde (requiere la 0032 aplicada; si el usuario todavía no la aplicó, anotá qué archivos quedaron pendientes de correr y seguí).

- [ ] **Step 5: Commit**

```bash
git add lib/comercio/brandingEfectivo.ts lib/comercio/brandingEfectivo.test.ts lib/google/heroUrl.ts lib/google/heroUrl.test.ts lib/apple/datosPassDeTarjeta.ts lib/apple/generatePass.ts lib/apple/generatePass.test.ts lib/apple/stripPass.tsx "app/api/tarjetas/[tarjetaId]/hero.png/route.ts" lib/google/syncObjeto.ts lib/google/linkGuardar.ts lib/google/syncClasePrograma.ts lib/comercio/cartel/resolverDatosCartel.ts lib/portal/buscarTarjetas.ts lib/comercio/guardarBrandingPrograma.ts "app/comercio/(protegido)/branding/page.tsx"
git commit -m "El encuadre viaja con la foto en brandingEfectivo y entra al hash de Google" -m "No hereda campo por campo como los colores: la posicion de una foto solo tiene sentido para esa foto. Todos los consumidores de brandingEfectivo leen las cuatro columnas nuevas; versionHero las hashea para que Google re-descargue al cambiar el encuadre."
```

---

### Task 5: Guardado del encuadre (comercio y programa) y Server Actions

**Files:**
- Modify: `lib/comercio/guardarBranding.ts`, `lib/comercio/guardarBranding.test.ts`
- Modify: `lib/comercio/guardarBrandingPrograma.ts`, `lib/comercio/guardarBrandingPrograma.test.ts`
- Modify: `app/comercio/(protegido)/branding/actions.ts` (`accionGuardarBranding`, `accionGuardarBrandingDePrograma`)

- [ ] **Step 1: Pruebas (rojo)**

En `guardarBranding.test.ts` **y en `lib/tarjetas/tiposFuncionales.test.ts` (dos llamadas, líneas ~190 y ~211)**, toda llamada existente a `guardarBranding` gana `encuadre_franja: { modo: 'llenar', focoX: 50, focoY: 50, zoom: 100 }` (sumar `tiposFuncionales.test.ts` al commit). Agregar:

```ts
  it('guarda el encuadre de la foto de la franja', async () => {
    const id = await crearComercio();
    const res = await guardarBranding(supabase, id, {
      color_fondo: 'rgb(10, 20, 30)', color_texto: 'rgb(255, 255, 255)', color_label: 'rgb(200, 200, 200)',
      sello_meta: null, difuminado_franja: 'medio',
      encuadre_franja: { modo: 'completa', focoX: 10, focoY: 90, zoom: 150 },
    });
    expect(res.ok).toBe(true);
    const { data } = await supabase.from('comercios').select('encuadre_franja, foco_franja_x, foco_franja_y, zoom_franja').eq('id', id).single();
    expect(data).toEqual({ encuadre_franja: 'completa', foco_franja_x: 10, foco_franja_y: 90, zoom_franja: 150 });
  });

  it('rechaza un encuadre inválido con el mensaje de validarEncuadre, sin escribir nada', async () => {
    // MUTACIÓN: quitar el `validarEncuadre` deja que el 23514 de la BD llegue como "No se pudo guardar".
    const id = await crearComercio();
    const res = await guardarBranding(supabase, id, {
      color_fondo: 'rgb(10, 20, 30)', color_texto: 'rgb(255, 255, 255)', color_label: 'rgb(200, 200, 200)',
      sello_meta: null, difuminado_franja: 'medio',
      encuadre_franja: { modo: 'llenar', focoX: 50, focoY: 50, zoom: 999 },
    });
    expect(res).toEqual({ ok: false, error: 'El zoom debe ser un entero de 100 a 300.' });
  });

  it('sin encuadre (formulario roto) rechaza con mensaje claro: las columnas del comercio no admiten null', async () => {
    const id = await crearComercio();
    const res = await guardarBranding(supabase, id, {
      color_fondo: 'rgb(10, 20, 30)', color_texto: 'rgb(255, 255, 255)', color_label: 'rgb(200, 200, 200)',
      sello_meta: null, difuminado_franja: 'medio', encuadre_franja: null,
    });
    expect(res).toEqual({ ok: false, error: 'Falta el encuadre de la foto de fondo.' });
  });
```

En `guardarBrandingPrograma.test.ts`: `BRANDING_VACIO` gana `encuadreFranja: null`. Agregar:

```ts
  it('guarda el encuadre propio de un programa y lo lee de vuelta como unidad', async () => {
    const { comercioId, cuponId } = await comercioConDosProgramas();
    const res = await guardarBrandingPrograma(supabase, comercioId, cuponId, {
      ...BRANDING_VACIO, brandingPropio: true,
      encuadreFranja: { modo: 'completa', focoX: 0, focoY: 100, zoom: 120 },
    });
    expect(res.ok).toBe(true);
    const filas = await brandingDeProgramas(supabase, comercioId);
    expect(filas.find((f) => f.programaId === cuponId)?.encuadreFranja).toEqual({ modo: 'completa', focoX: 0, focoY: 100, zoom: 120 });
  });

  it('encuadre null SE ESCRIBE (hereda): deja las cuatro columnas en null aunque antes tuvieran valor', async () => {
    const { comercioId, cuponId } = await comercioConDosProgramas();
    await guardarBrandingPrograma(supabase, comercioId, cuponId, { ...BRANDING_VACIO, brandingPropio: true, encuadreFranja: { modo: 'llenar', focoX: 1, focoY: 2, zoom: 110 } });
    const res = await guardarBrandingPrograma(supabase, comercioId, cuponId, { ...BRANDING_VACIO, brandingPropio: true, encuadreFranja: null });
    expect(res.ok).toBe(true);
    const { data } = await supabase.from('programas_tarjeta').select('encuadre_franja, foco_franja_x, foco_franja_y, zoom_franja').eq('id', cuponId).single();
    expect(data).toEqual({ encuadre_franja: null, foco_franja_x: null, foco_franja_y: null, zoom_franja: null });
  });

  it('rechaza un encuadre inválido con el mensaje de validarEncuadre', async () => {
    const { comercioId, cuponId } = await comercioConDosProgramas();
    const res = await guardarBrandingPrograma(supabase, comercioId, cuponId, {
      ...BRANDING_VACIO, brandingPropio: true, encuadreFranja: { modo: 'raro', focoX: 50, focoY: 50, zoom: 100 } as never,
    });
    expect(res).toEqual({ ok: false, error: 'El modo de encuadre no es válido.' });
  });

  describe('brandingProgramaDesdeFormulario — encuadre', () => {
    const base = { brandingPropio: false, colorFondo: '', colorTexto: '', colorLabel: '', difuminadoFranja: '', selloMeta: '' };
    it('cuatro vacíos → null', () => {
      expect(brandingProgramaDesdeFormulario({ ...base, encuadre: { modo: '', focoX: '', focoY: '', zoom: '' } }).encuadreFranja).toBeNull();
    });
    it('un solo vacío NO es null: llega con NaN para que la validación lo rechace', () => {
      const r = brandingProgramaDesdeFormulario({ ...base, encuadre: { modo: 'llenar', focoX: '', focoY: '50', zoom: '100' } });
      expect(r.encuadreFranja).not.toBeNull();
      expect(Number.isNaN(r.encuadreFranja!.focoX)).toBe(true);
    });
  });
```

- [ ] **Step 2: Rojo**

Run: `npx vitest run lib/comercio/guardarBranding.test.ts lib/comercio/guardarBrandingPrograma.test.ts`.

- [ ] **Step 3: Implementar**

`guardarBranding.ts`:
```ts
import { validarEncuadre } from './encuadreFranja';

export interface DatosBranding {
  // … lo existente …
  // El encuadre de la foto de la franja, crudo desde el formulario. null = no llegó (un formulario
  // roto): las columnas del comercio son NOT NULL, así que acá null es un ERROR, no "heredá". El
  // formulario del negocio manda los cuatro campos SIEMPRE (haya foto o no).
  encuadre_franja: { modo: string; focoX: number; focoY: number; zoom: number } | null;
}
```
Después de la validación de difuminado:
```ts
  if (datos.encuadre_franja === null) {
    return { ok: false, error: 'Falta el encuadre de la foto de fondo.' };
  }
  const errorEncuadre = validarEncuadre(datos.encuadre_franja);
  if (errorEncuadre) return { ok: false, error: errorEncuadre };
```
Y en el `update`:
```ts
      encuadre_franja: datos.encuadre_franja.modo,
      foco_franja_x: datos.encuadre_franja.focoX,
      foco_franja_y: datos.encuadre_franja.focoY,
      zoom_franja: datos.encuadre_franja.zoom,
```

`guardarBrandingPrograma.ts`: `DatosBrandingPrograma` gana `encuadreFranja: { modo: string; focoX: number; focoY: number; zoom: number } | null;` (comentario: null SE ESCRIBE = hereda; solo cuenta con foto propia — ver brandingEfectivo). Validación: `if (datos.encuadreFranja !== null) { const e = validarEncuadre(datos.encuadreFranja); if (e) return { ok: false, error: e }; }`. En el `update`:
```ts
      encuadre_franja: datos.encuadreFranja?.modo ?? null,
      foco_franja_x: datos.encuadreFranja?.focoX ?? null,
      foco_franja_y: datos.encuadreFranja?.focoY ?? null,
      zoom_franja: datos.encuadreFranja?.zoom ?? null,
```
`brandingProgramaDesdeFormulario` gana el campo `encuadre: { modo: string; focoX: string; focoY: string; zoom: string }` en su entrada y devuelve `encuadreFranja: encuadreDesdeFormulario(campos.encuadre)`. `hayMarcaPropia` NO cambia; agregar el comentario: "El encuadre no entra: solo existe con foto propia, y subir la foto ya enciende branding_propio (accionSubirImagenDePrograma)."

`actions.ts`:
- `accionGuardarBranding`: leer los cuatro campos y pasar
  ```ts
  encuadre_franja: encuadreDesdeFormulario({
    modo: String(formData.get('encuadre_franja') ?? ''),
    focoX: String(formData.get('foco_franja_x') ?? ''),
    focoY: String(formData.get('foco_franja_y') ?? ''),
    zoom: String(formData.get('zoom_franja') ?? ''),
  }),
  ```
- `accionGuardarBrandingDePrograma`: en `brandingProgramaDesdeFormulario({...})` agregar `encuadre: { modo: String(formData.get('encuadre_franja') ?? ''), focoX: …, focoY: …, zoom: … }`.

- [ ] **Step 4: Verde + mutación**

Run: `npx vitest run lib/comercio/guardarBranding.test.ts lib/comercio/guardarBrandingPrograma.test.ts` → verde. Mutación: comentar el `validarEncuadre` de `guardarBranding` → la prueba de zoom 999 falla con "No se pudo guardar el branding." (el 23514). Restaurar. `npx tsc --noEmit` limpio.

- [ ] **Step 5: Commit**

```bash
git add lib/comercio/guardarBranding.ts lib/comercio/guardarBranding.test.ts lib/comercio/guardarBrandingPrograma.ts lib/comercio/guardarBrandingPrograma.test.ts "app/comercio/(protegido)/branding/actions.ts"
git commit -m "El encuadre se guarda con la marca del negocio y de cada tarjeta" -m "En el comercio es obligatorio (columnas NOT NULL); en el programa null se escribe y significa heredar. validarEncuadre es la defensa real: el CHECK de la base solo devuelve un 23514 mudo."
```

---

### Task 6: La composición del pass aplica el encuadre; `componerFranja` de una escala

**Files:**
- Modify: `lib/apple/stripPass.tsx`
- Modify: `lib/apple/generatePass.test.ts`
- Modify: `app/api/tarjetas/[tarjetaId]/hero.png/route.test.ts`

- [ ] **Step 1: Prueba (rojo)** en `generatePass.test.ts`, junto a la del difuminado:

```ts
  it('el encuadre llega al PNG: focoY 0 muestra la mitad roja y focoY 100 la azul', async () => {
    // Prueba de integración (no unitaria de colocarFoto): confirma que DatosPass.encuadreFranja
    // llega hasta los píxeles. Foto 200×100 con la mitad superior roja y la inferior azul; en
    // 'llenar' sobra alto, así que el foco vertical decide qué mitad queda en el centro. Difuminado
    // 'ninguno' para que el centro no se tiña del color de fondo. El velo del 45% oscurece pero no
    // cambia qué canal domina.
    // MUTACIÓN: ignorar el encuadre en capasDeFondo deja las dos franjas con el centro rojo.
    const mitades = await sharp({ create: { width: 200, height: 100, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
      .composite([{ input: await sharp({ create: { width: 200, height: 50, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } }).png().toBuffer(), top: 50, left: 0 }])
      .png()
      .toBuffer();
    const conFoto = {
      ...datosBase(),
      puntos: 0,
      tipoTarjeta: 'membresia',
      selloMeta: null,
      stripUrl: null,
      heroUrl: `data:image/png;base64,${mitades.toString('base64')}`,
      difuminadoFranja: 'ninguno',
    };
    async function centroDe(buffer: Buffer): Promise<{ r: number; b: number }> {
      const strip = Buffer.from(await (await JSZip.loadAsync(buffer)).file('strip.png')!.async('nodebuffer'));
      const { data, info } = await sharp(strip).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const i = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
      return { r: data[i], b: data[i + 2] };
    }
    const arriba = await centroDe(await generarPassApple({ ...conFoto, serialNumber: 'test-enc-0', qrToken: 'e0', encuadreFranja: { modo: 'llenar', focoX: 50, focoY: 0, zoom: 100 } }));
    const abajo = await centroDe(await generarPassApple({ ...conFoto, serialNumber: 'test-enc-100', qrToken: 'e1', encuadreFranja: { modo: 'llenar', focoX: 50, focoY: 100, zoom: 100 } }));
    expect(arriba.r).toBeGreaterThan(arriba.b);
    expect(abajo.b).toBeGreaterThan(abajo.r);
  });
```

Y en `hero.png/route.test.ts` agregar:

```ts
  it('pasa a la composición el encuadre de la foto PROPIA del programa', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos', sello_meta: 8, hero_url: 'https://ejemplo.com/hero-COMERCIO.jpg', foco_franja_y: 10 });
    const programaId = entorno.obtenerProgramaPrincipal(comercioId);
    await supabase.from('programas_tarjeta').update({
      branding_propio: true, hero_url: 'https://ejemplo.com/hero-PROGRAMA.jpg',
      encuadre_franja: 'completa', foco_franja_x: 0, foco_franja_y: 100, zoom_franja: 200,
    }).eq('id', programaId);
    const { id: tarjetaId } = await entorno.crearTarjeta(comercioId, 3);
    await pedirImagen(tarjetaId);
    const args = componerStripsMock.mock.calls[0][0];
    expect(args.heroUrl).toBe('https://ejemplo.com/hero-PROGRAMA.jpg');
    expect(args.encuadreFranja).toEqual({ modo: 'completa', focoX: 0, focoY: 100, zoom: 200 });
  }, 30_000);
```

- [ ] **Step 2: Rojo**

Run: `npx vitest run lib/apple/generatePass.test.ts "app/api/tarjetas/[tarjetaId]/hero.png/route.test.ts"` → la del encuadre falla (los dos centros rojos); la de la ruta pasa o falla según Task 4 (si pasa, bien: Task 4 ya cableó el dato).

- [ ] **Step 3: Implementar en `stripPass.tsx`**

```ts
import sharp from 'sharp';
import { colocarFoto, MARCO_FRANJA, type Encuadre, type Medidas } from '../comercio/encuadreFranja';

export interface DatosStrip {
  // … lo existente …
  // Qué parte de la foto se ve (migración 0032). Con el default es el cover centrado de siempre.
  encuadreFranja: Encuadre;
}

// La foto ya bajada, con sus medidas. Sin medidas (sharp no pudo leerla) la capa cae al cover
// centrado de siempre: el encuadre es best-effort como todo lo demás de la franja.
interface FotoFondo {
  dataUrl: string;
  medidas: Medidas | null;
}

function capasDeFondo(datos: DatosStrip, escala: number, foto: FotoFondo | null) {
  if (!foto) return [];
  const marco = { ancho: MARCO_FRANJA.ancho * escala, alto: MARCO_FRANJA.alto * escala };
  // Con medidas, la foto va posicionada en absoluto por colocarFoto (la MISMA función que usa la
  // vista previa del editor): en modo 'completa' lo que sobra queda del color de la tarjeta, que ya
  // es el fondo del contenedor, y el difuminado lo funde. Sin medidas, el cover de siempre.
  const colocacion = foto.medidas ? colocarFoto(foto.medidas, marco, datos.encuadreFranja) : null;
  const capaLlena = { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' };
  const capas = [
    {
      type: 'img',
      props: colocacion
        ? {
            src: foto.dataUrl,
            width: colocacion.ancho,
            height: colocacion.alto,
            style: { position: 'absolute', top: colocacion.top, left: colocacion.left },
          }
        : {
            src: foto.dataUrl,
            width: marco.ancho,
            height: marco.alto,
            style: { position: 'absolute', top: 0, left: 0, objectFit: 'cover' },
          },
    },
    { type: 'div', props: { style: { ...capaLlena, background: 'rgba(0, 0, 0, 0.45)' } } },
  ];
  // … el difuminado igual que hoy …
  return capas;
}
```
Adaptar `grillaSellos`, `bandaMarca` y `renderizar` para recibir `foto: FotoFondo | null` en vez de `heroDataUrl`. Agregar:

```ts
// Mide la foto para el encuadre. Best-effort: sin medidas la franja sale con el cover de siempre.
async function medir(buf: Buffer): Promise<Medidas | null> {
  try {
    const { width, height } = await sharp(buf).metadata();
    return width && height ? { ancho: width, alto: height } : null;
  } catch (error) {
    console.warn('[apple] no se pudo medir la foto de fondo; va sin encuadre:', error);
    return null;
  }
}

// Baja el ícono y la foto UNA vez y mide la foto UNA vez: componerStrips renderiza tres escalas con
// lo mismo, y la ruta de portada de clase una sola.
async function bajarInsumos(datos: DatosStrip): Promise<{ iconoUrl: string | null; foto: FotoFondo | null }> {
  const [icono, hero] = await Promise.all([
    descargarImagen(datos.selloIconoUrl, 'el ícono del sello'),
    descargarImagen(datos.heroUrl, 'la foto de fondo de la franja'),
  ]);
  const foto = hero ? { dataUrl: comoDataUrl(hero)!, medidas: await medir(hero.buf) } : null;
  return { iconoUrl: comoDataUrl(icono), foto };
}

// UNA escala. Para la portada de la clase de Google (app/api/comercios/[comercioId]/franja.png), que
// está en el camino crítico de la creación de la clase y no tiene por qué renderizar tres tamaños
// para servir uno. Respeta stripUrl igual que componerStrips (la ruta lo manda en null a propósito).
export async function componerFranja(datos: DatosStrip, escala: 1 | 2 | 3): Promise<Buffer | null> {
  try {
    if (datos.stripUrl) {
      const res = await fetch(datos.stripUrl);
      if (!res.ok) throw new Error(`strip del comercio respondió ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }
    const { iconoUrl, foto } = await bajarInsumos(datos);
    return await renderizar(datos, escala, iconoUrl, foto);
  } catch (error) {
    console.warn('[apple] no se pudo componer la franja de una escala:', error);
    return null;
  }
}
```
Y `componerStrips` usa `bajarInsumos` una vez y renderiza las tres escalas con el resultado (no llama a `componerFranja` tres veces).

- [ ] **Step 4: Verde**

Run: `npx vitest run lib/apple "app/api/tarjetas/[tarjetaId]/hero.png/route.test.ts"` → verde. Mutación: en `capasDeFondo` reemplazar `colocacion` por `null` → la prueba de los centros falla (los dos rojos). Restaurar. `npx tsc --noEmit` limpio.

- [ ] **Step 5: Commit**

```bash
git add lib/apple/stripPass.tsx lib/apple/generatePass.test.ts "app/api/tarjetas/[tarjetaId]/hero.png/route.test.ts"
git commit -m "La franja del pass aplica el encuadre de la foto; componerFranja de una sola escala" -m "capasDeFondo coloca la foto con la misma funcion que usa la vista previa. La foto se baja y se mide UNA vez para las tres escalas. Prueba de integracion con una foto de dos colores: el foco vertical decide que mitad queda en el centro del strip.png."
```

---

### Task 7: Portada de la clase de Google — ruta nueva, syncs y barrido

**Files:**
- Create: `app/api/comercios/[comercioId]/franja.png/route.ts`
- Create: `app/api/comercios/[comercioId]/franja.png/route.test.ts`
- Modify: `lib/google/syncClase.ts`, `lib/google/syncClase.test.ts`
- Modify: `lib/google/syncClasePrograma.ts`, `lib/google/syncClasePrograma.test.ts`
- Modify: `app/comercio/(protegido)/branding/actions.ts` (`accionGuardarBranding`)
- Create: `app/comercio/(protegido)/branding/actions.test.ts`

- [ ] **Step 1: Prueba de la ruta (rojo)** — patrón de `hero.png/route.test.ts`, mockeando `componerFranja`:

```ts
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createServiceClient } from '@/lib/supabase/server';
import { crearEntorno } from '../../../../../test/fixtures/entornoComercio';

// La portada de la LoyaltyClass de Google: la MISMA banda de marca del pass de Apple. Se mockea
// componerFranja y se aserta sobre sus ARGUMENTOS (qué se le pidió dibujar), igual que hero.png.
const componerFranjaMock = vi.fn();
vi.mock('@/lib/apple/stripPass', () => ({
  componerFranja: (...args: unknown[]) => componerFranjaMock(...args),
}));

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

beforeEach(() => {
  componerFranjaMock.mockReset().mockResolvedValue(Buffer.from('png'));
});
afterEach(() => entorno.limpiar());

async function pedir(comercioId: string, programaId?: string) {
  const { GET } = await import('./route');
  const url = `http://localhost/api/comercios/${comercioId}/franja.png${programaId ? `?programa=${programaId}` : ''}`;
  const { NextRequest } = await import('next/server');
  return GET(new NextRequest(url), { params: Promise.resolve({ comercioId }) });
}

describe('GET /api/comercios/[comercioId]/franja.png', () => {
  it('sin foto efectiva → 404 y no compone nada', async () => {
    const comercioId = await entorno.crearComercio({ hero_url: null });
    const res = await pedir(comercioId);
    expect(res.status).toBe(404);
    expect(componerFranjaMock).not.toHaveBeenCalled();
  }, 30_000);

  it('compone la BANDA (sin grilla, sin franja propia) con el branding y el encuadre del comercio, escala 3', async () => {
    const comercioId = await entorno.crearComercio({
      tipo_tarjeta: 'sellos', sello_meta: 8, hero_url: 'https://ejemplo.com/hero.jpg', strip_url: 'https://ejemplo.com/strip.png',
      color_fondo: 'rgb(10, 10, 10)', foco_franja_y: 0,
    });
    const res = await pedir(comercioId);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const [args, escala] = componerFranjaMock.mock.calls[0];
    // MUTACIÓN: pasar el tipo/meta reales dibuja la grilla de UN cliente en la portada de TODOS.
    expect(args.tipoTarjeta).toBe('puntos');
    expect(args.selloMeta).toBeNull();
    expect(args.puntos).toBe(0);
    // MUTACIÓN: pasar marca.stripUrl sirve los bytes crudos de la franja como image/png (decisión 5).
    expect(args.stripUrl).toBeNull();
    expect(args.selloIconoUrl).toBeNull();
    expect(args.heroUrl).toBe('https://ejemplo.com/hero.jpg');
    expect(args.colorFondo).toBe('rgb(10, 10, 10)');
    expect(args.encuadreFranja.focoY).toBe(0);
    expect(escala).toBe(3);
  }, 30_000);

  it('con ?programa= usa el branding efectivo del programa (foto y encuadre propios)', async () => {
    const comercioId = await entorno.crearComercio({ hero_url: 'https://ejemplo.com/hero-COMERCIO.jpg' });
    const programaId = entorno.obtenerProgramaPrincipal(comercioId);
    await supabase.from('programas_tarjeta').update({ branding_propio: true, hero_url: 'https://ejemplo.com/hero-PROGRAMA.jpg', encuadre_franja: 'completa', foco_franja_x: 0, foco_franja_y: 0, zoom_franja: 100 }).eq('id', programaId);
    await pedir(comercioId, programaId);
    const [args] = componerFranjaMock.mock.calls[0];
    expect(args.heroUrl).toBe('https://ejemplo.com/hero-PROGRAMA.jpg');
    expect(args.encuadreFranja.modo).toBe('completa');
  }, 30_000);

  it('un ?programa= de OTRO comercio → 404, no cae al comercio en silencio', async () => {
    const comercioId = await entorno.crearComercio({ hero_url: 'https://ejemplo.com/hero.jpg' });
    const otroId = await entorno.crearComercio({ hero_url: 'https://ejemplo.com/otro.jpg' });
    const programaAjeno = entorno.obtenerProgramaPrincipal(otroId);
    const res = await pedir(comercioId, programaAjeno);
    expect(res.status).toBe(404);
    expect(componerFranjaMock).not.toHaveBeenCalled();
  }, 30_000);
});
```

- [ ] **Step 2: Implementar la ruta**

```ts
// app/api/comercios/[comercioId]/franja.png/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { componerFranja } from '@/lib/apple/stripPass';
import { brandingEfectivo } from '@/lib/comercio/brandingEfectivo';
import { encuadreDelComercio, encuadreDelPrograma } from '@/lib/comercio/encuadreFranja';

export const runtime = 'nodejs';

const COLUMNAS_MARCA =
  'color_fondo, color_texto, color_label, logo_url, hero_url, strip_url, sello_icono_url, difuminado_franja, encuadre_franja, foco_franja_x, foco_franja_y, zoom_franja';

// La portada (heroImage) de la LoyaltyClass de Google: la MISMA banda de marca que va en el pass de
// Apple (velo, difuminado, resplandor, encuadre). Hasta la 0032 la clase apuntaba a la foto cruda y
// en Android la portada no se parecía a la del iPhone. Es de TODOS los clientes del programa, así
// que nunca lleva progreso (tipo 'puntos', 0, sin meta) ni ícono de sello; y la franja personalizada
// queda afuera a propósito (stripUrl null): componerFranja con strip devuelve bytes crudos de
// formato y tamaño arbitrarios, que es lo que Google rechaza al validar la clase.
//
// Está en el camino crítico de la creación de la clase (Google descarga la imagen al insertar), por
// eso renderiza UNA escala y no tres.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ comercioId: string }> },
) {
  const { comercioId } = await params;
  const programaId = request.nextUrl.searchParams.get('programa');
  const supabase = createServiceClient();

  const [{ data: c }, { data: programa }] = await Promise.all([
    supabase.from('comercios').select(COLUMNAS_MARCA).eq('id', comercioId).maybeSingle(),
    programaId
      ? supabase
          .from('programas_tarjeta')
          .select(`branding_propio, ${COLUMNAS_MARCA}`)
          .eq('id', programaId)
          // Scope por comercio: un programa ajeno o inexistente es 404, no "el comercio a secas".
          .eq('comercio_id', comercioId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (!c || (programaId && !programa)) {
    return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
  }

  const marca = brandingEfectivo(
    {
      colorFondo: c.color_fondo,
      colorTexto: c.color_texto,
      colorLabel: c.color_label,
      logoUrl: c.logo_url,
      heroUrl: c.hero_url,
      stripUrl: c.strip_url,
      selloIconoUrl: c.sello_icono_url,
      difuminadoFranja: c.difuminado_franja,
      encuadreFranja: encuadreDelComercio(c),
    },
    programa
      ? {
          brandingPropio: programa.branding_propio,
          colorFondo: programa.color_fondo,
          colorTexto: programa.color_texto,
          colorLabel: programa.color_label,
          logoUrl: programa.logo_url,
          heroUrl: programa.hero_url,
          stripUrl: programa.strip_url,
          selloIconoUrl: programa.sello_icono_url,
          difuminadoFranja: programa.difuminado_franja ?? undefined,
          encuadreFranja: encuadreDelPrograma(programa),
        }
      : null,
  );

  if (!marca.heroUrl) {
    return NextResponse.json({ error: 'Sin foto de fondo' }, { status: 404 });
  }

  const png = await componerFranja(
    {
      tipoTarjeta: 'puntos',
      puntos: 0,
      selloMeta: null,
      colorFondo: marca.colorFondo ?? 'rgb(35, 24, 18)',
      colorLabel: marca.colorLabel ?? 'rgb(255, 255, 255)',
      stripUrl: null,
      selloIconoUrl: null,
      heroUrl: marca.heroUrl,
      difuminadoFranja: marca.difuminadoFranja,
      encuadreFranja: marca.encuadreFranja,
    },
    3,
  );
  if (!png) {
    return NextResponse.json({ error: 'No se pudo componer la imagen' }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(png), {
    status: 200,
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
  });
}
```

Run: `npx vitest run "app/api/comercios/[comercioId]/franja.png/route.test.ts"` → verde.

- [ ] **Step 3: `syncClaseComercio` y `syncClasePrograma` apuntan a la ruta (rojo primero)**

En `syncClase.test.ts` agregar (con `NEXT_PUBLIC_BASE_URL` fijado en el test como hace `heroUrl.test.ts`):

```ts
  it('con foto: la clase apunta a la portada COMPUESTA con versión, no a la foto cruda', async () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site';
    const id = await crearComercio({ google_class_id: null, hero_url: 'https://ejemplo.com/hero.jpg' });
    await syncClaseComercio(supabase, id);
    const uri = insertMock.mock.calls[0][0].requestBody.heroImage.sourceUri.uri;
    expect(uri).toMatch(new RegExp(`^https://www\\.cardly-sv\\.site/api/comercios/${id}/franja\\.png\\?v=[0-9a-f]{12}$`));
  });

  it('cambiar el encuadre cambia la versión de la portada (Google la re-descarga)', async () => {
    // MUTACIÓN: hashear sin el encuadre deja la URL igual y Google sirve la portada vieja para siempre.
    process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site';
    const id = await crearComercio({ google_class_id: 'clase-existente', hero_url: 'https://ejemplo.com/hero.jpg' });
    await syncClaseComercio(supabase, id);
    await supabase.from('comercios').update({ foco_franja_y: 0 }).eq('id', id);
    await syncClaseComercio(supabase, id);
    const [a, b] = patchMock.mock.calls.map((c) => c[0].requestBody.heroImage.sourceUri.uri);
    expect(a).not.toBe(b);
  });

  it('sin foto: la clase sale sin heroImage, como siempre', async () => {
    const id = await crearComercio({ google_class_id: null, hero_url: null });
    await syncClaseComercio(supabase, id);
    expect(insertMock.mock.calls[0][0].requestBody.heroImage).toBeUndefined();
  });
```
(`crearComercio` del test gana `hero_url` en su `Partial`, y el `afterEach` restaura `NEXT_PUBLIC_BASE_URL`.)

Implementación en `syncClase.ts`: el `select` pasa a `'nombre, color_fondo, color_label, logo_url, hero_url, difuminado_franja, encuadre_franja, foco_franja_x, foco_franja_y, zoom_franja, google_class_id'` y:

```ts
    // La portada compuesta (misma banda que el pass de Apple), versionada por todo lo que dibuja. Si
    // falta NEXT_PUBLIC_BASE_URL cae a la foto cruda: degradación, no fallo.
    const heroUrl = comercio.hero_url
      ? (urlFranjaClase(
          comercioId,
          null,
          versionFranjaClase({
            colorFondo: comercio.color_fondo,
            colorLabel: comercio.color_label,
            heroUrl: comercio.hero_url,
            difuminadoFranja: comercio.difuminado_franja,
            encuadreFranja: encuadreDelComercio(comercio),
          }),
        ) ?? comercio.hero_url)
      : null;
    const cuerpo = construirClase(classId, { nombre: comercio.nombre, colorFondo: comercio.color_fondo, logoUrl: comercio.logo_url, heroUrl, ubicaciones });
```

En `syncClasePrograma.ts`, con `marca` ya resuelta: `heroUrl: marca.heroUrl ? (urlFranjaClase(comercioId, programaId, versionFranjaClase({ colorFondo: marca.colorFondo, colorLabel: marca.colorLabel, heroUrl: marca.heroUrl, difuminadoFranja: marca.difuminadoFranja, encuadreFranja: marca.encuadreFranja })) ?? marca.heroUrl) : null`. Agregar a `syncClasePrograma.test.ts` una prueba equivalente a la primera de arriba (la URL lleva `?programa=<id>&v=`).

Para no repetir esa expresión en tres archivos, ponerla en `lib/google/heroUrl.ts`:
```ts
// La portada que va en la clase: la compuesta si hay foto y base URL; la foto cruda si falta la base
// (degradación); null sin foto. UNA función para los TRES lugares que construyen la clase.
export function heroUrlDeClase(
  comercioId: string,
  programaId: string | null,
  marca: { colorFondo: string | null; colorLabel: string | null; heroUrl: string | null; difuminadoFranja: string; encuadreFranja: Encuadre },
): string | null {
  if (!marca.heroUrl) return null;
  return urlFranjaClase(comercioId, programaId, versionFranjaClase(marca)) ?? marca.heroUrl;
}
```
y usarla en `syncClase.ts`, `syncClasePrograma.ts` y **`lib/google/linkGuardar.ts`**.

**`linkGuardar.ts` es el TERCER lugar que construye la clase, y es el más peligroso:** la clase viaja EMBEBIDA en el JWT de "Agregar a Google Wallet" y Google la upsertea por id al procesarlo (el propio archivo lo documenta en su cabecera). Si siguiera mandando `heroUrl: marca.heroUrl`, cada cliente que toca el botón devolvería la portada a la foto cruda, deshaciendo lo que la ruta nueva logró. En `construirClase(classId, {...})` de `linkGuardar.ts` (línea ~108): `heroUrl: heroUrlDeClase(tarjeta.comercio_id, programa?.id ?? null, marca)`. Ojo: el `classId` puede ser el del comercio o el del programa; el `programaId` de la URL sigue la misma regla que `syncClasePrograma`: si el JWT lleva la clase del PROGRAMA (`resProg.ok && resProg.classId`), la URL lleva `?programa=`; si lleva la del comercio, no. Guardar en una variable `const claseDelPrograma = …` al decidir `classId` y usarla acá.

Prueba en `lib/google/linkGuardar.test.ts` (ya decodifica el JWT con `jwt` y una llave de prueba; ver cómo lee `payload.loyaltyClasses[0]`): con un comercio con `hero_url` y `NEXT_PUBLIC_BASE_URL` fijado, `payload.loyaltyClasses[0].heroImage.sourceUri.uri` matchea `/\/api\/comercios\/<comercioId>\/franja\.png\?v=[0-9a-f]{12}$/`. MUTACIÓN: volver a `heroUrl: marca.heroUrl` → la prueba falla (URL de Storage).

- [ ] **Step 4: Barrido de clases de programas al guardar la marca del negocio**

En `lib/google/syncClasePrograma.ts` agregar:

```ts
// Re-sincroniza la clase de cada programa del comercio que YA tiene una. Lo llama el guardado de la
// marca del NEGOCIO: la portada de un programa con clase propia que hereda la foto depende de ocho
// campos del negocio (foto, colores, difuminado, encuadre), y sin esto quedaba con el `?v=` viejo en
// Android. Solo los que tienen google_class_id: una clase de Google es permanente y no se crea por
// esto. Best-effort y en secuencia.
export async function syncClasesDeProgramasConClase(
  supabase: SupabaseClient<Database>,
  comercioId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('programas_tarjeta')
    .select('id')
    .eq('comercio_id', comercioId)
    .not('google_class_id', 'is', null);
  if (error) {
    console.error('[google] no se pudieron listar los programas con clase:', error);
    return;
  }
  for (const p of data ?? []) {
    await syncClasePrograma(supabase, comercioId, p.id);
  }
}
```

Prueba en `syncClasePrograma.test.ts`. **Ojo con el fixture de ese archivo:** `crearEscenario` crea UN programa y el `afterEach` borra UN `programaId`; un segundo programa quedaría huérfano, bloquearía el borrado del comercio por FK y dejaría basura permanente en la base REAL (incidente del 2026-07-30, CLAUDE.md). Para esta prueba usá `crearEntorno` de `test/fixtures/entornoComercio.ts` (borra por `comercio_id`) en un `describe` aparte con su propio `afterEach(() => entorno.limpiar())`, o extendé el fixture para rastrear varios programas. Escenario: comercio con `logo_url` y `google_class_id`; programa A con `google_class_id: 'clase-x'`; programa B **con `branding_propio: true` y `color_fondo` propio pero SIN `google_class_id`** (así `necesitaClasePropia` da true: sin eso, `syncClasePrograma` corta antes del insert y la mutación no se ve). Aserción: `syncClasesDeProgramasConClase` hace `patch` UNA vez con `resourceId: 'clase-x'` y **ningún `insert`**. MUTACIÓN: quitar el `.not('google_class_id', 'is', null)` → aparece un `insert` para B (crearía una clase permanente). Confirmar y restaurar.

En `actions.ts`, `accionGuardarBranding`, después de `syncClaseComercio`: `await syncClasesDeProgramasConClase(createServiceClient(), comercioId);` con el comentario del porqué.

Prueba nueva `app/comercio/(protegido)/branding/actions.test.ts` con el patrón de `sucursales/actions.test.ts` (mocks de `verifyComercioOwner`, `next/cache`, `notificarCambioComercio`, `syncClase`, `syncComercio`, y `@/lib/google/syncClasePrograma` → **exportar tanto `syncClasesDeProgramasConClase: vi.fn()` como `syncClasePrograma: vi.fn()`**, porque `actions.ts` importa `propagarMarcaPrograma`, que importa `syncClasePrograma`, y el proxy de vitest lanza al acceder a un export ausente del mock): un guardado válido (FormData con los tres colores, `difuminado_franja`, y los cuatro campos del encuadre) llama al barrido con el `comercioId` del gate; un guardado inválido (zoom 999) NO lo llama y devuelve `{ error: 'El zoom debe ser un entero de 100 a 300.' }`.

- [ ] **Step 5: Verde, typecheck, commit**

Run: `npx vitest run lib/google "app/api/comercios" "app/comercio/(protegido)/branding"` → verde. `npx tsc --noEmit` limpio.

```bash
git add "app/api/comercios/[comercioId]/franja.png/route.ts" "app/api/comercios/[comercioId]/franja.png/route.test.ts" lib/google/heroUrl.ts lib/google/heroUrl.test.ts lib/google/syncClase.ts lib/google/syncClase.test.ts lib/google/syncClasePrograma.ts lib/google/syncClasePrograma.test.ts lib/google/linkGuardar.ts lib/google/linkGuardar.test.ts "app/comercio/(protegido)/branding/actions.ts" "app/comercio/(protegido)/branding/actions.test.ts"
git commit -m "La portada de la clase de Google es la misma banda compuesta del pass de Apple" -m "Ruta nueva franja.png (una escala, sin progreso, sin franja propia) con ?v= por todo lo que dibuja. Los TRES lugares que construyen la clase (syncClase, syncClasePrograma y la clase embebida en el JWT de linkGuardar, que Google upsertea por id) apuntan ahi cuando hay foto; sin NEXT_PUBLIC_BASE_URL caen a la foto cruda. Al guardar la marca del negocio se re-sincronizan las clases de los programas que ya tienen una."
```

---

### Task 8: El cartel imprimible aplica el encuadre

**Files:**
- Modify: `lib/comercio/cartel/tipos.ts` (`DatosCartel`)
- Modify: `lib/comercio/cartel/plantillas.ts` (`plantillaFoto`)
- Modify: `lib/comercio/cartel/resolverDatosCartel.ts`
- Modify: `lib/comercio/cartel/plantillas.test.ts`, `lib/comercio/cartel/export.test.ts` (y cualquier otro que construya `DatosCartel`)

- [ ] **Step 1: Pruebas (rojo)**

`DATOS`/`DATOS_BASE` de los tests ganan `encuadreFoto: ENCUADRE_POR_DEFECTO, medidasFoto: null`. En `export.test.ts` agregar:

```ts
  it('el encuadre mueve qué parte de la foto queda en el centro del cartel', async () => {
    // Foto 400×200: mitad izquierda magenta, mitad derecha cian. El cartel "mostrador" es vertical
    // (148×210 mm), así que en 'llenar' sobra ANCHO y el foco horizontal decide qué mitad se ve.
    // Las pruebas de dimensiones no pueden atrapar una foto mal encuadrada: esta cuenta píxeles.
    // MUTACIÓN: volver al `xMidYMid slice` fijo deja el centro del mismo color en los dos casos.
    const mitades = await sharp({ create: { width: 400, height: 200, channels: 4, background: { r: 255, g: 0, b: 255, alpha: 1 } } })
      .composite([{ input: await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 255, b: 255, alpha: 1 } } }).png().toBuffer(), top: 0, left: 200 }])
      .png()
      .toBuffer();
    const base: DatosCartel = {
      ...DATOS,
      plantilla: 'foto',
      fotoDataUri: `data:image/png;base64,${mitades.toString('base64')}`,
      medidasFoto: { ancho: 400, alto: 200 },
    };
    async function magentaEnLaMitadSuperior(datos: DatosCartel): Promise<number> {
      const png = await rasterizarCartelPng(await construirCartelSvg(datos, 'mostrador'), 'mostrador');
      const dim = DIMENSIONES_CARTEL.mostrador.px;
      const recorte = await sharp(png).extract({ left: 0, top: 0, width: dim.ancho, height: Math.floor(dim.alto * 0.3) }).png().toBuffer();
      return contarMagenta(recorte);
    }
    const izquierda = await magentaEnLaMitadSuperior({ ...base, encuadreFoto: { modo: 'llenar', focoX: 0, focoY: 50, zoom: 100 } });
    const derecha = await magentaEnLaMitadSuperior({ ...base, encuadreFoto: { modo: 'llenar', focoX: 100, focoY: 50, zoom: 100 } });
    expect(izquierda).toBeGreaterThan(100000);
    expect(derecha).toBe(0);
  });
```
(Se mide el 30% superior del cartel para quedar lejos de la tarjeta blanca del QR y del logo.)

En `plantillas.test.ts`, en el `describe` de la plantilla foto:
```ts
  it('con medidas de la foto, la mete en un <svg> anidado con la ventana del encuadre', async () => {
    const datos: DatosCartel = { ...DATOS_BASE, plantilla: 'foto', fotoDataUri: 'data:image/png;base64,AAAA', medidasFoto: { ancho: 400, alto: 200 }, encuadreFoto: { modo: 'llenar', focoX: 0, focoY: 50, zoom: 100 } };
    const svg = await construirCartelSvg(datos, 'sticker');
    expect(svg).toMatch(/<svg x="0" y="0" width="400" height="400" viewBox="0 0 200 200" preserveAspectRatio="none">/);
    expect(svg).toContain('<image href="data:image/png;base64,AAAA" x="0" y="0" width="400" height="200" preserveAspectRatio="none"/>');
  });

  it('sin medidas, conserva el xMidYMid slice de siempre', async () => {
    const datos: DatosCartel = { ...DATOS_BASE, plantilla: 'foto', fotoDataUri: 'data:image/png;base64,AAAA', medidasFoto: null };
    expect(await construirCartelSvg(datos, 'sticker')).toContain('preserveAspectRatio="xMidYMid slice"');
  });
```
(El sticker es 400×400 de viewBox; con foto 400×200 en 'llenar', escala 2, ventana 200×200; focoX 0 → x=0.)

- [ ] **Step 2: Implementar**

`tipos.ts`:
```ts
import type { Encuadre, Medidas } from '../encuadreFranja';
export interface DatosCartel {
  // … lo existente …
  // Encuadre de la foto (0032), el MISMO que la franja del pass. Con medidas, plantillaFoto dibuja la
  // ventana exacta; sin medidas (sharp no pudo leerla) cae al xMidYMid slice de siempre.
  encuadreFoto: Encuadre;
  medidasFoto: Medidas | null;
}
```

`plantillas.ts`, en `plantillaFoto`:
```ts
  const fondo = datos.fotoDataUri
    ? `${fotoDeFondo(datos, w, h)}<rect width="${w}" height="${h}" fill="#000000" opacity="0.35"/>`
    : `<rect width="${w}" height="${h}" fill="${datos.colorFondo}"/>`;
```
y la función:
```ts
// La foto a sangre con el encuadre del dueño. `preserveAspectRatio` de SVG solo admite nueve anclajes
// fijos, así que un foco arbitrario necesita un <svg> anidado cuyo viewBox es la VENTANA de la foto
// (rectanguloVisible, la misma aritmética del pass). El <rect> de atrás es lo que se ve en modo
// 'completa' o con zoom hacia afuera; el <svg> interno recorta por defecto, y como la ventana tiene
// la proporción del cartel por construcción, `none` no deforma nada.
function fotoDeFondo(datos: DatosCartel, w: number, h: number): string {
  if (!datos.medidasFoto) {
    return `<image href="${datos.fotoDataUri}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`;
  }
  const r = rectanguloVisible(datos.medidasFoto, { ancho: w, alto: h }, datos.encuadreFoto);
  const n = (v: number) => Number(v.toFixed(3));
  return (
    `<rect width="${w}" height="${h}" fill="${datos.colorFondo}"/>` +
    `<svg x="0" y="0" width="${w}" height="${h}" viewBox="${n(r.x)} ${n(r.y)} ${n(r.ancho)} ${n(r.alto)}" preserveAspectRatio="none">` +
    `<image href="${datos.fotoDataUri}" x="0" y="0" width="${datos.medidasFoto.ancho}" height="${datos.medidasFoto.alto}" preserveAspectRatio="none"/>` +
    `</svg>`
  );
}
```
(`plantillas.ts` es puro y lo importa el navegador: NO importar sharp acá.)

`resolverDatosCartel.ts`: reemplazar `aDataUri` por `bajarImagen(url): Promise<{ dataUri: string; medidas: Medidas | null } | null>` que además hace `sharp(bytes).metadata()` en try/catch (best-effort → `medidas: null`). El logo sigue usando solo `dataUri`. En `datos` devolver `fotoDataUri: foto?.dataUri ?? null, medidasFoto: foto?.medidas ?? null, encuadreFoto: marca.encuadreFranja`.

- [ ] **Step 3: Verde, typecheck, commit**

Run: `npx vitest run lib/comercio/cartel` → verde (incluida la mutación anotada: volver al `slice` fijo hace fallar la de píxeles). `npx tsc --noEmit` limpio (`EditorCartel.tsx` hereda los campos vía `...datosResueltos`; si el compilador señala algo más, arreglarlo).

```bash
git add lib/comercio/cartel/tipos.ts lib/comercio/cartel/plantillas.ts lib/comercio/cartel/resolverDatosCartel.ts lib/comercio/cartel/plantillas.test.ts lib/comercio/cartel/export.test.ts
git commit -m "El cartel con foto aplica el mismo encuadre que la franja del pass" -m "preserveAspectRatio solo admite nueve anclajes; un foco arbitrario necesita un svg anidado cuyo viewBox es la ventana de rectanguloVisible. El servidor mide la foto al bajarla; sin medidas queda el slice centrado de siempre. Prueba de pixeles: el foco horizontal decide que mitad de la foto queda en el cartel."
```

---

### Task 9: Editor y vista previa por tipo, controles de encuadre y arrastre

**Files:**
- Modify: `app/comercio/(protegido)/branding/FormularioBranding.tsx` (reescritura)
- Modify: `app/comercio/(protegido)/branding/page.tsx`
- Modify: `app/globals.css` (estilos del bloque de encuadre)

No hay pruebas de componentes en el repo: la verificación de esta tarea es el typecheck + la revisión en el navegador que hace el controlador (Task 10). Toda la aritmética ya está probada en Tasks 1 y 2.

- [ ] **Step 1: `page.tsx`**

- Import: `import { encuadreDelComercio } from '@/lib/comercio/encuadreFranja';` (el select de `comercios` ya trae las 4 columnas desde Task 4).
- `const tipoTarjeta = programaDeReferencia?.tipoTarjeta ?? c.tipo_tarjeta ?? 'puntos';` y `const esSellos = tipoOPuntos(tipoTarjeta).valor === 'sellos';` (reemplaza el cálculo actual de `esSellos`; `FormularioReverso` recibe `tipoTarjeta`).
- Etiqueta de la franja: `etiqueta: esSellos ? 'Franja personalizada (reemplaza la grilla de sellos)' : 'Franja personalizada (reemplaza la foto de fondo)'`.
- Props nuevas de `FormularioBranding`: `tipoTarjeta={tipoTarjeta}` (en vez de `esSellos`), `encuadreInicial={seleccionado ? (marca?.encuadreFranja ?? null) : encuadreDelComercio(c)}`, `fotoPropia={seleccionado ? marca?.heroUrl != null : c.hero_url != null}`, y `urls` gana `strip: seleccionado ? (marca?.stripUrl ?? c.strip_url) : c.strip_url`.

- [ ] **Step 2: `FormularioBranding.tsx`** — reescribir con esta estructura (conservar TODO lo que hoy funciona: estado de colores, remount del select, botón de volver al negocio, mensajes):

```tsx
'use client';

import { useState, useRef, useEffect, type ChangeEvent, type PointerEvent as PointerEventReact, type ReactNode } from 'react';
import { useActionState } from 'react';
import { accionGuardarBranding, accionGuardarBrandingDePrograma, accionUsarDisenoDelNegocio, type EstadoBranding } from './actions';
import { NIVELES_DIFUMINADO, stopsDifuminado, type NivelDifuminado } from '@/lib/apple/difuminadoFranja';
import { hexDesdeRgb, rgbDesdeTexto } from '@/lib/comercio/colorHex';
import { frentePase } from '@/lib/tarjetas/frentePase';
import { tipoOPuntos } from '@/lib/tarjetas/tipos';
import {
  ENCUADRE_POR_DEFECTO, MARCO_FRANJA, ZOOM_MINIMO, ZOOM_MAXIMO,
  colocarFoto, porcentajesDeColocacion, focoTrasArrastre,
  type Encuadre, type Medidas,
} from '@/lib/comercio/encuadreFranja';

// … ETIQUETAS_DIFUMINADO, AVISO_GOOGLE, Colores, CAMPOS_COLOR como hoy …

type Props = {
  nombreComercio: string;
  // El tipo de la tarjeta que se diseña: decide qué campos lleva el frente del pass (frentePase) y
  // si hay meta de sellos. Antes era un booleano `esSellos` y todo lo que no fuera sellos se
  // dibujaba como puntos — una membresía mostraba "PUNTOS 0".
  tipoTarjeta: string;
  programaId: string | null;
  nombreTarjeta: string;
  inicial: Colores & { sello_meta: string };
  heredado: Colores | null;
  // Encuadre con el que arranca el formulario: el guardado del negocio (nunca null), o el propio de
  // la tarjeta (null si nunca lo tocó → se edita desde el default).
  encuadreInicial: Encuadre | null;
  // Si la foto que se ve es PROPIA de lo que se diseña (negocio: hay foto; tarjeta: hero_url propio).
  // Decide si los cuatro campos del encuadre viajan y si el bloque se edita — el encuadre viaja con
  // la foto (brandingEfectivo).
  fotoPropia: boolean;
  usaDisenoPropio: boolean;
  tieneDisenoGuardado: boolean;
  urls: { logo: string | null; hero: string | null; strip: string | null; selloIcono: string | null };
  subidas: ReactNode;
};

const NOMBRE_DE_EJEMPLO = 'Nombre del cliente';
```

Cuerpo del componente (además de lo que ya existe):

```tsx
  const esSellos = tipoOPuntos(tipoTarjeta).valor === 'sellos';

  // ---- encuadre -------------------------------------------------------------------------------
  const [encuadre, setEncuadre] = useState<Encuadre>(encuadreInicial ?? ENCUADRE_POR_DEFECTO);
  // Medidas naturales de la foto: 0 hasta el onLoad. Sin ellas la foto se dibuja con cover centrado
  // y no se arrastra (colocarFoto exige medidas válidas).
  const [medidasFoto, setMedidasFoto] = useState<Medidas | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const ultimoPunteroRef = useRef<{ x: number; y: number } | null>(null);

  const hayFoto = Boolean(urls.hero);
  const hayStrip = Boolean(urls.strip);
  // Cuándo VIAJAN los cuatro campos vs cuándo se VEN los controles: dos reglas distintas a propósito
  // (spec, Editor). En negocio viajan SIEMPRE (columnas NOT NULL, y un negocio sin foto tiene que
  // poder publicar colores); en una tarjeta, solo con foto propia (sin ella: null → hereda).
  const mandaEncuadre = programaId ? fotoPropia : true;
  const editaEncuadre = hayFoto && !hayStrip && fotoPropia;
  const puedeArrastrar = editaEncuadre && medidasFoto !== null;

  const colocacion = medidasFoto ? porcentajesDeColocacion(colocarFoto(medidasFoto, MARCO_FRANJA, encuadre), MARCO_FRANJA) : null;

  function alAgarrarFoto(e: PointerEventReact<HTMLDivElement>) {
    if (!puedeArrastrar) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    ultimoPunteroRef.current = { x: e.clientX, y: e.clientY };
    setArrastrando(true);
  }
  function alMoverFoto(e: PointerEventReact<HTMLDivElement>) {
    const anterior = ultimoPunteroRef.current;
    if (!anterior || !medidasFoto) return;
    const caja = e.currentTarget.getBoundingClientRect();
    // Delta INCREMENTAL: al pasarse del borde el foco se acota y al volver responde de inmediato.
    const delta = { x: e.clientX - anterior.x, y: e.clientY - anterior.y };
    ultimoPunteroRef.current = { x: e.clientX, y: e.clientY };
    const foco = focoTrasArrastre(encuadre, delta, medidasFoto, { ancho: caja.width, alto: caja.height });
    setEncuadre((v) => ({ ...v, ...foco }));
  }
  function alSoltarFoto(e: PointerEventReact<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    ultimoPunteroRef.current = null;
    setArrastrando(false);
    // Los focos se guardan como enteros (validarEncuadre); durante el arrastre son floats para no
    // perder los desplazamientos chicos.
    setEncuadre((v) => ({ ...v, focoX: Math.round(v.focoX), focoY: Math.round(v.focoY) }));
  }

  // ---- frente del pass ------------------------------------------------------------------------
  // La misma función que arma el pass real. Contador 0 (tarjeta recién emitida) salvo en sellos, que
  // conserva la demostración de 7 llenos. hayGrilla asume composición exitosa (el navegador no
  // puede saber si next/og falló).
  const frente = frentePase({
    tipoTarjeta,
    puntos: esSellos ? llenos : 0,
    selloMeta: esSellos ? metaConfigurada : null,
    hayGrilla: esSellos && metaConfigurada !== null && !hayStrip,
  });
```

Vista previa — la franja:

```tsx
          <div
            style={{ position: 'relative', width: '100%', aspectRatio: '375 / 123', overflow: 'hidden',
              touchAction: puedeArrastrar ? 'none' : undefined,
              cursor: puedeArrastrar ? (arrastrando ? 'grabbing' : 'grab') : undefined }}
            onPointerDown={alAgarrarFoto}
            onPointerMove={alMoverFoto}
            onPointerUp={alSoltarFoto}
            onPointerCancel={alSoltarFoto}
            aria-label={puedeArrastrar ? 'Arrastrá la foto para encuadrarla' : undefined}
          >
            {hayStrip ? (
              // La franja personalizada reemplaza TODO lo que va en esta zona (el pass la usa tal cual).
              // eslint-disable-next-line @next/next/no-img-element -- vista previa simple
              <img src={urls.strip!} alt="" aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <>
                {urls.hero && (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element -- vista previa simple */}
                    <img
                      src={urls.hero}
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                      onLoad={(e) => setMedidasFoto({ ancho: e.currentTarget.naturalWidth, alto: e.currentTarget.naturalHeight })}
                      style={colocacion
                        ? { position: 'absolute', left: `${colocacion.left}%`, top: `${colocacion.top}%`, width: `${colocacion.ancho}%`, height: `${colocacion.alto}%`, maxWidth: 'none' }
                        : { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }} />
                    {stops && ( /* los dos gradientes igual que hoy */ )}
                  </>
                )}
                {/* grilla de sellos / aviso de meta / resplandor: igual que hoy, pero el resplandor
                    solo cuando no hay foto (como hoy) */}
              </>
            )}
            {/* El campo primario, SOBRE la franja, abajo a la izquierda: donde Apple dibuja los
                primaryFields de un storeCard. Los tipos sin contador no lo tienen. */}
            {frente.primario && (
              <div style={{ position: 'absolute', left: 16, bottom: 10, pointerEvents: 'none' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: label }}>{frente.primario.etiqueta}</div>
                <div style={{ fontSize: '1.7rem', lineHeight: 1.2, color: texto }}>{frente.primario.valor}</div>
              </div>
            )}
          </div>

          {/* Fila secundaria, debajo de la franja: el contador de sellos con grilla a la izquierda (si lo
              hay) y el titular a la derecha, como el pass real. */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, padding: '12px 16px 4px', minHeight: 44 }}>
            {frente.secundario ? (
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: label }}>{frente.secundario.etiqueta}</div>
                <div style={{ fontSize: '1.1rem', lineHeight: 1.2 }}>{frente.secundario.valor}</div>
              </div>
            ) : <span />}
            <div style={{ textAlign: 'right', fontSize: '0.95rem', opacity: 0.9 }}>{NOMBRE_DE_EJEMPLO}</div>
          </div>
```
(Ojo: el `maxWidth: 'none'` es necesario — el reset global pone `img{max-width:100%}` y acá la foto puede medir 200%+ del marco.)

Editor — dentro del `<form>` de colores, en lugar del `.field` suelto del difuminado, un bloque:

```tsx
          <fieldset key={`encuadre-${claveSelect}`} className="encuadre-franja">
            <legend className="titulo-seccion">Foto de fondo de la franja</legend>

            {/* Los cuatro campos viajan SIEMPRE que corresponda, ocultos si no se editan: si viajaran
                solo cuando se ven, publicar los colores con una franja personalizada puesta borraría
                el encuadre guardado. */}
            {mandaEncuadre && !editaEncuadre && (
              <>
                <input type="hidden" name="encuadre_franja" value={encuadre.modo} />
                <input type="hidden" name="foco_franja_x" value={Math.round(encuadre.focoX)} />
                <input type="hidden" name="foco_franja_y" value={Math.round(encuadre.focoY)} />
                <input type="hidden" name="zoom_franja" value={encuadre.zoom} />
              </>
            )}

            {editaEncuadre && (
              <>
                <div className="field">
                  <span className="field-etiqueta">Encuadre</span>
                  <div className="encuadre-modos" role="radiogroup" aria-label="Encuadre">
                    <label><input type="radio" name="encuadre_franja" value="llenar" checked={encuadre.modo === 'llenar'} onChange={() => setEncuadre((v) => ({ ...v, modo: 'llenar' }))} /> Llenar (recorta)</label>
                    <label><input type="radio" name="encuadre_franja" value="completa" checked={encuadre.modo === 'completa'} onChange={() => setEncuadre((v) => ({ ...v, modo: 'completa' }))} /> Completa (sin recortar)</label>
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="foco_franja_x">Posición horizontal <span className="dato-mono">{Math.round(encuadre.focoX)}</span></label>
                  <input id="foco_franja_x" name="foco_franja_x" type="range" min={0} max={100} step={1} value={Math.round(encuadre.focoX)} onChange={(e) => setEncuadre((v) => ({ ...v, focoX: Number(e.target.value) }))} />
                </div>
                <div className="field">
                  <label htmlFor="foco_franja_y">Posición vertical <span className="dato-mono">{Math.round(encuadre.focoY)}</span></label>
                  <input id="foco_franja_y" name="foco_franja_y" type="range" min={0} max={100} step={1} value={Math.round(encuadre.focoY)} onChange={(e) => setEncuadre((v) => ({ ...v, focoY: Number(e.target.value) }))} />
                </div>
                <div className="field">
                  <label htmlFor="zoom_franja">Zoom <span className="dato-mono">{encuadre.zoom}%</span></label>
                  <input id="zoom_franja" name="zoom_franja" type="range" min={ZOOM_MINIMO} max={ZOOM_MAXIMO} step={5} value={encuadre.zoom} onChange={(e) => setEncuadre((v) => ({ ...v, zoom: Number(e.target.value) }))} />
                </div>
                <p className="field-aviso" style={{ color: 'var(--texto-2)' }}>
                  También podés arrastrar la foto en la vista previa.
                </p>
              </>
            )}

            {programaId && hayFoto && !fotoPropia && !hayStrip && (
              <p className="field-aviso" style={{ color: 'var(--texto-2)' }}>
                Esta tarjeta usa la foto de tu negocio, y el encuadre acompaña a la foto: se ajusta desde “Todas mis tarjetas”. Subí una foto propia arriba para encuadrarla acá.
              </p>
            )}
            {hayStrip && (
              <p className="field-aviso" style={{ color: 'var(--texto-2)' }}>
                La franja personalizada reemplaza a la foto de fondo: el encuadre y el difuminado no aplican mientras esté puesta.
              </p>
            )}
            {!hayFoto && !hayStrip && (
              <p className="field-aviso" style={{ color: 'var(--texto-2)' }}>
                Subí una foto de fondo de la franja arriba para encuadrarla.
              </p>
            )}

            {/* el .field del difuminado, igual que hoy (con su <select key={claveSelect}>) */}
          </fieldset>
```

- [ ] **Step 3: CSS** en `app/globals.css`, junto a `.branding-grid`:

```css
/* Bloque de encuadre de la foto de la franja (editor de marca). Un fieldset sin la caja del
   navegador: la sección ya vive dentro del panel del formulario. */
.encuadre-franja {
  border: 0;
  padding: 0;
  margin: 0 0 18px;
  min-width: 0;
}
.encuadre-franja legend { padding: 0; margin-bottom: 14px; }
.encuadre-modos { display: flex; gap: 16px; flex-wrap: wrap; }
.encuadre-modos label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.encuadre-franja input[type='range'] { width: 100%; accent-color: var(--acento); }
.field-etiqueta { display: block; margin-bottom: 8px; }
```
(Verificar que `--acento` exista en el archivo; si el token se llama distinto, usar el que usan los botones `.btn-acento`.)

- [ ] **Step 4: Typecheck, lint y commit**

Run: `npx tsc --noEmit` → limpio. `npx eslint "app/comercio/(protegido)/branding"` → limpio.

```bash
git add "app/comercio/(protegido)/branding/FormularioBranding.tsx" "app/comercio/(protegido)/branding/page.tsx" app/globals.css
git commit -m "Editor de marca: vista previa fiel por tipo y controles de encuadre con arrastre" -m "La vista previa usa frentePase (la misma funcion del pass): una membresia ya no muestra PUNTOS 0, el campo primario va sobre la franja y el titular debajo. La foto se coloca con colocarFoto y se arrastra con focoTrasArrastre; los deslizadores siguen existiendo. Los cuatro campos viajan siempre que haya foto propia, ocultos cuando no se editan."
```

---

### Task 10 (controlador): verificación en navegador, estado del proyecto

- [ ] Levantar el dev server del worktree con `preview_start` (sirve ESTE código), entrar con la cuenta de prueba de membresía del usuario (o crear un comercio de prueba) y verificar:
  1. Membresía: la franja no tiene texto encima y debajo solo está "Nombre del cliente" a la derecha.
  2. Puntos: "PUNTOS 0" sobre la franja abajo a la izquierda.
  3. Sellos con meta: franja sin texto; "SELLOS 7 de N" debajo a la izquierda.
  4. Con foto: `getBoundingClientRect` de la `<img>` cambia entre foco vertical 0 y 100; arrastrar con `pointerdown/move/up` mueve la foto y actualiza el deslizador; el zoom agranda la `<img>`.
  5. Publicar guarda (verificar en la BD con un script de solo lectura o la vista previa tras recargar).
  6. La etiqueta de la franja personalizada dice "(reemplaza la foto de fondo)" fuera de sellos.
- [ ] Correr la suite completa: `npx vitest run` → todo verde; `npx tsc --noEmit`; `npx eslint .`.
- [ ] Agregar la sección del día a `docs/superpowers/ESTADO-Y-PLAN-2026-07-28.md` (qué se hizo, la 0032, la decisión "el encuadre viaja con la foto", el cambio visible en Android, y lo que queda: QA en teléfono real de Apple y Google con una foto encuadrada).
- [ ] Commit final del estado.

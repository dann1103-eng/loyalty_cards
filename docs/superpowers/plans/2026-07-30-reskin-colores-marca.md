# Reskin de colores de marca — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el acento naranja del panel por la paleta oficial de marca (violeta/lima) en los
3 temas de `app/globals.css`, sin tocar estructura, componentes ni ningún otro archivo.

**Architecture:** Edición directa de constantes CSS (`:root` y sus dos overrides `[data-tema=…]`).
No hay lógica nueva, no hay componentes nuevos, no hay pruebas automatizadas nuevas — es un cambio de
valores dentro de un archivo ya existente.

**Tech Stack:** CSS custom properties puro (sin preprocesador, sin CSS-in-JS).

**Spec:** `docs/superpowers/specs/2026-07-30-reskin-colores-marca-design.md`

---

## Antes de empezar

Este plan asume que quien lo ejecuta parte de un checkout limpio en la rama `master` del checkout
PRINCIPAL (`C:\Users\Daniel\Desktop\Loyalty Cards`), **no** de un worktree de infraestructura de la
sesión. Si te dispatchan como subagente para este plan: confirmá con `git branch --show-current` que
estás parado en `master` de esa ruta ANTES de tocar nada; si no, `cd` ahí primero.

## Task 1: Reemplazar los tokens de acento en los 3 temas

**Files:**
- Modify: `app/globals.css:47-49,84-85,101-102,115-116` (Oscuro), `:153-155,167-168,178-179,186-188`
  (Claro), `:222-224,238,250-251` (Alto contraste), `:692` (glow de `.sello.lleno`, fuera de los
  bloques de tema pero con el mismo naranja viejo — ver Step 12)

Todos los valores de esta tarea salen literalmente de las tablas de
`docs/superpowers/specs/2026-07-30-reskin-colores-marca-design.md §3` — no hay margen de
interpretación, son reemplazos de cadena exactos.

- [ ] **Step 1: Tema Oscuro — reemplazar el bloque de acento**

En `app/globals.css`, dentro de `:root { ... }` (el primer bloque del archivo):

Buscar:
```css
  /* ---------- acento único: naranja cálido ---------- */
  --acento: #ffc495;
  --acento-fuerte: #ff9d42;
  --sobre-acento: #42230a; /* texto oscuro SOLO sobre superficies acento (contraste) */
```

Reemplazar por:
```css
  /* ---------- acento único: violeta de marca (antes naranja cálido) ---------- */
  --acento: #8f86e0; /* Soft */
  --acento-fuerte: #514ba8; /* --violeta oficial */
  --sobre-acento: #181849; /* Deep — texto oscuro SOLO sobre superficies acento (contraste) */
```

- [ ] **Step 2: Tema Oscuro — reemplazar `--ring`/`--sombra-acento`**

Buscar:
```css
  --ring: 0 0 0 4px rgba(255, 196, 149, 0.22);
  --sombra-acento: 0 0 24px rgba(255, 157, 66, 0.25);
```

Reemplazar por:
```css
  --ring: 0 0 0 4px rgba(143, 134, 224, 0.22);
  --sombra-acento: 0 0 24px rgba(81, 75, 168, 0.25);
```

- [ ] **Step 3: Tema Oscuro — reemplazar `--acento-suave`/`--acento-borde`**

Buscar:
```css
  --acento-suave: rgba(255, 196, 149, 0.12);
  --acento-borde: rgba(255, 196, 149, 0.4);
```

Reemplazar por:
```css
  --acento-suave: rgba(143, 134, 224, 0.12);
  --acento-borde: rgba(143, 134, 224, 0.4);
```

- [ ] **Step 4: Tema Oscuro — reemplazar el glow de `--atmosfera`**

Buscar (dentro de `--atmosfera:`, es el PRIMER `radial-gradient` de los dos):
```css
  --atmosfera:
    radial-gradient(110% 70% at 8% -10%, rgba(255, 157, 66, 0.09) 0%, transparent 55%),
    radial-gradient(90% 60% at 100% 110%, rgba(139, 214, 180, 0.05) 0%, transparent 55%);
```

Reemplazar por (el segundo `radial-gradient`, el del menta, NO se toca):
```css
  --atmosfera:
    radial-gradient(110% 70% at 8% -10%, rgba(81, 75, 168, 0.09) 0%, transparent 55%),
    radial-gradient(90% 60% at 100% 110%, rgba(139, 214, 180, 0.05) 0%, transparent 55%);
```

- [ ] **Step 5: Tema Claro — reemplazar el bloque de acento**

Dentro de `:root[data-tema="claro"] { ... }`:

Buscar:
```css
  --acento: #a8480a;
  --acento-fuerte: #c2410c;
  --sobre-acento: #fff6ee;
```

Reemplazar por:
```css
  --acento: #514ba8; /* --violeta oficial */
  --acento-fuerte: #3d3880; /* violeta más oscuro, hover/press */
  --sobre-acento: #f5f4fc;
```

- [ ] **Step 6: Tema Claro — reemplazar `--ring`/`--sombra-acento`**

Buscar:
```css
  --ring: 0 0 0 4px rgba(168, 72, 10, 0.18);
  --sombra-acento: 0 0 24px rgba(194, 65, 12, 0.22);
```

Reemplazar por:
```css
  --ring: 0 0 0 4px rgba(81, 75, 168, 0.18);
  --sombra-acento: 0 0 24px rgba(61, 56, 128, 0.22);
```

- [ ] **Step 7: Tema Claro — reemplazar `--acento-suave`/`--acento-borde`**

Buscar:
```css
  --acento-suave: rgba(168, 72, 10, 0.12);
  --acento-borde: rgba(168, 72, 10, 0.4);
```

Reemplazar por:
```css
  --acento-suave: rgba(81, 75, 168, 0.12);
  --acento-borde: rgba(81, 75, 168, 0.4);
```

- [ ] **Step 8: Tema Claro — reemplazar el glow de `--atmosfera`**

Buscar (dentro del bloque `:root[data-tema="claro"]`, es el PRIMER `radial-gradient`):
```css
  --atmosfera:
    radial-gradient(110% 70% at 8% -10%, rgba(255, 157, 66, 0.16) 0%, transparent 55%),
    radial-gradient(90% 60% at 100% 110%, rgba(13, 110, 74, 0.08) 0%, transparent 55%);
```

Reemplazar por (el segundo `radial-gradient` NO se toca):
```css
  --atmosfera:
    radial-gradient(110% 70% at 8% -10%, rgba(81, 75, 168, 0.16) 0%, transparent 55%),
    radial-gradient(90% 60% at 100% 110%, rgba(13, 110, 74, 0.08) 0%, transparent 55%);
```

- [ ] **Step 9: Tema Alto contraste — reemplazar el bloque de acento**

Dentro de `:root[data-tema="alto-contraste"] { ... }`:

Buscar:
```css
  --acento: #ffb01f;
  --acento-fuerte: #ff9500;
  --sobre-acento: #000000;
```

Reemplazar por:
```css
  --acento: #c9ec5e; /* Lima */
  --acento-fuerte: #a9d13a; /* lima más oscuro, hover/press */
  --sobre-acento: #000000;
```

- [ ] **Step 10: Tema Alto contraste — reemplazar `--ring`**

Buscar:
```css
  --ring: 0 0 0 4px rgba(255, 176, 31, 0.6);
```

Reemplazar por:
```css
  --ring: 0 0 0 4px rgba(201, 236, 94, 0.6);
```

- [ ] **Step 11: Tema Alto contraste — reemplazar `--acento-suave`/`--acento-borde`**

Buscar:
```css
  --acento-suave: rgba(255, 176, 31, 0.22);
  --acento-borde: rgba(255, 176, 31, 0.85);
```

Reemplazar por:
```css
  --acento-suave: rgba(201, 236, 94, 0.22);
  --acento-borde: rgba(201, 236, 94, 0.85);
```

`--sombra-acento`/`--atmosfera` de este tema ya están en `none` (líneas 239 y 258) — no se tocan.

- [ ] **Step 12: `.sello.lleno` — un resabio de naranja SIN documentar, fuera de los bloques de tema**

`app/globals.css:688-693` tiene un glow hardcodeado que no vive dentro de ningún `:root[data-tema=…]`
y por eso los steps de arriba no lo tocan — pero es el mismo naranja viejo, y a diferencia de los
otros dos literales hardcodeados del archivo (líneas 1105-1111 y 1662-1672), **este no tiene ningún
comentario que lo marque como intencional.** Es el glow del sello YA LLENO (relleno con
`var(--acento-fuerte)`, que sí cambia con el tema) — dejarlo en naranja significaría que un sello
completo brilla naranja en un panel que en todo lo demás ya es violeta.

Buscar:
```css
.sello.lleno {
  border-color: transparent;
  background: var(--acento-fuerte);
  color: var(--sobre-acento);
  box-shadow: 0 0 12px rgba(255, 157, 66, 0.4);
}
```

Reemplazar por (mismo alpha, mismo radio de difuminado — solo el color, igual que el resto de esta
tarea; sigue sin ser un `var()`, porque convertirlo sería un cambio de estructura, no de color, y sale
del alcance de este plan):
```css
.sello.lleno {
  border-color: transparent;
  background: var(--acento-fuerte);
  color: var(--sobre-acento);
  box-shadow: 0 0 12px rgba(81, 75, 168, 0.4);
}
```

- [ ] **Step 13: Barrido — confirmar que no queda ningún resabio naranja, SOLO en los bloques de tema**

El barrido se limita a las líneas 23-259 (los tres bloques `:root[data-tema=…]`) a propósito: el
archivo tiene DOS literales naranja más, fuera de esas líneas, que son intencionales y ya están
documentados en el propio archivo — **no tocarlos**:
- `globals.css:1111` (`.subida-imagen:hover`) — comentario en 1105-1110 explica por qué se queda.
- `globals.css:1672` (`.escaner-guia`) — comentario en 1662-1664 explica por qué se queda (se calibró
  contra el video real de la cámara, no contra el panel).

Correr, desde el checkout principal:

```bash
sed -n '23,259p' app/globals.css | grep -n "255, 196, 149\|255, 157, 66\|ffc495\|ff9d42\|42230a\|a8480a\|c2410c\|fff6ee\|168, 72, 10\|194, 65, 12\|ffb01f\|ff9500\|255, 176, 31"
```

Expected: **sin salida** (0 coincidencias). Si aparece algo, es un valor de acento que quedó sin
migrar dentro de un bloque de tema — revisar contra la tabla del spec antes de seguir. (Nota:
`255, 157, 66` en el SEGUNDO `radial-gradient` de `--atmosfera` no existe — ese usa `139, 214, 180`,
el menta, que nunca cambia; si el grep encuentra `255, 157, 66` es porque un `--atmosfera` quedó sin
tocar en el primer gradiente.)

- [ ] **Step 14: Typecheck y lint**

```bash
npx tsc --noEmit
npm run lint
```

Expected: ambos sin errores. Un cambio de CSS puro no debería tocar TypeScript, pero es la
verificación estándar del proyecto antes de cualquier commit.

- [ ] **Step 15: Commit**

```bash
git add app/globals.css
git commit -m "Reskin: acento de marca (violeta/lima) en los 3 temas del panel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Verificación final (la hace el orquestador, NO un subagente)

Esta verificación es visual y usa el navegador — por regla del proyecto, no se levanta un dev server
dentro de un subagente. La hace quien dispatchea las tareas, con las herramientas de navegador:

1. Levantar el dev server (`preview_start` con el nombre configurado en `.claude/launch.json`, o
   `npm run dev` si no hay uno).
2. Abrir `/comercio/panel` en los 3 temas (selector de tema en la UI) y confirmar visualmente que el
   acento es violeta (o lima en alto contraste) y que no queda ningún naranja.
3. Abrir `/comercio/branding` (tiene formularios) y `/comercio/reportes` (tiene tablas) en los 3 temas.
4. Enfocar un botón primario con Tab en cada tema y confirmar que el anillo de foco (`--ring`) se ve
   con el color nuevo.
5. Capturar una screenshot de cada tema en `/comercio/panel` para dejar registro visual del resultado.

Si algo no se ve bien, NO es un problema de este plan (los valores están tomados 1:1 del spec ya
revisado) — es una señal de que el spec necesita un ajuste, y hay que volver a
`docs/superpowers/specs/2026-07-30-reskin-colores-marca-design.md` antes de tocar más CSS a ojo.

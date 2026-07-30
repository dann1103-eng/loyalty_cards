# Reskin de colores con la identidad de marca — diseño

**Fecha:** 2026-07-30
**Estado:** aprobado por el usuario (decisiones §5), validado con mockups en el companion de brainstorming.

## 1. Problema

El panel (`app/globals.css`) tiene un sistema de temas ya maduro — oscuro/claro/alto-contraste,
tokens calibrados a mano con ratios de contraste documentados línea por línea — pero su acento es un
naranja cálido (`#ffc495`/`#ff9d42`/`#a8480a`/`#c2410c`) que no tiene relación con la paleta oficial de
marca (Gray `#E9E8E3` · Lima `#C9EC5E` · Soft `#8F86E0` · Frosted `#B1E4F9` · Teal `#234B59` · Deep
`#181849`) ya usada en la landing (`app/_inicio/inicio.module.css:24`) y en el folleto. Ahora que esa
identidad está cerrada, el panel debe reflejarla.

## 2. Alcance

**Solo colores. Nada de estructura.** El usuario fue explícito: la estructura del panel ya está bien.
Este trabajo toca EXCLUSIVAMENTE los valores hex/rgba dentro de los tres bloques
`:root[data-tema=…]` de `app/globals.css:23-259` — ningún componente, ningún layout, ningún archivo
nuevo.

**Decisiones tomadas con mockups reales** (companion de brainstorming, `paleta-acento.html` y
`fondos.html`):

1. El acento pasa de naranja a **violeta** (`Soft`/`Violeta` de marca), con **lima** reservado como
   chispa puntual (badges tipo "Recomendado", no como acento de uso general).
2. Los **fondos quedan neutros**, igual que hoy — el violeta vive en botones/links/acentos, no tiñe
   `--fondo`/`--superficie-*`.
3. `--menta` (éxito/datos) y `--error` **no se tocan** — son semánticos, no de marca.
4. Alto contraste cambia su acento de ámbar a **lima**, porque ya es la paleta más saturada de marca y
   sirve igual de bien (o mejor, ver §3) para el propósito real de ese tema: legibilidad bajo el sol.

## 3. Valores nuevos, por tema

Todos los pares reusan hex OFICIALES de la paleta de marca — ninguno es inventado. Los alphas de
`--acento-suave`/`--acento-borde`/`--ring`/`--sombra-acento` **se preservan tal cual** (misma fracción
que hoy), solo cambia el color base: esas fracciones ya fueron calibradas una vez (comentario de
`globals.css:135-139`) y no hay motivo para tocarlas de nuevo.

### Oscuro (`:root`, líneas 47-49, 84-85, 101-102, 115-116)

| Token | Antes | Después |
|---|---|---|
| `--acento` | `#ffc495` | `#8f86e0` (Soft) |
| `--acento-fuerte` | `#ff9d42` | `#514ba8` (Violeta oficial) |
| `--sobre-acento` | `#42230a` | `#181849` (Deep) |
| `--acento-suave` | `rgba(255,196,149,.12)` | `rgba(143,134,224,.12)` |
| `--acento-borde` | `rgba(255,196,149,.4)` | `rgba(143,134,224,.4)` |
| `--ring` | `rgba(255,196,149,.22)` en el `0 0 0 4px …` | `rgba(143,134,224,.22)` |
| `--sombra-acento` | `rgba(255,157,66,.25)` en `0 0 24px …` | `rgba(81,75,168,.25)` |
| `--atmosfera` (1er radial) | `rgba(255,157,66,.09)` | `rgba(81,75,168,.09)` |

Contraste `--sobre-acento` sobre `--acento` (texto del botón primario): **5.26:1** — sobre el mínimo
AA de 4.5:1 para texto normal. `--acento` como texto plano sobre `--superficie-1` (`#1c1b1b`, uso de
links/nav activo, p.ej. `globals.css:353,787,1387`): **5.45:1**.

### Claro (`:root[data-tema="claro"]`, líneas 153-155, 178-179)

| Token | Antes | Después |
|---|---|---|
| `--acento` | `#a8480a` | `#514ba8` (Violeta oficial) |
| `--acento-fuerte` | `#c2410c` | `#3d3880` (violeta más oscuro, hover/press) |
| `--sobre-acento` | `#fff6ee` | `#f5f4fc` |
| `--acento-suave` | `rgba(168,72,10,.12)` | `rgba(81,75,168,.12)` |
| `--acento-borde` | `rgba(168,72,10,.4)` | `rgba(81,75,168,.4)` |
| `--ring` | `rgba(168,72,10,.18)` | `rgba(81,75,168,.18)` |
| `--sombra-acento` | `rgba(194,65,12,.22)` | `rgba(61,56,128,.22)` |
| `--atmosfera` (1er radial) | `rgba(255,157,66,.16)` | `rgba(81,75,168,.16)` |

Contraste `--sobre-acento` sobre `--acento`: **6.71:1**. `--acento` como texto sobre `--superficie-1`
(`#ffffff`): **7.19:1**. Ambos con más margen que el mínimo que ya tenía el naranja original (~4.5:1
según el comentario de `globals.css:125-126`).

### Alto contraste (`:root[data-tema="alto-contraste"]`, líneas 222-224, 250-251)

| Token | Antes | Después |
|---|---|---|
| `--acento` | `#ffb01f` | `#c9ec5e` (Lima) |
| `--acento-fuerte` | `#ff9500` | `#a9d13a` (lima más oscuro, hover/press) |
| `--sobre-acento` | `#000000` | `#000000` (sin cambio) |
| `--acento-suave` | `rgba(255,176,31,.22)` | `rgba(201,236,94,.22)` |
| `--acento-borde` | `rgba(255,176,31,.85)` | `rgba(201,236,94,.85)` |
| `--ring` | `rgba(255,176,31,.6)` | `rgba(201,236,94,.6)` |

`--sombra-acento`/`--atmosfera` ya están en `none` en este tema (`globals.css:239-240,258`) y siguen
así — no hay sombras que recolorear.

Contraste `#000000` sobre `#c9ec5e`: **15.6:1** — muy por encima del `#ffb01f` original (que ya
cumplía, pero con menos margen). El lima no solo mantiene el propósito de "saturado sobre negro para
leerse al sol" — lo mejora.

## 4. Verificación

Sin pruebas automatizadas nuevas (no hay lógica, son constantes CSS). La verificación es visual, con
el controlador (no un subagente — no se levanta dev server en subagentes):

1. Los tres temas, en `/comercio/panel` y al menos una pantalla con formularios (`/comercio/branding`)
   y una con tablas (`/comercio/reportes`): confirmar que no queda ningún resabio naranja y que el
   texto sobre chips/botones se lee bien.
2. `ListaTemas.tsx` (el selector de tema) para confirmar que el ítem activo se distingue con el nuevo
   acento.
3. Estado `:hover`/`:focus` de un botón primario en cada tema (usa `--ring`).
4. Confirmar con las devtools que ningún `--acento-suave`/`--acento-borde` quedó con el alpha viejo
   por un copy-paste incompleto.

## 5. Fuera de alcance

- Fondos tintados de marca (Deep navy / Gray) — decidido explícitamente que NO, quedan neutros.
- Recolorear `--menta` o `--error`.
- Cualquier cambio a `app/_inicio/inicio.module.css` (la landing ya tiene su propia paleta oficial,
  cerrada en una sesión anterior).
- Tipografía, espaciado, radios, sombras de elevación — nada de eso cambia.

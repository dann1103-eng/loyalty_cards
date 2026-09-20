# Rediseño neumórfico de la app

Fecha: 2026-09-20
Estado: decisiones tomadas por Daniel en conversación; aprobado para plan e implementación. Daniel
pidió terminar todo y revisarlo a la vuelta: los valores de color de esta spec se implementan como
están, y **su revisión es sobre el tablero de componentes** (ver esa sección). Nada se publica sin
su OK.

## Por qué

Daniel quiere cambiarle el aspecto a toda la APP — no a la portada `/` — hacia un estilo
neumórfico: botones y bordes suavizados, una paleta más limpia y clara. Trajo tres referencias: un
tablero de componentes soft-UI gris-lavanda, un dashboard claro con un acento saturado, y una app
móvil con variante azul-marino.

Lo que tienen en común, y es lo que este diseño toma de ellas:

- el fondo no es blanco puro; la superficie de cada elemento es **del mismo color que el fondo**, y
  la forma sale solo de dos sombras (luz arriba-izquierda, sombra abajo-derecha);
- radios grandes y consistentes, casi sin bordes;
- un solo acento saturado, que aparece **solo** en lo interactivo activo (el CTA, el toggle
  encendido, el check marcado, el ítem activo);
- tres estados físicos: elevado (reposo), hundido (presionado, o un campo donde se escribe) y plano.

## Decisiones de Daniel

| Tema | Decisión |
|---|---|
| Alcance | Las 34 pantallas de app: comercio (17), cliente final (2), auth y onboarding (6), admin de FM (9). La portada `/` queda fuera. |
| Temas | El **claro** se vuelve neumórfico y pasa a ser **el default**. El **oscuro** queda como variante neumórfica azul-marino. El **alto contraste** queda **plano y con bordes**, sin cambios de concepto: existe para atender bajo el sol. |
| Acento | Se conserva el **violeta de marca** (reskin del 2026-07-30), no el azul de las referencias. El neumorfismo lo definen las superficies y las sombras, no el color del botón. |
| Método | Híbrido: el **sistema** (física de superficies, sombras, estados) se fija con el CSS real en un tablero que se abre en el navegador y en el teléfono. **Stitch** queda solo para explorar el LAYOUT de pantallas puntuales, nunca el estilo. |

## Lo que hay hoy

Verificado en el código (commit `3db8bf0`):

- **No hay Tailwind ni librería de UI.** Todo el estilo de la app vive en `app/globals.css` (1861
  líneas): unas 40 familias de clases semánticas en español alimentadas por variables CSS. Las
  páginas solo consumen clases. No hay componentes `<Boton>`/`<Tarjeta>`: el componente ES la clase.
  Por eso rediseñar es reescribir ese archivo más unos pocos TSX puntuales, no tocar 34 pantallas.
- Tres temas que redefinen los mismos tokens: `:root` (oscuro, hoy el default), `:root[data-tema=
  "claro"]` y `:root[data-tema="alto-contraste"]`. Estado en `data-tema` del `<html>` (`lib/tema.ts`).
- El lenguaje de elevación actual es **vidrio**: `backdrop-filter: blur(16px)`, fondo translúcido,
  sombra oscura difusa. Es incompatible con el neumorfismo, que exige una superficie opaca del mismo
  color que la página. Se reemplaza, no se suma.
- La suite (127 `.test.ts`) no mira clases ni markup. Cero `.test.tsx`, cero snapshots. Los e2e de
  Playwright usan locators semánticos. **Un cambio de CSS no la rompe — y tampoco la cubre.**
- El único guardrail de diseño es `lib/tema.test.ts`: cada tema redefine todos los tokens de `:root`
  (menos `CONSTANTES`), declara `color-scheme`, y hoy fija `TEMA_POR_DEFECTO === 'oscuro'`.
- **No existe ninguna prueba ni módulo de contraste** en el repo (grep de `luminanc`, `0.2126`,
  `0.04045`, `contrastRatio`: cero resultados). Las razones que hay son comentarios calculados a
  mano, y uno está mal (`globals.css:145` dice 3.4:1; la cuenta real da 3.08:1).

## Hallazgos que cambian el diseño

1. **Un fallo de contraste ya está en producción, en el default de hoy.** En el tema oscuro,
   `--sobre-acento` (`#181849`) sobre `--acento-fuerte` (`#514ba8`) da **2.31:1**. WCAG pide 4.5:1
   para texto de 16px, y no llega ni al 3:1 de texto grande. Lo pintan cuatro reglas —
   `.btn-acento` (el botón **"Acreditar"** del escáner, lo que más toca el cajero, y "Publicar
   cambios"), `.sello.lleno`, `.admin-marca .icono-circulo`, `.nav-destacado .icono` — y 8 usos
   inline en TSX. El comentario de `globals.css:49` dice que `--sobre-acento` es para ir sobre
   `--acento` (ahí da 5.26:1). **Se arregla en el token, no en los 12 sitios:** `--acento-fuerte`
   del oscuro pasa a `#a49df0` (6.84:1). En un tema oscuro, "fuerte" significa más lejos del fondo,
   o sea más claro: el valor viejo contradecía el nombre.
2. **`.field textarea` no existe en el CSS.** Hay `<textarea>` en 8 archivos TSX y salen con el
   estilo del navegador. `FormularioReverso.tsx` lo parchea con un estilo inline y un `useState`
   para el foco, y su propio comentario reconoce el hueco.
3. **El foco se dibuja con `box-shadow`.** `.field input:focus` hace `outline: none` (L440) y
   `box-shadow: var(--ring)`. Con un campo hundido, el anillo reemplazaría al hundido; y en
   `forced-colors` el `box-shadow` desaparece. No hay regla global de `:focus-visible`.
4. **La trampa de `none` dentro de una lista de sombras.** En alto contraste las sombras valen
   `none`, y `box-shadow: var(--x), 0 0 0 3px y` con `--x: none` es una declaración inválida: se cae
   la sombra entera. El comentario de `globals.css:1447-1449` ya lo documenta para
   `.nav-destacado.activo`. El neumorfismo compone sombras por naturaleza, así que esto se resuelve
   con una regla del sistema y una prueba, no caso por caso.
5. **El cambio de default se filtra fuera de las 34 pantallas.** `html { color-scheme: dark }`
   (L271); `app/manifest.ts` con `#131313`; `app/mi-tarjeta/layout.tsx` con
   `statusBarStyle: 'black-translucent'` (íconos blancos de la barra de estado: invisibles sobre un
   fondo claro); y la portada, fuera de alcance, consume tokens globales de tema.
6. **El worktree de trabajo no tiene `.env.local`**, y `vitest.setup.ts:4` lanza si falta: no corre
   ninguna prueba, ni siquiera las puras. Lo copia Daniel en su terminal; el asistente no lo lee ni
   lo copia.
7. `DESIGN.md` y `PRODUCT.md` todavía describen el acento naranja y "oscuro por defecto".
8. **Un segundo fallo, en alto contraste, que apareció al correr un prototipo de la prueba contra el
   CSS de hoy.** La pastilla "inactivo" pinta `--error` (`#ff8a7a`) sobre `--error-suave`
   (`rgba(255, 138, 122, 0.22)` sobre negro): **6.67:1**. Pasa el AA, pero no el 7:1 que esta spec
   le exige al texto de ese tema, que existe para leer bajo el sol. `--error-suave` solo lo usa
   `.pastilla-inactivo`, así que se arregla bajando su alpha en alto contraste a **0.16** (7.52:1),
   sin tocar `--error`, que pinta todos los avisos de error. Va en la Fase 2 junto con el hallazgo 1.

## Reglas del sistema

**1. El relieve comunica FORMA, nunca ESTADO.** Activo, seleccionado y con foco se marcan siempre
con el acento — relleno, borde, `outline`, una marca de verificación. Un chip que solo "se hunde" al
activarse desaparece bajo el sol, en escala de grises y para quien no distingue bien el contraste
bajo. El relieve dice "esto es una superficie"; el acento dice "esto está activo".

**2. Los tokens compuestos van solos en su declaración.** `box-shadow: var(--relieve-2);` y nada
más en esa línea. Los colores base (`--luz`, `--sombra-relieve`) sí pueden aparecer dentro de una
lista, porque en alto contraste valen `transparent`, que es un color válido. Los compuestos
(`--relieve-*`, `--hundido-*`, `--shadow-*`, `--sombra-acento`, `--sombra-menta`) valen `none` en
algún tema, y no pueden ir en lista. Lo verifica una prueba.

**3. El foco es `outline`, no `box-shadow`.** Así no pelea con el relieve ni con el hundido, no se
compone con ningún token que valga `none`, y sobrevive a `forced-colors`.

**4. Toda superficie con relieve DEL COLOR DE LA PÁGINA tiene borde de 1px, aunque casi no se vea.**
La caja mide igual en los tres temas (cambiar de tema no mueve nada: la cuenta de ancho de
`.contexto-pastilla`, L1558-1590, sigue valiendo), y en `forced-colors` el borde es el único límite
que queda. Donde hoy no hay borde (`.menu-boton`, `.admin-salir`, `.metric-carta`), se agrega y se
**descuenta 1px del padding** para que la caja no crezca (el `box-sizing: border-box` es global).
**Exentos:** los botones rellenos (`.btn-primary`, `.btn-acento`) y los ítems activos de acento.
Su relleno ya los separa de la página, y agregarles borde cambiaría 2px su alto: movería la fila del
escáner, donde el campo y "Acreditar" se estiran a la misma altura.

**5. `--shadow-1..3` son para lo que FLOTA; `--relieve-*` para lo que se levanta DE la página.**
Flotan: `.cardface`, `.wallet-btn`, la vista previa del pase en `FormularioBranding.tsx`. Se
levantan o se hunden: paneles, filas, botones, campos.

## Tokens

### Nuevos

Declarados en los tres bloques de tema (la prueba de simetría lo exige), salvo `--radius-control`,
que es constante.

| Token | Uso | Claro (`:root`, nuevo default) | Oscuro | Alto contraste |
|---|---|---|---|---|
| `--luz` | brillo arriba-izquierda; componible | `rgba(255, 255, 255, 0.9)` | `rgba(255, 255, 255, 0.07)` | `transparent` |
| `--sombra-relieve` | sombra abajo-derecha; componible | `rgba(24, 24, 73, 0.2)` | `rgba(4, 5, 18, 0.6)` | `transparent` |
| `--relieve-1` | filas, botones, chips | `4px 4px 10px var(--sombra-relieve), -4px -4px 10px var(--luz)` | `4px 4px 10px var(--sombra-relieve), -3px -3px 8px var(--luz)` | `none` |
| `--relieve-2` | paneles, métricas, marco del escáner | `6px 6px 14px var(--sombra-relieve), -6px -6px 14px var(--luz)` | `6px 6px 16px var(--sombra-relieve), -5px -5px 12px var(--luz)` | `none` |
| `--relieve-3` | lo anclado abajo (barra, hoja): la sombra sube | `0 -1px 0 var(--luz), 0 -8px 24px -12px var(--sombra-relieve)` | `0 -1px 0 var(--luz), 0 -10px 28px -12px var(--sombra-relieve)` | `none` |
| `--hundido-1` | campos, chips inactivos, pistas, fila activa | `inset 3px 3px 6px var(--sombra-relieve), inset -3px -3px 6px var(--luz)` | `inset 3px 3px 7px var(--sombra-relieve), inset -2px -2px 5px var(--luz)` | `none` |
| `--hundido-2` | `:active` (presionado) | `inset 5px 5px 10px var(--sombra-relieve), inset -5px -5px 10px var(--luz)` | `inset 5px 5px 12px var(--sombra-relieve), inset -4px -4px 8px var(--luz)` | `none` |
| `--borde-relieve` | el borde de 1px de toda superficie con relieve | `rgba(24, 24, 73, 0.06)` | `rgba(245, 245, 240, 0.05)` | `rgba(255, 255, 255, 0.55)` |
| `--radius-control` | **constante**: campos, `.btn-acento`, cuentas del portal, alertas | `16px` | — | — |

`--radius-control` es un token nuevo y no un cambio de `--radius-field` porque la portada usa
`--radius-field` y está fuera de alcance. Se agrega a `CONSTANTES` en `lib/tema.test.ts`.

### Valores por tema

`=` significa "sin cambio respecto de hoy".

| Token | Claro (`:root`) | Oscuro (`:root[data-tema="oscuro"]`, nuevo) | Alto contraste |
|---|---|---|---|
| `color-scheme` | `light`, solo en `html` (`:root` es el mismo elemento: declararlo en los dos deja uno muerto) | `dark` | = |
| `--fondo` | `#e7e6f0` | `#1c1e3a` | = |
| `--superficie-0` (el pozo) | `#dcdbe8` | `#15172e` | = |
| `--superficie-1` / `-2` | `var(--fondo)` / `var(--fondo)` | `var(--fondo)` / `var(--fondo)` | = |
| `--superficie-3` / `-4` | `#d8d7e5` / `#cbcadb` | `#262947` / `#303455` | = |
| `--texto` | `#181849` (Deep) | `var(--blanco)` | = |
| `--texto-2` | `rgba(24, 24, 73, 0.75)` | `rgba(245, 245, 240, 0.74)` | = |
| `--texto-3` | `rgba(24, 24, 73, 0.66)` | `rgba(245, 245, 240, 0.56)` | = |
| `--linea` / `--linea-fuerte` | `rgba(24, 24, 73, 0.12)` / `rgba(24, 24, 73, 0.24)` | `rgba(245, 245, 240, 0.1)` / `rgba(245, 245, 240, 0.18)` | = |
| `--acento` / `--acento-fuerte` | `#514ba8` / `#3d3880` | `#8f86e0` / **`#a49df0`** | = |
| `--sobre-acento` | `#f5f4fc` | `#181849` | = |
| `--menta` / `--sobre-menta` | **`#0b6645`** / `#eefff7` | `#8bd6b4` / `#00351f` | = |
| `--error` | `#a4231c` | `#ffb4ab` | = |
| `--error-fondo` / `--error-borde` | `rgba(164, 35, 28, 0.08)` / `rgba(164, 35, 28, 0.32)` | `rgba(147, 0, 10, 0.22)` / `rgba(255, 180, 171, 0.35)` | = |
| `--shadow-1` | `0 6px 18px -10px rgba(24, 24, 73, 0.28)` | `0 6px 18px -10px rgba(4, 5, 18, 0.6)` | = (`none`) |
| `--shadow-2` | `0 18px 44px -20px rgba(24, 24, 73, 0.32)` | `0 18px 44px -20px rgba(4, 5, 18, 0.65)` | = (`none`) |
| `--shadow-3` | `0 26px 60px -18px rgba(24, 24, 73, 0.36)` | `0 26px 60px -18px rgba(4, 5, 18, 0.75)` | = (`none`) |
| `--ring` | `0 0 0 4px rgba(81, 75, 168, 0.22)` | `0 0 0 4px rgba(143, 134, 224, 0.3)` | = |
| `--sombra-acento` | `0 8px 20px -8px rgba(61, 56, 128, 0.45)` | `0 0 24px rgba(143, 134, 224, 0.3)` | = (`none`) |
| `--sombra-menta` | `0 10px 22px -10px rgba(11, 102, 69, 0.45)` | `0 10px 22px -10px rgba(139, 214, 180, 0.6)` | = (`none`) |
| `--velo` | `rgba(24, 24, 73, 0.45)` | `rgba(6, 7, 20, 0.6)` | = |
| `--hover-suave` / `--neutro-suave` | `rgba(24, 24, 73, 0.05)` / `rgba(24, 24, 73, 0.07)` | `rgba(245, 245, 240, 0.05)` / `rgba(245, 245, 240, 0.08)` | = |
| `--acento-suave` / `--acento-borde` | `rgba(81, 75, 168, 0.12)` / `rgba(81, 75, 168, 0.4)` | `rgba(143, 134, 224, 0.12)` / `rgba(143, 134, 224, 0.4)` | = |
| `--menta-suave` / `--error-suave` | `rgba(11, 102, 69, 0.12)` / `rgba(164, 35, 28, 0.1)` | `rgba(139, 214, 180, 0.13)` / `rgba(255, 180, 171, 0.12)` | = / **`rgba(255, 138, 122, 0.16)`** (hallazgo 8) |
| `--btn-primario-fondo` / `-texto` | `#181849` / `#f5f4fc` | `var(--blanco)` / `var(--superficie-0)` | = |

`--ring` se conserva (lo usan reglas que no son foco), pero el foco deja de usarlo.

**Por qué estos valores.**

- **Fondo claro `#e7e6f0`**, gris-lavanda tintado hacia el matiz del Soft. Necesita esa luminancia
  media (≈0.80) para que el brillo blanco tenga margen: `--luz` da 1.21:1 contra él, y la sombra
  1.50:1. Sobre el `#f4f1ec` actual (≈0.88) la luz daría ≈1.13 y el relieve casi no se vería. Se
  descartó el Gray del kit (`#E9E8E3`): es cálido (≈50°) y con sombras en Deep se ensucia.
- **Texto claro = Deep**, el mismo `--sobre-claro` de la portada: 13.41:1.
- **Fondo oscuro `#1c1e3a`**, azul marino sacado de Deep. Es el techo: el acento `#8f86e0` se usa
  como texto (kickers, títulos de sección, links) y necesita 4.5:1. Con `#1c1e3a` da 5.13:1; un azul
  más suave como `#25284d` ya cae a 4.47:1.
- `--texto-3` claro sube de 0.62 a **0.66** (con 0.62 da 4.42:1 sobre el fondo nuevo) y
  `--texto-3` oscuro sube de 0.48 a **0.56** (con 0.48 da 4.44:1: el fondo nuevo es más claro que
  `#131313`).
- `--menta` claro baja de `#0d6e4a` a **`#0b6645`**: sobre el fondo pasa igual, pero dentro de
  `.pastilla-activo`, sobre su propio tinte lavanda, el valor de hoy da 4.27:1.

**Razones verificadas** (fórmula WCAG 2.x, alpha compuesto sobre su fondo sin redondeo intermedio):

| Par | Claro | Oscuro | Mínimo |
|---|---|---|---|
| `--texto` / `--fondo` | 13.41 | 14.81 | 7 |
| `--texto-2` / `--fondo` · sobre `--superficie-3` | 6.60 · 6.08 | 8.65 · 7.75 | 4.5 |
| `--texto-2` / pozo (`--superficie-0`, chip inactivo) | 6.22 | 9.20 | 4.5 |
| `--texto-3` / `--fondo` · sobre el pozo (placeholder) | 4.99 · **4.76** | 5.54 · 5.77 | 4.5 |
| `--acento` / `--fondo` | 5.81 | 5.13 | 4.5 |
| `--sobre-acento` / `--acento` · `--acento-fuerte` | 6.58 · 9.26 | 5.26 · 6.84 | 4.5 |
| `--sobre-menta` / `--menta` | 6.76 | 8.09 | 4.5 |
| `--menta` · `--error` / `--fondo` | 5.66 · 5.99 | 9.55 · 9.54 | 4.5 |
| `--menta` / `--menta-suave` · `--error` / `--error-suave` | **4.76** · 5.10 | 7.17 · 7.37 | 4.5 |
| `--texto` / `--error-fondo` | 11.81 | 14.49 | 7 |
| `--acento` / `--acento-suave` (glifo de ícono) | 4.91 | 4.31 | 3 |
| botón primario | 15.19 | 16.08 | 7 |
| piso de relieve: `--luz` · `--sombra-relieve` / `--fondo` | 1.21 · 1.50 | 1.22 · 1.17 | 1.12 |

Los dos 4.76 de claro son el margen más chico: **si el tablero aclara el fondo, se recalculan antes
de aprobar**.

### Se eliminan

`--vidrio-top`, `--vidrio-nav`, `--vidrio-panel` y `--atmosfera`, de los **tres** bloques a la vez
(la prueba de simetría revisa en las dos direcciones, así que borrarlos juntos la deja verde). No se
usan en TSX. No se reutilizan: un "vidrio" opaco mentiría con su nombre. `--atmosfera` sobra porque
cualquier degradado debajo de una superficie en relieve rompe el truco de que la superficie tenga el
color de la página; con él se va el `background-attachment: fixed` del `body` (L289-290), que además
cuesta repintado al hacer scroll en móvil. Reemplazos: `.panel` → `var(--superficie-1)`;
`.admin-top` y `.nav-inferior` → `var(--fondo)`.

Conteo de `:root`: 50 − 4 + 9 = 55. El piso de la prueba (`> 40`) se cumple.

### Estructura del archivo

- `:root` pasa a tener los valores del **claro**.
- Nace `:root[data-tema="oscuro"] {` con `color-scheme: dark` y los valores del oscuro.
- El bloque `:root[data-tema="claro"]` desaparece (su contenido pasó a `:root`).
- Alto contraste queda donde está y suma los tokens nuevos.
- `html { color-scheme: light }`.
- `lib/tema.ts`: `TEMA_POR_DEFECTO = 'claro'`; `ETIQUETAS_TEMA` se revisa ("Fondo blanco" y "El de
  siempre" dejan de ser ciertas).

**Reglas de redacción** que exige el parser de `lib/tema.test.ts:74-81` mientras siga siendo el de
hoy (el parser nuevo de la sección de pruebas las vuelve innecesarias, pero hay que respetarlas
hasta que exista):

1. tokens con **exactamente dos espacios** de indentación;
2. **ningún `}`** dentro de comentarios de un bloque de tema (el parser corta en el primero);
3. **ningún literal `:root {`** en comentarios antes del bloque (el parser toma la primera aparición).

### Hex y rgba, no oklch

`DESIGN.md:75` pide `oklch()` para colores nuevos. Esta spec se aparta a propósito: la prueba de
contraste tendría que imitar el mapeo al gamut sRGB que hace el navegador, y un recorte ingenuo
podría certificar un contraste que la pantalla no muestra. El kit de marca ya viene en hex. Se
corrige esa regla en `DESIGN.md`.

## Migración por familia de clases

**E** elevada · **H** hundida · **P** plana · **NT** no se toca. Números de línea de `3db8bf0`.

| Familia | Queda | Cambios |
|---|---|---|
| `.panel` (399-408) | E | `background: var(--superficie-1)`; borrar los dos `backdrop-filter`; `border: 1px solid var(--borde-relieve)`; `box-shadow: var(--relieve-2)`. El override inline de `RegistroCliente.tsx:180` sigue valiendo. |
| `.field` (410-454) | H | Ver el detalle abajo. |
| `.btn-primary` (458-485) | E, relleno sólido | `box-shadow: var(--relieve-1)`. `:active` → `box-shadow: none` + `scale(.98)`. `:disabled` → `box-shadow: none` (deshabilitado no puede verse levantado). |
| `.btn-acento` (488-515) | E, violeta | Radio `var(--radius-control)`; `box-shadow: var(--relieve-1)`; hover `box-shadow: var(--sombra-acento)` (solo); `:active` → `none`. |
| `.btn-borde` (518-540) | E, neutro | `background: var(--superficie-1)`; `border-color: var(--borde-relieve)` (el nombre de la clase queda como herencia: las clases no se renombran, DESIGN.md:139); hover `var(--relieve-2)`; `:active` `var(--hundido-2)` + `scale(.97)`. |
| `.admin-lista` (908-912) | — | `gap: 14px` (hoy 10). La extensión de `--relieve-1` es 4 + 10 = 14px: con 10px la sombra de una fila pisa el brillo de la siguiente. Igual: `.panel-atajos` → 14, `.portal-cuentas`/`.portal-recompensas` 8 → 12, `.metric-pila` 16 → 20 (en L1010 **y** en el `@media` de L1067), `.filtro-chips` 8 → 12. |
| `.admin-fila` (913-928) | E | `border: 1px solid var(--borde-relieve)`; `box-shadow: var(--relieve-1)`. El hover aplica **solo a `:is(a, button).admin-fila`**: hay 14 filas `<div>` estáticas que hoy "se levantan" sin ser tocables. Hover: `translateY(-2px)` + `var(--relieve-2)` con `cubic-bezier(0.22, 1, 0.36, 1)`; `:active` `var(--hundido-2)`. Se deja de cambiar el `background` en hover. |
| `.icono-circulo` (315-325) | P | Sin cambio: el tinte identifica, no es un control (`aria-hidden`). Levantarlo lo haría parecer tocable. |
| `.pastilla` (943-959) | P | Solo hereda los valores nuevos. |
| `.metric-carta` (1013-1071) | E, **neutra** | `background: var(--superficie-1)`; `color: var(--texto)`; `border: 1px solid var(--borde-relieve)` con padding 22 → 21px; `box-shadow: var(--relieve-2)`. Se quitan también las rotaciones del `@media` de L1069-1070. `.naranja`/`.menta` solo colorean `.metric-valor` y `.metric-etiqueta` (`var(--acento)` / `var(--menta)`). Se quitan la rotación y el hover: no es interactiva. `.metric-etiqueta`/`.metric-sub` cambian `opacity` por `color: var(--texto-2)` / `var(--texto-3)`, así entran en la prueba. Hoy son bloques violeta saturados, lo que contradice "un acento, solo en lo interactivo activo". **Punto de aprobación del tablero.** |
| `.nav-inferior` / `.nav-destacado` (1372-1456) | barra E hacia arriba, ítems P | Barra: `background: var(--fondo)`; borrar `backdrop-filter`; `border-top: 1px solid var(--borde-relieve)`; `box-shadow: var(--relieve-3)`. Ítem activo: píldora de acento sólido (como hoy). Destacado: como hoy. Barra a lo ancho, no isla flotante: no toca el `padding-bottom: 96px` de `.admin-shell`. |
| `.filtro-chip` (1824-1838) | inactivo H, activo E acento | Inactivo: `background: var(--superficie-0)`, `box-shadow: var(--hundido-1)`, borde `--borde-relieve`. Activo: relleno de acento + `var(--relieve-1)`. El estado lo da el relleno, no el relieve. |
| `.menu-boton` (1464-1484) | E | `background: var(--superficie-1)`; `border: 1px solid var(--borde-relieve)` con padding 10 → 9px (se mantiene 44×44); `var(--relieve-1)`; `:active` `var(--hundido-2)`. |
| `.menu-destacado` (1488-1515) | E | `var(--relieve-1)`; `-activo` mantiene `border-color: var(--acento)`. |
| `.sheet-panel` (1606-1623) | E hacia arriba | `border-top: 1px solid var(--borde-relieve)`; `box-shadow: var(--relieve-3)`. El padding de 18px aloja la sombra de las filas pese al `overflow-y: auto`. |
| `.sheet-fila` (1624-1650) | P; la activa H | La activa: `background: var(--superficie-0)`, `box-shadow: var(--hundido-1)`, `outline: 2px solid var(--acento)`, `outline-offset: -2px`. Se agrega `.sheet-fila-activa:focus-visible { outline-width: 3px; outline-offset: 2px }`: la regla global de foco empata en especificidad y sin esto el foco sería indistinguible en la fila activa. |
| `.contexto-pastilla` (1538-1596) | E | `background: var(--superficie-1)`; `border-color: var(--borde-relieve)`; `var(--relieve-1)`. Padding y borde intactos: la cuenta de L1558-1590 sigue valiendo. |
| `.portal-cuenta` (1692-1713) | E; la activa H | `var(--relieve-1)`, `:active` `var(--hundido-2)`. Activa: `border-color: var(--acento)` + `outline: 1px solid var(--acento)` + `box-shadow: var(--hundido-1)`, en lugar de `var(--ring)`. Se agrega `.portal-cuenta-activa:focus-visible { outline-width: 3px; outline-offset: 2px }`, por la misma razón que en `.sheet-fila-activa`. |
| `.portal-recompensa` (1728-1737) | E | `var(--relieve-1)`, sin hover (es estática). Radio `--radius-control`. `.portal-instalar`/`.portal-link` quedan P. |
| `.escaner-marco` (1787-1793) | E | `var(--relieve-2)`. **No puede ser H:** una sombra `inset` se pinta debajo del contenido y el `<video>` la taparía entera. Si se la quiere hundida, hace falta un `::after` superpuesto. `.escaner-video` como hoy. |
| `.alerta` / `.nota` (542-568) | P | Solo radio `--radius-control`. Un mensaje no es una superficie. |
| `.subida-imagen` (1090-1121) | H | `background: var(--superficie-0)`; `var(--hundido-1)`; radio `--radius-control`. **Se borra el literal naranja de L1111** y se reescribe su comentario (L1105-1110). El comentario dice que "se queda" porque no se veía y porque borrarlo era tocar el oscuro sin poder mirarlo; la razón nueva es otra: esa declaración de `box-shadow` en `:hover`/`:focus-within` **reemplaza** al hundido, y el pozo se aplanaría al pasar el mouse. En su lugar el hover conserva `box-shadow: var(--hundido-1)`. |
| `.admin-top` / `.admin-salir` (839-891) | header P opaco; botón E | `background: var(--fondo)`; borrar `backdrop-filter` y reescribir el comentario de L849-851. `.admin-salir`: fondo `--superficie-1`, `border: 1px solid var(--borde-relieve)` con padding 8px 16px → 7px 15px, `var(--relieve-1)`, `:active` `var(--hundido-2)`. |
| `body` (280-291) | — | Borrar `background-image` y `background-attachment`. |

### `.field` en detalle

- Selector: `.field :is(input, select, textarea):not([type="checkbox"], [type="radio"],
  [type="range"], [type="file"], [type="color"])`. Sin los `:not()`, el hundido cae sobre los
  radios, checkboxes y selectores de color nativos que viven dentro de `.field` (4 radios, 6
  checkboxes, 6 selectores de color en la app).
- `background: var(--superficie-0)`; `border: 1px solid var(--borde-relieve)`;
  `box-shadow: var(--hundido-1)`; radio `var(--radius-control)`.
- Foco: **se borra el `outline: none` de L440** (le ganaría en especificidad a la regla global).
  Queda `border-color: var(--acento)`, sin tocar `box-shadow` ni `background`: el pozo sigue
  hundido y el foco lo dibuja el `outline` global.
- Para el textarea: `.field textarea { resize: vertical; line-height: 1.55; }` (el `line-height`
  viene del parche inline de `FormularioReverso`, que se borra).
- Placeholder: `.field :is(input, textarea)::placeholder { color: var(--texto-3); }`.
- Los resets de `.field input[type="file"]` (L1142) y `.encuadre-franja input[type='range']`
  (L1347) **no** necesitan `box-shadow: none`: los `:not()` ya excluyen esos inputs de la regla del
  hundido.
- `::file-selector-button` pasa a E: fondo `--superficie-1` + `var(--relieve-1)`.

### Base nueva

```css
:where(a, button, input, select, textarea, summary, [tabindex]):focus-visible {
  outline: 2px solid var(--acento);
  outline-offset: 2px;
}
body { accent-color: var(--acento); }
```

Con especificidad 0 dentro del `:where`, `.cartel-manija:focus-visible` (la única regla de foco que
existe hoy) sigue ganando.

### Clases nuevas

- `.campo-suelto`: el hundido de `.field` para un input fuera de `.field`.
- `.pozo`: contenedor hundido de solo lectura (`--superficie-0` + `--hundido-1`).
- `.pista` / `.pista-relleno`: la barra de progreso o de gráfico; la pista hundida, el relleno de
  acento.
- `.opcion-plan` / `.opcion-plan-activa`: la opción de plan elegida en el alta de comercio.

### No se tocan

`.cardface*`, `.sello*`, `.qr-tile`, `.wallet-btn`, `.escaner-guia`, `.subida-preview` y
`.cartel-manija*` (se dibujan sobre el cartel del comercio). Heredan solos los valores nuevos de
`--shadow-*` / `--linea-fuerte` donde ya los usan, y así debe ser. `.sello.lleno` pinta
`--acento-fuerte` y por eso cambia de tono en oscuro con el arreglo del hallazgo 1: **el tablero
tiene que mostrarlo** para confirmar que la maqueta del pase no queda mintiendo.

## Cambios fuera de la hoja de estilos

Ninguna familia necesita envoltorios ni pseudo-elementos: el relieve es `box-shadow` sobre el mismo
nodo. Lo que sí se toca:

1. `app/comercio/(protegido)/branding/FormularioReverso.tsx` — borrar `estiloTextarea` y
   `textareaEnfocado` con su comentario (L139-157), los `onFocus`/`onBlur` (L265-266) y el
   `style={estiloTextarea}` (L275); quitar `type CSSProperties` del import de L3 (queda sin uso y el
   lint lo marca) y `useState` si también queda sin uso. El textarea ya está dentro de `.field`.
   Obligatorio: el estilo inline pisaría el hundido.
2. `app/comercio/(protegido)/reportes/page.tsx:320-321` — la barra del gráfico (hoy inline con
   `--superficie-3`/`--acento`) pasa a `.pista` / `.pista-relleno`.
3. `app/comercio/(protegido)/escanear/Escaner.tsx:411-424` ("Puntos a sumar", el camino del cajero)
   y `app/admin/(protegido)/comercios/FormularioAccesoDueno.tsx:132-141` → `.campo-suelto`.
4. `app/comercio/(protegido)/programas/FormularioConfiguracionPrograma.tsx:219-226` → `.pozo`.
5. `app/registro-comercio/FormularioRegistro.tsx:145-156` → `.opcion-plan` / `.opcion-plan-activa`.
   Hoy el plan elegido se marca con `--superficie-1` contra `transparent`; con
   `--superficie-1 == --fondo` esa diferencia desaparece.
6. Solo comentarios que dejan de ser ciertos (hablan del `backdrop-filter` de `.admin-top`):
   `app/_ui/SelectorTema.tsx:53-59`, `MenuOpciones.tsx:70-76`, `SelectorContexto.tsx:90-96`.
   **El portal se mantiene**; el comentario pasa a "si vuelve un `backdrop-filter`/`transform`/
   `filter` al header, el `position: fixed` de adentro dejaría de ser relativo a la ventana".
   En `sucursales/ModalAgregarLocal.tsx:129-135` la razón principal del portal (el `transform` de
   `.reveal`) sigue siendo cierta: solo cambia la última cláusula (L135).
7. `lib/tema.ts`: `TEMA_POR_DEFECTO = 'claro'` y `ETIQUETAS_TEMA` → claro `'El predeterminado'`,
   oscuro `'Para usar de noche'` (hoy "Fondo blanco" y "El de siempre", que dejan de ser ciertas);
   alto contraste sin cambio. El ORDEN de `TEMAS` no cambia: `lib/tema.test.ts` y el script del
   `<head>` lo fijan como literal a propósito. `app/manifest.ts:10-11` → `#e7e6f0`;
   `app/mi-tarjeta/layout.tsx` → `statusBarStyle: 'default'`.

## Prueba de contraste

Hoy no existe. Es la red que le falta a un rediseño cuyo riesgo principal es, justamente, comerse el
contraste.

### Módulos

**`lib/diseno/contraste.ts`** — puro, sin I/O:

- `parsearColor(valor): Rgba`. Acepta `#rgb`, `#rrggbb`, `rgb(r, g, b)`, `rgba(r, g, b, a)` con
  comas, y `transparent`. **Cualquier otro formato lanza** `formato de color no soportado: <valor>`
  (incluye `oklch()`, `hsl()`, `color-mix()`, `currentColor`, nombres). Nada se omite en silencio.
- `componer(capas: Rgba[]): Rgba`. Capas de arriba hacia abajo; se compone de abajo hacia arriba en
  sRGB 0-255, **sin redondeo intermedio**. Si la capa de abajo no es opaca, lanza
  `la pila de fondo no termina en un color opaco`.
- `luminancia(rgba)`: WCAG 2.x (umbral 0.04045, exponente 2.4, coeficientes .2126/.7152/.0722).
  Lanza si alpha < 1.
- `razon(a, b) = (Lmax + 0.05) / (Lmin + 0.05)`, simétrica.

**`lib/diseno/tokensCss.ts`** — el único parser de tokens del repo; `lib/tema.test.ts` pasa a
usarlo, **sin cambiar ninguna de sus aserciones**:

- `bloque(css, selector): Map<nombre, valor>`. Quita los comentarios primero. Exige dos espacios de
  indentación y **lanza** `indentación distinta de dos espacios en --x` si encuentra otra: hoy ese
  token sería invisible para la prueba sin que nadie se entere (DESIGN.md:72-73).
- `mapaDeTema(css, tema)`: si el tema es `TEMA_POR_DEFECTO`, usa `:root`; si no, fusiona `:root`
  con su bloque, igual que la cascada en `<html>`. Así la prueba sirve antes (default oscuro) y
  después (default claro) sin tocarla.
- `resolver(nombre, mapa)`: sigue cadenas de `var(--x)` (p. ej. `--texto → var(--blanco)`), detecta
  ciclos (`referencia circular: --a → --b → --a`), y lanza ante `var(--x, fallback)` y ante tokens
  que no existen.
- `regla(css, selector): Map<prop, valor>`: la regla cuya lista de selectores contiene exactamente
  ese selector.

Pruebas unitarias de la matemática con valores de referencia: `#000`/`#fff` = 21; `#777`/`#fff` =
4.48; `#767676`/`#fff` = 4.54; `rgba(0,0,0,.5)` sobre `#fff` = gris 127.5 (sin redondear: **no**
`#808080`), que contra blanco da 3.98; `razon(a, b) === razon(b, a)`; lanza ante oklch y ante ciclos.
Los grises solos no alcanzan: con r = g = b, permutar los coeficientes .2126/.7152/.0722 no cambia
nada y la prueba seguiría verde. Por eso van también `#0000ff`/`#fff` = 8.59, `#ff0000`/`#fff` =
4.00 y `#00ff00`/`#000` = 15.30.

### `lib/diseno/temas.test.ts` — pares de tokens

Lee `app/globals.css` y recorre los tres temas.

| Frente | Sobre | Mínimo | Por qué |
|---|---|---|---|
| `--texto` | `--fondo` | 7 | AAA. El cajero bajo el sol; hoy ya pasa de 13:1, así que es una protección barata. |
| `--texto-2` | `--fondo` y `--superficie-3` | 4.5 | Rótulos y subtítulos de fila; la fila activa usa `-3`. |
| `--texto-3` | `--fondo` | 4.5 | Etiquetas de la barra a 0.62rem, código bajo el QR a 0.72rem: texto chico, sin alivio de 3:1. |
| `--acento` | `--fondo` | 4.5 | Se usa como texto (kicker, títulos de sección, links). De paso cubre el 3:1 del contorno de foco. |
| `--sobre-acento` | `--acento` **y** `--acento-fuerte` | 4.5 | Barra y chip activos, `.btn-acento`, círculo de "Escanear". Hoy el segundo falla (hallazgo 1). |
| `--sobre-menta` | `--menta` | 4.5 | `.check`. |
| `--btn-primario-texto` | `--btn-primario-fondo` | 7 | El botón más tocado de la app. |
| `--menta`, `--error` | `--fondo` | 4.5 | Mensajes de éxito, avisos de campo. |
| `--menta` / `--error` | `--menta-suave` / `--error-suave` sobre `--fondo` | 4.5 | Pastillas. |
| `--texto` | `--error-fondo` sobre `--fondo` | 7 | `.alerta`. |
| `--acento` | `--acento-suave` sobre `--fondo` | 3 | Glifo de ícono: no es texto (WCAG 1.4.11). |

**Solo en alto contraste:** todo par de texto sube a `max(mínimo, 7)` — ese tema existe para el sol
— y `--linea` contra `--fondo` ≥ 3, porque es la única separación que queda. Desde la Fase 3 se
suma `--borde-relieve` ≥ 3 (antes no existe, y `resolver` lanza ante un token que no existe).

**Fondos translúcidos:** si la última capa de una pila no es opaca, se apoya sobre `--fondo` (lo que
queda debajo de todo es la página), y la etiqueta lo dice: `--vidrio-nav∘--fondo`.

### Pares por regla

Miden lo que ve el usuario y no un token intermediario (la lección del QR descentrado en CLAUDE.md:
la prueba que medía la tarjeta seguía verde con el QR corrido). El color y el fondo se leen **de la
regla CSS**, y cada uno tiene que ser un único `var(--x)` o `transparent` (que equivale al fondo de
la página). Si no, lanza `la regla X pinta <prop> con <valor>, no con un token`.

| Regla | Mínimo |
|---|---|
| `.field input` (Fases 2-3) → el selector nuevo de `.field` (Fase 4+): texto sobre su fondo | 7 |
| `.field input::placeholder` (Fases 2-3) → `.field :is(input, textarea)::placeholder` (Fase 4+), sobre el fondo del campo | 4.5 |
| `.btn-primary` | 7 |
| `.btn-acento` | 4.5 |
| `.nav-inferior a` sobre `.nav-inferior` | 4.5 |
| `.nav-inferior a.activo:not(.nav-destacado)` | 4.5 |
| `.nav-destacado .icono` | 3 |
| `.filtro-chip` y `.filtro-chip.activo` | 4.5 |
| `.pastilla-activo`, `.pastilla-inactivo` | 4.5 |
| `.alerta` | 7 |
| `.metric-carta.naranja` y `.metric-carta.menta` (Fases 2 a 5: hoy son bloques de color) | 4.5 |
| desde la Fase 6: `.metric-valor` de cada variante sobre `.metric-carta` | 3 (texto grande, 2.9rem) |
| desde la Fase 6: `.metric-etiqueta` sobre `.metric-carta` | 4.5 |

El valor de medir por regla se ve con el placeholder: un par fijo `--texto-3`/`--superficie-0`
fallaría hoy (4.46:1 en el claro actual) por una combinación que hoy no existe en pantalla, porque
el campo de hoy está sobre `--superficie-1`. El par por regla sigue a la migración solo.

**Los selectores de los pares por regla se actualizan en el mismo commit que migra cada familia.**

Formato del mensaje, con el valor sin redondear comparado e impreso con dos decimales:

```
[tema claro] --texto-3 sobre --fondo: 3.08:1 < 4.5 (notas, código bajo el QR, etiquetas de la barra)
```

### Aserciones estructurales

1. **Composición de sombras.** Se reúnen los tokens que valen `none` en algún tema. Toda declaración
   `box-shadow:` fuera de los bloques de tema que referencie uno de ellos tiene que ser exactamente
   `var(--x)`, sola. Hoy el CSS ya pasa.
2. **Alto contraste es plano.** Ahí `--relieve-1/2/3` y `--hundido-1/2` valen `none`, y `--luz` y
   `--sombra-relieve` valen `transparent`. En claro y oscuro, ninguno vale `none`.
3. **Piso de relieve** en claro y oscuro: `--luz` y `--sombra-relieve`, compuestas sobre `--fondo`,
   dan ≥ 1.12:1 contra `--fondo`. Si no, el neumorfismo no se ve.
4. **En `lib/tema.test.ts`:** el `color-scheme` de `html` coincide con el del tema por defecto, y el
   de cada bloque con el de su tema. La fuente de verdad es un mapa escrito en la prueba
   (`claro → light`, `oscuro → dark`, `alto-contraste → dark`), no el CSS: comparar el CSS contra sí
   mismo sería una tautología que sigue verde con `html` en `dark` y el default en claro.

### Mutation-testing

Obligatorio. Cada fila: qué romper, y el mensaje con que tiene que fallar. Los números son la
**predicción** calculada con la convención de arriba; la corrida real fija el mensaje exacto, y si
no coincide se investiga antes de seguir. Las filas de la Fase 2 corren contra el CSS de hoy; las
de la Fase 3 en adelante se identifican por bloque y token, porque los números de línea se mueven.

| Aserción | Qué romper (CSS de `3db8bf0`) | Falla con |
|---|---|---|
| `--texto` ≥ 7 | claro `--texto` (L143) `#1c1917` → `#6b6b6b` | `[tema claro] --texto sobre --fondo: 4.73:1 < 7` — prueba que el umbral es 7 y no 4.5 |
| `--texto-2` ≥ 4.5 | oscuro `--texto-2` (L39) `0.72` → `0.40` | `[tema oscuro] --texto-2 sobre --fondo: 3.60:1 < 4.5` |
| `--texto-3` ≥ 4.5 | claro `--texto-3` (L148) `0.62` → `0.48` | `[tema claro] --texto-3 sobre --fondo: 3.08:1 < 4.5` |
| `--acento` ≥ 4.5 | claro `--acento` (L153) `#514ba8` → `#8f86e0` | `[tema claro] --acento sobre --fondo: 2.80:1 < 4.5` |
| `--sobre-acento`/`--acento` | alto contraste `--sobre-acento` (L224) `#000000` → `#ffffff` | `[tema alto-contraste] --sobre-acento sobre --acento: 1.34:1 < 7` |
| `--sobre-acento`/`--acento-fuerte` | **Hoy ya falla.** Tras el arreglo (L48 → `#a49df0`), revertirlo | `[tema oscuro] --sobre-acento sobre --acento-fuerte: 2.31:1 < 4.5` |
| pastilla inactiva en alto contraste | **Hoy ya falla.** Tras el arreglo (L253 → `0.16`), revertirlo a `0.22` | `[tema alto-contraste] --error sobre --error-suave∘--fondo: 6.67:1 < 7` |
| `--sobre-menta` | claro `--sobre-menta` (L158) `#eefff7` → `#8bd6b4` | `[tema claro] --sobre-menta sobre --menta: 3.70:1 < 4.5` |
| botón primario ≥ 7 | claro `--btn-primario-texto` (L184) `#faf8f5` → `#6b6b6b` | `[tema claro] --btn-primario-texto sobre --btn-primario-fondo: 3.28:1 < 7` |
| `--menta` | claro `--menta` (L157) → `#8bd6b4` | `[tema claro] --menta sobre --fondo: 1.51:1 < 4.5` |
| `--error` | alto contraste `--error` (L229) → `#93000a` | `[tema alto-contraste] --error sobre --fondo: 2.24:1 < 7` |
| pastilla | claro `--menta-suave` (L180) `0.12` → `0.45` | `[tema claro] --menta sobre --menta-suave∘--fondo: 2.79:1 < 4.5` |
| `.alerta` | claro `--error-fondo` (L161) `0.08` → `0.85` | `[tema claro] --texto sobre --error-fondo∘--fondo: 3.07:1 < 7` |
| glifo de ícono | alto contraste `--acento-suave` (L250) `0.22` → `0.9` | `[tema alto-contraste] --acento sobre --acento-suave∘--fondo: 1.25:1 < 3` |
| refuerzo de alto contraste | alto contraste `--texto-3` (L217) `#d4d4d4` → `#7a7a7a` | `[tema alto-contraste] --texto-3 sobre --fondo: 4.89:1 < 7` — pasaría con 4.5: prueba que el refuerzo existe |
| bordes de alto contraste | alto contraste `--linea` (L219) `0.55` → `0.1` | `[tema alto-contraste] --linea sobre --fondo: 1.20:1 < 3` |
| par por regla | `.btn-acento` (L493) `color: var(--sobre-acento)` → `var(--texto)`, con el arreglo aplicado | `[tema oscuro] regla .btn-acento: --texto sobre --acento-fuerte: 2.22:1 < 4.5` |
| guarda contra literales | `.btn-acento` (L494) → `background: #514ba8` | lanza `la regla .btn-acento pinta background con #514ba8, no con un token` |
| placeholder | `.field input::placeholder` (L436) → `color: var(--linea-fuerte)` | `[tema claro] regla .field input::placeholder: --linea-fuerte sobre --superficie-1: 1.67:1 < 4.5` |
| composición | `.nav-destacado.activo .icono` (L1451) → `0 0 0 3px var(--acento-suave), var(--sombra-acento)` | `[composición] .nav-destacado.activo .icono compone var(--sombra-acento), que vale none en alto-contraste` |
| formato no soportado | claro `--acento` (L153) → `oklch(45% 0.13 280)` | lanza `formato de color no soportado: oklch(45% 0.13 280)` |
| ciclo | `--texto: var(--texto-2)` y `--texto-2: var(--texto)` | lanza `referencia circular: --texto → --texto-2 → --texto` |
| indentación | declarar un token con 4 espacios | lanza `indentación distinta de dos espacios en --x` |
| alto contraste plano (F3+) | alto contraste: `--hundido-1: none` → el valor de claro | `[alto-contraste] --hundido-1 debe ser none (tema plano a propósito) y vale "inset 3px…"` |
| piso de relieve (F3+) | claro `--luz` → `rgba(255, 255, 255, 0.2)` | `[tema claro] piso de relieve: --luz∘--fondo …:1 < 1.12` |
| `color-scheme` (F3+) | dejar `html` en `dark` | `html declara color-scheme dark y el default (claro) es light` |
| default (F3+) | volver `lib/tema.ts` a `'oscuro'` | `expected 'oscuro' to be 'claro'` |
| valores nuevos (F3) | copiar el `.62` al `--texto-3` claro nuevo · dejar `--menta: #0d6e4a` en claro · aclarar el `--fondo` oscuro a `#25284d` | `--texto-3 sobre --fondo: 4.42:1 < 4.5` · `--menta sobre --menta-suave∘--fondo: 4.27:1 < 4.5` · `--acento sobre --fondo: 4.47:1 < 4.5` |

Mutante equivalente que no vale la pena probar: cambiar 0.04045 por 0.03928 no altera ningún valor
de 8 bits.

### Qué no cubre

- `opacity` sobre elementos (por eso las métricas pasan a `color`).
- Texto sobre imágenes o video (`.cardface`, `.escaner-video`).
- Estados deshabilitados (WCAG los exime).
- `forced-colors`.
- Estilos inline en TSX: se revisan con grep en la Fase 6.

## Tablero de componentes

**Cambio de papel (2026-09-20).** La idea original era aprobar el tablero antes de tocar `app/`.
Daniel pidió terminar todo y revisarlo a la vuelta, así que el tablero pasa a ser **su herramienta
de revisión**. Se construye primero, con el CSS de hoy (sirve de "antes"), y al cierre de cada fase
`propuesta.css` se regenera **copiando** `app/globals.css`: son idénticos por construcción, y el diff
de la Fase 7 queda como verificación formal. La lista de aprobación de abajo pasa a ser la lista de
revisión de Daniel. Con los valores de esta spec como default: si algo no le gusta, se cambia el
token y listo, porque todo está en una rama sin publicar.

Vive en `public/tablero-neumorfico/` **del worktree** (`preview_start` sirve el worktree). Como está
en `public/`, integrado a `master` se serviría en producción: **se borra en el commit previo a
integrar**, después de la revisión de Daniel, y no en la Fase 7.

- `index.html` — tres `<iframe>` con `componentes.html?tema=claro|oscuro|alto-contraste`: cada uno
  tiene su propio `:root`, aislamiento real.
- `componentes.html` — marcado copiado de los TSX reales: la barra de `NavInferior.tsx`, la hoja de
  `MenuOpciones.tsx`, los 15 tipos de input dentro de `.field`, filas, métricas, chips, pastillas,
  alertas, una pista con relleno, y las excepciones (`.cardface` con `.sello.lleno`, `.qr-tile`,
  `.wallet-btn`) sobre el fondo nuevo.
- `propuesta.css` — **copia íntegra** del futuro `app/globals.css`.
- `tablero.css` — solo el marco del tablero y las variables de fuente.
- `medir.js` — lee `getComputedStyle` de los elementos `[data-par]` y calcula razones sobre la
  cascada real del navegador.

Se ve en el navegador integrado, y se ofrece publicarlo como Artifact privado para abrirlo en el
teléfono, que es donde de verdad se juzga el relieve.

Verificación: `medir.js` vía `javascript_tool` en cada iframe; capturas a 375 y 320px en los tres
temas; recorrido con Tab (el foco se ve en los tres); interruptores **"sol"**
(`filter: contrast(.6) brightness(1.2)`) y **"grises"**: los estados activos tienen que seguir
distinguiéndose.

**Daniel aprueba:** fondo lavanda y azul marino · intensidad del relieve · métricas neutras · chips
inactivos hundidos · `--borde-relieve` tenue · `--acento-fuerte` oscuro lavanda (y cómo queda
`.sello.lleno`) · radio de 16px · barra a lo ancho. Se itera hasta la aprobación.

## Orden de entrega

| Fase | Qué | Cómo se verifica |
|---|---|---|
| 1 · Tablero | `public/tablero-neumorfico/`, con el CSS de hoy | Ver "Tablero de componentes". Capturas del "antes" en los tres temas. |
| 2 · Contraste | `lib/diseno/{contraste,tokensCss}.ts` y sus pruebas, `lib/diseno/temas.test.ts`, `lib/tema.test.ts` sobre el parser nuevo. La primera corrida sale **roja con 5 fallas**: el 2.31:1 del oscuro (token, `.btn-acento`, `.nav-destacado .icono`) y el 6.67:1 de la pastilla inactiva en alto contraste (token y regla). Se corrigen `--acento-fuerte` del oscuro y `--error-suave` del alto contraste. | `npx vitest run lib/diseno lib/tema.test.ts`, y cada fila de mutación de la Fase 2: romper, ver fallar con el mensaje, restaurar. |
| 3 · Tokens y default | Los tres bloques, `--radius-control` a `CONSTANTES`, `html { color-scheme: light }`, `lib/tema.ts`, `lib/tema.test.ts:29` y sus comentarios (L8-12, L24, L60), manifest, barra de estado. Durante esta fase `--vidrio-*` pasan a `var(--fondo)` y `--atmosfera` a `none`; se eliminan en la 4 y la 5. | Pruebas y mutaciones de la Fase 3. En el navegador, `getComputedStyle(document.documentElement)` de cada token contra la salida del parser. Recorrido de login, registro, mi-tarjeta, admin **y `/`** en los tres temas. |
| 4 · Primitivas | `.panel`, `.field`, los tres botones, filas, pastilla, alerta, `body`, foco global, `FormularioReverso`. Se borran `--vidrio-panel`, `--atmosfera` y el `backdrop-filter` del panel. | Pares por regla actualizados en el mismo commit; prueba de composición; los 15 inputs en tres temas; branding, reglas, alta de comercio, registro-comercio. |
| 5 · Header, barra y hojas | `.admin-top`, `.admin-salir`, `.nav-*`, `.menu-*`, `.sheet-*`, `.contexto-pastilla`, `.filtro-chip`, comentarios de portales. Se borran `--vidrio-top`/`--vidrio-nav`. | Ancho de `.contexto-etiqueta` con `getBoundingClientRect` a 360 y 320px idéntico antes y después; 5 columnas para el dueño y 3 para el cajero; las cuatro hojas abren y cierran con Escape; scroll por debajo del header y la barra. |
| 6 · Pantallas y JSX inline | `.metric-*`, `.portal-*`, `.escaner-*`, `.subida-imagen`, gaps, y las clases nuevas en los 5 archivos TSX. | Panel, reportes, mi-tarjeta, branding. `grep -rn "var(--superficie" app --include=*.tsx \| grep -v _inicio` solo deja las excepciones del pase. El escáner con cámara lo prueba Daniel en un teléfono real. |
| 7 · Cierre | `git diff --no-index --ignore-cr-at-eol public/tablero-neumorfico/propuesta.css app/globals.css` **vacío**. `DESIGN.md`, `PRODUCT.md`, `ESTADO-Y-PLAN`. El tablero queda para la revisión de Daniel (ver "Tablero de componentes"). | Suite completa, `npm run lint`, `npm run typecheck`, `npx next build` (`/` sigue `○ Static`). Lo que no se pueda correr sin `.env.local` queda anotado como pendiente de Daniel, con el comando. |

**Integración.** Salvo la Fase 2, todo se integra junto al final: los estados intermedios de 3 a 6
no deben llegar a los comercios piloto. La Fase 2 **puede** publicarse sola — arregla hoy el botón
"Acreditar" del cajero — pero solo con el OK explícito de Daniel en ese momento. Antes de publicar
el rediseño, avisar a los pilotos: los cajeros que nunca tocaron el selector de tema pasan a claro de
golpe, a mitad de turno.

**Trabajo con subagentes.** Los subagentes trabajan en el worktree
`.claude/worktrees/focused-aryabhata-28e859` con rutas absolutas, y verifican
`git branch --show-current` = `claude/app-neumorphism-redesign-f8c05a` antes de tocar nada.

## Layouts con Stitch

Opcional, por pantalla, **después** de aprobar el tablero, y solo donde la ESTRUCTURA de la pantalla
no convenza. Candidatas: `/comercio/panel`, `/comercio/escanear`, `/mi-tarjeta`,
`/comercio/reportes`. El prompt lleva los valores aprobados:

> Diseñá la pantalla móvil (375px) "<nombre>" de Cardly, una app salvadoreña de tarjetas de
> lealtad en Apple/Google Wallet. Todo el texto en español. Estilo soft UI neumórfico: fondo
> `#e7e6f0`; las superficies son del MISMO color que el fondo y se distinguen solo por doble sombra
> (luz blanca arriba-izquierda, sombra `rgba(24,24,73,.2)` abajo-derecha); campos y chips inactivos
> hundidos (inset); radios de 16–20px; casi sin bordes. Texto `#181849`. Un único acento violeta
> `#514ba8`, SOLO en lo interactivo activo (CTA, ítem activo de la barra, chip seleccionado). Nada de
> degradados, vidrio ni blur. Tipografías: Outfit (títulos), Hanken Grotesk (cuerpo), Geist Mono
> (números). Barra inferior de 5 destinos con "Escanear" destacado al centro.
> Contenido real de la pantalla: <datos y acciones de esa pantalla>.
> Quiero explorar la ESTRUCTURA: jerarquía, agrupación y orden.

Lo que devuelva Stitch es una **referencia de layout**: se traduce a las clases existentes, en una
tarea aparte por pantalla (toca JSX con comportamiento). Nunca se importa su HTML ni su Tailwind.

## Riesgos

1. **El relieve es el único límite entre superficies en claro y oscuro** (1.1 a 1.5:1). En un LCD
   barato bajo el sol, paneles y campos se funden con la página. → La regla "forma, nunca estado";
   el borde de 1px siempre; el piso de relieve en la prueba; el interruptor "sol" y el teléfono real
   en la Fase 1; alto contraste a un toque en el menú para todos los roles, incluido el cajero
   (`MenuOpciones.tsx:124-127`).
2. **Colisiones de `box-shadow`**: el foco que borra el hundido; `none` dentro de una lista; el
   literal naranja que aplana el pozo; el hundido cayendo sobre radios y checkboxes nativos. → Foco
   con `outline`; la prueba de composición; borrar L1111; los `:not()` más los resets; los 15 inputs
   en el tablero.
3. **El default se filtra** a la portada, al PWA, a la barra de estado, y a los cajeros que pasan a
   claro de golpe. → Manifest y barra de estado en la Fase 3; aviso a los pilotos. La portada:
   `FormularioDemo` consume `--superficie-1/2`, `--texto`, `--linea-fuerte` y `--ring`, así que
   sigue al tema — **igual que hoy**, porque quien ya tenía el tema claro elegido ya lo veía así.
   Lo único que cambia es que el visitante sin tema elegido lo ve en claro. Se recorre `/` en cada
   fase: si queda **ilegible**, eso bloquea la integración y se arregla con el cambio mínimo en
   `inicio.module.css`; si solo se ve distinto, se anota para Daniel y no se toca.
4. **Costo de pintura** de las sombras dobles en listas largas en teléfonos baratos, y sombras que se
   pisan o se recortan (gaps de 8-10px, `overflow` de la hoja y del `body`). → Desenfoque ≤ 10px en
   `--relieve-1`; gaps de 12-20px; si el throttling ×4 de DevTools muestra repintados caros en
   `/comercio/clientes`, mover el hover de `.admin-fila` a un `::after` que anime solo `opacity`
   (cumple la regla de movimiento de la casa).
5. **Una verificación que parece hecha sin estarlo**: sin `.env.local` no corre nada, y un parser
   que resuelva `var()` distinto que el navegador certificaría contrastes falsos. → El `.env.local`
   como prerrequisito; confirmar con una mutación que la prueba de verdad corrió; contrastar el
   parser con `getComputedStyle` en las Fases 1 y 3.

## Fuera de alcance

- La portada `/` y `app/_inicio/inicio.module.css`.
- El pase de Apple/Google Wallet (`.pkpass`, objetos de Google): no es UI del panel.
- Cambios de estructura de pantallas (eso es la sección de Stitch, tarea aparte por pantalla).
- Cambiar tipografías: Outfit, Hanken Grotesk y Geist Mono se conservan (DESIGN.md:109-111).
- El e2e `owner-branding.spec.ts`, desactualizado desde antes (ESTADO-Y-PLAN).

## Documentos a actualizar al cierre

- `DESIGN.md`: identidad ("claro neumórfico por defecto"), la tabla de tokens (hoy todavía describe
  el naranja), una sección de relieve con las reglas del sistema, el contrato de la prueba nueva, las
  excepciones (incluido el literal de `.subida-imagen`, que deja de existir), y la regla de hex/rgba
  en lugar de oklch para tokens de tema. La escena física del claro pasa a ser la del default.
- `PRODUCT.md`: "claro por defecto"; revisar la anti-referencia "navy y gris" frente al azul marino
  del oscuro.
- `docs/superpowers/ESTADO-Y-PLAN-2026-07-28.md`: sección nueva con lo hecho y lo pendiente.

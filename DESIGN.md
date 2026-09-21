# DESIGN.md — Cardly SV

> **Reescrito el 2026-09-20 con el rediseño neumórfico** (spec:
> `docs/superpowers/specs/2026-09-20-rediseno-neumorfico-design.md`). La versión anterior describía
> el sistema v2 "vidrio sobre carbón", con el oscuro por defecto y un acento naranja que ya no
> existía desde el reskin del 2026-07-30. **La fuente de verdad es el código**: los bloques `:root`,
> `:root[data-tema="oscuro"]` y `:root[data-tema="alto-contraste"]` de `app/globals.css`. Este
> documento explica el porqué; si los dos se contradicen, gana el CSS y hay que corregir acá.

## Identidad
**Neumórfico, claro por defecto, un solo acento violeta.** Lo que se levanta es DEL MISMO COLOR que
la página: la forma sale del relieve (luz arriba-izquierda, sombra abajo-derecha), no de un borde ni
de otro color. Nada de vidrio esmerilado, nada de degradados de fondo. El acento marca lo que está
activo y nada más; el menta queda como secundario de datos y éxito.

## Los tres temas
`lib/tema.ts` define `TEMAS = ['oscuro', 'claro', 'alto-contraste']` (el orden no cambia: el script
del `<head>` y la prueba lo fijan como literal) y `TEMA_POR_DEFECTO = 'claro'`. Es **preferencia de
dispositivo**, no dato de negocio: vive en `localStorage` (`cardly-tema`), y un script síncrono en
el `<head>` (`SCRIPT_TEMA`, montado desde `app/layout.tsx`) lo aplica antes del primer pintado para
que no haya destello. El estado real es el atributo `data-tema` del `<html>`: el selector de React
lo lee del DOM, no de `localStorage`. El claro es `:root`; los otros dos son bloques
`:root[data-tema="…"]` que pisan los mismos tokens.

Cada tema tiene su escena física. Si una decisión de color no se puede justificar con una de estas
tres frases, la decisión está mal:

| Tema | Escena | Consecuencias |
|---|---|---|
| **claro** (default) | El dueño configura su tarjeta de día, con la vidriera abierta a la calle; el cajero cobra en el mostrador. | Gris-lavanda y no blanco: la luz del relieve necesita margen para verse (sobre el hueso `#f4f1ec` de antes, `--luz` quedaba en 1.11:1). Texto en Deep, el azul casi negro del kit. |
| **oscuro** | El dueño revisa las ventas del día a las once de la noche, en la cama, con el brillo al mínimo. | Azul marino sacado de Deep, no carbón: el neumorfismo necesita algo de luminancia para que la luz se vea. `#1c1e3a` es el techo, porque el acento se usa como texto y con un fondo más claro cae bajo 4.5:1. |
| **alto contraste** | El cajero cobra en un puesto al aire libre, mediodía, el sol pegando en la pantalla. | **Plano a propósito.** Negro puro, bordes a alpha alto, acentos saturados, y el relieve en `none`: bajo el sol la sombra no da profundidad, solo ensucia el borde. Las mismas reglas que en los otros dos dibujan relieve, acá dibujan un borde blanco. Todo texto pide 7:1. |

**El cambio de default (2026-09-20) llega a gente que nunca eligió nada.** Quien tenía el tema
guardado lo conserva; quien nunca tocó el selector (la mayoría de los cajeros) pasa del oscuro al
claro de golpe. Avisar a los comercios piloto antes de publicar.

## Estrategia de color: **Restrained** en los paneles
Neutros más **un** acento violeta, por debajo del 10% de la superficie, y un menta secundario para
datos y éxito. Vale para `/comercio`, `/admin`, `/registro` y `/mi-tarjeta`, donde el color tiene
que señalar dónde tocar y nada más. Por eso las tarjetas de métricas son **neutras** y el color va
solo en el número y la etiqueta: hasta el 2026-09-20 eran bloques de acento saturado, y eso
contradecía "un acento, solo en lo interactivo activo".

**La página pública `/` tiene permiso para otra estrategia**, más comprometida: es brand, no
herramienta. Ver "Página pública", abajo.

### Tokens (nombres estables; los valores los redefine cada tema)

| Rol | Token | Claro (`:root`) | Oscuro | Alto contraste |
|---|---|---|---|---|
| Fondo de página | `--fondo` | `#e7e6f0` | `#1c1e3a` | `#000000` |
| El pozo (campos, chips inactivos, pistas, fila activa) | `--superficie-0` | `#dcdbe8` | `#15172e` | `#000000` |
| Lo que se levanta | `--superficie-1` / `-2` | `var(--fondo)` / `var(--fondo)` | `var(--fondo)` / `var(--fondo)` | `#000000` / `#0b0b0b` |
| Escalón de hover de una fila de hoja | `--superficie-3` | `#d8d7e5` | `#262947` | `#1c1c1c` |
| Texto | `--texto` / `-2` / `-3` | Deep `#181849` al 100 / 75 / 66% | hueso al 100 / 74 / 56% | `#fff` / `#ededed` / `#d4d4d4` |
| Bordes | `--linea` / `--linea-fuerte` | Deep al 12 / 24% | hueso al 10 / 18% | blanco al 55 / 82% |
| Acento | `--acento` / `--acento-fuerte` | `#514ba8` / `#3d3880` | `#8f86e0` / `#a49df0` | `#c9ec5e` / `#a9d13a` |
| Sobre acento | `--sobre-acento` | `#f5f4fc` | `#181849` | `#000000` |
| Secundario | `--menta` / `--sobre-menta` | `#0b6645` / `#eefff7` | `#8bd6b4` / `#00351f` | `#00e58c` / `#000000` |
| Error | `--error` + `-fondo` / `-borde` | `#a4231c` | `#ffb4ab` | `#ff8a7a` |
| Tintes suaves | `--neutro-suave`, `--acento-suave`, `--acento-borde`, `--menta-suave`, `--error-suave` | alphas de Deep y del acento | alphas del hueso y del acento | alphas altos |
| **Relieve (colores)** | `--luz` / `--sombra-relieve` | blanco al 90% / Deep al 20% | blanco al 7% / casi negro al 60% | `transparent` / `transparent` |
| **Relieve (compuestos)** | `--relieve-1/2/3`, `--hundido-1/2` | dos sombras cada uno | dos sombras cada uno | `none` |
| **Borde de relieve** | `--borde-relieve` | Deep al 6% | hueso al 5% | blanco al 55% |
| Lo que flota | `--shadow-1/2/3` | sombras en Deep | sombras casi negras | `none` |
| Velo de las hojas | `--velo` | Deep al 45% | casi negro al 60% | negro al 85% |
| Botón primario | `--btn-primario-fondo` / `-texto` | Deep sobre lavanda | hueso sobre el pozo | blanco sobre negro |

Hay dos **constantes de marca y forma** que no cambian con el tema: `--blanco` (`#f5f5f0`, el hueso
de la tarjeta de billetera) y los radios `--radius` 20px, `--radius-field` 12px, `--radius-control`
16px, `--radius-pill` 999px, más el espaciado `--sp-1…7`.

**Se retiraron** el 2026-09-20: `--vidrio-top`, `--vidrio-nav`, `--vidrio-panel` y `--atmosfera`
(una superficie translúcida no puede ser del color de la página, y un degradado debajo del relieve
rompe el truco), `--hover-suave` y `--superficie-4` (quedaron sin consumidores). No los restaures
si releés un plan viejo.

**`--ring` se queda aunque la app ya no lo use:** el foco de la app es un `outline`, pero la
portada dibuja con `--ring` el anillo de los campos del formulario de demo. No es un token sin
consumidores.

### El contrato que hay que respetar
Tres pruebas leen `app/globals.css` con **un solo parser** (`lib/diseno/tokensCss.ts`), que quita
los comentarios y **lanza** ante lo que no sabe leer (anidamiento de CSS, paréntesis sueltos, un
`var()` con valor de respaldo) en vez de leerlo mal en silencio:

1. **`lib/tema.test.ts`** — cada tema que no es el default tiene su bloque; cada tema redefine TODOS
   los tokens variables de `:root` (y ninguno de más); cada bloque declara su `color-scheme`, y el
   de `html` es el del default. La fuente de verdad del esquema es un mapa escrito en la prueba, no
   el CSS: comparar el CSS contra sí mismo sería una tautología. Un token nuevo va en los tres
   bloques, con **exactamente dos espacios** de indentación y abriendo su propia línea (el parser
   lanza si no). Las excepciones viven en `CONSTANTES`: agregar algo ahí es decir "esto no cambia
   con el tema", no "callá la prueba".
2. **`lib/diseno/temas.test.ts`** — el contraste WCAG 2.x de los tres temas:
   - **pares de tokens** (`--texto` sobre `--fondo`, etc.) y **pares por regla**, que leen el color
     y el fondo de la regla CSS real para medir lo que ve el usuario y no un token intermediario;
   - un **tinte translúcido se mide sobre la superficie que lo contiene**, no sobre la página: la
     pastilla vive en una fila (`--superficie-2`), la alerta en un panel (`--superficie-1`). Medirla
     sobre `--fondo` daba más contraste del real;
   - en alto contraste, todo texto pide **7:1**;
   - **composición**: ninguna `box-shadow` mete en una lista un token que vale `none` en algún tema
     (ni directamente ni a través de otro token), porque `none, x` invalida la declaración entera;
   - **relieve**: alto contraste es plano; claro y oscuro tienen un piso (la luz y la sombra tienen
     que verse contra el fondo);
   - **foco**: existe la regla global con `outline`, ningún `:focus` pinta un anillo con
     `box-shadow`, cada estado que se marca con `outline` tiene su propia regla `:focus-visible`, y
     la portada revierte la regla global (misma lista de elementos, antes de sus propios anillos);
   - **el hover no pisa un estado**: una regla `.X:hover` no redeclara lo que declara `.X-activa` o
     `.X.activo`, salvo que la excluya con `:not()`;
   - la copia del CSS del tablero de revisión (`public/tablero-neumorfico/propuesta.css`), mientras
     exista, es idéntica a `globals.css`.
3. **`lib/diseno/contraste.test.ts`** y **`tokensCss.test.ts`** — la matemática y el parser.

Correr: `npx vitest run lib/diseno lib/tema.test.ts` (necesita `.env.local`, porque
`vitest.setup.ts` lanza si falta aunque estas pruebas no toquen Supabase).

**Color nuevo en los tokens de tema va en hex o `rgba()`, no en `oklch()`.** Hasta el 2026-09-20 la
regla era la contraria. Se cambió porque la prueba de contraste tendría que imitar el mapeo al gamut
sRGB que hace el navegador, y un recorte ingenuo podría certificar un contraste que la pantalla no
muestra. El kit de marca ya viene en hex. Los `#000000` y `#ffffff` del alto contraste son
deliberados: ahí el extremo puro es justamente el punto.

## Tipografía
Tres familias, inyectadas por `next/font` en `app/layout.tsx` como variables CSS. **No se
redeclaran en `globals.css`**: `--x: var(--x, …)` es una referencia circular que invalida la
variable y tira toda la tipografía al serif del navegador.

- `--font-display` → **Outfit** (400/600/700): marca, títulos, nombres de fila, botones primarios.
- `--font-body` → **Hanken Grotesk** (400/600): todo el cuerpo y los formularios.
- `--font-mono` → **Geist Mono** (400/700): números y códigos (puntos, sellos, teléfonos, tokens de
  QR), etiquetas tipo kicker en versalitas con tracking amplio.

Dos familias más, **solo de la página pública** (`/`), agregadas con el kit de marca del 2026-07-29.
No se usan en ningún panel: los paneles conservan Outfit, porque cambiarles la identidad por un pase
de diseño de otra superficie sería justo lo que la regla de preservación evita.

- `--font-titular` → **Anton** (400): los titulares en bloque de `/`. **Es la fuente de titular del
  kit** (`INSUMOS/Tipografías/HEADING/Anton.zip`) y está en Google Fonts, así que va por
  `next/font/google` sin self-hostear. Condensada y de un solo peso: es exactamente el bloque de
  mayúsculas del mockup, que Outfit 700 no lograba (Outfit es más ancha y más redonda). **No lleva
  `letter-spacing` negativo**: Anton ya viene condensada y apretarla más junta las astas verticales
  hasta que una palabra se lee como un bloque negro.
- `--font-marcador` → **Permanent Marker** (400): el trazo suelto que acompaña cada titular
  ("funciona", "para crecer", "esto?"). **Es un sustituto consciente:** el kit trae **Devina Garden**
  para ese rol y no está en Google Fonts. Para usar la de verdad hay que meter el archivo en
  `app/fonts/` y pasar a `next/font/local` — es un cambio de archivo, no de diseño.

El kit trae tres familias más que **no** están cableadas y cuyo rol ya cubren las de arriba:
Blogh Display (heading alternativo), Alte Haas Grotesk y Megion (subheadings). Viven en el zip del
kit, no en el repo.

Outfit está en la lista de "reflejos" de la skill `impeccable`, y aun así **se conserva**: ya es la
identidad publicada en las cuatro superficies, y la regla de preservación de identidad le gana al
rechazo por reflejo. Cambiar la familia es una decisión de marca del dueño, no un pase de diseño.

Escala: ratio ≥1.25 entre pasos, `clamp()` en los títulos. Cuerpo entre 65 y 75 caracteres por
línea. Texto claro sobre fondo oscuro lleva 0.05 a 0.1 más de interlineado que el mismo texto en
tema claro (el tipo claro se lee más liviano y necesita aire).

## Relieve, forma y espaciado

### Las cinco reglas del relieve
1. **El relieve comunica FORMA, nunca ESTADO.** Activo, elegido y con foco se marcan con el acento
   (relleno, borde, `outline`, una marca de verificación). Un chip que solo "se hunde" al activarse
   desaparece bajo el sol, en escala de grises y para quien no distingue bien el contraste bajo.
   Verificado: con un filtro de sol (contraste 0.6, brillo 1.2) el relieve se lava y el chip activo
   sigue clarísimo; en grises, activo e inactivo se separan por 5.25:1.
2. **Los tokens compuestos van SOLOS en su `box-shadow`.** `box-shadow: var(--relieve-2);` y nada más
   en esa línea. Los colores (`--luz`, `--sombra-relieve`) sí pueden ir en una lista, porque en alto
   contraste valen `transparent`, que es un color válido. Los compuestos valen `none`, y
   `none, 0 0 0 3px x` es una declaración inválida: se cae la sombra entera.
3. **El foco es `outline`, no `box-shadow`.** No pelea con el relieve ni con el hundido (un anillo de
   `box-shadow` le reemplazaba el pozo al campo enfocado), no se compone con ningún token que valga
   `none`, y sobrevive a `forced-colors`. La regla global es
   `:where(a, button, input, select, textarea, summary, [tabindex]):focus-visible`, con
   especificidad (0,1,0): EMPATA con una clase de estado que declare su propio `outline`, así que
   cada una (`.sheet-fila-activa`, `.portal-cuenta-activa`) necesita su regla `:focus-visible`. Las
   dos excepciones son estados en un elemento que no recibe el foco: `.opcion-plan-activa` (el foco
   cae en su radio) y el ícono de "Escanear" activo (el foco cae en el `<a>`).
   **La portada no usa este foco:** `--acento` sigue al tema y sus bandas no (el violeta daba
   1.00:1 sobre la banda del cierre en oscuro). `inicio.module.css` lo revierte al anillo del
   navegador con `outline: revert`, antes de sus propias reglas de foco.
4. **Toda superficie con relieve del color de la página lleva borde de 1px** (`--borde-relieve`),
   aunque casi no se vea. La caja mide igual en los tres temas, y en `forced-colors` el borde es el
   único límite que queda. Donde no había borde, se descontó 1px del padding para que la caja no
   crezca. **Exentos:** los botones rellenos (`.btn-primary`, `.btn-acento`), que ya se separan por
   el relleno. **`.btn-borde` usa `--linea-fuerte` y no `--borde-relieve`:** en un botón el borde es
   la afordancia; con `--borde-relieve`, en alto contraste bajaba de 13.77:1 a 6.27:1.
   `.menu-destacado` conserva el `--linea` que ya tenía antes del rediseño.
5. **Todo estado tiene una señal que no es sombra.** En alto contraste el relieve vale `none`, así
   que un hover que solo "sube" ahí no se ve. Cómo quedó cada uno:
   - `.btn-borde`, `.admin-salir`, `.menu-boton` y `.contexto-pastilla`: el hover sube **y** marca
     el borde con el acento. `.menu-destacado` lo pasa a `--linea-fuerte`.
   - Las filas tocables (`.admin-fila` como `<a>`, `<button>` o `<details>`) se desplazan 2px, y al
     tocarlas marcan el borde con el acento.
   - `.btn-primary` y `.btn-acento` cambian opacidad o brillo: una señal débil en alto contraste,
     aceptada porque en el teléfono no hay hover.
   - Sin hover, a propósito: `.portal-cuenta`, `.opcion-plan`, `.filtro-chip` y
     `::file-selector-button`.
   - **Un hover nunca pisa el estado activo.** `.X:hover` (0,2,0) le gana a `.X-activa` (0,1,0):
     se escribe `.X:not(.X-activa):hover`. Pasó con `.sheet-fila` y con `.menu-destacado`.
   - El activo de "Escanear" es un aro de `outline` separado del círculo, no un anillo de
     `box-shadow` (el que tenía, con `--acento-suave`, medía 1.18:1 contra la barra).

### Qué es elevado, qué es hundido y qué es plano
- **Elevado:** `.panel`, `.btn-*`, `.admin-fila` (todas, también las `<div>` de solo lectura; las
  tocables —`<a>`, `<button>`, `<details>`— además reaccionan al hover y al toque),
  `.metric-carta`, `.menu-boton`, `.menu-destacado`, `.admin-salir`, `.contexto-pastilla`,
  `.portal-cuenta`, `.portal-recompensa`, `.escaner-marco`, `.opcion-plan`, `::file-selector-button`.
  `.escaner-marco` no puede ir hundido: una sombra `inset` se pinta debajo del contenido y el
  `<video>` la taparía entera.
- **Elevado hacia arriba** (`--relieve-3`, la sombra sube): lo anclado abajo, `.nav-inferior` y
  `.sheet-panel`.
- **Hundido:** `.field` (campos de texto, selects y textareas; los `:not()` dejan afuera radios,
  checkboxes, rangos, archivos y colores), `.campo-suelto`, `.pozo`, `.pista`, `.filtro-chip`
  inactivo, `.subida-imagen`, la fila activa de una hoja.
- **Plano:** `.icono-circulo` (identifica, no se toca), `.pastilla`, `.alerta`/`.nota`, `.admin-top`.
- **Lo que flota** usa `--shadow-1/2/3`, no el relieve: la tarjeta del pase, el botón de Wallet, la
  vista previa del editor de marca.

### Forma y espaciado
- **Radios:** `--radius` 20px (paneles, filas, métricas), `--radius-control` 16px (campos,
  `.btn-acento`, alertas, cuentas y recompensas del portal), `--radius-pill` 999px.
  `--radius-field` (12px) sigue existiendo porque la portada lo usa; en la app los controles
  migraron a `--radius-control`, y en 12px quedan solo `.wallet-btn` (excepción de Apple) y
  `.portal-instalar` (plano).
- **Espaciado:** `--sp-1…7` = 4 / 8 / 12 / 16 / 24 / 32 / 48. Variar el ritmo; el mismo padding en
  todos lados es monotonía.
- **Separación entre superficies con relieve:** 12 a 14px. La extensión de `--relieve-1` es 4 + 10 =
  14px, así que con 8 o 10 px la sombra de una pieza le pisa el brillo a la de al lado. Las listas
  densas de filas usan 14; los chips, las cuentas del portal y los botones en fila, 12.

## Excepciones deliberadas al tema (no son deuda)
Cada una está marcada en el CSS con su porqué. No "migrarlas" sin leerlo:
- `.cardface*` y `.sello*`: es la réplica de la tarjeta de la billetera, cuyos colores elige el
  comercio. Si siguieran al tema, el editor de marca mentiría. El `border` sí sigue al tema, porque
  no pinta la tarjeta: pinta la separación entre la tarjeta y la página.
- `.qr-tile`: siempre blanco con zona de silencio. Un lector necesita módulos oscuros sobre claro.
- `.wallet-btn`: negro oficial de Apple.
- `.escaner-guia`: se dibuja sobre el video de la cámara, no sobre el panel.
- `.subida-preview`: damero fijo, lienzo neutro para juzgar un PNG con transparencia.
- `.cartel-manija*`: se dibujan sobre el cartel del comercio.

(El naranja al 5% que tenía `.subida-imagen` en hover **ya no existe**: con el campo hundido, ese
`box-shadow` le reemplazaba el pozo y lo aplanaba.)

## Componentes (clases estables; no se renombran)
`.shell`/`.stack` (layout de auth y registro) · `.kicker`/`.title`/`.lede`/`.titulo-seccion` ·
`.panel` (contenedor de formulario) · `.field` · `.btn-primary`/`.btn-acento`/`.btn-borde` ·
`.alerta`/`.nota` · `.cardface*`/`.sello*` (maqueta del pass) · `.qr-tile`/`.qr-codigo` ·
`.wallet-btn` · `.admin-*` (shell, top, main, encabezado, lista, fila, vacío, error, zona de
peligro) · `.pastilla*` · `.metric-*` (métricas del panel) · `.nav-inferior`/`.nav-destacado`
(barra móvil de 5 destinos) · `.menu-*` y `.sheet-*` (menú de opciones y bottom sheets) ·
`.contexto-pastilla` (switcher de comercio y sucursal) · `.portal-*` (portal del cliente) ·
`.escaner-*` · `.filtro-chip` · `.subida-imagen`/`.subida-preview` · `.reveal` (entrada escalonada).
Desde el 2026-09-20, para lo que antes era estilo inline en el JSX: `.campo-suelto` (el hundido de
un campo fuera de un `.field`), `.pozo` (contenedor hundido de solo lectura), `.pista` /
`.pista-relleno` (barra de progreso o de gráfico) y `.opcion-plan` / `.opcion-plan-activa`.

**Los portales no se sacan.** `SelectorTema`, `SelectorContexto` y `MenuOpciones` montan sus hojas
con `createPortal` sobre `document.body`. El header ya no es vidrio, pero sigue siendo `sticky` con
`z-index: 40`, y eso crea un contexto de apilamiento: sin el portal, la barra inferior
(`z-index: 50`) le pasaría por encima a la hoja y taparía "Cerrar sesión".

## Movimiento
- Nunca se animan propiedades de layout. Transform y opacidad, y nada más. Un `inset`, un `width` o
  un `margin` animados producen tirones que ninguna curva arregla (pasó con los puntos del carrusel
  de `/`, que crecían con `inset`; ahora crecen con `scale`).
- Curvas ease-out **exponenciales**, sin rebote. Las tres de la casa:
  `cubic-bezier(0.22, 1, 0.36, 1)` (quíntica, para desplazamientos que tienen que "acomodarse"),
  `cubic-bezier(0.25, 1, 0.5, 1)` (cuártica, para opacidad y cambios de color) y
  `cubic-bezier(0.2, 0.7, 0.2, 1)` (la de `.reveal`, entradas).
  **El segundo número tiene que ser 1.** Una curva como `cubic-bezier(0.22, 0.61, 0.36, 1)` parece
  ease-out y no lo es: con y1 = 0.61 el arranque es casi lineal, y a 500 ms el ojo lo lee como un
  tirón seguido de un arrastre. Con y1 = 1 la velocidad es máxima en el primer instante y decae sin
  cortes: eso es lo que se percibe como "suave".
- **Duraciones desparejas a propósito.** El elemento que responde al gesto va más rápido que los que
  se acomodan alrededor (en el abanico de `/`: 440 ms la tarjeta señalada, 600 ms sus vecinas), y la
  vuelta al reposo es más lenta que la ida. Con una sola duración para todos, el conjunto se mueve
  en bloque y se siente mecánico.
- Queda un solo uso con overshoot heredado de Stitch: `sello-pop`
  (`cubic-bezier(0.34, 1.56, 0.64, 1)`), una celebración corta cuando se llena un sello. No es el
  patrón a copiar. Los otros dos se fueron con el rediseño: el hover de `.admin-fila` pasó a la
  quíntica de la casa, y `.metric-carta` ya no tiene hover porque no es interactiva.
- `.reveal` escalona la entrada (`d1`…`d6`) y `@media (prefers-reduced-motion: reduce)` la apaga
  junto con las demás transiciones.

## Página pública (`/`)
Vive en `app/page.tsx` + `app/_inicio/`, con su **propio módulo CSS** (`inicio.module.css`) a
propósito: nada de ahí debe filtrarse a los paneles, que son otro producto. Los radios, sombras y
espaciados **sí** salen de las variables globales, para que la página no se despegue del sistema
cuando este cambie. Los COLORES de marca ya no: ver la estrategia de abajo.

Es la única superficie **brand** del producto, y por eso es la única que se pasa de "Restrained".

### Estrategia de color de `/`: **Full palette**, la paleta oficial del kit de marca
Reemplaza el "Committed" de un solo campo de brasa naranja (histórico: `oklch(40% 0.115 42)`).
Referencia nombrada: flyer de calle / streetwear, no cripto-neón ni SaaS-navy.

**La fuente de verdad del color de marca es `Cardly_Brand_Palette.pdf`** (kit del dueño, entregado
el 2026-07-29), que da hex, RGB, CMYK, HSL, LAB y Pantone de los seis colores:

| Nombre del kit | Hex | Rol en la página |
|---|---|---|
| **Deep** | `#181849` | `--campo`: la noche. Fondo de cabecera, hero, bandas oscuras y pie. |
| **Gray** | `#E9E8E3` | `--sobre-campo` y `--claro`: el texto sobre la noche Y el fondo de la banda clara. |
| **Lime** | `#C9EC5E` | `--realce`: TODA la energía de acción (botones, ordinales, el signo del FAQ). |
| **Soft** | `#8F86E0` | `--violeta-tarjeta`: fondos grandes (la card de Growth, el cierre). |
| **Frosted** | `#B1E4F9` | `--frosted`: la franja de confianza y un glow del hero. |
| **Teal** | `#234B59` | `--teal`: disponible, sin uso todavía en `/`. |

Hasta el 2026-07-29 estos valores eran `oklch()` calculados **a ojo desde una captura del mockup**, y
ninguno coincidía con el kit: la noche salía más neutra y menos azul que el Deep real, y el violeta
bastante más saturado que el Soft real. Van en **hex y no en oklch** a propósito, contra la regla
general de "color nuevo se escribe en oklch": el kit los define en hex, y convertir de ida y vuelta
solo agrega deriva sobre un valor que ya es la autoridad. `--violeta` (`#514ba8`) es la única
excepción calculada: es el Soft oscurecido para texto y viñetas sobre la banda clara, donde el Soft
puro no llega a 4.5:1.

Escena que lo decide: *el dueño de una pupusería cierra a las nueve de la noche, se sienta en el
mostrador ya apagado y busca "tarjetas de lealtad" en el teléfono, con el brillo bajo.* Sigue
siendo la misma escena que eligió noche sobre blanco; lo que cambió es que ya no alcanza un solo
campo de brasa para sostener nueve secciones (antes eran tres), y el ritmo de bandas oscuras y
claras es lo que evita que una página larga se sienta un solo rectángulo de color.

**Los CINCO nombres de variable se conservan** (`--campo`, `--sobre-campo`, `--sobre-campo-2`,
`--realce`, `--borde-campo`): es el mismo contrato de siempre, solo cambia el valor. Se declaran
una sola vez en `.pagina` (antes vivían en `.cabecera, .hero` nada más) junto con los cuatro nuevos
de la banda clara (`--claro`, `--sobre-claro`, `--sobre-claro-2`, `--linea-clara`) y los tres de
condimento, para que cualquier sección de la página pueda usarlos sin redeclararlos. Todo lo que se
pinta con ellos ignora el tema del dispositivo a propósito, misma excepción que `.cardface`: un
afiche que cambia de color porque el visitante dejó el panel en claro no es un afiche.

**La excepción de la excepción sigue siendo alto contraste.** `:global(:root[data-tema="alto-
contraste"]) .pagina` redefine las doce variables (negro y blanco puros, lima y violeta más
saturados) y además **colapsa la alternancia**: `--claro` pasa a valer `#000000` también, para que
las bandas claras no le devuelvan a alguien bajo el sol un blanco deslumbrante contra el resto de
la página en negro. Quien prendió ese tema quiere leer, no mirar un afiche.

### Los insumos del kit, y de dónde sale cada imagen
El kit del dueño (zip `INSUMOS-…`) es la fuente de **todas** las imágenes de `/`. Se convierten a
WebP redimensionado y viven en `public/_inicio/`; **el zip crudo NO se commitea** (traía el `.ai`, el
PDF de la paleta y cinco zips de fuentes: servirlos desde `public/` los publicaría en
`cardly-sv.site/INSUMOS/…`, y los zips de fuentes en un repo público son además un problema de
licencia). El respaldo del original es el zip del dueño, no este repo.

| Archivo servido | Origen en el kit | Dónde se usa |
|---|---|---|
| `hero-chico.webp` | `Imagen3.png` | La foto del hero. |
| `grupo.webp` | `Imagen2grupo.png` | El cierre (`#demo`). |
| `tarjeta-puntos/sellos/puntos-bu.webp` | `CARDLY-Imagen1/2/3.png` | Los tres modelos de "Tarjetas". |
| `wallet-puntos/sellos-futbol/sellos-gym.webp` | `Phone-Cardly-Image1/2/3.png` | Los tres pasos de "Así funciona". |
| `sticker-*.webp` (9) | `Sticker1…9.png` | Flotando, uno o dos por sección. |
| `abanico-tarjetas.webp` | `Imagen1.png` | **Sin uso todavía** (los tres modelos ya compuestos en abanico con stickers). |

**Los stickers son decorativos y se esconden abajo de 900 px.** Van con `aria-hidden`, `alt=""` y
`pointer-events: none` (flotan ENCIMA del contenido: sin eso se roban clicks de los botones que
están debajo), y ninguno carga información que no esté escrita en texto al lado. En una columna
todos caen sobre el texto y lo vuelven ilegible, así que en teléfono no se muestra ninguno: ahí la
energía de afiche la cargan Anton y el color.

**Hueco conocido:** el kit trae **3** modelos de tarjeta y el catálogo tiene **8** tipos. La sección
muestra los 3 reales y nombra los 8 en chips de texto. No se maquetan los otros 5: una ficha
dibujada por nosotros para "Cupón" o "Membresía" es una promesa visual de un diseño que no existe.
Cuando existan, entran en `.modelosGrilla` sin tocar el CSS.

Restricciones que no se negocian:
- **Se sirve prerenderizada estática y funciona sin JavaScript.** Verificado con `npx next build`
  tras el rediseño: `/` sigue saliendo `○ (Static)`. Las preguntas frecuentes son `<details>` /
  `<summary>` nativos por la misma razón (cero JavaScript para abrir y cerrar).
- **Ninguna imagen del kit se sirve en su PNG original.** Tres de ellas pesaban 730–850 KB, y
  PRODUCT.md dice que esta página es lo primero que ve alguien "con una conexión mala en un teléfono
  barato". Se convierten a WebP y se redimensionan al techo con el que realmente se pintan.
- El abanico de tarjetas (`CarruselTarjetas.tsx`) no se tocó: sigue viviendo DENTRO del hero, a la
  derecha del texto, con el mismo sistema de `--ancho-tarjeta` / `--tope-tarjeta` / `--aire-
  escenario`. Ver el historial de este documento (o el git log de `inicio.module.css`) si hace
  falta el detalle de esas cotas.
- **El teléfono del abanico va en claro; la tarjeta de adentro, no.** Se mantiene igual: el aparato
  es cromo y necesita contraste contra la noche del fondo, y las tarjetas de muestra conservan los
  colores de cada comercio ficticio.
- **La regla "sin cards genéricos" se aplica con criterio, no a rajatabla.** "Cómo funciona" y
  "¿Seguís usando esto?" y las preguntas frecuentes siguen siendo listas regladas (una raya arriba,
  sin caja) — ahí una card seguiría siendo la respuesta perezosa. Pero "Tarjetas para cada negocio"
  (ocho fichas, una por tipo real de `lib/tarjetas/tipos.ts`) y "Planes" (tres tarifas) SÍ usan
  fichas: ahí una card es la afordancia correcta (comparar opciones lado a lado), y cada una evita
  la trampa de la grilla idéntica con una decisión propia — las de tipo llevan forma de talón de
  boleto (borde punteado + dos muescas del color de la banda, sin imágenes), y de las tres tarifas
  solo Growth invierte a fondo noche para cargar la jerarquía en el color en vez de en un borde más
  grueso.
- **"Qué gana tu negocio" (la tira con `scroll-snap` nativo) se retiró** en el rediseño: sus seis
  razones se repartieron entre la nueva franja de confianza (después del hero) y "¿Seguís usando
  esto?" (banda oscura, filas an lugar de cards, con el tache dibujado en SVG). Si hace falta el
  patrón de tira deslizable para una futura sección, está en el historial de git de este archivo y
  de `inicio.module.css`.
- **Sin contadores de piloto.** El mockup traía una franja de "+1,200 comercios / +250,000
  tarjetas / +5 millones de escaneos": números que PRODUCT.md descarta a propósito ("son números de
  piloto y restan"). La franja de confianza que los reemplaza dice tres cosas verificables hoy
  (Apple + Google Wallet, la cantidad real de tipos de tarjeta del catálogo, "tu marca no la
  nuestra"), con el mismo ritmo de tres columnas.
- **Precios públicos: pendiente de decisión del dueño, no de diseño.** El rediseño agregó una
  sección "Planes" con las tres tarifas reales ($29 / $49 / $89, ver el catálogo de
  `lib/comercios/cuentas.ts`), matching el mockup. Esto revierte la política anterior de esta
  página ("no vende precios, pide una demo"). El código ya lo muestra; si el dueño decide volver a
  ocultarlo, la sección se saca de `app/page.tsx` sin tocar el resto del diseño, y este párrafo (y
  la frase correspondiente en `PRODUCT.md`) hay que borrarlos junto con ella.

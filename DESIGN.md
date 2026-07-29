# DESIGN.md — Cardly SV

> **Reescrito el 2026-07-27 contra `app/globals.css` y `lib/tema.ts`.** La versión anterior
> describía una identidad de cafetería en tema claro (espresso, papel crema, caramelo) y se declaraba
> supersedida por un rediseño de Stitch que ya se aplicó y siguió evolucionando. Nada de eso está
> vivo. **La fuente de verdad es el código**: los bloques `:root`, `:root[data-tema="claro"]` y
> `:root[data-tema="alto-contraste"]` de `app/globals.css`. Este documento explica el porqué; si los
> dos se contradicen, gana el CSS y hay que corregir acá.

## Identidad
**Oscuro por defecto, hueso sobre carbón, un solo acento naranja cálido.** Sin marrones, sin
degradados de marca, sin vidrio decorativo. La calidez viene del acento y del hueso `#f5f5f0` (no
blanco puro), no de saturar las superficies.

## Los tres temas
`lib/tema.ts` define `TEMAS = ['oscuro', 'claro', 'alto-contraste']` y `TEMA_POR_DEFECTO = 'oscuro'`.
Es **preferencia de dispositivo**, no dato de negocio: vive en `localStorage` (`cardly-tema`), y un
script síncrono en el `<head>` (`SCRIPT_TEMA`, montado desde `app/layout.tsx`) lo aplica antes del
primer pintado para que no haya destello. El estado real es el atributo `data-tema` del `<html>`:
el selector de React lo lee del DOM, no de `localStorage`.

Cada tema tiene su frase de escena física. Si una decisión de color no se puede justificar con una
de estas tres frases, la decisión está mal:

| Tema | Escena | Consecuencias |
|---|---|---|
| **oscuro** (default) | El dueño revisa las ventas del día a las once de la noche, en la cama, con el teléfono al mínimo de brillo. | Carbón, no negro. Jerarquía por opacidad del mismo hueso. Glows de atmósfera muy tenues. |
| **claro** | El dueño configura su tarjeta en su laptop, de día, con la vidriera abierta a la calle. | Los acentos se **oscurecen**: el naranja pálido nació para leerse sobre negro y sobre blanco da 1.6:1. Los escalones de superficie se hunden en vez de subir. |
| **alto contraste** | El cajero cobra en un puesto al aire libre, mediodía, el sol pegando en la pantalla. | Negro **puro** (un `#131313` refleja y se lava), bordes a alpha alto, acentos saturados, sombras y glows apagados: bajo el sol no dan profundidad, solo ensucian el borde. |

## Estrategia de color: **Restrained** en los paneles
Neutros (hueso sobre carbón) más **un** acento naranja, por debajo del 10% de la superficie, y un
menta secundario para datos y éxito. El cian suelto que proponía Stitch se descartó; los marrones de
borde también. Esto vale para `/comercio`, `/admin`, `/registro` y `/mi-tarjeta`, donde el color
tiene que señalar dónde tocar y nada más.

**La página pública `/` tiene permiso para otra estrategia**, más comprometida: es brand, no
herramienta. Ver "Página pública", abajo.

### Tokens (nombres estables; los valores los redefine cada tema)

| Rol | Token | Oscuro | Claro | Alto contraste |
|---|---|---|---|---|
| Fondo de página | `--fondo` | `#131313` | `#f4f1ec` | `#000000` |
| Superficies | `--superficie-0…4` | `#0e0e0e` → `#353534` | `#e7e2d9`, blanco, blanco, `#ded7ca`, `#d0c7b6` | `#000000` → `#2e2e2e` |
| Texto | `--texto` / `-2` / `-3` | hueso al 100 / 72 / 48% | tinta al 100 / 72 / 62% | `#fff` / `#ededed` / `#d4d4d4` |
| Bordes | `--linea` / `--linea-fuerte` | hueso al 10 / 16% | tinta al 12 / 24% | blanco al 55 / 82% |
| Acento | `--acento` / `--acento-fuerte` | `#ffc495` / `#ff9d42` | `#a8480a` / `#c2410c` | `#ffb01f` / `#ff9500` |
| Sobre acento | `--sobre-acento` | `#42230a` | `#fff6ee` | `#000000` |
| Secundario | `--menta` / `--sobre-menta` | `#8bd6b4` / `#00351f` | `#0d6e4a` / `#eefff7` | `#00e58c` / `#000000` |
| Error | `--error` + `-fondo` / `-borde` / `--error-suave` | `#ffb4ab` | `#a4231c` | `#ff8a7a` |
| Tintes suaves | `--hover-suave`, `--neutro-suave`, `--acento-suave`, `--acento-borde`, `--menta-suave` | alphas del hueso | alphas de la tinta | alphas altos |
| Vidrio | `--vidrio-top`, `--vidrio-nav`, `--vidrio-panel`, `--velo` | translúcidos | translúcidos claros | **opacos** |
| Botón primario | `--btn-primario-fondo` / `-texto` | hueso sobre carbón | tinta sobre hueso | blanco sobre negro |
| Atmósfera | `--atmosfera` | dos glows radiales | dos glows radiales | `none` |

**`--blanco` (`#f5f5f0`) no es un token de tema: es una constante de marca.** Los otros dos temas no
lo redefinen a propósito, porque sus dos usos que quedan (`.cardface`, `.cardface-logo`) son la
tarjeta de la billetera, que se ve igual esté el panel claro u oscuro.

### El contrato que hay que respetar
`lib/tema.test.ts` lo verifica y falla el build de pruebas:
1. Cada tema que no es el default tiene su bloque `:root[data-tema="…"] {`.
2. **Cada tema redefine TODOS los tokens variables de `:root`.** Un token nuevo declarado solo en
   `:root` deja esa pantalla con el color del tema oscuro incrustado en claro y en alto contraste.
   Y al revés: un token que solo existe en un tema no lo hereda nadie.
3. Cada tema declara `color-scheme` (si no, los `<select>`, los scrollbars y el autofill nativos
   salen con el esquema anterior).
4. Las excepciones viven en `CONSTANTES` dentro de la prueba (`--blanco`, radios, espaciado,
   `--shadow-card`). Agregar algo ahí es decir "esto no cambia con el tema", no "callá la prueba".

La prueba lee el CSS con una regex que exige **exactamente dos espacios** de indentación antes del
`--token:`. Un token declarado con otra indentación es invisible para ella.

**Color nuevo se escribe en `oklch()`**, con los neutros tintados hacia el matiz del acento (chroma
0.005 a 0.01 alcanza). Los hex de arriba son historia: vinieron de Stitch y se conservan porque
están calibrados y probados, no porque sean el estándar. Los `#000000` y `#ffffff` del tema de alto
contraste son **deliberados**: ahí el extremo puro es justamente el punto.

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

## Forma, espaciado, elevación
- **Radios:** `--radius` 20px (paneles, filas), `--radius-field` 12px (campos), `--radius-pill` 999px.
- **Espaciado:** `--sp-1…7` = 4 / 8 / 12 / 16 / 24 / 32 / 48. Variar el ritmo; el mismo padding en
  todos lados es monotonía.
- **Elevación:** `--shadow-1` (filas, inputs), `--shadow-2` (paneles), `--shadow-3` (tarjeta del
  pass, botón primario), `--ring` (foco), `--sombra-acento`, `--sombra-menta`. En alto contraste las
  sombras valen `none` literal, no un rgba transparente: una sombra invisible igual cuesta pintura
  por scroll en el teléfono barato del mostrador. **Ojo al componer:** `0 0 0 3px x, var(--sombra-acento)`
  es inválido cuando esa variable vale `none`, y se cae la sombra entera.

## Excepciones deliberadas al tema (no son deuda)
Cada una está marcada en el CSS con su porqué. No "migrarlas" sin leerlo:
- `.cardface*` y `.sello*`: es la réplica de la tarjeta de la billetera, cuyos colores elige el
  comercio. Si siguieran al tema, el editor de marca mentiría. El `border` sí sigue al tema, porque
  no pinta la tarjeta: pinta la separación entre la tarjeta y la página.
- `.qr-tile`: siempre blanco con zona de silencio. Un lector necesita módulos oscuros sobre claro.
- `.wallet-btn`: negro oficial de Apple.
- `.escaner-guia`: se dibuja sobre el video de la cámara, no sobre el panel.
- `.subida-preview`: damero fijo, lienzo neutro para juzgar un PNG con transparencia.
- El naranja al 5% del `:focus-within` de `.subida-imagen`: se revisó y no es visible en ninguno de
  los tres temas; tokenizarlo sería inventar una variable para un efecto que nadie ve.

## Componentes (clases estables; no se renombran)
`.shell`/`.stack` (layout de auth y registro) · `.kicker`/`.title`/`.lede`/`.titulo-seccion` ·
`.panel` (contenedor de formulario) · `.field` · `.btn-primary`/`.btn-acento`/`.btn-borde` ·
`.alerta`/`.nota` · `.cardface*`/`.sello*` (maqueta del pass) · `.qr-tile`/`.qr-codigo` ·
`.wallet-btn` · `.admin-*` (shell, top, main, encabezado, lista, fila, vacío, error, zona de
peligro) · `.pastilla*` · `.metric-*` (métricas del panel) · `.nav-inferior`/`.nav-destacado`
(barra móvil de 5 destinos) · `.menu-*` y `.sheet-*` (menú de opciones y bottom sheets) ·
`.contexto-pastilla` (switcher de comercio y sucursal) · `.portal-*` (portal del cliente) ·
`.escaner-*` · `.filtro-chip` · `.subida-imagen`/`.subida-preview` · `.reveal` (entrada escalonada).

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
- Quedan tres usos con overshoot heredados de Stitch (`sello-pop`, el hover de `.admin-fila` y el
  de `.metric-carta`, todos `cubic-bezier(0.34, 1.56, 0.64, 1)`): son celebraciones cortas dentro
  del panel, no el patrón a copiar.
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

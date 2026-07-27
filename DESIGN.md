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
propósito: nada de ahí debe filtrarse a los paneles, que son otro producto. Los colores, radios,
sombras y espaciados **sí** salen de las variables globales, para que la página no se despegue del
sistema cuando este cambie.

Es la única superficie **brand** del producto, y por eso es la única que se pasa de "Restrained".

### Estrategia de color de `/`: **Committed**, un campo de brasa
La primera pantalla (cabecera + hero) es un campo plano y saturado, `--campo: oklch(40% 0.115 42)`,
un naranja quemado del mismo matiz que el acento del sistema. Cubre el 100% del primer pliegue y
para en seco donde empieza el contenido: de ahí para abajo manda el tema. La cabecera pegajosa
lleva el mismo campo, así que arriba del todo se lee como una sola superficie y al bajar queda una
franja de marca.

Escena que lo decide: *el dueño de una pupusería cierra a las nueve de la noche, se sienta en el
mostrador ya apagado y busca "tarjetas de lealtad" en el teléfono, con el brillo bajo.* De ahí sale
que no puede ser una página blanca que encandile, y que el color tiene que hacer el trabajo que en
un local haría un rótulo pintado a mano: decir de quién es esto antes de que nadie lea una palabra.

Cinco variables locales, declaradas en `.cabecera, .hero` de `inicio.module.css`:
`--campo`, `--sobre-campo`, `--sobre-campo-2`, `--realce`, `--borde-campo`. Todo lo que se pinta
encima (marca, enlaces, botones, flechas y puntos del carrusel) usa ese par de contraste y **no**
los tokens del tema: un afiche que se aclara porque el visitante dejó el panel en claro no es un
afiche. Es la misma excepción de `.cardface`, por la misma razón.

**La excepción de la excepción es alto contraste**, y se respeta: un bloque
`:global(:root[data-tema="alto-contraste"])` redefine esas cinco variables (negro, blanco, ámbar) y
nada más. Quien prendió ese tema está bajo el sol y quiere leer, no mirar un afiche.

Restricciones que no se negocian:
- **Se sirve prerenderizada estática y funciona sin JavaScript.** Verificar con `npx next build` que
  `/` siga saliendo estática.
- El abanico de tarjetas (`CarruselTarjetas.tsx`) funciona con dedo, teclado y mouse, y anuncia la
  tarjeta activa a un lector de pantalla. Vive DENTRO del hero, a la derecha del texto, y abajo de
  900px se apila debajo tocando los dos bordes de la pantalla. En escritorio la vitrina además se
  sale de la envoltura por la derecha (con techo de 120px) para acercarse al borde de la pantalla.
  Se le cambia el encuadre y el tamaño con `--ancho-tarjeta`, `--tope-tarjeta` y `--aire-escenario`;
  no se reescribe.
  Las cotas del escenario están calculadas y anotadas en el CSS, porque el degradado que difumina
  las puntas recorta TODO lo que se salga de su caja (contenido, sombras y anillos de foco). `--tope`
  no baja de 40px, que son píxeles fijos; **`--aire` se calcula a partir del ancho de la tarjeta**
  (`+ 56px + ancho × 0.17`) y no se escribe a mano: lo que sobresale al girar crece con la tarjeta,
  así que un número fijo se queda viejo la primera vez que alguien la agranda.
- **El teléfono del abanico va en claro; la tarjeta de adentro, no.** El aparato es cromo (cuerpo,
  marco, isla, indicador de inicio) y en claro se recorta contra la brasa a 3.9:1 en su borde más
  oscuro; en negro se hundía a 1.6:1 y la mitad de arriba desaparecía. Los colores de la tarjeta son
  del comercio de muestra y son el punto de la ilustración: no se tocan.
- **Sin fondos ni cards genéricos**, pedido explícito del dueño. La página no tiene ni una caja: los
  pasos son una lista ordenada con una regla arriba y el ordinal en mono. Lo único con contenedor
  propio es el formulario de demo, porque agrupar campos sí es una función y no una decoración.
- **"Qué gana tu negocio" es una tira que se desliza** (`.tira`), no un segundo abanico: si la
  página repitiera el mecanismo del hero, el de arriba dejaría de significar "así se ve tu tarjeta".
  Es una fila recta de columnas regladas con `scroll-snap` **nativo**: cero JavaScript, y por eso
  sigue andando con el script apagado. Cada columna mide 74vw con techo de 340px, así que en un
  monitor entran tres y asoma la cuarta: el contenido no queda escondido detrás de un gesto. El
  contenedor que se desliza es un `<div tabindex="0" role="group">` aparte y **no** el `<dl>`, para
  no pisarle el rol de lista ni desarmar los pares término/definición; el tabindex hace falta porque
  Chrome y Safari no hacen enfocable un scroller sin nada enfocable adentro.

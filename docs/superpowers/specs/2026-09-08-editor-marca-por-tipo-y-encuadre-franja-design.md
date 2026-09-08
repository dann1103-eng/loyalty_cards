# Editor de marca según el tipo de tarjeta, y encuadre de la foto de la franja

Fecha: 2026-09-08
Estado: diseño aprobado por el usuario en conversación; pendiente de plan

## Por qué

Daniel se dio de alta como si fuera un cliente nuevo, eligió **membresía** (una tarjeta que solo
muestra el QR) y entró al editor de marca. Tres cosas estaban mal:

1. **La vista previa asume puntos o sellos.** Debajo de la franja dice "PUNTOS 0" aunque el pass
   real de una membresía no lleva contador (ver `contadorPase`, que devuelve `null` para cupón,
   membresía y descuento). La vista previa se vende como "réplica del pass real" y no lo es.
2. **La foto de fondo de la franja sale cortada y no hay forma de acomodarla.** Subió una imagen
   con el logo arriba y la franja, que Apple fija en proporción 375:123, la recorta al centro:
   el logo queda partido. Hoy el único control sobre esa foto es el difuminado.
3. **Las etiquetas de recursos visuales hablan de sellos.** "Franja personalizada (reemplaza la
   grilla de sellos)" no significa nada para una membresía.

Además, durante el diseño se decidió incluir tres cosas que el primer borrador dejaba afuera:
**zoom**, **arrastrar la foto en la vista previa** y aplicar el encuadre también al **cartel
imprimible** (plantilla "foto").

## Decisiones

1. **La vista previa replica el pass de Apple para los ocho tipos, con la MISMA función que
   arma el frente del pass.** Hoy la decisión "qué va en el campo primario y qué en el
   secundario" vive inline en `generarPassApple` (sellos con grilla → secundario "SELLOS · 7 de
   N"; sellos sin grilla → primario "7 de N sellos"; el resto → `contadorPase`, que devuelve
   `null` para cupón, membresía y descuento). Se extrae a un módulo puro
   `lib/tarjetas/frentePase.ts` (`frentePase({ tipoTarjeta, puntos, selloMeta, hayGrilla })` →
   `{ primario, secundario }`, cada uno `{ etiqueta, valor, numero } | null`) que consumen
   `generatePass` y la vista previa. Así la vista previa no puede decir algo distinto del pass ni
   siquiera en una palabra. La vista previa usa contador 0 (tarjeta recién emitida) salvo en
   sellos, que conserva su demostración de 7 llenos con meta solo si está configurada. El campo
   primario se dibuja **sobre la franja** (abajo a la izquierda), que es donde Apple dibuja los
   `primaryFields` de un `storeCard`. Debajo va la fila secundaria: el secundario a la izquierda
   si lo hay, y el nombre del titular a la derecha con el texto de ejemplo "Nombre del cliente".

2. **El encuadre es un dato de cuatro partes: modo, foco horizontal, foco vertical y zoom.**
   - `modo`: `'llenar'` (la foto cubre el marco y se recorta) o `'completa'` (la foto entra
     entera y el color de fondo de la tarjeta rellena lo que sobra; el difuminado la funde).
   - `focoX`, `focoY`: enteros 0–100. Semántica de `object-position`: dónde se alinea la holgura
     entre la foto escalada y el marco. 50/50 es centrado (el comportamiento de hoy).
   - `zoom`: entero 100–300, en porcentaje sobre la escala base del modo. En "llenar" 100 es el
     recorte justo y subir acerca; en "completa" 100 es la foto entera y subir la va llenando.
   - Default: `{ modo: 'llenar', focoX: 50, focoY: 50, zoom: 100 }`. Con el default, todo lo
     que ya existe se ve **exactamente igual** que hoy.

3. **Una sola función pura decide qué se ve, y la consumen los cinco dibujantes.** Dadas las
   medidas de la foto, las medidas del marco y el encuadre, `colocarFoto` devuelve dónde y a qué
   tamaño va la foto dentro del marco, y `rectanguloVisible` el rectángulo de la foto (en píxeles
   de la foto) que ocupa el marco entero — puede ser más chico que la foto (recorte) o más grande
   (foto completa con fondo alrededor). Los consumidores: la vista previa en el navegador (CSS),
   la franja del pass de Apple (next/og), la grilla de sellos por tarjeta de Google (misma
   composición), la imagen de portada de la clase de Google (ruta nueva) y el cartel (SVG). Como
   el marco es un parámetro, la misma foto con el mismo encuadre se ve coherente en la franja
   3:1 y en el cartel vertical.

4. **El encuadre viaja con la foto — NO se hereda campo por campo.** Los colores heredan con
   `??` porque un color del negocio sirve igual en cualquier tarjeta. La posición de una foto
   solo tiene sentido para ESA foto: heredar el foco del negocio sobre una foto distinta daría
   siempre un resultado sin sentido. Regla, dentro de `brandingEfectivo` para que ningún
   consumidor pueda divergir:
   - la tarjeta tiene `hero_url` propio → usa su encuadre propio; si nunca lo tocó (columnas en
     null), el default;
   - la tarjeta hereda la foto → hereda el encuadre del negocio;
   - `branding_propio` apagado → todo del negocio, como el resto.

5. **Google también.** Hoy la `LoyaltyClass` apunta a la foto cruda (`heroImage`), así que en
   Android una tarjeta de puntos o membresía muestra la foto sin velo, sin difuminado y sin
   encuadre. Pasa a apuntar a una ruta pública nueva que sirve **la misma banda de marca que va
   en el pass de Apple** (velo oscuro, difuminado, resplandor, encuadre), con `?v=` de
   cache-busting. Consecuencia aceptada por el usuario: en Android la portada de los comercios
   existentes cambia de aspecto para verse igual que en iPhone. La grilla de sellos por tarjeta
   (`/api/tarjetas/[id]/hero.png`) ya se compone con `componerStrips` y hereda el encuadre sin
   código aparte.

   **La franja personalizada (`strip_url`) NO entra en la portada de la clase.** La ruta fuerza
   `stripUrl: null` y sirve solo la banda con la foto; la condición para usar la URL compuesta es
   una sola, en la ruta y en `syncClase`/`syncClasePrograma`: **hay foto efectiva**. Sin foto
   efectiva, la clase sale sin `heroImage`, como hoy. Motivo: `componerStrips` con `stripUrl`
   devuelve los bytes crudos de la franja (formato y tamaño arbitrarios) y servirlos como
   `image/png` es exactamente el tipo de cosa que Google rechaza al validar la clase. Un comercio
   con foto Y franja personalizada ve en Android la banda con la foto, no la franja.

6. **Zoom y arrastre no cambian el modelo.** El zoom es el cuarto número del encuadre. El
   arrastre es aritmética pura sobre los mismos datos: mover la foto N píxeles en la vista previa
   cambia el foco en `N / holgura × 100` en ese eje, donde la holgura es `marco − foto escalada`
   (negativa cuando la foto desborda). En un eje sin holgura la foto no se mueve. El delta es
   **incremental** (desde el último `pointermove`, no acumulado desde el `pointerdown`): al
   arrastrar más allá del borde el foco se acota en 0 o 100 y, al volver, la foto responde de
   inmediato en vez de quedarse pegada hasta que el puntero desanda el exceso. Los deslizadores
   siguen existiendo (precisión y teclado) y se actualizan al arrastrar. La rueda del mouse NO
   hace zoom: pelearía con el scroll de la página.

7. **Migración primero, deploy después.** Las cuatro columnas nuevas entran al payload de
   `guardarBranding` y `guardarBrandingPrograma`. Sin la migración aplicada, TODO el formulario
   de colores fallaría, no solo lo nuevo (lección de la 0030, en CLAUDE.md). La suite en rojo
   "solo por la migración" es la medida exacta de eso y no se pushea así.

## Modelo de datos — migración 0032

```sql
-- 0032: encuadre de la foto de fondo de la franja (modo, foco y zoom).
begin;

alter table comercios
  add column encuadre_franja text not null default 'llenar'
    check (encuadre_franja in ('llenar', 'completa')),
  add column foco_franja_x smallint not null default 50 check (foco_franja_x between 0 and 100),
  add column foco_franja_y smallint not null default 50 check (foco_franja_y between 0 and 100),
  add column zoom_franja smallint not null default 100 check (zoom_franja between 100 and 300);

-- En el programa las cuatro nacen null: "no lo toqué". Se leen como UNIDAD (ver decisión 4):
-- si alguna es null, el programa no tiene encuadre propio y cae al default.
alter table programas_tarjeta
  add column encuadre_franja text check (encuadre_franja in ('llenar', 'completa')),
  add column foco_franja_x smallint check (foco_franja_x between 0 and 100),
  add column foco_franja_y smallint check (foco_franja_y between 0 and 100),
  add column zoom_franja smallint check (zoom_franja between 100 and 300);

commit;
```

- Los CHECK son la defensa barata; la real es `validarEncuadre` en TS, que corre al guardar, y
  `sanearEncuadre` al leer (un valor ilegible cae al default, nunca revienta un pass).
- `lib/supabase/types.ts` se transcribe a mano (así está el archivo); `scripts/verificar-0032.ts`
  verifica columnas, defaults y que un programa existente lea null en las cuatro.
- El usuario aplica el SQL en Studio y avisa; el asistente no puede correr DDL.

## Módulo puro: `lib/comercio/encuadreFranja.ts`

Sin DOM, sin React, sin sharp, sin next/og. Lo importan el cliente (vista previa) y el servidor
(pass, rutas, cartel). Cubierto con mutation-testing.

```ts
export const MODOS_ENCUADRE = ['llenar', 'completa'] as const;
export type ModoEncuadre = (typeof MODOS_ENCUADRE)[number];
export interface Encuadre { modo: ModoEncuadre; focoX: number; focoY: number; zoom: number }
export const ENCUADRE_POR_DEFECTO: Encuadre;          // llenar, 50, 50, 100
export const ZOOM_MINIMO = 100; export const ZOOM_MAXIMO = 300;

export interface Medidas { ancho: number; alto: number }
export interface Colocacion { left: number; top: number; ancho: number; alto: number } // en unidades del marco
export interface Rectangulo { x: number; y: number; ancho: number; alto: number }     // en píxeles de la foto

// Escala base × zoom, y la holgura repartida según el foco. Es EL cálculo; todo lo demás deriva.
export function colocarFoto(foto: Medidas, marco: Medidas, encuadre: Encuadre): Colocacion;
// La ventana de la foto que ocupa el marco entero (para el <svg viewBox> del cartel).
export function rectanguloVisible(foto: Medidas, marco: Medidas, encuadre: Encuadre): Rectangulo;
// Arrastre: delta en píxeles de pantalla del marco → nuevo foco (0–100), eje por eje.
export function focoTrasArrastre(
  encuadre: Encuadre, deltaPx: { x: number; y: number }, foto: Medidas, marcoPx: Medidas,
): { focoX: number; focoY: number };

// Validación al guardar. null = válido; string = mensaje para el dueño.
export function validarEncuadre(e: { modo: string; focoX: number; focoY: number; zoom: number }): string | null;
// Lo que llega del formulario (strings). Cuatro vacíos → null (heredar/no tocar); si no, números
// crudos (NaN incluido) para que validarEncuadre los rechace con mensaje claro.
export function encuadreDesdeFormulario(c: { modo: string; focoX: string; focoY: string; zoom: string }):
  { modo: string; focoX: number; focoY: number; zoom: number } | null;
// Lo que sale de la BD es dato hostil. Dos funciones y no una con `| null`: las cuatro columnas
// del comercio son NOT NULL, y un `?? ENCUADRE_POR_DEFECTO` en cada llamador del comercio sería
// indistinguible de un olvido. Un valor fuera de rango o ilegible hace caer el ENCUADRE ENTERO al
// default (se lee como unidad), nunca un campo suelto.
export function encuadreDelComercio(fila: {
  encuadre_franja: string; foco_franja_x: number; foco_franja_y: number; zoom_franja: number;
}): Encuadre;
// Programa: si alguna columna es null → null (sin encuadre propio).
export function encuadreDelPrograma(fila: {
  encuadre_franja: string | null; foco_franja_x: number | null;
  foco_franja_y: number | null; zoom_franja: number | null;
}): Encuadre | null;
```

Medidas no positivas (`ancho` o `alto` ≤ 0, que es lo que da `naturalWidth` antes del `onLoad`):
`colocarFoto` devuelve el marco entero sin desplazamiento, `rectanguloVisible` la ventana `0 0
marco`, y `focoTrasArrastre` el foco sin cambios. Nunca `NaN`/`Infinity`: un `NaN` en una
coordenada rompe el SVG del cartel entero.

Aritmética de `colocarFoto`:

```
escalaBase = modo === 'llenar' ? max(marco.ancho/foto.ancho, marco.alto/foto.alto)
                               : min(marco.ancho/foto.ancho, marco.alto/foto.alto)
escala     = escalaBase × zoom / 100
ancho      = foto.ancho × escala ; alto = foto.alto × escala
left       = (marco.ancho − ancho) × focoX / 100
top        = (marco.alto  − alto)  × focoY / 100
```

`rectanguloVisible` es la inversa: `x = −left/escala`, `y = −top/escala`, `ancho = marco.ancho/escala`,
`alto = marco.alto/escala`. `focoTrasArrastre`: `holgura = marcoPx − fotoEscaladaPx` por eje;
`foco' = acotar(foco + deltaPx/holgura × 100)`; con `|holgura| < 0.5` px el foco no cambia.

Casos que las pruebas fijan (y su mutación): medidas no positivas → marco entero y foco sin
cambios; centrado con default reproduce el `cover` actual;
`focoY` 0 y 100 muestran los extremos opuestos; `completa` sin zoom deja la foto entera dentro
del marco; zoom 200 en `llenar` duplica el tamaño; el arrastre con holgura 0 no mueve; arrastrar
más allá del borde deja el foco en 0 o en 100; `validarEncuadre` rechaza modo desconocido,
foco fuera de 0–100, zoom fuera de 100–300 y `NaN`, cada uno con su mensaje;
`encuadreDesdeColumnas` devuelve null con una sola columna null.

## Herencia: `brandingEfectivo`

`BrandingBase` gana `encuadreFranja: Encuadre` (obligatorio: el compilador obliga a cada
consumidor a pasarlo, igual que pasó con `reverso` y `ubicaciones`). `BrandingPrograma` gana
`encuadreFranja?: Encuadre | null`. La resolución aplica la decisión 4. Pruebas: los tres casos de
la regla, y que con `branding_propio` apagado se ignora el encuadre propio.

## Composición del pass (Apple y grilla de Google)

- `DatosStrip` y `DatosPass` ganan `encuadreFranja: Encuadre`.
- `componerStrips` mide la foto con `sharp(buf).metadata()` después de bajarla (best-effort: sin
  medidas, la capa se dibuja como hoy con `objectFit: 'cover'` centrado). Con medidas,
  `capasDeFondo` posiciona la `<img>` en absoluto con `colocarFoto` sobre el marco `375×123 ×
  escala`; el contenedor ya tiene el color de fondo, así que en modo `completa` lo que sobra queda
  del color de la tarjeta y el difuminado lo funde. Velo y difuminado no cambian.
- `versionHero` (`DatosVersionHero`) suma los cuatro campos: cualquier cambio de encuadre cambia
  la URL y Google re-descarga. Prueba: cada campo por separado cambia el hash.
- Prueba de composición (junto a la de difuminado en `generatePass.test.ts`): una foto de dos
  colores (mitad superior roja, inferior azul), difuminado `ninguno`; con `focoY: 0` el píxel
  central de `strip.png` es rojo y con `focoY: 100` es azul (muestreado con sharp). Si la
  composición ignora el foco, los dos salen rojos y la prueba falla.

## Portada de la clase de Google — ruta nueva

`GET /api/comercios/[comercioId]/franja.png?programa=<programaId>&v=<hash>`

- Lee el comercio y, si viene `programa`, el programa **scopeado por `comercio_id`** (uno ajeno
  o inexistente → 404, no cae al comercio en silencio). Resuelve `brandingEfectivo` y compone la
  banda con `tipoTarjeta: 'puntos'`, `puntos: 0`, `selloMeta: null`, **`stripUrl: null`** (fuerza
  la banda de marca con la foto: la clase es de todos los clientes y no puede llevar el progreso
  de uno, y la franja personalizada queda afuera — decisión 5). Sin foto efectiva → 404.
  `Cache-Control: no-store`, como `hero.png`.
- **Esta ruta está en el camino crítico de la creación de la clase**: Google descarga la imagen al
  hacer `insert`/`patch`, y si falla o tarda, falla la sincronización entera (en el `insert`
  inicial, el comercio se queda sin Google Wallet hasta el próximo intento). Por eso se renderiza
  UNA sola escala y no tres: `stripPass` exporta `componerFranja(datos, escala)` (la función que
  `componerStrips` ya llama tres veces por dentro) y la ruta sirve la escala 3 (1125×369, el
  tamaño más cercano al recomendado de Google). La degradación a foto cruda cuando falta
  `NEXT_PUBLIC_BASE_URL` no cubre un fallo de esta ruta en producción; eso se vigila con
  `scripts/verificar-wallet.ts` como el resto de Google.
- `lib/google/heroUrl.ts` gana `urlFranjaClase(comercioId, programaId | null, version)`; null si
  falta `NEXT_PUBLIC_BASE_URL`, y en ese caso `syncClase`/`syncClasePrograma` mandan la foto cruda
  como hoy (degradación, no fallo).
- `syncClaseComercio` y `syncClasePrograma` leen las columnas que la banda dibuja (colores,
  difuminado, encuadre) para calcular la versión con `versionHero` (`puntos: 0`, `selloMeta:
  null`, `stripUrl: null`, igual que la ruta) y pasan a `construirClase` la URL compuesta cuando
  hay foto efectiva. `construirClase` no cambia.
- **Barrido de clases de programas al guardar la marca del negocio.** La imagen de clase de un
  programa con clase propia que HEREDA la foto ahora depende de ocho campos del negocio (foto,
  colores, difuminado, encuadre). `accionGuardarBranding` hoy solo llama `syncClaseComercio`;
  pasa a llamar además `syncClasePrograma` para cada programa del comercio con `google_class_id`
  (best-effort, en secuencia). Sin esto, cambiar el encuadre desde "Todas mis tarjetas" dejaría
  esas clases con el `?v=` viejo en Android. Prueba: con un programa con `google_class_id`, el
  guardado dispara su sync; sin `google_class_id`, no (una clase de Google no se crea por esto).
- Prueba de ruta (patrón de `hero.png/route.test.ts`, con `componerFranja` mockeado): dibuja con
  el branding efectivo del programa, fuerza banda de marca aunque el programa sea de sellos y
  aunque tenga franja personalizada, rechaza un `programa` de otro comercio, y 404 sin foto.

## Guardado

- `guardarBranding` (comercio): `DatosBranding` gana los cuatro campos; `validarEncuadre` antes
  del update; se escriben en `comercios`.
- `guardarBrandingPrograma`: `DatosBrandingPrograma` gana `encuadreFranja: Encuadre | null`
  (null = no tocar/heredar). `brandingProgramaDesdeFormulario` usa `encuadreDesdeFormulario`.
  `hayMarcaPropia` NO cambia: un encuadre propio solo existe con foto propia, y subir la foto ya
  enciende `branding_propio` (documentado en el código).
- `brandingDeProgramas` devuelve `encuadreFranja: Encuadre | null` vía `encuadreDelPrograma`.
- Server Actions: `accionGuardarBranding` y `accionGuardarBrandingDePrograma` leen
  `encuadre_franja`, `foco_franja_x`, `foco_franja_y`, `zoom_franja` del `FormData`.
- Pruebas: rechazo con mensaje por cada regla; persistencia; en programa, cuatro vacíos → null y
  la fila queda null; un solo vacío → error.

## Consumidores a barrer (lección del spec de branding por programa)

Todos los `select` que hoy traen `difuminado_franja` traen también las cuatro columnas nuevas y
pasan el encuadre a `brandingEfectivo`. Lista, por grep sobre `difuminado_franja` y sobre
`brandingEfectivo(`:
`lib/apple/datosPassDeTarjeta.ts`, `app/api/tarjetas/[tarjetaId]/hero.png/route.ts`,
`lib/google/syncObjeto.ts`, `lib/google/linkGuardar.ts`, `lib/google/syncClasePrograma.ts`,
`lib/google/syncClase.ts`, `lib/comercio/cartel/resolverDatosCartel.ts`,
`lib/comercio/guardarBrandingPrograma.ts`, `app/comercio/(protegido)/branding/page.tsx`, y
`lib/portal/buscarTarjetas.ts`, que llama `brandingEfectivo` con valores de relleno (ya pasa
`difuminadoFranja: 'medio'` porque el portal no dibuja la franja) y pasa `ENCUADRE_POR_DEFECTO`
con el mismo comentario. El tipo obligatorio en `BrandingBase` hace que el compilador señale el
que falte.

## Cartel imprimible (plantilla "foto")

- `DatosCartel` gana `encuadreFoto: Encuadre` y `medidasFoto: Medidas | null`.
  `resolverDatosCartel` mide la foto con sharp al bajarla (best-effort: null si falla) y pasa el
  encuadre efectivo. `combinarDatosCartel` NO ofrece override del encuadre (igual que no lo ofrece
  de la foto).
- `plantillaFoto`: con medidas, la foto va dentro de un `<svg>` anidado con
  `viewBox="x y ancho alto"` = `rectanguloVisible(foto, viewBox del cartel, encuadre)` y
  `preserveAspectRatio="none"` (la proporción del rectángulo es la del marco por construcción,
  así que no deforma), con un `<rect>` del color de fondo detrás para el modo `completa`. Sin
  medidas, el `xMidYMid slice` de hoy. El velo del 35% no cambia.
- La vista previa del cartel (`EditorCartel.tsx`) construye el mismo SVG en el navegador y hereda
  el cambio; solo se le pasan los dos campos nuevos.
- Prueba en `export.test.ts`: rasteriza la plantilla "foto" con una foto de dos colores y
  verifica que `focoY` 0 y 100 dejan colores distintos en el centro. Las pruebas de dimensiones
  no pueden atrapar una foto mal encuadrada.

## Editor (`FormularioBranding.tsx`, `page.tsx`, `SubidaImagen.tsx`)

- `FormularioBranding` recibe `tipoTarjeta` (y deriva `esSellos`), `urls.strip`, el encuadre
  inicial (`Encuadre | null` en programa) y `fotoPropia: boolean` (en programa: si tiene
  `hero_url` propio; en negocio: true si hay foto).
- **Bloque "Foto de fondo de la franja"** dentro del formulario de colores (es el único que
  publica), reemplazando el campo suelto de difuminado, que se muda adentro:
  - Encuadre: radio "Llenar (recorta)" / "Completa (sin recortar)".
  - Posición horizontal y vertical: `<input type="range" 0–100 step 1>`.
  - Zoom: `<input type="range" 100–300 step 5>` con el valor visible.
  - Difuminado: el `<select>` de hoy, con su `key` de remount intacta.
  - **Cuándo se VE:** hay foto efectiva, no hay franja personalizada y (en programa) la foto es
    propia. **Cuándo VIAJAN los cuatro campos:** siempre que haya foto propia — en negocio,
    siempre que haya foto; en programa, siempre que tenga `hero_url` propio — como inputs ocultos
    cuando el bloque no se ve. Son dos reglas distintas a propósito: si viajaran solo cuando se
    ven, un programa con foto propia y franja personalizada mandaría cuatro vacíos al publicar
    los colores, `encuadreDesdeFormulario` daría null y el guardado borraría el encuadre que el
    dueño ya había ajustado. Solo un programa SIN foto propia no manda los campos (→ null →
    hereda), y ahí un texto explica que el encuadre acompaña a la foto y se ajusta desde "Todas
    mis tarjetas". Con franja personalizada, una nota dice que la franja reemplaza a la foto.
- **Arrastre en la vista previa**: la franja captura el puntero (`setPointerCapture`,
  `touch-action: none`), calcula el delta contra el `getBoundingClientRect` del marco y usa
  `focoTrasArrastre` con las medidas naturales de la foto (`naturalWidth/Height` al `onLoad`).
  Hasta que la foto carga, se dibuja con `object-fit: cover` centrado y no se arrastra.
- **Vista previa fiel**: decisión 1. La foto se coloca con `colocarFoto` sobre un marco de
  375×123 unidades convertido a porcentajes del contenedor.
- **Etiquetas**: la franja personalizada dice "(reemplaza la grilla de sellos)" en sellos y
  "(reemplaza la foto de fondo)" en el resto. El resto de etiquetas no cambia.
- Verificación del pegamento con el DOM: no hay pruebas de componentes en el repo. Se verifica en
  el navegador contra el dev server del worktree (que sí tiene este código): posición de la
  `<img>` medida con `getBoundingClientRect` para dos focos, arrastre con eventos de puntero y
  lectura de los deslizadores, y que membresía no muestra contador.

## Fuera de alcance

- Zoom con la rueda del mouse o con pellizco.
- Encuadre distinto por tarjeta cuando la tarjeta hereda la foto del negocio (decisión 4).
- La orientación EXIF de fotos que no pasaron por el redimensionado del navegador (las mayores a
  1400 px se re-codifican con canvas, que ya la aplica).
- Tocar `textModulesData`/`linksModuleData` de Google o cualquier otra parte de la clase.

## Orden de trabajo

0. `lib/tarjetas/frentePase.ts` + `generatePass` consumiéndolo (las pruebas de `generatePass`
   existentes son la red).
1. Módulo puro + pruebas de mutación.
2. Migración 0032, `types.ts`, `verificar-0032.ts`; el usuario aplica el SQL.
3. `brandingEfectivo` + herencia; `versionHero`.
4. Guardado (comercio y programa) + Server Actions.
5. Composición: `stripPass`, `datosPassDeTarjeta`, `hero.png`, `syncObjeto`, `linkGuardar`.
6. Ruta `franja.png` + `syncClase`/`syncClasePrograma`.
7. Cartel.
8. Editor y vista previa; verificación en navegador.
9. Estado del proyecto (`ESTADO-Y-PLAN`), commit.

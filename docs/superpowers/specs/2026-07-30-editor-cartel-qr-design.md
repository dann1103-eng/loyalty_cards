# Editor de cartel/QR para mesas y mostrador — diseño

**Fecha:** 2026-07-30
**Estado:** aprobado por el usuario (decisiones §10), validado con mockups en el companion de
brainstorming (`estilos-plantilla.html`, `estilos-sticker.html`, `editor-libertad.html`).

## 1. Problema

Cada comercio necesita imprimir algo físico —un sticker de mesa, un cartel de mostrador— con un QR
que el cliente escanea para afiliarse. Ese QR **ya existe**: `programas/page.tsx:33-35` lo genera con
`QRCode.toDataURL` apuntando a `/registro/{comercio.slug}[/{programa.slug}]` y lo muestra en pantalla,
pero no hay nada diseñado alrededor — el dueño tendría que armar su propio cartel a mano en otra
herramienta, sin usar el logo ni los colores que ya cargó en su editor de marca.

## 2. Alcance y decisiones tomadas

Todo lo siguiente se decidió con el usuario, con mockups reales de por medio (companion de
brainstorming):

1. **Un cartel por PROGRAMA, no por comercio.** Un comercio con dos programas activos (p. ej. Sellos y
   Puntos) diseña y descarga un cartel distinto para cada uno, cada uno con el QR de SU programa.
2. **Plantillas configurables, no un lienzo libre tipo Canva.** Tres plantillas prearmadas —
   *Centrado*, *Split* (franja lateral en mostrador, franja arriba/abajo en sticker) y *Foto de
   fondo* — donde el comercio solo ajusta color, logo y texto. Nada de mover/redimensionar elementos a
   mano.
3. **Reusa el logo y los 3 colores de marca por defecto, pero se pueden personalizar solo para el
   cartel.** Los campos de color/logo del cartel nacen en `null` (= heredar de `comercios`) y el
   comercio los puede pisar explícitamente.
4. **Dos formatos de salida:** sticker cuadrado ~10×10cm y cartel de mostrador A5 vertical. Ambos en
   PNG y PDF.
5. **Texto configurable:** nombre del comercio (fijo, viene de `comercios.nombre`), un CTA editable
   (default `¡Escaneá y sumate!`) y una segunda línea OPCIONAL de teaser (p. ej. "Tu 5to café gratis").
6. **Vive dentro de Programas**, como un link "Diseñar cartel" por programa activo — no es una entrada
   nueva del nav inferior (que ya no tiene espacio libre, ver el precedente de
   `docs/superpowers/plans/2026-07-25-panel-movil-contexto-sucursales.md`).

## 3. Modelo de datos — migración 0026

Última migración en el repo: `0025_backfill_programas_principales_faltantes.sql`. `0026` es el número
libre.

```sql
create table disenos_cartel (
  id uuid primary key default gen_random_uuid(),
  programa_id uuid not null unique references programas_tarjeta(id) on delete cascade,
  -- Denormalizado a propósito, mismo motivo que en otras tablas del proyecto: permite scopear/filtrar
  -- por comercio sin un join, y el índice de abajo lo aprovecha.
  comercio_id uuid not null references comercios(id) on delete cascade,

  plantilla text not null default 'centrado' check (plantilla in ('centrado', 'split', 'foto')),

  -- Los tres NULOS por defecto = "heredar de comercios.color_fondo/color_texto/color_label". Un valor
  -- no nulo es una personalización explícita solo para este cartel.
  color_fondo text,
  color_texto text,
  color_label text,
  logo_url text,

  texto_cta text not null default '¡Escaneá y sumate!' check (btrim(texto_cta) <> ''),
  texto_teaser text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index disenos_cartel_comercio_idx on disenos_cartel (comercio_id);

alter table disenos_cartel enable row level security;
-- Sin políticas = deny-all para anon/authenticated, igual que programas_tarjeta (0024). Todo acceso
-- pasa por Server Actions con createServiceClient(), gateadas por verifyComercioOwner().
```

**No hay backfill.** La ausencia de fila para un `programa_id` significa "sin personalizar" — la
pantalla calcula los valores por defecto en memoria (plantilla `centrado`, colores/logo heredados,
`texto_cta` por defecto, sin teaser) sin escribir nada. **Recién se inserta una fila cuando el dueño
guarda el editor por primera vez.** Esto evita filas vacías para los programas que nadie personaliza —
la mayoría, probablemente.

**`lib/supabase/types.ts` se actualiza en el mismo commit** que la migración (`Row`/`Insert`/`Update`
de `disenos_cartel`), siguiendo el precedente de todas las migraciones anteriores.

**La migración la aplica el usuario a mano** en Supabase Studio (regla del proyecto). Se entrega el
`.sql`, se verifica después con un script de solo lectura (`scripts/verificar-0026.ts`, mismo patrón
que `verificar-0015.ts` de la Tanda 1).

## 4. Renderizado — una función pura, dos consumidores

`lib/comercio/cartel/plantillas.ts` expone:

```ts
construirCartelSvg(datos: DatosCartel, formato: 'sticker' | 'mostrador'): string
```

Sin `fetch`, sin Supabase, sin DOM — recibe todo ya resuelto y devuelve un string `<svg>...</svg>`.
Esta MISMA función corre en dos lugares:

- **En el navegador**, para la vista previa en vivo del editor (sin round-trip al servidor mientras el
  dueño cambia color/texto/plantilla).
- **En el servidor**, al exportar PNG/PDF.

Así lo que se ve en pantalla es, por construcción, idéntico a lo que se descarga.

```ts
interface DatosCartel {
  nombreComercio: string;
  plantilla: 'centrado' | 'split' | 'foto';
  colorFondo: string;
  colorTexto: string;
  colorLabel: string;
  logoDataUri: string | null;   // ver §4.1 — NUNCA una URL remota
  fotoDataUri: string | null;   // ídem, solo se usa si plantilla === 'foto'
  textoCta: string;
  textoTeaser: string | null;
  urlRegistro: string;
}
```

### 4.1 Por qué las imágenes viajan como `logoDataUri`, no como URL

Un renderizador SVG del lado servidor (lo que usa `sharp`/libvips para rasterizar) **no está
garantizado que resuelva referencias externas** (`<image href="https://...">`) — por política de
seguridad, muchos rechazan o simplemente no cargan URLs remotas al rasterizar, a diferencia del
navegador. Depender de eso significaría que el cartel se ve bien en la vista previa (el navegador SÍ
carga la URL) pero **el logo desaparece silenciosamente en el PNG/PDF exportado** — exactamente el
tipo de fallo silencioso que este proyecto trata como inaceptable (ver el trap documentado en
`docs/superpowers/specs/2026-07-26-reverso-tarjeta-configurable-design.md §3`, mismo patrón de riesgo).

La solución **se resuelve en la arquitectura, no se prueba y se espera que funcione**: el logo/foto se
descargan UNA vez (como bytes) y se convierten a `data:` URI ANTES de llegar a `construirCartelSvg`,
tanto del lado cliente como del servidor. La función pura entonces **jamás** ve una URL remota — solo
`logoDataUri`/`fotoDataUri` ya resueltos, o `null`. La conversión ocurre una sola vez por carga de
pantalla (o al cambiar el logo), no en cada tecla.

### 4.2 El QR

`QRCode.toString(datos.urlRegistro, { type: 'svg', margin: 0, color: { dark: '#000000', light:
'#ffffff' } })` — API verificada en `node_modules/qrcode/lib/server.js:93-97`, que delega en
`lib/renderer/svg.js`. **El QR siempre se pinta en negro puro sobre blanco puro, nunca con los colores
de marca del comercio** — es una decisión deliberada de escaneabilidad, no un descuido: un QR en tonos
pastel puede fallar en cámaras baratas bajo mala luz, que es exactamente el escenario de un mostrador.
El SVG que devuelve `qrcode` se anida tal cual dentro de un `<svg>` contenedor posicionado (SVG anidado
es válido) — no se pasa por PNG intermedio, se queda vectorial hasta el rasterizado final.

### 4.3 Texto: escapado obligatorio

`nombreComercio`, `textoCta` y `textoTeaser` son texto libre que termina interpolado dentro de
elementos `<text>` del SVG. **Se escapan `&`, `<`, `>`, `"`, `'` antes de interpolar** — mismo
requisito que ya estableció `docs/superpowers/specs/2026-07-26-reverso-tarjeta-configurable-design.md
§7.1` para HTML. Sin esto, un nombre de comercio con `&` rompe el XML del SVG entero (pantalla en
blanco en la vista previa) y un `<` malicioso podría inyectar markup dentro de la vista previa que se
renderiza con `dangerouslySetInnerHTML`.

### 4.4 Las 3 plantillas × 2 formatos

Cada plantilla es una función `(datos, formato) => string` que arma el layout con coordenadas
relativas a un `viewBox` fijo por formato (p. ej. `0 0 400 400` para sticker, `0 0 400 566` para
mostrador — proporción A5). El "Split" es la única que cambia de orientación entre formatos (franja
lateral en mostrador, franja superior en sticker) — el resto del layout escala igual.

## 5. Exportación

### 5.1 Tamaños reales

| Formato | Medida física | Píxeles a 300dpi | Puntos PDF (72pt/in) |
|---|---|---|---|
| Sticker | 10×10cm | 1181×1181 | 283×283 |
| Mostrador | A5 (148×210mm) | 1748×2480 | 419.53×595.28 |

### 5.2 PNG

`sharp(Buffer.from(svg)).resize(anchoPx, altoPx).png().toBuffer()` — `sharp` rasteriza el SVG y lo
escala al tamaño de destino en un solo paso (no hace falta fijar `density` a mano). Sin dependencia
nueva: `sharp` ya está en `package.json:36`.

### 5.3 PDF — `pdf-lib` (dependencia nueva, aprobada por el usuario)

Se genera el MISMO PNG que en §5.2 y se embebe como imagen única ocupando toda la página, del tamaño
físico exacto de la tabla de arriba:

```ts
const pdf = await PDFDocument.create();
const pagina = pdf.addPage([anchoPt, altoPt]);
const png = await pdf.embedPng(bufferPng);
pagina.drawImage(png, { x: 0, y: 0, width: anchoPt, height: altoPt });
```

**Por qué un PNG embebido y no texto vectorial con las fuentes de `pdf-lib`:** las fuentes estándar de
`pdf-lib` (Helvetica, etc.) no traen instalada la tipografía de marca (Outfit/Hanken Grotesk), y
mezclar "vista previa con la fuente real" + "PDF con Helvetica" rompería la garantía de §4 de que
"lo que ves es lo que descargás". Con un PNG único, el PDF es pixel-idéntico a la vista previa y al
PNG exportado — misma garantía, un solo camino de renderizado.

**Por qué no Playwright** (que ya se usó para el folleto en
`C:\Users\Daniel\AppData\Local\Temp\claude\...\scratchpad\folleto\render.js`): ahí era un script de
un solo uso, corrido a mano. Acá cada descarga es una request real de producción — levantar un
Chromium completo por descarga en una función serverless de Vercel es lento, pesado en memoria, y
generalmente cuesta agrandar el bundle de la función con el binario de Chromium. `pdf-lib` es JS puro,
sin binario nativo, y no tiene ese costo.

### 5.4 La ruta

`app/comercio/(protegido)/programas/[id]/cartel/descargar/route.ts` — `GET`, con query params
`?formato=sticker|mostrador&tipo=png|pdf`. `verifyComercioOwner()` primero y fuera de cualquier
try/catch (lanza `NEXT_REDIRECT`). Resuelve `DatosCartel` (§6), llama a `construirCartelSvg`, rasteriza
y responde con `Content-Type` (`image/png` o `application/pdf`) y `Content-Disposition: attachment;
filename="cartel-{programa.slug}-{formato}.{ext}"`.

## 6. UI y flujo

### 6.1 Dónde se edita

En `/comercio/programas`, cada programa activo ya lista su QR (`programas/page.tsx:80` en adelante) —
debajo se agrega un link `Diseñar cartel` que lleva a
`app/comercio/(protegido)/programas/[id]/cartel/page.tsx`.

### 6.2 Refactor pequeño, en el mismo trabajo: extraer la URL de registro

Hoy la URL `/registro/{slug}[/{slug}]` se arma DOS VECES por separado —
`app/comercio/(protegido)/panel/page.tsx:71` (solo programa principal) y
`app/comercio/(protegido)/programas/page.tsx:29-31` (por programa) — cada una con su propio
`NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '')`. El cartel necesita la misma URL una tercera vez. Se extrae
`lib/comercio/urlRegistroPrograma.ts` con una única función pura, y las tres consumen esa — mejora
dirigida al código existente que ya tocaba este trabajo, no un refactor por su cuenta.

### 6.3 La pantalla del editor

Server Component que carga programa + comercio (colores/logo/`hero_url`) + fila de `disenos_cartel`
(o los defaults en memoria si no existe, §3), resuelve `logoDataUri`/`fotoDataUri` (§4.1) en el
servidor para el primer render sin parpadeo, y pasa todo a un Client Component `EditorCartel.tsx`:

- 3 tarjetas clicables para elegir plantilla (igual que en el companion).
- Toggle **"Usar mi logo y colores de marca"**, ON por defecto. Al apagarlo aparecen 3 `<input
  type="color">` (precargados con los valores actuales de la marca, no en blanco) y una subida de
  logo propia.
- La subida de logo reusa exactamente el patrón de `rutaImagenRecompensa` (`lib/comercio/
  imagenComercio.ts:54-56`, comercio + entidad hija dentro del mismo bucket): se agrega
  `rutaImagenCartel(comercioId, programaId, ext)` → `{comercioId}/carteles/{programaId}.{ext}`, mismo
  bucket `comercio-imagenes`, misma validación (`validarImagenSubida`, 2MB, png/jpg/webp). Acciones
  `accionSubirLogoCartel(programaId, …)` / `accionQuitarLogoCartel(programaId, …)`, calcadas de
  `accionSubirFotoRecompensa`/`accionQuitarFotoRecompensa` (`app/comercio/(protegido)/recompensas/
  actions.ts:74-138`).
- Input de texto para el CTA (con el default, editable) y uno opcional para el teaser.
- Selector Sticker/Mostrador que cambia la vista previa en vivo.
- Botones **Descargar PNG** / **Descargar PDF** — enlaces directos a la ruta de §5.4 con el formato y
  tipo correspondientes (no hace falta JS para la descarga en sí, un `<a href>` alcanza).

**Al apagar el toggle de personalización, los overrides se BORRAN (se guardan como `null`), no quedan
ocultos.** Si el dueño vuelve a encenderlo después, los selectores se recargan desde la marca actual
del comercio, nunca desde un valor viejo escondido — evita el estado fantasma de "¿por qué mi cartel
tiene un color que no configuré en ningún lado visible?".

### 6.4 Guardado

`accionGuardarCartel(programaId, _estadoPrevio, formData)` seguiría el patrón de
`accionGuardarBranding` (`app/comercio/(protegido)/branding/actions.ts:24-55`): `verifyComercioOwner()`
primero, `upsert` sobre `disenos_cartel` con `programa_id`/`comercio_id` del gate y de la ruta —
**nunca del formulario** —, `revalidatePath`. **No llama a `notificarCambioComercio` ni a
`syncClaseComercio`/`syncObjetosComercio`**: el cartel no toca el `.pkpass` ni el pase de Google en
absoluto, es un documento aparte para imprimir. Confirmado revisando que ninguna columna de
`disenos_cartel` se lee en `lib/apple/generatePass.ts` ni en `lib/google/construirRecursos.ts`.

## 7. Errores y degradación

- Si `logo_url`/`hero_url` del comercio no existen (comercio nuevo, sin subir nada), la plantilla
  "Centrado"/"Split" se arma sin logo (un placeholder simple con la inicial del nombre) y la "Foto de
  fondo" **no debería ofrecerse como opción** si no hay `hero_url` — se deshabilita esa tarjeta con una
  nota, en vez de generar un cartel con fondo roto.
- Si falla la descarga de bytes del logo/foto para convertir a `data:` URI (red, archivo borrado del
  bucket), el cartel se arma igual sin esa imagen — best-effort, mismo criterio que el resto del
  branding (nunca bloquear la descarga por una imagen faltante).
- Si el programa está desactivado, la pantalla de edición sigue siendo accesible (el dueño puede
  querer archivar el diseño), pero se muestra un aviso: el QR de un programa desactivado ya no
  registra clientes (mismo caso ya documentado en `programas/page.tsx:23-25`) — un cartel ya impreso
  con ese QR queda muerto. No bloqueante, solo informativo.

## 8. Pruebas

- **`construirCartelSvg` (pura)** — las 3 plantillas × los 2 formatos producen un SVG bien formado
  (parseable) con el QR embebido; el texto se escapa correctamente (`&`, `<`, `"`); un nombre de
  comercio largo no rompe el layout (wrap o clamp, a definir en implementación); sin logo, no revienta.
- **Resolución de overrides** — con fila en `disenos_cartel`: los campos no-nulos ganan sobre los de
  `comercios`; con fila pero campos nulos, y sin fila en absoluto, el resultado es idéntico (hereda
  todo de `comercios`). Esta es la parte con más superficie de bug silencioso — mostrarle a un
  comercio el logo o color de otro sería el peor caso posible.
- **Export** — que el PNG resultante tenga exactamente las dimensiones en píxeles de la tabla de §5.1
  para cada combinación formato×tipo; que el PDF tenga el `MediaBox` del tamaño en puntos esperado.
- **Mutation-testing obligatorio** sobre: la lógica override-vs-heredado, el escapado de texto, y que
  el QR siempre use negro/blanco fijo (romper esa línea y confirmar que una prueba con colores de
  marca "raros" para el QR falla).
- **Prueba manual real, con el controlador:** descargar un PNG y un PDF de cada formato e imprimirlos
  (o verlos a tamaño real en pantalla) para confirmar que el QR sigue siendo escaneable — el error más
  fácil de cometer (margen insuficiente, resolución baja) y el más caro de descubrir después de
  imprimir un lote de stickers.

## 9. Fuera de alcance

- Editor de posición libre (decidido explícitamente que no).
- Formato "Carta" para el mostrador — la arquitectura de §5.1 lo soporta agregando una fila a la
  tabla de tamaños; no se ofrece en el selector de v1 porque no se pidió.
- Variantes de idioma o moneda.
- Cualquier cambio al `.pkpass`/pase de Google — el cartel es un documento de impresión aparte.
- Reimprimir o avisar automáticamente cuando un programa con cartel diseñado se desactiva — solo el
  aviso pasivo de §7.

## 10. Decisiones registradas

1. **Un cartel por programa**, no uno por comercio — cada programa activo tiene su propio QR y su
   propio diseño.
2. **Plantillas configurables, no editor libre** — menor superficie de construcción, mayor velocidad
   de entrega, y el resultado con plantillas curadas ya se ve profesional (validado con mockups).
3. **Reusa por defecto, personalizable por cartel** — los overrides nacen en `null` y se pueden pisar;
   apagar la personalización los borra en vez de dejarlos ocultos.
4. **El QR es siempre negro sobre blanco**, nunca temático — prioridad de escaneabilidad sobre estética
   en ese elemento puntual.
5. **PNG y PDF para los dos formatos**, generados desde el mismo SVG y sin Chromium de por medio
   (`pdf-lib`, dependencia nueva aprobada).
6. **Las imágenes viajan como `data:` URI dentro de la función de renderizado**, nunca como URL remota
   — evita que el renderizador SVG del servidor pierda el logo en silencio.

# El frente del pase como los diseños, el apellido y tres modelos en la portada — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el pase real (Apple, Google y la vista previa del editor) tenga el orden de los diseños de Daniel —estado arriba a la derecha, franja limpia, NOMBRE y APELLIDO, "Powered by Cardly" bajo el QR—, pedir el apellido al registrarse, y sumar los tres modelos a la portada.

**Architecture:** Un solo módulo puro (`frentePase`) decide qué va en cada lugar y lo consumen las dos billeteras y las vistas previas. Google se despliega en dos pasos (objetos, después la plantilla de la clase) para que ninguna tarjeta quede con filas vacías.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase (DDL a mano por el usuario), passkit-generator, googleapis walletobjects v1, vitest.

**Spec:** `docs/superpowers/specs/2026-09-17-frente-del-pase-como-los-disenos-design.md` — manda sobre este plan si difieren. Leé las decisiones 1 a 10, la tabla del frente y la tabla de franjas antes de cualquier tarea.

**Estado de la base:** la **0036 YA ESTÁ APLICADA y verificada** (`scripts/verificar-0036.ts`) y `lib/supabase/types.ts` ya declara `clientes.apellido`.

**Assets:** `public/_inicio/tarjeta-membresia.webp`, `tarjeta-gift-card.webp` y `tarjeta-descuento.webp` ya están convertidos (sin commitear): los commitea la Task 7.

---

## Reglas para TODAS las tareas

- **Checkout:** `C:\Users\Daniel\Desktop\Proyectos\Loyalty Cards\.claude\worktrees\brand-editor-preview-adjustments-e82e88`, rama `claude/brand-editor-preview-adjustments-e82e88`. Verificalo con `git -C "<ruta>" branch --show-current` ANTES de tocar nada; prefijá cada comando con `cd "<ruta>" &&` y usá rutas absolutas.
- **Español** en identificadores, comentarios y textos. El panel del dueño **vosea**; lo que lee el cliente final (registro) tutea, como ya hace `RegistroCliente.tsx`.
- **TDD con mutación** en toda rama crítica: rompé la línea que la prueba protege, confirmá que FALLA por la razón correcta, restaurá, y anotá la mutación en la prueba. Asertá mensajes exactos.
- **Nunca toques Google ni Apple reales** (mockeá `walletClient` y APNs como hacen las pruebas existentes). **No inicies el dev server.** **No crees clases de Google.**
- **No corras la suite COMPLETA** (hay subagentes en paralelo sobre una sola BD). Corré solo tus archivos: `npx vitest run <rutas>`.
- **Commits por pathspec** (`git commit -m … -- <tus rutas>`; `git add` solo para archivos nuevos o renombrados), nunca `git add -A`. Identidad: `git -c user.name="Daniel" -c user.email="268727888+dann1103-eng@users.noreply.github.com" commit -m "<titulo sin tildes>" -m "<cuerpo>" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- <rutas>`.
- `npx tsc --noEmit` limpio **en tus archivos** al cerrar. Entre la Task 1 y las de la ola 2, los consumidores de `frentePase` quedan rojos a propósito: cada uno lo arregla su tarea.

## Olas

- **Ola 1 (en paralelo):** Task 1 (`frentePase`), Task 6 (dónde se ve el apellido), Task 7 (portada), Task 8 (script de Google).
- **Ola 2 (en paralelo, después de la Task 1):** Task 2 (registro), Task 3 (Apple), Task 4 (objetos de Google), Task 5 (vistas previas).
- **Controlador:** Task 10 (suite, navegador, deploy A, fase objetos).
- **Después del deploy A y de la fase objetos con 0 fallos:** Task 9 (plantilla de la clase) → deploy B → fase clases.

---

### Task 1: `frentePase` con los lugares de los diseños

**Files:** `lib/tarjetas/frentePase.ts`, `lib/tarjetas/frentePase.test.ts`, `lib/tarjetas/vigencia.ts` (+ `lib/tarjetas/formatearFecha.test.ts` o un test nuevo).

Leé entero `frentePase.ts`, `contadorPase.ts` y `describirSaldo`/`sigueVigente` en `tipos.ts` antes de empezar.

- [ ] **`formatearFechaCorta(iso: string): string`** en `vigencia.ts`: `'2026-10-16'` (o un timestamp que empiece así) → `'16/10/2026'`, por recorte de los primeros 10 caracteres, sin `Date`. Prueba del formato y de que con `process.env.TZ` de América no corre el día (mirá cómo lo hace `formatearFecha.test.ts`).
- [ ] **El contrato nuevo** (spec, "El contrato de `frentePase`"): exportar `type Franja = 'propia' | 'grilla' | 'banda'` y `interface FrentePase { estado; sobreFranja; titular; listado }`. **Eliminar** `primario`, `secundario` y `encabezado`. Entradas: las de hoy **sin** `hayGrilla`, **más** `franja: Franja`, `nombreCliente: string | null`, `apellidoCliente: string | null` — todas obligatorias.
- [ ] **`estado`**, exactamente la tabla del spec:
  - tipos con contador → `contadorPase` (ya da `SELLOS 7 de 10`, `SALDO $50.00`, `PUNTOS` con `numero`, `VISITAS`; null en descuento);
  - **cupón**: usado → `CUPÓN · Usado` (USADO GANA aunque tenga fecha); sin fecha → `CUPÓN · Disponible`; vigente (`sigueVigente`, el último día cuenta) → `VÁLIDO HASTA · dd/mm/aaaa`; vencido → `VENCIÓ EL · dd/mm/aaaa`;
  - **membresía**: sin fecha → `MEMBRESÍA · Sin activar`; vigente → `VÁLIDO HASTA`; vencida → `VENCIÓ EL` (`usadoEn` se ignora, como en `describirSaldo`);
  - la fecha SIEMPRE con `formatearFechaCorta`; `numero: null` en todos los estados con fecha.
  - Las etiquetas "sin fecha" / "usado" salen de una **tabla por tipo** (solo `membresia` y `cupon`); `VÁLIDO HASTA` y `VENCIÓ EL` son comunes. Un tipo con `usaVigencia` que no esté en la tabla NO hereda "MEMBRESÍA": prueba que recorra `TIPOS` con `usaVigencia` y exija que estén en la tabla.
- [ ] **`sobreFranja`** = nombre del pase recortado (blanco → null) **solo si `franja === 'banda'`**; null en `'propia'` y `'grilla'`.
- [ ] **`titular`**: nombre recortado; sin nombre → `null` (aunque haya apellido); apellido recortado, blanco → `null`.
- [ ] **`listado`**: SIN CAMBIOS respecto de hoy (sellos con meta `"7 de 10 sellos"`; cupón/membresía con la frase larga de `describirSaldo` y etiqueta `CUPÓN`/`MEMBRESÍA`; resto `contadorPase`). Hoy no depende de la grilla; que siga sin depender.
- [ ] **`PIE_CODIGO`**: constante exportada con `'Powered by Cardly'`. Si `lib/marca.ts` expone el nombre de la marca, armala con eso; si no, literal.
- [ ] **Pruebas**: reescribí `frentePase.test.ts` sobre el contrato nuevo cubriendo CADA fila de la tabla del spec, el último día y el día siguiente, cupón usado con fecha, `sobreFranja` en los tres estados, titular (con/sin apellido, blancos, apellido sin nombre) y el recorrido de `TIPOS`. Conservá las pruebas de `listado` que ya existen.
- [ ] **Mutaciones obligatorias** (literales en tu reporte): (a) `sobreFranja` también en `'propia'`; (b) `formatearFecha` en vez de `formatearFechaCorta`; (c) en cupón, evaluar la fecha antes que `usadoEn`; (d) `>` en vez de `sigueVigente` (el último día).
- [ ] Commit (tsc va a quedar rojo en Apple, Google y las vistas previas: es esperado).

---

### Task 2: El apellido en el registro

**Files:** `lib/clientes/registrarCliente.ts` (+test), `app/api/registro/route.ts` (+ su prueba si existe), `app/registro/[comercioSlug]/RegistroCliente.tsx`, `lib/comercio/altaPorTelefono.ts` (+test), `app/comercio/(protegido)/clientes/agregar/actions.ts`, `app/comercio/(protegido)/clientes/agregar/FormularioAgregarCliente.tsx`, `scripts/seed-demo-comercios.ts`, `lib/tarjetas/tiposFuncionales.test.ts`, `e2e/registro.spec.ts`. Depende de la Task 1 (por la réplica de `RegistroCliente`).

- [ ] **`registrarCliente(supabase, comercioId, programaId, nombre, apellido, telefono)`**: `apellido: string | null` obligatorio en la firma, recibido YA limpio. Se inserta SOLO al crear el cliente (`insert({ nombre, apellido, telefono })`); un cliente existente NO se actualiza (decisión 6). Actualizá TODOS los llamadores (grep `registrarCliente(`).
- [ ] Pruebas en `registrarCliente.test.ts`: (1) cliente nuevo guarda el apellido; (2) **cliente existente sin apellido que se registra en otro programa con apellido: el apellido sigue null** — MUTACIÓN: completarlo si está vacío tiene que hacer fallar esta prueba; (3) nuevo con `apellido: null` guarda null.
- [ ] **Ruta `/api/registro`**, espejo exacto del nombre: `typeof apellido !== 'string' || !apellido` → 400 `'Faltan datos'`; recortado vacío o `> 120` → 400 `'Apellido inválido'`. Pasa el recortado a `registrarCliente`. Si la ruta tiene prueba, agregá los dos casos; si no tiene, sacá la validación a una función pura probada (mismo criterio que el nombre).
- [ ] **`RegistroCliente.tsx`**: estado `apellido`; campo "Apellido" debajo de "Nombre" (`id="apellido"`, `placeholder="Tu apellido"`, `autoComplete="family-name"`, `required`, `maxLength={120}`); "Nombre" pasa a `autoComplete="given-name"` y `maxLength={120}`; el body del fetch suma `apellido`. La réplica chica que llama a `frentePase` (hoy usa `primario`, ~líneas 63-66 y 94-104) pasa a usar `estado`, con `franja: 'banda'`, `nombreCliente: null`, `apellidoCliente: null`.
- [ ] **Alta por teléfono** (`altaPorTelefono.ts` + `agregar/actions.ts` + `FormularioAgregarCliente.tsx`): `apellido` OPCIONAL. `altaPorTelefono` recorta; vacío → `null`; más de 120 → `{ ok: false, error: 'El apellido puede tener hasta 120 caracteres.' }` SIN llamar a `registrarCliente`. El formulario: campo "Apellido (opcional)" con `maxLength={120}`, sin `required`. Pruebas: apellido vacío → cliente con `apellido` null (no `''`, que rompería con 23514); 121 caracteres → el mensaje exacto y ningún cliente creado.
- [ ] `seed-demo-comercios.ts` y `tiposFuncionales.test.ts`: pasá un apellido o `null` (decidí por caso).
- [ ] `e2e/registro.spec.ts`: completá el apellido (`page.getByLabel('Apellido').fill(...)`). No lo corras (Playwright levanta el servidor); solo dejalo coherente.
- [ ] Commit.

---

### Task 3: Apple

**Files:** `lib/apple/generatePass.ts`, `lib/apple/generatePass.test.ts`, `lib/apple/datosPassDeTarjeta.ts` (+test), `lib/apple/pesoPass.test.ts`. Depende de la Task 1.

- [ ] `DatosPass` suma `apellidoCliente: string | null` (junto a `nombreCliente`, con comentario). `datosPassDeTarjeta` lee `clientes(nombre, apellido)`; su prueba verifica los dos.
- [ ] **La franja** (spec, tabla de franjas): `'propia'` si `datos.stripUrl && strips !== null`; `'grilla'` si es sellos con meta `> 0`, sin `stripUrl` y `strips !== null`; `'banda'` en el resto. Reemplaza el cálculo de `hayGrilla`.
- [ ] **Campos**: `estado` → `headerFields` `{ key: 'estado', label, value }` con `numberStyle: 'PKNumberStyleDecimal'` y valor numérico cuando `numero !== null` (mismo criterio que hoy tiene el primario); `sobreFranja` → `primaryFields` `{ key: 'nombre_pase', value }`; `titular` → `secondaryFields` `{ key: 'nombre', label: 'NOMBRE', value }` y, si hay apellido, `{ key: 'apellido', label: 'APELLIDO', value, textAlignment: 'PKTextAlignmentRight' }`. Borrá los campos viejos (`nombre_pase` en header, `puntos` en primary/secondary, `titular`). Reescribí los comentarios que describen el orden viejo.
- [ ] **Código de barras**: `pass.setBarcodes({ format: 'PKBarcodeFormatQR', message: datos.qrToken, messageEncoding: 'iso-8859-1', altText: PIE_CODIGO })`. Verificá en `node_modules/passkit-generator` que la firma con objeto es la correcta para la versión instalada.
- [ ] **Pruebas** (leé el `.pkpass` generado como hacen las existentes): membresía vigente (header `VÁLIDO HASTA` / `16/10/2026`, sin primary si hay franja propia), gift card (`SALDO`), puntos (`numberStyle`), sellos con grilla (primary vacío), banda lisa con nombre de pase (primary `nombre_pase`), descuento (sin header), titular con y sin apellido, **exactamente 1** código con `format` QR, `message` = token y `altText` = `PIE_CODIGO`. **Franja propia que no bajó**: con `stripUrl` y `componerStrips` devolviendo null (mockeado o URL inválida), el primary lleva el nombre del pase.
- [ ] **Mutaciones**: (a) `'propia'` solo por `stripUrl` (sin `strips !== null`) → falla la de la franja que no bajó; (b) quitar `altText` → falla la del código; (c) invertir la alineación del apellido.
- [ ] `pesoPass.test.ts`: agregá `apellidoCliente` al objeto literal y confirmá que sigue verde.
- [ ] Commit.

---

### Task 4: Los objetos de Google

**Files:** `lib/google/construirRecursos.ts` (+test), `lib/google/heroUrl.ts` (+test), `lib/google/syncObjeto.ts` (+test), `lib/google/linkGuardar.ts` (+test). Depende de la Task 1. **NO toques `construirClase`** (eso es la Task 9, después del deploy A).

- [ ] **`TarjetaParaObjeto`** suma `nombreCliente: string | null`, `apellidoCliente: string | null` y `stripUrl: string | null` (crudo). La franja se resuelve DENTRO de `construirObjeto`: `'propia'` si `stripUrl && heroImageUrl`; `'grilla'` si sellos con meta, sin `stripUrl` y con `heroImageUrl`; `'banda'` en el resto.
- [ ] **`heroImage`** cuando la franja es `'grilla'` o `'propia'` (decisión 8 del spec).
- [ ] **`textModulesData`**, en este orden y cada uno solo si su dato existe: `{ id: 'nombre_pase', header: 'Tarjeta', body: sobreFranja }`, `{ id: 'estado', header: estado.etiqueta, body: estado.valor }`, `{ id: 'nombre', header: 'NOMBRE', body }`, `{ id: 'apellido', header: 'APELLIDO', body }`. **Mandalo SIEMPRE, aunque quede `[]`**: el sync hace `patch`, y un campo omitido en un patch deja en Google los módulos viejos (un nombre de pase borrado seguiría viéndose). Prueba que fije `[]`.
- [ ] **`barcode`**: `{ type: 'QR_CODE', value: qrToken, alternateText: PIE_CODIGO }`.
- [ ] `loyaltyPoints` (desde `listado`) y `validTimeInterval`: sin cambios; sus pruebas siguen verdes.
- [ ] **`versionHeroTarjeta(marca, puntos, selloMeta)`** en `heroUrl.ts`: si `marca.stripUrl`, llama a `versionHero` con `puntos: 0, selloMeta: null`; si no, con los reales. Reemplazá las llamadas a `versionHero` de `syncObjeto.ts` y `linkGuardar.ts` por este ayudante. Prueba: con franja propia, dos puntajes distintos dan la MISMA versión; sin franja propia, distinta. MUTACIÓN: pasar los puntos reales con franja propia.
- [ ] `syncObjeto.ts` y `linkGuardar.ts`: leen `clientes(nombre, apellido)` y pasan `nombreCliente`, `apellidoCliente` y `stripUrl: marca.stripUrl` a `construirObjeto`. Sus pruebas verifican que el cuerpo mandado lleva los módulos (mockeando `walletClient`).
- [ ] **Pruebas de `construirRecursos.test.ts`**: módulos por caso (membresía con nombre de pase y banda; gift card con franja propia → sin `nombre_pase`, con `heroImage`; descuento sin estado; cliente sin apellido), `alternateText`, `[]` sin datos. **Mutaciones**: (a) hero solo en `'grilla'` → falla la gift card con franja propia; (b) omitir `textModulesData` cuando está vacío → falla la del `[]`.
- [ ] Commit.

---

### Task 5: Las vistas previas

**Files:** `app/comercio/(protegido)/branding/FormularioBranding.tsx`, `app/admin/(protegido)/comercios/FormularioComercio.tsx`. Depende de la Task 1.

No hay pruebas de componente en este repo: el controlador mide en el navegador. Mantené el markup simple y con estilos inline como el resto del archivo.

- [ ] **`FormularioBranding.tsx`** (réplica ~líneas 285-532):
  - `frentePase` con `franja`: `'propia'` si `urls.strip`; `'grilla'` si sellos con `metaConfigurada !== null` y sin `urls.strip`; `'banda'` en el resto. `nombreCliente: 'María'`, `apellidoCliente: 'Rivera'` (reemplazan `NOMBRE_DE_EJEMPLO`).
  - **Arriba a la derecha**: `frente.estado` con la etiqueta chica arriba y el valor abajo (como `VÁLIDO HASTA` / `16/10/2026` del diseño); nada si es null.
  - **Sobre la franja**: `frente.sobreFranja` (donde hoy va el primario), solo si no es null.
  - **Debajo de la franja**: NOMBRE a la izquierda y APELLIDO a la derecha, cada uno con su rótulo chico arriba.
  - **QR**: dentro de la caja blanca, debajo del ícono, `PIE_CODIGO` en letra chica y oscura.
  - Actualizá los comentarios que describen el orden viejo.
- [ ] **`FormularioComercio.tsx`** (admin, ~líneas 86-131): `franja: 'grilla'` si es sellos con la meta de demo, `'banda'` si no; `nombreCliente: null`, `apellidoCliente: null`; muestra `frente.estado` donde hoy muestra `frente.primario ?? frente.secundario`.
- [ ] `npx tsc --noEmit` limpio en los dos archivos y `npx eslint` sobre ellos.
- [ ] Commit. En el reporte, describí qué debería ver el controlador en el navegador para cada tipo.

---

### Task 6: Dónde se ve el apellido

**Files:** Create `lib/clientes/nombreCompleto.ts` (+test) y `lib/clientes/coincideBusqueda.ts` (+test). Modify `lib/comercio/acreditar.ts` (+test), `app/comercio/(protegido)/clientes/page.tsx`, `app/comercio/(protegido)/clientes/[tarjetaId]/page.tsx`, `app/admin/(protegido)/comercios/[id]/clientes/page.tsx`, `lib/comercio/exportarClientes.ts` (+test). Independiente de la Task 1.

- [ ] **`nombreCompleto(nombre: string, apellido: string | null): string`**: `"María Rivera"`; con apellido null o en blanco, el nombre solo. Pruebas.
- [ ] **`coincideBusqueda(cliente: { nombre; apellido; telefono } | null, q: string): boolean`**: sale del filtro en memoria de `clientes/page.tsx` (~líneas 33-34, 65-71) SIN cambiar su semántica, y suma el apellido. Pruebas: por nombre, por apellido, por teléfono, `q` vacía. MUTACIÓN: sacar el apellido del texto buscado.
- [ ] **Escáner**: `buscarTarjetaPorToken` selecciona `clientes(nombre, apellido, telefono)` y devuelve `nombreCliente: nombreCompleto(...)` (con el fallback `'Cliente'` de hoy). Ajustá `acreditar.test.ts` (inserta un apellido y verifica el nombre completo).
- [ ] **Clientes** (lista y detalle) y **lista del admin**: seleccionan `apellido` y muestran `nombreCompleto` donde hoy muestran `clientes.nombre` (título, alt del QR, nombre del archivo del QR).
- [ ] **CSV** (`exportarClientes.ts`): `FilaExportacion.apellido: string`, columna **"Apellido" después de "Nombre"** (vacía si no hay), sin pasar por `nombreCompleto`. Ajustá la prueba del encabezado exacto y la del conteo de separadores.
- [ ] Commit.

---

### Task 7: La portada

**Files:** `app/page.tsx`, `app/_inicio/inicio.module.css` (solo comentarios si quedan desactualizados), `public/_inicio/tarjeta-membresia.webp`, `public/_inicio/tarjeta-gift-card.webp`, `public/_inicio/tarjeta-descuento.webp` (nuevos, ya convertidos). Independiente.

**Ojo:** otra sesión tocó `app/page.tsx` hace pocos días (píxel de Meta, contraste de la portada). Antes de editar, `git log -3 -- app/page.tsx` y leé el archivo actual; no reviertas nada de eso.

- [ ] `MODELOS_REALES` (renombralo si querés, p. ej. `MODELOS`): cada modelo suma `tipo` (valor de `TIPOS`). Orden: Sellos, Puntos, Membresía, Gift card, Descuento. El `nombre` visible sale de la `etiqueta` del catálogo (`TIPOS`) para que no diverja; si la etiqueta del catálogo no sirve como rótulo, explicalo y dejalo literal.
- [ ] `alt` que describa QUÉ SE VE (criterio de los existentes): membresía — pase de un gimnasio, fondo negro, "Mensualidad VIP", válido hasta el 16/10/2026, nombre y apellido; gift card — estudio de arte, fondo oscuro con moño plateado, saldo de $50; descuento — joyería, fondo café con aretes dorados y 40% de descuento.
- [ ] `TIPOS_SIN_MODELO = TIPOS.filter((t) => !MODELOS.some((m) => m.tipo === t.valor))`. El cartel queda en "+3" solo (cashback, prepago, cupón). Actualizá los comentarios que hablan de "dos modelos" / "seis diseños".
- [ ] La nota de abajo de la tira NO cambia de texto.
- [ ] `npx tsc --noEmit` y `npx eslint app/page.tsx`. Commit con los tres `.webp` (`git add` de esos tres primero).

---

### Task 8: El script de actualización de Google

**Files:** Create `scripts/actualizar-frente-google.ts`, `lib/google/baseUrlPublica.ts` (+test). Independiente. **No lo corras** (ni en ensayo): toca producción; lo corre el controlador con autorización del usuario.

Leé antes `scripts/resincronizar-objetos-google.ts` (patrón, carga de `.env.local`, filtro de tarjetas), `lib/google/syncObjeto.ts`, `syncClase.ts` y `syncClasePrograma.ts` (qué devuelve cada uno).

- [ ] **`esBaseUrlPublica(url: string | undefined): boolean`**: true solo con `https://` y host que no sea `localhost`/`127.0.0.1`. Pruebas y mutación (aceptar `http://`).
- [ ] Uso: `npx tsx --conditions=react-server scripts/actualizar-frente-google.ts <objetos|clases> [--aplicar]`. Fase inválida → uso y exit 1. `NEXT_PUBLIC_BASE_URL` no pública → aborta con el motivo (Google rechaza el patch ENTERO con `400 Image cannot be loaded`).
- [ ] **Sin `--aplicar`**: ensayo. Imprime cuántos comercios, objetos (fase objetos) o clases de comercio y de programa (fase clases) tocaría, y termina sin llamar a Google.
- [ ] **`objetos --aplicar`**: tarjetas con `google_object_id is not null` (NUNCA `syncObjetosComercio`, que crearía objetos), agrupadas por comercio, en secuencia con `syncObjetoTarjeta`. Resumen por comercio: ok / fallos con el error. **Exit 1 si hubo algún fallo** (el deploy B depende de 0 fallos).
- [ ] **`clases --aplicar`**: `syncClaseComercio` para comercios con `google_class_id`; `syncClasePrograma` SOLO para programas con `google_class_id`, leyendo su resultado. Resumen y exit 1 si hubo fallos. Imprimí al empezar un recordatorio de que esta fase se corre desde el commit del deploy B.
- [ ] `npx tsc --noEmit` limpio en el script. Commit.

---

### Task 9: La plantilla de filas en la clase — SOLO después del deploy A y de la fase objetos con 0 fallos

**Files:** `lib/google/construirRecursos.ts` (`construirClase`), `lib/google/construirRecursos.test.ts`.

- [ ] `construirClase` suma `classTemplateInfo: { cardTemplateOverride: { cardRowTemplateInfos: [fila1, fila2] } }` con dos `twoItems`, cada ítem `{ firstValue: { fields: [{ fieldPath }] } }`:
  1. `object.textModulesData['nombre_pase']` | `object.textModulesData['estado']`
  2. `object.textModulesData['nombre']` | `object.textModulesData['apellido']`
- [ ] Verificá los nombres exactos contra los tipos de `googleapis` (`Schema$ClassTemplateInfo`, `Schema$CardTemplateOverride`, `Schema$CardRowTemplateInfo`, `Schema$TemplateItem`, `Schema$FieldSelector`, `Schema$FieldReference`).
- [ ] Prueba que fije las dos filas y su orden. MUTACIÓN: invertir las filas.
- [ ] Comentario en `construirClase` con el porqué del orden de despliegue (spec, "Orden de despliegue").
- [ ] Commit (lo publica el controlador como deploy B).

---

### Task 10: Controlador

- [ ] Al terminar cada tarea: leer el diff, correr las pruebas y las mutaciones críticas uno mismo, no creerle al reporte.
- [ ] Con las olas 1 y 2 terminadas: `npx tsc --noEmit`, eslint de los archivos tocados, **suite completa**.
- [ ] Navegador (página temporal en `app/`, borrada antes del commit, sin sesión ni base): la vista previa de marca en membresía (franja propia y banda lisa), gift card, sellos con grilla y descuento; el formulario de registro con Apellido; la tira de la portada con los cinco modelos y el "+3" (a 375 px y a 1100 px, sin scroll horizontal del body).
- [ ] **Antes del deploy A** (spec, riesgos): listar en producción, solo lectura, los programas que no son de sellos con franja propia efectiva (programa o comercio) y tarjetas con `google_object_id`, y el tipo real de esas franjas. Si hay alguno, avisarle al usuario antes de publicar: desde el deploy A, si Google no acepta esa imagen, esas tarjetas dejan de actualizar saldo en Android.
- [ ] Merge fast-forward a `master` + push = **deploy A**. Esperar a que producción sirva el código nuevo.
- [ ] Documento de estado (`docs/superpowers/ESTADO-Y-PLAN-2026-07-28.md`): sección nueva con lo que entró, lo no obvio y lo pendiente (fase objetos, deploy B, fase clases, QA en teléfono).
- [ ] **Fase objetos**: ensayo, pedirle autorización explícita al usuario, `--aplicar` con `NEXT_PUBLIC_BASE_URL=https://www.cardly-sv.site`, repetir hasta 0 fallos.
- [ ] Task 9 → suite de Google → merge + push = **deploy B** → **fase clases** (ensayo, autorización, `--aplicar`).
- [ ] Pedirle al usuario la QA en teléfono: iPhone y Android, membresía con franja propia, gift card, descuento, un cliente sin apellido; en Android, que los ítems vacíos no dejen hueco.

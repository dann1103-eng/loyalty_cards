# Diseño: Fase 3 — Panel de autogestión del comercio, catálogo de tipos de tarjeta y tarjetas de sellos

**Fecha:** 2026-07-16
**Estado:** Auto-aprobado. El usuario dio autonomía total y pidió explícitamente no ser consultado ("continua con autonomía sin preguntarme nada... dejemos todo lo que se pueda listo") porque debía ausentarse. Este documento registra las decisiones de alcance y arquitectura que normalmente se acordarían en diálogo, tomadas unilateralmente por necesidad. **No se saltó la revisión**: pasa por spec-document-reviewer igual que cualquier spec de este proyecto, y se ejecuta con la misma disciplina de dos etapas (implementador + revisión de spec + revisión de calidad) que encontró 9 bugs reales en el panel de FM el mismo día — esa instrucción ("la manera más segura y eficiente") nunca se retiró.

## 1. Contexto

Fases 0+1 (walking skeleton de Apple Wallet: registro → pass firmado → Wallet → saldo en vivo) están completas y en producción. El panel interno de FM (comercios: ver/crear/editar licencia y branding) está terminado o a un paso de estarlo. El roadmap original siempre reservó para una fase posterior: el panel de autogestión del propio comercio (su "Fase 3") y un catálogo de tipos de tarjeta (deferido hasta tener ≥2 tipos reales). Ambos se activan ahora.

**Google Wallet queda fuera de esta fase** — decisión del usuario el mismo día, por falta de tiempo. Todo lo que sigue es Apple-only, igual que hoy.

**Investigación de referencia:** se revisó cardly.com.mx (competidor) para el catálogo de tipos de tarjeta. Su arquitectura es, en esencia, la misma que la nuestra: QR físico → formulario → tarjeta en Wallet (Apple o Google, el cliente no instala nada aparte) → app propia del negocio escanea para sumar puntos/sellos o canjear. Ofrecen 8 tipos, todos personalizables en logo/colores/íconos/texto: **Cashback** (reembolso hacia compras futuras), **Sellos** (compra 9, la 10 gratis), **Recompensas** (sistema de puntos — nuestro tipo "puntos" ya construido), **Membresías** (club VIP por niveles), **Descuento** (ventas al por mayor), **Cupón** (uso único, se convierte en otro tipo tras canjear), **Prepago** (tarjetas de sellos prepagadas), **Gift Card** (saldo de regalo prepagado).

## 2. Objetivo de esta fase

Tres piezas, construidas juntas porque comparten esquema y páginas:

1. **Catálogo de tipos de tarjeta** — `comercios` gana un tipo (`tipo_tarjeta`), con las 8 opciones de Cardly como universo completo, pero **solo 2 funcionales de verdad esta fase**: `puntos` (ya construido) y `sellos` (nuevo). Los otros 6 aparecen en el selector de FM como "Próximamente" — deshabilitados, no fingidos como funcionales.
2. **Tarjetas de sellos** — un tipo de tarjeta alterno con un pass visualmente distinto (grilla de sellos, no un número), reutilizando la misma columna `puntos_actuales` como contador de sellos.
3. **Panel de autogestión del comercio** — un login real y propio para el dueño del comercio (`usuarios_comercio`, rol `owner`), donde configura el branding con **subida real de imágenes** (a diferencia del panel de FM, que usa texto/URL) y administra sus reglas de puntos y catálogo de recompensas.

## 3. Actores y roles

- **FM** — ya tiene su panel (`/admin`). Gana un campo más para editar: `tipo_tarjeta` del comercio (el tipo es parte de lo que FM "vende"/habilita, como la licencia — no algo que el dueño elija libremente).
- **Dueño de comercio** (`usuarios_comercio.rol = 'owner'`) — **nuevo**, login real vía Supabase Auth + `@supabase/ssr` (reutilizando exactamente el patrón ya construido para FM: `createClienteServidor`, `getClaims()`, gate en `layout.tsx` de un route group protegido). Un comercio puede tener más de un dueño con cuentas separadas (a diferencia de FM, que es una sola cuenta compartida) — cada fila de `usuarios_comercio` es una cuenta de Auth distinta.
- **Cajero** (`usuarios_comercio.rol = 'cajero'`) — la fila y el CHECK ya existen en el esquema desde la Fase 0, pero su login y su PWA de escaneo **quedan fuera de esta fase** (ver §9). No se toca.
- **Cliente** — sin cambios; sigue identificado solo por teléfono, sin contraseña.

## 4. Modelo de datos

### 4.1 Tipo de tarjeta (nueva migración `0005`)

```sql
alter table comercios
  add column tipo_tarjeta text not null default 'puntos'
    check (tipo_tarjeta in ('puntos', 'sellos', 'cashback', 'membresia', 'descuento', 'cupon', 'prepago', 'gift_card'));

-- Campos que solo aplican cuando tipo_tarjeta = 'sellos'. Nullable: sin sentido en otros tipos.
alter table comercios add column sello_icono_url text;
alter table comercios add column sello_meta integer check (sello_meta is null or sello_meta > 0);
```

`default 'puntos'` es intencional: Cafetería Piloto (la única fila real hoy) queda como está, sin migración de datos.

**Por qué el CHECK en la BD, y no solo en el código (a diferencia de la decisión con `validarColorRgb`):** aquí SÍ conviene el CHECK porque el conjunto de valores válidos es una lista fija y pequeña (8 strings), no una regla derivable de un formato (como `rgb(r,g,b)`, que tiene infinitos valores válidos). No hay una "regex" que duplicar — el CHECK y el array de TypeScript son ambos, literalmente, la misma lista de 8 strings; mantenerlos sincronizados es trivial y ya es el patrón usado para `licencia_estado`/`ESTADOS_LICENCIA`. Se exportará una constante `TIPOS_TARJETA` (mismo mecanismo que `ESTADOS_LICENCIA`) para que el `<select>` de FM y el validador no puedan divergir.

### 4.2 Sellos — corregido tras revisión: reutiliza `tarjetas.puntos_actuales`, pero como TEXTO, no como imagen compuesta

**La primera versión de esta sección decía "solo cambia el render" y estaba mal.** La revisión de spec comprobó que este proyecto **no tiene ninguna capacidad de composición de imágenes** (sin `sharp`/`canvas`/`jimp`/`resvg`/`satori` ni nada similar), que el pass hoy renderiza puntos como un único campo de texto (`lib/apple/generatePass.ts`, `primaryField` con `numberStyle`) sin ninguna imagen involucrada, y que — más revelador — **ni siquiera las imágenes de branding que YA existen** (`logo_url`, `strip_url`, `hero_url`, capturadas por el panel de FM desde hoy) llegan nunca al pass firmado: hoy solo llegan a la base de datos. Prometer una grilla visual de sellos compuesta como imagen es, en la práctica, pedir un subsistema entero de generación de imágenes desde cero, no un "cambio de render."

**Diseño corregido, sin pipeline de imágenes:** un sello sigue siendo, en los datos, idéntico a un punto — el mismo entero en `tarjetas.puntos_actuales`, ganado con las mismas `reglas_puntos` (`por_visita`/`por_monto`, sin cambios). Lo único que cambia es el **texto** del campo primario del pass: en vez de mostrar el número solo, si `comercios.tipo_tarjeta = 'sellos'` se muestra como fracción de texto — `"7 de 10 sellos"` en vez de `"7"` — usando `comercios.sello_meta` como el denominador. Sigue siendo el mismo `primaryField`, con un `value` de tipo string en vez de number; **cero componentes nuevos, cero dependencias nuevas.**

**Completar la tarjeta usa el mecanismo de canje que YA existe, sin ningún código nuevo:** al llegar a `sello_meta`, el cliente es elegible para canjear una `recompensa` cuyo `costo_puntos = sello_meta` — exactamente el mismo canje que ya existe para puntos (`canjes` descuenta `puntos_gastados` de `puntos_actuales`). No hace falta diseñar "qué pasa al completar" como un caso especial: completar y canjear un sello **es** gastar `sello_meta` puntos, y el contador vuelve a 0 por el mismo camino que ya funciona hoy. Esto también resuelve de raíz la pregunta de "qué pasa si `puntos_actuales >= sello_meta`" que la revisión señaló como no definida: no puede pasar en la práctica, porque llegar a la meta dispara el canje (vía el cajero, fuera de alcance de esta fase pero ya construido conceptualmente) antes de seguir sumando.

**`sello_icono_url` se guarda y se usa en la vista previa web (§6) y en el futuro portal del cliente — NO en el pass firmado, todavía.** Wirear imágenes de verdad al pass (branding general, no solo el ícono de sello) es trabajo real, pre-existente y sin construir, que queda fuera de alcance de esta fase (ver §9). El campo se guarda ahora para no tener que migrar el esquema otra vez cuando se construya esa parte.

### 4.3 `usuarios_comercio` — ya existe, sin cambios de esquema

```sql
-- (ya existe desde 0001, sin tocar)
create table usuarios_comercio (
  id uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references comercios(id),
  email text not null unique,
  rol text not null check (rol in ('owner', 'cajero')),
  auth_user_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);
```
`auth_user_id` es nullable hoy porque nunca se usó — esta fase es la primera en poblarlo. Alta de una cuenta de dueño: script nuevo `scripts/seed-usuario-comercio.ts <email> <password> <slug-del-comercio>` que FM corre a mano al dar de alta un comercio nuevo (no hay envío de invitación por correo — eso requeriría un servicio de email que este proyecto no tiene configurado).

**Corrección tras revisión: NO es exactamente "el mismo patrón" que `seed-usuario-fm.ts`.** Ese script hace `upsert({...}, {onConflict: 'auth_user_id'})`, válido porque `usuarios_fm.auth_user_id` es `not null unique`. Aquí, `usuarios_comercio.auth_user_id` es **nullable y NO único** — ese `onConflict` no tiene ninguna restricción a la cual apuntar y fallaría. La clave de idempotencia correcta es `email` (la única columna única de la tabla aparte del `id`): `upsert({..., rol: 'owner'}, {onConflict: 'email'})`, resolviendo `comercio_id` a partir del slug recibido como argumento antes del upsert.

### 4.4 Imágenes — Supabase Storage, subida mediada por el servidor

Un bucket nuevo, `comercio-imagenes` (público de lectura — correcto para estos archivos: logo/strip/hero/ícono de sello son, por naturaleza, públicos, aparecen en la tarjeta de cualquier cliente). Rutas `{comercio_id}/{campo}.{ext}`. **La escritura NO pasa por políticas de RLS de Storage** — el owner sube el archivo a un Server Action, que lo valida (tipo MIME, tamaño máximo) y lo sube usando `createServiceClient()`, exactamente el mismo patrón que ya usa el resto del proyecto (autorización a nivel de aplicación vía el gate, nunca a nivel de RLS). Evita diseñar un segundo modelo de autorización (políticas de Storage) además del ya existente.

**Dos correcciones tras revisión, ambas necesarias antes de implementar:**
1. **El `{comercio_id}` de la ruta debe salir del resultado de `verifyComercioOwner()`, nunca de un campo del formulario.** Si se tomara de un input del cliente, un dueño podría sobrescribir las imágenes de OTRO comercio con solo cambiar un valor en el request. El Server Action ignora cualquier `comercio_id` que llegue del formulario y usa siempre el de la sesión verificada.
2. **Cache-busting:** la ruta es determinística (`{comercio_id}/logo.png`) y Supabase Storage sirve URLs públicas cacheadas por CDN — volver a subir un logo al mismo path serviría la imagen vieja hasta que expire el caché, tanto en la vista previa como en el pass (cuando se construya esa parte). Se agrega un sufijo de versión al nombre de archivo (o un parámetro `?v=timestamp` en la URL guardada) para invalidar el caché en cada subida nueva.

## 5. Autenticación y gate del dueño

Réplica exacta de la arquitectura de `/admin`, con nombres propios:

- `lib/comercio/esOwnerDeComercio.ts` — busca en `usuarios_comercio` por `auth_user_id`, retorna `{comercioId, nombre} | null`. Mismo manejo de error que `esAdminFm`: un error de infraestructura se registra con `console.warn`/`console.error` y nunca se confunde con "no es dueño". **Nota tras revisión:** este patrón usa `.maybeSingle()`, igual que `esAdminFm` — seguro ahí porque `usuarios_fm.auth_user_id` es único. Aquí `usuarios_comercio.auth_user_id` **no** tiene esa restricción; el diseño asume que, en la práctica, cada cuenta de Auth queda ligada a una sola fila (un dueño = una cuenta = un comercio). Si alguna vez una misma cuenta terminara con dos filas, `.maybeSingle()` lanzaría y el dueño quedaría bloqueado por el manejo de "error de infraestructura" — un caso de baja probabilidad dado que `email` sí es único, pero vale tenerlo presente si el flujo de alta cambia más adelante.
- `lib/comercio/verifyComercioOwner.ts` — `cache()`-wrapped, `getClaims()`, redirige a `/comercio/login` si no hay sesión o si el usuario no tiene fila en `usuarios_comercio` con `rol='owner'`.
- `app/comercio/login/` — mismo patrón que `app/admin/login/` (Server Component + Client Component + Server Action), mismos mensajes de error genéricos ("Correo o contraseña incorrectos"), mismo truco de `Object.hasOwn` para los mensajes por query string.
- `app/comercio/(protegido)/layout.tsx` — el gate. **Misma regla estructural que ya nos mordió una vez:** `app/comercio/layout.tsx` NUNCA debe existir (envolvería `/comercio/login`, ciclo infinito). El route group es obligatorio.

- `proxy.ts` (raíz) y `lib/supabase/proxy.ts` — **corregido tras revisión, con el patrón exacto en vez de "tener cuidado".** La revisión encontró dos errores concretos en la primera versión de esta sección:

  1. **La descripción del código actual era incorrecta.** `lib/supabase/proxy.ts` ya NO compara con un string literal suelto — ya está anclado a propósito: `ruta === '/admin/login' || ruta.startsWith('/admin/login/')`, con un comentario explicando por qué (un `startsWith` sin anclar eximiría también `/admin/login-sso`). La generalización propuesta ("termina en `/login`") era en realidad **más floja** que el código actual, y contradice ese mismo comentario. Se descarta.

  2. **El destino del redirect está hardcodeado a `/admin/login` sin condición.** Al agregar `/comercio/:path*` al `matcher`, una visita sin sesión a `/comercio/panel` caería en el mismo bloque y terminaría redirigida a `/admin/login` — la pantalla de FM, no la del dueño del comercio. Esto no estaba resuelto en la versión anterior.

  **Patrón correcto** (reemplaza el bloque de exención + redirect en `lib/supabase/proxy.ts`):
  ```typescript
  const esRutaLogin =
    ruta === '/admin/login' || ruta.startsWith('/admin/login/') ||
    ruta === '/comercio/login' || ruta.startsWith('/comercio/login/');

  if (!usuario && !esRutaLogin) {
    const prefijo = ruta.startsWith('/comercio') ? '/comercio' : '/admin';
    const url = request.nextUrl.clone();
    url.pathname = `${prefijo}/login`;
    url.search = '';
    // ...resto sin cambios
  }
  ```
  Dos checks anclados en OR (no una regla floja nueva), y el destino del redirect se deriva del prefijo de la ruta en vez de estar fijo. `matcher` en `proxy.ts` (raíz) pasa a `['/admin/:path*', '/comercio/:path*']`.

## 6. Páginas del panel de autogestión

- `/comercio/(protegido)/panel` — resumen: nombre del comercio, tipo de tarjeta actual (nombre + descripción corta), atajos a branding/reglas/recompensas.
- `/comercio/(protegido)/branding` — formulario: colores (mismos 3 campos `rgb(r,g,b)` que ya validan con `validarColorRgb`), logo/strip/hero **con subida de archivo real** (no URL de texto), y si `tipo_tarjeta='sellos'`: el ícono del sello (subida de archivo) y la meta de sellos (número). El campo `tipo_tarjeta` en sí **no es editable aquí** — lo asigna FM (ver §4.1), el dueño solo ve cuál tiene.
- `/comercio/(protegido)/reglas` — CRUD de `reglas_puntos` (tipo, valor). Sin soft-delete: una regla vieja simplemente se reemplaza o se borra (no hay historial de canjes que dependa de una regla, a diferencia de `recompensas`).
- `/comercio/(protegido)/recompensas` — CRUD de `recompensas`. **El borrado es SIEMPRE soft-delete (`activa=false`)** — la columna `recompensas.activa` existe desde la Fase 0, pero **corrección tras revisión: ningún código la usa todavía**. No hay CRUD de recompensas construido hasta ahora, y el único patrón de borrado que sí existe en el proyecto (`eliminarComercio`) es un borrado real (`.delete()`). Esta CRUD es, en la práctica, **la primera vez que se escribe código para esta regla** — no hay nada que "reutilizar", hay que implementarla explícitamente: el botón "eliminar" de una recompensa debe ejecutar `update({activa: false})`, nunca `.delete()`. Se deja anotado así de explícito precisamente para que nadie copie el patrón de `eliminarComercio` aquí por analogía y rompa el historial de `canjes.recompensa_id`.

Diseño visual: reutiliza el mismo sistema (`app/globals.css`: `shell`, `panel`, `field`, `btn-primary`, etc.) que ya existe, extendiéndolo donde haga falta (ej. un componente de subida de imagen con vista previa) — no se reconstruye desde cero.

**"Mejor diseño", corregido tras revisión — vista previa simple, NO un renderizador del pass firmado.** La versión anterior prometía una "vista previa en vivo del pass... sin necesidad de firmarla de verdad." Un `.pkpass` es un zip binario firmado (`passkit-generator`, `getAsBuffer()`) — no se puede renderizar en el navegador, y reconstruir su layout visual en HTML/CSS con fidelidad real es trabajo de diseño propio, no algo gratis. Se reduce el alcance a algo que sí es barato y honesto: un `<div>` con los colores elegidos (fondo/texto/etiqueta) en una proporción similar a una tarjeta de Wallet, mostrando el nombre del comercio y —si `tipo_tarjeta='sellos'`— el texto "7 de 10 sellos" de ejemplo. Una maqueta de colores, no una réplica pixel-perfect del pass real. Si el dueño quiere ver el pass real, sigue pudiendo agregarlo a su propio Wallet después de guardar.

## 7. Selector de tipo en el panel de FM

Se extiende el formulario existente de comercio (`FormularioComercio.tsx`, ya construido) con un nuevo `<select name="tipo_tarjeta">`, generado desde una constante `TIPOS_TARJETA` (objeto con `valor`, `etiqueta`, `descripcion`, `disponible: boolean`). Las 6 opciones con `disponible: false` se renderizan con `disabled` y la etiqueta sufijada con "(Próximamente)" — igual que Cardly muestra sus 8 tipos pero nosotros somos honestos sobre cuáles funcionan hoy.

## 8. Pruebas end-to-end

Se agrega Playwright (nueva dependencia de desarrollo) cubriendo, como mínimo:
1. Registro de cliente real → pass descargable (flujo público existente).
2. Login de FM → crear comercio → editarlo → eliminarlo (flujo ya construido hoy).
3. Login de dueño → editar branding con subida de imagen → verificar que se refleja.

No exhaustivo — cubre los caminos críticos, no cada combinación. No hay pipeline de CI configurado en este proyecto; estas pruebas corren localmente por ahora.

## 9. Explícitamente fuera de alcance de esta fase

- **Google Wallet** — decisión del usuario el mismo día, sin tiempo.
- **Login y PWA de escaneo del cajero** — sigue siendo su propia fase (la "Fase 4" del roadmap original). Esta fase solo toca al `owner`. Es una superficie grande por sí sola (cámara, escaneo en tiempo real, UI de canje) y no fue pedida explícitamente en este mensaje.
- **Los 6 tipos de tarjeta restantes, funcionalmente** — cashback, membresías, descuento, cupón, prepago, gift card quedan en el catálogo como "Próximamente", sin lógica de saldo/nivel/canje real detrás. Construirlos requiere diseño propio por tipo (cada uno tiene una mecánica de redención distinta) — no tiene sentido improvisarlo sin ese diseño.
- **Verificación por SMS/OTP del portal de cliente** — ver el spec separado del portal (§10). Requeriría contratar un servicio de terceros (Twilio o similar), una decisión de gasto que no me corresponde tomar unilateralmente.
- **Invitación de dueños por correo** — alta manual vía script (igual que FM), no hay servicio de email configurado.
- **Facturación real** — sigue siendo seguimiento manual, sin cambios.
- **Imágenes de branding renderizadas en el pass firmado** (logo/strip/hero/ícono de sello) — corrección tras revisión: esto **ya estaba fuera de alcance de facto** (nunca se construyó, ni siquiera para los campos que el panel de FM ya captura hoy), pero la primera versión de este documento no lo decía explícitamente. Esta fase permite subir y guardar esas imágenes (§4.4) y usarlas en la vista previa web simplificada (§6); wirearlas al pass real de Apple es trabajo aparte, no diseñado aquí.
- **Vista previa pixel-perfect del pass firmado** — corrección tras revisión: se reemplaza por una maqueta simple de colores (§6). Reconstruir el layout real de Apple Wallet en HTML/CSS con fidelidad completa queda fuera de alcance.
- **Grilla visual de sellos compuesta como imagen** — corrección tras revisión (ver §4.2): sellos se muestra como texto ("7 de 10") esta fase, no como una imagen con íconos llenos/vacíos. La versión visual es una mejora futura.

## 10. Nota sobre el portal del cliente

El "portal de clientes ... para descargarla como app" se diseña como **documento separado** (`2026-07-16-portal-cliente-design.md`), porque es una superficie distinta (cara al cliente final, sin autenticación por contraseña) con sus propios riesgos de privacidad y una decisión de alcance propia (look-up por teléfono vs. verificación por código). Separarlo permite que esta fase (autogestión + catálogo + sellos) se entregue y funcione de forma independiente, sin esperar a que la otra esté lista.

## 11. Decisiones registradas

1. Catálogo completo (8 tipos) en el esquema desde ya; solo 2 (puntos, sellos) funcionales. Evita fingir que algo funciona cuando no.
2. `tipo_tarjeta` SÍ lleva CHECK en la BD (a diferencia del color) porque es un conjunto fijo de 8 valores, no un formato con infinitas variantes válidas.
3. Sellos reutiliza `puntos_actuales` — sin columna nueva de conteo. **Corregido tras revisión:** se muestra como texto ("7 de 10 sellos"), no como imagen — este proyecto no tiene pipeline de composición de imágenes, y construir uno no es "solo cambiar el render." Completar la tarjeta reutiliza el canje de recompensas ya existente, sin lógica nueva de redención.
4. Autorización del panel de dueño: mismo modelo que FM — gate a nivel de aplicación + `createServiceClient()`, nunca RLS de sesión. Un solo modelo de autorización en todo el proyecto.
5. Subida de imágenes: mediada por el servidor (Server Action + service-role), no políticas de Storage. El `comercio_id` de la ruta sale siempre del gate, nunca de un campo del formulario. Cache-busting por versión en el nombre de archivo.
6. Alta de cuentas de dueño: script manual con `upsert(..., {onConflict: 'email'})` (no `auth_user_id` — a diferencia de `usuarios_fm`, no es único aquí), sin invitación por correo (no hay servicio de email).
7. `tipo_tarjeta` lo asigna FM, no lo elige el dueño — es parte de lo que FM "vende", igual que la licencia.
8. `proxy.ts`: exención de login como OR de dos checks anclados (`/admin/login` y `/comercio/login`, cada uno con su variante `/…/`), nunca una regla floja tipo `endsWith`. Destino del redirect derivado del prefijo de la ruta, no fijo a `/admin/login`.
9. Recompensas: soft-delete (`activa=false`) es la primera vez que se escribe ese código — no hay nada existente que reutilizar, y no debe copiarse el borrado real de `eliminarComercio`.
10. Vista previa de branding: maqueta simple de colores, no una reconstrucción fiel del pass firmado (eso no es viable sin renderizar el `.pkpass` real).

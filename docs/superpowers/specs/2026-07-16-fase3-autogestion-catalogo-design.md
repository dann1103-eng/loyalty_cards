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

### 4.2 Sellos reutiliza `tarjetas.puntos_actuales`

No se crea una columna nueva para el conteo de sellos. Un sello es, en los datos, idéntico a un punto — un entero que sube. Lo único que cambia es el **render**: si `comercios.tipo_tarjeta = 'sellos'`, el pass muestra una grilla de `sello_meta` íconos (llenos hasta `puntos_actuales`, vacíos el resto) usando `sello_icono_url` como el ícono, en vez del campo de texto con el número. `reglas_puntos` (cómo se ganan) no cambia — sigue siendo `por_visita` o `por_monto`, aplica igual a puntos y a sellos.

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
`auth_user_id` es nullable hoy porque nunca se usó — esta fase es la primera en poblarlo. Alta de una cuenta de dueño: mismo patrón que `scripts/seed-usuario-fm.ts`, un script nuevo `scripts/seed-usuario-comercio.ts <email> <password> <slug-del-comercio>` que FM corre a mano al dar de alta un comercio nuevo (no hay envío de invitación por correo — eso requeriría un servicio de email que este proyecto no tiene configurado, y añadir uno es una decisión de gasto/infraestructura que no me corresponde tomar solo).

### 4.4 Imágenes — Supabase Storage, subida mediada por el servidor

Un bucket nuevo, `comercio-imagenes` (público de lectura), con rutas `{comercio_id}/{campo}.{ext}`. **La escritura NO pasa por políticas de RLS de Storage** — el owner sube el archivo a un Server Action, que lo valida (tipo MIME, tamaño máximo) y lo sube usando `createServiceClient()`, exactamente el mismo patrón que ya usa el resto del proyecto (autorización a nivel de aplicación vía el gate, nunca a nivel de RLS). Evita diseñar un segundo modelo de autorización (políticas de Storage) además del ya existente — dos modelos de autorización en paralelo es exactamente la clase de duplicación que este proyecto ha evitado a propósito en otras decisiones (por ejemplo, no se agregó un CHECK de color en SQL para no duplicar `validarColorRgb`).

## 5. Autenticación y gate del dueño

Réplica exacta de la arquitectura de `/admin`, con nombres propios:

- `lib/comercio/esOwnerDeComercio.ts` — busca en `usuarios_comercio` por `auth_user_id`, retorna `{comercioId, nombre} | null`. Mismo manejo de error que `esAdminFm`: un error de infraestructura se registra con `console.warn`/`console.error` y nunca se confunde con "no es dueño".
- `lib/comercio/verifyComercioOwner.ts` — `cache()`-wrapped, `getClaims()`, redirige a `/comercio/login` si no hay sesión o si el usuario no tiene fila en `usuarios_comercio` con `rol='owner'`.
- `app/comercio/login/` — mismo patrón que `app/admin/login/` (Server Component + Client Component + Server Action), mismos mensajes de error genéricos ("Correo o contraseña incorrectos"), mismo truco de `Object.hasOwn` para los mensajes por query string.
- `app/comercio/(protegido)/layout.tsx` — el gate. **Misma regla estructural que ya nos mordió una vez:** `app/comercio/layout.tsx` NUNCA debe existir (envolvería `/comercio/login`, ciclo infinito). El route group es obligatorio.
- `proxy.ts` (raíz) — su `matcher` gana `/comercio/:path*` junto al `/admin/:path*` existente, y la exención de ruta de login se generaliza a "termina en `/login` o `/login/...`" en vez de estar hardcodeada solo a `/admin/login` (verificar esto con cuidado: la lógica actual compara con el string literal `/admin/login`; hay que generalizarla sin abrir un hueco donde `/comercio/loginX` quede exento por accidente — mismo cuidado que ya se documentó para la ruta de FM).

## 6. Páginas del panel de autogestión

- `/comercio/(protegido)/panel` — resumen: nombre del comercio, tipo de tarjeta actual (nombre + descripción corta), atajos a branding/reglas/recompensas.
- `/comercio/(protegido)/branding` — formulario: colores (mismos 3 campos `rgb(r,g,b)` que ya validan con `validarColorRgb`), logo/strip/hero **con subida de archivo real** (no URL de texto), y si `tipo_tarjeta='sellos'`: el ícono del sello (subida de archivo) y la meta de sellos (número). El campo `tipo_tarjeta` en sí **no es editable aquí** — lo asigna FM (ver §4.1), el dueño solo ve cuál tiene.
- `/comercio/(protegido)/reglas` — CRUD de `reglas_puntos` (tipo, valor). Sin soft-delete: una regla vieja simplemente se reemplaza o se borra (no hay historial de canjes que dependa de una regla, a diferencia de `recompensas`).
- `/comercio/(protegido)/recompensas` — CRUD de `recompensas`. **El borrado es SIEMPRE soft-delete (`activa=false`)** — esto ya está decidido desde la Fase 0 (memoria del proyecto): `canjes` referencia `recompensa_id`, borrar de verdad rompería el historial. No reinventar esto.

Diseño visual: reutiliza el mismo sistema (`app/globals.css`: `shell`, `panel`, `field`, `btn-primary`, etc.) que ya existe, extendiéndolo donde haga falta (ej. un componente de subida de imagen con vista previa) — no se reconstruye desde cero. "Mejor diseño" en la práctica significa: vista previa en vivo del pass mientras se edita el branding (mostrar cómo se vería la tarjeta con los colores/imagen elegidos, sin necesidad de firmarla de verdad para previsualizar), algo que el panel de FM no tiene y que sí vale la pena aquí porque el dueño es quien más se beneficia de ver el resultado antes de guardar.

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

## 10. Nota sobre el portal del cliente

El "portal de clientes ... para descargarla como app" se diseña como **documento separado** (`2026-07-16-portal-cliente-design.md`), porque es una superficie distinta (cara al cliente final, sin autenticación por contraseña) con sus propios riesgos de privacidad y una decisión de alcance propia (look-up por teléfono vs. verificación por código). Separarlo permite que esta fase (autogestión + catálogo + sellos) se entregue y funcione de forma independiente, sin esperar a que la otra esté lista.

## 11. Decisiones registradas

1. Catálogo completo (8 tipos) en el esquema desde ya; solo 2 (puntos, sellos) funcionales. Evita fingir que algo funciona cuando no.
2. `tipo_tarjeta` SÍ lleva CHECK en la BD (a diferencia del color) porque es un conjunto fijo de 8 valores, no un formato con infinitas variantes válidas.
3. Sellos reutiliza `puntos_actuales` — sin columna nueva de conteo. Solo cambia el render del pass.
4. Autorización del panel de dueño: mismo modelo que FM — gate a nivel de aplicación + `createServiceClient()`, nunca RLS de sesión. Un solo modelo de autorización en todo el proyecto.
5. Subida de imágenes: mediada por el servidor (Server Action + service-role), no políticas de Storage. Mismo argumento de "un solo modelo de autorización."
6. Alta de cuentas de dueño: script manual, sin invitación por correo (no hay servicio de email).
7. `tipo_tarjeta` lo asigna FM, no lo elige el dueño — es parte de lo que FM "vende", igual que la licencia.

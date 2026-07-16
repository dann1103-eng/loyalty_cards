# Diseño: Panel de administración de FM (comercios y licencias)

**Fecha:** 2026-07-16
**Estado:** Aprobado por el usuario para pasar a plan de implementación

## 1. Contexto

Este documento extiende el proyecto descrito en [2026-07-09-fm-loyalty-mvp-design.md](2026-07-09-fm-loyalty-mvp-design.md). Las Fases 0+1 (walking skeleton de Apple Wallet) ya están completas, desplegadas en producción (Vercel + Supabase), y validadas de punta a punta en un iPhone real: registro → tarjeta firmada → Apple Wallet → saldo real y actualizado.

Hoy, dar de alta un comercio nuevo (crear su registro, branding) se hace a mano vía script (`scripts/seed-pilot-comercio.ts`) o directo en Supabase Studio. FM (la plataforma) necesita su propio panel para gestionar sus comercios clientes y el estado de su licencia, sin depender de scripts.

## 2. Objetivo de esta fase

Un panel interno, usado solo por FM, donde se pueda: ver la lista de comercios clientes, dar de alta uno nuevo, y editar tanto su licencia (activo/inactivo, plan, monto mensual) como su branding existente (nombre, colores, URLs de imágenes) — todo protegido por login real.

Esta fase construye además la infraestructura de autenticación (Supabase Auth + `@supabase/ssr`) que la próxima fase (login de dueño/cajero de comercio) reutilizará directamente.

## 3. Actores y roles

- **FM (plataforma)** — Daniel y su socio, usando **una sola cuenta compartida** de Supabase Auth (email + contraseña). No se necesitan cuentas individuales por persona.
- **Comercio (dueño/cajero)** — sin cambios en esta fase; su login sigue siendo una fase futura (Fase 4 del spec original — el spec original ubica "login con rol" ahí, no en la Fase 3, que solo cubre CRUD de reglas/recompensas).
- **Cliente final** — sin cambios; sigue sin login, solo su tarjeta en Wallet.

## 4. Modelo de datos (Supabase / Postgres)

### Tabla nueva: `usuarios_fm`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid, PK | `gen_random_uuid()` |
| `auth_user_id` | uuid | FK a `auth.users(id)` |
| `email` | text, unique | |
| `created_at` | timestamptz | default `now()` |

Una sola fila hoy (la cuenta compartida de FM), pero modelada como tabla real — visible y editable en Supabase Studio — en vez de un correo quemado en código o en variables de entorno. RLS: activado, deny-all salvo `service_role` (mismo patrón que el resto del esquema).

No hay UI para gestionar `usuarios_fm` en esta fase — la única fila se crea manualmente (Supabase Studio o un script, igual que `scripts/seed-pilot-comercio.ts` siembra el comercio piloto hoy), después de crear la cuenta correspondiente en Supabase Auth.

### Columnas nuevas en `comercios` (licencia)

| Campo | Tipo | Notas |
|---|---|---|
| `licencia_estado` | text, check (`activo`\|`inactivo`) | default `activo` |
| `licencia_plan` | text, nullable | texto libre (ej. "Básico", "Premium") |
| `licencia_monto_mensual` | numeric, nullable | seguimiento manual, sin pasarela de pago |
| `licencia_activa_desde` | timestamptz, nullable | |

Deliberadamente simple y mutable (no versionado con historial) — es seguimiento manual para el piloto, no facturación real. Los campos de branding (`nombre`, `slug`, `color_fondo`, `color_texto`, `color_label`, `logo_url`, `strip_url`, `hero_url`) ya existen desde la Fase 0; esta fase solo agrega la UI para editarlos.

## 5. Componentes

1. **`/admin/login`** — formulario email + contraseña. Usa `createBrowserClient` de `@supabase/ssr` (NO el `createClient` plano de `@supabase/supabase-js` que ya se usa del lado del servidor) para `supabase.auth.signInWithPassword` — usar el cliente equivocado guardaría la sesión en `localStorage` en vez de cookies, y rompería en silencio todos los chequeos del servidor descritos abajo.
2. **`verifyFmAdmin()`** — un único helper de servidor, no un chequeo "solo en el layout". Lee la sesión con `createServerClient` de `@supabase/ssr` (el tercer y último cliente de Supabase de este diseño, junto al `createServiceClient()` de siempre y al `createBrowserClient` del login) y confirma la fila en `usuarios_fm`. Envuelto en `cache()` de React, ya que se llama varias veces por request (layout + página + posible Server Action) y no hay razón para repetir la consulta. Next.js 16 (este proyecto) renombró Middleware a Proxy, y su propia guía de autenticación advierte explícitamente que los layouts no se vuelven a renderizar en navegación del lado del cliente dentro de App Router — un chequeo únicamente ahí puede no detectar una sesión vencida al navegar entre páginas. Por eso `verifyFmAdmin()` se llama desde **tres lugares**: el layout de `/admin` (primera barrera), cada página bajo `/admin` (defensa en profundidad, siguiendo la guía del propio framework), y cada Server Action de creación/edición (para que una acción invocada directamente nunca dependa solo del chequeo de la página). Además, se necesita un `proxy.ts` (el archivo que reemplaza a `middleware.ts` en Next.js 16) para refrescar la cookie de sesión de Supabase — los Server Components no pueden escribir cookies, por lo que ese refresco no puede vivir únicamente en las páginas.
3. **Logout** — una acción simple que cierra la sesión de Supabase Auth y redirige a `/admin/login`.
4. **`/admin/comercios`** — lista de comercios: nombre, slug, estado de licencia, monto mensual.
5. **`/admin/comercios/nuevo`** — formulario de alta: nombre, slug, 3 colores (`rgb(r,g,b)`), URLs de logo/franja/imagen principal, campos de licencia.
6. **`/admin/comercios/[id]/editar`** — mismo formulario, precargado, para editar un comercio existente.
7. **Server Actions** de creación/edición — validan (slug único, formato de color) y escriben con `createServiceClient()` (mismo cliente de servidor de siempre), después de que `verifyFmAdmin()` confirme la sesión.

## 6. Flujo de datos

**Login:** FM ingresa email+contraseña (vía `createBrowserClient`) → Supabase Auth crea la sesión (cookie httpOnly) → redirige a `/admin/comercios`.

**`proxy.ts`** refresca la cookie de sesión de Supabase en cada request que toque `/admin/*` (los Server Components no pueden escribir cookies, por eso este paso no puede vivir solo en las páginas).

**Cada página y Server Action de `/admin`:** llama a `verifyFmAdmin()` — valida la sesión y confirma la fila en `usuarios_fm` — antes de renderizar o procesar cualquier acción. El layout hace la primera verificación; páginas y Server Actions repiten la misma verificación como defensa en profundidad, no confían solo en el layout.

**Crear/editar comercio:** formulario → Server Action (con `verifyFmAdmin()` ya pasado) → valida slug único y formato de color → `createServiceClient()` inserta/actualiza → redirige a la lista.

**Logout:** cierra la sesión de Supabase Auth → redirige a `/admin/login`.

## 7. Manejo de errores

- Slug duplicado al crear → mensaje claro en el formulario, no un 500.
- Color que no calza con el formato `rgb(r,g,b)` → se rechaza en el formulario antes de guardar (un color mal formado rompería la firma del pass después — lección de la Fase 1).
- Sesión vencida a medio formulario → redirige a login con el mensaje de error pasado por parámetro de consulta (ej. `?error=sesion-vencida`), para no perderlo en la redirección.
- Intento de acceso a `/admin/*` sin sesión o sin fila en `usuarios_fm` → redirige a login; nunca expone datos de comercios.
- Contraseña olvidada de la cuenta compartida de FM → fuera de alcance de esta fase; se resetea manualmente vía Supabase Studio (son 2 personas, no amerita un flujo de "olvidé mi contraseña" todavía).

## 8. Pruebas

- Integración para el chequeo "es admin de FM": sesión válida + fila en `usuarios_fm` → pasa; sesión válida sin fila → rechaza; sin sesión → rechaza. Mismo patrón de pruebas de integración contra Supabase real usado en toda la Fase 0+1.
- Integración para crear/editar un comercio: inserta, verifica columnas (incluida la licencia), limpia.
- Unitaria para la validación de formato de color.

## 9. Explícitamente fuera de alcance de esta fase

- **Tarjetas de sellos (stamp cards)** — un tipo de tarjeta alterno (grid visual de sellos en vez de un número de puntos). Necesita un nuevo `tipo` en `reglas_puntos`, un diseño nuevo del pass (imagen compuesta, no un campo de texto), y campos de branding que hoy no existen (imagen de fondo, degradado, ícono de sello). Queda como su propia sesión de diseño futura, probablemente justo antes o junto con la Fase 3.
- **Catálogo de tipos de tarjeta que un comercio puede "contratar"** — inspirado en un producto competidor que el usuario encontró. No tiene sentido diseñarlo hasta que existan al menos 2-3 tipos de tarjeta reales construidos (hoy solo existe "puntos"). Revisar una vez que las tarjetas de sellos estén implementadas.
- **Panel de autogestión del dueño de comercio (Fases 3+4 del spec original)** — reglas de puntos y catálogo de recompensas configurables por el propio dueño (Fase 3), más su login con rol (Fase 4), con subida real de imágenes (a diferencia de este panel interno de FM, que usa campos de texto/URL simples). Sigue siendo la siguiente fase después de esta.
- **Facturación real / pasarela de pago** — los campos de licencia en esta fase son de seguimiento manual únicamente.

## 10. Decisiones registradas

- Cuenta de FM: **una sola cuenta compartida** de Supabase Auth (email+contraseña), no cuentas individuales por persona.
- Identidad de "es admin de FM": tabla real `usuarios_fm`, no un correo quemado en código ni en variables de entorno — consistente con cómo el resto del proyecto modela acceso (filas reales, visibles en Supabase Studio).
- Licencia: campos simples y mutables en `comercios`, sin historial versionado ni integración de pago — seguimiento manual para el piloto.
- Branding editable desde este panel: los campos que ya existen en el esquema (nombre, colores, URLs de imagen como texto). Sin subida de archivos en este panel interno — eso se reserva para el panel de autogestión del dueño (Fase 3), donde sí importa una buena UX de carga de imágenes.
- Esta fase instala `@supabase/ssr` y construye el primer flujo real de autenticación del proyecto — la Fase 4 (login de dueño/cajero) reutiliza directamente este mismo patrón en vez de construirlo de nuevo.

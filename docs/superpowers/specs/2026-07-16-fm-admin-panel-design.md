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
- **Comercio (dueño/cajero)** — sin cambios en esta fase; su login sigue siendo una fase futura (Fase 3 del spec original).
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

### Columnas nuevas en `comercios` (licencia)

| Campo | Tipo | Notas |
|---|---|---|
| `licencia_estado` | text, check (`activo`\|`inactivo`) | default `activo` |
| `licencia_plan` | text, nullable | texto libre (ej. "Básico", "Premium") |
| `licencia_monto_mensual` | numeric, nullable | seguimiento manual, sin pasarela de pago |
| `licencia_activa_desde` | timestamptz, nullable | |

Deliberadamente simple y mutable (no versionado con historial) — es seguimiento manual para el piloto, no facturación real. Los campos de branding (`nombre`, `slug`, `color_fondo`, `color_texto`, `color_label`, `logo_url`, `strip_url`, `hero_url`) ya existen desde la Fase 0; esta fase solo agrega la UI para editarlos.

## 5. Componentes

1. **`/admin/login`** — formulario email + contraseña. Primer uso en el proyecto de un cliente de Supabase en el navegador (con la anon key) para `supabase.auth.signInWithPassword`.
2. **Layout protegido `/admin/*`** — cada request bajo este layout valida la sesión (vía `@supabase/ssr`, lectura de cookies) y confirma que exista una fila en `usuarios_fm` para ese `auth_user_id`; si no, redirige a `/admin/login`.
3. **`/admin/comercios`** — lista de comercios: nombre, slug, estado de licencia, monto mensual.
4. **`/admin/comercios/nuevo`** — formulario de alta: nombre, slug, 3 colores (`rgb(r,g,b)`), URLs de logo/franja/imagen principal, campos de licencia.
5. **`/admin/comercios/[id]/editar`** — mismo formulario, precargado, para editar un comercio existente.
6. **Server Actions** de creación/edición — validan (slug único, formato de color) y escriben con `createServiceClient()` (mismo cliente de servidor de siempre), después de confirmar que quien llama es un admin de FM autenticado.

## 6. Flujo de datos

**Login:** FM ingresa email+contraseña → Supabase Auth crea la sesión (cookie httpOnly vía `@supabase/ssr`) → redirige a `/admin/comercios`.

**Cada página de `/admin`:** valida la sesión y la fila en `usuarios_fm` en el servidor antes de renderizar o procesar cualquier acción.

**Crear/editar comercio:** formulario → Server Action → valida slug único y formato de color → `createServiceClient()` inserta/actualiza → redirige a la lista.

## 7. Manejo de errores

- Slug duplicado al crear → mensaje claro en el formulario, no un 500.
- Color que no calza con el formato `rgb(r,g,b)` → se rechaza en el formulario antes de guardar (un color mal formado rompería la firma del pass después — lección de la Fase 1).
- Sesión vencida a medio formulario → redirige a login sin perder el mensaje de error ya mostrado.
- Intento de acceso a `/admin/*` sin sesión o sin fila en `usuarios_fm` → redirige a login; nunca expone datos de comercios.

## 8. Pruebas

- Integración para el chequeo "es admin de FM": sesión válida + fila en `usuarios_fm` → pasa; sesión válida sin fila → rechaza; sin sesión → rechaza. Mismo patrón de pruebas de integración contra Supabase real usado en toda la Fase 0+1.
- Integración para crear/editar un comercio: inserta, verifica columnas (incluida la licencia), limpia.
- Unitaria para la validación de formato de color.

## 9. Explícitamente fuera de alcance de esta fase

- **Tarjetas de sellos (stamp cards)** — un tipo de tarjeta alterno (grid visual de sellos en vez de un número de puntos). Necesita un nuevo `tipo` en `reglas_puntos`, un diseño nuevo del pass (imagen compuesta, no un campo de texto), y campos de branding que hoy no existen (imagen de fondo, degradado, ícono de sello). Queda como su propia sesión de diseño futura, probablemente justo antes o junto con la Fase 3.
- **Catálogo de tipos de tarjeta que un comercio puede "contratar"** — inspirado en un producto competidor que el usuario encontró. No tiene sentido diseñarlo hasta que existan al menos 2-3 tipos de tarjeta reales construidos (hoy solo existe "puntos"). Revisar una vez que las tarjetas de sellos estén implementadas.
- **Panel de autogestión del dueño de comercio (Fase 3 del spec original)** — reglas de puntos y catálogo de recompensas configurables por el propio dueño, con subida real de imágenes (a diferencia de este panel interno de FM, que usa campos de texto/URL simples). Sigue siendo la siguiente fase después de esta.
- **Facturación real / pasarela de pago** — los campos de licencia en esta fase son de seguimiento manual únicamente.

## 10. Decisiones registradas

- Cuenta de FM: **una sola cuenta compartida** de Supabase Auth (email+contraseña), no cuentas individuales por persona.
- Identidad de "es admin de FM": tabla real `usuarios_fm`, no un correo quemado en código ni en variables de entorno — consistente con cómo el resto del proyecto modela acceso (filas reales, visibles en Supabase Studio).
- Licencia: campos simples y mutables en `comercios`, sin historial versionado ni integración de pago — seguimiento manual para el piloto.
- Branding editable desde este panel: los campos que ya existen en el esquema (nombre, colores, URLs de imagen como texto). Sin subida de archivos en este panel interno — eso se reserva para el panel de autogestión del dueño (Fase 3), donde sí importa una buena UX de carga de imágenes.
- Esta fase instala `@supabase/ssr` y construye el primer flujo real de autenticación del proyecto — la Fase 3 (login de dueño/cajero) reutiliza directamente este mismo patrón en vez de construirlo de nuevo.

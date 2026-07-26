# Alta de dueños con link de invitación (versión mínima) — Plan

> **For agentic workers:** implementar con subagent-driven-development. Steps con checkbox.

**Goal:** que FM dé de alta el acceso de un dueño desde el panel, sin correr scripts y sin conocer su contraseña: genera un link que comparte por WhatsApp, y el cliente define su propia clave.

**Architecture:** `generateLink` de Supabase Auth (crea el usuario y devuelve el token, SIN enviar correo — el proyecto no tiene servicio de email). El link apunta a nuestro dominio, no al de Supabase. Una ruta de activación canjea el token por sesión y lleva a definir contraseña.

---

## Por qué esto existe

Hoy el panel de FM crea el **comercio** pero no su **dueño**: la ficha de editar solo *lee* `usuarios_comercio`. El único camino es `npm run seed-comercio -- correo contraseña slug` en la terminal de Daniel — que además elige y por lo tanto conoce la contraseña del cliente. Tampoco existe recuperación de contraseña: si un dueño la olvida, hay que volver a correr el script.

Decisiones tomadas con el usuario: el campo va en la ficha de **editar** comercio (no en la de crear); el link apunta a **nuestro dominio**.

## Restricción crítica del entorno

`proxy.ts` (matcher `/comercio/:path*`) redirige a `/comercio/login` **toda** ruta sin sesión salvo las de login. El invitado NO tiene sesión cuando abre su link, así que **sin eximir la ruta de activación el flujo se rompe entero**. Es lo primero a resolver.

## Seguridad

- Solo FM genera accesos: `verifyFmAdmin()` en la acción, FUERA de try/catch.
- **El link es una credencial temporal: NUNCA loguearlo, ni el `hashed_token`.** Ante error se loguea `error.message`, jamás el objeto con propiedades.
- El link no se guarda en BD: se muestra una vez y se regenera cuando haga falta.
- La contraseña la define el cliente; ni FM ni el código la ven nunca.

---

### Tarea 1: `lib/comercio/accesoDueno.ts` + test

**Files:** Create `lib/comercio/accesoDueno.ts`, `lib/comercio/accesoDueno.test.ts`

- [ ] **Paso 1: tests que fallan.** Integración contra Supabase real (patrón de `cajeros.test.ts`, que también crea usuarios de Auth). Casos:
  1. Dueño NUEVO: crea el usuario de Auth, crea la membresía `rol: 'owner'`, y devuelve un link que empieza con la base URL y trae `token_hash` y `tipo=invite`.
  2. Email inválido → rechazo, sin crear nada.
  3. Comercio inexistente → rechazo, sin crear nada.
  4. **Dueño que YA existe en Auth** (p. ej. ya es dueño de otro comercio): no falla; devuelve link con `tipo=recovery` y crea la membresía del comercio nuevo.
  5. **Idempotencia:** llamar dos veces con el mismo correo y comercio no duplica la membresía (el unique es `(comercio_id, email)`).

  Teardown en orden FK: `usuarios_comercio` → `auth.admin.deleteUser`. Registrar TODO lo creado apenas se crea (incluido lo que crea la función bajo prueba), y **sufijo por corrida** en los correos (`${Date.now()}-${random}`) — la BD es la de producción donde el usuario hace QA.

- [ ] **Paso 2: implementar.** Firma:

```ts
export async function generarAccesoDueno(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  email: string,
  baseUrl: string,
): Promise<{ ok: true; link: string } | { ok: false; error: string }>
```

Orden y reglas:
1. Normalizar y validar el email (mismo `EMAIL_RE` que `cajeros.ts` — importalo o replicá el criterio, no inventes otro).
2. Verificar que el comercio existe (si no, error claro).
3. `generateLink({ type: 'invite', email })`. Si falla porque el usuario ya está registrado, reintentar con `{ type: 'recovery', email }` — un dueño que ya existe no puede ser "invitado" de nuevo, pero sí puede recibir un link para definir clave. Cualquier otro error de Auth: loguear SOLO `error.message` y devolver error genérico.
4. Con el `user.id` que devuelve, asegurar la membresía owner en `usuarios_comercio` (insert; si ya existe por el unique `(comercio_id, email)`, tratarlo como éxito — es idempotente a propósito).
5. Armar el link con `properties.hashed_token` y `properties.verification_type`:
   `${baseUrl}/comercio/activar?token_hash=${hashed_token}&tipo=${verification_type}`

- [ ] **Paso 3: MUTATION-TESTS.** (a) Quitar la validación del email → falla el caso 2. (b) Quitar el fallback a `recovery` → falla el caso 4. (c) Hacer que el insert de membresía no trate el duplicado como éxito → falla el caso 5. Reportar los mensajes textuales.

- [ ] **Paso 4:** typecheck, lint, `npm test -- lib/comercio/accesoDueno.test.ts`.

---

### Tarea 2: Eximir la ruta de activación en el proxy

**Files:** Modify `lib/supabase/proxy.ts`

- [ ] La constante `esRutaLogin` pasa a cubrir también la activación. Renombrala a algo que diga la verdad (p. ej. `esRutaPublicaDeComercio`) y **conservá el anclado exacto** que el comentario existente explica (nada de `startsWith` suelto: `/comercio/activar` y sus sub-rutas, no `/comercio/activarXYZ`). Comentá POR QUÉ se exime: el invitado no tiene sesión todavía y sin esto su link cae en el login.

- [ ] Verificá que `/comercio/clave` **no** necesita exención (ahí ya hay sesión, la creó la activación) y dejalo escrito en el comentario.

---

### Tarea 3: Ruta de activación + pantalla de contraseña

**Files:** Create `app/comercio/activar/route.ts`, `app/comercio/clave/page.tsx`, `app/comercio/clave/actions.ts`, `app/comercio/clave/FormularioClave.tsx`

- [ ] **Route Handler GET `/comercio/activar`:** lee `token_hash` y `tipo`; llama `verifyOtp({ token_hash, type })` con `createClienteServidor()` (en un Route Handler la escritura de cookies SÍ es legal — ver el comentario de `server.ts`). Con éxito → redirect a `/comercio/clave`. Sin token, con token inválido o vencido → redirect a `/comercio/login?error=link-vencido`. Usá `NextResponse.redirect` con URL absoluta derivada del request. **No loguees el token.**

- [ ] **`/comercio/clave`:** Server Component que exige sesión (`getClaims()`, FUERA de try/catch; sin sesión → redirect al login). Formulario con contraseña y confirmación.

- [ ] **Server Action:** valida largo mínimo 8 (mismo criterio que `cajeros.ts`) y que ambas coincidan; `updateUser({ password })`; al éxito redirect a `/comercio/panel`. Errores devueltos al formulario, **nunca** la contraseña a un log.

- [ ] **En el login**, mostrar el mensaje de `?error=link-vencido` explicando que hay que pedirle a FM un link nuevo. Mirá cómo el login ya maneja `?error=sin-permiso` y seguí ese patrón.

---

### Tarea 4: UI en el panel de FM

**Files:** Modify `app/admin/(protegido)/comercios/[id]/editar/page.tsx` y sus `actions.ts`; Create el componente del formulario

- [ ] **Acción `accionGenerarAcceso(comercioId, estadoPrevio, formData)`:** `verifyFmAdmin()` FUERA de try/catch; llama `generarAccesoDueno` con `NEXT_PUBLIC_BASE_URL`; devuelve `{ link }` o `{ error }`. Si falta la base URL, error claro (sin ella el link sería inservible).

- [ ] **UI:** debajo de la lista de dueños que ya existe, un campo de correo + botón "Generar acceso". Al volver con éxito, mostrar el link en un bloque **seleccionable y fácil de copiar** (que se pueda tocar y copiar desde el teléfono), con una nota de que vence en 24 horas y que se comparte por WhatsApp.

- [ ] Junto a cada dueño ya listado, un botón **"Regenerar link"** que llama la misma acción con su correo (sirve para link vencido y para contraseña olvidada).

- [ ] **El link NO se persiste** en ningún lado: vive solo en el estado del formulario.

---

## Definition of done

- Suite completa verde, typecheck y lint limpios.
- Mutation-tests de la Tarea 1 ejecutados y reportados.
- La BD de producción sin residuos de las corridas de prueba (verificado con consulta de solo lectura).
- Probado de punta a punta por el usuario: generar link → abrirlo → definir clave → entrar al panel.

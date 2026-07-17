# Panel de administración de FM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un panel interno protegido por login donde FM lista, crea y edita sus comercios clientes — su licencia (activo/inactivo, plan, monto) y su branding existente (nombre, colores, URLs de imágenes).

**Architecture:** Primer flujo de autenticación real del proyecto: Supabase Auth (email+contraseña) vía `@supabase/ssr`, con un `proxy.ts` (Next.js 16 renombró Middleware a Proxy) que refresca la cookie de sesión, y un helper `verifyFmAdmin()` llamado desde el layout, cada página y cada Server Action. La lógica de datos vive en funciones puras de `lib/` (testeables contra la BD real), y los Server Actions son cascarones delgados que autentican, parsean el formulario y delegan — el mismo patrón que ya usa `registrarCliente`.

**Tech Stack:** Next.js 16 (App Router, Proxy, Server Actions), `@supabase/ssr` 0.12.x, Supabase Auth + Postgres, Vitest (integración contra Supabase real).

---

## Alcance de este plan

Implementa el spec [2026-07-16-fm-admin-panel-design.md](../specs/2026-07-16-fm-admin-panel-design.md) completo. **Fuera de alcance** (ver §9 del spec): tarjetas de sellos, catálogo de tipos de tarjeta, el panel de autogestión del dueño de comercio, facturación real, y recuperación de contraseña (se resetea a mano en Supabase Studio).

## Hechos verificados que este plan asume

Investigados y confirmados contra los docs empaquetados del propio proyecto (`node_modules/next/dist/docs/`) y las fuentes actuales de Supabase. **Confía en estos por encima de tu memoria de entrenamiento** — varios contradicen tutoriales comunes:

1. **`proxy.ts` va en la raíz del repo** (junto a `app/`, este proyecto no tiene `src/`). Export `proxy`, default o nombrado. Corre en **Node por defecto** — el runtime Edge NO es soportado en Proxy y no se puede configurar.
2. **`cookies()` es async** → `const cookieStore = await cookies()`.
3. **Escribir cookies NO funciona durante el render de un Server Component.** Solo en Server Actions, Route Handlers, o el Proxy (vía `NextResponse.cookies`). Por eso el `setAll` del cliente de servidor lleva un `try/catch` que traga el error.
4. **`@supabase/ssr` 0.12.3 pide `@supabase/supabase-js ^2.110.5`; el proyecto tiene exactamente `2.110.2`.** Un `npm install @supabase/ssr` a secas dará conflicto de peer deps — hay que subir supabase-js en el mismo comando (Tarea 2).
5. **El adaptador de cookies actual es `{ getAll, setAll }`** (`{get,set,remove}` está deprecado). **`setAll` recibe DOS argumentos: `(cookiesToSet, headers)`** — el 2º son cache-headers que evitan que un CDN cachee respuestas con tokens refrescados y filtre sesiones entre usuarios. Casi ningún tutorial lo tiene.
6. **Nunca uses `getSession()` en código de servidor** (no garantiza revalidar el token). El reemplazo actual es **`getClaims()`** — no `getUser()`.
7. **`redirect()` lanza `NEXT_REDIRECT`** → siempre llamarlo FUERA de un `try/catch`, o la navegación se traga en silencio.
8. **Los Server Actions son POST a la ruta donde se usan**, no rutas propias. Un matcher del Proxy que excluya un path también salta los Server Actions de ese path. Los docs de Next dicen textual: *"Always verify authentication and authorization inside each Server Function rather than relying on Proxy alone."* → por eso cada acción llama a `verifyFmAdmin()`.
9. **El snippet del DAL en la guía de auth de Next tiene un bug**: usa `cache(...)` y `redirect(...)` sin importarlos. No lo copies tal cual.
10. Supabase **ya migró su guía oficial a `proxy.ts`** y usa `lib/supabase/` — coincide con la estructura de este proyecto, sin adaptaciones.

## Prerrequisitos

- Rama nueva desde `master` (ver Tarea 0).
- `.env.local` en la raíz ya tiene `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`. **No se agregan variables nuevas.**
- `node_modules` instalado (`npm install`).

---

### Task 0: Rama de trabajo

- [ ] **Step 1: Crear la rama**

```bash
git checkout -b feature/fm-admin-panel
git status
```
Expected: `On branch feature/fm-admin-panel`, working tree clean.

---

### Task 1: Migración 0003 — `usuarios_fm` + columnas de licencia

**Files:**
- Create: `supabase/migrations/0003_usuarios_fm_y_licencias.sql`
- Modify: `lib/supabase/types.ts`

- [ ] **Step 1: Escribir la migración**

Create `supabase/migrations/0003_usuarios_fm_y_licencias.sql`:

```sql
-- 0003: Panel de administración de FM.
-- Migraciones anteriores ya aplicadas a la base viva; todo cambio es append-only.

-- Quién es administrador de FM (la plataforma), no de un comercio.
-- Hoy tendrá UNA sola fila: la cuenta compartida de Daniel + socio. Se modela como tabla
-- real (no un correo quemado en código/env) para ser visible y editable en Supabase Studio,
-- consistente con cómo el resto del esquema modela acceso.
create table usuarios_fm (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id),
  email text not null unique,
  created_at timestamptz not null default now()
);

alter table usuarios_fm enable row level security;
-- Sin políticas: deny-all salvo service_role, igual que el resto del esquema.

-- Licencia del comercio. Seguimiento MANUAL para el piloto: sin historial versionado y sin
-- pasarela de pago (ver spec §9). Simple y mutable a propósito.
alter table comercios
  add column licencia_estado text not null default 'activo'
    check (licencia_estado in ('activo', 'inactivo')),
  add column licencia_plan text,
  add column licencia_monto_mensual numeric,
  add column licencia_activa_desde timestamptz;
```

- [ ] **Step 2: Aplicar la migración (manual)**

Dashboard de Supabase → **SQL Editor** → pegar el contenido → **Run**.
Expected: "Success. No rows returned". La tabla `usuarios_fm` aparece en Table Editor y `comercios` tiene las 4 columnas nuevas.

- [ ] **Step 3: Actualizar el tipo `Database`**

`lib/supabase/types.ts` está transcrito a mano (ver su encabezado) y debe actualizarse en el mismo commit que la migración.

En el bloque de `comercios`, agrega a `Row` (todas las nuevas son nullable salvo `licencia_estado`):
```typescript
          licencia_estado: string;
          licencia_plan: string | null;
          licencia_monto_mensual: number | null;
          licencia_activa_desde: string | null;
```
a `Insert` (todas opcionales — `licencia_estado` tiene default):
```typescript
          licencia_estado?: string;
          licencia_plan?: string | null;
          licencia_monto_mensual?: number | null;
          licencia_activa_desde?: string | null;
```
y a `Update` (todas opcionales, igual que las demás).

Agrega la tabla nueva completa al objeto `Tables`, siguiendo el patrón exacto de `usuarios_comercio`:
```typescript
      usuarios_fm: {
        Row: {
          id: string;
          auth_user_id: string;
          email: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          auth_user_id: string;
          email: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          auth_user_id?: string;
          email?: string;
          created_at?: string;
        };
        Relationships: [];
      };
```

- [ ] **Step 4: Verificar contra la BD real**

Modify `scripts/verify-schema.ts`: agrega `'usuarios_fm'` al arreglo `TABLAS` (respeta el `as const`).

Run: `npm run verify-schema`
Expected: `OK: usuarios_fm` junto a las otras 9 tablas, sin errores.

- [ ] **Step 5: Gates + commit**

Run: `npm run typecheck` → limpio.
```bash
git add -A
git commit -m "Add usuarios_fm table and comercio licensing columns"
```

---

### Task 2: Instalar `@supabase/ssr` + clientes de navegador y de servidor

**Files:**
- Modify: `package.json`
- Create: `lib/supabase/client.ts`
- Modify: `lib/supabase/server.ts`

- [ ] **Step 1: Instalar (con el bump de peer dep)**

`@supabase/ssr` 0.12.x pide `@supabase/supabase-js ^2.110.5` y el proyecto tiene exactamente `2.110.2`. Instalar ambos en un solo comando evita el `ERESOLVE`:

Run: `npm install @supabase/ssr @supabase/supabase-js@latest`
Expected: instala sin conflicto de peer deps. Si aún así falla, reporta el error — NO uses `--force` ni `--legacy-peer-deps` sin avisar.

Verifica que la suite existente siga verde tras el bump de supabase-js:
Run: `npm test`
Expected: 34 passed. Si algo se rompe por el bump, repórtalo antes de seguir.

- [ ] **Step 2: Cliente de navegador**

Create `lib/supabase/client.ts`:

```typescript
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './types';

// Cliente de Supabase para el NAVEGADOR (usa la anon key, respeta RLS).
// OJO: debe ser createBrowserClient de @supabase/ssr, NO el createClient plano de
// @supabase/supabase-js — el cliente equivocado guarda la sesión en localStorage en vez de
// cookies, y entonces el servidor nunca la ve (los chequeos de auth fallarían en silencio).
export function createClienteNavegador() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

Nota: aquí NO se usa `requireEnv()` — este archivo corre en el navegador, donde `lib/env.ts` no aplica igual y Next inyecta las `NEXT_PUBLIC_*` en build. El `!` es aceptable en este caso puntual.

- [ ] **Step 3: Cliente de servidor con sesión de usuario**

Modify `lib/supabase/server.ts` — AGREGA (no reemplaces) junto al `createServiceClient()` existente. Los nombres se mantienen distintos a propósito: `createServiceClient` (service role, ignora RLS) vs `createClienteServidor` (sesión del usuario).

```typescript
import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from './types';
import { requireEnv } from '@/lib/env';

export function createServiceClient() {
  return createClient<Database>(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
  );
}

// Cliente de servidor ATADO A LA SESIÓN del usuario (lee cookies). Distinto del service
// client de arriba, que ignora RLS y no tiene sesión.
export async function createClienteServidor() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Escribir cookies lanza durante el render de un Server Component (limitación de
            // Next). Se ignora a propósito: el proxy.ts es quien persiste el refresco.
          }
        },
      },
    },
  );
}
```

- [ ] **Step 4: Gates + commit**

Run: `npm run typecheck`, `npm run lint`, `npm test` (34 passed).
```bash
git add -A
git commit -m "Add @supabase/ssr browser and session-bound server clients"
```

---

### Task 3: `proxy.ts` — refresco de la cookie de sesión

**Files:**
- Create: `lib/supabase/proxy.ts`
- Create: `proxy.ts` (RAÍZ del repo, junto a `app/`)

- [ ] **Step 1: Helper de refresco**

Create `lib/supabase/proxy.ts`:

```typescript
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from './types';
import { requireEnv } from '@/lib/env';

// Refresca la cookie de sesión de Supabase en cada request a /admin/*. Esto NO puede vivir
// solo en las páginas: los Server Components no pueden escribir cookies (limitación de Next),
// así que sin este paso la sesión expira y el usuario es expulsado al azar.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
          // 2º argumento: cache-headers. Sin esto, un CDN podría cachear una respuesta con
          // tokens refrescados y filtrar la sesión a otro usuario.
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value),
          );
        },
      },
    },
  );

  // No metas código entre createServerClient y getClaims(): un error aquí es dificilísimo de
  // depurar (usuarios deslogueados al azar). getClaims() — NO getSession(), que no garantiza
  // revalidar el token en servidor.
  const { data } = await supabase.auth.getClaims();
  const usuario = data?.claims;

  // Anclado a propósito: un startsWith suelto también eximiría a /admin/login-sso o
  // /admin/loginXYZ, heredando una exención que nadie pidió. Así solo se eximen /admin/login
  // y sus sub-rutas legítimas (p. ej. un futuro /admin/login/reset).
  const ruta = request.nextUrl.pathname;
  const esRutaLogin = ruta === '/admin/login' || ruta.startsWith('/admin/login/');

  // Primera barrera (rápida). El gate real es verifyFmAdmin() en layout/página/acción.
  // /admin/login se excluye o se cicla infinitamente contra sí mismo.
  if (!usuario && !esRutaLogin) {
    const url = request.nextUrl.clone();
    url.pathname = '/admin/login';
    // clone() conserva el query string y cambiar .pathname no lo limpia: sin esto,
    // /admin/comercios?error=sin-permiso mostraría "sin permiso" a alguien que solo no tiene
    // sesión. Nada necesita preservarlo: el login redirige a un destino fijo.
    url.search = '';
    const respuesta = NextResponse.redirect(url);
    // Si getClaims() detectó un token muerto, setAll ya escribió las cookies de borrado en
    // supabaseResponse; devolver un redirect nuevo sin copiarlas las tiraría — justo lo que
    // advierte el comentario del final de esta función.
    supabaseResponse.cookies.getAll().forEach((c) => respuesta.cookies.set(c));
    return respuesta;
  }

  // Devolver supabaseResponse tal cual: si lo reemplazas por otro NextResponse sin copiar las
  // cookies, navegador y servidor se desincronizan y la sesión muere antes de tiempo.
  return supabaseResponse;
}
```

- [ ] **Step 2: El proxy**

Create `proxy.ts` en la **raíz del repo** (mismo nivel que `app/`, NO dentro de `app/`):

```typescript
import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

// Next.js 16 renombró Middleware a Proxy. Corre en runtime Node (Edge no es soportado aquí).
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Solo el panel de FM necesita sesión. El resto del sitio (registro público, endpoints de
  // Apple Wallet) es público y no debe pagar este costo.
  matcher: '/admin/:path*',
};
```

- [ ] **Step 3: Verificar que compila y que el resto del sitio sigue vivo**

Run: `npm run build`
Expected: build exitoso, sin advertencias de config desconocida.

Run: `npm run dev` y en otra terminal:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/registro/cafeteria-piloto
```
Expected: `200` — el proxy NO debe afectar rutas públicas. Detén el dev server.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add Next 16 proxy for Supabase session refresh on /admin"
```

---

### Task 4: `esAdminFm()` (testeable) + `verifyFmAdmin()` (el gate)

Se parten en dos a propósito: la consulta a la BD se puede testear de verdad contra Supabase; el envoltorio que lee cookies necesita un contexto de request de Next y se verifica a mano en la Tarea 10.

**Files:**
- Create: `lib/fm/esAdminFm.ts`
- Test: `lib/fm/esAdminFm.test.ts`
- Create: `lib/fm/verifyFmAdmin.ts`

- [ ] **Step 1: Escribir el test que falla**

Create `lib/fm/esAdminFm.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { esAdminFm } from './esAdminFm';

const supabase = createServiceClient();
const usuariosCreados: string[] = [];

afterEach(async () => {
  // Orden importante: la FK usuarios_fm.auth_user_id -> auth.users NO tiene cascade, así que la
  // fila va antes que el usuario. Los fallos se registran en vez de tragarse: un borrado que
  // falla deja basura que ninguna prueba volvería a sacar a la luz.
  for (const id of usuariosCreados) {
    const { error: errorFila } = await supabase.from('usuarios_fm').delete().eq('auth_user_id', id);
    if (errorFila) console.error('[test] no se pudo borrar la fila de usuarios_fm:', errorFila);
    const { error: errorUsuario } = await supabase.auth.admin.deleteUser(id);
    if (errorUsuario) console.error('[test] no se pudo borrar el usuario de auth:', errorUsuario);
  }
  usuariosCreados.length = 0;
});

async function crearUsuarioAuth(): Promise<string> {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase.auth.admin.createUser({
    email: `test-fm-${sufijo}@ejemplo.test`,
    password: 'contrasena-de-prueba-1234',
    email_confirm: true,
  });
  if (error) throw error;
  usuariosCreados.push(data.user.id);
  return data.user.id;
}

async function hacerAdmin(id: string) {
  const { error } = await supabase
    .from('usuarios_fm')
    .insert({ auth_user_id: id, email: `fm-${id}@ejemplo.test` });
  if (error) throw error;
}

describe('esAdminFm', () => {
  it('devuelve true cuando el usuario tiene fila en usuarios_fm', async () => {
    const id = await crearUsuarioAuth();
    await hacerAdmin(id);

    expect(await esAdminFm(supabase, id)).toBe(true);
  });

  it('devuelve false cuando el usuario existe pero NO tiene fila en usuarios_fm', async () => {
    const id = await crearUsuarioAuth();

    expect(await esAdminFm(supabase, id)).toBe(false);
  });

  it('devuelve false para un id que no existe', async () => {
    expect(await esAdminFm(supabase, '00000000-0000-0000-0000-000000000000')).toBe(false);
  });

  // Esta prueba existe por el .eq('auth_user_id', ...) de esAdminFm. Con la tabla vacía, un
  // maybeSingle() SIN filtro devuelve lo mismo que uno con filtro, así que las tres pruebas de
  // arriba siguen pasando aunque se borre el .eq(). Aquí hay una fila de OTRO usuario: sin el
  // filtro, maybeSingle() la devolvería y el intruso pasaría como admin.
  //
  // OJO: esto solo muerde si la tabla queda con UNA fila. maybeSingle() con 2+ filas devuelve
  // error PGRST116, que esAdminFm convierte en false — o sea que con basura acumulada la versión
  // mutada también daría false y esta prueba pasaría en vano, sin avisar de nada.
  it('devuelve false para un usuario sin fila aunque OTRO usuario sí sea admin', async () => {
    const idAdmin = await crearUsuarioAuth();
    await hacerAdmin(idAdmin);
    const idIntruso = await crearUsuarioAuth();

    expect(await esAdminFm(supabase, idIntruso)).toBe(false);
  });
});
```

Run: `npm test -- esAdminFm`
Expected: FAIL — `Cannot find module './esAdminFm'`.

- [ ] **Step 2: Implementar**

Create `lib/fm/esAdminFm.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

// ¿Este usuario autenticado es administrador de FM (la plataforma)?
// Separado de verifyFmAdmin() para poder testear la consulta contra la BD real sin necesitar
// un contexto de request de Next.
export async function esAdminFm(
  supabase: SupabaseClient<Database>,
  authUserId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('usuarios_fm')
    .select('id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (error) {
    // maybeSingle() devuelve error: null cuando no hay filas — así que un error aquí SIEMPRE
    // es infraestructura (llave revocada, migración rota, red), nunca un "no es admin".
    // Seguimos fallando cerrado (false), pero dejamos rastro: sin esto una caída total se ve
    // idéntica a una denegación rutinaria, y el admin recibiría "no tienes acceso" —mentira—
    // sin una sola línea de log que lo explique.
    console.error('[fm] falló la consulta de usuarios_fm; se deniega por seguridad:', error);
    return false;
  }

  return Boolean(data);
}
```

Run: `npm test -- esAdminFm`
Expected: 4 passed. (La rama de error queda sin cobertura a propósito: requiere una BD rota
para dispararse y no vale la pena simularla aquí.)

- [ ] **Step 3: El gate**

Create `lib/fm/verifyFmAdmin.ts`:

```typescript
import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClienteServidor, createServiceClient } from '@/lib/supabase/server';
import { esAdminFm } from './esAdminFm';

// Gate de /admin. Se llama desde el layout, CADA página y CADA Server Action.
//
// Por qué no basta el layout: los layouts no se re-renderizan en navegación del lado del
// cliente (Partial Rendering), así que una sesión vencida no se detectaría al cambiar de
// página. Y los Server Actions son POST a la ruta donde se usan — los docs de Next dicen
// explícitamente que hay que verificar auth dentro de cada acción, no confiar en el Proxy.
//
// cache() lo memoiza por render pass, así que layout y página comparten una sola consulta. Un
// Server Action corre fuera de ese render pass y probablemente hará la suya: no pasa nada,
// cache() sin dispatcher simplemente ejecuta la función.
//
// OJO: redirect() funciona LANZANDO una excepción (NEXT_REDIRECT). Si envuelves una llamada a
// verifyFmAdmin() en try/catch y te tragas el error, DESACTIVAS el gate — la ejecución sigue
// como si el usuario estuviera autorizado. Llámalo siempre FUERA de cualquier try/catch.
export const verifyFmAdmin = cache(async () => {
  const supabase = await createClienteServidor();

  // getClaims(), NO getSession(): getSession() no garantiza revalidar el token en servidor.
  const { data, error } = await supabase.auth.getClaims();

  if (error) {
    // A diferencia de esAdminFm, aquí un error NO siempre es infraestructura: un refresh token
    // vencido o revocado da AuthApiError y es rutina. Pero AuthRetryableFetchError (Auth caído,
    // red) aterriza en el mismo sitio, y sin este log una caída total se vería idéntica a "no hay
    // sesión". No los separamos —warn, no error— porque el gate reacciona igual a ambos; si algún
    // día importa distinguirlos, auth-js exporta isAuthRetryableFetchError().
    console.warn('[fm] getClaims() falló; se trata como sesión ausente:', error);
  }

  const authUserId = data?.claims?.sub;

  if (!authUserId) {
    redirect('/admin/login');
  }

  // La consulta va con el service client: usuarios_fm es deny-all bajo RLS.
  const esAdmin = await esAdminFm(createServiceClient(), authUserId);
  if (!esAdmin) {
    redirect('/admin/login?error=sin-permiso');
  }

  return { authUserId };
});
```

- [ ] **Step 4: Gates + commit**

Run: `npm test` (38 passed: 34 + 4), `npm run typecheck`, `npm run lint`.
Confirma 0 filas huérfanas: los tests borran su usuario de auth y su fila.
```bash
git add -A
git commit -m "Add esAdminFm query and cached verifyFmAdmin gate"
```

---

### Task 5: Validación de color (TDD, función pura)

**Files:**
- Create: `lib/comercios/validarColorRgb.ts`
- Test: `lib/comercios/validarColorRgb.test.ts`

Un color mal formado rompería la firma del pass en producción (lección de la Fase 1: `passkit-generator` valida el formato y lanza). Se valida en el formulario antes de guardar.

- [ ] **Step 1: Escribir el test que falla**

Create `lib/comercios/validarColorRgb.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validarColorRgb } from './validarColorRgb';

describe('validarColorRgb', () => {
  it('acepta el formato canónico rgb(r, g, b)', () => {
    expect(validarColorRgb('rgb(35, 24, 18)')).toBe(true);
    expect(validarColorRgb('rgb(255, 255, 255)')).toBe(true);
    expect(validarColorRgb('rgb(0,0,0)')).toBe(true);
  });

  it('rechaza valores fuera del rango 0-255', () => {
    expect(validarColorRgb('rgb(256, 0, 0)')).toBe(false);
    expect(validarColorRgb('rgb(-1, 0, 0)')).toBe(false);
  });

  it('rechaza otros formatos de color', () => {
    expect(validarColorRgb('#231812')).toBe(false);
    expect(validarColorRgb('rgba(35, 24, 18, 0.5)')).toBe(false);
    expect(validarColorRgb('red')).toBe(false);
  });

  it('rechaza basura y vacío', () => {
    expect(validarColorRgb('')).toBe(false);
    expect(validarColorRgb('rgb(35, 24)')).toBe(false);
    expect(validarColorRgb('rgb(a, b, c)')).toBe(false);
  });

  // Los tres tests de abajo fijan el EJE DE FORMA. Los de arriba cubren el de valor (rangos), y
  // ninguno usa una tripleta bien formada dentro de un envoltorio malo — por eso, sin estos, se
  // puede aflojar la regex y la suite sigue verde.

  it('rechaza un rgb() válido envuelto en basura', () => {
    // Fija los anclajes ^ y $. Importa más de lo que parece: la regex de passkit-generator NO
    // está anclada (es un test de subcadena), así que la librería aceptaría estos tres y el
    // string malformado llegaría a Wallet dentro de un pass firmado. Esta es la única defensa.
    //
    // Hacen falta las dos formas: los primeros dos NO terminan en una tripleta válida, así que
    // el $ los rechaza solo y el ^ nunca se ejercita. El tercero (basura ANTES, tripleta al
    // final) es el único que fija el ^.
    expect(validarColorRgb('garbage rgb(0,0,0) garbage')).toBe(false);
    expect(validarColorRgb('rgb(0,0,0); background: url(x)')).toBe(false);
    expect(validarColorRgb('javascript:alert(1) rgb(0,0,0)')).toBe(false);
  });

  it('rechaza canales con relleno de ceros', () => {
    // Fija el \d{1,3}. El chequeo numérico NO lo cubre: Number('0000000255') === 255, así que
    // pasaría el <= 255. passkit-generator lanza con esta entrada.
    expect(validarColorRgb('rgb(0000000255,0,0)')).toBe(false);
  });

  it('rechaza RGB en mayúsculas', () => {
    // Decisión deliberada, no estilo: passkit-generator lanza con RGB(...) — el .regex() de Joi
    // distingue mayúsculas y el literal es 'rgb\(' en minúscula.
    expect(validarColorRgb('RGB(0,0,0)')).toBe(false);
  });
});
```

Run: `npm test -- validarColorRgb`
Expected: FAIL — `Cannot find module './validarColorRgb'`.

- [ ] **Step 2: Implementar**

Create `lib/comercios/validarColorRgb.ts`:

```typescript
/**
 * ¿Es un color en el formato canónico `rgb(r, g, b)` con r/g/b entre 0 y 255?
 *
 * Es el ÚNICO formato que el spec de Apple garantiza para un pass. Un valor inválido no falla
 * aquí: falla al firmar el pass, en producción, cuando un cliente intenta agregar su tarjeta.
 * Por eso se valida antes de guardar.
 */
export function validarColorRgb(valor: string): boolean {
  const match = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(valor.trim());
  if (!match) return false;

  // El límite inferior lo impone la regex: \d no matchea el signo, así que "rgb(-1, 0, 0)" ni
  // llega hasta aquí. El superior no se expresa limpio en regex, así que va numérico.
  return match.slice(1).every((n) => Number(n) <= 255);
}
```

Run: `npm test -- validarColorRgb`
Expected: 7 passed.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Add rgb color validation for comercio branding"
```

---

### Task 6: `crearComercio()` y `actualizarComercio()` (TDD)

Funciones puras de datos, igual que `registrarCliente` — los Server Actions las envuelven en la Tarea 9.

**Files:**
- Create: `lib/comercios/guardarComercio.ts`
- Test: `lib/comercios/guardarComercio.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Create `lib/comercios/guardarComercio.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearComercio, actualizarComercio, type DatosComercio } from './guardarComercio';

const supabase = createServiceClient();
const slugsDePrueba: string[] = [];

afterEach(async () => {
  if (!slugsDePrueba.length) return;
  const { error } = await supabase.from('comercios').delete().in('slug', slugsDePrueba);
  if (error) console.error('[test] no se pudieron borrar los comercios de prueba:', error);
  slugsDePrueba.length = 0;
});

function datosValidos(slug: string): DatosComercio {
  slugsDePrueba.push(slug);
  return {
    nombre: 'Comercio Test',
    slug,
    color_fondo: 'rgb(35, 24, 18)',
    color_texto: 'rgb(255, 255, 255)',
    color_label: 'rgb(255, 255, 255)',
    logo_url: null,
    strip_url: null,
    hero_url: null,
    licencia_estado: 'activo',
    licencia_plan: 'Básico',
    licencia_monto_mensual: 25,
    licencia_activa_desde: '2026-07-16',
  };
}

describe('crearComercio', () => {
  it('crea un comercio con licencia y branding', async () => {
    const slug = `test-crear-${Date.now()}`;
    const res = await crearComercio(supabase, datosValidos(slug));

    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('comercios')
      .select('nombre, licencia_estado, licencia_monto_mensual, licencia_activa_desde')
      .eq('slug', slug)
      .single();
    expect(data!.nombre).toBe('Comercio Test');
    expect(data!.licencia_estado).toBe('activo');
    // Sin Number(): PostgREST devuelve numeric como número JSON. Aserción más fuerte —
    // fallaría ruidosamente si eso cambiara, en vez de que Number() lo tapara en silencio.
    expect(data!.licencia_monto_mensual).toBe(25);
    // Fija la migración 0004: la columna es `date`, no timestamptz, y PostgREST la devuelve
    // como "2026-07-16" tal cual. Si alguien la revierte a timestamptz, esto falla — que es el
    // punto: con timestamptz, El Salvador (UTC-6) renderizaría el 15 de julio en cada fila.
    expect(data!.licencia_activa_desde).toBe('2026-07-16');
  });

  it('rechaza un slug duplicado con un mensaje claro, sin lanzar', async () => {
    const slug = `test-dup-${Date.now()}`;
    await crearComercio(supabase, datosValidos(slug));

    const res = await crearComercio(supabase, { ...datosValidos(slug), nombre: 'Otro' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/slug/i);
  });

  it('rechaza un color con formato inválido', async () => {
    const slug = `test-color-${Date.now()}`;
    const res = await crearComercio(supabase, { ...datosValidos(slug), color_fondo: '#231812' });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/color/i);
  });

  it('rechaza un monto mensual negativo', async () => {
    const slug = `test-monto-${Date.now()}`;
    const res = await crearComercio(supabase, {
      ...datosValidos(slug),
      licencia_monto_mensual: -50,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/monto/i);
  });

  it('rechaza un estado de licencia que la BD no acepta', async () => {
    const slug = `test-estado-${Date.now()}`;
    const res = await crearComercio(supabase, {
      ...datosValidos(slug),
      licencia_estado: 'suspendido',
    });

    expect(res.ok).toBe(false);
    // Debe explicar QUÉ está mal. Sin la validación, esto igual daría ok:false — pero por un
    // 23514 traducido a "No se pudo crear el comercio", que no le dice nada a nadie.
    if (!res.ok) expect(res.error).toMatch(/estado/i);
  });

  it('rechaza un nombre vacío', async () => {
    const slug = `test-nombre-${Date.now()}`;
    const res = await crearComercio(supabase, { ...datosValidos(slug), nombre: '   ' });

    expect(res.ok).toBe(false);
    // La BD acepta nombre:'' sin chistar (no hay CHECK) — validar() es la única defensa.
    if (!res.ok) expect(res.error).toMatch(/nombre/i);
  });

  it('rechaza slugs con formato inválido', async () => {
    // El slug es la URL del QR impreso, así que su forma no es cosmética.
    for (const malo of ['Test-Mayusculas', 'con espacios', 'acentué', '']) {
      // Registrar el slug que REALMENTE se inserta: el spread de abajo pisa el de datosValidos(),
      // así que sin esta línea afterEach borraría un slug que nunca existió. No muerde con el
      // código correcto (validar() rechaza los cuatro antes de insertar), pero sí cada vez que
      // se muta la regla del slug — y 'Test-Mayusculas' ni siquiera calza un barrido test-%.
      slugsDePrueba.push(malo);
      const res = await crearComercio(supabase, { ...datosValidos(`test-slug-${Date.now()}`), slug: malo });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/slug/i);
    }
  });

  it('valida los tres colores, no solo el de fondo', async () => {
    // Sin esto, una sola prueba sobre color_fondo da la impresión de que los colores están
    // cubiertos, y dos tercios de ellos no lo están. Cada uno revienta al firmar el pass.
    for (const campo of ['color_texto', 'color_label'] as const) {
      // El slug NO puede llevar el guion bajo de `campo`: la regex de slug lo rechaza y validar()
      // corta ahí, antes de llegar a los colores — la prueba fallaría por el slug, sin ejercitar
      // nunca lo que dice probar.
      const res = await crearComercio(supabase, {
        ...datosValidos(`test-${campo.replace('_', '-')}-${Date.now()}`),
        [campo]: '#231812',
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/color/i);
    }
  });

  it('rechaza un monto que no es un número', async () => {
    const slug = `test-nan-${Date.now()}`;
    // La Tarea 9 hace Number(monto): un "25a" en el formulario llega como NaN. Sin el
    // Number.isFinite, JSON.stringify(NaN) es "null" y el monto se guardaría VACÍO en silencio.
    const res = await crearComercio(supabase, { ...datosValidos(slug), licencia_monto_mensual: NaN });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/monto/i);
  });

  it('rechaza fechas inválidas o con el formato equivocado', async () => {
    // '16/07/2026' es lo que teclea alguien en El Salvador; '2026-02-31' tiene forma correcta
    // pero no existe. Las dos deben explicar qué pasa, no dar un error genérico.
    // '0000-01-01' pasa el round-trip de Date (JS representa el año 0 y lo devuelve igual) pero
    // Postgres lo rechaza con un 22008: no existe el año cero. Sin el (?!0000) sale el genérico.
    for (const mala of ['16/07/2026', 'ayer', '2026-02-31', '2026-7-6', '0000-01-01']) {
      const res = await crearComercio(supabase, {
        ...datosValidos(`test-fecha-${Date.now()}`),
        licencia_activa_desde: mala,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/fecha/i);
    }
  });

  it('normaliza espacios y guarda los opcionales vacíos como null', async () => {
    const slug = `test-normalizar-${Date.now()}`;
    const res = await crearComercio(supabase, {
      ...datosValidos(slug),
      nombre: '  Café con Espacios  ',
      color_fondo: '  rgb(35, 24, 18)  ',
      licencia_estado: '  activo  ',
      logo_url: '',
    });

    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('comercios')
      .select('nombre, color_fondo, licencia_estado, logo_url')
      .eq('slug', slug)
      .single();
    expect(data!.nombre).toBe('Café con Espacios');
    // licencia_estado es el único string que normalizar() podría olvidar trimear, y sin trim
    // '  activo  ' se rechaza con un mensaje que se ve idéntico a lo que el admin escribió.
    expect(data!.licencia_estado).toBe('activo');
    // validarColorRgb hace su propio .trim() interno, así que sin normalizar ANTES del insert
    // este valor pasaría la validación y se guardaría con los espacios intactos.
    expect(data!.color_fondo).toBe('rgb(35, 24, 18)');
    // El formulario HTML de la Tarea 9 manda '' (nunca null) para un campo opcional vacío.
    expect(data!.logo_url).toBeNull();
  });
});

describe('actualizarComercio', () => {
  it('actualiza licencia y branding de un comercio existente', async () => {
    const slug = `test-editar-${Date.now()}`;
    const creado = await crearComercio(supabase, datosValidos(slug));
    if (!creado.ok) throw new Error('el setup falló');

    const res = await actualizarComercio(supabase, creado.id, {
      ...datosValidos(slug),
      nombre: 'Nombre Editado',
      licencia_estado: 'inactivo',
    });

    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('comercios')
      .select('nombre, licencia_estado')
      .eq('id', creado.id)
      .single();
    expect(data!.nombre).toBe('Nombre Editado');
    expect(data!.licencia_estado).toBe('inactivo');
  });

  it('valida igual que crearComercio', async () => {
    // Esta es LA prueba que faltaba: borrar validar() de actualizarComercio dejaba las 7 pruebas
    // en verde, y guardaba color_fondo:'no-es-un-color' con ok:true — datos que revientan al
    // firmar el pass, en producción, sin que nada los atrape (la BD no respalda esta regla).
    const slug = `test-editar-invalido-${Date.now()}`;
    const creado = await crearComercio(supabase, datosValidos(slug));
    if (!creado.ok) throw new Error('el setup falló');

    const res = await actualizarComercio(supabase, creado.id, {
      ...datosValidos(slug),
      color_fondo: 'no-es-un-color',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/color/i);
  });

  it('falla si el comercio ya no existe, en vez de reportar éxito', async () => {
    // Sin el .select('id').single(), esto devolvía ok:true habiendo escrito cero filas.
    const res = await actualizarComercio(
      supabase,
      '00000000-0000-0000-0000-000000000000',
      datosValidos(`test-fantasma-${Date.now()}`),
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/no existe/i);
  });
});
```

Run: `npm test -- guardarComercio`
Expected: FAIL — `Cannot find module './guardarComercio'`.

- [ ] **Step 2: Implementar**

Create `lib/comercios/guardarComercio.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { validarColorRgb } from './validarColorRgb';

// Fuente única de verdad: la BD tiene check (licencia_estado in ('activo','inactivo')) en la
// migración 0003. El <select> de la Tarea 9 se construye desde esta misma constante para que el
// formulario y el validador no puedan divergir.
export const ESTADOS_LICENCIA = ['activo', 'inactivo'] as const;
export type EstadoLicencia = (typeof ESTADOS_LICENCIA)[number];

export interface DatosComercio {
  nombre: string;
  slug: string;
  color_fondo: string;
  color_texto: string;
  color_label: string;
  logo_url: string | null;
  strip_url: string | null;
  hero_url: string | null;
  licencia_estado: string;
  licencia_plan: string | null;
  licencia_monto_mensual: number | null;
  licencia_activa_desde: string | null;
}

export type ResultadoGuardar =
  | { ok: true; id: string }
  | { ok: false; error: string };

// Un opcional vacío es null, no ''. El formulario HTML de la Tarea 9 manda siempre string:
// un campo que el usuario dejó en blanco llega como '', y guardarlo tal cual metería cadenas
// vacías donde la columna espera NULL.
function limpiarOpcional(valor: string | null): string | null {
  const limpio = valor?.trim();
  return limpio ? limpio : null;
}

// Normaliza ANTES de validar para que se valide EXACTAMENTE lo que se almacena. Sin esto,
// validarColorRgb —que hace su propio .trim() interno— aprobaría '  rgb(0,0,0)  ' y el valor
// se guardaría con los espacios puestos.
function normalizar(datos: DatosComercio): DatosComercio {
  return {
    ...datos,
    nombre: datos.nombre.trim(),
    slug: datos.slug.trim(),
    color_fondo: datos.color_fondo.trim(),
    color_texto: datos.color_texto.trim(),
    color_label: datos.color_label.trim(),
    logo_url: limpiarOpcional(datos.logo_url),
    strip_url: limpiarOpcional(datos.strip_url),
    hero_url: limpiarOpcional(datos.hero_url),
    licencia_estado: datos.licencia_estado.trim(),
    licencia_plan: limpiarOpcional(datos.licencia_plan),
    licencia_activa_desde: limpiarOpcional(datos.licencia_activa_desde),
  };
}

// ¿Es una fecha real en formato AAAA-MM-DD? El <input type="date"> del navegador ya lo
// garantiza, pero un Server Action es un POST: no se le cree al formulario. Sin esto, teclear
// "16/07/2026" —el formato natural en El Salvador— revienta en la BD y sale como un genérico
// "No se pudo crear el comercio", sin decir qué está mal.
function esFechaValida(valor: string): boolean {
  // El (?!0000) va aquí porque el round-trip de abajo NO atrapa el año cero: JS representa el
  // año 0 sin problema y lo devuelve idéntico. Postgres no — no existe el año cero, y rechaza
  // "0000-01-01" con un 22008, o sea el genérico "No se pudo crear el comercio" que esta
  // función existe para evitar. Solo el 0000: "0001-01-01" sí es válido en Postgres.
  // El orden importa: la regex admite exactamente \d{4}-\d{2}-\d{2}, así que Date nunca ve un
  // año expandido ni un signo, y nunca cae al parser legacy que varía entre motores.
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  // El round-trip atrapa fechas con forma correcta pero imposibles ("2026-02-31"): según el
  // motor, Date las rueda a marzo o da Invalid Date. Comparar contra la entrada cubre ambos.
  const fecha = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}

// Devuelve el primer problema encontrado, o null si todo está bien.
// TODA la validación vive aquí, no en los Server Actions: esta es la capa con tests de
// integración. Una regla que solo exista en la acción no está cubierta por ninguna prueba.
function validar(datos: DatosComercio): string | null {
  if (!datos.nombre) return 'El nombre es obligatorio.';
  if (!/^[a-z0-9-]+$/.test(datos.slug)) {
    return 'El slug solo puede tener minúsculas, números y guiones.';
  }
  if (!(ESTADOS_LICENCIA as readonly string[]).includes(datos.licencia_estado)) {
    // Sin esto, un estado inválido no falla aquí: falla en la BD con un 23514 (violación de
    // CHECK), que el manejo de errores —que solo distingue 23505— convierte en un genérico
    // "No se pudo crear el comercio". El admin se queda sin saber qué escribió mal.
    return 'El estado de la licencia debe ser "activo" o "inactivo".';
  }
  const colores: [string, string][] = [
    ['color de fondo', datos.color_fondo],
    ['color de texto', datos.color_texto],
    ['color de etiqueta', datos.color_label],
  ];
  for (const [nombre, valor] of colores) {
    if (!validarColorRgb(valor)) {
      return `El ${nombre} debe tener el formato rgb(r, g, b) con valores de 0 a 255.`;
    }
  }
  const monto = datos.licencia_monto_mensual;
  if (monto !== null && !Number.isFinite(monto)) {
    // Ruta real: la Tarea 9 hace Number(monto), así que un "25a" llega como NaN. Va aparte del
    // chequeo de negativo porque decirle "no puede ser negativo" a un NaN es, literalmente,
    // afirmar algo falso sobre el valor.
    return 'El monto mensual debe ser un número.';
  }
  if (monto !== null && monto < 0) {
    return 'El monto mensual no puede ser negativo.';
  }
  const fecha = datos.licencia_activa_desde;
  if (fecha !== null && !esFechaValida(fecha)) {
    return 'La fecha de inicio de la licencia debe ser una fecha real en formato AAAA-MM-DD.';
  }
  return null;
}

export async function crearComercio(
  supabase: SupabaseClient<Database>,
  datos: DatosComercio,
): Promise<ResultadoGuardar> {
  const limpios = normalizar(datos);
  const problema = validar(limpios);
  if (problema) return { ok: false, error: problema };

  const { data, error } = await supabase.from('comercios').insert(limpios).select('id').single();

  if (error) {
    // 23505 = unique violation. El único unique aquí es el slug.
    if (error.code === '23505') {
      return { ok: false, error: `Ya existe un comercio con el slug "${limpios.slug}".` };
    }
    console.error('[fm] falló el insert de comercio:', error);
    return { ok: false, error: 'No se pudo crear el comercio.' };
  }

  return { ok: true, id: data.id };
}

// El slug es editable a propósito, aunque sea la URL del QR físico pegado en la tienda
// (/registro/[comercioSlug]). Un typo al crear ("cafeteria-pilotoo") tiene que poder arreglarse, y
// volverlo inmutable obligaría a borrar y recrear, arrastrando las tarjetas existentes.
// Lo que SÍ se rompe al cambiarlo: los registros nuevos desde el QR ya impreso, que caen en un
// "Comercio no encontrado" silencioso — sin error, sin log, sin alerta. Lo que NO se rompe: los
// passes ya emitidos, cuyo código de barras es tarjetas.qr_token, no el slug. Por eso el
// formulario de la Tarea 9 debe pedir confirmación explícita al cambiar el slug de un comercio
// que ya existe.
export async function actualizarComercio(
  supabase: SupabaseClient<Database>,
  id: string,
  datos: DatosComercio,
): Promise<ResultadoGuardar> {
  const limpios = normalizar(datos);
  const problema = validar(limpios);
  if (problema) return { ok: false, error: problema };

  const { error } = await supabase
    .from('comercios')
    .update(limpios)
    .eq('id', id)
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: `Ya existe otro comercio con el slug "${limpios.slug}".` };
    }
    // PGRST116 = la consulta no devolvió exactamente una fila. El .select('id').single() de
    // arriba NO es decorativo: sin él, un update que no toca NADA devuelve 204 sin error y esto
    // reportaría ok:true habiendo escrito cero. Y .select('id') solo tampoco basta — devuelve []
    // sin error; hace falta el .single(). Dos rutas llegan aquí: un id que ya no existe, o un
    // cliente sin permiso — comercios es deny-all bajo RLS desde la 0001, así que pasar un
    // createClienteServidor() haría no-op silencioso en TODOS los updates.
    if (error.code === 'PGRST116') {
      return { ok: false, error: 'Ese comercio ya no existe.' };
    }
    console.error('[fm] falló el update de comercio:', error);
    return { ok: false, error: 'No se pudo actualizar el comercio.' };
  }

  return { ok: true, id };
}
```

Run: `npm test -- guardarComercio`
Expected: 14 passed.

- [ ] **Step 3: Gates + commit**

Run: `npm test` — expect **59 passed** (34 base + 4 esAdminFm + 7 validarColorRgb + 14 guardarComercio). Run `npm run typecheck`, `npm run lint`.
Confirma 0 comercios `test-%` huérfanos en la BD.
```bash
git add -A
git commit -m "Add crearComercio and actualizarComercio with validation"
```

---

### Task 7: Login, logout y la página de login

**Files:**
- Create: `app/admin/login/actions.ts`
- Create: `app/admin/login/page.tsx` (Server Component)
- Create: `app/admin/login/FormularioLogin.tsx` (Client Component)
- Create: `app/admin/actions.ts`

> ⚠️ **NO crees `app/admin/layout.tsx` — ni en esta tarea ni en ninguna.** Un layout ahí envolvería TAMBIÉN a `/admin/login`, y como el layout protegido redirige a `/admin/login`, se produciría un ciclo infinito (`ERR_TOO_MANY_REDIRECTS`). Un route group NO puede sacar una página de un layout que está por encima del grupo. El layout protegido va dentro del grupo, en la Tarea 8. Estructura final:
>
> ```
> app/admin/
>   actions.ts                  ← cerrarSesion (compartido)
>   login/
>     page.tsx                  ← sin chequeo (fuera del grupo protegido)
>     FormularioLogin.tsx
>     actions.ts
>   (protegido)/
>     layout.tsx                ← AQUÍ va verifyFmAdmin()
>     comercios/...
> ```
> Los route groups no afectan la URL: `/admin/login` y `/admin/comercios` siguen igual.

- [ ] **Step 1: Acción de login**

Create `app/admin/login/actions.ts`:

```typescript
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClienteServidor } from '@/lib/supabase/server';

export type EstadoLogin = { error: string } | undefined;

export async function iniciarSesion(
  _estadoPrevio: EstadoLogin,
  formData: FormData,
): Promise<EstadoLogin> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { error: 'Ingresa tu correo y contraseña.' };
  }

  const supabase = await createClienteServidor();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Supabase no distingue "no existe la cuenta" de "contraseña incorrecta", a propósito:
    // hacerlo permitiría enumerar qué correos tienen cuenta. No lo distingas tú tampoco.
    return { error: 'Correo o contraseña incorrectos.' };
  }

  revalidatePath('/admin', 'layout');
  // redirect() lanza NEXT_REDIRECT: va FUERA de cualquier try/catch, o se traga en silencio.
  redirect('/admin/comercios');
}
```

- [ ] **Step 2: Acción de logout**

Create `app/admin/actions.ts`:

```typescript
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClienteServidor } from '@/lib/supabase/server';

export async function cerrarSesion() {
  const supabase = await createClienteServidor();
  await supabase.auth.signOut();
  revalidatePath('/admin', 'layout');
  redirect('/admin/login');
}
```

- [ ] **Step 3: Formulario de login (cliente)**

Create `app/admin/login/FormularioLogin.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { iniciarSesion, type EstadoLogin } from './actions';

export default function FormularioLogin({ mensajeInicial }: { mensajeInicial?: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoLogin, FormData>(
    iniciarSesion,
    undefined,
  );

  // El error de la acción (credenciales malas) tiene prioridad sobre el que venga por URL
  // (p. ej. ?error=sin-permiso tras un rechazo de verifyFmAdmin).
  const mensaje = estado?.error ?? mensajeInicial;

  return (
    <form className="panel reveal d3" action={accion}>
      <div className="field">
        <label htmlFor="email">Correo</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="field">
        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <button className="btn-primary" type="submit" disabled={pendiente}>
        {pendiente ? 'Entrando…' : 'Entrar'}
      </button>
      {mensaje && (
        <p className="alerta" role="alert">
          {mensaje}
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 4: Página de login (servidor)**

Create `app/admin/login/page.tsx`. Es Server Component a propósito: así lee `searchParams` como prop y NO necesita `useSearchParams()` — que en un componente cliente exigiría envolverlo en `<Suspense>` o rompería el build al prerenderizar.

```tsx
import FormularioLogin from './FormularioLogin';

const MENSAJES: Record<string, string> = {
  'sin-permiso': 'Esa cuenta no tiene acceso al panel de FM.',
};

export default async function PaginaLogin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  // Object.hasOwn y no MENSAJES[error] a secas: ?error=constructor devolvería
  // Object.prototype.constructor —una FUNCIÓN— y React revienta al intentar renderizarla.
  // Cualquiera puede escribir eso en la barra de direcciones. Un valor desconocido no muestra
  // nada, que es el comportamiento correcto.
  const mensaje = error && Object.hasOwn(MENSAJES, error) ? MENSAJES[error] : undefined;

  return (
    <main className="shell">
      <div className="stack">
        <p className="kicker reveal d1">FM Lealtad</p>
        <h1 className="title reveal d2">
          Panel <em>interno</em>
        </h1>
        <FormularioLogin mensajeInicial={mensaje} />
      </div>
    </main>
  );
}
```

**Dos correcciones sobre una versión anterior de este plan:**

1. **Guarda con `Object.hasOwn`.** Una versión anterior tenía `MENSAJES[error]` a secas. `/admin/login?error=constructor` devuelve `Object.prototype.constructor` (una función) → React lanza "Functions are not valid as a React child". Trivialmente disparable escribiendo en la barra de direcciones.
2. **`'sesion-vencida'` se ELIMINA de `MENSAJES`.** Nada lo produce (grep de todo el código confirma cero coincidencias fuera de este plan). `proxy.ts` limpia `url.search = ''` antes de redirigir a `/admin/login` —a propósito, para que `?error=sin-permiso` no le llegue a alguien que simplemente no tiene sesión— y `verifyFmAdmin()` solo emite `?error=sin-permiso`. Un mensaje que ningún usuario puede ver es código muerto que insinúa una función inexistente: quien lo lea después asumirá que el panel anuncia sesiones vencidas, y no es así. Si se quiere esa función, `proxy.ts` tendría que distinguir "tenía una cookie de sesión muerta" de "nunca inició sesión" —una decisión de diseño real, no un string.

Reutiliza las clases del sistema visual existente (`shell`, `stack`, `kicker`, `title`, `panel`, `field`, `btn-primary`, `alerta`) definidas en `app/globals.css` — no inventes estilos nuevos.

- [ ] **Step 5: Verificar**

Run: `npm run build` → exitoso (si falla por prerender de `/admin/login`, revisa que la página NO use `useSearchParams()`).
Run: `npm test` → 59 passed (esta tarea no agrega tests — es cableado de UI; la lógica que invoca ya está cubierta).
Run: `npm run typecheck`, `npm run lint` → limpios.

No levantes un dev server para esto: la verificación visual se hace aparte, con herramientas de navegador administradas.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add FM admin login page with sign-in and sign-out actions"
```

---

### Task 8: Layout protegido + lista de comercios

**Files:**
- Create: `app/admin/(protegido)/layout.tsx`
- Create: `app/admin/(protegido)/comercios/page.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Layout protegido (DENTRO del grupo)**

> ⚠️ **Va en `app/admin/(protegido)/layout.tsx`, NO en `app/admin/layout.tsx`.** Esto no es cosmético: un layout en `app/admin/` envolvería también a `/admin/login`, y como este layout redirige ahí, daría un ciclo infinito. Los route groups NO pueden sacar una página de un layout que está por encima del grupo — por eso `app/admin/layout.tsx` simplemente no debe existir. Antes de seguir, confirma: `ls app/admin/layout.tsx` → debe decir "No such file".

Create `app/admin/(protegido)/layout.tsx`:

```tsx
import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import { cerrarSesion } from '../actions';

export default async function LayoutProtegido({ children }: { children: React.ReactNode }) {
  // Primera barrera. NO es la única: cada página y cada Server Action repiten el chequeo,
  // porque los layouts no se re-renderizan en navegación del lado del cliente.
  await verifyFmAdmin();

  return (
    <div className="admin-shell">
      <header className="admin-top">
        <span className="admin-marca">FM Lealtad</span>
        <form action={cerrarSesion}>
          <button className="admin-salir" type="submit">
            Salir
          </button>
        </form>
      </header>
      {children}
    </div>
  );
}
```

Nota el import: `../actions` (sube al `app/admin/actions.ts` de la Tarea 7), no `./actions`. Los archivos de la Tarea 7 (`app/admin/login/…`) NO se mueven ni cambian.

- [ ] **Step 2: Estilos del panel**

Modify `app/globals.css` — agrega al final:

```css
/* ---------- panel interno de FM ---------- */
.admin-shell {
  position: relative;
  z-index: 1;
  min-height: 100dvh;
}
.admin-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px;
  border-bottom: 1px solid var(--line);
  background: rgba(252, 248, 241, 0.7);
  backdrop-filter: blur(8px);
}
.admin-marca {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1.15rem;
}
.admin-salir {
  font-family: var(--font-body);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--ink-soft);
  background: none;
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 7px 13px;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.admin-salir:hover {
  color: var(--espresso);
  border-color: var(--ink-soft);
}
.admin-main {
  max-width: 900px;
  margin: 0 auto;
  padding: 34px 22px 60px;
}
.admin-encabezado {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 22px;
}
.admin-lista {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.admin-fila {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 16px 18px;
  background: linear-gradient(180deg, var(--foam), var(--cream));
  border: 1px solid var(--line);
  border-radius: 13px;
  transition: transform 0.15s ease, box-shadow 0.2s ease;
}
.admin-fila:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 26px -20px rgba(36, 24, 18, 0.7);
}
.admin-fila-nombre {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1.1rem;
}
.admin-fila-slug {
  font-size: 0.8rem;
  color: var(--ink-soft);
}
.pastilla {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 4px 10px;
  border-radius: 999px;
}
.pastilla-activo {
  color: #2f5d3a;
  background: rgba(76, 145, 92, 0.16);
}
.pastilla-inactivo {
  color: var(--clay);
  background: rgba(168, 86, 60, 0.14);
}
.admin-vacio {
  padding: 40px 20px;
  text-align: center;
  color: var(--ink-soft);
  border: 1px dashed var(--line);
  border-radius: 13px;
}
.admin-error {
  padding: 40px 20px;
  text-align: center;
  color: var(--clay);
  border: 1px dashed var(--clay);
  border-radius: 13px;
}
```

- [ ] **Step 3: Lista de comercios**

Create `app/admin/(protegido)/comercios/page.tsx`:

```tsx
import Link from 'next/link';
import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function PaginaComercios() {
  // Defensa en profundidad: el layout ya verificó, pero los layouts no se re-ejecutan en
  // navegación del lado del cliente. cache() hace que esto no cueste una consulta extra.
  await verifyFmAdmin();

  const supabase = createServiceClient();
  const { data: comercios, error } = await supabase
    .from('comercios')
    .select('id, nombre, slug, licencia_estado, licencia_monto_mensual')
    .order('nombre');

  if (error) {
    // Sin esto, un fallo de consulta deja comercios en null y la página muestra "Todavía no hay
    // comercios" — una MENTIRA, y de las caras: le dice a FM que su cartera está vacía cuando lo
    // único que pasa es que la BD no responde. "Vacío" y "roto" tienen que verse distinto.
    console.error('[fm] falló la consulta de comercios:', error);
  }

  return (
    <main className="admin-main">
      <div className="admin-encabezado">
        <h1 className="title" style={{ fontSize: '2rem', margin: 0 }}>
          Comercios
        </h1>
        <Link className="btn-primary" style={{ width: 'auto' }} href="/admin/comercios/nuevo">
          Nuevo comercio
        </Link>
      </div>

      {error ? (
        <p className="admin-error" role="alert">
          No se pudo cargar la lista de comercios. Revisa la conexión y recarga la página.
        </p>
      ) : !comercios || comercios.length === 0 ? (
        <p className="admin-vacio">Todavía no hay comercios. Crea el primero.</p>
      ) : (
        <div className="admin-lista">
          {comercios.map((c) => (
            <Link key={c.id} className="admin-fila" href={`/admin/comercios/${c.id}/editar`}>
              <div>
                <div className="admin-fila-nombre">{c.nombre}</div>
                <div className="admin-fila-slug">/{c.slug}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {c.licencia_monto_mensual != null && (
                  <span className="admin-fila-slug">${c.licencia_monto_mensual}/mes</span>
                )}
                <span
                  className={`pastilla ${
                    c.licencia_estado === 'activo' ? 'pastilla-activo' : 'pastilla-inactivo'
                  }`}
                >
                  {c.licencia_estado}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Verificar + commit**

Run: `npm run build`, `npm run typecheck`, `npm run lint` → todo limpio.
```bash
git add -A
git commit -m "Add protected admin layout and comercios list page"
```

---

### Task 9: Formulario de comercio + Server Actions de crear/editar

**Files:**
- Create: `app/admin/(protegido)/comercios/FormularioComercio.tsx`
- Create: `app/admin/(protegido)/comercios/actions.ts`
- Create: `app/admin/(protegido)/comercios/nuevo/page.tsx`
- Create: `app/admin/(protegido)/comercios/[id]/editar/page.tsx`
- Modify: `app/globals.css` (estilos del `<select>`, Step 2)

- [ ] **Step 1: Server Actions**

Create `app/admin/(protegido)/comercios/actions.ts`:

```typescript
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { crearComercio, actualizarComercio, type DatosComercio } from '@/lib/comercios/guardarComercio';

export type EstadoFormulario = { error: string } | undefined;

function textoONull(valor: FormDataEntryValue | null): string | null {
  const s = String(valor ?? '').trim();
  return s === '' ? null : s;
}

function leerDatos(formData: FormData): DatosComercio {
  const monto = textoONull(formData.get('licencia_monto_mensual'));
  return {
    nombre: String(formData.get('nombre') ?? '').trim(),
    slug: String(formData.get('slug') ?? '').trim(),
    color_fondo: String(formData.get('color_fondo') ?? '').trim(),
    color_texto: String(formData.get('color_texto') ?? '').trim(),
    color_label: String(formData.get('color_label') ?? '').trim(),
    logo_url: textoONull(formData.get('logo_url')),
    strip_url: textoONull(formData.get('strip_url')),
    hero_url: textoONull(formData.get('hero_url')),
    licencia_estado: String(formData.get('licencia_estado') ?? 'activo'),
    licencia_plan: textoONull(formData.get('licencia_plan')),
    // Number('25a') es NaN, no una excepción. No lo atajamos aquí: validar() lo rechaza con
    // "El monto mensual debe ser un número", y esa capa sí tiene pruebas.
    licencia_monto_mensual: monto === null ? null : Number(monto),
    licencia_activa_desde: textoONull(formData.get('licencia_activa_desde')),
  };
}

// Las acciones NO validan: toda la validación vive en validar(), dentro de guardarComercio.ts,
// que es la capa con tests de integración. Aquí solo: autenticar, parsear, delegar.
export async function accionCrearComercio(
  _estadoPrevio: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  // Cada Server Action verifica por su cuenta: son POST a la ruta donde se usan, no rutas
  // propias, y los docs de Next dicen explícitamente que no hay que confiar solo en el Proxy.
  // OJO: verifyFmAdmin() usa redirect(), que funciona LANZANDO. Nunca lo envuelvas en try/catch.
  await verifyFmAdmin();

  const res = await crearComercio(createServiceClient(), leerDatos(formData));
  if (!res.ok) return { error: res.error };

  revalidatePath('/admin/comercios');
  redirect('/admin/comercios');
}

export async function accionActualizarComercio(
  id: string,
  _estadoPrevio: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  await verifyFmAdmin();

  const res = await actualizarComercio(createServiceClient(), id, leerDatos(formData));
  if (!res.ok) return { error: res.error };

  revalidatePath('/admin/comercios');
  redirect('/admin/comercios');
}
```

- [ ] **Step 2: Formulario compartido**

Create `app/admin/(protegido)/comercios/FormularioComercio.tsx`:

```tsx
'use client';

import { useState, type ChangeEvent } from 'react';
import { useActionState } from 'react';
import type { EstadoFormulario } from './actions';
import { ESTADOS_LICENCIA, type DatosComercio } from '@/lib/comercios/guardarComercio';

type Valores = {
  nombre: string;
  slug: string;
  color_fondo: string;
  color_texto: string;
  color_label: string;
  logo_url: string;
  strip_url: string;
  hero_url: string;
  licencia_estado: string;
  licencia_plan: string;
  licencia_monto_mensual: string;
  licencia_activa_desde: string;
};

function valoresIniciales(inicial?: Partial<DatosComercio>): Valores {
  return {
    nombre: inicial?.nombre ?? '',
    slug: inicial?.slug ?? '',
    color_fondo: inicial?.color_fondo ?? 'rgb(255, 255, 255)',
    color_texto: inicial?.color_texto ?? 'rgb(255, 255, 255)',
    color_label: inicial?.color_label ?? 'rgb(255, 255, 255)',
    logo_url: inicial?.logo_url ?? '',
    strip_url: inicial?.strip_url ?? '',
    hero_url: inicial?.hero_url ?? '',
    licencia_estado: inicial?.licencia_estado ?? 'activo',
    licencia_plan: inicial?.licencia_plan ?? '',
    licencia_monto_mensual:
      inicial?.licencia_monto_mensual != null ? String(inicial.licencia_monto_mensual) : '',
    licencia_activa_desde: inicial?.licencia_activa_desde ?? '',
  };
}

export default function FormularioComercio({
  accion,
  inicial,
  textoBoton,
  esEdicion = false,
}: {
  accion: (estado: EstadoFormulario, formData: FormData) => Promise<EstadoFormulario>;
  inicial?: Partial<DatosComercio>;
  textoBoton: string;
  esEdicion?: boolean;
}) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoFormulario, FormData>(
    accion,
    undefined,
  );

  // Campos CONTROLADOS a propósito. React 19 resetea los campos no controlados cuando una
  // action del formulario termina —incluso si devolvió un error— así que con defaultValue el
  // admin llenaba doce campos, se equivocaba en uno, y perdía todo. Verificado en el navegador:
  // el nombre y el slug volvían a "" al rechazarse un color. Y es fácil de disparar: escribir
  // "Café Piloto" como slug (mayúscula, espacio, tilde) lo rechaza al primer intento.
  const [valores, setValores] = useState<Valores>(() => valoresIniciales(inicial));

  const cambiar =
    (campo: keyof Valores) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setValores((v) => ({ ...v, [campo]: e.target.value }));

  return (
    <form className="panel" action={ejecutar}>
      <div className="field">
        <label htmlFor="nombre">Nombre</label>
        <input id="nombre" name="nombre" value={valores.nombre} onChange={cambiar('nombre')} required />
      </div>
      <div className="field">
        <label htmlFor="slug">Slug (la dirección: /registro/…)</label>
        <input
          id="slug"
          name="slug"
          value={valores.slug}
          onChange={cambiar('slug')}
          placeholder="cafeteria-piloto"
          required
        />
        {esEdicion && (
          <p className="field-aviso">
            Cambiarlo rompe los QR ya impresos de este comercio: quien los escanee caerá en
            «Comercio no encontrado» y no podrá registrarse. Los passes ya emitidos siguen
            funcionando.
          </p>
        )}
      </div>

      {(
        [
          ['color_fondo', 'Color de fondo'],
          ['color_texto', 'Color de texto'],
          ['color_label', 'Color de etiqueta'],
        ] as const
      ).map(([campo, etiqueta]) => (
        <div className="field" key={campo}>
          <label htmlFor={campo}>{etiqueta}</label>
          <input
            id={campo}
            name={campo}
            value={valores[campo]}
            onChange={cambiar(campo)}
            placeholder="rgb(35, 24, 18)"
            required
          />
        </div>
      ))}

      {(
        [
          ['logo_url', 'URL del logo'],
          ['strip_url', 'URL de la franja'],
          ['hero_url', 'URL de la imagen principal'],
        ] as const
      ).map(([campo, etiqueta]) => (
        <div className="field" key={campo}>
          <label htmlFor={campo}>{etiqueta} (opcional)</label>
          <input id={campo} name={campo} value={valores[campo]} onChange={cambiar(campo)} />
        </div>
      ))}

      <div className="field">
        <label htmlFor="licencia_estado">Estado de licencia</label>
        {/* Las opciones salen de ESTADOS_LICENCIA, la MISMA constante contra la que valida
            guardarComercio.ts y que refleja el check de la BD. Hardcodearlas aquí crearía tres
            copias de una sola regla: si mañana se agrega un estado, se agrega en un solo lugar. */}
        <select
          id="licencia_estado"
          name="licencia_estado"
          value={valores.licencia_estado}
          onChange={cambiar('licencia_estado')}
        >
          {ESTADOS_LICENCIA.map((e) => (
            <option key={e} value={e}>
              {e.charAt(0).toUpperCase() + e.slice(1)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="licencia_plan">Plan (opcional)</label>
        <input
          id="licencia_plan"
          name="licencia_plan"
          value={valores.licencia_plan}
          onChange={cambiar('licencia_plan')}
        />
      </div>
      <div className="field">
        <label htmlFor="licencia_monto_mensual">Monto mensual (opcional)</label>
        <input
          id="licencia_monto_mensual"
          name="licencia_monto_mensual"
          type="number"
          min="0"
          step="0.01"
          value={valores.licencia_monto_mensual}
          onChange={cambiar('licencia_monto_mensual')}
        />
      </div>
      <div className="field">
        <label htmlFor="licencia_activa_desde">Activa desde (opcional)</label>
        <input
          id="licencia_activa_desde"
          name="licencia_activa_desde"
          type="date"
          value={valores.licencia_activa_desde}
          onChange={cambiar('licencia_activa_desde')}
        />
      </div>

      <button className="btn-primary" type="submit" disabled={pendiente}>
        {pendiente ? 'Guardando…' : textoBoton}
      </button>
      {estado?.error && (
        <p className="alerta" role="alert">
          {estado.error}
        </p>
      )}
    </form>
  );
}
```

Agrega el estilo del `<select>` y del aviso de slug a `app/globals.css` (junto a `.field input`):
```css
.field select {
  font-family: var(--font-body);
  font-size: 1rem;
  color: var(--espresso);
  background: #fff;
  border: 1.5px solid var(--line);
  border-radius: 12px;
  padding: 13px 14px;
}
.field select:focus {
  outline: none;
  border-color: var(--caramel);
  box-shadow: 0 0 0 4px rgba(192, 127, 56, 0.18);
}
.field-aviso {
  margin-top: 6px;
  font-size: 0.8rem;
  line-height: 1.45;
  color: var(--clay);
}
```

- [ ] **Step 3: Página de alta**

Create `app/admin/(protegido)/comercios/nuevo/page.tsx`:

```tsx
import Link from 'next/link';
import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import FormularioComercio from '../FormularioComercio';
import { accionCrearComercio } from '../actions';

export const dynamic = 'force-dynamic';

export default async function PaginaNuevoComercio() {
  await verifyFmAdmin();

  return (
    <main className="admin-main">
      <div className="admin-encabezado">
        <h1 className="title" style={{ fontSize: '2rem', margin: 0 }}>
          Nuevo comercio
        </h1>
        <Link className="admin-fila-slug" href="/admin/comercios">
          ← Volver
        </Link>
      </div>
      <FormularioComercio accion={accionCrearComercio} textoBoton="Crear comercio" />
    </main>
  );
}
```

- [ ] **Step 4: Página de edición**

Create `app/admin/(protegido)/comercios/[id]/editar/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import FormularioComercio from '../../FormularioComercio';
import { accionActualizarComercio } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function PaginaEditarComercio({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await verifyFmAdmin();
  const { id } = await params;

  const supabase = createServiceClient();
  const { data: comercio, error } = await supabase
    .from('comercios')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    // maybeSingle() devuelve error:null cuando no hay filas, así que un error aquí SIEMPRE es
    // infraestructura. Sin separarlo, un fallo de consulta caería en notFound() y le diría al
    // admin que el comercio NO EXISTE —mentira— justo después de que lo vio en la lista.
    console.error('[fm] falló la consulta del comercio a editar:', error);
    return (
      <main className="admin-main">
        <div className="admin-encabezado">
          <h1 className="title" style={{ fontSize: '2rem', margin: 0 }}>
            Comercio
          </h1>
          <Link className="admin-fila-slug" href="/admin/comercios">
            ← Volver
          </Link>
        </div>
        <p className="admin-error" role="alert">
          No se pudo cargar este comercio. Revisa la conexión y recarga la página.
        </p>
      </main>
    );
  }

  if (!comercio) notFound();

  // bind() fija el id como primer argumento; la firma que ve useActionState sigue siendo
  // (estado, formData).
  const accion = accionActualizarComercio.bind(null, id);

  // Las columnas de color son nullable en la BD (migración 0001: `color_fondo text`) pero
  // DatosComercio las declara string, así que Partial<DatosComercio> las vuelve
  // `string | undefined` y NO acepta null. Pasar `comercio` directo es un TS2322: hay que mapear.
  const inicial = {
    ...comercio,
    color_fondo: comercio.color_fondo ?? '',
    color_texto: comercio.color_texto ?? '',
    color_label: comercio.color_label ?? '',
  };

  return (
    <main className="admin-main">
      <div className="admin-encabezado">
        <h1 className="title" style={{ fontSize: '2rem', margin: 0 }}>
          {comercio.nombre}
        </h1>
        <Link className="admin-fila-slug" href="/admin/comercios">
          ← Volver
        </Link>
      </div>
      <FormularioComercio accion={accion} inicial={inicial} textoBoton="Guardar cambios" esEdicion />
    </main>
  );
}
```

- [ ] **Step 5: Gates + commit**

Run: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` (59 passed).
```bash
git add -A
git commit -m "Add comercio create/edit form and server actions"
```

---

### Task 9b: Eliminar comercio (agregado durante la Tarea 10)

**Fuera del alcance original.** El objetivo aprobado de esta fase (spec §2) era "ver, crear y
editar" — sin borrar. Durante la verificación manual end-to-end de la Tarea 10, el usuario creó
un comercio de prueba y notó que el panel no tenía forma de quitarlo; pidió agregar borrado antes
de fusionar a `master`. La regla de "solo sin datos asociados" no es una validación nueva de
aplicación: ya la impone el esquema — ninguna FK hacia `comercios` (migración 0001:
`usuarios_comercio`, `tarjetas`, `reglas_puntos`, `recompensas`) tiene `on delete cascade`, así
que Postgres rechaza el borrado con un 23503 si existe cualquier dependiente. El panel solo
traduce ese código a un mensaje legible; a propósito NO se duplica la regla contando filas en JS
antes de borrar (podría desincronizarse del esquema).

**Verificación previa a confiar en el diseño** (comercio piloto real de por medio, con 1
`tarjeta` real ligada a un pass de Apple firmado en el iPhone del usuario):
1. Se releyeron las cuatro migraciones (`0001`–`0004`) y se grepeó `cascade` (sin distinguir
   mayúsculas) en todo `supabase/`: cero resultados. Ningún FK, en ninguna migración, tiene
   `on delete cascade`.
2. `event.preventDefault()` en el `onSubmit` de un `<form action={función}>` de React 19 SÍ
   cancela la Server Action, no es decorativo. Verificado leyendo el código fuente instalado
   (`node_modules/react-dom/cjs/react-dom-client.development.js`): el submit nativo se procesa en
   un solo batch síncrono que primero acumula y corre los listeners normales de `onSubmit` (vía
   `accumulateTwoPhaseListeners` sobre "onSubmit") y SOLO DESPUÉS ejecuta la extracción propia de
   la action (función `extractEvents$1`), cuyo listener revisa `nativeEvent.defaultPrevented` y
   pasa `action: null` a `startHostTransition` si ya está en `true` — es decir, nunca llama a la
   action. Como ambos leen/escriben el mismo evento nativo dentro del mismo pase síncrono, y el
   `onSubmit` del desarrollador corre primero, el `preventDefault()` condicionado al
   `window.confirm()` de `BotonEliminar` sí bloquea el borrado si el usuario cancela. Coincide con
   `node_modules/next/dist/docs/01-app/03-api-reference/02-components/form.md`: "calling
   event.preventDefault() will override \<Form\> behavior".
3. `accionEliminarComercio.bind(null, id)` sí tipa contra la firma `(estado, formData) =>
   Promise<EstadoFormulario>` que espera `BotonEliminar` — confirmado con `npm run typecheck`
   limpio, igual que ya ocurre con `accionActualizarComercio.bind(null, id)`.
4. Un DELETE sobre un id que ya no existe debe devolver `ok:true` (a diferencia del `ok:true`
   sobre un UPDATE de 0 filas, que sí sería mentira: implicaría un cambio que nunca pasó). Para
   un DELETE, el estado que el caller quiere — "esta fila no debe existir" — se cumple lo haya
   hecho esta llamada o ya estuviera así. Ojo: esto depende de que el único caller use el service
   client (ignora RLS); con un cliente de sesión, "0 filas por RLS" y "0 filas porque ya no
   existe" volverían a ser indistinguibles, el mismo problema que motivó el `.select().single()`
   en `actualizarComercio`. Hoy `accionEliminarComercio` siempre pasa `createServiceClient()`, así
   que no aplica — pero es un acoplamiento implícito, no verificado por ningún test.

**Files:**
- Modify: `lib/comercios/guardarComercio.ts` (agrega `eliminarComercio`)
- Modify: `lib/comercios/guardarComercio.test.ts` (agrega el describe `eliminarComercio`)
- Modify: `app/admin/(protegido)/comercios/actions.ts` (agrega `accionEliminarComercio`)
- Create: `app/admin/(protegido)/comercios/BotonEliminar.tsx`
- Modify: `app/admin/(protegido)/comercios/[id]/editar/page.tsx` (monta `BotonEliminar`)
- Modify: `app/globals.css` (`.admin-zona-peligro` / `.admin-eliminar`)
- Modify: `eslint.config.mjs` (`argsIgnorePattern`, Step 7)

- [ ] **Step 1: Escribir el test que falla**

Extiende `lib/comercios/guardarComercio.test.ts`: importa `eliminarComercio` y agrega
`tarjetasDePrueba`/`clientesDePrueba`, reordenando `afterEach` para borrar tarjetas → clientes →
comercios, en ese orden (el hijo antes que sus dos padres — al revés, el propio borrado que esta
prueba ejercita rechazaría la limpieza con el mismo 23503 que el feature existe para producir).

```typescript
const slugsDePrueba: string[] = [];
const tarjetasDePrueba: string[] = [];
const clientesDePrueba: string[] = [];

afterEach(async () => {
  if (tarjetasDePrueba.length) {
    const { error } = await supabase.from('tarjetas').delete().in('id', tarjetasDePrueba);
    if (error) console.error('[test] no se pudieron borrar las tarjetas de prueba:', error);
    tarjetasDePrueba.length = 0;
  }
  if (clientesDePrueba.length) {
    const { error } = await supabase.from('clientes').delete().in('id', clientesDePrueba);
    if (error) console.error('[test] no se pudieron borrar los clientes de prueba:', error);
    clientesDePrueba.length = 0;
  }
  if (slugsDePrueba.length) {
    const { error } = await supabase.from('comercios').delete().in('slug', slugsDePrueba);
    if (error) console.error('[test] no se pudieron borrar los comercios de prueba:', error);
    slugsDePrueba.length = 0;
  }
});
```

```typescript
describe('eliminarComercio', () => {
  it('elimina un comercio sin datos asociados', async () => {
    const slug = `test-eliminar-${Date.now()}`;
    const creado = await crearComercio(supabase, datosValidos(slug));
    if (!creado.ok) throw new Error('el setup falló');

    const res = await eliminarComercio(supabase, creado.id);
    expect(res.ok).toBe(true);

    const { data } = await supabase.from('comercios').select('id').eq('id', creado.id).maybeSingle();
    expect(data).toBeNull();
  });

  it('rechaza eliminar un comercio con tarjetas y NO lo borra', async () => {
    const slug = `test-con-tarjeta-${Date.now()}`;
    const creado = await crearComercio(supabase, datosValidos(slug));
    if (!creado.ok) throw new Error('el setup falló');

    const telefono = `+000-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { data: cliente, error: eCliente } = await supabase
      .from('clientes')
      .insert({ nombre: 'Cliente de prueba', telefono })
      .select('id')
      .single();
    if (eCliente) throw eCliente;
    clientesDePrueba.push(cliente.id);

    const { data: tarjeta, error: eTarjeta } = await supabase
      .from('tarjetas')
      .insert({ cliente_id: cliente.id, comercio_id: creado.id })
      .select('id')
      .single();
    if (eTarjeta) throw eTarjeta;
    tarjetasDePrueba.push(tarjeta.id);

    const res = await eliminarComercio(supabase, creado.id);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/asociad|eliminar/i);

    // La comprobación que de verdad importa: el comercio SIGUE existiendo. Esta es la misma
    // situación del comercio piloto real en producción, con una tarjeta real ligada a un pass
    // de Apple en el iPhone del usuario — si este assert alguna vez fallara, significaría que
    // el borrado arrastró datos de un cliente real.
    const { data } = await supabase.from('comercios').select('id').eq('id', creado.id).maybeSingle();
    expect(data).not.toBeNull();
  });
});
```

Run: `npm test -- guardarComercio` → RED esperado: `TypeError: eliminarComercio is not a
function` en las 2 pruebas nuevas, 14 pruebas existentes en verde.

- [ ] **Step 2: `eliminarComercio()`**

Agrega a `lib/comercios/guardarComercio.ts`, después de `actualizarComercio`:

```typescript
// Ningún FK hacia comercios tiene ON DELETE CASCADE (migración 0001: usuarios_comercio,
// tarjetas, reglas_puntos y recompensas apuntan aquí sin cascada) — a propósito, para que
// borrar un comercio NUNCA arrastre en silencio datos reales de un cliente. Postgres es la
// única fuente de verdad de esa regla: no la duplicamos contando filas en JS, que podría
// desincronizarse si el esquema cambia. Solo traducimos el 23503 a un mensaje legible.
export async function eliminarComercio(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from('comercios').delete().eq('id', id);

  if (error) {
    if (error.code === '23503') {
      return {
        ok: false,
        error:
          'No se puede eliminar: tiene datos asociados (tarjetas, reglas de puntos o recompensas). Solo se pueden eliminar comercios sin actividad.',
      };
    }
    console.error('[fm] falló el borrado de comercio:', error);
    return { ok: false, error: 'No se pudo eliminar el comercio.' };
  }

  return { ok: true };
}
```

El tipo de retorno es deliberadamente `{ ok: true } | { ok: false; error: string }`, NO
`ResultadoGuardar`: ese tipo carga un `id` en el caso de éxito que un DELETE no tiene sentido
devolver (el caller ya lo tiene). Sin `.select().single()` a propósito — ver punto 4 de la
verificación arriba.

Run: `npm test -- guardarComercio` → GREEN, 16 passed (14 + 2).

- [ ] **Step 3: Server Action**

Agrega a `app/admin/(protegido)/comercios/actions.ts`:

```typescript
export async function accionEliminarComercio(
  id: string,
  _estadoPrevio: EstadoFormulario,
  _formData: FormData,
): Promise<EstadoFormulario> {
  await verifyFmAdmin();

  const res = await eliminarComercio(createServiceClient(), id);
  if (!res.ok) return { error: res.error };

  revalidatePath('/admin/comercios');
  redirect('/admin/comercios');
}
```

Misma forma que `accionActualizarComercio`: `(id, estadoPrevio, formData)` vía `.bind(null, id)`,
reutilizando `EstadoFormulario` — sin tipo nuevo.

- [ ] **Step 4: `BotonEliminar` (client component)**

Create `app/admin/(protegido)/comercios/BotonEliminar.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import type { EstadoFormulario } from './actions';

export default function BotonEliminar({
  accion,
  nombre,
}: {
  accion: (estado: EstadoFormulario, formData: FormData) => Promise<EstadoFormulario>;
  nombre: string;
}) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoFormulario, FormData>(
    accion,
    undefined,
  );

  return (
    <div className="admin-zona-peligro">
      <form
        action={ejecutar}
        onSubmit={(e) => {
          // La confirmación es UX contra un clic accidental, NO el control de seguridad — ese
          // es verifyFmAdmin() dentro de la Server Action, más el FK de Postgres que rechaza
          // borrar cualquier comercio con datos reales asociados.
          if (!window.confirm(`¿Eliminar "${nombre}"? Esta acción no se puede deshacer.`)) {
            e.preventDefault();
          }
        }}
      >
        <button className="admin-eliminar" type="submit" disabled={pendiente}>
          {pendiente ? 'Eliminando…' : 'Eliminar comercio'}
        </button>
      </form>
      {estado?.error && (
        <p className="alerta" role="alert">
          {estado.error}
        </p>
      )}
    </div>
  );
}
```

Ver punto 2 de la verificación arriba: el `preventDefault()` condicionado al `confirm()` sí
cancela la action, no es decorativo.

- [ ] **Step 5: Montarlo en la página de edición**

Modifica `app/admin/(protegido)/comercios/[id]/editar/page.tsx`: importa `BotonEliminar` desde
`'../../BotonEliminar'` y agrega `accionEliminarComercio` al import existente desde `'../../actions'`.
Después de `const accion = accionActualizarComercio.bind(null, id);` agrega:

```tsx
const eliminar = accionEliminarComercio.bind(null, id);
```

Y renderiza `<BotonEliminar accion={eliminar} nombre={comercio.nombre} />` justo después de
`<FormularioComercio ... />`, dentro del mismo `<main className="admin-main">`. `nuevo/page.tsx`
NO se toca: no se puede borrar algo que todavía no existe.

- [ ] **Step 6: CSS**

Agrega a `app/globals.css`:

```css
.admin-zona-peligro {
  margin-top: 34px;
  padding-top: 22px;
  border-top: 1px dashed var(--line);
}
.admin-eliminar {
  font-family: var(--font-body);
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--clay);
  background: none;
  border: 1.5px solid var(--clay);
  border-radius: 12px;
  padding: 11px 18px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.admin-eliminar:hover {
  background: var(--clay);
  color: #fff;
}
.admin-eliminar:disabled {
  opacity: 0.6;
  cursor: default;
}
```

- [ ] **Step 7: Gate imprevisto — ESLint**

`accionEliminarComercio` deja `_estadoPrevio` y `_formData` sin usar. A diferencia de
`accionCrearComercio`/`accionActualizarComercio` (donde el último parámetro, `formData`, SÍ se
usa), aquí el último parámetro realmente usado es `id` — el primero. El modo por defecto de
`@typescript-eslint/no-unused-vars` (`args: 'after-used'`) marca los parámetros no usados que
quedan DESPUÉS del último usado, sin mirar el prefijo `_`; por eso `_estadoPrevio` nunca había
disparado el warning en las otras dos acciones (ahí es el del medio, no el que sigue al último
usado), pero aquí sí marcaba los dos. Se agrega `argsIgnorePattern: '^_'` a
`@typescript-eslint/no-unused-vars` en `eslint.config.mjs`, lo que hace cumplir una convención
que el archivo ya usaba de facto.

- [ ] **Step 8: Gates + commit**

Run: `npm test` (61 passed), `npm run typecheck`, `npm run lint`, `npm run build` — clean.
```bash
git add lib/comercios/guardarComercio.ts lib/comercios/guardarComercio.test.ts \
  "app/admin/(protegido)/comercios/actions.ts" "app/admin/(protegido)/comercios/BotonEliminar.tsx" \
  "app/admin/(protegido)/comercios/[id]/editar/page.tsx" app/globals.css eslint.config.mjs \
  docs/superpowers/plans/2026-07-16-fm-admin-panel.md
git commit -m "Add comercio deletion, guarded by the FK constraint"
```

---

### Task 10: Cuenta de FM + verificación manual end-to-end

**Files:**
- Create: `scripts/seed-usuario-fm.ts`
- Modify: `package.json`

- [ ] **Step 1: Script de alta de la cuenta**

Create `scripts/seed-usuario-fm.ts`:

```typescript
// Ejecutar vía: npm run seed-fm -- correo@ejemplo.com "contraseña"
// Crea la cuenta compartida de FM en Supabase Auth y su fila en usuarios_fm.
// Idempotente: si el correo ya existe en Auth, solo asegura la fila en usuarios_fm.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    throw new Error('Uso: npm run seed-fm -- correo@ejemplo.com "contraseña"');
  }

  const supabase = createServiceClient();

  const { data: creado, error: errorCrear } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  let authUserId = creado?.user?.id;

  if (errorCrear) {
    // Ya existe: lo buscamos en la lista de usuarios.
    const { data: lista, error: errorLista } = await supabase.auth.admin.listUsers();
    if (errorLista) throw errorLista;
    const existente = lista.users.find((u) => u.email === email);
    if (!existente) throw errorCrear;
    authUserId = existente.id;
    console.log('La cuenta ya existía en Auth; se reutiliza.');
  }

  const { error: errorFila } = await supabase
    .from('usuarios_fm')
    .upsert({ auth_user_id: authUserId!, email }, { onConflict: 'auth_user_id' });
  if (errorFila) throw errorFila;

  console.log('Listo. Cuenta de FM habilitada:', email);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Modify `package.json` scripts:
```json
"seed-fm": "tsx --conditions=react-server scripts/seed-usuario-fm.ts"
```

- [ ] **Step 2: Crear la cuenta real**

Run (elige un correo y una contraseña fuerte reales de FM):
```bash
npm run seed-fm -- tu-correo@ejemplo.com "una-contraseña-fuerte"
```
Expected: `Listo. Cuenta de FM habilitada: ...`. Verifica en Supabase Studio que exista la fila en `usuarios_fm`.

- [ ] **Step 3: Verificación manual end-to-end (local)**

Run: `npm run dev`, y comprueba en el navegador:

1. `http://localhost:3000/admin/comercios` sin sesión → redirige a `/admin/login`.
2. Login con credenciales incorrectas → mensaje amable, sin 500.
3. Login correcto → llega a la lista y aparece **Cafetería Piloto** con su pastilla de estado.
4. **Nuevo comercio** → guarda uno de prueba (slug `prueba-admin`) → aparece en la lista.
5. Crear otro con el **mismo slug** → mensaje "Ya existe un comercio con el slug…", sin 500.
6. Crear uno con color `#231812` → mensaje sobre el formato `rgb(r, g, b)`, sin 500.
7. **Editar** el de prueba: cambia nombre y pon la licencia en `inactivo` → se refleja en la lista.
8. **Salir** → vuelve al login; intenta `/admin/comercios` → redirige a login.
9. Verifica que el sitio público sigue vivo: `http://localhost:3000/registro/cafeteria-piloto` → 200.

Borra el comercio de prueba al final (Supabase Studio o `delete` por slug `prueba-admin`).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add FM account seed script"
```

---

### Task 11: Despliegue

- [ ] **Step 1: Aplicar la migración en producción**

Ya se aplicó en la Tarea 1 (la base de Supabase es la misma para local y producción en este proyecto — no hay entornos separados). Confirma con `npm run verify-schema`.

- [ ] **Step 2: Merge y push**

Antes del merge, confirma que `master` no divergió del remoto (al momento de escribir este plan iba varios commits adelante de `origin/master`):
```bash
git fetch origin
git log --oneline origin/master..master
```
Si hay commits locales sin subir, están bien — son de este proyecto; solo asegúrate de que `master` no esté DETRÁS de `origin/master` (si lo está, `git pull --ff-only` primero).

```bash
git checkout master
git merge --ff-only feature/fm-admin-panel
git push origin master
```
Vercel despliega automáticamente. **No hay variables de entorno nuevas que agregar.**

- [ ] **Step 3: Verificar en producción**

Repite los pasos clave de la Tarea 10 Step 3 contra `https://loyalty-cards-rose.vercel.app/admin/login`:
- Login funciona, la lista carga, crear/editar funciona.
- `https://loyalty-cards-rose.vercel.app/registro/cafeteria-piloto` sigue en 200 (el proxy no rompió lo público).

- [ ] **Step 4: Limpiar la rama**

```bash
git branch -d feature/fm-admin-panel
```

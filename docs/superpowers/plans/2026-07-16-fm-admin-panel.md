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
let authUserId: string | null = null;

afterEach(async () => {
  if (!authUserId) return;
  await supabase.from('usuarios_fm').delete().eq('auth_user_id', authUserId);
  await supabase.auth.admin.deleteUser(authUserId);
  authUserId = null;
});

async function crearUsuarioAuth(): Promise<string> {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase.auth.admin.createUser({
    email: `test-fm-${sufijo}@ejemplo.test`,
    password: 'contrasena-de-prueba-1234',
    email_confirm: true,
  });
  if (error) throw error;
  authUserId = data.user.id;
  return data.user.id;
}

describe('esAdminFm', () => {
  it('devuelve true cuando el usuario tiene fila en usuarios_fm', async () => {
    const id = await crearUsuarioAuth();
    await supabase.from('usuarios_fm').insert({ auth_user_id: id, email: `fm-${id}@ejemplo.test` });

    expect(await esAdminFm(supabase, id)).toBe(true);
  });

  it('devuelve false cuando el usuario existe pero NO tiene fila en usuarios_fm', async () => {
    const id = await crearUsuarioAuth();

    expect(await esAdminFm(supabase, id)).toBe(false);
  });

  it('devuelve false para un id que no existe', async () => {
    expect(await esAdminFm(supabase, '00000000-0000-0000-0000-000000000000')).toBe(false);
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
  const { data } = await supabase
    .from('usuarios_fm')
    .select('id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  return Boolean(data);
}
```

Run: `npm test -- esAdminFm`
Expected: 3 passed.

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
// cache() lo memoiza por render pass (layout + página + acción comparten una sola consulta).
export const verifyFmAdmin = cache(async () => {
  const supabase = await createClienteServidor();

  // getClaims(), NO getSession(): getSession() no garantiza revalidar el token en servidor.
  const { data } = await supabase.auth.getClaims();
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

Run: `npm test` (37 passed: 34 + 3), `npm run typecheck`, `npm run lint`.
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
 * Es el ÚNICO formato que el spec de Apple garantiza para un pass. Un valor inválido no
 * falla aquí: falla al firmar el pass, en producción, cuando un cliente intenta agregar su
 * tarjeta. Por eso se valida antes de guardar.
 */
export function validarColorRgb(valor: string): boolean {
  const match = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(valor.trim());
  if (!match) return false;

  return match.slice(1).every((n) => {
    const num = Number(n);
    return num >= 0 && num <= 255;
  });
}
```

Run: `npm test -- validarColorRgb`
Expected: 4 passed.

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
  if (slugsDePrueba.length) {
    await supabase.from('comercios').delete().in('slug', slugsDePrueba);
    slugsDePrueba.length = 0;
  }
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
    licencia_activa_desde: '2026-07-16T00:00:00.000Z',
  };
}

describe('crearComercio', () => {
  it('crea un comercio con licencia y branding', async () => {
    const slug = `test-crear-${Date.now()}`;
    const res = await crearComercio(supabase, datosValidos(slug));

    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('comercios')
      .select('nombre, licencia_estado, licencia_monto_mensual')
      .eq('slug', slug)
      .single();
    expect(data!.nombre).toBe('Comercio Test');
    expect(data!.licencia_estado).toBe('activo');
    // Sin Number(): PostgREST devuelve numeric como número JSON. Aserción más fuerte —
    // fallaría ruidosamente si eso cambiara, en vez de que Number() lo tapara en silencio.
    expect(data!.licencia_monto_mensual).toBe(25);
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

// Devuelve el primer problema encontrado, o null si todo está bien.
// TODA la validación vive aquí, no en los Server Actions: esta es la capa con tests de
// integración. Una regla que solo exista en la acción no está cubierta por ninguna prueba.
function validar(datos: DatosComercio): string | null {
  if (!datos.nombre.trim()) return 'El nombre es obligatorio.';
  if (!/^[a-z0-9-]+$/.test(datos.slug)) {
    return 'El slug solo puede tener minúsculas, números y guiones.';
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
  if (monto !== null && (!Number.isFinite(monto) || monto < 0)) {
    return 'El monto mensual debe ser un número positivo.';
  }
  return null;
}

export async function crearComercio(
  supabase: SupabaseClient<Database>,
  datos: DatosComercio,
): Promise<ResultadoGuardar> {
  const problema = validar(datos);
  if (problema) return { ok: false, error: problema };

  const { data, error } = await supabase.from('comercios').insert(datos).select('id').single();

  if (error) {
    // 23505 = unique violation. El único unique aquí es el slug.
    if (error.code === '23505') {
      return { ok: false, error: `Ya existe un comercio con el slug "${datos.slug}".` };
    }
    return { ok: false, error: 'No se pudo crear el comercio.' };
  }

  return { ok: true, id: data.id };
}

export async function actualizarComercio(
  supabase: SupabaseClient<Database>,
  id: string,
  datos: DatosComercio,
): Promise<ResultadoGuardar> {
  const problema = validar(datos);
  if (problema) return { ok: false, error: problema };

  const { error } = await supabase.from('comercios').update(datos).eq('id', id);

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: `Ya existe otro comercio con el slug "${datos.slug}".` };
    }
    return { ok: false, error: 'No se pudo actualizar el comercio.' };
  }

  return { ok: true, id };
}
```

Run: `npm test -- guardarComercio`
Expected: 5 passed.

- [ ] **Step 3: Gates + commit**

Run: `npm test` — expect **46 passed** (34 base + 3 esAdminFm + 4 validarColorRgb + 5 guardarComercio). Run `npm run typecheck`, `npm run lint`.
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
    // Supabase no distingue "no existe la cuenta" de "contraseña incorrecta", a propósito.
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
  'sesion-vencida': 'Tu sesión expiró. Vuelve a entrar.',
};

export default async function PaginaLogin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="shell">
      <div className="stack">
        <p className="kicker reveal d1">FM Lealtad</p>
        <h1 className="title reveal d2">
          Panel <em>interno</em>
        </h1>
        <FormularioLogin mensajeInicial={error ? MENSAJES[error] : undefined} />
      </div>
    </main>
  );
}
```

Reutiliza las clases del sistema visual existente (`shell`, `stack`, `kicker`, `title`, `panel`, `field`, `btn-primary`, `alerta`) definidas en `app/globals.css` — no inventes estilos nuevos.

- [ ] **Step 5: Verificar**

Run: `npm run build` → exitoso (si falla por prerender de `/admin/login`, revisa que la página NO use `useSearchParams()`).
Run: `npm run dev`, abre `http://localhost:3000/admin/login` → se ve el formulario con el estilo del sitio.
Intenta entrar con credenciales falsas → "Correo o contraseña incorrectos." (NO un 500).
Abre `http://localhost:3000/admin/login?error=sin-permiso` → se ve "Esa cuenta no tiene acceso al panel de FM." Detén el dev server.

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
  const { data: comercios } = await supabase
    .from('comercios')
    .select('id, nombre, slug, licencia_estado, licencia_monto_mensual')
    .order('nombre');

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

      {!comercios || comercios.length === 0 ? (
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
    licencia_monto_mensual: monto === null ? null : Number(monto),
    licencia_activa_desde: textoONull(formData.get('licencia_activa_desde')),
  };
}

// Las acciones NO validan: toda la validación (incluido el monto) vive en validar(), dentro
// de guardarComercio.ts, que es la capa con tests. Aquí solo: autenticar, parsear, delegar.
export async function accionCrearComercio(
  _estadoPrevio: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  // Cada Server Action verifica por su cuenta: son POST a la ruta donde se usan, no rutas
  // propias, y los docs de Next dicen explícitamente que no hay que confiar solo en el Proxy.
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

import { useActionState } from 'react';
import type { EstadoFormulario } from './actions';
import type { DatosComercio } from '@/lib/comercios/guardarComercio';

export default function FormularioComercio({
  accion,
  inicial,
  textoBoton,
}: {
  accion: (estado: EstadoFormulario, formData: FormData) => Promise<EstadoFormulario>;
  inicial?: Partial<DatosComercio>;
  textoBoton: string;
}) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoFormulario, FormData>(
    accion,
    undefined,
  );

  return (
    <form className="panel" action={ejecutar}>
      <div className="field">
        <label htmlFor="nombre">Nombre</label>
        <input id="nombre" name="nombre" defaultValue={inicial?.nombre ?? ''} required />
      </div>
      <div className="field">
        <label htmlFor="slug">Slug (la dirección: /registro/…)</label>
        <input
          id="slug"
          name="slug"
          defaultValue={inicial?.slug ?? ''}
          placeholder="cafeteria-piloto"
          required
        />
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
            defaultValue={inicial?.[campo] ?? 'rgb(255, 255, 255)'}
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
          <input id={campo} name={campo} defaultValue={inicial?.[campo] ?? ''} />
        </div>
      ))}

      <div className="field">
        <label htmlFor="licencia_estado">Estado de licencia</label>
        <select
          id="licencia_estado"
          name="licencia_estado"
          defaultValue={inicial?.licencia_estado ?? 'activo'}
        >
          <option value="activo">Activo</option>
          <option value="inactivo">Inactivo</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="licencia_plan">Plan (opcional)</label>
        <input id="licencia_plan" name="licencia_plan" defaultValue={inicial?.licencia_plan ?? ''} />
      </div>
      <div className="field">
        <label htmlFor="licencia_monto_mensual">Monto mensual (opcional)</label>
        <input
          id="licencia_monto_mensual"
          name="licencia_monto_mensual"
          type="number"
          min="0"
          step="0.01"
          defaultValue={inicial?.licencia_monto_mensual ?? ''}
        />
      </div>
      <div className="field">
        <label htmlFor="licencia_activa_desde">Activa desde (opcional)</label>
        <input
          id="licencia_activa_desde"
          name="licencia_activa_desde"
          type="date"
          defaultValue={inicial?.licencia_activa_desde?.slice(0, 10) ?? ''}
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

Agrega el estilo del `<select>` a `app/globals.css` (junto a `.field input`):
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
  const { data: comercio } = await supabase.from('comercios').select('*').eq('id', id).maybeSingle();

  if (!comercio) notFound();

  // bind() fija el id como primer argumento; la firma que ve useActionState sigue siendo
  // (estado, formData).
  const accion = accionActualizarComercio.bind(null, id);

  // Las columnas de color son nullable en la BD (migración 0001) pero DatosComercio las
  // declara string, así que Partial<DatosComercio> las vuelve `string | undefined` y NO
  // acepta null. Pasar `comercio` directo es un error de tipos (TS2322) — hay que mapear.
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
      <FormularioComercio accion={accion} inicial={inicial} textoBoton="Guardar cambios" />
    </main>
  );
}
```

- [ ] **Step 5: Gates + commit**

Run: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` (46 passed).
```bash
git add -A
git commit -m "Add comercio create/edit form and server actions"
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

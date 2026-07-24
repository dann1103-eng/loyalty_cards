# Cuentas multi-negocio + Sucursales + Cajeros + BI — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que un cliente de FM agrupe varios negocios (con o sin sucursales que comparten tarjeta) bajo una cuenta con límite de negocios, con login multi-comercio, cuentas de cajero por sucursal, acreditación/canje atómicos con atribución por sucursal, y pantallas de BI en el panel del dueño y de FM.

**Architecture:** Tabla `cuentas_comercio` sobre `comercios` (nullable `cuenta_id`, defensa en `validar()`); `sucursales` hija de `comercios` que comparte la tarjeta ya existente (`tarjetas` es `UNIQUE(cliente_id, comercio_id)`); atribución `sucursal_id`+`cajero_usuario_id` en el ledger; RPC atómicos Postgres (`SECURITY INVOKER` + `revoke execute`) para acreditar/canjear; reportes por RPC agregados en SQL. Gate compartido `verifyComercioAcceso` (owner o cajero) con comercio activo por cookie revalidada.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Supabase (Postgres + Auth, migraciones a mano), Vitest (integración contra BD viva, `fileParallelism:false`), TypeScript.

**Spec:** `docs/superpowers/specs/2026-07-21-multi-negocio-sucursales-bi-design.md` — leerla; este plan es el desglose ejecutable, la spec tiene el porqué de cada decisión.

**Reglas del proyecto que aplican a TODAS las tareas:**
- TDD: prueba que falla → mínimo para pasar → verde → commit. Mutation-testing OBLIGATORIO donde el paso lo indique (romper la línea guardada, confirmar que la prueba falla por la razón correcta CON el mensaje correcto, restaurar). Backup+restore con `cp archivo archivo.bak` / `cp archivo.bak archivo` para archivos nuevos sin commitear (nunca `git checkout --` sobre no-commiteado).
- Migraciones: el ASISTENTE NO corre DDL. Cada `⚑` es un STOP: se escribe el `.sql`, se pega en el chat, el usuario lo corre en Studio y avisa, y recién ahí sigue el trabajo que depende de esa migración. Verificar después con `npm run verify-schema` y/o un script de solo-lectura.
- `lib/supabase/types.ts` se edita A MANO en el MISMO commit que la migración correspondiente; sus arrays `Relationships` son load-bearing (los joins embebidos no tipan sin ellos); `Functions` debe tener una entrada por cada RPC o `supabase.rpc()` no tipa.
- `comercio_id` SIEMPRE del gate de sesión, NUNCA de un formulario. La cookie de comercio activo se valida contra la lista real de membresías en cada request.
- `redirect()` LANZA `NEXT_REDIRECT`: los gates se llaman FUERA de todo try/catch. NUNCA crear `app/comercio/layout.tsx`.
- Commits: identidad `Daniel <268727888+dann1103-eng@users.noreply.github.com>`, `-m` plano (sin here-strings de PowerShell; usar la Bash tool), trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` al final.
- Correr la suite completa (`npx vitest run`) al cerrar cada fase; typecheck+lint (`npx tsc --noEmit`, `npm run lint`) antes de cerrar fases con cambios de tipos.
- Español en identificadores y comentarios.

---

## Mapa de archivos (qué se crea / se toca)

**Migraciones (a mano):**
- Crear `supabase/migrations/0008_cuentas_sucursales_cajeros.sql`
- Crear `supabase/migrations/0009_rpc_atomico.sql`
- Crear `supabase/migrations/0010_reportes.sql`
- Modificar `scripts/verify-schema.ts` (array `TABLAS`)

**Tipos:**
- Modificar `lib/supabase/types.ts` (tablas, columnas, `Relationships`, `Functions`)

**Auth core / gate:**
- Crear `lib/comercio/membresiasDeUsuario.ts` (+ test)
- Modificar `lib/comercio/esOwnerDeComercio.ts` (single→lista) (+ reescribir su test)
- Crear `lib/comercio/verifyComercioAcceso.ts`
- Modificar `lib/comercio/verifyComercioOwner.ts` (wrapper owner-only + lista `comercios`)
- Modificar `lib/comercio/ownerDeSesion.ts` (comercio activo por cookie)
- Crear `lib/comercio/comercioActivo.ts` (resolver puro de cookie↔membresías) (+ test)

**Selector:**
- Crear `app/comercio/elegir/page.tsx`, `app/comercio/elegir/actions.ts`
- **Modificar** `app/comercio/actions.ts` — YA EXISTE (contiene `cerrarSesionComercio`, del que depende el layout del panel). AGREGAR `cambiarComercioActivo`, CONSERVAR `cerrarSesionComercio`.
- Crear `app/comercio/(protegido)/SelectorComercio.tsx` (dropdown del header)
- Modificar `app/comercio/(protegido)/layout.tsx`, `app/comercio/(protegido)/NavInferior.tsx`
- Modificar `app/comercio/login/actions.ts` (redirect por rol/cantidad)

**Cuentas (panel FM):**
- Crear `lib/comercios/cuentas.ts` (+ test)
- Modificar `lib/comercios/guardarComercio.ts` (`cuenta_id` en `DatosComercio`, `validar()`, límite)
- Modificar `lib/comercios/guardarComercio.test.ts` (factory con cuenta real)
- Crear `app/admin/(protegido)/cuentas/page.tsx`, `.../nuevo/page.tsx`, `.../[id]/page.tsx`, `.../actions.ts`
- Modificar `app/admin/(protegido)/comercios/FormularioComercio.tsx`, `.../comercios/actions.ts`, `.../comercios/nuevo/page.tsx`, `.../comercios/[id]/editar/page.tsx`, `app/admin/(protegido)/layout.tsx`

**Sucursales + cajeros (panel dueño):**
- Crear `lib/comercio/sucursales.ts` (+ test)
- Crear `lib/comercio/cajeros.ts` (+ test)
- Crear `app/comercio/(protegido)/sucursales/` (page/actions/FormularioSucursal/BotonEstadoSucursal)
- Crear `app/comercio/(protegido)/cajeros/` (page/actions/FormularioCajero)

**RPC atómico:**
- Modificar `lib/comercio/acreditar.ts`, `lib/comercio/acreditar.test.ts`
- Modificar `lib/comercio/canje.ts`, `lib/comercio/canje.test.ts`

**Escáner:**
- Crear `lib/comercio/atribucionEscaner.ts` (+ test) — resolver puro anti-spoofing del cajero
- Modificar `app/comercio/(protegido)/escanear/page.tsx`, `Escaner.tsx`, `actions.ts`

**BI:**
- Crear `lib/reportes/reportes.ts` (+ test)
- Crear `app/comercio/(protegido)/reportes/page.tsx`
- Crear `app/admin/(protegido)/reportes/page.tsx`

**Seeds (arreglos):**
- Modificar `scripts/seed-usuario-comercio.ts`, `scripts/seed-demo-owners.ts` (`onConflict`), `scripts/seed-demo-comercios.ts`, `scripts/seed-pilot-comercio.ts` (crear+asignar cuenta)

---

## Fase 1 ⚑ — Migración 0008 (schema base) + types + verify

**Objetivo:** dejar el esquema listo (cuentas, sucursales, columnas de atribución, swap del email) y los tipos TS al día. Nada del lado app se puede probar antes de esto.

### Task 1.1: Escribir la migración 0008 y entregarla al usuario

**Files:**
- Create: `supabase/migrations/0008_cuentas_sucursales_cajeros.sql`

- [ ] **Step 1: Escribir el `.sql`** (byte-exacto — un plan posterior lo puede releer):

```sql
-- 0008: Cuentas (cliente que paga) + sucursales + atribución de cajero/sucursal en el ledger.
-- Migraciones anteriores ya aplicadas a la base viva; todo cambio es append-only.

-- cuentas_comercio: el cliente que paga. limite_negocios se APLICA en la capa app (validar()),
-- la BD solo garantiza el rango con un CHECK. RLS deny-all como el resto del esquema.
create table cuentas_comercio (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  limite_negocios integer not null default 1 check (limite_negocios > 0),
  created_at timestamptz not null default now()
);
alter table cuentas_comercio enable row level security;

-- comercios.cuenta_id: nullable a propósito (la defensa real es validar() en guardarComercio.ts,
-- patrón del proyecto). Se backfillea 1:1 y se QUEDA nullable.
alter table comercios add column cuenta_id uuid references cuentas_comercio(id);

do $$
declare r record; nueva uuid;
begin
  for r in select id, nombre from comercios where cuenta_id is null loop
    insert into cuentas_comercio (nombre, limite_negocios)
      values (r.nombre, 1) returning id into nueva;
    update comercios set cuenta_id = nueva where id = r.id;
  end loop;
end $$;

-- Multi-login: el email deja de ser único global; pasa a único POR comercio (una persona puede
-- ser owner de varios comercios → varias filas con el mismo email/auth_user_id).
alter table usuarios_comercio drop constraint usuarios_comercio_email_key;
alter table usuarios_comercio
  add constraint usuarios_comercio_comercio_email_key unique (comercio_id, email);

-- sucursales: comparten la tarjeta/branding/QR del comercio (tarjetas ya es UNIQUE(cliente,comercio)).
create table sucursales (
  id uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references comercios(id),
  nombre text not null,
  activa boolean not null default true,
  created_at timestamptz not null default now()
);
alter table sucursales enable row level security;

-- Cajero atado a una sucursal (rol 'cajero' ya existe en el CHECK de la 0001).
alter table usuarios_comercio add column sucursal_id uuid references sucursales(id);

-- Atribución por transacción (ambas tablas nunca se leyeron en prod → bajo riesgo).
alter table transacciones_puntos add column sucursal_id uuid references sucursales(id);
alter table canjes add column sucursal_id uuid references sucursales(id);
```

- [ ] **Step 2: STOP — entregar al usuario.** Pegar el bloque SQL en el chat, pedir que lo corra en Supabase Studio y avise. NO seguir hasta la confirmación.

### Task 1.2: Verificar la migración aplicada

- [ ] **Step 1: Extender `scripts/verify-schema.ts`** — agregar `'cuentas_comercio', 'sucursales'` al array `TABLAS`.
- [ ] **Step 2: Correr** `npm run verify-schema`. Esperado: `OK:` para cada tabla, incluidas las dos nuevas.
- [ ] **Step 3: Verificar el backfill** con un script descartable de solo-lectura (`_verif_0008.mjs`, correr con `npx tsx --conditions=react-server`): confirmar que `select count(*) from comercios where cuenta_id is null` = 0, que hay tantas `cuentas_comercio` como comercios, y que `usuarios_comercio` acepta el nuevo unique (probar que dos filas con mismo email + distinto comercio_id conviven — sin insertar basura permanente, o hacerlo y limpiar). Borrar el script al terminar.

### Task 1.3: Actualizar `lib/supabase/types.ts` (tablas y columnas, SIN Functions todavía)

**Files:**
- Modify: `lib/supabase/types.ts`

- [ ] **Step 1:** Agregar la tabla `cuentas_comercio` (Row: `id, nombre: string; limite_negocios: number; created_at: string`; Insert: `nombre` requerido, resto opcional; Update: todo opcional; `Relationships: []`).
- [ ] **Step 2:** Agregar la tabla `sucursales` (Row: `id, comercio_id, nombre: string; activa: boolean; created_at: string`; Insert requeridos `comercio_id, nombre`; `Relationships` con `sucursales_comercio_id_fkey → comercios`).
- [ ] **Step 3:** En `comercios`: agregar `cuenta_id: string | null` a Row/Insert/Update; agregar entrada `Relationships` `comercios_cuenta_id_fkey → cuentas_comercio` (hoy es `[]`).
- [ ] **Step 4:** En `usuarios_comercio`, `transacciones_puntos`, `canjes`: agregar `sucursal_id: string | null` a Row/Insert/Update; agregar en cada uno la entrada `Relationships` `..._sucursal_id_fkey → sucursales` (y, para `transacciones_puntos`/`canjes` que hoy tienen `Relationships: []`, agregar también su FK `tarjeta_id → tarjetas` / `recompensa_id → recompensas` para que futuros joins tipen).
- [ ] **Step 5:** `npx tsc --noEmit`. Esperado: sin errores.
- [ ] **Step 6: Commit.**

```bash
git add supabase/migrations/0008_cuentas_sucursales_cajeros.sql scripts/verify-schema.ts lib/supabase/types.ts
git commit -m "Migración 0008: cuentas, sucursales y atribución de cajero/sucursal + types"
```

---

## Fase 2 — Arreglar `onConflict` de los seeds

**Objetivo:** que los seeds no se rompan silenciosamente con el nuevo unique `(comercio_id, email)`. Sin migración de por medio; es puro código.

### Task 2.1: Cambiar el `onConflict` en los dos seeds de usuarios

**Files:**
- Modify: `scripts/seed-usuario-comercio.ts`, `scripts/seed-demo-owners.ts`

- [ ] **Step 1:** En ambos, cambiar `.upsert({...}, { onConflict: 'email' })` por `{ onConflict: 'comercio_id,email' }` (el payload ya incluye `comercio_id`). Confirmar por lectura que el payload lo tiene.
- [ ] **Step 2: Commit.**

```bash
git add scripts/seed-usuario-comercio.ts scripts/seed-demo-owners.ts
git commit -m "Seeds: onConflict de usuarios_comercio a (comercio_id,email) por el nuevo unique"
```

---

## Fase 3 — Auth core: membresías (lista), gate compartido, resolver de comercio activo

**Objetivo:** eliminar el lockout (`.maybeSingle()`), soportar que una cuenta administre varios comercios, y resolver el comercio activo desde una cookie SIEMPRE validada. Depende de Fase 1.

### Task 3.1: `membresiasDeUsuario` (la consulta base, sin `.maybeSingle()`)

**Files:**
- Create: `lib/comercio/membresiasDeUsuario.ts`, `lib/comercio/membresiasDeUsuario.test.ts`

- [ ] **Step 1: Test que falla** — un `auth_user_id` con DOS filas owner (en dos comercios) devuelve AMBAS. Fixture: crear 2 comercios + 2 filas `usuarios_comercio` con el mismo `auth_user_id` y `rol:'owner'`. Assert: `membresiasDeUsuario(supabase, authUserId)` tiene `length === 2` y contiene ambos `comercioId`. (Este es EXACTAMENTE el caso que antes lanzaba PGRST116.) Teardown FK-ordenado. Correr: `npx vitest run lib/comercio/membresiasDeUsuario.test.ts` → FAIL (módulo no existe).
- [ ] **Step 2: Implementar:**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

export interface Membresia {
  usuarioComercioId: string;
  comercioId: string;
  nombre: string;
  rol: string;
  sucursalId: string | null;
}

// Todas las membresías (owner o cajero) de una cuenta de Auth. Lista, NO maybeSingle(): una cuenta
// puede administrar varios comercios (arreglo del lockout que documentaba esOwnerDeComercio.ts).
// Falla cerrado → [] con log (un error acá es infraestructura, no "sin membresías").
export async function membresiasDeUsuario(
  supabase: SupabaseClient<Database>,
  authUserId: string,
): Promise<Membresia[]> {
  const { data, error } = await supabase
    .from('usuarios_comercio')
    .select('id, comercio_id, rol, sucursal_id, comercios(nombre)')
    .eq('auth_user_id', authUserId);

  if (error) {
    console.error('[comercio] falló la consulta de membresías; se deniega por seguridad:', error);
    return [];
  }
  return (data ?? [])
    .filter((f) => f.comercios)
    .map((f) => ({
      usuarioComercioId: f.id,
      comercioId: f.comercio_id,
      nombre: f.comercios!.nombre,
      rol: f.rol,
      sucursalId: f.sucursal_id,
    }));
}
```

- [ ] **Step 3:** Correr el test → PASS.
- [ ] **Step 4: Mutation** — cambiar `.select(...)` a `.select(...).maybeSingle()` (y adaptar el map). Correr el test de dos-comercios → debe FALLAR (PGRST116 o length≠2). Restaurar. Confirma que el test protege el fix del lockout.

### Task 3.2: `esOwnerDeComercio` → lista de comercios owner

**Files:**
- Modify: `lib/comercio/esOwnerDeComercio.ts`, `lib/comercio/esOwnerDeComercio.test.ts`

- [ ] **Step 1: Reescribir el test** — `esOwnerDeComercio(supabase, authUserId)` devuelve un array `{comercioId, nombre}[]` solo de las membresías `rol:'owner'` (un cajero NO aparece). Casos: cuenta con 1 owner → length 1; cuenta con 2 owner → length 2; cuenta que es solo cajero → length 0; `auth_user_id` inexistente → length 0. Correr → FAIL.
- [ ] **Step 2: Reimplementar** sobre `membresiasDeUsuario` (filtrar `rol==='owner'`, mapear a `{comercioId, nombre}`). Mantener el `console.error`/fail-cerrado vía la función base.
- [ ] **Step 3:** Correr → PASS.
- [ ] **Step 4: Mutation** — quitar el filtro `rol==='owner'` (dejar pasar cajeros). El test "solo cajero → length 0" debe FALLAR. Restaurar.

### Task 3.3: `comercioActivo` — resolver PURO cookie↔membresías (testeable sin request de Next)

**Files:**
- Create: `lib/comercio/comercioActivo.ts`, `lib/comercio/comercioActivo.test.ts`

- [ ] **Step 1: Test que falla.** `resolverComercioActivo(membresias, cookieComercioId)` devuelve:
  - `[]` → `{ tipo: 'sin-acceso' }`
  - 1 membresía → `{ tipo: 'resuelto', membresia }` (ignora la cookie)
  - 2+ y cookie ∈ membresías → `{ tipo: 'resuelto', membresia: la de la cookie }`
  - 2+ y cookie ausente o NO ∈ membresías → `{ tipo: 'elegir' }`
  - **Caso de seguridad:** 2+ y cookie apuntando a un comercio ajeno (no en la lista) → `{ tipo: 'elegir' }` (NO se honra). Correr → FAIL.
- [ ] **Step 2: Implementar** la función pura (sin `cookies()`, sin `redirect()`): un `find` sobre `membresias` por `comercioId === cookieComercioId`; ramas según length y match.
- [ ] **Step 3:** Correr → PASS.
- [ ] **Step 4: Mutation** — hacer que con 2+ devuelva `{tipo:'resuelto', membresia: membresias.find(...) ?? membresias[0]}` SIN verificar que el match existe (o devolver la cookie a ciegas). El test de "cookie ajena → elegir" debe FALLAR. Restaurar. Confirma la revalidación anti-tampering.

### Task 3.4: `verifyComercioAcceso` (gate compartido owner|cajero) + reescribir `verifyComercioOwner`/`ownerDeSesion`

**Files:**
- Create: `lib/comercio/verifyComercioAcceso.ts`
- Modify: `lib/comercio/verifyComercioOwner.ts`, `lib/comercio/ownerDeSesion.ts`

Estos usan `cookies()`/`redirect()` (contexto de request), así que la lógica pura ya está cubierta por 3.3; acá NO se hacen tests unitarios del redirect (se validan en el e2e de la Fase 4). Cuidar: `getClaims()` (no `getSession()`), gate FUERA de try/catch, `cache()`.

- [ ] **Step 1:** Crear `verifyComercioAcceso` (`server-only`, `cache()`): `getClaims()` → sin `sub` → `redirect('/comercio/login')`; `membresias = membresiasDeUsuario(createServiceClient(), sub)`; `resolverComercioActivo(membresias, cookieStore.get('fm_comercio_activo')?.value)`; `sin-acceso` → `redirect('/comercio/login?error=sin-permiso')`; `elegir` → `redirect('/comercio/elegir')`; `resuelto` → devolver `{ authUserId, comercioId, nombre, rol, usuarioComercioId, sucursalId, membresias }`.
- [ ] **Step 2:** Reescribir `verifyComercioOwner` como wrapper: llama `verifyComercioAcceso()`; si `rol !== 'owner'` → si hay alguna membresía cajero `redirect('/comercio/escanear')`, si no `redirect('/comercio/login?error=sin-permiso')`; devolver `{ authUserId, comercioId, nombre }` MÁS `comercios` (= `membresias.filter(rol==='owner').map(...)`, para el selector). Las páginas/acciones existentes que lo llaman NO cambian su uso.
- [ ] **Step 3:** Reescribir `ownerDeSesion` (route handler): resolver membresías + comercio activo; si el activo es owner → `{ comercioId, nombre, usuarioComercioId }`; si no resuelve (2+ sin cookie) o no es owner → `null`. Envuelto en try/catch (corre fuera de request en Vitest) como hoy.
- [ ] **Step 4:** `npx tsc --noEmit` → sin errores. `npx vitest run lib/comercio/` → verde (los tests de membresías/esOwner/comercioActivo pasan; los que dependían del viejo `esOwnerDeComercio` single ya están reescritos).
- [ ] **Step 5: Commit.**

```bash
git add lib/comercio/membresiasDeUsuario.ts lib/comercio/membresiasDeUsuario.test.ts lib/comercio/esOwnerDeComercio.ts lib/comercio/esOwnerDeComercio.test.ts lib/comercio/comercioActivo.ts lib/comercio/comercioActivo.test.ts lib/comercio/verifyComercioAcceso.ts lib/comercio/verifyComercioOwner.ts lib/comercio/ownerDeSesion.ts
git commit -m "Auth core: membresías (lista), gate compartido y comercio activo por cookie revalidada"
```

---

## Fase 4 — Selector de comercio (pantalla + header + redirect por rol)

**Objetivo:** UX del login multi-comercio: 1 comercio directo, 2+ elige/cambia. Depende de Fase 3.

### Task 4.1: Pantalla `/comercio/elegir` (FUERA de `(protegido)`)

**Files:**
- Create: `app/comercio/elegir/page.tsx`, `app/comercio/elegir/actions.ts`

- [ ] **Step 1:** `elegir/page.tsx` (`dynamic='force-dynamic'`): gate liviano — `getClaims()` → sin sub → `redirect('/comercio/login')`; `membresias`; 0 → `redirect('/comercio/login?error=sin-permiso')`; 1 → setear cookie + `redirect('/comercio/panel')`; 2+ → render de una lista con un `<form action={elegirComercio.bind(null, comercioId)}>` por comercio (botón con el nombre). Reusar clases del design system (`.panel`, `.admin-fila`).
- [ ] **Step 2:** `elegir/actions.ts` → `elegirComercio(comercioId, _prev, _fd)`: `getClaims()`; `membresias`; **assert `comercioId ∈ membresias`** (si no, `redirect('/comercio/elegir')` — no confiar en el input); `const cookieStore = await cookies()` (async en este Next); `cookieStore.set('fm_comercio_activo', comercioId, { httpOnly:true, sameSite:'lax', path:'/' })`; `revalidatePath('/comercio','layout')`; `redirect('/comercio/panel')`. NOTA: entre el commit de esta Task 4.1 y el resto de la Fase 4, `/comercio/elegir` recién empieza a existir; los gates de Fase 3 que redirigen ahí no tienen a quién enviar antes — inocuo en la práctica porque tras el backfill ninguna cuenta tiene 2+ comercios (todos caen en la rama de resolución directa).
- [ ] **Step 3: Commit** de la pantalla elegir.

```bash
git add app/comercio/elegir
git commit -m "Pantalla /comercio/elegir para cuentas con varios comercios"
```

### Task 4.2: Selector en el header + cajero shell + redirect del login

**Files:**
- Modify: `app/comercio/actions.ts` (YA EXISTE — agregar `cambiarComercioActivo`, conservar `cerrarSesionComercio`)
- Create: `app/comercio/(protegido)/SelectorComercio.tsx`
- Modify: `app/comercio/(protegido)/layout.tsx`, `app/comercio/(protegido)/NavInferior.tsx`, `app/comercio/login/actions.ts`

- [ ] **Step 1:** En `app/comercio/actions.ts` (CONSERVANDO `cerrarSesionComercio`), agregar `cambiarComercioActivo(comercioId, ...)`: misma lógica de validación+cookie+revalidate+redirect que `elegirComercio` (extraer un helper compartido si conviene, DRY). Recordar: `cookies()` es ASYNC en este Next → `const cookieStore = await cookies()`.
- [ ] **Step 2:** `layout.tsx`: cambiar la llamada del gate a `verifyComercioAcceso()`. Si `rol==='owner'` y `comercios.length>=2`, renderizar `<SelectorComercio comercios={comercios} activo={comercioId} />` (client component: un `<select>`/dropdown que hace `startTransition`→`cambiarComercioActivo`). Si `rol==='cajero'`, header mínimo (nombre comercio + sucursal + "Salir").
- [ ] **Step 3:** `NavInferior.tsx`: aceptar `rol`; cajero ve solo "Escanear" (y "Salir"); owner ve la nav completa (incluye los nuevos ítems de fases siguientes: Sucursales, Cajeros, Reportes — agregar en sus fases).
- [ ] **Step 4:** `login/actions.ts`: tras `signInWithPassword` OK, resolver `membresias`; owner con 2+ → `redirect('/comercio/elegir')`; 1 owner → cookie + `/comercio/panel`; solo cajero → cookie (su comercio) + `/comercio/escanear`; ninguna → `?error=sin-permiso`.
- [ ] **Step 5: Verificación e2e (navegador, controlador — NO subagente).** Con un comercio QA descartable y una cuenta owner de DOS comercios QA: login → aparece `/comercio/elegir` con 2 opciones → elegir uno → panel del correcto → cambiar con el selector → panel del otro. Probar cookie manipulada (editar `fm_comercio_activo` a un id ajeno en devtools) → debe rebotar a `/comercio/elegir`, NO mostrar el comercio ajeno. Con una cuenta de UN solo comercio → entra directo (sin selector). Limpiar fixtures (filas + usuarios Auth).
- [ ] **Step 6: Commit.**

```bash
git add app/comercio/actions.ts "app/comercio/(protegido)/SelectorComercio.tsx" "app/comercio/(protegido)/layout.tsx" "app/comercio/(protegido)/NavInferior.tsx" app/comercio/login/actions.ts
git commit -m "Selector de comercio: dropdown del header, cajero shell y redirect por rol en login"
```

---

## Fase 5 — Cuentas (lib + panel FM) + límite en TODOS los caminos

**Objetivo:** el admin FM crea cuentas, les pone límite, y vincula/crea comercios respetando ese límite. Depende de Fase 1. Incluye el refactor obligatorio de `guardarComercio.test.ts`.

### Task 5.1: `lib/comercios/cuentas.ts` — CRUD + `verificarLimiteCuenta`

**Files:**
- Create: `lib/comercios/cuentas.ts`, `lib/comercios/cuentas.test.ts`

- [ ] **Step 1: Test que falla** para `verificarLimiteCuenta(supabase, cuentaId, opciones?)`. Fixtures: cuenta con `limite_negocios=2`. Casos:
  - 0 comercios → `{ ok:true }`.
  - 1 comercio → `{ ok:true }`.
  - 2 comercios (== límite) → `{ ok:false, error }` con mensaje que menciona el límite.
  - 2 comercios pero `excluyendoComercioId` = uno de ellos (update no-op) → `{ ok:true }` (cuenta 1, no 2).
  Y tests de `crearCuenta` (nombre vacío → error; `limite_negocios` < 1 → error; ok → `{ ok:true, id }`). Correr → FAIL.
- [ ] **Step 2: Implementar.** `verificarLimiteCuenta`:

```ts
export async function verificarLimiteCuenta(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
  opciones?: { excluyendoComercioId?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: cuenta, error: eCuenta } = await supabase
    .from('cuentas_comercio').select('limite_negocios').eq('id', cuentaId).maybeSingle();
  if (eCuenta) { console.error('[fm] no se pudo leer la cuenta:', eCuenta); return { ok: false, error: 'No se pudo verificar el límite de la cuenta.' }; }
  if (!cuenta) return { ok: false, error: 'La cuenta no existe.' };

  let q = supabase.from('comercios').select('id', { count: 'exact', head: true }).eq('cuenta_id', cuentaId);
  if (opciones?.excluyendoComercioId) q = q.neq('id', opciones.excluyendoComercioId);
  const { count, error } = await q;
  if (error) { console.error('[fm] no se pudo contar comercios de la cuenta:', error); return { ok: false, error: 'No se pudo verificar el límite de la cuenta.' }; }

  if ((count ?? 0) >= cuenta.limite_negocios) {
    return { ok: false, error: `Esta cuenta ya alcanzó su límite de ${cuenta.limite_negocios} negocio(s).` };
  }
  return { ok: true };
}
```

  Más `crearCuenta`, `actualizarCuenta` (`.select('id').single()` para detectar no-op → "Esa cuenta ya no existe."), `asignarComercioACuenta(supabase, comercioId, cuentaId)` (llama `verificarLimiteCuenta(cuentaId, {excluyendoComercioId: comercioId})` y luego `update comercios set cuenta_id`).
  Teardown FK de este test: borrar `comercios` (o sus tarjetas si las hubiera) ANTES de `cuentas_comercio`.
- [ ] **Step 3:** Correr → PASS.
- [ ] **Step 4: Mutation A** — cambiar `>=` por `>` en `verificarLimiteCuenta`. El test "2 comercios (== límite) → bloquea" debe FALLAR. Restaurar.
- [ ] **Step 5: Test del camino de reasignar (la corrección del spec-review).** Caso: cuenta destino con `limite_negocios=2` ya con 2 comercios → `asignarComercioACuenta(supabase, tercerComercioId, cuentaDestinoId)` → `{ok:false}` con el mensaje del límite (y el comercio NO queda reasignado). Correr → PASS.
- [ ] **Step 6: Mutation B** — quitar la llamada a `verificarLimiteCuenta` dentro de `asignarComercioACuenta` (que asigne directo). El test del Step 5 debe FALLAR. Restaurar. (Sin esto, el guard del camino de reasignar quedaría sin protección — es una de las correcciones del spec-review.)

### Task 5.2: `guardarComercio.ts` — `cuenta_id` + límite; y refactor de su test

**Files:**
- Modify: `lib/comercios/guardarComercio.ts`, `lib/comercios/guardarComercio.test.ts`

- [ ] **Step 1: Refactor del test PRIMERO** (si no, todo lo demás queda rojo). En `guardarComercio.test.ts`: agregar un helper async `cuentaDePrueba()` que inserta una `cuentas_comercio` con `limite_negocios: 999` (alto, para no interferir), guarda su id para teardown, y lo devuelve. `datosValidos(slug)` pasa a async y agrega `cuenta_id: await cuentaDePrueba()` (o recibe el `cuentaId`). El `afterEach` borra `cuentas_comercio` DESPUÉS de `comercios` (orden FK). Actualizar todos los `datosValidos(...)` call sites a `await`.
- [ ] **Step 2:** Correr `npx vitest run lib/comercios/guardarComercio.test.ts` — ahora FALLA porque `crearComercio` todavía no acepta/exige `cuenta_id` (los tipos y validar aún no cambian). Esto confirma que el test ya ejercita el campo nuevo.
- [ ] **Step 3: Implementar en `guardarComercio.ts`:** `DatosComercio` gana `cuenta_id: string`; `normalizar` lo pasa (trim); `validar()` agrega al inicio `if (!datos.cuenta_id) return 'La cuenta es obligatoria.';`; `crearComercio` llama `verificarLimiteCuenta(supabase, cuenta_id)` antes del insert (si `!ok` → devolver ese error) e incluye `cuenta_id` en el insert; `actualizarComercio` llama `verificarLimiteCuenta(supabase, cuenta_id, {excluyendoComercioId: id})` cuando el `cuenta_id` nuevo difiere del actual (leer el actual primero) — si `!ok`, devolver el error.
- [ ] **Step 4:** Correr → PASS.
- [ ] **Step 5: Mutation** — quitar el guard `if (!datos.cuenta_id)` de `validar()`. Agregar un test que pase `cuenta_id: ''` y espere "La cuenta es obligatoria." → sin el guard debe FALLAR (o fallar en el insert con otro mensaje). Restaurar.

### Task 5.3: Panel FM de cuentas + selector `cuenta_id` en el form de comercio

**Files:**
- Create: `app/admin/(protegido)/cuentas/page.tsx`, `.../nuevo/page.tsx`, `.../[id]/page.tsx`, `.../actions.ts`
- Modify: `app/admin/(protegido)/comercios/FormularioComercio.tsx`, `.../comercios/actions.ts`, `.../comercios/nuevo/page.tsx`, `.../comercios/[id]/editar/page.tsx`, `app/admin/(protegido)/layout.tsx`

- [ ] **Step 1:** Área `cuentas/` (espeja `comercios/`): listar cuentas con conteo de negocios (`comercios` count por `cuenta_id`) y su límite; crear (`accionCrearCuenta` → `crearCuenta`); editar límite y nombre (`accionActualizarCuenta`); vincular/desvincular comercios (`asignarComercioACuenta`); borrar cuenta vacía (traducir 23503 como en `eliminarComercio`). Cada página y acción con `verifyFmAdmin()` fuera de try/catch.
- [ ] **Step 2:** En `comercios/actions.ts` `leerDatos`: agregar `cuenta_id: String(formData.get('cuenta_id') ?? '')`. En `FormularioComercio.tsx`: `<select name="cuenta_id">` poblado con las cuentas (las páginas nuevo/editar cargan la lista y la pasan). En `comercios/[id]/editar/page.tsx` seleccionar la cuenta actual.
- [ ] **Step 3:** `admin/layout.tsx`: agregar link de nav a `/admin/cuentas`.
- [ ] **Step 4: Actualizar los seeds REALES de comercios** (requisito del spec §4.1, hoy faltante): `scripts/seed-demo-comercios.ts` y `scripts/seed-pilot-comercio.ts` insertan directo en `comercios` sin `cuenta_id` (no rompe — la columna es nullable — pero quedan fuera del rollup por cuenta en los reportes FM). Agregar en cada uno: crear una `cuentas_comercio` (nombre = el del comercio, `limite_negocios` acorde) y asignar su `cuenta_id` al comercio. Idempotente por slug como el resto del seed.
- [ ] **Step 5: Verificación (navegador, controlador).** Crear una cuenta límite 2 → crear/vincular 2 comercios OK → intentar un 3ro → bloqueado con el mensaje del límite. Reasignar un comercio entre cuentas respeta el límite del destino.
- [ ] **Step 6:** `npx vitest run` (suite completa) + `npx tsc --noEmit` + `npm run lint` → verde.
- [ ] **Step 7: Commit.**

```bash
git add lib/comercios/cuentas.ts lib/comercios/cuentas.test.ts lib/comercios/guardarComercio.ts lib/comercios/guardarComercio.test.ts "app/admin/(protegido)/cuentas" "app/admin/(protegido)/comercios" "app/admin/(protegido)/layout.tsx" scripts/seed-demo-comercios.ts scripts/seed-pilot-comercio.ts
git commit -m "Cuentas: CRUD FM, cuenta_id en comercios, límite al crear y reasignar, seeds con cuenta"
```

---

## Fase 6 — Sucursales (lib + CRUD del dueño)

**Objetivo:** el dueño crea/renombra/activa-desactiva sucursales. Depende de Fase 1. Espeja `lib/comercio/recompensas.ts`.

### Task 6.1: `lib/comercio/sucursales.ts`

**Files:**
- Create: `lib/comercio/sucursales.ts`, `lib/comercio/sucursales.test.ts`

- [ ] **Step 1: Test que falla.** `crearSucursal(supabase, comercioId, {nombre})` (nombre vacío → error; ok → id). `renombrarSucursal(supabase, id, comercioId, {nombre})` scoped (id de OTRO comercio → no toca nada / error). `cambiarEstadoSucursal(supabase, id, comercioId, activa)` (soft; nunca borra). `listarSucursales(supabase, comercioId)`. `sucursalPerteneceAComercio(supabase, sucursalId, comercioId)` → boolean (sucursal ajena → false). Teardown FK-ordenado: `sucursales` ANTES de `comercios` (y antes de `cuentas_comercio` si el helper creó una). Correr → FAIL.
- [ ] **Step 2: Implementar** (scoping por `comercio_id` en todas, como `recompensas.ts`; `renombrar`/`cambiarEstado` con `.eq('id').eq('comercio_id').select('id').single()`).
- [ ] **Step 3:** Correr → PASS.
- [ ] **Step 4: Mutation** — en `sucursalPerteneceAComercio` quitar el `.eq('comercio_id', comercioId)`. El test "sucursal ajena → false" debe FALLAR. Restaurar. (Este helper es un control de seguridad del picker del dueño.)

### Task 6.2: UI de sucursales en el panel del dueño

**Files:**
- Create: `app/comercio/(protegido)/sucursales/page.tsx`, `.../actions.ts`, `.../FormularioSucursal.tsx`, `.../BotonEstadoSucursal.tsx`
- Modify: `app/comercio/(protegido)/panel/page.tsx` (ATAJOS), `.../NavInferior.tsx`

- [ ] **Step 1:** `page.tsx` (gate `verifyComercioOwner()`) lista sucursales; `actions.ts` (`accionCrearSucursal`, `accionRenombrarSucursal`, `accionCambiarEstado`, cada una re-gate + `comercioId` del gate). Formulario + botón activar/desactivar espejando `recompensas/`.
- [ ] **Step 2:** Agregar "Sucursales" a `ATAJOS` (panel) y a `NavInferior` (owner).
- [ ] **Step 3:** `npx vitest run lib/comercio/sucursales.test.ts` verde; verificación rápida en navegador (crear 2 sucursales, desactivar una).
- [ ] **Step 4: Commit.**

```bash
git add lib/comercio/sucursales.ts lib/comercio/sucursales.test.ts "app/comercio/(protegido)/sucursales" "app/comercio/(protegido)/panel/page.tsx" "app/comercio/(protegido)/NavInferior.tsx"
git commit -m "Sucursales: capa lib scopeada y CRUD en el panel del dueño"
```

---

## Fase 7 — Cajeros (lib + CRUD del dueño, alta en runtime)

**Objetivo:** el dueño crea cuentas de cajero atadas a una sucursal. Depende de Fase 6 (necesita el `<select>` de sucursales).

### Task 7.1: `lib/comercio/cajeros.ts`

**Files:**
- Create: `lib/comercio/cajeros.ts`, `lib/comercio/cajeros.test.ts`

- [ ] **Step 1: Test que falla.** `crearCajero(serviceSupabase, comercioId, {email, password, sucursalId})`: email inválido → error; password corta → error; `sucursalId` de OTRO comercio → error (usar `sucursalPerteneceAComercio`); ok → crea el Auth user (`auth.admin.createUser({email, password, email_confirm:true})`, patrón de `scripts/seed-usuario-comercio.ts`), inserta `usuarios_comercio {comercio_id, email, rol:'cajero', auth_user_id, sucursal_id}` y devuelve `{ok:true, id}`. `listarCajeros(supabase, comercioId)`. `desactivarCajero(supabase, id, comercioId)` (borra la fila `usuarios_comercio` scoped). **La contraseña NUNCA se loguea** (no `console.error(error)` que la incluya; loguear solo el `error.message`). Teardown: borrar la fila + el Auth user creado. Correr → FAIL.
- [ ] **Step 2: Implementar.** Reusar el patrón de `admin.createUser` + fallback `listUsers()` si el email ya existe en Auth (como el seed). Validar `sucursalPerteneceAComercio` ANTES de crear el Auth user.
- [ ] **Step 3:** Correr → PASS.
- [ ] **Step 4: Mutation** — quitar la validación `sucursalPerteneceAComercio`. El test "sucursal ajena → error" debe FALLAR. Restaurar. (Evita atar un cajero a una sucursal de otro comercio.)

### Task 7.2: UI de cajeros en el panel del dueño

**Files:**
- Create: `app/comercio/(protegido)/cajeros/page.tsx`, `.../actions.ts`, `.../FormularioCajero.tsx`
- Modify: `app/comercio/(protegido)/panel/page.tsx` (ATAJOS), `.../NavInferior.tsx`

- [ ] **Step 1:** `page.tsx` (gate owner) lista cajeros con su sucursal; `FormularioCajero.tsx` con email + password + `<select sucursal>` (de `listarSucursales` activas); `actions.ts` `accionCrearCajero` corre `createServiceClient()`, re-gate owner, `comercioId` del gate, delega a `crearCajero`. **La acción no loguea la password.** `accionDesactivarCajero`.
- [ ] **Step 1.5 (PRECONDICIÓN — detectado en review de Fase 4):** antes de crear cualquier cajero, RELAJAR el gate de `app/comercio/(protegido)/escanear/page.tsx` de `verifyComercioOwner()` a `verifyComercioAcceso()`. Hoy un cajero que se loguea es mandado a `/comercio/escanear`, pero esa página usa el gate owner-only que lo rebota a `/comercio/escanear` → **loop infinito de redirect**. El picker/atribución completo llega en Fase 9; acá solo el cambio de gate (y que la página no reviente si `rol==='cajero'`) para que el cajero pueda entrar. Sin esto, la verificación del Step 3 da "demasiadas redirecciones".
- [ ] **Step 2:** Agregar "Cajeros" a ATAJOS + NavInferior (owner).
- [ ] **Step 3:** Verificación (navegador, controlador): crear un cajero atado a una sucursal; loguear con esa cuenta en otra sesión/incógnito → cae en `/comercio/escanear` (SIN loop, gracias al Step 1.5), NO ve el panel de dueño. Limpiar el cajero (fila + Auth user).
- [ ] **Step 4: Commit.**

```bash
git add lib/comercio/cajeros.ts lib/comercio/cajeros.test.ts "app/comercio/(protegido)/cajeros" "app/comercio/(protegido)/panel/page.tsx" "app/comercio/(protegido)/NavInferior.tsx"
git commit -m "Cajeros: alta en runtime por el dueño, atados a una sucursal (rol cajero)"
```

---

## Fase 8 ⚑ — Migración 0009 (RPC atómicos) + reescritura de acreditar/canje

**Objetivo:** acreditar/canjear atómicos y con atribución, sin cambiar el contrato que los tests actuales asertan. Depende de Fases 1, 6.

### Task 8.1: Escribir la migración 0009 y entregarla

**Files:**
- Create: `supabase/migrations/0009_rpc_atomico.sql`

- [ ] **Step 1: Escribir el `.sql`** (byte-exacto). SEGURIDAD: `SECURITY INVOKER` (default) + `revoke execute` de roles públicos + `grant` a `service_role` — sin esto, cualquiera con la anon key salta el gate vía `POST /rest/v1/rpc/`:

```sql
-- 0009: acreditar/canjear atómicos (una transacción, lock de fila) con atribución de sucursal/cajero.
-- SEGURIDAD: funciones SECURITY INVOKER (corren con privilegios del que llama). Todos los callers
-- usan service_role (ignora RLS). Se REVOCA execute de public/anon/authenticated para que la anon
-- key (pública, va al bundle) NO pueda invocarlas por REST saltándose el gate de la app.

-- Soft-delete de cajeros (hallazgo del review de Fase 7): el ledger va a referenciar
-- usuarios_comercio.id por cajero_usuario_id (abajo), y un DELETE físico de un cajero que ya operó
-- lanzaría 23503. Se agrega la columna `activo` para dar de baja sin borrar la fila (preserva la
-- atribución del ledger, igual que el soft-delete de sucursales). La Fase 9 cambia desactivarCajero
-- a UPDATE activo=false y filtra membresiasDeUsuario/listarCajeros por activo.
alter table usuarios_comercio add column activo boolean not null default true;

-- IMPORTANTE (plpgsql): en `returns table(...)` cada columna de salida es una variable OUT dentro
-- del cuerpo. Por eso las columnas OUT se llaman `saldo`/`costo` y NO `puntos_actuales`/`costo_puntos`:
-- si se llamaran igual que las columnas de las tablas, una referencia sin calificar (en el update,
-- el where, el returning o el select) sería AMBIGUA y Postgres lanzaría "column reference ... is
-- ambiguous" en la PRIMERA llamada (default variable_conflict = error). Con nombres OUT distintos,
-- `puntos_actuales`/`costo_puntos` sin calificar refieren SIEMPRE a la columna de la tabla. No cambiar
-- estos nombres sin re-verificar esa regla.

create or replace function acreditar_puntos_atomico(
  p_comercio_id uuid, p_tarjeta_id uuid, p_delta integer,
  p_sucursal_id uuid, p_cajero_usuario_id uuid
) returns table(estado text, saldo integer)
language plpgsql
set search_path = public
as $$
declare v_saldo integer;
begin
  if p_sucursal_id is not null and not exists (
    select 1 from sucursales where id = p_sucursal_id and comercio_id = p_comercio_id and activa
  ) then
    return query select 'sucursal_invalida'::text, null::integer; return;
  end if;

  update tarjetas set puntos_actuales = puntos_actuales + p_delta
    where id = p_tarjeta_id and comercio_id = p_comercio_id
    returning puntos_actuales into v_saldo;
  if not found then
    return query select 'tarjeta_no_encontrada'::text, null::integer; return;
  end if;

  insert into transacciones_puntos (tarjeta_id, puntos_delta, sucursal_id, cajero_usuario_id)
    values (p_tarjeta_id, p_delta, p_sucursal_id, p_cajero_usuario_id);

  return query select 'ok'::text, v_saldo;
end $$;

create or replace function canjear_recompensa_atomico(
  p_comercio_id uuid, p_tarjeta_id uuid, p_recompensa_id uuid,
  p_sucursal_id uuid, p_cajero_usuario_id uuid
) returns table(estado text, saldo integer, nombre_recompensa text, costo integer)
language plpgsql
set search_path = public
as $$
declare v_nombre text; v_costo integer; v_saldo integer; v_actual integer;
begin
  select nombre, costo_puntos into v_nombre, v_costo
    from recompensas where id = p_recompensa_id and comercio_id = p_comercio_id and activa;
  if not found then
    return query select 'recompensa_no_disponible'::text, null::integer, null::text, null::integer; return;
  end if;

  if p_sucursal_id is not null and not exists (
    select 1 from sucursales where id = p_sucursal_id and comercio_id = p_comercio_id and activa
  ) then
    return query select 'sucursal_invalida'::text, null::integer, null::text, null::integer; return;
  end if;

  update tarjetas set puntos_actuales = puntos_actuales - v_costo
    where id = p_tarjeta_id and comercio_id = p_comercio_id and puntos_actuales >= v_costo
    returning puntos_actuales into v_saldo;
  if not found then
    select puntos_actuales into v_actual from tarjetas where id = p_tarjeta_id and comercio_id = p_comercio_id;
    if not found then
      return query select 'tarjeta_no_encontrada'::text, null::integer, null::text, null::integer; return;
    end if;
    return query select 'saldo_insuficiente'::text, v_actual, v_nombre, v_costo; return;
  end if;

  insert into canjes (tarjeta_id, recompensa_id, puntos_gastados, sucursal_id, cajero_usuario_id)
    values (p_tarjeta_id, p_recompensa_id, v_costo, p_sucursal_id, p_cajero_usuario_id);

  return query select 'ok'::text, v_saldo, v_nombre, v_costo;
end $$;

revoke execute on function acreditar_puntos_atomico(uuid, uuid, integer, uuid, uuid) from public, anon, authenticated;
revoke execute on function canjear_recompensa_atomico(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function acreditar_puntos_atomico(uuid, uuid, integer, uuid, uuid) to service_role;
grant execute on function canjear_recompensa_atomico(uuid, uuid, uuid, uuid, uuid) to service_role;
```

- [ ] **Step 2: STOP — entregar al usuario.** Pegar en el chat, esperar confirmación.
- [ ] **Step 3: Verificación C1 (script descartable de solo-verificación).** Con la anon key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, no la service): `supabase.rpc('acreditar_puntos_atomico', {...})` debe dar error de permiso / no escribir. Con service role: funciona. Documentar el resultado. Borrar el script.

### Task 8.2: `types.ts` Functions + reescribir `acreditar.ts`

**Files:**
- Modify: `lib/supabase/types.ts`, `lib/comercio/acreditar.ts`, `lib/comercio/acreditar.test.ts`

- [ ] **Step 1:** Agregar a `Functions` de `types.ts` las entradas de `acreditar_puntos_atomico` y `canjear_recompensa_atomico`. OJO: por ser `returns table(...)`, el tipo de `Returns` es un ARRAY (`{estado: string; saldo: number}[]` / `{estado; saldo; nombre_recompensa; costo}[]`) — por eso los wrappers leen `data?.[0]`. **Además, la 0009 agregó `usuarios_comercio.activo`: agregar `activo: boolean` a su Row/Insert/Update en el MISMO commit** (Fase 9 lo consume para el soft-delete de cajeros).
- [ ] **Step 2: Adaptar el test** de `acreditar.test.ts`: mantener TODOS los casos actuales (delta inválido, tarjeta ajena, saldo/ledger). `acreditarPuntos` ahora acepta `opciones?: {sucursalId?, cajeroUsuarioId?}`. NUEVOS casos: (a) al acreditar con `sucursalId` + `cajeroUsuarioId`, la fila de `transacciones_puntos` queda con esos valores; (b) `sucursalId` de OTRO comercio → `{ok:false}` (estado `sucursal_invalida`); (c) **`sucursalId` del MISMO comercio pero `activa=false` → `{ok:false}` `sucursal_invalida`** (cubre el `and activa` del RPC; sin este caso, quitar `and activa` no se detecta). Fixtures crean sucursales (activa e inactiva). Teardown FK: `transacciones_puntos` → `sucursales` → `tarjetas`/`clientes` → `comercios`. Correr → FAIL (la firma/impl aún no cambia).
- [ ] **Step 3: Reimplementar** `acreditarPuntos(supabase, comercioId, tarjetaId, delta, opciones?)`: conservar la validación de `delta` (mensaje idéntico); reemplazar el read+insert+update por `supabase.rpc('acreditar_puntos_atomico', {p_comercio_id, p_tarjeta_id, p_delta:delta, p_sucursal_id:opciones?.sucursalId ?? null, p_cajero_usuario_id:opciones?.cajeroUsuarioId ?? null})`; leer `const fila = data?.[0]`; **guard: `if (error || !fila) return {ok:false, error:'No se pudo registrar la transacción.'}`** (log del error); mapear `fila.estado`: `ok`→`{ok:true, puntosActuales: fila.saldo}`; `tarjeta_no_encontrada`→`{ok:false, error:'Esa tarjeta no existe en tu comercio.'}` (byte-idéntico); `sucursal_invalida`→`{ok:false, error:'La sucursal no es válida.'}`.
- [ ] **Step 4:** Correr → PASS.
- [ ] **Step 5: Mutation** — quitar `p_sucursal_id`/`p_cajero_usuario_id` del insert dentro del RPC (requiere re-aplicar SQL a mano — o, más práctico, mutar el wrapper para pasar `null` fijo). El test "persiste sucursal/cajero" debe FALLAR. Restaurar.

### Task 8.3: Reescribir `canje.ts`

**Files:**
- Modify: `lib/comercio/canje.ts`, `lib/comercio/canje.test.ts`

- [ ] **Step 1: Adaptar el test:** mantener todos los casos (recompensa ajena/inactiva, saldo insuficiente con "le faltan N", tarjeta ajena, canje OK deja fila). `canjearRecompensa` acepta `opciones?`. NUEVOS: (a) fila `canjes` con `sucursal_id`+`cajero_usuario_id`; (b) `sucursal_id` de otro comercio → rechazo (`sucursal_invalida`); (c) `sucursal_id` del MISMO comercio pero `activa=false` → rechazo (cubre el `and activa`). Teardown FK: `canjes` → `sucursales` → `tarjetas`/`clientes`/`recompensas` → `comercios`. Correr → FAIL.
- [ ] **Step 2: Reimplementar** `canjearRecompensa(supabase, comercioId, tarjetaId, recompensaId, opciones?)`: todo el cuerpo pasa a `supabase.rpc('canjear_recompensa_atomico', {...})`; leer `const fila = data?.[0]`; guard `if (error || !fila) return {ok:false, error:'No se pudo canjear.'}` (log); mapear `fila.estado`: `ok`→`{ok:true, puntosActuales: fila.saldo, nombreRecompensa: fila.nombre_recompensa}`; `recompensa_no_disponible`→`'Esa recompensa no está disponible.'`; `saldo_insuficiente`→`` `No le alcanzan los puntos: le faltan ${fila.costo - fila.saldo}.` `` (el RPC devuelve `saldo`=saldo actual y `costo`=costo de la recompensa); `tarjeta_no_encontrada`→`'Esa tarjeta no existe en tu comercio.'`; `sucursal_invalida`→`'La sucursal no es válida.'`. La reversa best-effort se ELIMINA (ya no aplica).
- [ ] **Step 3:** Correr → PASS.
- [ ] **Step 4: Scope cross-comercio.** El aislamiento entre comercios vive en el `and comercio_id = p_comercio_id` del `update` del RPC (SQL, no wrapper). El test que YA cubre esto es "tarjeta de otro comercio → `tarjeta_no_encontrada`" contra el RPC real: si pasa, el scope está activo end-to-end. La mutación de ese guard requiere re-aplicar DDL a mano (⚑), así que es una **verificación manual asistida por el usuario, opcional**: si se hace, el usuario aplica una versión sin el `and comercio_id`, se confirma que el test cross-comercio falla, y se restaura. No es un paso automatizable por el asistente; el test verde contra el RPC correcto es la garantía primaria.
- [ ] **Step 5:** `npx vitest run` completa verde. **Correr `npm run seed-demos` o el seed que usa `acreditarPuntos` para confirmar que la llamada de 4 args sigue funcionando** (el `opciones?` opcional).
- [ ] **Step 6: Commit.**

```bash
git add supabase/migrations/0009_rpc_atomico.sql lib/supabase/types.ts lib/comercio/acreditar.ts lib/comercio/acreditar.test.ts lib/comercio/canje.ts lib/comercio/canje.test.ts
git commit -m "Migración 0009: RPC atómicos (INVOKER+revoke) y acreditar/canje sobre ellos con atribución"
```

---

## Fase 9 — Escáner: sucursal fija (cajero) vs selector (dueño) + atribución

**Objetivo:** que cada acreditación/canje registre su sucursal y cajero. Depende de Fases 3, 6, 8.

### Task 9.0: Soft-delete de cajeros (precondición — la 0009 ya agregó `usuarios_comercio.activo`)

**Files:**
- Modify: `lib/supabase/types.ts` (agregar `activo: boolean` a `usuarios_comercio` Row/Insert/Update — si no se hizo en Fase 8)
- Modify: `lib/comercio/cajeros.ts` (`desactivarCajero` → soft), `lib/comercio/cajeros.test.ts`
- Modify: `lib/comercio/membresiasDeUsuario.ts` (filtrar `activo`), `lib/comercio/listarCajeros` (filtrar/exponer `activo`)

Antes de que este mismo escáner escriba `cajero_usuario_id` (Task 9.2), cambiar la baja de cajero a soft-delete para no romper con el FK del ledger (hallazgo del review de Fase 7).
- [ ] **Step 1:** `desactivarCajero` pasa de `.delete()` a `.update({ activo: false })` (mismo scoping `comercio_id` + `rol='cajero'`, mismo PGRST116→"ya no existe"). Quitar la traducción interina del 23503 (ya no aplica). Test: la fila NO se borra, queda `activo=false`; el cajero pierde acceso.
- [ ] **Step 2:** `membresiasDeUsuario` agrega `.eq('activo', true)` — un cajero (u owner) con `activo=false` no tiene membresía → sin acceso. (Los owners nacen `activo=true` por default, no se afectan.) `listarCajeros` filtra `activo=true` (o expone el estado). Test: un cajero dado de baja no aparece en la lista ni puede entrar.
- [ ] **Step 3:** Mutation — quitar el `.eq('activo', true)` de `membresiasDeUsuario`; el test "cajero dado de baja no entra" debe FALLAR. Restaurar.
- [ ] **Step 4:** `npx vitest run lib/comercio/` verde; `npx tsc --noEmit` limpio.

### Task 9.1: Resolver PURO de atribución (control de seguridad, mutation-testeable)

**Files:**
- Create: `lib/comercio/atribucionEscaner.ts`, `lib/comercio/atribucionEscaner.test.ts`

Para no depender de `cookies()`/`redirect()` en el test (misma técnica que `resolverComercioActivo` de la Fase 3), la lógica anti-spoofing vive en una función pura.

- [ ] **Step 1: Test que falla.** `resolverSucursalDeAccion(rol, sucursalIdSesion, sucursalIdCliente)`:
  - `rol==='cajero'` → SIEMPRE `sucursalIdSesion`, aunque `sucursalIdCliente` sea otra cosa (un cajero no puede falsear su sucursal). **Caso de seguridad:** `resolverSucursalDeAccion('cajero', 'A', 'B')` === `'A'`.
  - `rol==='owner'` → `sucursalIdCliente` (el owner elige en el picker; la validación de pertenencia la hace la acción con `sucursalPerteneceAComercio`).
  Correr → FAIL.
- [ ] **Step 2: Implementar** la función pura.
- [ ] **Step 3:** Correr → PASS.
- [ ] **Step 4: Mutation** — hacer que para `'cajero'` devuelva `sucursalIdCliente ?? sucursalIdSesion` (confiar en el cliente). El caso `('cajero','A','B') === 'A'` debe FALLAR. Restaurar. (Es EL control que impide que un cajero atribuya visitas a otra sucursal — dato que se le vende al cliente.)

### Task 9.2: Threading de sucursal + cajero en las acciones del escáner

**Files:**
- Modify: `app/comercio/(protegido)/escanear/page.tsx`, `Escaner.tsx`, `actions.ts`

- [ ] **Step 1:** `page.tsx`: gate → `verifyComercioAcceso()`. Cajero → pasar `sucursalFija = {id, nombre}`; owner → `listarSucursales(comercioId)` activas → `sucursales` para el picker. Si el cajero tiene su sucursal DESACTIVADA (no está entre las activas) → estado "tu sucursal está desactivada, contactá al dueño", sin permitir acreditar.
- [ ] **Step 2:** `Escaner.tsx`: si `sucursalFija` → etiqueta read-only; si `sucursales` (owner) → `<select>` que guarda `sucursalIdSeleccionada`. Pasar ese valor a `accionAcreditar`/`accionCanjear`.
- [ ] **Step 3:** `actions.ts`: gate → `verifyComercioAcceso()` en las 3 acciones. `sucursalId = resolverSucursalDeAccion(sesion.rol, sesion.sucursalId, sucursalIdCliente)`; si `rol==='owner'` y `sucursalId` no es null, validar con `sucursalPerteneceAComercio` (rechazar si no); `cajeroUsuarioId = sesion.usuarioComercioId` para ambos. Pasar `{sucursalId, cajeroUsuarioId}` a `acreditarPuntos`/`canjearRecompensa`. Mantener `notificarCambioTarjeta` + `syncObjetoTarjeta`. NOTA (hardening bajo, opcional — review de Fase 8): `cajeroUsuarioId` sale SIEMPRE de `sesion.usuarioComercioId` (la membresía del comercio activo), así que es estructuralmente de este comercio — no hay input del cliente. El RPC no re-valida `cajero_usuario_id` contra `comercio_id` (a diferencia de sucursal), pero como no es alcanzable por el cliente, no se agrega esa validación SQL salvo que un flujo futuro pase el cajero desde afuera del gate.
- [ ] **Step 4: Verificación e2e (navegador, controlador).** Como cajero (cuenta atada a sucursal A): escanear una tarjeta, acreditar → en la BD la fila `transacciones_puntos` tiene `sucursal_id`=A y `cajero_usuario_id`=el cajero. Como dueño: elegir sucursal B en el picker, acreditar → fila con B. Limpiar fixtures.
- [ ] **Step 5: Commit.**

```bash
git add lib/comercio/atribucionEscaner.ts lib/comercio/atribucionEscaner.test.ts "app/comercio/(protegido)/escanear"
git commit -m "Escáner: atribución por sucursal (cajero fijo vs dueño selector) con resolver puro testeado"
```

---

## Fase 10 ⚑ — Migración 0010 (reportes) + pantallas de BI

**Objetivo:** estadísticas por sucursal (dueño) y agregado cross-cliente (FM). Depende de Fase 8 (los datos de atribución deben existir para ser útiles).

### Task 10.1: Escribir la migración 0010 y entregarla

**Files:**
- Create: `supabase/migrations/0010_reportes.sql`

- [ ] **Step 1: Escribir el `.sql`.** Mismo blindaje que 0009 (`SECURITY INVOKER` + `revoke execute from public, anon, authenticated` + `grant to service_role`) en TODAS las funciones. Agregación en SQL. **MISMA trampa de nombres OUT que 0009 (crítico):** en cada `returns table(...)`, las columnas OUT NO deben llamarse igual que columnas de las tablas que se referencian sin calificar en el cuerpo (ej. no usar `sucursal_id`, `costo_puntos`, `puntos_actuales` como nombre OUT si en el `group by`/`select`/`join` se referencian esas columnas sin calificar) — calificar con el nombre de la tabla o aliasar los OUT, o Postgres lanza "column reference ambiguous" en la primera llamada. Funciones: `reporte_sucursales(p_comercio_id)` (por sucursal: acreditaciones, puntos_otorgados, canjes, clientes_unicos — join a `tarjetas` para scopear, bucket NULL para filas sin sucursal); `reporte_top_clientes(p_comercio_id, p_limite)`; `reporte_tendencia(p_comercio_id, p_dias)` (serie por día); `reporte_fm_comercios()` (cross-cliente, **LEFT join** `comercios → cuentas_comercio` para no perder comercios con `cuenta_id` null). Índices: `transacciones_puntos(sucursal_id)`, `canjes(sucursal_id)`, `transacciones_puntos(tarjeta_id)`, `transacciones_puntos(created_at)`.
- [ ] **Step 2: STOP — entregar al usuario.** Esperar confirmación.
- [ ] **Step 3:** Verificar con la anon key que las funciones de reporte NO devuelven datos (mismo chequeo C1). Borrar el script.

### Task 10.2: `lib/reportes/reportes.ts` (wrappers) + pantallas

**Files:**
- Modify: `lib/supabase/types.ts` (Functions de 0010)
- Create: `lib/reportes/reportes.ts`, `lib/reportes/reportes.test.ts`, `app/comercio/(protegido)/reportes/page.tsx`, `app/admin/(protegido)/reportes/page.tsx`
- Modify: `app/comercio/(protegido)/panel/page.tsx` (ATAJOS), `.../NavInferior.tsx`, `app/admin/(protegido)/layout.tsx`

- [ ] **Step 1:** Agregar las entradas `Functions` de 0010 a `types.ts`.
- [ ] **Step 2: Test** de `reportes.ts`: sembrar acreditaciones/canjes en 2 sucursales de un comercio QA; `reporteSucursales(supabase, comercioId)` devuelve los conteos correctos por sucursal (y el bucket NULL si hay filas legacy). `comercioId` siempre explícito (del gate en el uso real). Teardown FK-ordenado: `transacciones_puntos`/`canjes` → `sucursales` → `tarjetas`/`clientes`/`recompensas` → `comercios` → `cuentas_comercio`. Correr → FAIL → implementar wrappers `supabase.rpc(...)` → PASS.
- [ ] **Step 3:** Pantalla dueño (`reportes/page.tsx`, gate `verifyComercioOwner()`): tarjetas por sucursal (clientes, acreditaciones, premios), tendencia, top clientes. Agregar a ATAJOS + NavInferior (owner).
- [ ] **Step 4:** Pantalla FM (`app/admin/(protegido)/reportes/page.tsx`, gate `verifyFmAdmin()`): tabla agregada por comercio y por cuenta. Link de nav en el layout admin.
- [ ] **Step 5:** Ajustar el copy del portal: `app/mi-tarjeta/PortalCliente.tsx` "El canje se hace en el local" → texto neutral (multi-sucursal).
- [ ] **Step 6: Verificación (navegador, controlador).** Tras sembrar datos en distintas sucursales, abrir reportes del dueño y de FM; confirmar que los conteos cuadran con un query directo a la BD.
- [ ] **Step 7:** `npx vitest run` completa + `npx tsc --noEmit` + `npm run lint` verdes.
- [ ] **Step 8: Commit.**

```bash
git add supabase/migrations/0010_reportes.sql lib/supabase/types.ts lib/reportes "app/comercio/(protegido)/reportes" "app/admin/(protegido)/reportes" "app/comercio/(protegido)/panel/page.tsx" "app/comercio/(protegido)/NavInferior.tsx" "app/admin/(protegido)/layout.tsx" app/mi-tarjeta/PortalCliente.tsx
git commit -m "Migración 0010: reportes agregados en SQL y pantallas de BI en panel dueño y FM"
```

---

## Cierre

- [ ] **Verificación e2e integral** (los dos escenarios de §8 del spec): (a) cliente real — cuenta límite 2, 2 comercios distintos (sellos + puntos), un login con selector, tarjetas distintas; (b) sucursales — 2 sucursales + 1 cajero por sucursal, atribución correcta en la BD, BI que cuadra. Limpiar TODAS las fixtures QA (filas + Auth users).
- [ ] **Actualizar la memoria del proyecto** con lo que quede como gotcha durable (el blindaje REST de los RPC ya está anotado; agregar lo que aparezca en la construcción).
- [ ] **Merge a `master` + deploy** SOLO con aprobación explícita del usuario (patrón "dale" del proyecto). Realinear `master` por ff si el usuario promovió algo desde Vercel.
- [ ] Recordar al usuario el feature ENCOLADO (texto/links configurables del reverso de la tarjeta) como el siguiente, con su propio brainstorm/spec.


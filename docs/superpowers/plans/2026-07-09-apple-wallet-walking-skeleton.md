# Apple Wallet Walking Skeleton (Fases 0+1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un cliente real se registra desde un iPhone, agrega su tarjeta a Apple Wallet, y su saldo se actualiza solo (por push) cuando se le suman puntos vía una llamada directa a la API — de punta a punta, con credenciales y firma reales, sin datos de prueba falsos en el camino crítico.

**Architecture:** Next.js App Router (páginas + API routes) sobre Supabase (Postgres). `passkit-generator` genera y firma el `.pkpass` en el servidor. Las actualizaciones llegan al dispositivo vía el protocolo **PassKit Web Service** de Apple: el dispositivo se registra para push, y cuando el saldo cambia, el servidor manda una notificación APNs de payload vacío que le indica al propio dispositivo que vuelva a pedir el pass actualizado — nunca "empujamos" el contenido directamente.

**Tech Stack:** Next.js 15+ (TypeScript, App Router), Supabase (Postgres + `@supabase/supabase-js`), `passkit-generator` 3.5.7, `@parse/node-apn` (autenticación por token `.p8`), Vitest, despliegue en Vercel.

---

## Alcance de este plan

El spec ([`docs/superpowers/specs/2026-07-09-fm-loyalty-mvp-design.md`](../specs/2026-07-09-fm-loyalty-mvp-design.md)) define 6 fases de construcción. Este plan cubre **solo las Fases 0 y 1**: el esquema completo de base de datos y el walking skeleton de Apple Wallet (registro → pass real → push real). Es la parte de mayor riesgo técnico e incertidumbre del proyecto, y la única forma de saber si el enfoque funciona es construirla primero, con el mínimo de código alrededor.

Google Wallet (Fase 2), la configurabilidad real de reglas/recompensas (Fase 3), la PWA de cajero (Fase 4) y el piloto en producción (Fase 5) son subsistemas independientes que tendrán **su propio plan** una vez lleguemos ahí — su forma exacta depende de lo que aprendamos construyendo esto primero.

**Simplificaciones deliberadas de esta fase (YAGNI, no se te olvide que existen):**
- El endpoint de "sumar puntos" (Tarea 11) no tiene autenticación ni PWA de cajero — es una llamada directa sin protección, solo para probar el flujo. **No debe quedar expuesto así en el piloto real** (Fase 4 le pone el rol de cajero encima).
- El endpoint de "listar seriales actualizados" (Tarea 10) no filtra por `passesUpdatedSince` — siempre devuelve todos los seriales registrados para ese dispositivo. Es más tráfico, pero nunca causa que se pierda una actualización, y con un solo comercio piloto el volumen es insignificante.
- No hay RLS por rol todavía — las tablas tienen RLS activado pero sin políticas (deny-all salvo la service role key). Las políticas reales llegan en la Fase 4, cuando exista login de comercio.
- Los colores/branding del comercio piloto son valores de placeholder; el kit gráfico real del diseñador llega en la Fase 5.

---

## Prerrequisitos

- Node.js 20+ instalado.
- Git Bash (ya confirmado disponible) — trae OpenSSL, lo necesitamos para los certificados de Apple.
- Cuenta de Apple Developer Program ya pagada (confirmado).
- Cuenta gratuita en [supabase.com](https://supabase.com) (se crea en la Tarea 2).
- Cuenta gratuita en [vercel.com](https://vercel.com) (se crea en la Tarea 12, para tener una URL pública real — Apple no puede llamar a `localhost`).

---

### Task 1: Scaffold del proyecto Next.js + TypeScript + Vitest

**Files:**
- Create: scaffold completo de Next.js (generado por `create-next-app`)
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Create: `lib/__smoke__.test.ts`

- [ ] **Step 1: Crear el proyecto Next.js en el directorio actual**

Estás en `C:\Users\Daniel\Desktop\Loyalty Cards`, que ya tiene `.git/` y `docs/` — `create-next-app` acepta directorios no vacíos mientras no haya archivos que choquen (como un `package.json` existente), así que esto es seguro.

Run:
```bash
npx create-next-app@latest . --typescript --eslint --app --no-src-dir --import-alias "@/*" --no-tailwind --use-npm
```

Si alguna de esas flags no es reconocida por la versión que se descargue, correlo sin flags (`npx create-next-app@latest .`) y responde el wizard interactivo así: TypeScript **Yes**, ESLint **Yes**, Tailwind **No**, `src/` directory **No**, App Router **Yes**, import alias **Yes**, valor `@/*`.

Expected: el comando termina sin error y aparecen `app/`, `package.json`, `tsconfig.json`, `next.config.ts` (o `.js`/`.mjs`), `.gitignore` (ya incluye `.env*.local` y `node_modules`).

- [ ] **Step 2: Instalar Vitest**

Run: `npm install -D vitest`

- [ ] **Step 3: Configurar Vitest con el mismo alias `@/*` que usa Next**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
```

Create `vitest.setup.ts` (vacío por ahora, se llena en la Tarea 2 para cargar variables de entorno en los tests):
```typescript
export {};
```

- [ ] **Step 4: Agregar scripts de test a `package.json`**

En `package.json`, dentro de `"scripts"`, agrega:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Escribir una prueba de humo y confirmar que el runner funciona**

Create `lib/__smoke__.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('el test runner funciona', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `npm test`
Expected: `1 passed` (1 test file, 1 test).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Scaffold Next.js project with Vitest configured"
```

---

### Task 2: Supabase — proyecto, cliente y variables de entorno

**Files:**
- Create: `lib/supabase/server.ts`
- Create: `.env.local` (no se commitea — ya está en `.gitignore`)
- Create: `.env.local.example`
- Modify: `vitest.setup.ts`

- [ ] **Step 1: Crear el proyecto en Supabase (manual)**

Ve a [supabase.com/dashboard](https://supabase.com/dashboard) → "New project" → nómbralo algo como `fm-loyalty` → elige una región cercana a El Salvador (ej. `us-east-1`) → guarda la contraseña de la base de datos en un lugar seguro (no la necesitamos para lo que sigue, Supabase usa las API keys).

Una vez creado, ve a **Project Settings → API** y copia:
- `Project URL`
- `anon` `public` key
- `service_role` key (⚠️ nunca la expongas al navegador — solo se usa en el servidor)

- [ ] **Step 2: Instalar el cliente de Supabase**

Run: `npm install @supabase/supabase-js`

- [ ] **Step 3: Guardar las variables de entorno**

Create `.env.local` (con tus valores reales):
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

Create `.env.local.example` (sin valores reales, para referencia futura y para que quede en git):
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_BASE_URL=
```

- [ ] **Step 4: Crear el cliente de servidor**

Create `lib/supabase/server.ts`:
```typescript
import { createClient } from '@supabase/supabase-js';

export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
```

Este cliente usa la `service_role` key y se usa **solo en código de servidor** (API routes, scripts) — nunca en un componente de cliente (`'use client'`).

- [ ] **Step 5: Hacer que los tests carguen `.env.local`**

Run: `npm install -D dotenv`

Modify `vitest.setup.ts`:
```typescript
import { config } from 'dotenv';

config({ path: '.env.local' });
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add Supabase server client and environment variable wiring"
```

(`.env.local` no se commitea — verifica con `git status` que solo aparezca `.env.local.example`.)

---

### Task 3: Esquema completo de base de datos

**Files:**
- Create: `supabase/migrations/0001_esquema_inicial.sql`
- Create: `scripts/verify-schema.ts`

Esta tarea crea **todas** las tablas del spec (§4) de una vez, aunque esta Fase 1 solo usa `comercios`, `clientes`, `tarjetas` y `apple_push_registrations` — el resto (`reglas_puntos`, `recompensas`, `transacciones_puntos`, `canjes`, `usuarios_comercio`) se usa desde la Fase 3 en adelante, pero definirlas ahora evita migraciones incrementales más adelante.

- [ ] **Step 1: Escribir la migración SQL**

Create `supabase/migrations/0001_esquema_inicial.sql`:
```sql
create extension if not exists pgcrypto;

create table comercios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  slug text not null unique,
  color_fondo text,
  color_texto text,
  color_label text,
  logo_url text,
  strip_url text,
  hero_url text,
  google_class_id text,
  created_at timestamptz not null default now()
);

create table usuarios_comercio (
  id uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references comercios(id),
  email text not null unique,
  rol text not null check (rol in ('owner', 'cajero')),
  auth_user_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Global por diseño: una persona = un registro, aunque tenga tarjetas en varios comercios (ver spec §4).
create table clientes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  telefono text not null unique,
  created_at timestamptz not null default now()
);

create table tarjetas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  comercio_id uuid not null references comercios(id),
  puntos_actuales integer not null default 0,
  qr_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  apple_serial_number text unique,
  apple_auth_token text,
  google_object_id text unique,
  created_at timestamptz not null default now(),
  unique (cliente_id, comercio_id)
);

create table reglas_puntos (
  id uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references comercios(id),
  tipo text not null check (tipo in ('por_visita', 'por_monto')),
  valor numeric not null,
  activa_desde timestamptz not null default now()
);

create table recompensas (
  id uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references comercios(id),
  nombre text not null,
  descripcion text,
  foto_url text,
  costo_puntos integer not null,
  tipo text not null check (tipo in ('codigo_descuento', 'articulo_gratis', 'otro')),
  valor text,
  activa boolean not null default true,
  created_at timestamptz not null default now()
);

create table transacciones_puntos (
  id uuid primary key default gen_random_uuid(),
  tarjeta_id uuid not null references tarjetas(id),
  cajero_usuario_id uuid references usuarios_comercio(id),
  puntos_delta integer not null,
  monto_compra numeric,
  created_at timestamptz not null default now()
);

create table canjes (
  id uuid primary key default gen_random_uuid(),
  tarjeta_id uuid not null references tarjetas(id),
  recompensa_id uuid not null references recompensas(id),
  cajero_usuario_id uuid references usuarios_comercio(id),
  puntos_gastados integer not null,
  estado text not null default 'completado' check (estado in ('completado', 'cancelado')),
  created_at timestamptz not null default now()
);

-- Tabla TÉCNICA (protocolo Apple, no es dominio de producto — no está en el spec §4).
-- Requerida por el PassKit Web Service para saber a qué dispositivos avisar cuando cambia una tarjeta.
create table apple_push_registrations (
  id uuid primary key default gen_random_uuid(),
  tarjeta_id uuid not null references tarjetas(id),
  device_library_identifier text not null,
  push_token text not null,
  created_at timestamptz not null default now(),
  unique (tarjeta_id, device_library_identifier)
);

-- RLS activado en todo lo que cuelga de comercio_id; sin políticas todavía (deny-all salvo service_role).
-- Las políticas reales por rol llegan en la Fase 4 (PWA de comercio), cuando exista login.
alter table comercios enable row level security;
alter table usuarios_comercio enable row level security;
alter table tarjetas enable row level security;
alter table reglas_puntos enable row level security;
alter table recompensas enable row level security;
alter table transacciones_puntos enable row level security;
alter table canjes enable row level security;
alter table apple_push_registrations enable row level security;
-- clientes: sin RLS — es global por diseño, no cuelga de un comercio.
```

- [ ] **Step 2: Aplicar la migración**

Ve al dashboard de Supabase → tu proyecto → **SQL Editor** → pega el contenido completo del archivo → **Run**.

Expected: "Success. No rows returned" y las 8 tablas aparecen en **Table Editor**.

- [ ] **Step 3: Escribir un script de verificación**

Create `scripts/verify-schema.ts`:
```typescript
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

const TABLAS = [
  'comercios', 'usuarios_comercio', 'clientes', 'tarjetas',
  'reglas_puntos', 'recompensas', 'transacciones_puntos', 'canjes',
  'apple_push_registrations',
];

async function main() {
  const supabase = createServiceClient();
  for (const tabla of TABLAS) {
    const { error } = await supabase.from(tabla).select('id').limit(1);
    if (error) throw new Error(`Tabla '${tabla}' falló: ${error.message}`);
    console.log(`OK: ${tabla}`);
  }
}

main();
```

- [ ] **Step 4: Instalar `tsx` y correr el script**

Run: `npm install -D tsx`
Run: `npx tsx scripts/verify-schema.ts`
Expected: se imprime `OK: <tabla>` una vez por cada una de las 9 tablas, sin errores.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add full database schema migration (all 8 domain tables + apple_push_registrations)"
```

---

### Task 4: Seed del comercio piloto

**Files:**
- Create: `scripts/seed-pilot-comercio.ts`

- [ ] **Step 1: Escribir el script de seed**

Create `scripts/seed-pilot-comercio.ts`:
```typescript
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

async function main() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('comercios')
    .upsert(
      {
        nombre: 'Cafetería Piloto',
        slug: 'cafeteria-piloto',
        color_fondo: 'rgb(35, 24, 18)',
        color_texto: 'rgb(255, 255, 255)',
        color_label: 'rgb(255, 255, 255)',
      },
      { onConflict: 'slug' },
    )
    .select()
    .single();

  if (error) throw error;
  console.log('Comercio piloto listo:', data);
}

main();
```

Nota: usa `upsert` con `onConflict: 'slug'`, así que correr el script varias veces no crea duplicados — es seguro re-ejecutarlo.

- [ ] **Step 2: Correr el seed**

Run: `npx tsx scripts/seed-pilot-comercio.ts`
Expected: imprime el objeto `comercio` con un `id` (uuid) y `slug: 'cafeteria-piloto'`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Add pilot comercio seed script"
```

---

### Task 5: Lógica de identidad cliente/tarjeta (TDD)

Esta es la lógica exacta que el spec-document-reviewer marcó como ambigua y que corregimos en el spec: un `cliente` es único por teléfono a nivel global; una `tarjeta` es única por (cliente, comercio).

**Files:**
- Create: `lib/clientes/registrarCliente.ts`
- Test: `lib/clientes/registrarCliente.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

Create `lib/clientes/registrarCliente.test.ts`:
```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { registrarCliente } from './registrarCliente';

const supabase = createServiceClient();
let ids: { comercioId: string } | null = null;
let idsB: { comercioId: string } | null = null;
const telefonosDePrueba: string[] = [];

afterEach(async () => {
  // Orden importa: borrar hijos (tarjetas) antes que padres (clientes/comercios) por las foreign keys.
  const comercioIds = [ids?.comercioId, idsB?.comercioId].filter(Boolean) as string[];
  if (comercioIds.length) {
    await supabase.from('tarjetas').delete().in('comercio_id', comercioIds);
  }
  if (telefonosDePrueba.length) {
    await supabase.from('clientes').delete().in('telefono', telefonosDePrueba);
    telefonosDePrueba.length = 0;
  }
  if (comercioIds.length) {
    await supabase.from('comercios').delete().in('id', comercioIds);
  }
  ids = null;
  idsB = null;
});

async function crearComercioDePrueba(slug: string): Promise<string> {
  const { data, error } = await supabase
    .from('comercios')
    .insert({ nombre: 'Comercio de prueba', slug })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

describe('registrarCliente', () => {
  it('crea cliente y tarjeta nuevos cuando el teléfono no existe', async () => {
    const comercioId = await crearComercioDePrueba(`test-a-${Date.now()}`);
    ids = { comercioId };
    const telefono = `+503-test-${Date.now()}`;
    telefonosDePrueba.push(telefono);

    const resultado = await registrarCliente(supabase, comercioId, 'Cliente Prueba', telefono);

    expect(resultado.esNuevoCliente).toBe(true);
    expect(resultado.esNuevaTarjeta).toBe(true);
    expect(resultado.qrToken).toHaveLength(32);
  });

  it('reutiliza el cliente si el teléfono ya existe en OTRO comercio', async () => {
    const comercioA = await crearComercioDePrueba(`test-b1-${Date.now()}`);
    const comercioB = await crearComercioDePrueba(`test-b2-${Date.now()}`);
    ids = { comercioId: comercioA };
    idsB = { comercioId: comercioB };
    const telefono = `+503-test-${Date.now()}`;
    telefonosDePrueba.push(telefono);

    const primero = await registrarCliente(supabase, comercioA, 'Cliente Prueba', telefono);
    const segundo = await registrarCliente(supabase, comercioB, 'Cliente Prueba', telefono);

    expect(segundo.clienteId).toBe(primero.clienteId);
    expect(segundo.tarjetaId).not.toBe(primero.tarjetaId);
    expect(segundo.esNuevoCliente).toBe(false);
    expect(segundo.esNuevaTarjeta).toBe(true);
  });

  it('recupera la misma tarjeta si el teléfono ya existe en el MISMO comercio', async () => {
    const comercioId = await crearComercioDePrueba(`test-c-${Date.now()}`);
    ids = { comercioId };
    const telefono = `+503-test-${Date.now()}`;
    telefonosDePrueba.push(telefono);

    const primero = await registrarCliente(supabase, comercioId, 'Cliente Prueba', telefono);
    const segundo = await registrarCliente(supabase, comercioId, 'Cliente Prueba', telefono);

    expect(segundo.tarjetaId).toBe(primero.tarjetaId);
    expect(segundo.esNuevaTarjeta).toBe(false);
  });
});
```

- [ ] **Step 2: Confirmar que fallan**

Run: `npm test -- registrarCliente`
Expected: FAIL — `Cannot find module './registrarCliente'` (todavía no existe).

- [ ] **Step 3: Implementar `registrarCliente`**

Create `lib/clientes/registrarCliente.ts`:
```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

export interface RegistrarClienteResult {
  clienteId: string;
  tarjetaId: string;
  qrToken: string;
  esNuevoCliente: boolean;
  esNuevaTarjeta: boolean;
}

export async function registrarCliente(
  supabase: SupabaseClient,
  comercioId: string,
  nombre: string,
  telefono: string,
): Promise<RegistrarClienteResult> {
  const { data: clienteExistente, error: buscarClienteError } = await supabase
    .from('clientes')
    .select('id')
    .eq('telefono', telefono)
    .maybeSingle();
  if (buscarClienteError) throw buscarClienteError;

  let clienteId: string;
  let esNuevoCliente = false;

  if (clienteExistente) {
    clienteId = clienteExistente.id;
  } else {
    const { data: nuevoCliente, error: crearClienteError } = await supabase
      .from('clientes')
      .insert({ nombre, telefono })
      .select('id')
      .single();
    if (crearClienteError) throw crearClienteError;
    clienteId = nuevoCliente.id;
    esNuevoCliente = true;
  }

  const { data: tarjetaExistente, error: buscarTarjetaError } = await supabase
    .from('tarjetas')
    .select('id, qr_token')
    .eq('cliente_id', clienteId)
    .eq('comercio_id', comercioId)
    .maybeSingle();
  if (buscarTarjetaError) throw buscarTarjetaError;

  if (tarjetaExistente) {
    return {
      clienteId,
      tarjetaId: tarjetaExistente.id,
      qrToken: tarjetaExistente.qr_token,
      esNuevoCliente,
      esNuevaTarjeta: false,
    };
  }

  const qrToken = crypto.randomBytes(16).toString('hex');
  const { data: nuevaTarjeta, error: crearTarjetaError } = await supabase
    .from('tarjetas')
    .insert({ cliente_id: clienteId, comercio_id: comercioId, qr_token: qrToken })
    .select('id, qr_token')
    .single();
  if (crearTarjetaError) throw crearTarjetaError;

  return {
    clienteId,
    tarjetaId: nuevaTarjeta.id,
    qrToken: nuevaTarjeta.qr_token,
    esNuevoCliente,
    esNuevaTarjeta: true,
  };
}
```

- [ ] **Step 4: Confirmar que las pruebas pasan**

Run: `npm test -- registrarCliente`
Expected: `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add registrarCliente with TDD coverage for cross-comercio identity resolution"
```

---

### Task 6: Alta manual en Apple Developer Portal

Esta tarea es manual (portal de Apple + comandos de OpenSSL), no código. Al final tendrás 4 secretos en base64 listos para pegar en `.env.local`.

**Files:**
- Modify: `.env.local`
- Modify: `.env.local.example`

- [ ] **Step 1: Crear el Pass Type ID**

Ve a [developer.apple.com/account](https://developer.apple.com/account) → **Certificates, Identifiers & Profiles** → **Identifiers** → botón **"+"** → elige **Pass Type IDs** → Identifier: `pass.com.fmcomsolutions.loyalty` (ajusta el dominio reverso a algo que controles) → Description: "FM Loyalty Card" → **Register**.

Anota el **Team ID** (visible en Membership, esquina superior derecha de la cuenta) — lo necesitas más adelante.

- [ ] **Step 2: Generar el CSR (Certificate Signing Request) con OpenSSL**

Run (en Git Bash, en una carpeta fuera del repo, ej. tu carpeta personal — estos archivos NUNCA se commitean):
```bash
mkdir -p ~/fm-loyalty-certs && cd ~/fm-loyalty-certs
openssl req -new -newkey rsa:2048 -nodes -keyout signerKey.pem -out request.csr -subj "/CN=FM Loyalty Pass/emailAddress=tu-correo@ejemplo.com"
```
Expected: se crean `signerKey.pem` (llave privada, PEM) y `request.csr`.

- [ ] **Step 3: Subir el CSR y descargar el certificado**

En el Pass Type ID que creaste → **Create Certificate** → sube `request.csr` → descarga el certificado resultante (`pass.cer`, en formato DER).

- [ ] **Step 4: Convertir el certificado a PEM**

Run:
```bash
openssl x509 -inform DER -in pass.cer -out signerCert.pem
```

- [ ] **Step 5: Descargar y convertir el certificado WWDR (Generation 4)**

Busca en la página de soporte de Apple Developer "Apple Worldwide Developer Relations Certification Authority G4" y descarga el `.cer`. **Importante:** debe ser específicamente **Generation 4** — las generaciones anteriores expiraron o no son compatibles.

Run:
```bash
openssl x509 -inform DER -in AppleWWDRCAG4.cer -out wwdr.pem
```

- [ ] **Step 6: Crear la Auth Key de APNs (.p8)**

En [developer.apple.com/account](https://developer.apple.com/account) → **Keys** → **"+"** → marca **"Apple Push Notifications service (APNs)"** → **Continue** → **Register** → descarga el archivo `AuthKey_XXXXXXXXXX.p8` (⚠️ **solo se puede descargar una vez** — guárdalo bien). Anota el **Key ID** (los 10 caracteres en el nombre del archivo).

- [ ] **Step 7: Convertir todo a base64 y guardarlo en `.env.local`**

Run (en Git Bash, ajusta las rutas a donde guardaste cada archivo):
```bash
base64 -w0 signerCert.pem
base64 -w0 signerKey.pem
base64 -w0 wwdr.pem
base64 -w0 AuthKey_XXXXXXXXXX.p8
```

Pega cada resultado en `.env.local` (en el proyecto):
```
APPLE_TEAM_ID=TU_TEAM_ID
APPLE_PASS_TYPE_IDENTIFIER=pass.com.fmcomsolutions.loyalty
APPLE_SIGNER_CERT_B64=<resultado del primer comando>
APPLE_SIGNER_KEY_B64=<resultado del segundo comando>
APPLE_WWDR_B64=<resultado del tercer comando>
APNS_KEY_B64=<resultado del cuarto comando>
APNS_KEY_ID=<los 10 caracteres del nombre del archivo .p8>
```

Modify `.env.local.example` agregando las mismas claves sin valores:
```
APPLE_TEAM_ID=
APPLE_PASS_TYPE_IDENTIFIER=
APPLE_SIGNER_CERT_B64=
APPLE_SIGNER_KEY_B64=
APPLE_WWDR_B64=
APNS_KEY_B64=
APNS_KEY_ID=
```

Guardar los certificados como variables base64 (en vez de archivos leídos del disco) es intencional: así el mismo mecanismo funciona igual en tu máquina y en Vercel (Tarea 12), sin necesitar subir archivos binarios al deploy ni arriesgarte a commitear un `certs/` por accidente.

- [ ] **Step 8: Verificar que los certificados son válidos**

Run (usando los archivos PEM locales, antes de borrarlos):
```bash
openssl x509 -in signerCert.pem -text -noout
openssl x509 -in wwdr.pem -text -noout
openssl rsa -in signerKey.pem -check -noout
```
Expected: los dos primeros comandos imprimen el detalle del certificado (Subject, Issuer, fechas de validez) sin error; el tercero imprime `RSA key ok`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Document Apple Developer credential setup (no secrets committed)"
```

(Solo se commitea el `.env.local.example` actualizado — confirma con `git status` que `.env.local` no aparece.)

---

### Task 7: Plantilla y servicio de generación de pass firmado

**Files:**
- Create: `passModels/loyalty.pass/pass.json`
- Create: `passModels/loyalty.pass/icon.png`, `icon@2x.png`, `icon@3x.png`
- Create: `lib/apple/generatePass.ts`
- Test: `lib/apple/generatePass.test.ts`
- Modify: `next.config.ts` (o `.js`/`.mjs`, según lo que haya generado create-next-app)

- [ ] **Step 1: Instalar `passkit-generator` y `jszip`**

Run: `npm install passkit-generator`
Run: `npm install -D jszip`

- [ ] **Step 2: Arreglar el `next.config` para que el build no truene**

`passkit-generator` tiene un bug conocido con el bundler de Next.js (issue [#248](https://github.com/alexandercerutti/passkit-generator/issues/248)) que puede tumbar el build por falta de memoria. Modify `next.config.ts` (o el que exista):
```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['passkit-generator'],
};

export default nextConfig;
```

- [ ] **Step 3: Crear la plantilla del pass**

Create `passModels/loyalty.pass/pass.json`:
```json
{
  "formatVersion": 1,
  "passTypeIdentifier": "pass.com.fmcomsolutions.loyalty",
  "teamIdentifier": "REEMPLAZA_CON_TU_TEAM_ID",
  "storeCard": {}
}
```
Reemplaza `teamIdentifier` con tu Team ID real de la Tarea 6.

Crea 3 imágenes cuadradas placeholder (el kit gráfico real del diseñador llega en la Fase 5 — cualquier PNG cuadrado sirve por ahora para probar el flujo):
- `passModels/loyalty.pass/icon.png` (29×29 px)
- `passModels/loyalty.pass/icon@2x.png` (58×58 px)
- `passModels/loyalty.pass/icon@3x.png` (87×87 px)

Si tienes ImageMagick instalado, un atajo rápido: `magick -size 29x29 xc:"#231812" passModels/loyalty.pass/icon.png` (y equivalente para las otras dos). Si no, copia cualquier PNG cuadrado que tengas a la mano con esos nombres — Apple no rechaza el pass por esto, solo se vería feo hasta que llegue el arte real.

- [ ] **Step 4: Escribir la prueba que falla**

Create `lib/apple/generatePass.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generarPassApple } from './generatePass';

describe('generarPassApple', () => {
  it('genera un .pkpass válido con los campos esperados', async () => {
    const buffer = await generarPassApple({
      serialNumber: 'test-serial-001',
      qrToken: 'abc123',
      puntos: 10,
      nombreComercio: 'Cafetería Piloto',
      colorFondo: 'rgb(35, 24, 18)',
      colorTexto: 'rgb(255, 255, 255)',
      colorLabel: 'rgb(255, 255, 255)',
      webServiceURL: 'https://example.com/api/apple',
      authenticationToken: '0123456789abcdef0123456789abcdef',
    });

    const zip = await JSZip.loadAsync(buffer);
    expect(Object.keys(zip.files)).toEqual(
      expect.arrayContaining(['pass.json', 'manifest.json', 'signature', 'icon.png']),
    );

    const passJson = JSON.parse(await zip.file('pass.json')!.async('string'));
    expect(passJson.serialNumber).toBe('test-serial-001');
    expect(passJson.storeCard.primaryFields[0].value).toBe(10);
  });
});
```

Run: `npm test -- generatePass`
Expected: FAIL — `Cannot find module './generatePass'`.

- [ ] **Step 5: Implementar el servicio de generación**

Create `lib/apple/generatePass.ts`:
```typescript
import { PKPass } from 'passkit-generator';
import path from 'node:path';

function cargarCertificados() {
  return {
    wwdr: Buffer.from(process.env.APPLE_WWDR_B64!, 'base64'),
    signerCert: Buffer.from(process.env.APPLE_SIGNER_CERT_B64!, 'base64').toString('utf-8'),
    signerKey: Buffer.from(process.env.APPLE_SIGNER_KEY_B64!, 'base64').toString('utf-8'),
  };
}

export interface DatosPass {
  serialNumber: string;
  qrToken: string;
  puntos: number;
  nombreComercio: string;
  colorFondo: string;
  colorTexto: string;
  colorLabel: string;
  webServiceURL: string;
  authenticationToken: string;
}

export async function generarPassApple(datos: DatosPass): Promise<Buffer> {
  const pass = await PKPass.from(
    {
      model: path.join(process.cwd(), 'passModels', 'loyalty.pass'),
      certificates: cargarCertificados(),
    },
    {
      serialNumber: datos.serialNumber,
      organizationName: datos.nombreComercio,
      description: `Tarjeta de lealtad de ${datos.nombreComercio}`,
      logoText: datos.nombreComercio,
      backgroundColor: datos.colorFondo,
      foregroundColor: datos.colorTexto,
      labelColor: datos.colorLabel,
      webServiceURL: datos.webServiceURL,
      authenticationToken: datos.authenticationToken,
    },
  );

  pass.type = 'storeCard';
  pass.primaryFields.push({
    key: 'puntos',
    label: 'PUNTOS',
    value: datos.puntos,
    numberStyle: 'PKNumberStyleDecimal',
  });
  pass.setBarcodes(datos.qrToken);

  return pass.getAsBuffer();
}
```

**Nota sobre colores:** deben ir en formato `rgb(r, g, b)`, no hex — es lo único que el spec de Apple garantiza soportar (el seed de la Tarea 4 ya usa este formato).

- [ ] **Step 6: Confirmar que la prueba pasa**

Run: `npm test -- generatePass`
Expected: `1 passed`. Si falla con un error de certificado, revisa que `.env.local` tenga los 3 valores `_B64` de la Tarea 6 bien pegados (sin saltos de línea de más).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add Apple pass generation service with signing"
```

---

### Task 8: Landing de registro + endpoints de registro y descarga del pass

**Files:**
- Create: `lib/apple/datosPassDeTarjeta.ts`
- Create: `app/api/registro/route.ts`
- Create: `app/api/tarjetas/[tarjetaId]/pass.pkpass/route.ts`
- Create: `app/registro/[comercioSlug]/page.tsx`

- [ ] **Step 1: Crear el helper compartido de mapeo de datos**

Create `lib/apple/datosPassDeTarjeta.ts`:
```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DatosPass } from './generatePass';

export async function datosPassDeTarjeta(
  supabase: SupabaseClient,
  serialNumber: string,
): Promise<{ datos: DatosPass; authTokenAlmacenado: string } | null> {
  const { data: tarjeta } = await supabase
    .from('tarjetas')
    .select('*, comercios(*)')
    .eq('apple_serial_number', serialNumber)
    .maybeSingle();

  if (!tarjeta) return null;

  return {
    authTokenAlmacenado: tarjeta.apple_auth_token,
    datos: {
      serialNumber: tarjeta.apple_serial_number,
      qrToken: tarjeta.qr_token,
      puntos: tarjeta.puntos_actuales,
      nombreComercio: tarjeta.comercios.nombre,
      colorFondo: tarjeta.comercios.color_fondo,
      colorTexto: tarjeta.comercios.color_texto,
      colorLabel: tarjeta.comercios.color_label,
      webServiceURL: `${process.env.NEXT_PUBLIC_BASE_URL}/api/apple`,
      authenticationToken: tarjeta.apple_auth_token,
    },
  };
}
```

- [ ] **Step 2: Endpoint de registro**

Create `app/api/registro/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { registrarCliente } from '@/lib/clientes/registrarCliente';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const { comercioSlug, nombre, telefono } = await request.json();

  if (!comercioSlug || !nombre || !telefono) {
    return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: comercio, error: comercioError } = await supabase
    .from('comercios')
    .select('id')
    .eq('slug', comercioSlug)
    .single();
  if (comercioError || !comercio) {
    return NextResponse.json({ error: 'Comercio no encontrado' }, { status: 404 });
  }

  const resultado = await registrarCliente(supabase, comercio.id, nombre, telefono);

  if (resultado.esNuevaTarjeta) {
    const authToken = crypto.randomBytes(16).toString('hex');
    await supabase
      .from('tarjetas')
      .update({ apple_auth_token: authToken, apple_serial_number: resultado.tarjetaId })
      .eq('id', resultado.tarjetaId);
  }

  return NextResponse.json({ tarjetaId: resultado.tarjetaId });
}
```

Nota: `apple_serial_number` se fija igual al `tarjeta.id` (el UUID interno) — es un identificador opaco para Apple, no hay razón para inventar uno distinto.

- [ ] **Step 3: Endpoint de descarga del pass**

Create `app/api/tarjetas/[tarjetaId]/pass.pkpass/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { generarPassApple } from '@/lib/apple/generatePass';
import { datosPassDeTarjeta } from '@/lib/apple/datosPassDeTarjeta';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tarjetaId: string }> },
) {
  const { tarjetaId } = await params;
  const supabase = createServiceClient();

  const { data: tarjeta } = await supabase
    .from('tarjetas')
    .select('apple_serial_number')
    .eq('id', tarjetaId)
    .maybeSingle();
  if (!tarjeta?.apple_serial_number) {
    return NextResponse.json({ error: 'Tarjeta no encontrada' }, { status: 404 });
  }

  const resultado = await datosPassDeTarjeta(supabase, tarjeta.apple_serial_number);
  if (!resultado) {
    return NextResponse.json({ error: 'Tarjeta no encontrada' }, { status: 404 });
  }

  const buffer = await generarPassApple(resultado.datos);

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': 'attachment; filename="tarjeta.pkpass"',
    },
  });
}
```

- [ ] **Step 4: Página de registro**

Create `app/registro/[comercioSlug]/page.tsx`:
```tsx
'use client';

import { useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';

export default function PaginaRegistro() {
  const { comercioSlug } = useParams<{ comercioSlug: string }>();
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [tarjetaId, setTarjetaId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    try {
      const res = await fetch('/api/registro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comercioSlug, nombre, telefono }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Error al registrar');
      setTarjetaId(data.tarjetaId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setCargando(false);
    }
  }

  if (tarjetaId) {
    return (
      <main>
        <h1>¡Listo!</h1>
        <a href={`/api/tarjetas/${tarjetaId}/pass.pkpass`}>Agregar a Apple Wallet</a>
      </main>
    );
  }

  return (
    <main>
      <h1>Regístrate</h1>
      <form onSubmit={handleSubmit}>
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" required />
        <input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="Teléfono" required />
        <button type="submit" disabled={cargando}>{cargando ? 'Enviando...' : 'Registrarme'}</button>
        {error && <p role="alert">{error}</p>}
      </form>
    </main>
  );
}
```

Sin estilos todavía — no es el foco de este walking skeleton, se puede pulir cuando quieras sin ningún riesgo técnico de por medio.

- [ ] **Step 5: Probar manualmente en el navegador**

Run: `npm run dev`

Abre `http://localhost:3000/registro/cafeteria-piloto`, llena el formulario con un teléfono de prueba, envía. Expected: aparece el enlace "Agregar a Apple Wallet" (el clic real en un iPhone se prueba hasta la Tarea 12, porque Apple necesita una URL pública, no `localhost`).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add registration landing page and pass download endpoint"
```

---

### Task 9: PassKit Web Service — registrar y desregistrar dispositivo

**Files:**
- Create: `app/api/apple/v1/devices/[deviceLibraryIdentifier]/registrations/[passTypeIdentifier]/[serialNumber]/route.ts`
- Test: `app/api/apple/v1/devices/[deviceLibraryIdentifier]/registrations/[passTypeIdentifier]/[serialNumber]/route.test.ts`

Este es el protocolo que Apple exige para poder actualizar passes ya agregados — no es opcional ni configurable, la forma exacta de las rutas y respuestas viene dada por Apple.

- [ ] **Step 1: Escribir la prueba que falla**

Create `app/api/apple/v1/devices/[deviceLibraryIdentifier]/registrations/[passTypeIdentifier]/[serialNumber]/route.test.ts`:
```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, DELETE } from './route';
import { createServiceClient } from '@/lib/supabase/server';

const supabase = createServiceClient();
let ids: { comercioId: string; clienteId: string; tarjetaId: string; serialNumber: string } | null = null;

async function crearTarjetaDePrueba() {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data: comercio } = await supabase
    .from('comercios').insert({ nombre: 'Comercio Test', slug: `test-ws-${sufijo}` }).select('id').single();
  const { data: cliente } = await supabase
    .from('clientes').insert({ nombre: 'Cliente Test', telefono: `+503-ws-${sufijo}` }).select('id').single();
  const serialNumber = `serial-test-${sufijo}`;
  const { data: tarjeta } = await supabase
    .from('tarjetas')
    .insert({
      cliente_id: cliente!.id,
      comercio_id: comercio!.id,
      apple_serial_number: serialNumber,
      apple_auth_token: 'token-de-prueba-1234567890ab',
    })
    .select('id').single();

  ids = { comercioId: comercio!.id, clienteId: cliente!.id, tarjetaId: tarjeta!.id, serialNumber };
  return ids;
}

afterEach(async () => {
  if (!ids) return;
  await supabase.from('apple_push_registrations').delete().eq('tarjeta_id', ids.tarjetaId);
  await supabase.from('tarjetas').delete().eq('id', ids.tarjetaId);
  await supabase.from('clientes').delete().eq('id', ids.clienteId);
  await supabase.from('comercios').delete().eq('id', ids.comercioId);
  ids = null;
});

function crearRequest(serialNumber: string, authorization: string, body: unknown) {
  return new NextRequest(
    `http://localhost/api/apple/v1/devices/device-abc/registrations/pass.com.fmcomsolutions.loyalty/${serialNumber}`,
    { method: 'POST', headers: { authorization }, body: JSON.stringify(body) },
  );
}

describe('POST /api/apple/v1/devices/.../registrations/...', () => {
  it('registra un dispositivo nuevo cuando el token es correcto', async () => {
    const tarjeta = await crearTarjetaDePrueba();
    const request = crearRequest(tarjeta.serialNumber, 'ApplePass token-de-prueba-1234567890ab', { pushToken: 'push-token-de-prueba' });

    const response = await POST(request, {
      params: Promise.resolve({
        deviceLibraryIdentifier: 'device-abc',
        passTypeIdentifier: 'pass.com.fmcomsolutions.loyalty',
        serialNumber: tarjeta.serialNumber,
      }),
    });

    expect(response.status).toBe(201);
  });

  it('rechaza con 401 si el token de autenticación no coincide', async () => {
    const tarjeta = await crearTarjetaDePrueba();
    const request = crearRequest(tarjeta.serialNumber, 'ApplePass token-incorrecto', { pushToken: 'push-token-de-prueba' });

    const response = await POST(request, {
      params: Promise.resolve({
        deviceLibraryIdentifier: 'device-abc',
        passTypeIdentifier: 'pass.com.fmcomsolutions.loyalty',
        serialNumber: tarjeta.serialNumber,
      }),
    });

    expect(response.status).toBe(401);
  });
});
```

Run: `npm test -- devices`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 2: Implementar el endpoint**

Create `app/api/apple/v1/devices/[deviceLibraryIdentifier]/registrations/[passTypeIdentifier]/[serialNumber]/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

type Params = { deviceLibraryIdentifier: string; passTypeIdentifier: string; serialNumber: string };

async function verificarAutenticacion(request: NextRequest, serialNumber: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { data: tarjeta } = await supabase
    .from('tarjetas')
    .select('apple_auth_token')
    .eq('apple_serial_number', serialNumber)
    .maybeSingle();

  const authHeader = request.headers.get('authorization') ?? '';
  const tokenRecibido = authHeader.replace(/^ApplePass\s+/i, '');

  return !!tarjeta && tokenRecibido === tarjeta.apple_auth_token;
}

export async function POST(request: NextRequest, { params }: { params: Promise<Params> }) {
  const { deviceLibraryIdentifier, serialNumber } = await params;

  if (!(await verificarAutenticacion(request, serialNumber))) {
    return new NextResponse(null, { status: 401 });
  }

  const { pushToken } = await request.json();
  const supabase = createServiceClient();

  const { data: tarjeta } = await supabase
    .from('tarjetas').select('id').eq('apple_serial_number', serialNumber).single();

  const { data: existente } = await supabase
    .from('apple_push_registrations')
    .select('id')
    .eq('tarjeta_id', tarjeta!.id)
    .eq('device_library_identifier', deviceLibraryIdentifier)
    .maybeSingle();

  if (existente) {
    return new NextResponse(null, { status: 200 });
  }

  await supabase.from('apple_push_registrations').insert({
    tarjeta_id: tarjeta!.id,
    device_library_identifier: deviceLibraryIdentifier,
    push_token: pushToken,
  });

  return new NextResponse(null, { status: 201 });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<Params> }) {
  const { deviceLibraryIdentifier, serialNumber } = await params;

  if (!(await verificarAutenticacion(request, serialNumber))) {
    return new NextResponse(null, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data: tarjeta } = await supabase
    .from('tarjetas').select('id').eq('apple_serial_number', serialNumber).single();

  await supabase
    .from('apple_push_registrations')
    .delete()
    .eq('tarjeta_id', tarjeta!.id)
    .eq('device_library_identifier', deviceLibraryIdentifier);

  return new NextResponse(null, { status: 200 });
}
```

**Nota de versión:** esto asume Next.js 15+, donde `params` en un Route Handler es una `Promise` que hay que esperar (`await params`). Si `create-next-app@latest` te instaló algo distinto y `params` llega como objeto plano (no Promise), quita el `await` y ajusta el tipo — el resto de la lógica no cambia.

- [ ] **Step 3: Confirmar que las pruebas pasan**

Run: `npm test -- devices`
Expected: `2 passed`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add PassKit Web Service device registration endpoints"
```

---

### Task 10: PassKit Web Service — servir passes actualizados

**Files:**
- Create: `app/api/apple/v1/devices/[deviceLibraryIdentifier]/registrations/[passTypeIdentifier]/route.ts`
- Create: `app/api/apple/v1/passes/[passTypeIdentifier]/[serialNumber]/route.ts`
- Create: `app/api/apple/v1/log/route.ts`

- [ ] **Step 1: Endpoint de seriales actualizados**

Create `app/api/apple/v1/devices/[deviceLibraryIdentifier]/registrations/[passTypeIdentifier]/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

type RegistroConTarjeta = { tarjetas: { apple_serial_number: string } | null };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ deviceLibraryIdentifier: string; passTypeIdentifier: string }> },
) {
  const { deviceLibraryIdentifier } = await params;
  const supabase = createServiceClient();

  // Simplificación deliberada de MVP: no filtramos por `passesUpdatedSince`, devolvemos
  // siempre todos los seriales de ese dispositivo. Apple los volverá a pedir todos
  // (endpoint de "último pass") y comparará — más tráfico, pero nunca se pierde una
  // actualización. Optimizar esto (agregar `updated_at` a `tarjetas` y filtrar) solo
  // vale la pena si el volumen de comercios/clientes crece.
  const { data: registros } = await supabase
    .from('apple_push_registrations')
    .select('tarjetas (apple_serial_number)')
    .eq('device_library_identifier', deviceLibraryIdentifier)
    .returns<RegistroConTarjeta[]>();

  const serialNumbers = (registros ?? [])
    .map((r) => r.tarjetas?.apple_serial_number)
    .filter((s): s is string => Boolean(s));

  if (serialNumbers.length === 0) {
    return new NextResponse(null, { status: 204 });
  }

  return NextResponse.json({
    serialNumbers,
    lastUpdated: String(Math.floor(Date.now() / 1000)),
  });
}
```

- [ ] **Step 2: Endpoint de último pass**

Create `app/api/apple/v1/passes/[passTypeIdentifier]/[serialNumber]/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { generarPassApple } from '@/lib/apple/generatePass';
import { datosPassDeTarjeta } from '@/lib/apple/datosPassDeTarjeta';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ passTypeIdentifier: string; serialNumber: string }> },
) {
  const { serialNumber } = await params;
  const supabase = createServiceClient();

  const resultado = await datosPassDeTarjeta(supabase, serialNumber);
  if (!resultado) {
    return new NextResponse(null, { status: 401 });
  }

  const authHeader = request.headers.get('authorization') ?? '';
  const tokenRecibido = authHeader.replace(/^ApplePass\s+/i, '');
  if (tokenRecibido !== resultado.authTokenAlmacenado) {
    return new NextResponse(null, { status: 401 });
  }

  const buffer = await generarPassApple(resultado.datos);

  return new NextResponse(buffer, {
    status: 200,
    headers: { 'Content-Type': 'application/vnd.apple.pkpass' },
  });
}
```

- [ ] **Step 3: Endpoint de log (stub)**

Create `app/api/apple/v1/log/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (Array.isArray(body?.logs)) {
    console.warn('[Apple Wallet device log]', body.logs.join('\n'));
  }
  return new NextResponse(null, { status: 200 });
}
```

Este endpoint es opcional según Apple, pero sin él el dispositivo recibiría 404 al intentar reportar errores — un stub que responde 200 evita ruido en los logs sin necesitar persistir nada.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add remaining PassKit Web Service endpoints (updated passes, log stub)"
```

(Sin test automatizado aquí — ambos endpoints dependen de que exista una tarjeta real con datos de Apple ya configurados; se verifican de punta a punta en la Tarea 12 con un dispositivo real, que es la única forma de confirmar que Wallet realmente los llama.)

---

### Task 11: Servicio de push APNs + endpoint de sumar puntos

**Files:**
- Create: `lib/apple/enviarPush.ts`
- Create: `lib/apple/notificarCambioTarjeta.ts`
- Test: `lib/apple/notificarCambioTarjeta.test.ts`
- Create: `app/api/tarjetas/[tarjetaId]/puntos/route.ts`
- Test: `app/api/tarjetas/[tarjetaId]/puntos/route.test.ts`

⚠️ **El endpoint de sumar puntos de esta tarea NO tiene autenticación.** Es intencional para esta fase (todavía no hay PWA de cajero ni login) pero no debe quedar así expuesto en el piloto real — la Fase 4 le agrega el rol de cajero.

- [ ] **Step 1: Instalar el cliente de APNs**

Run: `npm install @parse/node-apn`

- [ ] **Step 2: Servicio de envío de push**

Create `lib/apple/enviarPush.ts`:
```typescript
import apn from '@parse/node-apn';

let provider: apn.Provider | null = null;

function obtenerProvider(): apn.Provider {
  if (!provider) {
    provider = new apn.Provider({
      token: {
        key: Buffer.from(process.env.APNS_KEY_B64!, 'base64'),
        keyId: process.env.APNS_KEY_ID!,
        teamId: process.env.APPLE_TEAM_ID!,
      },
      production: true, // los pushes de actualización de pass SOLO funcionan en producción, nunca en sandbox
    });
  }
  return provider;
}

export async function enviarPushActualizacion(pushToken: string, passTypeIdentifier: string) {
  const note = new apn.Notification();
  note.topic = passTypeIdentifier; // el topic es el Pass Type ID, NO un bundle ID de app
  note.expiry = Math.floor(Date.now() / 1000) + 3600;
  note.priority = 10;
  note.rawPayload = {}; // Apple exige un payload vacío para actualizaciones de pass

  return obtenerProvider().send(note, pushToken);
}
```

- [ ] **Step 3: Escribir la prueba que falla para `notificarCambioTarjeta`**

Create `lib/apple/notificarCambioTarjeta.test.ts`:
```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { notificarCambioTarjeta } from './notificarCambioTarjeta';

const supabase = createServiceClient();
let ids: { comercioId: string; clienteId: string; tarjetaId: string } | null = null;

afterEach(async () => {
  if (!ids) return;
  await supabase.from('tarjetas').delete().eq('id', ids.tarjetaId);
  await supabase.from('clientes').delete().eq('id', ids.clienteId);
  await supabase.from('comercios').delete().eq('id', ids.comercioId);
  ids = null;
});

describe('notificarCambioTarjeta', () => {
  it('no lanza error cuando la tarjeta no tiene dispositivos registrados', async () => {
    const sufijo = `${Date.now()}`;
    const { data: comercio } = await supabase
      .from('comercios').insert({ nombre: 'Comercio Test', slug: `test-push-${sufijo}` }).select('id').single();
    const { data: cliente } = await supabase
      .from('clientes').insert({ nombre: 'Cliente Test', telefono: `+503-push-${sufijo}` }).select('id').single();
    const { data: tarjeta } = await supabase
      .from('tarjetas').insert({ cliente_id: cliente!.id, comercio_id: comercio!.id }).select('id').single();

    ids = { comercioId: comercio!.id, clienteId: cliente!.id, tarjetaId: tarjeta!.id };

    await expect(notificarCambioTarjeta(supabase, tarjeta!.id)).resolves.not.toThrow();
  });
});
```

Run: `npm test -- notificarCambioTarjeta`
Expected: FAIL — `Cannot find module './notificarCambioTarjeta'`.

- [ ] **Step 4: Implementar `notificarCambioTarjeta`**

Create `lib/apple/notificarCambioTarjeta.ts`:
```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import { enviarPushActualizacion } from './enviarPush';

export async function notificarCambioTarjeta(supabase: SupabaseClient, tarjetaId: string): Promise<void> {
  const { data: registros } = await supabase
    .from('apple_push_registrations')
    .select('push_token, device_library_identifier')
    .eq('tarjeta_id', tarjetaId);

  if (!registros || registros.length === 0) return;

  const passTypeIdentifier = process.env.APPLE_PASS_TYPE_IDENTIFIER!;

  for (const registro of registros) {
    try {
      const resultado = await enviarPushActualizacion(registro.push_token, passTypeIdentifier);
      const fallo = resultado.failed[0];
      if (fallo && ['BadDeviceToken', 'Unregistered', 'ExpiredToken'].includes(fallo.response?.reason ?? '')) {
        await supabase
          .from('apple_push_registrations')
          .delete()
          .eq('device_library_identifier', registro.device_library_identifier)
          .eq('tarjeta_id', tarjetaId);
      }
    } catch (err) {
      // Un push fallido NUNCA debe tumbar la transacción de puntos — el punto ya quedó
      // guardado en base de datos (ver spec §8, manejo de errores).
      console.error('Error enviando push (ignorado, no bloquea la transacción):', err);
    }
  }
}
```

- [ ] **Step 5: Confirmar que la prueba pasa**

Run: `npm test -- notificarCambioTarjeta`
Expected: `1 passed`.

- [ ] **Step 6: Escribir la prueba que falla para el endpoint de sumar puntos**

Create `app/api/tarjetas/[tarjetaId]/puntos/route.test.ts`:
```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { createServiceClient } from '@/lib/supabase/server';

const supabase = createServiceClient();
let ids: { comercioId: string; clienteId: string; tarjetaId: string } | null = null;

afterEach(async () => {
  if (!ids) return;
  await supabase.from('transacciones_puntos').delete().eq('tarjeta_id', ids.tarjetaId);
  await supabase.from('tarjetas').delete().eq('id', ids.tarjetaId);
  await supabase.from('clientes').delete().eq('id', ids.clienteId);
  await supabase.from('comercios').delete().eq('id', ids.comercioId);
  ids = null;
});

describe('POST /api/tarjetas/[tarjetaId]/puntos', () => {
  it('suma puntos y actualiza el saldo de la tarjeta', async () => {
    const sufijo = `${Date.now()}`;
    const { data: comercio } = await supabase
      .from('comercios').insert({ nombre: 'Comercio Test', slug: `test-puntos-${sufijo}` }).select('id').single();
    const { data: cliente } = await supabase
      .from('clientes').insert({ nombre: 'Cliente Test', telefono: `+503-puntos-${sufijo}` }).select('id').single();
    const { data: tarjeta } = await supabase
      .from('tarjetas').insert({ cliente_id: cliente!.id, comercio_id: comercio!.id }).select('id').single();

    ids = { comercioId: comercio!.id, clienteId: cliente!.id, tarjetaId: tarjeta!.id };

    const request = new NextRequest(`http://localhost/api/tarjetas/${tarjeta!.id}/puntos`, {
      method: 'POST',
      body: JSON.stringify({ puntosDelta: 10 }),
    });

    const response = await POST(request, { params: Promise.resolve({ tarjetaId: tarjeta!.id }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.puntosActuales).toBe(10);

    const { data: transacciones } = await supabase
      .from('transacciones_puntos').select('puntos_delta').eq('tarjeta_id', tarjeta!.id);
    expect(transacciones).toHaveLength(1);
    expect(transacciones![0].puntos_delta).toBe(10);
  });
});
```

Run: `npm test -- puntos`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 7: Implementar el endpoint**

Create `app/api/tarjetas/[tarjetaId]/puntos/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { notificarCambioTarjeta } from '@/lib/apple/notificarCambioTarjeta';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tarjetaId: string }> },
) {
  const { tarjetaId } = await params;
  const { puntosDelta } = await request.json();

  if (typeof puntosDelta !== 'number' || puntosDelta <= 0) {
    return NextResponse.json({ error: 'puntosDelta debe ser un número positivo' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: tarjeta, error: tarjetaError } = await supabase
    .from('tarjetas')
    .select('puntos_actuales')
    .eq('id', tarjetaId)
    .single();
  if (tarjetaError || !tarjeta) {
    return NextResponse.json({ error: 'Tarjeta no encontrada' }, { status: 404 });
  }

  const nuevoSaldo = tarjeta.puntos_actuales + puntosDelta;

  await supabase.from('transacciones_puntos').insert({ tarjeta_id: tarjetaId, puntos_delta: puntosDelta });
  await supabase.from('tarjetas').update({ puntos_actuales: nuevoSaldo }).eq('id', tarjetaId);

  await notificarCambioTarjeta(supabase, tarjetaId);

  return NextResponse.json({ puntosActuales: nuevoSaldo });
}
```

- [ ] **Step 8: Confirmar que la prueba pasa**

Run: `npm test -- puntos`
Expected: `1 passed`.

- [ ] **Step 9: Correr toda la suite completa**

Run: `npm test`
Expected: todos los tests pasan (deberían ser ~10-11 en total entre todas las tareas).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Add APNs push service and points endpoint that triggers wallet updates"
```

---

### Task 12: Verificación manual end-to-end en iPhone real

Apple no puede llamar a `localhost` — el dispositivo necesita una URL pública real para el `webServiceURL` y para descargar el pass. Por eso este último paso requiere desplegar.

**Files:** ninguno (despliegue + verificación manual)

- [ ] **Step 1: Crear cuenta en Vercel y desplegar**

Ve a [vercel.com](https://vercel.com) → crea una cuenta (puedes usar tu GitHub) → "Add New Project" → importa este repositorio (necesitarás subirlo a GitHub primero si no lo has hecho: `git remote add origin <url>` y `git push -u origin master`, o usa `vercel` CLI directo con `npx vercel`).

- [ ] **Step 2: Configurar las variables de entorno en Vercel**

En el dashboard del proyecto en Vercel → **Settings → Environment Variables**, agrega **todas** las que tienes en `.env.local`:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APPLE_TEAM_ID`, `APPLE_PASS_TYPE_IDENTIFIER`, `APPLE_SIGNER_CERT_B64`, `APPLE_SIGNER_KEY_B64`, `APPLE_WWDR_B64`, `APNS_KEY_B64`, `APNS_KEY_ID`.

Para `NEXT_PUBLIC_BASE_URL`, usa la URL que Vercel te asigna (ej. `https://loyalty-cards.vercel.app`) — la sabrás después del primer deploy; puedes agregarla y volver a desplegar.

Vuelve a desplegar después de guardar las variables (Vercel no las aplica automáticamente a un deploy ya hecho): **Deployments → (...) → Redeploy**.

- [ ] **Step 2: Actualizar el pass.json de la plantilla con el Team ID real**

Si no lo hiciste ya en la Tarea 7, confirma que `passModels/loyalty.pass/pass.json` tiene tu `teamIdentifier` real (no el placeholder) antes de este deploy.

- [ ] **Step 3: Registrarte desde un iPhone real**

Desde Safari **en el iPhone**, abre `https://<tu-deploy>.vercel.app/registro/cafeteria-piloto`. Llena el formulario con tu nombre y tu número. Envía.

- [ ] **Step 4: Agregar la tarjeta a Wallet**

Toca "Agregar a Apple Wallet". Debe abrirse la vista previa nativa de Wallet mostrando el branding del comercio piloto y "0" puntos. Toca "Agregar".

Expected: la tarjeta aparece en la app Wallet del iPhone.

- [ ] **Step 5: Sumar puntos desde afuera y confirmar la actualización automática**

Obtén el `tarjetaId` (de la respuesta JSON del registro, con las herramientas de desarrollador de Safari, o consultando la tabla `tarjetas` en Supabase Studio filtrando por el teléfono que usaste).

Run (desde tu computadora):
```bash
curl -X POST https://<tu-deploy>.vercel.app/api/tarjetas/<tarjetaId>/puntos \
  -H "Content-Type: application/json" \
  -d '{"puntosDelta": 10}'
```
Expected: `{"puntosActuales":10}`.

Espera unos segundos a un minuto (el push no es instantáneo) y abre la app Wallet en el iPhone. **La tarjeta debe mostrar "10" puntos sin que hayas hecho nada manualmente** — ese es el hito completo de esta fase.

- [ ] **Step 6: Si no se actualiza sola, diagnosticar**

Run: `vercel logs <tu-deploy>` (o revisa **Deployments → Functions** en el dashboard) y busca:
- ¿Llegó el `POST` a `/api/apple/v1/devices/.../registrations/...` cuando agregaste la tarjeta a Wallet? (confirma que el dispositivo se registró)
- ¿El `POST /api/tarjetas/.../puntos` llamó a `notificarCambioTarjeta` sin error?
- ¿Apple llamó de vuelta a `/api/apple/v1/devices/.../registrations/...` (GET) y luego a `/api/apple/v1/passes/...` después del push?

- [ ] **Step 7: Confirmar el hito y commitear cualquier ajuste**

Si algo se ajustó durante la verificación (ej. el `teamIdentifier` de la plantilla, una variable de entorno faltante), commitea esos cambios:
```bash
git add -A
git commit -m "Fix issues found during real-device verification"
```

**Con esto, el walking skeleton de Apple Wallet queda de punta a punta.** El siguiente plan (Fase 2: Google Wallet) se escribe cuando llegues aquí — puede aprovechar la mayoría de esta infraestructura (el esquema ya existe, `registrarCliente` no cambia, solo se agrega la generación/actualización del lado de Google).

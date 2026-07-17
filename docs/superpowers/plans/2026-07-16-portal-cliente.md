# Portal del cliente (consulta de saldo, instalable como PWA) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una vista web ligera e instalable (`/mi-tarjeta`) donde el cliente final ingresa su teléfono y ve, solo lectura, el saldo de su(s) tarjeta(s) (puntos o "N de M sellos"), las recompensas que puede canjear y un botón para volver a descargar su pass — complementando al pass de Wallet, sin reemplazarlo.

**Architecture:** Un Route Handler POST (`app/api/portal/consulta`) por consistencia con el endpoint hermano `/api/tarjetas/[id]/puntos` (misma postura: `createServiceClient()`, `NextResponse.json`, `runtime = 'nodejs'`, público). La lógica testeable vive en funciones puras de `lib/portal/` (límite de intentos y búsqueda por teléfono, con pruebas de integración contra Supabase real); el Route Handler es un cascarón delgado que obtiene la IP, aplica el límite y delega. La página es `'use client'` y consume esa ruta. La instalabilidad es `app/manifest.ts` + íconos PNG reales generados con `next/og` (incluido en Next, sin dependencia nueva), y metadata `appleWebApp` + `apple-touch-icon` en un layout acotado a `/mi-tarjeta` (NO en el layout raíz).

**Tech Stack:** Next.js 16 (App Router, Route Handlers, `MetadataRoute.Manifest`, `next/og` `ImageResponse`), `@supabase/supabase-js` (service client), `@vercel/functions` (extracción de IP — nueva dependencia), Vitest (integración contra Supabase real).

---

## Alcance de este plan

Implementa el spec [2026-07-16-portal-cliente-design.md](../specs/2026-07-16-portal-cliente-design.md) completo:

1. Migración `0006`: tabla `intentos_consulta_portal(id, ip, created_at)` + índice en `(ip, created_at)`.
2. Nueva dependencia `@vercel/functions` + `obtenerIp()` (verificando la API real antes de escribir código).
3. Límite de intentos por IP (máx. 10 por 15 min) como función testeable.
4. Búsqueda por teléfono → tarjetas + comercio (nombre, colores, tipo, saldo) + recompensas activas, con el saldo formateado como TEXTO (sellos: "N de M sellos", nunca una grilla visual).
5. Route Handler `app/api/portal/consulta/route.ts` (POST) que cablea IP → límite → búsqueda.
6. Página `/mi-tarjeta` (`'use client'`): formulario de teléfono → resultado (selector si hay varias tarjetas, saldo/sellos, recompensas, botón de re-descarga del pass).
7. `app/manifest.ts` + íconos reales 192/512 (generados con `next/og`) + `apple-touch-icon` 180 + metadata `appleWebApp`, con copy honesto sobre el flujo de instalación en iOS (Compartir → Agregar a inicio, no un prompt del navegador).

**Fuera de alcance** (spec §5): verificación por SMS/OTP (el límite por IP es la mitigación de esta fase), canje/redención desde el portal (sigue siendo exclusivo del cajero físico), service worker / offline, notificaciones push, cuenta con contraseña para el cliente, y limpieza automática de `intentos_consulta_portal`.

## Hechos verificados que este plan asume

Investigados y confirmados contra el código y los docs empaquetados del propio proyecto (`node_modules/next/dist/docs/`). **Confía en estos por encima de tu memoria de entrenamiento.**

1. **Íconos: se generan con `next/og`, NO se comitean PNGs binarios.** El spec §4 sugería "íconos reales de 192×192 y 512×512 en `public/`". Verificado que `next/og` viene incluido en Next 16 (`require('next/og')` carga `ImageResponse`, una función) y que la convención de archivos `apple-icon`/`icon` de Next rasteriza JSX a PNG real en build (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/app-icons.md`). Se usa esa vía en lugar de PNGs binarios en `public/`: **cero dependencias nuevas**, íconos PNG reales del tamaño exacto, y el "asset" es código revisable en el diff (no un binario opaco). Es una desviación deliberada y mejor que las dos opciones que el spec imaginó (script con librería, o asset manual). Ver Tarea 7.
2. **`@vercel/functions` NO está instalado hoy** (no aparece en `package.json` ni en `node_modules`). Por eso la Tarea 2 **instala y VERIFICA** el nombre/firma exacto del helper de IP contra el paquete instalado antes de usarlo, con un fallback documentado (`x-forwarded-for`, ÚLTIMO valor). No se asume la API de memoria.
3. **Numeración de migración: esta es `0006`, no `0005`.** En disco existen `0001`–`0004`. El spec de la Fase 3 ([2026-07-16-fase3-autogestion-catalogo-design.md](../specs/2026-07-16-fase3-autogestion-catalogo-design.md) §4.1) reclama `0005` para agregar `comercios.tipo_tarjeta` y `comercios.sello_meta` — columnas que la búsqueda de este portal LEE. Por eso la Fase 3 va primero (prerrequisito duro, ver abajo) y esta migración es la `0006`. **El implementador DEBE confirmar el siguiente número libre con `ls supabase/migrations/` antes de escribir el archivo**, y renumerar si la realidad difiere.
4. **`lib/supabase/types.ts` está transcrito a mano** (ver su encabezado) y `comercios.Row` **hoy NO tiene** `tipo_tarjeta` ni `sello_meta`: esas entradas las agrega la edición de la Fase 3. La búsqueda de este portal (y su tipo) dependen de que esas columnas existan en la BD y en `types.ts` — de ahí el prerrequisito.
5. **El embed `tarjetas → comercios` ya resuelve su tipo:** `types.ts` tiene la Relationship `tarjetas_comercio_id_fkey` (verificado). Así `.select('..., comercios(...)')` desde `tarjetas` tipa como objeto-a-uno. Las `recompensas` se consultan aparte con `.in('comercio_id', ...)` (evita el embed inverso `comercios(recompensas(...))`, que exigiría una Relationship que `recompensas` no tiene hoy).
6. **`clientes` no tiene `comercio_id`** (verificado en `0001`): una búsqueda por teléfono cruza TODOS los comercios a la vez — justo la razón del límite de intentos (spec §3).
7. **El Route Handler hermano** `app/api/tarjetas/[tarjetaId]/puntos/route.ts` fija la postura a imitar: `export const runtime = 'nodejs'`, `createServiceClient()`, `NextResponse.json(...)`, sin autenticación. La ruta del portal es público-con-límite, igual espíritu.
8. **El botón de re-descarga reusa el endpoint existente:** `href="/api/tarjetas/${tarjetaId}/pass.pkpass"` (verificado en `app/registro/[comercioSlug]/RegistroCliente.tsx`, y el endpoint en `app/api/tarjetas/[tarjetaId]/pass.pkpass/route.ts` devuelve 404 si la tarjeta no tiene `apple_serial_number`).
9. **El layout raíz (`app/layout.tsx`) NO tiene `appleWebApp` ni `apple-touch-icon`** (verificado). Esta metadata se agrega a un layout NUEVO acotado a `/mi-tarjeta`, no al raíz (spec §4).
10. **Las pruebas son de integración contra Supabase remoto** (`vitest.setup.ts` carga `.env.local`; `vitest.config.ts`: `environment: 'node'`, `testTimeout: 20000`, `fileParallelism: false`). Se replica el patrón existente: sufijos únicos por fila + `afterEach` que limpia y registra los fallos de borrado (nunca los traga).

## Prerrequisitos

- **La Fase 3 debe estar fusionada ANTES que este plan (prerrequisito DURO).** La búsqueda del portal lee `comercios.tipo_tarjeta` y `comercios.sello_meta`; sin ellas, la consulta falla en la BD y `types.ts` no compila. En concreto se necesita: (a) la migración `0005` de la Fase 3 aplicada a la BD compartida (una sola Supabase para local y prod, sin entornos separados), y (b) las columnas `tipo_tarjeta`/`sello_meta` presentes en `lib/supabase/types.ts`. Rama nueva desde `master` **después** de ese merge (ver Tarea 0). Si por alguna razón la migración `0005` está aplicada pero su edición de `types.ts` no está en tu rama, agrégalas a mano a `comercios.Row`/`Insert`/`Update` antes de la Tarea 4.
- `.env.local` en la raíz ya tiene `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`. **No se agregan variables de entorno nuevas.**
- `node_modules` instalado (`npm install`).

### Nota sobre el conteo de pruebas (baseline)

La suite del proyecto tiene hoy **61 pruebas** (medido sobre los `*.test.ts` de la rama `feature/fm-admin-panel`). Este plan agrega **exactamente 15** (final: **76**). Los números absolutos de cada tarea (65, 72, 76) asumen ese baseline de 61. **Como la Fase 3 es prerrequisito y trae sus propias pruebas, si se fusionó antes que este plan, suma su cantidad a cada total absoluto de abajo** — lo que este plan garantiza son los deltas (+4, +7, +4). Verifica siempre el número real con `npm test` en tu rama.

---

### Task 0: Rama de trabajo

- [ ] **Step 1: Confirmar el prerrequisito de la Fase 3 y crear la rama**

Confirma que `comercios.tipo_tarjeta` y `comercios.sello_meta` existen en `lib/supabase/types.ts` (Fase 3 fusionada):
```bash
grep -n "tipo_tarjeta\|sello_meta" lib/supabase/types.ts
```
Expected: al menos las líneas de `comercios.Row`. Si no aparecen, **detente**: falta el prerrequisito (ver Prerrequisitos).

```bash
git checkout master
git checkout -b feature/portal-cliente
git status
```
Expected: `On branch feature/portal-cliente`, working tree clean.

---

### Task 1: Migración 0006 — `intentos_consulta_portal` + índice

**Files:**
- Create: `supabase/migrations/0006_intentos_consulta_portal.sql`
- Modify: `lib/supabase/types.ts`
- Modify: `scripts/verify-schema.ts`

- [ ] **Step 1: Confirmar el número de migración libre**

```bash
ls supabase/migrations/
```
Expected: hasta `0005_*` (de la Fase 3). El siguiente libre es **`0006`**. Si lo que ves difiere (p. ej. la Fase 3 usó otro número o hay un `0006` ya), usa el siguiente libre real y ajusta el nombre del archivo y los mensajes de commit en consecuencia.

- [ ] **Step 2: Escribir la migración**

Create `supabase/migrations/0006_intentos_consulta_portal.sql`:

```sql
-- 0006: Portal del cliente — límite de intentos de consulta por IP.
-- Migraciones anteriores ya aplicadas a la base viva; todo cambio es append-only.
-- Esta tabla es autónoma (no referencia otras). El portal, además, LEE comercios.tipo_tarjeta y
-- comercios.sello_meta, que agrega la migración 0005 de la Fase 3 (prerrequisito de este plan).

create table intentos_consulta_portal (
  id uuid primary key default gen_random_uuid(),
  ip text not null,
  created_at timestamptz not null default now()
);

-- El límite se evalúa como "cuántos intentos de esta IP en los últimos 15 minutos". El índice
-- compuesto (ip, created_at) hace ese conteo eficiente (filtro por ip + rango de fecha) sin
-- escanear toda la tabla a medida que crece.
create index intentos_consulta_portal_ip_created_at_idx
  on intentos_consulta_portal (ip, created_at);

alter table intentos_consulta_portal enable row level security;
-- Sin políticas: deny-all salvo service_role, igual que el resto del esquema. El portal usa
-- createServiceClient() (ignora RLS), consistente con todo el proyecto.
```

- [ ] **Step 3: Aplicar la migración (manual)**

Dashboard de Supabase → **SQL Editor** → pegar el contenido → **Run**.
Expected: "Success. No rows returned". La tabla `intentos_consulta_portal` aparece en Table Editor con su índice.

- [ ] **Step 4: Actualizar el tipo `Database`**

`lib/supabase/types.ts` se mantiene a mano (ver su encabezado). Agrega la tabla nueva al objeto `Tables` (mismo patrón que las demás; sin Relationships):

```typescript
      intentos_consulta_portal: {
        Row: {
          id: string;
          ip: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          ip: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          ip?: string;
          created_at?: string;
        };
        Relationships: [];
      };
```

- [ ] **Step 5: Verificar contra la BD real**

Modify `scripts/verify-schema.ts`: agrega `'intentos_consulta_portal'` al arreglo `TABLAS` (respeta el `as const`).

Run: `npm run verify-schema`
Expected: `OK: intentos_consulta_portal` junto a las otras tablas, sin errores.

- [ ] **Step 6: Gates + commit**

Run: `npm run typecheck` → limpio.
```bash
git add -A
git commit -m "Add intentos_consulta_portal table for portal rate limiting"
```

---

### Task 2: `@vercel/functions` + `obtenerIp()` (verificar la API primero)

Extraer la IP del cliente es un adaptador de plataforma delgado (como los wrappers que leen cookies en el panel de FM): se verifica a mano, no con pruebas unitarias. La lógica testeable (el límite) recibe la IP como parámetro y llega en la Tarea 3.

**Files:**
- Modify: `package.json` (nueva dependencia)
- Create: `lib/portal/obtenerIp.ts`

- [ ] **Step 1: Instalar el paquete**

Run: `npm install @vercel/functions`
Expected: instala sin conflicto de peer deps. Si falla, reporta el error — NO uses `--force` ni `--legacy-peer-deps` sin avisar.

Verifica que la suite existente siga verde tras instalar:
Run: `npm test`
Expected: 61 passed (baseline; súmale la Fase 3 si ya está fusionada — ver nota de baseline).

- [ ] **Step 2: VERIFICAR el nombre y la firma exactos del helper de IP**

**No asumas la API de memoria.** Inspecciona el paquete instalado:
```bash
cat node_modules/@vercel/functions/package.json
ls node_modules/@vercel/functions/dist
```
Y abre el archivo de tipos (`.d.ts`) que exporte el helper de IP (o el `README.md` si viene incluido). Busca la función que extrae la IP de un `Request`/`Headers`.

**Lo que esperas confirmar** (spec §3): una función exportada `ipAddress` que recibe el `Request` (o sus `Headers`) y devuelve `string | undefined`, pensada para resolver la cadena de proxies de Vercel. **Anota el nombre y la firma reales que encontraste.** Tres desenlaces:
- Coincide (`ipAddress(request)`) → úsalo tal cual en el Step 3.
- Difiere (otro nombre o firma) → ajusta el import y la llamada del Step 3 a lo que confirmaste.
- El paquete no ofrece un helper usable → borra el import y deja SOLO el fallback de `x-forwarded-for` del Step 3 (Plan B).

- [ ] **Step 3: Escribir `obtenerIp()`**

Create `lib/portal/obtenerIp.ts`:

```typescript
import { ipAddress } from '@vercel/functions';

// Extrae la IP del cliente. La fuente confiable en Vercel es el helper del paquete oficial
// (@vercel/functions), que resuelve la cadena de proxies correctamente.
//
// OJO IMPLEMENTADOR: el nombre `ipAddress` y su firma (recibe el Request, devuelve
// string | undefined) se CONFIRMAN en el Step 2 contra el paquete instalado. Si difieren, ajusta
// este import y la llamada. Si el paquete no ofreciera un helper usable, borra el import y usa
// solo el fallback de abajo (Plan B). No inventes una firma que no confirmaste.
export function obtenerIp(request: Request): string {
  // Envuelto en try/catch a propósito: fuera de Vercel (p. ej. en Vitest) el helper puede no
  // resolver nada, y un adaptador de IP nunca debe tumbar la request — si no da resultado o
  // lanza, se cae al fallback de abajo. No es una suposición sobre su comportamiento: es que
  // extraer la IP no es motivo para fallar la consulta.
  try {
    const desdePaquete = ipAddress(request);
    if (desdePaquete) return desdePaquete;
  } catch (error) {
    console.warn('[portal] el helper de IP falló; se usa el fallback de x-forwarded-for:', error);
  }

  // Plan B (fallback documentado, spec §3): el ÚLTIMO valor de x-forwarded-for. En Vercel el
  // proxy AÑADE la IP real al final de la cadena, no la reemplaza — por eso tomar el PRIMER valor
  // sería falsificable (el atacante controla los valores de la izquierda y podría rotar la
  // cabecera en cada request para esquivar el límite). El último valor es el que puso Vercel.
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const partes = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (partes.length > 0) return partes[partes.length - 1];
  }

  // Sin IP identificable: un solo cubo compartido. Colapsa hacia limitar (varios clientes sin IP
  // comparten cupo) en vez de hacia no-limitar — el lado seguro para un mecanismo anti-raspado.
  return 'ip-desconocida';
}
```

- [ ] **Step 4: Gates + commit**

Run: `npm run typecheck`, `npm run lint` → limpios.
```bash
git add -A
git commit -m "Add @vercel/functions and obtenerIp client-IP helper"
```

---

### Task 3: Límite de intentos por IP (TDD)

**Files:**
- Create: `lib/portal/limiteIntentos.ts`
- Test: `lib/portal/limiteIntentos.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Create `lib/portal/limiteIntentos.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { verificarYRegistrarIntento, LIMITE_INTENTOS, VENTANA_MINUTOS } from './limiteIntentos';

const supabase = createServiceClient();
// La columna ip es text, no inet: cualquier string sirve como marcador de prueba, y usar uno
// único por test aísla las filas de otras corridas y del tráfico real.
const ipsDePrueba: string[] = [];

function ipUnica(): string {
  const ip = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  ipsDePrueba.push(ip);
  return ip;
}

afterEach(async () => {
  if (!ipsDePrueba.length) return;
  const { error } = await supabase.from('intentos_consulta_portal').delete().in('ip', ipsDePrueba);
  if (error) console.error('[test] no se pudieron borrar los intentos de prueba:', error);
  ipsDePrueba.length = 0;
});

// Siembra N intentos para una IP, todos con el mismo created_at (por defecto: ahora).
async function sembrar(ip: string, cantidad: number, created_at?: string) {
  const filas = Array.from({ length: cantidad }, () => ({ ip, ...(created_at ? { created_at } : {}) }));
  const { error } = await supabase.from('intentos_consulta_portal').insert(filas);
  if (error) throw error;
}

describe('verificarYRegistrarIntento', () => {
  it('permite el primer intento de una IP y registra la fila', async () => {
    const ip = ipUnica();

    const permitido = await verificarYRegistrarIntento(supabase, ip);

    expect(permitido).toBe(true);
    const { count } = await supabase
      .from('intentos_consulta_portal')
      .select('*', { count: 'exact', head: true })
      .eq('ip', ip);
    expect(count).toBe(1); // registró el intento aunque lo permitió
  });

  it('bloquea cuando la IP ya alcanzó el límite en la ventana, y aun así registra el intento', async () => {
    const ip = ipUnica();
    await sembrar(ip, LIMITE_INTENTOS); // exactamente el límite, todos "ahora"

    const permitido = await verificarYRegistrarIntento(supabase, ip);

    expect(permitido).toBe(false); // el intento nº (límite+1) se bloquea
    // "insert regardless of outcome": aun bloqueado, deja rastro (hostigar mantiene el bloqueo).
    const { count } = await supabase
      .from('intentos_consulta_portal')
      .select('*', { count: 'exact', head: true })
      .eq('ip', ip);
    expect(count).toBe(LIMITE_INTENTOS + 1);
  });

  it('no cuenta intentos fuera de la ventana de tiempo', async () => {
    const ip = ipUnica();
    // Muy por encima del límite, pero todos VIEJOS (fuera de la ventana): no deben contar.
    const viejo = new Date(Date.now() - (VENTANA_MINUTOS + 5) * 60_000).toISOString();
    await sembrar(ip, LIMITE_INTENTOS + 5, viejo);

    const permitido = await verificarYRegistrarIntento(supabase, ip);

    // Sin el filtro .gte('created_at', ...), estos viejos contarían y esto sería false.
    expect(permitido).toBe(true);
  });

  it('cuenta por IP, no de forma global', async () => {
    const ipLlena = ipUnica();
    await sembrar(ipLlena, LIMITE_INTENTOS);
    const ipLibre = ipUnica();

    // Sin el .eq('ip', ip), el conteo sería global y esta IP nueva heredaría el bloqueo de la otra.
    expect(await verificarYRegistrarIntento(supabase, ipLibre)).toBe(true);
  });
});
```

Run: `npm test -- limiteIntentos`
Expected: FAIL — `Cannot find module './limiteIntentos'`.

- [ ] **Step 2: Implementar**

Create `lib/portal/limiteIntentos.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

// Máx. intentos permitidos por IP dentro de la ventana. Exportados para que las pruebas y
// cualquier futuro consumidor no dupliquen los números mágicos.
export const LIMITE_INTENTOS = 10;
export const VENTANA_MINUTOS = 15;

// Cuenta los intentos PREVIOS de esta IP en la ventana, REGISTRA el intento actual (exitoso o no)
// y devuelve si se permite continuar. Contar antes de insertar hace que el intento nº (límite+1)
// vea `límite` previos y se bloquee — o sea, máximo `LIMITE_INTENTOS` por ventana.
//
// Se registra SIEMPRE, aun al bloquear: así hostigar el endpoint mantiene la IP por encima del
// límite (ventana deslizante) en vez de darle un cupo nuevo cada vez.
export async function verificarYRegistrarIntento(
  supabase: SupabaseClient<Database>,
  ip: string,
): Promise<boolean> {
  const desde = new Date(Date.now() - VENTANA_MINUTOS * 60_000).toISOString();

  const { count, error: errorConteo } = await supabase
    .from('intentos_consulta_portal')
    .select('*', { count: 'exact', head: true })
    .eq('ip', ip)
    .gte('created_at', desde);

  const { error: errorInsert } = await supabase.from('intentos_consulta_portal').insert({ ip });
  if (errorInsert) {
    // El registro es best-effort: si falla, no reventamos la consulta del cliente por eso, pero
    // dejamos rastro (un fallo sistemático de inserts anularía el límite en silencio).
    console.error('[portal] no se pudo registrar el intento de consulta:', errorInsert);
  }

  if (errorConteo) {
    // Fallar CERRADO: si no podemos contar, negamos. Un atacante no debe poder habilitar la
    // enumeración tumbando el conteo. El costo (bloquear a un cliente legítimo durante una caída
    // de BD, con un dato de bajo riesgo) es tolerable; fallar abierto reabriría justo el raspado
    // que este límite existe para frenar.
    console.error('[portal] no se pudo contar intentos; se bloquea por seguridad:', errorConteo);
    return false;
  }

  return (count ?? 0) < LIMITE_INTENTOS;
}
```

Run: `npm test -- limiteIntentos`
Expected: 4 passed.

- [ ] **Step 3: Gates + commit**

Run: `npm test` → **65 passed** (61 + 4). Run `npm run typecheck`, `npm run lint`.
Confirma 0 filas `test-%` huérfanas en `intentos_consulta_portal`.
```bash
git add -A
git commit -m "Add per-IP attempt rate limiter for the client portal"
```

---

### Task 4: Búsqueda por teléfono + formato de saldo (TDD)

**Files:**
- Create: `lib/portal/buscarTarjetas.ts`
- Test: `lib/portal/buscarTarjetas.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Create `lib/portal/buscarTarjetas.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { buscarTarjetasPorTelefono, formatearSaldo } from './buscarTarjetas';

const supabase = createServiceClient();
const comerciosDePrueba: string[] = [];
const clientesDePrueba: string[] = [];
const tarjetasDePrueba: string[] = [];

afterEach(async () => {
  // Orden: hijos antes que padres. tarjetas -> (clientes, comercios); recompensas -> comercios.
  if (tarjetasDePrueba.length) {
    const { error } = await supabase.from('tarjetas').delete().in('id', tarjetasDePrueba);
    if (error) console.error('[test] no se pudieron borrar las tarjetas:', error);
    tarjetasDePrueba.length = 0;
  }
  if (comerciosDePrueba.length) {
    const { error: eR } = await supabase.from('recompensas').delete().in('comercio_id', comerciosDePrueba);
    if (eR) console.error('[test] no se pudieron borrar las recompensas:', eR);
  }
  if (clientesDePrueba.length) {
    const { error } = await supabase.from('clientes').delete().in('id', clientesDePrueba);
    if (error) console.error('[test] no se pudieron borrar los clientes:', error);
    clientesDePrueba.length = 0;
  }
  if (comerciosDePrueba.length) {
    const { error } = await supabase.from('comercios').delete().in('id', comerciosDePrueba);
    if (error) console.error('[test] no se pudieron borrar los comercios:', error);
    comerciosDePrueba.length = 0;
  }
});

async function crearComercio(extra: Record<string, unknown> = {}): Promise<string> {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase
    .from('comercios')
    .insert({ nombre: 'Comercio Portal Test', slug: `test-portal-${sufijo}`, ...extra })
    .select('id')
    .single();
  if (error) throw error;
  comerciosDePrueba.push(data.id);
  return data.id;
}

async function crearClienteConTarjeta(comercioId: string, puntos: number): Promise<string> {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const telefono = `+000-portal-${sufijo}`;
  const { data: cliente, error: eC } = await supabase
    .from('clientes')
    .insert({ nombre: 'Cliente Portal', telefono })
    .select('id')
    .single();
  if (eC) throw eC;
  clientesDePrueba.push(cliente.id);
  const { data: tarjeta, error: eT } = await supabase
    .from('tarjetas')
    .insert({ cliente_id: cliente.id, comercio_id: comercioId, puntos_actuales: puntos })
    .select('id')
    .single();
  if (eT) throw eT;
  tarjetasDePrueba.push(tarjeta.id);
  return telefono;
}

describe('formatearSaldo', () => {
  it('formatea puntos con singular y plural', () => {
    expect(formatearSaldo('puntos', 1, null)).toBe('1 punto');
    expect(formatearSaldo('puntos', 7, null)).toBe('7 puntos');
  });

  it('formatea sellos como "N de M sellos", y sin meta como "N sellos"', () => {
    expect(formatearSaldo('sellos', 7, 10)).toBe('7 de 10 sellos');
    expect(formatearSaldo('sellos', 3, null)).toBe('3 sellos');
  });
});

describe('buscarTarjetasPorTelefono', () => {
  it('devuelve encontrado:false para un teléfono desconocido', async () => {
    const res = await buscarTarjetasPorTelefono(supabase, `+000-no-existe-${Date.now()}`);
    expect(res.encontrado).toBe(false);
    expect(res.tarjetas).toHaveLength(0);
  });

  it('devuelve la tarjeta de puntos con su saldo y comercio', async () => {
    const comercioId = await crearComercio(); // tipo_tarjeta usa el default 'puntos'
    const telefono = await crearClienteConTarjeta(comercioId, 7);

    const res = await buscarTarjetasPorTelefono(supabase, telefono);

    expect(res.encontrado).toBe(true);
    expect(res.nombreCliente).toBe('Cliente Portal');
    expect(res.tarjetas).toHaveLength(1);
    expect(res.tarjetas[0].comercioNombre).toBe('Comercio Portal Test');
    expect(res.tarjetas[0].puntosActuales).toBe(7);
    expect(res.tarjetas[0].saldoTexto).toBe('7 puntos');
  });

  it('formatea una tarjeta de sellos como "N de M sellos"', async () => {
    const comercioId = await crearComercio({ tipo_tarjeta: 'sellos', sello_meta: 10 });
    const telefono = await crearClienteConTarjeta(comercioId, 7);

    const res = await buscarTarjetasPorTelefono(supabase, telefono);

    expect(res.tarjetas[0].tipoTarjeta).toBe('sellos');
    expect(res.tarjetas[0].selloMeta).toBe(10);
    expect(res.tarjetas[0].saldoTexto).toBe('7 de 10 sellos');
  });

  it('incluye solo las recompensas activas del comercio', async () => {
    const comercioId = await crearComercio();
    const telefono = await crearClienteConTarjeta(comercioId, 5);
    const { error } = await supabase.from('recompensas').insert([
      { comercio_id: comercioId, nombre: 'Café gratis', costo_puntos: 10, tipo: 'articulo_gratis', activa: true },
      { comercio_id: comercioId, nombre: 'Descuento viejo', costo_puntos: 5, tipo: 'otro', activa: false },
    ]);
    if (error) throw error;

    const res = await buscarTarjetasPorTelefono(supabase, telefono);

    // Sin el .eq('activa', true), aparecerían las dos.
    expect(res.tarjetas[0].recompensas).toHaveLength(1);
    expect(res.tarjetas[0].recompensas[0].nombre).toBe('Café gratis');
  });

  it('devuelve las tarjetas de varios comercios sin mezclar sus recompensas', async () => {
    const comercioA = await crearComercio();
    const comercioB = await crearComercio();
    // Mismo cliente en ambos comercios: se registra una vez y suma tarjetas (clientes es global).
    const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const telefono = `+000-portal-multi-${sufijo}`;
    const { data: cliente, error: eC } = await supabase
      .from('clientes').insert({ nombre: 'Cliente Multi', telefono }).select('id').single();
    if (eC) throw eC;
    clientesDePrueba.push(cliente.id);
    for (const comercioId of [comercioA, comercioB]) {
      const { data: t, error: eT } = await supabase
        .from('tarjetas').insert({ cliente_id: cliente.id, comercio_id: comercioId }).select('id').single();
      if (eT) throw eT;
      tarjetasDePrueba.push(t.id);
    }
    const { error: eR } = await supabase.from('recompensas').insert([
      { comercio_id: comercioA, nombre: 'Premio A', costo_puntos: 10, tipo: 'otro', activa: true },
      { comercio_id: comercioB, nombre: 'Premio B', costo_puntos: 10, tipo: 'otro', activa: true },
    ]);
    if (eR) throw eR;

    const res = await buscarTarjetasPorTelefono(supabase, telefono);

    expect(res.tarjetas).toHaveLength(2);
    // Cada tarjeta lleva SOLO las recompensas de su propio comercio (pin del agrupado por comercio_id).
    const porComercio = Object.fromEntries(res.tarjetas.map((t) => [t.comercioNombre, t.recompensas.map((r) => r.nombre)]));
    for (const nombres of Object.values(porComercio)) {
      expect(nombres).toHaveLength(1);
    }
    const todos = res.tarjetas.flatMap((t) => t.recompensas.map((r) => r.nombre)).sort();
    expect(todos).toEqual(['Premio A', 'Premio B']);
  });
});
```

Run: `npm test -- buscarTarjetas`
Expected: FAIL — `Cannot find module './buscarTarjetas'`.

- [ ] **Step 2: Implementar**

Create `lib/portal/buscarTarjetas.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

export interface RecompensaPortal {
  nombre: string;
  descripcion: string | null;
  costoPuntos: number;
}

export interface TarjetaPortal {
  tarjetaId: string;
  comercioNombre: string;
  colorFondo: string | null;
  colorTexto: string | null;
  colorLabel: string | null;
  tipoTarjeta: string;
  puntosActuales: number;
  selloMeta: number | null;
  saldoTexto: string;
  recompensas: RecompensaPortal[];
}

export interface ResultadoConsulta {
  encontrado: boolean;
  nombreCliente: string | null;
  tarjetas: TarjetaPortal[];
}

// El saldo se muestra como TEXTO en un solo lugar (spec §2, y §4.2 de la Fase 3: sin grilla
// visual). Sellos: "N de M sellos" (o "N sellos" si el comercio no fijó meta). Puntos y cualquier
// otro tipo: "N punto(s)".
export function formatearSaldo(tipoTarjeta: string, puntos: number, selloMeta: number | null): string {
  if (tipoTarjeta === 'sellos') {
    return selloMeta != null ? `${puntos} de ${selloMeta} sellos` : `${puntos} sellos`;
  }
  return `${puntos} ${puntos === 1 ? 'punto' : 'puntos'}`;
}

// Busca al cliente por teléfono y arma sus tarjetas con el comercio (nombre, colores, tipo, saldo)
// y las recompensas ACTIVAS de cada comercio. Solo lectura. Usa createServiceClient() (lo pasa el
// caller): clientes no cuelga de RLS y tarjetas/recompensas son deny-all salvo service_role.
export async function buscarTarjetasPorTelefono(
  supabase: SupabaseClient<Database>,
  telefono: string,
): Promise<ResultadoConsulta> {
  const limpio = telefono.trim();
  if (!limpio) return { encontrado: false, nombreCliente: null, tarjetas: [] };

  const { data: cliente, error: errorCliente } = await supabase
    .from('clientes')
    .select('id, nombre')
    .eq('telefono', limpio)
    .maybeSingle();

  if (errorCliente) {
    // maybeSingle() devuelve error:null cuando no hay filas: un error aquí es infraestructura.
    console.error('[portal] falló la consulta de cliente:', errorCliente);
    return { encontrado: false, nombreCliente: null, tarjetas: [] };
  }
  if (!cliente) return { encontrado: false, nombreCliente: null, tarjetas: [] };

  // Embed a-uno tarjetas -> comercios (FK tarjetas_comercio_id_fkey, ya en types.ts). Lee
  // tipo_tarjeta y sello_meta, que agrega la migración 0005 de la Fase 3 (prerrequisito).
  const { data: tarjetas, error: errorTarjetas } = await supabase
    .from('tarjetas')
    .select('id, puntos_actuales, comercios(id, nombre, color_fondo, color_texto, color_label, tipo_tarjeta, sello_meta)')
    .eq('cliente_id', cliente.id);

  if (errorTarjetas) {
    console.error('[portal] falló la consulta de tarjetas:', errorTarjetas);
    return { encontrado: true, nombreCliente: cliente.nombre, tarjetas: [] };
  }

  const filas = (tarjetas ?? []).filter((t) => t.comercios);
  const comercioIds = filas.map((t) => t.comercios!.id);

  // Recompensas activas de todos los comercios involucrados en UNA sola consulta (.in), luego se
  // agrupan por comercio en memoria. Se evita el embed inverso comercios(recompensas(...)), que
  // exigiría una Relationship que recompensas no declara en types.ts hoy.
  const recompensasPorComercio = new Map<string, RecompensaPortal[]>();
  if (comercioIds.length > 0) {
    const { data: recompensas, error: errorRecompensas } = await supabase
      .from('recompensas')
      .select('comercio_id, nombre, descripcion, costo_puntos')
      .in('comercio_id', comercioIds)
      .eq('activa', true)
      .order('costo_puntos');
    if (errorRecompensas) {
      console.error('[portal] falló la consulta de recompensas:', errorRecompensas);
    }
    for (const r of recompensas ?? []) {
      const lista = recompensasPorComercio.get(r.comercio_id) ?? [];
      lista.push({ nombre: r.nombre, descripcion: r.descripcion, costoPuntos: r.costo_puntos });
      recompensasPorComercio.set(r.comercio_id, lista);
    }
  }

  const resultado: TarjetaPortal[] = filas.map((t) => {
    const c = t.comercios!;
    return {
      tarjetaId: t.id,
      comercioNombre: c.nombre,
      colorFondo: c.color_fondo,
      colorTexto: c.color_texto,
      colorLabel: c.color_label,
      tipoTarjeta: c.tipo_tarjeta,
      puntosActuales: t.puntos_actuales,
      selloMeta: c.sello_meta,
      saldoTexto: formatearSaldo(c.tipo_tarjeta, t.puntos_actuales, c.sello_meta),
      recompensas: recompensasPorComercio.get(c.id) ?? [],
    };
  });

  return { encontrado: true, nombreCliente: cliente.nombre, tarjetas: resultado };
}
```

Run: `npm test -- buscarTarjetas`
Expected: 7 passed.

Si el typecheck se queja de que `tipo_tarjeta`/`sello_meta` no existen en `comercios`, falta el prerrequisito de la Fase 3 (ver Prerrequisitos) — no lo parchees agregando las columnas solo aquí.

- [ ] **Step 3: Gates + commit**

Run: `npm test` → **72 passed** (65 + 7). Run `npm run typecheck`, `npm run lint`.
Confirma 0 comercios `test-portal-%` huérfanos en la BD.
```bash
git add -A
git commit -m "Add phone lookup that returns cards, balance text and rewards"
```

---

### Task 5: Route Handler `POST /api/portal/consulta` (TDD)

**Files:**
- Create: `app/api/portal/consulta/route.ts`
- Test: `app/api/portal/consulta/route.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Create `app/api/portal/consulta/route.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { createServiceClient } from '@/lib/supabase/server';
import { LIMITE_INTENTOS } from '@/lib/portal/limiteIntentos';

const supabase = createServiceClient();
const ipsDePrueba: string[] = [];
let limpiar: { comercioId: string; clienteId: string; tarjetaId: string } | null = null;

afterEach(async () => {
  if (ipsDePrueba.length) {
    await supabase.from('intentos_consulta_portal').delete().in('ip', ipsDePrueba);
    ipsDePrueba.length = 0;
  }
  if (limpiar) {
    await supabase.from('tarjetas').delete().eq('id', limpiar.tarjetaId);
    await supabase.from('clientes').delete().eq('id', limpiar.clienteId);
    await supabase.from('comercios').delete().eq('id', limpiar.comercioId);
    limpiar = null;
  }
});

// x-forwarded-for de UN solo valor: así tanto el helper del paquete como el fallback (último
// valor) devuelven la misma IP, y el test no depende de cuál de los dos use obtenerIp().
function pedir(telefono: unknown, ip: string): NextRequest {
  ipsDePrueba.push(ip);
  return new NextRequest('http://localhost/api/portal/consulta', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ telefono }),
  });
}

describe('POST /api/portal/consulta', () => {
  it('devuelve las tarjetas para un teléfono registrado', async () => {
    const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { data: comercio } = await supabase
      .from('comercios').insert({ nombre: 'Portal Route Test', slug: `test-route-portal-${sufijo}` }).select('id').single();
    const { data: cliente } = await supabase
      .from('clientes').insert({ nombre: 'Cliente Route', telefono: `+000-route-${sufijo}` }).select('id').single();
    const { data: tarjeta } = await supabase
      .from('tarjetas').insert({ cliente_id: cliente!.id, comercio_id: comercio!.id, puntos_actuales: 3 }).select('id').single();
    limpiar = { comercioId: comercio!.id, clienteId: cliente!.id, tarjetaId: tarjeta!.id };

    const res = await POST(pedir(`+000-route-${sufijo}`, `ip-ok-${sufijo}`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.encontrado).toBe(true);
    expect(body.tarjetas).toHaveLength(1);
    expect(body.tarjetas[0].saldoTexto).toBe('3 puntos');
  });

  it('devuelve encontrado:false para un teléfono no registrado', async () => {
    const res = await POST(pedir(`+000-nadie-${Date.now()}`, `ip-none-${Date.now()}`));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.encontrado).toBe(false);
  });

  it('responde 429 cuando se supera el límite de intentos', async () => {
    const ip = `ip-flood-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    ipsDePrueba.push(ip);
    const filas = Array.from({ length: LIMITE_INTENTOS }, () => ({ ip }));
    await supabase.from('intentos_consulta_portal').insert(filas);

    const req = new NextRequest('http://localhost/api/portal/consulta', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ telefono: '+000-cualquiera' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(429);
  });

  it('rechaza con 400 un cuerpo sin teléfono', async () => {
    const res = await POST(pedir('', `ip-empty-${Date.now()}`));
    expect(res.status).toBe(400);
  });
});
```

Run: `npm test -- consulta`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 2: Implementar**

Create `app/api/portal/consulta/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { obtenerIp } from '@/lib/portal/obtenerIp';
import { verificarYRegistrarIntento } from '@/lib/portal/limiteIntentos';
import { buscarTarjetasPorTelefono } from '@/lib/portal/buscarTarjetas';

// Route Handler (no Server Action) por consistencia con el endpoint hermano
// /api/tarjetas/[id]/puntos, no por una limitación técnica. Público con límite de intentos.
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const supabase = createServiceClient();

  // Límite de intentos ANTES de tocar clientes (spec §3): registra el intento (exitoso o no) y
  // decide si se permite. Un exceso responde 429 sin llegar nunca a la búsqueda por teléfono.
  const ip = obtenerIp(request);
  const permitido = await verificarYRegistrarIntento(supabase, ip);
  if (!permitido) {
    return NextResponse.json(
      { error: 'Demasiados intentos, intenta de nuevo más tarde.' },
      { status: 429 },
    );
  }

  let telefono: unknown;
  try {
    ({ telefono } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }
  if (typeof telefono !== 'string' || !telefono.trim()) {
    return NextResponse.json({ error: 'El teléfono es obligatorio' }, { status: 400 });
  }

  const resultado = await buscarTarjetasPorTelefono(supabase, telefono);
  return NextResponse.json(resultado);
}
```

Run: `npm test -- consulta`
Expected: 4 passed.

- [ ] **Step 3: Gates + commit**

Run: `npm test` → **76 passed** (72 + 4). Run `npm run typecheck`, `npm run lint`.
Confirma 0 filas `ip-%` huérfanas en `intentos_consulta_portal` ni comercios `test-route-portal-%`.
```bash
git add -A
git commit -m "Add POST /api/portal/consulta wiring IP, rate limit and lookup"
```

---

### Task 6: Página `/mi-tarjeta` (cliente)

**Files:**
- Create: `app/mi-tarjeta/page.tsx` (Server Component delgado)
- Create: `app/mi-tarjeta/PortalCliente.tsx` (Client Component)
- Modify: `app/globals.css`

- [ ] **Step 1: Página servidor (cascarón)**

Create `app/mi-tarjeta/page.tsx`. Igual que `app/registro/[comercioSlug]/page.tsx`, es un Server Component delgado que renderiza el componente cliente:

```tsx
import PortalCliente from './PortalCliente';

export default function PaginaMiTarjeta() {
  return <PortalCliente />;
}
```

- [ ] **Step 2: Componente cliente**

Create `app/mi-tarjeta/PortalCliente.tsx`. Reutiliza el sistema visual existente (`shell`, `stack`, `kicker`, `title`, `lede`, `panel`, `field`, `btn-primary`, `alerta`, `nota`, `cardface`, `wallet-btn`) y agrega solo lo específico del portal (Step 3):

```tsx
'use client';

import { useState, type FormEvent } from 'react';
import type { ResultadoConsulta, TarjetaPortal } from '@/lib/portal/buscarTarjetas';

function CaraTarjeta({ tarjeta }: { tarjeta: TarjetaPortal }) {
  // Usa los colores reales del comercio (como el pass). Fallback al espresso de la marca si el
  // comercio no tiene colores cargados.
  const fondo = tarjeta.colorFondo ?? 'rgb(36, 24, 18)';
  const texto = tarjeta.colorTexto ?? 'rgb(245, 237, 225)';
  return (
    <div className="cardface" style={{ background: fondo, color: texto }}>
      <div className="cardface-top">
        <span>Tarjeta de lealtad</span>
        <span className="cardface-dot">fm</span>
      </div>
      <div className="cardface-name">{tarjeta.comercioNombre}</div>
      <div className="portal-saldo">{tarjeta.saldoTexto}</div>
    </div>
  );
}

function DetalleTarjeta({ tarjeta }: { tarjeta: TarjetaPortal }) {
  return (
    <div className="portal-detalle">
      <CaraTarjeta tarjeta={tarjeta} />

      {tarjeta.recompensas.length > 0 && (
        <div className="portal-recompensas">
          <p className="portal-subtitulo">Recompensas</p>
          {tarjeta.recompensas.map((r, i) => {
            const falta = r.costoPuntos - tarjeta.puntosActuales;
            return (
              <div className="portal-recompensa" key={`${r.nombre}-${i}`}>
                <div>
                  <div className="portal-recompensa-nombre">{r.nombre}</div>
                  {r.descripcion && <div className="portal-recompensa-desc">{r.descripcion}</div>}
                </div>
                <div className="portal-recompensa-estado">
                  {falta <= 0 ? (
                    <span className="portal-canjeable">Ya puedes canjearla</span>
                  ) : (
                    <span className="portal-falta">Te faltan {falta}</span>
                  )}
                  <span className="portal-costo">{r.costoPuntos} pts</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reusa el endpoint de descarga existente (mismo patrón que RegistroCliente). */}
      <a className="wallet-btn" href={`/api/tarjetas/${tarjeta.tarjetaId}/pass.pkpass`}>
        Descargar mi pass de nuevo
      </a>
      <p className="nota">
        El canje se hace en el local: muestra tu pass al cajero. Esta vista es solo para consultar.
      </p>
    </div>
  );
}

export default function PortalCliente() {
  const [telefono, setTelefono] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoConsulta | null>(null);
  const [seleccion, setSeleccion] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    setResultado(null);
    setSeleccion(null);
    try {
      const res = await fetch('/api/portal/consulta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefono }),
      });
      const data = await res.json();
      if (res.status === 429) {
        setError('Demasiados intentos. Espera unos minutos e inténtalo de nuevo.');
        return;
      }
      if (!res.ok) {
        setError(data.error ?? 'No se pudo consultar. Intenta de nuevo.');
        return;
      }
      setResultado(data);
      // Si solo hay una tarjeta, se muestra directo (sin selector).
      if (data.encontrado && data.tarjetas.length === 1) {
        setSeleccion(data.tarjetas[0].tarjetaId);
      }
    } catch {
      setError('No se pudo conectar. Revisa tu internet e intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  }

  function reiniciar() {
    setResultado(null);
    setSeleccion(null);
    setError(null);
  }

  if (resultado?.encontrado) {
    const tarjetas = resultado.tarjetas;
    const activa = tarjetas.find((t) => t.tarjetaId === seleccion) ?? null;
    return (
      <main className="shell">
        <div className="stack">
          <h1 className="title reveal d1" style={{ fontSize: '2rem' }}>
            Hola, {resultado.nombreCliente}
          </h1>

          {tarjetas.length === 0 ? (
            <p className="lede reveal d2">Aún no tienes tarjetas registradas.</p>
          ) : (
            <>
              {tarjetas.length > 1 && (
                <div className="portal-cuentas reveal d2">
                  {tarjetas.map((t) => (
                    <button
                      key={t.tarjetaId}
                      type="button"
                      className={`portal-cuenta ${t.tarjetaId === seleccion ? 'portal-cuenta-activa' : ''}`}
                      onClick={() => setSeleccion(t.tarjetaId)}
                    >
                      <span className="portal-cuenta-nombre">{t.comercioNombre}</span>
                      <span className="portal-cuenta-saldo">{t.saldoTexto}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="reveal d3">{activa && <DetalleTarjeta tarjeta={activa} />}</div>
            </>
          )}

          <button type="button" className="portal-link" onClick={reiniciar}>
            Consultar otro número
          </button>

          <div className="portal-instalar">
            <p className="portal-subtitulo">Tenla siempre a mano</p>
            <p className="nota">
              En iPhone: toca el botón <b>Compartir</b> de Safari y elige <b>Agregar a inicio</b>.
              (Safari no lo ofrece solo — hay que hacerlo desde ese menú.) En Android/Chrome, el
              navegador puede ofrecerte <b>Agregar a pantalla de inicio</b>.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="stack">
        <p className="kicker reveal d1">FM Lealtad</p>
        <h1 className="title reveal d2">Mi tarjeta</h1>
        <p className="lede reveal d2">
          Ingresa tu teléfono para ver tus puntos, tus sellos y las recompensas que puedes canjear.
        </p>

        <form className="panel reveal d3" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="telefono">Teléfono</label>
            <input
              id="telefono"
              type="tel"
              inputMode="tel"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="7777 1234"
              autoComplete="tel"
              required
            />
          </div>
          <button className="btn-primary" type="submit" disabled={cargando}>
            {cargando ? 'Consultando…' : 'Ver mi tarjeta'}
          </button>
          {error && (
            <p className="alerta" role="alert">
              {error}
            </p>
          )}
          {resultado && !resultado.encontrado && !error && (
            <p className="alerta" role="alert">
              No encontramos una tarjeta con ese número. Revisa que sea el mismo con el que te
              registraste.
            </p>
          )}
          <p className="nota">Solo usamos tu teléfono para encontrar tu tarjeta.</p>
        </form>
      </div>
    </main>
  );
}
```

Nota: `import type { ResultadoConsulta, TarjetaPortal }` es solo de tipos (se borra en compilación) — no arrastra código de servidor de `buscarTarjetas.ts` al bundle del cliente.

- [ ] **Step 3: Estilos del portal**

Modify `app/globals.css` — agrega al final (reutiliza las variables ya existentes: `--line`, `--ink-soft`, `--espresso`, `--caramel`, `--foam`, `--cream`, `--clay`, `--font-display`, `--font-body`):

```css
/* ---------- portal del cliente (/mi-tarjeta) ---------- */
.portal-saldo {
  margin-top: 14px;
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1.6rem;
}
.portal-detalle {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin-top: 8px;
}
.portal-subtitulo {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--ink-soft);
  margin: 0 0 8px;
}
.portal-cuentas {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px 0 4px;
}
.portal-cuenta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  background: linear-gradient(180deg, var(--foam), var(--cream));
  border: 1px solid var(--line);
  border-radius: 13px;
  cursor: pointer;
  font-family: var(--font-body);
  text-align: left;
}
.portal-cuenta-activa {
  border-color: var(--caramel);
  box-shadow: 0 0 0 3px rgba(192, 127, 56, 0.18);
}
.portal-cuenta-nombre {
  font-family: var(--font-display);
  font-weight: 600;
}
.portal-cuenta-saldo {
  font-size: 0.85rem;
  color: var(--ink-soft);
}
.portal-recompensas {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.portal-recompensa {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 15px;
  border: 1px solid var(--line);
  border-radius: 12px;
}
.portal-recompensa-nombre {
  font-weight: 600;
}
.portal-recompensa-desc {
  font-size: 0.82rem;
  color: var(--ink-soft);
  margin-top: 2px;
}
.portal-recompensa-estado {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  white-space: nowrap;
}
.portal-canjeable {
  font-size: 0.78rem;
  font-weight: 600;
  color: #2f5d3a;
}
.portal-falta {
  font-size: 0.78rem;
  color: var(--ink-soft);
}
.portal-costo {
  font-size: 0.75rem;
  color: var(--clay);
}
.portal-instalar {
  margin-top: 20px;
  padding: 16px 18px;
  border: 1px dashed var(--line);
  border-radius: 13px;
}
.portal-link {
  align-self: flex-start;
  margin-top: 6px;
  font-family: var(--font-body);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--ink-soft);
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: underline;
}
```

- [ ] **Step 4: Verificar + commit**

Run: `npm run build`, `npm run typecheck`, `npm run lint` → todo limpio.
Run: `npm test` → 76 passed (esta tarea no agrega pruebas — es cableado de UI; la lógica que invoca ya está cubierta).
No levantes un dev server: la verificación visual va en la Tarea 8, con herramientas de navegador administradas.
```bash
git add -A
git commit -m "Add /mi-tarjeta client portal page and styles"
```

---

### Task 7: PWA — manifest, íconos generados, apple-touch-icon y appleWebApp

**Decisión de íconos (honesta y concreta):** en vez de comitear PNGs binarios en `public/` (lo que el spec §4 sugería pero yo, como autor del plan, no puedo generar), los íconos se **generan con `next/og`** — incluido en Next 16, **sin dependencia nueva** (verificado: `require('next/og')` carga `ImageResponse`). Cada ícono es un PNG real del tamaño exacto, rasterizado en build desde JSX (fondo espresso de la marca + "FM"). El "asset" queda como código revisable en el diff, no como un binario opaco. Ver `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/app-icons.md`.

**Files:**
- Create: `lib/portal/iconoFm.tsx` (render compartido)
- Create: `app/manifest.ts`
- Create: `app/mi-tarjeta/icono-192/route.tsx`
- Create: `app/mi-tarjeta/icono-512/route.tsx`
- Create: `app/mi-tarjeta/apple-icon.tsx`
- Create: `app/mi-tarjeta/layout.tsx`

- [ ] **Step 1: Render compartido del ícono**

Create `lib/portal/iconoFm.tsx`:

```tsx
import { ImageResponse } from 'next/og';

// Genera un ícono PNG REAL del tamaño pedido con next/og (incluido en Next, sin dependencia
// nueva): fondo espresso de la marca + "FM" centrado. Lo usan los íconos del manifest (192/512) y
// el apple-touch-icon (180). Satori (dentro de ImageResponse) rasteriza el texto con su fuente por
// defecto, así que una o dos letras latinas no necesitan cargar ninguna fuente.
export function renderIconoFm(tamano: number): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#241812',
          color: '#f5ede1',
          fontSize: tamano * 0.42,
          fontWeight: 700,
          fontFamily: 'sans-serif',
        }}
      >
        FM
      </div>
    ),
    { width: tamano, height: tamano },
  );
}
```

- [ ] **Step 2: Manifest**

Create `app/manifest.ts` (debe vivir en la raíz de `app/`, según la convención de Next):

```typescript
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Mi Tarjeta — FM Lealtad',
    short_name: 'Mi Tarjeta',
    description: 'Consulta el saldo de tus tarjetas de lealtad y las recompensas que puedes canjear.',
    start_url: '/mi-tarjeta',
    display: 'standalone',
    background_color: '#241812',
    theme_color: '#241812',
    icons: [
      // Rutas estables servidas por los Route Handlers del Step 3 (PNG real cada una). El campo
      // `type` le dice al navegador el MIME aunque la URL no termine en .png.
      { src: '/mi-tarjeta/icono-192', sizes: '192x192', type: 'image/png' },
      { src: '/mi-tarjeta/icono-512', sizes: '512x512', type: 'image/png' },
    ],
  };
}
```

- [ ] **Step 3: Route Handlers de los íconos del manifest (192 y 512)**

Create `app/mi-tarjeta/icono-192/route.tsx`:

```tsx
import { renderIconoFm } from '@/lib/portal/iconoFm';

// Sin datos de request => Next lo optimiza estáticamente (se genera en build y se cachea).
export function GET() {
  return renderIconoFm(192);
}
```

Create `app/mi-tarjeta/icono-512/route.tsx`:

```tsx
import { renderIconoFm } from '@/lib/portal/iconoFm';

export function GET() {
  return renderIconoFm(512);
}
```

- [ ] **Step 4: apple-touch-icon 180×180 (acotado a /mi-tarjeta)**

Create `app/mi-tarjeta/apple-icon.tsx`. La convención `apple-icon` de Next inyecta el `<link rel="apple-touch-icon" sizes="180x180">` SOLO en las rutas bajo `/mi-tarjeta` (por estar colocado en ese segmento), no en todo el sitio:

```tsx
import { renderIconoFm } from '@/lib/portal/iconoFm';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return renderIconoFm(180);
}
```

- [ ] **Step 5: Layout de /mi-tarjeta con metadata appleWebApp**

Create `app/mi-tarjeta/layout.tsx`. Aquí va la metadata `appleWebApp` (spec §4: en el layout de esta ruta, NO en el raíz — el raíz `app/layout.tsx` no se toca):

```tsx
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Mi Tarjeta — FM Lealtad',
  // Emite <meta name="mobile-web-app-capable" content="yes">, el título de la web-app y el estilo
  // de la barra de estado en iOS. Junto con apple-icon.tsx, hace que "Agregar a inicio" en Safari
  // use nuestro ícono y abra en modo standalone. NO implica que Safari lo ofrezca solo (ver el
  // copy honesto de la página).
  appleWebApp: {
    capable: true,
    title: 'Mi Tarjeta',
    statusBarStyle: 'black-translucent',
  },
};

export default function LayoutMiTarjeta({ children }: { children: React.ReactNode }) {
  return children;
}
```

- [ ] **Step 6: Verificar que se generan íconos PNG reales**

Run: `npm run build`
Expected: build exitoso. Si falla en las rutas de ícono por el runtime de `next/og` en Node, agrega `export const runtime = 'edge';` a los tres archivos de ícono (`icono-192`, `icono-512`, `apple-icon`) — pero primero confirma que es eso; en Next 16 `next/og` funciona en Node por defecto.

Run: `npm run dev` y en otra terminal comprueba que los tres íconos responden con PNG real (200 + content-type de imagen + bytes > 0):
```bash
curl -s -o /dev/null -w "%{http_code} %{content_type} %{size_download}\n" http://localhost:3000/mi-tarjeta/icono-192
curl -s -o /dev/null -w "%{http_code} %{content_type} %{size_download}\n" http://localhost:3000/mi-tarjeta/icono-512
curl -s -o /dev/null -w "%{http_code} %{content_type} %{size_download}\n" http://localhost:3000/mi-tarjeta/apple-icon
curl -s http://localhost:3000/manifest.webmanifest | head -c 400; echo
```
Expected: cada ícono → `200 image/png <n>` con `<n>` > 0. El manifest devuelve el JSON con los dos íconos y `start_url: "/mi-tarjeta"`. Detén el dev server.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add PWA manifest, next/og icons and appleWebApp metadata for /mi-tarjeta"
```

---

### Task 8: Verificación manual end-to-end (local)

- [ ] **Step 1: Datos de prueba**

Necesitas un cliente real con al menos una tarjeta. Reutiliza el flujo público existente si hace falta: `http://localhost:3000/registro/cafeteria-piloto` → registra un cliente con un teléfono que recuerdes. (Cafetería Piloto es tipo `puntos`; si la Fase 3 dejó algún comercio de `sellos`, registra también ahí para ver el texto "N de M sellos".)

- [ ] **Step 2: Recorrido en el navegador**

Run: `npm run dev`, y comprueba en `http://localhost:3000/mi-tarjeta`:

1. Ingresa un teléfono que **no** existe → mensaje "No encontramos una tarjeta con ese número", sin 500.
2. Ingresa el teléfono real registrado → aparece "Hola, {nombre}", la cara de la tarjeta con los colores del comercio y el saldo como texto (`N puntos` o `N de M sellos`).
3. Si el cliente tiene tarjetas en varios comercios → aparece el selector; al cambiar de comercio, cambian saldo y recompensas y **no se mezclan**.
4. La lista de recompensas muestra solo las activas, con "Ya puedes canjearla" o "Te faltan N".
5. **Descargar mi pass de nuevo** apunta a `/api/tarjetas/{tarjetaId}/pass.pkpass` y descarga el `.pkpass` (o 404 si esa tarjeta no tiene `apple_serial_number`, que es correcto).
6. El bloque de instalación dice el flujo honesto de iOS (Compartir → Agregar a inicio), sin insinuar un prompt automático.
7. "Consultar otro número" limpia el resultado y vuelve al formulario.
8. Verifica el sitio público intacto: `http://localhost:3000/registro/cafeteria-piloto` → 200.

- [ ] **Step 3: Verificación de instalabilidad**

En DevTools → Application → Manifest: se ve el manifest cargado con nombre, `start_url` `/mi-tarjeta`, `theme_color`, y los íconos 192/512 SIN advertencias de tamaño. En `<head>` de `/mi-tarjeta`: hay `<link rel="apple-touch-icon" sizes="180x180">` y `<meta name="mobile-web-app-capable" content="yes">`; en una página pública (p. ej. `/registro/cafeteria-piloto`) **no** están esos apple-* (confirmando que la metadata está acotada a /mi-tarjeta). Detén el dev server.

- [ ] **Step 4: Verificación del límite de intentos**

Con el dev server arriba, dispara el endpoint 11 veces seguidas y confirma que la última responde 429:
```bash
for i in $(seq 1 11); do \
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/portal/consulta \
    -H "Content-Type: application/json" -H "x-forwarded-for: 203.0.113.7" \
    -d '{"telefono":"+000-inexistente"}'; \
done
```
Expected: diez `200` y un `429` al final. Luego borra esas filas de prueba en Supabase Studio (o `delete from intentos_consulta_portal where ip = '203.0.113.7'`). Detén el dev server.

---

### Task 9: Despliegue

- [ ] **Step 1: Confirmar la migración en producción**

La `0006` se aplicó en la Tarea 1 (una sola Supabase para local y producción — no hay entornos separados). Confirma con `npm run verify-schema` (debe listar `OK: intentos_consulta_portal`).

- [ ] **Step 2: Nueva variable/dependencia**

No hay variables de entorno nuevas. Sí hay una dependencia nueva (`@vercel/functions`) — Vercel la instala en el build desde `package.json`, sin acción manual.

- [ ] **Step 3: Merge y push**

```bash
git fetch origin
git log --oneline origin/master..master
```
Asegúrate de que `master` no esté DETRÁS de `origin/master` (si lo está, `git pull --ff-only` primero).

```bash
git checkout master
git merge --ff-only feature/portal-cliente
git push origin master
```
Vercel despliega automáticamente.

- [ ] **Step 4: Verificar en producción**

Contra `https://loyalty-cards-rose.vercel.app/mi-tarjeta`:
- Consultar un teléfono real registrado → muestra sus tarjetas y recompensas.
- **Clave (spec §3):** confirma que `obtenerIp()` resuelve una IP real en Vercel — dispara el endpoint 11 veces y verifica que la 11ª da 429 (si NO limita, `ipAddress()` no está devolviendo la IP y el fallback tampoco: revisa el Step 2 de la Tarea 2 contra el comportamiento real de Vercel, y que se use el ÚLTIMO valor de `x-forwarded-for`). Limpia las filas de prueba después.
- El sitio público sigue en 200 (`/registro/cafeteria-piloto`).
- En un iPhone real: abre `/mi-tarjeta` en Safari → Compartir → Agregar a inicio → el ícono "FM" aparece en la pantalla de inicio y abre en modo standalone.

- [ ] **Step 5: Limpiar la rama**

```bash
git branch -d feature/portal-cliente
```

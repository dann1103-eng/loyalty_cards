# Panel móvil: nav, sucursal Principal, switcher de contexto, alta self-serve y accesos cajero — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar el spec `docs/superpowers/specs/2026-07-25-panel-movil-contexto-sucursales-design.md`: nav inferior deslizable, sucursal "Principal" por comercio que no consume cupo (migración 0012), acceso de cajeros a Resumen/Clientes, switcher de contexto comercio·sucursal, modal de creación con alta self-serve de comercios, y reportes conglomerado con filtros.

**Architecture:** 5 fases shippeables en este orden: (1) migración+cupo+candados, (2) nav+cajeros, (3) contexto+switcher, (4) modal+alta self-serve, (5) reportes. Toda validación vive en la capa `lib` (la BD casi no respalda); toda cookie nueva se revalida server-side; los gates (`verifyComercio*`) van SIEMPRE fuera de try/catch.

**Tech Stack:** Next.js (App Router, Server Actions), Supabase (service client, RLS deny-all), Vitest de **integración contra Supabase real** (en serie, `fileParallelism: false`, timeouts 20s), CSS propio en `globals.css`.

---

## Reglas del proyecto que aplican a TODAS las tareas

- **Trabajá en el worktree de la sesión:** `C:\Users\Daniel\Desktop\Loyalty Cards\.claude\worktrees\focused-bhabha-c88011` (rama `claude/mobile-commerce-interface-branches-859c45`). Verificalo vos mismo ANTES de tocar nada: `git branch --show-current` en ese directorio debe imprimir esa rama; si tu shell arranca en otro worktree con historia de otra feature, es infraestructura de la sesión — usá `cd` a la ruta de arriba en cada comando y rutas absolutas en Read/Write/Edit.
- **Código e identificadores en español.** Comentarios explican POR QUÉ, no qué.
- **Tests:** `npm test -- <ruta>` corre un archivo; `npm test` la suite completa (integración real: necesita `.env.local`, ~222 pruebas verdes hoy). `npm run typecheck` y `npm run lint` limpios antes de cada commit.
- **Mutation-testing obligatorio** en cada candado marcado: aplicá la mutación indicada (editá la línea), corré el test, confirmá que FALLA por la razón correcta (aserción/mensaje esperado, no un crash casual), restaurá la línea, corré de nuevo en verde. Reportá qué viste.
- **Commits:** identidad `Daniel <268727888+dann1103-eng@users.noreply.github.com>`, `-m` plano (sin here-strings), trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **NUNCA** inicies el dev server. **NUNCA** leas/imprimas `.env.local`.
- `redirect()` LANZA `NEXT_REDIRECT`: gates y redirects fuera de todo try/catch.

---

# FASE 1 — Migración 0012, cupo y candados de sucursales

### Tarea 1: Migración `0012_sucursal_principal.sql` + types + script de verificación

**Files:**
- Create: `supabase/migrations/0012_sucursal_principal.sql`
- Create: `scripts/verificar-0012.ts`
- Modify: `lib/supabase/types.ts:497-530` (tabla `sucursales`)

- [ ] **Paso 1: Escribir la migración** (byte-idéntica al spec §3):

```sql
-- 0012: sucursal "Principal" por comercio. La primera sucursal de todo comercio pasa a ser su
-- principal: no consume cupo del plan (la aplica la capa app), no se puede desactivar (capa app),
-- y es la default para cajeros/atribución. Máximo una por comercio (índice parcial).

alter table sucursales add column es_principal boolean not null default false;

create unique index sucursales_principal_unica on sucursales (comercio_id) where es_principal;

-- Backfill 1: comercios que YA tienen sucursales → la más antigua pasa a principal (desempate por
-- id para que sea determinista). El dueño puede renombrarla, así que no impone nada.
update sucursales s
set es_principal = true
where s.id = (
  select s2.id from sucursales s2
  where s2.comercio_id = s.comercio_id
  order by s2.created_at, s2.id
  limit 1
);

-- Backfill 2: una principal debe estar disponible — si la elegida estaba inactiva, se reactiva
-- (sin esto, un comercio con todas sus sucursales apagadas seguiría sin poder crear cajeros).
update sucursales set activa = true where es_principal and not activa;

-- Backfill 3: comercios SIN sucursales → se les crea su "Principal" activa.
insert into sucursales (comercio_id, nombre, activa, es_principal)
select c.id, 'Principal', true, true
from comercios c
where not exists (select 1 from sucursales s where s.comercio_id = c.id);
```

- [ ] **Paso 2: Transcribir la columna a `lib/supabase/types.ts`** — en `sucursales`, agregar `es_principal` a las tres formas (después de `activa`):

En `Row`: `es_principal: boolean;` · En `Insert`: `es_principal?: boolean;` · En `Update`: `es_principal?: boolean;`

- [ ] **Paso 3: Escribir `scripts/verificar-0012.ts`** (solo lectura, patrón dotenv de los seeds):

```ts
// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0012.ts
// Verificación de SOLO LECTURA de la migración 0012 (sucursal principal). No escribe nada.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

async function main() {
  const supabase = createServiceClient();

  const { error: eMuestra } = await supabase
    .from('sucursales')
    .select('id, es_principal')
    .limit(1);
  if (eMuestra) {
    console.error('FALLO: no se pudo consultar es_principal (¿migración aplicada?):', eMuestra.message);
    process.exit(1);
  }
  console.log('OK: la columna es_principal existe y es consultable.');

  const { data: comercios, error: eComercios } = await supabase.from('comercios').select('id, nombre');
  const { data: sucursales, error: eSucursales } = await supabase
    .from('sucursales')
    .select('comercio_id, activa, es_principal');
  if (eComercios || !comercios || eSucursales || !sucursales) {
    console.error('FALLO: no se pudieron listar comercios/sucursales:', eComercios?.message ?? eSucursales?.message);
    process.exit(1);
  }

  let problemas = 0;
  for (const c of comercios) {
    const principales = sucursales.filter((s) => s.comercio_id === c.id && s.es_principal);
    if (principales.length !== 1) {
      console.error(`PROBLEMA: "${c.nombre}" tiene ${principales.length} sucursales principales (esperado: 1).`);
      problemas++;
    } else if (!principales[0].activa) {
      console.error(`PROBLEMA: la principal de "${c.nombre}" está inactiva.`);
      problemas++;
    }
  }
  if (problemas > 0) process.exit(1);
  console.log(`OK: ${comercios.length} comercio(s), cada uno con exactamente 1 principal activa.`);
}

main();
```

- [ ] **Paso 4: Typecheck** — `npm run typecheck`. Esperado: sin errores (nada consume `es_principal` todavía).

- [ ] **Paso 5: ⛔ PAUSA OBLIGATORIA — migración a mano.** El asistente NO puede correr DDL. Pegale el SQL completo del Paso 1 al usuario en el chat y pedile que lo corra en Supabase Studio (proyecto `fguzohncpslqgbxacayl`). **Esperá su confirmación.** No sigas a la Tarea 2 sin esto: las suites de integración de las tareas siguientes consultan `es_principal` y fallarían contra el esquema viejo.

- [ ] **Paso 6: Verificar la migración** — `npx tsx --conditions=react-server scripts/verificar-0012.ts`. Esperado: las dos líneas `OK:` y exit 0. Si reporta `PROBLEMA:`, mostráselo al usuario antes de seguir.

- [ ] **Paso 7: Commit**

```bash
git add supabase/migrations/0012_sucursal_principal.sql scripts/verificar-0012.ts lib/supabase/types.ts
git commit -m "Migracion 0012: sucursal principal por comercio (columna, indice parcial, backfill) + types + script de verificacion" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Tarea 2: Cupo — la principal es gratis (`contarUnidadesCuenta` + `cupoDeCuenta`)

**Files:**
- Modify: `lib/comercios/cuentas.ts:82-117` (`verificarLimiteCuenta` → extraer conteo compartido) y `:187-203` (`asignarComercioACuenta`)
- Modify: `lib/comercios/guardarComercio.ts:161-175` (conteo de sucursales al mover de cuenta)
- Test: `lib/comercios/cuentas.test.ts`

- [ ] **Paso 1: Escribir los tests que van a fallar** (agregarlos a `cuentas.test.ts`, usando los fixtures existentes del archivo — leé cómo crean cuenta/comercio y seguí el patrón; las sucursales de fixture se insertan directo con `supabase.from('sucursales').insert(...)`):

```ts
describe('cupo con sucursal principal (0012)', () => {
  it('la principal NO consume cupo: comercio + principal caben en limite 1', async () => {
    const cuentaId = await crearCuentaFixture(1);
    const comercioId = await crearComercioFixture(cuentaId);
    await supabase.from('sucursales').insert({ comercio_id: comercioId, nombre: 'Principal', es_principal: true });

    const cupo = await cupoDeCuenta(supabase, cuentaId);
    expect(cupo).toEqual({ ok: true, limite: 1, usadas: 1 });

    // La cuenta está LLENA por el comercio (1/1): una unidad más se rechaza…
    const lleno = await verificarLimiteCuenta(supabase, cuentaId);
    expect(lleno).toEqual({ ok: false, error: 'Esta cuenta ya alcanzó su límite de 1 negocio(s)/sucursal(es).' });
  });

  it('una sucursal ADICIONAL sí consume cupo', async () => {
    const cuentaId = await crearCuentaFixture(2);
    const comercioId = await crearComercioFixture(cuentaId);
    await supabase.from('sucursales').insert([
      { comercio_id: comercioId, nombre: 'Principal', es_principal: true },
      { comercio_id: comercioId, nombre: 'Centro', es_principal: false },
    ]);

    const cupo = await cupoDeCuenta(supabase, cuentaId);
    expect(cupo).toEqual({ ok: true, limite: 2, usadas: 2 });
    const lleno = await verificarLimiteCuenta(supabase, cuentaId);
    expect(lleno).toEqual({ ok: false, error: 'Esta cuenta ya alcanzó su límite de 2 negocio(s)/sucursal(es).' });
  });

  it('cupoDeCuenta con limite null (Pro) reporta usadas sin tope', async () => {
    const cuentaId = await crearCuentaFixture(null);
    const comercioId = await crearComercioFixture(cuentaId);
    await supabase.from('sucursales').insert({ comercio_id: comercioId, nombre: 'Principal', es_principal: true });

    const cupo = await cupoDeCuenta(supabase, cuentaId);
    expect(cupo).toEqual({ ok: true, limite: null, usadas: 1 });
  });

  it('mover un comercio excluye su principal del conteo de unidades', async () => {
    // Comercio con principal + 1 extra = 2 unidades al moverse (1 comercio + 1 extra), no 3.
    const cuentaOrigen = await crearCuentaFixture(5);
    const comercioId = await crearComercioFixture(cuentaOrigen);
    await supabase.from('sucursales').insert([
      { comercio_id: comercioId, nombre: 'Principal', es_principal: true },
      { comercio_id: comercioId, nombre: 'Centro', es_principal: false },
    ]);
    const destinoJusto = await crearCuentaFixture(2);
    expect(await asignarComercioACuenta(supabase, comercioId, destinoJusto)).toEqual({ ok: true });

    const devuelta = await asignarComercioACuenta(supabase, comercioId, cuentaOrigen);
    expect(devuelta).toEqual({ ok: true });
    const destinoChico = await crearCuentaFixture(1);
    expect(await asignarComercioACuenta(supabase, comercioId, destinoChico)).toEqual({
      ok: false,
      error: 'Esta cuenta ya alcanzó su límite de 1 negocio(s)/sucursal(es).',
    });
  });
});
```

Nota: si `cuentas.test.ts` no tiene un `crearComercioFixture(cuentaId)`, agregalo espejando `crearCuentaFixture` (insert directo a `comercios` con `nombre`, `slug` único con `Date.now()`, `cuenta_id`, push a `comerciosDePrueba`). Si `crearCuentaFixture` no acepta `null`, extendé su firma a `limite: number | null` (el insert ya lo acepta: la columna es nullable desde la 0011).

- [ ] **Paso 2: Correr y ver FALLAR** — `npm test -- lib/comercios/cuentas.test.ts`. Esperado: los 4 nuevos fallan (`cupoDeCuenta` no existe; los conteos dan de más).

- [ ] **Paso 3: Implementar en `cuentas.ts`.** Reemplazar el cuerpo de `verificarLimiteCuenta` extrayendo el conteo a una función compartida (los comentarios existentes sobre el conteo combinado y `unidadesAAgregar` se conservan, reubicados):

```ts
// Conteo compartido de unidades de una cuenta: comercios + sucursales ADICIONALES. La sucursal
// PRINCIPAL de cada comercio no consume cupo (0012: representa el mismo local que el comercio —
// sin esta exclusión, una cuenta Starter con su comercio y su Principal ya estaría 2/1 y el
// callejón "Starter sin cajeros" volvería). Lo usan verificarLimiteCuenta (aplicar el tope) y
// cupoDeCuenta (mostrarlo): UNA implementación — dos copias divergirían.
type ConteoUnidades =
  | { ok: true; limite: number | null; usadas: number }
  | { ok: false; error: string };

async function contarUnidadesCuenta(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
  excluyendoComercioId?: string,
): Promise<ConteoUnidades> {
  const { data: cuenta, error: eCuenta } = await supabase
    .from('cuentas_comercio').select('limite_negocios').eq('id', cuentaId).maybeSingle();
  if (eCuenta) { console.error('[fm] no se pudo leer la cuenta:', eCuenta); return { ok: false, error: 'No se pudo verificar el límite de la cuenta.' }; }
  if (!cuenta) return { ok: false, error: 'La cuenta no existe.' };

  // count Y data en la misma llamada: count trae el total de comercios de la cuenta, data trae sus
  // ids (para contar sucursales vía el .in() de abajo) — un solo round-trip para las dos cosas.
  let qComercios = supabase.from('comercios').select('id', { count: 'exact' }).eq('cuenta_id', cuentaId);
  if (excluyendoComercioId) qComercios = qComercios.neq('id', excluyendoComercioId);
  const { data: comerciosDeCuenta, count: countComercios, error: eComercios } = await qComercios;
  if (eComercios) { console.error('[fm] no se pudo contar comercios de la cuenta:', eComercios); return { ok: false, error: 'No se pudo verificar el límite de la cuenta.' }; }

  let countSucursales = 0;
  const ids = (comerciosDeCuenta ?? []).map((c) => c.id);
  if (ids.length > 0) {
    const { count, error: eSucursales } = await supabase
      .from('sucursales').select('id', { count: 'exact', head: true })
      .in('comercio_id', ids)
      .eq('es_principal', false); // CONTROL: la principal es gratis; las adicionales consumen cupo
    if (eSucursales) { console.error('[fm] no se pudo contar sucursales de la cuenta:', eSucursales); return { ok: false, error: 'No se pudo verificar el límite de la cuenta.' }; }
    countSucursales = count ?? 0;
  }

  return { ok: true, limite: cuenta.limite_negocios, usadas: (countComercios ?? 0) + countSucursales };
}

// Cupo para la UI (página Sucursales, switcher): cuántas unidades usa la cuenta y cuál es su tope.
// `limite: null` = sin tope (Pro). NO aplica el tope — eso es de verificarLimiteCuenta.
export async function cupoDeCuenta(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
): Promise<ConteoUnidades> {
  return contarUnidadesCuenta(supabase, cuentaId);
}
```

`verificarLimiteCuenta` queda (misma firma y mismos mensajes — el comentario largo existente sobre `unidadesAAgregar` y el move se conserva encima):

```ts
export async function verificarLimiteCuenta(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
  opciones?: { excluyendoComercioId?: string; unidadesAAgregar?: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const conteo = await contarUnidadesCuenta(supabase, cuentaId, opciones?.excluyendoComercioId);
  if (!conteo.ok) return conteo;

  // null = plan sin tope (Pro): nada que aplicar.
  if (conteo.limite === null) return { ok: true };

  const unidades = opciones?.unidadesAAgregar ?? 1;
  if (conteo.usadas + unidades > conteo.limite) {
    return { ok: false, error: `Esta cuenta ya alcanzó su límite de ${conteo.limite} negocio(s)/sucursal(es).` };
  }
  return { ok: true };
}
```

En `asignarComercioACuenta` (cuentas.ts) y en el camino move-de-cuenta de `actualizarComercio` (guardarComercio.ts), el conteo de `sucursalesPropias` agrega `.eq('es_principal', false)` (la principal viaja gratis con su comercio) — en ambos, la línea

```ts
    .from('sucursales').select('id', { count: 'exact', head: true }).eq('comercio_id', comercioId);
```

pasa a

```ts
    .from('sucursales').select('id', { count: 'exact', head: true }).eq('comercio_id', comercioId)
    .eq('es_principal', false);
```

(en `actualizarComercio` el `.eq('comercio_id', ...)` usa `id`; ajustá el nombre de variable al de cada archivo).

- [ ] **Paso 4: Correr y ver PASAR** — `npm test -- lib/comercios/cuentas.test.ts`. Si algún test EXISTENTE de límite falla: leelo — si su fixture asumía que TODA sucursal consume cupo, agregale `es_principal: false` explícito al insert de fixture (la intención del test no cambia) o ajustá el conteo esperado. No aflojes ninguna aserción de mensaje.

- [ ] **Paso 5: MUTATION-TESTS de los DOS candados (son independientes — cada línea la atrapa un test distinto).**

  (a) En `contarUnidadesCuenta`, borrá `.eq('es_principal', false)`. Corré `npm test -- lib/comercios/cuentas.test.ts`. Esperado: FALLAN los tres tests de cupo ("la principal NO consume cupo" → usadas 2≠1; "una sucursal ADICIONAL sí consume cupo" → usadas 3≠2; "cupoDeCuenta con limite null" → usadas 1≠... según fixture). **El test del move NO falla con esta mutación y está bien así:** sus cuentas destino no tienen comercios todavía, así que el conteo de sucursales ni se ejecuta (`ids.length === 0`). No "arregles" nada por verlo verde. Restaurá.

  (b) En `asignarComercioACuenta`, borrá su `.eq('es_principal', false)`. Esperado: FALLA "mover un comercio excluye su principal del conteo" (con la principal contada, `unidadesAAgregar` es 3 y el move al destino de límite 2 se rechaza). Restaurá y corré todo en verde.

  Dejá este comentario encima de la línea en `contarUnidadesCuenta` si no está: `// CONTROL: la principal es gratis; las adicionales consumen cupo`.

- [ ] **Paso 6: Suite completa + typecheck + lint** — `npm test && npm run typecheck && npm run lint`. Esperado: verde (los tests de `guardarComercio.test.ts` y `sucursales.test.ts` existentes siguen pasando: sus fixtures insertan sucursales con `es_principal` default `false`).

- [ ] **Paso 7: Commit**

```bash
git add lib/comercios/cuentas.ts lib/comercios/cuentas.test.ts lib/comercios/guardarComercio.ts
git commit -m "Cupo 0012: la sucursal principal no consume cupo; cupoDeCuenta para la UI (conteo compartido)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Tarea 3: `sucursales.ts` — auto-reparación, candado de la principal, listado con `esPrincipal`

**Files:**
- Modify: `lib/comercio/sucursales.ts` (`crearSucursal`, `cambiarEstadoSucursal`, `listarSucursales`, `SucursalListada`; nueva `crearSucursalPrincipal`)
- Test: `lib/comercio/sucursales.test.ts`

- [ ] **Paso 1: Tests que fallan** (en `sucursales.test.ts`, con sus fixtures existentes):

```ts
describe('sucursal principal (0012)', () => {
  it('la PRIMERA sucursal de un comercio nace principal y no verifica cupo', async () => {
    // Cuenta LLENA (limite 1, ya consumido por el comercio): sin la regla de primera-gratis esto
    // rechazaría — es la auto-reparación de un comercio que quedó sin principal.
    const cuentaId = await crearCuentaFixture(1);
    const comercioId = await crearComercioConCuenta(cuentaId);

    const res = await crearSucursal(supabase, comercioId, { nombre: 'Casa matriz' });
    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('sucursales').select('nombre, activa, es_principal').eq('comercio_id', comercioId);
    expect(data).toEqual([{ nombre: 'Casa matriz', activa: true, es_principal: true }]);
  });

  it('con principal existente, la siguiente es adicional y el cupo aplica', async () => {
    const cuentaId = await crearCuentaFixture(1);
    const comercioId = await crearComercioConCuenta(cuentaId);
    await crearSucursal(supabase, comercioId, { nombre: 'Principal' });

    const res = await crearSucursal(supabase, comercioId, { nombre: 'Centro' });
    expect(res).toEqual({ ok: false, error: 'Esta cuenta ya alcanzó su límite de 1 negocio(s)/sucursal(es).' });
  });

  it('con cupo, la adicional nace es_principal=false', async () => {
    const cuentaId = await crearCuentaFixture(2);
    const comercioId = await crearComercioConCuenta(cuentaId);
    await crearSucursal(supabase, comercioId, { nombre: 'Principal' });

    const res = await crearSucursal(supabase, comercioId, { nombre: 'Centro' });
    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('sucursales').select('es_principal').eq('comercio_id', comercioId).eq('nombre', 'Centro');
    expect(data).toEqual([{ es_principal: false }]);
  });

  it('la principal no se puede desactivar (mensaje exacto)', async () => {
    const comercioId = await crearComercio();
    const principal = await crearSucursal(supabase, comercioId, { nombre: 'Principal' });
    if (!principal.ok) throw new Error('fixture');

    const res = await cambiarEstadoSucursal(supabase, principal.id, comercioId, false);
    expect(res).toEqual({ ok: false, error: 'La sucursal principal no se puede desactivar.' });
    const { data } = await supabase.from('sucursales').select('activa').eq('id', principal.id).single();
    expect(data?.activa).toBe(true);
  });

  it('una adicional sí se puede desactivar', async () => {
    const comercioId = await crearComercio();
    await crearSucursal(supabase, comercioId, { nombre: 'Principal' });
    const extra = await crearSucursal(supabase, comercioId, { nombre: 'Centro' });
    if (!extra.ok) throw new Error('fixture');

    expect(await cambiarEstadoSucursal(supabase, extra.id, comercioId, false)).toEqual({ ok: true });
  });

  it('listarSucursales expone esPrincipal y ordena la principal primera', async () => {
    const comercioId = await crearComercio();
    await crearSucursal(supabase, comercioId, { nombre: 'Zeta' });
    await crearSucursal(supabase, comercioId, { nombre: 'Alfa' });

    const lista = await listarSucursales(supabase, comercioId);
    expect(lista?.map((s) => ({ nombre: s.nombre, esPrincipal: s.esPrincipal }))).toEqual([
      { nombre: 'Zeta', esPrincipal: true },
      { nombre: 'Alfa', esPrincipal: false },
    ]);
  });

  it('crearSucursalPrincipal inserta la fila Principal activa', async () => {
    const comercioId = await crearComercio();
    const res = await crearSucursalPrincipal(supabase, comercioId);
    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('sucursales').select('nombre, activa, es_principal').eq('comercio_id', comercioId);
    expect(data).toEqual([{ nombre: 'Principal', activa: true, es_principal: true }]);
  });
});
```

Nota: `crearComercioConCuenta(cuentaId)` — si no existe, agregalo espejando el `crearComercio()` fixture del archivo pero con `cuenta_id`. Importá `crearSucursalPrincipal` en el import del archivo.

- [ ] **Paso 2: Ver FALLAR** — `npm test -- lib/comercio/sucursales.test.ts`.

- [ ] **Paso 3: Implementar.** `SucursalListada` gana `esPrincipal: boolean`. `crearSucursal` queda:

```ts
export async function crearSucursal(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  datos: DatosSucursal,
): Promise<ResultadoSucursal> {
  const nombre = datos.nombre.trim();
  if (!nombre) return { ok: false, error: 'El nombre de la sucursal es obligatorio.' };

  // ¿Primera sucursal del comercio? Nace PRINCIPAL y NO consume cupo (0012): representa el local
  // del propio comercio. Es también la auto-reparación del caso "el alta del comercio no pudo
  // crear su Principal" — la primera creada a mano toma ese lugar. Dos altas concurrentes de la
  // "primera" chocan contra el índice parcial único (23505) → cae al error genérico, sin daño.
  const { count, error: eConteo } = await supabase
    .from('sucursales').select('id', { count: 'exact', head: true }).eq('comercio_id', comercioId);
  if (eConteo) {
    console.error('[comercio] no se pudo contar las sucursales del comercio:', eConteo);
    return { ok: false, error: 'No se pudo crear la sucursal.' };
  }
  const esPrimera = (count ?? 0) === 0;

  if (!esPrimera) {
    // Una sucursal ADICIONAL consume cupo del plan (migración 0011 + 0012): hay que saber a qué
    // cuenta pertenece este comercio y verificar su cupo. Un comercio sin cuenta_id (legado/fixture)
    // no tiene límite que verificar — degrada con gracia (spec Fase 6 §4.1).
    const { data: comercio, error: eComercio } = await supabase
      .from('comercios').select('cuenta_id').eq('id', comercioId).maybeSingle();
    if (eComercio) {
      console.error('[comercio] no se pudo leer el comercio para verificar el límite:', eComercio);
      return { ok: false, error: 'No se pudo crear la sucursal.' };
    }
    if (comercio?.cuenta_id) {
      const limite = await verificarLimiteCuenta(supabase, comercio.cuenta_id);
      if (!limite.ok) return { ok: false, error: limite.error };
    }
  }

  const { data, error } = await supabase
    .from('sucursales')
    .insert({ comercio_id: comercioId, nombre, es_principal: esPrimera }) // activa=true por default (0008)
    .select('id')
    .single();

  if (error) {
    console.error('[comercio] falló el insert de sucursal:', error);
    return { ok: false, error: 'No se pudo crear la sucursal.' };
  }
  return { ok: true, id: data.id };
}
```

`cambiarEstadoSucursal` gana el candado ANTES del update existente (el resto del cuerpo no cambia):

```ts
  // CANDADO: la principal no se puede desactivar — sin ella el comercio vuelve al callejón "no hay
  // sucursal activa para cajeros" que la 0012 elimina. Solo aplica al APAGAR (reactivarla es no-op
  // legítimo). Ver MUTATION-TESTING en el .test.ts.
  if (!activa) {
    const { data: fila, error: eFila } = await supabase
      .from('sucursales').select('es_principal').eq('id', id).eq('comercio_id', comercioId).maybeSingle();
    if (eFila) {
      console.error('[comercio] no se pudo leer la sucursal para el candado de principal:', eFila);
      return { ok: false, error: 'No se pudo cambiar el estado de la sucursal.' };
    }
    if (!fila) return { ok: false, error: 'Esa sucursal ya no existe.' };
    if (fila.es_principal) return { ok: false, error: 'La sucursal principal no se puede desactivar.' };
  }
```

`listarSucursales`: el select pasa a `'id, nombre, activa, es_principal'`, el order a `.order('es_principal', { ascending: false }).order('created_at')`, y el return mapea:

```ts
  return (data ?? []).map((s) => ({ id: s.id, nombre: s.nombre, activa: s.activa, esPrincipal: s.es_principal }));
```

Nueva función al final del archivo:

```ts
// La fila "Principal" que todo comercio recibe al nacer (0012). La llama crearComercio
// (guardarComercio.ts) — el alta de FM y la self-serve pasan por ahí — para que ningún caller
// pueda olvidarla. Si falla, el caller NO revierte el comercio: la primera sucursal creada a mano
// toma el lugar (auto-reparación de crearSucursal).
export async function crearSucursalPrincipal(
  supabase: SupabaseClient<Database>,
  comercioId: string,
): Promise<ResultadoSucursal> {
  const { data, error } = await supabase
    .from('sucursales')
    .insert({ comercio_id: comercioId, nombre: 'Principal', es_principal: true })
    .select('id')
    .single();
  if (error) {
    console.error('[comercio] falló el insert de la sucursal principal:', error);
    return { ok: false, error: 'No se pudo crear la sucursal principal.' };
  }
  return { ok: true, id: data.id };
}
```

- [ ] **Paso 4: Ver PASAR** — `npm test -- lib/comercio/sucursales.test.ts`. **Tests EXISTENTES que hay que ajustar** (su única sucursal ahora nace principal): `cambiarEstadoSucursal` → "desactiva con SOFT-DELETE: la fila SIGUE existiendo con activa=false" (`sucursales.test.ts:116`) y "reactiva una sucursal desactivada" (`:131`). Arreglo en ambos: crear PRIMERO una sucursal ("Principal") y operar sobre una SEGUNDA ("Centro") — la intención de cada test (soft-delete real, reactivación) no cambia. **OJO con el segundo: hay que arreglarlo aunque siga VERDE.** Al bloquearse el apagado, la fila nunca queda inactiva y sus dos aserciones (`res.ok` y `activa === true`) se cumplen trivialmente: pasa sin probar nada — decoración exacta de lo que el proyecto prohíbe. **No aflojes el linchpin del soft-delete** (`expect(data).not.toBeNull()`): ese es el control que impide implementar el desactivar con `.delete()`. Lo mismo si algún test de cupo asumía que la primera sucursal lo verifica.

- [ ] **Paso 5: MUTATION-TESTS.** (a) En `crearSucursal`, cambiá `const esPrimera = (count ?? 0) === 0;` por `const esPrimera = false;` → deben FALLAR "la PRIMERA sucursal…" (por error de límite) y "crearSucursalPrincipal…" NO (no usa esa función) — verificá que el fallo sea el error de límite, no otro. Restaurá. (b) En `cambiarEstadoSucursal`, borrá la línea `if (fila.es_principal) return ...` → FALLA "la principal no se puede desactivar" (recibe ok:true y activa=false). Restaurá. Corré en verde.

- [ ] **Paso 6: Suite + typecheck + lint; Commit**

```bash
git add lib/comercio/sucursales.ts lib/comercio/sucursales.test.ts
git commit -m "Sucursales 0012: primera nace principal (gratis, auto-reparacion), candado anti-desactivar, esPrincipal en el listado" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Tarea 4: `crearComercio` crea la Principal (alta FM y self-serve comparten camino)

**Files:**
- Modify: `lib/comercios/guardarComercio.ts:102-127` (`crearComercio`)
- Test: `lib/comercios/guardarComercio.test.ts`

- [ ] **Paso 1: Tests que fallan** (en `guardarComercio.test.ts`; usá los fixtures/datos válidos existentes del archivo — hay helpers que arman `DatosComercio` válido con cuenta):

```ts
describe('sucursal principal en el alta (0012)', () => {
  it('mover un comercio a otra cuenta NO cuenta su principal (gemelo del de asignarComercioACuenta)', async () => {
    // actualizarComercio tiene SU PROPIO conteo de sucursales propias — el .eq('es_principal',
    // false) de allá necesita su propia prueba, o esa copia puede regresar sin que nadie se entere.
    // Espeja el test vecino "al cambiar de cuenta, cuenta las sucursales propias…" (mismos helpers:
    // datosValidos(slug) trae su cuenta de límite 999, y el destino se crea con crearCuenta), pero
    // con un destino de límite 2 que SÍ debe aceptar el move: 1 comercio + 1 sucursal adicional
    // (la principal viaja gratis con su comercio).
    const cuentaDestino = await (await import('./cuentas')).crearCuenta(supabase, {
      nombre: `Destino principal ${Date.now()}`, limiteNegocios: 2, plan: 'growth',
      licenciaEstado: 'activo', licenciaMontoMensual: null, licenciaActivaDesde: null,
    });
    if (!cuentaDestino.ok) throw new Error('setup falló');
    cuentasDePrueba.push(cuentaDestino.id);

    const datos = await datosValidos(`test-mover-principal-${Date.now()}`);
    const creado = await crearComercio(supabase, datos); // crea también su Principal
    if (!creado.ok) throw new Error('el setup falló');
    await supabase.from('sucursales').insert({ comercio_id: creado.id, nombre: 'Sucursal Propia' });

    const res = await actualizarComercio(supabase, creado.id, { ...datos, cuenta_id: cuentaDestino.id });
    expect(res.ok).toBe(true);
  });

  it('crearComercio crea el comercio Y su sucursal Principal activa', async () => {
    const res = await crearComercio(supabase, await datosValidos(`test-alta-principal-${Date.now()}`));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { data } = await supabase
      .from('sucursales').select('nombre, activa, es_principal').eq('comercio_id', res.id);
    expect(data).toEqual([{ nombre: 'Principal', activa: true, es_principal: true }]);
  });

  it('si el insert de la principal falla, el comercio igual se crea (best-effort)', async () => {
    // Inyección de fallo puntual: la integración real no puede hacer fallar SOLO ese insert.
    // La cuenta del fixture es NUEVA (0 comercios al verificar el límite), así que el único
    // acceso a 'sucursales' dentro de crearComercio es el insert de la principal.
    const real = createServiceClient();
    const conSucursalesRotas = {
      from(tabla: string) {
        if (tabla !== 'sucursales') return real.from(tabla as never);
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: null, error: { message: 'roto a propósito' } }),
            }),
          }),
        } as never;
      },
    } as ReturnType<typeof createServiceClient>;

    const res = await crearComercio(conSucursalesRotas, await datosValidos(`test-principal-rota-${Date.now()}`));
    expect(res.ok).toBe(true); // el comercio NO se pierde por la principal
    if (!res.ok) return;
    const { data } = await real.from('sucursales').select('id').eq('comercio_id', res.id);
    expect(data).toEqual([]); // quedó sin principal: crearSucursal la auto-repara después
  });
});
```

Notas de fixtures (verificadas contra el archivo vivo): `datosValidos(slug)` es `async` y devuelve un `DatosComercio` completo con su cuenta (límite 999) — **conservá ese objeto y hacele spread**, NO leas la fila con `select('*')`: el `Row` de comercios tiene `color_fondo/color_texto/color_label` como `string | null` y `DatosComercio` los exige `string`, así que el spread de la fila no compila en modo strict. `crearCuenta` se importa dinámicamente como en el test vecino, y su id va a `cuentasDePrueba`. Los slugs se registran solos dentro de `datosValidos`.

- [ ] **Paso 2: Ver FALLAR** — `npm test -- lib/comercios/guardarComercio.test.ts`. Esperado: fallan los DOS tests de principal ("crearComercio crea el comercio Y su sucursal Principal" y el best-effort). **El test gemelo del move queda VERDE en esta fase roja y está bien:** sin principal no hay nada que excluir del conteo, así que su fase roja real es la mutación (b) del Paso 5. No salgas a "arreglar" código correcto por verlo pasar.

- [ ] **Paso 3: Implementar.** En `crearComercio`, entre el insert exitoso y el `return`:

```ts
  // Todo comercio nace con su sucursal "Principal" (0012). Best-effort: si este insert falla, el
  // comercio igual queda creado (ok:true) — la primera sucursal creada a mano se vuelve principal
  // (auto-reparación en crearSucursal); no se le niega el alta al admin por esto.
  const principal = await crearSucursalPrincipal(supabase, data.id);
  if (!principal.ok) {
    console.error('[fm] el comercio quedó sin sucursal principal:', data.id);
  }

  return { ok: true, id: data.id };
```

Import arriba: `import { crearSucursalPrincipal } from '../comercio/sucursales';` (sin ciclo: `sucursales.ts` importa de `cuentas.ts`, no de `guardarComercio.ts`).

- [ ] **Paso 4: Ver PASAR** — `npm test -- lib/comercios/guardarComercio.test.ts`. OJO: tests existentes de `crearComercio` ahora dejan una sucursal por comercio — si algún teardown borra comercios sin borrar antes sus sucursales, va a fallar por FK: agregá el delete de `sucursales` por `comercio_id` antes del delete de `comercios` en el teardown (patrón que `cuentas.test.ts` ya usa).

- [ ] **Paso 5: MUTATION-TESTS.** (a) Comentá la llamada `await crearSucursalPrincipal(supabase, data.id);` (y su manejo) → FALLA "crearComercio crea el comercio Y su sucursal Principal" (data `[]` ≠ fila esperada). Restaurá. (b) En `actualizarComercio`, borrá el `.eq('es_principal', false)` del conteo de sucursales propias (agregado en la Tarea 2) → FALLA el test gemelo del move (unidades 3 > límite 2). Restaurá, verde.

- [ ] **Paso 6: Suite + typecheck + lint; Commit**

```bash
git add lib/comercios/guardarComercio.ts lib/comercios/guardarComercio.test.ts
git commit -m "Alta de comercio crea su sucursal Principal (best-effort, camino compartido FM/self-serve)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Tarea 5: UI de Sucursales — Principal visible, sin toggle, aviso de cupo

**Files:**
- Modify: `app/comercio/(protegido)/sucursales/page.tsx`

- [ ] **Paso 1: Reescribir la página.** Cambios sobre la versión actual: (a) trae `cuenta_id` del comercio y `cupoDeCuenta`; (b) si el cupo está lleno, reemplaza el formulario de alta por el aviso del plan; (c) la fila de la principal muestra "Sucursal principal" y NO renderiza `BotonEstadoSucursal`:

```tsx
import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { listarSucursales } from '@/lib/comercio/sucursales';
import { cupoDeCuenta } from '@/lib/comercios/cuentas';
import FormularioSucursal from './FormularioSucursal';
import BotonEstadoSucursal from './BotonEstadoSucursal';

export const dynamic = 'force-dynamic';

export default async function PaginaSucursales() {
  const { comercioId } = await verifyComercioOwner();
  const supabase = createServiceClient();

  // listarSucursales trae activas e inactivas: el dueño necesita ver las apagadas para reactivarlas.
  const sucursales = await listarSucursales(supabase, comercioId);

  // Cupo del plan: si la cuenta está llena, el alta se reemplaza por el aviso (crear igual
  // rechazaría — esto lo dice ANTES y sin formulario inútil). Comercio sin cuenta (legado): sin
  // tope conocido, se muestra el formulario (paridad con crearSucursal, que tampoco bloquea ahí).
  const { data: comercio } = await supabase
    .from('comercios').select('cuenta_id').eq('id', comercioId).maybeSingle();
  let avisoCupo: string | null = null;
  if (comercio?.cuenta_id) {
    const cupo = await cupoDeCuenta(supabase, comercio.cuenta_id);
    if (cupo.ok && cupo.limite !== null && cupo.usadas >= cupo.limite) {
      avisoCupo = `Alcanzaste el límite de tu plan (${cupo.limite} ${cupo.limite === 1 ? 'local' : 'locales'}). Hablá con FM para ampliarlo.`;
    }
  }

  return (
    <main className="admin-main" style={{ maxWidth: 640 }}>
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>Sucursales</h1>
        <Link className="admin-fila-slug" href="/comercio/panel">← Volver</Link>
      </div>

      <div className="reveal d2">
        {avisoCupo ? <p className="admin-vacio">{avisoCupo}</p> : <FormularioSucursal />}
      </div>

      <div className="admin-lista reveal d3" style={{ marginTop: 22 }}>
        {sucursales === null ? (
          <p className="admin-error" role="alert">No se pudieron cargar las sucursales. Recargá la página.</p>
        ) : sucursales.length === 0 ? (
          <p className="admin-vacio">Todavía no hay sucursales. Agregá la primera.</p>
        ) : (
          sucursales.map((s) => (
            <div
              key={s.id}
              className="admin-fila"
              style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span className="icono-circulo acento" aria-hidden="true">
                    <span className="icono">{s.esPrincipal ? 'home_pin' : 'store'}</span>
                  </span>
                  <div>
                    <div className="admin-fila-nombre">{s.nombre}</div>
                    {s.esPrincipal && <div className="admin-fila-slug">Sucursal principal</div>}
                  </div>
                </div>
                <span className={`pastilla ${s.activa ? 'pastilla-activo' : 'pastilla-inactivo'}`}>
                  {s.activa ? 'Activa' : 'Inactiva'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ flex: '1 1 220px' }}>
                  <FormularioSucursal sucursal={{ id: s.id, nombre: s.nombre }} />
                </div>
                {/* La principal no se puede desactivar (candado en la capa lib): sin botón acá. */}
                {!s.esPrincipal && <BotonEstadoSucursal id={s.id} nombre={s.nombre} activa={s.activa} />}
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
```

- [ ] **Paso 2: Typecheck + lint** — `npm run typecheck && npm run lint`. Esperado: limpios.

- [ ] **Paso 3: Commit**

```bash
git add "app/comercio/(protegido)/sucursales/page.tsx"
git commit -m "UI Sucursales: principal destacada sin toggle, aviso de cupo del plan en lugar del alta" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Checkpoint Fase 1:** una cuenta Starter ya puede crear cajeros (su Principal existe tras la migración). Verificación visual: la hace el controlador o el usuario en producción, NUNCA un dev server en subagentes.

---

# FASE 2 — Nav inferior deslizable + accesos del cajero

### Tarea 6: `enlacesPorRol` + NavInferior carrusel + CSS

**Files:**
- Create: `lib/comercio/navegacion.ts`
- Create: `lib/comercio/navegacion.test.ts`
- Modify: `app/comercio/(protegido)/NavInferior.tsx` (reescritura completa)
- Modify: `app/globals.css:1004-1045` (bloque `.nav-inferior`)

- [ ] **Paso 1: Test que falla** — `lib/comercio/navegacion.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ENLACES_NAV, enlacesPorRol } from './navegacion';

// MUTATION-TESTING: enlacesPorRol es el control de acceso VISUAL de la nav (la barrera real son los
// gates de cada página). Mutación que estos tests deben atrapar: devolver todos los enlaces para
// 'cajero' — el cajero vería secciones owner-only en su nav.
describe('enlacesPorRol', () => {
  it('owner ve las 9 secciones (incluida Reglas, nueva en la nav)', () => {
    const hrefs = enlacesPorRol('owner').map((e) => e.href);
    expect(hrefs).toEqual(ENLACES_NAV.map((e) => e.href));
    expect(hrefs).toContain('/comercio/reglas');
    expect(hrefs).toHaveLength(9);
  });

  it('cajero ve EXACTAMENTE Resumen, Escanear y Clientes', () => {
    expect(enlacesPorRol('cajero').map((e) => e.href)).toEqual([
      '/comercio/panel',
      '/comercio/escanear',
      '/comercio/clientes',
    ]);
  });

  it('un rol desconocido degrada a solo Escanear', () => {
    expect(enlacesPorRol('lo-que-sea').map((e) => e.href)).toEqual(['/comercio/escanear']);
  });
});
```

- [ ] **Paso 2: Ver FALLAR** — `npm test -- lib/comercio/navegacion.test.ts` (módulo inexistente).

- [ ] **Paso 3: Crear `lib/comercio/navegacion.ts`:**

```ts
// Enlaces de la nav inferior del panel comercio y qué ve cada rol. Módulo puro (sin JSX ni
// 'use client') para poder testear la política sin montar el componente.
export interface EnlaceNav {
  href: string;
  icono: string;
  etiqueta: string;
}

export const ENLACES_NAV: readonly EnlaceNav[] = [
  { href: '/comercio/panel', icono: 'dashboard', etiqueta: 'Resumen' },
  { href: '/comercio/escanear', icono: 'qr_code_scanner', etiqueta: 'Escanear' },
  { href: '/comercio/branding', icono: 'palette', etiqueta: 'Marca' },
  { href: '/comercio/recompensas', icono: 'redeem', etiqueta: 'Premios' },
  { href: '/comercio/reglas', icono: 'rule', etiqueta: 'Reglas' },
  { href: '/comercio/sucursales', icono: 'store', etiqueta: 'Sucursales' },
  { href: '/comercio/cajeros', icono: 'badge', etiqueta: 'Cajeros' },
  { href: '/comercio/clientes', icono: 'group', etiqueta: 'Clientes' },
  { href: '/comercio/reportes', icono: 'insights', etiqueta: 'Reportes' },
];

// Qué secciones ve el CAJERO en su nav (plan 2026-07-25 §4.8): Resumen, Escanear y Clientes. Las
// demás lo rebotarían en su gate igual — esto evita mostrarle puertas cerradas.
const RUTAS_CAJERO = ['/comercio/panel', '/comercio/escanear', '/comercio/clientes'];

export function enlacesPorRol(rol: string): EnlaceNav[] {
  if (rol === 'owner') return [...ENLACES_NAV];
  if (rol === 'cajero') return ENLACES_NAV.filter((e) => RUTAS_CAJERO.includes(e.href));
  // Rol desconocido: degrada al comportamiento previo (solo el escáner).
  return ENLACES_NAV.filter((e) => e.href === '/comercio/escanear');
}
```

- [ ] **Paso 4: Ver PASAR** — `npm test -- lib/comercio/navegacion.test.ts`.

- [ ] **Paso 5: Reescribir `NavInferior.tsx`** (contenido completo):

```tsx
'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { enlacesPorRol } from '@/lib/comercio/navegacion';

// Nav inferior móvil (C2/C3). Con 9 secciones ya no entran todas en un viewport móvil: la barra es
// un carrusel deslizable (.nav-carril: overflow-x + snap; el CSS oculta la scrollbar y desvanece
// los bordes para insinuar que hay más íconos). En desktop se oculta por CSS. Qué ve cada rol lo
// decide enlacesPorRol (lib/comercio/navegacion.ts), que tiene sus propios tests.
export default function NavInferior({ rol }: { rol: string }) {
  const ruta = usePathname();
  const carrilRef = useRef<HTMLDivElement>(null);
  const enlaces = enlacesPorRol(rol);

  // La pestaña activa se trae a la vista al navegar (pudo quedar fuera del carrusel).
  useEffect(() => {
    carrilRef.current
      ?.querySelector('a.activo')
      ?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [ruta]);

  return (
    <nav className="nav-inferior" aria-label="Secciones del panel">
      <div className="nav-carril" ref={carrilRef}>
        {enlaces.map((e) => {
          const activo = ruta === e.href || ruta.startsWith(`${e.href}/`);
          return (
            <Link key={e.href} href={e.href} className={activo ? 'activo' : undefined}>
              <span className={`icono${activo ? ' icono-lleno' : ''}`} aria-hidden="true">
                {e.icono}
              </span>
              {e.etiqueta}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
```

- [ ] **Paso 6: Reemplazar el bloque CSS** `/* ---------- nav inferior móvil (C2/C3) ---------- */` de `globals.css` (desde `.nav-inferior {` hasta el `@media` inclusive) por:

```css
/* ---------- nav inferior móvil (C2/C3) ---------- */
/* Barra fija + carril deslizable adentro. El mask va en el CARRIL (no en la barra) para desvanecer
   los íconos en los bordes sin comerse el fondo/blur de la barra. flex: 1 0 auto en los enlaces:
   pocos ítems (cajero) se reparten el ancho; muchos (owner) desbordan y se deslizan. */
.nav-inferior {
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
  z-index: 50;
  padding: 10px 0 calc(10px + env(safe-area-inset-bottom));
  background: rgba(28, 27, 27, 0.92);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border-top: 1px solid var(--linea);
  border-radius: 20px 20px 0 0;
}
.nav-carril {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 2px;
  overflow-x: auto;
  scroll-snap-type: x proximity;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  padding-inline: 14px;
  mask-image: linear-gradient(to right, transparent 0, #000 18px, #000 calc(100% - 18px), transparent 100%);
  -webkit-mask-image: linear-gradient(to right, transparent 0, #000 18px, #000 calc(100% - 18px), transparent 100%);
}
.nav-carril::-webkit-scrollbar {
  display: none;
}
.nav-inferior a {
  flex: 1 0 auto;
  scroll-snap-align: center;
  white-space: nowrap;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  font-family: var(--font-body);
  font-size: 0.62rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--texto-3);
  padding: 6px 14px;
  border-radius: var(--radius-pill);
  transition: color 0.15s ease, background 0.15s ease, transform 0.12s ease;
}
.nav-inferior a:active {
  transform: scale(0.94);
}
.nav-inferior a.activo {
  color: var(--sobre-acento);
  background: var(--acento);
}
@media (min-width: 760px) {
  .nav-inferior { display: none; }
  .admin-shell { padding-bottom: 0; }
}
```

- [ ] **Paso 7: MUTATION-TEST.** En `enlacesPorRol`, cambiá la rama cajero por `return [...ENLACES_NAV];` → FALLA "cajero ve EXACTAMENTE…". Restaurá, verde.

- [ ] **Paso 8: Suite + typecheck + lint; Commit**

```bash
git add lib/comercio/navegacion.ts lib/comercio/navegacion.test.ts "app/comercio/(protegido)/NavInferior.tsx" app/globals.css
git commit -m "Nav inferior deslizable (carrusel con snap y fades) + Reglas en la nav + enlaces por rol testeados" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Tarea 7: Panel y Clientes con gate compartido (acceso cajero)

**Files:**
- Modify: `app/comercio/(protegido)/panel/page.tsx`
- Modify: `app/comercio/(protegido)/clientes/page.tsx`

- [ ] **Paso 1: `panel/page.tsx`.** (a) El import y el gate cambian a `verifyComercioAcceso`; (b) los atajos se filtran por rol. Diffs exactos:

```tsx
// ANTES:
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
// DESPUÉS:
import { verifyComercioAcceso } from '@/lib/comercio/verifyComercioAcceso';
```

Justo después de la constante `ATAJOS` agregar:

```tsx
// El cajero solo ve los atajos de SUS secciones (las demás lo rebotarían en su gate de página).
const RUTAS_ATAJOS_CAJERO = ['/comercio/escanear', '/comercio/clientes'];
```

El gate (con su comentario) pasa a:

```tsx
  // Gate COMPARTIDO (plan 2026-07-25 §4.8): el cajero también ve el Resumen — métricas y QR de
  // registro le sirven en caja. No hay Server Actions en esta página; las secciones owner-only
  // siguen detrás de verifyComercioOwner en sus propias páginas.
  const { comercioId, rol } = await verifyComercioAcceso();
  const esOwner = rol === 'owner';
  const atajos = esOwner ? ATAJOS : ATAJOS.filter((a) => RUTAS_ATAJOS_CAJERO.includes(a.href));
```

Y en la sección "Accesos rápidos", `{ATAJOS.map((a) => (` pasa a `{atajos.map((a) => (`.

- [ ] **Paso 2: `clientes/page.tsx`.** Mismo cambio de import; el gate pasa a:

```tsx
  // Gate COMPARTIDO (plan 2026-07-25 §4.8): el cajero usa el directorio para la asignación manual
  // de puntos — el botón "Acreditar / Canjear" entra al escáner, cuyas acciones ya re-verifican con
  // gate compartido y atribución server-side. Esta página es de solo lectura (sin Server Actions).
  const { comercioId } = await verifyComercioAcceso();
```

- [ ] **Paso 3: Typecheck + lint + suite** — `npm run typecheck && npm run lint && npm test`. Esperado: verde (no hay tests de páginas; la suite protege las libs).

- [ ] **Paso 4: Commit**

```bash
git add "app/comercio/(protegido)/panel/page.tsx" "app/comercio/(protegido)/clientes/page.tsx"
git commit -m "Cajeros: acceso a Resumen y directorio de Clientes (gate compartido, atajos por rol)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Checkpoint Fase 2:** en móvil la nav se desliza y muestra las 9 secciones del owner; un cajero ve Resumen · Escanear · Clientes y puede acreditar desde el directorio.

---

# FASE 3 — Contexto de sucursal activa + switcher

### Tarea 8: Cookie + resolución pura + `obtenerSucursalActiva` + gate

**Files:**
- Modify: `lib/comercio/cookieComercio.ts`
- Create: `lib/comercio/sucursalActiva.ts`
- Create: `lib/comercio/sucursalActiva.test.ts`
- Modify: `lib/comercio/sucursales.ts` (nueva `obtenerSucursalActiva`)
- Modify: `lib/comercio/sucursales.test.ts`
- Modify: `lib/comercio/verifyComercioAcceso.ts`, `lib/comercio/verifyComercioOwner.ts`

- [ ] **Paso 1: Tests que fallan.** `lib/comercio/sucursalActiva.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolverSucursalActiva } from './sucursalActiva';

// MUTATION-TESTING: el candado es que para un CAJERO la cookie se IGNORA SIEMPRE (su sucursal es la
// de su membresía, que viene del gate). Mutación a atrapar: devolver la cookie para rol 'cajero' —
// un cajero elegiría contexto ajeno con una cookie armada a mano.
describe('resolverSucursalActiva', () => {
  it('cajero: SIEMPRE su sucursal de membresía, la cookie se ignora', () => {
    expect(resolverSucursalActiva('cajero', 'suc-mia', 'suc-ajena')).toEqual({
      tipo: 'fija-de-membresia',
      sucursalId: 'suc-mia',
    });
  });

  it('cajero sin sucursal en la membresía: todas (sin contexto)', () => {
    expect(resolverSucursalActiva('cajero', null, 'suc-ajena')).toEqual({ tipo: 'todas' });
  });

  it('owner sin cookie: todas', () => {
    expect(resolverSucursalActiva('owner', null, undefined)).toEqual({ tipo: 'todas' });
  });

  it('owner con cookie: pide validarla (el id NO está verificado todavía)', () => {
    expect(resolverSucursalActiva('owner', null, 'suc-1')).toEqual({
      tipo: 'validar-cookie',
      sucursalId: 'suc-1',
    });
  });
});
```

Y en `lib/comercio/sucursales.test.ts`:

```ts
describe('obtenerSucursalActiva', () => {
  it('devuelve id y nombre solo si es del comercio y está activa', async () => {
    const comercioId = await crearComercio();
    const creada = await crearSucursal(supabase, comercioId, { nombre: 'Principal' });
    if (!creada.ok) throw new Error('fixture');

    expect(await obtenerSucursalActiva(supabase, creada.id, comercioId)).toEqual({
      id: creada.id,
      nombre: 'Principal',
    });
  });

  it('rechaza (null) una sucursal de OTRO comercio', async () => {
    const comercioA = await crearComercio();
    const comercioB = await crearComercio();
    const deA = await crearSucursal(supabase, comercioA, { nombre: 'Principal' });
    if (!deA.ok) throw new Error('fixture');

    expect(await obtenerSucursalActiva(supabase, deA.id, comercioB)).toBeNull();
  });

  it('rechaza (null) una sucursal inactiva', async () => {
    const comercioId = await crearComercio();
    await crearSucursal(supabase, comercioId, { nombre: 'Principal' });
    const extra = await crearSucursal(supabase, comercioId, { nombre: 'Centro' });
    if (!extra.ok) throw new Error('fixture');
    await cambiarEstadoSucursal(supabase, extra.id, comercioId, false);

    expect(await obtenerSucursalActiva(supabase, extra.id, comercioId)).toBeNull();
  });
});
```

- [ ] **Paso 2: Ver FALLAR** — `npm test -- lib/comercio/sucursalActiva.test.ts lib/comercio/sucursales.test.ts`.

- [ ] **Paso 3: Implementar.** En `cookieComercio.ts`, debajo de `COOKIE_COMERCIO_ACTIVO`:

```ts
// Cookie hermana: la SUCURSAL activa del contexto del owner, dentro del comercio activo. Sin
// cookie = "todas". Mismo contrato de seguridad: es input del cliente y SIEMPRE se revalida
// (resolverSucursalActiva decide, obtenerSucursalActiva verifica pertenencia + activa).
export const COOKIE_SUCURSAL_ACTIVA = 'fm_sucursal_activa';
```

Crear `lib/comercio/sucursalActiva.ts`:

```ts
// Resolución PURA de la "sucursal activa" del contexto (espeja resolverComercioActivo): decide qué
// hacer con la cookie sin cookies() ni BD, para testear la política sola.
//
// SEGURIDAD: para un CAJERO la cookie se IGNORA SIEMPRE — su sucursal es la de su membresía, que
// sale del gate, nunca del cliente (ver MUTATION-TESTING en el .test.ts). El id de
// 'validar-cookie' NO está verificado: el gate DEBE pasarlo por obtenerSucursalActiva
// (pertenencia + activa) antes de usarlo.
export type ResolucionSucursalActiva =
  | { tipo: 'todas' }
  | { tipo: 'fija-de-membresia'; sucursalId: string }
  | { tipo: 'validar-cookie'; sucursalId: string };

export function resolverSucursalActiva(
  rol: string,
  sucursalIdMembresia: string | null,
  cookieValue: string | undefined,
): ResolucionSucursalActiva {
  if (rol === 'cajero') {
    return sucursalIdMembresia
      ? { tipo: 'fija-de-membresia', sucursalId: sucursalIdMembresia }
      : { tipo: 'todas' };
  }
  return cookieValue
    ? { tipo: 'validar-cookie', sucursalId: cookieValue }
    : { tipo: 'todas' };
}
```

En `lib/comercio/sucursales.ts`, al final:

```ts
// La consulta de validación del contexto: id + nombre SOLO si la sucursal es de ESTE comercio y
// está activa. La usan verifyComercioAcceso (cookie del owner y sucursal del cajero) y
// cambiarContextoActivo (input del sheet). CONTROL DE SEGURIDAD: sin el .eq('comercio_id') una
// cookie con sucursal ajena pasaría; sin el .eq('activa') se fijaría contexto en una apagada
// (ver MUTATION-TESTING en el .test.ts).
export async function obtenerSucursalActiva(
  supabase: SupabaseClient<Database>,
  sucursalId: string,
  comercioId: string,
): Promise<{ id: string; nombre: string } | null> {
  const { data, error } = await supabase
    .from('sucursales')
    .select('id, nombre')
    .eq('id', sucursalId)
    .eq('comercio_id', comercioId)
    .eq('activa', true)
    .maybeSingle();
  if (error) {
    // Falla cerrado (null = "todas"), pero deja rastro: infra ≠ contexto inválido.
    console.error('[comercio] falló la validación de la sucursal activa:', error);
  }
  return data ?? null;
}
```

En `verifyComercioAcceso.ts`: importar `resolverSucursalActiva` y `obtenerSucursalActiva` y `COOKIE_SUCURSAL_ACTIVA`; entre la resolución del comercio y el `return`:

```ts
  // Contexto de SUCURSAL activa (plan 2026-07-25 §4.4): para el owner, la cookie (input del
  // cliente) revalidada por obtenerSucursalActiva; para el cajero, SIEMPRE la de su membresía —
  // la cookie se ignora (resolverSucursalActiva). Ajena, apagada o inexistente → null = "todas".
  // (Un cajero cuya sucursal fue desactivada queda null acá: el header muestra solo el comercio;
  // el escáner sigue usando sucursalId de la membresía para su propio bloqueo, sin cambios.)
  const resolucion = resolverSucursalActiva(
    r.membresia.rol,
    r.membresia.sucursalId,
    cookieStore.get(COOKIE_SUCURSAL_ACTIVA)?.value,
  );
  const sucursalActiva =
    resolucion.tipo === 'todas'
      ? null
      : await obtenerSucursalActiva(createServiceClient(), resolucion.sucursalId, r.membresia.comercioId);
```

y el `return` agrega `sucursalActiva,`. En `verifyComercioOwner.ts`, el `return` agrega `sucursalActiva: acceso.sucursalActiva,`.

- [ ] **Paso 4: Ver PASAR** — `npm test -- lib/comercio/sucursalActiva.test.ts lib/comercio/sucursales.test.ts`.

- [ ] **Paso 5: MUTATION-TESTS.** (a) En `resolverSucursalActiva`, hacé que la rama cajero devuelva `{ tipo: 'validar-cookie', sucursalId: cookieValue! }` cuando hay cookie → FALLA "cajero: SIEMPRE su sucursal". Restaurá. (b) En `obtenerSucursalActiva`, borrá `.eq('comercio_id', comercioId)` → FALLA "rechaza una sucursal de OTRO comercio". Restaurá. (c) Borrá `.eq('activa', true)` → FALLA "rechaza una sucursal inactiva". Restaurá. Verde final.

- [ ] **Paso 6: Suite + typecheck + lint; Commit**

```bash
git add lib/comercio/cookieComercio.ts lib/comercio/sucursalActiva.ts lib/comercio/sucursalActiva.test.ts lib/comercio/sucursales.ts lib/comercio/sucursales.test.ts lib/comercio/verifyComercioAcceso.ts lib/comercio/verifyComercioOwner.ts
git commit -m "Contexto de sucursal activa: cookie revalidada server-side, resolucion pura (cajero ignora cookie) y gate extendido" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Tarea 9: `cambiarContextoActivo` + SelectorContexto (bottom sheet) + limpieza de cookie

**Files:**
- Modify: `app/comercio/actions.ts` (nueva acción; ELIMINAR `cambiarComercioActivo`)
- Modify: `lib/comercio/fijarComercioActivo.ts`, `app/comercio/login/actions.ts` (borran la cookie de sucursal)
- Create: `app/comercio/(protegido)/SelectorContexto.tsx`
- Delete: `app/comercio/(protegido)/SelectorComercio.tsx` (superseded — su único consumidor era el layout)
- Modify: `app/comercio/(protegido)/layout.tsx` (reescritura)
- Modify: `app/globals.css` (pastilla de contexto + bottom sheet)

- [ ] **Paso 1: `app/comercio/actions.ts`** — `cerrarSesionComercio` queda igual; `cambiarComercioActivo` se ELIMINA (su único consumidor era SelectorComercio, que muere en esta tarea); se agrega:

```ts
// Cambia el contexto activo (comercio + sucursal) desde el sheet del switcher (SelectorContexto).
// TODO input del cliente se revalida acá: el comercio contra las membresías OWNER de la sesión, la
// sucursal con obtenerSucursalActiva (pertenencia + activa; una ajena/apagada degrada a "todas"
// sin tumbar el cambio de comercio). NO reusa fijarComercioActivo: aquélla valida contra TODAS las
// membresías y SIEMPRE redirige al panel — acá cambiar solo de sucursal no debe sacarte de la
// página. ORDEN de cookies: la de sucursal se escribe DESPUÉS de la de comercio (fijar comercio
// resetea sucursal; al revés, la elegida se perdería).
// getClaims() y redirect() FUERA de try/catch (NEXT_REDIRECT).
export async function cambiarContextoActivo(comercioId: string, sucursalId: string | null) {
  const supabase = await createClienteServidor();
  const { data, error } = await supabase.auth.getClaims();
  if (error) {
    console.warn('[comercio] getClaims() falló al cambiar contexto; se trata como sesión ausente:', error);
  }
  const sub = data?.claims?.sub;
  if (!sub) {
    redirect('/comercio/login');
  }

  // usuarios_comercio es deny-all bajo RLS → service client.
  const servicio = createServiceClient();
  const membresias = await membresiasDeUsuario(servicio, sub);
  if (!membresias.some((m) => m.comercioId === comercioId && m.rol === 'owner')) {
    // Comercio ajeno o donde no es owner: no confiar en el input, de vuelta a elegir.
    redirect('/comercio/elegir');
  }

  let sucursalValidadaId: string | null = null;
  if (sucursalId !== null) {
    const sucursal = await obtenerSucursalActiva(servicio, sucursalId, comercioId);
    sucursalValidadaId = sucursal?.id ?? null;
  }

  const cookieStore = await cookies();
  const cambiaComercio = cookieStore.get(COOKIE_COMERCIO_ACTIVO)?.value !== comercioId;
  cookieStore.set(COOKIE_COMERCIO_ACTIVO, comercioId, opcionesCookieComercio());
  if (sucursalValidadaId) {
    cookieStore.set(COOKIE_SUCURSAL_ACTIVA, sucursalValidadaId, opcionesCookieComercio());
  } else {
    cookieStore.delete(COOKIE_SUCURSAL_ACTIVA);
  }
  revalidatePath('/comercio', 'layout');
  if (cambiaComercio) {
    redirect('/comercio/panel');
  }
}
```

Imports del archivo tras el cambio: agregar `cookies` (`next/headers`), `createServiceClient` (hoy solo importa `createClienteServidor`), `membresiasDeUsuario`, `obtenerSucursalActiva`, y `COOKIE_COMERCIO_ACTIVO, COOKIE_SUCURSAL_ACTIVA, opcionesCookieComercio` de `cookieComercio`. **Quitar** el import de `fijarComercioActivo`: al borrar `cambiarComercioActivo` queda sin uso y el lint lo marca.

- [ ] **Paso 2: Limpieza de cookie al fijar comercio.** En `fijarComercioActivo.ts`, actualizá primero su comentario de cabecera (línea ~11): menciona `cambiarComercioActivo (selector del header)` como caller, que acaba de desaparecer — su caller vivo es `elegirComercio` (`/comercio/elegir`), y el switcher usa `cambiarContextoActivo`. Después, tras el `cookieStore.set(...)`:

```ts
  // Cambiar de comercio resetea el contexto de sucursal a "todas" (la cookie vieja apuntaría a una
  // sucursal de OTRO comercio; la revalidación igual la descartaría — esto la limpia antes).
  cookieStore.delete(COOKIE_SUCURSAL_ACTIVA);
```

En `app/comercio/login/actions.ts`, lo mismo tras CADA `cookieStore.set(COOKIE_COMERCIO_ACTIVO, ...)` (las dos ramas: owner único y cajero). Importar `COOKIE_SUCURSAL_ACTIVA` en ambos archivos.

- [ ] **Paso 3: Crear `SelectorContexto.tsx`** y **borrar `SelectorComercio.tsx`**:

```tsx
'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { cambiarContextoActivo } from '../actions';

export interface ComercioConSucursales {
  comercioId: string;
  nombre: string;
  sucursales: { id: string; nombre: string; esPrincipal: boolean }[];
}

// Switcher de contexto del header (solo owner): pastilla que dice DÓNDE estás parado + bottom
// sheet para cambiar de comercio/sucursal. La validación real vive en cambiarContextoActivo
// (server) — el cliente nunca es la barrera de seguridad.
export default function SelectorContexto({
  comercios,
  comercioActivoId,
  sucursalActiva,
}: {
  comercios: ComercioConSucursales[];
  comercioActivoId: string;
  sucursalActiva: { id: string; nombre: string } | null;
}) {
  const [abierto, setAbierto] = useState(false);
  const [pendiente, startTransition] = useTransition();

  const activo = comercios.find((c) => c.comercioId === comercioActivoId);
  const etiqueta = sucursalActiva
    ? `${activo?.nombre ?? ''} · ${sucursalActiva.nombre}`
    : activo?.nombre ?? '';

  const elegir = (comercioId: string, sucursalId: string | null) => {
    if (comercioId === comercioActivoId && (sucursalId ?? null) === (sucursalActiva?.id ?? null)) {
      setAbierto(false); // sin cambio: no re-dispares la acción
      return;
    }
    startTransition(async () => {
      await cambiarContextoActivo(comercioId, sucursalId);
      // Cambio solo de sucursal: no hay redirect, cerramos acá (con redirect esto no llega a correr).
      setAbierto(false);
    });
  };

  return (
    <>
      <button
        type="button"
        className="contexto-pastilla"
        onClick={() => setAbierto(true)}
        disabled={pendiente}
        aria-label={`Contexto activo: ${etiqueta}. Cambiar de comercio o sucursal.`}
      >
        <span className="icono" aria-hidden="true" style={{ fontSize: 16 }}>swap_horiz</span>
        <span className="contexto-etiqueta">{etiqueta}</span>
      </button>

      {abierto && (
        <div className="sheet-fondo" onClick={() => setAbierto(false)}>
          <div
            className="sheet-panel"
            role="dialog"
            aria-label="Cambiar de contexto"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="titulo-seccion" style={{ marginBottom: 10 }}>¿Qué estás gestionando?</p>
            {comercios.map((c) => {
              const esComercioActivo = c.comercioId === comercioActivoId;
              return (
                <div key={c.comercioId} style={{ marginBottom: 12 }}>
                  <button
                    type="button"
                    className={`sheet-fila${esComercioActivo && !sucursalActiva ? ' sheet-fila-activa' : ''}`}
                    disabled={pendiente}
                    onClick={() => elegir(c.comercioId, null)}
                  >
                    <span className="icono" aria-hidden="true">storefront</span>
                    <span>
                      <span style={{ display: 'block', fontWeight: 700 }}>{c.nombre}</span>
                      <span className="admin-fila-slug">Todas las sucursales</span>
                    </span>
                  </button>
                  {c.sucursales.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`sheet-fila sheet-fila-sub${esComercioActivo && sucursalActiva?.id === s.id ? ' sheet-fila-activa' : ''}`}
                      disabled={pendiente}
                      onClick={() => elegir(c.comercioId, s.id)}
                    >
                      <span className="icono" aria-hidden="true">{s.esPrincipal ? 'home_pin' : 'store'}</span>
                      <span>
                        {s.nombre}
                        {s.esPrincipal && (
                          <span className="admin-fila-slug" style={{ marginLeft: 8 }}>Principal</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
            <Link
              className="sheet-agregar"
              href="/comercio/sucursales?agregar=1"
              onClick={() => setAbierto(false)}
            >
              <span className="icono" aria-hidden="true">add_circle</span>
              Agregar local…
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
```

(Nota: `?agregar=1` recién abre el modal en la Fase 4 — hasta entonces solo navega a Sucursales, lo cual ya es útil.)

- [ ] **Paso 4: Reescribir `layout.tsx`** (contenido completo):

```tsx
import Link from 'next/link';
import { verifyComercioAcceso } from '@/lib/comercio/verifyComercioAcceso';
import { createServiceClient } from '@/lib/supabase/server';
import { cerrarSesionComercio } from '../actions';
import NavInferior from './NavInferior';
import SelectorContexto, { type ComercioConSucursales } from './SelectorContexto';

export default async function LayoutComercio({ children }: { children: React.ReactNode }) {
  // Primera barrera. NO la única: cada página y cada Server Action repiten el chequeo. Gate
  // COMPARTIDO (no owner-only): un cajero también entra al shell — su nav y su header son mínimos.
  const { nombre, rol, comercioId, sucursalActiva, membresias } = await verifyComercioAcceso();

  // Comercios owner + sus sucursales activas: alimentan el switcher. UNA consulta para todas las
  // sucursales (deny-all bajo RLS → service client). Si falla, el sheet degrada a solo-comercios
  // (listas vacías) — nunca tumba el shell.
  const comerciosOwner = membresias
    .filter((m) => m.rol === 'owner')
    .map((m) => ({ comercioId: m.comercioId, nombre: m.nombre }));

  let comerciosConSucursales: ComercioConSucursales[] = [];
  if (rol === 'owner' && comerciosOwner.length > 0) {
    const { data, error } = await createServiceClient()
      .from('sucursales')
      .select('id, comercio_id, nombre, es_principal')
      .in('comercio_id', comerciosOwner.map((c) => c.comercioId))
      .eq('activa', true)
      .order('es_principal', { ascending: false })
      .order('created_at');
    if (error) console.error('[comercio] no se pudieron cargar las sucursales del switcher:', error);
    comerciosConSucursales = comerciosOwner.map((c) => ({
      ...c,
      sucursales: (data ?? [])
        .filter((s) => s.comercio_id === c.comercioId)
        .map((s) => ({ id: s.id, nombre: s.nombre, esPrincipal: s.es_principal })),
    }));
  }

  // El cajero no tiene switcher: su contexto es fijo y se muestra en la marca del header.
  const marcaCajero = sucursalActiva ? `${nombre} · ${sucursalActiva.nombre}` : nombre;

  return (
    <div className="admin-shell">
      <header className="admin-top">
        <Link href="/comercio/panel" className="admin-marca">
          <span className="icono-circulo" aria-hidden="true">
            <span className="icono icono-lleno" style={{ fontSize: 18 }}>storefront</span>
          </span>
          <span>{rol === 'owner' ? nombre : marcaCajero}</span>
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {rol === 'owner' && (
            <SelectorContexto
              comercios={comerciosConSucursales}
              comercioActivoId={comercioId}
              sucursalActiva={sucursalActiva}
            />
          )}
          <form action={cerrarSesionComercio}>
            <button className="admin-salir" type="submit">Salir</button>
          </form>
        </div>
      </header>
      {children}
      <NavInferior rol={rol} />
    </div>
  );
}
```

- [ ] **Paso 5: CSS del switcher y el sheet** — agregar a `globals.css`, después del bloque de la nav inferior:

```css
/* ---------- switcher de contexto (header) + bottom sheet ---------- */
.contexto-pastilla {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-body);
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--texto);
  background: var(--superficie-3);
  border: 1px solid var(--linea);
  border-radius: var(--radius-pill);
  padding: 8px 12px;
  max-width: 200px;
  cursor: pointer;
}
.contexto-etiqueta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sheet-fondo {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(0, 0, 0, 0.55);
}
.sheet-panel {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 91;
  max-height: 72vh;
  overflow-y: auto;
  background: var(--superficie-2);
  border-top: 1px solid var(--linea);
  border-radius: 20px 20px 0 0;
  padding: 18px 18px calc(18px + env(safe-area-inset-bottom));
}
.sheet-fila {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  color: var(--texto);
  font-family: var(--font-body);
  font-size: 0.95rem;
  padding: 10px 12px;
  border-radius: 12px;
  cursor: pointer;
}
.sheet-fila:hover { background: var(--superficie-3); }
.sheet-fila-sub { padding-left: 34px; font-size: 0.9rem; }
.sheet-fila-activa { background: var(--superficie-3); outline: 1px solid var(--acento); }
.sheet-agregar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  margin-top: 4px;
  border-top: 1px solid var(--linea);
  color: var(--acento);
  font-weight: 600;
  font-size: 0.92rem;
}
```

- [ ] **Paso 6: Typecheck + lint + suite** — `npm run typecheck && npm run lint && npm test`. Typecheck debe atrapar cualquier referencia colgada a `SelectorComercio`/`cambiarComercioActivo`; verificá además que `grep -r "SelectorComercio\|cambiarComercioActivo" app/ lib/` no devuelva nada (si devuelve el comentario de `fijarComercioActivo.ts`, es que no hiciste el Paso 2).

- [ ] **Paso 7: Commit**

```bash
git add -A app/comercio "app/comercio/(protegido)/SelectorContexto.tsx" app/globals.css lib/comercio/fijarComercioActivo.ts
git commit -m "Switcher de contexto comercio-sucursal en el header (bottom sheet) con accion unica revalidada server-side" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Tarea 10: Scopeo por sucursal activa — Escanear, Cajeros y Resumen

**Files:**
- Modify: `app/comercio/(protegido)/escanear/page.tsx`, `app/comercio/(protegido)/escanear/Escaner.tsx:19-47`
- Modify: `app/comercio/(protegido)/cajeros/page.tsx`, `app/comercio/(protegido)/cajeros/FormularioCajero.tsx`
- Modify: `app/comercio/(protegido)/panel/page.tsx`

- [ ] **Paso 1: Escanear — preselección del picker.** En `Escaner.tsx`, la firma gana `sucursalInicialId?: string` (después de `sucursales`) y el estado del picker (línea ~42) pasa a:

```tsx
  // Solo aplica al owner (con picker). Arranca en la sucursal activa del contexto si hay una
  // (plan 2026-07-25 §4.5) — editable por operación; '' = "Sin especificar" → null.
  const [sucursalIdSeleccionada, setSucursalIdSeleccionada] = useState(sucursalInicialId ?? '');
```

En `escanear/page.tsx`, la rama del owner pasa a:

```tsx
        <Escaner
          tokenInicial={token}
          sucursales={activas.map((s) => ({ id: s.id, nombre: s.nombre }))}
          sucursalInicialId={sesion.sucursalActiva?.id}
        />
```

- [ ] **Paso 2: Cajeros — filtro + preselección.** En `cajeros/page.tsx`:

```tsx
  const { comercioId, sucursalActiva } = await verifyComercioOwner();
```

y tras armar `sucursalesActivas`:

```tsx
  // Contexto de sucursal (plan 2026-07-25 §4.5): con una elegida, la lista se filtra a ella y el
  // alta la preselecciona; en "todas", lista completa con la Principal preseleccionada (que la
  // preselección exista es comportamiento nuevo — antes arrancaba en "Elegí una sucursal").
  const cajerosVisibles =
    cajeros === null ? null : sucursalActiva ? cajeros.filter((c) => c.sucursalId === sucursalActiva.id) : cajeros;
  const sucursalPreseleccionadaId = sucursalActiva?.id ?? sucursalesActivas.find((s) => s.esPrincipal)?.id;
```

El render usa `cajerosVisibles` en lugar de `cajeros` (mismas tres ramas null/vacío/lista), con el vacío sensible al contexto:

```tsx
          <p className="admin-vacio">
            {sucursalActiva
              ? `No hay cajeros en ${sucursalActiva.nombre}.`
              : 'Todavía no hay cajeros. Agregá el primero.'}
          </p>
```

y el form recibe la preselección: `<FormularioCajero sucursales={sucursalesActivas} sucursalPreseleccionadaId={sucursalPreseleccionadaId} />`. En `FormularioCajero.tsx`, la firma gana `sucursalPreseleccionadaId?: string` y el `<select>` pasa a `defaultValue={sucursalPreseleccionadaId ?? ''}`.

- [ ] **Paso 3: Resumen — carta de actividad de la sucursal activa.** En `panel/page.tsx` (que desde la Tarea 7 usa el gate compartido), el gate pasa a `const { comercioId, rol, sucursalActiva } = await verifyComercioAcceso();`, se importan `reporteSucursales` (`@/lib/reportes/reportes`) y tras las métricas existentes:

```tsx
  // Contexto de sucursal (owner): actividad de ESA sucursal, con los reportes por sucursal ya
  // existentes. Sin contexto no se consulta nada extra. Una sucursal sin actividad todavía no
  // aparece en el reporte → carta en cero (no "sin carta": el contexto elegido siempre se ve).
  let actividadSucursal: { acreditaciones: number; canjes: number; clientes_unicos: number } | null = null;
  if (esOwner && sucursalActiva) {
    const filas = await reporteSucursales(supabase, comercioId);
    const fila = filas.find((f) => f.sucursal_id === sucursalActiva.id);
    actividadSucursal = {
      acreditaciones: fila?.acreditaciones ?? 0,
      canjes: fila?.canjes ?? 0,
      clientes_unicos: fila?.clientes_unicos ?? 0,
    };
  }
```

y entre la sección de métricas y "Tu programa":

```tsx
      {sucursalActiva && actividadSucursal && (
        <section className="panel reveal d3" style={{ marginTop: 0, marginBottom: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 className="admin-fila-nombre" style={{ fontSize: '1.05rem' }}>
              Actividad en {sucursalActiva.nombre}
            </h2>
            <span className="admin-fila-slug">contexto activo</span>
          </div>
          <div style={{ display: 'flex', gap: 28 }}>
            {[
              [actividadSucursal.clientes_unicos, 'Clientes'],
              [actividadSucursal.acreditaciones, 'Visitas'],
              [actividadSucursal.canjes, 'Premios'],
            ].map(([valor, etiqueta]) => (
              <div key={etiqueta}>
                <div className="dato-mono" style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--texto)', lineHeight: 1 }}>
                  {valor}
                </div>
                <div className="admin-fila-slug" style={{ marginTop: 4 }}>{etiqueta}</div>
              </div>
            ))}
          </div>
        </section>
      )}
```

(Las métricas de "Clientes con tarjeta"/"Puntos vigentes" siguen siendo del comercio — la tarjeta es compartida entre sucursales; no se tocan.)

- [ ] **Paso 4: Typecheck + lint + suite; Commit**

```bash
git add "app/comercio/(protegido)/escanear/page.tsx" "app/comercio/(protegido)/escanear/Escaner.tsx" "app/comercio/(protegido)/cajeros/page.tsx" "app/comercio/(protegido)/cajeros/FormularioCajero.tsx" "app/comercio/(protegido)/panel/page.tsx"
git commit -m "Contexto de sucursal scopea Escanear (atribucion preseleccionada), Cajeros (filtro y alta) y Resumen (carta de actividad)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Checkpoint Fase 3:** la pastilla del header dice dónde estás parado; cambiar de sucursal no te saca de la página; el escáner atribuye por defecto a la sucursal del contexto.

---

# FASE 4 — Modal "¿Qué estás creando?" + alta self-serve de comercios

### Tarea 11: Slug autogenerado (`slugComercio.ts`)

**Files:**
- Create: `lib/comercios/slugComercio.ts`
- Create: `lib/comercios/slugComercio.test.ts`

- [ ] **Paso 1: Tests que fallan:**

```ts
import { describe, it, expect } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { slugificarNombre, generarSlugUnico } from './slugComercio';

describe('slugificarNombre (pura)', () => {
  it('minúsculas, sin acentos ni ñ, espacios y símbolos a guiones', () => {
    expect(slugificarNombre('Café París 2')).toBe('cafe-paris-2');
    expect(slugificarNombre('La Ñoña')).toBe('la-nona');
    expect(slugificarNombre('  Verde—Raíz  ')).toBe('verde-raiz');
    expect(slugificarNombre('ya-en-forma')).toBe('ya-en-forma');
  });

  it('un nombre sin caracteres usables cae al fallback', () => {
    expect(slugificarNombre('¡¡¡***!!!')).toBe('comercio');
  });
});

describe('generarSlugUnico (integración)', () => {
  const supabase = createServiceClient();
  const comerciosDePrueba: string[] = [];

  afterEach(async () => {
    if (comerciosDePrueba.length) {
      await supabase.from('sucursales').delete().in('comercio_id', comerciosDePrueba);
      await supabase.from('comercios').delete().in('id', comerciosDePrueba);
      comerciosDePrueba.length = 0;
    }
  });

  async function ocuparSlug(slug: string) {
    const { data, error } = await supabase
      .from('comercios').insert({ nombre: 'Ocupa', slug }).select('id').single();
    if (error) throw error;
    comerciosDePrueba.push(data.id);
  }

  it('slug libre: devuelve el base', async () => {
    const base = `libre-${Date.now()}`;
    expect(await generarSlugUnico(supabase, base)).toEqual({ ok: true, slug: base });
  });

  it('base ocupado: desambigua con -2', async () => {
    const base = `choca-${Date.now()}`;
    await ocuparSlug(base);
    expect(await generarSlugUnico(supabase, base)).toEqual({ ok: true, slug: `${base}-2` });
  });

  it('los 5 candidatos ocupados: error claro, sin loop infinito', async () => {
    const base = `lleno-${Date.now()}`;
    await ocuparSlug(base);
    for (let i = 2; i <= 5; i++) await ocuparSlug(`${base}-${i}`);
    expect(await generarSlugUnico(supabase, base)).toEqual({
      ok: false,
      error: 'No se pudo generar una dirección única, cambiá el nombre.',
    });
  });
});
```

(Importá `afterEach` de vitest en el import inicial. OJO: `ocuparSlug` inserta comercios SIN cuenta — válido a nivel BD, la columna es nullable.)

- [ ] **Paso 2: Ver FALLAR**, **Paso 3: Implementar** `lib/comercios/slugComercio.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

// Slug autogenerado para el alta self-serve (plan 2026-07-25 §4.6): el dueño no ve el campo (FM
// puede editarlo después desde su panel). Debe cumplir el regex de validar(): ^[a-z0-9-]+$.
// OJO transcripción: el rango del segundo replace es el bloque Unicode "Combining Diacritical
// Marks" y DEBE escribirse con escapes: barra-u-0300 guion barra-u-036f (si al copiar quedaron
// caracteres combinantes literales dentro de los corchetes, reescribilo con los escapes).
export function slugificarNombre(nombre: string): string {
  const base = nombre
    .toLowerCase()
    .normalize('NFD') // separa letra y acento: "café" → "cafe" + diacrítico (la ñ → n + tilde)
    .replace(/[̀-ͯ]/g, '') // borra los diacríticos combinantes que dejó NFD
    .replace(/[^a-z0-9]+/g, '-') // todo lo demás (espacios, símbolos) → un guion
    .replace(/^-+|-+$/g, ''); // sin guiones en los bordes
  return base || 'comercio'; // un nombre sin nada usable (p. ej. "!!!") no puede dar slug vacío
}

// Busca un slug LIBRE: el base, o base-2..base-5. Se PRE-verifica con un select porque
// crearComercio traduce el 23505 a un mensaje (no expone el código) y matchear mensajes sería
// frágil. Una colisión residual por carrera entre este select y el insert devuelve el error de
// crearComercio tal cual (el usuario reintenta). Tope de 5: evita un loop infinito en un caso
// ~imposible.
export async function generarSlugUnico(
  supabase: SupabaseClient<Database>,
  nombre: string,
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const base = slugificarNombre(nombre);
  for (let i = 1; i <= 5; i++) {
    const candidato = i === 1 ? base : `${base}-${i}`;
    const { data, error } = await supabase
      .from('comercios').select('id').eq('slug', candidato).maybeSingle();
    if (error) {
      console.error('[comercio] no se pudo verificar la disponibilidad del slug:', error);
      return { ok: false, error: 'No se pudo crear el comercio.' };
    }
    if (!data) return { ok: true, slug: candidato };
  }
  return { ok: false, error: 'No se pudo generar una dirección única, cambiá el nombre.' };
}
```

- [ ] **Paso 4: Ver PASAR** — `npm test -- lib/comercios/slugComercio.test.ts`. **Paso 5: Commit**

```bash
git add lib/comercios/slugComercio.ts lib/comercios/slugComercio.test.ts
git commit -m "Slug autogenerado con desambiguacion pre-verificada para el alta self-serve" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Tarea 12: `crearComercioPropio` (lib, con compensación)

**Files:**
- Create: `lib/comercios/crearComercioPropio.ts`
- Create: `lib/comercios/crearComercioPropio.test.ts`

- [ ] **Paso 1: Tests que fallan** — archivo nuevo completo:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearComercioPropio } from './crearComercioPropio';

const supabase = createServiceClient();
const cuentasDePrueba: string[] = [];
const comerciosDePrueba: string[] = [];
const usuariosAuthDePrueba: string[] = [];

afterEach(async () => {
  // Orden FK: usuarios_comercio y sucursales → comercios → cuentas → auth.users (el FK de
  // auth_user_id bloquea el deleteUser si quedan membresías).
  if (comerciosDePrueba.length) {
    await supabase.from('usuarios_comercio').delete().in('comercio_id', comerciosDePrueba);
    await supabase.from('sucursales').delete().in('comercio_id', comerciosDePrueba);
    await supabase.from('comercios').delete().in('id', comerciosDePrueba);
    comerciosDePrueba.length = 0;
  }
  if (cuentasDePrueba.length) {
    await supabase.from('cuentas_comercio').delete().in('id', cuentasDePrueba);
    cuentasDePrueba.length = 0;
  }
  for (const id of usuariosAuthDePrueba) {
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) console.error('[test] no se pudo borrar el usuario de Auth de prueba:', error.message);
  }
  usuariosAuthDePrueba.length = 0;
});

async function crearCuentaFixture(limite: number): Promise<string> {
  const { data, error } = await supabase
    .from('cuentas_comercio')
    .insert({ nombre: `Cuenta Propio ${Date.now()}`, limite_negocios: limite })
    .select('id').single();
  if (error) throw error;
  cuentasDePrueba.push(data.id);
  return data.id;
}

async function crearComercioActivoFixture(cuentaId: string | null): Promise<string> {
  const { data, error } = await supabase
    .from('comercios')
    .insert({ nombre: 'Activo', slug: `activo-${Date.now()}-${Math.random().toString(36).slice(2)}`, cuenta_id: cuentaId })
    .select('id').single();
  if (error) throw error;
  comerciosDePrueba.push(data.id);
  return data.id;
}

async function crearOwnerFixture(comercioId: string): Promise<{ authUserId: string; email: string }> {
  const email = `owner-propio-${Date.now()}-${Math.random().toString(36).slice(2)}@test.fm`;
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: 'secreta-de-test-123',
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error('sin usuario de Auth');
  usuariosAuthDePrueba.push(data.user.id);
  const { error: eMembresia } = await supabase.from('usuarios_comercio').insert({
    comercio_id: comercioId,
    auth_user_id: data.user.id,
    email,
    rol: 'owner',
  });
  if (eMembresia) throw eMembresia;
  return { authUserId: data.user.id, email };
}

// Registra para el teardown lo que la función crea (el id vuelve en el resultado).
function registrar(id: string) {
  comerciosDePrueba.push(id);
}

describe('crearComercioPropio', () => {
  it('crea comercio + Principal + membresía owner, con la cuenta DERIVADA de la sesión', async () => {
    const cuentaId = await crearCuentaFixture(2);
    const activoId = await crearComercioActivoFixture(cuentaId);
    const { authUserId, email } = await crearOwnerFixture(activoId);

    const res = await crearComercioPropio(
      supabase,
      { authUserId, comercioActivoId: activoId },
      { nombre: 'Mi Segunda Marca', tipoTarjeta: 'sellos' },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    registrar(res.id);

    const { data: comercio } = await supabase
      .from('comercios').select('nombre, slug, tipo_tarjeta, cuenta_id, sello_meta').eq('id', res.id).single();
    expect(comercio).toEqual({
      nombre: 'Mi Segunda Marca',
      slug: 'mi-segunda-marca',
      tipo_tarjeta: 'sellos',
      cuenta_id: cuentaId, // CONTROL: derivada del comercio activo, nunca de un input
      sello_meta: null, // se configura en /marca
    });

    const { data: principal } = await supabase
      .from('sucursales').select('nombre, activa, es_principal').eq('comercio_id', res.id);
    expect(principal).toEqual([{ nombre: 'Principal', activa: true, es_principal: true }]);

    const { data: membresia } = await supabase
      .from('usuarios_comercio').select('email, rol, activo').eq('comercio_id', res.id);
    expect(membresia).toEqual([{ email, rol: 'owner', activo: true }]);
  });

  it('cuenta llena: rechaza con el error de límite', async () => {
    const cuentaId = await crearCuentaFixture(1); // el comercio activo ya la llena
    const activoId = await crearComercioActivoFixture(cuentaId);
    const { authUserId } = await crearOwnerFixture(activoId);

    const res = await crearComercioPropio(
      supabase,
      { authUserId, comercioActivoId: activoId },
      { nombre: 'No Cabe', tipoTarjeta: 'puntos' },
    );
    expect(res).toEqual({ ok: false, error: 'Esta cuenta ya alcanzó su límite de 1 negocio(s)/sucursal(es).' });
  });

  it('comercio activo sin cuenta: error claro', async () => {
    const activoId = await crearComercioActivoFixture(null);
    const { authUserId } = await crearOwnerFixture(activoId);

    const res = await crearComercioPropio(
      supabase,
      { authUserId, comercioActivoId: activoId },
      { nombre: 'Sin Cuenta', tipoTarjeta: 'puntos' },
    );
    expect(res).toEqual({ ok: false, error: 'Tu comercio no está asociado a una cuenta. Contactá a FM.' });
  });

  it('tipo de tarjeta no disponible (cashback): rechazado', async () => {
    const cuentaId = await crearCuentaFixture(5);
    const activoId = await crearComercioActivoFixture(cuentaId);
    const { authUserId } = await crearOwnerFixture(activoId);

    const res = await crearComercioPropio(
      supabase,
      { authUserId, comercioActivoId: activoId },
      { nombre: 'Cash', tipoTarjeta: 'cashback' },
    );
    expect(res).toEqual({ ok: false, error: 'El tipo de tarjeta no es válido.' });
  });

  it('si la membresía falla, COMPENSA: borra comercio y principal, y devuelve error', async () => {
    const cuentaId = await crearCuentaFixture(5);
    const activoId = await crearComercioActivoFixture(cuentaId);
    const { authUserId } = await crearOwnerFixture(activoId);

    // Inyección puntual: el insert de usuarios_comercio falla; el SELECT (membresía actual) sigue
    // real. Todo lo demás pega a la BD de verdad — la compensación borra filas reales.
    const real = createServiceClient();
    const conMembresiasRotas = {
      from(tabla: string) {
        const builder = real.from(tabla as never);
        if (tabla !== 'usuarios_comercio') return builder;
        return {
          select: builder.select.bind(builder),
          insert: () => ({ error: { message: 'roto a propósito' } }),
        } as never;
      },
    } as ReturnType<typeof createServiceClient>;

    const res = await crearComercioPropio(
      conMembresiasRotas,
      { authUserId, comercioActivoId: activoId },
      { nombre: 'Huerfano Imposible', tipoTarjeta: 'puntos' },
    );
    expect(res).toEqual({ ok: false, error: 'No se pudo crear el comercio. Intentá de nuevo.' });

    // Ni el comercio ni su principal sobrevivieron.
    const { data: huerfanos } = await real.from('comercios').select('id').eq('slug', 'huerfano-imposible');
    expect(huerfanos).toEqual([]);
  });
});
```

- [ ] **Paso 2: Ver FALLAR** — `npm test -- lib/comercios/crearComercioPropio.test.ts`.

- [ ] **Paso 3: Implementar `lib/comercios/crearComercioPropio.ts`:**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { TIPOS_TARJETA, crearComercio } from './guardarComercio';
import { generarSlugUnico } from './slugComercio';

// Alta self-serve de un comercio por el DUEÑO (plan 2026-07-25 §4.6). A diferencia del alta de FM:
//  - la CUENTA nunca viene de un formulario — se deriva del comercio activo de la sesión (control
//    de seguridad: un cuenta_id del cliente dejaría crear comercios en cuentas ajenas);
//  - el slug se autogenera; el branding nace con los defaults del editor de marca (los placeholder
//    del form de FM son blanco/blanco/blanco — tarjeta ilegible) y se termina en /marca.
// La licencia NO se verifica: hoy licencia_estado no gatea ningún flujo del panel comercio
// (solo el admin FM la usa) y este alta mantiene esa política — el cupo es el único tope.

// Los defaults de branding/page.tsx — la carta nace legible y con el acento de la casa.
export const COLORES_DEFAULT = {
  color_fondo: 'rgb(19, 19, 21)',
  color_texto: 'rgb(245, 245, 240)',
  color_label: 'rgb(255, 157, 66)',
} as const;

export interface DatosComercioPropio {
  nombre: string;
  tipoTarjeta: string;
}

export async function crearComercioPropio(
  supabase: SupabaseClient<Database>,
  sesion: { authUserId: string; comercioActivoId: string },
  datos: DatosComercioPropio,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const nombre = datos.nombre.trim();
  if (!nombre) return { ok: false, error: 'El nombre del comercio es obligatorio.' };

  // Solo los tipos FUNCIONALES hoy (puntos/sellos): el modal no ofrece los "próximamente", y un
  // valor armado a mano tampoco pasa — el <select>/<radio> del cliente nunca es la barrera.
  const tipo = TIPOS_TARJETA.find((t) => t.valor === datos.tipoTarjeta && t.disponible);
  if (!tipo) return { ok: false, error: 'El tipo de tarjeta no es válido.' };

  // 1) Cuenta DERIVADA de la sesión (ver comentario de cabecera).
  const { data: comercioActivo, error: eActivo } = await supabase
    .from('comercios').select('cuenta_id').eq('id', sesion.comercioActivoId).maybeSingle();
  if (eActivo) {
    console.error('[comercio] no se pudo leer el comercio activo para el alta:', eActivo);
    return { ok: false, error: 'No se pudo crear el comercio.' };
  }
  const cuentaId = comercioActivo?.cuenta_id;
  if (!cuentaId) return { ok: false, error: 'Tu comercio no está asociado a una cuenta. Contactá a FM.' };

  // 2) Email para la membresía nueva: el de la membresía owner ACTUAL (fuente estable — los claims
  //    podrían no traer email).
  const { data: membresiaActual, error: eMembresia } = await supabase
    .from('usuarios_comercio')
    .select('email')
    .eq('comercio_id', sesion.comercioActivoId)
    .eq('auth_user_id', sesion.authUserId)
    .eq('rol', 'owner')
    .eq('activo', true)
    .maybeSingle();
  if (eMembresia || !membresiaActual) {
    console.error('[comercio] no se encontró la membresía owner de la sesión para el alta:', eMembresia);
    return { ok: false, error: 'No se pudo crear el comercio.' };
  }

  // 3) Slug libre.
  const slug = await generarSlugUnico(supabase, nombre);
  if (!slug.ok) return slug;

  // 4) Comercio: crearComercio valida, verifica el cupo de la cuenta y crea la sucursal Principal
  //    (mismo camino que el alta de FM).
  const creado = await crearComercio(supabase, {
    nombre,
    slug: slug.slug,
    ...COLORES_DEFAULT,
    logo_url: null,
    strip_url: null,
    hero_url: null,
    tipo_tarjeta: tipo.valor,
    cuenta_id: cuentaId,
  });
  if (!creado.ok) return creado;

  // 5) Membresía owner del comercio nuevo — sin ella el dueño no podría ni verlo. Si falla,
  //    COMPENSACIÓN best-effort: borrar la principal y el comercio recién creados. Ningún camino
  //    "ok" puede dejar un comercio que el usuario no administra.
  const { error: eInsertMembresia } = await supabase.from('usuarios_comercio').insert({
    comercio_id: creado.id,
    auth_user_id: sesion.authUserId,
    email: membresiaActual.email,
    rol: 'owner',
  });
  if (eInsertMembresia) {
    console.error('[comercio] falló la membresía del comercio nuevo; se revierte el alta:', eInsertMembresia);
    const { error: eSucursales } = await supabase.from('sucursales').delete().eq('comercio_id', creado.id);
    if (eSucursales) console.error('[comercio] no se pudo borrar la principal en la compensación:', eSucursales);
    const { error: eComercio } = await supabase.from('comercios').delete().eq('id', creado.id);
    if (eComercio) console.error('[comercio] no se pudo borrar el comercio en la compensación:', eComercio);
    return { ok: false, error: 'No se pudo crear el comercio. Intentá de nuevo.' };
  }

  return { ok: true, id: creado.id };
}
```

- [ ] **Paso 4: Ver PASAR** — `npm test -- lib/comercios/crearComercioPropio.test.ts`.

- [ ] **Paso 5: MUTATION-TESTS (tres candados).** (a) En el paso 5 de la función, comentá los DOS deletes de la compensación → FALLA "si la membresía falla, COMPENSA" (queda la fila con slug `huerfano-imposible`). Restaurá. (b) En la validación del tipo, quitá `&& t.disponible` → FALLA "tipo de tarjeta no disponible" (cashback se crearía). Restaurá. (c) **Cuenta derivada de la sesión** (fila de la tabla §5 del spec): en el paso 4, cambiá `cuenta_id: cuentaId` por `cuenta_id: '00000000-0000-0000-0000-000000000000'` (la cuenta deja de venir de la sesión) y corré SOLO el primer test:

```bash
npm test -- lib/comercios/crearComercioPropio.test.ts -t "cuenta DERIVADA"
```

Esperado: FALLA en `expect(res.ok).toBe(true)` con `error: 'La cuenta no existe.'` — `verificarLimiteCuenta` rechaza el uuid inventado antes de cualquier insert. **Esta mutación NO escribe en la BD, y por eso es esta y no otra:** una variante que apunte a una cuenta REAL con cupo haría que el test "cuenta llena" (que no registra su comercio para el teardown) cree un comercio + principal + membresía huérfanos en el proyecto de producción, donde el usuario hace QA — y encima la membresía bloquearía por FK el `deleteUser` del `afterEach`. Restaurá y corré el archivo completo en verde.

  Nota de desviación deliberada respecto al spec §7: ahí se sugería provocar el fallo de membresía con un `auth_user_id` inexistente (FK real). No sirve acá: el paso 2 de la función busca la membresía owner ACTUAL por ese mismo `auth_user_id` y abortaría antes de llegar al insert. Por eso el test usa inyección puntual del insert de `usuarios_comercio` (el resto pega a la BD real y la compensación borra filas reales).

- [ ] **Paso 6: Suite + typecheck + lint; Commit**

```bash
git add lib/comercios/crearComercioPropio.ts lib/comercios/crearComercioPropio.test.ts
git commit -m "crearComercioPropio: alta self-serve con cuenta derivada de la sesion, principal y membresia owner + compensacion" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Tarea 13: Modal en Sucursales + acción + aterrizaje en /marca

**Files:**
- Modify: `app/comercio/(protegido)/sucursales/actions.ts` (tipo `EstadoSucursal` + nueva acción)
- Modify: `app/comercio/(protegido)/sucursales/FormularioSucursal.tsx` (queda SOLO renombrar)
- Create: `app/comercio/(protegido)/sucursales/ModalAgregarLocal.tsx`
- Modify: `app/comercio/(protegido)/sucursales/page.tsx` (botón Agregar + `?agregar=1`)
- Modify: `app/comercio/(protegido)/branding/page.tsx` (banner `?nuevo=1`)

- [ ] **Paso 1: `actions.ts`.** `EstadoSucursal` NO se toca (lo comparten `accionRenombrarSucursal` y `accionCambiarEstado`, y ensancharlo rompería el `estado?.error` de `BotonEstadoSucursal.tsx:36`). El ALTA gana su propio tipo, porque el modal necesita distinguir el éxito para cerrarse:

```ts
// El alta tiene su propio estado (no el EstadoSucursal compartido): el modal se cierra al ver
// {ok:true}, y un `undefined` de éxito sería indistinguible del estado inicial.
export type EstadoCrearSucursal = { error: string } | { ok: true } | undefined;
```

`accionCrearSucursal` pasa a `Promise<EstadoCrearSucursal>` (firma y tipo del `_estadoPrevio`) y su `return undefined` final pasa a `return { ok: true };`. Se agrega al final del archivo:

```ts
export type EstadoComercioPropio = { error: string } | undefined;

// Alta self-serve de comercio (modal "¿Qué estás creando?"). Gate owner FUERA de try/catch. Al
// éxito fija el comercio NUEVO como activo (su membresía owner se acaba de crear — válido por
// construcción, mismo criterio que fijar tras elegir), resetea la sucursal a "todas" y aterriza
// en /marca para terminar la identidad. redirect() LANZA NEXT_REDIRECT: nada de try/catch acá.
export async function accionCrearComercioPropio(
  _estadoPrevio: EstadoComercioPropio,
  formData: FormData,
): Promise<EstadoComercioPropio> {
  const { authUserId, comercioId } = await verifyComercioOwner();

  const res = await crearComercioPropio(
    createServiceClient(),
    { authUserId, comercioActivoId: comercioId },
    {
      nombre: String(formData.get('nombre') ?? ''),
      tipoTarjeta: String(formData.get('tipoTarjeta') ?? ''),
    },
  );
  if (!res.ok) return { error: res.error };

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_COMERCIO_ACTIVO, res.id, opcionesCookieComercio());
  cookieStore.delete(COOKIE_SUCURSAL_ACTIVA);
  revalidatePath('/comercio', 'layout');
  redirect('/comercio/branding?nuevo=1');
}
```

Imports nuevos del archivo: `cookies` (`next/headers`), `redirect` (`next/navigation`), `crearComercioPropio`, y `COOKIE_COMERCIO_ACTIVO, COOKIE_SUCURSAL_ACTIVA, opcionesCookieComercio`.

- [ ] **Paso 2: `FormularioSucursal.tsx` queda SOLO renombrar** (el alta vive en el modal; borrar `FormularioCrear` y el switch por prop — `sucursal` pasa a requerido). Sigue usando `EstadoSucursal`, así que el render del error no cambia. Contenido completo:

```tsx
'use client';

import { useState, type ChangeEvent } from 'react';
import { useActionState } from 'react';
import { accionRenombrarSucursal, type EstadoSucursal } from './actions';

// Renombrar una sucursal existente (el ALTA vive en ModalAgregarLocal desde el plan 2026-07-25).
// Input CONTROLADO (patrón anti-reset de FormularioComercio): un rechazo ("ya no existe", nombre
// vacío) NO borra lo que el dueño estaba editando.
export default function FormularioSucursal({
  sucursal,
}: {
  sucursal: { id: string; nombre: string };
}) {
  const accion = accionRenombrarSucursal.bind(null, sucursal.id);
  const [estado, ejecutar, pendiente] = useActionState<EstadoSucursal, FormData>(accion, undefined);

  const [nombre, setNombre] = useState(sucursal.nombre);
  const cambiar = (e: ChangeEvent<HTMLInputElement>) => setNombre(e.target.value);

  return (
    <form action={ejecutar} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <div className="field" style={{ marginBottom: 0, flex: 1 }}>
          <input
            id={`renombrar-${sucursal.id}`}
            name="nombre"
            value={nombre}
            onChange={cambiar}
            aria-label={`Nuevo nombre para ${sucursal.nombre}`}
            required
          />
        </div>
        <button className="btn-borde" type="submit" disabled={pendiente} style={{ whiteSpace: 'nowrap' }}>
          {pendiente ? 'Guardando…' : 'Renombrar'}
        </button>
      </div>
      {estado?.error && <p className="alerta" role="alert" style={{ margin: 0 }}>{estado.error}</p>}
    </form>
  );
}
```

- [ ] **Paso 3: Crear `ModalAgregarLocal.tsx`:**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useActionState } from 'react';
import {
  accionCrearSucursal,
  accionCrearComercioPropio,
  type EstadoCrearSucursal,
  type EstadoComercioPropio,
} from './actions';
import { TIPOS_TARJETA } from '@/lib/comercios/guardarComercio';

type Paso = 'elegir' | 'sucursal' | 'comercio';

// Modal "¿Qué estás creando?" (plan 2026-07-25 §4.6). La página solo lo renderiza cuando HAY cupo.
// El alta de comercio redirige a /marca desde el server (su caso de éxito nunca vuelve acá); el de
// sucursal devuelve {ok} y el modal se cierra (la lista de atrás ya se revalidó).
export default function ModalAgregarLocal({
  nombreComercio,
  puedeCrearComercio,
  abrirAlCargar,
}: {
  nombreComercio: string;
  puedeCrearComercio: boolean;
  abrirAlCargar: boolean;
}) {
  const [abierto, setAbierto] = useState(abrirAlCargar);
  const [paso, setPaso] = useState<Paso>('elegir');

  const [estadoSucursal, crearSucursal, pendienteSucursal] = useActionState<EstadoCrearSucursal, FormData>(
    accionCrearSucursal,
    undefined,
  );
  useEffect(() => {
    if (estadoSucursal && 'ok' in estadoSucursal) {
      setAbierto(false);
      setPaso('elegir');
    }
  }, [estadoSucursal]);

  const [estadoComercio, crearComercio, pendienteComercio] = useActionState<EstadoComercioPropio, FormData>(
    accionCrearComercioPropio,
    undefined,
  );

  const cerrar = () => {
    setAbierto(false);
    setPaso('elegir');
  };

  const boton = (
    <button className="btn-primary" type="button" disabled={abierto} onClick={() => setAbierto(true)}>
      <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">add_circle</span>
      Agregar local
    </button>
  );

  if (!abierto) return boton;

  const tiposDisponibles = TIPOS_TARJETA.filter((t) => t.disponible);

  return (
    <>
      {boton}
      <div className="sheet-fondo" onClick={cerrar}>
        <div
          className="sheet-panel"
          role="dialog"
          aria-label="Agregar local"
          onClick={(e) => e.stopPropagation()}
        >
          {paso === 'elegir' && (
            <>
              <p className="titulo-seccion" style={{ marginBottom: 10 }}>¿Qué estás creando?</p>
              <button type="button" className="sheet-fila" onClick={() => setPaso('sucursal')}>
                <span className="icono" aria-hidden="true">store</span>
                <span>
                  <span style={{ display: 'block', fontWeight: 700 }}>Sucursal</span>
                  <span className="admin-fila-slug">
                    Otro local que usa la misma tarjeta de {nombreComercio}.
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="sheet-fila"
                disabled={!puedeCrearComercio}
                style={puedeCrearComercio ? undefined : { opacity: 0.55, cursor: 'not-allowed' }}
                onClick={() => setPaso('comercio')}
              >
                <span className="icono" aria-hidden="true">storefront</span>
                <span>
                  <span style={{ display: 'block', fontWeight: 700 }}>Comercio nuevo</span>
                  <span className="admin-fila-slug">
                    {puedeCrearComercio
                      ? 'Otra marca, con su propia tarjeta e identidad.'
                      : 'Tu comercio no está asociado a una cuenta — contactá a FM.'}
                  </span>
                </span>
              </button>
            </>
          )}

          {paso === 'sucursal' && (
            <form action={crearSucursal}>
              <p className="titulo-seccion" style={{ marginBottom: 10 }}>Nueva sucursal</p>
              <p className="admin-fila-slug" style={{ marginBottom: 12 }}>
                Va a usar la misma tarjeta y el mismo QR de registro de {nombreComercio}.
              </p>
              <div className="field">
                <label htmlFor="nombre-sucursal">Nombre de la sucursal</label>
                <input id="nombre-sucursal" name="nombre" placeholder="Sucursal Centro" required />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-borde" type="button" onClick={() => setPaso('elegir')}>
                  Volver
                </button>
                <button className="btn-primary" type="submit" disabled={pendienteSucursal}>
                  {pendienteSucursal ? 'Agregando…' : 'Agregar sucursal'}
                </button>
              </div>
              {estadoSucursal && 'error' in estadoSucursal && (
                <p className="alerta" role="alert">{estadoSucursal.error}</p>
              )}
            </form>
          )}

          {paso === 'comercio' && (
            <form action={crearComercio}>
              <p className="titulo-seccion" style={{ marginBottom: 10 }}>Comercio nuevo</p>
              <p className="admin-fila-slug" style={{ marginBottom: 12 }}>
                Al crearlo te llevamos al editor de marca para configurar su identidad.
              </p>
              <div className="field">
                <label htmlFor="nombre-comercio">Nombre del comercio</label>
                <input id="nombre-comercio" name="nombre" placeholder="Verde Raíz Café" required />
              </div>
              <div className="field">
                <label>Tipo de tarjeta</label>
                {tiposDisponibles.map((t, i) => (
                  <label
                    key={t.valor}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', cursor: 'pointer' }}
                  >
                    <input type="radio" name="tipoTarjeta" value={t.valor} defaultChecked={i === 0} required />
                    <span>
                      <span style={{ display: 'block', fontWeight: 600 }}>{t.etiqueta}</span>
                      <span className="admin-fila-slug">{t.descripcion}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-borde" type="button" onClick={() => setPaso('elegir')}>
                  Volver
                </button>
                <button className="btn-primary" type="submit" disabled={pendienteComercio}>
                  {pendienteComercio ? 'Creando…' : 'Crear comercio'}
                </button>
              </div>
              {estadoComercio?.error && <p className="alerta" role="alert">{estadoComercio.error}</p>}
            </form>
          )}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Paso 4: `sucursales/page.tsx`** — el gate suma `nombre`, la firma gana `searchParams` y el bloque `reveal d2` cambia:

```tsx
export default async function PaginaSucursales({
  searchParams,
}: {
  searchParams: Promise<{ agregar?: string }>;
}) {
  const { comercioId, nombre } = await verifyComercioOwner();
  const { agregar } = await searchParams;
```

y (reemplaza el bloque del formulario de la Tarea 5; `comercio` es el mismo fetch de `cuenta_id` que esa tarea ya dejó en la página):

```tsx
      <div className="reveal d2">
        {avisoCupo ? (
          <p className="admin-vacio">{avisoCupo}</p>
        ) : (
          <ModalAgregarLocal
            nombreComercio={nombre}
            puedeCrearComercio={Boolean(comercio?.cuenta_id)}
            abrirAlCargar={agregar === '1'}
          />
        )}
      </div>
```

(con `import ModalAgregarLocal from './ModalAgregarLocal';`; el import de `FormularioSucursal` queda solo para las filas de renombrar).

- [ ] **Paso 5: Banner en `/marca`.** En `branding/page.tsx`, la firma gana `searchParams: Promise<{ nuevo?: string }>` (leer `const { nuevo } = await searchParams;`) y tras el `admin-encabezado`:

```tsx
      {nuevo === '1' && (
        <p className="admin-vacio" role="status" style={{ marginBottom: 18 }}>
          Tu comercio nuevo ya está creado. Este es su editor de marca: configurá colores, logo e
          imágenes de la tarjeta{esSellos ? ' y la meta de sellos' : ''}.
        </p>
      )}
```

- [ ] **Paso 6: Typecheck + lint + suite** — deben quedar limpios; `npm test` completo verde.

- [ ] **Paso 7: Commit**

```bash
git add "app/comercio/(protegido)/sucursales" "app/comercio/(protegido)/branding/page.tsx"
git commit -m "Modal '¿Que estas creando?': sucursal o comercio nuevo self-serve que aterriza en /marca" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Checkpoint Fase 4:** un dueño Growth/Pro con cupo crea una sucursal (misma tarjeta) o un comercio nuevo (elige tipo de tarjeta, termina la marca en /marca ya switcheado). Sin cupo, ve el aviso del plan.

---

# FASE 5 — Reportes conglomerado con filtros

### Tarea 14: Merges puros (`agregados.ts`)

**Files:**
- Create: `lib/reportes/agregados.ts`
- Create: `lib/reportes/agregados.test.ts`

- [ ] **Paso 1: Tests que fallan** (todo puro, sin BD):

```ts
import { describe, it, expect } from 'vitest';
import { sumarTendencias, fusionarTopClientes, resolverFiltrosReportes } from './agregados';

// MUTATION-TESTING: el orden es el contrato (visitas desc, puntos como desempate — el MISMO
// criterio que la SQL de reporte_top_clientes). Mutación a atrapar: invertir el sort.
describe('sumarTendencias', () => {
  it('suma día a día entre series y ordena ascendente', () => {
    const a = [
      { dia: '2026-07-24', acreditaciones: 2, canjes: 1 },
      { dia: '2026-07-25', acreditaciones: 3, canjes: 0 },
    ];
    const b = [
      { dia: '2026-07-25', acreditaciones: 1, canjes: 2 },
      { dia: '2026-07-23', acreditaciones: 5, canjes: 0 },
    ];
    expect(sumarTendencias([a, b])).toEqual([
      { dia: '2026-07-23', acreditaciones: 5, canjes: 0 },
      { dia: '2026-07-24', acreditaciones: 2, canjes: 1 },
      { dia: '2026-07-25', acreditaciones: 4, canjes: 2 },
    ]);
  });

  it('sin series devuelve vacío', () => {
    expect(sumarTendencias([])).toEqual([]);
  });

  it('no muta las series de entrada', () => {
    const a = [{ dia: '2026-07-25', acreditaciones: 1, canjes: 1 }];
    sumarTendencias([a, a]);
    expect(a[0]).toEqual({ dia: '2026-07-25', acreditaciones: 1, canjes: 1 });
  });
});

// MUTATION-TESTING: resolverFiltrosReportes es el candado de la fila "Filtros de reportes validados
// contra membresías" (tabla §5 del spec). Vive acá, en una función pura, JUSTAMENTE para poder
// mutarlo — validado inline en la página no habría forma de testearlo (el repo no testea páginas).
describe('resolverFiltrosReportes', () => {
  const comercios = [
    { comercioId: 'c-mio', nombre: 'Mío' },
    { comercioId: 'c-otro-mio', nombre: 'Otro mío' },
  ];
  const sucursales = [
    { id: 's-1', nombre: 'Principal', activa: true, esPrincipal: true },
    { id: 's-2', nombre: 'Centro', activa: true, esPrincipal: false },
  ];

  it('sin params: alcance = todos los comercios owner, sin sucursal', () => {
    expect(resolverFiltrosReportes(comercios, sucursales, {})).toEqual({
      comercio: null,
      sucursal: null,
    });
  });

  it('comercio propio: se acepta', () => {
    expect(resolverFiltrosReportes(comercios, sucursales, { comercio: 'c-mio' })).toEqual({
      comercio: comercios[0],
      sucursal: null,
    });
  });

  it('comercio AJENO (no está en sus membresías): cae a Todo', () => {
    expect(resolverFiltrosReportes(comercios, sucursales, { comercio: 'c-ajeno' })).toEqual({
      comercio: null,
      sucursal: null,
    });
  });

  it('sucursal ajena al comercio filtrado: cae a "todas" sin tumbar el filtro de comercio', () => {
    expect(
      resolverFiltrosReportes(comercios, sucursales, { comercio: 'c-mio', sucursal: 's-de-otro' }),
    ).toEqual({ comercio: comercios[0], sucursal: null });
  });

  it('sucursal válida del comercio filtrado: se acepta', () => {
    expect(
      resolverFiltrosReportes(comercios, sucursales, { comercio: 'c-mio', sucursal: 's-2' }),
    ).toEqual({ comercio: comercios[0], sucursal: sucursales[1] });
  });

  it('sucursal SIN comercio filtrado: se ignora (no hay a qué comercio pertenecer)', () => {
    expect(resolverFiltrosReportes(comercios, sucursales, { sucursal: 's-1' })).toEqual({
      comercio: null,
      sucursal: null,
    });
  });
});

describe('fusionarTopClientes', () => {
  const fila = (nombre: string, visitas: number, puntos: number) => ({
    cliente_id: `id-${nombre}`,
    cliente_nombre: nombre,
    visitas,
    puntos_totales: puntos,
  });

  it('ordena por visitas desc con puntos como desempate, corta al límite y etiqueta el comercio', () => {
    const res = fusionarTopClientes(
      [
        { comercioNombre: 'Café', filas: [fila('Ana', 5, 10), fila('Beto', 3, 99)] },
        { comercioNombre: 'Spa', filas: [fila('Caro', 5, 20), fila('Dani', 1, 1)] },
      ],
      3,
    );
    expect(res.map((r) => [r.cliente_nombre, r.comercio_nombre])).toEqual([
      ['Caro', 'Spa'], // 5 visitas y 20 pts: gana el desempate contra Ana (5 y 10)
      ['Ana', 'Café'],
      ['Beto', 'Café'],
    ]);
  });

  it('límite 0 devuelve vacío', () => {
    expect(fusionarTopClientes([{ comercioNombre: 'X', filas: [fila('A', 1, 1)] }], 0)).toEqual([]);
  });
});
```

- [ ] **Paso 2: Ver FALLAR**, **Paso 3: Implementar** `lib/reportes/agregados.ts`:

```ts
import type { SucursalListada } from '../comercio/sucursales';
import type { FilaTendencia, FilaTopCliente } from './reportes';

// Merges PUROS para la vista conglomerado de /comercio/reportes (plan 2026-07-25 §4.7): los RPC de
// la 0010 son POR comercio; acá se agregan en memoria — cero DDL nuevo, escala de sobra para el
// volumen del piloto. Puros para testearlos sin BD.

// Suma serie a serie por día. Cada serie ya viene con sus días en 0 (la SQL los rellena); días que
// solo existen en una serie igual entran. Orden ascendente por día — con "YYYY-MM-DD" el orden
// lexicográfico ES el cronológico.
export function sumarTendencias(series: FilaTendencia[][]): FilaTendencia[] {
  const porDia = new Map<string, FilaTendencia>();
  for (const serie of series) {
    for (const fila of serie) {
      const acumulado = porDia.get(fila.dia);
      if (acumulado) {
        acumulado.acreditaciones += fila.acreditaciones;
        acumulado.canjes += fila.canjes;
      } else {
        porDia.set(fila.dia, { ...fila }); // copia: no mutar la fila de entrada
      }
    }
  }
  return [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia));
}

export interface ComercioOwner {
  comercioId: string;
  nombre: string;
}

// CONTROL DE SEGURIDAD (tabla §5 del spec): los filtros llegan por querystring — input del cliente.
// El comercio DEBE estar entre las membresías owner de la sesión; la sucursal DEBE pertenecer al
// comercio filtrado. Lo que no valida cae a "Todo"/"todas" — nunca llega un id ajeno a un RPC.
// Puro a propósito: la página no puede testearse, esta función sí (ver MUTATION-TESTING en el
// .test.ts). Una sucursal sin comercio filtrado se ignora: no hay contra qué verificar pertenencia.
export function resolverFiltrosReportes(
  comerciosOwner: ComercioOwner[],
  sucursalesDelComercio: SucursalListada[],
  params: { comercio?: string; sucursal?: string },
): { comercio: ComercioOwner | null; sucursal: SucursalListada | null } {
  const comercio = comerciosOwner.find((c) => c.comercioId === params.comercio) ?? null;
  if (!comercio) return { comercio: null, sucursal: null };
  const sucursal = sucursalesDelComercio.find((s) => s.id === params.sucursal) ?? null;
  return { comercio, sucursal };
}

export type TopClienteConComercio = FilaTopCliente & { comercio_nombre: string };

// Fusiona los tops por comercio en un top global: visitas desc, puntos como desempate (el MISMO
// criterio que la SQL de reporte_top_clientes), cortado a `limite`. Cada fila conserva la etiqueta
// del comercio: en la vista "Todo" una misma persona puede aparecer por dos comercios distintos —
// son tarjetas distintas a propósito, no se fusionan.
export function fusionarTopClientes(
  porComercio: { comercioNombre: string; filas: FilaTopCliente[] }[],
  limite: number,
): TopClienteConComercio[] {
  return porComercio
    .flatMap((c) => c.filas.map((f) => ({ ...f, comercio_nombre: c.comercioNombre })))
    .sort((a, b) => b.visitas - a.visitas || b.puntos_totales - a.puntos_totales)
    .slice(0, Math.max(0, limite));
}
```

- [ ] **Paso 4: Ver PASAR** — `npm test -- lib/reportes/agregados.test.ts`.

- [ ] **Paso 5: MUTATION-TESTS.** (a) Invertí el sort de `fusionarTopClientes` (`a.visitas - b.visitas`) → FALLA el test de orden. Restaurá. (b) Quitá el desempate (`|| b.puntos_totales - a.puntos_totales`) → FALLA (Ana quedaría antes que Caro — verificá que la aserción lo atrape). Restaurá. (c) **Candado de filtros:** en `resolverFiltrosReportes`, cambiá la primera línea por `const comercio = { comercioId: params.comercio!, nombre: '?' };` (confiar en el querystring) → FALLA "comercio AJENO cae a Todo". Restaurá. (d) Cambiá el find de sucursal por `const sucursal = sucursalesDelComercio[0] ?? null;` → FALLA "sucursal ajena al comercio filtrado". Restaurá, todo verde.

- [ ] **Paso 6: Commit**

```bash
git add lib/reportes/agregados.ts lib/reportes/agregados.test.ts
git commit -m "Merges puros para reportes conglomerado: tendencias sumadas y top de clientes fusionado" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Tarea 15: `/comercio/reportes` conglomerado con chips de filtro

**Files:**
- Modify: `app/comercio/(protegido)/reportes/page.tsx` (reescritura completa)
- Modify: `app/globals.css` (chips de filtro)

- [ ] **Paso 1: CSS de los chips** — agregar a `globals.css` (después del bloque del sheet):

```css
/* ---------- chips de filtro (reportes) ---------- */
.filtro-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.filtro-chip {
  font-family: var(--font-body);
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--texto-2);
  background: var(--superficie-3);
  border: 1px solid var(--linea);
  border-radius: var(--radius-pill);
  padding: 6px 12px;
}
.filtro-chip.activo {
  color: var(--sobre-acento);
  background: var(--acento);
  border-color: var(--acento);
}
```

- [ ] **Paso 2: Reescribir `reportes/page.tsx`** (contenido completo; conserva `etiquetaDia`, `Estadistica` y el markup de métricas/tendencia actuales, ahora parametrizados):

```tsx
import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { listarSucursales } from '@/lib/comercio/sucursales';
import {
  reporteSucursales,
  reporteTendencia,
  reporteTopClientes,
  type FilaReporteSucursal,
} from '@/lib/reportes/reportes';
import { sumarTendencias, fusionarTopClientes, resolverFiltrosReportes } from '@/lib/reportes/agregados';

export const dynamic = 'force-dynamic';

const DIAS_TENDENCIA = 14;
const TOP_LIMITE = 5;

// Etiqueta corta dd/mm a partir del `dia` (string "YYYY-MM-DD"). Se parte a mano en vez de `new Date`
// para no arrastrar el desfase de zona horaria (la SQL ya cortó los días en hora de El Salvador).
function etiquetaDia(dia: string): string {
  const [, mm, dd] = dia.split('-');
  return `${dd}/${mm}`;
}

function Estadistica({ valor, etiqueta }: { valor: number; etiqueta: string }) {
  return (
    <div>
      <div className="dato-mono" style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--texto)', lineHeight: 1 }}>
        {valor}
      </div>
      <div className="admin-fila-slug" style={{ marginTop: 4 }}>{etiqueta}</div>
    </div>
  );
}

// `esPrincipal` viene de afuera: reporte_sucursales (0010) no devuelve es_principal — se cruza con
// el listado de sucursales que la página ya carga.
function CartaSucursal({ fila, esPrincipal }: { fila: FilaReporteSucursal; esPrincipal: boolean }) {
  return (
    <div className="panel" style={{ marginTop: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 className="admin-fila-nombre" style={{ fontSize: '1.05rem' }}>
          {fila.sucursal_nombre ?? 'Sin sucursal'}
          {esPrincipal && <span className="admin-fila-slug" style={{ marginLeft: 8 }}>Principal</span>}
        </h3>
        {fila.sucursal_activa === false && <span className="pastilla pastilla-inactivo">inactiva</span>}
        {fila.sucursal_id === null && <span className="admin-fila-slug">actividad sin asignar</span>}
      </div>
      <div style={{ display: 'flex', gap: 28 }}>
        <Estadistica valor={fila.clientes_unicos} etiqueta="Clientes" />
        <Estadistica valor={fila.acreditaciones} etiqueta="Visitas" />
        <Estadistica valor={fila.canjes} etiqueta="Premios" />
      </div>
    </div>
  );
}

export default async function PaginaReportes({
  searchParams,
}: {
  searchParams: Promise<{ comercio?: string; sucursal?: string }>;
}) {
  // Gate del dueño. La vista es el CONGLOMERADO de sus comercios owner (plan 2026-07-25 §4.7) e
  // IGNORA el switcher del header. Los filtros vienen del querystring (input del cliente): los
  // valida resolverFiltrosReportes (puro, con mutation-tests) ANTES de correr cualquier RPC —
  // ?comercio contra la lista owner, ?sucursal por pertenencia al comercio filtrado. Un id ajeno o
  // inválido cae a "Todo"/"todas".
  const { comercios } = await verifyComercioOwner();
  const params = await searchParams;
  const supabase = createServiceClient();

  // Sucursales del comercio del querystring: solo se cargan si ese id es de un comercio SUYO (así
  // un id ajeno ni siquiera dispara la consulta). Activas e inactivas: el histórico de una sucursal
  // apagada sigue siendo consultable.
  const esComercioPropio = comercios.some((c) => c.comercioId === params.comercio);
  const sucursalesDelComercio = esComercioPropio
    ? (await listarSucursales(supabase, params.comercio!)) ?? []
    : [];
  const { comercio: comercioFiltrado, sucursal: sucursalFiltrada } = resolverFiltrosReportes(
    comercios,
    sucursalesDelComercio,
    params,
  );

  const alcance = comercioFiltrado ? [comercioFiltrado] : comercios;
  const datos = await Promise.all(
    alcance.map(async (c) => {
      // El listado va junto a los RPC porque reporte_sucursales (0010) no devuelve es_principal:
      // el cruce por id es lo que permite etiquetar la Principal en cada carta.
      const [sucursales, tendencia, top, listado] = await Promise.all([
        reporteSucursales(supabase, c.comercioId),
        reporteTendencia(supabase, c.comercioId, DIAS_TENDENCIA),
        reporteTopClientes(supabase, c.comercioId, TOP_LIMITE),
        listarSucursales(supabase, c.comercioId),
      ]);
      return { comercio: c, sucursales, tendencia, top, listado: listado ?? [] };
    }),
  );

  // Ids de las sucursales principales del alcance visible (para la etiqueta de las cartas).
  const idsPrincipales = new Set(
    datos.flatMap((d) => d.listado.filter((s) => s.esPrincipal).map((s) => s.id)),
  );

  // Cabecera: con filtro de sucursal, SUS números; si no, la suma del alcance visible.
  const filasVisibles = sucursalFiltrada
    ? datos[0].sucursales.filter((f) => f.sucursal_id === sucursalFiltrada.id)
    : datos.flatMap((d) => d.sucursales);
  const totalVisitas = filasVisibles.reduce((suma, f) => suma + f.acreditaciones, 0);
  const totalPremios = filasVisibles.reduce((suma, f) => suma + f.canjes, 0);

  const tendencia = sucursalFiltrada ? [] : sumarTendencias(datos.map((d) => d.tendencia));
  const maxDia = Math.max(1, ...tendencia.map((d) => d.acreditaciones + d.canjes));
  const hayActividad = totalVisitas + totalPremios > 0;
  const topGlobal = sucursalFiltrada
    ? []
    : fusionarTopClientes(
        datos.map((d) => ({ comercioNombre: d.comercio.nombre, filas: d.top })),
        TOP_LIMITE,
      );

  const urlComercio = (id?: string) => (id ? `/comercio/reportes?comercio=${id}` : '/comercio/reportes');
  const urlSucursal = (id?: string) =>
    comercioFiltrado
      ? id
        ? `/comercio/reportes?comercio=${comercioFiltrado.comercioId}&sucursal=${id}`
        : urlComercio(comercioFiltrado.comercioId)
      : urlComercio();

  return (
    <main className="admin-main" style={{ maxWidth: 640 }}>
      <section className="reveal d1" style={{ marginBottom: 18 }}>
        <h1 className="title" style={{ fontSize: '1.7rem', margin: 0 }}>Reportes</h1>
        <p className="lede" style={{ marginTop: 6 }}>
          {comercios.length > 1
            ? 'Todos tus comercios en un solo lugar. Filtrá por comercio o sucursal.'
            : 'Cómo se mueve tu programa de lealtad por sucursal.'}
        </p>
      </section>

      {/* Filtros (GET, sin JS): fila de comercios; con uno elegido, fila de sus sucursales. */}
      <section className="reveal d1" style={{ marginBottom: 20 }}>
        <div className="filtro-chips">
          <Link className={`filtro-chip${!comercioFiltrado ? ' activo' : ''}`} href={urlComercio()}>
            Todo
          </Link>
          {comercios.map((c) => (
            <Link
              key={c.comercioId}
              className={`filtro-chip${comercioFiltrado?.comercioId === c.comercioId ? ' activo' : ''}`}
              href={urlComercio(c.comercioId)}
            >
              {c.nombre}
            </Link>
          ))}
        </div>
        {comercioFiltrado && sucursalesDelComercio.length > 0 && (
          <div className="filtro-chips" style={{ marginTop: 8 }}>
            <Link className={`filtro-chip${!sucursalFiltrada ? ' activo' : ''}`} href={urlSucursal()}>
              Todas
            </Link>
            {sucursalesDelComercio.map((s) => (
              <Link
                key={s.id}
                className={`filtro-chip${sucursalFiltrada?.id === s.id ? ' activo' : ''}`}
                href={urlSucursal(s.id)}
              >
                {s.nombre}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Métricas de cabecera (alcance visible). */}
      <section className="metric-pila reveal d2">
        <div className="metric-carta naranja">
          <div className="metric-etiqueta">
            <span>Visitas acreditadas</span>
            <span className="icono" aria-hidden="true">sensors</span>
          </div>
          <div>
            <div className="metric-valor">{totalVisitas}</div>
            <div className="metric-sub">sellos/puntos otorgados</div>
          </div>
        </div>
        <div className="metric-carta menta">
          <div className="metric-etiqueta">
            <span>Premios canjeados</span>
            <span className="icono" aria-hidden="true">redeem</span>
          </div>
          <div>
            <div className="metric-valor">{totalPremios}</div>
            <div className="metric-sub">recompensas entregadas</div>
          </div>
        </div>
      </section>

      {sucursalFiltrada ? (
        /* Vista por SUCURSAL: su carta + nota (tendencia y top son por comercio — RPC de la 0010;
           crear variantes por sucursal quedó explícitamente fuera de alcance). */
        <section className="reveal d3">
          {filasVisibles.length === 0 ? (
            <p className="admin-vacio">Todavía no hay actividad registrada en {sucursalFiltrada.nombre}.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {filasVisibles.map((f) => (
                <CartaSucursal
                  key={f.sucursal_id ?? 'sin-sucursal'}
                  fila={f}
                  esPrincipal={f.sucursal_id !== null && idsPrincipales.has(f.sucursal_id)}
                />
              ))}
            </div>
          )}
          <p className="nota" style={{ marginTop: 14 }}>
            La tendencia y el top de clientes son del comercio completo.{' '}
            <Link className="admin-fila-slug" href={urlSucursal()}>Quitar el filtro de sucursal →</Link>
          </p>
        </section>
      ) : (
        <>
          {/* Por comercio (cabecera con el nombre solo cuando hay 2+ en el alcance). */}
          <section className="reveal d3" style={{ marginBottom: 22 }}>
            {datos.map((d) => (
              <div key={d.comercio.comercioId} style={{ marginBottom: 18 }}>
                <p className="titulo-seccion" style={{ marginBottom: 10 }}>
                  {alcance.length > 1 ? d.comercio.nombre : 'Por sucursal'}
                </p>
                {d.sucursales.length === 0 ? (
                  <p className="admin-vacio">Todavía no hay actividad registrada.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {d.sucursales.map((f) => (
                      <CartaSucursal
                        key={f.sucursal_id ?? 'sin-sucursal'}
                        fila={f}
                        esPrincipal={f.sucursal_id !== null && idsPrincipales.has(f.sucursal_id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </section>

          {/* Tendencia agregada del alcance. */}
          <section className="panel reveal d4" style={{ marginTop: 0, marginBottom: 22 }}>
            <h2 className="admin-fila-nombre" style={{ fontSize: '1.1rem', marginBottom: 4 }}>
              Últimos {DIAS_TENDENCIA} días
            </h2>
            <p className="admin-fila-slug" style={{ marginBottom: 16 }}>
              Visitas y premios por día (visitas / premios).
            </p>
            {!hayActividad ? (
              <p style={{ color: 'var(--texto-2)', fontSize: '0.9rem' }}>
                Aún no hay movimientos para graficar.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {tendencia.map((d) => {
                  const total = d.acreditaciones + d.canjes;
                  const pct = Math.round((total / maxDia) * 100);
                  return (
                    <div key={d.dia} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="dato-mono" style={{ width: 46, fontSize: '0.72rem', color: 'var(--texto-2)' }}>
                        {etiquetaDia(d.dia)}
                      </span>
                      <div style={{ flex: 1, height: 10, background: 'var(--superficie-3)', borderRadius: 999, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--acento)' }} />
                      </div>
                      <span className="dato-mono" style={{ width: 58, textAlign: 'right', fontSize: '0.72rem', color: 'var(--texto-2)' }}>
                        {d.acreditaciones}/{d.canjes}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Top de clientes (con etiqueta del comercio cuando el alcance es más de uno). */}
          <section className="reveal d5">
            <p className="titulo-seccion" style={{ marginBottom: 10 }}>Clientes más frecuentes</p>
            {topGlobal.length === 0 ? (
              <p className="admin-vacio">Todavía no hay clientes con visitas.</p>
            ) : (
              <div className="admin-lista">
                {topGlobal.map((c) => (
                  <div key={`${c.comercio_nombre}-${c.cliente_id}`} className="admin-fila">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <span className="icono-circulo acento" aria-hidden="true">
                        <span className="icono">person</span>
                      </span>
                      <div>
                        <div className="admin-fila-nombre">{c.cliente_nombre}</div>
                        <div className="admin-fila-slug">
                          <span className="dato-mono">{c.visitas}</span> visitas
                          {alcance.length > 1 ? ` · ${c.comercio_nombre}` : ''}
                        </div>
                      </div>
                    </div>
                    <span className="admin-fila-slug dato-mono">{c.puntos_totales} pts</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
```

- [ ] **Paso 3: Typecheck + lint + suite** — limpios y verde.

- [ ] **Paso 4: Commit**

```bash
git add "app/comercio/(protegido)/reportes/page.tsx" app/globals.css
git commit -m "Reportes conglomerado: todos los comercios owner con chips de filtro por comercio y sucursal" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Tarea 16: Guía de pruebas manuales + cierre

**Files:**
- Modify: `docs/guia-pruebas-manuales-cuentas-sucursales.md`

- [ ] **Paso 1: Extender la guía.** Leé el formato del archivo existente y agregá una parte nueva al final ("Parte N — Panel móvil, sucursal Principal y contexto (plan 2026-07-25)") con pasos verificables para: (1) migración 0012 verificada (`verificar-0012.ts` OK); (2) cuenta Starter: la sección Sucursales muestra su Principal, Cajeros permite crear el primero, el aviso de cupo aparece al querer agregar más; (3) nav inferior en móvil: se desliza, las 9 secciones alcanzables, la activa se auto-centra; (4) cajero: nav Resumen · Escanear · Clientes, puede acreditar desde el directorio, NO puede entrar a /comercio/reportes ni /comercio/sucursales (rebote); (5) switcher: pastilla con comercio · sucursal, cambiar sucursal no te saca de la página, cambiar comercio aterriza en el panel, el escáner preselecciona la sucursal del contexto; (6) modal: crear sucursal (misma tarjeta) y crear comercio (aterriza en /marca con banner, la marca del header cambia al nuevo); (7) reportes: vista Todo con 2 comercios, filtro por comercio, filtro por sucursal con su nota. Mantené el estilo de la guía existente (checkbox + resultado esperado).

- [ ] **Paso 2: Verificación final completa** — `npm test && npm run typecheck && npm run lint`. Esperado: TODO verde/limpio. Reportar el conteo final de pruebas.

- [ ] **Paso 3: Commit**

```bash
git add docs/guia-pruebas-manuales-cuentas-sucursales.md
git commit -m "Guia de pruebas manuales: panel movil, sucursal principal, contexto, alta self-serve y reportes conglomerado" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Definition of done

- Migración 0012 aplicada por el usuario y verificada con `scripts/verificar-0012.ts` (exit 0).
- Suite completa verde (`npm test`), `npm run typecheck` y `npm run lint` limpios.
- Todos los mutation-tests de los candados ejecutados y reportados (tabla §5 del spec). Mapa
  tarea→candado: cupo/principal → Tarea 2 Paso 5 (a,b) y Tarea 4 Paso 5 (b); principal no
  desactivable + primera-gratis → Tarea 3 Paso 5; cookie de sucursal (cajero la ignora,
  pertenencia, activa) → Tarea 8 Paso 5 (a,b,c); alta principal → Tarea 4 Paso 5 (a); cuenta
  derivada de la sesión, tipo de tarjeta y compensación → Tarea 12 Paso 5 (a,b,c); filtros de
  reportes validados → Tarea 14 Paso 5 (c,d); nav por rol → Tarea 6 Paso 7. Lo único que queda
  fuera del mutation-testing es el comportamiento puramente visual (el carrusel de la nav, el
  sheet, los chips): va a la guía de pruebas manuales (Tarea 16).
- Guía de pruebas manuales extendida; la verificación visual la hace el controlador con las
  herramientas de navegador o el usuario en producción (los checkpoints de cada fase).
- El merge a `master` es fast-forward (patrón del proyecto) y lo decide el usuario.

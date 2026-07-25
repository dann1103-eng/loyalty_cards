# Plan/monto/estado de licencia a nivel cuenta + límite combinado — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover `licencia_plan`/`licencia_monto_mensual`/`licencia_estado`/`licencia_activa_desde` de `comercios` a `cuentas_comercio` (una suscripción por cliente que paga, no por negocio individual), introducir un catálogo fijo de 3 planes (Starter/Growth/Pro) que precargan monto y límite sugerido, y corregir `verificarLimiteCuenta` para que el límite cuente comercios distintos Y sucursales JUNTOS (hoy las sucursales no tienen ningún tope — hueco real encontrado en QA manual sobre la cuenta "Verde Raíz").

**Architecture:** Migración 0011 mueve las 4 columnas de licencia de `comercios` a `cuentas_comercio` con backfill (sigue 1:1 hoy, verificado); `limite_negocios` pasa a nullable (`null` = sin tope, plan Pro). `verificarLimiteCuenta` (ya existente, Fase 5) se reescribe para sumar comercios + sucursales de la cuenta antes de comparar contra el límite; `crearSucursal` (Fase 6, hoy sin ningún límite) pasa a llamarla. Todo el resto de la lógica (gates, RPCs atómicos, reportes) queda intacto — `licencia_estado` no se lee en ningún gate hoy (verificado por grep), así que este es un cambio de datos + UI, no de autenticación.

**Tech Stack:** Next.js 16 App Router / Server Actions, Supabase Postgres (migración a mano), Vitest contra Supabase vivo.

**Contexto de decisiones (resueltas en conversación, no reabrir):**
1. `licencia_plan`/`monto`/`activa_desde` Y `licencia_estado` se mueven TODOS a `cuentas_comercio` — pausar ahora afecta TODOS los comercios de la cuenta a la vez (antes era por comercio; decisión revisada explícitamente para este fix, corrige la decisión 2 original del spec de Fase 6).
2. Catálogo real de 3 planes (de `fm-ai-website.vercel.app/productos/cardly`): Starter $29/mes, Growth $49/mes, Pro $89/mes. El límite de cada plan es un DEFAULT sugerido, editable por FM por cuenta (tratos negociados) — no estricto.
3. "Diseños de tarjeta" en el catálogo de marketing, aterrizado a este modelo técnico: el número del plan es la SUMA de comercios distintos + sucursales de la cuenta (una sola cuenta combinada, no dos topes separados). Confirmado con el caso real: Verde Raíz (1 comercio + 2 sucursales = 3 unidades) debe quedar sobre su límite de 2.
4. Pro = sin tope real (`limite_negocios: null`), no un número grande artificial.
5. Los 6 comercios reales hoy son piloto/demo (`licencia_plan` = `'Demo'` o `null`, verificado por lectura directa) — el backfill NO inventa un plan real; `plan` queda `null` hasta que FM asigne uno de los 3 al editar.

**Explícitamente fuera de alcance (detectado durante el diseño, no pedido):**
- Catálogo Cardly también menciona **límite de clientes** (500/2500/sin límite) y un **setup inicial $149 único** — ninguno de los dos se modela en este fix. Si se quieren, son un fix aparte.
- "Soporte multi-sucursal" de Pro es descriptivo/comercial, no se traduce en una restricción técnica adicional (ya cubierto por el límite combinado).
- No se agrega cobertura retroactiva para `renombrarSucursal`/`cambiarEstadoSucursal`/`listarSucursales`/`sucursalPerteneceAComercio` (gap preexistente de Fase 6, sin tests desde que se escribieron) — la Tarea 4 solo cubre el comportamiento NUEVO (límite en `crearSucursal`).

---

### Task 1: Migración 0011 + `types.ts`

**Files:**
- Create: `supabase/migrations/0011_plan_cuenta.sql`
- Modify: `lib/supabase/types.ts:26-103` (tabla `comercios`), `lib/supabase/types.ts:473-493` (tabla `cuentas_comercio`)

- [ ] **Step 1: Escribir la migración**

```sql
-- 0011: Plan/monto/estado de licencia pasan de comercios a cuentas_comercio (el cliente que paga,
-- no el negocio individual) — antes, 2 comercios de la MISMA cuenta podían tener licencias
-- distintas, lo cual no tiene sentido si es una sola suscripción. licencia_estado también se
-- mueve: pausar ahora afecta TODOS los comercios de la cuenta a la vez (antes era por comercio
-- individual — decisión revisada explícitamente para este fix, corrige la decisión 2 del spec de
-- Fase 6, ver docs/superpowers/plans/2026-07-25-plan-cuenta-facturacion.md).
--
-- El límite (limite_negocios, ya existente desde 0008) cambia de SIGNIFICADO en la capa app
-- (lib/comercios/cuentas.ts verificarLimiteCuenta): antes contaba solo comercios distintos; ahora
-- cuenta comercios Y sucursales JUNTOS. Acá solo se lo vuelve NULLABLE = "sin límite" (plan Pro),
-- en vez de un número mágico grande. El check existente (limite_negocios > 0) ya permite NULL sin
-- tocarlo: Postgres no rechaza una fila por un CHECK que evalúa a NULL, solo por uno que evalúa a
-- false — por eso no hace falta drop/recreate del constraint.

alter table cuentas_comercio
  alter column limite_negocios drop not null,
  add column plan text check (plan is null or plan in ('starter', 'growth', 'pro')),
  add column licencia_estado text not null default 'activo'
    check (licencia_estado in ('activo', 'inactivo')),
  add column licencia_monto_mensual numeric,
  -- date, NO timestamptz: fix de la migración 0004 sobre esta MISMA columna en comercios ("es
  -- semánticamente una FECHA... con timestamptz, El Salvador (UTC-6) renderizaría el día anterior
  -- en cada fila"). Revertir a timestamptz reintroduciría ese off-by-one silencioso. PostgREST
  -- sigue devolviendo `date` como "2026-07-16" (string) — el tipo de TypeScript no cambia.
  add column licencia_activa_desde date;

-- Guardia defensiva: el backfill de abajo asume 1:1 comercio↔cuenta (verificado a mano antes de
-- escribir esta migración con un script de solo lectura: 6/6 comercios con cuenta_id único). Si
-- para cuando esto se corre en Studio algún comercio YA se reasignó a una cuenta compartida (el
-- flujo "Vincular" del panel FM ya existe en producción), el UPDATE de abajo matchearía varias
-- filas de comercios contra una sola fila de cuentas_comercio y Postgres elegiría una de forma no
-- determinística — descartando en silencio los datos de licencia de las demás. Esto lo convierte
-- en un error ruidoso en vez de una corrupción silenciosa.
do $$
begin
  if exists (
    select cuenta_id from comercios where cuenta_id is not null
    group by cuenta_id having count(*) > 1
  ) then
    raise exception 'Hay cuentas con más de un comercio — revisar el backfill manualmente antes de continuar.';
  end if;
end $$;

-- Backfill: se copia estado/monto/fecha de cada comercio a su cuenta (1:1, ver guardia arriba).
-- `plan` se deja NULL a propósito: los 6 comercios reales hoy tienen licencia_plan='Demo' o null
-- (piloto/demo, ninguno es un cliente pagando un plan real de Cardly) — mapearlos a
-- 'starter'/'growth'/'pro' inventaría un dato que no existe. FM le asigna un plan real a cada
-- cuenta la próxima vez que la edite (la capa app lo exige desde este fix en adelante — ver
-- validarDatosCuenta en cuentas.ts).
update cuentas_comercio c
set licencia_estado = co.licencia_estado,
    licencia_monto_mensual = co.licencia_monto_mensual,
    licencia_activa_desde = co.licencia_activa_desde
from comercios co
where co.cuenta_id = c.id;

alter table comercios
  drop column licencia_estado,
  drop column licencia_plan,
  drop column licencia_monto_mensual,
  drop column licencia_activa_desde;
```

- [ ] **Step 2: Entregar la migración al usuario**

Pegar el `.sql` en el chat. El usuario la corre a mano en Supabase Studio (CLAUDE.md: el asistente
no puede correr DDL) y avisa cuando esté aplicada. **Nada del resto de este plan se puede probar
contra la BD viva antes de este paso** — los siguientes tasks SÍ se pueden escribir/typecheckear,
pero sus tests de integración fallarán hasta que la migración esté aplicada.

- [ ] **Step 3: Actualizar `types.ts` — tabla `comercios` (quitar 4 columnas)**

En `Row`, `Insert` y `Update` (líneas ~38-41, ~60-63, ~82-85), borrar estas 4 líneas de cada bloque:
```ts
          licencia_estado: string;
          licencia_plan: string | null;
          licencia_monto_mensual: number | null;
          licencia_activa_desde: string | null;
```
(en `Insert`/`Update` llevan `?` — `licencia_estado?: string;` etc. — igual se borran las 4 líneas
correspondientes en cada bloque). El resto de la tabla `comercios` (incluyendo `Relationships`) no
cambia.

- [ ] **Step 4: Actualizar `types.ts` — tabla `cuentas_comercio` (agregar 4 columnas, `limite_negocios` nullable)**

Reemplazar el bloque completo (líneas 473-493):
```ts
      cuentas_comercio: {
        Row: {
          id: string;
          nombre: string;
          limite_negocios: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          nombre: string;
          limite_negocios?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          nombre?: string;
          limite_negocios?: number;
          created_at?: string;
        };
        Relationships: [];
      };
```
por:
```ts
      cuentas_comercio: {
        Row: {
          id: string;
          nombre: string;
          // null = sin límite (plan Pro). Antes NOT NULL (Fase 6) — migración 0011 lo relaja.
          limite_negocios: number | null;
          plan: string | null;
          licencia_estado: string;
          licencia_monto_mensual: number | null;
          licencia_activa_desde: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          nombre: string;
          limite_negocios?: number | null;
          plan?: string | null;
          licencia_estado?: string;
          licencia_monto_mensual?: number | null;
          licencia_activa_desde?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          nombre?: string;
          limite_negocios?: number | null;
          plan?: string | null;
          licencia_estado?: string;
          licencia_monto_mensual?: number | null;
          licencia_activa_desde?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: fallará en TODOS los sitios que todavía usan `licencia_estado`/`licencia_plan`/etc. de
`comercios` (guardarComercio.ts, sus tests, las UI de FM, el seed) — eso es lo esperado, los
siguientes tasks los arreglan uno por uno. Confirmar que los ÚNICOS errores son en esos archivos
conocidos, no en algo inesperado.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0011_plan_cuenta.sql lib/supabase/types.ts
git commit -m "Migración 0011: plan/monto/estado de licencia pasan de comercios a cuentas_comercio"
```

---

### Task 2: `lib/comercios/cuentas.ts` — catálogo de planes + límite combinado

**Precondición:** Task 1 aplicada en la BD viva (⚑).

**Files:**
- Modify: `lib/comercios/cuentas.ts` (completo)
- Modify: `lib/comercios/cuentas.test.ts` (extender)

- [ ] **Step 1: Escribir los tests nuevos primero (mutation-testing incluido)**

Agregar a `lib/comercios/cuentas.test.ts`, dentro de `describe('verificarLimiteCuenta', ...)`
(después del test existente de exclusión):

```ts
  it('cuenta sucursales JUNTO con comercios hacia el mismo límite', async () => {
    // MUTATION: si verificarLimiteCuenta deja de sumar sucursales (vuelve a contar solo
    // comercios), este test pasaría con ok:true indebidamente — 1 comercio + 1 sucursal ya
    // llenan un límite de 2, así que debe bloquear.
    const cuentaId = await crearCuentaFixture(2);
    const comercioId = await crearComercioFixture(cuentaId);
    const { error } = await supabase.from('sucursales').insert({ comercio_id: comercioId, nombre: 'Sucursal Test' });
    if (error) throw error;

    const res = await verificarLimiteCuenta(supabase, cuentaId);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('2');
  });

  it('permite cuando el combinado de comercios + sucursales no llega al límite', async () => {
    const cuentaId = await crearCuentaFixture(3);
    const comercioId = await crearComercioFixture(cuentaId);
    const { error } = await supabase.from('sucursales').insert({ comercio_id: comercioId, nombre: 'Sucursal Test' });
    if (error) throw error;

    // 1 comercio + 1 sucursal = 2 < 3.
    const res = await verificarLimiteCuenta(supabase, cuentaId);
    expect(res.ok).toBe(true);
  });

  it('una cuenta sin límite (null, plan Pro) siempre permite, sin importar cuántos comercios/sucursales tenga', async () => {
    // MUTATION: si se quita el corte temprano por limite_negocios===null, `total >= null` coacciona
    // null a 0 en JS y SIEMPRE bloquearía (hasta el primer comercio) — lo opuesto de "sin límite".
    const { data, error } = await supabase
      .from('cuentas_comercio').insert({ nombre: `Cuenta Sin Límite ${Date.now()}`, limite_negocios: null })
      .select('id').single();
    if (error) throw error;
    cuentasDePrueba.push(data.id);
    const comercioId = await crearComercioFixture(data.id);
    await supabase.from('sucursales').insert({ comercio_id: comercioId, nombre: 'Sucursal Test' });

    const res = await verificarLimiteCuenta(supabase, data.id);
    expect(res.ok).toBe(true);
  });
```

Agregar también, dentro del MISMO `describe('asignarComercioACuenta', ...)` ya existente (después de
sus 2 tests actuales — "NO reasigna cuando..." y "reasigna cuando..."):

```ts
  it('cuenta las sucursales del comercio que se está moviendo, no solo lo que YA hay en destino', async () => {
    // MUTATION: este es el hueco que motivó este fix (caso real "Verde Raíz"). Si
    // asignarComercioACuenta deja de sumar las sucursales PROPIAS del comercio que se mueve al
    // unidadesAAgregar, este test pasa con ok:true indebidamente. Destino: límite 3, ya tiene 2
    // comercios (0 sucursales) = 2 unidades usadas, 1 de cupo libre. El comercio que se mueve trae
    // 1 (él mismo) + 2 sucursales propias = 3 unidades → 2+3=5 > 3, debe rechazar.
    const cuentaDestino = await crearCuentaFixture(3);
    await crearComercioFixture(cuentaDestino);
    await crearComercioFixture(cuentaDestino);

    const cuentaOrigen = await crearCuentaFixture(99);
    const comercioAMover = await crearComercioFixture(cuentaOrigen);
    await supabase.from('sucursales').insert([
      { comercio_id: comercioAMover, nombre: 'Sucursal 1' },
      { comercio_id: comercioAMover, nombre: 'Sucursal 2' },
    ]);

    const res = await asignarComercioACuenta(supabase, comercioAMover, cuentaDestino);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('3');
    // Y NO quedó reasignado: sigue en la cuenta de origen.
    const { data } = await supabase.from('comercios').select('cuenta_id').eq('id', comercioAMover).single();
    expect(data!.cuenta_id).toBe(cuentaOrigen);
  });
```

Reemplazar el `describe('crearCuenta', ...)` y `describe('actualizarCuenta', ...)` completos por
(los datos base ahora incluyen los 4 campos nuevos — `plan` pasa a ser obligatorio):

```ts
const CUENTA_BASE = {
  plan: 'starter',
  licenciaEstado: 'activo',
  licenciaMontoMensual: 29,
  licenciaActivaDesde: '2026-07-25',
};

describe('crearCuenta', () => {
  it('crea una cuenta y devuelve su id', async () => {
    const res = await crearCuenta(supabase, { nombre: 'Grupo Aurora', limiteNegocios: 3, ...CUENTA_BASE });
    expect(res.ok).toBe(true);
    if (res.ok) {
      cuentasDePrueba.push(res.id);
      const { data } = await supabase
        .from('cuentas_comercio')
        .select('nombre, limite_negocios, plan, licencia_estado, licencia_monto_mensual, licencia_activa_desde')
        .eq('id', res.id)
        .single();
      expect(data!.nombre).toBe('Grupo Aurora');
      expect(data!.limite_negocios).toBe(3);
      expect(data!.plan).toBe('starter');
      expect(data!.licencia_estado).toBe('activo');
      expect(data!.licencia_monto_mensual).toBe(29);
      expect(data!.licencia_activa_desde).toBe('2026-07-25');
    }
  });

  it('crea una cuenta sin límite (Pro, limiteNegocios null)', async () => {
    const res = await crearCuenta(supabase, { nombre: 'Grupo Pro', limiteNegocios: null, ...CUENTA_BASE, plan: 'pro' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      cuentasDePrueba.push(res.id);
      const { data } = await supabase.from('cuentas_comercio').select('limite_negocios').eq('id', res.id).single();
      expect(data!.limite_negocios).toBeNull();
    }
  });

  it('rechaza un nombre vacío', async () => {
    const res = await crearCuenta(supabase, { nombre: '   ', limiteNegocios: 1, ...CUENTA_BASE });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/nombre/i);
  });

  it('rechaza un límite menor a 1 (pero permite null)', async () => {
    const res = await crearCuenta(supabase, { nombre: 'Grupo X', limiteNegocios: 0, ...CUENTA_BASE });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/l[íi]mite/i);
  });

  it('rechaza un plan que no está en el catálogo', async () => {
    // MUTATION: quitar este chequeo deja pasar cualquier string a una columna con CHECK en la BD —
    // el insert fallaría con un 23514 genérico en vez de este mensaje claro.
    const res = await crearCuenta(supabase, { nombre: 'Grupo Y', limiteNegocios: 1, ...CUENTA_BASE, plan: 'enterprise' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/plan/i);
  });

  it('rechaza un monto mensual negativo', async () => {
    const res = await crearCuenta(supabase, { nombre: 'Grupo Z', limiteNegocios: 1, ...CUENTA_BASE, licenciaMontoMensual: -10 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/monto/i);
  });

  it('rechaza una fecha inválida', async () => {
    const res = await crearCuenta(supabase, { nombre: 'Grupo W', limiteNegocios: 1, ...CUENTA_BASE, licenciaActivaDesde: '31/07/2026' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/fecha/i);
  });
});

describe('actualizarCuenta', () => {
  it('actualiza el nombre, límite y datos de licencia de una cuenta existente', async () => {
    const cuentaId = await crearCuentaFixture(1);
    const res = await actualizarCuenta(supabase, cuentaId, { nombre: 'Nombre Nuevo', limiteNegocios: 5, ...CUENTA_BASE, plan: 'growth' });
    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('cuentas_comercio')
      .select('nombre, limite_negocios, plan')
      .eq('id', cuentaId)
      .single();
    expect(data!.nombre).toBe('Nombre Nuevo');
    expect(data!.limite_negocios).toBe(5);
    expect(data!.plan).toBe('growth');
  });

  it('falla si la cuenta ya no existe, en vez de reportar éxito', async () => {
    const res = await actualizarCuenta(
      supabase,
      '00000000-0000-0000-0000-000000000000',
      { nombre: 'Fantasma', limiteNegocios: 1, ...CUENTA_BASE },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/no existe/i);
  });
});
```

`crearCuentaFixture` (helper existente, arriba en el archivo) sigue sin tocar — sigue insertando
directo por Supabase, sin pasar por `validar()`, así que no necesita los campos nuevos.

- [ ] **Step 2: Correr los tests nuevos y confirmar que fallan**

Run: `npm test -- --run cuentas.test`
Expected: FAIL — `crearCuenta`/`actualizarCuenta` no aceptan los campos nuevos todavía, y
`verificarLimiteCuenta` no cuenta sucursales.

- [ ] **Step 3: Reescribir `lib/comercios/cuentas.ts` completo**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

// Catálogo de planes de Cardly (fm-ai-website.vercel.app/productos/cardly). Fuente única de verdad
// de nombre/monto/límite sugerido: el <select> de FormularioCuenta se construye desde esta MISMA
// constante para que el formulario y el validador no puedan divergir (mismo patrón que
// TIPOS_TARJETA en guardarComercio.ts). `limiteSugerido: null` en 'pro' = sin tope — ver
// verificarLimiteCuenta más abajo.
export const PLANES = [
  { valor: 'starter', etiqueta: 'Starter', montoMensual: 29, limiteSugerido: 1 },
  { valor: 'growth', etiqueta: 'Growth', montoMensual: 49, limiteSugerido: 2 },
  { valor: 'pro', etiqueta: 'Pro', montoMensual: 89, limiteSugerido: null },
] as const;
export type Plan = (typeof PLANES)[number]['valor'];

// Fuente única de verdad: la BD tiene check (licencia_estado in ('activo','inactivo')) en la
// migración 0011 (antes vivía en comercios, migración 0003 — Fase 6 la movió acá).
export const ESTADOS_LICENCIA = ['activo', 'inactivo'] as const;
export type EstadoLicencia = (typeof ESTADOS_LICENCIA)[number];

export interface DatosCuenta {
  nombre: string;
  // null = sin límite (Pro). La capa app (validarDatosCuenta) es la única defensa del rango — la
  // BD solo garantiza limite_negocios > 0 CUANDO no es null (migración 0011).
  limiteNegocios: number | null;
  plan: string;
  licenciaEstado: string;
  licenciaMontoMensual: number | null;
  licenciaActivaDesde: string | null;
}

export type ResultadoCuenta =
  | { ok: true; id: string }
  | { ok: false; error: string };

// ¿Es una fecha real en formato AAAA-MM-DD? Movida acá desde guardarComercio.ts (Fase 6): licencia_
// activa_desde ahora es de la cuenta, no del comercio. Ver el comentario original en el historial
// de guardarComercio.ts para el detalle de por qué existe el (?!0000) y el round-trip.
function esFechaValida(valor: string): boolean {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}

function validarDatosCuenta(datos: DatosCuenta): string | null {
  if (!datos.nombre) return 'El nombre de la cuenta es obligatorio.';
  if (datos.limiteNegocios !== null && (!Number.isInteger(datos.limiteNegocios) || datos.limiteNegocios < 1)) {
    return 'El límite de negocios/sucursales debe ser un número entero mayor o igual a 1 (o vacío para "sin límite").';
  }
  if (!(PLANES as readonly { valor: string }[]).some((p) => p.valor === datos.plan)) {
    return 'El plan no es válido.';
  }
  if (!(ESTADOS_LICENCIA as readonly string[]).includes(datos.licenciaEstado)) {
    return 'El estado de la licencia debe ser "activo" o "inactivo".';
  }
  const monto = datos.licenciaMontoMensual;
  if (monto !== null && !Number.isFinite(monto)) return 'El monto mensual debe ser un número.';
  if (monto !== null && monto < 0) return 'El monto mensual no puede ser negativo.';
  const fecha = datos.licenciaActivaDesde;
  if (fecha !== null && !esFechaValida(fecha)) {
    return 'La fecha de inicio de la licencia debe ser una fecha real en formato AAAA-MM-DD.';
  }
  return null;
}

// ¿Cabe un negocio/sucursal más en esta cuenta? El límite se APLICA acá, en la capa app —
// la BD solo garantiza el rango del propio límite (o que sea null) con un CHECK, no cuántas filas
// lo respetan.
//
// El límite cubre comercios DISTINTOS y SUCURSALES juntos (decisión revisada 2026-07-25 — antes
// solo contaba comercios; QA manual sobre "Verde Raíz" encontró que las sucursales no tenían
// NINGÚN tope). sucursales no tiene cuenta_id directo (solo comercio_id), así que se cuentan vía
// los ids de comercio de esta cuenta.
//
// `unidadesAAgregar` (default 1): cuántas unidades va a sumar la operación que está preguntando.
// Un alta nueva (comercio o sucursal) siempre agrega 1. PERO mover un comercio EXISTENTE a esta
// cuenta (asignarComercioACuenta) no solo agrega el comercio: también arrastra sus propias
// sucursales, que hasta el momento del move NO están bajo cuenta_id=cuentaId (así que
// excluyendoComercioId no las excluye — nunca se contaron, ni tampoco llegan a sumarse solas). Sin
// este parámetro, mover un comercio con sucursales a una cuenta casi llena la deja MUY por encima
// de su límite sin ningún bloqueo — el mismo tipo de hueco que este fix existe para cerrar.
export async function verificarLimiteCuenta(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
  opciones?: { excluyendoComercioId?: string; unidadesAAgregar?: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: cuenta, error: eCuenta } = await supabase
    .from('cuentas_comercio').select('limite_negocios').eq('id', cuentaId).maybeSingle();
  if (eCuenta) { console.error('[fm] no se pudo leer la cuenta:', eCuenta); return { ok: false, error: 'No se pudo verificar el límite de la cuenta.' }; }
  if (!cuenta) return { ok: false, error: 'La cuenta no existe.' };

  // null = plan sin tope (Pro): nada que contar, se aprueba directo.
  if (cuenta.limite_negocios === null) return { ok: true };

  // count Y data en la misma llamada: count trae el total de comercios de la cuenta, data trae sus
  // ids (para contar sucursales vía el .in() de abajo) — un solo round-trip para las dos cosas.
  let qComercios = supabase.from('comercios').select('id', { count: 'exact' }).eq('cuenta_id', cuentaId);
  if (opciones?.excluyendoComercioId) qComercios = qComercios.neq('id', opciones.excluyendoComercioId);
  const { data: comerciosDeCuenta, count: countComercios, error: eComercios } = await qComercios;
  if (eComercios) { console.error('[fm] no se pudo contar comercios de la cuenta:', eComercios); return { ok: false, error: 'No se pudo verificar el límite de la cuenta.' }; }

  let countSucursales = 0;
  const ids = (comerciosDeCuenta ?? []).map((c) => c.id);
  if (ids.length > 0) {
    const { count, error: eSucursales } = await supabase
      .from('sucursales').select('id', { count: 'exact', head: true }).in('comercio_id', ids);
    if (eSucursales) { console.error('[fm] no se pudo contar sucursales de la cuenta:', eSucursales); return { ok: false, error: 'No se pudo verificar el límite de la cuenta.' }; }
    countSucursales = count ?? 0;
  }

  const total = (countComercios ?? 0) + countSucursales;
  const unidades = opciones?.unidadesAAgregar ?? 1;
  if (total + unidades > cuenta.limite_negocios) {
    return { ok: false, error: `Esta cuenta ya alcanzó su límite de ${cuenta.limite_negocios} negocio(s)/sucursal(es).` };
  }
  return { ok: true };
}

export async function crearCuenta(
  supabase: SupabaseClient<Database>,
  datos: DatosCuenta,
): Promise<ResultadoCuenta> {
  const nombre = datos.nombre.trim();
  const limpios: DatosCuenta = { ...datos, nombre };
  const problema = validarDatosCuenta(limpios);
  if (problema) return { ok: false, error: problema };

  const { data, error } = await supabase
    .from('cuentas_comercio')
    .insert({
      nombre: limpios.nombre,
      limite_negocios: limpios.limiteNegocios,
      plan: limpios.plan,
      licencia_estado: limpios.licenciaEstado,
      licencia_monto_mensual: limpios.licenciaMontoMensual,
      licencia_activa_desde: limpios.licenciaActivaDesde,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[fm] falló el insert de cuenta:', error);
    return { ok: false, error: 'No se pudo crear la cuenta.' };
  }
  return { ok: true, id: data.id };
}

export async function actualizarCuenta(
  supabase: SupabaseClient<Database>,
  id: string,
  datos: DatosCuenta,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const nombre = datos.nombre.trim();
  const limpios: DatosCuenta = { ...datos, nombre };
  const problema = validarDatosCuenta(limpios);
  if (problema) return { ok: false, error: problema };

  const { error } = await supabase
    .from('cuentas_comercio')
    .update({
      nombre: limpios.nombre,
      limite_negocios: limpios.limiteNegocios,
      plan: limpios.plan,
      licencia_estado: limpios.licenciaEstado,
      licencia_monto_mensual: limpios.licenciaMontoMensual,
      licencia_activa_desde: limpios.licenciaActivaDesde,
    })
    .eq('id', id)
    .select('id')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return { ok: false, error: 'Esa cuenta ya no existe.' };
    }
    console.error('[fm] falló el update de cuenta:', error);
    return { ok: false, error: 'No se pudo actualizar la cuenta.' };
  }
  return { ok: true };
}

// Reasigna un comercio a otra cuenta, respetando el límite combinado de la cuenta DESTINO. El
// comercio movido trae SUS PROPIAS sucursales con él — hay que contarlas y pasarlas como
// unidadesAAgregar (1 por el comercio + N por sus sucursales), porque en el momento de este
// chequeo esas sucursales todavía cuelgan del comercio con su cuenta_id VIEJO: el conteo interno
// de verificarLimiteCuenta (que solo mira comercios YA en cuentaId) nunca las ve.
export async function asignarComercioACuenta(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  cuentaId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { count: sucursalesPropias, error: eSucursales } = await supabase
    .from('sucursales').select('id', { count: 'exact', head: true }).eq('comercio_id', comercioId);
  if (eSucursales) {
    console.error('[fm] no se pudo contar las sucursales del comercio a reasignar:', eSucursales);
    return { ok: false, error: 'No se pudo reasignar el comercio a la cuenta.' };
  }

  const limite = await verificarLimiteCuenta(supabase, cuentaId, {
    excluyendoComercioId: comercioId,
    unidadesAAgregar: 1 + (sucursalesPropias ?? 0),
  });
  if (!limite.ok) return limite;

  const { error } = await supabase
    .from('comercios')
    .update({ cuenta_id: cuentaId })
    .eq('id', comercioId)
    .select('id')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return { ok: false, error: 'Ese comercio ya no existe.' };
    }
    console.error('[fm] falló la reasignación de comercio a cuenta:', error);
    return { ok: false, error: 'No se pudo reasignar el comercio a la cuenta.' };
  }
  return { ok: true };
}

export async function eliminarCuenta(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from('cuentas_comercio').delete().eq('id', id);

  if (error) {
    if (error.code === '23503') {
      return {
        ok: false,
        error: 'No se puede eliminar: la cuenta todavía tiene negocios asignados. Reasigná o eliminá esos negocios primero.',
      };
    }
    console.error('[fm] falló el borrado de cuenta:', error);
    return { ok: false, error: 'No se pudo eliminar la cuenta.' };
  }

  return { ok: true };
}
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npm test -- --run cuentas.test`
Expected: PASS (todos, incluyendo los 3 nuevos de límite combinado).

- [ ] **Step 5: Mutation-testing manual (obligatorio — rama crítica)**

Para CADA mutación listada en los comentarios `// MUTATION:` de arriba: aplicarla a mano en
`cuentas.ts`, correr `npm test -- --run cuentas.test`, confirmar que el test específico FALLA con
el mensaje esperado (no otro), restaurar con el contenido original. Documentar en el mensaje de
commit cuáles se verificaron.

- [ ] **Step 6: Commit**

```bash
git add lib/comercios/cuentas.ts lib/comercios/cuentas.test.ts
git commit -m "Cuentas: catálogo de 3 planes + límite combinado comercios+sucursales"
```

---

### Task 3: `lib/comercios/guardarComercio.ts` — quitar licencia (se mudó a cuentas)

**Precondición:** Task 1 aplicada en la BD viva (⚑).

**Files:**
- Modify: `lib/comercios/guardarComercio.ts`
- Modify: `lib/comercios/guardarComercio.test.ts`

- [ ] **Step 1: Actualizar `guardarComercio.test.ts` primero**

En `datosValidos()`, quitar las 4 líneas de licencia:
```ts
    licencia_estado: 'activo',
    licencia_plan: 'Básico',
    licencia_monto_mensual: 25,
    licencia_activa_desde: '2026-07-16',
```
(el objeto queda con `nombre`, `slug`, los 3 colores, `logo_url`/`strip_url`/`hero_url`,
`tipo_tarjeta`, `cuenta_id`).

Borrar por completo estos 5 tests (su comportamiento se porta a `cuentas.test.ts` en la Task 2,
paso 1 — ya están ahí como parte del catálogo de planes/monto/fecha):
- `'crea un comercio con licencia y branding'` (líneas 78-97) — reemplazar por una versión que NO
  verifique licencia:
  ```ts
  it('crea un comercio con branding', async () => {
    const slug = `test-crear-${Date.now()}`;
    const res = await crearComercio(supabase, await datosValidos(slug));

    expect(res.ok).toBe(true);
    const { data } = await supabase.from('comercios').select('nombre').eq('slug', slug).single();
    expect(data!.nombre).toBe('Comercio Test');
  });
  ```
- `'rechaza un monto mensual negativo'` (líneas 116-125) — BORRAR (el monto ya no es de comercio).
- `'rechaza un estado de licencia que la BD no acepta'` (líneas 127-138) — BORRAR.
- `'rechaza fechas inválidas o con el formato equivocado'` (líneas 203-216) — BORRAR.
- `'normaliza espacios y guarda los opcionales vacíos como null'` (líneas 218-243) — quitar
  `licencia_estado: '  activo  ',` del objeto de entrada, quitar `licencia_estado` del `.select()` y
  el `expect(data!.licencia_estado).toBe('activo');` (con su comentario, que ya no aplica).
- `'rechaza un monto que no es un número'` (líneas 193-201) — BORRAR.
- `'actualiza licencia y branding de un comercio existente'` (líneas 266-286) — renombrar a
  `'actualiza el nombre y branding de un comercio existente'`, quitar
  `licencia_estado: 'inactivo',` del objeto y el assert correspondiente.

- [ ] **Step 2: Correr los tests y confirmar que fallan por el motivo correcto**

Run: `npm test -- --run guardarComercio.test`
Expected: FAIL — `DatosComercio` (el tipo que usa `datosValidos()`) todavía exige los 4 campos de
licencia que se acaban de quitar del objeto; error de tipos/runtime hasta el Step 3.

- [ ] **Step 3: Editar `guardarComercio.ts`**

Quitar el export de `ESTADOS_LICENCIA`/`EstadoLicencia` (líneas 6-10 — se mudó a `cuentas.ts`, Task
2). Quitar las 4 líneas de `DatosComercio` (`licencia_estado`, `licencia_plan`,
`licencia_monto_mensual`, `licencia_activa_desde`). En `normalizar()`, quitar las líneas
`licencia_estado: datos.licencia_estado.trim(),` y `licencia_activa_desde:
limpiarOpcional(datos.licencia_activa_desde),`. En `validar()`, quitar el bloque del chequeo de
`licencia_estado` (con su comentario), el bloque de `monto`/`licencia_monto_mensual`, y el bloque de
`fecha`/`licencia_activa_desde`. Quitar la función `esFechaValida()` completa (se mudó a
`cuentas.ts`, Task 2 — ya no tiene ningún consumidor acá).

`crearComercio`/`eliminarComercio` no cambian de cuerpo. **`actualizarComercio` SÍ cambia** su
llamada a `verificarLimiteCuenta` (mismo motivo que `asignarComercioACuenta` en `cuentas.ts`, Task
2 Step 3: el comercio que cambia de cuenta arrastra sus propias sucursales, que el conteo interno
de `verificarLimiteCuenta` no ve todavía en ese momento). Reemplazar el bloque:

```ts
  if (actual && actual.cuenta_id !== limpios.cuenta_id) {
    const limite = await verificarLimiteCuenta(supabase, limpios.cuenta_id, { excluyendoComercioId: id });
    if (!limite.ok) return { ok: false, error: limite.error };
  }
```

por:

```ts
  if (actual && actual.cuenta_id !== limpios.cuenta_id) {
    // El comercio que cambia de cuenta trae sus propias sucursales — igual que
    // asignarComercioACuenta en cuentas.ts, hay que contarlas y pasarlas como unidadesAAgregar.
    const { count: sucursalesPropias, error: eSucursales } = await supabase
      .from('sucursales').select('id', { count: 'exact', head: true }).eq('comercio_id', id);
    if (eSucursales) {
      console.error('[fm] no se pudo contar las sucursales del comercio a reasignar:', eSucursales);
      return { ok: false, error: 'No se pudo actualizar el comercio.' };
    }
    const limite = await verificarLimiteCuenta(supabase, limpios.cuenta_id, {
      excluyendoComercioId: id,
      unidadesAAgregar: 1 + (sucursalesPropias ?? 0),
    });
    if (!limite.ok) return { ok: false, error: limite.error };
  }
```

El archivo resultante conserva: `TIPOS_TARJETA`/`TipoTarjeta`, `DatosComercio` (sin los 4 campos de
licencia), `normalizar()` (sin las 2 líneas de licencia), `validar()` (sin los 3 bloques de
licencia — conserva `cuenta_id`, `nombre`, `slug`, `tipo_tarjeta`, los 3 colores).

Agregar a `guardarComercio.test.ts` (mismo archivo de este task, describe `actualizarComercio`):

```ts
  it('al cambiar de cuenta, cuenta las sucursales propias contra el límite de la cuenta destino', async () => {
    // Mismo caso que el test análogo de asignarComercioACuenta en cuentas.test.ts (Task 2), pero
    // por el camino de "editar comercio y cambiarle la cuenta" en vez del botón "Vincular".
    const cuentaDestino = (await (await import('../comercios/cuentas')).crearCuenta(supabase, {
      nombre: `Destino ${Date.now()}`, limiteNegocios: 1, plan: 'starter',
      licenciaEstado: 'activo', licenciaMontoMensual: null, licenciaActivaDesde: null,
    }));
    if (!cuentaDestino.ok) throw new Error('setup falló');
    cuentasDePrueba.push(cuentaDestino.id);

    const slug = `test-mover-cuenta-${Date.now()}`;
    const datos = await datosValidos(slug);
    const creado = await crearComercio(supabase, datos);
    if (!creado.ok) throw new Error('el setup falló');
    await supabase.from('sucursales').insert({ comercio_id: creado.id, nombre: 'Sucursal Propia' });

    // Destino ya tiene límite 1 y 0 comercios — cabría el comercio SOLO, pero trae 1 sucursal
    // consigo: 1 (comercio) + 1 (sucursal) = 2 > 1, debe rechazar.
    const res = await actualizarComercio(supabase, creado.id, { ...datos, cuenta_id: cuentaDestino.id });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/límite/i);
  });
```

(Import inline de `crearCuenta` para no reordenar los imports del archivo — si el linter se queja,
mover el import a la cabecera junto a los demás.)

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npm test -- --run guardarComercio.test`
Expected: PASS.

- [ ] **Step 5: Mutation-testing manual del fix de `actualizarComercio` (obligatorio — rama crítica)**

Quitar temporalmente el `unidadesAAgregar: 1 + (sucursalesPropias ?? 0)` (volver a la llamada vieja,
sin ese campo — equivale a `unidadesAAgregar` por defecto = 1, ignorando las sucursales propias),
correr `npm test -- --run guardarComercio.test`, confirmar que **"al cambiar de cuenta, cuenta las
sucursales propias..."** falla (esperaba `ok:false`, recibe `ok:true`), restaurar.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: los errores de `guardarComercio.ts`/`.test.ts` desaparecen. Quedan los de las UI de FM y
el seed (Tasks 5, 6, 7).

- [ ] **Step 7: Commit**

```bash
git add lib/comercios/guardarComercio.ts lib/comercios/guardarComercio.test.ts
git commit -m "guardarComercio: quitar licencia_estado/plan/monto/fecha (se mudaron a cuentas)"
```

---

### Task 4: `lib/comercio/sucursales.ts` — el límite combinado también aplica al crear sucursal

**Precondición:** Task 2 completa (necesita `verificarLimiteCuenta` ya extendida).

**Files:**
- Modify: `lib/comercio/sucursales.ts`
- Modify: `lib/comercio/sucursales.test.ts`

**⚠️ Este archivo YA EXISTE con 11 tests reales** (5 `describe`: `crearSucursal`,
`renombrarSucursal`, `cambiarEstadoSucursal` — incluye el guard de soft-delete contra las FKs de
`transacciones_puntos`/`canjes` —, `listarSucursales`, `sucursalPerteneceAComercio` — incluye el
control de seguridad del picker del dueño, con su propio comentario `MUTATION-TESTING`). **Este
task EXTIENDE el archivo, no lo reemplaza.** Solo cubre el comportamiento NUEVO (el límite en
`crearSucursal`); no agrega cobertura retroactiva para las funciones ya cubiertas.

- [ ] **Step 1: Extender el test file existente (falla primero)**

El archivo actual empieza así (NO tocar, queda igual):

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import {
  crearSucursal,
  renombrarSucursal,
  cambiarEstadoSucursal,
  listarSucursales,
  sucursalPerteneceAComercio,
} from './sucursales';

const supabase = createServiceClient();
const comerciosDePrueba: string[] = [];
```

Inmediatamente después de esa línea (`const comerciosDePrueba: string[] = [];`), agregar una línea
nueva:

```ts
const cuentasDePrueba: string[] = [];
```

El `afterEach` existente queda:
```ts
afterEach(async () => {
  if (!comerciosDePrueba.length) return;
  // sucursales apunta a comercios sin cascade: borrar sucursales antes que su comercio (orden FK).
  await supabase.from('sucursales').delete().in('comercio_id', comerciosDePrueba);
  const { error } = await supabase.from('comercios').delete().in('id', comerciosDePrueba);
  if (error) console.error('[test] no se pudieron borrar los comercios de prueba:', error);
  comerciosDePrueba.length = 0;
});
```
Reemplazarlo por (agrega el borrado de cuentas DESPUÉS de comercios — orden FK):
```ts
afterEach(async () => {
  if (comerciosDePrueba.length) {
    // sucursales apunta a comercios sin cascade: borrar sucursales antes que su comercio.
    await supabase.from('sucursales').delete().in('comercio_id', comerciosDePrueba);
    const { error } = await supabase.from('comercios').delete().in('id', comerciosDePrueba);
    if (error) console.error('[test] no se pudieron borrar los comercios de prueba:', error);
    comerciosDePrueba.length = 0;
  }
  if (cuentasDePrueba.length) {
    const { error } = await supabase.from('cuentas_comercio').delete().in('id', cuentasDePrueba);
    if (error) console.error('[test] no se pudieron borrar las cuentas de prueba:', error);
    cuentasDePrueba.length = 0;
  }
});
```

Justo después del helper existente `crearComercio()` (el que inserta SIN `cuenta_id` — no tocar),
agregar dos helpers nuevos con nombres DISTINTOS para no chocar con él:

```ts
async function crearCuentaFixture(limite: number | null): Promise<string> {
  const { data, error } = await supabase
    .from('cuentas_comercio')
    .insert({ nombre: `Cuenta Test ${Date.now()}-${Math.random().toString(36).slice(2)}`, limite_negocios: limite })
    .select('id').single();
  if (error) throw error;
  cuentasDePrueba.push(data.id);
  return data.id;
}

async function crearComercioConCuenta(cuentaId: string | null): Promise<string> {
  const slug = `test-suc-cuenta-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase
    .from('comercios').insert({ nombre: 'Suc Cuenta', slug, cuenta_id: cuentaId }).select('id').single();
  if (error) throw error;
  comerciosDePrueba.push(data.id); // mismo array/afterEach que crearComercio(): comparten teardown.
  return data.id;
}
```

El resto del archivo (los 5 `describe` existentes: `crearSucursal`, `renombrarSucursal`,
`cambiarEstadoSucursal`, `listarSucursales`, `sucursalPerteneceAComercio`) **queda exactamente
igual, sin tocar una sola línea**. Al FINAL del archivo (después del último `});` que cierra
`describe('sucursalPerteneceAComercio', ...)`), agregar un `describe` nuevo:

```ts

describe('crearSucursal — límite combinado de la cuenta', () => {
  it('rechaza cuando la cuenta del comercio ya alcanzó su límite combinado', async () => {
    // MUTATION: quitar la llamada a verificarLimiteCuenta en crearSucursal deja pasar esto con
    // ok:true indebidamente — el comercio YA consume el único cupo (límite 1).
    const cuentaId = await crearCuentaFixture(1);
    const comercioId = await crearComercioConCuenta(cuentaId);

    const res = await crearSucursal(supabase, comercioId, { nombre: 'Sucursal Nueva' });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/límite/i);
  });

  it('permite crear cuando la cuenta tiene cupo, y la sucursal queda registrada', async () => {
    const cuentaId = await crearCuentaFixture(3);
    const comercioId = await crearComercioConCuenta(cuentaId);

    const res = await crearSucursal(supabase, comercioId, { nombre: 'Sucursal Nueva' });

    expect(res.ok).toBe(true);
    if (res.ok) {
      // Limpieza vía afterEach existente: borra sucursales por comercio_id, no hace falta trackear.
      const { data } = await supabase.from('sucursales').select('nombre').eq('id', res.id).single();
      expect(data!.nombre).toBe('Sucursal Nueva');
    }
  });

  it('permite crear sin límite cuando la cuenta tiene limite_negocios null (plan Pro)', async () => {
    const cuentaId = await crearCuentaFixture(null);
    const comercioId = await crearComercioConCuenta(cuentaId);

    const res = await crearSucursal(supabase, comercioId, { nombre: 'Sucursal Sin Tope' });

    expect(res.ok).toBe(true);
  });

  it('degrada con gracia cuando el comercio no tiene cuenta_id (sin límite que verificar)', async () => {
    const comercioId = await crearComercioConCuenta(null);

    const res = await crearSucursal(supabase, comercioId, { nombre: 'Sucursal Sin Cuenta' });

    expect(res.ok).toBe(true);
  });
});
```

(La regla preexistente "rechaza un nombre vacío" YA está cubierta por el `describe('crearSucursal',
...)` original — no se duplica acá.)

- [ ] **Step 2: Correr y confirmar que fallan las 3 que dependen del límite**

Run: `npm test -- --run sucursales.test`
Expected: los 11 tests preexistentes siguen en PASS (no se tocaron). De los 4 nuevos: FAIL en
"rechaza cuando la cuenta... alcanzó su límite" y en "permite... con cupo"/"sin tope" (pueden pasar
por accidente si no hay chequeo — revisar que el fallo, cuando lo hay, sea por la razón correcta).

- [ ] **Step 3: Editar `lib/comercio/sucursales.ts`**

Agregar el import y modificar `crearSucursal`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { verificarLimiteCuenta } from '../comercios/cuentas';

// ... (DatosSucursal, SucursalListada, ResultadoSucursal, ResultadoAccion sin cambios) ...

export async function crearSucursal(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  datos: DatosSucursal,
): Promise<ResultadoSucursal> {
  const nombre = datos.nombre.trim();
  if (!nombre) return { ok: false, error: 'El nombre de la sucursal es obligatorio.' };

  // El límite del plan cubre comercios Y sucursales juntos (migración 0011): antes de crear, hay
  // que saber a qué cuenta pertenece este comercio y verificar su cupo ahí. Un comercio sin
  // cuenta_id (legado/fixture de test) no tiene límite que verificar — degrada con gracia, mismo
  // criterio que el resto del proyecto para cuenta_id nulo (spec Fase 6 §4.1).
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

  const { data, error } = await supabase
    .from('sucursales')
    .insert({ comercio_id: comercioId, nombre })
    .select('id')
    .single();

  if (error) {
    console.error('[comercio] falló el insert de sucursal:', error);
    return { ok: false, error: 'No se pudo crear la sucursal.' };
  }
  return { ok: true, id: data.id };
}
```

(El resto del archivo — `renombrarSucursal`, `cambiarEstadoSucursal`, `listarSucursales`,
`sucursalPerteneceAComercio` — no cambia.)

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npm test -- --run sucursales.test`
Expected: PASS — los 11 preexistentes + los 4 nuevos (15 en total).

- [ ] **Step 5: Mutation-testing manual (obligatorio — rama crítica)**

Quitar temporalmente el bloque `if (comercio?.cuenta_id) { ... }` (o comentar la llamada a
`verificarLimiteCuenta`), correr `npm test -- --run sucursales.test`, confirmar que
**"rechaza cuando la cuenta del comercio ya alcanzó su límite combinado"** falla (esperaba
`ok:false`, recibe `ok:true`), restaurar.

- [ ] **Step 6: Commit**

```bash
git add lib/comercio/sucursales.ts lib/comercio/sucursales.test.ts
git commit -m "Sucursales: aplicar el límite combinado de la cuenta al crear"
```

---

### Task 5: FM admin — panel de Comercios (quitar sección de licencia)

**Precondición:** Task 3 completa.

**Files:**
- Modify: `app/admin/(protegido)/comercios/FormularioComercio.tsx`
- Modify: `app/admin/(protegido)/comercios/actions.ts`
- Modify: `app/admin/(protegido)/comercios/page.tsx`

- [ ] **Step 1: `FormularioComercio.tsx` — quitar los 4 campos de licencia**

Quitar el import de `ESTADOS_LICENCIA` (queda `import { TIPOS_TARJETA, type DatosComercio } from
'@/lib/comercios/guardarComercio';`). Quitar del tipo `Valores` las 4 líneas `licencia_estado`,
`licencia_plan`, `licencia_monto_mensual`, `licencia_activa_desde`. Quitar esas mismas 4 líneas de
`valoresIniciales()`. Borrar los 4 bloques `<div className="field">` correspondientes (líneas
199-247 del archivo actual: "Estado de licencia", "Plan (opcional)", "Monto mensual (opcional)",
"Activa desde (opcional)") — el formulario pasa de terminar en el `<select>` de `tipo_tarjeta`
directo al botón de submit.

- [ ] **Step 2: `actions.ts` — quitar el parseo de los 4 campos**

En `leerDatos()`, quitar la línea `const monto = textoONull(formData.get('licencia_monto_mensual'));`
y las 4 líneas correspondientes del objeto devuelto (`licencia_estado`, `licencia_plan`,
`licencia_monto_mensual`, `licencia_activa_desde`).

- [ ] **Step 3: `page.tsx` — la lista muestra el estado/monto de la CUENTA (join), no del comercio**

Reemplazar el `.select(...)` y el bloque de renderizado del pastilla/monto:

```ts
  const { data: comercios, error } = await supabase
    .from('comercios')
    .select('id, nombre, slug, cuentas_comercio(licencia_estado, licencia_monto_mensual)')
    .order('nombre');
```

Y en el JSX de cada fila (reemplaza el bloque `{c.licencia_monto_mensual != null && (...)}` /
`<span className={...pastilla...}>{c.licencia_estado}</span>`):

```tsx
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {c.cuentas_comercio?.licencia_monto_mensual != null && (
                  <span className="admin-fila-slug dato-mono">${c.cuentas_comercio.licencia_monto_mensual}/mes</span>
                )}
                {c.cuentas_comercio && (
                  <span
                    className={`pastilla ${
                      c.cuentas_comercio.licencia_estado === 'activo' ? 'pastilla-activo' : 'pastilla-inactivo'
                    }`}
                  >
                    {c.cuentas_comercio.licencia_estado}
                  </span>
                )}
              </div>
```

(`cuentas_comercio` embebido resuelve a un objeto único, no array — es many-to-one, mismo patrón
que `comercios(nombre)` en `membresiasDeUsuario.ts`. Un comercio sin `cuenta_id` da
`cuentas_comercio: null`, de ahí el `?.`/`&&`.)

- [ ] **Step 4: Typecheck + verificación visual**

Run: `npx tsc --noEmit`
Expected: limpio para estos 3 archivos.
Verificación visual (navegador, cuenta FM real): abrir `/admin/comercios`, confirmar que la lista
muestra pastilla/monto correctos (heredados de la cuenta) y que el formulario de
crear/editar comercio ya NO tiene los 4 campos de licencia.

- [ ] **Step 5: Commit**

```bash
git add "app/admin/(protegido)/comercios/FormularioComercio.tsx" "app/admin/(protegido)/comercios/actions.ts" "app/admin/(protegido)/comercios/page.tsx"
git commit -m "FM admin/comercios: quitar campos de licencia (ahora en Cuentas)"
```

---

### Task 6: FM admin — panel de Cuentas (plan, monto, estado, límite combinado)

**Precondición:** Task 2 completa.

**Files:**
- Modify: `app/admin/(protegido)/cuentas/FormularioCuenta.tsx`
- Modify: `app/admin/(protegido)/cuentas/actions.ts`
- Modify: `app/admin/(protegido)/cuentas/page.tsx`
- Modify: `app/admin/(protegido)/cuentas/[id]/page.tsx`

- [ ] **Step 1: `FormularioCuenta.tsx` — agregar plan/monto/estado/fecha, con pre-fill al elegir plan**

```tsx
'use client';

import { useState, useActionState } from 'react';
import type { EstadoFormulario } from './actions';
import { PLANES, ESTADOS_LICENCIA } from '@/lib/comercios/cuentas';

export default function FormularioCuenta({
  accion,
  inicial,
  textoBoton,
}: {
  accion: (estado: EstadoFormulario, formData: FormData) => Promise<EstadoFormulario>;
  inicial?: {
    nombre?: string;
    limite_negocios?: number | null;
    plan?: string | null;
    licencia_estado?: string;
    licencia_monto_mensual?: number | null;
    licencia_activa_desde?: string | null;
  };
  textoBoton: string;
}) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoFormulario, FormData>(
    accion,
    undefined,
  );

  // Campos CONTROLADOS por el mismo motivo que FormularioComercio: React 19 resetea los campos no
  // controlados cuando una action del formulario termina, incluso si devolvió un error.
  const [nombre, setNombre] = useState(inicial?.nombre ?? '');
  // Cuenta NUEVA (sin `inicial`): precargar el primer plan, igual que el resto de los defaults.
  // Cuenta EXISTENTE con plan:null (backfill de la migración 0011 — demo/piloto, nunca tuvo un
  // plan real): dejar '' para forzar una elección explícita, en vez de mostrar "Starter" ya
  // seleccionado como si alguien lo hubiera decidido (ver placeholder deshabilitado más abajo).
  const [plan, setPlan] = useState(inicial?.plan ?? (inicial ? '' : PLANES[0].valor));
  const [limite, setLimite] = useState(
    inicial?.limite_negocios !== undefined
      ? (inicial.limite_negocios === null ? '' : String(inicial.limite_negocios))
      : String(PLANES[0].limiteSugerido ?? ''),
  );
  const [monto, setMonto] = useState(
    inicial?.licencia_monto_mensual != null ? String(inicial.licencia_monto_mensual) : String(PLANES[0].montoMensual),
  );
  const [licenciaEstado, setLicenciaEstado] = useState(inicial?.licencia_estado ?? 'activo');
  const [activaDesde, setActivaDesde] = useState(inicial?.licencia_activa_desde ?? '');

  // Elegir un plan PRECARGA monto y límite sugeridos — siguen siendo editables después (tratos
  // negociados), esto es solo una ayuda para no tipear de memoria los 3 valores del catálogo.
  const cambiarPlan = (nuevoPlan: string) => {
    setPlan(nuevoPlan);
    const p = PLANES.find((x) => x.valor === nuevoPlan);
    if (p) {
      setMonto(String(p.montoMensual));
      setLimite(p.limiteSugerido === null ? '' : String(p.limiteSugerido));
    }
  };

  return (
    <form className="panel" action={ejecutar} style={{ marginTop: 0 }}>
      <div className="field">
        <label htmlFor="nombre">Nombre de la cuenta</label>
        <input id="nombre" name="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
      </div>

      <div className="field">
        <label htmlFor="plan">Plan</label>
        <select id="plan" name="plan" value={plan} onChange={(e) => cambiarPlan(e.target.value)}>
          {plan === '' && <option value="" disabled>— Elegí un plan —</option>}
          {PLANES.map((p) => (
            <option key={p.valor} value={p.valor}>
              {p.etiqueta} (${p.montoMensual}/mes, {p.limiteSugerido ?? 'sin límite'})
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="limite_negocios">Límite de negocios + sucursales</label>
        <input
          id="limite_negocios"
          name="limite_negocios"
          type="number"
          min="1"
          step="1"
          placeholder="Vacío = sin límite"
          value={limite}
          onChange={(e) => setLimite(e.target.value)}
        />
        <p className="field-aviso">
          Cuenta comercios distintos Y sucursales juntos. Se precarga según el plan; dejalo vacío
          para "sin límite" o ajustalo para un trato negociado.
        </p>
      </div>

      <div className="field">
        <label htmlFor="licencia_monto_mensual">Monto mensual</label>
        <input
          id="licencia_monto_mensual"
          name="licencia_monto_mensual"
          type="number"
          min="0"
          step="0.01"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="licencia_estado">Estado de licencia</label>
        <select
          id="licencia_estado"
          name="licencia_estado"
          value={licenciaEstado}
          onChange={(e) => setLicenciaEstado(e.target.value)}
        >
          {ESTADOS_LICENCIA.map((e) => (
            <option key={e} value={e}>
              {e.charAt(0).toUpperCase() + e.slice(1)}
            </option>
          ))}
        </select>
        <p className="field-aviso">Pausar afecta TODOS los comercios de esta cuenta a la vez.</p>
      </div>

      <div className="field">
        <label htmlFor="licencia_activa_desde">Activa desde (opcional)</label>
        <input
          id="licencia_activa_desde"
          name="licencia_activa_desde"
          type="date"
          value={activaDesde}
          onChange={(e) => setActivaDesde(e.target.value)}
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

- [ ] **Step 2: `actions.ts` — leer los campos nuevos**

Reemplazar `leerDatos()`:

```ts
import type { DatosCuenta } from '@/lib/comercios/cuentas';

function leerDatos(formData: FormData): DatosCuenta {
  const limiteRaw = String(formData.get('limite_negocios') ?? '').trim();
  const montoRaw = String(formData.get('licencia_monto_mensual') ?? '').trim();
  const fechaRaw = String(formData.get('licencia_activa_desde') ?? '').trim();
  return {
    nombre: String(formData.get('nombre') ?? '').trim(),
    // '' = sin límite (null). Number('3a') es NaN → validarDatosCuenta lo rechaza (no matchea
    // "es null" ni "es entero >= 1", cae en el mensaje de rango).
    limiteNegocios: limiteRaw === '' ? null : Number(limiteRaw),
    plan: String(formData.get('plan') ?? ''),
    licenciaEstado: String(formData.get('licencia_estado') ?? 'activo'),
    licenciaMontoMensual: montoRaw === '' ? null : Number(montoRaw),
    licenciaActivaDesde: fechaRaw === '' ? null : fechaRaw,
  };
}
```

Quitar el tipo `{ nombre: string; limiteNegocios: number }` inline que usaban las funciones (ya
no hace falta, usan `DatosCuenta` importado). El resto de `actions.ts` (las 4 funciones
`accion...`) no cambia — siguen llamando `crearCuenta`/`actualizarCuenta`/`eliminarCuenta`/
`asignarComercioACuenta` con la misma forma.

- [ ] **Step 3: `page.tsx` (lista) — contar comercios + sucursales, manejar límite null**

Reemplazar el bloque de conteo y el render de cada fila:

```ts
  const { data: comercios, error: errorComercios } = await supabase.from('comercios').select('id, cuenta_id');
  if (errorComercios) console.error('[fm] falló el conteo de negocios por cuenta:', errorComercios);
  const cuentaPorComercio = new Map<string, string>();
  const negociosPorCuenta = new Map<string, number>();
  for (const c of comercios ?? []) {
    if (!c.cuenta_id) continue;
    cuentaPorComercio.set(c.id, c.cuenta_id);
    negociosPorCuenta.set(c.cuenta_id, (negociosPorCuenta.get(c.cuenta_id) ?? 0) + 1);
  }
  // El límite cuenta sucursales también (ver verificarLimiteCuenta) — sucursales no tiene
  // cuenta_id directo, se suma vía el mapa de comercio→cuenta de arriba.
  const { data: sucursales, error: errorSucursales } = await supabase.from('sucursales').select('comercio_id');
  if (errorSucursales) console.error('[fm] falló el conteo de sucursales por cuenta:', errorSucursales);
  for (const s of sucursales ?? []) {
    const cuentaId = cuentaPorComercio.get(s.comercio_id);
    if (cuentaId) negociosPorCuenta.set(cuentaId, (negociosPorCuenta.get(cuentaId) ?? 0) + 1);
  }
```

```tsx
          {cuentas.map((c) => {
            const usados = negociosPorCuenta.get(c.id) ?? 0;
            const llena = c.limite_negocios !== null && usados >= c.limite_negocios;
            return (
              <Link key={c.id} className="admin-fila" href={`/admin/cuentas/${c.id}`}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span className="icono-circulo acento" aria-hidden="true">
                    <span className="icono">account_balance</span>
                  </span>
                  <div>
                    <div className="admin-fila-nombre">{c.nombre}</div>
                    <div className="admin-fila-slug">
                      <span className="dato-mono">{usados}</span> de{' '}
                      <span className="dato-mono">{c.limite_negocios ?? '∞'}</span> negocio(s)/sucursal(es)
                    </div>
                  </div>
                </div>
                <span className={`pastilla ${llena ? 'pastilla-inactivo' : 'pastilla-activo'}`}>
                  {llena ? 'Llena' : 'Con cupo'}
                </span>
              </Link>
            );
          })}
```

Y en el `.select()` inicial, agregar `limite_negocios` ya está — no hace falta tocar esa línea
(`'id, nombre, limite_negocios'` ya lo trae).

- [ ] **Step 4: `[id]/page.tsx` — mostrar plan/monto/estado, límite combinado en "hay cupo"**

Ampliar el `.select()` de la cuenta:
```ts
  const { data: cuenta, error } = await supabase
    .from('cuentas_comercio')
    .select('id, nombre, limite_negocios, plan, licencia_estado, licencia_monto_mensual, licencia_activa_desde')
    .eq('id', id)
    .maybeSingle();
```

Reemplazar el cálculo de `hayCupo` (necesita el conteo combinado, no solo `negocios.length`).
**Misma guardia que Task 2 Step 3** (`ids.length > 0` antes del `.in()`): una cuenta recién creada
sin comercios todavía es un caso normal, no un edge case — sin la guardia, `.in('comercio_id', [])`
en cada visita a `/admin/cuentas/[id]` de una cuenta nueva es innecesario en el mejor caso.
```ts
  const idsDeNegocios = negocios.map((n) => n.id);
  let sucursalesDeLaCuenta = 0;
  if (idsDeNegocios.length > 0) {
    const { data } = await supabase.from('sucursales').select('id').in('comercio_id', idsDeNegocios);
    sucursalesDeLaCuenta = data?.length ?? 0;
  }
  const usados = negocios.length + sucursalesDeLaCuenta;
  const hayCupo = cuenta.limite_negocios === null || usados < cuenta.limite_negocios;
```

Pasar los campos nuevos a `FormularioCuenta`:
```tsx
      <FormularioCuenta
        accion={accion}
        inicial={{
          nombre: cuenta.nombre,
          limite_negocios: cuenta.limite_negocios,
          plan: cuenta.plan,
          licencia_estado: cuenta.licencia_estado,
          licencia_monto_mensual: cuenta.licencia_monto_mensual,
          licencia_activa_desde: cuenta.licencia_activa_desde,
        }}
        textoBoton="Guardar cambios"
      />
```

Actualizar los dos textos que muestran `{cuenta.limite_negocios}` directo (línea ~88 "Negocios de
esta cuenta (N de LIMITE)" y línea ~115 "La cuenta alcanzó su límite de LIMITE negocio(s)") para
usar `usados`/`cuenta.limite_negocios ?? '∞'` en vez de `negocios.length`/`cuenta.limite_negocios`
crudo, consistente con el nuevo conteo combinado.

- [ ] **Step 5: Typecheck + verificación visual**

Run: `npx tsc --noEmit`
Expected: limpio.
Verificación visual (navegador, cuenta FM real): abrir `/admin/cuentas`, crear una cuenta eligiendo
"Growth" y confirmar que monto/límite se precargan a 49/2; abrir la cuenta de "Verde Raíz", confirmar
que ahora muestra "3 de 2" (o el número real) y la pastilla "Llena".

- [ ] **Step 6: Commit**

```bash
git add "app/admin/(protegido)/cuentas/FormularioCuenta.tsx" "app/admin/(protegido)/cuentas/actions.ts" "app/admin/(protegido)/cuentas/page.tsx" "app/admin/(protegido)/cuentas/[id]/page.tsx"
git commit -m "FM admin/cuentas: catálogo de planes + límite combinado + campos de licencia"
```

---

### Task 7: Seed de demo

**Precondición:** Tasks 2, 3 completas.

**Files:**
- Modify: `scripts/seed-demo-comercios.ts:176-198`

- [ ] **Step 1: Mover `licencia_estado` a la cuenta, quitar `licencia_plan: 'Demo'`**

```ts
    // 0. Cuenta (cliente que paga) del demo: una por comercio, límite 1. licencia_estado vive acá
    //    desde la migración 0011 (antes era del comercio). plan queda null: 'Demo' no es uno de
    //    los 3 planes reales del catálogo (starter/growth/pro) y forzarlo inventaría un dato falso.
    const { data: cuenta, error: eCuenta } = await supabase
      .from('cuentas_comercio')
      .insert({ nombre: d.nombre, limite_negocios: 1, licencia_estado: 'activo' })
      .select('id')
      .single();
    if (eCuenta) throw eCuenta;

    // 1. Comercio (colores + tipo + cuenta).
    const { data: comercio, error: eC } = await supabase
      .from('comercios')
      .insert({
        nombre: d.nombre, slug: d.slug,
        color_fondo: d.fondo, color_texto: d.texto, color_label: d.label,
        tipo_tarjeta: d.tipo, sello_meta: d.meta,
        cuenta_id: cuenta.id,
      })
      .select('id')
      .single();
    if (eC) throw eC;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: limpio en todo el proyecto — este es el ÚLTIMO archivo con referencias a las columnas
viejas de licencia en `comercios`.

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-demo-comercios.ts
git commit -m "Seed demo: licencia_estado a la cuenta, plan null (no inventar un plan real)"
```

---

### Task 8: Verificación end-to-end

**Precondición:** Tasks 1-7 completas.

- [ ] **Step 1: Typecheck limpio**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 2: Lint limpio**

Run: `npm run lint`
Expected: sin errores ni warnings.

- [ ] **Step 3: Suite completa**

Run: `npm test -- --run`
Expected: todos los archivos en verde (línea base actual: 37 archivos/211 tests, más los nuevos de
esta plan — Tasks 2 y 4 agregan tests).

- [ ] **Step 4: Build de producción**

Run: `npm run build`
Expected: build limpio, todas las rutas compilan (en particular `/admin/comercios`, `/admin/cuentas`,
`/admin/cuentas/[id]`, `/comercio/sucursales`).

- [ ] **Step 5: Verificación manual en navegador (controlador, no subagente)**

Contra datos reales (Verde Raíz):
1. `/admin/cuentas` → abrir Verde Raíz → confirmar que muestra "3 de 2" (o el conteo real
   comercios+sucursales) y no permite vincular otro comercio ni el dueño puede agregar otra
   sucursal desde `/comercio/sucursales` (mensaje de límite visible).
2. Editar la cuenta de Verde Raíz, asignarle plan "Growth" (o el que corresponda), monto y estado
   — confirmar que guarda y que el pastilla en `/admin/comercios` refleja el estado de la cuenta.
3. Crear una cuenta nueva desde cero eligiendo "Pro" → confirmar que el límite queda vacío
   ("sin límite") y que se puede seguir agregando sucursales sin bloqueo.
4. Pausar (licencia_estado: inactivo) una cuenta con 2 comercios → confirmar en la lista de
   `/admin/comercios` que AMBOS comercios de esa cuenta muestran la pastilla "inactivo" (antes solo
   afectaba a uno).

- [ ] **Step 6: Reportar al usuario**

Resumen de lo verificado (tests, build, verificación manual) y pedir autorización para el merge
(mismo patrón "dale" del resto del proyecto).

# Fase 3 — Panel de autogestión del comercio, catálogo de tipos de tarjeta y tarjetas de sellos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Cada tarea pasa por la misma revisión de dos etapas (revisión de spec + revisión de calidad) que encontró 9 bugs reales en el panel de FM — escribe cada paso asumiendo que un revisor va a comprobarlo contra el spec.

**Goal:** Darle al dueño de cada comercio su propio login y panel de autogestión (branding con subida real de imágenes, reglas de puntos, catálogo de recompensas), agregar un catálogo de 8 tipos de tarjeta (solo `puntos` y `sellos` funcionales), y renderizar las tarjetas de sellos como fracción de texto ("7 de 10 sellos") en el pass de Apple.

**Architecture:** Réplica exacta de la arquitectura de auth de FM (`/admin`), con nombres propios para el dueño (`/comercio`): Supabase Auth (email+contraseña) vía `@supabase/ssr`, gate `verifyComercioOwner()` llamado desde el layout, cada página y cada Server Action, y lógica de datos en funciones puras de `lib/comercio/` (testeables contra la BD real). La subida de imágenes va mediada por el servidor (Server Action + `createServiceClient()`), nunca por políticas de RLS de Storage. Un solo modelo de autorización en todo el proyecto: gate a nivel de aplicación, no RLS de sesión.

**Tech Stack:** Next.js 16 (App Router, Proxy, Server Actions), `@supabase/ssr` 0.12.x, Supabase Auth + Postgres + Storage, Vitest (integración contra Supabase real), Playwright (e2e local).

---

## Alcance de este plan

Implementa el spec [2026-07-16-fase3-autogestion-catalogo-design.md](../specs/2026-07-16-fase3-autogestion-catalogo-design.md) completo. Construye **sobre** el panel de FM (Fase 2, ya implementado — ver [2026-07-16-fm-admin-panel.md](2026-07-16-fm-admin-panel.md)).

**Fuera de alcance** (ver §9 del spec, respétalo — la revisión de spec ya corrigió intentos de meter estas cosas):
- **Google Wallet.** Todo sigue siendo Apple-only.
- **Login y PWA de escaneo del cajero** (Fase 4).
- **Canje / redención de cualquier tipo de tarjeta.** NO existe código de canje en ningún lado del proyecto (grep de `canje|puntos_gastados|.rpc(` confirma cero inserts, cero función que reste `puntos_actuales`). Esta fase construye el CONTADOR de sellos y su TEXTO ("7 de 10"); **no** construye qué pasa al llegar a la meta. **Ninguna tarea de este plan puede depender de que el canje exista.**
- **Imágenes de branding renderizadas en el pass firmado** (logo/strip/hero/ícono de sello). Se suben y guardan (§4.4 del spec) y se usan en la vista previa web (§6); wirearlas al `.pkpass` real es trabajo aparte.
- **Vista previa pixel-perfect del pass.** Se hace una maqueta simple de colores (`.cardface` existente), no una reconstrucción del `.pkpass`.
- **Grilla visual de sellos compuesta como imagen.** Sellos se muestra como texto; este proyecto no tiene pipeline de composición de imágenes.
- **El portal del cliente** (`/mi-tarjeta`, rate limiting, PWA) — es un documento separado (`2026-07-16-portal-cliente-design.md`), otra fase. Si algo aquí lo menciona, es solo una nota de una línea (ej.: "el futuro portal leerá `sello_icono_url`").

## Hechos verificados que este plan asume

Confirmados leyendo el código actual del proyecto (no de memoria). **Confía en estos:**

1. **La suite arranca en 61 tests** (13 archivos `*.test.ts` del proyecto, sin contar `node_modules`). Contado con `rg '^\s*(it|test)\(' -c` sobre `**/*.test.ts`. Este plan lleva la suite a **91**. Playwright corre aparte (`npm run e2e`), NO cuenta para `npm test`.
2. **No existe código de canje/redención** en ningún lado. El único código que toca `puntos_actuales` hoy (`app/api/tarjetas/[tarjetaId]/puntos/route.ts`) **solo suma** y rechaza deltas ≤ 0. Ver el punto de "fuera de alcance".
3. **`recompensas.activa` existe desde 0001 pero NINGÚN código la usa.** No hay CRUD de recompensas construido. El único patrón de borrado que existe (`eliminarComercio`) es un **hard delete** (`.delete()`). La CRUD de recompensas de esta fase es la PRIMERA vez que se escribe soft-delete: el borrado DEBE ser `update({activa:false})`, nunca `.delete()`. No copies `eliminarComercio` por analogía.
4. **No hay uso de Supabase Storage en ningún lado** (grep de `storage|createBucket|.upload(` solo pega en `package-lock.json`). Las migraciones existentes son puro DDL de esquema pegado a mano en el SQL Editor de Studio; **no hay precedente de crear buckets vía migración SQL.** Por eso el bucket se crea con un **script manual** (`scripts/seed-storage-bucket.ts`), del mismo estilo que `scripts/seed-usuario-fm.ts` (que el operador corre a mano). Ver Tarea 9.
5. **`usuarios_comercio.auth_user_id` es nullable y NO único** (migración 0001, distinto de `usuarios_fm.auth_user_id` que es `not null unique`). Consecuencias: (a) el seed usa `onConflict: 'email'` (la única columna única aparte del `id`), NO `'auth_user_id'`; (b) `esOwnerDeComercio` usa `.maybeSingle()` con el caveat documentado en spec §5 (si una cuenta llegara a tener 2 filas, `.maybeSingle()` lanza y el dueño queda bloqueado por el manejo de "error de infraestructura" — caso de baja probabilidad porque `email` sí es único).
6. **El FK `usuarios_comercio.comercio_id → comercios(id)` existe (0001, inline)** — Postgres lo nombra `usuarios_comercio_comercio_id_fkey` — pero **NO está en el array `Relationships` de `usuarios_comercio` en `types.ts`** (está en `[]`). Sin esa entrada, el join embebido `comercios(nombre)` da `SelectQueryError` a nivel de tipo (mismo problema documentado en la entrada de `tarjetas`). La Tarea 5 la agrega.
7. **El campo primario del pass hoy es un NÚMERO** (`lib/apple/generatePass.ts`, `pass.primaryFields.push({ key:'puntos', label:'PUNTOS', value: datos.puntos, numberStyle:'PKNumberStyleDecimal' })`). Sellos cambia solo el `value` a un string `"N de M sellos"` (y el `label` a `SELLOS`), sin `numberStyle`, **cuando** `tipo_tarjeta='sellos'` y `sello_meta > 0`. En cualquier otro caso queda idéntico.
8. **`proxy.ts` (raíz) y `lib/supabase/proxy.ts` son el archivo de MÁS RIESGO del plan.** El estado actual está anclado a propósito (`ruta === '/admin/login' || ruta.startsWith('/admin/login/')`) y el redirect está hardcodeado a `/admin/login`. La Tarea 8 exige RE-LEER el archivo actual antes de parchear (no confiar en la cita de este plan) y aplicar el patrón exacto de spec §5.
9. **Las migraciones se aplican A MANO** (pegar en Studio → SQL Editor → Run). Hay UNA sola base para local y producción (no hay entornos separados) — aplicar 0005 en la Tarea 1 la aplica también a producción.
10. **Playwright usa `.spec.ts`; Vitest usa `.test.ts` pero su glob por defecto también atrapa `.spec.ts`.** Para que Vitest no intente correr los tests de Playwright, la Tarea 16 agrega `e2e/**` al `exclude` de `vitest.config.ts`.

## Convención de nombres (no confundir)

- `lib/comercios/` (**plural**) — código de FM que gestiona comercios como catálogo (`guardarComercio`, `validarColorRgb`). Ya existe. **No se renombra.**
- `lib/comercio/` (**singular**) — código NUEVO del panel del dueño, que gestiona SU comercio (`esOwnerDeComercio`, `verifyComercioOwner`, `guardarBranding`, `reglas`, `recompensas`, `imagenComercio`). Se crea en esta fase.

## Prerrequisitos

- El panel de FM (Fase 2) debe estar presente en la rama base (`lib/fm/verifyFmAdmin.ts`, `app/admin/(protegido)/comercios/actions.ts`, etc.). La Tarea 0 lo verifica.
- `.env.local` en la raíz ya tiene `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`. **No se agregan variables nuevas para el panel del dueño.** Playwright (Tarea 16) sí lee credenciales de prueba de env (ver ahí).
- `node_modules` instalado.

## Reglas de ejecución (te han mordido antes)

- **Comentarios e identificadores en español**, igual que todo el código existente.
- **TDD estricto:** escribe el test que falla → córrelo y velo fallar por la razón esperada → implementa → córrelo y velo pasar → gates → commit.
- **Cada commit con `-m` de una sola línea, en inglés, imperativo** (estilo del historial: "Add FM admin login page…"). **NUNCA uses here-strings** (`@'…'@` / `git commit -m @'…'@`) — la corrupción de mensajes por here-string ya rompió commits de este proyecto. Un solo `git commit -m "texto corto"`, sin saltos de línea.
- **Nunca envuelvas `verifyComercioOwner()` en try/catch** — usa `redirect()`, que funciona LANZANDO `NEXT_REDIRECT`; tragarse esa excepción DESACTIVA el gate.
- **Antes de escribir código nuevo de Next**, si dudas de una API, lee la guía relevante en `node_modules/next/dist/docs/` (este Next tiene cambios de ruptura — ver `AGENTS.md`).

---

### Task 0: Rama de trabajo

- [ ] **Step 1: Verificar que la Fase 2 está presente y crear la rama**

La Fase 3 se construye sobre el panel de FM. Antes de ramificar, confirma que ese trabajo está en el árbol:

```bash
ls lib/fm/verifyFmAdmin.ts "app/admin/(protegido)/comercios/actions.ts"
```
Expected: ambos archivos existen. Si NO existen, detente: la Fase 2 debe estar fusionada/presente primero (este plan la asume).

Crea la rama desde el HEAD que contiene la Fase 2 (normalmente `master` si ya se fusionó, o la rama de la Fase 2 si no):

```bash
git checkout -b feature/fase3-autogestion-catalogo
git status
```
Expected: `On branch feature/fase3-autogestion-catalogo`, working tree clean.

---

### Task 1: Migración 0005 — `tipo_tarjeta` + campos de sellos

**Files:**
- Create: `supabase/migrations/0005_tipo_tarjeta_y_sellos.sql`
- Modify: `lib/supabase/types.ts`

- [ ] **Step 1: Escribir la migración**

Create `supabase/migrations/0005_tipo_tarjeta_y_sellos.sql`:

```sql
-- 0005: Catálogo de tipos de tarjeta + campos de tarjetas de sellos.
-- Migraciones anteriores ya aplicadas a la base viva; todo cambio es append-only.

-- El tipo de tarjeta que FM habilita para el comercio (parte de lo que FM "vende", como la
-- licencia — NO algo que el dueño elija libremente). 8 valores del catálogo completo; solo
-- 'puntos' y 'sellos' son funcionales esta fase (los otros 6 aparecen como "Próximamente" en el
-- panel de FM). CHECK en la BD porque es una lista fija y pequeña de 8 strings, no un formato con
-- infinitas variantes válidas (a diferencia del color) — mismo criterio que licencia_estado.
alter table comercios
  add column tipo_tarjeta text not null default 'puntos'
    check (tipo_tarjeta in ('puntos', 'sellos', 'cashback', 'membresia', 'descuento', 'cupon', 'prepago', 'gift_card'));

-- Solo aplican cuando tipo_tarjeta = 'sellos'. Nullable: sin sentido en otros tipos. Los llena
-- el DUEÑO desde su panel de autogestión; FM solo asigna tipo_tarjeta. sello_icono_url se guarda
-- y se usa en la vista previa web (spec §6) y en el futuro portal del cliente — NO en el pass
-- firmado todavía. sello_meta es el denominador del texto "N de M sellos" del pass.
alter table comercios add column sello_icono_url text;
alter table comercios add column sello_meta integer check (sello_meta is null or sello_meta > 0);
```

`default 'puntos'` es intencional: Cafetería Piloto (la única fila real) queda como está, sin migración de datos.

- [ ] **Step 2: Aplicar la migración (manual)**

Dashboard de Supabase → **SQL Editor** → pegar el contenido → **Run**.
Expected: "Success. No rows returned". En Table Editor, `comercios` tiene las 3 columnas nuevas (`tipo_tarjeta` con default `puntos`, `sello_icono_url`, `sello_meta`).

Recuerda: es la MISMA base para local y producción. Con esto, la migración ya está aplicada en ambos.

- [ ] **Step 3: Actualizar el tipo `Database`**

`lib/supabase/types.ts` se mantiene a mano (ver su encabezado). En el bloque de `comercios`:

Agrega a `Row` (después de `licencia_activa_desde`):
```typescript
          tipo_tarjeta: string;
          sello_icono_url: string | null;
          sello_meta: number | null;
```
Agrega a `Insert` (todas opcionales — `tipo_tarjeta` tiene default, las otras son nullable):
```typescript
          tipo_tarjeta?: string;
          sello_icono_url?: string | null;
          sello_meta?: number | null;
```
Agrega a `Update` las mismas tres, opcionales (igual que `Insert`).

Actualiza también el comentario de encabezado del archivo para listar la migración 0005 junto a las anteriores.

- [ ] **Step 4: Gate + commit**

Run: `npm run typecheck` → limpio. Run: `npm run verify-schema` → `OK: comercios` (sin tabla nueva, solo confirma que `comercios` sigue accesible).
```bash
git add -A
git commit -m "Add tipo_tarjeta and sellos columns to comercios"
```

---

### Task 2: `TIPOS_TARJETA` + `tipo_tarjeta` en `guardarComercio` (TDD)

Extiende la capa de datos de FM para que acepte y valide `tipo_tarjeta`. **`guardarComercio` NO toca `sello_meta` ni `sello_icono_url`** — esos son del dueño (Tareas 10-12); si FM los tocara, un update de FM borraría lo que el dueño configuró.

**Files:**
- Modify: `lib/comercios/guardarComercio.ts`
- Modify: `lib/comercios/guardarComercio.test.ts`
- Modify: `app/admin/(protegido)/comercios/actions.ts`

- [ ] **Step 1: Escribir los tests que fallan**

En `lib/comercios/guardarComercio.test.ts`, agrega `tipo_tarjeta: 'puntos'` al objeto que devuelve `datosValidos()` (después de `licencia_activa_desde`). Luego agrega, al final del `describe('crearComercio')`, dos tests, y uno al final del `describe('actualizarComercio')`:

```typescript
  it('guarda el tipo_tarjeta seleccionado', async () => {
    const slug = `test-tipo-${Date.now()}`;
    const res = await crearComercio(supabase, { ...datosValidos(slug), tipo_tarjeta: 'sellos' });

    expect(res.ok).toBe(true);
    const { data } = await supabase.from('comercios').select('tipo_tarjeta').eq('slug', slug).single();
    expect(data!.tipo_tarjeta).toBe('sellos');
  });

  it('rechaza un tipo_tarjeta que la BD no acepta', async () => {
    const slug = `test-tipo-malo-${Date.now()}`;
    const res = await crearComercio(supabase, { ...datosValidos(slug), tipo_tarjeta: 'inexistente' });

    expect(res.ok).toBe(false);
    // Sin la validación, esto igual daría ok:false — pero por un 23514 traducido a "No se pudo
    // crear el comercio", que no le dice al admin qué escribió mal.
    if (!res.ok) expect(res.error).toMatch(/tipo/i);
  });
```
```typescript
  it('actualiza el tipo_tarjeta de un comercio existente', async () => {
    const slug = `test-tipo-editar-${Date.now()}`;
    const creado = await crearComercio(supabase, datosValidos(slug));
    if (!creado.ok) throw new Error('el setup falló');

    const res = await actualizarComercio(supabase, creado.id, { ...datosValidos(slug), tipo_tarjeta: 'sellos' });

    expect(res.ok).toBe(true);
    const { data } = await supabase.from('comercios').select('tipo_tarjeta').eq('id', creado.id).single();
    expect(data!.tipo_tarjeta).toBe('sellos');
  });
```

Run: `npm test -- guardarComercio`
Expected: FAIL — TS de que `tipo_tarjeta` no existe en `DatosComercio`, o los 3 tests nuevos fallan (`inexistente` se inserta sin rechazo / `tipo_tarjeta` no se guarda). Los 16 existentes siguen verdes.

- [ ] **Step 2: Implementar**

En `lib/comercios/guardarComercio.ts`:

Agrega la constante (justo después de `ESTADOS_LICENCIA`):
```typescript
// Fuente única de verdad del catálogo de tipos de tarjeta: la BD tiene
// check (tipo_tarjeta in (...8 valores...)) en la migración 0005. El <select> de FM (Tarea 3) se
// construye desde esta MISMA constante. `disponible: false` = el tipo existe en el catálogo pero
// su lógica de saldo/canje no está construida esta fase (aparece "(Próximamente)" y deshabilitado).
// Solo 'puntos' y 'sellos' son funcionales hoy (spec §4.1, §7).
export const TIPOS_TARJETA = [
  { valor: 'puntos', etiqueta: 'Puntos', descripcion: 'Suma puntos por visita o por monto.', disponible: true },
  { valor: 'sellos', etiqueta: 'Sellos', descripcion: 'Junta sellos hacia una meta (ej. 9 y la 10 gratis).', disponible: true },
  { valor: 'cashback', etiqueta: 'Cashback', descripcion: 'Reembolso hacia compras futuras.', disponible: false },
  { valor: 'membresia', etiqueta: 'Membresías', descripcion: 'Club VIP por niveles.', disponible: false },
  { valor: 'descuento', etiqueta: 'Descuento', descripcion: 'Ventas al por mayor.', disponible: false },
  { valor: 'cupon', etiqueta: 'Cupón', descripcion: 'Uso único; se convierte en otro tipo tras canjear.', disponible: false },
  { valor: 'prepago', etiqueta: 'Prepago', descripcion: 'Tarjetas de sellos prepagadas.', disponible: false },
  { valor: 'gift_card', etiqueta: 'Gift Card', descripcion: 'Saldo de regalo prepagado.', disponible: false },
] as const;
export type TipoTarjeta = (typeof TIPOS_TARJETA)[number]['valor'];
```

Agrega `tipo_tarjeta` a `DatosComercio` (después de `licencia_activa_desde`):
```typescript
  tipo_tarjeta: string;
```

En `normalizar()`, agrega el trim de `tipo_tarjeta` (en el objeto devuelto):
```typescript
    tipo_tarjeta: datos.tipo_tarjeta.trim(),
```

En `validar()`, agrega (después del bloque de `licencia_estado`):
```typescript
  if (!TIPOS_TARJETA.some((t) => t.valor === datos.tipo_tarjeta)) {
    // Mismo motivo que licencia_estado: sin esto, un valor inválido cae en un 23514 de la BD que
    // el manejo de errores (solo distingue 23505) convierte en un genérico "No se pudo crear el
    // comercio". Se valida contra los 8 valores válidos de la BD (no solo los `disponible`): el
    // <select> ya deshabilita los no disponibles, y el pass renderiza cualquier tipo != 'sellos'
    // como número de forma segura, así que un tipo no disponible guardado no rompe nada.
    return 'El tipo de tarjeta no es válido.';
  }
```

`crearComercio`/`actualizarComercio` no cambian: ya hacen `.insert(limpios)` / `.update(limpios)` sobre todo `DatosComercio`, así que `tipo_tarjeta` entra solo. **No agregues `sello_meta` ni `sello_icono_url` a `DatosComercio`** (son del dueño).

Run: `npm test -- guardarComercio`
Expected: 19 passed.

- [ ] **Step 3: Actualizar `leerDatos()` — OBLIGATORIO en esta tarea, no en la 3**

`tipo_tarjeta` acaba de volverse un campo **requerido** de `DatosComercio`. `leerDatos()` en `app/admin/(protegido)/comercios/actions.ts` es el único constructor de producción de `DatosComercio` que NO usa `Partial` — si esta tarea termina sin tocarlo, `npm run typecheck` falla con TS2741 ("Property 'tipo_tarjeta' is missing") al cerrar el Step 4, porque `npm test` (Vitest/esbuild) no chequea tipos y no lo habría avisado. Corrige esto YA, no lo dejes para la Tarea 3.

En `app/admin/(protegido)/comercios/actions.ts`, dentro de `leerDatos()`, agrega (después de `licencia_activa_desde`):
```typescript
    tipo_tarjeta: String(formData.get('tipo_tarjeta') ?? 'puntos'),
```

- [ ] **Step 4: Gates + commit**

Run: `npm test` → **64 passed** (61 + 3). Run `npm run typecheck`, `npm run lint`.
Confirma 0 comercios `test-%` huérfanos en la BD.
```bash
git add -A
git commit -m "Add tipo_tarjeta catalog constant and validation"
```

---

### Task 3: Selector de `tipo_tarjeta` en el panel de FM

Extiende el formulario existente de FM. Sin tests nuevos (es cableado de UI; la validación ya está cubierta en la Tarea 2, y la verificación visual va aparte).

**Files:**
- Modify: `app/admin/(protegido)/comercios/FormularioComercio.tsx`

`leerDatos()` (en `actions.ts`) ya lee `tipo_tarjeta` — eso se movió a la Tarea 2 Step 3, porque `DatosComercio` lo vuelve requerido ahí y esperar a esta tarea rompía el `typecheck` de la 2. Nada que hacer aquí sobre `actions.ts`.

- [ ] **Step 1: Agregar el `<select>` al formulario**

En `app/admin/(protegido)/comercios/FormularioComercio.tsx`:

Amplía el import:
```typescript
import { ESTADOS_LICENCIA, TIPOS_TARJETA, type DatosComercio } from '@/lib/comercios/guardarComercio';
```

Agrega `tipo_tarjeta` al tipo `Valores` (después de `licencia_activa_desde: string;`):
```typescript
  tipo_tarjeta: string;
```

En `valoresIniciales()`, agrega (después de `licencia_activa_desde`):
```typescript
    tipo_tarjeta: inicial?.tipo_tarjeta ?? 'puntos',
```

Agrega el campo en el JSX, justo ANTES del `<div className="field">` de `licencia_estado` (el tipo de tarjeta es lo que FM habilita, va con la licencia):
```tsx
      <div className="field">
        <label htmlFor="tipo_tarjeta">Tipo de tarjeta</label>
        {/* Opciones desde TIPOS_TARJETA (misma constante que valida guardarComercio). Los tipos
            no disponibles se muestran deshabilitados con "(Próximamente)" — honestos sobre cuáles
            funcionan hoy, a diferencia de Cardly que muestra los 8 como si todos funcionaran. */}
        <select
          id="tipo_tarjeta"
          name="tipo_tarjeta"
          value={valores.tipo_tarjeta}
          onChange={cambiar('tipo_tarjeta')}
        >
          {TIPOS_TARJETA.map((t) => (
            <option key={t.valor} value={t.valor} disabled={!t.disponible}>
              {t.etiqueta}
              {t.disponible ? '' : ' (Próximamente)'}
            </option>
          ))}
        </select>
      </div>
```

- [ ] **Step 2: Gates + commit**

Run: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` (**64 passed**).
```bash
git add -A
git commit -m "Add tipo_tarjeta select to FM comercio form"
```

---

### Task 4: Sellos como fracción de texto en el pass (TDD)

**Files:**
- Modify: `lib/apple/generatePass.ts`
- Modify: `lib/apple/datosPassDeTarjeta.ts`
- Modify: `lib/apple/generatePass.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

En `lib/apple/generatePass.test.ts`:

Primero, a los DOS objetos existentes que se pasan a `generarPassApple` (los tests actuales), agrega estas dos propiedades (el `DatosPass` va a exigirlas):
```typescript
      tipoTarjeta: 'puntos',
      selloMeta: null,
```

Luego agrega dos tests nuevos dentro del `describe('generarPassApple')`:
```typescript
  it('renderiza sellos como fracción de texto cuando tipo_tarjeta=sellos', async () => {
    const buffer = await generarPassApple({
      serialNumber: 'test-serial-sellos',
      qrToken: 'sel777',
      puntos: 7,
      nombreComercio: 'Cafetería Piloto',
      colorFondo: 'rgb(35, 24, 18)',
      colorTexto: 'rgb(255, 255, 255)',
      colorLabel: 'rgb(255, 255, 255)',
      webServiceURL: 'https://example.com/api/apple',
      authenticationToken: '0123456789abcdef0123456789abcdef',
      tipoTarjeta: 'sellos',
      selloMeta: 10,
    });

    const zip = await JSZip.loadAsync(buffer);
    const passJson = JSON.parse(await zip.file('pass.json')!.async('string'));
    // Valor STRING, no número: "7 de 10 sellos". Sin numberStyle.
    expect(passJson.storeCard.primaryFields[0].value).toBe('7 de 10 sellos');
    expect(passJson.storeCard.primaryFields[0].label).toBe('SELLOS');
  });

  it('vuelve al número si tipo=sellos pero sello_meta es null (fallback seguro)', async () => {
    // FM puede poner tipo='sellos' antes de que el dueño configure la meta. Sin meta no hay
    // denominador, así que se renderiza el número — nunca "7 de  sellos".
    const buffer = await generarPassApple({
      serialNumber: 'test-serial-sellos-sinmeta',
      qrToken: 'sel000',
      puntos: 7,
      nombreComercio: 'Cafetería Piloto',
      colorFondo: 'rgb(35, 24, 18)',
      colorTexto: 'rgb(255, 255, 255)',
      colorLabel: 'rgb(255, 255, 255)',
      webServiceURL: 'https://example.com/api/apple',
      authenticationToken: '0123456789abcdef0123456789abcdef',
      tipoTarjeta: 'sellos',
      selloMeta: null,
    });

    const zip = await JSZip.loadAsync(buffer);
    const passJson = JSON.parse(await zip.file('pass.json')!.async('string'));
    expect(passJson.storeCard.primaryFields[0].value).toBe(7);
  });
```

Run: `npm test -- generatePass`
Expected: FAIL — TS de que `tipoTarjeta`/`selloMeta` no existen en `DatosPass`, o los dos nuevos fallan.

- [ ] **Step 2: Implementar**

En `lib/apple/generatePass.ts`, agrega a la interfaz `DatosPass` (después de `authenticationToken: string;`):
```typescript
  tipoTarjeta: string;
  selloMeta: number | null;
```

Reemplaza el bloque que empuja el campo primario (hoy: `pass.type = 'storeCard'; pass.primaryFields.push({...puntos...}); pass.setBarcodes(...)`) por:
```typescript
  pass.type = 'storeCard';

  // Sellos: el campo primario es TEXTO ("7 de 10 sellos"), no un número. Reutiliza el mismo
  // puntos_actuales como contador; solo cambia cómo se muestra. Sin numberStyle (es string) y
  // sin componentes/dependencias nuevas (spec §4.2, corregido tras revisión: este proyecto no
  // tiene pipeline de composición de imágenes). Fallback al número si no hay meta configurada.
  const esSellos = datos.tipoTarjeta === 'sellos' && datos.selloMeta != null && datos.selloMeta > 0;
  if (esSellos) {
    pass.primaryFields.push({
      key: 'puntos',
      label: 'SELLOS',
      value: `${datos.puntos} de ${datos.selloMeta} sellos`,
    });
  } else {
    pass.primaryFields.push({
      key: 'puntos',
      label: 'PUNTOS',
      value: datos.puntos,
      numberStyle: 'PKNumberStyleDecimal',
    });
  }

  pass.setBarcodes(datos.qrToken);
```

En `lib/apple/datosPassDeTarjeta.ts`, agrega al objeto `datos` que se retorna (la consulta ya trae `comercios(*)`, así que `tipo_tarjeta` y `sello_meta` ya vienen una vez `types.ts` los declara — Tarea 1). Después de `colorLabel: ...`:
```typescript
      tipoTarjeta: tarjeta.comercios.tipo_tarjeta,
      selloMeta: tarjeta.comercios.sello_meta,
```

Run: `npm test -- generatePass`
Expected: 4 passed.

- [ ] **Step 3: Gates + commit**

Run: `npm test` → **66 passed** (64 + 2). Run `npm run typecheck`, `npm run lint`, `npm run build`.
```bash
git add -A
git commit -m "Render sellos cards as a text fraction on the pass"
```

---

### Task 5: `esOwnerDeComercio()` (testeable) + `verifyComercioOwner()` (el gate)

Réplica exacta del par `esAdminFm`/`verifyFmAdmin`, con nombres propios. Se parten en dos igual: la consulta se testea contra la BD; el envoltorio que lee cookies se verifica a mano (Tarea 15).

**Files:**
- Modify: `lib/supabase/types.ts` (agregar el `Relationship` de `usuarios_comercio`)
- Create: `lib/comercio/esOwnerDeComercio.ts`
- Test: `lib/comercio/esOwnerDeComercio.test.ts`
- Create: `lib/comercio/verifyComercioOwner.ts`

- [ ] **Step 1: Habilitar el join en `types.ts`**

En `lib/supabase/types.ts`, en el bloque `usuarios_comercio`, reemplaza `Relationships: [];` por:
```typescript
        // FK inline en la migración 0001 (`comercio_id ... references comercios(id)`) — Postgres
        // la nombra `usuarios_comercio_comercio_id_fkey`. Necesaria para que el join embebido
        // `comercios(nombre)` de esOwnerDeComercio resuelva su tipo (sin la entrada da
        // SelectQueryError, igual que documenta la entrada de `tarjetas`).
        Relationships: [
          {
            foreignKeyName: 'usuarios_comercio_comercio_id_fkey';
            columns: ['comercio_id'];
            isOneToOne: false;
            referencedRelation: 'comercios';
            referencedColumns: ['id'];
          },
        ];
```

- [ ] **Step 2: Escribir el test que falla**

Create `lib/comercio/esOwnerDeComercio.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { esOwnerDeComercio } from './esOwnerDeComercio';

const supabase = createServiceClient();
const usuariosCreados: string[] = [];
const slugsDePrueba: string[] = [];

afterEach(async () => {
  // Orden: filas de usuarios_comercio (por email) → auth.users → comercios. usuarios_comercio
  // apunta a comercios y a auth.users sin cascade, así que el hijo va antes que ambos padres.
  for (const id of usuariosCreados) {
    const { error: e1 } = await supabase.from('usuarios_comercio').delete().eq('auth_user_id', id);
    if (e1) console.error('[test] no se pudo borrar la fila de usuarios_comercio:', e1);
    const { error: e2 } = await supabase.auth.admin.deleteUser(id);
    if (e2) console.error('[test] no se pudo borrar el usuario de auth:', e2);
  }
  usuariosCreados.length = 0;
  if (slugsDePrueba.length) {
    const { error } = await supabase.from('comercios').delete().in('slug', slugsDePrueba);
    if (error) console.error('[test] no se pudieron borrar los comercios de prueba:', error);
    slugsDePrueba.length = 0;
  }
});

async function crearUsuarioAuth(): Promise<string> {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase.auth.admin.createUser({
    email: `test-owner-${sufijo}@ejemplo.test`,
    password: 'contrasena-de-prueba-1234',
    email_confirm: true,
  });
  if (error) throw error;
  usuariosCreados.push(data.user.id);
  return data.user.id;
}

async function crearComercio(nombre: string): Promise<string> {
  const slug = `test-owner-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  slugsDePrueba.push(slug);
  const { data, error } = await supabase
    .from('comercios')
    .insert({ nombre, slug })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function ligar(authUserId: string, comercioId: string, rol: 'owner' | 'cajero') {
  const { error } = await supabase
    .from('usuarios_comercio')
    .insert({ comercio_id: comercioId, email: `uc-${authUserId}@ejemplo.test`, rol, auth_user_id: authUserId });
  if (error) throw error;
}

describe('esOwnerDeComercio', () => {
  it('devuelve el comercio (id y nombre) cuando el usuario es owner', async () => {
    const id = await crearUsuarioAuth();
    const comercioId = await crearComercio('Comercio del Owner');
    await ligar(id, comercioId, 'owner');

    const res = await esOwnerDeComercio(supabase, id);
    expect(res).not.toBeNull();
    expect(res!.comercioId).toBe(comercioId);
    expect(res!.nombre).toBe('Comercio del Owner');
  });

  it('devuelve null cuando el usuario existe pero NO tiene fila en usuarios_comercio', async () => {
    const id = await crearUsuarioAuth();
    expect(await esOwnerDeComercio(supabase, id)).toBeNull();
  });

  it('devuelve null para un id que no existe', async () => {
    expect(await esOwnerDeComercio(supabase, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('devuelve null para un usuario con rol cajero (no owner)', async () => {
    // El filtro .eq('rol','owner') NO es decorativo: un cajero tiene fila en usuarios_comercio
    // pero no debe entrar al panel del dueño. Sin el filtro, este test pasaría un cajero como owner.
    const id = await crearUsuarioAuth();
    const comercioId = await crearComercio('Comercio con Cajero');
    await ligar(id, comercioId, 'cajero');

    expect(await esOwnerDeComercio(supabase, id)).toBeNull();
  });

  it('devuelve null para un usuario sin fila aunque OTRO sí sea owner', async () => {
    // Fija el .eq('auth_user_id', ...): con una sola fila de otro owner, un maybeSingle() sin
    // filtro la devolvería y el intruso entraría.
    const idOwner = await crearUsuarioAuth();
    const comercioId = await crearComercio('Comercio de Otro');
    await ligar(idOwner, comercioId, 'owner');
    const idIntruso = await crearUsuarioAuth();

    expect(await esOwnerDeComercio(supabase, idIntruso)).toBeNull();
  });
});
```

Run: `npm test -- esOwnerDeComercio`
Expected: FAIL — `Cannot find module './esOwnerDeComercio'`.

- [ ] **Step 3: Implementar la consulta**

Create `lib/comercio/esOwnerDeComercio.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

// ¿Este usuario autenticado es DUEÑO (owner) de un comercio? Devuelve el id y el nombre del
// comercio (para el panel), o null. Separado de verifyComercioOwner() para testear la consulta
// contra la BD real sin un contexto de request de Next — mismo patrón que esAdminFm().
export async function esOwnerDeComercio(
  supabase: SupabaseClient<Database>,
  authUserId: string,
): Promise<{ comercioId: string; nombre: string } | null> {
  const { data, error } = await supabase
    .from('usuarios_comercio')
    .select('comercio_id, comercios(nombre)')
    .eq('auth_user_id', authUserId)
    .eq('rol', 'owner')
    .maybeSingle();

  if (error) {
    // maybeSingle() devuelve error:null cuando no hay filas — así que un error aquí SIEMPRE es
    // infraestructura (llave revocada, red, migración rota), nunca un "no es owner". Fallamos
    // cerrado (null) pero dejamos rastro. CAVEAT (spec §5): usuarios_comercio.auth_user_id NO es
    // único; si una cuenta llegara a tener 2 filas owner, maybeSingle() lanza PGRST116 y cae aquí
    // → el dueño queda bloqueado. Baja probabilidad (email sí es único, una cuenta = un comercio);
    // vale tenerlo presente si el flujo de alta cambia.
    console.error('[comercio] falló la consulta de usuarios_comercio; se deniega por seguridad:', error);
    return null;
  }

  if (!data || !data.comercios) return null;

  return { comercioId: data.comercio_id, nombre: data.comercios.nombre };
}
```

Run: `npm test -- esOwnerDeComercio`
Expected: 5 passed. (La rama de error queda sin cobertura a propósito: requiere una BD rota.)

- [ ] **Step 4: El gate**

Create `lib/comercio/verifyComercioOwner.ts`:

```typescript
import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClienteServidor, createServiceClient } from '@/lib/supabase/server';
import { esOwnerDeComercio } from './esOwnerDeComercio';

// Gate de /comercio. Se llama desde el layout, CADA página y CADA Server Action del panel del
// dueño. Mismas razones que verifyFmAdmin(): los layouts no se re-renderizan en navegación del
// lado del cliente, y los Server Actions son POST a su ruta (los docs de Next exigen verificar
// auth dentro de cada acción, no confiar en el Proxy). cache() lo memoiza por render pass.
//
// OJO: redirect() funciona LANZANDO NEXT_REDIRECT. Envolver esto en try/catch y tragarse el error
// DESACTIVA el gate. Llámalo siempre FUERA de cualquier try/catch.
//
// Devuelve comercioId para que las acciones scopeen SIEMPRE por la sesión verificada — nunca por
// un campo del formulario (spec §4.4 corrección 1: un comercio_id del cliente dejaría a un dueño
// sobrescribir datos de OTRO comercio).
export const verifyComercioOwner = cache(async () => {
  const supabase = await createClienteServidor();

  // getClaims(), NO getSession(): getSession() no garantiza revalidar el token en servidor.
  const { data, error } = await supabase.auth.getClaims();

  if (error) {
    console.warn('[comercio] getClaims() falló; se trata como sesión ausente:', error);
  }

  const authUserId = data?.claims?.sub;

  if (!authUserId) {
    redirect('/comercio/login');
  }

  // Service client: usuarios_comercio es deny-all bajo RLS.
  const owner = await esOwnerDeComercio(createServiceClient(), authUserId);
  if (!owner) {
    redirect('/comercio/login?error=sin-permiso');
  }

  return { authUserId, comercioId: owner.comercioId, nombre: owner.nombre };
});
```

- [ ] **Step 5: Gates + commit**

Run: `npm test` → **71 passed** (66 + 5). Run `npm run typecheck`, `npm run lint`.
Confirma 0 filas huérfanas en `usuarios_comercio`/`auth.users`/`comercios` (los tests limpian).
```bash
git add -A
git commit -m "Add esOwnerDeComercio query and verifyComercioOwner gate"
```

---

### Task 6: Login, logout y la página de login del comercio

Mismo patrón que `app/admin/login/`. Sin tests nuevos (cableado de UI; la lógica invocada ya está cubierta).

> ⚠️ **NO crees `app/comercio/layout.tsx` — ni en esta tarea ni en ninguna.** Misma regla que ya nos mordió en `/admin`: un layout en `app/comercio/` envolvería TAMBIÉN a `/comercio/login`, y como el layout protegido redirige a `/comercio/login`, se produce un ciclo infinito (`ERR_TOO_MANY_REDIRECTS`). Un route group NO puede sacar una página de un layout que está por encima del grupo. El gate va DENTRO del grupo `(protegido)` (Tarea 7). Estructura final:
> ```
> app/comercio/
>   actions.ts                  ← cerrarSesionComercio (compartido)
>   login/
>     page.tsx                  ← sin chequeo (fuera del grupo protegido)
>     FormularioLoginComercio.tsx
>     actions.ts
>   (protegido)/
>     layout.tsx                ← AQUÍ va verifyComercioOwner()
>     panel/ branding/ reglas/ recompensas/
> ```

**Files:**
- Create: `app/comercio/login/actions.ts`
- Create: `app/comercio/login/FormularioLoginComercio.tsx`
- Create: `app/comercio/login/page.tsx`
- Create: `app/comercio/actions.ts`

- [ ] **Step 1: Acción de login**

Create `app/comercio/login/actions.ts`:

```typescript
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClienteServidor } from '@/lib/supabase/server';

export type EstadoLogin = { error: string } | undefined;

export async function iniciarSesionComercio(
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
    // Genérico a propósito: no distinguir "no existe" de "contraseña incorrecta" evita enumerar
    // qué correos tienen cuenta.
    return { error: 'Correo o contraseña incorrectos.' };
  }

  revalidatePath('/comercio', 'layout');
  // redirect() lanza NEXT_REDIRECT: va FUERA de cualquier try/catch.
  redirect('/comercio/panel');
}
```

- [ ] **Step 2: Acción de logout (compartida)**

Create `app/comercio/actions.ts`:

```typescript
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClienteServidor } from '@/lib/supabase/server';

export async function cerrarSesionComercio() {
  const supabase = await createClienteServidor();
  await supabase.auth.signOut();
  revalidatePath('/comercio', 'layout');
  redirect('/comercio/login');
}
```

- [ ] **Step 3: Formulario de login (cliente)**

Create `app/comercio/login/FormularioLoginComercio.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { iniciarSesionComercio, type EstadoLogin } from './actions';

export default function FormularioLoginComercio({ mensajeInicial }: { mensajeInicial?: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoLogin, FormData>(
    iniciarSesionComercio,
    undefined,
  );

  const mensaje = estado?.error ?? mensajeInicial;

  return (
    <form className="panel reveal d3" action={accion}>
      <div className="field">
        <label htmlFor="email">Correo</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="field">
        <label htmlFor="password">Contraseña</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
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

Create `app/comercio/login/page.tsx`. Server Component a propósito: lee `searchParams` como prop, sin `useSearchParams()` (que exigiría `<Suspense>` o rompería el prerender).

```tsx
import FormularioLoginComercio from './FormularioLoginComercio';

const MENSAJES: Record<string, string> = {
  'sin-permiso': 'Esa cuenta no tiene acceso al panel del comercio.',
};

export default async function PaginaLoginComercio({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  // Object.hasOwn, no MENSAJES[error] a secas: ?error=constructor devolvería una FUNCIÓN
  // (Object.prototype.constructor) y React revienta al renderizarla. Un valor desconocido no
  // muestra nada, que es lo correcto.
  const mensaje = error && Object.hasOwn(MENSAJES, error) ? MENSAJES[error] : undefined;

  return (
    <main className="shell">
      <div className="stack">
        <p className="kicker reveal d1">FM Lealtad</p>
        <h1 className="title reveal d2">
          Panel del <em>comercio</em>
        </h1>
        <FormularioLoginComercio mensajeInicial={mensaje} />
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Gates + commit**

Run: `npm run build` (si falla por prerender de `/comercio/login`, revisa que NO uses `useSearchParams()`), `npm run typecheck`, `npm run lint`, `npm test` (**71 passed**).
```bash
git add -A
git commit -m "Add comercio owner login page with sign-in and sign-out"
```

---

### Task 7: Layout protegido del comercio + página de resumen

**Files:**
- Create: `app/comercio/(protegido)/layout.tsx`
- Create: `app/comercio/(protegido)/panel/page.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Layout protegido (DENTRO del grupo)**

> ⚠️ Va en `app/comercio/(protegido)/layout.tsx`, **NO** en `app/comercio/layout.tsx`. Antes de seguir, confirma: `ls app/comercio/layout.tsx` → debe decir "No such file".

Create `app/comercio/(protegido)/layout.tsx`:

```tsx
import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { cerrarSesionComercio } from '../actions';

export default async function LayoutComercio({ children }: { children: React.ReactNode }) {
  // Primera barrera. NO la única: cada página y cada Server Action repiten el chequeo.
  const { nombre } = await verifyComercioOwner();

  return (
    <div className="admin-shell">
      <header className="admin-top">
        <Link href="/comercio/panel" className="admin-marca">{nombre}</Link>
        <form action={cerrarSesionComercio}>
          <button className="admin-salir" type="submit">Salir</button>
        </form>
      </header>
      {children}
    </div>
  );
}
```

Nota el import `../actions` (sube a `app/comercio/actions.ts`), no `./actions`.

- [ ] **Step 2: Página de resumen (`/comercio/panel`)**

Create `app/comercio/(protegido)/panel/page.tsx`:

```tsx
import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { TIPOS_TARJETA } from '@/lib/comercios/guardarComercio';

export const dynamic = 'force-dynamic';

export default async function PaginaPanel() {
  // Defensa en profundidad: el layout ya verificó, pero no se re-ejecuta en navegación del
  // cliente. cache() hace que no cueste una consulta extra.
  const { comercioId } = await verifyComercioOwner();

  const supabase = createServiceClient();
  const { data: comercio } = await supabase
    .from('comercios')
    .select('nombre, tipo_tarjeta')
    .eq('id', comercioId)
    .maybeSingle();

  const tipo = TIPOS_TARJETA.find((t) => t.valor === comercio?.tipo_tarjeta);

  return (
    <main className="admin-main">
      <div className="admin-encabezado">
        <h1 className="title" style={{ fontSize: '2rem', margin: 0 }}>Tu comercio</h1>
      </div>

      <div className="panel" style={{ marginTop: 0 }}>
        <p className="admin-fila-slug">Tipo de tarjeta</p>
        <p className="admin-fila-nombre">{tipo?.etiqueta ?? comercio?.tipo_tarjeta}</p>
        {tipo && <p className="nota" style={{ textAlign: 'left', margin: '6px 0 0' }}>{tipo.descripcion}</p>}
      </div>

      <div className="panel-atajos">
        <Link className="admin-fila" href="/comercio/branding">
          <div>
            <div className="admin-fila-nombre">Branding</div>
            <div className="admin-fila-slug">Colores, imágenes y sellos</div>
          </div>
          <span aria-hidden="true">→</span>
        </Link>
        <Link className="admin-fila" href="/comercio/reglas">
          <div>
            <div className="admin-fila-nombre">Reglas de puntos</div>
            <div className="admin-fila-slug">Cómo se ganan los puntos/sellos</div>
          </div>
          <span aria-hidden="true">→</span>
        </Link>
        <Link className="admin-fila" href="/comercio/recompensas">
          <div>
            <div className="admin-fila-nombre">Recompensas</div>
            <div className="admin-fila-slug">Catálogo de premios canjeables</div>
          </div>
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: CSS de los atajos**

Modify `app/globals.css` — agrega al final:
```css
/* ---------- panel del dueño del comercio ---------- */
.panel-atajos {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 22px;
}
.admin-marca {
  cursor: pointer;
}
```

- [ ] **Step 4: Gates + commit**

Run: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` (**71 passed**).
```bash
git add -A
git commit -m "Add protected comercio layout and panel summary page"
```

---

### Task 8: `proxy.ts` — extender el refresco de sesión a `/comercio` (ARCHIVO DE MÁS RIESGO)

Este es el archivo más delicado del plan. Un error aquí desloguea usuarios al azar o manda al dueño a la pantalla de FM. **RE-LEE el archivo actual ANTES de editar** — no confíes en la cita de abajo, pudo haber cambiado.

**Files:**
- Modify: `lib/supabase/proxy.ts`
- Modify: `proxy.ts` (raíz)

- [ ] **Step 1: Re-leer y confirmar el estado actual**

Run: `cat lib/supabase/proxy.ts` y localiza EXACTAMENTE este bloque (debe existir tal cual; si difiere, adapta el patrón a lo que realmente haya, conservando el anclaje):
```typescript
  const ruta = request.nextUrl.pathname;
  const esRutaLogin = ruta === '/admin/login' || ruta.startsWith('/admin/login/');

  // Primera barrera (rápida). El gate real es verifyFmAdmin() en layout/página/acción.
  // /admin/login se excluye o se cicla infinitamente contra sí mismo.
  if (!usuario && !esRutaLogin) {
    const url = request.nextUrl.clone();
    url.pathname = '/admin/login';
```

- [ ] **Step 2: Aplicar el patrón exacto de spec §5**

Reemplaza la definición de `esRutaLogin` (deja el comentario de anclaje que ya está encima) por el OR de CUATRO checks anclados:
```typescript
  const esRutaLogin =
    ruta === '/admin/login' || ruta.startsWith('/admin/login/') ||
    ruta === '/comercio/login' || ruta.startsWith('/comercio/login/');
```

Dentro del `if (!usuario && !esRutaLogin) {`, reemplaza las dos líneas que fijan el destino:
```typescript
    const url = request.nextUrl.clone();
    url.pathname = '/admin/login';
```
por (derivando el destino del prefijo de la ruta):
```typescript
    // El destino del redirect se DERIVA del prefijo, no es fijo: una visita sin sesión a
    // /comercio/panel debe caer en /comercio/login (la pantalla del dueño), no en /admin/login
    // (la de FM). El matcher solo enruta /admin/* y /comercio/*, así que `ruta` siempre empieza
    // por uno de los dos; startsWith('/comercio') es seguro aquí.
    const prefijo = ruta.startsWith('/comercio') ? '/comercio' : '/admin';
    const url = request.nextUrl.clone();
    url.pathname = `${prefijo}/login`;
```

El resto del bloque (`url.search = ''`, la copia de cookies del `supabaseResponse`, el `return`) queda **sin cambios**.

- [ ] **Step 3: Extender el matcher**

En `proxy.ts` (raíz), cambia `matcher`:
```typescript
export const config = {
  // Los paneles de FM y del dueño necesitan sesión. El resto del sitio (registro público,
  // endpoints de Apple Wallet) es público y no debe pagar este costo.
  matcher: ['/admin/:path*', '/comercio/:path*'],
};
```

- [ ] **Step 4: Verificar que compila y que las rutas se comportan**

Run: `npm run build` → exitoso, sin advertencias de config desconocida.

Run: `npm run dev` y en otra terminal comprueba los redirects (sin sesión):
```bash
curl -s -o /dev/null -w "%{redirect_url}\n" http://localhost:3000/comercio/panel
curl -s -o /dev/null -w "%{redirect_url}\n" http://localhost:3000/admin/comercios
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/registro/cafeteria-piloto
```
Expected:
- `/comercio/panel` → redirect a `…/comercio/login`
- `/admin/comercios` → redirect a `…/admin/login` (no se rompió lo de FM)
- `/registro/cafeteria-piloto` → `200` (el proxy no afecta rutas públicas)

Detén el dev server.

- [ ] **Step 5: Gates + commit**

Run: `npm run typecheck`, `npm run lint`, `npm test` (**71 passed**).
```bash
git add -A
git commit -m "Extend proxy session refresh and redirects to comercio panel"
```

---

### Task 9: Bucket de Storage `comercio-imagenes` (script manual)

No hay precedente de crear buckets vía migración SQL en este proyecto (hecho verificado #4). Se crea con un script idempotente que el operador corre a mano, del mismo estilo que `seed-usuario-fm`. Sin tests de Vitest.

**Files:**
- Create: `scripts/seed-storage-bucket.ts`
- Modify: `package.json`

- [ ] **Step 1: Script de creación del bucket**

Create `scripts/seed-storage-bucket.ts`:

```typescript
// Ejecutar vía: npm run seed-bucket
// Crea el bucket público 'comercio-imagenes' en Supabase Storage (idempotente).
// Público de LECTURA a propósito: logo/strip/hero/ícono de sello son públicos por naturaleza
// (aparecen en la tarjeta de cualquier cliente). La ESCRITURA no pasa por RLS de Storage: va
// mediada por un Server Action con service role (spec §4.4). No se diseña un segundo modelo de
// autorización (políticas de Storage) además del gate que ya existe.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

const BUCKET = 'comercio-imagenes';

async function main() {
  const supabase = createServiceClient();

  const { error } = await supabase.storage.createBucket(BUCKET, { public: true });

  if (error) {
    // Si ya existe, es idempotente: lo reportamos y salimos OK. Cualquier otro error sí es real.
    const msg = (error.message ?? '').toLowerCase();
    if (msg.includes('already exists') || msg.includes('duplicate')) {
      console.log(`El bucket '${BUCKET}' ya existía; nada que hacer.`);
      return;
    }
    throw error;
  }

  console.log(`Bucket '${BUCKET}' creado (público de lectura).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Modify `package.json` scripts (agrega junto a `seed-fm`):
```json
    "seed-bucket": "tsx --conditions=react-server scripts/seed-storage-bucket.ts",
```

- [ ] **Step 2: Crear el bucket**

Run: `npm run seed-bucket`
Expected: `Bucket 'comercio-imagenes' creado (público de lectura).` (o el mensaje de "ya existía" si se re-ejecuta).

Alternativa manual (si el script fallara por permisos): Supabase Studio → **Storage** → **New bucket** → nombre `comercio-imagenes`, marcar **Public bucket** → Create.

Verifica en Studio → Storage que el bucket exista y sea público.

- [ ] **Step 3: Commit**

Run: `npm run typecheck`, `npm run lint`, `npm test` (**71 passed**).
```bash
git add -A
git commit -m "Add seed script for the comercio-imagenes storage bucket"
```

---

### Task 10: Validación de imágenes subidas (TDD, funciones puras)

La lógica pura de la subida (MIME/tamaño permitidos, extensión, ruta) se testea aparte del Server Action de I/O.

**Files:**
- Create: `lib/comercio/imagenComercio.ts`
- Test: `lib/comercio/imagenComercio.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Create `lib/comercio/imagenComercio.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  validarImagenSubida,
  extensionDeMime,
  rutaImagenComercio,
  TAMANO_MAXIMO_BYTES,
} from './imagenComercio';

describe('validarImagenSubida', () => {
  it('acepta PNG, JPEG y WebP dentro del límite', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      expect(validarImagenSubida({ type, size: 50_000 })).toBeNull();
    }
  });

  it('rechaza un tipo MIME no permitido', () => {
    for (const type of ['image/svg+xml', 'image/gif', 'application/pdf', 'text/html']) {
      const err = validarImagenSubida({ type, size: 50_000 });
      expect(err).not.toBeNull();
      expect(err!).toMatch(/formato|tipo/i);
    }
  });

  it('rechaza un archivo más grande que el límite', () => {
    const err = validarImagenSubida({ type: 'image/png', size: TAMANO_MAXIMO_BYTES + 1 });
    expect(err).not.toBeNull();
    expect(err!).toMatch(/grande|tamaño|pesa/i);
  });

  it('rechaza un archivo de tamaño cero', () => {
    const err = validarImagenSubida({ type: 'image/png', size: 0 });
    expect(err).not.toBeNull();
    expect(err!).toMatch(/vacío|vacio|archivo/i);
  });
});

describe('extensionDeMime', () => {
  it('mapea cada MIME permitido a su extensión', () => {
    expect(extensionDeMime('image/png')).toBe('png');
    expect(extensionDeMime('image/jpeg')).toBe('jpg');
    expect(extensionDeMime('image/webp')).toBe('webp');
  });
});

describe('rutaImagenComercio', () => {
  it('compone la ruta {comercioId}/{campo}.{ext}', () => {
    expect(rutaImagenComercio('abc-123', 'logo', 'png')).toBe('abc-123/logo.png');
    expect(rutaImagenComercio('abc-123', 'sello_icono', 'webp')).toBe('abc-123/sello_icono.webp');
  });
});
```

Run: `npm test -- imagenComercio`
Expected: FAIL — `Cannot find module './imagenComercio'`.

- [ ] **Step 2: Implementar**

Create `lib/comercio/imagenComercio.ts`:

```typescript
// Validación y rutas para las imágenes de branding del comercio. Puro y testeable, separado del
// Server Action de subida (I/O). El bucket es 'comercio-imagenes' (público de lectura); la ruta
// SIEMPRE deriva el comercio_id del gate, nunca del formulario (spec §4.4).

// Un mapa MIME -> extensión es también la lista blanca de tipos permitidos.
const MIME_A_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

// 2 MB: de sobra para un logo/strip/hero; corta subidas accidentales de fotos gigantes.
export const TAMANO_MAXIMO_BYTES = 2 * 1024 * 1024;

// Los cuatro campos de imagen del comercio. sello_icono solo aplica a tipo_tarjeta='sellos', pero
// la validación de campo es la misma. Nunca se confía en un nombre de campo del cliente para
// nombrar una columna: el Server Action lo valida contra esta lista.
export const CAMPOS_IMAGEN = ['logo', 'strip', 'hero', 'sello_icono'] as const;
export type CampoImagen = (typeof CAMPOS_IMAGEN)[number];

// Devuelve el primer problema, o null si la imagen es aceptable.
export function validarImagenSubida(archivo: { type: string; size: number }): string | null {
  if (!archivo.size) return 'El archivo está vacío.';
  if (!(archivo.type in MIME_A_EXT)) {
    return 'Formato no permitido. Usa PNG, JPG o WebP.';
  }
  if (archivo.size > TAMANO_MAXIMO_BYTES) {
    return 'La imagen es muy grande. El máximo es 2 MB.';
  }
  return null;
}

export function extensionDeMime(mime: string): string {
  const ext = MIME_A_EXT[mime];
  if (!ext) throw new Error(`MIME sin extensión conocida: ${mime}`);
  return ext;
}

// Ruta determinística dentro del bucket. El comercio_id lo pone el gate; el cache-busting va por
// query string (?v=timestamp) sobre la URL pública guardada, no en el path (así el re-subir pisa
// el archivo viejo en vez de acumular versiones infinitas).
export function rutaImagenComercio(comercioId: string, campo: string, ext: string): string {
  return `${comercioId}/${campo}.${ext}`;
}
```

Run: `npm test -- imagenComercio`
Expected: 6 passed.

- [ ] **Step 3: Gates + commit**

Run: `npm test` → **77 passed** (71 + 6). Run `npm run typecheck`, `npm run lint`.
```bash
git add -A
git commit -m "Add pure validators for comercio image uploads"
```

---

### Task 11: `guardarBranding()` (TDD, función pura)

Guarda los campos de TEXTO del branding del dueño: los 3 colores y `sello_meta`. Las imágenes van por el Server Action de subida (Tarea 12), no aquí.

**Files:**
- Create: `lib/comercio/guardarBranding.ts`
- Test: `lib/comercio/guardarBranding.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Create `lib/comercio/guardarBranding.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { guardarBranding } from './guardarBranding';

const supabase = createServiceClient();
const idsDePrueba: string[] = [];

afterEach(async () => {
  if (!idsDePrueba.length) return;
  const { error } = await supabase.from('comercios').delete().in('id', idsDePrueba);
  if (error) console.error('[test] no se pudieron borrar los comercios de prueba:', error);
  idsDePrueba.length = 0;
});

async function crearComercio(): Promise<string> {
  const slug = `test-branding-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase
    .from('comercios')
    .insert({ nombre: 'Comercio Branding', slug, tipo_tarjeta: 'sellos' })
    .select('id')
    .single();
  if (error) throw error;
  idsDePrueba.push(data.id);
  return data.id;
}

describe('guardarBranding', () => {
  it('guarda colores y sello_meta de un comercio existente', async () => {
    const id = await crearComercio();
    const res = await guardarBranding(supabase, id, {
      color_fondo: 'rgb(10, 20, 30)',
      color_texto: 'rgb(255, 255, 255)',
      color_label: 'rgb(200, 200, 200)',
      sello_meta: 10,
    });

    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('comercios')
      .select('color_fondo, sello_meta')
      .eq('id', id)
      .single();
    expect(data!.color_fondo).toBe('rgb(10, 20, 30)');
    expect(data!.sello_meta).toBe(10);
  });

  it('rechaza un color con formato inválido', async () => {
    const id = await crearComercio();
    const res = await guardarBranding(supabase, id, {
      color_fondo: '#231812',
      color_texto: 'rgb(255, 255, 255)',
      color_label: 'rgb(255, 255, 255)',
      sello_meta: null,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/color/i);
  });

  it('rechaza un sello_meta menor o igual a cero', async () => {
    const id = await crearComercio();
    const res = await guardarBranding(supabase, id, {
      color_fondo: 'rgb(10, 20, 30)',
      color_texto: 'rgb(255, 255, 255)',
      color_label: 'rgb(255, 255, 255)',
      sello_meta: 0,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/meta|sellos/i);
  });

  it('falla si el comercio ya no existe, en vez de reportar éxito', async () => {
    // Sin el .select('id').single(), un update de 0 filas devolvería ok:true habiendo escrito cero.
    const res = await guardarBranding(supabase, '00000000-0000-0000-0000-000000000000', {
      color_fondo: 'rgb(10, 20, 30)',
      color_texto: 'rgb(255, 255, 255)',
      color_label: 'rgb(255, 255, 255)',
      sello_meta: null,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/no existe/i);
  });
});
```

Run: `npm test -- guardarBranding`
Expected: FAIL — `Cannot find module './guardarBranding'`.

- [ ] **Step 2: Implementar**

Create `lib/comercio/guardarBranding.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { validarColorRgb } from '../comercios/validarColorRgb';

export interface DatosBranding {
  color_fondo: string;
  color_texto: string;
  color_label: string;
  // null = el comercio no usa sellos, o el dueño aún no configuró la meta. La BD exige > 0 o null.
  sello_meta: number | null;
}

export type ResultadoBranding = { ok: true } | { ok: false; error: string };

// Guarda solo campos de TEXTO del branding del dueño. El comercio_id SIEMPRE viene del gate
// (verifyComercioOwner), nunca del formulario (spec §4.4). No toca las columnas *_url de imagen:
// esas las escribe el Server Action de subida. sello_meta se guarda aunque el tipo no sea 'sellos'
// (el pass solo lo lee cuando tipo='sellos', así que guardarlo es inofensivo).
export async function guardarBranding(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  datos: DatosBranding,
): Promise<ResultadoBranding> {
  const colores: [string, string][] = [
    ['color de fondo', datos.color_fondo.trim()],
    ['color de texto', datos.color_texto.trim()],
    ['color de etiqueta', datos.color_label.trim()],
  ];
  for (const [nombre, valor] of colores) {
    if (!validarColorRgb(valor)) {
      return { ok: false, error: `El ${nombre} debe tener el formato rgb(r, g, b) con valores de 0 a 255.` };
    }
  }

  if (datos.sello_meta !== null && (!Number.isInteger(datos.sello_meta) || datos.sello_meta <= 0)) {
    return { ok: false, error: 'La meta de sellos debe ser un número entero mayor que cero.' };
  }

  const { error } = await supabase
    .from('comercios')
    .update({
      color_fondo: colores[0][1],
      color_texto: colores[1][1],
      color_label: colores[2][1],
      sello_meta: datos.sello_meta,
    })
    .eq('id', comercioId)
    .select('id')
    .single();

  if (error) {
    // PGRST116 = la consulta no devolvió exactamente una fila (id inexistente). El .select().single()
    // NO es decorativo: sin él, un update de 0 filas devuelve 204 sin error y esto reportaría ok:true.
    if (error.code === 'PGRST116') {
      return { ok: false, error: 'Ese comercio ya no existe.' };
    }
    console.error('[comercio] falló el update de branding:', error);
    return { ok: false, error: 'No se pudo guardar el branding.' };
  }

  return { ok: true };
}
```

Run: `npm test -- guardarBranding`
Expected: 4 passed.

- [ ] **Step 3: Gates + commit**

Run: `npm test` → **81 passed** (77 + 4). Run `npm run typecheck`, `npm run lint`.
Confirma 0 comercios `test-branding-%` huérfanos.
```bash
git add -A
git commit -m "Add guardarBranding for owner colors and sello meta"
```

---

### Task 12: Página de branding — formulario, subida de imágenes y vista previa

Cablea la UI del branding: guardar colores/sello_meta (Server Action → `guardarBranding`), subir imágenes reales (Server Action → Storage), y una maqueta simple de colores. Sin tests nuevos (I/O + UI; la lógica pura ya está cubierta en Tareas 10-11).

**Files:**
- Create: `app/comercio/(protegido)/branding/actions.ts`
- Create: `app/comercio/(protegido)/branding/FormularioBranding.tsx`
- Create: `app/comercio/(protegido)/branding/SubidaImagen.tsx`
- Create: `app/comercio/(protegido)/branding/page.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Server Actions (guardar branding + subir imagen)**

Create `app/comercio/(protegido)/branding/actions.ts`:

```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { guardarBranding } from '@/lib/comercio/guardarBranding';
import {
  validarImagenSubida,
  extensionDeMime,
  rutaImagenComercio,
  CAMPOS_IMAGEN,
} from '@/lib/comercio/imagenComercio';
import type { Database } from '@/lib/supabase/types';

const BUCKET = 'comercio-imagenes';

export type EstadoBranding = { error: string } | { ok: true } | undefined;

// Guarda colores + sello_meta. comercio_id SIEMPRE del gate, nunca del formulario.
export async function accionGuardarBranding(
  _estadoPrevio: EstadoBranding,
  formData: FormData,
): Promise<EstadoBranding> {
  const { comercioId } = await verifyComercioOwner();

  const montoMeta = String(formData.get('sello_meta') ?? '').trim();
  const res = await guardarBranding(createServiceClient(), comercioId, {
    color_fondo: String(formData.get('color_fondo') ?? ''),
    color_texto: String(formData.get('color_texto') ?? ''),
    color_label: String(formData.get('color_label') ?? ''),
    // '' → null; "12" → 12; "12a" → NaN, que guardarBranding rechaza con mensaje claro.
    sello_meta: montoMeta === '' ? null : Number(montoMeta),
  });

  if (!res.ok) return { error: res.error };
  revalidatePath('/comercio/branding');
  return { ok: true };
}

// Sube UNA imagen. El campo (logo/strip/hero/sello_icono) se valida contra la lista blanca: nunca
// se confía en el cliente para nombrar una columna. comercio_id del gate → la ruta del archivo.
export async function accionSubirImagen(
  _estadoPrevio: EstadoBranding,
  formData: FormData,
): Promise<EstadoBranding> {
  const { comercioId } = await verifyComercioOwner();

  const campo = String(formData.get('campo') ?? '');
  if (!(CAMPOS_IMAGEN as readonly string[]).includes(campo)) {
    return { error: 'Campo de imagen no válido.' };
  }

  const archivo = formData.get('archivo');
  if (!(archivo instanceof File)) {
    return { error: 'No se recibió ninguna imagen.' };
  }

  const problema = validarImagenSubida({ type: archivo.type, size: archivo.size });
  if (problema) return { error: problema };

  const ext = extensionDeMime(archivo.type);
  const ruta = rutaImagenComercio(comercioId, campo, ext);
  const supabase = createServiceClient();

  const { error: errorSubida } = await supabase.storage
    .from(BUCKET)
    .upload(ruta, await archivo.arrayBuffer(), { contentType: archivo.type, upsert: true });
  if (errorSubida) {
    console.error('[comercio] falló la subida de imagen:', errorSubida);
    return { error: 'No se pudo subir la imagen.' };
  }

  // URL pública + cache-busting: la ruta es determinística y el CDN cachea, así que re-subir al
  // mismo path serviría la imagen vieja sin el ?v=. La columna es {campo}_url.
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(ruta);
  const urlConVersion = `${pub.publicUrl}?v=${Date.now()}`;

  // `campo` ya se validó contra CAMPOS_IMAGEN arriba, así que `${campo}_url` es una de las cuatro
  // columnas reales (logo_url/strip_url/hero_url/sello_icono_url). El cast es necesario porque una
  // llave computada de tipo unión ensancha el objeto a { [x: string]: string }, que el tipo Update
  // (estricto, sin index signature) rechazaría; el cast lo alinea sin perder seguridad en runtime.
  const actualizacion = { [`${campo}_url`]: urlConVersion } as Database['public']['Tables']['comercios']['Update'];

  const { error: errorUpdate } = await supabase
    .from('comercios')
    .update(actualizacion)
    .eq('id', comercioId)
    .select('id')
    .single();
  if (errorUpdate) {
    console.error('[comercio] falló el guardado de la URL de imagen:', errorUpdate);
    return { error: 'La imagen se subió pero no se pudo guardar su dirección.' };
  }

  revalidatePath('/comercio/branding');
  return { ok: true };
}
```

- [ ] **Step 2: Componente de subida (cliente)**

Create `app/comercio/(protegido)/branding/SubidaImagen.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { accionSubirImagen, type EstadoBranding } from './actions';

export default function SubidaImagen({
  campo,
  etiqueta,
  urlActual,
}: {
  campo: string;
  etiqueta: string;
  urlActual: string | null;
}) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoBranding, FormData>(
    accionSubirImagen,
    undefined,
  );

  return (
    <form className="subida-imagen" action={ejecutar}>
      <input type="hidden" name="campo" value={campo} />
      <div className="field">
        <label htmlFor={`archivo-${campo}`}>{etiqueta}</label>
        {urlActual && (
          // eslint-disable-next-line @next/next/no-img-element -- vista previa simple, no vale next/image
          <img className="subida-preview" src={urlActual} alt={`Vista previa de ${etiqueta}`} />
        )}
        <input id={`archivo-${campo}`} name="archivo" type="file" accept="image/png,image/jpeg,image/webp" required />
      </div>
      <button className="admin-salir" type="submit" disabled={pendiente}>
        {pendiente ? 'Subiendo…' : 'Subir'}
      </button>
      {estado && 'error' in estado && (
        <p className="alerta" role="alert">{estado.error}</p>
      )}
    </form>
  );
}
```

- [ ] **Step 3: Formulario de colores + sellos + vista previa (cliente)**

Create `app/comercio/(protegido)/branding/FormularioBranding.tsx`. Incluye la maqueta simple de colores (spec §6: un `<div>` con los colores elegidos en proporción de tarjeta, con el nombre y —si es sellos— el texto "7 de 10 sellos" de ejemplo; NO una réplica del `.pkpass`). Reutiliza `.cardface`:

```tsx
'use client';

import { useState, type ChangeEvent } from 'react';
import { useActionState } from 'react';
import { accionGuardarBranding, type EstadoBranding } from './actions';

type Props = {
  nombreComercio: string;
  esSellos: boolean;
  inicial: {
    color_fondo: string;
    color_texto: string;
    color_label: string;
    sello_meta: string;
  };
};

export default function FormularioBranding({ nombreComercio, esSellos, inicial }: Props) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoBranding, FormData>(
    accionGuardarBranding,
    undefined,
  );

  // Controlados: para la vista previa en vivo y para no perder lo escrito si la acción rechaza.
  const [valores, setValores] = useState(inicial);
  const cambiar =
    (campo: keyof typeof inicial) =>
    (e: ChangeEvent<HTMLInputElement>) =>
      setValores((v) => ({ ...v, [campo]: e.target.value }));

  const metaEjemplo = valores.sello_meta && Number(valores.sello_meta) > 0 ? Number(valores.sello_meta) : 10;

  return (
    <>
      {/* Maqueta de colores — NO es el pass real (un .pkpass es un zip binario firmado, no se
          renderiza en el navegador). Solo muestra los colores elegidos en proporción de tarjeta. */}
      <div
        className="cardface"
        style={{ background: valores.color_fondo, color: valores.color_texto, marginBottom: 22 }}
      >
        <div className="cardface-top" style={{ color: valores.color_label }}>
          <span>Tarjeta de lealtad</span>
        </div>
        <div className="cardface-name">{nombreComercio}</div>
        <div className="cardface-points">
          {esSellos ? (
            <b style={{ fontSize: '1.4rem' }}>7 de {metaEjemplo} sellos</b>
          ) : (
            <>
              <b>0</b>
              <span style={{ color: valores.color_label }}>Puntos</span>
            </>
          )}
        </div>
      </div>

      <form className="panel" style={{ marginTop: 0 }} action={ejecutar}>
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

        {esSellos && (
          <div className="field">
            <label htmlFor="sello_meta">Meta de sellos</label>
            <input
              id="sello_meta"
              name="sello_meta"
              type="number"
              min="1"
              step="1"
              value={valores.sello_meta}
              onChange={cambiar('sello_meta')}
              placeholder="10"
            />
          </div>
        )}

        <button className="btn-primary" type="submit" disabled={pendiente}>
          {pendiente ? 'Guardando…' : 'Guardar branding'}
        </button>
        {estado && 'error' in estado && (
          <p className="alerta" role="alert">{estado.error}</p>
        )}
        {estado && 'ok' in estado && (
          <p className="nota" style={{ textAlign: 'left' }}>Branding guardado.</p>
        )}
      </form>
    </>
  );
}
```

- [ ] **Step 4: Página de branding (servidor)**

Create `app/comercio/(protegido)/branding/page.tsx`:

```tsx
import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import FormularioBranding from './FormularioBranding';
import SubidaImagen from './SubidaImagen';

export const dynamic = 'force-dynamic';

export default async function PaginaBranding() {
  const { comercioId } = await verifyComercioOwner();

  const supabase = createServiceClient();
  const { data: c } = await supabase
    .from('comercios')
    .select('nombre, tipo_tarjeta, color_fondo, color_texto, color_label, sello_meta, logo_url, strip_url, hero_url, sello_icono_url')
    .eq('id', comercioId)
    .maybeSingle();

  if (!c) {
    return (
      <main className="admin-main">
        <p className="admin-error" role="alert">No se pudo cargar tu comercio. Recarga la página.</p>
      </main>
    );
  }

  const esSellos = c.tipo_tarjeta === 'sellos';

  const imagenes: [string, string, string | null][] = [
    ['logo', 'Logo', c.logo_url],
    ['strip', 'Franja (strip)', c.strip_url],
    ['hero', 'Imagen principal', c.hero_url],
  ];
  if (esSellos) imagenes.push(['sello_icono', 'Ícono del sello', c.sello_icono_url]);

  return (
    <main className="admin-main">
      <div className="admin-encabezado">
        <h1 className="title" style={{ fontSize: '2rem', margin: 0 }}>Branding</h1>
        <Link className="admin-fila-slug" href="/comercio/panel">← Volver</Link>
      </div>

      <FormularioBranding
        nombreComercio={c.nombre}
        esSellos={esSellos}
        inicial={{
          color_fondo: c.color_fondo ?? 'rgb(35, 24, 18)',
          color_texto: c.color_texto ?? 'rgb(255, 255, 255)',
          color_label: c.color_label ?? 'rgb(255, 255, 255)',
          sello_meta: c.sello_meta != null ? String(c.sello_meta) : '',
        }}
      />

      <div className="admin-zona-peligro" style={{ borderTopStyle: 'solid' }}>
        <h2 className="admin-fila-nombre" style={{ marginBottom: 14 }}>Imágenes</h2>
        {imagenes.map(([campo, etiqueta, url]) => (
          <SubidaImagen key={campo} campo={campo} etiqueta={etiqueta} urlActual={url} />
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 5: CSS**

Modify `app/globals.css` — agrega al final:
```css
.subida-imagen {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  margin-bottom: 16px;
}
.subida-imagen .field {
  flex: 1;
  margin-bottom: 0;
}
.subida-preview {
  max-width: 100%;
  max-height: 90px;
  width: auto;
  border-radius: 10px;
  border: 1px solid var(--line);
  margin-bottom: 8px;
  object-fit: contain;
  background: #fff;
}
.field input[type='file'] {
  font-family: var(--font-body);
  font-size: 0.9rem;
  color: var(--ink-soft);
}
```

- [ ] **Step 6: Gates + commit**

Run: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` (**81 passed**).
```bash
git add -A
git commit -m "Add comercio branding page with image upload and preview"
```

---

### Task 13: Reglas de puntos — CRUD (TDD) + página

`reglas_puntos` (tipo, valor). **Hard delete a propósito** (spec §6: sin soft-delete; ninguna regla tiene historial de canjes que dependa de ella, a diferencia de recompensas).

**Files:**
- Create: `lib/comercio/reglas.ts`
- Test: `lib/comercio/reglas.test.ts`
- Create: `app/comercio/(protegido)/reglas/actions.ts`
- Create: `app/comercio/(protegido)/reglas/FormularioRegla.tsx`
- Create: `app/comercio/(protegido)/reglas/page.tsx`

- [ ] **Step 1: Escribir el test que falla**

Create `lib/comercio/reglas.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearRegla, eliminarRegla } from './reglas';

const supabase = createServiceClient();
const comerciosDePrueba: string[] = [];

afterEach(async () => {
  if (!comerciosDePrueba.length) return;
  // reglas_puntos apunta a comercios sin cascade: borrar reglas antes que su comercio.
  await supabase.from('reglas_puntos').delete().in('comercio_id', comerciosDePrueba);
  const { error } = await supabase.from('comercios').delete().in('id', comerciosDePrueba);
  if (error) console.error('[test] no se pudieron borrar los comercios de prueba:', error);
  comerciosDePrueba.length = 0;
});

async function crearComercio(): Promise<string> {
  const slug = `test-reglas-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase.from('comercios').insert({ nombre: 'Reglas', slug }).select('id').single();
  if (error) throw error;
  comerciosDePrueba.push(data.id);
  return data.id;
}

describe('crearRegla', () => {
  it('crea una regla por_visita', async () => {
    const comercioId = await crearComercio();
    const res = await crearRegla(supabase, comercioId, { tipo: 'por_visita', valor: 1 });

    expect(res.ok).toBe(true);
    const { data } = await supabase.from('reglas_puntos').select('tipo, valor').eq('comercio_id', comercioId).single();
    expect(data!.tipo).toBe('por_visita');
    expect(data!.valor).toBe(1);
  });

  it('rechaza un tipo que la BD no acepta', async () => {
    const comercioId = await crearComercio();
    const res = await crearRegla(supabase, comercioId, { tipo: 'por_lo_que_sea', valor: 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/tipo/i);
  });

  it('rechaza un valor no positivo', async () => {
    const comercioId = await crearComercio();
    const res = await crearRegla(supabase, comercioId, { tipo: 'por_monto', valor: 0 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/valor/i);
  });
});

describe('eliminarRegla', () => {
  it('elimina una regla del comercio', async () => {
    const comercioId = await crearComercio();
    const creada = await crearRegla(supabase, comercioId, { tipo: 'por_visita', valor: 1 });
    if (!creada.ok) throw new Error('el setup falló');

    const res = await eliminarRegla(supabase, creada.id, comercioId);
    expect(res.ok).toBe(true);
    const { data } = await supabase.from('reglas_puntos').select('id').eq('id', creada.id).maybeSingle();
    expect(data).toBeNull();
  });

  it('no elimina una regla de OTRO comercio', async () => {
    // El .eq('comercio_id', comercioId) evita que un dueño borre reglas ajenas manipulando el id.
    const comercioA = await crearComercio();
    const comercioB = await crearComercio();
    const creada = await crearRegla(supabase, comercioA, { tipo: 'por_visita', valor: 1 });
    if (!creada.ok) throw new Error('el setup falló');

    const res = await eliminarRegla(supabase, creada.id, comercioB);
    expect(res.ok).toBe(false);

    const { data } = await supabase.from('reglas_puntos').select('id').eq('id', creada.id).maybeSingle();
    expect(data).not.toBeNull(); // sigue existiendo: no era de comercioB
  });
});
```

Run: `npm test -- reglas`
Expected: FAIL — `Cannot find module './reglas'`.

- [ ] **Step 2: Implementar**

Create `lib/comercio/reglas.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

// Espejo del check de la BD (migración 0001: tipo in ('por_visita','por_monto')). El <select> del
// formulario se construye desde esta constante.
export const TIPOS_REGLA = [
  { valor: 'por_visita', etiqueta: 'Por visita' },
  { valor: 'por_monto', etiqueta: 'Por monto' },
] as const;

export interface DatosRegla {
  tipo: string;
  valor: number;
}

export type ResultadoRegla = { ok: true; id: string } | { ok: false; error: string };

export async function crearRegla(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  datos: DatosRegla,
): Promise<ResultadoRegla> {
  if (!TIPOS_REGLA.some((t) => t.valor === datos.tipo)) {
    // Sin esto, un tipo inválido cae en el 23514 de la BD → mensaje genérico sin explicar qué pasó.
    return { ok: false, error: 'El tipo de regla debe ser "por visita" o "por monto".' };
  }
  if (!Number.isFinite(datos.valor) || datos.valor <= 0) {
    return { ok: false, error: 'El valor de la regla debe ser un número mayor que cero.' };
  }

  const { data, error } = await supabase
    .from('reglas_puntos')
    .insert({ comercio_id: comercioId, tipo: datos.tipo, valor: datos.valor })
    .select('id')
    .single();

  if (error) {
    console.error('[comercio] falló el insert de regla:', error);
    return { ok: false, error: 'No se pudo crear la regla.' };
  }
  return { ok: true, id: data.id };
}

// Hard delete a propósito (spec §6): ninguna regla tiene historial que dependa de ella. Scopeado
// por comercio_id (del gate) para que un dueño no borre reglas de otro comercio manipulando el id.
export async function eliminarRegla(
  supabase: SupabaseClient<Database>,
  id: string,
  comercioId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase
    .from('reglas_puntos')
    .delete()
    .eq('id', id)
    .eq('comercio_id', comercioId)
    .select('id')
    .single();

  if (error) {
    // PGRST116 = 0 filas: el id no existe o no es de este comercio. En ambos casos, para el dueño,
    // "esa regla no existe (para ti)" — no la borramos, no reportamos éxito falso.
    if (error.code === 'PGRST116') {
      return { ok: false, error: 'Esa regla ya no existe.' };
    }
    console.error('[comercio] falló el borrado de regla:', error);
    return { ok: false, error: 'No se pudo eliminar la regla.' };
  }
  return { ok: true };
}
```

Run: `npm test -- reglas`
Expected: 5 passed.

- [ ] **Step 3: Server Actions**

Create `app/comercio/(protegido)/reglas/actions.ts`:

```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { crearRegla, eliminarRegla } from '@/lib/comercio/reglas';

export type EstadoRegla = { error: string } | undefined;

export async function accionCrearRegla(
  _estadoPrevio: EstadoRegla,
  formData: FormData,
): Promise<EstadoRegla> {
  const { comercioId } = await verifyComercioOwner();

  const valorTexto = String(formData.get('valor') ?? '').trim();
  const res = await crearRegla(createServiceClient(), comercioId, {
    tipo: String(formData.get('tipo') ?? ''),
    valor: valorTexto === '' ? NaN : Number(valorTexto),
  });
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/reglas');
  return undefined;
}

export async function accionEliminarRegla(
  id: string,
  _estadoPrevio: EstadoRegla,
  _formData: FormData,
): Promise<EstadoRegla> {
  const { comercioId } = await verifyComercioOwner();

  const res = await eliminarRegla(createServiceClient(), id, comercioId);
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/reglas');
  return undefined;
}
```

- [ ] **Step 4: Formulario (cliente)**

Create `app/comercio/(protegido)/reglas/FormularioRegla.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { accionCrearRegla, type EstadoRegla } from './actions';
import { TIPOS_REGLA } from '@/lib/comercio/reglas';

export default function FormularioRegla() {
  const [estado, ejecutar, pendiente] = useActionState<EstadoRegla, FormData>(accionCrearRegla, undefined);

  return (
    <form className="panel" style={{ marginTop: 0 }} action={ejecutar}>
      <div className="field">
        <label htmlFor="tipo">Tipo de regla</label>
        <select id="tipo" name="tipo" defaultValue="por_visita">
          {TIPOS_REGLA.map((t) => (
            <option key={t.valor} value={t.valor}>{t.etiqueta}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="valor">Valor (puntos por visita, o puntos por unidad de monto)</label>
        <input id="valor" name="valor" type="number" min="0.01" step="0.01" required />
      </div>
      <button className="btn-primary" type="submit" disabled={pendiente}>
        {pendiente ? 'Agregando…' : 'Agregar regla'}
      </button>
      {estado?.error && <p className="alerta" role="alert">{estado.error}</p>}
    </form>
  );
}
```

- [ ] **Step 5: Botón eliminar (cliente)**

Create `app/comercio/(protegido)/reglas/BotonEliminarRegla.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { accionEliminarRegla, type EstadoRegla } from './actions';

export default function BotonEliminarRegla({ id }: { id: string }) {
  const accion = accionEliminarRegla.bind(null, id);
  const [estado, ejecutar, pendiente] = useActionState<EstadoRegla, FormData>(accion, undefined);

  return (
    <form
      action={ejecutar}
      onSubmit={(e) => {
        if (!window.confirm('¿Eliminar esta regla?')) e.preventDefault();
      }}
    >
      <button className="admin-eliminar" type="submit" disabled={pendiente}>
        {pendiente ? 'Eliminando…' : 'Eliminar'}
      </button>
      {estado?.error && <p className="alerta" role="alert">{estado.error}</p>}
    </form>
  );
}
```

- [ ] **Step 6: Página (servidor)**

Create `app/comercio/(protegido)/reglas/page.tsx`:

```tsx
import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { TIPOS_REGLA } from '@/lib/comercio/reglas';
import FormularioRegla from './FormularioRegla';
import BotonEliminarRegla from './BotonEliminarRegla';

export const dynamic = 'force-dynamic';

export default async function PaginaReglas() {
  const { comercioId } = await verifyComercioOwner();

  const supabase = createServiceClient();
  const { data: reglas, error } = await supabase
    .from('reglas_puntos')
    .select('id, tipo, valor')
    .eq('comercio_id', comercioId)
    .order('activa_desde', { ascending: false });

  if (error) console.error('[comercio] falló la consulta de reglas:', error);

  const etiquetaTipo = (tipo: string) => TIPOS_REGLA.find((t) => t.valor === tipo)?.etiqueta ?? tipo;

  return (
    <main className="admin-main">
      <div className="admin-encabezado">
        <h1 className="title" style={{ fontSize: '2rem', margin: 0 }}>Reglas de puntos</h1>
        <Link className="admin-fila-slug" href="/comercio/panel">← Volver</Link>
      </div>

      <FormularioRegla />

      <div className="admin-lista" style={{ marginTop: 22 }}>
        {error ? (
          <p className="admin-error" role="alert">No se pudieron cargar las reglas. Recarga la página.</p>
        ) : !reglas || reglas.length === 0 ? (
          <p className="admin-vacio">Todavía no hay reglas. Agrega la primera.</p>
        ) : (
          reglas.map((r) => (
            <div key={r.id} className="admin-fila">
              <div>
                <div className="admin-fila-nombre">{etiquetaTipo(r.tipo)}</div>
                <div className="admin-fila-slug">Valor: {r.valor}</div>
              </div>
              <BotonEliminarRegla id={r.id} />
            </div>
          ))
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 7: Gates + commit**

Run: `npm test` → **86 passed** (81 + 5). Run `npm run build`, `npm run typecheck`, `npm run lint`.
Confirma 0 comercios `test-reglas-%` huérfanos.
```bash
git add -A
git commit -m "Add reglas de puntos CRUD for the owner panel"
```

---

### Task 14: Recompensas — CRUD (TDD) + página. **BORRADO = SOFT-DELETE**

`recompensas`. **El borrado DEBE ser `update({activa:false})`, NUNCA `.delete()`** (spec §6 y hecho verificado #3). Es la PRIMERA vez que se escribe este soft-delete — no hay nada que reutilizar, y NO se debe copiar el hard delete de `eliminarComercio`. Borrar de verdad rompería el historial de `canjes.recompensa_id` (aunque el canje aún no exista, la FK y la intención sí).

**Files:**
- Create: `lib/comercio/recompensas.ts`
- Test: `lib/comercio/recompensas.test.ts`
- Create: `app/comercio/(protegido)/recompensas/actions.ts`
- Create: `app/comercio/(protegido)/recompensas/FormularioRecompensa.tsx`
- Create: `app/comercio/(protegido)/recompensas/BotonDesactivarRecompensa.tsx`
- Create: `app/comercio/(protegido)/recompensas/page.tsx`

- [ ] **Step 1: Escribir el test que falla**

Create `lib/comercio/recompensas.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearRecompensa, desactivarRecompensa } from './recompensas';

const supabase = createServiceClient();
const comerciosDePrueba: string[] = [];

afterEach(async () => {
  if (!comerciosDePrueba.length) return;
  // recompensas apunta a comercios sin cascade: borrar recompensas antes que su comercio.
  await supabase.from('recompensas').delete().in('comercio_id', comerciosDePrueba);
  const { error } = await supabase.from('comercios').delete().in('id', comerciosDePrueba);
  if (error) console.error('[test] no se pudieron borrar los comercios de prueba:', error);
  comerciosDePrueba.length = 0;
});

async function crearComercio(): Promise<string> {
  const slug = `test-recomp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase.from('comercios').insert({ nombre: 'Recomp', slug }).select('id').single();
  if (error) throw error;
  comerciosDePrueba.push(data.id);
  return data.id;
}

function datosValidos() {
  return { nombre: 'Café gratis', descripcion: 'Un café de la casa', costo_puntos: 100, tipo: 'articulo_gratis', valor: null as string | null };
}

describe('crearRecompensa', () => {
  it('crea una recompensa', async () => {
    const comercioId = await crearComercio();
    const res = await crearRecompensa(supabase, comercioId, datosValidos());

    expect(res.ok).toBe(true);
    const { data } = await supabase.from('recompensas').select('nombre, activa').eq('comercio_id', comercioId).single();
    expect(data!.nombre).toBe('Café gratis');
    expect(data!.activa).toBe(true);
  });

  it('rechaza un tipo inválido', async () => {
    const comercioId = await crearComercio();
    const res = await crearRecompensa(supabase, comercioId, { ...datosValidos(), tipo: 'inventado' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/tipo/i);
  });

  it('rechaza un costo_puntos no positivo', async () => {
    const comercioId = await crearComercio();
    const res = await crearRecompensa(supabase, comercioId, { ...datosValidos(), costo_puntos: 0 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/costo|puntos/i);
  });
});

describe('desactivarRecompensa', () => {
  it('desactiva con SOFT-DELETE: la fila SIGUE existiendo con activa=false', async () => {
    // ESTE es el test linchpin. Si alguien implementa desactivar con .delete() en vez de
    // update({activa:false}), este test falla: data sería null. El historial de canjes.recompensa_id
    // depende de que la fila NO desaparezca.
    const comercioId = await crearComercio();
    const creada = await crearRecompensa(supabase, comercioId, datosValidos());
    if (!creada.ok) throw new Error('el setup falló');

    const res = await desactivarRecompensa(supabase, creada.id, comercioId);
    expect(res.ok).toBe(true);

    const { data } = await supabase.from('recompensas').select('activa').eq('id', creada.id).maybeSingle();
    expect(data).not.toBeNull();      // NO se borró la fila
    expect(data!.activa).toBe(false); // se marcó inactiva
  });

  it('no desactiva una recompensa de OTRO comercio', async () => {
    const comercioA = await crearComercio();
    const comercioB = await crearComercio();
    const creada = await crearRecompensa(supabase, comercioA, datosValidos());
    if (!creada.ok) throw new Error('el setup falló');

    const res = await desactivarRecompensa(supabase, creada.id, comercioB);
    expect(res.ok).toBe(false);

    const { data } = await supabase.from('recompensas').select('activa').eq('id', creada.id).maybeSingle();
    expect(data!.activa).toBe(true); // intacta: no era de comercioB
  });
});
```

Run: `npm test -- recompensas`
Expected: FAIL — `Cannot find module './recompensas'`.

- [ ] **Step 2: Implementar**

Create `lib/comercio/recompensas.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

// Espejo del check de la BD (migración 0001: tipo in ('codigo_descuento','articulo_gratis','otro')).
export const TIPOS_RECOMPENSA = [
  { valor: 'codigo_descuento', etiqueta: 'Código de descuento' },
  { valor: 'articulo_gratis', etiqueta: 'Artículo gratis' },
  { valor: 'otro', etiqueta: 'Otro' },
] as const;

export interface DatosRecompensa {
  nombre: string;
  descripcion: string | null;
  costo_puntos: number;
  tipo: string;
  valor: string | null;
}

export type ResultadoRecompensa = { ok: true; id: string } | { ok: false; error: string };

export async function crearRecompensa(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  datos: DatosRecompensa,
): Promise<ResultadoRecompensa> {
  const nombre = datos.nombre.trim();
  if (!nombre) return { ok: false, error: 'El nombre de la recompensa es obligatorio.' };
  if (!TIPOS_RECOMPENSA.some((t) => t.valor === datos.tipo)) {
    return { ok: false, error: 'El tipo de recompensa no es válido.' };
  }
  if (!Number.isInteger(datos.costo_puntos) || datos.costo_puntos <= 0) {
    return { ok: false, error: 'El costo en puntos debe ser un número entero mayor que cero.' };
  }

  const { data, error } = await supabase
    .from('recompensas')
    .insert({
      comercio_id: comercioId,
      nombre,
      descripcion: datos.descripcion?.trim() || null,
      costo_puntos: datos.costo_puntos,
      tipo: datos.tipo,
      valor: datos.valor?.trim() || null,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[comercio] falló el insert de recompensa:', error);
    return { ok: false, error: 'No se pudo crear la recompensa.' };
  }
  return { ok: true, id: data.id };
}

// SOFT-DELETE — update({activa:false}), NUNCA .delete(). El historial de canjes.recompensa_id
// (Fase 4) depende de que la fila NO desaparezca. Es la primera vez que se escribe este patrón en
// el proyecto: no copiar el hard delete de eliminarComercio. Scopeado por comercio_id (del gate).
export async function desactivarRecompensa(
  supabase: SupabaseClient<Database>,
  id: string,
  comercioId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase
    .from('recompensas')
    .update({ activa: false })
    .eq('id', id)
    .eq('comercio_id', comercioId)
    .select('id')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return { ok: false, error: 'Esa recompensa ya no existe.' };
    }
    console.error('[comercio] falló la desactivación de recompensa:', error);
    return { ok: false, error: 'No se pudo desactivar la recompensa.' };
  }
  return { ok: true };
}
```

Run: `npm test -- recompensas`
Expected: 5 passed.

- [ ] **Step 3: Server Actions**

Create `app/comercio/(protegido)/recompensas/actions.ts`:

```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { crearRecompensa, desactivarRecompensa } from '@/lib/comercio/recompensas';

export type EstadoRecompensa = { error: string } | undefined;

export async function accionCrearRecompensa(
  _estadoPrevio: EstadoRecompensa,
  formData: FormData,
): Promise<EstadoRecompensa> {
  const { comercioId } = await verifyComercioOwner();

  const costoTexto = String(formData.get('costo_puntos') ?? '').trim();
  const res = await crearRecompensa(createServiceClient(), comercioId, {
    nombre: String(formData.get('nombre') ?? ''),
    descripcion: String(formData.get('descripcion') ?? '') || null,
    costo_puntos: costoTexto === '' ? NaN : Number(costoTexto),
    tipo: String(formData.get('tipo') ?? ''),
    valor: String(formData.get('valor') ?? '') || null,
  });
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/recompensas');
  return undefined;
}

// Desactiva (soft-delete), NO borra. La función de datos ya lo garantiza; la acción solo delega.
export async function accionDesactivarRecompensa(
  id: string,
  _estadoPrevio: EstadoRecompensa,
  _formData: FormData,
): Promise<EstadoRecompensa> {
  const { comercioId } = await verifyComercioOwner();

  const res = await desactivarRecompensa(createServiceClient(), id, comercioId);
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/recompensas');
  return undefined;
}
```

- [ ] **Step 4: Formulario (cliente)**

Create `app/comercio/(protegido)/recompensas/FormularioRecompensa.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { accionCrearRecompensa, type EstadoRecompensa } from './actions';
import { TIPOS_RECOMPENSA } from '@/lib/comercio/recompensas';

export default function FormularioRecompensa() {
  const [estado, ejecutar, pendiente] = useActionState<EstadoRecompensa, FormData>(
    accionCrearRecompensa,
    undefined,
  );

  return (
    <form className="panel" style={{ marginTop: 0 }} action={ejecutar}>
      <div className="field">
        <label htmlFor="nombre">Nombre</label>
        <input id="nombre" name="nombre" required />
      </div>
      <div className="field">
        <label htmlFor="descripcion">Descripción (opcional)</label>
        <input id="descripcion" name="descripcion" />
      </div>
      <div className="field">
        <label htmlFor="costo_puntos">Costo en puntos</label>
        <input id="costo_puntos" name="costo_puntos" type="number" min="1" step="1" required />
      </div>
      <div className="field">
        <label htmlFor="tipo">Tipo</label>
        <select id="tipo" name="tipo" defaultValue="articulo_gratis">
          {TIPOS_RECOMPENSA.map((t) => (
            <option key={t.valor} value={t.valor}>{t.etiqueta}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="valor">Valor (opcional — ej. el código de descuento)</label>
        <input id="valor" name="valor" />
      </div>
      <button className="btn-primary" type="submit" disabled={pendiente}>
        {pendiente ? 'Agregando…' : 'Agregar recompensa'}
      </button>
      {estado?.error && <p className="alerta" role="alert">{estado.error}</p>}
    </form>
  );
}
```

- [ ] **Step 5: Botón desactivar (cliente)**

Create `app/comercio/(protegido)/recompensas/BotonDesactivarRecompensa.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { accionDesactivarRecompensa, type EstadoRecompensa } from './actions';

export default function BotonDesactivarRecompensa({ id, nombre }: { id: string; nombre: string }) {
  const accion = accionDesactivarRecompensa.bind(null, id);
  const [estado, ejecutar, pendiente] = useActionState<EstadoRecompensa, FormData>(accion, undefined);

  return (
    <form
      action={ejecutar}
      onSubmit={(e) => {
        if (!window.confirm(`¿Desactivar "${nombre}"? Dejará de estar disponible, pero su historial se conserva.`)) {
          e.preventDefault();
        }
      }}
    >
      <button className="admin-eliminar" type="submit" disabled={pendiente}>
        {pendiente ? 'Desactivando…' : 'Desactivar'}
      </button>
      {estado?.error && <p className="alerta" role="alert">{estado.error}</p>}
    </form>
  );
}
```

- [ ] **Step 6: Página (servidor)**

Create `app/comercio/(protegido)/recompensas/page.tsx`. Muestra solo las activas (las desactivadas quedan en la BD para el historial, pero no se listan):

```tsx
import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { TIPOS_RECOMPENSA } from '@/lib/comercio/recompensas';
import FormularioRecompensa from './FormularioRecompensa';
import BotonDesactivarRecompensa from './BotonDesactivarRecompensa';

export const dynamic = 'force-dynamic';

export default async function PaginaRecompensas() {
  const { comercioId } = await verifyComercioOwner();

  const supabase = createServiceClient();
  const { data: recompensas, error } = await supabase
    .from('recompensas')
    .select('id, nombre, descripcion, costo_puntos, tipo')
    .eq('comercio_id', comercioId)
    .eq('activa', true) // las desactivadas siguen en la BD (soft-delete), pero no se listan
    .order('costo_puntos');

  if (error) console.error('[comercio] falló la consulta de recompensas:', error);

  const etiquetaTipo = (tipo: string) => TIPOS_RECOMPENSA.find((t) => t.valor === tipo)?.etiqueta ?? tipo;

  return (
    <main className="admin-main">
      <div className="admin-encabezado">
        <h1 className="title" style={{ fontSize: '2rem', margin: 0 }}>Recompensas</h1>
        <Link className="admin-fila-slug" href="/comercio/panel">← Volver</Link>
      </div>

      <FormularioRecompensa />

      <div className="admin-lista" style={{ marginTop: 22 }}>
        {error ? (
          <p className="admin-error" role="alert">No se pudieron cargar las recompensas. Recarga la página.</p>
        ) : !recompensas || recompensas.length === 0 ? (
          <p className="admin-vacio">Todavía no hay recompensas. Agrega la primera.</p>
        ) : (
          recompensas.map((r) => (
            <div key={r.id} className="admin-fila">
              <div>
                <div className="admin-fila-nombre">{r.nombre}</div>
                <div className="admin-fila-slug">
                  {r.costo_puntos} puntos · {etiquetaTipo(r.tipo)}
                  {r.descripcion ? ` · ${r.descripcion}` : ''}
                </div>
              </div>
              <BotonDesactivarRecompensa id={r.id} nombre={r.nombre} />
            </div>
          ))
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 7: Gates + commit**

Run: `npm test` → **91 passed** (86 + 5). Run `npm run build`, `npm run typecheck`, `npm run lint`.
Confirma 0 comercios `test-recomp-%` huérfanos.
```bash
git add -A
git commit -m "Add recompensas CRUD with soft-delete for the owner panel"
```

---

### Task 15: Cuenta de dueño + verificación manual end-to-end del panel

**Files:**
- Create: `scripts/seed-usuario-comercio.ts`
- Modify: `package.json`

- [ ] **Step 1: Script de alta de la cuenta de dueño**

Template de `scripts/seed-usuario-fm.ts`, con dos diferencias: recibe el **slug** del comercio como 3er argumento (para resolver `comercio_id`), y el upsert usa **`onConflict: 'email'`** (NO `'auth_user_id'`: en `usuarios_comercio` esa columna es nullable y no única — no hay restricción a la cual apuntar y `'auth_user_id'` fallaría).

Create `scripts/seed-usuario-comercio.ts`:

```typescript
// Ejecutar vía: npm run seed-comercio -- correo@ejemplo.com "contraseña" slug-del-comercio
// Crea la cuenta de un DUEÑO en Supabase Auth y su fila (rol 'owner') en usuarios_comercio.
// Idempotente: si el correo ya existe en Auth, solo asegura la fila. No envía invitación por
// correo (este proyecto no tiene servicio de email) — FM corre esto a mano al dar de alta un dueño.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

async function main() {
  const [email, password, slug] = process.argv.slice(2);
  if (!email || !password || !slug) {
    throw new Error('Uso: npm run seed-comercio -- correo@ejemplo.com "contraseña" slug-del-comercio');
  }

  const supabase = createServiceClient();

  // Resolver el comercio por slug ANTES del upsert (la fila necesita comercio_id).
  const { data: comercio, error: errorComercio } = await supabase
    .from('comercios')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (errorComercio) throw errorComercio;
  if (!comercio) throw new Error(`No existe ningún comercio con slug "${slug}".`);

  // Crear la cuenta de Auth (o reutilizar si ya existe).
  const { data: creado, error: errorCrear } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  let authUserId = creado?.user?.id;

  if (errorCrear) {
    const { data: lista, error: errorLista } = await supabase.auth.admin.listUsers();
    if (errorLista) throw errorLista;
    const existente = lista.users.find((u) => u.email === email);
    if (!existente) throw errorCrear;
    authUserId = existente.id;
    console.log('La cuenta ya existía en Auth; se reutiliza.');
  }

  // onConflict: 'email' — la ÚNICA columna única de usuarios_comercio aparte de id. auth_user_id
  // aquí es nullable y NO único (a diferencia de usuarios_fm), así que 'auth_user_id' fallaría.
  const { error: errorFila } = await supabase
    .from('usuarios_comercio')
    .upsert(
      { comercio_id: comercio.id, email, rol: 'owner', auth_user_id: authUserId! },
      { onConflict: 'email' },
    );
  if (errorFila) throw errorFila;

  console.log(`Listo. Dueño habilitado para "${slug}":`, email);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Modify `package.json` scripts (junto a `seed-fm`):
```json
    "seed-comercio": "tsx --conditions=react-server scripts/seed-usuario-comercio.ts",
```

- [ ] **Step 2: Crear una cuenta de dueño real (Cafetería Piloto)**

Run (correo y contraseña reales del dueño piloto):
```bash
npm run seed-comercio -- dueno@ejemplo.com "una-contraseña-fuerte" cafeteria-piloto
```
Expected: `Listo. Dueño habilitado para "cafeteria-piloto": …`. Verifica en Studio que exista la fila en `usuarios_comercio` con `rol='owner'` y `auth_user_id` poblado.

- [ ] **Step 3: Verificación manual end-to-end (local)**

Run: `npm run seed-bucket` (si no lo hiciste ya), luego `npm run dev`. En el navegador:

1. `/comercio/panel` sin sesión → redirige a `/comercio/login`.
2. Login del dueño con credenciales incorrectas → mensaje amable, sin 500.
3. Login correcto → `/comercio/panel`, muestra el nombre y el tipo de tarjeta.
4. Con FM (panel `/admin`): edita Cafetería Piloto y pon **tipo de tarjeta = Sellos**; verifica que los 6 no disponibles aparecen "(Próximamente)" y deshabilitados.
5. En `/comercio/branding`: aparecen el campo **Meta de sellos** y la subida **Ícono del sello** (porque el tipo es sellos). Cambia colores → la maqueta de arriba cambia en vivo. Pon meta = 10 → Guardar → "Branding guardado.".
6. Sube un logo (PNG < 2 MB) → aparece la vista previa. Sube un archivo `.txt` → mensaje "Formato no permitido".
7. En `/comercio/reglas`: agrega una regla "por visita, valor 1" → aparece en la lista. Elimínala → desaparece.
8. En `/comercio/recompensas`: agrega "Café gratis, 100 puntos" → aparece. Desactívala → desaparece de la lista (pero sigue en la BD: confírmalo en Studio, `activa=false`).
9. Registra un cliente en `/registro/cafeteria-piloto`, agrega la tarjeta a Apple Wallet y confirma que el campo primario dice **"0 de 10 sellos"** (tipo sellos + meta 10). Súmale puntos con el endpoint de cajero y confirma que pasa a "1 de 10 sellos".
10. Vuelve el tipo de Cafetería Piloto a **Puntos** (para no dejar el piloto alterado) — el pass vuelve a mostrar el número. **Salir** → `/comercio/login`.

Limpia cualquier dato de prueba que hayas creado (reglas/recompensas de juguete) en Studio.

- [ ] **Step 4: Commit**

Run: `npm run typecheck`, `npm run lint`, `npm test` (**91 passed**).
```bash
git add -A
git commit -m "Add owner account seed script"
```

---

### Task 16: Playwright — pruebas end-to-end de los caminos críticos

Agrega Playwright como dependencia de desarrollo y las 3 pruebas del spec §8. **No cuentan para `npm test`** (Vitest); corren con `npm run e2e`. No hay CI: corren localmente.

> ⚠️ Estas pruebas golpean la BD real (no hay entorno separado). Deben usar datos desechables con teléfono/slug únicos y limpiar tras de sí, igual que los tests de integración. El flujo de FM crea y BORRA su propio comercio; el de registro usa un teléfono único por corrida.

**Files:**
- Modify: `package.json`
- Modify: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `e2e/registro.spec.ts`
- Create: `e2e/fm-comercios.spec.ts`
- Create: `e2e/owner-branding.spec.ts`
- Create: `e2e/fixtures/logo.png` (una imagen PNG pequeña de prueba)

- [ ] **Step 1: Instalar Playwright**

Run:
```bash
npm install -D @playwright/test
npx playwright install chromium
```
Expected: instala sin conflicto de peer deps y descarga el binario de Chromium. Si el install de peer deps falla, repórtalo — NO uses `--force`.

- [ ] **Step 2: Evitar que Vitest agarre los `.spec.ts` de Playwright**

El glob por defecto de Vitest atrapa `**/*.spec.ts`. Excluye `e2e/`.

Modify `vitest.config.ts` — importa `configDefaults` y agrega `exclude`:
```typescript
import { defineConfig, configDefaults } from 'vitest/config';
```
Dentro de `test: { … }`, agrega:
```typescript
    // Los .spec.ts de Playwright viven en e2e/ y usan otro runner; Vitest no debe tocarlos.
    exclude: [...configDefaults.exclude, 'e2e/**'],
```

- [ ] **Step 3: Config de Playwright**

Create `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test';

// Levanta el dev server automáticamente y corre contra él. Sin CI: reutiliza un server ya abierto.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:3000' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
```

Modify `package.json` scripts:
```json
    "e2e": "playwright test",
```

- [ ] **Step 4: Flujo 1 — registro público → pass descargable**

Create `e2e/registro.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Corregido tras revisión: la versión anterior de este archivo no tenía forma de borrar lo que
// crea (solo tenía `page`/`request`) — cada corrida de `npm run e2e` habría dejado un cliente y
// una tarjeta huérfanos en la BD compartida de producción, para siempre. Se agrega un cliente
// de servicio y un afterEach que limpia por teléfono, sin importar si el test pasó o falló.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

let telefonoDePrueba: string | null = null;

test.afterEach(async () => {
  if (!telefonoDePrueba) return;
  // Orden FK-safe: tarjeta (hijo) antes que cliente (padre) — mismo orden que usan los tests
  // de integración de Vitest en este proyecto.
  const { data: cliente } = await supabase
    .from('clientes')
    .select('id')
    .eq('telefono', telefonoDePrueba)
    .maybeSingle();
  if (cliente) {
    await supabase.from('tarjetas').delete().eq('cliente_id', cliente.id);
    await supabase.from('clientes').delete().eq('id', cliente.id);
  }
  telefonoDePrueba = null;
});

// Registro de cliente real en la Cafetería Piloto → el botón de Apple Wallet apunta a un .pkpass
// descargable con Content-Type correcto. Teléfono único por corrida para no chocar con el unique.
test('registro público entrega un pass descargable', async ({ page, request }) => {
  await page.goto('/registro/cafeteria-piloto');

  const telefono = `7${Date.now().toString().slice(-7)}`;
  // Se registra para limpieza ANTES del submit — si algo falla después, el afterEach igual
  // encuentra y borra el cliente si el registro alcanzó a crearlo.
  telefonoDePrueba = telefono;
  await page.getByLabel('Nombre').fill('Cliente E2E');
  await page.getByLabel('Teléfono').fill(telefono);
  await page.getByRole('button', { name: /crear mi tarjeta/i }).click();

  const enlace = page.getByRole('link', { name: /agregar a apple wallet/i });
  await expect(enlace).toBeVisible();

  const href = await enlace.getAttribute('href');
  expect(href).toMatch(/\/api\/tarjetas\/.+\/pass\.pkpass$/);

  // El endpoint responde un .pkpass real (no un 404/500).
  const resp = await request.get(href!);
  expect(resp.status()).toBe(200);
  expect(resp.headers()['content-type']).toContain('application/vnd.apple.pkpass');
});
```

- [ ] **Step 5: Flujo 2 — FM login → crear/editar/eliminar comercio**

Create `e2e/fm-comercios.spec.ts`. Lee credenciales de FM desde env (`E2E_FM_EMAIL`, `E2E_FM_PASSWORD`); crea un comercio desechable con slug único y lo elimina al final (autolimpieza — no tiene datos asociados, así que el hard delete de FM lo permite):

```typescript
import { test, expect } from '@playwright/test';

const EMAIL = process.env.E2E_FM_EMAIL;
const PASSWORD = process.env.E2E_FM_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'Define E2E_FM_EMAIL y E2E_FM_PASSWORD en .env.local para este flujo.');

test('FM inicia sesión, crea, edita y elimina un comercio', async ({ page }) => {
  await page.goto('/admin/login');
  await page.getByLabel('Correo').fill(EMAIL!);
  await page.getByLabel('Contraseña').fill(PASSWORD!);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/admin\/comercios/);

  const slug = `e2e-${Date.now()}`;
  await page.getByRole('link', { name: /nuevo comercio/i }).click();
  await page.getByLabel('Nombre').fill('Comercio E2E');
  await page.getByLabel(/slug/i).fill(slug);
  await page.getByLabel('Color de fondo').fill('rgb(35, 24, 18)');
  await page.getByLabel('Color de texto').fill('rgb(255, 255, 255)');
  await page.getByLabel('Color de etiqueta').fill('rgb(255, 255, 255)');
  await page.getByRole('button', { name: /crear comercio/i }).click();
  await expect(page).toHaveURL(/\/admin\/comercios/);
  await expect(page.getByText('Comercio E2E')).toBeVisible();

  // Editar
  await page.getByText('Comercio E2E').click();
  await page.getByLabel('Nombre').fill('Comercio E2E Editado');
  await page.getByRole('button', { name: /guardar cambios/i }).click();
  await expect(page.getByText('Comercio E2E Editado')).toBeVisible();

  // Eliminar (autolimpieza). Acepta el window.confirm.
  await page.getByText('Comercio E2E Editado').click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /eliminar comercio/i }).click();
  await expect(page).toHaveURL(/\/admin\/comercios/);
  await expect(page.getByText('Comercio E2E Editado')).toHaveCount(0);
});
```

- [ ] **Step 6: Flujo 3 — dueño login → editar branding con imagen → verificar reflejo**

Create `e2e/owner-branding.spec.ts`. Lee credenciales del dueño desde env (`E2E_OWNER_EMAIL`, `E2E_OWNER_PASSWORD` — la cuenta creada en la Tarea 15). Sube el fixture y verifica que la vista previa aparece:

```typescript
import { test, expect } from '@playwright/test';
import path from 'node:path';

const EMAIL = process.env.E2E_OWNER_EMAIL;
const PASSWORD = process.env.E2E_OWNER_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'Define E2E_OWNER_EMAIL y E2E_OWNER_PASSWORD en .env.local para este flujo.');

test('el dueño edita branding y sube una imagen que se refleja', async ({ page }) => {
  await page.goto('/comercio/login');
  await page.getByLabel('Correo').fill(EMAIL!);
  await page.getByLabel('Contraseña').fill(PASSWORD!);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/comercio\/panel/);

  await page.goto('/comercio/branding');
  await page.getByLabel('Color de fondo').fill('rgb(20, 40, 60)');
  await page.getByRole('button', { name: /guardar branding/i }).click();
  await expect(page.getByText(/branding guardado/i)).toBeVisible();

  // Subir el logo y verificar que aparece una vista previa (<img> con la URL pública + ?v=).
  // Hay un botón "Subir" por imagen: se apunta al form que contiene #archivo-logo con :has()
  // (un <form> sin nombre accesible NO tiene rol ARIA "form", así que getByRole('form') no sirve).
  await page.setInputFiles('#archivo-logo', path.join(__dirname, 'fixtures', 'logo.png'));
  await page.locator('form:has(#archivo-logo)').getByRole('button', { name: /subir/i }).click();
  await expect(page.locator('img.subida-preview').first()).toBeVisible();
});
```

Nota: crea `e2e/fixtures/logo.png` — cualquier PNG pequeño real (≤ 2 MB) sirve. Puedes copiar `passModels/loyalty.pass/icon.png`:
```bash
mkdir -p e2e/fixtures && cp passModels/loyalty.pass/icon.png e2e/fixtures/logo.png
```

- [ ] **Step 7: Correr los e2e**

Asegúrate de tener en `.env.local` (además de las de Supabase) las de prueba: `E2E_FM_EMAIL`, `E2E_FM_PASSWORD`, `E2E_OWNER_EMAIL`, `E2E_OWNER_PASSWORD`.

Run: `npm run e2e`
Expected: 3 passed (o los flujos con credenciales faltantes salen como *skipped*, nunca *failed*).

Verifica también que Vitest sigue ignorando `e2e/`:
Run: `npm test` → **91 passed** (sin intentar correr los `.spec.ts` de Playwright).

- [ ] **Step 8: Gates + commit**

Run: `npm run typecheck`, `npm run lint`.
```bash
git add -A
git commit -m "Add Playwright e2e tests for the three critical flows"
```

---

### Task 17: Despliegue

- [ ] **Step 1: Confirmar el estado de la BD de producción**

La migración 0005 y el bucket ya se aplicaron (Tareas 1 y 9) — es la misma base para local y producción. Confirma con `npm run verify-schema` (comercios accesible) y revisa en Studio que existan las 3 columnas y el bucket `comercio-imagenes`.

- [ ] **Step 2: Merge y push**

```bash
git fetch origin
git log --oneline origin/master..master
```
Asegúrate de que `master` no esté DETRÁS de `origin/master` (si lo está, `git pull --ff-only` primero).
```bash
git checkout master
git merge --ff-only feature/fase3-autogestion-catalogo
git push origin master
```
Vercel despliega automáticamente. **No hay variables de entorno nuevas de producción** (las `E2E_*` son solo para correr Playwright en local).

- [ ] **Step 3: Verificar en producción**

Contra `https://loyalty-cards-rose.vercel.app`:
- `/comercio/login` carga; el dueño piloto inicia sesión y ve su panel.
- Editar branding + subir una imagen funciona y se refleja.
- `/admin/login` (FM) sigue funcionando (el proxy no rompió lo existente).
- `/registro/cafeteria-piloto` sigue en 200.

- [ ] **Step 4: Limpiar la rama**

```bash
git branch -d feature/fase3-autogestion-catalogo
```

---

## Resumen de conteo de tests (Vitest)

Base: **61**. Cada tarea con TDD suma; el total corre así:

| Tarea | Archivo | +tests | Total acumulado |
|------|---------|--------|-----------------|
| — | base (13 archivos existentes) | — | 61 |
| 2 | `lib/comercios/guardarComercio.test.ts` (16→19) | +3 | **64** |
| 4 | `lib/apple/generatePass.test.ts` (2→4) | +2 | **66** |
| 5 | `lib/comercio/esOwnerDeComercio.test.ts` (nuevo) | +5 | **71** |
| 10 | `lib/comercio/imagenComercio.test.ts` (nuevo) | +6 | **77** |
| 11 | `lib/comercio/guardarBranding.test.ts` (nuevo) | +4 | **81** |
| 13 | `lib/comercio/reglas.test.ts` (nuevo) | +5 | **86** |
| 14 | `lib/comercio/recompensas.test.ts` (nuevo) | +5 | **91** |

Tareas 3, 6, 7, 8, 9, 12, 15 no agregan tests de Vitest (UI/scripts/proxy — verificación por build/manual). La Tarea 16 agrega 3 pruebas de Playwright que corren aparte (`npm run e2e`) y **no** cuentan para `npm test`.

**Total final de `npm test`: 91.** Verificación aritmética: 61 + 3 + 2 + 5 + 6 + 4 + 5 + 5 = 91. ✓

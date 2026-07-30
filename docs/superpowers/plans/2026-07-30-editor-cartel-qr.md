# Editor de cartel/QR para mesas y mostrador — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada comercio diseñe, guarde y descargue (PNG + PDF, dos formatos físicos) un cartel de
mesa/mostrador con el QR de registro de cada uno de sus programas, reusando por defecto su logo y
colores de marca ya cargados.

**Architecture:** Una función pura de renderizado SVG (`construirCartelSvg`) que corre igual en el
navegador (vista previa en vivo) y en el servidor (exportación), alimentada por una capa de resolución
de datos que decide override-vs-heredado, y una capa de exportación que rasteriza ese SVG a PNG
(`sharp`) y lo embebe en un PDF de una sola página (`pdf-lib`).

**Tech Stack:** Next.js App Router (Server Components + Server Actions + Route Handler), Supabase
(Postgres + Storage), `qrcode` (ya instalado), `sharp` (ya instalado), `pdf-lib` (dependencia nueva).

**Spec:** `docs/superpowers/specs/2026-07-30-editor-cartel-qr-design.md`

---

## Antes de empezar

Este plan asume que quien lo ejecuta parte de la rama `master` del checkout PRINCIPAL
(`C:\Users\Daniel\Desktop\Loyalty Cards`), **no** de un worktree de infraestructura de la sesión. Si
te dispatchan como subagente para este plan: confirmá con `git branch --show-current` que estás
parado en `master` de esa ruta ANTES de tocar nada; si no, `cd` ahí primero.

**Regla que aplica a TODAS las tareas de este plan, sin excepción:** cualquier lectura o escritura que
reciba un `programaId` (de una URL, de un `FormData`, del `[id]` de una ruta) DEBE verificar que ese
programa pertenece al `comercioId` de la sesión ANTES de usarlo — nunca confiar en que un id que llega
del navegador es del comercio correcto. La Tarea 8/9 (`resolverDatosCartel`) y la Tarea 11
(`accionGuardarCartel`/subida de logo) son los dos lugares donde este chequeo se implementa una sola
vez cada uno; todo lo demás los reusa.

## Task 1: Migración 0026 + `types.ts` + verificador

**Files:**
- Create: `supabase/migrations/0026_disenos_cartel.sql`
- Modify: `lib/supabase/types.ts`
- Create: `scripts/verificar-0026.ts`

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/0026_disenos_cartel.sql` con este contenido exacto (copiado del spec §3,
byte-idéntico):

```sql
-- 0026: diseños de cartel/QR por programa.
--
-- Un comercio puede diseñar el cartel de mesa/mostrador que imprime con el QR de registro de CADA
-- uno de sus programas activos. Sin backfill: la ausencia de fila para un programa_id significa "sin
-- personalizar" — la capa de aplicación calcula los defaults en memoria.

create table disenos_cartel (
  id uuid primary key default gen_random_uuid(),
  programa_id uuid not null unique references programas_tarjeta(id) on delete cascade,
  comercio_id uuid not null references comercios(id) on delete cascade,

  plantilla text not null default 'centrado' check (plantilla in ('centrado', 'split', 'foto')),

  color_fondo text,
  color_texto text,
  color_label text,
  logo_url text,

  texto_cta text not null default '¡Escaneá y sumate!' check (btrim(texto_cta) <> ''),
  texto_teaser text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index disenos_cartel_comercio_idx on disenos_cartel (comercio_id);

alter table disenos_cartel enable row level security;
-- Sin políticas = deny-all para anon/authenticated, igual que programas_tarjeta (0024). Todo acceso
-- pasa por Server Actions/Route Handlers con createServiceClient(), gateados por
-- verifyComercioOwner() y con el programa re-verificado contra comercio_id.
```

- [ ] **Step 2: Actualizar `lib/supabase/types.ts`**

Abrir `lib/supabase/types.ts`. Buscar el bloque `Tables` (donde ya están `comercios`, `programas_tarjeta`,
etc. — cada tabla tiene su `Row`/`Insert`/`Update`) y agregar, siguiendo el mismo estilo que las tablas
vecinas:

```ts
      disenos_cartel: {
        Row: {
          id: string;
          programa_id: string;
          comercio_id: string;
          plantilla: string;
          color_fondo: string | null;
          color_texto: string | null;
          color_label: string | null;
          logo_url: string | null;
          texto_cta: string;
          texto_teaser: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          programa_id: string;
          comercio_id: string;
          plantilla?: string;
          color_fondo?: string | null;
          color_texto?: string | null;
          color_label?: string | null;
          logo_url?: string | null;
          texto_cta?: string;
          texto_teaser?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          programa_id?: string;
          comercio_id?: string;
          plantilla?: string;
          color_fondo?: string | null;
          color_texto?: string | null;
          color_label?: string | null;
          logo_url?: string | null;
          texto_cta?: string;
          texto_teaser?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
```

(Insertar como una entrada más del objeto `Tables`, en el mismo nivel que `comercios`/
`programas_tarjeta` — respetar la coma de la entrada anterior.)

- [ ] **Step 3: Escribir el script de verificación**

Crear `scripts/verificar-0026.ts`, siguiendo el mismo patrón que `scripts/verificar-0024.ts` (que ya
existe en el repo): mismos imports, mismos helpers `ok`/`fallo`, crea y borra sus propios datos, y
termina probando que el rol anónimo no puede leer la tabla.

```ts
// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0026.ts
// Verificación de la migración 0026 (disenos_cartel). Lee/escribe datos propios de prueba y los
// borra al final; además confirma que la llave pública (anon) no puede ver la tabla.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

let fallas = 0;
const ok = (m: string) => console.log(`OK: ${m}`);
const fallo = (m: string, d?: string) => {
  console.error(`FALLO: ${m}${d ? ` — ${d}` : ''}`);
  fallas += 1;
};

async function main() {
  const supabase = createServiceClient();

  // ── 1. Estructura ──────────────────────────────────────────────────────────────────────────
  const cols = await supabase
    .from('disenos_cartel')
    .select('id, programa_id, comercio_id, plantilla, color_fondo, color_texto, color_label, logo_url, texto_cta, texto_teaser, created_at, updated_at')
    .limit(1);
  if (cols.error) {
    fallo('la tabla disenos_cartel no existe o le faltan columnas', cols.error.message);
    process.exit(1);
  }
  ok('la tabla disenos_cartel existe con las columnas esperadas.');

  // ── 2. Constraints, sobre datos propios que se crean y se borran ──────────────────────────────
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data: com, error: eCom } = await supabase
    .from('comercios')
    .insert({ nombre: 'Verificacion 0026', slug: `verif-0026-${sufijo}` })
    .select('id')
    .single();
  if (eCom || !com) {
    fallo('no se pudo crear el comercio de prueba', eCom?.message);
    process.exit(1);
  }

  try {
    const { data: prog, error: eProg } = await supabase
      .from('programas_tarjeta')
      .insert({ comercio_id: com.id, nombre: 'Programa Verificacion', slug: 'principal', tipo_tarjeta: 'sellos', es_principal: true })
      .select('id')
      .single();
    if (eProg || !prog) {
      fallo('no se pudo crear el programa de prueba', eProg?.message);
      throw new Error('setup falló');
    }

    const invalida = await supabase
      .from('disenos_cartel')
      .insert({ programa_id: prog.id, comercio_id: com.id, plantilla: 'no-existe' } as never);
    if (invalida.error?.code === '23514') {
      ok("rechaza una plantilla fuera de la lista blanca (23514, CHECK).");
    } else {
      fallo('aceptó una plantilla inválida', invalida.error?.message ?? 'sin error');
    }

    const vacio = await supabase
      .from('disenos_cartel')
      .insert({ programa_id: prog.id, comercio_id: com.id, texto_cta: '   ' });
    if (vacio.error?.code === '23514') {
      ok('rechaza texto_cta en blanco (23514, CHECK).');
    } else {
      fallo('aceptó texto_cta en blanco', vacio.error?.message ?? 'sin error');
    }

    const { data: diseno, error: eDiseno } = await supabase
      .from('disenos_cartel')
      .insert({ programa_id: prog.id, comercio_id: com.id, plantilla: 'split' })
      .select('id')
      .single();
    if (eDiseno || !diseno) {
      fallo('no se pudo crear un diseño válido', eDiseno?.message);
      throw new Error('setup falló');
    }
    ok('acepta un diseño válido con los defaults correctos.');

    const repetido = await supabase
      .from('disenos_cartel')
      .insert({ programa_id: prog.id, comercio_id: com.id });
    if (repetido.error?.code === '23505') {
      ok('rechaza un SEGUNDO diseño para el mismo programa_id (23505, unique).');
    } else {
      fallo('aceptó dos diseños para el mismo programa', repetido.error?.message ?? 'sin error');
    }

    // ── 3. RLS: la llave pública NO puede ver la tabla ──────────────────────────────────────────
    const { createClient } = await import('@supabase/supabase-js');
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data: viaAnon, error: eAnon } = await anon
      .from('disenos_cartel')
      .select('id')
      .eq('id', diseno.id);
    // RLS sin políticas no devuelve error: filtra en silencio y da 0 filas. Por eso se prueba que la
    // fila SÍ existe (arriba) y que, aun así, el anon la ve vacía.
    if (!eAnon && (viaAnon?.length ?? 0) === 0) {
      ok('la llave pública no puede leer disenos_cartel (RLS deny-all).');
    } else {
      fallo('PROBLEMA GRAVE: la llave pública puede leer disenos_cartel', eAnon?.message ?? `${viaAnon?.length} filas visibles`);
    }

    await supabase.from('disenos_cartel').delete().eq('programa_id', prog.id);
    await supabase.from('programas_tarjeta').delete().eq('id', prog.id);
  } catch (e) {
    if (!(e instanceof Error && e.message === 'setup falló')) throw e;
  } finally {
    await supabase.from('comercios').delete().eq('id', com.id);
    ok('datos de prueba borrados.');
  }

  if (fallas > 0) {
    console.error(`\n${fallas} verificación(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nTodo en orden: la migración 0026 está aplicada.');
  process.exit(0);
}

main();
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

Expected: sin errores (los tipos nuevos de `disenos_cartel` deben ser válidos TypeScript; el script
de verificación no corre en este paso porque la migración todavía no está aplicada en la base real).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0026_disenos_cartel.sql lib/supabase/types.ts scripts/verificar-0026.ts
git commit -m "Cartel: migracion 0026 (disenos_cartel) + types.ts + verificador

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Entregar la migración al usuario**

Pegar el contenido de `supabase/migrations/0026_disenos_cartel.sql` en el chat y pedirle al usuario
que lo corra en Supabase Studio (regla del proyecto: el asistente no corre DDL). **No avanzar a
ninguna tarea que dependa de la tabla existiendo en la base real hasta que el usuario confirme que la
corrió** — las Tareas 2 a 7 no la necesitan (son código puro/TypeScript), pero la Tarea 8 en adelante
sí toca la base.

---

## Task 2: Extraer `urlRegistroPrograma` y usarla en `panel`/`programas`

**Files:**
- Create: `lib/comercio/urlRegistroPrograma.ts`
- Create: `lib/comercio/urlRegistroPrograma.test.ts`
- Modify: `app/comercio/(protegido)/panel/page.tsx:69-71`
- Modify: `app/comercio/(protegido)/programas/page.tsx:26-32`

Hoy la URL `/registro/<slug>[/<slug>]` se arma dos veces por separado, cada una con su propio
`NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '')`. El cartel la necesita una tercera vez — se extrae antes de
agregar un tercer lugar que la duplique.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `lib/comercio/urlRegistroPrograma.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { urlRegistroPrograma } from './urlRegistroPrograma';

describe('urlRegistroPrograma', () => {
  it('arma la URL del programa principal SIN slug de programa', () => {
    expect(urlRegistroPrograma('https://www.cardly-sv.site', 'cafe-sol', 'principal', true)).toBe(
      'https://www.cardly-sv.site/registro/cafe-sol',
    );
  });

  it('arma la URL de un programa NO principal CON su slug', () => {
    expect(urlRegistroPrograma('https://www.cardly-sv.site', 'cafe-sol', 'cupon-2026', false)).toBe(
      'https://www.cardly-sv.site/registro/cafe-sol/cupon-2026',
    );
  });

  it('quita una barra final del baseUrl para no duplicarla', () => {
    expect(urlRegistroPrograma('https://www.cardly-sv.site/', 'cafe-sol', 'principal', true)).toBe(
      'https://www.cardly-sv.site/registro/cafe-sol',
    );
  });

  it('devuelve null si no hay baseUrl configurado', () => {
    expect(urlRegistroPrograma(undefined, 'cafe-sol', 'principal', true)).toBeNull();
  });
});
```

- [ ] **Step 2: Correr la prueba y confirmar que falla**

```bash
npx vitest run lib/comercio/urlRegistroPrograma.test.ts
```

Expected: FAIL — `Cannot find module './urlRegistroPrograma'`.

- [ ] **Step 3: Implementar**

Crear `lib/comercio/urlRegistroPrograma.ts`:

```ts
// URL pública de registro de un programa. Extraído para no duplicar esta lógica una tercera vez:
// panel/page.tsx y programas/page.tsx la armaban cada uno por su cuenta, y el cartel la necesita
// también. Pura — sin Supabase, sin `process.env` adentro (el baseUrl entra como parámetro para que
// la prueba no dependa de variables de entorno).
export function urlRegistroPrograma(
  baseUrl: string | undefined,
  comercioSlug: string,
  programaSlug: string,
  esPrincipal: boolean,
): string | null {
  const base = baseUrl?.replace(/\/$/, '');
  if (!base) return null;
  return esPrincipal ? `${base}/registro/${comercioSlug}` : `${base}/registro/${comercioSlug}/${programaSlug}`;
}
```

- [ ] **Step 4: Correr la prueba y confirmar que pasa**

```bash
npx vitest run lib/comercio/urlRegistroPrograma.test.ts
```

Expected: 4 PASS.

- [ ] **Step 5: Mutation-testing de esta prueba**

Romper temporalmente el `?` del ternario (invertirlo: `!esPrincipal ? ... : ...`) y confirmar que
**las dos primeras pruebas fallan** con un mensaje de "expected X, got Y" — no solo que "algo falla".
Restaurar el archivo a como quedó en el Step 3.

- [ ] **Step 6: Usar la función en `panel/page.tsx`**

En `app/comercio/(protegido)/panel/page.tsx`, agregar el import:

```ts
import { urlRegistroPrograma } from '@/lib/comercio/urlRegistroPrograma';
```

Buscar (línea 70-71):
```ts
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '');
  const urlRegistro = comercio?.slug && baseUrl ? `${baseUrl}/registro/${comercio.slug}` : null;
```

Reemplazar por:
```ts
  const urlRegistro = comercio?.slug
    ? urlRegistroPrograma(process.env.NEXT_PUBLIC_BASE_URL, comercio.slug, 'principal', true)
    : null;
```

- [ ] **Step 7: Usar la función en `programas/page.tsx`**

En `app/comercio/(protegido)/programas/page.tsx`, agregar el mismo import. Buscar (líneas 26-32):

```ts
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '');
  const filas = await Promise.all(
    (programas ?? []).map(async (p) => {
      const urlRegistro =
        comercio?.slug && baseUrl && p.activo
          ? `${baseUrl}/registro/${comercio.slug}${p.esPrincipal ? '' : `/${p.slug}`}`
          : null;
```

Reemplazar por:
```ts
  const filas = await Promise.all(
    (programas ?? []).map(async (p) => {
      const urlRegistro =
        comercio?.slug && p.activo
          ? urlRegistroPrograma(process.env.NEXT_PUBLIC_BASE_URL, comercio.slug, p.slug, p.esPrincipal)
          : null;
```

- [ ] **Step 8: Verificar que ninguna otra parte del archivo dependía de la variable `baseUrl` borrada**

```bash
grep -n "baseUrl" "app/comercio/(protegido)/panel/page.tsx" "app/comercio/(protegido)/programas/page.tsx"
```

Expected: sin coincidencias (se quitó la única declaración y su único uso en cada archivo).

- [ ] **Step 9: Typecheck y lint**

```bash
npx tsc --noEmit
npm run lint
```

Expected: sin errores.

- [ ] **Step 10: Commit**

```bash
git add lib/comercio/urlRegistroPrograma.ts lib/comercio/urlRegistroPrograma.test.ts "app/comercio/(protegido)/panel/page.tsx" "app/comercio/(protegido)/programas/page.tsx"
git commit -m "Extraer urlRegistroPrograma: elimina la duplicacion entre panel y programas

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Tipos y dimensiones del cartel

**Files:**
- Create: `lib/comercio/cartel/tipos.ts`
- Create: `lib/comercio/cartel/tipos.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

Crear `lib/comercio/cartel/tipos.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DIMENSIONES_CARTEL, esPlantillaCartel } from './tipos';

describe('DIMENSIONES_CARTEL', () => {
  it('sticker: 10x10cm da 1181x1181px a 300dpi', () => {
    expect(DIMENSIONES_CARTEL.sticker.px).toEqual({ ancho: 1181, alto: 1181 });
  });

  it('mostrador: A5 (148x210mm) da 1748x2480px a 300dpi', () => {
    expect(DIMENSIONES_CARTEL.mostrador.px).toEqual({ ancho: 1748, alto: 2480 });
  });

  it('sticker: 283x283pt a 72pt/pulgada', () => {
    expect(DIMENSIONES_CARTEL.sticker.pt).toEqual({ ancho: 283.46, alto: 283.46 });
  });

  it('mostrador: 419.53x595.28pt a 72pt/pulgada', () => {
    expect(DIMENSIONES_CARTEL.mostrador.pt).toEqual({ ancho: 419.53, alto: 595.28 });
  });

  it('el viewBox del mostrador conserva la proporción física (148:210)', () => {
    const { ancho, alto } = DIMENSIONES_CARTEL.mostrador.viewBox;
    expect(alto / ancho).toBeCloseTo(210 / 148, 3);
  });
});

describe('esPlantillaCartel', () => {
  it('acepta las 3 plantillas válidas', () => {
    expect(esPlantillaCartel('centrado')).toBe(true);
    expect(esPlantillaCartel('split')).toBe(true);
    expect(esPlantillaCartel('foto')).toBe(true);
  });

  it('rechaza cualquier otra cosa', () => {
    expect(esPlantillaCartel('libre')).toBe(false);
    expect(esPlantillaCartel(null)).toBe(false);
    expect(esPlantillaCartel(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Correr la prueba y confirmar que falla**

```bash
npx vitest run lib/comercio/cartel/tipos.test.ts
```

Expected: FAIL — `Cannot find module './tipos'`.

- [ ] **Step 3: Implementar**

Crear `lib/comercio/cartel/tipos.ts`:

```ts
// Tipos y dimensiones del cartel/QR (migración 0026). Puro — sin Supabase, sin fetch, sin DOM.

export const PLANTILLAS_CARTEL = ['centrado', 'split', 'foto'] as const;
export type PlantillaCartel = (typeof PLANTILLAS_CARTEL)[number];

export function esPlantillaCartel(valor: unknown): valor is PlantillaCartel {
  return typeof valor === 'string' && (PLANTILLAS_CARTEL as readonly string[]).includes(valor);
}

export const FORMATOS_CARTEL = ['sticker', 'mostrador'] as const;
export type FormatoCartel = (typeof FORMATOS_CARTEL)[number];

// Todo lo que necesita construirCartelSvg, YA resuelto: ninguna URL remota (ver §4.1 del spec — un
// renderizador SVG del lado servidor puede no cargar referencias externas, así que el logo/foto
// SIEMPRE llegan como data: URI, nunca como URL pública).
export interface DatosCartel {
  nombreComercio: string;
  plantilla: PlantillaCartel;
  colorFondo: string;
  colorTexto: string;
  colorLabel: string;
  logoDataUri: string | null;
  fotoDataUri: string | null;
  textoCta: string;
  textoTeaser: string | null;
  urlRegistro: string;
}

interface DimensionCartel {
  mm: { ancho: number; alto: number };
  // Tamaño de rasterizado a 300dpi — ver lib/comercio/cartel/export.ts.
  px: { ancho: number; alto: number };
  // Tamaño de página del PDF, en puntos (72pt = 1 pulgada).
  pt: { ancho: number; alto: number };
  // Unidades de diseño del <svg viewBox="0 0 ancho alto">. El ancho es fijo (400) en los dos
  // formatos; el alto se DERIVA de la proporción física real (mm), nunca se hardcodea — así el
  // viewBox nunca puede desincronizarse de la proporción real del papel.
  viewBox: { ancho: number; alto: number };
}

const MM_POR_PULGADA = 25.4;
const DPI_EXPORTACION = 300;
const PT_POR_PULGADA = 72;
const ANCHO_DISENO = 400;

function calcularDimension(anchoMm: number, altoMm: number): DimensionCartel {
  const pulgadasAncho = anchoMm / MM_POR_PULGADA;
  const pulgadasAlto = altoMm / MM_POR_PULGADA;
  return {
    mm: { ancho: anchoMm, alto: altoMm },
    px: {
      ancho: Math.round(pulgadasAncho * DPI_EXPORTACION),
      alto: Math.round(pulgadasAlto * DPI_EXPORTACION),
    },
    pt: {
      ancho: Number((pulgadasAncho * PT_POR_PULGADA).toFixed(2)),
      alto: Number((pulgadasAlto * PT_POR_PULGADA).toFixed(2)),
    },
    viewBox: { ancho: ANCHO_DISENO, alto: Number(((ANCHO_DISENO * altoMm) / anchoMm).toFixed(2)) },
  };
}

export const DIMENSIONES_CARTEL: Record<FormatoCartel, DimensionCartel> = {
  sticker: calcularDimension(100, 100),
  mostrador: calcularDimension(148, 210),
};
```

- [ ] **Step 4: Correr la prueba y confirmar que pasa**

```bash
npx vitest run lib/comercio/cartel/tipos.test.ts
```

Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/comercio/cartel/tipos.ts lib/comercio/cartel/tipos.test.ts
git commit -m "Cartel: tipos y dimensiones fisicas (sticker 10x10cm, mostrador A5)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Ruta de subida del logo propio del cartel

**Files:**
- Modify: `lib/comercio/imagenComercio.ts`

Mismo patrón que `rutaImagenRecompensa` (ya existe en este archivo): un comercio, N entidades hijas
(acá programas), cada una con su propia imagen dentro del mismo bucket.

- [ ] **Step 1: Agregar la función**

En `lib/comercio/imagenComercio.ts`, agregar al final del archivo (después de `rutaImagenRecompensa`):

```ts
// Ruta del logo PROPIO de un cartel (cuando el comercio decide no heredar el logo de su marca para
// este cartel puntual). Mismo bucket, misma validación de 2MB/png-jpg-webp que el resto — solo
// cambia el path. Un comercio tiene UN logo de cartel por programa (nunca dos), así que basta con el
// comercioId + el programaId, igual que rutaImagenRecompensa usa comercioId + recompensaId.
export function rutaImagenCartel(comercioId: string, programaId: string, ext: string): string {
  return `${comercioId}/carteles/${programaId}.${ext}`;
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add lib/comercio/imagenComercio.ts
git commit -m "Cartel: ruta de subida del logo propio (mismo patron que recompensas)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Plantilla "Centrado" + helpers comunes (QR, escapado, logo)

**Files:**
- Create: `lib/comercio/cartel/plantillas.ts`
- Create: `lib/comercio/cartel/plantillas.test.ts`

Esta tarea deja listos los helpers que las Tareas 6 y 7 van a reusar (`escaparXml`, `construirQrSvg`,
`logoSvg`, `tarjetaBlancaConQr`) y la primera de las 3 plantillas.

**Nota sobre las coordenadas de layout:** los números de esta tarea (y de las Tareas 6-7) son un punto
de partida razonable, no medidas verificadas visualmente — nadie renderizó estos SVG en un navegador
todavía. Es exactamente el mismo proceso que ya se usó para los stickers de la landing en este mismo
proyecto: posicionar, renderizar, mirar en el navegador, ajustar. La Tarea 15 tiene el paso explícito
de abrir cada plantilla × formato en el navegador y corregir overlaps/desbordes — **no es una señal de
que esta tarea esté mal hecha si algo se ve apretado la primera vez.**

- [ ] **Step 1: Escribir la prueba que falla**

Crear `lib/comercio/cartel/plantillas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { construirCartelSvg, escaparXml } from './plantillas';
import type { DatosCartel } from './tipos';

const DATOS_BASE: DatosCartel = {
  nombreComercio: 'Café Sol',
  plantilla: 'centrado',
  colorFondo: '#3b2a1e',
  colorTexto: '#f5ede0',
  colorLabel: '#e8b978',
  logoDataUri: null,
  fotoDataUri: null,
  textoCta: '¡Escaneá y sumate!',
  textoTeaser: null,
  urlRegistro: 'https://www.cardly-sv.site/registro/cafe-sol',
};

describe('escaparXml', () => {
  it('escapa los 5 caracteres especiales de XML', () => {
    expect(escaparXml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &apos;');
  });

  it('un nombre con & no rompe el SVG resultante', async () => {
    const datos: DatosCartel = { ...DATOS_BASE, nombreComercio: 'Café & Té' };
    const svg = await construirCartelSvg(datos, 'sticker');
    expect(svg).toContain('Café &amp; Té');
    expect(svg).not.toContain('Café & Té');
  });
});

describe('construirCartelSvg — plantilla centrado', () => {
  it('produce un <svg> bien formado con el viewBox del formato pedido', async () => {
    const svg = await construirCartelSvg(DATOS_BASE, 'sticker');
    expect(svg.trim().startsWith('<svg')).toBe(true);
    expect(svg.trim().endsWith('</svg>')).toBe(true);
    expect(svg).toContain('viewBox="0 0 400 400"');
  });

  it('usa el viewBox alto del formato mostrador (proporción A5)', async () => {
    const svg = await construirCartelSvg(DATOS_BASE, 'mostrador');
    expect(svg).toContain('viewBox="0 0 400 567.57"');
  });

  it('incluye el color de fondo elegido', async () => {
    const svg = await construirCartelSvg(DATOS_BASE, 'sticker');
    expect(svg).toContain('#3b2a1e');
  });

  it('incluye el nombre del comercio', async () => {
    const svg = await construirCartelSvg(DATOS_BASE, 'sticker');
    expect(svg).toContain('Café Sol');
  });

  it('incluye el texto del CTA', async () => {
    const svg = await construirCartelSvg(DATOS_BASE, 'sticker');
    expect(svg).toContain('¡Escaneá y sumate!');
  });

  it('sin teaser, no agrega un segundo <text> de teaser', async () => {
    const svg = await construirCartelSvg(DATOS_BASE, 'sticker');
    const conTeaser = await construirCartelSvg({ ...DATOS_BASE, textoTeaser: 'Tu 5to café gratis' }, 'sticker');
    expect(svg).not.toContain('Tu 5to café gratis');
    expect(conTeaser).toContain('Tu 5to café gratis');
  });

  it('sin logo, dibuja un círculo con la inicial del nombre (no revienta)', async () => {
    const svg = await construirCartelSvg(DATOS_BASE, 'sticker');
    expect(svg).toContain('<circle');
    expect(svg).toContain('>C<');
  });

  it('con logo, dibuja una <image> con el data URI en vez del círculo', async () => {
    const datos: DatosCartel = { ...DATOS_BASE, logoDataUri: 'data:image/png;base64,AAAA' };
    const svg = await construirCartelSvg(datos, 'sticker');
    expect(svg).toContain('<image href="data:image/png;base64,AAAA"');
  });

  it('embebe el QR de la URL de registro como SVG anidado, no como <img>/data URI', async () => {
    const svg = await construirCartelSvg(DATOS_BASE, 'sticker');
    // El SVG que arma `qrcode` trae su propio xmlns — si aparece dos veces, el QR quedó anidado.
    expect(svg.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g)?.length).toBe(2);
  });
});
```

- [ ] **Step 2: Correr la prueba y confirmar que falla**

```bash
npx vitest run lib/comercio/cartel/plantillas.test.ts
```

Expected: FAIL — `Cannot find module './plantillas'`.

- [ ] **Step 3: Implementar los helpers + la plantilla "centrado"**

Crear `lib/comercio/cartel/plantillas.ts`:

```ts
import QRCode from 'qrcode';
import { DIMENSIONES_CARTEL, type DatosCartel, type FormatoCartel } from './tipos';

// Se escapan los 5 caracteres especiales de XML antes de interpolar CUALQUIER texto libre (nombre
// del comercio, CTA, teaser) dentro del SVG — mismo requisito que ya estableció el spec del reverso
// de la tarjeta (docs/superpowers/specs/2026-07-26-reverso-tarjeta-configurable-design.md §7.1) para
// HTML. Sin esto, un nombre con "&" rompe el XML entero (pantalla en blanco en la vista previa).
export function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// El QR SIEMPRE en negro puro sobre blanco puro, nunca con los colores de marca — decisión de
// escaneabilidad (spec §4.2), no un descuido. `qrcode.toString` es la API pública y asíncrona (no
// hay una variante síncrona soportada públicamente); no hace ningún fetch de red — solo dibuja la
// matriz del código ya calculada — así que seguimos llamando "pura respecto de I/O" a esta función
// aunque técnicamente sea `async`.
async function construirQrSvg(url: string, lado: number): Promise<string> {
  const svg = await QRCode.toString(url, {
    type: 'svg',
    margin: 0,
    color: { dark: '#000000', light: '#ffffff' },
  });
  // El SVG que devuelve `qrcode` trae su propio <svg viewBox="0 0 N N">; se ANIDA (svg-en-svg es
  // válido) con x/y=0 en un contenedor de tamaño fijo, en vez de convertirlo a PNG intermedio — se
  // queda vectorial hasta el rasterizado final (ver export.ts).
  return `<svg x="0" y="0" width="${lado}" height="${lado}">${svg}</svg>`;
}

// Tarjeta blanca detrás del QR (mejora el contraste de escaneo sobre cualquier color de fondo) más
// un margen proporcional al lado del QR. `qrSvg` debe haberse construido con el MISMO `lado`.
function tarjetaBlancaConQr(qrSvg: string, x: number, y: number, lado: number): string {
  const margen = lado * 0.12;
  const ladoTarjeta = lado + margen * 2;
  return [
    `<rect x="${x}" y="${y}" width="${ladoTarjeta}" height="${ladoTarjeta}" rx="${ladoTarjeta * 0.08}" fill="#ffffff"/>`,
    `<g transform="translate(${x + margen}, ${y + margen})">${qrSvg}</g>`,
  ].join('');
}

// Logo del comercio si existe; si no, un círculo con la inicial del nombre (spec §7: la plantilla no
// debe romperse por falta de logo).
function logoSvg(datos: DatosCartel, x: number, y: number, lado: number): string {
  if (datos.logoDataUri) {
    return `<image href="${datos.logoDataUri}" x="${x}" y="${y}" width="${lado}" height="${lado}" preserveAspectRatio="xMidYMid slice"/>`;
  }
  const inicial = escaparXml(datos.nombreComercio.trim().charAt(0).toUpperCase() || '?');
  return [
    `<circle cx="${x + lado / 2}" cy="${y + lado / 2}" r="${lado / 2}" fill="${datos.colorLabel}"/>`,
    `<text x="${x + lado / 2}" y="${y + lado / 2 + lado * 0.13}" text-anchor="middle" font-family="sans-serif" font-size="${lado * 0.55}" font-weight="700" fill="${datos.colorFondo}">${inicial}</text>`,
  ].join('');
}

async function plantillaCentrado(datos: DatosCartel, formato: FormatoCartel): Promise<string> {
  const dim = DIMENSIONES_CARTEL[formato];
  const w = dim.viewBox.ancho;
  const h = dim.viewBox.alto;
  const cx = w / 2;

  const logoLado = w * 0.18;
  const logoY = h * 0.1;
  const nombreY = logoY + logoLado + h * 0.045;
  const qrLado = w * 0.5;
  const qrX = cx - qrLado / 2;
  const qrY = nombreY + h * 0.06;
  const ctaY = qrY + qrLado * 1.24 + h * 0.05;
  const teaserY = ctaY + h * 0.045;

  const qrSvg = await construirQrSvg(datos.urlRegistro, qrLado);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim.mm.ancho}mm" height="${dim.mm.alto}mm" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${datos.colorFondo}"/>
  ${logoSvg(datos, cx - logoLado / 2, logoY, logoLado)}
  <text x="${cx}" y="${nombreY}" text-anchor="middle" font-family="sans-serif" font-size="${h * 0.032}" font-weight="700" fill="${datos.colorTexto}">${escaparXml(datos.nombreComercio)}</text>
  ${tarjetaBlancaConQr(qrSvg, qrX, qrY, qrLado)}
  <text x="${cx}" y="${ctaY}" text-anchor="middle" font-family="sans-serif" font-size="${h * 0.026}" font-weight="600" fill="${datos.colorLabel}">${escaparXml(datos.textoCta)}</text>
  ${datos.textoTeaser ? `<text x="${cx}" y="${teaserY}" text-anchor="middle" font-family="sans-serif" font-size="${h * 0.022}" fill="${datos.colorTexto}">${escaparXml(datos.textoTeaser)}</text>` : ''}
</svg>`;
}

// El dispatcher completo se termina en la Tarea 7 (agrega 'split' y 'foto'); esta tarea lo deja
// andando SOLO para 'centrado' para poder probarlo de punta a punta ya mismo.
export async function construirCartelSvg(datos: DatosCartel, formato: FormatoCartel): Promise<string> {
  if (datos.plantilla === 'centrado') return plantillaCentrado(datos, formato);
  throw new Error(`Plantilla "${datos.plantilla}" todavía no implementada (Tarea 6/7 de este plan).`);
}

export { plantillaCentrado, construirQrSvg, tarjetaBlancaConQr, logoSvg };
```

- [ ] **Step 4: Correr la prueba y confirmar que pasa**

```bash
npx vitest run lib/comercio/cartel/plantillas.test.ts
```

Expected: todas las pruebas de la sección "plantilla centrado" y "escaparXml" en PASS.

- [ ] **Step 5: Mutation-testing del escapado**

Romper `escaparXml` quitando el `.replace(/&/g, '&amp;')` (dejar los otros 4) y confirmar que **la
prueba "un nombre con & no rompe el SVG resultante" falla** — no una prueba genérica, esa
específicamente, con un mensaje que muestre `Café & Té` sin escapar. Restaurar.

- [ ] **Step 6: Commit**

```bash
git add lib/comercio/cartel/plantillas.ts lib/comercio/cartel/plantillas.test.ts
git commit -m "Cartel: plantilla Centrado + helpers de QR/logo/escapado

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Plantilla "Split"

**Files:**
- Modify: `lib/comercio/cartel/plantillas.ts`
- Modify: `lib/comercio/cartel/plantillas.test.ts`

Es la única plantilla que cambia de orientación entre formatos: franja lateral en mostrador, franja
arriba/abajo en sticker (spec §4.4 y validado con el usuario en el companion de brainstorming).

- [ ] **Step 1: Agregar las pruebas que fallan**

En `lib/comercio/cartel/plantillas.test.ts`, agregar (después del bloque `describe('construirCartelSvg — plantilla centrado'`):

```ts
describe('construirCartelSvg — plantilla split', () => {
  const datos: DatosCartel = { ...DATOS_BASE, plantilla: 'split' };

  it('en mostrador, la franja de color es LATERAL (ancho de franja < alto del viewBox)', async () => {
    const svg = await construirCartelSvg(datos, 'mostrador');
    // La franja lateral es el primer <rect> de color de marca (no #ffffff) con height=viewBox alto.
    expect(svg).toMatch(/<rect width="\d+(\.\d+)?" height="567\.57" fill="#3b2a1e"/);
  });

  it('en sticker, la franja de color es SUPERIOR (ancho de franja == viewBox ancho)', async () => {
    const svg = await construirCartelSvg(datos, 'sticker');
    expect(svg).toMatch(/<rect width="400" height="\d+(\.\d+)?" fill="#3b2a1e"/);
  });

  it('produce SVG válido y con el QR embebido en los dos formatos', async () => {
    for (const formato of ['sticker', 'mostrador'] as const) {
      const svg = await construirCartelSvg(datos, formato);
      expect(svg.trim().startsWith('<svg')).toBe(true);
      expect(svg.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g)?.length).toBe(2);
    }
  });
});
```

- [ ] **Step 2: Correr y confirmar que falla**

```bash
npx vitest run lib/comercio/cartel/plantillas.test.ts
```

Expected: FAIL en el nuevo `describe('construirCartelSvg — plantilla split'` — `construirCartelSvg`
todavía lanza el error de "no implementada" para `split`.

- [ ] **Step 3: Implementar**

En `lib/comercio/cartel/plantillas.ts`, agregar (después de `plantillaCentrado`):

```ts
async function plantillaSplit(datos: DatosCartel, formato: FormatoCartel): Promise<string> {
  const dim = DIMENSIONES_CARTEL[formato];
  const w = dim.viewBox.ancho;
  const h = dim.viewBox.alto;

  if (formato === 'mostrador') {
    const anchoFranja = w * 0.32;
    const logoLado = anchoFranja * 0.5;
    const qrLado = (w - anchoFranja) * 0.55;
    const qrX = anchoFranja + (w - anchoFranja - qrLado) / 2;
    const qrY = h / 2 - qrLado * 0.62;
    const qrSvg = await construirQrSvg(datos.urlRegistro, qrLado);
    const centroDerecha = anchoFranja + (w - anchoFranja) / 2;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim.mm.ancho}mm" height="${dim.mm.alto}mm" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#ffffff"/>
  <rect width="${anchoFranja}" height="${h}" fill="${datos.colorFondo}"/>
  ${logoSvg(datos, anchoFranja / 2 - logoLado / 2, h * 0.08, logoLado)}
  <text x="${anchoFranja / 2}" y="${h * 0.08 + logoLado + h * 0.04}" text-anchor="middle" font-family="sans-serif" font-size="${h * 0.028}" font-weight="700" fill="${datos.colorTexto}">${escaparXml(datos.nombreComercio)}</text>
  ${tarjetaBlancaConQr(qrSvg, qrX, qrY, qrLado)}
  <text x="${centroDerecha}" y="${qrY + qrLado * 1.24 + h * 0.05}" text-anchor="middle" font-family="sans-serif" font-size="${h * 0.024}" font-weight="600" fill="${datos.colorLabel}">${escaparXml(datos.textoCta)}</text>
  ${datos.textoTeaser ? `<text x="${centroDerecha}" y="${qrY + qrLado * 1.24 + h * 0.09}" text-anchor="middle" font-family="sans-serif" font-size="${h * 0.02}" fill="${datos.colorTexto}">${escaparXml(datos.textoTeaser)}</text>` : ''}
</svg>`;
  }

  // Sticker: franja arriba/abajo en vez de lateral — un cuadrado angosto no le deja aire a una
  // franja lateral (validado con el usuario en el companion de brainstorming).
  const altoFranja = h * 0.34;
  const logoLado = altoFranja * 0.42;
  const qrLado = w * 0.42;
  const qrX = w / 2 - qrLado / 2;
  const qrY = altoFranja + h * 0.08;
  const qrSvg = await construirQrSvg(datos.urlRegistro, qrLado);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim.mm.ancho}mm" height="${dim.mm.alto}mm" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#ffffff"/>
  <rect width="${w}" height="${altoFranja}" fill="${datos.colorFondo}"/>
  ${logoSvg(datos, w * 0.08, altoFranja / 2 - logoLado / 2, logoLado)}
  <text x="${w * 0.08 + logoLado + w * 0.04}" y="${altoFranja / 2 + logoLado * 0.13}" text-anchor="start" font-family="sans-serif" font-size="${h * 0.032}" font-weight="700" fill="${datos.colorTexto}">${escaparXml(datos.nombreComercio)}</text>
  ${tarjetaBlancaConQr(qrSvg, qrX, qrY, qrLado)}
  <text x="${w / 2}" y="${qrY + qrLado * 1.24 + h * 0.045}" text-anchor="middle" font-family="sans-serif" font-size="${h * 0.026}" font-weight="600" fill="${datos.colorLabel}">${escaparXml(datos.textoCta)}</text>
</svg>`;
}
```

Actualizar el dispatcher (reemplazar el `if` de `construirCartelSvg`):

```ts
export async function construirCartelSvg(datos: DatosCartel, formato: FormatoCartel): Promise<string> {
  if (datos.plantilla === 'centrado') return plantillaCentrado(datos, formato);
  if (datos.plantilla === 'split') return plantillaSplit(datos, formato);
  throw new Error(`Plantilla "${datos.plantilla}" todavía no implementada (Tarea 7 de este plan).`);
}
```

Y agregar `plantillaSplit` al `export` final del archivo.

- [ ] **Step 4: Correr y confirmar que pasa**

```bash
npx vitest run lib/comercio/cartel/plantillas.test.ts
```

Expected: todo PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/comercio/cartel/plantillas.ts lib/comercio/cartel/plantillas.test.ts
git commit -m "Cartel: plantilla Split (lateral en mostrador, arriba/abajo en sticker)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Plantilla "Foto de fondo" + dispatcher completo

**Files:**
- Modify: `lib/comercio/cartel/plantillas.ts`
- Modify: `lib/comercio/cartel/plantillas.test.ts`

- [ ] **Step 1: Agregar las pruebas que fallan**

En `lib/comercio/cartel/plantillas.test.ts`, agregar:

```ts
describe('construirCartelSvg — plantilla foto', () => {
  it('sin fotoDataUri, cae a un fondo sólido en vez de romperse', async () => {
    const datos: DatosCartel = { ...DATOS_BASE, plantilla: 'foto', fotoDataUri: null };
    const svg = await construirCartelSvg(datos, 'sticker');
    expect(svg).toContain(datos.colorFondo);
    expect(svg).not.toContain('<image href="" ');
  });

  it('con fotoDataUri, la usa como fondo de imagen', async () => {
    const datos: DatosCartel = { ...DATOS_BASE, plantilla: 'foto', fotoDataUri: 'data:image/webp;base64,BBBB' };
    const svg = await construirCartelSvg(datos, 'sticker');
    expect(svg).toContain('<image href="data:image/webp;base64,BBBB"');
  });

  it('produce SVG válido y con el QR embebido en los dos formatos', async () => {
    const datos: DatosCartel = { ...DATOS_BASE, plantilla: 'foto', fotoDataUri: 'data:image/webp;base64,BBBB' };
    for (const formato of ['sticker', 'mostrador'] as const) {
      const svg = await construirCartelSvg(datos, formato);
      expect(svg.trim().startsWith('<svg')).toBe(true);
      expect(svg.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g)?.length).toBe(2);
    }
  });
});

describe('construirCartelSvg — plantilla desconocida', () => {
  it('lanza un error legible en vez de devolver un SVG vacío', async () => {
    const datos = { ...DATOS_BASE, plantilla: 'no-existe' } as unknown as DatosCartel;
    await expect(construirCartelSvg(datos, 'sticker')).rejects.toThrow(/no implementada|Plantilla/);
  });
});
```

- [ ] **Step 2: Correr y confirmar que falla**

```bash
npx vitest run lib/comercio/cartel/plantillas.test.ts
```

Expected: FAIL en `describe('construirCartelSvg — plantilla foto'` (todavía lanza "no implementada").

- [ ] **Step 3: Implementar**

En `lib/comercio/cartel/plantillas.ts`, agregar:

```ts
async function plantillaFoto(datos: DatosCartel, formato: FormatoCartel): Promise<string> {
  const dim = DIMENSIONES_CARTEL[formato];
  const w = dim.viewBox.ancho;
  const h = dim.viewBox.alto;

  const logoLado = w * 0.14;
  const qrLado = w * 0.42;
  const tarjetaAncho = w * 0.8;
  const tarjetaAlto = qrLado * 1.5;
  const tarjetaX = (w - tarjetaAncho) / 2;
  const tarjetaY = h - tarjetaAlto - h * 0.06;
  const qrX = w / 2 - qrLado / 2;
  const qrY = tarjetaY + tarjetaAlto * 0.12;

  const qrSvg = await construirQrSvg(datos.urlRegistro, qrLado);

  // Sin fotoDataUri, cae a fondo sólido (spec §7: la UI no debería ofrecer esta plantilla sin
  // hero_url, pero el renderizador no confía en que la UI lo respete siempre).
  const fondo = datos.fotoDataUri
    ? `<image href="${datos.fotoDataUri}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/><rect width="${w}" height="${h}" fill="#000000" opacity="0.35"/>`
    : `<rect width="${w}" height="${h}" fill="${datos.colorFondo}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim.mm.ancho}mm" height="${dim.mm.alto}mm" viewBox="0 0 ${w} ${h}">
  ${fondo}
  ${logoSvg(datos, w * 0.06, h * 0.06, logoLado)}
  <rect x="${tarjetaX}" y="${tarjetaY}" width="${tarjetaAncho}" height="${tarjetaAlto}" rx="${tarjetaAncho * 0.04}" fill="#ffffff"/>
  <g transform="translate(${qrX}, ${qrY})">${qrSvg}</g>
  <text x="${w / 2}" y="${qrY + qrLado * 1.22}" text-anchor="middle" font-family="sans-serif" font-size="${h * 0.026}" font-weight="600" fill="#1c1917">${escaparXml(datos.textoCta)}</text>
</svg>`;
}
```

Terminar el dispatcher (reemplazar el `throw` final por la tercera rama):

```ts
export async function construirCartelSvg(datos: DatosCartel, formato: FormatoCartel): Promise<string> {
  if (datos.plantilla === 'centrado') return plantillaCentrado(datos, formato);
  if (datos.plantilla === 'split') return plantillaSplit(datos, formato);
  if (datos.plantilla === 'foto') return plantillaFoto(datos, formato);
  throw new Error(`Plantilla "${String(datos.plantilla)}" desconocida.`);
}
```

Agregar `plantillaFoto` al `export` final del archivo.

- [ ] **Step 4: Correr y confirmar que pasa**

```bash
npx vitest run lib/comercio/cartel/plantillas.test.ts
```

Expected: TODAS las pruebas de este archivo en PASS (centrado + split + foto + escapado + error).

- [ ] **Step 5: Typecheck y lint**

```bash
npx tsc --noEmit
npm run lint
```

Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add lib/comercio/cartel/plantillas.ts lib/comercio/cartel/plantillas.test.ts
git commit -m "Cartel: plantilla Foto de fondo + dispatcher construirCartelSvg completo

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: `combinarDatosCartel` — la lógica de override-vs-heredado (la de más riesgo)

**Files:**
- Create: `lib/comercio/cartel/combinarDatos.ts`
- Create: `lib/comercio/cartel/combinarDatos.test.ts`

Esta es, según el spec, la parte con más superficie de bug silencioso: mostrarle a un comercio el
logo o color de OTRO sería el peor caso posible. Por eso vive sola, pura, sin ningún I/O — se prueba
con objetos planos, sin mockear Supabase.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `lib/comercio/cartel/combinarDatos.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { combinarDatosCartel } from './combinarDatos';

const COMERCIO = {
  nombre: 'Café Sol',
  color_fondo: 'rgb(59, 42, 30)',
  color_texto: 'rgb(245, 237, 224)',
  color_label: 'rgb(232, 185, 120)',
  logo_url: 'https://ejemplo.test/logo.webp',
  hero_url: 'https://ejemplo.test/hero.webp',
};

describe('combinarDatosCartel', () => {
  it('SIN fila de diseño, hereda TODO de comercios y usa los defaults del sistema', () => {
    const r = combinarDatosCartel(COMERCIO, null);
    expect(r).toEqual({
      nombreComercio: 'Café Sol',
      plantilla: 'centrado',
      colorFondo: 'rgb(59, 42, 30)',
      colorTexto: 'rgb(245, 237, 224)',
      colorLabel: 'rgb(232, 185, 120)',
      logoUrl: 'https://ejemplo.test/logo.webp',
      fotoUrl: 'https://ejemplo.test/hero.webp',
      textoCta: '¡Escaneá y sumate!',
      textoTeaser: null,
    });
  });

  it('CON fila de diseño pero todos sus overrides en null, el resultado es IDÉNTICO a sin fila', () => {
    const sinFila = combinarDatosCartel(COMERCIO, null);
    const conFilaVacia = combinarDatosCartel(COMERCIO, {
      plantilla: 'centrado',
      color_fondo: null,
      color_texto: null,
      color_label: null,
      logo_url: null,
      texto_cta: '¡Escaneá y sumate!',
      texto_teaser: null,
    });
    expect(conFilaVacia).toEqual(sinFila);
  });

  it('un override no-nulo GANA sobre el valor de comercios', () => {
    const r = combinarDatosCartel(COMERCIO, {
      plantilla: 'split',
      color_fondo: '#000000',
      color_texto: null,
      color_label: null,
      logo_url: 'https://ejemplo.test/logo-cartel.webp',
      texto_cta: 'Sumate al club',
      texto_teaser: 'Tu 5to café gratis',
    });
    expect(r.plantilla).toBe('split');
    expect(r.colorFondo).toBe('#000000');
    expect(r.colorTexto).toBe('rgb(245, 237, 224)'); // no overrideado: hereda
    expect(r.logoUrl).toBe('https://ejemplo.test/logo-cartel.webp');
    expect(r.textoCta).toBe('Sumate al club');
    expect(r.textoTeaser).toBe('Tu 5to café gratis');
  });

  it('fotoUrl SIEMPRE viene de comercios.hero_url — no existe override de foto', () => {
    const r = combinarDatosCartel(COMERCIO, {
      plantilla: 'foto',
      color_fondo: null,
      color_texto: null,
      color_label: null,
      logo_url: null,
      texto_cta: '¡Escaneá y sumate!',
      texto_teaser: null,
    });
    expect(r.fotoUrl).toBe('https://ejemplo.test/hero.webp');
  });

  it('un comercio SIN marca configurada cae en los defaults del sistema, no en null/undefined', () => {
    const comercioNuevo = {
      nombre: 'Negocio Nuevo',
      color_fondo: null,
      color_texto: null,
      color_label: null,
      logo_url: null,
      hero_url: null,
    };
    const r = combinarDatosCartel(comercioNuevo, null);
    expect(r.colorFondo).toBe('rgb(19, 19, 21)');
    expect(r.colorTexto).toBe('rgb(245, 245, 240)');
    expect(r.colorLabel).toBe('rgb(255, 157, 66)');
    expect(r.logoUrl).toBeNull();
    expect(r.fotoUrl).toBeNull();
  });

  it('una plantilla guardada inválida (dato corrupto) cae a "centrado" en vez de propagarse', () => {
    const r = combinarDatosCartel(COMERCIO, {
      plantilla: 'esto-no-es-una-plantilla',
      color_fondo: null,
      color_texto: null,
      color_label: null,
      logo_url: null,
      texto_cta: '¡Escaneá y sumate!',
      texto_teaser: null,
    });
    expect(r.plantilla).toBe('centrado');
  });
});
```

- [ ] **Step 2: Correr y confirmar que falla**

```bash
npx vitest run lib/comercio/cartel/combinarDatos.test.ts
```

Expected: FAIL — `Cannot find module './combinarDatos'`.

- [ ] **Step 3: Implementar**

Crear `lib/comercio/cartel/combinarDatos.ts`:

```ts
import { esPlantillaCartel, type PlantillaCartel } from './tipos';

// Defaults del sistema cuando el comercio JAMÁS configuró su marca — mismos literales que ya usa
// app/comercio/(protegido)/branding/page.tsx para precargar su formulario, para que un comercio sin
// nada configurado vea el MISMO color en el cartel que vería si abriera su editor de marca.
const COLOR_FONDO_DEFECTO = 'rgb(19, 19, 21)';
const COLOR_TEXTO_DEFECTO = 'rgb(245, 245, 240)';
const COLOR_LABEL_DEFECTO = 'rgb(255, 157, 66)';
const TEXTO_CTA_DEFECTO = '¡Escaneá y sumate!';

export interface ComercioParaCartel {
  nombre: string;
  color_fondo: string | null;
  color_texto: string | null;
  color_label: string | null;
  logo_url: string | null;
  hero_url: string | null;
}

export interface FilaDisenoCartel {
  plantilla: string;
  color_fondo: string | null;
  color_texto: string | null;
  color_label: string | null;
  logo_url: string | null;
  texto_cta: string;
  texto_teaser: string | null;
}

export interface DatosCartelResueltos {
  nombreComercio: string;
  plantilla: PlantillaCartel;
  colorFondo: string;
  colorTexto: string;
  colorLabel: string;
  logoUrl: string | null;
  fotoUrl: string | null;
  textoCta: string;
  textoTeaser: string | null;
}

// El corazón del riesgo del spec: cada override en null hereda de `comercio`; la AUSENCIA total de
// `diseno` (null) equivale exactamente a que los 4 overrides fueran null — por eso las dos primeras
// pruebas de arriba dan el mismo resultado byte a byte. `fotoUrl` NO tiene override: siempre sale de
// `comercio.hero_url` (spec §3 — disenos_cartel no tiene columna de foto).
export function combinarDatosCartel(
  comercio: ComercioParaCartel,
  diseno: FilaDisenoCartel | null,
): DatosCartelResueltos {
  return {
    nombreComercio: comercio.nombre,
    plantilla: esPlantillaCartel(diseno?.plantilla) ? diseno.plantilla : 'centrado',
    colorFondo: diseno?.color_fondo ?? comercio.color_fondo ?? COLOR_FONDO_DEFECTO,
    colorTexto: diseno?.color_texto ?? comercio.color_texto ?? COLOR_TEXTO_DEFECTO,
    colorLabel: diseno?.color_label ?? comercio.color_label ?? COLOR_LABEL_DEFECTO,
    logoUrl: diseno?.logo_url ?? comercio.logo_url,
    fotoUrl: comercio.hero_url,
    textoCta: diseno?.texto_cta ?? TEXTO_CTA_DEFECTO,
    textoTeaser: diseno?.texto_teaser ?? null,
  };
}
```

- [ ] **Step 4: Correr y confirmar que pasa**

```bash
npx vitest run lib/comercio/cartel/combinarDatos.test.ts
```

Expected: 6 PASS.

- [ ] **Step 5: Mutation-testing — obligatorio, es la lógica de más riesgo del plan**

Para cada mutación: romper la línea, correr `npx vitest run lib/comercio/cartel/combinarDatos.test.ts`,
confirmar que FALLA por la razón correcta (qué prueba, qué mensaje), restaurar el archivo.

1. Cambiar `diseno?.color_fondo ?? comercio.color_fondo ?? COLOR_FONDO_DEFECTO` por
   `diseno?.color_fondo ?? COLOR_FONDO_DEFECTO` (se salta la herencia de `comercio`) — debe fallar
   "un override no-nulo GANA sobre el valor de comercios" Y "SIN fila de diseño, hereda TODO".
2. Cambiar `fotoUrl: comercio.hero_url` por `fotoUrl: diseno?.logo_url ?? comercio.hero_url` (inventa
   un override de foto que no existe) — debe fallar "fotoUrl SIEMPRE viene de comercios.hero_url".
3. Cambiar `esPlantillaCartel(diseno?.plantilla) ? diseno.plantilla : 'centrado'` por
   `(diseno?.plantilla as PlantillaCartel) ?? 'centrado'` (confía en el dato sin validar) — debe
   fallar "una plantilla guardada inválida... cae a centrado".

- [ ] **Step 6: Commit**

```bash
git add lib/comercio/cartel/combinarDatos.ts lib/comercio/cartel/combinarDatos.test.ts
git commit -m "Cartel: combinarDatosCartel, la logica pura de override-vs-heredado (con mutation-testing)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: `resolverDatosCartel` — la capa de I/O (Supabase + data URIs)

**Files:**
- Create: `lib/comercio/cartel/resolverDatosCartel.ts`
- Create: `lib/comercio/cartel/resolverDatosCartel.test.ts`

**Depende de que la migración 0026 ya esté aplicada en la base real** (Task 1, Step 6) — este archivo
consulta `disenos_cartel` de verdad.

- [ ] **Step 1: Escribir la prueba que falla**

Este archivo SÍ toca Supabase, así que la prueba usa la base real (mismo criterio que el resto del
proyecto: Vitest corre contra Supabase real, sin mocks, en serie). Crear
`lib/comercio/cartel/resolverDatosCartel.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServiceClient } from '@/lib/supabase/server';
import { resolverDatosCartel } from './resolverDatosCartel';

describe('resolverDatosCartel', () => {
  const supabase = createServiceClient();
  let comercioId: string;
  let programaId: string;

  beforeEach(async () => {
    const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { data: comercio } = await supabase
      .from('comercios')
      .insert({
        nombre: 'Café de Prueba',
        slug: `cafe-prueba-${sufijo}`,
        logo_url: 'https://ejemplo.test/logo.webp',
      })
      .select('id')
      .single();
    comercioId = comercio!.id;

    const { data: programa } = await supabase
      .from('programas_tarjeta')
      .insert({ comercio_id: comercioId, nombre: 'Principal', slug: 'principal', tipo_tarjeta: 'sellos', es_principal: true })
      .select('id')
      .single();
    programaId = programa!.id;
  });

  afterEach(async () => {
    await supabase.from('disenos_cartel').delete().eq('comercio_id', comercioId);
    await supabase.from('programas_tarjeta').delete().eq('comercio_id', comercioId);
    await supabase.from('comercios').delete().eq('id', comercioId);
  });

  it('devuelve null si el programa NO pertenece al comercio (chequeo de propiedad)', async () => {
    const { data: otroComercio } = await supabase
      .from('comercios')
      .insert({ nombre: 'Otro comercio', slug: `otro-${Date.now()}` })
      .select('id')
      .single();
    try {
      const r = await resolverDatosCartel(supabase, otroComercio!.id, programaId);
      expect(r).toBeNull();
    } finally {
      await supabase.from('comercios').delete().eq('id', otroComercio!.id);
    }
  });

  it('sin fila en disenos_cartel, resuelve con los defaults heredados del comercio', async () => {
    const r = await resolverDatosCartel(supabase, comercioId, programaId);
    expect(r).not.toBeNull();
    expect(r!.nombreComercio).toBe('Café de Prueba');
    expect(r!.plantilla).toBe('centrado');
    expect(r!.urlRegistro).toContain('/registro/');
  });

  it('logoDataUri es null si el logo no se pudo descargar (best-effort, no revienta)', async () => {
    // 'https://ejemplo.test/logo.webp' no es una URL real: el fetch debe fallar en silencio.
    const r = await resolverDatosCartel(supabase, comercioId, programaId);
    expect(r!.logoDataUri).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y confirmar que falla**

```bash
npx vitest run lib/comercio/cartel/resolverDatosCartel.test.ts
```

Expected: FAIL — `Cannot find module './resolverDatosCartel'`.

- [ ] **Step 3: Implementar**

Crear `lib/comercio/cartel/resolverDatosCartel.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import { combinarDatosCartel } from './combinarDatos';
import { urlRegistroPrograma } from '../urlRegistroPrograma';
import type { DatosCartel } from './tipos';

// Descarga una imagen pública (Storage) y la convierte a data: URI. NUNCA se pasa una URL remota a
// construirCartelSvg (spec §4.1): un renderizador SVG del lado servidor puede no resolver
// referencias externas, y el logo/foto desaparecerían en silencio en el PNG/PDF exportado.
// Best-effort: si falla, el cartel se arma igual sin esa imagen (spec §7).
async function aDataUri(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const respuesta = await fetch(url);
    if (!respuesta.ok) return null;
    const tipo = respuesta.headers.get('content-type') ?? 'image/webp';
    const bytes = Buffer.from(await respuesta.arrayBuffer());
    return `data:${tipo};base64,${bytes.toString('base64')}`;
  } catch (error) {
    console.warn('[comercio] no se pudo convertir una imagen del cartel a data URI:', error);
    return null;
  }
}

// Punto de entrada único para leer todo lo que necesita el cartel de un programa. El chequeo de
// propiedad vive ACÁ (el filtro .eq('comercio_id', comercioId) sobre programas_tarjeta): si el
// programaId no es de este comercio, `programa` viene null y la función devuelve null ANTES de leer
// nada más — así el Server Component, el Route Handler de descarga y cualquier otro llamador quedan
// protegidos por el mismo código, sin tener que repetir el chequeo cada uno por su cuenta.
export async function resolverDatosCartel(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  programaId: string,
): Promise<DatosCartel | null> {
  const [{ data: comercio, error: eComercio }, { data: programa, error: ePrograma }, { data: diseno, error: eDiseno }] =
    await Promise.all([
      supabase
        .from('comercios')
        .select('nombre, slug, color_fondo, color_texto, color_label, logo_url, hero_url')
        .eq('id', comercioId)
        .maybeSingle(),
      supabase
        .from('programas_tarjeta')
        .select('slug, es_principal')
        .eq('id', programaId)
        .eq('comercio_id', comercioId)
        .maybeSingle(),
      supabase
        .from('disenos_cartel')
        .select('plantilla, color_fondo, color_texto, color_label, logo_url, texto_cta, texto_teaser')
        .eq('programa_id', programaId)
        .maybeSingle(),
    ]);

  if (eComercio || !comercio || ePrograma || !programa) {
    if (eComercio) console.error('[comercio] no se pudo leer el comercio para el cartel:', eComercio);
    if (ePrograma) console.error('[comercio] no se pudo leer el programa para el cartel:', ePrograma);
    return null;
  }
  // eDiseno: la ausencia de fila NO es un error (spec §3, "sin personalizar"). Solo se registra un
  // error real de consulta, y se trata como "sin fila" para no bloquear el cartel por esto.
  if (eDiseno) console.error('[comercio] no se pudo leer el diseño de cartel guardado:', eDiseno);

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  const urlRegistro = urlRegistroPrograma(baseUrl, comercio.slug, programa.slug, programa.es_principal);
  if (!urlRegistro) {
    console.error('[comercio] falta NEXT_PUBLIC_BASE_URL: no se puede armar el QR del cartel');
    return null;
  }

  const combinados = combinarDatosCartel(comercio, eDiseno ? null : diseno);

  const [logoDataUri, fotoDataUri] = await Promise.all([
    aDataUri(combinados.logoUrl),
    aDataUri(combinados.fotoUrl),
  ]);

  return {
    nombreComercio: combinados.nombreComercio,
    plantilla: combinados.plantilla,
    colorFondo: combinados.colorFondo,
    colorTexto: combinados.colorTexto,
    colorLabel: combinados.colorLabel,
    logoDataUri,
    fotoDataUri,
    textoCta: combinados.textoCta,
    textoTeaser: combinados.textoTeaser,
    urlRegistro,
  };
}
```

- [ ] **Step 4: Correr y confirmar que pasa**

```bash
npx vitest run lib/comercio/cartel/resolverDatosCartel.test.ts
```

Expected: 3 PASS. Si `NEXT_PUBLIC_BASE_URL` no está en `.env.local` de pruebas, la segunda prueba
fallaría por eso — no por lógica; confirmar que la variable existe antes de investigar más.

- [ ] **Step 5: Typecheck y lint**

```bash
npx tsc --noEmit
npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add lib/comercio/cartel/resolverDatosCartel.ts lib/comercio/cartel/resolverDatosCartel.test.ts
git commit -m "Cartel: resolverDatosCartel, capa de I/O con el chequeo de propiedad del programa

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: Exportación a PNG y PDF (`sharp` + `pdf-lib`)

**Files:**
- Modify: `package.json` (agrega `pdf-lib`)
- Create: `lib/comercio/cartel/export.ts`
- Create: `lib/comercio/cartel/export.test.ts`

- [ ] **Step 1: Instalar la dependencia nueva**

```bash
npm install pdf-lib
```

Expected: `package.json` y `package-lock.json` se actualizan solos con la versión resuelta — no
editar el número de versión a mano.

- [ ] **Step 2: Escribir las pruebas que fallan**

Crear `lib/comercio/cartel/export.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { construirCartelSvg } from './plantillas';
import { rasterizarCartelPng, generarCartelPdf } from './export';
import { DIMENSIONES_CARTEL } from './tipos';
import type { DatosCartel } from './tipos';

const DATOS: DatosCartel = {
  nombreComercio: 'Café Sol',
  plantilla: 'centrado',
  colorFondo: '#3b2a1e',
  colorTexto: '#f5ede0',
  colorLabel: '#e8b978',
  logoDataUri: null,
  fotoDataUri: null,
  textoCta: '¡Escaneá y sumate!',
  textoTeaser: null,
  urlRegistro: 'https://www.cardly-sv.site/registro/cafe-sol',
};

describe('rasterizarCartelPng', () => {
  it('el PNG del sticker mide EXACTAMENTE 1181x1181px (no un raster chico ampliado)', async () => {
    const svg = await construirCartelSvg(DATOS, 'sticker');
    const png = await rasterizarCartelPng(svg, 'sticker');
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(DIMENSIONES_CARTEL.sticker.px.ancho);
    expect(meta.height).toBe(DIMENSIONES_CARTEL.sticker.px.alto);
  });

  it('el PNG del mostrador mide EXACTAMENTE 1748x2480px', async () => {
    const svg = await construirCartelSvg(DATOS, 'mostrador');
    const png = await rasterizarCartelPng(svg, 'mostrador');
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(DIMENSIONES_CARTEL.mostrador.px.ancho);
    expect(meta.height).toBe(DIMENSIONES_CARTEL.mostrador.px.alto);
  });
});

describe('generarCartelPdf', () => {
  it('la página del PDF del sticker mide 283.46x283.46pt', async () => {
    const svg = await construirCartelSvg(DATOS, 'sticker');
    const png = await rasterizarCartelPng(svg, 'sticker');
    const pdfBytes = await generarCartelPdf(png, 'sticker');
    const pdf = await PDFDocument.load(pdfBytes);
    const { width, height } = pdf.getPage(0).getSize();
    expect(width).toBeCloseTo(DIMENSIONES_CARTEL.sticker.pt.ancho, 1);
    expect(height).toBeCloseTo(DIMENSIONES_CARTEL.sticker.pt.alto, 1);
  });

  it('el PDF tiene exactamente 1 página', async () => {
    const svg = await construirCartelSvg(DATOS, 'sticker');
    const png = await rasterizarCartelPng(svg, 'sticker');
    const pdfBytes = await generarCartelPdf(png, 'sticker');
    const pdf = await PDFDocument.load(pdfBytes);
    expect(pdf.getPageCount()).toBe(1);
  });
});
```

- [ ] **Step 3: Correr y confirmar que falla**

```bash
npx vitest run lib/comercio/cartel/export.test.ts
```

Expected: FAIL — `Cannot find module './export'`.

- [ ] **Step 4: Implementar**

Crear `lib/comercio/cartel/export.ts`:

```ts
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { DIMENSIONES_CARTEL, type FormatoCartel } from './tipos';

// ⚠️ TRAMPA VERIFICADA (node_modules/sharp/lib/constructor.js:156): `density` es una opción de CARGA
// para vectores (default 72dpi) que `.resize()` NO ajusta. El <svg> que arma plantillas.ts ya trae
// width/height físicos en mm — sin fijar `density: 300` acá, sharp rasterizaría ese SVG a ~400x400px
// (72dpi de un viewBox sin unidad física) y el resize() de abajo sería un UPSCALE CON PÉRDIDA de un
// raster chico, no una rasterización nítida a 300dpi. Con density:300 + los mm del SVG, sharp
// rasteriza NATIVAMENTE al tamaño de destino y el resize() que sigue es, como mucho, un ajuste de
// redondeo de 1-2px (spec §5.2).
export async function rasterizarCartelPng(svg: string, formato: FormatoCartel): Promise<Buffer> {
  const dim = DIMENSIONES_CARTEL[formato];
  return sharp(Buffer.from(svg), { density: 300 })
    .resize(dim.px.ancho, dim.px.alto)
    .png()
    .toBuffer();
}

// Un PNG único embebido ocupando toda la página, del tamaño físico exacto en puntos — no texto
// vectorial con las fuentes de pdf-lib (que no traen la tipografía de marca). Así el PDF es
// pixel-idéntico a la vista previa y al PNG exportado (spec §5.3).
export async function generarCartelPdf(pngBuffer: Buffer, formato: FormatoCartel): Promise<Buffer> {
  const dim = DIMENSIONES_CARTEL[formato];
  const pdf = await PDFDocument.create();
  const pagina = pdf.addPage([dim.pt.ancho, dim.pt.alto]);
  const png = await pdf.embedPng(pngBuffer);
  pagina.drawImage(png, { x: 0, y: 0, width: dim.pt.ancho, height: dim.pt.alto });
  return Buffer.from(await pdf.save());
}
```

- [ ] **Step 5: Correr y confirmar que pasa**

```bash
npx vitest run lib/comercio/cartel/export.test.ts
```

Expected: 4 PASS.

- [ ] **Step 6: Mutation-testing de la trampa de densidad**

Quitar `{ density: 300 }` de `rasterizarCartelPng` (dejar `sharp(Buffer.from(svg))` a secas) y correr
de nuevo las 2 pruebas de `rasterizarCartelPng`. **Deben fallar** — el PNG resultante NO va a medir
1181x1181/1748x2480 (va a medir lo que `.resize()` diga sin importar la densidad real de carga, PERO
la calidad/nitidez no es lo que esta prueba mide — si por casualidad las dimensiones igual dieran
bien, es una señal de que la prueba necesita reforzarse, no de que la mutación sea inofensiva:
avisar y no continuar sin resolverlo). Restaurar `{ density: 300 }`.

- [ ] **Step 7: Typecheck y lint**

```bash
npx tsc --noEmit
npm run lint
```

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json lib/comercio/cartel/export.ts lib/comercio/cartel/export.test.ts
git commit -m "Cartel: exportacion a PNG (sharp, con density correcta) y PDF (pdf-lib)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 11: Server Actions — guardar configuración y subir/quitar logo propio

**Files:**
- Create: `app/comercio/(protegido)/programas/[id]/cartel/actions.ts`

- [ ] **Step 1: Implementar**

Crear `app/comercio/(protegido)/programas/[id]/cartel/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { obtenerPrograma } from '@/lib/comercio/programas';
import {
  validarImagenSubida,
  extensionDeMime,
  rutaImagenCartel,
} from '@/lib/comercio/imagenComercio';
import { esPlantillaCartel } from '@/lib/comercio/cartel/tipos';

const BUCKET_IMAGENES = 'comercio-imagenes';

export type EstadoCartel = { error: string } | { ok: true } | undefined;

// Guarda la personalización del cartel de UN programa. `obtenerPrograma` (lib/comercio/programas.ts)
// verifica que el programaId sea del comercio de la sesión ANTES de escribir — mismo patrón que
// guardarConfiguracionPrograma/accionSubirFotoRecompensa: programaId llega de la URL del navegador y
// no se confía en él sin verificar.
//
// Se usa SELECT-then-INSERT/UPDATE explícito en vez de `.upsert()` a propósito: un upsert que omite
// `logo_url` del payload podría, dependiendo de cómo PostgREST arme el ON CONFLICT, tocar esa
// columna sin que sea la intención — un UPDATE con una lista de columnas explícita es inequívoco: NO
// toca logo_url pase lo que pase, así que un logo ya subido con accionSubirLogoCartel nunca se borra
// al guardar colores/texto.
export async function accionGuardarCartel(
  programaId: string,
  _estadoPrevio: EstadoCartel,
  formData: FormData,
): Promise<EstadoCartel> {
  const { comercioId } = await verifyComercioOwner();
  const supabase = createServiceClient();

  const programa = await obtenerPrograma(supabase, comercioId, programaId);
  if (!programa) return { error: 'Ese programa no es de tu comercio.' };

  const plantilla = String(formData.get('plantilla') ?? 'centrado');
  if (!esPlantillaCartel(plantilla)) return { error: 'Plantilla no válida.' };

  const textoCta = String(formData.get('texto_cta') ?? '').trim();
  if (!textoCta) return { error: 'El texto del llamado a la acción no puede quedar vacío.' };
  const textoTeaser = String(formData.get('texto_teaser') ?? '').trim() || null;

  // Apagar la personalización BORRA los overrides de color (no los deja ocultos): si el dueño la
  // vuelve a prender después, los selectores parten de la marca ACTUAL del comercio, nunca de un
  // valor viejo escondido (spec §6.3).
  const personalizar = formData.get('personalizar') === 'on';
  const colorFondo = personalizar ? String(formData.get('color_fondo') ?? '').trim() || null : null;
  const colorTexto = personalizar ? String(formData.get('color_texto') ?? '').trim() || null : null;
  const colorLabel = personalizar ? String(formData.get('color_label') ?? '').trim() || null : null;

  const campos = {
    plantilla,
    color_fondo: colorFondo,
    color_texto: colorTexto,
    color_label: colorLabel,
    texto_cta: textoCta,
    texto_teaser: textoTeaser,
  };

  const { data: existente } = await supabase
    .from('disenos_cartel')
    .select('id')
    .eq('programa_id', programaId)
    .maybeSingle();

  const { error } = existente
    ? await supabase.from('disenos_cartel').update(campos).eq('id', existente.id)
    : await supabase.from('disenos_cartel').insert({ ...campos, programa_id: programaId, comercio_id: comercioId });

  if (error) {
    console.error('[comercio] no se pudo guardar el cartel:', error);
    return { error: 'No se pudo guardar el cartel.' };
  }

  // No dispara notificarCambioComercio ni syncClaseComercio/syncObjetosComercio: el cartel no toca
  // el .pkpass ni el pase de Google en absoluto (spec §6.4) — es un documento aparte para imprimir.
  revalidatePath(`/comercio/programas/${programaId}/cartel`);
  return { ok: true };
}

// Sube el logo PROPIO del cartel (cuando el comercio no quiere heredar el de su marca para este
// cartel puntual). Mismo patrón que accionSubirFotoRecompensa: el programa se verifica ANTES de
// escribir en Storage.
export async function accionSubirLogoCartel(
  programaId: string,
  _estadoPrevio: EstadoCartel,
  formData: FormData,
): Promise<EstadoCartel> {
  const { comercioId } = await verifyComercioOwner();
  const supabase = createServiceClient();

  const programa = await obtenerPrograma(supabase, comercioId, programaId);
  if (!programa) return { error: 'Ese programa no es de tu comercio.' };

  const archivo = formData.get('archivo');
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { error: 'No se recibió ninguna imagen.' };
  }

  const problema = validarImagenSubida({ type: archivo.type, size: archivo.size });
  if (problema) return { error: problema };

  const ext = extensionDeMime(archivo.type);
  const ruta = rutaImagenCartel(comercioId, programaId, ext);

  const { error: errorSubida } = await supabase.storage
    .from(BUCKET_IMAGENES)
    .upload(ruta, await archivo.arrayBuffer(), { contentType: archivo.type, upsert: true });
  if (errorSubida) {
    console.error('[comercio] falló la subida del logo del cartel:', errorSubida);
    return { error: 'No se pudo subir la imagen.' };
  }

  const { data: pub } = supabase.storage.from(BUCKET_IMAGENES).getPublicUrl(ruta);
  const urlConVersion = `${pub.publicUrl}?v=${Date.now()}`;

  const { data: existente } = await supabase
    .from('disenos_cartel')
    .select('id')
    .eq('programa_id', programaId)
    .maybeSingle();

  const { error } = existente
    ? await supabase.from('disenos_cartel').update({ logo_url: urlConVersion }).eq('id', existente.id)
    : await supabase.from('disenos_cartel').insert({ programa_id: programaId, comercio_id: comercioId, logo_url: urlConVersion });

  if (error) {
    console.error('[comercio] se subió el logo pero no se pudo guardar su dirección:', error);
    return { error: 'La imagen se subió pero no se pudo guardar.' };
  }

  revalidatePath(`/comercio/programas/${programaId}/cartel`);
  return { ok: true };
}

export async function accionQuitarLogoCartel(
  programaId: string,
  _estadoPrevio: EstadoCartel,
  _formData: FormData,
): Promise<EstadoCartel> {
  const { comercioId } = await verifyComercioOwner();
  const supabase = createServiceClient();

  const programa = await obtenerPrograma(supabase, comercioId, programaId);
  if (!programa) return { error: 'Ese programa no es de tu comercio.' };

  const { error } = await supabase
    .from('disenos_cartel')
    .update({ logo_url: null })
    .eq('programa_id', programaId);
  if (error) {
    console.error('[comercio] no se pudo quitar el logo del cartel:', error);
    return { error: 'No se pudo quitar la imagen.' };
  }

  // Borrado del archivo best-effort y a ciegas sobre las tres extensiones posibles — mismo criterio
  // que accionQuitarFotoRecompensa.
  await supabase.storage
    .from(BUCKET_IMAGENES)
    .remove(['png', 'jpg', 'webp'].map((ext) => rutaImagenCartel(comercioId, programaId, ext)));

  revalidatePath(`/comercio/programas/${programaId}/cartel`);
  return { ok: true };
}
```

- [ ] **Step 2: Typecheck y lint**

```bash
npx tsc --noEmit
npm run lint
```

Expected: sin errores (todavía no hay página que importe estas acciones, pero deben compilar solas).

- [ ] **Step 3: Commit**

```bash
git add "app/comercio/(protegido)/programas/[id]/cartel/actions.ts"
git commit -m "Cartel: server actions de guardado y subida/quita del logo propio

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 12: Server Component — `page.tsx` del editor

**Files:**
- Create: `app/comercio/(protegido)/programas/[id]/cartel/page.tsx`

- [ ] **Step 1: Implementar**

Crear `app/comercio/(protegido)/programas/[id]/cartel/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { resolverDatosCartel } from '@/lib/comercio/cartel/resolverDatosCartel';
import EditorCartel from './EditorCartel';

export const dynamic = 'force-dynamic';

export default async function PaginaCartel({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: programaId } = await params;
  const { comercioId } = await verifyComercioOwner();

  const supabase = createServiceClient();

  // resolverDatosCartel YA verifica que programaId sea del comercio de la sesión (lee
  // programas_tarjeta con .eq('comercio_id', comercioId)) — null significa "no existe o no es tuyo",
  // y las dos se tratan igual: 404, sin distinguir cuál para no filtrar si un id ajeno existe.
  const datos = await resolverDatosCartel(supabase, comercioId, programaId);
  if (!datos) notFound();

  // El comercio también se lee aparte (sin overrides) para que el toggle "usar mi marca" pueda
  // volver a estos valores crudos sin ida y vuelta al servidor (spec §6.3).
  const { data: comercio } = await supabase
    .from('comercios')
    .select('color_fondo, color_texto, color_label')
    .eq('id', comercioId)
    .maybeSingle();

  const { data: disenoGuardado } = await supabase
    .from('disenos_cartel')
    .select('color_fondo, color_texto, color_label, logo_url')
    .eq('programa_id', programaId)
    .maybeSingle();

  return (
    <main className="admin-main" style={{ maxWidth: 720 }}>
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>Diseñar cartel</h1>
        <Link className="admin-fila-slug" href="/comercio/programas">← Volver</Link>
      </div>
      <p className="lede reveal d1" style={{ marginTop: 0 }}>
        El cartel para mesa (sticker) o mostrador que tus clientes escanean para sumarse a{' '}
        {datos.nombreComercio}.
      </p>

      <EditorCartel
        programaId={programaId}
        datosResueltos={datos}
        marcaComercio={{
          colorFondo: comercio?.color_fondo ?? 'rgb(19, 19, 21)',
          colorTexto: comercio?.color_texto ?? 'rgb(245, 245, 240)',
          colorLabel: comercio?.color_label ?? 'rgb(255, 157, 66)',
        }}
        personalizadoInicial={
          disenoGuardado?.color_fondo != null ||
          disenoGuardado?.color_texto != null ||
          disenoGuardado?.color_label != null
        }
        tieneLogoPropio={disenoGuardado?.logo_url != null}
      />
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: FALLA — `EditorCartel` todavía no existe. Es esperado; se resuelve en la Tarea 13. No
commitear todavía.

---

## Task 13: Client Component — `EditorCartel.tsx`

**Files:**
- Create: `app/comercio/(protegido)/programas/[id]/cartel/EditorCartel.tsx`

- [ ] **Step 1: Implementar**

Crear `app/comercio/(protegido)/programas/[id]/cartel/EditorCartel.tsx`:

```tsx
'use client';

import { useActionState, useMemo, useRef, useState } from 'react';
import { construirCartelSvg } from '@/lib/comercio/cartel/plantillas';
import type { DatosCartel, FormatoCartel, PlantillaCartel } from '@/lib/comercio/cartel/tipos';
import { PLANTILLAS_CARTEL } from '@/lib/comercio/cartel/tipos';
import {
  accionGuardarCartel,
  accionSubirLogoCartel,
  accionQuitarLogoCartel,
  type EstadoCartel,
} from './actions';

const ETIQUETAS_PLANTILLA: Record<PlantillaCartel, string> = {
  centrado: 'Centrado clásico',
  split: 'Split (franja + QR)',
  foto: 'Foto de fondo',
};

export default function EditorCartel({
  programaId,
  datosResueltos,
  marcaComercio,
  personalizadoInicial,
  tieneLogoPropio,
}: {
  programaId: string;
  datosResueltos: DatosCartel;
  marcaComercio: { colorFondo: string; colorTexto: string; colorLabel: string };
  personalizadoInicial: boolean;
  tieneLogoPropio: boolean;
}) {
  const [plantilla, setPlantilla] = useState<PlantillaCartel>(datosResueltos.plantilla);
  const [personalizar, setPersonalizar] = useState(personalizadoInicial);
  const [colorFondo, setColorFondo] = useState(datosResueltos.colorFondo);
  const [colorTexto, setColorTexto] = useState(datosResueltos.colorTexto);
  const [colorLabel, setColorLabel] = useState(datosResueltos.colorLabel);
  const [textoCta, setTextoCta] = useState(datosResueltos.textoCta);
  const [textoTeaser, setTextoTeaser] = useState(datosResueltos.textoTeaser ?? '');
  const [formato, setFormato] = useState<FormatoCartel>('sticker');
  const [previewSvg, setPreviewSvg] = useState<string>('');

  const inputLogoRef = useRef<HTMLInputElement>(null);

  // Al apagar la personalización, los inputs vuelven a la marca actual del comercio — NUNCA a un
  // valor guardado escondido (spec §6.3). Al prenderla, arrancan de lo que ya se ve (que en ese
  // momento coincide con la marca, porque veníamos de apagado).
  function alternarPersonalizar(activar: boolean) {
    setPersonalizar(activar);
    if (!activar) {
      setColorFondo(marcaComercio.colorFondo);
      setColorTexto(marcaComercio.colorTexto);
      setColorLabel(marcaComercio.colorLabel);
    }
  }

  const datosVivos: DatosCartel = useMemo(
    () => ({
      ...datosResueltos,
      plantilla,
      colorFondo,
      colorTexto,
      colorLabel,
      textoCta,
      textoTeaser: textoTeaser.trim() || null,
    }),
    [datosResueltos, plantilla, colorFondo, colorTexto, colorLabel, textoCta, textoTeaser],
  );

  // Vista previa en vivo: la MISMA función que arma el PNG/PDF exportado (construirCartelSvg), sin
  // ida y vuelta al servidor. Es async porque `qrcode` expone una API por promesa (no hace ningún
  // fetch de red) — el efecto descarta cualquier respuesta que ya no sea la más reciente.
  useMemo(() => {
    let vigente = true;
    construirCartelSvg(datosVivos, formato).then((svg) => {
      if (vigente) setPreviewSvg(svg);
    });
    return () => {
      vigente = false;
    };
  }, [datosVivos, formato]);

  const guardar = accionGuardarCartel.bind(null, programaId);
  const [estadoGuardar, ejecutarGuardar, guardando] = useActionState<EstadoCartel, FormData>(guardar, undefined);

  const subirLogo = accionSubirLogoCartel.bind(null, programaId);
  const [estadoLogo, ejecutarSubirLogo, subiendoLogo] = useActionState<EstadoCartel, FormData>(subirLogo, undefined);

  const quitarLogo = accionQuitarLogoCartel.bind(null, programaId);
  const [estadoQuitarLogo, ejecutarQuitarLogo] = useActionState<EstadoCartel, FormData>(quitarLogo, undefined);

  const error =
    (estadoGuardar && 'error' in estadoGuardar && estadoGuardar.error) ||
    (estadoLogo && 'error' in estadoLogo && estadoLogo.error) ||
    (estadoQuitarLogo && 'error' in estadoQuitarLogo && estadoQuitarLogo.error) ||
    null;

  return (
    <div className="reveal d2" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <p className="label">Plantilla</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {PLANTILLAS_CARTEL.map((p) => (
            <button
              key={p}
              type="button"
              className={p === plantilla ? 'btn-primary' : 'btn-borde'}
              onClick={() => setPlantilla(p)}
            >
              {ETIQUETAS_PLANTILLA[p]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="label">Formato</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            className={formato === 'sticker' ? 'btn-primary' : 'btn-borde'}
            onClick={() => setFormato('sticker')}
          >
            Sticker de mesa (10×10cm)
          </button>
          <button
            type="button"
            className={formato === 'mostrador' ? 'btn-primary' : 'btn-borde'}
            onClick={() => setFormato('mostrador')}
          >
            Mostrador (A5)
          </button>
        </div>
      </div>

      {previewSvg && (
        <div className="panel" style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
          {/* eslint-disable-next-line react/no-danger -- SVG construido por construirCartelSvg, con
              todo texto libre ya escapado (ver plantillas.ts); no hay markup del usuario sin pasar
              por escaparXml. */}
          <div style={{ maxWidth: 260 }} dangerouslySetInnerHTML={{ __html: previewSvg }} />
        </div>
      )}

      <form action={ejecutarGuardar} className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <input type="hidden" name="plantilla" value={plantilla} />

        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            name="personalizar"
            checked={personalizar}
            onChange={(e) => alternarPersonalizar(e.target.checked)}
          />
          Personalizar colores para este cartel (si no, usa los de tu marca)
        </label>

        {personalizar && (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <label>
              Fondo
              <input type="color" name="color_fondo" value={colorFondo} onChange={(e) => setColorFondo(e.target.value)} />
            </label>
            <label>
              Texto
              <input type="color" name="color_texto" value={colorTexto} onChange={(e) => setColorTexto(e.target.value)} />
            </label>
            <label>
              Acento
              <input type="color" name="color_label" value={colorLabel} onChange={(e) => setColorLabel(e.target.value)} />
            </label>
          </div>
        )}

        <label>
          Llamado a la acción
          <input
            className="field"
            name="texto_cta"
            value={textoCta}
            maxLength={60}
            onChange={(e) => setTextoCta(e.target.value)}
          />
        </label>

        <label>
          Teaser opcional (ej. &quot;Tu 5to café gratis&quot;)
          <input
            className="field"
            name="texto_teaser"
            value={textoTeaser}
            maxLength={60}
            onChange={(e) => setTextoTeaser(e.target.value)}
          />
        </label>

        <button type="submit" className="btn-primary" disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar cartel'}
        </button>
      </form>

      <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span className="label">Logo propio de este cartel</span>
        <form action={ejecutarSubirLogo}>
          <input
            ref={inputLogoRef}
            type="file"
            name="archivo"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: 'none' }}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
          />
          <button
            type="button"
            className="btn-borde"
            disabled={subiendoLogo}
            onClick={() => inputLogoRef.current?.click()}
          >
            {subiendoLogo ? 'Subiendo…' : tieneLogoPropio ? 'Cambiar logo' : 'Subir logo propio'}
          </button>
        </form>
        {tieneLogoPropio && (
          <form action={ejecutarQuitarLogo}>
            <button type="submit" className="btn-borde">Quitar (volver al logo de marca)</button>
          </form>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <a className="btn-borde" href={`/comercio/programas/${programaId}/cartel/descargar?formato=${formato}&tipo=png`}>
          Descargar PNG
        </a>
        <a className="btn-borde" href={`/comercio/programas/${programaId}/cartel/descargar?formato=${formato}&tipo=pdf`}>
          Descargar PDF
        </a>
      </div>

      {error && <p className="alerta" role="alert">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck y lint**

```bash
npx tsc --noEmit
npm run lint
```

Expected: sin errores (la Tarea 12 quedó pendiente de esto — ahora debería compilar completo).

- [ ] **Step 3: Commit**

```bash
git add "app/comercio/(protegido)/programas/[id]/cartel/page.tsx" "app/comercio/(protegido)/programas/[id]/cartel/EditorCartel.tsx"
git commit -m "Cartel: pantalla del editor (Server Component + vista previa en vivo)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 14: Route Handler de descarga + link desde Programas

**Files:**
- Create: `app/comercio/(protegido)/programas/[id]/cartel/descargar/route.ts`
- Modify: `app/comercio/(protegido)/programas/page.tsx`

- [ ] **Step 1: Implementar la ruta de descarga**

Crear `app/comercio/(protegido)/programas/[id]/cartel/descargar/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { resolverDatosCartel } from '@/lib/comercio/cartel/resolverDatosCartel';
import { construirCartelSvg } from '@/lib/comercio/cartel/plantillas';
import { rasterizarCartelPng, generarCartelPdf } from '@/lib/comercio/cartel/export';
import { FORMATOS_CARTEL, type FormatoCartel } from '@/lib/comercio/cartel/tipos';

// `sharp`/`pdf-lib` necesitan el runtime de Node (no Edge) — mismo requisito que ya declara
// hero.png/route.ts para sharp.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Descarga del cartel ya diseñado, en PNG o PDF. Es un Route Handler y no un Server Action porque
// devuelve un ARCHIVO — mismo motivo que clientes/exportar/route.ts.
//
// Gate de DUEÑO: verifyComercioOwner() FUERA de cualquier try/catch (redirect() lanza NEXT_REDIRECT).
// resolverDatosCartel verifica que el programaId de la URL sea del comercioId de la sesión — un
// programa ajeno da null, y acá se traduce a 404 (nunca 403: no hay que confirmarle a nadie que el
// id existe).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: programaId } = await params;
  const { comercioId } = await verifyComercioOwner();

  const formatoParam = request.nextUrl.searchParams.get('formato');
  const tipo = request.nextUrl.searchParams.get('tipo');
  if (!FORMATOS_CARTEL.includes(formatoParam as FormatoCartel) || (tipo !== 'png' && tipo !== 'pdf')) {
    return NextResponse.json({ error: 'Parámetros de descarga inválidos.' }, { status: 400 });
  }
  const formato = formatoParam as FormatoCartel;

  const supabase = createServiceClient();
  const datos = await resolverDatosCartel(supabase, comercioId, programaId);
  if (!datos) {
    return NextResponse.json({ error: 'No encontrado.' }, { status: 404 });
  }

  const svg = await construirCartelSvg(datos, formato);
  const png = await rasterizarCartelPng(svg, formato);

  if (tipo === 'png') {
    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `attachment; filename="cartel-${formato}.png"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  const pdf = await generarCartelPdf(png, formato);
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="cartel-${formato}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
```

- [ ] **Step 2: Agregar el link "Diseñar cartel" en `programas/page.tsx`**

En `app/comercio/(protegido)/programas/page.tsx`, dentro del bloque que ya muestra el QR de cada
programa activo (después del `</div>` que cierra el `qr-tile` y antes del `)}` que cierra el
`{qr && urlRegistro && (...)}`), agregar el link. Buscar:

```tsx
                    <a
                      className="btn-borde"
                      style={{ marginTop: 8 }}
                      href={qr}
                      download={`qr-${comercio?.slug}-${programa.slug}.png`}
                    >
                      <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">download</span>
                      Descargar
                    </a>
                  </div>
                )}
```

Reemplazar por:

```tsx
                    <a
                      className="btn-borde"
                      style={{ marginTop: 8 }}
                      href={qr}
                      download={`qr-${comercio?.slug}-${programa.slug}.png`}
                    >
                      <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">download</span>
                      Descargar
                    </a>
                    <Link
                      className="btn-borde"
                      style={{ marginTop: 8, marginLeft: 8 }}
                      href={`/comercio/programas/${programa.id}/cartel`}
                    >
                      <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">palette</span>
                      Diseñar cartel
                    </Link>
                  </div>
                )}
```

(`Link` de `next/link` ya está importado en este archivo — es el mismo import que usa el "← Volver"
del encabezado.)

- [ ] **Step 3: Typecheck y lint**

```bash
npx tsc --noEmit
npm run lint
```

Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add "app/comercio/(protegido)/programas/[id]/cartel/descargar/route.ts" "app/comercio/(protegido)/programas/page.tsx"
git commit -m "Cartel: ruta de descarga PNG/PDF + link desde Programas

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 15: Ronda de mutación restante, suite completa y verificación manual

**Files:** ninguno nuevo — solo verificación.

- [ ] **Step 1: Confirmar que la migración 0026 ya está aplicada**

Si el usuario todavía no confirmó haber corrido `0026_disenos_cartel.sql` (Task 1, Step 6), **parar
acá** y esperar la confirmación antes de seguir — las Tareas 9, 11 y 12 en adelante ya asumieron que la
tabla existe, pero esta es la primera vez que se corre la suite completa contra la base real.

- [ ] **Step 2: Correr el verificador de la migración**

```bash
npx tsx --conditions=react-server scripts/verificar-0026.ts
```

Expected: todas las líneas `OK:`, ninguna `FALLO:`, termina con "Todo en orden".

- [ ] **Step 3: Suite completa**

```bash
npx vitest run
```

Expected: todos los archivos en PASS, incluidos los 6 archivos de prueba nuevos de este plan.

- [ ] **Step 4: Typecheck y lint del proyecto completo**

```bash
npx tsc --noEmit
npm run lint
```

Expected: sin errores.

- [ ] **Step 5: Verificación manual en el navegador — la hace el orquestador, NO un subagente**

Por regla del proyecto, no se levanta dev server dentro de un subagente. Esta verificación la hace
quien dispatchea las tareas, con las herramientas de navegador:

1. Levantar el dev server y entrar a `/comercio/programas` de un comercio de prueba con al menos un
   programa activo. Confirmar que aparece el link "Diseñar cartel".
2. Abrir el editor. Para CADA una de las 3 plantillas × 2 formatos (6 combinaciones): confirmar
   visualmente que nada se superpone, que el QR se ve completo y con margen blanco alrededor, y que
   el texto no se corta. **Ajustar los números de `plantillas.ts` acá si algo se ve apretado** — es
   el paso esperado de esto, no una señal de que las Tareas 5-7 estén mal (ver la nota al inicio de
   la Tarea 5).
3. Probar el toggle "Personalizar colores": apagarlo y prenderlo, confirmar que vuelve a los colores
   de marca del comercio y no a un valor viejo.
4. Subir un logo propio, confirmar que aparece en la vista previa reemplazando el círculo con la
   inicial. Quitarlo, confirmar que vuelve al logo (o al círculo, si el comercio tampoco tiene logo
   de marca).
5. Descargar un PNG y un PDF de cada formato. Abrir el PNG en un visor de imágenes y confirmar sus
   dimensiones en píxeles contra la tabla del spec §5.1. Abrir el PDF y confirmar que el tamaño de
   página coincide (10×10cm / A5).
6. **Escanear el QR de un PNG o PDF descargado con el teléfono real** — el paso que ninguna prueba
   automatizada puede reemplazar. Confirmar que abre la URL de registro correcta.
7. Con dos comercios de prueba distintos: confirmar que el comercio B NO puede ver ni sobrescribir el
   cartel del comercio A editando la URL a mano (`/comercio/programas/<id-del-otro-comercio>/cartel`
   debe dar 404, no el editor del otro comercio).
8. Capturar una screenshot de la vista previa de al menos 2 plantillas para dejar registro visual.

- [ ] **Step 6: Actualizar la documentación de estado del proyecto**

Si existe `docs/superpowers/ESTADO-Y-PLAN-2026-07-28.md` (o el archivo de estado vigente más
reciente), agregar una línea marcando esta feature como entregada, con la fecha real de esta sesión.

- [ ] **Step 7: Commit final (si el Step 5 requirió ajustes de layout)**

```bash
git add lib/comercio/cartel/plantillas.ts docs/superpowers/ESTADO-Y-PLAN-2026-07-28.md
git commit -m "Cartel: ajustes de layout tras verificacion visual + estado del proyecto

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

Si el Step 5 no requirió ningún cambio de código, este commit no aplica — el plan queda completo con
el commit de la Tarea 14.

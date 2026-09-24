# Reportes con filtros, tabla de clientes y Excel — plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usá superpowers:subagent-driven-development para implementar
> este plan tarea por tarea (implementador + revisión de spec-compliance + revisión de calidad, por
> tarea). Los pasos usan casillas (`- [ ]`) para el seguimiento.
>
> **Sin bloques de código completos, a propósito** (convención de los planes de este repo desde
> `2026-09-21-pasarela-wompi.md`): la spec tiene las reglas, las columnas y los textos exactos, y un
> bloque de código del plan que no se mantiene byte-idéntico al archivo publicado es peor que no tenerlo
> (CLAUDE.md). **Los archivos publicados son la única fuente de verdad.**

**Objetivo:** que Reportes se pueda filtrar por período, comercio, sucursal y cajero en TODOS sus
bloques; que la lista de clientes con actividad se pueda ordenar y paginar; y que Reportes y la lista de
clientes se bajen como `.xlsx`.

**Arquitectura:** cuatro funciones SQL nuevas (0040) que reciben el alcance como `uuid[]` y agregan
desde UN CTE `actividad` (ledger + canjes, ya filtrados). Encima, wrappers en `lib/reportes/` que
devuelven `null` ante un error; funciones puras para filtros, presets, URLs, unidades y paginación; la
página de Reportes reescrita sobre eso; y dos rutas de descarga con `write-excel-file`.

**Tecnología:** Next.js 16.2.10, Supabase (Postgres + PostgREST), Vitest 4, `write-excel-file` (nueva)
y `read-excel-file` (nueva, solo devDependency). **Migración 0040** (la aplica Daniel a mano).

**Spec:** `docs/superpowers/specs/2026-09-23-reportes-filtros-y-excel-design.md`. Leela entera antes de
tocar nada; este plan no repite sus reglas, las ordena en tareas.

**Rama:** `claude/cobranza-y-rework-admin`. Se publica con `git push origin HEAD:master` en la Tarea 8,
DESPUÉS de que Daniel aplique la 0040.

---

## Antes de empezar (todas las tareas)

**Dónde se trabaja:** `C:\Users\Daniel\Desktop\Proyectos\Loyalty Cards\.claude\worktrees\focused-aryabhata-28e859`.
Cada subagente verifica con `git -C "<esa ruta>" branch --show-current` ANTES de tocar nada; si imprime
`claude/cobranza-y-rework-admin`, prosigue (los subagentes arrancan en un worktree de infraestructura
ajeno: `cd` con la ruta absoluta en cada Bash, rutas absolutas en Read/Write/Edit).

**Pruebas:** `npx vitest run <archivo>` desde esa ruta (tiene `.env.local`; nunca leerlo ni imprimirlo).
Las pruebas de RPC corren contra el Supabase REAL, en serie (`vitest.config.ts`), y limpian lo que
siembran (`test/fixtures/entornoComercio.ts`). **Mutation-testing obligatorio** (CLAUDE.md): romper la
línea protegida, confirmar que la prueba falla por la razón correcta (mensaje exacto), restaurar;
documentar en el encabezado de la prueba solo las mutaciones corridas, con lo que se VIO caer.

**Sin dev server en subagentes.** La verificación en el navegador la hace el controlador.

**Commits:** `git -c user.name="Daniel" -c user.email="268727888+dann1103-eng@users.noreply.github.com" commit -F <archivo>`
(mensaje en un archivo del scratchpad), en español, trailer `Co-Authored-By:` al final. `git add` SOLO
de los archivos tocados. `npx tsc --noEmit` y `npx eslint <archivos tocados>` limpios antes de cada
commit.

**Estilo:** comentarios e identificadores en español, con el POR QUÉ y el caso real. El panel del dueño
vosea.

**Migraciones (CLAUDE.md):** el asistente NO corre DDL. Se escribe el `.sql`, el controlador lo pega en
el chat, Daniel lo corre en Studio y avisa, y se verifica con un script de solo lectura. **Ninguna tarea
que LEA las funciones nuevas se publica antes de eso**, y no se pushea con la suite en rojo.

---

## Tarea 1 — Migración 0040 (solo SQL, tipos y script de verificación)

**Spec:** §5 entero, "Definiciones", y "Orden de publicación".

**Archivos:**
- Crear: `supabase/migrations/0040_reportes_con_filtros.sql`
- Modificar: `lib/supabase/types.ts` (las cuatro funciones en `Functions`, a mano, como la 0033)
- Crear: `scripts/verificar-0040.ts` (solo lectura)

- [ ] **Paso 1:** leer `0033_operaciones_y_nombre_pase.sql` (el molde: comentarios de cabecera con el
  porqué, `begin`/`commit`, `revoke` + `grant` con firma explícita) y `0015` (índices, 101-104 sobre
  sobrecargas).
- [ ] **Paso 2:** escribir las cuatro funciones con la **forma común obligatoria** de la spec: CTE `lim`
  por comercio (bordes a `timestamptz` en su zona; nunca `::date` en el `WHERE`), CTE `actividad` con
  las tres clases y los cuatro filtros en las DOS ramas, agregados con `filter`, nombres unidos
  después, `coalesce` en las sumas. `reporte_resumen` con `grouping sets` y `es_total =
  grouping(...) = 3`. `reporte_por_dia` con `p_hasta` obligatorio y `p_agrupar`. `reporte_clientes` con
  el `case` de orden, desempates, `p_limite` acotado, el offset acotado en aritmética entera (fórmula de
  la spec) y `total`/`offset_efectivo`. `reporte_cajeros_alcance`. Los dos índices. **Nada existente se
  toca.**
- [ ] **Paso 3:** tipos en `types.ts` (args y filas; `p_sucursal_id`/`p_cajero_id` como
  `string | null`).
- [ ] **Paso 4:** `scripts/verificar-0040.ts`, modelado sobre `scripts/verificar-0039.ts` y
  `scripts/snapshot-reportes.ts`: existencia y firma de las cuatro; `anon` NO puede ejecutarlas (con la
  llave anon, como las verificaciones de ACL anteriores si las hay; si no hay patrón, un cliente con la
  llave pública); para cada comercio demo (`slug like '%-demo'`), "Desde siempre" sin filtros contra
  las viejas: visitas, acumulado y premios IGUALES y `clientes_nuevo >= clientes_viejo`. Imprime un
  resumen y sale con código ≠ 0 si algo no cierra.
- [ ] **Paso 5 — la SQL corre ANTES de llegar a Daniel.** Evaluar PGlite (`@electric-sql/pglite`,
  devDependency; ver Tarea 3, paso 3), con un límite de 30 minutos: si resuelve `at time zone` con
  `America/El_Salvador` y `America/Bogota`, crear `scripts/mutar-sql-0040.ts` con las tablas mínimas
  (columnas copiadas de las migraciones), cargar la 0040 y correr un caso por función (sintaxis, bordes
  del período, `grouping()`, offset acotado con total 0). Un error de SQL se arregla ACÁ, no en Studio.
  Si PGlite no sirve, anotarlo y seguir: la 0040 va a Daniel validada solo por lectura y revisión.
- [ ] **Paso 6:** `npx tsc --noEmit` (el script de verificación compila; todavía NO se corre contra
  Supabase: las funciones no existen).
- [ ] **Paso 7:** commit. **El controlador** pega el SQL en el chat para Daniel y espera su aviso;
  después corre `npx tsx --env-file=.env.local --conditions=react-server scripts/verificar-0040.ts` y
  anota el resultado acá.

## Tarea 2 — Funciones puras: filtros, presets, URLs, unidades y paginación

Independiente de la base: se puede hacer mientras Daniel aplica la 0040.

**Spec:** §1, §3 (orden, dirección inicial, `pagina=1`), "Unidad del acumulado", §4 (paginación y
fechas del Excel).

**Archivos (sugeridos; ajustá nombres si el repo tiene uno mejor):**
- Modificar: `lib/reportes/agregados.ts` (`resolverFiltrosReportes` extendida) y su prueba
- Modificar: `lib/reportes/rangoFechas.ts` (presets con aritmética de calendario) y su prueba
- Crear: `lib/reportes/urlReportes.ts` + prueba
- Crear: `lib/reportes/unidadAcumulado.ts` + prueba (unidad por tipo; centavos → dólares; sin
  contador → vacío; "visitas prepagadas"; si el alcance permite ordenar por acumulado)
- Crear: `lib/reportes/paginarTodo.ts` + prueba
- Crear: `lib/reportes/fechaExcel.ts` + prueba (componentes de reloj local con `Intl` →
  `Date.UTC`)

- [ ] **Paso 1 (rojo):** pruebas de la spec §7 "Puras": período y fechas (incluido `0001-01-01` y el piso
  `2000-01-01`), parámetros repetidos (arreglo), cajero ajeno, orden/dir/página inválidos, un solo
  comercio = elegido, `orden=acumulado` cae a `visitas` con unidades mezcladas o tipo sin contador;
  presets cerca de la medianoche local y en `Europe/Madrid` el día del cambio de hora; `urlReportes`
  (conserva, borra sucursal y cajero al cambiar de comercio, `pagina=1` al filtrar y al ordenar,
  dirección inicial); `paginarTodo` (total 0, = tamaño, = doble, con un falso que acota como la SQL);
  fechas del Excel desde un proceso en otra zona (`process.env.TZ` no sirve una vez cargado: probar con
  instantes elegidos y asertar `getUTCHours()`/`getUTCDate()`).
- [ ] **Paso 2:** implementar hasta verde. `resolverFiltrosReportes` recibe lo que necesita (lista de
  comercios con su unidad y zona, sucursales y usuarios del comercio resuelto) y devuelve TODO resuelto
  (fechas incluidas): la página y la ruta del Excel usan la MISMA.
- [ ] **Paso 3:** mutaciones (mínimo): el `=== 1` del comercio único; el borrado de sucursal/cajero en
  `urlReportes`; el corte de `paginarTodo` vuelto a "< tamaño"; restar 24 h en vez de calendario; el
  `/100` de centavos; el piso de fecha.
- [ ] **Paso 4:** commit.

## Tarea 3 — Wrappers de las RPC y pruebas contra la base (requiere la 0040 aplicada)

**Spec:** §5, §7 "RPC contra la base".

**Archivos:**
- Modificar: `lib/reportes/reportes.ts` (cuatro wrappers nuevos que devuelven `null` ante un error, como
  `reporteCajeros`; `reporteClientes` pagina con `p_offset`, NUNCA `.range()`; las otras con `.order`)
- Modificar: `test/fixtures/entornoComercio.ts` (helper para sembrar visitas, ajustes y canjes con
  `created_at`, sucursal y cajero elegidos; opción `clienteId` en `crearTarjeta`; comercio con zona
  elegida)
- Crear: `lib/reportes/reportesConFiltros.test.ts`

- [ ] **Paso 1 (rojo):** las pruebas de la spec §7, una por comportamiento. Sembrar con fechas ELEGIDAS
  (instantes calculados en la zona del comercio), nunca "ahora".
- [ ] **Paso 2:** wrappers hasta verde.
- [ ] **Paso 3 — mutaciones.** Las de los WRAPPERS se corren como siempre. Las de la SQL (cada filtro en
  la rama de CANJES por separado; `>=`/`>` y el `+1` del borde; el `filter` del bruto; `grouping()`
  contra "ids null"; el desempate; "un ajuste cuenta como visita") **no se pueden correr contra
  Supabase**: el asistente no corre DDL, y pedirle a Daniel una función mutada por cada una no es
  razonable. Camino propuesto, a evaluar primero en 30 minutos como máximo: **PGlite**
  (`@electric-sql/pglite`, Postgres en WASM, devDependency) con un script
  `scripts/mutar-sql-0040.ts` que crea las tablas mínimas (columnas copiadas de las migraciones), carga
  la 0040, siembra un caso por mutación, aplica la mutación con `create or replace` y verifica que el
  resultado cambie. Condición para usarlo: que PGlite resuelva `at time zone 'America/El_Salvador'` y
  `'America/Bogota'` (probarlo antes de escribir nada más). Si no sirve, **las mutaciones de SQL quedan
  declaradas como NO corridas** en el encabezado de la prueba, con una tabla "línea de SQL → prueba que
  la protege", y se avisa al controlador. Nunca se escribe "mutación verificada" de algo que no se corrió.
- [ ] **Paso 4:** commit.

## Tarea 4 — La pantalla de Reportes

**Spec:** §1 (interfaz), §2, §3, "Rótulo".

**Archivos:**
- Modificar: `app/comercio/(protegido)/reportes/page.tsx` (reescritura sobre las funciones de las Tareas 2
  y 3)
- Crear si ayuda: componentes en la misma carpeta (`FiltrosReportes.tsx`, `TablaClientes.tsx`,
  `PorDia.tsx`) — Server Components, sin JS.
- Crear: la consulta de usuarios del comercio para el filtro de cajero (activos e inactivos, cajeros y
  dueño) en `lib/comercio/cajeros.ts` o donde corresponda, con prueba contra la base.
- Modificar: `app/globals.css` (contenedor de la tabla con scroll horizontal y columna fija;
  `max-width` + puntos suspensivos en `.filtro-chip`).
- Modificar: `reportes/cajeros/page.tsx` y `panel/page.tsx` (solo el rótulo "Operaciones" → "Visitas").

- [ ] **Paso 1:** la página resuelve filtros con la función de la Tarea 2 (gate `verifyComercioOwner`
  fuera de try/catch), llama las RPC de la Tarea 3 en paralelo, y dibuja cabecera, por día, por
  sucursal (con estado vacío), tabla (orden con `aria-sort`, paginación, conteo "clientes" / "filas
  (cliente por comercio)") y el `<a download>` al Excel. Si una RPC devuelve `null`, un aviso de error
  en ese bloque (no ceros).
- [ ] **Paso 2:** CSS. Nada de colores nuevos: tokens existentes.
- [ ] **Paso 3:** `tsc`, `eslint`, las pruebas de `lib/reportes` y `lib/comercio`.
- [ ] **Paso 4:** commit. (La verificación visual la hace el controlador en la Tarea 7.)

## Tarea 5 — Excel de Reportes

**Spec:** §4 entero.

**Archivos:**
- `package.json`: `write-excel-file` (dependencies) y `read-excel-file` (devDependencies). Antes, `npm
  view` de las dos; después, `npm audit` (alto o crítico: frenar y avisar).
- Crear: `lib/reportes/excelReportes.ts` (arma las hojas a partir de filas ya leídas: puro, con
  prueba)
- Crear: `app/comercio/(protegido)/reportes/exportar/route.ts` + `route.test.ts`

- [ ] **Paso 1 (rojo):** prueba pura de las hojas (columnas, tipos, unidad, fechas, teléfono `@`,
  "Sin registrar", la nota de Clientes, el aviso de tope). Prueba de la ruta con el gate mockeado (DOS
  comercios en el mock), leyendo el `.xlsx` con `read-excel-file` y abriendo el zip con `fflate` para
  `$#,##0.00` y `state="frozen"`; una RPC que falla (mock del wrapper) → 500 texto plano.
- [ ] **Paso 2:** implementar. Import de `write-excel-file/node`, `.toBuffer()`. Molde de
  `cartel/descargar/route.ts` (runtime, dynamic, cabeceras, nombre saneado). Si el build de Turbopack
  protesta, `serverExternalPackages`.
- [ ] **Paso 3:** mutaciones: el `/100`; el `format` de fecha; el `'@'` del teléfono; el 500 (que no
  devuelva un Excel vacío).
- [ ] **Paso 4:** commit.

## Tarea 6 — Lista de clientes en `.xlsx` y los cuatro defectos del export

**Spec:** §6.

**Archivos:**
- Modificar: `lib/comercio/exportarClientes.ts` (+ prueba): tarjetas de a 1000 en orden
  `(created_at, id)`; visitas de `reporteClientes` paginado; error → falla; "Cliente desde" local;
  rótulo "Visitas (todas sus tarjetas)".
- Modificar: `app/comercio/(protegido)/clientes/exportar/route.ts` (`?formato=xlsx`) + prueba
- Modificar: `app/comercio/(protegido)/clientes/page.tsx` (el `<a download>` de Excel junto al CSV)

- [ ] **Paso 1 (rojo):** más de 1000 tarjetas no se puede sembrar razonablemente: probar la paginación
  con el helper de la Tarea 2 y un falso; contra la base, el orden estable y la fecha local (una tarjeta
  creada a las 23:30 locales del día X dice X). Error de visitas → la exportación falla.
- [ ] **Paso 2:** implementar. El CSV conserva su formato (salvo el rótulo nuevo y los arreglos).
- [ ] **Paso 3:** mutaciones: el corte de la paginación; ignorar el error; la fecha en UTC.
- [ ] **Paso 4:** commit.

## Tarea 7 — Verificación en el navegador (controlador)

- [ ] Dev server (`preview_start`). Sesión de dueño de un comercio DEMO (no piloto).
- [ ] A 375 px y en escritorio: cada preset; Personalizado (abre precargado); comercio / sucursal /
  cajero; tabla (ordenar cada columna, invertir, paginar, `pagina=999`); sin scroll horizontal de la
  página (`document.documentElement.scrollWidth <= innerWidth`); chips de email largo.
- [ ] Bajar el Excel de Reportes y el de clientes; abrirlos (hoja real, o leerlos con `read-excel-file`
  en un script del scratchpad) y mirar negrita, anchos y fechas.
- [ ] Anotar el resultado acá.

## Tarea 8 — Publicar

- [ ] La 0040 aplicada por Daniel y `verificar-0040` en verde (Tarea 1, paso 7).
- [ ] Suite completa verde, `tsc --noEmit`, `npm run lint`.
- [ ] `git push origin HEAD:master`; esperar el deploy (`gh api …/commits/<sha>/status`, memoria
  "Deploy de Vercel que no arranca"); en producción, Reportes de un demo carga y el Excel baja.
- [ ] Actualizar el ESTADO (sección nueva) y la memoria.

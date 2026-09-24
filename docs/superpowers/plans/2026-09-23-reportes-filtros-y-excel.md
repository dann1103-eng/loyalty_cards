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
devuelven `null` ante un error; funciones puras para parámetros, filtros, presets, URLs, unidades y
paginación; un cargador compartido por la página y la ruta del Excel; la página de Reportes reescrita; y
dos rutas de descarga con `write-excel-file`.

**Tecnología:** Next.js 16.2.10, Supabase (Postgres + PostgREST), Vitest 4, `write-excel-file` (nueva),
`read-excel-file` y `@electric-sql/pglite` (nuevas, solo devDependencies). **Migración 0040** (la aplica
Daniel a mano).

**Spec:** `docs/superpowers/specs/2026-09-23-reportes-filtros-y-excel-design.md`. Leela entera antes de
tocar nada; este plan no repite sus reglas, las ordena en tareas. Plan revisado una vez contra el repo
(1 bloqueante ya resuelto + 13 importantes, incorporados).

**Rama:** `claude/cobranza-y-rework-admin`. La entrega anterior (Wallet/logos) ya está en `master`
(`eb88176`, con su Tarea 8 cerrada): desde acá, `git log origin/master..HEAD` tiene que mostrar SOLO
commits de este plan. Se publica con `git push origin HEAD:master` en la Tarea 8, DESPUÉS de que Daniel
aplique la 0040.

---

## Antes de empezar (todas las tareas)

**Dónde se trabaja:** `C:\Users\Daniel\Desktop\Proyectos\Loyalty Cards\.claude\worktrees\focused-aryabhata-28e859`.
Cada subagente verifica con `git -C "<esa ruta>" branch --show-current` ANTES de tocar nada; si imprime
`claude/cobranza-y-rework-admin`, prosigue (los subagentes arrancan en un worktree de infraestructura
ajeno: `cd` con la ruta absoluta en cada Bash, rutas absolutas en Read/Write/Edit).

**Next 16 (AGENTS.md):** antes de escribir una Route Handler o leer `searchParams`, leer la guía en
`node_modules/next/dist/docs/` (Route Handlers, `searchParams` como Promise, `serverExternalPackages`).

**Pruebas:** `npx vitest run <archivo>` desde esa ruta (tiene `.env.local`; nunca leerlo ni imprimirlo).
Las pruebas de RPC corren contra el Supabase REAL, en serie (`vitest.config.ts`), y limpian lo que
siembran (`test/fixtures/entornoComercio.ts`). Las de la SQL en sí corren en PGlite (Tarea 1b).
**Mutation-testing obligatorio** (CLAUDE.md): romper la línea protegida, confirmar que la prueba falla
por la razón correcta (mensaje exacto), restaurar; documentar en el encabezado de la prueba solo las
mutaciones corridas, con lo que se VIO caer. Nunca "verificada" de algo que no se corrió.

**Fechas y zonas:** la PC de Daniel está en UTC−6, igual que `America/El_Salvador`; Vercel corre en UTC.
Toda prueba de fechas usa además `America/Bogota` (UTC−5) o `Europe/Madrid` (con horario de verano):
con El Salvador sola, un código que use el reloj del proceso pasa acá y falla en producción.

**Sin dev server en subagentes.** La verificación en el navegador la hace el controlador.

**Commits:** `git -c user.name="Daniel" -c user.email="268727888+dann1103-eng@users.noreply.github.com" commit -F <archivo>`
(mensaje en un archivo del scratchpad), en español, trailer `Co-Authored-By:` al final. `git add` SOLO
de los archivos tocados (y `package-lock.json` junto con `package.json`). `npx tsc --noEmit` y
`npx eslint <archivos tocados>` limpios antes de cada commit.

**Estilo:** comentarios e identificadores en español, con el POR QUÉ y el caso real. El panel del dueño
vosea.

**Migraciones (CLAUDE.md):** el asistente NO corre DDL. Se escribe el `.sql`, el controlador lo pega en
el chat, Daniel lo corre en Studio y avisa, y se verifica con un script de solo lectura. **Una vez
aplicada, la 0040 NO se edita nunca**: un arreglo (o un `verificar-0040` en rojo) va en una 0041
(`create or replace` si la firma y el retorno no cambian; `drop` + `create`, con `revoke`/`grant`, si
cambian). Es seguro porque nada publicado llama a esas funciones hasta la Tarea 8.

---

## Paso 0 — Confirmaciones de Daniel (compuerta) — HECHO

**2026-09-23:** Daniel confirmó las dos: "30 días + Desde siempre" y `write-excel-file`.

La spec ("Dos cambios respecto de lo aprobado") pide confirmar: (a) "Desde siempre" como preset más, con
30 días por defecto; (b) `write-excel-file` en lugar de `exceljs`. El controlador se lo pregunta a
Daniel. Hasta tener la respuesta se puede avanzar con las Tareas 1a, 1b, 3 y 4a (no dependen de ninguna
de las dos); la Tarea 2 depende de (a) y la 5 de (b). Si Daniel dice que no a alguna, se ajusta la spec
antes de esas tareas.

## Tarea 1a — Migración 0040: SQL y tipos

**Spec:** §5 entero, "Definiciones", "Orden de publicación".

**Archivos:**
- Crear: `supabase/migrations/0040_reportes_con_filtros.sql`
- Modificar: `lib/supabase/types.ts` (las cuatro funciones en `Functions`, a mano; agregar la 0040 en el
  encabezado del archivo si lleva la lista de migraciones)

- [ ] **Paso 1:** leer `0033_operaciones_y_nombre_pase.sql` (el molde: cabecera con el porqué,
  `begin`/`commit`, `revoke` + `grant` con firma explícita) y `0015` (índices; 101-104 sobre
  sobrecargas).
- [ ] **Paso 2:** escribir las cuatro funciones con la **forma común obligatoria** de la spec (CTE `lim`
  por comercio; CTE `actividad` con los cuatro filtros en las DOS ramas; agregados con `filter`; nombres
  unidos después; `coalesce`). **Los ajustes:** la clase `'ajuste'` entra SOLO en
  `reporte_cajeros_alcance`. En `reporte_resumen`, `reporte_por_dia` y `reporte_clientes` el CTE excluye
  los ajustes desde el `WHERE`: si no, un cliente con solo ajustes tendría fila, un ajuste movería
  `ultima_actividad`, una sucursal con solo ajustes aparecería en el resumen, y un ajuste viejo estiraría
  el tramo de "Por día". El resto como la spec: `grouping(...) = 3`, `p_hasta` obligatorio en por día,
  el `case` de orden con los desempates, `p_limite` acotado, el offset acotado en aritmética ENTERA,
  `total`/`offset_efectivo`. Los dos índices. **Nada existente se toca.** No usar funciones de Postgres
  16 o posterior sin confirmar antes la versión de Supabase (la da Studio; preguntarle al controlador).
- [ ] **Paso 3:** tipos en `types.ts`: args (`p_desde`, `p_hasta`, `p_sucursal_id`, `p_cajero_id` como
  `string | null`, patrón de `types.ts:1595-1596`) y filas (`comercio_id` y `sucursal_id` nulos en la
  fila total del resumen).
- [ ] **Paso 4:** `npx tsc --noEmit`. Commit. (Todavía NO se pega: falta la 1b.)

## Tarea 1b — La SQL corre y se muta en PGlite, antes de llegar a Daniel

**Por qué:** "un error de SQL se arregla acá, no en Studio". Y el protocolo de mutación del proyecto
(romper una línea, ver caer la prueba) necesita correr la SQL, cosa que contra Supabase no se puede.

**Archivos:**
- `package.json`: `@electric-sql/pglite` (devDependency). Antes, `npm view @electric-sql/pglite
  version`; después, `npm audit`.
- Crear: `lib/reportes/sql0040.pglite.test.ts` (vitest)

- [ ] **Paso 1 — factibilidad (tope: 30 minutos, se evalúa UNA vez, acá):** una sesión PGlite con
  `TimeZone` distinta de UTC resuelve `at time zone 'America/El_Salvador'` y `'America/Bogota'`, y carga
  `pgcrypto`. Si no, se anota y se salta a "Si PGlite no sirve".
- [ ] **Paso 2 — el esquema real, no una copia a mano:** la prueba carga `supabase/migrations/0001` a
  `0039` del disco, en orden, con un preámbulo: `create schema auth; create table auth.users(id uuid
  primary key);` y los roles `anon`, `authenticated`, `service_role` (sin ellos los `revoke`/`grant`
  fallan, y justo un `grant` con la firma mal escrita es lo que abortaría la transacción en Studio).
  Después carga la `0040` **byte-idéntica, leída del disco**. Si alguna migración vieja usa algo que
  PGlite no tiene, se reemplaza SOLO esa sentencia en el preámbulo o con un parche documentado en la
  prueba, nunca editando la migración.
- [ ] **Paso 3 — casos** (los de la spec §7 que dependen de la SQL): bordes (23:59 del día X cuenta en X;
  00:00 de X+1 no; 00:00 de X sí); dos zonas en el mismo alcance; los cuatro filtros en visitas Y en
  canjes; ajuste excluido en las tres funciones (un cliente con solo ajustes no tiene fila; un ajuste no
  mueve `ultima_actividad`; una sucursal con solo ajustes no aparece; un ajuste viejo no estira "Por
  día") e incluido como Correcciones en cajeros; bruto; `grouping()` contra "sin sucursal"; el total de
  clientes distinto de la suma; orden y desempates; `offset_efectivo` con `pagina` 999 y con total 0
  (`pagina=5` en un comercio sin actividad); `auto` en 62 y 63 días; `p_orden` fuera de la lista;
  `p_limite` fuera de [1, 1000].
- [ ] **Paso 4 — mutaciones, sobre el `.sql` del disco** (se rompe la línea, se corre, se ve caer, se
  restaura): cada filtro en la rama de CANJES por separado; `>=`/`>` y el `+1` del borde; `lim` con la
  zona de un solo comercio; el `filter` del bruto; `grouping()` contra "ids null"; "un ajuste cuenta
  como visita"; "Clientes cuenta ajustes"; el desempate; el offset con división NUMÉRICA (312 de a 50
  con la página 999 tiene que dar 300, no 311) y sin el `greatest` de afuera (total 0 con límite 1
  tiene que dar cero filas sin error) — `floor()` es EQUIVALENTE a la división entera, no se corre;
  el borde 62/63 de `auto`; el acotado de `p_limite`; el `case` de `p_orden`. Más la lista de "cosas a
  confirmar ejecutando" de la revisión de la 1a (anotada abajo, en "Resultado de la revisión de 1a").
- [ ] **Paso 5:** commit. **Recién ahora**, con las revisiones de 1a y 1b aprobadas, el controlador pega
  la 0040 en el chat para Daniel.
- **Si PGlite no sirve:** las mutaciones de SQL quedan declaradas como NO corridas, con una tabla "línea
  de SQL → prueba contra Supabase que la protege" en el encabezado de `reportesConFiltros.test.ts`, y el
  controlador se lo dice a Daniel al pegarle la migración.
- **Lo que PGlite NO ve** (queda para las pruebas contra Supabase, Tarea 3): nombres de argumentos en
  PostgREST, el tope de filas (`max-rows`), `.range()` por fuera del resultado, tipos del JSON,
  `PGRST203`. **Collation:** PGlite puede ordenar distinto que Supabase con acentos y mayúsculas; en
  PGlite no se asierta el orden por nombre con esos casos.

**Resultado de la revisión de 1a (`d674969`) — lo que la 1b tiene que EJECUTAR para confirmar:**
1. Resumen con entrada vacía: exactamente una fila, `es_total`, ids null, todo en 0.
2. Resumen con actividad "sin sucursal": la fila total y `(comercio, null)` se distinguen solo por
   `es_total`; mutarlo a "ids null" tiene que caer.
3. `limit (select …) offset (select …)` sobre el CTE compila y pagina.
4. Total 0 con `p_limite = 1` y `p_offset` 0 y 250: cero filas, sin error (mata quitar el `greatest` de
   afuera).
5. 312 de a 50 (o 7 de a 3) con la página 999: `offset_efectivo` = 300 (o 6) (mata la división numérica).
6. `total`/`offset_efectivo` iguales en todas las filas; `p_limite` 0 → 1, 5000 → 1000, null → 50;
   `p_desc` null usa la dirección inicial de cada columna.
7. Orden por nombre en las dos direcciones con apellido null al final; el mismo cliente en dos
   comercios con la métrica empatada desempata por `comercio_id`; páginas 1 y 2 sin repetidos.
8. Clientes distintos del total del resumen con el mismo cliente en dos comercios = 1.
9. `primera`: un ajuste viejo no estira la serie; activo antes del período pero no en él → N filas en
   cero; nunca activo → cero filas; primera actividad después de `p_hasta` → cero filas; `p_hasta` null →
   cero filas.
10. `auto` sobre el tramo recortado: `p_desde` hace 100 días y primera actividad hace 62 → por día; 63 →
    por mes; `p_agrupar` `'xyz'` o null → `auto`.
11. Por mes con dos zonas: 23:30 locales del último día del mes cuenta en ese mes para cada comercio.
12. Nombre y orden de las columnas de `reporte_cajeros_alcance` contra los tipos TS.
13. La transacción completa, con los roles del preámbulo, llega al `commit` con `check_function_bodies`
    activo.
Menores de esa revisión que quedan para después: `primera` lee toda la historia del alcance (versión
acotada con `exists`, cambiable en una 0041 sin tocar la firma); `canjes_tarjeta_idx` queda redundante
con el índice compuesto nuevo (retirarlo con las funciones viejas).

## Tarea 1c — `verificar-0040` y la aplicación

**Archivos:** Crear `scripts/verificar-0040.ts` (solo lectura). Un solo mecanismo de variables de entorno
(el `dotenv` del script o `--env-file`, no los dos).

- [ ] **Paso 1:** existencia y firma de las cuatro; `anon` NO puede ejecutarlas (patrón de
  `scripts/verificar-0035.ts:41-44`).
- [ ] **Paso 2:** para cada comercio demo (`slug like '%-demo'`), contra las funciones viejas, con
  `p_desde` y `p_hasta` null:
  - `reporte_resumen` por (comercio, sucursal), incluida la fila "sin sucursal", contra
    `reporte_sucursales`: visitas, acumulado y premios IGUALES; `clientes_nuevo >= clientes_viejo`
    (NUNCA el total nuevo contra la suma vieja: quien fue a dos sucursales da falsos rojos);
  - `reporte_cajeros_alcance` contra `reporte_cajeros` (fechas null): todo igual salvo Clientes;
  - `reporte_clientes` contra `reporte_top_clientes`: visitas y acumulado por cliente;
  - `reporte_por_dia('dia')` de los últimos 14 días contra `reporte_tendencia(14)`, DÍA POR DÍA,
    contando como 0 los días que falten (por el recorte de `primera`, un demo nuevo o sin actividad
    devuelve menos filas que la serie vieja, que siempre trae 14).
  Imprime un resumen y sale ≠ 0 si algo no cierra.
- [ ] **Paso 3:** `tsc`, commit. **Controlador:** pega la 0040 (Tarea 1b, paso 5), espera el aviso de
  Daniel, corre el script, anota el resultado acá. En rojo → 0041, no editar la 0040.

## Tarea 2 — Funciones puras: parámetros, filtros, presets, URLs, unidades, paginación y fechas

Independiente de la base (salvo lo que dice cada punto). Depende del Paso 0 (a).

**Spec:** §1, §3 (orden, dirección inicial, `pagina=1`), "Unidad del acumulado", §4 (paginación y
fechas del Excel).

**Archivos (sugeridos; ajustá nombres si el repo tiene uno mejor):**
- Crear: `lib/reportes/parametrosReportes.ts` + prueba: `leerParametrosReportes` acepta
  `URLSearchParams` (la ruta) O `Record<string, string | string[] | undefined>` (la página) y devuelve
  lo mismo: una clave repetida (`?comercio=a&comercio=b`) es INVÁLIDA en los dos casos (hoy la ruta
  tomaría el primer valor con `.get()` y la página caería al default: filtrarían distinto).
- Modificar: `lib/reportes/agregados.ts` (+ prueba):
  - `comercioAConsultar(comercios, params)`: el comercio resuelto ANTES de cargar sus sucursales y
    usuarios, con la regla "un solo comercio = elegido". Hoy la página lo prechequea mirando solo
    `params.comercio` (`page.tsx:77-80`): con esa regla, un dueño con un comercio no cargaría sucursales,
    y la mutación del `=== 1` sobre la función pura no lo vería. La página y la ruta usan ESTA función.
  - `resolverFiltrosReportes` extendida: devuelve TODO resuelto (fechas incluidas), usando lo que el
    cargador trajo (Tarea 3).
- Modificar: `lib/reportes/rangoFechas.ts` (+ prueba): presets con aritmética de CALENDARIO (sin restar
  24 h) y el piso `2000-01-01`. `rangoUltimosDias`/`resolverRangoFechas` también los usa
  `reportes/cajeros/page.tsx:48-49`: el arreglo de calendario vale también ahí (es un bug), el piso de
  2000 también (una fecha absurda no sirve en ninguna pantalla); anotarlo en el commit.
- Crear: `lib/reportes/urlReportes.ts` + prueba (incluida la URL del Excel, SIN `orden`/`dir`/`pagina`).
- Crear: `lib/reportes/unidadAcumulado.ts` + prueba (unidad por tipo; centavos → dólares; sin contador →
  vacío; "visitas prepagadas"; si el alcance permite ordenar por acumulado).
- Crear: `lib/reportes/paginar.ts` + prueba: los DOS mecanismos de la spec como helpers, con el tope de
  50 000 adentro y el tamaño de página inyectable:
  - `paginarPorOffset(llamar, tamano)` para `reporte_clientes` (corta con `offset_efectivo !== p_offset`
    o `p_offset + filas >= total`);
  - `paginarPorRango(llamar, tamano)` para el resto (`.range()` + orden explícito; corta con "< tamaño").
- Crear: `lib/reportes/fechaExcel.ts` + prueba (componentes de reloj local con `Intl` → `Date.UTC`).

- [ ] **Paso 1 (rojo):** pruebas de la spec §7 "Puras", más: claves repetidas en las dos formas de
  entrada; `comercioAConsultar` con uno y con dos comercios; `paginarPorOffset` con total 0, = tamaño,
  = doble (con un falso que acota como la SQL); `paginarPorRango` con múltiplo exacto; el tope de
  50 000; fechas en `America/Bogota` y `Europe/Madrid` (asertar `getUTCHours()`/`getUTCDate()`).
- [ ] **Paso 2:** implementar hasta verde.
- [ ] **Paso 3:** mutaciones (mínimo): el `=== 1` de `comercioAConsultar`; la clave repetida tomada como
  primer valor; el borrado de sucursal/cajero en `urlReportes`; el corte de `paginarPorOffset` vuelto a
  "< tamaño"; restar 24 h en vez de calendario; el `/100` de centavos; el piso de fecha; "componentes del
  reloj del PROCESO" (`getHours()` en vez de `Intl`) en `fechaExcel`.
- [ ] **Paso 4:** commit.

## Tarea 3 — Wrappers, cargador compartido y pruebas contra Supabase (requiere la 0040 aplicada)

**Spec:** §5, §7 "RPC contra la base".

**Archivos:**
- Modificar: `lib/reportes/reportes.ts`: cuatro wrappers nuevos que devuelven `null` ante un error (como
  `reporteCajeros`); `reporteClientes` pagina con `p_offset` vía `paginarPorOffset`, NUNCA `.range()`;
  las otras con `paginarPorRango` y `.order`. El tamaño de página es inyectable (para probar con 2).
  Actualizar el encabezado "fail-soft" del archivo (ya no vale para todo).
- Crear: `lib/reportes/contextoReportes.ts`: `cargarContextoReportes` (la zona del comercio ACTIVO; la
  unidad y la zona de cada comercio del alcance; sucursales y usuarios del comercio resuelto por
  `comercioAConsultar`), usado por la página Y por la ruta del Excel.
- Modificar: `test/fixtures/entornoComercio.ts`: helper para sembrar visitas, ajustes y canjes con
  `created_at`, sucursal y cajero elegidos (el ajuste exige `motivo` por CHECK; el canje exige
  `recompensa_id`, `puntos_gastados` y `estado`); opción `clienteId` en `crearTarjeta`. (La zona del
  comercio ya se elige con `crearComercio({ zona_horaria })`.)
- Crear: `lib/reportes/reportesConFiltros.test.ts`

- [ ] **Paso 1 (rojo):** lo que PGlite no ve: los nombres de argumentos llegan por PostgREST; con
  tamaño de página 2, 5 clientes y 4 clientes (múltiplo exacto) salen completos por `reporteClientes`
  (atrapa un `.range()` encima y la página repetida); `reporteResumen` y `reportePorDia` con tamaño 2
  también; una prueba de humo por función con datos sembrados a fechas ELEGIDAS. El cargador contra la
  base: un comercio único queda resuelto y sus sucursales/usuarios cargados.
- [ ] **Paso 2:** hasta verde.
- [ ] **Paso 3:** mutaciones de los WRAPPERS y del cargador: `.range()` sobre `reporte_clientes`; tamaño
  fijo en vez de inyectado; `null` convertido en `[]`; el cargador con el prechequeo viejo (solo
  `params.comercio`).
- [ ] **Paso 4:** commit.

## Tarea 4a — Datos y reglas de la pantalla (sin JSX nuevo todavía)

**Archivos:**
- La consulta de usuarios del comercio para el filtro de cajero (activos e inactivos, cajeros y dueño),
  en `lib/comercio/cajeros.ts` o al lado, con prueba contra la base. Para mostrar "Vos" hace falta el
  `authUserId` del gate.
- Helpers puros con prueba y mutación (en `lib/reportes/pantallaReportes.ts` o similar): página efectiva a
  partir de `offset_efectivo`; "Página X de Y"; "clientes" / "filas (cliente por comercio)"; `aria-sort`;
  qué encabezados enlazan (Acumulado no con unidades mezcladas o sin contador); qué filas de chips se
  dibujan; "Por día" / "Por mes".
- Rótulo "Operaciones" → "Visitas" en `panel/page.tsx` (~199) y `reportes/cajeros/page.tsx` (~123, ahí en
  minúscula: "operaciones").

- [ ] **Paso 1 (rojo)** → **Paso 2** → **Paso 3 mutaciones:** filtrar `activo=true` o excluir al dueño en
  la consulta de usuarios; olvidar `comercio_id`; la página efectiva ignorando `offset_efectivo`;
  "clientes" con varios comercios. → **Paso 4:** commit.

## Tarea 4b — Filtros y bloques

**Archivos:** `app/comercio/(protegido)/reportes/page.tsx` (+ componentes Server en la misma carpeta si
ayuda: `FiltrosReportes.tsx`, `PorDia.tsx`); `app/globals.css`.

- [ ] Las filas de chips con `urlReportes`, y el formulario de "Personalizado" PRECARGADO con el período
  visto y los demás filtros en `<input type="hidden">`. Gate `verifyComercioOwner` fuera de try/catch;
  `leerParametrosReportes` + `cargarContextoReportes` + `resolverFiltrosReportes`.
- [ ] Cabecera con TRES cartas (`.metric-pila` hoy es de 2 columnas, `globals.css` ~1264: ajustarla sin
  romper las otras pantallas que la usan); por día; por sucursal con sus estados vacíos; aviso de error
  en el bloque cuya RPC devolvió `null` (nunca ceros); el `<a download>` al Excel (URL de `urlReportes`).
- [ ] `max-width` + puntos suspensivos en `.filtro-chip`. Nada de colores nuevos: tokens existentes.
- [ ] `tsc`, `eslint`, pruebas de `lib/reportes`. Commit. (La tabla, en 4c; hasta entonces la página
  puede dejar el bloque de clientes vacío con un TODO que 4c borra — la rama no se publica a medias.)

## Tarea 4c — La tabla de clientes

**Archivos:** `TablaClientes.tsx` (Server Component) + `app/globals.css` (contenedor con scroll
horizontal y columna Cliente fija).

- [ ] Encabezados-enlace con `aria-sort` (helpers de 4a), paginación, conteo, "Última actividad" con la
  hora local, Comercio con 2 o más.
- [ ] Borrar el código muerto: `sumarTendencias`, `fusionarTopClientes`, `reporteTendencia`,
  `reporteTopClientes` y sus pruebas, SI ya nada los usa (buscarlo: `exportarClientes` deja de usar
  `reporte_top_clientes` recién en la Tarea 6 — si todavía lo usa, esperar a la 6).
- [ ] `tsc`, `eslint`. Commit.

## Tarea 5 — Excel de Reportes

Depende del Paso 0 (b).

**Spec:** §4 entero.

**Archivos:**
- `package.json` + `package-lock.json`: `write-excel-file` (dependencies) y `read-excel-file`
  (devDependencies). Antes, `npm view` de las dos; después, `npm audit` (alto o crítico: frenar y avisar).
- Crear: `lib/reportes/excelReportes.ts` (arma las hojas a partir de filas ya leídas: puro, con prueba)
- Crear: `app/comercio/(protegido)/reportes/exportar/route.ts` + `route.test.ts`

- [ ] **Paso 1 (rojo):** prueba pura de las hojas (columnas, tipos, unidad, fechas, teléfono `@`, "Sin
  registrar", la nota de Clientes, el aviso de tope). Prueba de la ruta con el gate mockeado (DOS
  comercios en el mock; también `nombre` y el `authUserId` si el cargador lo usa), leyendo el `.xlsx` con
  `read-excel-file` (`readSheet(buf, 'Clientes')`; `trim: false` donde se compare texto exacto) y
  abriendo el zip con **`jszip`** (ya es devDependency; no importar `fflate`, que es transitiva) para
  `$#,##0.00` en `xl/styles.xml` y `state="frozen"` en la hoja; el `Content-Type` del xlsx y el nombre;
  una RPC que falla (mock del wrapper) → 500 texto plano.
- [ ] **Paso 2:** implementar. Import de `write-excel-file/node`, `.toBuffer()`. Molde de
  `cartel/descargar/route.ts`. "Por día" del Excel pide `p_agrupar='dia'`, nunca `'auto'`.
- [ ] **Paso 3:** mutaciones: el `/100`; el `format` de fecha; el `'@'` del teléfono; el 500 (que no
  devuelva un Excel vacío); "Por día" con `'auto'`; un `comercio` ajeno pasado sin resolver.
- [ ] **Paso 4:** `NODE_OPTIONS=--max-old-space-size=6144 npm run build` (la memoria "Worktree sin
  .env.local" documenta el error de memoria sin esa variable). Si Turbopack protesta por la librería,
  `serverExternalPackages` en `next.config.ts`. Commit.

## Tarea 6 — Lista de clientes en `.xlsx` y los cuatro defectos del export

**Spec:** §6.

**Archivos:**
- Modificar: `lib/comercio/exportarClientes.ts` (+ su prueba, que va contra la base): tarjetas con
  `paginarPorRango` en orden `(created_at, id)`, tamaño inyectable; visitas de `reporteClientes`
  paginado; error → falla; "Cliente desde" local; rótulo "Visitas (todas sus tarjetas)".
- Modificar: `app/comercio/(protegido)/clientes/exportar/route.ts`: hoy es `GET()` sin request; pasa a
  recibirla para leer `?formato=xlsx`.
- Crear: `app/comercio/(protegido)/clientes/exportar/route.test.ts` (no existe)
- Modificar: `app/comercio/(protegido)/clientes/page.tsx` (el `<a download>` de Excel junto al CSV)

- [ ] **Paso 1 (rojo):** con tamaño de página 2, 5 tarjetas salen todas y en orden; una tarjeta creada a
  las 23:30 locales del día X dice X (en un comercio de `America/Bogota`); un error de visitas hace fallar
  la exportación; la hoja "Clientes" del `.xlsx`, el encabezado "Visitas (todas sus tarjetas)", Visitas
  como número, "Cliente desde" como `Date`, teléfono con `'@'`; `?formato=xlsx` contra el CSV por
  defecto (Content-Type y nombre).
- [ ] **Paso 2:** implementar. El CSV conserva su formato (salvo el rótulo nuevo y los arreglos).
- [ ] **Paso 3:** mutaciones: el corte de la paginación; ignorar el error; la fecha en UTC; ignorar
  `formato`; el teléfono sin `'@'`.
- [ ] **Paso 4:** si la Tarea 4c dejó pendiente el borrado de `reporteTopClientes`, hacerlo acá. Commit.

## Tarea 7 — Verificación en el navegador (controlador + Daniel)

- [ ] **El controlador no puede iniciar sesión** (escribir una contraseña está prohibido): Daniel entra
  con un dueño DEMO en el panel del navegador y avisa.
- [ ] **"Todo" con 2 o más comercios:** los dueños demo tienen un comercio cada uno
  (`scripts/seed-demo-owners.ts`). Para verlo: una membresía de dueño TEMPORAL sobre un segundo demo, con
  un script que la crea y otro que la borra (y verificación de que quedó como estaba); o, si Daniel
  prefiere no tocar membresías, la página estática en `public/` del worktree que describe CLAUDE.md
  (mismo markup y CSS, medido con `getBoundingClientRect`), borrada al terminar.
- [ ] Contar antes cuántos clientes con actividad tiene el demo: para probar la paginación hacen falta
  más de 50 (si no hay, la paginación queda cubierta por las pruebas y se anota).
- [ ] A 375 px y en escritorio: cada preset; Personalizado (abre precargado); comercio / sucursal /
  cajero; tabla (ordenar cada columna, invertir, paginar, `pagina=999`); sin scroll horizontal de la
  página (`document.documentElement.scrollWidth <= innerWidth`); chips de email largo.
- [ ] Bajar el Excel de Reportes y el de clientes; leerlos con `read-excel-file` en un script del
  scratchpad y, si Daniel puede, abrirlos en Excel (negrita, anchos, fechas).
- [ ] Anotar el resultado acá.

## Tarea 8 — Publicar

- [ ] La 0040 aplicada por Daniel y `verificar-0040` en verde (Tarea 1c).
- [ ] Suite completa verde (con la 0040 aplicada incluye las pruebas contra Supabase), `tsc --noEmit`,
  `npm run lint`, y `NODE_OPTIONS=--max-old-space-size=6144 npm run build`.
- [ ] `git log origin/master..HEAD`: SOLO commits de este plan.
- [ ] `git push origin HEAD:master`; esperar el deploy (`gh api …/commits/<sha>/status`, memoria "Deploy
  de Vercel que no arranca"); en producción, con Daniel: Reportes de un demo carga, el Excel de Reportes,
  el CSV y el `.xlsx` de clientes bajan.
- [ ] Vuelta atrás si algo sale mal: `git revert` de los commits de este plan y push; la 0040 se queda
  (es aditiva y nada viejo la necesita).
- [ ] Actualizar el ESTADO (sección nueva) y la memoria.

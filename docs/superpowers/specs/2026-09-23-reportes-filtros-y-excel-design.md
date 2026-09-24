# Reportes con filtros, tabla de clientes y Excel

**Fecha:** 2026-09-23 · **Estado:** diseño aprobado por Daniel en líneas generales (2026-09-23, "Aprobado,
en ese orden"); esta spec lo baja a detalle y pasó dos revisiones contra el código (23 + 8
hallazgos, incorporados). Segunda de dos entregas pedidas tras los onboardings del 2026-09-22/23 (la primera:
`2026-09-23-wallet-dispositivo-y-logos-design.md`). **Lleva migración 0040** (funciones de reporte
nuevas + dos índices), que Daniel aplica a mano ANTES del deploy.

## Lo que pidió Daniel

Tras los onboardings, un comercio preguntó si puede "ordenar por toques de consumo de mayor a menor o
solo ver los de X día", y exportar a Excel y no solo a CSV. Decisiones (2026-09-23, preguntas con
opciones):

1. **Reportes, las cuatro:** rango de fechas en todo; tabla de clientes ordenable; filtro por sucursal
   en todo; filtro por cajero.
2. **Excel:** "Clientes y reportes": un botón en Reportes que baja un `.xlsx` con varias hojas
   respetando los filtros, y la lista de clientes también en `.xlsx` además del CSV.
3. Del resumen de diseño aprobado: presets Hoy / Ayer / 7 días / 30 días / Este mes / Personalizado;
   tabla con nombre, teléfono, visitas, acumulado, premios y última visita, ordenable tocando la
   columna, 50 por página, que reemplaza el top 5; hojas Resumen / Clientes / Por día / Por sucursal /
   Cajeros; números como números; **en pantalla "Visitas"**, en el código "operaciones".

**Dos cambios respecto de lo aprobado — CONFIRMADOS por Daniel el 2026-09-23:**
- **"Desde siempre" como preset más, y 30 días por defecto.** Hoy la cabecera y las cartas muestran el
  histórico; sin este preset esa vista desaparecería.
- **Librería `write-excel-file` en lugar de `exceljs`.** El resumen aprobado decía "exceljs, que está
  mantenida", y no es exacto: su última versión (4.4.0) es de 2023 y arrastra nueve dependencias viejas
  (`archiver@5`, `unzipper@0.10`, `tmp`, …). `write-excel-file` 4.1.1 es de 2026-06, solo escribe
  (es lo único que hace falta) y depende de un solo paquete (`fflate`). Las pruebas leen el archivo
  con `read-excel-file` (mismo autor, 2026-08), solo como devDependency.

## Cómo está hoy (relevado el 2026-09-23)

- `app/comercio/(protegido)/reportes/page.tsx`: vista del CONGLOMERADO de comercios del dueño (ignora
  el switcher del header, spec 2026-07-25 §4.7), con chips GET de comercio (se muestran siempre) y de
  sucursal. Sin período: cabecera y cartas por sucursal son **todo el histórico**; la tendencia son 14
  días fijos; el top son 5 clientes históricos. Al elegir una sucursal se ESCONDEN tendencia y top
  ("esos reportes solo existen por comercio").
- Las RPC de la 0033 (`reporte_sucursales`, `reporte_tendencia`, `reporte_top_clientes`,
  `reporte_cajeros`) son por UN comercio, SECURITY INVOKER, solo `service_role`; el acceso lo controla
  la app (`verifyComercioOwner` + ids de la sesión). Solo `reporte_cajeros` acepta fechas (y es la única
  que filtra canjes por fecha); ninguna filtra por sucursal y cajero a la vez.
- `reportes/cajeros/page.tsx`: comercio ACTIVO, `desde`/`hasta` por GET, 30 días por defecto.
- El panel (`panel/page.tsx`) también usa `reporte_sucursales` y dice "Operaciones".
- CSV de clientes (`clientes/exportar/route.ts` + `lib/comercio/exportarClientes.ts`), cuatro defectos
  que el `.xlsx` heredaría:
  - la consulta de tarjetas no pagina (PostgREST corta en 1000 sin avisar);
  - las visitas salen de `reporte_top_clientes` con `p_limite: 100_000`, que TAMBIÉN se corta en 1000:
    del cliente 1001 en adelante, 0 visitas;
  - el error de esa RPC se ignora (visitas en 0 en silencio);
  - "Cliente desde" es la fecha UTC y no la del comercio.
- Índices: ninguno empieza por `tarjetas.comercio_id` (el de 0001 empezaba por `cliente_id`, y la 0024
  lo reemplazó por `(cliente_id, programa_id)`); `canjes` no tiene índice por fecha.

## Definiciones

**No cambian (0033):**
- **Visita** (en código `operaciones`): fila de `transacciones_puntos` con `tipo in ('acreditacion',
  'uso', 'renovacion')`. Los ajustes no son visitas; se cuentan aparte como "Correcciones".
- **Acumulado** (`puntos_otorgados`): `sum(puntos_delta) filter (where tipo = 'acreditacion')`, BRUTO,
  nunca neto (un 'uso' de gift card o prepago lleva delta negativo: neto, el fraude se borraría solo).
- **Premios**: filas de `canjes`.

**Cambia:**
- **Clientes** = clientes distintos con al menos una visita O un premio en el alcance. En la 0033,
  `reporte_sucursales` contaba solo a los de visitas (su CTE de canjes no cuenta clientes) y
  `reporte_cajeros` a cualquier fila del ledger, ajustes incluidos, sin canjes. En las funciones nuevas
  es una sola definición en todas las hojas. La pantalla de cajeros (que sigue con su RPC) conserva la
  suya; la hoja Resumen del Excel lo aclara en una línea.

**Unidad del acumulado** (la trampa de `exportarClientes.ts:25-31`): el contador es el universal de la
tarjeta, así que en cashback y gift card son CENTAVOS, y en cupón, membresía y descuento el delta es
siempre 0. Por eso:
- pantalla: `describirCosto(tipo del programa principal DE ESE comercio, valor)`, como hoy; vacío en los
  tipos sin contador;
- Excel: en centavos se escribe `valor / 100` con formato `$#,##0.00`; en puntos, sellos y prepago el
  número entero; en los tipos sin contador la celda va vacía; y una columna **Unidad** ("puntos",
  "sellos", "visitas prepagadas", "$") al lado. En prepago dice "visitas prepagadas" y no "visitas":
  al lado de la columna Visitas, que es otra cosa, confundiría.
- Un comercio con programas de tipos distintos suma unidades mezcladas en su acumulado: se escribe con
  el tipo del principal, como hoy (fuera de alcance).
- **Acumulado no se puede ordenar** (su encabezado no es un enlace) cuando el alcance mezcla UNIDADES
  (ordenar centavos contra sellos no significa nada) o cuando su único tipo no tiene contador (la
  columna va vacía). Un `orden=acumulado` guardado en una URL cae a `visitas` DENTRO de
  `resolverFiltrosReportes`, que para eso recibe la unidad de cada comercio del alcance.

**Rótulo:** "Operaciones" pasa a decir **"Visitas"** donde lo lee el dueño: Reportes, la pantalla de
cajeros, el panel y el Excel (decisión de Daniel). La cuenta es la misma de la 0033; el subtítulo que
la explica se conserva ("veces que atendiste a un cliente"). Lo que en su momento confundía era
"Visitas *acreditadas*".

## 1. Filtros

Todos por **GET, sin JavaScript** (como hoy): la URL es el reporte, se comparte y se guarda. Un
parámetro inválido, o repetido (llega como arreglo), cae a su valor por defecto; nunca da error.

| Parámetro | Valores | Por defecto |
|---|---|---|
| `periodo` | `hoy`, `ayer`, `7d`, `30d`, `mes`, `todo`, `rango` | `30d` |
| `desde`, `hasta` | `YYYY-MM-DD`, solo con `periodo=rango`, de `2000-01-01` a HOY (un `hasta` futuro se lee como hoy: `reporte_por_dia` genera la serie día por día); invertidos se dan vuelta | ver abajo |
| `comercio` | id de un comercio SUYO | todos ("Todo") |
| `sucursal` | id de una sucursal de ese comercio (activa o no) | todas |
| `cajero` | id de un `usuarios_comercio` de ese comercio (cajero o dueño, activo o no) | todos |
| `orden`, `dir`, `pagina` | ver §3; `pagina` entero de 1 a 10 000 | `visitas`, según columna, `1` |

- **Un solo comercio = ese comercio elegido.** Si el dueño tiene uno, `resolverFiltrosReportes` lo
  devuelve como filtrado aunque la URL no traiga `comercio`: los filtros de sucursal y cajero están
  disponibles, el Excel se nombra con el comercio y no hay columna "Comercio". La fila de chips de
  comercio solo se dibuja con 2 o más.
- **Los días son LOCALES de cada comercio** (su `zona_horaria`), bordes inclusivos: `desde` = 00:00
  local, `hasta` = 00:00 local del día siguiente (exclusivo), como `reporte_cajeros`.
- **Presets:** los resuelve la app con **aritmética de calendario** (no restando 24 h, que es lo que
  hace hoy `rangoUltimosDias` y se corre un día en zonas con horario de verano), en la zona del
  comercio filtrado o, con "Todo", del comercio ACTIVO del dueño (el del switcher; `verifyComercioOwner`
  no trae la zona: una consulta). Con varias zonas en "Todo", "Hoy" puede quedar corrido un día en
  algún comercio cerca de la medianoche: limitación documentada (hoy todos los pilotos están en
  `America/El_Salvador`).
  - `hoy`, `ayer`: ese día. `7d`, `30d`: los últimos 7 o 30 días incluido hoy. `mes`: del 1 del mes a
    hoy. `todo`: sin `desde`, `hasta` = hoy.
- **`rango`:** el chip "Personalizado" enlaza con `desde`/`hasta` PRECARGADOS con el período que se está
  viendo, así nunca abre vacío, y muestra un `<form method="GET">` con dos `<input type="date">` y un
  botón "Ver" que conserva los otros filtros en `<input type="hidden">`. A mano: sin `hasta` = hoy; sin
  `desde` = sin borde inferior.
- `sucursal` y `cajero` exigen un comercio resuelto y se combinan. Un cajero que no operó en esa
  sucursal da resultados vacíos, no un error.
- La validación es PURA y con prueba: `resolverFiltrosReportes` se extiende. Un id ajeno se descarta
  ANTES de correr cualquier RPC, como hoy.

**Interfaz:** filas de chips (`.filtro-chip`, `Link`) en este orden: período; comercio (2 o más);
sucursal (comercio resuelto con 2 o más sucursales); cajero (comercio resuelto con al menos un
`usuarios_comercio` de rol `cajero`, activo o no). La lista de cajeros sale de una consulta NUEVA
(`listarCajeros` filtra `activo=true` y excluye al dueño): cajeros activos e inactivos más el dueño
("Vos"), por email; el chip tiene ancho máximo y corta con puntos suspensivos (`.filtro-chip` no tiene
`max-width` y un email largo desborda a 375 px). Las URLs las arma una función pura
`urlReportes(filtros, cambios)`, con prueba: conserva lo que no cambia; cambiar de comercio o volver
a "Todo" BORRA sucursal y cajero; cualquier cambio de filtro vuelve a `pagina=1`.

## 2. Qué muestra Reportes

Todo respeta TODOS los filtros; ya no se esconden bloques al elegir sucursal.

1. **Cabecera:** Visitas, Premios y Clientes del alcance y el período. Clientes es la cuenta DISTINTA
   del alcance (no la suma de las sucursales, que duplicaría a quien fue a dos).
2. **Por día:** las barras de hoy (`.pista`). La SQL recorta la serie a
   `[max(desde, primera actividad del alcance), hasta]` (la app siempre manda `hasta`; sin actividad,
   vacía) y, en
   modo `auto`, agrupa **por mes** si ese tramo pasa de 62 días; el título dice "Por día" o "Por mes".
3. **Por sucursal:** las cartas de hoy (Clientes, Visitas, Premios), bajo el nombre del comercio si hay
   2 o más, con período y cajero aplicados. Con una sucursal elegida, solo esa; si no tuvo actividad
   con esos filtros, un estado vacío ("Sin actividad en <sucursal> en este período"), no un hueco.
4. **Clientes** (§3), en lugar del top 5.
5. **"Descargar Excel"** (§4) como `<a download>` (como el del CSV, nunca `<Link>`: el prefetch correría
   la ruta en cada vista). "Ver actividad por cajero" queda como hoy (comercio activo, su propio
   rango): el detalle por cajero con todos los filtros está en la hoja Cajeros del Excel y en el filtro
   de cajero de esta pantalla.

## 3. Tabla de clientes

- **Una fila por (comercio, cliente)** con al menos una visita o un premio en el alcance y el período.
  Columnas: Cliente (nombre y apellido; debajo, el teléfono formateado), **Visitas**, **Acumulado**,
  **Premios**, **Última actividad** (fecha y hora locales). Con 2 o más comercios, también **Comercio**.
  - "Última actividad" y no "última visita": es la más reciente entre sus visitas y sus premios, y
    respeta los filtros (con un cajero elegido, la última vez que ESE cajero lo atendió).
  - El conteo dice "312 clientes" con un comercio y "312 filas (cliente por comercio)" con varios: una
    persona con tarjeta en dos comercios es 1 en la cabecera y 2 filas acá.
- **Orden:** tocar un encabezado ordena por esa columna (`orden` = `visitas` | `acumulado` | `premios` |
  `ultima` | `nombre`); tocar la activa invierte (`dir` = `desc` | `asc`); ordenar vuelve a
  `pagina=1`. Dirección inicial por columna: `nombre` ascendente, el resto descendente. Desempate: `nombre` → `apellido` (nulls al final)
  → `cliente_id` → `comercio_id`; en las demás columnas, directo `cliente_id` → `comercio_id`. Estable
  entre páginas: ni repite ni saltea. El orden por nombre usa la collation de la base (`nombre`
  mayúsculas y acentos como vengan); la prueba fija el caso. El encabezado activo lleva `aria-sort`.
- **Paginación de 50** en SQL, con el total. Una página más allá del final se lee como la ÚLTIMA: la
  SQL acota el `offset` con el total (un CTE que cuenta antes de paginar) y devuelve la página efectiva,
  así la app no pierde el total con cero filas. "Página 2 de 7 · 312 clientes", Anterior/Siguiente.
- A 375 px la tabla va en un contenedor con scroll horizontal y la columna Cliente fija; la página no
  scrollea de costado.

## 4. Excel de Reportes

`GET /comercio/reportes/exportar` con los parámetros de filtro (sin `orden`/`dir`/`pagina`: trae TODOS
los clientes por visitas desc). Molde de `programas/[id]/cartel/descargar/route.ts`: `runtime =
'nodejs'`, `force-dynamic`, `verifyComercioOwner` FUERA de cualquier try/catch (el gate lanza
`NEXT_REDIRECT`), la misma función pura de filtros, `Content-Disposition: attachment`, `Cache-Control:
no-store`. Nombre: `reportes-<comercio o "todos">-<desde o "desde-siempre">_<hasta>.xlsx`, saneado como el
del CSV.

| Hoja | Columnas |
|---|---|
| **Resumen** | Filtros aplicados en texto (comercio, sucursal, cajero, período con sus fechas), Visitas, Premios, Clientes, "Generado" (fecha y hora locales) y una nota: "Clientes = quien tuvo al menos una visita o un premio" (difiere de la pantalla de cajeros). |
| **Clientes** | (Comercio,) Nombre, Apellido, Teléfono, Visitas, Acumulado, Unidad, Premios, Última actividad. |
| **Por día** | Día, Visitas, Premios. SIEMPRE por día, del tramo recortado (§2), días sin actividad incluidos. |
| **Por sucursal** | Comercio, Sucursal, Visitas, Acumulado, Unidad, Premios, Clientes. |
| **Cajeros** | Comercio, Cajero (email; "Sin registrar" para el grupo sin cajero), Visitas, Acumulado, Unidad, Monto vendido, Forzadas, Correcciones, Premios, Clientes. Respeta TODOS los filtros, cajero incluido. |

- Encabezados en negrita, primera fila fija, anchos razonables.
- **Números como números.** Montos en dólares con formato `$#,##0.00`.
- **Fechas como fechas de Excel, sin depender de la zona del proceso** (Vercel corre en UTC; la PC de
  Daniel, en UTC−6): se toman los componentes de reloj LOCAL del comercio con
  `Intl.DateTimeFormat({ timeZone: zona })` y se arma `new Date(Date.UTC(año, mes, día, hora, min))`;
  la librería lo escribe como número de serie y Excel muestra esa hora. Formato `dd/mm/yyyy` (Día) o
  `dd/mm/yyyy hh:mm`. La prueba lee la celda y asierta `getUTCHours()`/`getUTCDate()`, y corre igual en
  cualquier zona.
- **El teléfono va como texto** (conserva el `+503`), con `format: '@'` para que Excel no lo
  reinterprete como número. En `.xlsx` un texto que empieza con `=` es un string, no una fórmula (en
  `write-excel-file` solo lo es un valor con `type: 'Formula'`); no hace falta el apóstrofo del CSV.
  Prueba que lo fije.
- **Sin el tope de 1000 filas**, con dos mecanismos que NO se mezclan:
  - `reporte_clientes` se pagina SOLO con su `p_offset` (de a 1000) y el bucle corta cuando
    `offset_efectivo !== p_offset` o `p_offset + filas >= total`. **Nunca `.range()` sobre esa
    función**: PostgREST aplicaría el limit/offset POR FUERA del resultado (que ya viene con 1000 o
    menos) y la segunda página saldría vacía; y cortar con "recibí menos de 1000" tampoco sirve, porque
    con un total múltiplo exacto de 1000 el offset acotado devuelve la última página otra vez y el bucle
    repetiría filas.
  - Las demás funciones (resumen, por día, cajeros) se paginan con `.range()` más un `.order(...)`
    explícito, hasta recibir menos de 1000.
  - El bucle es un helper PURO, `paginarTodo(llamar, tamano)`, probado con una función falsa que acota
    como la SQL: total 0, total igual al tamaño de página, total igual al doble. Mutación: volver a
    cortar con "< tamaño".
  - **Tope de seguridad: 50 000 filas por hoja**; si se alcanza, la hoja Resumen lo dice. (Con los
    pilotos, órdenes de magnitud por debajo.)
- **Nunca un archivo con ceros por un error.** Las funciones de `lib` nuevas devuelven `null` ante un
  error (como `reporteCajeros`), y la ruta responde 500 en texto plano ("No se pudo generar el Excel.
  Probá de nuevo."). Con `<a download>`, el navegador marca la descarga como fallida; no le muestra al
  dueño un JSON crudo.
- **Librería:** `write-excel-file` (ver "Dos cambios"); `read-excel-file` solo en las pruebas. Antes de
  instalar, `npm view` de las dos; después, `npm audit`: algo alto o crítico frena y se consulta. Si el
  build de Next (Turbopack) protesta, `serverExternalPackages` en `next.config.ts`. Datos verificados
  en su README (2026-09-23): se importa de `write-excel-file/node` (el paquete no tiene export raíz) y
  el archivo sale con `.toBuffer()`; varias hojas = arreglo de `{ data, sheet, columns,
  stickyRowsCount }`; negrita con `fontWeight: 'bold'` por celda; anchos con `columns[].width`; una
  celda `Date` EXIGE `format`; `null` = celda vacía; las fechas se convierten con base UTC (su propio
  ejemplo usa `Date.UTC`).

## 5. Base de datos: migración 0040

Funciones NUEVAS con el molde de la 0033: `language sql stable`, `set search_path = public`, SECURITY
INVOKER, `revoke execute … from public, anon, authenticated` + `grant execute … to service_role` con la
firma explícita (una función nueva nace con execute para PUBLIC), todo dentro de `begin`/`commit`. El
acceso lo sigue controlando la app. **Ninguna función existente se toca ni se borra**: el código
publicado sigue andando entre la migración y el deploy sin depender de ningún `default`.

Todas reciben `p_comercios uuid[]` ("Todo" se resuelve en SQL, en una llamada, y la tabla pagina sobre
el conglomerado), `p_desde date`, `p_hasta date` (null = sin ese borde), `p_sucursal_id uuid`,
`p_cajero_id uuid` (null = todos).

**Forma común (obligatoria, no "lo más legible"):**
- Un CTE `lim(comercio_id, ts_desde, ts_hasta)` con los bordes convertidos a `timestamptz` en la zona de
  CADA comercio, y la actividad filtrada por `created_at >= ts_desde and created_at < ts_hasta` contra
  ESE comercio. Nunca `(created_at at time zone z)::date` en el `WHERE` (no usa índice).
- Un CTE `actividad` = `union all` del ledger y de los canjes YA FILTRADOS (alcance, período, sucursal,
  cajero: los cuatro filtros escritos en las DOS ramas), con una columna `clase`:
  - `'visita'`: fila del ledger con `tipo in ('acreditacion','uso','renovacion')`;
  - `'ajuste'`: fila del ledger con `tipo = 'ajuste'`. Entra SOLO en `reporte_cajeros_alcance` (para
    Correcciones); en las otras tres funciones el CTE los excluye desde el `WHERE` — si no, un cliente
    con solo ajustes tendría fila, un ajuste movería `ultima_actividad`, una sucursal con solo ajustes
    aparecería en el resumen y un ajuste viejo estiraría el tramo de "Por día";
  - `'canje'`: fila de `canjes`;
  y las columnas `comercio_id`, `sucursal_id`, `cajero_usuario_id`, `cliente_id`, `puntos_delta`,
  `tipo`, `forzado` (false en los canjes), `monto_compra`, `created_at`. Todo se agrega desde ahí con
  `filter`:
  - Visitas = `count(*) filter (where clase = 'visita')`;
  - Acumulado = `sum(puntos_delta) filter (where clase = 'visita' and tipo = 'acreditacion')`;
  - Premios = `count(*) filter (where clase = 'canje')`;
  - Clientes = `count(distinct cliente_id) filter (where clase in ('visita','canje'))`: un ajuste NO
    hace cliente;
  - Correcciones = `count(*) filter (where clase = 'ajuste')`; Forzadas = `count(*) filter (where
    forzado)`.
  Es la única forma de contar bien "clientes con visita O canje". Mutación obligatoria: "un ajuste
  cuenta como visita" tiene que tirar una prueba.
- Las sumas llevan `coalesce(…, 0)`, y los nombres (sucursal, cliente, email) se unen DESPUÉS de
  agregar, en la consulta de afuera.

1. **`reporte_resumen(...)`** → `comercio_id, sucursal_id, sucursal_nombre, sucursal_activa,
   operaciones, puntos_otorgados, canjes, clientes_unicos, es_total boolean`, con
   `group by grouping sets ((comercio_id, sucursal_id), ())`. `es_total` =
   `grouping(comercio_id, sucursal_id) = 3` (es un entero, no un booleano), NUNCA "los ids son null": la
   fila de actividad "sin sucursal" también tiene `sucursal_id` null. El `clientes_unicos` de la fila
   total es la cuenta distinta del alcance entero (una persona con tarjeta en dos comercios cuenta 1).
   Con el alcance sin actividad, el conjunto `()` devuelve IGUAL una fila total, con ceros (por el
   `coalesce`): la pantalla decide "sin actividad" ignorando la fila total, no por "cero filas".
2. **`reporte_por_dia(..., p_agrupar text)`** → `periodo date, operaciones, canjes, es_mes boolean`.
   `p_agrupar` = `'dia'` | `'mes'` | `'auto'` (`auto`: día si el tramo recortado tiene hasta 62 días,
   mes si no). **`p_hasta` es obligatorio** (con null, cero filas): la app siempre lo manda (con "todo"
   y con un rango sin `hasta`, manda hoy). Tramo: `[max(p_desde, primera actividad del alcance),
   p_hasta]`, donde la "primera actividad" se busca SIN el borde inferior del período y CON los filtros
   de sucursal y cajero (con "Desde siempre" y un cajero elegido, la serie arranca en el primer día de
   ese cajero); cada fila se cuenta en el día local de SU comercio. **Contrato de las filas:** cero filas
   si y solo si el alcance filtrado no tuvo actividad hasta `p_hasta`, o `p_hasta` es null, o
   `p_desde > p_hasta` (la app los da vuelta antes de llamar); un período
   sin actividad en un alcance que ya operaba devuelve el tramo con filas en CERO. Por eso "sin
   actividad en el período" se decide con la fila total de `reporte_resumen`, nunca con
   `filas.length === 0`. Se pide con `.order('periodo')`.
3. **`reporte_clientes(..., p_orden text, p_desc boolean, p_limite integer, p_offset integer)`** →
   `comercio_id, cliente_id, nombre, apellido, telefono, operaciones, puntos_otorgados, canjes,
   ultima_actividad timestamptz, total bigint, offset_efectivo integer`. Agrega en una subconsulta y
   ordena afuera (un `order by case …` no puede usar el alias de un agregado). `p_orden` se valida
   contra una lista cerrada DENTRO de la SQL (`case`); un valor fuera de la lista ordena por visitas.
   `p_limite` se acota a [1, 1000] (null → 50). `total` = filas antes de paginar (un CTE que cuenta).
   El offset se acota con
   `least(greatest(p_offset, 0), greatest(((total - 1) / limite) * limite, 0))`, sobre el límite YA
   acotado (con `p_limite` crudo, 0 o null dividirían por cero). La división es ENTERA para alinear a
   múltiplo de página: con numérico, 312 filas de a 50 darían 311 en vez de 300. El `greatest` de
   afuera evita el negativo con total 0 y límite 1. (`floor()` sería equivalente a la división entera:
   no es una mutación que se pueda tirar.) Con total 0 la función devuelve cero filas, y gracias al
   acotado "cero filas" significa exactamente "total 0" (la app no puede leer `total` de una respuesta
   vacía). Pruebas: un comercio sin actividad con `pagina=5`; total 0 con límite 1; 312 de a 50 con la
   página 999 → `offset_efectivo` 300.
4. **`reporte_cajeros_alcance(...)`** → las columnas de `reporte_cajeros` más `comercio_id`, con los
   cuatro filtros y la definición única de Clientes; Correcciones y Forzadas salen de la clase
   `'ajuste'` y de `forzado` del CTE `actividad` (monto vendido: `sum(monto_compra)` de las visitas de
   `tipo = 'acreditacion'`, como en la 0033). La vieja `reporte_cajeros` queda intacta para su
   pantalla: sin `drop`, sin sobrecargas ambiguas (con `create or replace` y un parámetro más, Postgres
   crearía una segunda función y la llamada con 3 argumentos daría `PGRST203`; la 0015:101-104 ya lo
   documenta).
5. **Índices:** `tarjetas (comercio_id)` y `canjes (tarjeta_id, created_at)`, con
   `create index if not exists`. (Sin `concurrently`: la migración corre en una transacción y las
   tablas son chicas hoy.) Las visitas ya tienen `(tarjeta_id, created_at desc)` (0015:85).

Las funciones viejas (`reporte_sucursales`, `reporte_tendencia`, `reporte_top_clientes`) quedan; se
retiran en una migración posterior, cuando nada las use (hoy: el panel usa `reporte_sucursales`, la
pantalla de cajeros `reporte_cajeros`, el FM `reporte_fm_comercios`; `exportarClientes` deja de usar
`reporte_top_clientes` en esta entrega).

`lib/supabase/types.ts` se actualiza a mano (como en la 0033). **`scripts/verificar-0040.ts`** (solo
lectura): existen las cuatro funciones con su firma; `anon` no puede ejecutarlas; y, para cada comercio
demo en "Desde siempre" sin filtros, contra las viejas: visitas, acumulado y premios IGUALES, y
`clientes_nuevo >= clientes_viejo` (la definición nueva suma a quien solo canjeó). La base de la
comparación: `scripts/snapshot-reportes.ts`.

## 6. Lista de clientes en `.xlsx`

`GET /comercio/clientes/exportar?formato=xlsx`: mismas filas que el CSV (una por TARJETA, como hoy) en
una hoja "Clientes": Nombre, Apellido, Teléfono, Tarjeta, Saldo, **Visitas (todas sus tarjetas)**,
Cliente desde. Visitas como número, "Cliente desde" como fecha. Sin `formato`, el CSV de hoy (con el
mismo rótulo nuevo de Visitas). En la pantalla de clientes, junto a "Descargar CSV", un "Descargar
Excel" (`<a download>`). Se arreglan los cuatro defectos que el `.xlsx` heredaría (también arreglan el
CSV):
- las tarjetas se piden de a 1000, en orden `(created_at, id)`, hasta agotarlas;
- las visitas salen de `reporte_clientes` paginado (`p_comercios = [id]`, sin fechas), no de
  `reporte_top_clientes`: sin el corte en 1000;
- un error al leerlas hace fallar la exportación (500), no deja visitas en 0;
- "Cliente desde" es la fecha LOCAL del comercio.
El rótulo "Visitas (todas sus tarjetas)" dice lo que ya pasa: las visitas son del cliente en ese
comercio y se repiten en cada una de sus tarjetas, así que sumar la columna duplica.

## 7. Pruebas

- **Puras (con mutación):**
  - `resolverFiltrosReportes` extendida: período, fechas (y `0001-01-01`), cajero ajeno, orden/dir/página
    inválidos, parámetros repetidos, un solo comercio = elegido.
  - `urlReportes`: conserva filtros; cambiar de comercio borra sucursal y cajero; vuelve a página 1;
    dirección inicial por columna.
  - Presets en una zona: cerca de la medianoche local, y en `Europe/Madrid` el día del cambio de hora.
  - Las fechas del Excel: `Date.UTC` con el reloj local, probado desde una zona de proceso distinta.
  - La unidad del acumulado por tipo (centavos → dólares, sin contador → vacío).
- **Dónde corre cada prueba de la SQL** (decidido en el plan): la lógica de la SQL y sus mutaciones, en
  PGlite (Postgres en proceso, con las migraciones 0001–0040 leídas del disco), ANTES de pegarle la
  migración a Daniel; contra Supabase, lo que PGlite no ve (PostgREST: nombres de argumentos, tope de
  filas, `.range()`, tipos del JSON). Si PGlite no sirve, todo contra Supabase y las mutaciones de SQL
  declaradas como no corridas.
- **RPC contra la base** (como `lib/reportes/reportes.test.ts`). El fixture (`test/fixtures/entornoComercio.ts`)
  suma un helper para sembrar visitas y canjes con `created_at`, sucursal y cajero elegidos, y la
  opción `clienteId` en `crearTarjeta` (hoy no se puede tener el mismo cliente en dos comercios).
  - Bordes: 23:59 local del día X cuenta en X; 00:00 local de X+1 no (y 00:00 de X sí: `>=` contra `>`).
  - Dos comercios en zonas distintas (El Salvador y Bogotá) en el mismo alcance.
  - Sucursal, cajero y los dos juntos, en visitas Y en canjes.
  - Ajuste excluido; bruto (un 'uso' negativo no descuenta).
  - Resumen: la fila total no se confunde con "sin sucursal"; su `clientes_unicos` no es la suma.
  - Clientes: orden por cada columna y dirección; desempate estable (páginas 1 y 2 sin repetidos);
    `total`; `pagina` 999 devuelve la última; un cliente con solo canjes; el mismo cliente en dos
    comercios = dos filas; `p_orden` fuera de la lista.
  - Por día: tramo recortado; `auto` cambia a mes en 63 días; sin actividad, vacío.
  - **Mutation-testing obligatorio**, en particular cada filtro en la rama de CANJES por separado (cada
    filtro se escribe dos veces), el borde (`>=`/`>`, el `+1`), el `filter` del bruto, `grouping()`
    contra "ids null", y el desempate.
- **Rutas:** el Excel se lee con `read-excel-file` (9.x: `readSheet(buf, 'Clientes')`, o la función
  por defecto para todas las hojas; `trim: false` donde se compare texto exacto): hojas, encabezados,
  tipos (número, `Date`, string) y valores. `read-excel-file` devuelve solo valores: el formato
  `$#,##0.00` y la fila fija se verifican abriendo el zip con `fflate` (ya viene con `write-excel-file`)
  y buscando el formato en `xl/styles.xml` y `state="frozen"` en la hoja; la negrita y los anchos, en el
  navegador. El gate va mockeado como en `cartel/descargar/route.test.ts`, pero el mock devuelve
  también `comercios` y `nombre`, con DOS comercios para la prueba "un comercio ajeno en `?comercio=`
  cae a Todo" (con uno solo, cae a ese comercio). "Una RPC que falla da 500" se prueba mockeando la
  función de `lib` que la envuelve (contra la base real no se puede provocar).
- **`paginarTodo`** (pura): total 0, total = tamaño de página, total = el doble; y que nunca use
  `.range()` sobre `reporte_clientes` (se prueba el llamador con un falso que acota como la SQL).
- **Navegador (controlador):** filtros y tabla a 375 px y en escritorio, sin scroll horizontal de la
  página; el Excel abierto en una hoja real.

## Orden de publicación

1. Migración 0040: el asistente la escribe y la pega en el chat; **Daniel la aplica en Studio**; se
   verifica con `scripts/verificar-0040.ts`. Como no toca nada existente, el código publicado sigue
   igual.
2. Recién después, el deploy (suite completa en verde, que con la 0040 aplicada incluye las pruebas de
   las RPC nuevas).

## Fuera de alcance

- Retirar las funciones viejas (migración posterior).
- Filtros nuevos en la pantalla de cajeros (su detalle con todos los filtros va en la hoja Cajeros).
- "Visitas" como días distintos: sigue siendo la cuenta de operaciones (0033).
- Unidades mezcladas dentro de un comercio con programas de tipos distintos.
- El panel de FM (`reporte_fm_comercios`).
- Los números del PANEL del comercio: siguen con `reporte_sucursales` (solo cambia el rótulo a
  "Visitas"), así que su "Clientes" (solo visitas) puede diferir del de Reportes "Desde siempre" para la
  misma sucursal. Pasarlo a `reporte_resumen` es natural en la migración que retire las funciones
  viejas.
- Reportes para el cajero (sigue siendo solo del dueño).

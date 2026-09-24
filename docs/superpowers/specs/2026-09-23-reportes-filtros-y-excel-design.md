# Reportes con filtros, tabla de clientes y Excel

**Fecha:** 2026-09-23 · **Estado:** diseño aprobado por Daniel en líneas generales (2026-09-23, "Aprobado,
en ese orden"); esta spec lo baja a detalle. Segunda de dos entregas pedidas tras los onboardings del
2026-09-22/23 (la primera: `2026-09-23-wallet-dispositivo-y-logos-design.md`). **Lleva migración 0040**
(funciones de reporte nuevas + dos índices), que Daniel aplica a mano ANTES del deploy.

## Lo que pidió Daniel

Tras los onboardings, un comercio preguntó si puede "ordenar por toques de consumo de mayor a menor o
solo ver los de X día", y exportar a Excel y no solo a CSV. Decisiones (2026-09-23, preguntas con
opciones):

1. **Reportes, las cuatro:** rango de fechas en todo; tabla de clientes ordenable; filtro por sucursal
   en todo; filtro por cajero.
2. **Excel:** "Clientes y reportes": un botón en Reportes que baja un `.xlsx` con varias hojas
   respetando los filtros, y la lista de clientes también en `.xlsx` además del CSV.
3. Lo aprobado en el resumen de diseño: presets Hoy / Ayer / 7 días / 30 días / Este mes / Personalizado;
   tabla con nombre, teléfono, visitas, acumulado, premios y última visita, ordenable tocando la
   columna, 50 por página, que reemplaza el top 5; hojas Resumen / Clientes / Por día / Por sucursal /
   Cajeros; números como números; librería `exceljs`; **en pantalla "Visitas"**, en el código
   "operaciones".

## Cómo está hoy (relevado el 2026-09-23)

- `app/comercio/(protegido)/reportes/page.tsx`: vista del CONGLOMERADO de comercios del dueño (ignora
  el switcher del header, spec 2026-07-25 §4.7), con chips GET de comercio y sucursal. Sin período:
  cabecera y cartas por sucursal son **todo el histórico**; la tendencia son 14 días fijos; el top son
  5 clientes históricos. Al elegir una sucursal se ESCONDEN tendencia y top ("esos reportes solo
  existen por comercio").
- Las RPC (`reporte_sucursales`, `reporte_tendencia`, `reporte_top_clientes`, `reporte_cajeros`; última
  definición en la 0033) son por UN comercio, SECURITY INVOKER, solo `service_role`; el acceso lo
  controla la app (`verifyComercioOwner` + ids de la sesión). Solo `reporte_cajeros` acepta fechas, y
  ninguna filtra por sucursal Y cajero a la vez.
- `reportes/cajeros/page.tsx`: comercio ACTIVO, `desde`/`hasta` por GET, 30 días por defecto.
- CSV de clientes: `app/comercio/(protegido)/clientes/exportar/route.ts` + `lib/comercio/exportarClientes.ts`.
  Tres defectos que el `.xlsx` heredaría: la consulta de tarjetas no pagina (PostgREST corta en 1000
  sin avisar); el error de `reporte_top_clientes` se ignora (visitas en 0 en silencio); "Cliente
  desde" es la fecha UTC y no la del comercio.
- Índices: no hay ninguno que empiece por `tarjetas.comercio_id` (el de 0001 empezaba por
  `cliente_id`, y la 0024 lo reemplazó por `(cliente_id, programa_id)`); `canjes` no tiene índice por
  `created_at`. Todas las RPC de reporte filtran `t.comercio_id = …` y recorren canjes por fecha.

## Definiciones que NO cambian (0033)

- **Visita** (en código `operaciones`): una fila de `transacciones_puntos` con `tipo in ('acreditacion',
  'uso', 'renovacion')`. Los ajustes (`'ajuste'`) no son visitas.
- **Acumulado** (`puntos_otorgados`): `sum(puntos_delta) filter (where tipo = 'acreditacion')`: BRUTO,
  nunca neto (un 'uso' de gift card o prepago lleva delta negativo; neto, el fraude se borraría solo).
- **Premios**: filas de `canjes`.
- **Clientes**: `count(distinct t.cliente_id)` de quien tuvo una visita O un canje en el alcance.
- El rótulo del acumulado sale de `describirCosto(tipo del programa principal)`, como hoy; para cupón,
  membresía y descuento `describirCosto` devuelve `''` y la columna se omite en pantalla (en el Excel
  va el número con el encabezado "Acumulado").

**Rótulo:** "Operaciones" pasa a decir **"Visitas"** en Reportes, en la pantalla de cajeros y en el
Excel (decisión de Daniel). La cuenta es la misma de la 0033; el subtítulo que la explica se conserva
("veces que atendiste a un cliente"). Los comentarios de la 0033 que cuentan por qué se dejó de decir
"Visitas acreditadas" siguen valiendo: lo que confundía era "acreditadas".

## 1. Filtros

Todos por **GET, sin JavaScript** (como hoy): la URL es el reporte, se comparte y se guarda. Un
parámetro inválido cae a su valor por defecto; nunca da error.

| Parámetro | Valores | Por defecto |
|---|---|---|
| `periodo` | `hoy`, `ayer`, `7d`, `30d`, `mes`, `todo`, `rango` | `30d` |
| `desde`, `hasta` | `YYYY-MM-DD`, solo con `periodo=rango` (invertidos se dan vuelta, como `resolverRangoFechas`) | — |
| `comercio` | id de un comercio SUYO | todos ("Todo") |
| `sucursal` | id de una sucursal de ese comercio (activa o no) | todas |
| `cajero` | id de un `usuarios_comercio` de ese comercio (cajero o dueño, activo o no) | todos |
| `orden`, `dir`, `pagina` | ver §3 | `visitas`, `desc`, `1` |

- **`todo` ("Desde siempre")** no estaba en la lista aprobada y se agrega: es lo que la pantalla
  muestra HOY en la cabecera y en las cartas, y sin él esa vista desaparece. El default pasa a 30 días
  (lo que un dueño mira a diario); para ver el histórico hay que tocar "Desde siempre". **A confirmar
  con Daniel al revisar esta spec.**
- **Las fechas son días LOCALES de cada comercio** (su `zona_horaria`), con los dos bordes inclusivos,
  como `reporte_cajeros`: `desde` = 00:00 local de ese día, `hasta` = 00:00 local del día siguiente
  (exclusivo). Los presets los resuelve la app con la zona del comercio filtrado; en "Todo", con la del
  primer comercio del dueño. (Limitación documentada: un dueño con comercios en zonas distintas puede
  ver "Hoy" corrido un día en uno de ellos cerca de la medianoche. Hoy todos los pilotos están en
  `America/El_Salvador`.)
- `sucursal` y `cajero` exigen `comercio` (son de un comercio). Con "Todo", no se muestran.
- `sucursal` y `cajero` se combinan (un cajero en una sucursal). Un cajero que no pertenece a esa
  sucursal da resultados vacíos, no un error: el dueño puede haber operado en varias.
- La validación es PURA y con prueba: `resolverFiltrosReportes` se extiende (hoy valida comercio y
  sucursal) para período, cajero, orden, dirección y página. Un id ajeno se descarta ANTES de correr
  cualquier RPC, como hoy.

**Interfaz de filtros:** filas de chips (`.filtro-chip`, `Link`) en este orden: período; comercio
(solo con 2 o más); sucursal (con un comercio elegido y 2 o más sucursales); cajero (con un comercio
elegido y al menos un cajero). "Personalizado" muestra un `<form method="GET">` con dos
`<input type="date">` y un botón "Ver", que conserva los demás filtros en `<input type="hidden">`.
Cada chip conserva los filtros que no cambia (hoy `urlComercio`/`urlSucursal` los pierden) y vuelve a
`pagina=1`. Las URLs las arma una función pura (`urlReportes(filtros, cambios)`), con prueba.

## 2. Qué muestra Reportes con los filtros

Todo respeta TODOS los filtros; ya no hay bloques que se escondan al elegir sucursal.

1. **Cabecera:** Visitas, Premios y Clientes del alcance y el período. Clientes es la cuenta DISTINTA
   del alcance (no la suma de las sucursales, que duplicaría a quien fue a dos).
2. **Por día:** las barras de hoy (`.pista`), una por día del período. Si el período pasa de **62
   días** (incluido "Desde siempre"), se agrupa **por mes** y el título lo dice ("Por mes"). Con "Todo"
   el período empieza en la primera actividad del alcance.
3. **Por sucursal:** las cartas de hoy (Clientes, Visitas, Premios), por comercio si hay 2 o más, con
   el período y el cajero aplicados. Con una sucursal elegida, solo esa carta.
4. **Clientes** (§3), en lugar del top 5.
5. Botones: **"Descargar Excel"** (§4) y "Ver actividad por cajero", que ahora lleva el período elegido
   (`desde`/`hasta` resueltos). La pantalla de cajeros no cambia de alcance (comercio activo); suma el
   filtro de sucursal a su RPC (§5) solo a través del Excel. Su rótulo "Operaciones" pasa a "Visitas".

## 3. Tabla de clientes

- **Una fila por (comercio, cliente)** con actividad en el alcance y el período: al menos una visita o
  un premio. Columnas: Cliente (nombre y apellido; debajo, el teléfono formateado), **Visitas**,
  **Acumulado**, **Premios**, **Última visita** (fecha y hora locales). Con 2 o más comercios en el
  alcance, también **Comercio**.
- **Orden:** tocar un encabezado ordena por esa columna (`orden` = `visitas` | `acumulado` | `premios` |
  `ultima` | `nombre`); tocar la columna activa invierte (`dir` = `desc` | `asc`). Por defecto, visitas
  de mayor a menor. Desempate SIEMPRE por `cliente_id` (y `comercio_id`), para que la paginación no
  repita ni saltee filas entre páginas. El encabezado activo lleva `aria-sort`.
- **Paginación de 50**, en SQL (`limit`/`offset`), con el total (`count(*) over ()`) para "Página 2
  de 7 · 312 clientes" y los enlaces Anterior/Siguiente. Una página fuera de rango se lee como la
  última.
- En el teléfono (375 px) la tabla va dentro de un contenedor con scroll horizontal y la columna
  Cliente fija; el resto de la pantalla no scrollea de costado.

## 4. Excel de Reportes

`GET /comercio/reportes/exportar` con los mismos parámetros de filtro (sin `orden`/`dir`/`pagina`:
el Excel trae TODOS los clientes, ordenados por visitas desc). Patrón de
`programas/[id]/cartel/descargar/route.ts`: `runtime = 'nodejs'`, `force-dynamic`, `verifyComercioOwner`
FUERA de cualquier try/catch (el gate lanza `NEXT_REDIRECT`), los mismos filtros validados por la
misma función pura, `Content-Disposition: attachment`, `Cache-Control: no-store`. Nombre:
`reportes-<comercio o "todos">-<desde>_<hasta>.xlsx` (saneado como el del CSV).

Hojas (encabezados en negrita, primera fila fija, anchos razonables):

| Hoja | Columnas |
|---|---|
| **Resumen** | Filtros aplicados en texto (comercio, sucursal, cajero, período con sus fechas), Visitas, Premios, Clientes, "Generado" (fecha y hora locales). |
| **Clientes** | (Comercio,) Nombre, Apellido, Teléfono, Visitas, Acumulado, Premios, Última visita. |
| **Por día** | Día, Visitas, Premios: SIEMPRE por día (no por mes), incluidos los días sin actividad. |
| **Por sucursal** | Comercio, Sucursal, Visitas, Acumulado, Premios, Clientes. |
| **Cajeros** | Comercio, Cajero (email; "Sin registrar" para el grupo sin cajero), Visitas, Acumulado, Monto vendido, Forzadas, Correcciones, Premios, Clientes. |

- **Números como números** (celdas numéricas, no texto); **fechas como fechas de Excel** con formato
  `dd/mm/yyyy` o `dd/mm/yyyy hh:mm`, construidas con la hora LOCAL del comercio (exceljs escribe la
  fecha tal cual; si se le pasa el instante UTC, Excel muestra la hora corrida 6 horas).
- **El teléfono va como texto** (conserva el `+503`). En `.xlsx` un texto que empieza con `=` NO se
  evalúa como fórmula (exceljs solo escribe fórmulas si se le pasan como `{ formula }`), así que no
  hace falta el apóstrofo del CSV. Prueba que lo fije.
- **Nunca un archivo vacío por un error.** Si una RPC falla, la ruta responde 500 con JSON, no un Excel
  con ceros: el fail-soft `[]` de `lib/reportes/reportes.ts` sirve para la pantalla, no para un
  archivo que el dueño va a creer. Las funciones nuevas devuelven `null` ante un error (como
  `reporteCajeros`).
- **Sin el tope de 1000 filas:** la hoja Clientes pide las filas de a 1000 hasta agotar el total.
- Cajeros: una llamada a `reporte_cajeros` por comercio del alcance, con período y sucursal.

**Librería:** `exceljs` (mantenida; el `xlsx` de npm tiene vulnerabilidades conocidas sin parche en
el registro público). Antes de instalar, `npm view exceljs version` y `npm audit` después: si
apareciera algo alto o crítico, se frena y se consulta. Si rompe el build de Next (Turbopack),
`serverExternalPackages`, como `passkit-generator`.

## 5. Base de datos: migración 0040

Funciones NUEVAS, con el mismo molde que las de la 0033: `language sql stable`,
`set search_path = public`, SECURITY INVOKER, `revoke … from public, anon, authenticated` +
`grant … to service_role` explícitos (una función nueva nace con execute para PUBLIC). El acceso lo
sigue controlando la app. Todas reciben el alcance como **`p_comercios uuid[]`** (así "Todo" se resuelve
en SQL, en UNA llamada, y la tabla de clientes pagina sobre el conglomerado; hoy eso se arma en JS
juntando tops por comercio y no se puede paginar) más `p_desde date, p_hasta date` (null = sin ese
borde, días locales de cada comercio), `p_sucursal_id uuid`, `p_cajero_id uuid` (null = todos).

1. **`reporte_resumen(...)`** → por `(comercio_id, sucursal_id)`: `sucursal_nombre`, `sucursal_activa`,
   `operaciones`, `puntos_otorgados`, `canjes`, `clientes_unicos`; MÁS una fila de total del alcance
   (`comercio_id` y `sucursal_id` null, marcada con una columna `es_total boolean`) cuyo
   `clientes_unicos` es la cuenta distinta del alcance entero. (Con `grouping sets` o con un `union`
   explícito; lo que resulte más legible.)
2. **`reporte_por_dia(..., p_agrupar text)`** → `periodo date, operaciones, canjes`. `p_agrupar` =
   `'dia'` | `'mes'`. Serie completa con `generate_series` entre `desde` y `hasta` (o desde la primera
   actividad del alcance si `desde` es null), días locales. Con varias zonas en el alcance, cada fila se
   cuenta en el día local de SU comercio (como hace hoy `sumarTendencias`).
3. **`reporte_clientes(..., p_orden text, p_desc boolean, p_limite integer, p_offset integer)`** →
   `comercio_id, cliente_id, nombre, apellido, telefono, operaciones, puntos_otorgados, canjes,
   ultima_actividad timestamptz, total bigint`. `p_orden` se valida contra una lista cerrada DENTRO de
   la SQL (`case`), además de en la app: un valor fuera de la lista ordena por visitas. `total` =
   `count(*) over ()` antes del `limit`. `ultima_actividad` = el máximo `created_at` entre sus visitas
   y sus canjes del alcance.
4. **`reporte_cajeros`**: suma `p_sucursal_id uuid default null` al final. Cambia la firma, así que va
   `drop` + `create` y se repiten los `revoke` y los `grant`. Con el `default`, el código publicado (que
   la llama con 3 argumentos con nombre) sigue andando DESPUÉS de la migración y ANTES del deploy; el
   script de verificación lo prueba llamándola con 3 argumentos.
5. **Índices:** `tarjetas (comercio_id)` y `canjes (created_at)`, con `create index if not exists`.
   (Sin `concurrently`: la migración corre en una transacción y las tablas son chicas hoy.)

Las funciones viejas (`reporte_sucursales`, `reporte_tendencia`, `reporte_top_clientes`) NO se borran:
`exportarClientes` usa `reporte_top_clientes` y el panel de FM usa `reporte_fm_comercios`, y un `drop`
en la misma migración rompería producción entre la migración y el deploy. Quedan anotadas para
retirarlas en una migración posterior.

`lib/supabase/types.ts` se actualiza a mano (como en la 0033). `scripts/verificar-0040.ts` (solo
lectura): que existan las funciones nuevas con su firma, que `anon` NO pueda ejecutarlas, que
`reporte_cajeros` responda con 3 y con 4 argumentos, y que los números de un comercio demo en "Desde
siempre" coincidan con los de las funciones viejas (`scripts/snapshot-reportes.ts` sirve de base).

## 6. Lista de clientes en `.xlsx`

`GET /comercio/clientes/exportar?formato=xlsx`: mismas filas y columnas que el CSV (Nombre, Apellido,
Teléfono, Tarjeta, Saldo, Visitas, Cliente desde), en una hoja "Clientes", con Visitas como número y
"Cliente desde" como fecha. Sin `formato`, sigue siendo el CSV de hoy. En la pantalla de clientes, junto
a "Descargar CSV", un "Descargar Excel". De paso se arreglan los tres defectos que el `.xlsx`
heredaría (también arreglan el CSV):
- las tarjetas se piden de a 1000 hasta agotarlas;
- un error de `reporte_top_clientes` hace fallar la exportación (500), no deja visitas en 0;
- "Cliente desde" es la fecha LOCAL del comercio.

## 7. Pruebas

- **Puras (con mutación):** `resolverFiltrosReportes` extendida (período, fechas, cajero ajeno,
  orden/dir/página inválidos); `urlReportes` (conserva filtros, vuelve a página 1); la resolución de los
  presets en una zona (Hoy/Ayer/7d/30d/Este mes cerca de la medianoche local, que es donde falla);
  `agrupacionDelPeriodo` (62 días → día, 63 → mes); el armado de las filas del Excel.
- **RPC contra la base** (como `lib/reportes/reportes.test.ts`), sembrando el ledger con `created_at`
  elegido (un helper nuevo en `test/fixtures/entornoComercio.ts`, que hoy no lo tiene):
  - bordes del período en la zona del comercio: una visita a las 23:30 locales del día X cuenta en X y
    no en X+1;
  - sucursal, cajero, y los dos juntos;
  - ajuste excluido; bruto (un 'uso' negativo no descuenta el acumulado);
  - clientes: orden por cada columna, las dos direcciones, desempate estable entre páginas, `total`,
    un cliente con solo canjes en el período;
  - "Todo" con dos comercios: un cliente de los dos sale en dos filas;
  - el total de clientes distintos del resumen NO es la suma de las sucursales;
  - `p_orden` fuera de la lista no rompe ni inyecta.
  - Mutation-testing obligatorio: romper la línea que cada prueba protege (el `+1` del borde, el
    `filter` del bruto, el filtro de cajero, el desempate) y ver caer la prueba por la razón correcta.
- **Rutas:** el Excel se abre con `exceljs` en la prueba y se miran hojas, encabezados, tipos (número,
  fecha, texto) y valores; el gate (`verifyComercioOwner` mockeado, como `cartel/descargar/route.test.ts`);
  un comercio ajeno en `?comercio=` cae a "Todo" del dueño; una RPC que falla da 500.
- **Navegador (controlador):** los filtros y la tabla en 375 px y en escritorio; ningún scroll
  horizontal de la página; el Excel se abre (y se mira) en una hoja real.

## Orden de publicación

1. Migración 0040: el asistente la escribe y la pega en el chat; **Daniel la aplica en Studio**; se
   verifica con `scripts/verificar-0040.ts`. El código publicado sigue andando con la 0040 aplicada.
2. Recién después, el deploy (suite completa en verde, que con la 0040 aplicada incluye las pruebas de
   las RPC nuevas).

## Fuera de alcance

- Retirar las funciones viejas (migración posterior, cuando nada las use).
- "Visitas" como DÍAS distintos: sigue siendo la cuenta de operaciones (0033).
- Unidades mezcladas en el acumulado de un comercio con programas de tipos distintos (sellos y
  centavos): se escribe con el tipo del programa principal, como hoy.
- El panel de FM (`reporte_fm_comercios`).
- Reportes para el cajero (sigue siendo solo del dueño).

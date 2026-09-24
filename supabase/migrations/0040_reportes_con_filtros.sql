-- 0040: reportes con filtros — período, comercio, sucursal y cajero en TODOS los bloques.
--
-- Ver docs/superpowers/specs/2026-09-23-reportes-filtros-y-excel-design.md (§5 y "Definiciones").
--
-- ══ POR QUÉ FUNCIONES NUEVAS ══
-- Las de la 0033 son por UN comercio, solo reporte_cajeros acepta fechas y ninguna filtra por
-- sucursal y cajero a la vez. Reportes pasa a filtrar TODO por período, sucursal y cajero, y "Todo"
-- (el conglomerado de comercios del dueño) se resuelve en UNA llamada: por eso el alcance llega como
-- `p_comercios uuid[]`, y la tabla de clientes pagina sobre el conglomerado entero y no comercio por
-- comercio.
--
-- ══ NADA EXISTENTE SE TOCA ══
-- Ninguna función se reemplaza ni se borra: entre esta migración y el deploy el código publicado
-- sigue llamando a las de la 0033, y después las siguen usando el panel (reporte_sucursales), la
-- pantalla de cajeros (reporte_cajeros) y el FM (reporte_fm_comercios). En particular reporte_cajeros
-- NO gana parámetros: `create or replace` con otra lista de argumentos no reemplaza nada, crea una
-- SEGUNDA función con el mismo nombre (0015:101-104). Mientras los parámetros nuevos no lleven
-- `default`, PostgREST igual resolvería la llamada publicada de 3 argumentos (descarta la función que
-- pide argumentos que no le llegan); pero alcanzaría con que alguien le pusiera un `default` a uno de
-- ellos para que esa llamada se volviera ambigua (PGRST203), y dos funciones con el mismo nombre
-- obligan a escribir la firma en cada drop, revoke y grant. Un nombre propio, reporte_cajeros_alcance,
-- no deja esa trampa armada. Las viejas se retiran en una migración posterior, cuando nada las use.
--
-- ══ LA FORMA COMÚN — la misma en las cuatro, a propósito ══
--   • `lim`: un renglón por comercio del alcance, con los bordes del período convertidos a INSTANTES
--     en la zona de ESE comercio (como reporte_cajeros): desde = 00:00 local, hasta = 00:00 local del
--     día SIGUIENTE, exclusivo (el `+ 1`). Un alcance con dos zonas corta cada comercio en su propia
--     medianoche. Nunca `(created_at at time zone z)::date` en el WHERE: no puede usar índice.
--   • `actividad`: el ledger y los canjes en UNA lista, ya filtrados por los cuatro filtros (alcance,
--     período, sucursal, cajero) escritos en las DOS ramas. Cada filtro existe dos veces, y olvidarlo
--     en la rama de canjes dejaría pasar premios de otra sucursal o de otro cajero sin que las visitas
--     lo delaten. Cada fila lleva su `clase`: 'visita' (acreditacion, uso, renovacion), 'ajuste' o
--     'canje'.
--   • Todo se agrega desde ahí con `filter`. Es la única forma de contar bien "clientes con al menos
--     una visita O un premio": con un CTE por tabla, como en la 0033, los dos count(distinct) no se
--     pueden sumar (quien visitó y canjeó contaría dos veces).
--   • Los nombres (sucursal, cliente, email) se unen DESPUÉS de agregar, y las sumas llevan coalesce.
--
-- ══ LAS DEFINICIONES (spec, "Definiciones") ══
--   • Visitas (en código `operaciones`) = filas del ledger de tipo acreditacion, uso o renovacion.
--     Igual que la 0033.
--   • Acumulado (`puntos_otorgados`) = la suma de puntos_delta SOLO de las acreditaciones: BRUTO,
--     nunca neto. Un 'uso' de gift card o de prepago lleva delta negativo; si entrara a la suma, un
--     cajero que otorga y después consume se borraría solo del reporte (0015, 0033). Lo protege su
--     propio filter, no el WHERE.
--   • Premios (`canjes`) = filas de canjes.
--   • Clientes (`clientes_unicos`) = clientes distintos con al menos una visita O un premio. CAMBIA
--     respecto de la 0033: reporte_sucursales no contaba a quien solo canjeó, y reporte_cajeros
--     contaba cualquier fila del ledger, ajustes incluidos. Acá es una sola definición en todo.
--
-- ══ LOS AJUSTES ══
-- Una corrección no es actividad comercial: es el arreglo de algo que ya se contó (0033). Entran SOLO
-- en reporte_cajeros_alcance, que es donde el dueño juzga a un cajero ("Correcciones"). En las otras
-- tres el CTE los excluye desde el WHERE y no con un filter: si llegaran a `actividad`, un cliente con
-- solo ajustes tendría fila, un ajuste movería su última actividad y una sucursal con solo ajustes
-- aparecería en el resumen. (En reporte_por_dia el tramo sale de `primera`, que por eso repite la
-- exclusión: un ajuste viejo estiraría la serie hacia atrás.)
--
-- ══ SEGURIDAD ══
-- Igual que 0009/0010/0015/0033: SECURITY INVOKER, `revoke` de public/anon/authenticated y `grant` a
-- service_role con la firma explícita. Una función nueva nace con execute para PUBLIC, y la anon key
-- viaja en el bundle del navegador: sin el revoke, cualquiera leería por REST los reportes de
-- cualquier comercio con solo conocer su id. El acceso real lo controla la app (verifyComercioOwner +
-- los ids de la sesión), que descarta un id ajeno ANTES de llamar.
--
-- ══ NOMBRES DE COLUMNAS ══
-- Varias columnas de salida se llaman igual que columnas de las tablas (comercio_id, sucursal_id,
-- canjes, nombre...). En `language sql` eso no choca (0015: la columna gana en silencio), y por las
-- dudas TODA referencia del cuerpo va calificada con su alias.
--
-- ORDEN: es ADITIVA. Se aplica ANTES del deploy; hasta entonces nada la llama.
begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Índices
-- ─────────────────────────────────────────────────────────────────────────────
-- Todo reporte entra por `tarjetas.comercio_id` (el alcance), y ningún índice empieza por esa columna:
-- el de la 0001 empezaba por cliente_id y la 0024 lo reemplazó por (cliente_id, programa_id). Los
-- canjes no tenían índice por fecha; las visitas ya tienen (tarjeta_id, created_at desc) desde la
-- 0015. Sin `concurrently`: la migración corre en una transacción y las tablas hoy son chicas.
create index if not exists tarjetas_comercio_idx on tarjetas (comercio_id);
create index if not exists canjes_tarjeta_fecha_idx on canjes (tarjeta_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. reporte_resumen — la cabecera y las cartas por sucursal, en una sola pasada
-- ─────────────────────────────────────────────────────────────────────────────
-- Una fila por (comercio, sucursal) más UNA fila total del alcance entero.
--
-- `es_total` sale de grouping(), NUNCA de "los ids son null": la actividad sin sucursal (anterior a la
-- atribución, o de un cajero sin sucursal) también tiene sucursal_id null, y confundirla con el total
-- mostraría el total como una sucursal más o se comería esa fila. grouping() devuelve un entero con
-- un bit por argumento: 3 (0b11) = ninguno de los dos agrupa = la fila del conjunto `()`. (Pedir los
-- DOS ids null daría hoy lo mismo, porque una fila agrupada siempre trae comercio_id —tarjetas lo
-- tiene NOT NULL—, así que esa mutación no la tira ninguna prueba; grouping() no depende de eso.)
--
-- El clientes_unicos de la fila total es la cuenta DISTINTA del alcance entero, no la suma de las
-- sucursales: quien fue a dos sucursales (o tiene tarjeta en dos comercios) cuenta 1.
--
-- Con el alcance sin actividad, el conjunto `()` devuelve IGUAL la fila total, con ceros (por el
-- coalesce): "sin actividad" se decide ignorando la fila total, no por "cero filas".
create function reporte_resumen(
  p_comercios uuid[], p_desde date, p_hasta date, p_sucursal_id uuid, p_cajero_id uuid
)
returns table(
  comercio_id uuid, sucursal_id uuid, sucursal_nombre text, sucursal_activa boolean,
  operaciones bigint, puntos_otorgados bigint, canjes bigint, clientes_unicos bigint,
  es_total boolean
)
language sql stable
set search_path = public
as $$
  with lim as (
    select c.id as comercio_id,
           (coalesce(p_desde, '1970-01-01'::date)::timestamp at time zone c.zona_horaria) as ts_desde,
           ((coalesce(p_hasta, '9999-12-30'::date) + 1)::timestamp at time zone c.zona_horaria) as ts_hasta
    from comercios c
    where c.id = any(p_comercios)
  ),
  actividad as (
    select case when tp.tipo = 'ajuste' then 'ajuste' else 'visita' end as clase,
           t.comercio_id, tp.sucursal_id, tp.cajero_usuario_id, t.cliente_id,
           tp.puntos_delta, tp.tipo, tp.forzado, tp.monto_compra, tp.created_at
    from transacciones_puntos tp
    join tarjetas t on t.id = tp.tarjeta_id
    join lim l on l.comercio_id = t.comercio_id
    where tp.created_at >= l.ts_desde and tp.created_at < l.ts_hasta
      and (p_sucursal_id is null or tp.sucursal_id = p_sucursal_id)
      and (p_cajero_id is null or tp.cajero_usuario_id = p_cajero_id)
      and tp.tipo in ('acreditacion', 'uso', 'renovacion')
    union all
    select 'canje'::text as clase,
           t.comercio_id, c.sucursal_id, c.cajero_usuario_id, t.cliente_id,
           null::integer, null::text, false, null::numeric, c.created_at
    from canjes c
    join tarjetas t on t.id = c.tarjeta_id
    join lim l on l.comercio_id = t.comercio_id
    where c.created_at >= l.ts_desde and c.created_at < l.ts_hasta
      and (p_sucursal_id is null or c.sucursal_id = p_sucursal_id)
      and (p_cajero_id is null or c.cajero_usuario_id = p_cajero_id)
  ),
  agregado as (
    select a.comercio_id, a.sucursal_id,
           count(*) filter (where a.clase = 'visita')::bigint as operaciones,
           coalesce(sum(a.puntos_delta) filter (where a.clase = 'visita' and a.tipo = 'acreditacion'), 0)::bigint as puntos_otorgados,
           count(*) filter (where a.clase = 'canje')::bigint as canjes,
           count(distinct a.cliente_id) filter (where a.clase in ('visita', 'canje'))::bigint as clientes_unicos,
           grouping(a.comercio_id, a.sucursal_id) = 3 as es_total
    from actividad a
    group by grouping sets ((a.comercio_id, a.sucursal_id), ())
  )
  select ag.comercio_id, ag.sucursal_id, s.nombre, s.activa,
         ag.operaciones, ag.puntos_otorgados, ag.canjes, ag.clientes_unicos, ag.es_total
  from agregado ag
  left join sucursales s on s.id = ag.sucursal_id
  order by ag.es_total desc, ag.comercio_id, (ag.sucursal_id is null), s.nombre, ag.sucursal_id;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. reporte_por_dia — la serie de barras (y la hoja "Por día" del Excel)
-- ─────────────────────────────────────────────────────────────────────────────
-- `p_hasta` es OBLIGATORIO: con null, cero filas (la app siempre lo manda; con "Desde siempre" y con
-- un rango sin hasta, manda hoy). Sin él la serie no tendría fin: con '9999-12-30' como borde, como
-- en las otras tres, generaría millones de días.
--
-- TRAMO: [max(p_desde, primera actividad del alcance), p_hasta]. La primera actividad se busca SIN el
-- borde inferior del período (CTE `primera`): con un comercio que ya operaba antes, la serie cubre el
-- período entero, días sin actividad incluidos; solo se recorta por delante cuando el alcance es más
-- nuevo que el período, y es lo que le pone principio a "Desde siempre" (que no tiene desde). Lleva
-- los mismos filtros que `actividad` salvo el período, y excluye los ajustes por la razón de arriba.
-- Los filtros de sucursal y cajero van en `primera` A PROPÓSITO: con "Desde siempre" y un cajero
-- elegido, la serie arranca en el primer día de ESE cajero, no en el del comercio.
--
-- CERO FILAS sale si y solo si: 1) p_hasta es null; 2) el alcance filtrado (comercios, sucursal,
-- cajero, sin ajustes) no tuvo actividad hasta p_hasta — ninguna, o solo posterior —; o 3) p_desde
-- es posterior a p_hasta (la app los da vuelta antes de llamar, así que no lo manda). Un período SIN
-- actividad en un alcance que ya operaba NO da cero filas: devuelve el tramo entero con filas en
-- CERO. Por eso "sin actividad en el período" se decide con la fila total de reporte_resumen (sus
-- operaciones y canjes en cero), NUNCA con `filas.length === 0` de esta función: es el mismo
-- criterio que el de la fila total del resumen, más arriba.
--
-- Cada fila se cuenta en el día local de SU comercio (la zona sale de `lim`, que por eso la trae).
--
-- `p_agrupar`: 'dia' | 'mes' | 'auto'. En 'auto', día si el tramo recortado tiene hasta 62 días y
-- mes si pasa (63 = mes). Cualquier otro valor, null incluido, se lee como 'auto'. Por mes, `periodo`
-- es el día 1 de ese mes y los meses del tramo sin actividad salen con ceros.
--
-- Los días se generan con aritmética de FECHAS (date + integer), no con generate_series de
-- timestamps, y el mes con date_trunc sobre `timestamp` sin zona: nada depende del TimeZone de la
-- sesión.
--
-- Líneas de esta función que ninguna prueba puede tirar, y está bien que así sea (cada una se mutó y
-- se corrió en PGlite, lib/reportes/sql0040.pglite.test.ts): (a) la exclusión de los ajustes en el
-- WHERE de `actividad` — acá los conteos filtran por clase y el tramo sale de `primera`, así que un
-- ajuste que llegara a `actividad` no cambiaría ningún número; queda por la forma común. (b) El
-- `p_hasta is not null` de `lim` — con p_hasta null, generate_series recibiría un null y tampoco
-- devolvería filas; está para que el contrato se lea en el código y para no recorrer la historia en
-- vano. (c) El filtro de PERÍODO de `actividad`, en las dos ramas — el `left join` desde `dias` ya
-- descarta toda fila cuyo día local cae fuera del tramo, y los bordes del período son exactamente
-- bordes de día local: sacarlo entero, o cambiar el `<` del hasta por `<=`, no cambia ningún número.
-- Solo se ve el `>=` del desde (un `>` perdería la fila de las 00:00 en punto, que es del primer día).
-- Está para que el índice (tarjeta_id, created_at) lea el período y no toda la historia del alcance.
-- (d) Parecido con el alcance de `actividad`: `conteo_dia` vuelve a unir con `lim` por comercio_id, así
-- que la fila de un comercio ajeno no llegaría al conteo; la mutación "join lim on true" cae igual,
-- pero porque DUPLICA filas cuando el alcance tiene dos comercios, no porque se cuele uno ajeno.
create function reporte_por_dia(
  p_comercios uuid[], p_desde date, p_hasta date, p_sucursal_id uuid, p_cajero_id uuid,
  p_agrupar text
)
returns table(periodo date, operaciones bigint, canjes bigint, es_mes boolean)
language sql stable
set search_path = public
as $$
  with lim as (
    select c.id as comercio_id, c.zona_horaria as zona,
           (coalesce(p_desde, '1970-01-01'::date)::timestamp at time zone c.zona_horaria) as ts_desde,
           ((p_hasta + 1)::timestamp at time zone c.zona_horaria) as ts_hasta
    from comercios c
    where c.id = any(p_comercios)
      and p_hasta is not null
  ),
  actividad as (
    select case when tp.tipo = 'ajuste' then 'ajuste' else 'visita' end as clase,
           t.comercio_id, tp.sucursal_id, tp.cajero_usuario_id, t.cliente_id,
           tp.puntos_delta, tp.tipo, tp.forzado, tp.monto_compra, tp.created_at
    from transacciones_puntos tp
    join tarjetas t on t.id = tp.tarjeta_id
    join lim l on l.comercio_id = t.comercio_id
    where tp.created_at >= l.ts_desde and tp.created_at < l.ts_hasta
      and (p_sucursal_id is null or tp.sucursal_id = p_sucursal_id)
      and (p_cajero_id is null or tp.cajero_usuario_id = p_cajero_id)
      and tp.tipo in ('acreditacion', 'uso', 'renovacion')
    union all
    select 'canje'::text as clase,
           t.comercio_id, c.sucursal_id, c.cajero_usuario_id, t.cliente_id,
           null::integer, null::text, false, null::numeric, c.created_at
    from canjes c
    join tarjetas t on t.id = c.tarjeta_id
    join lim l on l.comercio_id = t.comercio_id
    where c.created_at >= l.ts_desde and c.created_at < l.ts_hasta
      and (p_sucursal_id is null or c.sucursal_id = p_sucursal_id)
      and (p_cajero_id is null or c.cajero_usuario_id = p_cajero_id)
  ),
  -- El primer día local con actividad en el alcance, por comercio y después el más temprano. Se toma
  -- el min(created_at) de cada comercio y recién ahí se pasa a fecha local. Vale porque lo monótono
  -- dentro de una zona es la FECHA local, no la conversión entera: en el cambio de hora de otoño la
  -- HORA local retrocede, pero el día no. Así, el día del instante más temprano es el más temprano de
  -- los días, el mismo que daría convertir fila por fila.
  primera as (
    select min(x.dia) as dia
    from (
      select (min(tp.created_at) at time zone l.zona)::date as dia
      from transacciones_puntos tp
      join tarjetas t on t.id = tp.tarjeta_id
      join lim l on l.comercio_id = t.comercio_id
      where (p_sucursal_id is null or tp.sucursal_id = p_sucursal_id)
        and (p_cajero_id is null or tp.cajero_usuario_id = p_cajero_id)
        and tp.tipo in ('acreditacion', 'uso', 'renovacion')
      group by l.comercio_id, l.zona
      union all
      select (min(c.created_at) at time zone l.zona)::date as dia
      from canjes c
      join tarjetas t on t.id = c.tarjeta_id
      join lim l on l.comercio_id = t.comercio_id
      where (p_sucursal_id is null or c.sucursal_id = p_sucursal_id)
        and (p_cajero_id is null or c.cajero_usuario_id = p_cajero_id)
      group by l.comercio_id, l.zona
    ) x
  ),
  -- greatest() ignora el null: sin p_desde ("Desde siempre"), el tramo arranca en la primera actividad.
  tramo as (
    select greatest(p_desde, pr.dia) as desde, p_hasta as hasta
    from primera pr
    where pr.dia is not null
  ),
  dias as (
    select tr.desde + i as dia,
           case when p_agrupar = 'mes' then true
                when p_agrupar = 'dia' then false
                else (tr.hasta - tr.desde + 1) > 62
           end as es_mes
    from tramo tr, generate_series(0, tr.hasta - tr.desde) as i
  ),
  conteo_dia as (
    select (a.created_at at time zone l.zona)::date as dia,
           count(*) filter (where a.clase = 'visita')::bigint as operaciones,
           count(*) filter (where a.clase = 'canje')::bigint as canjes
    from actividad a
    join lim l on l.comercio_id = a.comercio_id
    group by 1
  )
  select case when d.es_mes then date_trunc('month', d.dia::timestamp)::date else d.dia end as periodo,
         coalesce(sum(cd.operaciones), 0)::bigint as operaciones,
         coalesce(sum(cd.canjes), 0)::bigint as canjes,
         d.es_mes
  from dias d
  left join conteo_dia cd on cd.dia = d.dia
  group by 1, d.es_mes
  order by 1;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. reporte_clientes — la tabla ordenable y paginada (y la hoja "Clientes" del Excel)
-- ─────────────────────────────────────────────────────────────────────────────
-- Una fila por (comercio, cliente) con al menos una visita o un premio en el alcance y el período: la
-- misma persona con tarjeta en dos comercios es DOS filas (y 1 en la cabecera). Sus varias tarjetas de
-- un mismo comercio (una por programa, 0024) suman en la misma fila. `ultima_actividad` es la más
-- reciente entre visitas y premios, con los filtros aplicados (con un cajero elegido, la última vez
-- que ESE cajero lo atendió).
--
-- Agrega en un CTE y ordena afuera: un `order by case ...` no puede usar el alias de un agregado.
--
-- ORDEN: `p_orden` se valida contra una lista CERRADA acá adentro ('visitas', 'acumulado', 'premios',
-- 'ultima', 'nombre'); cualquier otro valor, null incluido, ordena por visitas. `p_desc` null toma la
-- dirección inicial de la columna (nombre ascendente, el resto descendente). Cada columna lleva su
-- par de `case` (uno por dirección) porque la dirección de un ORDER BY no se puede parametrizar.
-- Desempate (spec §3): por nombre, apellido en la misma dirección con los null al final, y después
-- cliente_id → comercio_id; en las demás columnas, directo cliente_id → comercio_id. (comercio_id,
-- cliente_id) es la clave del agregado, así que el orden es TOTAL: entre páginas ni repite ni saltea.
-- El nombre se ordena con la collation de la base, tal cual viene (sin lower()). El `nulls last` del
-- apellido ASCENDENTE es el default de `asc`: está para que el par de líneas se lea parejo, y quitarlo
-- no cambia nada (esa mutación no la tira ninguna prueba); el del descendente sí hace falta.
--
-- PAGINACIÓN: `p_limite` se acota a [1, 1000] (null = 50, la página de la pantalla). `total` = filas
-- antes de paginar. El offset se acota con el total para que una página más allá del final se lea
-- como la ÚLTIMA:
--   least(greatest(p_offset, 0), greatest(((total - 1) / limite) * limite, 0))
-- Tres detalles de esa fórmula:
--   • `limite` es el límite YA acotado, no p_limite crudo: con p_limite 0 (o null) se dividiría por
--     cero.
--   • La división es ENTERA (bigint / integer trunca) para alinear el tope al comienzo de la última
--     página: con numeric, 312 filas de a 50 darían un offset de 311 en vez de 300, y la "última
--     página" mostraría una sola fila. floor() sobre numeric daría lo mismo que la división entera
--     (el único numerador negativo es el de total 0, y lo arregla el greatest de afuera), así que una
--     mutación a floor() no la tira ninguna prueba.
--   • El greatest(…, 0) de afuera evita el offset negativo cuando total = 0 y limite = 1:
--     (0 - 1) / 1 = -1. Con un límite de 2 o más, la división entera ya da 0.
-- Gracias al acotado, cero filas significa exactamente total 0: la app no puede leer `total` de una
-- respuesta vacía. `offset_efectivo` le dice a la app qué página recibió de verdad.
--
-- OJO con `.range()` desde PostgREST: el limit/offset que agrega va POR FUERA de este resultado (que
-- ya viene paginado), y la segunda página saldría vacía. Esta función se pagina SOLO con p_offset.
create function reporte_clientes(
  p_comercios uuid[], p_desde date, p_hasta date, p_sucursal_id uuid, p_cajero_id uuid,
  p_orden text, p_desc boolean, p_limite integer, p_offset integer
)
returns table(
  comercio_id uuid, cliente_id uuid, nombre text, apellido text, telefono text,
  operaciones bigint, puntos_otorgados bigint, canjes bigint, ultima_actividad timestamptz,
  total bigint, offset_efectivo integer
)
language sql stable
set search_path = public
as $$
  with lim as (
    select c.id as comercio_id,
           (coalesce(p_desde, '1970-01-01'::date)::timestamp at time zone c.zona_horaria) as ts_desde,
           ((coalesce(p_hasta, '9999-12-30'::date) + 1)::timestamp at time zone c.zona_horaria) as ts_hasta
    from comercios c
    where c.id = any(p_comercios)
  ),
  actividad as (
    select case when tp.tipo = 'ajuste' then 'ajuste' else 'visita' end as clase,
           t.comercio_id, tp.sucursal_id, tp.cajero_usuario_id, t.cliente_id,
           tp.puntos_delta, tp.tipo, tp.forzado, tp.monto_compra, tp.created_at
    from transacciones_puntos tp
    join tarjetas t on t.id = tp.tarjeta_id
    join lim l on l.comercio_id = t.comercio_id
    where tp.created_at >= l.ts_desde and tp.created_at < l.ts_hasta
      and (p_sucursal_id is null or tp.sucursal_id = p_sucursal_id)
      and (p_cajero_id is null or tp.cajero_usuario_id = p_cajero_id)
      and tp.tipo in ('acreditacion', 'uso', 'renovacion')
    union all
    select 'canje'::text as clase,
           t.comercio_id, c.sucursal_id, c.cajero_usuario_id, t.cliente_id,
           null::integer, null::text, false, null::numeric, c.created_at
    from canjes c
    join tarjetas t on t.id = c.tarjeta_id
    join lim l on l.comercio_id = t.comercio_id
    where c.created_at >= l.ts_desde and c.created_at < l.ts_hasta
      and (p_sucursal_id is null or c.sucursal_id = p_sucursal_id)
      and (p_cajero_id is null or c.cajero_usuario_id = p_cajero_id)
  ),
  agregado as (
    select a.comercio_id, a.cliente_id,
           count(*) filter (where a.clase = 'visita')::bigint as operaciones,
           coalesce(sum(a.puntos_delta) filter (where a.clase = 'visita' and a.tipo = 'acreditacion'), 0)::bigint as puntos_otorgados,
           count(*) filter (where a.clase = 'canje')::bigint as canjes,
           max(a.created_at) as ultima_actividad
    from actividad a
    group by a.comercio_id, a.cliente_id
  ),
  conteo as (
    select count(*)::bigint as total from agregado
  ),
  paginado as (
    select pl.limite, co.total,
           least(greatest(p_offset, 0), greatest(((co.total - 1) / pl.limite) * pl.limite, 0)) as offset_efectivo
    from (select least(greatest(coalesce(p_limite, 50), 1), 1000) as limite) pl
    cross join conteo co
  ),
  orden as (
    select o.columna, coalesce(p_desc, o.columna <> 'nombre') as descendente
    from (
      select case when p_orden in ('visitas', 'acumulado', 'premios', 'ultima', 'nombre') then p_orden
                  else 'visitas'
             end as columna
    ) o
  )
  select ag.comercio_id, ag.cliente_id, cl.nombre, cl.apellido, cl.telefono,
         ag.operaciones, ag.puntos_otorgados, ag.canjes, ag.ultima_actividad,
         pa.total, pa.offset_efectivo::integer
  from agregado ag
  join clientes cl on cl.id = ag.cliente_id
  cross join paginado pa
  cross join orden o
  order by
    case when o.columna = 'visitas' and o.descendente then ag.operaciones end desc,
    case when o.columna = 'visitas' and not o.descendente then ag.operaciones end asc,
    case when o.columna = 'acumulado' and o.descendente then ag.puntos_otorgados end desc,
    case when o.columna = 'acumulado' and not o.descendente then ag.puntos_otorgados end asc,
    case when o.columna = 'premios' and o.descendente then ag.canjes end desc,
    case when o.columna = 'premios' and not o.descendente then ag.canjes end asc,
    case when o.columna = 'ultima' and o.descendente then ag.ultima_actividad end desc,
    case when o.columna = 'ultima' and not o.descendente then ag.ultima_actividad end asc,
    case when o.columna = 'nombre' and o.descendente then cl.nombre end desc,
    case when o.columna = 'nombre' and not o.descendente then cl.nombre end asc,
    case when o.columna = 'nombre' and o.descendente then cl.apellido end desc nulls last,
    case when o.columna = 'nombre' and not o.descendente then cl.apellido end asc nulls last,
    ag.cliente_id, ag.comercio_id
  limit (select p.limite from paginado p)
  offset (select p.offset_efectivo from paginado p);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. reporte_cajeros_alcance — la hoja "Cajeros" del Excel, con los cuatro filtros
-- ─────────────────────────────────────────────────────────────────────────────
-- Las columnas de reporte_cajeros (0033) más comercio_id: una fila por (comercio, cajero), incluido el
-- grupo cajero_usuario_id null ("Sin registrar", actividad anterior a la atribución). Es la ÚNICA de
-- las cuatro donde los ajustes entran a `actividad`: de ahí salen `ajustes` (Correcciones) y
-- `puntos_ajustados`. Forzadas = filas con `forzado` (en los canjes es false). El monto vendido suma
-- `monto_compra` solo de las acreditaciones, como en la 0033.
--
-- Diferencia deliberada con reporte_cajeros: `clientes_unicos` usa la definición única (visita o
-- premio). Allá contaba cualquier fila del ledger, ajustes incluidos, y no contaba a quien solo canjeó.
-- La pantalla de cajeros sigue con su función y su definición; la hoja Resumen del Excel lo aclara.
create function reporte_cajeros_alcance(
  p_comercios uuid[], p_desde date, p_hasta date, p_sucursal_id uuid, p_cajero_id uuid
)
returns table(
  comercio_id uuid, cajero_usuario_id uuid, cajero_email text, cajero_activo boolean,
  operaciones bigint, puntos_otorgados bigint, monto_total numeric,
  forzadas bigint, ajustes bigint, puntos_ajustados bigint,
  canjes bigint, clientes_unicos bigint
)
language sql stable
set search_path = public
as $$
  with lim as (
    select c.id as comercio_id,
           (coalesce(p_desde, '1970-01-01'::date)::timestamp at time zone c.zona_horaria) as ts_desde,
           ((coalesce(p_hasta, '9999-12-30'::date) + 1)::timestamp at time zone c.zona_horaria) as ts_hasta
    from comercios c
    where c.id = any(p_comercios)
  ),
  actividad as (
    select case when tp.tipo = 'ajuste' then 'ajuste' else 'visita' end as clase,
           t.comercio_id, tp.sucursal_id, tp.cajero_usuario_id, t.cliente_id,
           tp.puntos_delta, tp.tipo, tp.forzado, tp.monto_compra, tp.created_at
    from transacciones_puntos tp
    join tarjetas t on t.id = tp.tarjeta_id
    join lim l on l.comercio_id = t.comercio_id
    where tp.created_at >= l.ts_desde and tp.created_at < l.ts_hasta
      and (p_sucursal_id is null or tp.sucursal_id = p_sucursal_id)
      and (p_cajero_id is null or tp.cajero_usuario_id = p_cajero_id)
      -- Acá SÍ entran los ajustes (ver arriba).
      and tp.tipo in ('acreditacion', 'uso', 'renovacion', 'ajuste')
    union all
    select 'canje'::text as clase,
           t.comercio_id, c.sucursal_id, c.cajero_usuario_id, t.cliente_id,
           null::integer, null::text, false, null::numeric, c.created_at
    from canjes c
    join tarjetas t on t.id = c.tarjeta_id
    join lim l on l.comercio_id = t.comercio_id
    where c.created_at >= l.ts_desde and c.created_at < l.ts_hasta
      and (p_sucursal_id is null or c.sucursal_id = p_sucursal_id)
      and (p_cajero_id is null or c.cajero_usuario_id = p_cajero_id)
  ),
  agregado as (
    select a.comercio_id, a.cajero_usuario_id,
           count(*) filter (where a.clase = 'visita')::bigint as operaciones,
           coalesce(sum(a.puntos_delta) filter (where a.clase = 'visita' and a.tipo = 'acreditacion'), 0)::bigint as puntos_otorgados,
           coalesce(sum(a.monto_compra) filter (where a.clase = 'visita' and a.tipo = 'acreditacion'), 0)::numeric as monto_total,
           count(*) filter (where a.forzado)::bigint as forzadas,
           count(*) filter (where a.clase = 'ajuste')::bigint as ajustes,
           coalesce(sum(a.puntos_delta) filter (where a.clase = 'ajuste'), 0)::bigint as puntos_ajustados,
           count(*) filter (where a.clase = 'canje')::bigint as canjes,
           count(distinct a.cliente_id) filter (where a.clase in ('visita', 'canje'))::bigint as clientes_unicos
    from actividad a
    group by a.comercio_id, a.cajero_usuario_id
  )
  select ag.comercio_id, ag.cajero_usuario_id, u.email, u.activo,
         ag.operaciones, ag.puntos_otorgados, ag.monto_total,
         ag.forzadas, ag.ajustes, ag.puntos_ajustados,
         ag.canjes, ag.clientes_unicos
  from agregado ag
  left join usuarios_comercio u on u.id = ag.cajero_usuario_id
  order by ag.comercio_id, (ag.cajero_usuario_id is null), ag.forzadas + ag.ajustes desc, u.email,
           ag.cajero_usuario_id;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. PERMISOS — los `revoke` tanto como los `grant`, con la firma explícita
-- ─────────────────────────────────────────────────────────────────────────────
revoke execute on function reporte_resumen(uuid[], date, date, uuid, uuid) from public, anon, authenticated;
revoke execute on function reporte_por_dia(uuid[], date, date, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function reporte_clientes(uuid[], date, date, uuid, uuid, text, boolean, integer, integer) from public, anon, authenticated;
revoke execute on function reporte_cajeros_alcance(uuid[], date, date, uuid, uuid) from public, anon, authenticated;

grant execute on function reporte_resumen(uuid[], date, date, uuid, uuid) to service_role;
grant execute on function reporte_por_dia(uuid[], date, date, uuid, uuid, text) to service_role;
grant execute on function reporte_clientes(uuid[], date, date, uuid, uuid, text, boolean, integer, integer) to service_role;
grant execute on function reporte_cajeros_alcance(uuid[], date, date, uuid, uuid) to service_role;

commit;

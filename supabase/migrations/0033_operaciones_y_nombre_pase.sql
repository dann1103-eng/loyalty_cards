-- 0033: los reportes cuentan OPERACIONES (no solo acreditaciones), y el pase gana un nombre propio.
--
-- Ver docs/superpowers/specs/2026-09-08-coherencia-por-tipo-de-tarjeta-design.md (decisiones 4 y 6).
--
-- ══ EL DEFECTO ══
-- El ledger distingue cuatro tipos (0019): 'acreditacion', 'ajuste', 'uso' y 'renovacion'. Renovar
-- una membresía escribe 'renovacion'; usar un cupón, consumir una visita de prepago o cobrar de una
-- gift card escriben 'uso'. Pero las cinco funciones de reporte filtran `tipo = 'acreditacion'`, así
-- que para un comercio de MEMBRESÍA todos los conteos de actividad y todas las sumas de valor dan
-- cero aunque tenga cientos de renovaciones — incluida la pantalla antifraude por cajero, que existe
-- para detectar a quien regala cosas y es ciega frente a un cajero que regala renovaciones. (No es
-- literalmente TODO el módulo: `forzadas`, `ajustes`, `puntos_ajustados` y `clientes_unicos` de
-- reporte_cajeros nunca filtraron por tipo, ni `clientes` ni `saldo_circulante` de fm_comercios.)
--
-- ══ LA REGLA, Y ES LO ÚNICO QUE HAY QUE ENTENDER DE ESTA MIGRACIÓN ══
--   • Lo que cuenta ACTIVIDAD se ensancha a ('acreditacion', 'uso', 'renovacion').
--   • Lo que suma VALOR se queda en 'acreditacion', y para eso lleva su PROPIO `filter`.
--
-- La segunda mitad no es un detalle. Un 'uso' PUEDE llevar delta negativo: -1 en prepago (0020) y
-- -monto en gift card (0022). (El 'uso' de un cupón sí lleva 0 — 0019 —, pero basta con que uno solo
-- no lo lleve para que la suma no pueda ensancharse.) Si entrara a `sum(puntos_delta)`, el total
-- pasaría de BRUTO a NETO y
-- un cajero que otorga y después consume se borraría solo del reporte — exactamente lo que la 0015
-- decidió impedir ("así el fraude no se autoborra del reporte"). Por eso el WHERE se ensancha y la
-- suma se protege con su filter, en vez de dejar el WHERE viejo y agregar filters nuevos: con el
-- `tipo = 'acreditacion'` intacto en el WHERE, ningún filter nuevo vería jamás una fila 'uso' ni
-- 'renovacion', el conteo saldría idéntico y TODAS las pruebas seguirían verdes.
--
-- 'ajuste' queda afuera de los dos lados porque una CORRECCIÓN no es actividad comercial: es el
-- arreglo de una actividad que ya se contó. Además ya se cuenta por separado en reporte_cajeros,
-- que es donde el dueño la mira para juzgar a un cajero.
--
-- ══ POR QUÉ drop + create Y NO create or replace ══
-- La columna `acreditaciones` pasa a llamarse `operaciones`, y eso cambia el tipo de retorno:
-- Postgres rechaza el `create or replace` con "cannot change return type of existing function".
-- Un nombre que ya no describe lo que cuenta es justamente la trampa que este trabajo cierra, así
-- que se renombra. Consecuencia: `drop` borra el ACL, y hay que repetir los `revoke` de la 0010 y
-- la 0015 ADEMÁS de los `grant` — una función recién creada nace con execute para PUBLIC, y
-- reporte_fm_comercios() no lleva parámetros y devuelve datos de TODOS los comercios.
--
-- `reporte_top_clientes` NO cambia de firma (sus columnas son `visitas` y `puntos_totales`), así
-- que va con `create or replace` y conserva su ACL.
begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. El nombre del pase, por programa
-- ─────────────────────────────────────────────────────────────────────────────
-- Lo que el cliente ve en su tarjeta (Apple: headerField; Google: textModulesData). Opcional:
-- null = el pase sale como hasta ahora. NO se reusa `nombre`, que es el rótulo interno del dueño y
-- en el programa principal nace igual al nombre del comercio (0024) — mostrarlo sería repetir el
-- nombre del negocio que ya está en el logo.
--
-- El tope de largo es parte del CHECK y no solo de la validación de aplicación: este texto se
-- interpola en el JSON del .pkpass y en el textModulesData de Google, y Apple recomienda ~35
-- caracteres para que entre en el headerField de un teléfono angosto.
alter table programas_tarjeta
  add column nombre_pase text
    check (nombre_pase is null or (btrim(nombre_pase) <> '' and char_length(nombre_pase) <= 40));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Las cuatro funciones que renombran su columna
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists reporte_sucursales(uuid);
drop function if exists reporte_tendencia(uuid, integer);
drop function if exists reporte_cajeros(uuid, date, date);
drop function if exists reporte_fm_comercios();

create function reporte_sucursales(p_comercio_id uuid)
returns table(
  sucursal_id uuid, sucursal_nombre text, sucursal_activa boolean,
  operaciones bigint, puntos_otorgados bigint, canjes bigint, clientes_unicos bigint
)
language sql stable
set search_path = public
as $$
  with acred as (
    select tp.sucursal_id as sid,
           count(*)::bigint as operaciones,
           -- El filter que protege el BRUTO. Sin él, el consumo de una gift card cancelaría lo
           -- otorgado y el fraude se autoborraría.
           coalesce(sum(tp.puntos_delta) filter (where tp.tipo = 'acreditacion'), 0)::bigint as puntos_otorgados,
           -- Se ensancha con el WHERE, o sea que ahora cuenta también a quien solo usó un cupón o
           -- renovó. Queda una asimetría con reporte_cajeros, donde `clientes_unicos` sigue sin
           -- filtro alguno (cuenta a quién ATENDIÓ ese cajero, y una corrección también es atender).
           count(distinct t.cliente_id)::bigint as clientes_unicos
    from transacciones_puntos tp
    join tarjetas t on t.id = tp.tarjeta_id
    where t.comercio_id = p_comercio_id
      and tp.tipo in ('acreditacion', 'uso', 'renovacion')
    group by tp.sucursal_id
  ),
  canj as (
    select c.sucursal_id as sid, count(*)::bigint as canjes
    from canjes c
    join tarjetas t on t.id = c.tarjeta_id
    where t.comercio_id = p_comercio_id
    group by c.sucursal_id
  ),
  sids as (
    select sid from acred union select sid from canj
  )
  select
    sids.sid,
    s.nombre,
    s.activa,
    coalesce(a.operaciones, 0)::bigint,
    coalesce(a.puntos_otorgados, 0)::bigint,
    coalesce(cj.canjes, 0)::bigint,
    coalesce(a.clientes_unicos, 0)::bigint
  from sids
  left join acred a on a.sid is not distinct from sids.sid
  left join canj cj on cj.sid is not distinct from sids.sid
  left join sucursales s on s.id = sids.sid
  order by (sids.sid is null), s.nombre;
$$;

create function reporte_tendencia(p_comercio_id uuid, p_dias integer)
returns table(dia date, operaciones bigint, canjes bigint)
language sql stable
set search_path = public
as $$
  with zona as (
    select coalesce(
      (select c.zona_horaria from comercios c where c.id = p_comercio_id),
      'America/El_Salvador'
    ) as z
  ),
  hoy as (select (now() at time zone zona.z)::date as d0 from zona),
  dias as (
    select gs::date as d
    from hoy, generate_series(hoy.d0 - (greatest(coalesce(p_dias, 30), 1) - 1), hoy.d0, interval '1 day') gs
  ),
  acred as (
    select (tp.created_at at time zone zona.z)::date as d, count(*)::bigint as n
    from transacciones_puntos tp
    join tarjetas t on t.id = tp.tarjeta_id
    cross join zona
    where t.comercio_id = p_comercio_id
      and tp.tipo in ('acreditacion', 'uso', 'renovacion')
    group by 1
  ),
  canj as (
    select (c.created_at at time zone zona.z)::date as d, count(*)::bigint as n
    from canjes c
    join tarjetas t on t.id = c.tarjeta_id
    cross join zona
    where t.comercio_id = p_comercio_id
    group by 1
  )
  select dias.d, coalesce(a.n, 0)::bigint, coalesce(cj.n, 0)::bigint
  from dias
  left join acred a on a.d = dias.d
  left join canj cj on cj.d = dias.d
  order by dias.d;
$$;

-- reporte_cajeros ya usaba `filter` campo por campo y NO tiene un WHERE por tipo: acá solo se
-- ensancha el filter del conteo. `clientes_unicos` se deja SIN filtro, como estaba: cuenta a quién
-- ATENDIÓ ese cajero, y una corrección también es haberlo atendido.
create function reporte_cajeros(p_comercio_id uuid, p_desde date, p_hasta date)
returns table(
  cajero_usuario_id uuid, cajero_email text, cajero_activo boolean,
  operaciones bigint, puntos_otorgados bigint, monto_total numeric,
  forzadas bigint, ajustes bigint, puntos_ajustados bigint,
  canjes bigint, clientes_unicos bigint
)
language sql stable
set search_path = public
as $$
  with lim as (
    select (coalesce(p_desde, '1970-01-01'::date)::timestamp at time zone c.zona_horaria) as ts_desde,
           ((coalesce(p_hasta, '9999-12-30'::date) + 1)::timestamp at time zone c.zona_horaria) as ts_hasta
    from comercios c where c.id = p_comercio_id
  ),
  acred as (
    select tp.cajero_usuario_id as uid,
           count(*) filter (where tp.tipo in ('acreditacion', 'uso', 'renovacion'))::bigint as n_oper,
           coalesce(sum(tp.puntos_delta) filter (where tp.tipo = 'acreditacion'), 0)::bigint as n_puntos,
           coalesce(sum(tp.monto_compra) filter (where tp.tipo = 'acreditacion'), 0)::numeric as n_monto,
           count(*) filter (where tp.forzado)::bigint as n_forzadas,
           count(*) filter (where tp.tipo = 'ajuste')::bigint as n_ajustes,
           coalesce(sum(tp.puntos_delta) filter (where tp.tipo = 'ajuste'), 0)::bigint as n_pajust,
           count(distinct t.cliente_id)::bigint as n_clientes
    from transacciones_puntos tp
    join tarjetas t on t.id = tp.tarjeta_id
    cross join lim
    where t.comercio_id = p_comercio_id
      and tp.created_at >= lim.ts_desde and tp.created_at < lim.ts_hasta
    group by tp.cajero_usuario_id
  ),
  canj as (
    select c.cajero_usuario_id as uid, count(*)::bigint as n_canjes
    from canjes c
    join tarjetas t on t.id = c.tarjeta_id
    cross join lim
    where t.comercio_id = p_comercio_id
      and c.created_at >= lim.ts_desde and c.created_at < lim.ts_hasta
    group by c.cajero_usuario_id
  ),
  uids as (select uid from acred union select uid from canj)
  select
    uids.uid, u.email, u.activo,
    coalesce(a.n_oper, 0)::bigint,
    coalesce(a.n_puntos, 0)::bigint,
    coalesce(a.n_monto, 0)::numeric,
    coalesce(a.n_forzadas, 0)::bigint,
    coalesce(a.n_ajustes, 0)::bigint,
    coalesce(a.n_pajust, 0)::bigint,
    coalesce(cj.n_canjes, 0)::bigint,
    coalesce(a.n_clientes, 0)::bigint
  from uids
  left join acred a on a.uid is not distinct from uids.uid
  left join canj cj on cj.uid is not distinct from uids.uid
  left join usuarios_comercio u on u.id = uids.uid
  order by (uids.uid is null), coalesce(a.n_forzadas, 0) + coalesce(a.n_ajustes, 0) desc, u.email;
$$;

create function reporte_fm_comercios()
returns table(
  comercio_id uuid, comercio_nombre text, cuenta_id uuid, cuenta_nombre text,
  clientes bigint, operaciones bigint, canjes bigint, saldo_circulante bigint
)
language sql stable
set search_path = public
as $$
  select
    co.id, co.nombre, co.cuenta_id, cu.nombre,
    (select count(*) from tarjetas t where t.comercio_id = co.id)::bigint,
    (select count(*) from transacciones_puntos tp join tarjetas t on t.id = tp.tarjeta_id
       where t.comercio_id = co.id and tp.tipo in ('acreditacion', 'uso', 'renovacion'))::bigint,
    (select count(*) from canjes c join tarjetas t on t.id = c.tarjeta_id where t.comercio_id = co.id)::bigint,
    -- OJO: `saldo_circulante` suma puntos_actuales de TODOS los comercios y todos los tipos, así que
    -- mezcla sellos con centavos. Es un defecto conocido y queda FUERA de esta migración: arreglarlo
    -- pide decidir qué significa "saldo" al agregar comercios de tipos distintos, y esa pregunta no
    -- tiene respuesta obvia. Anotado en el spec, sección "Fuera de alcance".
    (select coalesce(sum(t.puntos_actuales), 0) from tarjetas t where t.comercio_id = co.id)::bigint
  from comercios co
  left join cuentas_comercio cu on cu.id = co.cuenta_id
  order by (co.cuenta_id is null), cu.nombre, co.nombre;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. La que NO cambia de firma: solo se ensancha el conteo de `visitas`
-- ─────────────────────────────────────────────────────────────────────────────
-- `visitas` es actividad y se ensancha; `puntos_totales` es valor y se queda en 'acreditacion'.
-- Como el tipo de retorno no cambia, `create or replace` alcanza y el ACL se conserva.
create or replace function reporte_top_clientes(p_comercio_id uuid, p_limite integer)
returns table(cliente_id uuid, cliente_nombre text, visitas bigint, puntos_totales bigint)
language sql stable
set search_path = public
as $$
  select cl.id, cl.nombre,
         count(*)::bigint as visitas,
         coalesce(sum(tp.puntos_delta) filter (where tp.tipo = 'acreditacion'), 0)::bigint as puntos_totales
  from transacciones_puntos tp
  join tarjetas t on t.id = tp.tarjeta_id
  join clientes cl on cl.id = t.cliente_id
  where t.comercio_id = p_comercio_id
    and tp.tipo in ('acreditacion', 'uso', 'renovacion')
  group by cl.id, cl.nombre
  order by visitas desc, puntos_totales desc
  limit greatest(coalesce(p_limite, 10), 0);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. PERMISOS de las cuatro recreadas — los `revoke` tanto como los `grant`
-- ─────────────────────────────────────────────────────────────────────────────
-- `drop` borró el ACL y una función nueva nace con execute para PUBLIC. Sin estos `revoke`,
-- reporte_fm_comercios() —sin parámetros y cross-comercio— queda invocable por `anon` vía PostgREST.
revoke execute on function reporte_sucursales(uuid) from public, anon, authenticated;
revoke execute on function reporte_tendencia(uuid, integer) from public, anon, authenticated;
revoke execute on function reporte_cajeros(uuid, date, date) from public, anon, authenticated;
revoke execute on function reporte_fm_comercios() from public, anon, authenticated;

grant execute on function reporte_sucursales(uuid) to service_role;
grant execute on function reporte_tendencia(uuid, integer) to service_role;
grant execute on function reporte_cajeros(uuid, date, date) to service_role;
grant execute on function reporte_fm_comercios() to service_role;

commit;

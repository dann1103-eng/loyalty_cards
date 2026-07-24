-- 0010: funciones de reportes (BI) agregadas en SQL, read-only.
-- SEGURIDAD: igual que 0009 — funciones SECURITY INVOKER (default); se REVOCA execute de
-- public/anon/authenticated y se GRANTea a service_role. Todos los callers (pantallas del dueño y de
-- FM) las llaman con service_role, scopeando por p_comercio_id que viene del gate, NUNCA del cliente.
-- Son `language sql stable`: agregación pura, sin el riesgo de colisión de variables OUT del plpgsql.
-- El ledger (transacciones_puntos/canjes) no tiene comercio_id → se scopea via join a tarjetas.

-- Índices para las agregaciones (bajo volumen hoy, baratos y a prueba de crecimiento).
create index if not exists transacciones_puntos_sucursal_idx on transacciones_puntos (sucursal_id);
create index if not exists canjes_sucursal_idx on canjes (sucursal_id);
create index if not exists transacciones_puntos_tarjeta_idx on transacciones_puntos (tarjeta_id);
create index if not exists transacciones_puntos_created_idx on transacciones_puntos (created_at);
create index if not exists canjes_tarjeta_idx on canjes (tarjeta_id);

-- Por sucursal del comercio: acreditaciones, puntos otorgados, canjes, clientes únicos.
-- Incluye la actividad SIN sucursal (bucket sucursal_id NULL, filas previas a la atribución).
create or replace function reporte_sucursales(p_comercio_id uuid)
returns table(
  sucursal_id uuid, sucursal_nombre text, sucursal_activa boolean,
  acreditaciones bigint, puntos_otorgados bigint, canjes bigint, clientes_unicos bigint
)
language sql stable
set search_path = public
as $$
  with acred as (
    select tp.sucursal_id as sid,
           count(*)::bigint as acreditaciones,
           coalesce(sum(tp.puntos_delta), 0)::bigint as puntos_otorgados,
           count(distinct t.cliente_id)::bigint as clientes_unicos
    from transacciones_puntos tp
    join tarjetas t on t.id = tp.tarjeta_id
    where t.comercio_id = p_comercio_id
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
    coalesce(a.acreditaciones, 0)::bigint,
    coalesce(a.puntos_otorgados, 0)::bigint,
    coalesce(cj.canjes, 0)::bigint,
    coalesce(a.clientes_unicos, 0)::bigint
  from sids
  left join acred a on a.sid is not distinct from sids.sid
  left join canj cj on cj.sid is not distinct from sids.sid
  left join sucursales s on s.id = sids.sid
  order by (sids.sid is null), s.nombre;
$$;

-- Top clientes del comercio por cantidad de visitas (y puntos como desempate).
create or replace function reporte_top_clientes(p_comercio_id uuid, p_limite integer)
returns table(cliente_id uuid, cliente_nombre text, visitas bigint, puntos_totales bigint)
language sql stable
set search_path = public
as $$
  select cl.id, cl.nombre,
         count(*)::bigint as visitas,
         coalesce(sum(tp.puntos_delta), 0)::bigint as puntos_totales
  from transacciones_puntos tp
  join tarjetas t on t.id = tp.tarjeta_id
  join clientes cl on cl.id = t.cliente_id
  where t.comercio_id = p_comercio_id
  group by cl.id, cl.nombre
  order by visitas desc, puntos_totales desc
  limit greatest(coalesce(p_limite, 10), 0);
$$;

-- Serie diaria (últimos p_dias días) de acreditaciones y canjes, en hora de El Salvador (UTC-6) para
-- que el corte de día coincida con lo que ve el comercio. Días sin actividad salen en 0 (LEFT join).
create or replace function reporte_tendencia(p_comercio_id uuid, p_dias integer)
returns table(dia date, acreditaciones bigint, canjes bigint)
language sql stable
set search_path = public
as $$
  with hoy as (select (now() at time zone 'America/El_Salvador')::date as d0),
  dias as (
    select gs::date as d
    from hoy, generate_series(hoy.d0 - (greatest(coalesce(p_dias, 30), 1) - 1), hoy.d0, interval '1 day') gs
  ),
  acred as (
    select (tp.created_at at time zone 'America/El_Salvador')::date as d, count(*)::bigint as n
    from transacciones_puntos tp
    join tarjetas t on t.id = tp.tarjeta_id
    where t.comercio_id = p_comercio_id
    group by 1
  ),
  canj as (
    select (c.created_at at time zone 'America/El_Salvador')::date as d, count(*)::bigint as n
    from canjes c
    join tarjetas t on t.id = c.tarjeta_id
    where t.comercio_id = p_comercio_id
    group by 1
  )
  select dias.d, coalesce(a.n, 0)::bigint, coalesce(cj.n, 0)::bigint
  from dias
  left join acred a on a.d = dias.d
  left join canj cj on cj.d = dias.d
  order by dias.d;
$$;

-- Vista agregada cross-cliente para el panel FM: por comercio, con su cuenta (LEFT join para no
-- perder comercios sin cuenta_id — bucket "sin cuenta").
create or replace function reporte_fm_comercios()
returns table(
  comercio_id uuid, comercio_nombre text, cuenta_id uuid, cuenta_nombre text,
  clientes bigint, acreditaciones bigint, canjes bigint, saldo_circulante bigint
)
language sql stable
set search_path = public
as $$
  select
    co.id, co.nombre, co.cuenta_id, cu.nombre,
    (select count(*) from tarjetas t where t.comercio_id = co.id)::bigint,
    (select count(*) from transacciones_puntos tp join tarjetas t on t.id = tp.tarjeta_id where t.comercio_id = co.id)::bigint,
    (select count(*) from canjes c join tarjetas t on t.id = c.tarjeta_id where t.comercio_id = co.id)::bigint,
    (select coalesce(sum(t.puntos_actuales), 0) from tarjetas t where t.comercio_id = co.id)::bigint
  from comercios co
  left join cuentas_comercio cu on cu.id = co.cuenta_id
  order by (co.cuenta_id is null), cu.nombre, co.nombre;
$$;

revoke execute on function reporte_sucursales(uuid) from public, anon, authenticated;
revoke execute on function reporte_top_clientes(uuid, integer) from public, anon, authenticated;
revoke execute on function reporte_tendencia(uuid, integer) from public, anon, authenticated;
revoke execute on function reporte_fm_comercios() from public, anon, authenticated;
grant execute on function reporte_sucursales(uuid) to service_role;
grant execute on function reporte_top_clientes(uuid, integer) to service_role;
grant execute on function reporte_tendencia(uuid, integer) to service_role;
grant execute on function reporte_fm_comercios() to service_role;

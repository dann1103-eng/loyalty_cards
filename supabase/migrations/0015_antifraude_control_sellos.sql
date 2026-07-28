-- 0015: antifraude y control de sellos.
--
-- Motivo: un dueño sospecha que un cajero regala sellos y hoy el sistema no permite ni detectarlo
-- ni corregirlo. No hay pantalla de movimientos por cliente, no hay forma de restar (la única resta
-- es canjear una recompensa concreta) y nada acota cuántos sellos recibe un cliente por día.
--
-- Cinco piezas: (a) clasificación del ledger (acreditación vs. ajuste, con motivo y marca de
-- "forzada"), (b) las perillas de control por comercio, (c) la zona horaria que define el corte del
-- día —hasta ahora hardcodeada dentro de reporte_tendencia—, (d) tres RPC nuevos + el existente
-- convertido en wrapper, (e) el historial por tarjeta y el reporte por cajero.
--
-- SEGURIDAD: mismo criterio que 0009/0010 — funciones SECURITY INVOKER (default), se REVOCA execute
-- de public/anon/authenticated y se GRANTea a service_role, para que la anon key (pública, va al
-- bundle del navegador) no pueda invocarlas por REST saltándose el gate de la app.

-- ─────────────────────────────────────────────────────────────────────────────
-- (a) LEDGER
-- ─────────────────────────────────────────────────────────────────────────────
-- `default 'acreditacion'` clasifica TODO el histórico sin backfill: hasta hoy la capa TS prohíbe
-- puntos_delta <= 0 (lib/comercio/acreditar.ts) y la única resta del sistema vive en `canjes`, así
-- que no existe ni una fila que fuera realmente un ajuste. En PG 11+ agregar una columna NOT NULL
-- con default CONSTANTE es una operación de metadato: NO reescribe la tabla (importa — esto corre
-- contra producción con el escáner en uso).
alter table transacciones_puntos
  add column tipo text not null default 'acreditacion'
    check (tipo in ('acreditacion', 'ajuste')),
  add column motivo text,
  add column forzado boolean not null default false;

-- Respaldo de BD para "el motivo es obligatorio". La defensa real, con mensaje en español, sigue
-- siendo la capa TS (CLAUDE.md: la BD casi no respalda la validación de aplicación); esto es el
-- candado de último recurso. NO puede fallar sobre el histórico: toda fila existente queda
-- tipo='acreditacion' y forzado=false, o sea que cae en la primera rama del OR.
alter table transacciones_puntos
  add constraint transacciones_puntos_motivo_obligatorio
    check (
      (tipo <> 'ajuste' and not forzado)
      or (motivo is not null and btrim(motivo) <> '')
    );

-- ─────────────────────────────────────────────────────────────────────────────
-- (b) y (c) PERILLAS DE CONTROL + ZONA HORARIA, por comercio
-- ─────────────────────────────────────────────────────────────────────────────
-- Van en `comercios` (por marca, junto a sello_meta) y no en `cuentas_comercio`: dos marcas de la
-- misma cuenta pueden tener políticas distintas, y el escáner ya lee `comercios` en cada búsqueda,
-- así que el dato sale gratis.
--
-- null = sin límite. Ése es el estado de TODOS los comercios existentes tras esta migración, o sea
-- que el comportamiento no cambia para nadie hasta que el dueño configure algo.
alter table comercios
  add column tope_acreditaciones_dia integer
    check (tope_acreditaciones_dia is null or tope_acreditaciones_dia > 0),
  add column espera_minima_minutos integer
    check (espera_minima_minutos is null or espera_minima_minutos > 0),
  -- Las dos siguientes solo tienen sentido con tipo_tarjeta='puntos' (en sellos el delta siempre
  -- es 1). La UI las oculta para tarjetas de sellos; la BD no lo fuerza porque un comercio puede
  -- cambiar de tipo y no queremos invalidarle la configuración guardada.
  add column techo_puntos_acreditacion integer
    check (techo_puntos_acreditacion is null or techo_puntos_acreditacion > 0),
  add column tope_puntos_dia integer
    check (tope_puntos_dia is null or tope_puntos_dia > 0),
  -- Activa la columna transacciones_puntos.monto_compra, que existe desde 0001 y nunca se escribió.
  -- Opcional porque el escáner es la operación más repetida del sistema y no todo comercio quiere
  -- la fricción; pero con monto, "5 sellos por $2 de compras" es evidencia dura, no sospecha.
  add column pedir_monto_compra boolean not null default false,
  -- CHECK de lista cerrada (mismo criterio que tipo_tarjeta en 0005 y difuminado_franja en 0007)
  -- por una razón dura, no por prolijidad: un nombre de zona inválido hace que `at time zone` lance
  -- 22023 DENTRO de acreditar_atomico, o sea que un typo en un campo de configuración dejaría al
  -- comercio SIN PODER SELLAR. La lista se amplía con drop constraint / add constraint cuando entre
  -- un país nuevo, y la constante espejo lib/comercio/zonasHorarias.ts TIENE que moverse con ella
  -- (mismo acoplamiento que NIVELES_DIFUMINADO / difuminado_franja).
  add column zona_horaria text not null default 'America/El_Salvador'
    check (zona_horaria in (
      'America/El_Salvador', 'America/Guatemala', 'America/Tegucigalpa', 'America/Managua',
      'America/Costa_Rica', 'America/Panama', 'America/Belize', 'America/Mexico_City',
      'America/Bogota', 'America/Lima', 'America/Guayaquil', 'America/Santo_Domingo',
      'America/Caracas', 'America/Santiago', 'America/Asuncion', 'America/Montevideo',
      'America/Argentina/Buenos_Aires', 'America/Sao_Paulo', 'America/New_York',
      'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/Madrid'
    ));

-- Índices. El chequeo del tope filtra por (tarjeta_id, tipo, created_at) y el de la espera pide el
-- created_at máximo de la tarjeta: el compuesto resuelve los dos. Los sueltos de 0010
-- (transacciones_puntos_tarjeta_idx / _created_idx) no cubren el predicado combinado.
create index if not exists transacciones_puntos_tarjeta_fecha_idx
  on transacciones_puntos (tarjeta_id, created_at desc);
-- El reporte por cajero agrupa por cajero_usuario_id dentro de un rango de fechas.
create index if not exists transacciones_puntos_cajero_idx on transacciones_puntos (cajero_usuario_id);
create index if not exists canjes_cajero_idx on canjes (cajero_usuario_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- (d) RPC
-- ─────────────────────────────────────────────────────────────────────────────
-- Recordá la regla de 0009 (líneas 13-19): en `returns table(...)` cada columna de salida es una
-- variable OUT dentro del cuerpo. Por eso las columnas OUT se llaman `saldo`/`costo` y NO
-- `puntos_actuales`/`costo_puntos`, y por eso todas las locales de acá llevan prefijo v_.

-- acreditar_atomico — LA implementación real del camino normal. Reemplaza en la práctica a
-- acreditar_puntos_atomico, que abajo queda como wrapper delegante de una línea.
--
-- ¿Por qué una función NUEVA en vez de agregarle p_monto_compra a la vieja? Porque CREATE OR
-- REPLACE FUNCTION no puede cambiar la lista de argumentos: agregar un parámetro crea una función
-- *nueva* que convive con la anterior y vuelve AMBIGUA (42725) toda llamada con 5 argumentos
-- nombrados. Manteniendo la vieja con su firma exacta, esta migración se puede aplicar tranquila
-- ANTES del deploy: el código viejo sigue llamando 5 args y se comporta bit a bit igual que hoy
-- (todas las perillas nacen en null). Cuando el deploy esté hecho, una migración posterior de una
-- línea borra el wrapper (patrón expand → migrate → contract).
create or replace function acreditar_atomico(
  p_comercio_id uuid, p_tarjeta_id uuid, p_delta integer,
  p_sucursal_id uuid, p_cajero_usuario_id uuid, p_monto_compra numeric
) returns table(estado text, saldo integer)
language plpgsql
set search_path = public
as $$
declare
  v_saldo integer;
  v_tope_acred integer;
  v_espera integer;
  v_techo integer;
  v_tope_puntos integer;
  v_zona text;
  v_inicio_dia timestamptz;
  v_conteo integer;
  v_puntos_hoy integer;
  v_ultima timestamptz;
begin
  -- El chequeo de sucursal va PRIMERO, igual que en 0009. No es cosmético: es lo que hace que el
  -- wrapper acreditar_puntos_atomico se comporte exactamente igual que antes en el caso borde
  -- "comercio inexistente Y sucursal inválida" (antes 'sucursal_invalida'; si el orden se invierte,
  -- pasaría a 'tarjeta_no_encontrada'). Ese caso no se da hoy —el comercioId sale del gate— pero
  -- el valor de este wrapper es justamente ser indistinguible del original.
  if p_sucursal_id is not null and not exists (
    select 1 from sucursales where id = p_sucursal_id and comercio_id = p_comercio_id and activa
  ) then
    return query select 'sucursal_invalida'::text, null::integer; return;
  end if;

  select c.tope_acreditaciones_dia, c.espera_minima_minutos, c.techo_puntos_acreditacion,
         c.tope_puntos_dia, c.zona_horaria
    into v_tope_acred, v_espera, v_techo, v_tope_puntos, v_zona
    from comercios c where c.id = p_comercio_id;
  if not found then
    -- Sin comercio no puede haber tarjeta de ese comercio: mismo mensaje, no se filtra cuál falta.
    return query select 'tarjeta_no_encontrada'::text, null::integer; return;
  end if;
  v_zona := coalesce(v_zona, 'America/El_Salvador');

  -- ══ CANDADO DE CONCURRENCIA ══
  -- Toma EL MISMO lock de fila que ya tomaba el `update` de más abajo, pero ANTES de los chequeos
  -- de límite y SIN mutar nada (así un rechazo posterior no deja el saldo tocado). Es lo único que
  -- hace confiable el count(*) sobre transacciones_puntos: en READ COMMITTED un count no toma
  -- ningún lock y no existe predicate locking (eso es SERIALIZABLE), así que dos escaneos
  -- simultáneos con tope 5 y 4 filas leerían los dos "4 de 5", pasarían los dos, y quedarían 6.
  -- Con el lock, el segundo BLOQUEA acá; cuando el primero commitea, el segundo sigue y su
  -- SIGUIENTE sentencia (el count) toma un snapshot NUEVO —READ COMMITTED da snapshot por
  -- sentencia— que ya incluye la fila del primero.
  --
  -- Tampoco sirve meter el count en el WHERE del UPDATE: la re-evaluación EPQ sustituye únicamente
  -- la FILA BLOQUEADA, y el resto del qual se sigue evaluando contra el snapshot original — el
  -- subselect seguiría contando 4. Ese truco funciona para canjear/ajustar (`puntos_actuales >=
  -- costo` es sobre la propia fila) y NO acá.
  --
  -- `for no key update`, NO `for update`: es exactamente la fuerza que ya toma un UPDATE de una
  -- columna no-clave, o sea que el footprint de bloqueo del sistema queda IDÉNTICO al de 0009 y
  -- solo se adelanta el momento. Excluye a otro acreditar/ajustar/canjear sobre la misma tarjeta,
  -- pero no choca con el `for key share` que toman los inserts de las tablas hijas (canjes,
  -- apple_push_registrations).
  --
  -- El WHERE solo referencia columnas INMUTABLES (id, comercio_id): si otra transacción actualizó
  -- la fila, el re-chequeo EPQ vuelve a pasar. Con una columna mutable acá, la fila desaparecería
  -- en silencio bajo concurrencia.
  --
  -- INVARIANTE A SOSTENER A MANO: el count solo es confiable porque TODOS los escritores de
  -- transacciones_puntos pasan por este lock. Cualquier camino futuro que inserte en esa tabla
  -- (un import, un script de corrección, una API) tiene que tomarlo primero o rompe la garantía.
  select puntos_actuales into v_saldo
    from tarjetas
    where id = p_tarjeta_id and comercio_id = p_comercio_id
    for no key update;
  if not found then
    return query select 'tarjeta_no_encontrada'::text, null::integer; return;
  end if;

  -- 1. Techo por transacción. Va primero porque es sobre ESTA acreditación y no necesita consulta.
  if v_techo is not null and p_delta > v_techo then
    return query select 'techo_puntos_excedido'::text, v_saldo; return;
  end if;

  -- 2 y 3. Topes del día. El count y el sum salen de LA MISMA consulta.
  --
  -- Las FORZADAS SÍ cuentan: siguen siendo sellos que el cliente recibió, así que cada una
  -- siguiente vuelve a exigir la autorización del dueño. Los AJUSTES NO cuentan (tipo =
  -- 'acreditacion'): una corrección no libera cupo, o el fraude se autolimpiaría el camino.
  if v_tope_acred is not null or v_tope_puntos is not null then
    -- Medianoche LOCAL del comercio expresada como instante. Se calcula una vez y se compara con
    -- >=, así el predicado es sargable contra transacciones_puntos_tarjeta_fecha_idx; la forma
    -- `(created_at at time zone z)::date = ...` no puede usar el índice.
    v_inicio_dia := date_trunc('day', now() at time zone v_zona) at time zone v_zona;

    select count(*), coalesce(sum(tp.puntos_delta), 0)
      into v_conteo, v_puntos_hoy
      from transacciones_puntos tp
      where tp.tarjeta_id = p_tarjeta_id
        and tp.tipo = 'acreditacion'
        and tp.created_at >= v_inicio_dia;

    -- El tope de acreditaciones va antes que el de puntos y que la espera a propósito: si varios
    -- se cumplen, "ya no puede recibir más hoy" es accionable y "esperá 5 minutos" sería mentira
    -- (esperar no destraba nada).
    if v_tope_acred is not null and v_conteo >= v_tope_acred then
      return query select 'limite_diario_alcanzado'::text, v_saldo; return;
    end if;

    if v_tope_puntos is not null and v_puntos_hoy + p_delta > v_tope_puntos then
      return query select 'tope_puntos_dia_alcanzado'::text, v_saldo; return;
    end if;
  end if;

  -- 4. Espera mínima entre acreditaciones al mismo cliente. Es la perilla que realmente ataja el
  -- caso "el cajero le puso 5 seguidos": un tope diario de 2 no impide ponerlos en 10 segundos.
  if v_espera is not null then
    select max(tp.created_at) into v_ultima
      from transacciones_puntos tp
      where tp.tarjeta_id = p_tarjeta_id and tp.tipo = 'acreditacion';
    -- now() dentro de una transacción es transaction_timestamp() — el MISMO reloj que estampa
    -- created_at por default, así que la comparación es consistente consigo misma.
    if v_ultima is not null and v_ultima > now() - make_interval(mins => v_espera) then
      return query select 'espera_minima_no_cumplida'::text, v_saldo; return;
    end if;
  end if;

  update tarjetas set puntos_actuales = puntos_actuales + p_delta
    where id = p_tarjeta_id and comercio_id = p_comercio_id
    returning puntos_actuales into v_saldo;

  insert into transacciones_puntos
    (tarjeta_id, puntos_delta, sucursal_id, cajero_usuario_id, tipo, monto_compra)
    values (p_tarjeta_id, p_delta, p_sucursal_id, p_cajero_usuario_id, 'acreditacion', p_monto_compra);

  return query select 'ok'::text, v_saldo;
end $$;

-- Wrapper de compatibilidad: MISMA firma y MISMO tipo de retorno que 0009, para que el código ya
-- desplegado siga funcionando mientras se aplica esta migración. Cero duplicación de la lógica de
-- límites. Se borra en una migración posterior, una vez que el deploy nuevo esté en producción.
create or replace function acreditar_puntos_atomico(
  p_comercio_id uuid, p_tarjeta_id uuid, p_delta integer,
  p_sucursal_id uuid, p_cajero_usuario_id uuid
) returns table(estado text, saldo integer)
language plpgsql
set search_path = public
as $$
begin
  return query select * from acreditar_atomico(
    p_comercio_id, p_tarjeta_id, p_delta, p_sucursal_id, p_cajero_usuario_id, null::numeric
  );
end $$;

-- acreditar_forzado_atomico — el camino del DUEÑO cuando un límite bloqueó al cajero.
--
-- Es una función APARTE y no un flag de la anterior, por dos razones:
--   1. Técnica: la misma de arriba — cambiar la lista de args crea overloads ambiguos.
--   2. De seguridad: la regla "solo el dueño puede forzar" queda con DOS candados independientes —
--      el chequeo de rol en la Server Action Y el hecho de que acreditar_atomico es FÍSICAMENTE
--      incapaz de escribir forzado=true. Un bug en el camino del cajero no puede forzar aunque
--      quiera.
--
-- NO toma el lock explícito: no hay ninguna decisión que dependa de leer transacciones_puntos, y
-- el `update ... returning` ya es atómico por sí solo.
create or replace function acreditar_forzado_atomico(
  p_comercio_id uuid, p_tarjeta_id uuid, p_delta integer,
  p_sucursal_id uuid, p_cajero_usuario_id uuid, p_monto_compra numeric, p_motivo text
) returns table(estado text, saldo integer)
language plpgsql
set search_path = public
as $$
declare v_saldo integer; v_motivo text;
begin
  v_motivo := btrim(coalesce(p_motivo, ''));
  if v_motivo = '' then
    return query select 'motivo_requerido'::text, null::integer; return;
  end if;

  if p_sucursal_id is not null and not exists (
    select 1 from sucursales where id = p_sucursal_id and comercio_id = p_comercio_id and activa
  ) then
    return query select 'sucursal_invalida'::text, null::integer; return;
  end if;

  update tarjetas set puntos_actuales = puntos_actuales + p_delta
    where id = p_tarjeta_id and comercio_id = p_comercio_id
    returning puntos_actuales into v_saldo;
  if not found then
    return query select 'tarjeta_no_encontrada'::text, null::integer; return;
  end if;

  insert into transacciones_puntos
    (tarjeta_id, puntos_delta, sucursal_id, cajero_usuario_id, tipo, motivo, forzado, monto_compra)
    values (p_tarjeta_id, p_delta, p_sucursal_id, p_cajero_usuario_id,
            'acreditacion', v_motivo, true, p_monto_compra);

  return query select 'ok'::text, v_saldo;
end $$;

-- ajustar_puntos_atomico — corrección manual del saldo con motivo obligatorio.
--
-- Acepta delta positivo o negativo y NO valida el signo: la política ("solo restar" vs. "también
-- corregir hacia arriba") vive en la capa TS, que es donde este proyecto pone la validación
-- (CLAUDE.md). Cambiar de idea después es una línea de TS y ninguna migración.
--
-- NO toma el lock explícito, a diferencia de acreditar_atomico: acá la decisión (que el saldo no
-- quede negativo) se expresa sobre la PROPIA fila que se actualiza, así que va dentro del WHERE del
-- update —mismo patrón que canjear_recompensa_atomico en 0009—. Bajo READ COMMITTED el segundo
-- update bloquea, re-lee la versión nueva y re-evalúa el where (EPQ): dos ajustes de -3 concurrentes
-- sobre un saldo de 5 no pueden dejarlo en -1.
create or replace function ajustar_puntos_atomico(
  p_comercio_id uuid, p_tarjeta_id uuid, p_delta integer,
  p_sucursal_id uuid, p_cajero_usuario_id uuid, p_motivo text
) returns table(estado text, saldo integer)
language plpgsql
set search_path = public
as $$
declare v_saldo integer; v_motivo text;
begin
  v_motivo := btrim(coalesce(p_motivo, ''));
  if v_motivo = '' then
    return query select 'motivo_requerido'::text, null::integer; return;
  end if;
  if p_delta is null or p_delta = 0 then
    return query select 'delta_invalido'::text, null::integer; return;
  end if;

  if p_sucursal_id is not null and not exists (
    select 1 from sucursales where id = p_sucursal_id and comercio_id = p_comercio_id and activa
  ) then
    return query select 'sucursal_invalida'::text, null::integer; return;
  end if;

  update tarjetas set puntos_actuales = puntos_actuales + p_delta
    where id = p_tarjeta_id and comercio_id = p_comercio_id
      and puntos_actuales + p_delta >= 0
    returning puntos_actuales into v_saldo;
  if not found then
    select puntos_actuales into v_saldo from tarjetas
      where id = p_tarjeta_id and comercio_id = p_comercio_id;
    if not found then
      return query select 'tarjeta_no_encontrada'::text, null::integer; return;
    end if;
    return query select 'saldo_insuficiente'::text, v_saldo; return;
  end if;

  insert into transacciones_puntos
    (tarjeta_id, puntos_delta, sucursal_id, cajero_usuario_id, tipo, motivo)
    values (p_tarjeta_id, p_delta, p_sucursal_id, p_cajero_usuario_id, 'ajuste', v_motivo);

  return query select 'ok'::text, v_saldo;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (e) HISTORIAL Y REPORTE POR CAJERO
-- ─────────────────────────────────────────────────────────────────────────────
-- historial_tarjeta — los movimientos de UNA tarjeta, unificando las dos tablas del ledger.
--
-- No hace falta tabla nueva: transacciones_puntos y canjes ya tienen todo (tarjeta, cajero,
-- sucursal, hora, delta). Además el LEFT JOIN a recompensas recupera el nombre del premio aunque
-- el dueño lo haya dado de baja después (recompensas usa soft-delete) — una tabla nueva tendría
-- que congelar ese texto.
--
-- OJO con los alias: en `language sql`, si una columna OUT se llama igual que una columna del
-- cuerpo, LA COLUMNA GANA EN SILENCIO (a diferencia de plpgsql, donde variable_conflict=error lo
-- hace explotar). Por eso las OUT son ocurrio_en / motivo_texto / fue_forzado / monto y no
-- created_at / motivo / forzado / monto_compra. Es la variante callada de la advertencia de 0009.
create or replace function historial_tarjeta(
  p_comercio_id uuid, p_tarjeta_id uuid, p_limite integer, p_desde timestamptz
) returns table(
  movimiento_id uuid, ocurrio_en timestamptz, clase text, delta integer, saldo_resultante integer,
  sucursal_nombre text, cajero_email text, motivo_texto text, fue_forzado boolean,
  monto numeric, recompensa_nombre text
)
language sql stable
set search_path = public
as $$
  with movs as (
    select tp.id as mid, tp.created_at as ts, tp.tipo as cl, tp.puntos_delta as dl,
           tp.sucursal_id as sid, tp.cajero_usuario_id as uid, tp.motivo as mot,
           tp.forzado as forz, tp.monto_compra as mnt, null::uuid as rid
    from transacciones_puntos tp
    join tarjetas t on t.id = tp.tarjeta_id
    where tp.tarjeta_id = p_tarjeta_id and t.comercio_id = p_comercio_id
    union all
    select c.id, c.created_at, 'canje'::text, -c.puntos_gastados,
           c.sucursal_id, c.cajero_usuario_id, null::text, false, null::numeric, c.recompensa_id
    from canjes c
    join tarjetas t on t.id = c.tarjeta_id
    where c.tarjeta_id = p_tarjeta_id and t.comercio_id = p_comercio_id
  ),
  -- La ventana corre sobre TODOS los movimientos de la tarjeta. Meter el filtro p_desde acá dentro
  -- es el error natural y arruinaría el saldo de TODAS las filas, no solo el de las recortadas: el
  -- saldo resultante de un movimiento es la suma de todo lo anterior, exista o no en la ventana.
  -- El filtro va DESPUÉS, en el select final.
  corrido as (
    select movs.*,
           sum(movs.dl) over (
             order by movs.ts, movs.mid
             rows between unbounded preceding and current row
           ) as saldo_corrido
    from movs
  )
  select co.mid, co.ts, co.cl, co.dl, co.saldo_corrido::integer,
         s.nombre, u.email, co.mot, co.forz, co.mnt, r.nombre
  from corrido co
  left join sucursales s on s.id = co.sid
  left join usuarios_comercio u on u.id = co.uid
  left join recompensas r on r.id = co.rid
  where p_desde is null or co.ts >= p_desde
  order by co.ts desc, co.mid desc
  limit greatest(coalesce(p_limite, 500), 1);
$$;

-- reporte_cajeros — el reporte que realmente detecta la anomalía: quién otorga cuánto.
-- Incluye el bucket cajero_usuario_id IS NULL (actividad previa a la atribución de Fase 8), igual
-- que reporte_sucursales incluye el bucket sin sucursal.
--
-- El rango se interpreta en la ZONA DEL COMERCIO, no en UTC: p_hasta es inclusivo, de ahí el +1
-- día en el borde superior (sin eso se pierde el último día completo del rango).
create or replace function reporte_cajeros(p_comercio_id uuid, p_desde date, p_hasta date)
returns table(
  cajero_usuario_id uuid, cajero_email text, cajero_activo boolean,
  acreditaciones bigint, puntos_otorgados bigint, monto_total numeric,
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
           count(*) filter (where tp.tipo = 'acreditacion')::bigint as n_acred,
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
    coalesce(a.n_acred, 0)::bigint,
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

-- ─────────────────────────────────────────────────────────────────────────────
-- LAS CUATRO FUNCIONES DE REPORTE DE 0010, CON EL FILTRO tipo = 'acreditacion'
-- ─────────────────────────────────────────────────────────────────────────────
-- Ahora que transacciones_puntos también guarda ajustes (deltas negativos), estas cuatro contarían
-- una CORRECCIÓN como una visita/acreditación. Se les agrega el filtro y nada más: misma firma,
-- mismas columnas, mismo orden — el snapshot antes/después de la migración tiene que dar diff
-- VACÍO, porque toda fila del histórico es tipo='acreditacion'.
--
-- Consecuencia aceptada conscientemente: puntos_otorgados queda BRUTO, no neto. Si un cajero da 10
-- y alguien quita 10, el reporte de sucursal sigue diciendo 10 otorgados. Es lo correcto —así el
-- fraude no se autoborra del reporte—; la corrección aparece en reporte_cajeros y el neto real ya
-- está en reporte_fm_comercios.saldo_circulante.

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
    where t.comercio_id = p_comercio_id and tp.tipo = 'acreditacion'
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
  where t.comercio_id = p_comercio_id and tp.tipo = 'acreditacion'
  group by cl.id, cl.nombre
  order by visitas desc, puntos_totales desc
  limit greatest(coalesce(p_limite, 10), 0);
$$;

create or replace function reporte_tendencia(p_comercio_id uuid, p_dias integer)
returns table(dia date, acreditaciones bigint, canjes bigint)
language sql stable
set search_path = public
as $$
  with zona as (
    -- Antes era el literal 'America/El_Salvador'. Ahora sale de comercios.zona_horaria, que nace
    -- con ese mismo valor por default: para todo comercio existente el resultado es idéntico.
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
    where t.comercio_id = p_comercio_id and tp.tipo = 'acreditacion'
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
    (select count(*) from transacciones_puntos tp join tarjetas t on t.id = tp.tarjeta_id where t.comercio_id = co.id and tp.tipo = 'acreditacion')::bigint,
    (select count(*) from canjes c join tarjetas t on t.id = c.tarjeta_id where t.comercio_id = co.id)::bigint,
    (select coalesce(sum(t.puntos_actuales), 0) from tarjetas t where t.comercio_id = co.id)::bigint
  from comercios co
  left join cuentas_comercio cu on cu.id = co.cuenta_id
  order by (co.cuenta_id is null), cu.nombre, co.nombre;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PERMISOS — mismo criterio que 0009/0010 para TODA función nueva.
-- ─────────────────────────────────────────────────────────────────────────────
revoke execute on function acreditar_atomico(uuid, uuid, integer, uuid, uuid, numeric) from public, anon, authenticated;
revoke execute on function acreditar_forzado_atomico(uuid, uuid, integer, uuid, uuid, numeric, text) from public, anon, authenticated;
revoke execute on function ajustar_puntos_atomico(uuid, uuid, integer, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function historial_tarjeta(uuid, uuid, integer, timestamptz) from public, anon, authenticated;
revoke execute on function reporte_cajeros(uuid, date, date) from public, anon, authenticated;

grant execute on function acreditar_atomico(uuid, uuid, integer, uuid, uuid, numeric) to service_role;
grant execute on function acreditar_forzado_atomico(uuid, uuid, integer, uuid, uuid, numeric, text) to service_role;
grant execute on function ajustar_puntos_atomico(uuid, uuid, integer, uuid, uuid, text) to service_role;
grant execute on function historial_tarjeta(uuid, uuid, integer, timestamptz) to service_role;
grant execute on function reporte_cajeros(uuid, date, date) to service_role;

-- Las funciones REEMPLAZADAS (acreditar_puntos_atomico y las 4 de reporte) conservan los permisos
-- que ya tenían: CREATE OR REPLACE no reinicia el ACL de una función existente. No hace falta
-- repetir su revoke/grant, y repetirlo sería inofensivo pero ruidoso.

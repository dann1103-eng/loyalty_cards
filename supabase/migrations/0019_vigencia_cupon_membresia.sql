-- 0019: cupón y membresía — el grupo de VIGENCIA de los tipos de tarjeta.
--
-- Son los dos tipos cuyo estado NO es un número sino una fecha, así que no pasan por
-- acreditar_atomico ni por ajustar_puntos_atomico. Necesitan su propia operación.

-- ─────────────────────────────────────────────────────────────────────────────
-- El ledger aprende dos movimientos más
-- ─────────────────────────────────────────────────────────────────────────────
-- Usar un cupón y renovar una membresía tienen que aparecer en el historial del cliente igual que
-- un sello: si no, la pantalla forense de la Tanda 1 tendría un agujero justo en los tipos donde
-- cada movimiento vale dinero.
--
-- Se AMPLÍA el CHECK en vez de reemplazarlo: los dos valores viejos siguen siendo válidos y ninguna
-- fila existente se toca.
alter table transacciones_puntos drop constraint if exists transacciones_puntos_tipo_check;
alter table transacciones_puntos
  add constraint transacciones_puntos_tipo_check
    check (tipo in ('acreditacion', 'ajuste', 'uso', 'renovacion'));

-- IMPORTANTE — lo que esto NO cambia: las cuatro funciones de reporte de la 0015 filtran
-- `tipo = 'acreditacion'`, así que un uso de cupón o una renovación NO cuentan como acreditación ni
-- como visita en los reportes. Es deliberado: esos reportes miden cuántos sellos/puntos se
-- otorgaron, y mezclarles otra unidad haría el número incomparable. El historial por cliente sí los
-- muestra, que es donde importan.

-- ─────────────────────────────────────────────────────────────────────────────
-- Usar un cupón
-- ─────────────────────────────────────────────────────────────────────────────
-- Un cupón se usa UNA vez. La garantía vive en el `where usado_en is null` del propio UPDATE, no en
-- un `if` previo: bajo READ COMMITTED el segundo update bloquea, re-lee la versión nueva y
-- re-evalúa el where (EPQ), así que dos cajeros escaneando el mismo cupón a la vez no pueden
-- usarlo dos veces. Es el MISMO patrón que canjear_recompensa_atomico (0009) y por la misma razón:
-- la condición se expresa sobre la propia fila que se actualiza.
create or replace function usar_cupon_atomico(
  p_comercio_id uuid, p_tarjeta_id uuid,
  p_sucursal_id uuid, p_cajero_usuario_id uuid
) returns table(estado text, vencia date)
language plpgsql
set search_path = public
as $$
declare v_vigencia date; v_usado timestamptz; v_zona text;
begin
  if p_sucursal_id is not null and not exists (
    select 1 from sucursales where id = p_sucursal_id and comercio_id = p_comercio_id and activa
  ) then
    return query select 'sucursal_invalida'::text, null::date; return;
  end if;

  select zona_horaria into v_zona from comercios where id = p_comercio_id;
  v_zona := coalesce(v_zona, 'America/El_Salvador');

  -- "Vence el 30" significa el 30 COMPLETO en el local. Se compara contra la fecha local del
  -- comercio, no contra current_date del servidor: en UTC el cupón moriría a las 6 de la tarde del
  -- día anterior para un comercio salvadoreño.
  update tarjetas set usado_en = now()
    where id = p_tarjeta_id and comercio_id = p_comercio_id
      and usado_en is null
      and (vigencia_hasta is null or vigencia_hasta >= (now() at time zone v_zona)::date)
    returning vigencia_hasta into v_vigencia;

  if not found then
    -- No se pudo: hay que decir POR QUÉ, o el cajero no sabe si insistir o cobrar de más.
    select vigencia_hasta, usado_en into v_vigencia, v_usado
      from tarjetas where id = p_tarjeta_id and comercio_id = p_comercio_id;
    if not found then
      return query select 'tarjeta_no_encontrada'::text, null::date; return;
    end if;
    if v_usado is not null then
      return query select 'cupon_ya_usado'::text, v_vigencia; return;
    end if;
    return query select 'cupon_vencido'::text, v_vigencia; return;
  end if;

  insert into transacciones_puntos
    (tarjeta_id, puntos_delta, sucursal_id, cajero_usuario_id, tipo)
    values (p_tarjeta_id, 0, p_sucursal_id, p_cajero_usuario_id, 'uso');

  return query select 'ok'::text, v_vigencia;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Renovar una membresía
-- ─────────────────────────────────────────────────────────────────────────────
-- La fecha nueva se calcula DENTRO del UPDATE, no leyendo y después escribiendo: dos cajeros
-- renovando la misma membresía a la vez leerían la misma fecha base y las dos escribirían el mismo
-- resultado — el cliente pagó dos períodos y recibió uno. Con la expresión adentro del update, la
-- segunda transacción re-lee la fila ya actualizada y suma sobre ella.
--
-- `greatest(vigencia_hasta, hoy)` es lo que hace que renovar ANTES de vencer no regale días ni los
-- quite: si todavía le quedaban 5 días, la renovación arranca desde su vencimiento; si ya venció,
-- arranca desde hoy.
create or replace function renovar_membresia_atomico(
  p_comercio_id uuid, p_tarjeta_id uuid,
  p_sucursal_id uuid, p_cajero_usuario_id uuid
) returns table(estado text, vence date)
language plpgsql
set search_path = public
as $$
declare v_dias integer; v_zona text; v_hoy date; v_vence date;
begin
  if p_sucursal_id is not null and not exists (
    select 1 from sucursales where id = p_sucursal_id and comercio_id = p_comercio_id and activa
  ) then
    return query select 'sucursal_invalida'::text, null::date; return;
  end if;

  select membresia_dias, coalesce(zona_horaria, 'America/El_Salvador')
    into v_dias, v_zona
    from comercios where id = p_comercio_id;
  if not found then
    return query select 'tarjeta_no_encontrada'::text, null::date; return;
  end if;
  if v_dias is null or v_dias <= 0 then
    -- Sin duración configurada no hay renovación posible, y decirlo explícito evita que el cajero
    -- cobre y después descubra que la tarjeta no se movió.
    return query select 'membresia_sin_configurar'::text, null::date; return;
  end if;

  v_hoy := (now() at time zone v_zona)::date;

  update tarjetas
    set vigencia_hasta = greatest(coalesce(vigencia_hasta, v_hoy), v_hoy) + v_dias
    where id = p_tarjeta_id and comercio_id = p_comercio_id
    returning vigencia_hasta into v_vence;
  if not found then
    return query select 'tarjeta_no_encontrada'::text, null::date; return;
  end if;

  insert into transacciones_puntos
    (tarjeta_id, puntos_delta, sucursal_id, cajero_usuario_id, tipo)
    values (p_tarjeta_id, 0, p_sucursal_id, p_cajero_usuario_id, 'renovacion');

  return query select 'ok'::text, v_vence;
end $$;

-- Mismo criterio de permisos que 0009/0010/0015: la anon key del bundle público no puede invocarlas.
revoke execute on function usar_cupon_atomico(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function renovar_membresia_atomico(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function usar_cupon_atomico(uuid, uuid, uuid, uuid) to service_role;
grant execute on function renovar_membresia_atomico(uuid, uuid, uuid, uuid) to service_role;

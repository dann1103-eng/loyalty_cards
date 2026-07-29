-- 0023: descuento por nivel — registrar una compra.
--
-- Es el único tipo cuyo movimiento NO cambia un saldo: lo que hace una compra es sumar al GASTO
-- HISTÓRICO (`tarjetas.acumulado_centavos`, migración 0018), y de ese acumulado sale el nivel de
-- descuento que le corresponde al cliente. El nivel se calcula al leer, nunca se guarda: si se
-- guardara, cambiar los umbrales dejaría a los clientes viejos con el nivel viejo para siempre.
--
-- Por qué no sirve acreditar_atomico: esa función suma a puntos_actuales, que en este tipo no se
-- usa. Y no puede llamarse con delta 0 — la capa TS lo rechaza, con razón: una acreditación de cero
-- en cualquier otro tipo es un error.

create or replace function registrar_compra_atomico(
  p_comercio_id uuid, p_tarjeta_id uuid, p_monto_centavos bigint,
  p_sucursal_id uuid, p_cajero_usuario_id uuid
) returns table(estado text, acumulado bigint)
language plpgsql
set search_path = public
as $$
declare v_acumulado bigint;
begin
  if p_monto_centavos is null or p_monto_centavos <= 0 then
    return query select 'monto_invalido'::text, null::bigint; return;
  end if;

  if p_sucursal_id is not null and not exists (
    select 1 from sucursales where id = p_sucursal_id and comercio_id = p_comercio_id and activa
  ) then
    return query select 'sucursal_invalida'::text, null::bigint; return;
  end if;

  -- La suma va DENTRO del update, no leyendo y después escribiendo: dos cajeros registrando compras
  -- del mismo cliente a la vez leerían el mismo acumulado y una de las dos compras se perdería —
  -- el cliente no llegaría al nivel que ya se ganó. Es el mismo motivo por el que renovar una
  -- membresía calcula la fecha adentro (0019).
  update tarjetas set acumulado_centavos = acumulado_centavos + p_monto_centavos
    where id = p_tarjeta_id and comercio_id = p_comercio_id
    returning acumulado_centavos into v_acumulado;
  if not found then
    return query select 'tarjeta_no_encontrada'::text, null::bigint; return;
  end if;

  -- delta 0 con monto_compra puesto: la compra SÍ es una visita y debe contar como tal en los
  -- reportes (que filtran tipo='acreditacion'), pero no otorgó puntos ni sellos. El monto es el
  -- dato real del movimiento.
  insert into transacciones_puntos
    (tarjeta_id, puntos_delta, sucursal_id, cajero_usuario_id, tipo, monto_compra)
    values (p_tarjeta_id, 0, p_sucursal_id, p_cajero_usuario_id, 'acreditacion', p_monto_centavos / 100.0);

  return query select 'ok'::text, v_acumulado;
end $$;

revoke execute on function registrar_compra_atomico(uuid, uuid, bigint, uuid, uuid) from public, anon, authenticated;
grant execute on function registrar_compra_atomico(uuid, uuid, bigint, uuid, uuid) to service_role;

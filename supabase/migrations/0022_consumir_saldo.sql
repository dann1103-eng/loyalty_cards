-- 0022: gastar saldo — gift card y cashback.
--
-- Una sola función nueva, y eso es una buena señal del diseño:
--   - CARGAR una gift card y ACREDITAR cashback son sumar al contador, así que reusan
--     acreditar_atomico (0015). Heredan gratis la atribución de sucursal y cajero, el historial, y
--     los cuatro límites antifraude — incluido `techo_puntos_acreditacion`, que para un tipo de
--     dinero se interpreta EN CENTAVOS y es el techo por carga que hace falta para que un cajero no
--     pueda regalar una gift card de $500.
--   - GASTAR no lo cubría ninguna: ajustar_puntos_atomico exige motivo y marca la fila como
--     'ajuste', y eso haría que el reporte por cajero contara cada compra normal como una
--     corrección — justo la columna que sirve para detectar algo raro.
--
-- Recordatorio de la 0018: en gift_card y cashback, `tarjetas.puntos_actuales` son CENTAVOS. Esta
-- función no lo sabe ni le importa: resta enteros. Quien la llama es el responsable de haber
-- convertido bien, y de eso se encarga lib/tarjetas/tipos.ts.

create or replace function consumir_saldo_atomico(
  p_comercio_id uuid, p_tarjeta_id uuid, p_monto integer,
  p_sucursal_id uuid, p_cajero_usuario_id uuid
) returns table(estado text, saldo integer)
language plpgsql
set search_path = public
as $$
declare v_saldo integer;
begin
  -- Un monto no positivo acá sería una "compra" que REGALA saldo. La capa TS ya lo valida, pero
  -- este es dinero del cliente: el candado va en los dos lados.
  if p_monto is null or p_monto <= 0 then
    return query select 'monto_invalido'::text, null::integer; return;
  end if;

  if p_sucursal_id is not null and not exists (
    select 1 from sucursales where id = p_sucursal_id and comercio_id = p_comercio_id and activa
  ) then
    return query select 'sucursal_invalida'::text, null::integer; return;
  end if;

  -- El guard de saldo suficiente va DENTRO del where del update, igual que en
  -- canjear_recompensa_atomico (0009) y usar_visita_atomico (0020). Bajo READ COMMITTED el segundo
  -- update bloquea, re-lee la versión nueva y re-evalúa el where (EPQ), así que dos cajeros
  -- cobrando de la misma gift card al mismo instante no pueden dejarla en negativo. Un `if` previo
  -- con un select SÍ lo permitiría — y acá eso es plata que el comercio entrega sin respaldo.
  update tarjetas set puntos_actuales = puntos_actuales - p_monto
    where id = p_tarjeta_id and comercio_id = p_comercio_id
      and puntos_actuales >= p_monto
    returning puntos_actuales into v_saldo;

  if not found then
    select puntos_actuales into v_saldo from tarjetas
      where id = p_tarjeta_id and comercio_id = p_comercio_id;
    if not found then
      return query select 'tarjeta_no_encontrada'::text, null::integer; return;
    end if;
    -- Se devuelve el saldo REAL para que el cajero pueda decirle al cliente cuánto tiene y cobrar
    -- la diferencia, en vez de un error genérico que parece una falla del sistema.
    return query select 'saldo_insuficiente'::text, v_saldo; return;
  end if;

  insert into transacciones_puntos
    (tarjeta_id, puntos_delta, sucursal_id, cajero_usuario_id, tipo)
    values (p_tarjeta_id, -p_monto, p_sucursal_id, p_cajero_usuario_id, 'uso');

  return query select 'ok'::text, v_saldo;
end $$;

revoke execute on function consumir_saldo_atomico(uuid, uuid, integer, uuid, uuid) from public, anon, authenticated;
grant execute on function consumir_saldo_atomico(uuid, uuid, integer, uuid, uuid) to service_role;

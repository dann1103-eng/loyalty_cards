-- 0020: multipass — consumir una visita.
--
-- El paquete se VENDE reusando acreditar_atomico (0015): sumar N al contador ya está resuelto,
-- auditado y con los cuatro límites antifraude aplicándose. No hace falta una función nueva para
-- eso, y duplicarla sería duplicar también sus reglas.
--
-- Lo que sí hace falta es CONSUMIR una visita, y no sirve ninguna de las que existen:
--   - ajustar_puntos_atomico exige motivo y marca la fila como 'ajuste'. Usar una visita no es una
--     corrección: mezclarlas haría que el reporte por cajero contara cada visita del negocio como
--     un ajuste, que es justo la columna que sirve para detectar algo raro.
--   - canjear_recompensa_atomico está atada a una recompensa con su costo en puntos.

create or replace function usar_visita_atomico(
  p_comercio_id uuid, p_tarjeta_id uuid,
  p_sucursal_id uuid, p_cajero_usuario_id uuid
) returns table(estado text, saldo integer)
language plpgsql
set search_path = public
as $$
declare v_saldo integer;
begin
  if p_sucursal_id is not null and not exists (
    select 1 from sucursales where id = p_sucursal_id and comercio_id = p_comercio_id and activa
  ) then
    return query select 'sucursal_invalida'::text, null::integer; return;
  end if;

  -- El guard de "queda al menos una" va DENTRO del where del update, igual que el saldo suficiente
  -- de canjear_recompensa_atomico (0009). Bajo READ COMMITTED el segundo update bloquea, re-lee la
  -- versión nueva y re-evalúa el where, así que dos cajeros marcando la última visita a la vez no
  -- pueden dejarla en -1. Un `if` previo con un select SÍ lo permitiría.
  update tarjetas set puntos_actuales = puntos_actuales - 1
    where id = p_tarjeta_id and comercio_id = p_comercio_id
      and puntos_actuales >= 1
    returning puntos_actuales into v_saldo;

  if not found then
    select puntos_actuales into v_saldo from tarjetas
      where id = p_tarjeta_id and comercio_id = p_comercio_id;
    if not found then
      return query select 'tarjeta_no_encontrada'::text, null::integer; return;
    end if;
    -- Se devuelve el saldo real (0) para que el cajero pueda decirle al cliente que se le acabaron
    -- las visitas, en vez de un error genérico que parece una falla del sistema.
    return query select 'sin_visitas'::text, v_saldo; return;
  end if;

  -- tipo='uso', el mismo movimiento que un cupón: no es una acreditación ni una corrección, y por
  -- eso no ensucia los reportes de sellos otorgados (que filtran tipo='acreditacion').
  insert into transacciones_puntos
    (tarjeta_id, puntos_delta, sucursal_id, cajero_usuario_id, tipo)
    values (p_tarjeta_id, -1, p_sucursal_id, p_cajero_usuario_id, 'uso');

  return query select 'ok'::text, v_saldo;
end $$;

revoke execute on function usar_visita_atomico(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function usar_visita_atomico(uuid, uuid, uuid, uuid) to service_role;

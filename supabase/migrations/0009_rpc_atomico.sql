-- 0009: acreditar/canjear atómicos (una transacción, lock de fila) con atribución de sucursal/cajero.
-- SEGURIDAD: funciones SECURITY INVOKER (corren con privilegios del que llama). Todos los callers
-- usan service_role (ignora RLS). Se REVOCA execute de public/anon/authenticated para que la anon
-- key (pública, va al bundle) NO pueda invocarlas por REST saltándose el gate de la app.

-- Soft-delete de cajeros (hallazgo del review de Fase 7): el ledger va a referenciar
-- usuarios_comercio.id por cajero_usuario_id (abajo), y un DELETE físico de un cajero que ya operó
-- lanzaría 23503. Se agrega la columna `activo` para dar de baja sin borrar la fila (preserva la
-- atribución del ledger, igual que el soft-delete de sucursales). La Fase 9 cambia desactivarCajero
-- a UPDATE activo=false y filtra membresiasDeUsuario/listarCajeros por activo.
alter table usuarios_comercio add column activo boolean not null default true;

-- IMPORTANTE (plpgsql): en `returns table(...)` cada columna de salida es una variable OUT dentro
-- del cuerpo. Por eso las columnas OUT se llaman `saldo`/`costo` y NO `puntos_actuales`/`costo_puntos`:
-- si se llamaran igual que las columnas de las tablas, una referencia sin calificar (en el update,
-- el where, el returning o el select) sería AMBIGUA y Postgres lanzaría "column reference ... is
-- ambiguous" en la PRIMERA llamada (default variable_conflict = error). Con nombres OUT distintos,
-- `puntos_actuales`/`costo_puntos` sin calificar refieren SIEMPRE a la columna de la tabla. No cambiar
-- estos nombres sin re-verificar esa regla.

create or replace function acreditar_puntos_atomico(
  p_comercio_id uuid, p_tarjeta_id uuid, p_delta integer,
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

  update tarjetas set puntos_actuales = puntos_actuales + p_delta
    where id = p_tarjeta_id and comercio_id = p_comercio_id
    returning puntos_actuales into v_saldo;
  if not found then
    return query select 'tarjeta_no_encontrada'::text, null::integer; return;
  end if;

  insert into transacciones_puntos (tarjeta_id, puntos_delta, sucursal_id, cajero_usuario_id)
    values (p_tarjeta_id, p_delta, p_sucursal_id, p_cajero_usuario_id);

  return query select 'ok'::text, v_saldo;
end $$;

create or replace function canjear_recompensa_atomico(
  p_comercio_id uuid, p_tarjeta_id uuid, p_recompensa_id uuid,
  p_sucursal_id uuid, p_cajero_usuario_id uuid
) returns table(estado text, saldo integer, nombre_recompensa text, costo integer)
language plpgsql
set search_path = public
as $$
declare v_nombre text; v_costo integer; v_saldo integer; v_actual integer;
begin
  select nombre, costo_puntos into v_nombre, v_costo
    from recompensas where id = p_recompensa_id and comercio_id = p_comercio_id and activa;
  if not found then
    return query select 'recompensa_no_disponible'::text, null::integer, null::text, null::integer; return;
  end if;

  if p_sucursal_id is not null and not exists (
    select 1 from sucursales where id = p_sucursal_id and comercio_id = p_comercio_id and activa
  ) then
    return query select 'sucursal_invalida'::text, null::integer, null::text, null::integer; return;
  end if;

  update tarjetas set puntos_actuales = puntos_actuales - v_costo
    where id = p_tarjeta_id and comercio_id = p_comercio_id and puntos_actuales >= v_costo
    returning puntos_actuales into v_saldo;
  if not found then
    select puntos_actuales into v_actual from tarjetas where id = p_tarjeta_id and comercio_id = p_comercio_id;
    if not found then
      return query select 'tarjeta_no_encontrada'::text, null::integer, null::text, null::integer; return;
    end if;
    return query select 'saldo_insuficiente'::text, v_actual, v_nombre, v_costo; return;
  end if;

  insert into canjes (tarjeta_id, recompensa_id, puntos_gastados, sucursal_id, cajero_usuario_id)
    values (p_tarjeta_id, p_recompensa_id, v_costo, p_sucursal_id, p_cajero_usuario_id);

  return query select 'ok'::text, v_saldo, v_nombre, v_costo;
end $$;

revoke execute on function acreditar_puntos_atomico(uuid, uuid, integer, uuid, uuid) from public, anon, authenticated;
revoke execute on function canjear_recompensa_atomico(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function acreditar_puntos_atomico(uuid, uuid, integer, uuid, uuid) to service_role;
grant execute on function canjear_recompensa_atomico(uuid, uuid, uuid, uuid, uuid) to service_role;

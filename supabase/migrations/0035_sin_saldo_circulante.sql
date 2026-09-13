-- 0035: reporte_fm_comercios() deja de devolver `saldo_circulante`.
--
-- Ver docs/superpowers/specs/2026-09-09-aviso-antes-del-vencimiento-design.md, pendiente B.
--
-- `saldo_circulante` sumaba `puntos_actuales` de todas las tarjetas de un comercio, y ese contador
-- significa otra cosa en cada tipo: sellos, CENTAVOS en gift card y cashback, visitas en prepago, y
-- nada en cupón, membresía y descuento. No era un número en ninguna unidad. La pantalla de FM dejó de
-- leerlo en el commit e5663bc; esta migración lo retira de la función.
--
-- ORDEN: es SUSTRACTIVA. Se aplica solo cuando e5663bc ya esté EN PRODUCCIÓN, nunca antes: el código
-- anterior suma `c.saldo_circulante` de cada fila, y sin la columna la cabecera de Reportes de FM
-- mostraría NaN y la columna "Circulante" de cada comercio saldría vacía. Es la regla que dejó la
-- 0033: deploy tolerante → migración.
--
-- Quitar una columna de salida cambia el tipo de retorno, así que `create or replace` falla con
-- "cannot change return type": hay `drop` + `create`. Y `drop` BORRA EL ACL — una función nueva nace
-- con execute para PUBLIC. reporte_fm_comercios() no lleva parámetros y devuelve datos de TODOS los
-- comercios: sin los `revoke` de abajo quedaría invocable por `anon` vía PostgREST.
begin;

drop function if exists reporte_fm_comercios();

-- Idéntica a la de la 0033, menos la última columna y su subconsulta.
create function reporte_fm_comercios()
returns table(
  comercio_id uuid, comercio_nombre text, cuenta_id uuid, cuenta_nombre text,
  clientes bigint, operaciones bigint, canjes bigint
)
language sql stable
set search_path = public
as $$
  select
    co.id, co.nombre, co.cuenta_id, cu.nombre,
    (select count(*) from tarjetas t where t.comercio_id = co.id)::bigint,
    (select count(*) from transacciones_puntos tp join tarjetas t on t.id = tp.tarjeta_id
       where t.comercio_id = co.id and tp.tipo in ('acreditacion', 'uso', 'renovacion'))::bigint,
    (select count(*) from canjes c join tarjetas t on t.id = c.tarjeta_id where t.comercio_id = co.id)::bigint
  from comercios co
  left join cuentas_comercio cu on cu.id = co.cuenta_id
  order by (co.cuenta_id is null), cu.nombre, co.nombre;
$$;

-- Los `revoke` tanto como el `grant` (ver arriba).
revoke execute on function reporte_fm_comercios() from public, anon, authenticated;
grant execute on function reporte_fm_comercios() to service_role;

commit;

-- 0031: la renovación de membresía lee los días del PROGRAMA, no del comercio.
--
-- ══ EL BUG ══
-- La migración 0024 mudó la configuración por tipo (`cashback_porcentaje`, `multipass_visitas`,
-- `membresia_dias`, `cupon_vigencia_dias`) de `comercios` a `programas_tarjeta`, e hizo el backfill.
-- Desde entonces la pantalla que edita esos números es Programas, y escribe SOLO en
-- `programas_tarjeta`. Nadie volvió a escribir las columnas de `comercios`.
--
-- `renovar_membresia_atomico` (0019) siguió leyendo `comercios.membresia_dias`. Consecuencia para un
-- comercio dado de alta después de la 0024: esa columna es null para siempre, así que TODA
-- renovación devolvía 'membresia_sin_configurar' — con un mensaje que además mandaba al dueño a
-- Reglas, pantalla que ya no tiene ese campo. El tipo "Membresía" estaba muerto en producción.
--
-- Las pruebas no lo veían porque el fixture de test (test/fixtures/entornoComercio.ts) copia la
-- configuración del comercio al programa: quedaba en las DOS tablas y daba igual cuál se leyera.
-- La prueba que sí lo atrapa vive en lib/tarjetas/tiposFuncionales.test.ts y carga la configuración
-- por el camino de producción (crearPrograma), dejando el comercio con sus columnas vacías.
--
-- ══ POR QUÉ SE CAMBIA EL CUERPO Y NO LA FIRMA ══
-- Pasar los días por parámetro (`p_dias`) obligaría a agregar un argumento, y `create or replace`
-- con otra firma crea un OVERLOAD ambiguo (42725) en vez de reemplazar — el mismo tropiezo que ya
-- documentó `acreditar_puntos_atomico` en la 0015. Con la firma intacta, esta migración se puede
-- aplicar ANTES del deploy sin romper el código vivo: la versión desplegada hoy la llama igual.
--
-- Y el dato se lee ADENTRO del RPC, no antes en TypeScript, para no reabrir la carrera que la 0019
-- cerró: la fecha nueva se sigue calculando dentro del propio UPDATE.

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

  -- Los días salen del programa de ESTA tarjeta; la zona horaria sigue siendo del comercio (es una
  -- propiedad del local, no del programa). El join arranca en `tarjetas` y no en `comercios` para
  -- que el mismo select valide de paso que la tarjeta es de este comercio: si no lo es, no hay fila
  -- y se responde 'tarjeta_no_encontrada' — que es exactamente lo que corresponde.
  select p.membresia_dias, coalesce(c.zona_horaria, 'America/El_Salvador')
    into v_dias, v_zona
    from tarjetas t
    join programas_tarjeta p on p.id = t.programa_id
    join comercios c on c.id = t.comercio_id
    where t.id = p_tarjeta_id and t.comercio_id = p_comercio_id;
  if not found then
    return query select 'tarjeta_no_encontrada'::text, null::date; return;
  end if;
  if v_dias is null or v_dias <= 0 then
    -- Sin duración configurada no hay renovación posible, y decirlo explícito evita que el cajero
    -- cobre y después descubra que la tarjeta no se movió.
    return query select 'membresia_sin_configurar'::text, null::date; return;
  end if;

  v_hoy := (now() at time zone v_zona)::date;

  -- Sin cambios respecto de la 0019, y a propósito: `greatest(vigencia_hasta, hoy) + v_dias` dentro
  -- del propio UPDATE es lo que impide que dos cajeros renovando a la vez cobren dos períodos y
  -- entreguen uno. La segunda transacción re-lee la fila ya actualizada y suma sobre ella.
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

-- Los grants no se heredan al reemplazar el cuerpo si la firma no cambia, pero se repiten por si
-- esta migración se aplicara sobre una base donde la función se hubiera recreado a mano.
revoke execute on function renovar_membresia_atomico(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function renovar_membresia_atomico(uuid, uuid, uuid, uuid) to service_role;

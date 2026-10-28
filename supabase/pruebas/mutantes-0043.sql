-- MUTANTES de la migracion 0043 (emitir_tarjeta). Para pegar en Supabase Studio.
--
-- Para que sirve: mutation-testing de lib/tarjetas/emitirTarjeta.sql.test.ts. Cada funcion de abajo es
-- una copia EXACTA de emitir_tarjeta (misma firma, mismo cuerpo, copiada de
-- supabase/migrations/0043_sellos_de_regalo.sql) con UNA sola linea rota, bajo OTRO nombre. La funcion
-- real NO se toca: los registros de todos los comercios siguen usando la buena mientras se prueba.
--
-- Orden:
--   1. Correr ESTE archivo (una transaccion).
--   2. Desde la carpeta del worktree, uno por uno:
--        EMITIR_TARJETA_FUNCION=emitir_tarjeta_mut_a npx vitest run lib/tarjetas/emitirTarjeta.sql.test.ts
--        EMITIR_TARJETA_FUNCION=emitir_tarjeta_mut_b npx vitest run lib/tarjetas/emitirTarjeta.sql.test.ts
--        EMITIR_TARJETA_FUNCION=emitir_tarjeta_mut_c npx vitest run lib/tarjetas/emitirTarjeta.sql.test.ts
--        EMITIR_TARJETA_FUNCION=emitir_tarjeta_mut_d npx vitest run lib/tarjetas/emitirTarjeta.sql.test.ts
--      Cada uno TIENE que fallar (ver abajo). Si alguno pasa en verde, la prueba no protege esa linea.
--   3. Correr mutantes-0043-borrar.sql.
--
-- Que prueba tiene que fallar con cada mutante, y con que asercion:
--   mut_a  caso B ("un programa que FUE de sellos con regalo 2 y ya es de otro tipo"):
--          `expected 2 to be +0` en "sellos_regalados que devuelve la funcion". Los casos A, C y D pasan.
--   mut_b  caso A ("programa de sellos con regalo 2"):
--          `expected 0 to be 2` en "la tarjeta nace con el saldo del regalo". B, C y D pasan.
--   mut_c  caso A: `expected [] to deeply equal [ { tipo: 'regalo', ... } ]` en
--          "el libro tiene UNA fila de regalo". B, C y D pasan.
--   mut_d  caso E ("un programa de OTRO comercio"):
--          `expected 2 to be +0` en "sellos_regalados: el regalo de un programa ajeno no se lee"
--          (y detras, la tarjeta en 2 y una fila de regalo). A, B, C y D pasan.
--
-- Ninguna de las cuatro escribe nada fuera de las filas que crea la propia prueba (comercios de prueba que
-- ella misma borra).

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- MUTANTE A: quita la condicion `case when p.tipo_tarjeta = 'sellos'`: lee SIEMPRE p.sellos_regalo, sea cual sea el tipo del programa.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function emitir_tarjeta_mut_a(
  p_comercio_id uuid, p_programa_id uuid, p_cliente_id uuid, p_vigencia_hasta date
) returns table(id_tarjeta uuid, token_qr text, sellos_regalados integer)
language plpgsql
set search_path = public
as $$
declare v_regalo integer; v_tarjeta_id uuid; v_qr_token text;
begin
  -- El regalo sale del programa de ESTA tarjeta, y solo cuenta si el programa es de sellos: si el FM
  -- le cambió el tipo después de que el dueño configuró el regalo, la columna sigue guardada pero no
  -- puede regalar "sellos" a una tarjeta de puntos o de cashback.
  --
  -- `comercio_id = p_comercio_id` amarra la lectura al comercio que llama, igual que el resto de las
  -- funciones: el regalo de un programa ajeno no se lee. Sin fila el regalo queda en 0. Si el
  -- programa NO EXISTE, el insert de abajo lo frena la clave foránea con 23503 — eso es lo que
  -- verifica scripts/verificar-0043.ts. (Un programa que existe pero es de otro comercio no lo frena
  -- ninguna FK, igual que con el insert directo de antes: el llamador resuelve el programa a partir
  -- del comercio, y acá solo se asegura de no regalar nada en ese caso.)
  select p.sellos_regalo -- MUTANTE A: sin la condicion del tipo 'sellos'
    into v_regalo
    from programas_tarjeta p
    where p.id = p_programa_id and p.comercio_id = p_comercio_id;
  v_regalo := coalesce(v_regalo, 0);

  -- El regalo es el SALDO INICIAL: el cliente nace con esos sellos y el pase, el escáner y el portal
  -- lo leen de `puntos_actuales` como a cualquier otro sello. qr_token y el resto de los defaults los
  -- pone la base (migración 0001).
  insert into tarjetas (cliente_id, comercio_id, programa_id, vigencia_hasta, puntos_actuales)
    values (p_cliente_id, p_comercio_id, p_programa_id, p_vigencia_hasta, v_regalo)
    returning id, qr_token into v_tarjeta_id, v_qr_token;

  -- Solo si hay regalo: una fila con puntos_delta = 0 en cada registro sería ruido en el historial
  -- de todos los clientes de todos los programas que no regalan nada. Sin cajero, sin sucursal y sin
  -- motivo (ver el comentario de arriba); `forzado` queda en su default, false.
  if v_regalo > 0 then
    insert into transacciones_puntos (tarjeta_id, puntos_delta, tipo)
      values (v_tarjeta_id, v_regalo, 'regalo');
  end if;

  return query select v_tarjeta_id, v_qr_token, v_regalo;
end $$;

revoke execute on function emitir_tarjeta_mut_a(uuid, uuid, uuid, date) from public, anon, authenticated;
grant execute on function emitir_tarjeta_mut_a(uuid, uuid, uuid, date) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- MUTANTE B: inserta la tarjeta con saldo 0 en vez de v_regalo (la fila del ledger y el valor devuelto siguen diciendo el regalo).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function emitir_tarjeta_mut_b(
  p_comercio_id uuid, p_programa_id uuid, p_cliente_id uuid, p_vigencia_hasta date
) returns table(id_tarjeta uuid, token_qr text, sellos_regalados integer)
language plpgsql
set search_path = public
as $$
declare v_regalo integer; v_tarjeta_id uuid; v_qr_token text;
begin
  -- El regalo sale del programa de ESTA tarjeta, y solo cuenta si el programa es de sellos: si el FM
  -- le cambió el tipo después de que el dueño configuró el regalo, la columna sigue guardada pero no
  -- puede regalar "sellos" a una tarjeta de puntos o de cashback.
  --
  -- `comercio_id = p_comercio_id` amarra la lectura al comercio que llama, igual que el resto de las
  -- funciones: el regalo de un programa ajeno no se lee. Sin fila el regalo queda en 0. Si el
  -- programa NO EXISTE, el insert de abajo lo frena la clave foránea con 23503 — eso es lo que
  -- verifica scripts/verificar-0043.ts. (Un programa que existe pero es de otro comercio no lo frena
  -- ninguna FK, igual que con el insert directo de antes: el llamador resuelve el programa a partir
  -- del comercio, y acá solo se asegura de no regalar nada en ese caso.)
  select case when p.tipo_tarjeta = 'sellos' then p.sellos_regalo else 0 end
    into v_regalo
    from programas_tarjeta p
    where p.id = p_programa_id and p.comercio_id = p_comercio_id;
  v_regalo := coalesce(v_regalo, 0);

  -- El regalo es el SALDO INICIAL: el cliente nace con esos sellos y el pase, el escáner y el portal
  -- lo leen de `puntos_actuales` como a cualquier otro sello. qr_token y el resto de los defaults los
  -- pone la base (migración 0001).
  insert into tarjetas (cliente_id, comercio_id, programa_id, vigencia_hasta, puntos_actuales)
    values (p_cliente_id, p_comercio_id, p_programa_id, p_vigencia_hasta, 0) -- MUTANTE B: saldo 0 en vez de v_regalo
    returning id, qr_token into v_tarjeta_id, v_qr_token;

  -- Solo si hay regalo: una fila con puntos_delta = 0 en cada registro sería ruido en el historial
  -- de todos los clientes de todos los programas que no regalan nada. Sin cajero, sin sucursal y sin
  -- motivo (ver el comentario de arriba); `forzado` queda en su default, false.
  if v_regalo > 0 then
    insert into transacciones_puntos (tarjeta_id, puntos_delta, tipo)
      values (v_tarjeta_id, v_regalo, 'regalo');
  end if;

  return query select v_tarjeta_id, v_qr_token, v_regalo;
end $$;

revoke execute on function emitir_tarjeta_mut_b(uuid, uuid, uuid, date) from public, anon, authenticated;
grant execute on function emitir_tarjeta_mut_b(uuid, uuid, uuid, date) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- MUTANTE C: se salta el insert del movimiento 'regalo' en el ledger (la tarjeta nace con el saldo y el valor devuelto sigue diciendo el regalo).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function emitir_tarjeta_mut_c(
  p_comercio_id uuid, p_programa_id uuid, p_cliente_id uuid, p_vigencia_hasta date
) returns table(id_tarjeta uuid, token_qr text, sellos_regalados integer)
language plpgsql
set search_path = public
as $$
declare v_regalo integer; v_tarjeta_id uuid; v_qr_token text;
begin
  -- El regalo sale del programa de ESTA tarjeta, y solo cuenta si el programa es de sellos: si el FM
  -- le cambió el tipo después de que el dueño configuró el regalo, la columna sigue guardada pero no
  -- puede regalar "sellos" a una tarjeta de puntos o de cashback.
  --
  -- `comercio_id = p_comercio_id` amarra la lectura al comercio que llama, igual que el resto de las
  -- funciones: el regalo de un programa ajeno no se lee. Sin fila el regalo queda en 0. Si el
  -- programa NO EXISTE, el insert de abajo lo frena la clave foránea con 23503 — eso es lo que
  -- verifica scripts/verificar-0043.ts. (Un programa que existe pero es de otro comercio no lo frena
  -- ninguna FK, igual que con el insert directo de antes: el llamador resuelve el programa a partir
  -- del comercio, y acá solo se asegura de no regalar nada en ese caso.)
  select case when p.tipo_tarjeta = 'sellos' then p.sellos_regalo else 0 end
    into v_regalo
    from programas_tarjeta p
    where p.id = p_programa_id and p.comercio_id = p_comercio_id;
  v_regalo := coalesce(v_regalo, 0);

  -- El regalo es el SALDO INICIAL: el cliente nace con esos sellos y el pase, el escáner y el portal
  -- lo leen de `puntos_actuales` como a cualquier otro sello. qr_token y el resto de los defaults los
  -- pone la base (migración 0001).
  insert into tarjetas (cliente_id, comercio_id, programa_id, vigencia_hasta, puntos_actuales)
    values (p_cliente_id, p_comercio_id, p_programa_id, p_vigencia_hasta, v_regalo)
    returning id, qr_token into v_tarjeta_id, v_qr_token;

  -- Solo si hay regalo: una fila con puntos_delta = 0 en cada registro sería ruido en el historial
  -- de todos los clientes de todos los programas que no regalan nada. Sin cajero, sin sucursal y sin
  -- motivo (ver el comentario de arriba); `forzado` queda en su default, false.
  if false then -- MUTANTE C: nunca escribe la fila del ledger
    insert into transacciones_puntos (tarjeta_id, puntos_delta, tipo)
      values (v_tarjeta_id, v_regalo, 'regalo');
  end if;

  return query select v_tarjeta_id, v_qr_token, v_regalo;
end $$;

revoke execute on function emitir_tarjeta_mut_c(uuid, uuid, uuid, date) from public, anon, authenticated;
grant execute on function emitir_tarjeta_mut_c(uuid, uuid, uuid, date) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- MUTANTE D: quita `and p.comercio_id = p_comercio_id` de la lectura del regalo: lee el programa sea de quien sea (el regalo de un programa AJENO sí se lee).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function emitir_tarjeta_mut_d(
  p_comercio_id uuid, p_programa_id uuid, p_cliente_id uuid, p_vigencia_hasta date
) returns table(id_tarjeta uuid, token_qr text, sellos_regalados integer)
language plpgsql
set search_path = public
as $$
declare v_regalo integer; v_tarjeta_id uuid; v_qr_token text;
begin
  -- El regalo sale del programa de ESTA tarjeta, y solo cuenta si el programa es de sellos: si el FM
  -- le cambió el tipo después de que el dueño configuró el regalo, la columna sigue guardada pero no
  -- puede regalar "sellos" a una tarjeta de puntos o de cashback.
  --
  -- `comercio_id = p_comercio_id` amarra la lectura al comercio que llama, igual que el resto de las
  -- funciones: el regalo de un programa ajeno no se lee. Sin fila el regalo queda en 0. Si el
  -- programa NO EXISTE, el insert de abajo lo frena la clave foránea con 23503 — eso es lo que
  -- verifica scripts/verificar-0043.ts. (Un programa que existe pero es de otro comercio no lo frena
  -- ninguna FK, igual que con el insert directo de antes: el llamador resuelve el programa a partir
  -- del comercio, y acá solo se asegura de no regalar nada en ese caso.)
  select case when p.tipo_tarjeta = 'sellos' then p.sellos_regalo else 0 end
    into v_regalo
    from programas_tarjeta p
    where p.id = p_programa_id; -- MUTANTE D: sin la condicion del comercio (lee el programa sea de quien sea)
  v_regalo := coalesce(v_regalo, 0);

  -- El regalo es el SALDO INICIAL: el cliente nace con esos sellos y el pase, el escáner y el portal
  -- lo leen de `puntos_actuales` como a cualquier otro sello. qr_token y el resto de los defaults los
  -- pone la base (migración 0001).
  insert into tarjetas (cliente_id, comercio_id, programa_id, vigencia_hasta, puntos_actuales)
    values (p_cliente_id, p_comercio_id, p_programa_id, p_vigencia_hasta, v_regalo)
    returning id, qr_token into v_tarjeta_id, v_qr_token;

  -- Solo si hay regalo: una fila con puntos_delta = 0 en cada registro sería ruido en el historial
  -- de todos los clientes de todos los programas que no regalan nada. Sin cajero, sin sucursal y sin
  -- motivo (ver el comentario de arriba); `forzado` queda en su default, false.
  if v_regalo > 0 then
    insert into transacciones_puntos (tarjeta_id, puntos_delta, tipo)
      values (v_tarjeta_id, v_regalo, 'regalo');
  end if;

  return query select v_tarjeta_id, v_qr_token, v_regalo;
end $$;

revoke execute on function emitir_tarjeta_mut_d(uuid, uuid, uuid, date) from public, anon, authenticated;
grant execute on function emitir_tarjeta_mut_d(uuid, uuid, uuid, date) to service_role;

commit;

-- Para que PostgREST vea las funciones nuevas sin esperar (si el primer intento da PGRST202, esperar unos
-- segundos o repetir esta linea).
notify pgrst, 'reload schema';

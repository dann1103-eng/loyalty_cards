-- 0043 — Sellos de regalo al registrarse: la tarjeta nace con el efecto de progreso empezado.
--
-- El pedido: que el dueño pueda decidir que una tarjeta de sellos NAZCA con N sellos ya puestos
-- ("2 de 10" en vez de "0 de 10"). Un cliente que ve la grilla con el arranque hecho tiene más
-- ganas de completarla que uno que la ve vacía.
--
-- Cuatro piezas, en una sola transacción para aplicarla una vez:
--
--   1. programas_tarjeta.sellos_regalo   cuántos sellos recibe una tarjeta NUEVA de ese programa.
--   2. Un CHECK que cruza esa columna con sello_meta (el regalo nunca alcanza la meta).
--   3. El ledger aprende un movimiento más: 'regalo'.
--   4. emitir_tarjeta(...)               crea la tarjeta y su regalo en UNA sola operación.
--
-- ══ POR QUÉ LA TARJETA SE EMITE DESDE UNA FUNCIÓN DE LA BASE ══
-- Dar el regalo desde TypeScript serían dos escrituras: el insert de la tarjeta con el saldo inicial
-- y el insert del movimiento en el ledger. Si la segunda falla, la tarjeta quedaría con sellos que
-- el historial no explica — y el historial es lo que el dueño mira cuando un cliente reclama. Dentro
-- de una función plpgsql las dos van en la misma transacción: o nace todo o no nace nada.
--
-- Y el regalo se lee ADENTRO de la función (el criterio de la 0031: la configuración se lee donde se
-- usa), no llega por parámetro. Así ningún llamador puede regalar sellos de más por un error o una
-- manipulación, y la regla "solo los programas de sellos regalan" vive en un único lugar. Como el
-- CHECK de abajo mantiene el regalo por debajo de la meta, cualquier valor que lea es uno con el que
-- la tarjeta nace incompleta.
--
-- ══ ADITIVA, SE PUEDE APLICAR ANTES DEL DEPLOY ══
-- Ningún programa existente cambia (la columna nace en 0), el código vivo no nombra la columna ni la
-- función, y ninguna fila del ledger se toca. El código que despliega después recién la usa. Volver
-- atrás: drop de la función y de la columna (el CHECK cae con la columna), y re-crear el CHECK del
-- ledger sin 'regalo' si no quedara ninguna fila de ese tipo.
begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La columna
-- ─────────────────────────────────────────────────────────────────────────────
-- En el PROGRAMA y no en `comercios`: desde la 0024 la mecánica de cada tipo (sello_meta incluida)
-- vive ahí, y el regalo se mide contra esa meta. NOT NULL DEFAULT 0 porque "sin regalo" es un valor
-- ("0"), no una ausencia; en PG 11+ agregar una columna con default constante no reescribe la tabla.
--
-- Solo se APLICA si el programa es de sellos (lo decide emitir_tarjeta): si el FM le cambia el tipo
-- a un programa, la columna queda guardada pero inofensiva.
alter table programas_tarjeta add column sellos_regalo integer not null default 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. El CHECK cruzado
-- ─────────────────────────────────────────────────────────────────────────────
-- Respaldo de la validación de TypeScript (lib/tarjetas/sellosRegalo.ts), que es la que le habla al
-- dueño en español. Esto es el candado de último recurso, y cruza DOS columnas a propósito: no solo
-- impide guardar un regalo mayor que la meta, sino BAJAR la meta por debajo del regalo ya guardado,
-- venga de donde venga (otra pestaña abierta con datos viejos, un script, un cambio a mano).
--
-- Sin esto, una tarjeta podría nacer completa: con la meta en 10 y el regalo en 10, el cliente se
-- registra y ya tiene el premio sin haber comprado nada.
--
--   regalo = 0                      siempre válido, con cualquier meta, incluida ninguna (null).
--   regalo > 0                      exige meta definida y estrictamente mayor que el regalo.
--
-- Esta CHECK nunca evalúa a NULL (sellos_regalo es NOT NULL y `sello_meta is not null` es booleano),
-- así que no hay el hueco habitual de "un CHECK que da NULL pasa".
alter table programas_tarjeta
  add constraint programas_tarjeta_sellos_regalo_check
    check (
      sellos_regalo >= 0
      and (sellos_regalo = 0 or (sello_meta is not null and sellos_regalo < sello_meta))
    );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. El ledger aprende un movimiento más
-- ─────────────────────────────────────────────────────────────────────────────
-- Los sellos de regalo tienen que aparecer en el historial del cliente: sin la fila, el saldo de la
-- tarjeta diría "2" y el historial estaría vacío, y ese agujero es exactamente lo que la pantalla
-- forense existe para no tener. Se AMPLÍA el CHECK en vez de reemplazarlo, igual que en la 0019:
-- los cuatro valores viejos siguen siendo válidos y ninguna fila existente se toca.
alter table transacciones_puntos drop constraint if exists transacciones_puntos_tipo_check;
alter table transacciones_puntos
  add constraint transacciones_puntos_tipo_check
    check (tipo in ('acreditacion', 'ajuste', 'uso', 'renovacion', 'regalo'));

-- IMPORTANTE — lo que esto NO cambia: las funciones de reporte (0033, 0040) filtran por tipos
-- concretos ('acreditacion', 'uso' y 'renovacion', más 'ajuste' aparte), y los topes de antifraude
-- (0015) cuentan solo 'acreditacion'; 'regalo' no entra en ninguno. Es deliberado y no hay que "arreglarlo": los
-- reportes miden visitas y operaciones, y un regalo no es ninguna de las dos (contarlo inflaría el
-- reporte de quien atendió, y gastaría el cupo diario de un cliente que todavía no compró nada).
--
-- Por la misma razón el movimiento NO lleva cajero ni sucursal: es del programa, no de quien
-- atendió. El CHECK `transacciones_puntos_motivo_obligatorio` (0015) tampoco molesta: solo exige
-- motivo para tipo 'ajuste' o forzado = true, y el regalo es 'regalo' con forzado = false.

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Emitir una tarjeta
-- ─────────────────────────────────────────────────────────────────────────────
-- IMPORTANTE (plpgsql): en `returns table(...)` cada columna de salida es una variable OUT dentro
-- del cuerpo. Por eso se llaman `id_tarjeta` / `token_qr` / `sellos_regalados` y NO `id` / `qr_token`
-- / `sellos_regalo`: si se llamaran igual que las columnas de las tablas, el `returning qr_token` o
-- el `select ... sellos_regalo` serían AMBIGUOS y Postgres lanzaría "column reference ... is
-- ambiguous" en la PRIMERA llamada (la advertencia de la 0009). Con estos nombres, lo que se escribe
-- sin calificar refiere SIEMPRE a la columna de la tabla. No cambiar los nombres de salida sin
-- re-verificar esa regla.
--
-- La vigencia (cupón) la calcula TypeScript y llega por parámetro: depende de la zona horaria del
-- comercio y de `cupon_vigencia_dias`, y esa lógica ya vive en un solo lugar (lib/tarjetas/vigencia).
-- Es null en todo tipo que no sea cupón.
--
-- ¿Y si la tarjeta ya existe? El insert viola el unique (cliente_id, programa_id) y lanza 23505,
-- que aborta la función entera: no queda ningún regalo suelto, porque el movimiento del ledger se
-- inserta DESPUÉS de la tarjeta. PostgREST devuelve ese código en `error.code`, así que la
-- recuperación de carreras de registrarCliente (dos pestañas registrando al mismo cliente a la vez)
-- sigue funcionando igual que con el insert directo. El regalo se da UNA vez, cuando nace la
-- tarjeta: un cliente que ya la tenía y vuelve a registrarse no recibe nada.
--
-- INVARIANTE DE LA 0015 ("todo escritor de transacciones_puntos toma el lock de la fila de la
-- tarjeta"): esta función lo cumple sin tomar nada. El count(*) de los topes diarios solo es
-- confiable si nadie escribe en el ledger de una tarjeta sin pasar por ese lock, pero la fila de
-- tarjetas que se inserta acá es INVISIBLE para cualquier otra transacción hasta el commit — nadie
-- más puede ni conocer su id, así que nadie puede estar acreditando, ajustando o canjeando sobre ella
-- mientras esta función escribe su primer movimiento.
create or replace function emitir_tarjeta(
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
  if v_regalo > 0 then
    insert into transacciones_puntos (tarjeta_id, puntos_delta, tipo)
      values (v_tarjeta_id, v_regalo, 'regalo');
  end if;

  return query select v_tarjeta_id, v_qr_token, v_regalo;
end $$;

-- Mismo criterio de permisos que 0009/0010/0015/0019: la anon key del bundle público no puede
-- invocarla. Emitir una tarjeta es una escritura del servidor, con la llave de servicio.
revoke execute on function emitir_tarjeta(uuid, uuid, uuid, date) from public, anon, authenticated;
grant execute on function emitir_tarjeta(uuid, uuid, uuid, date) to service_role;

commit;

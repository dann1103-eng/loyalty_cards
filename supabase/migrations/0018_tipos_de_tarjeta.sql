-- 0018: los seis tipos de tarjeta que faltaban.
--
-- Hasta acá el catálogo (comercios.tipo_tarjeta, migración 0005) tenía 8 valores pero solo 2 vivos:
-- puntos y sellos. Los otros seis decían "Próximamente" en el panel de FM. Esta migración les da el
-- estado que cada uno necesita.
--
-- ══ DECISIÓN CENTRAL: puntos_actuales es el CONTADOR UNIVERSAL ══
-- No se parte la tabla ni se agrega una columna de saldo por tipo. `tarjetas.puntos_actuales`
-- (integer) sigue siendo el número que sube y baja, y lo que SIGNIFICA depende de tipo_tarjeta:
--
--   puntos    → puntos
--   sellos    → sellos
--   multipass → visitas que quedan
--   gift_card → CENTAVOS de saldo
--   cashback  → CENTAVOS acumulados de devolución
--   cupon     → sin uso (el estado vive en usado_en)
--   membresia → sin uso (el estado vive en vigencia_hasta)
--   descuento → sin uso (el nivel sale de acumulado_centavos)
--
-- Por qué CENTAVOS y no numeric: toda la maquinaria de la Tanda 1 —los RPC atómicos, los cuatro
-- límites antifraude, el historial con su saldo corrido, los reportes— está escrita sobre enteros.
-- Reinterpretar el entero cuesta cero migración de datos y cero reescritura de esa maquinaria. Y
-- guardar plata en enteros es lo correcto de todas formas: un numeric con decimales invita a que
-- alguien lo pase a float en el camino, y sumar 0.1 + 0.2 repetidas veces acumula error sobre el
-- saldo de un cliente.
--
-- La contrapartida, que hay que tener presente: un `puntos_actuales` de 1250 significa "$12.50" o
-- "1250 puntos" según el comercio. TODA lectura tiene que pasar por el formateador que conoce el
-- tipo (lib/portal/buscarTarjetas.ts → formatearSaldo). Nunca imprimir el número crudo.

-- ─────────────────────────────────────────────────────────────────────────────
-- Configuración por comercio
-- ─────────────────────────────────────────────────────────────────────────────
alter table comercios
  -- CASHBACK: qué porcentaje de la compra vuelve como saldo. numeric(5,2) admite 0.01–100.00.
  add column cashback_porcentaje numeric(5, 2)
    check (cashback_porcentaje is null or (cashback_porcentaje > 0 and cashback_porcentaje <= 100)),
  -- MULTIPASS: cuántas visitas trae el paquete que se vende.
  add column multipass_visitas integer
    check (multipass_visitas is null or multipass_visitas > 0),
  -- MEMBRESÍA: cuántos días dura cada renovación.
  add column membresia_dias integer
    check (membresia_dias is null or membresia_dias > 0),
  -- CUPÓN: cuántos días vale desde que el cliente se registra. null = sin vencimiento.
  add column cupon_vigencia_dias integer
    check (cupon_vigencia_dias is null or cupon_vigencia_dias > 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- Estado por tarjeta
-- ─────────────────────────────────────────────────────────────────────────────
alter table tarjetas
  -- MEMBRESÍA y CUPÓN. Es una fecha y no un timestamp a propósito: "vence el 30" tiene que
  -- significar el 30 completo en el local, no un instante que cambia con la zona horaria.
  add column vigencia_hasta date,
  -- CUPÓN: cuándo se usó. null = todavía disponible. Se guarda el instante y no un booleano porque
  -- "cuándo lo usó" es justamente el dato que el comercio quiere para medir la campaña.
  add column usado_en timestamptz,
  -- DESCUENTO: total gastado histórico, en centavos. NUNCA baja — es lo que define el nivel, y un
  -- cliente no debería perder su nivel porque canjeó algo. bigint y no integer: acá se acumula
  -- para siempre, y un integer se agota en $21 millones.
  add column acumulado_centavos bigint not null default 0
    check (acumulado_centavos >= 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- Niveles de descuento
-- ─────────────────────────────────────────────────────────────────────────────
-- Tabla propia y no columnas en comercios: la cantidad de niveles la decide cada comercio ("5% a
-- partir de $100, 10% a partir de $300, 15% a partir de $500"), y modelar N niveles en columnas
-- fijas obliga a elegir un tope arbitrario.
create table niveles_descuento (
  id uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references comercios(id),
  -- Umbral de gasto acumulado a partir del cual aplica este porcentaje.
  desde_centavos bigint not null check (desde_centavos >= 0),
  porcentaje numeric(5, 2) not null check (porcentaje > 0 and porcentaje <= 100),
  created_at timestamptz not null default now(),
  -- Dos niveles con el mismo umbral en un comercio harían ambiguo qué descuento aplica.
  unique (comercio_id, desde_centavos)
);

create index niveles_descuento_comercio_idx on niveles_descuento (comercio_id, desde_centavos desc);

alter table niveles_descuento enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- Nota sobre lo que NO cambia
-- ─────────────────────────────────────────────────────────────────────────────
-- tipo_tarjeta ya acepta los ocho valores desde la 0005: no hace falta tocar ese CHECK. Lo que
-- cambia es la capa de aplicación, que hasta ahora marcaba seis de ellos como "Próximamente"
-- (TIPOS_TARJETA en lib/comercios/guardarComercio.ts).
--
-- Los RPC de la 0015 (acreditar_atomico, ajustar_puntos_atomico) siguen sirviendo tal cual para
-- todo tipo con contador: suman y restan enteros sin saber qué representan. Cupón y membresía no
-- los usan — su estado no es un número.

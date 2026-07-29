-- 0024: programas de tarjeta.
--
-- Un comercio pasa a poder ofrecer VARIOS programas a la vez (sellos permanente + cupón de campaña,
-- por ejemplo), cada uno con su nombre, su configuración y su propio QR de registro.
--
-- ══ ADVERTENCIA: ESTA MIGRACIÓN MUEVE DATOS VIVOS ══
-- Las 23 anteriores fueron aditivas. Esta reparte las tarjetas existentes hacia el programa que les
-- corresponde: si el backfill sale mal, clientes reales pierden su tarjeta. Por eso va toda en una
-- transacción con guardas que la ABORTAN antes de commitear si algo no cuadra.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- La tabla
-- ─────────────────────────────────────────────────────────────────────────────
-- La configuración por tipo (sello_meta, cashback_porcentaje, …) se MUDA acá desde `comercios`, y
-- esa mudanza es la parte que mejora el diseño: nunca fue del comercio, fue del programa. Con un
-- solo programa por comercio la diferencia era invisible.
create table programas_tarjeta (
  id uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references comercios(id),
  -- Lo que el dueño escribe para reconocerlo: "Sellos del café", "Cupón de bienvenida".
  nombre text not null check (btrim(nombre) <> ''),
  -- Va en la URL de registro: /registro/<comercioSlug>/<slug>. Mismo formato que comercios.slug.
  slug text not null check (slug ~ '^[a-z0-9-]+$'),
  tipo_tarjeta text not null
    check (tipo_tarjeta in ('puntos', 'sellos', 'cashback', 'membresia', 'descuento', 'cupon', 'prepago', 'gift_card')),
  -- El que recibe quien escanea el QR viejo del comercio, sin programa en la URL. Así los QR ya
  -- impresos en los locales siguen funcionando.
  es_principal boolean not null default false,
  -- Soft-delete: las tarjetas emitidas lo referencian y el historial de cada cliente cuelga de
  -- ellas. Mismo criterio que recompensas y cajeros.
  activo boolean not null default true,
  -- Configuración, mudada desde comercios.
  sello_meta integer check (sello_meta is null or sello_meta > 0),
  cashback_porcentaje numeric(5, 2)
    check (cashback_porcentaje is null or (cashback_porcentaje > 0 and cashback_porcentaje <= 100)),
  multipass_visitas integer check (multipass_visitas is null or multipass_visitas > 0),
  membresia_dias integer check (membresia_dias is null or membresia_dias > 0),
  cupon_vigencia_dias integer check (cupon_vigencia_dias is null or cupon_vigencia_dias > 0),
  created_at timestamptz not null default now(),
  -- Dos programas con el mismo slug en un comercio harían ambigua la URL de registro.
  unique (comercio_id, slug)
);

-- Como máximo UN principal por comercio. Índice único parcial, el mismo patrón que
-- sucursales.es_principal (0012) — es el caso que Postgres sí sabe expresar.
create unique index programas_tarjeta_un_principal
  on programas_tarjeta (comercio_id) where es_principal;

create index programas_tarjeta_comercio_idx on programas_tarjeta (comercio_id) where activo;

alter table programas_tarjeta enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill 1: un programa por cada comercio existente
-- ─────────────────────────────────────────────────────────────────────────────
-- Se copia su tipo y su configuración actual. Slug 'principal' y no derivado del nombre: es estable,
-- no colisiona, y el QR viejo del comercio no lleva slug de todas formas.
insert into programas_tarjeta (
  comercio_id, nombre, slug, tipo_tarjeta, es_principal, activo,
  sello_meta, cashback_porcentaje, multipass_visitas, membresia_dias, cupon_vigencia_dias
)
select
  c.id, c.nombre, 'principal', c.tipo_tarjeta, true, true,
  c.sello_meta, c.cashback_porcentaje, c.multipass_visitas, c.membresia_dias, c.cupon_vigencia_dias
from comercios c;

do $$
declare v_comercios integer; v_programas integer;
begin
  select count(*) into v_comercios from comercios;
  select count(*) into v_programas from programas_tarjeta where es_principal;
  if v_comercios <> v_programas then
    raise exception 'Backfill incompleto: % comercios pero % programas principales', v_comercios, v_programas;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill 2: apuntar cada tarjeta a su programa
-- ─────────────────────────────────────────────────────────────────────────────
alter table tarjetas add column programa_id uuid references programas_tarjeta(id);

update tarjetas t
  set programa_id = p.id
  from programas_tarjeta p
  where p.comercio_id = t.comercio_id and p.es_principal;

-- LA guarda que importa: una tarjeta sin programa es un cliente sin tarjeta. Si quedara una sola,
-- toda la transacción se revierte.
do $$
declare v_huerfanas integer;
begin
  select count(*) into v_huerfanas from tarjetas where programa_id is null;
  if v_huerfanas > 0 then
    raise exception 'Quedaron % tarjetas sin programa: se aborta', v_huerfanas;
  end if;
end $$;

alter table tarjetas alter column programa_id set not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- La unicidad se muda al programa
-- ─────────────────────────────────────────────────────────────────────────────
-- Antes: un cliente, una tarjeta por comercio. Ahora puede tener dos en el mismo local si son de
-- programas distintos, pero nunca dos del mismo programa.
--
-- Se reemplaza DESPUÉS del backfill: hacerlo antes dejaría una ventana en la que dos tarjetas del
-- mismo cliente y comercio podrían colarse sin programa asignado.
alter table tarjetas drop constraint if exists tarjetas_cliente_id_comercio_id_key;
alter table tarjetas add constraint tarjetas_cliente_programa_key unique (cliente_id, programa_id);

-- comercios.tipo_tarjeta y su configuración NO se borran acá a propósito: quedan como el reflejo
-- del programa principal para que el código ya desplegado siga funcionando durante la ventana de
-- deploy. Se retiran en una migración posterior (expand → migrate → contract), igual que se hizo
-- con acreditar_puntos_atomico en la 0015.

commit;

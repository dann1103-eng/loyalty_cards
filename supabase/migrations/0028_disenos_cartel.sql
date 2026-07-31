-- 0028: diseños de cartel/QR por programa.
--
-- Un comercio puede diseñar el cartel de mesa/mostrador que imprime con el QR de registro de CADA
-- uno de sus programas activos. Ver docs/superpowers/specs/2026-07-30-editor-cartel-qr-design.md.
--
-- SIN BACKFILL a propósito: la AUSENCIA de fila para un programa_id significa "sin personalizar", y
-- la capa de aplicación calcula los defaults en memoria. Por eso aplicar esto no le crea nada a
-- ningún programa existente y ningún cartel cambia.
--
-- Nota de numeración: el plan original decía "0026", escrito en paralelo con notificaciones push
-- (0026) y branding por programa (0027) sin que ninguno supiera del otro. Tal cual estaba habría
-- sobrescrito una migración YA APLICADA en producción. Renumerada a 0028 antes de correrla.
begin;

create table disenos_cartel (
  id uuid primary key default gen_random_uuid(),
  -- UNIQUE: un solo diseño por programa. `on delete cascade` en las dos FKs, a diferencia de las
  -- tablas de la 0026: el diseño de un cartel no vale nada sin su programa y no es dato de cliente
  -- ni evidencia de auditoría, así que acá borrar en cascada es lo correcto y no una pérdida.
  programa_id uuid not null unique references programas_tarjeta(id) on delete cascade,
  comercio_id uuid not null references comercios(id) on delete cascade,

  plantilla text not null default 'centrado' check (plantilla in ('centrado', 'split', 'foto')),

  -- null = heredá del branding efectivo del programa (que a su vez hereda del comercio, 0027).
  color_fondo text,
  color_texto text,
  color_label text,
  logo_url text,

  texto_cta text not null default '¡Escaneá y sumate!' check (btrim(texto_cta) <> ''),
  texto_teaser text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index disenos_cartel_comercio_idx on disenos_cartel (comercio_id);

alter table disenos_cartel enable row level security;
-- Sin políticas = deny-all para anon/authenticated, igual que programas_tarjeta (0024) y las tablas
-- de la 0026. Todo acceso pasa por Server Actions/Route Handlers con createServiceClient(),
-- gateados por verifyComercioOwner() y con el programa re-verificado contra comercio_id. Con un
-- cliente de sesión, cada select/insert devuelve null/no-op EN SILENCIO en vez de un error.

commit;

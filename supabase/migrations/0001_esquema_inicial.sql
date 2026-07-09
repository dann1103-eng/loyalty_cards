create extension if not exists pgcrypto;

create table comercios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  slug text not null unique,
  color_fondo text,
  color_texto text,
  color_label text,
  logo_url text,
  strip_url text,
  hero_url text,
  google_class_id text,
  created_at timestamptz not null default now()
);

create table usuarios_comercio (
  id uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references comercios(id),
  email text not null unique,
  rol text not null check (rol in ('owner', 'cajero')),
  auth_user_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Global por diseño: una persona = un registro, aunque tenga tarjetas en varios comercios (ver spec §4).
create table clientes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  telefono text not null unique,
  created_at timestamptz not null default now()
);

create table tarjetas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  comercio_id uuid not null references comercios(id),
  puntos_actuales integer not null default 0,
  qr_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  apple_serial_number text unique,
  -- apple_auth_token: NO está en el spec §4 — es un agregado técnico de este plan.
  -- Apple exige verificar este token en cada llamada al PassKit Web Service (Tareas 9-10);
  -- se genera una vez al crear la tarjeta y se incrusta en el pass firmado.
  apple_auth_token text,
  google_object_id text unique,
  created_at timestamptz not null default now(),
  unique (cliente_id, comercio_id)
);

create table reglas_puntos (
  id uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references comercios(id),
  tipo text not null check (tipo in ('por_visita', 'por_monto')),
  valor numeric not null,
  activa_desde timestamptz not null default now()
);

create table recompensas (
  id uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references comercios(id),
  nombre text not null,
  descripcion text,
  foto_url text,
  costo_puntos integer not null,
  tipo text not null check (tipo in ('codigo_descuento', 'articulo_gratis', 'otro')),
  valor text,
  activa boolean not null default true,
  created_at timestamptz not null default now()
);

create table transacciones_puntos (
  id uuid primary key default gen_random_uuid(),
  tarjeta_id uuid not null references tarjetas(id),
  cajero_usuario_id uuid references usuarios_comercio(id),
  puntos_delta integer not null,
  monto_compra numeric,
  created_at timestamptz not null default now()
);

create table canjes (
  id uuid primary key default gen_random_uuid(),
  tarjeta_id uuid not null references tarjetas(id),
  recompensa_id uuid not null references recompensas(id),
  cajero_usuario_id uuid references usuarios_comercio(id),
  puntos_gastados integer not null,
  estado text not null default 'completado' check (estado in ('completado', 'cancelado')),
  created_at timestamptz not null default now()
);

-- Tabla TÉCNICA (protocolo Apple, no es dominio de producto — no está en el spec §4).
-- Requerida por el PassKit Web Service para saber a qué dispositivos avisar cuando cambia una tarjeta.
create table apple_push_registrations (
  id uuid primary key default gen_random_uuid(),
  tarjeta_id uuid not null references tarjetas(id),
  device_library_identifier text not null,
  push_token text not null,
  created_at timestamptz not null default now(),
  unique (tarjeta_id, device_library_identifier)
);

-- RLS activado en todo lo que cuelga de comercio_id; sin políticas todavía (deny-all salvo service_role).
-- Las políticas reales por rol llegan en la Fase 4 (PWA de comercio), cuando exista login.
alter table comercios enable row level security;
alter table usuarios_comercio enable row level security;
alter table tarjetas enable row level security;
alter table reglas_puntos enable row level security;
alter table recompensas enable row level security;
alter table transacciones_puntos enable row level security;
alter table canjes enable row level security;
alter table apple_push_registrations enable row level security;
-- clientes: sin RLS — es global por diseño, no cuelga de un comercio.

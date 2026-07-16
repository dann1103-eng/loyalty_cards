-- 0003: Panel de administración de FM.
-- Migraciones anteriores ya aplicadas a la base viva; todo cambio es append-only.

-- Quién es administrador de FM (la plataforma), no de un comercio.
-- Hoy tendrá UNA sola fila: la cuenta compartida de Daniel + socio. Se modela como tabla
-- real (no un correo quemado en código/env) para ser visible y editable en Supabase Studio,
-- consistente con cómo el resto del esquema modela acceso.
create table usuarios_fm (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id),
  email text not null unique,
  created_at timestamptz not null default now()
);

alter table usuarios_fm enable row level security;
-- Sin políticas: deny-all salvo service_role, igual que el resto del esquema.

-- Licencia del comercio. Seguimiento MANUAL para el piloto: sin historial versionado y sin
-- pasarela de pago (ver spec §9). Simple y mutable a propósito.
alter table comercios
  add column licencia_estado text not null default 'activo'
    check (licencia_estado in ('activo', 'inactivo')),
  add column licencia_plan text,
  add column licencia_monto_mensual numeric,
  add column licencia_activa_desde timestamptz;

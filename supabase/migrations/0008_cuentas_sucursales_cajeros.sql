-- 0008: Cuentas (cliente que paga) + sucursales + atribución de cajero/sucursal en el ledger.
-- Migraciones anteriores ya aplicadas a la base viva; todo cambio es append-only.

-- cuentas_comercio: el cliente que paga. limite_negocios se APLICA en la capa app (validar()),
-- la BD solo garantiza el rango con un CHECK. RLS deny-all como el resto del esquema.
create table cuentas_comercio (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  limite_negocios integer not null default 1 check (limite_negocios > 0),
  created_at timestamptz not null default now()
);
alter table cuentas_comercio enable row level security;

-- comercios.cuenta_id: nullable a propósito (la defensa real es validar() en guardarComercio.ts,
-- patrón del proyecto). Se backfillea 1:1 y se QUEDA nullable.
alter table comercios add column cuenta_id uuid references cuentas_comercio(id);

do $$
declare r record; nueva uuid;
begin
  for r in select id, nombre from comercios where cuenta_id is null loop
    insert into cuentas_comercio (nombre, limite_negocios)
      values (r.nombre, 1) returning id into nueva;
    update comercios set cuenta_id = nueva where id = r.id;
  end loop;
end $$;

-- Multi-login: el email deja de ser único global; pasa a único POR comercio (una persona puede
-- ser owner de varios comercios → varias filas con el mismo email/auth_user_id).
alter table usuarios_comercio drop constraint usuarios_comercio_email_key;
alter table usuarios_comercio
  add constraint usuarios_comercio_comercio_email_key unique (comercio_id, email);

-- sucursales: comparten la tarjeta/branding/QR del comercio (tarjetas ya es UNIQUE(cliente,comercio)).
create table sucursales (
  id uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references comercios(id),
  nombre text not null,
  activa boolean not null default true,
  created_at timestamptz not null default now()
);
alter table sucursales enable row level security;

-- Cajero atado a una sucursal (rol 'cajero' ya existe en el CHECK de la 0001).
alter table usuarios_comercio add column sucursal_id uuid references sucursales(id);

-- Atribución por transacción (ambas tablas nunca se leyeron en prod → bajo riesgo).
alter table transacciones_puntos add column sucursal_id uuid references sucursales(id);
alter table canjes add column sucursal_id uuid references sucursales(id);

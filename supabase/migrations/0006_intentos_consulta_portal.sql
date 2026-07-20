-- 0006: Portal del cliente — límite de intentos de consulta por IP.
-- Migraciones anteriores ya aplicadas a la base viva; todo cambio es append-only.
-- Esta tabla es autónoma (no referencia otras). El portal, además, LEE comercios.tipo_tarjeta y
-- comercios.sello_meta, que agrega la migración 0005 de la Fase 3 (prerrequisito de este plan).

create table intentos_consulta_portal (
  id uuid primary key default gen_random_uuid(),
  ip text not null,
  created_at timestamptz not null default now()
);

-- El límite se evalúa como "cuántos intentos de esta IP en los últimos 15 minutos". El índice
-- compuesto (ip, created_at) hace ese conteo eficiente (filtro por ip + rango de fecha) sin
-- escanear toda la tabla a medida que crece.
create index intentos_consulta_portal_ip_created_at_idx
  on intentos_consulta_portal (ip, created_at);

alter table intentos_consulta_portal enable row level security;
-- Sin políticas: deny-all salvo service_role, igual que el resto del esquema. El portal usa
-- createServiceClient() (ignora RLS), consistente con todo el proyecto.

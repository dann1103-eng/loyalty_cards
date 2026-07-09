-- 0002: Correcciones post-revisión de calidad de la migración 0001.
-- 0001 ya fue aplicada a la base viva y queda congelada; todo cambio es append-only.

-- CRÍTICO: activar RLS en clientes. La decisión del spec §4 ("global por diseño") significa
-- que clientes no lleva POLÍTICAS por comercio — no que RLS esté apagado. Todos los accesos
-- actuales usan el service client (que ignora RLS), así que esto no rompe nada; solo cierra
-- el acceso anónimo vía PostgREST a datos personales (nombres y teléfonos).
-- Sin políticas = deny-all salvo service_role, igual que las demás tablas.
alter table clientes enable row level security;

-- Índice para la consulta del PassKit Web Service (Tarea 10): "dame los seriales registrados
-- de ESTE dispositivo". device_library_identifier es la SEGUNDA columna del unique compuesto
-- (tarjeta_id, device_library_identifier), así que ese índice no cubre esta búsqueda.
create index apple_push_registrations_device_idx
  on apple_push_registrations (device_library_identifier);

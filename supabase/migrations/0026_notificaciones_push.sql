-- 0026: notificaciones push activas (campañas manuales + aviso de inactividad).
--
-- Ver docs/superpowers/specs/2026-07-29-notificaciones-push-design.md para el razonamiento
-- completo. Resumen: push disparado por el servidor, no por cercanía. Dos features separadas
-- (campaña manual, aviso de inactividad) comparten una función de envío y un registro de
-- auditoría — ese registro es también la fuente del candado de 3 mensajes/24h por tarjeta que
-- exige Google.

begin;

create table difusiones (
  id uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references comercios(id),
  -- null = todos los programas activos del comercio.
  programa_id uuid references programas_tarjeta(id),
  mensaje text not null check (btrim(mensaje) <> ''),
  -- Cuánto dura el mensaje en el reverso del pase. Lo elige el dueño, igual que campana_hasta en
  -- geopush (migración 0021) — una promo de "este fin de semana" y una de "todo el mes" duran lo
  -- que el dueño diga, no un número fijo del sistema.
  vigente_hasta date not null,
  creada_por uuid not null references usuarios_comercio(id),
  creada_en timestamptz not null default now(),
  -- Tarjetas a las que enviarMensajeTarjeta logró mandar por AL MENOS un canal — no el tamaño de
  -- la lista resuelta: con el candado de Google, pueden diferir.
  destinatarios integer not null default 0
);
create index difusiones_comercio_idx on difusiones (comercio_id, creada_en desc);
alter table difusiones enable row level security;

create table notificaciones_enviadas (
  id uuid primary key default gen_random_uuid(),
  tarjeta_id uuid not null references tarjetas(id),
  canal text not null check (canal in ('apple', 'google')),
  origen text not null check (origen in ('campana', 'inactividad')),
  -- Solo cuando origen='campana'; null en 'inactividad'. Trazabilidad de soporte: "¿a este
  -- cliente sí le llegó ESTA campaña puntual?".
  difusion_id uuid references difusiones(id),
  enviada_en timestamptz not null default now()
);
create index notificaciones_enviadas_tarjeta_idx on notificaciones_enviadas (tarjeta_id, enviada_en desc);
alter table notificaciones_enviadas enable row level security;
-- Ninguna de las dos tablas lleva políticas: deny-all, mismo criterio que programas_tarjeta
-- (0024). Todo acceso DEBE ir por createServiceClient() — con un cliente de sesión, cada
-- select/insert devuelve null/no-op en silencio en vez de un error.

-- Estado ACTUAL del aviso en el reverso de CADA tarjeta. construirReverso se reconstruye de cero
-- en cada regeneración del pase (una venta, un cambio de branding) — sin este campo persistido,
-- changeMessage no tendría qué comparar la próxima vez que el pase se regenere por OTRA razón.
alter table tarjetas
  add column aviso_texto text,
  add column aviso_hasta date; -- null junto con aviso_texto null = sin aviso vigente

-- Perillas del aviso de inactividad, junto a las de Tanda 1 (mismo patrón de columnas en comercios
-- que tope_acreditaciones_dia / espera_minima_minutos — migración 0015).
alter table comercios
  add column aviso_inactividad_activo boolean not null default false,
  add column aviso_inactividad_dias integer check (aviso_inactividad_dias is null or aviso_inactividad_dias > 0),
  add column aviso_inactividad_mensaje text;

-- Para no re-avisar cada día una vez cruzado el umbral (ver avisoInactividad.ts, Task 8).
alter table tarjetas add column aviso_inactividad_enviado_en timestamptz;

commit;

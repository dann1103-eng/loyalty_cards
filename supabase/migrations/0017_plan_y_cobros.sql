-- 0017: autogestión de plan y seguimiento de cobros.
--
-- Motivo: hoy el dueño no ve su plan, ni cuánto de su cupo consume, ni qué pagó. Todo eso vive solo
-- en /admin y se comunica por WhatsApp. Y para cambiar de plan tiene que escribir.
--
-- Fuera de alcance a propósito: el COBRO en sí. Stripe no acepta negocios de El Salvador y N1co
-- espera la personería jurídica, así que acá no hay pasarela: FM registra los cobros a mano y el
-- dueño los ve. Cuando exista la pasarela, el flujo de cambio de plan ya está construido.

-- ─────────────────────────────────────────────────────────────────────────────
-- Solicitudes de cambio de plan
-- ─────────────────────────────────────────────────────────────────────────────
-- El dueño pide, FM aprueba. No se aplica solo: sin cobro automático detrás, un cambio inmediato
-- dejaría que alguien pase a Pro sin pagarlo, y bajar de plan podría dejar la cuenta por encima de
-- su nuevo cupo (ver verificarLimiteCuenta en lib/comercios/cuentas.ts).
create table solicitudes_plan (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references cuentas_comercio(id),
  -- Se guarda el plan que la cuenta tenía AL SOLICITAR, no solo el pedido: sin eso, leer una
  -- solicitud vieja no dice de dónde venía, y el plan actual pudo cambiar desde entonces.
  plan_actual text not null,
  plan_solicitado text not null,
  motivo text,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'aprobada', 'rechazada')),
  -- Respuesta de FM. Un rechazo sin explicación deja al dueño sin saber qué hacer.
  comentario_fm text,
  resuelta_en timestamptz,
  created_at timestamptz not null default now(),
  -- Una solicitud resuelta SIEMPRE tiene fecha de resolución, y una pendiente nunca.
  check ((estado = 'pendiente') = (resuelta_en is null))
);

-- Como máximo UNA solicitud pendiente por cuenta. Índice único parcial, el mismo patrón que
-- sucursales.es_principal (0012) — es el caso que Postgres sí sabe expresar ("como máximo uno") y
-- evita que un dueño impaciente llene la bandeja de FM con diez solicitudes iguales.
create unique index solicitudes_plan_una_pendiente
  on solicitudes_plan (cuenta_id) where estado = 'pendiente';

create index solicitudes_plan_cuenta_idx on solicitudes_plan (cuenta_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Cobros
-- ─────────────────────────────────────────────────────────────────────────────
-- Registro de seguimiento, NO documentos fiscales. El comprobante que se puede imprimir lo dice
-- explícitamente en el propio documento: sin personería jurídica no hay DTE, y un papel que parezca
-- una factura sin serlo le crea un problema al comercio, no se lo resuelve.
create table cobros (
  id uuid primary key default gen_random_uuid(),
  -- Correlativo GLOBAL, no por cuenta: un correlativo por cuenta necesitaría contar filas al
  -- insertar (con su condición de carrera) y acá no aporta nada — no es una serie fiscal.
  numero bigint generated always as identity,
  cuenta_id uuid not null references cuentas_comercio(id),
  periodo_desde date not null,
  periodo_hasta date not null,
  monto numeric not null check (monto >= 0),
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'pagado', 'anulado')),
  -- Texto libre: transferencia, efectivo, N1co… No es una lista cerrada porque los medios de pago
  -- cambian y esto es seguimiento, no contabilidad.
  metodo text,
  nota text,
  pagado_en date,
  created_at timestamptz not null default now(),
  check (periodo_hasta >= periodo_desde),
  -- Un cobro marcado como pagado sin fecha de pago es exactamente el dato que después nadie puede
  -- reconstruir.
  check ((estado = 'pagado') = (pagado_en is not null))
);

create index cobros_cuenta_idx on cobros (cuenta_id, periodo_desde desc);

-- RLS habilitada sin políticas = deny-all salvo service_role, igual que el resto del esquema. La
-- autorización real vive en la capa TS (verifyComercioOwner / verifyFmAdmin).
alter table solicitudes_plan enable row level security;
alter table cobros enable row level security;

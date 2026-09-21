-- 0037: pasarela de pagos (Wompi).
--
-- Ver docs/superpowers/specs/2026-09-21-pasarela-wompi-design.md. Resumen: el dueño paga su plan desde la
-- app con un enlace de pago de Wompi, y cada pago que Wompi informa (por webhook, o que la app confirma
-- por consulta, o que FM aplica a mano) queda registrado en `pagos_wompi` y decide sobre un cobro.
--
-- MIGRACIÓN PRIMERO, DEPLOY DESPUÉS: todo lo que agrega esta migración lo escribe código NUEVO, así que
-- aplicarla antes del deploy no cambia nada de lo que corre hoy. Al revés (deploy sin migración) el
-- panel del dueño se rompe: las pantallas nuevas leen columnas que no existen.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- cobros: qué se cobra, qué plan se aplica al pagar, y el enlace de Wompi
-- ─────────────────────────────────────────────────────────────────────────────
alter table cobros
  -- 'periodo' = un mes completo (lo único que existía hasta hoy, por eso es el default y las filas
  -- viejas quedan bien). 'ajuste' = la diferencia prorrateada de subir de plan a mitad de período: NO
  -- abre un período nuevo, así que no cuenta para "próximo pago" ni para "período en curso".
  add column tipo text not null default 'periodo' check (tipo in ('periodo', 'ajuste')),
  -- El plan que se aplica cuando este cobro se confirma. null = solo renovar el plan actual.
  add column plan_destino text,
  add column wompi_id_enlace integer,
  add column wompi_url_enlace text,
  add column wompi_enlace_vence timestamptz,
  -- La transacción que pagó este cobro. Sirve para distinguir el REINTENTO de la misma transacción (se
  -- reaplica sin miedo) de un DOBLE PAGO con otra transacción (se marca ya_pagado).
  add column wompi_id_transaccion text,
  -- Un ajuste siempre dice a qué plan sube.
  add constraint cobros_ajuste_con_plan check (tipo <> 'ajuste' or plan_destino is not null);

-- Una transacción paga como máximo un cobro: la red de seguridad de la base contra un doble reclamo.
create unique index cobros_wompi_transaccion_uk
  on cobros (wompi_id_transaccion)
  where wompi_id_transaccion is not null;

-- Como máximo UN intento de pago abierto por cuenta: cierra la carrera de dos toques o dos pestañas.
-- Los cobros pendientes que registra FM a mano nunca llevan metodo = 'Wompi', así que no entran.
create unique index cobros_un_intento_pendiente
  on cobros (cuenta_id)
  where estado = 'pendiente' and metodo = 'Wompi';

-- ─────────────────────────────────────────────────────────────────────────────
-- pagos_wompi: un registro por cada transacción que nos informan
-- ─────────────────────────────────────────────────────────────────────────────
create table pagos_wompi (
  id uuid primary key default gen_random_uuid(),
  -- Idempotencia: una transacción se procesa UNA vez. Un webhook repetido, o el mismo pago que llega por
  -- webhook y por el redirect, cae en el mismo registro.
  id_transaccion text not null unique,
  fuente text not null check (fuente in ('webhook', 'redirect', 'manual')),
  -- null si el enlace no lo creó la app (uno hecho a mano en el panel de Wompi) o el cuerpo no se reconoció.
  cobro_id uuid references cobros(id),
  cuenta_id uuid references cuentas_comercio(id),
  -- Lo que la app mandó al crear el enlace (el id del cobro), o el de un enlace hecho a mano.
  identificador_enlace text,
  monto numeric not null default 0,
  es_real boolean not null default false,
  fecha_transaccion timestamptz,
  conciliacion text not null default 'pendiente' check (conciliacion in (
    'pendiente', 'aplicado', 'prueba', 'sin_cobro', 'cobro_anulado', 'monto_distinto',
    'ya_pagado', 'plan_no_aplicable', 'no_aprobada', 'error'
  )),
  detalle text,
  -- FM lo marcó como visto: lo saca de "necesita atención".
  revisado_en timestamptz,
  -- El cuerpo crudo. Trae nombre y correo del pagador: lo lee solo el admin.
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index pagos_wompi_created_idx on pagos_wompi (created_at desc);
create index pagos_wompi_cobro_idx on pagos_wompi (cobro_id);

-- RLS habilitada sin políticas = deny-all salvo service_role, igual que el resto del esquema. La
-- autorización real vive en la capa TS (verifyFmAdmin).
alter table pagos_wompi enable row level security;

commit;

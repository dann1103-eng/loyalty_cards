-- 0011: Plan/monto/estado de licencia pasan de comercios a cuentas_comercio (el cliente que paga,
-- no el negocio individual) — antes, 2 comercios de la MISMA cuenta podían tener licencias
-- distintas, lo cual no tiene sentido si es una sola suscripción. licencia_estado también se
-- mueve: pausar ahora afecta TODOS los comercios de la cuenta a la vez (antes era por comercio
-- individual — decisión revisada explícitamente para este fix, corrige la decisión 2 del spec de
-- Fase 6, ver docs/superpowers/plans/2026-07-25-plan-cuenta-facturacion.md).
--
-- El límite (limite_negocios, ya existente desde 0008) cambia de SIGNIFICADO en la capa app
-- (lib/comercios/cuentas.ts verificarLimiteCuenta): antes contaba solo comercios distintos; ahora
-- cuenta comercios Y sucursales JUNTOS. Acá solo se lo vuelve NULLABLE = "sin límite" (plan Pro),
-- en vez de un número mágico grande. El check existente (limite_negocios > 0) ya permite NULL sin
-- tocarlo: Postgres no rechaza una fila por un CHECK que evalúa a NULL, solo por uno que evalúa a
-- false — por eso no hace falta drop/recreate del constraint.
--
-- Primera migración del proyecto con un DROP COLUMN (0001-0010 son solo aditivas o cambian tipo/
-- constraint in-place). begin/commit explícitos para no depender de que el editor SQL de Studio
-- trate el pegado completo como una sola transacción implícita: si la guardia de abajo aborta a
-- mitad de camino, esto asegura que NADA quede a medio aplicar (ni las columnas nuevas en
-- cuentas_comercio, ni el backfill, ni el drop en comercios) en vez de un estado parcial.
begin;

alter table cuentas_comercio
  alter column limite_negocios drop not null,
  add column plan text check (plan is null or plan in ('starter', 'growth', 'pro')),
  add column licencia_estado text not null default 'activo'
    check (licencia_estado in ('activo', 'inactivo')),
  add column licencia_monto_mensual numeric,
  -- date, NO timestamptz: fix de la migración 0004 sobre esta MISMA columna en comercios ("es
  -- semánticamente una FECHA... con timestamptz, El Salvador (UTC-6) renderizaría el día anterior
  -- en cada fila"). Revertir a timestamptz reintroduciría ese off-by-one silencioso. PostgREST
  -- sigue devolviendo `date` como "2026-07-16" (string) — el tipo de TypeScript no cambia.
  add column licencia_activa_desde date;

-- Guardia defensiva: el backfill de abajo asume 1:1 comercio↔cuenta (verificado a mano antes de
-- escribir esta migración con un script de solo lectura: 6/6 comercios con cuenta_id único). Si
-- para cuando esto se corre en Studio algún comercio YA se reasignó a una cuenta compartida (el
-- flujo "Vincular" del panel FM ya existe en producción), el UPDATE de abajo matchearía varias
-- filas de comercios contra una sola fila de cuentas_comercio y Postgres elegiría una de forma no
-- determinística — descartando en silencio los datos de licencia de las demás. Esto lo convierte
-- en un error ruidoso en vez de una corrupción silenciosa.
do $$
begin
  if exists (
    select cuenta_id from comercios where cuenta_id is not null
    group by cuenta_id having count(*) > 1
  ) then
    raise exception 'Hay cuentas con más de un comercio — revisar el backfill manualmente antes de continuar.';
  end if;
end $$;

-- Backfill: se copia estado/monto/fecha de cada comercio a su cuenta (1:1, ver guardia arriba).
-- `plan` se deja NULL a propósito: los 6 comercios reales hoy tienen licencia_plan='Demo' o null
-- (piloto/demo, ninguno es un cliente pagando un plan real de Cardly) — mapearlos a
-- 'starter'/'growth'/'pro' inventaría un dato que no existe. FM le asigna un plan real a cada
-- cuenta la próxima vez que la edite (la capa app lo exige desde este fix en adelante — ver
-- validarDatosCuenta en cuentas.ts).
update cuentas_comercio c
set licencia_estado = co.licencia_estado,
    licencia_monto_mensual = co.licencia_monto_mensual,
    licencia_activa_desde = co.licencia_activa_desde
from comercios co
where co.cuenta_id = c.id;

alter table comercios
  drop column licencia_estado,
  drop column licencia_plan,
  drop column licencia_monto_mensual,
  drop column licencia_activa_desde;

commit;

-- 0034: aviso antes del vencimiento, por programa.
--
-- Ver docs/superpowers/specs/2026-09-09-aviso-antes-del-vencimiento-design.md.
--
-- El único aviso automático que existía se dispara por INACTIVIDAD, y ese disparador no sirve para
-- un negocio de membresías: un socio que renovó ayer y viene todas las semanas no está inactivo, y
-- sin embargo su membresía se le vence igual. Esta migración agrega lo necesario para avisarle ANTES.
--
-- Es ADITIVA: el único CHECK que toca se AMPLÍA, nunca se restringe. Por eso se aplica antes del
-- deploy sin romper el código en producción.
begin;

-- Configuración del aviso, por PROGRAMA. Espeja la del aviso de inactividad, que vive en
-- `comercios` (0026), pero acá va en el programa por dos motivos: el mensaje depende del TIPO
-- ("renová tu membresía" no es "usá tu cupón") y un comercio puede tener los dos programas activos a
-- la vez; y es donde ya vive el plazo que se está por vencer (membresia_dias, cupon_vigencia_dias).
--
-- El tope de 90 es de cordura. El cruce que de verdad importa —que la anticipación NO alcance al
-- plazo del programa, o el socio recibe "está por vencer" al día siguiente de pagar— depende del
-- tipo y de otra columna, así que vive en la validación de aplicación (avisoVencimiento.ts), no acá.
alter table programas_tarjeta
  add column aviso_vencimiento_activo boolean not null default false,
  add column aviso_vencimiento_dias integer
    check (aviso_vencimiento_dias is null or (aviso_vencimiento_dias > 0 and aviso_vencimiento_dias <= 90)),
  add column aviso_vencimiento_mensaje text
    check (aviso_vencimiento_mensaje is null or char_length(aviso_vencimiento_mensaje) <= 200);

-- PARA QUÉ vencimiento ya se avisó. Es una FECHA y no un booleano a propósito: el cron manda solo si
-- esta fecha es distinta de `vigencia_hasta`, así que al renovar —cuando `vigencia_hasta` cambia— el
-- aviso del período siguiente sale solo. Un booleano `aviso_enviado` habría necesitado un reset
-- dentro de `renovar_membresia_atomico`, o sea acoplar el RPC de renovación a una feature de
-- notificaciones: el tipo de acoplamiento que ya mordió a este proyecto con `sello_meta`.
alter table tarjetas
  add column aviso_vencimiento_para date;

-- El origen nuevo en la auditoría. Sin esto el insert en notificaciones_enviadas falla con 23514 y
-- el push se manda igual: quedaría un envío sin rastro, que es lo contrario de para qué existe la
-- tabla. `if exists` por el precedente de la 0019, que hizo este mismo movimiento sobre
-- transacciones_puntos_tipo_check.
alter table notificaciones_enviadas
  drop constraint if exists notificaciones_enviadas_origen_check;
alter table notificaciones_enviadas
  add constraint notificaciones_enviadas_origen_check
    check (origen in ('campana', 'inactividad', 'vencimiento'));

commit;

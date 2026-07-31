-- 0029: reverso por programa de tarjeta.
--
-- El espejo de la 0027 (branding por programa) para el REVERSO: cada programa puede tener sus
-- propios términos y sus propias redes, y hereda los del comercio en todo lo que no defina. Con
-- dos tarjetas del mismo negocio en la billetera —la de sellos y el cupón de campaña— el cupón
-- suele necesitar decir otra cosa al dorso.
--
-- OJO — esta migración YA ESTABA APLICADA en la base cuando se escribió este archivo (el usuario la
-- corrió a mano en Studio, que es el flujo del proyecto, pero el .sql nunca llegó al repo). Se
-- reconstruye acá para que la historia de migraciones describa el esquema real; el estado de la
-- base se verificó con `scripts/verificar-0029.ts`. NO volver a correrla: `add column` sin
-- `if not exists` falla sobre columnas que ya existen.
begin;

alter table programas_tarjeta
  add column terminos_uso text,
  add column red_instagram text,
  add column red_facebook text,
  add column red_whatsapp text,
  add column sitio_web text,
  -- NULLABLE a propósito, a diferencia de comercios.mostrar_como_funciona (0013), que es NOT NULL
  -- con default true. Acá `null` es un valor con significado: "no lo definí, heredá el del
  -- comercio". Con un default true, todo programa nacería forzando la sección encendida y la
  -- herencia no existiría para este campo.
  add column mostrar_como_funciona boolean,
  -- El interruptor maestro, igual que branding_propio en la 0027: manda SOBRE los campos, así
  -- apagarlo no obliga al dueño a limpiar cada columna y volver a encenderlo le devuelve lo que
  -- tenía. Nace en false: los programas existentes heredan y ninguna tarjeta viva cambia de
  -- reverso al aplicar esto.
  add column reverso_propio boolean not null default false;

commit;

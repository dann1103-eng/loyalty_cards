-- 0036: el apellido del cliente, para el frente del pase con NOMBRE y APELLIDO.
--
-- Ver docs/superpowers/specs/2026-09-17-frente-del-pase-como-los-disenos-design.md.
--
-- Hasta acá `clientes` guardaba un solo `nombre`, y el registro pedía "Tu nombre" con
-- autocomplete="name": muchos clientes tienen el nombre completo ahí. El pase nuevo lleva NOMBRE y
-- APELLIDO en dos campos, y partir el nombre existente en la primera palabra fallaría con los
-- compuestos ("María José López"), así que el apellido se PIDE al registrarse.
--
-- Es NULLABLE a propósito: los clientes que ya existen no lo tienen, y no se les completa después
-- (un cliente que ya existe no recibe apellido al registrarse en otro programa: dejaría que
-- cualquiera que conozca un teléfono le escriba un apellido a otra persona). Esos pases muestran
-- solo NOMBRE.
--
-- ADITIVA: se aplica ANTES del deploy. El insert del registro nuevo escribe esta columna, y sin ella
-- fallaría el alta entera, no solo el apellido.
--
-- El CHECK espeja la validación de aplicación (recortado, 1 a 120) igual que la hace el nombre en
-- /api/registro: este texto se interpola en el .pkpass y en el objeto de Google.
begin;

alter table clientes
  add column apellido text
    check (apellido is null or (btrim(apellido) <> '' and char_length(apellido) <= 120));

commit;

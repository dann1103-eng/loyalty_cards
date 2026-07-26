-- 0013: reverso configurable de la tarjeta.
--
-- El pass de Apple no tenia reverso: el cliente que tocaba la "i" de su tarjeta no encontraba nada.
-- Estas columnas guardan lo que el dueno escribe (terminos de uso) y lo que aporta (sus redes).
--
-- La seccion "Como funciona" NO se guarda acá a proposito: se arma en cada generacion del pass
-- leyendo reglas_puntos y recompensas, para que no pueda quedar prometiendole al cliente una
-- recompensa que el dueno ya cambio. Ver docs/superpowers/specs/2026-07-26-reverso-tarjeta-configurable-design.md
alter table comercios
  add column terminos_uso text,
  add column red_instagram text,
  add column red_facebook text,
  add column red_whatsapp text,
  add column sitio_web text,
  -- default true: los comercios que ya existen quedan con la seccion automatica encendida, que es el
  -- comportamiento deseado. El dueno la apaga si prefiere redactar todo el mismo en los terminos.
  add column mostrar_como_funciona boolean not null default true;

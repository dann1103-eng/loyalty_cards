-- 0042 — TikTok en el reverso, y elegir si la foto se oscurece detrás de los sellos.
--
-- Dos pedidos de Daniel del 2026-10-06, en una sola migración para aplicarla una vez.
--
-- 1. red_tiktok: el link del TikTok del comercio, igual que ya pone Instagram, Facebook, WhatsApp y
--    su sitio. La misma columna de texto que las otras redes, en los mismos dos niveles: `comercios`
--    (0013) y `programas_tarjeta` (0029, donde NULL = heredar). Sin CHECK, como las otras: la
--    exigencia de https:// y el tope de 500 caracteres los pone normalizarReverso
--    (lib/comercio/guardarReverso.ts).
--
-- 2. oscurecer_franja: si la foto de fondo de la franja lleva el velo oscuro cuando encima va la
--    GRILLA DE SELLOS. Hasta hoy iba siempre (para que los sellos resalten); hay comercios que
--    prefieren ver su foto tal cual.
--      comercios          NOT NULL DEFAULT true  -> todos quedan como están hoy.
--      programas_tarjeta  nullable               -> NULL = "no lo toqué". Viaja CON LA FOTO, igual que
--                                                   el encuadre (0032): solo cuenta si la tarjeta
--                                                   tiene foto propia (ver brandingEfectivo).
--    No afecta a los otros tipos de tarjeta: ahí el velo depende de si hay texto escrito encima.
--
-- ADITIVA: ninguna fila cambia de aspecto y ninguna función ni vista nombra estas columnas. Volver
-- atrás: drop de las cuatro columnas.
begin;

alter table comercios
  add column red_tiktok text,
  add column oscurecer_franja boolean not null default true;

alter table programas_tarjeta
  add column red_tiktok text,
  add column oscurecer_franja boolean;

commit;

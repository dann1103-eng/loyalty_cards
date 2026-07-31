-- 0027: branding por programa de tarjeta.
--
-- Ver docs/superpowers/specs/2026-07-30-branding-por-programa-design.md para el razonamiento
-- completo. Resumen: cada programa puede tener su propio logo, colores e imágenes; `null` significa
-- "heredá el del comercio", así que ningún comercio existente cambia de aspecto al aplicar esto.
begin;

alter table programas_tarjeta
  add column color_fondo text,
  add column color_texto text,
  add column color_label text,
  add column logo_url text,
  add column hero_url text,
  add column strip_url text,
  add column sello_icono_url text,
  add column difuminado_franja text,
  -- DOS estados separados a propósito. google_class_id registra que la clase EXISTE en Google y
  -- una vez seteado NUNCA vuelve a null: las clases no se borran (la API no tiene delete) y un
  -- segundo insert sobre el mismo id falla. branding_propio dice si el programa usa SU branding o
  -- hereda el del comercio — apagarlo NO obliga a limpiar cada columna.
  add column google_class_id text,
  add column branding_propio boolean not null default false;

commit;

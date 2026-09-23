-- 0039: monto mínimo de compra y reseña de Google antes del registro
-- (spec 2026-09-23-onboarding-manifest-monto-resena-design.md, secciones 2 y 3).
--
-- Motivo: dos perillas nuevas por comercio, sin relación entre sí más que nacer en el mismo
-- onboarding real (2026-09-22). (a) El dueño ya puede pedir el monto de la compra
-- (`pedir_monto_compra`, migración 0015) pero ese monto no gatea nada; ahora puede EXIGIRLO y fijar
-- un mínimo de compra para sumar sellos/puntos. (b) El dueño puede pedirle al cliente que deje una
-- reseña en Google antes de sacar su tarjeta (sistema de honor, sin verificación real).
--
-- Todas las filas existentes cumplen los CHECK sin backfill: las cuatro columnas nacen en su
-- default (false/null) y las dos implicaciones son ciertas cuando el lado izquierdo es false/null.
-- `pedir_monto_compra` es NOT NULL desde la 0015, así que la implicación (a) no depende de una
-- columna que pudiera ser null.
begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- (a) Monto mínimo de compra (spec §2)
-- ─────────────────────────────────────────────────────────────────────────────
alter table comercios
  add column exigir_monto_compra boolean not null default false,
  add column monto_minimo_compra_centavos integer
    check (monto_minimo_compra_centavos is null or monto_minimo_compra_centavos > 0),
  add constraint comercios_exigir_implica_pedir
    check (not exigir_monto_compra or pedir_monto_compra),
  add constraint comercios_minimo_implica_exigir
    check (monto_minimo_compra_centavos is null or exigir_monto_compra);

-- ─────────────────────────────────────────────────────────────────────────────
-- (b) Reseña de Google antes del registro (spec §3)
-- ─────────────────────────────────────────────────────────────────────────────
alter table comercios
  add column pedir_resena_google boolean not null default false,
  add column resena_google_url text
    check (resena_google_url is null or char_length(resena_google_url) <= 500),
  add constraint comercios_resena_con_link
    check (not pedir_resena_google or resena_google_url is not null);

commit;

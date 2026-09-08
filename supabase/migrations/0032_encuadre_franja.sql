-- 0032: encuadre de la foto de fondo de la franja (modo, foco y zoom).
--
-- Ver docs/superpowers/specs/2026-09-08-editor-marca-por-tipo-y-encuadre-franja-design.md. Con los
-- defaults, todo lo existente se ve exactamente igual que hoy (cover centrado). Los CHECK son la
-- defensa barata; la real es validarEncuadre/encuadreDelComercio en lib/comercio/encuadreFranja.ts.
begin;

alter table comercios
  add column encuadre_franja text not null default 'llenar'
    check (encuadre_franja in ('llenar', 'completa')),
  add column foco_franja_x smallint not null default 50 check (foco_franja_x between 0 and 100),
  add column foco_franja_y smallint not null default 50 check (foco_franja_y between 0 and 100),
  add column zoom_franja smallint not null default 100 check (zoom_franja between 100 and 300);

-- En el programa las cuatro nacen null: "no lo toqué". Se leen como UNIDAD (encuadreDelPrograma):
-- si alguna es null, el programa no tiene encuadre propio. El encuadre VIAJA CON LA FOTO: solo
-- cuenta cuando el programa tiene hero_url propio (ver brandingEfectivo).
alter table programas_tarjeta
  add column encuadre_franja text check (encuadre_franja in ('llenar', 'completa')),
  add column foco_franja_x smallint check (foco_franja_x between 0 and 100),
  add column foco_franja_y smallint check (foco_franja_y between 0 and 100),
  add column zoom_franja smallint check (zoom_franja between 100 and 300);

commit;

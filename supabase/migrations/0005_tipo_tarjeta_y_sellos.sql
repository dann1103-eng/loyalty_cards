-- 0005: Catálogo de tipos de tarjeta + campos de tarjetas de sellos.
-- Migraciones anteriores ya aplicadas a la base viva; todo cambio es append-only.

-- El tipo de tarjeta que FM habilita para el comercio (parte de lo que FM "vende", como la
-- licencia — NO algo que el dueño elija libremente). 8 valores del catálogo completo; solo
-- 'puntos' y 'sellos' son funcionales esta fase (los otros 6 aparecen como "Próximamente" en el
-- panel de FM). CHECK en la BD porque es una lista fija y pequeña de 8 strings, no un formato con
-- infinitas variantes válidas (a diferencia del color) — mismo criterio que licencia_estado.
alter table comercios
  add column tipo_tarjeta text not null default 'puntos'
    check (tipo_tarjeta in ('puntos', 'sellos', 'cashback', 'membresia', 'descuento', 'cupon', 'prepago', 'gift_card'));

-- Solo aplican cuando tipo_tarjeta = 'sellos'. Nullable: sin sentido en otros tipos. Los llena
-- el DUEÑO desde su panel de autogestión; FM solo asigna tipo_tarjeta. sello_icono_url se guarda
-- y se usa en la vista previa web (spec §6) y en el futuro portal del cliente — NO en el pass
-- firmado todavía. sello_meta es el denominador del texto "N de M sellos" del pass.
alter table comercios add column sello_icono_url text;
alter table comercios add column sello_meta integer check (sello_meta is null or sello_meta > 0);

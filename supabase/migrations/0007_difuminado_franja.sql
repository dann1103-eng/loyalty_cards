-- 0007: Intensidad del difuminado de bordes de la franja del pass (comercios.difuminado_franja).
-- Migraciones anteriores ya aplicadas a la base viva; todo cambio es append-only.
-- Controla cuánto se funde la foto de fondo (hero_url) hacia el color de la tarjeta en los
-- cuatro bordes de la franja. 'ninguno' = corte seco (comportamiento previo a este ajuste).
alter table comercios
  add column difuminado_franja text not null default 'medio'
    check (difuminado_franja in ('ninguno', 'sutil', 'medio', 'fuerte'));

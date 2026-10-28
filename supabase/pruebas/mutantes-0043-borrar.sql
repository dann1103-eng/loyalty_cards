-- Borra los cuatro mutantes de la migracion 0043 (los crea mutantes-0043.sql). La funcion real
-- emitir_tarjeta no se toca.
begin;

drop function if exists emitir_tarjeta_mut_a(uuid, uuid, uuid, date);
drop function if exists emitir_tarjeta_mut_b(uuid, uuid, uuid, date);
drop function if exists emitir_tarjeta_mut_c(uuid, uuid, uuid, date);
drop function if exists emitir_tarjeta_mut_d(uuid, uuid, uuid, date);

commit;

notify pgrst, 'reload schema';

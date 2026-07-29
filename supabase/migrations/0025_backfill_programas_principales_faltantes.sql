-- 0025: backfill de programas principales faltantes.
--
-- La 0024 le dio un programa principal a cada comercio que existía EN ESE MOMENTO. Todo comercio
-- creado DESPUÉS de esa migración (y antes de que crearComercio() empezara a llamar a
-- crearProgramaPrincipal — ver lib/comercios/guardarComercio.ts) nació sin programa: sin uno,
-- registrarCliente no puede resolver ninguno y el alta de clientes en ese comercio queda rota
-- desde el primer minuto. Verificado en producción con scripts/verificar-0024.ts: 27 comercios,
-- solo 8 con programa principal.
--
-- Este backfill le da a los comercios que quedaron afuera el mismo tratamiento que la 0024 le dio
-- a los suyos: un programa principal que espeja su tipo_tarjeta actual. Ninguna tarjeta necesita
-- tocarse acá — verificado que las 21 existentes ya tenían programa_id (solo pudieron nacer en un
-- comercio que sí tenía principal, porque registrarCliente exige uno).

begin;

insert into programas_tarjeta (comercio_id, nombre, slug, tipo_tarjeta, es_principal, activo)
select c.id, c.nombre, 'principal', c.tipo_tarjeta, true, true
from comercios c
where not exists (
  select 1 from programas_tarjeta p where p.comercio_id = c.id and p.es_principal
);

do $$
declare v_sin_principal integer;
begin
  select count(*) into v_sin_principal
  from comercios c
  where not exists (select 1 from programas_tarjeta p where p.comercio_id = c.id and p.es_principal);
  if v_sin_principal > 0 then
    raise exception 'Quedaron % comercios sin programa principal: se aborta', v_sin_principal;
  end if;
end $$;

commit;

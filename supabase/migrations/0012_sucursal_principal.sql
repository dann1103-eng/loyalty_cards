-- 0012: sucursal "Principal" por comercio. La primera sucursal de todo comercio pasa a ser su
-- principal: no consume cupo del plan (la aplica la capa app), no se puede desactivar (capa app),
-- y es la default para cajeros/atribución. Máximo una por comercio (índice parcial).

alter table sucursales add column es_principal boolean not null default false;

create unique index sucursales_principal_unica on sucursales (comercio_id) where es_principal;

-- Backfill 1: comercios que YA tienen sucursales → la más antigua pasa a principal (desempate por
-- id para que sea determinista). El dueño puede renombrarla, así que no impone nada.
update sucursales s
set es_principal = true
where s.id = (
  select s2.id from sucursales s2
  where s2.comercio_id = s.comercio_id
  order by s2.created_at, s2.id
  limit 1
);

-- Backfill 2: una principal debe estar disponible — si la elegida estaba inactiva, se reactiva
-- (sin esto, un comercio con todas sus sucursales apagadas seguiría sin poder crear cajeros).
update sucursales set activa = true where es_principal and not activa;

-- Backfill 3: comercios SIN sucursales → se les crea su "Principal" activa.
insert into sucursales (comercio_id, nombre, activa, es_principal)
select c.id, 'Principal', true, true
from comercios c
where not exists (select 1 from sucursales s where s.comercio_id = c.id);

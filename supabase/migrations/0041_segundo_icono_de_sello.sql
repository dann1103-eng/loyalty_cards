-- 0041 — Segundo ícono de sello y el patrón con que se reparte en la grilla.
--
-- Pedido de Daniel (2026-10-05): en las tarjetas físicas los comercios suelen intercalar dos sellos
-- distintos, o marcar el último con otro dibujo para que se entienda que ahí está el premio. Hoy
-- cada programa tiene UN ícono (sello_icono_url) que se repite en todas las casillas.
--
-- Tres columnas, en `comercios` y en `programas_tarjeta` (la marca vive en los dos niveles desde la
-- 0027; el programa hereda del comercio lo que no define):
--
--   sello_icono_2_url  El segundo ícono. NULL = no hay segundo: la grilla se dibuja como hoy, y las
--                      otras dos columnas no se miran.
--   sello_patron       Dónde va el segundo ícono. NULL se lee como 'intercalado'.
--                        intercalado  casillas 2, 4, 6…
--                        mitades      la segunda mitad de la grilla
--                        ultimo       solo la última casilla (la del premio)
--                        casillas     las que diga sello_casillas
--   sello_casillas     Posiciones (desde 1) del segundo ícono cuando el patrón es 'casillas'.
--
-- ADITIVA: las tres nacen en NULL en todas las filas, ningún CHECK puede fallar sobre datos
-- existentes y ninguna función ni vista las nombra. Volver atrás: drop de las seis columnas.
--
-- Los CHECK son la red barata. La defensa real es sanearPatronSellos (lib/tarjetas/patronSellos.ts),
-- que corre al leer y al guardar: una posición fuera de la grilla se IGNORA al dibujar (la meta de
-- sellos puede cambiar después de guardado el patrón), no se rechaza acá.
begin;

alter table comercios
  add column sello_icono_2_url text,
  add column sello_patron text
    constraint comercios_sello_patron_check
    check (sello_patron is null or sello_patron in ('intercalado', 'mitades', 'ultimo', 'casillas')),
  add column sello_casillas smallint[]
    constraint comercios_sello_casillas_check
    check (sello_casillas is null or cardinality(sello_casillas) <= 30);

alter table programas_tarjeta
  add column sello_icono_2_url text,
  add column sello_patron text
    constraint programas_tarjeta_sello_patron_check
    check (sello_patron is null or sello_patron in ('intercalado', 'mitades', 'ultimo', 'casillas')),
  add column sello_casillas smallint[]
    constraint programas_tarjeta_sello_casillas_check
    check (sello_casillas is null or cardinality(sello_casillas) <= 30);

commit;

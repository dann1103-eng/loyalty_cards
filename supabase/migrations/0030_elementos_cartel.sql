-- 0030: elementos libres del cartel — textos y franjas de color puestos donde el dueño quiera.
--
-- Hasta acá el cartel tenía exactamente dos textos (la frase principal y la segunda línea) en
-- posiciones fijas de la plantilla. Esto agrega una lista de elementos EXTRA que el dueño coloca por
-- coordenada, encima del diseño de la plantilla.
--
-- Aditivo y con default: toda fila existente estrena '[]' y ningún cartel ya diseñado cambia ni un
-- píxel. Agregar una columna con default constante es metadato en PG 11+, no reescribe la tabla.
--
-- POR QUÉ jsonb Y NO UNA TABLA HIJA: estos elementos no se consultan, ni se filtran, ni se agregan,
-- ni los referencia nadie más — se leen SIEMPRE completos junto a su fila de disenos_cartel y se
-- pisan completos al guardar. Una tabla hija costaría un join y una transacción de borrar-e-insertar
-- para comprar una capacidad que ninguna pantalla necesita.
begin;

alter table disenos_cartel
  add column elementos jsonb not null default '[]'::jsonb
    -- Lo que el CHECK sí puede garantizar barato: que sea una lista y que esté acotada. La FORMA de
    -- cada elemento (tipos, rangos, colores) la valida `sanearElementos` en
    -- lib/comercio/cartel/elementos.ts, que es la única defensa real y descarta lo que no entiende
    -- en vez de dejar que llegue al SVG. El tope de 12 existe para que un cliente con un bug no
    -- pueda engordar la fila sin límite; un cartel con 12 extras ya está saturado.
    check (jsonb_typeof(elementos) = 'array' and jsonb_array_length(elementos) <= 12);

commit;

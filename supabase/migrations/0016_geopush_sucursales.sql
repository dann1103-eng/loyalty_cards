-- 0016: geolocalización por sucursal (geopush).
--
-- Motivo: la competencia vende "notificación cuando el cliente pasa cerca del local" y hoy no
-- tenemos ni un dato de ubicación en toda la base. Apple y Google lo resuelven ELLOS a partir de
-- ubicaciones grabadas dentro del pase: no hace falta backend propio para disparar la notificación,
-- solo cargar y mantener las coordenadas.
--
-- Asimetría a tener presente (medida contra la documentación de ambos, 2026-07-28):
--   - iPhone: la tarjeta se sugiere en la pantalla de bloqueo con NUESTRO texto (relevantText, 128
--     caracteres), radio ~100 m, y MÁXIMO 10 UBICACIONES POR PASE. Sin sonido: es una sugerencia.
--   - Android: notificación real con sonido, radio ~150 m, tope de 4 por usuario por día, pero el
--     TEXTO LO PONE GOOGLE y no se puede editar.
-- O sea que `mensaje_cercania` solo se ve en iPhone. Es correcto igual: es el que sirve para
-- marketing, y en Android la notificación llega de todas formas.

alter table sucursales
  -- numeric(9,6): 3 dígitos enteros (alcanza para -180) y 6 decimales (~0.11 m de precisión, muy
  -- por debajo del radio de ~100 m que usan las dos plataformas). Nullable porque una sucursal sin
  -- coordenadas es un estado normal: recién creada, o el dueño todavía no las cargó.
  add column latitud numeric(9,6)
    check (latitud is null or (latitud >= -90 and latitud <= 90)),
  add column longitud numeric(9,6)
    check (longitud is null or (longitud >= -180 and longitud <= 180)),
  -- 128 es el límite duro de relevantText en PassKit. Un texto más largo no lo rechaza Apple: lo
  -- CORTA en silencio, que es peor. El CHECK lo ataja acá y la capa TS da el mensaje en español.
  add column mensaje_cercania text
    check (mensaje_cercania is null or char_length(mensaje_cercania) <= 128),
  -- Qué sucursales participan del geopush. Lo elige el dueño (decisión del 2026-07-28) en vez de
  -- que el sistema tome las primeras 10 en silencio: Apple ignora de la 11 en adelante SIN avisar,
  -- y un fallo callado en una feature de marketing es indistinguible de "no funciona".
  add column geopush_activo boolean not null default false;

-- Sin coordenadas no hay geopush posible, así que la combinación no debe poder existir. Este SÍ es
-- un candado que vale la pena en la BD y no solo en TS: una sucursal marcada como activa pero sin
-- coordenadas generaría un `locations` inválido dentro del .pkpass, y un pase mal formado no lo
-- rechaza el servidor — lo rechaza el teléfono del cliente, donde ya no se puede diagnosticar.
alter table sucursales
  add constraint sucursales_geopush_necesita_coordenadas
    check (not geopush_activo or (latitud is not null and longitud is not null));

-- EL TOPE DE 10 POR COMERCIO NO SE EXPRESA ACÁ. Postgres resuelve "como máximo UNO" con un índice
-- único parcial (así se hace es_principal en la 0012), pero "como máximo DIEZ" necesitaría un
-- trigger o una constraint diferida, y este proyecto pone la validación en la capa TS a propósito
-- (CLAUDE.md). Vive en lib/comercio/sucursales.ts, junto al mensaje en español que explica cuál es
-- el límite y por qué.

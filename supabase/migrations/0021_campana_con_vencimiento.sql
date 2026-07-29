-- 0021: mensaje de campaña con fecha de fin, para el aviso por cercanía.
--
-- Motivo: el mensaje de la 0016 es PERMANENTE. `MerchantLocation` de Google no tiene campo de
-- vencimiento y `relevantText` de Apple vive grabado dentro del .pkpass hasta que lo cambiemos, así
-- que un "2x1 este fin de semana" seguiría ahí en agosto y el año que viene. Servía para un mensaje
-- estable ("Pasá por tu café"), no para una promoción — y una promoción sin fecha de fin no es una
-- campaña, es un cartel que se quedó pegado.
--
-- El modelo pasa a ser BASE + CAMPAÑA:
--   - mensaje_cercania (0016) se vuelve el mensaje BASE: permanente, el que describe al negocio.
--   - mensaje_campana + campana_hasta son la promoción temporal, que TAPA al base mientras vive.
-- Al vencer, se vuelve solo al base. El dueño no tiene que acordarse de entrar a limpiarlo, que es
-- justo lo que nadie hace.

alter table sucursales
  -- Mismo límite de 128 que mensaje_cercania: es el tope de relevantText en PassKit, y Apple no lo
  -- rechaza — lo CORTA en silencio.
  add column mensaje_campana text
    check (mensaje_campana is null or char_length(mensaje_campana) <= 128),
  -- Último día en que se muestra la campaña, INCLUSIVE. Fecha y no timestamp por la misma razón que
  -- vigencia_hasta en tarjetas (0018): "hasta el 30" es el 30 completo en el local.
  add column campana_hasta date;

-- Una campaña sin fecha nunca terminaría —que es exactamente el problema que esta migración viene a
-- resolver— y una fecha sin mensaje no muestra nada. Las dos o ninguna.
alter table sucursales
  add constraint sucursales_campana_completa
    check ((mensaje_campana is null) = (campana_hasta is null));

-- Lo usa el trabajo diario que apaga las campañas vencidas: busca las que terminaron ayer para
-- re-emitir los pases de ese comercio. Sin ese empujón, el mensaje viejo se queda en el teléfono
-- del cliente que no vuelve a pasar por caja.
create index sucursales_campana_hasta_idx on sucursales (campana_hasta)
  where campana_hasta is not null;

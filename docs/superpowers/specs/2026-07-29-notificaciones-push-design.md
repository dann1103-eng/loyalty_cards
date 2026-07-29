# Notificaciones push activas — diseño

Fecha: 2026-07-29.

## Por qué

El geopush (migración 0016 + 0021) es **pasivo**: graba coordenadas y un mensaje dentro del pase, y
es el propio iPhone/Android el que decide mostrarlo cuando detecta cercanía. El servidor nunca
"manda" nada en ese momento.

El dueño pidió algo distinto: poder mandar un mensaje **activo**, disparado desde el servidor, sin
depender de la ubicación del cliente — para dos casos:

1. Un cliente lleva N días sin usar su tarjeta → recordatorio automático, mensaje configurable.
2. El comercio tiene una campaña o promo → el dueño manda un mensaje a sus clientes cuando quiere.

## La asimetría de plataforma (investigado 2026-07-29)

Esto no es simétrico entre Apple y Google, y la diferencia cambia el diseño:

**Apple** no tiene una API de "mandar una notificación". El push a un pase es SIEMPRE un payload
vacío (`{}`) — un aviso de "andá a refrescarte", nada más (`lib/apple/enviarPush.ts`, ya
construido). Lo único que produce un aviso visible en la pantalla de bloqueo es que un CAMPO del
pase cambie de valor y tenga un `changeMessage` (con `%@` como marcador de sustitución) — ahí sí
iOS muestra ese texto. Sin `changeMessage`, un campo que cambia solo dispara el genérico "Pass
Updated".

Más importante: Apple trata el push de pases como una utilidad, no un canal de marketing. Sus
lineamientos restringen los avisos a lo "relevante al pase" (saldo que cambió, oferta por vencer) y
tratan el abuso para marketing genérico como motivo de **revocación de privilegios** — el mismo
mecanismo del que depende HOY la actualización de saldo tras cada venta. Fuentes: [PassKit Support
Center](https://help.passkit.com/en/articles/11905171-understanding-push-notifications-for-apple-and-google-wallet-passes),
[Apple Developer Forums](https://developer.apple.com/forums/thread/76308).

**Google** sí tiene una API real (`addMessage` sobre `LoyaltyClass`/`LoyaltyObject`), documentada y
pensada explícitamente para ofertas de retail — pero con un tope técnico duro: **máximo 3 mensajes
que disparan notificación por pase cada 24 horas**, aplicado por throttling (el cuarto no llega, no
avisa que no llegó). Fuente: [Google Wallet API — Trigger Push
Notifications](https://developers.google.com/wallet/retail/offers/use-cases/trigger-push-notifications).

**Decisión: aceptar la asimetría.** En Android el cliente recibe una notificación real; en iPhone
recibe algo más sutil (el mensaje asoma en la pantalla de bloqueo como una actualización de la
tarjeta). No se baja Google al nivel de Apple para igualar — sería peor experiencia para todos por
parejo. Se documenta así en el panel del dueño.

## Decisiones

1. **Dos features separadas, una función de envío compartida.** La campaña manual (acción puntual
   del dueño, lista de destinatarios calculada al momento) y el aviso de inactividad (cron diario,
   revisa un umbral) son disparadores distintos — forzarlos a una sola tabla genérica de
   "difusiones con tipo" complica sin necesidad. Comparten solo la función de bajo nivel que sabe
   hablar con Apple y Google para una tarjeta puntual.
2. **Tope a las campañas manuales: 4 por mes por comercio, parejo en los tres planes.** No es una
   palanca de plan (como sucursales o programas) — protege la cuenta de Apple/Google y al cliente
   real del spam, y esa razón no cambia con lo que el comercio pague. Lo hace cumplir el servidor,
   no una sugerencia de UI.
3. **El aviso de inactividad no necesita tope propio.** Se autolimita: un cliente cruza el umbral de
   inactividad una vez por período, así que no hay forma de que el sistema lo repita en el mismo
   ciclo.
4. **Candado no negociable, compartido por las dos features:** antes de mandar por Google a una
   tarjeta puntual, contar cuántos avisos con notificación recibió esa tarjeta en las últimas 24
   horas (de CUALQUIER origen). Si ya tiene 3, se salta esa tarjeta — no se manda igual, no se
   corta la difusión completa por una tarjeta saturada.
5. **La inactividad se mide POR TARJETA, no por cliente.** Con programas de tarjeta (migración
   0024) un cliente puede tener su tarjeta de sellos activa y su cupón de bienvenida olvidado — y
   ese es exactamente el caso que vale la pena avisar. Evaluar por cliente-agregado escondería esa
   señal.
6. **Umbral y mensaje de inactividad son configurables por el dueño, nunca hardcodeados.** Mismo
   criterio que las perillas antifraude de Tanda 1 (`tope_acreditaciones_dia`, etc.): un número fijo
   en el código es una decisión de producto disfrazada de constante técnica.
7. **Una campaña puede apuntar a un programa específico, o a todos (default).** El comercio ya
   puede tener varios programas activos; una promo de "Cupón de bienvenida" no necesariamente le
   interesa a quien solo tiene la tarjeta de sellos.
8. **Solo el dueño dispara campañas.** Gate `verifyComercioOwner()`, no compartido con cajero —
   es una decisión de marketing/política, no una operación de mostrador.

## Modelo de datos

```sql
-- Registro compartido: auditoría Y fuente del candado de 3/24h de Google.
create table notificaciones_enviadas (
  id uuid primary key default gen_random_uuid(),
  tarjeta_id uuid not null references tarjetas(id),
  canal text not null check (canal in ('apple', 'google')),
  origen text not null check (origen in ('campana', 'inactividad')),
  enviada_en timestamptz not null default now()
);
create index on notificaciones_enviadas (tarjeta_id, enviada_en desc);

-- Historial de campañas manuales Y fuente del tope de 4/mes.
create table difusiones (
  id uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references comercios(id),
  programa_id uuid references programas_tarjeta(id), -- null = todos los programas del comercio
  mensaje text not null,
  creada_por uuid not null references usuarios_comercio(id),
  creada_en timestamptz not null default now(),
  destinatarios integer not null default 0 -- cuántas tarjetas recibieron el mensaje, para el panel
);
create index on difusiones (comercio_id, creada_en desc);

-- Perillas del aviso de inactividad, junto a las de Tanda 1 (mismo patrón de columnas en comercios).
alter table comercios
  add column aviso_inactividad_activo boolean not null default false,
  add column aviso_inactividad_dias integer check (aviso_inactividad_dias is null or aviso_inactividad_dias > 0),
  add column aviso_inactividad_mensaje text;

-- Para no re-avisar cada día una vez cruzado el umbral.
alter table tarjetas add column aviso_inactividad_enviado_en timestamptz;
```

Un cupo de recordatorio: si la última actividad real de la tarjeta (`transacciones_puntos` /
`canjes`) es más nueva que `aviso_inactividad_enviado_en`, la tarjeta puede volver a avisarse la
próxima vez que cruce el umbral — no hace falta una limpieza explícita de la columna.

## La función compartida

`enviarMensajeTarjeta(supabase, tarjetaId, mensaje, origen)`:

- **Apple**: escribe `mensaje` en un campo nuevo del reverso del pase (`aviso`, con
  `changeMessage: "%@"`) y dispara el push silencioso que ya existe
  (`notificarCambioTarjeta`/`notificarCambioComercio`) — cero código nuevo de APNs. El límite de
  caracteres del campo se verifica empíricamente durante la implementación (mismo criterio que ya
  se aplicó a `relevantText`, no se asume un número sin probarlo contra Wallet real).
- **Google**: antes de llamar `addMessage`, cuenta en `notificaciones_enviadas` cuántos avisos
  recibió esa tarjeta en las últimas 24 horas; si ya son 3, se salta el envío por este canal (Apple
  sigue mandándose igual — el candado es solo de Google). Si manda, registra la fila en
  `notificaciones_enviadas`.
- Reutiliza la limpieza de tokens inválidos que `notificarCambioTarjeta` ya tiene (un token
  `BadDeviceToken`/`Unregistered` se borra solo) — no hay que reconstruir eso.

## Campaña manual

Pantalla nueva (`/comercio/notificaciones` o similar — nombre final a definir), gate de dueño:

- Formulario: mensaje (texto libre) + selector de programa (default "todos").
- Antes de mandar: contar `difusiones` de los últimos 30 días para el comercio; si ya hay 4,
  rechazar con un mensaje claro.
- Al mandar: resolver las tarjetas destino (todas las activas del comercio, o solo las del
  programa elegido), llamar `enviarMensajeTarjeta` por cada una, insertar la fila en `difusiones`
  con el conteo real de destinatarios.
- Historial visible en la misma pantalla: qué se mandó, cuándo, a cuántos, y el contador de "te
  quedan N de 4 este mes".

## Aviso de inactividad

- Perilla nueva en Reglas, junto a los controles de Tanda 1 (mismo patrón visual y de gate que
  `pedir_monto_compra`/`tope_puntos_dia`): activar/desactivar, días de inactividad (número,
  default sugerido 30), mensaje.
- Cron diario nuevo (mismo mecanismo que `/api/cron/campanas`: `CRON_SECRET`, falla cerrado si no
  está configurado). Recorre comercios con `aviso_inactividad_activo`, y dentro de cada uno, cada
  tarjeta activa cuya última actividad real supere `aviso_inactividad_dias` Y (no tenga
  `aviso_inactividad_enviado_en`, o su última actividad sea más nueva que ese aviso). Llama
  `enviarMensajeTarjeta` con origen `'inactividad'` y actualiza la columna.

## Lo que NO cambia

El geopush sigue exactamente igual — sigue siendo pasivo, sigue viviendo en `sucursales`, sigue sin
tocar `notificaciones_enviadas` ni `difusiones`. Las dos campañas (la de geopush y la nueva) son
conceptos distintos que conviven: una tapa el mensaje de cercanía mientras dura, la otra dispara un
push activo una vez. No se unifican en una sola tabla — forzar disparadores y ciclos de vida
distintos a un modelo único (ver decisión 1) tiende a complicar más de lo que ahorra.

## Riesgos y pendientes para el plan

- El límite real de caracteres del nuevo campo del reverso de Apple no está medido — se verifica
  contra Wallet real durante la implementación, como ya se hizo con `relevantText`
  (`LARGO_MAXIMO_MENSAJE_CERCANIA`).
- Hoy existe UNA `LoyaltyClass` por comercio (no por programa) — un `addMessage` a nivel clase
  llega a TODOS los programas del comercio de una sola llamada, más eficiente que recorrer
  objetos. Cuando la campaña apunta a un programa específico, hace falta recorrer los objetos
  (`LoyaltyObject`) de las tarjetas de ese programa en vez de la clase — el plan debe decidir la
  forma exacta de esa llamada.
- Cobertura de pruebas obligatoria para: el tope de 4/mes (incluida la mutación "cambiar `>=` por
  `>`"), el candado de 3/24h de Google, y el caso concreto que motivó la decisión 5 — una tarjeta
  activa y otra inactiva del MISMO cliente en el MISMO comercio, confirmando que el aviso llega
  solo a la inactiva.

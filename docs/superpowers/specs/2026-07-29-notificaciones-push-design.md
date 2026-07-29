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
-- Historial de campañas manuales Y fuente del tope de 4/mes.
create table difusiones (
  id uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references comercios(id),
  programa_id uuid references programas_tarjeta(id), -- null = todos los programas activos del comercio
  mensaje text not null,
  vigente_hasta date not null, -- cuánto dura el mensaje en el reverso del pase (lo elige el dueño, como campana_hasta en geopush)
  creada_por uuid not null references usuarios_comercio(id),
  creada_en timestamptz not null default now(),
  destinatarios integer not null default 0 -- cuántas tarjetas recibieron el mensaje, para el panel
);
create index on difusiones (comercio_id, creada_en desc);

-- Registro compartido: auditoría de AMBOS canales Y fuente del candado de 3/24h de Google.
create table notificaciones_enviadas (
  id uuid primary key default gen_random_uuid(),
  tarjeta_id uuid not null references tarjetas(id),
  canal text not null check (canal in ('apple', 'google')),
  origen text not null check (origen in ('campana', 'inactividad')),
  difusion_id uuid references difusiones(id), -- solo origen='campana'; null en 'inactividad'
  enviada_en timestamptz not null default now()
);
create index on notificaciones_enviadas (tarjeta_id, enviada_en desc);

-- Estado ACTUAL del aviso en el reverso de CADA tarjeta. construirReverso/datosPassDeTarjeta
-- reconstruyen el reverso de cero en CADA regeneración del pase (confirmado leyendo el código:
-- no hay copia congelada) — así que changeMessage necesita un valor persistido que sobreviva a
-- una regeneración disparada por otra cosa (una venta, un cambio de branding). Sin esto no hay
-- qué comparar. Mismo patrón que vigencia_hasta/usado_en: el campo vive en la tarjeta, no en el
-- evento que lo originó.
alter table tarjetas
  add column aviso_texto text,
  add column aviso_hasta date; -- null junto con aviso_texto null = sin aviso vigente en el reverso

-- Perillas del aviso de inactividad, junto a las de Tanda 1 (mismo patrón de columnas en comercios).
alter table comercios
  add column aviso_inactividad_activo boolean not null default false,
  add column aviso_inactividad_dias integer check (aviso_inactividad_dias is null or aviso_inactividad_dias > 0),
  add column aviso_inactividad_mensaje text;

-- Para no re-avisar cada día una vez cruzado el umbral.
alter table tarjetas add column aviso_inactividad_enviado_en timestamptz;
```

**Duración del aviso en el pase**: para una campaña, el dueño elige `vigente_hasta` al mandarla
(igual que `campana_hasta` en geopush) — una promo de "este fin de semana" y una de "todo el mes"
duran lo que el dueño diga, no un número fijo del sistema. Para el aviso de inactividad, la
duración es un valor fijo del sistema (14 días sugerido, no una perilla más: el dueño ya configuró
el umbral y el mensaje: agregar una TERCERA perilla solo para esto es la clase de configurabilidad
que nadie pidió). Se resuelve con la misma lógica que `resolverMensajeCercania` (texto vigente si
`aviso_hasta >= hoy`, si no, nada) — mismo patrón ya probado, función pura con `hoyIso` por
argumento.

**"Última actividad real" cuando la tarjeta nunca se usó**: el momento más reciente entre la
última fila en `transacciones_puntos`/`canjes` para esa tarjeta, y `tarjetas.created_at` si no
tiene ninguna fila. Esto importa en la práctica: es exactamente el caso del cupón de bienvenida
nunca canjeado que motiva la decisión 5 — sin este fallback, una tarjeta sin ninguna fila de
ledger nunca calificaría como inactiva y el aviso no le llegaría jamás.

**"Tarjeta activa" en este documento** significa: pertenece a un programa con
`programas_tarjeta.activo = true` (join, no una columna en `tarjetas` — esa tabla no tiene
`activa`/`activo`). Ni las campañas ni el aviso de inactividad alcanzan tarjetas de un programa
que el dueño ya desactivó.

Un aviso de inactividad puede volver a mandarse: si la última actividad real de la tarjeta
(definida arriba) es más nueva que `aviso_inactividad_enviado_en`, quiere decir que hubo actividad
después del último aviso, así que puede volver a cruzar el umbral y avisarse de nuevo — no hace
falta una limpieza explícita de la columna.

## La función compartida

`enviarMensajeTarjeta(supabase, tarjetaId, mensaje, vigenteHasta, origen, difusionId?)`:

1. Actualiza `tarjetas.aviso_texto`/`aviso_hasta` con `mensaje`/`vigenteHasta` — esto es lo que
   `construirReverso` va a leer de ahora en más, en CUALQUIER regeneración del pase, no solo esta.
2. **Apple**: el campo nuevo del reverso (`aviso`, con `changeMessage: "%@"`) ya cambió de valor en
   el paso 1, así que dispara el push silencioso que ya existe
   (`notificarCambioTarjeta`/`notificarCambioComercio`) — cero código nuevo de APNs. Inserta una
   fila en `notificaciones_enviadas` con `canal='apple'`. El límite de caracteres del campo se
   verifica empíricamente durante la implementación (mismo criterio que ya se aplicó a
   `relevantText`, no se asume un número sin probarlo contra Wallet real).
3. **Google**: antes de llamar `addMessage`, cuenta en `notificaciones_enviadas` cuántas filas con
   `canal='google'` tiene esa tarjeta en las últimas 24 horas (el filtro por canal es explícito:
   las filas de Apple del paso 2 no cuentan para este candado, que es específicamente el tope de
   Google). Si ya son 3, se salta el envío por este canal — Apple ya se mandó igual en el paso 2,
   el candado es solo de Google. Si manda, inserta la fila con `canal='google'`.
- `difusionId` viaja solo desde la campaña manual (origen `'campana'`) y queda en
  `notificaciones_enviadas.difusion_id` — trazabilidad de soporte ("¿a este cliente sí le llegó
  esta campaña puntual?"). El aviso de inactividad no tiene difusión que enlazar.
- Reutiliza la limpieza de tokens inválidos que `notificarCambioTarjeta` ya tiene (un token
  `BadDeviceToken`/`Unregistered` se borra solo) — no hay que reconstruir eso.

## Campaña manual

Pantalla nueva (`/comercio/notificaciones` o similar — nombre final a definir), gate de dueño:

- Formulario: mensaje (texto libre) + hasta cuándo dura en el reverso del pase + selector de
  programa (default "todos").
- Antes de mandar: contar `difusiones` de los últimos 30 días (ventana móvil, no mes de
  calendario) para el comercio; si ya hay 4, rechazar con un mensaje claro.
- Al mandar: resolver las tarjetas destino (tarjetas activas del comercio — ver definición arriba
  — o solo las del programa elegido), llamar `enviarMensajeTarjeta` por cada una con el
  `difusion_id` recién creado, insertar la fila en `difusiones` con el conteo real de
  destinatarios.
- Historial visible en la misma pantalla: qué se mandó, cuándo, a cuántos, y el contador de "te
  quedan N de 4 en los últimos 30 días" (la copia no dice "este mes": el mecanismo es ventana
  móvil, no reinicio de calendario, y la copia tiene que decir la verdad).

## Aviso de inactividad

- Perilla nueva en Reglas, junto a los controles de Tanda 1 (mismo patrón visual y de gate que
  `pedir_monto_compra`/`tope_puntos_dia`): activar/desactivar, días de inactividad (número,
  default sugerido 30), mensaje.
- Cron diario nuevo (mismo mecanismo que `/api/cron/campanas`: `CRON_SECRET`, falla cerrado si no
  está configurado, entrada propia en `vercel.json` junto a la de `/api/cron/campanas`). Recorre
  comercios con `aviso_inactividad_activo`, y dentro de cada uno, cada tarjeta activa (ver
  definición arriba) cuya última actividad real (ver definición arriba, incluye el fallback a
  `created_at`) supere `aviso_inactividad_dias` Y (no tenga `aviso_inactividad_enviado_en`, o su
  última actividad sea más nueva que ese aviso). Llama `enviarMensajeTarjeta` con origen
  `'inactividad'`, `vigenteHasta` = hoy + 14 días, y actualiza `aviso_inactividad_enviado_en`.

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
  `>`"), el candado de 3/24h de Google con el filtro por `canal` (una mutación que lo quite debe
  atrapar que un push de Apple cuente contra el tope de Google), la resolución de "última
  actividad real" con el fallback a `created_at` para una tarjeta sin ninguna fila de ledger, y el
  caso concreto que motivó la decisión 5 — una tarjeta activa y otra inactiva del MISMO cliente en
  el MISMO comercio, confirmando que el aviso llega solo a la inactiva.

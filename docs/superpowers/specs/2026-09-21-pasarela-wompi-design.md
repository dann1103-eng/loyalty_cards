# Pasarela de pagos con Wompi

**Fecha:** 2026-09-21 · **Rama:** `claude/pasarela-wompi` · **Estado:** propuesta, a la espera de la
revisión de Daniel. Nada de esto está implementado.

## Por qué

Hoy el cobro es manual de punta a punta. El dueño sube de plan al instante, FM coordina el cobro por
WhatsApp y lo registra a mano en `/admin/cuentas/[id]`, y ese registro es lo que dispara el evento
Subscribe de Meta. Las cuentas que nacen del registro público quedan en `licencia_estado: 'inactivo'`
porque nadie las cobró todavía. El código ya dejó el hueco marcado: `0017` dice "cuando exista la
pasarela, el flujo de cambio de plan ya está construido", `altaAutoservicio.ts` dice "el paso de cobro
se enchufa acá", y `marcarCobroPagado` existe sin que nadie la llame.

Wompi (El Salvador) ofrece API. Objetivo: que el dueño pague desde la app y que cada pago caiga solo
al panel de FM.

## Decisiones de Daniel (2026-09-21)

1. **El plan nuevo se aplica solo cuando se confirma el pago.** Se le advirtió el costo: un webhook
   tardío deja al dueño esperando. La mitigación está en "Confirmar sin depender solo del webhook".
2. **Un cobro por mes, pagado con un botón.** No se usa la suscripción recurrente de Wompi.
3. **La app del dueño tiene que poder instalarse en el celular y mandarle notificaciones**, con "pago
   pendiente" y "pago próximo" como primeros avisos. Es la **Fase 2** de esta spec.
4. **Subir de plan con el período ya pagado y en curso se prorratea.** Se cobra solo la diferencia por
   los días que faltan. **Al renovar**, sea que suba, baje o siga igual, se cobra el precio completo del
   plan elegido. El detalle está en "Cuánto se cobra".

## Supuestos míos, a confirmar al revisar

- Solo se acepta **tarjeta de crédito o débito**. Puntos Agrícola, cuotas, Bitcoin, QuickPay y Nequi
  quedan apagados; se prenden con una constante cuando se decida.
- **La ventana de renovación es de 7 días**: el dueño puede renovar (y cambiar de plan al hacerlo) desde
  7 días antes de que termine su período. Sin ventana, "renovar con otro plan" serviría para saltarse el
  prorrateo (pagar de más un mes por adelantado y tener el plan nuevo casi todo el mes en curso). La
  misma cifra será la del aviso de "pago próximo" de la Fase 2.
- **Bajar de plan:** al renovar se puede pagando el plan más chico, con la comprobación de cupo que ya
  hace `resolverSolicitud`. A mitad de período **sigue siendo una solicitud que FM resuelve**
  (`solicitarCambioPlan`), y no hay devolución ni crédito por los días no usados.
- **Los pilotos (cuentas sin plan) que quieran un plan pasan por el pago.** Es consecuencia de la
  decisión 1. FM puede seguir asignando un plan a mano desde la ficha de la cuenta, que no se toca.
- Una cuenta con **precio negociado** por FM se prorratea contra su precio real (`licencia_monto_mensual`),
  no contra el del catálogo.

## Lo que dice la documentación de Wompi

Leída completa el 2026-09-21 (47 páginas de <https://docs.wompi.sv/llms.txt> y el Swagger en
<https://api.wompi.sv/swagger/v1/swagger.json>). Lo que condiciona el diseño:

| Hecho | Consecuencia |
|---|---|
| OAuth2 `client_credentials` contra `POST https://id.wompi.sv/connect/token` (`audience=wompi_api`). El App ID es el `client_id` y el API Secret el `client_secret`. El token dura 3600 s. | Un cliente que cachea el token en memoria y lo renueva antes de vencer. |
| `POST /EnlacePago` crea el enlace y devuelve `idEnlace`, `urlEnlace` (corta), `urlEnlaceLargo`, `urlQrCodeEnlace`. Cada enlace acepta su propio `urlRedirect`, `urlWebhook`, `vigencia`, `limitesDeUso` y `datosAdicionales`. | "El botón" es un botón de la app que crea el enlace en el servidor y redirige. La doc no ofrece un widget embebible. |
| Cobrar con nuestra propia pantalla (`/TransaccionCompra/3Ds`) exige mandar número de tarjeta y CVV por nuestro servidor. | No se usa: nos metería en las obligaciones de seguridad de datos de tarjeta. |
| Consultar (`GET /EnlacePago/{id}`), editar, activar y desactivar enlaces piden **usuario y contraseña de la cuenta Wompi**, no las credenciales del negocio. | Esas credenciales no se guardan en la app. Se usan enlaces de un solo uso con vencimiento, que no hace falta desactivar. |
| `GET /TransaccionCompra/{id}` acepta las credenciales del negocio. | Es la verificación autoritativa de un pago. |
| El webhook llega **solo para transacciones exitosas**, es un `POST` con cuerpo JSON y el header `wompi_hash` (HMAC-SHA256 en hexadecimal del cuerpo **crudo**, con el API Secret como llave). Wompi reintenta la entrega. | La firma se valida sobre el texto crudo, antes de parsear. El manejo tiene que ser idempotente. |
| El cuerpo del webhook trae `IdTransaccion`, `Monto`, `EsProductiva`, `ResultadoTransaccion` y `EnlacePago.IdentificadorEnlaceComercio`. El ejemplo de la doc es de 2020 y el Swagger no lo describe. | Se guarda el cuerpo crudo y el parser tolera mayúsculas y minúsculas. Se confirma contra la API antes de aplicar. |
| El redirect trae `idTransaccion`, `monto`, `identificadorEnlaceComercio`, `idEnlace` y `hash`. El hash es el HMAC de esos cuatro valores **concatenados en ese orden**, sin separador. La doc pide no depender solo del redirect. | La página de vuelta valida el hash con los valores **tal como llegan en la URL**, sin reformatear (`10` no es `10.00`), y además consulta la API. El webhook queda como camino principal. |
| Modo prueba: todo se aprueba, salvo un CVV `111`. El webhook trae `EsProductiva: false`, y las pruebas no salen en el reporte de Wompi. | Un pago de prueba se registra y se ve, pero nunca activa nada. |
| Los enlaces recurrentes exigen que el cliente acepte la suscripción a mano, y la doc no dice si avisan por webhook. | No entran en esta fase. |

## Alcance

**Fase 1 (esta spec):** cliente de Wompi, botón Pagar, enlace por cobro, webhook, conciliación,
pantalla `/admin/pagos`, cambio de plan condicionado al pago, y "próximo pago" visible para el dueño.

**Fase 2 (spec propia, después):** los cobros del mes se generan solos, la app del dueño se instala en
el celular y le llegan avisos de pago pendiente y pago próximo. Ver el bosquejo al final.

**Fuera de alcance:** suscripciones recurrentes de Wompi, reembolsos (se hacen en el panel de Wompi),
facturación fiscal (sigue sin personería jurídica, ver `cobros.ts`), otras formas de pago, otras
pasarelas, y que los clientes finales le paguen a los comercios.

## Flujo de punta a punta

```
dueño en /comercio/plan            servidor                          Wompi
       │ toca "Pagar"                 │                                │
       ├─────────────────────────────►│ crea (o reusa) cobro pendiente │
       │                              │ POST /EnlacePago ─────────────►│
       │                              │◄──────────── urlEnlace ────────┤
       │◄──── redirige a urlEnlace ───┤                                │
       ├──────────────────────────────┼───────── paga con tarjeta ────►│
       │                              │◄── POST /api/wompi/webhook ────┤  (camino principal)
       │◄── redirige a /comercio/plan/pago/resultado?…hash ────────────┤  (camino de respaldo)
       │                              │
       │            ambos caminos terminan en confirmarPagoCobro (idempotente)
       │                              │ → cobro pagado, plan aplicado, licencia activa, Subscribe a Meta
admin ─┴── ve el evento en /admin/pagos
```

## Confirmar sin depender solo del webhook

Como el plan solo cambia al confirmarse el pago, un webhook lento no puede dejar al dueño colgado:

- **Página de vuelta** (`/comercio/plan/pago/resultado`): valida el `hash` del redirect, consulta
  `GET /TransaccionCompra/{idTransaccion}`, y solo si `esAprobada` y `esReal` son verdaderos y el monto
  es el del cobro llama a `confirmarPagoCobro`. Si Wompi todavía no lo refleja, muestra "Estamos
  confirmando tu pago" y se recarga sola unos segundos.
- **Si el dueño cierra la pestaña**, llega el webhook.
- **Si no llega ninguno**, el cobro sigue pendiente, el dueño puede volver a tocar Pagar, y FM puede
  marcarlo pagado a mano con el camino de hoy (`accionRegistrarCobro`).
- Todo evento cuya conciliación no sea `aplicado` aparece destacado en `/admin/pagos`.

## Cuánto se cobra

**Definiciones.** "Hoy" es la fecha en `America/El_Salvador`. El **período en curso** es un cobro
`tipo = 'periodo'`, `estado = 'pagado'` con `periodo_desde <= hoy <= periodo_hasta`. El **precio
actual** es `licencia_monto_mensual` de la cuenta. La **ventana de renovación** son los últimos 7 días
del período en curso, y también todo el tiempo después de que venció, o si la cuenta nunca pagó.

| Situación | Qué puede hacer el dueño | Cuánto paga | Qué pasa con el período |
|---|---|---|---|
| Período en curso, **fuera** de la ventana | Subir de plan | La **diferencia prorrateada** | No cambia: termina el mismo día. La próxima renovación cobra el plan nuevo completo |
| Período en curso, **dentro** de la ventana | Subir con prorrateo, **o** renovar con cualquier plan (mismo, más caro o más chico) | Prorrateo, o el **precio completo** del plan elegido | Renovar abre el período siguiente, que arranca el día después de que termine el actual |
| Sin período en curso (venció, cuenta nueva, piloto sin cobros) | Elegir cualquier plan | El **precio completo** | Un período nuevo que arranca hoy |
| Bajar a mitad de período | Solicitud a FM, sin cambios | — | — |

**Fórmula del prorrateo.** Los días se cuentan completos y **hoy cuenta**: si el período es del 1 al 30
de septiembre y hoy es el 15, faltan 16 de 30.

```
ajuste = redondear_centavos( (precio_nuevo − precio_actual) × dias_restantes ÷ dias_del_periodo )
```

| Cambio (hoy 15 de septiembre, período 1–30) | Cuenta | Cobra |
|---|---|---|
| Starter → Growth | 20 × 16 ÷ 30 | **$10.67** |
| Growth → Pro | 40 × 16 ÷ 30 | **$21.33** |
| Starter → Pro | 60 × 16 ÷ 30 | **$32.00** |
| Starter → Growth el último día | 20 × 1 ÷ 30 | $0.67 |

**Reglas de borde:**
- El redondeo es al centavo, hacia arriba en la mitad. Un ajuste menor que $0.01 no se cobra: se le
  indica que renueve.
- Solo se prorratea **subir**: el plan destino tiene que ser más caro en el catálogo **y**
  `precio_nuevo − precio_actual > 0`. Si FM le negoció un precio igual o mayor al del destino, no hay
  diferencia que cobrar y la pantalla lo manda a escribir a FM.
- `dias_del_periodo` son los días reales de ese período (28 a 31), no un 30 fijo.
- Un período dura un mes calendario menos un día. Si el mes siguiente no tiene ese día, se usa su
  último día: uno que arranca el 31 de enero termina el 27 de febrero (28 en año bisiesto), y uno que
  arranca el 15 de septiembre termina el 14 de octubre.
- **Renovar con un plan más chico exige que la cuenta quepa**: si `cupoDeCuenta.usadas` supera el límite
  sugerido del destino, se bloquea **antes de cobrar**, con el mensaje de `resolverSolicitud` ("usa N
  unidades y el plan permite M"). Se vuelve a comprobar al aplicar, porque el dueño pudo agregar un
  negocio entre medio.
- El cobro de un ajuste guarda en `nota` la cuenta hecha ("Starter → Growth, 16 de 30 días") para que el
  comprobante y el admin la muestren.
- El enlace de Wompi de un ajuste **vence, como máximo, el último día del período**: así no se puede
  pagar un ajuste cuando ya no corresponde.
- Un dueño solo tiene **un intento de pago abierto** a la vez. Al iniciar otro, el pendiente anterior se
  reusa si es del mismo tipo, del mismo plan y del mismo día; si no, se anula y se crea uno nuevo. Los
  ajustes pendientes cuyo período ya terminó no se muestran y se anulan al iniciar el siguiente pago.

## Modelo de datos (migración 0037, se aplica a mano ANTES del deploy)

```sql
-- Qué plan se aplica cuando este cobro se confirma, y el enlace de Wompi que se le generó.
alter table cobros
  -- 'periodo' = un mes completo (lo único que existía hasta hoy, por eso es el default y las filas
  -- viejas quedan bien). 'ajuste' = la diferencia prorrateada de subir de plan a mitad de período:
  -- NO abre un período nuevo, así que no cuenta para "próximo pago" ni para "período en curso".
  add column tipo text not null default 'periodo' check (tipo in ('periodo', 'ajuste')),
  add column plan_destino text,              -- null = solo renovar el plan actual
  add column wompi_id_enlace integer,
  add column wompi_url_enlace text,
  add column wompi_enlace_vence timestamptz;

-- Un registro por cada transacción que Wompi nos informa (o que confirmamos por consulta).
create table pagos_wompi (
  id uuid primary key default gen_random_uuid(),
  id_transaccion text not null unique,       -- idempotencia: una transacción se procesa una vez
  fuente text not null check (fuente in ('webhook', 'redirect')),
  cobro_id uuid references cobros(id),       -- null si el enlace no lo creó la app
  cuenta_id uuid references cuentas_comercio(id),
  identificador_enlace text,                 -- lo que mandamos (el id del cobro) o el de un enlace manual
  monto numeric not null,
  es_real boolean not null,
  fecha_transaccion timestamptz,
  conciliacion text not null default 'pendiente' check (conciliacion in (
    'pendiente', 'aplicado', 'prueba', 'sin_cobro', 'cobro_anulado',
    'monto_distinto', 'ya_pagado', 'plan_no_aplicable', 'error')),
  detalle text,
  payload jsonb not null,                    -- el cuerpo crudo: trae nombre y correo del pagador
  created_at timestamptz not null default now()
);
create index pagos_wompi_created_idx on pagos_wompi (created_at desc);
create index pagos_wompi_cobro_idx on pagos_wompi (cobro_id);
alter table pagos_wompi enable row level security;   -- deny-all salvo service_role, como el resto
```

`plan_destino` y las columnas de enlace solo las escribe código nuevo, así que aplicar la migración
antes del deploy no rompe nada de lo que corre hoy.

## Conciliación

| Situación | `conciliacion` | Efecto |
|---|---|---|
| Firma inválida o ausente | (no se guarda) | `401`, línea en el log |
| `EsProductiva` falso y sin `WOMPI_ACEPTAR_PRUEBAS` | `prueba` | se guarda y se ve; no aplica nada |
| El identificador no es un cobro de la app (enlace hecho a mano en el panel de Wompi) | `sin_cobro` | se guarda y se ve; `200` |
| Cobro anulado | `cobro_anulado` | no aplica; FM decide (posible devolución) |
| Monto distinto al del cobro | `monto_distinto` | no aplica; FM decide |
| Cobro ya pagado con **otra** transacción | `ya_pagado` | no aplica; posible doble pago, FM devuelve |
| Todo bien | `aplicado` | ver "Aplicar el pago" |
| Se cobró, pero el plan ya no cabe (el dueño agregó un negocio entre el cobro y el pago) | `plan_no_aplicable` | el cobro queda pagado y la licencia activa, pero el plan no cambia; responde `200` y FM lo resuelve hablando con el dueño o devolviendo |
| Falla interna al aplicar | `error` | responde `500`, Wompi reintenta, y el reintento vuelve a aplicar |

El monto y el plan salen **siempre de nuestra base**, nunca del webhook ni del navegador.

## Aplicar el pago (`confirmarPagoCobro`)

1. `update cobros set estado='pagado', pagado_en=<hoy>, metodo='Wompi' where id=$1 and estado='pendiente'
   returning …`. Una sola sentencia hace de candado: si no devuelve fila, otro camino ya lo aplicó.
2. Si el cobro tiene `plan_destino`, aplica el plan con `aplicarPlanDestino`, que junta las dos reglas
   que hoy viven separadas: **subir** (`subirPlanPorElDueno`: el límite nunca baja, y el "sin tope" de
   las cuentas viejas sobrevive) y **bajar** (`resolverSolicitud`: comprueba el cupo y fija el límite
   sugerido del plan). `subirPlanPorElDueno` deja de ser un camino del dueño. Si al bajar el cupo ya no
   alcanza, devuelve "no aplicable" y la conciliación queda en `plan_no_aplicable`.
3. Licencia: `licencia_estado = 'activo'`, `licencia_activa_desde` si estaba vacía, y
   `licencia_monto_mensual` con el precio del plan vigente. En un cobro `tipo = 'ajuste'` **no se abre
   ningún período**: el que estaba en curso sigue igual y solo cambia el plan y el precio.
4. Subscribe a Meta (`notificarPagoAMeta`, con `after()`) **solo si el paso 1 reclamó la fila**: un
   reintento del webhook no lo cuenta dos veces. Igual que hoy con los cobros registrados a mano, todo
   cobro pagado avisa, ajustes incluidos y con su monto real.

Los pasos 2 y 3 son idempotentes. Si fallan después del 1, el evento queda en `error` y el reintento
los repite sin volver a tocar el cobro ni a Meta.

## Módulos

- `lib/wompi/config.ts`: lee las variables de entorno (`server-only`) y falla con un mensaje claro si faltan.
- `lib/wompi/firma.ts`: HMAC-SHA256 hexadecimal, comparación con `timingSafeEqual`, y el hash del redirect.
- `lib/wompi/cliente.ts`: token en memoria (se renueva antes de vencer), `crearEnlacePago` y
  `consultarTransaccion`, con `fetch` inyectable para probar sin red.
- `lib/wompi/webhook.ts`: parser tolerante del cuerpo (mayúsculas o minúsculas) que devuelve un objeto
  tipado o un motivo de rechazo.
- `lib/comercios/pagosWompi.ts`: registra el evento y decide la conciliación.
- `lib/comercios/prorrateo.ts`: **puro**, sin base de datos. `calcularAjuste`, el período siguiente
  (`periodoSiguiente`), el estado del período (`estadoDelPeriodo`: en curso, en ventana o vencido) y la
  constante `DIAS_VENTANA_RENOVACION = 7`. Es donde vive toda la aritmética de fechas y dinero.
- `lib/comercios/cobros.ts`: `crearCobroPendiente`, `reclamarCobroPagado`, y la lógica de reuso o
  anulación del intento pendiente.
- `app/api/wompi/webhook/route.ts`: ruta pública (`/api/*` ya queda fuera del matcher del proxy).
- `app/comercio/(protegido)/plan/`: `accionIniciarPagoPlan`, botones de pago, y `pago/resultado/page.tsx`.
- `app/admin/(protegido)/pagos/page.tsx` y un enlace "Pagos" en la navegación del admin.

## Pantallas

**Dueño, `/comercio/plan`:**
- Los botones de subir plan pasan de "cambiar ya" a pagar. **Con el período en curso** dicen lo que
  cuestan hoy: **"Pasar a Growth · pagás $10.67 hoy (16 días que faltan)"**, y debajo, en chico, "Desde
  el 1 de octubre, $49/mes". **Sin período en curso** dicen **"Elegir Growth · $49"**. Tocar crea el
  cobro y lleva a Wompi. El texto que hoy dice "El cambio es inmediato… no te pedimos tarjeta acá" se corrige.
- Una cuenta inactiva ve "Activá tu cuenta" con el botón del primer mes.
- **Próximo pago**: la fecha siguiente al último período pagado. Dentro de la ventana de 7 días aparece
  **Renovar** con un selector de plan (mismo, más caro o más chico) y el precio completo a la vista.
  Antes de la ventana no hay botón de renovar.
- En la lista de cobros, cada pendiente con monto mayor que cero lleva **Pagar**, y los ajustes se
  distinguen ("Ajuste por subir de plan").
- Página de vuelta: "Pago confirmado", "Estamos confirmando tu pago" o "No pudimos confirmarlo".

**Admin, `/admin/pagos`:** fecha, cuenta (con enlace a su ficha), monto, insignia **Real** o **Prueba**,
conciliación (pastilla) y el cuerpo crudo desplegable. Filtro "Solo lo que necesita atención".

## Seguridad

- Firma obligatoria y comparación en tiempo constante. Sin `WOMPI_CLIENT_SECRET`, la ruta responde `500` y no procesa.
- Credenciales solo en el servidor (`import 'server-only'`, sin `NEXT_PUBLIC_`). Nunca se guarda la
  contraseña de la cuenta Wompi, y la app no llama a ningún endpoint que la pida.
- Un enlace equivale a un cobro y a un pago: `cantidadMaximaPagosExitosos: 1`, `esMontoEditable: false`,
  y vigencia de 48 h (en un ajuste, como máximo hasta el último día del período; `fechaInicio` es
  obligatoria en el Swagger cuando se manda `vigencia`). Si vence, el siguiente toque de Pagar crea otro.
- Los importes salen de `prorrateo.ts` y de `PLANES` en el servidor. La acción del dueño recibe **solo
  el plan elegido**, nunca un monto.
- El cuerpo crudo guarda nombre y correo del pagador: lo lee solo el admin y no se le muestra al dueño.
- Un pago de prueba no activa nada. La variable `WOMPI_ACEPTAR_PRUEBAS` se **ignora** si
  `VERCEL_ENV === 'production'`, para que un error de configuración no permita activar cuentas gratis.
- Los enlaces y el webhook apuntan a `www.cardly-sv.site` (`NEXT_PUBLIC_BASE_URL`), directo, sin redirect
  entre el apex y `www`.

## Variables de entorno

`WOMPI_CLIENT_ID` y `WOMPI_CLIENT_SECRET` (secretos), `WOMPI_ACEPTAR_PRUEBAS` (solo desarrollo), y
opcionales `WOMPI_API_URL` y `WOMPI_ID_URL`. Solo los **nombres** van en `.env.local.example`.

## Pruebas

Puras (corren sin `.env.local`): firma y hash del redirect, parser del webhook, cliente con `fetch`
falso, la tabla de conciliación, y **todo el prorrateo** (`prorrateo.ts` no toca la base: el importe, los
días, los fines de mes y las ventanas se prueban con fechas fijas, incluidos febrero bisiesto y el
último día del período). Con base de datos (necesitan `.env.local`): el candado de
`reclamarCobroPagado` con dos llamadas concurrentes, y `confirmarPagoCobro` de punta a punta. Cada
rama crítica lleva su mutación.

| Aserción | Qué romper | Falla con |
|---|---|---|
| Firma válida | quitar `timingSafeEqual` por `===` sobre un hash de otra longitud | la prueba de longitud distinta lanza en vez de devolver `false` |
| Firma sobre el cuerpo crudo | calcular el HMAC sobre `JSON.stringify(JSON.parse(cuerpo))` | la prueba con espacios y saltos de línea en el cuerpo falla |
| Orden del hash del redirect | invertir `idTransaccion` y `idEnlace` | el hash armado en la prueba con `node:crypto`, en el orden de la doc, ya no coincide (los ejemplos de la doc no traen el secreto con que se firmaron, así que no sirven de vector) |
| Prueba no activa | ignorar `esReal` | `prueba` pasa a `aplicado` |
| Monto | comparar contra el monto del webhook en vez del del cobro | un monto alterado se aplica |
| Idempotencia | quitar `and estado='pendiente'` del `update` | dos llamadas aplican dos veces y Meta se notifica dos veces |
| Producción | quitar la guarda de `VERCEL_ENV` | `WOMPI_ACEPTAR_PRUEBAS` activa una cuenta en producción |
| Días restantes | no contar hoy (`dias_restantes − 1`) | Starter → Growth el 15 de septiembre da $10.00 en vez de $10.67 |
| Días del período | usar 30 fijo | un período de 31 días (o de 28) da otro importe |
| Redondeo | truncar en vez de redondear | 20 × 16 ÷ 30 da $10.66 en vez de $10.67 |
| Solo subir | quitar `precio_nuevo − precio_actual > 0` | un precio negociado mayor que el del destino genera un ajuste negativo |
| Ventana de renovación | ampliarla a 30 días | el día 10 del período se puede renovar con otro plan y saltarse el prorrateo |
| Precio actual | usar el precio del catálogo en vez de `licencia_monto_mensual` | una cuenta con precio negociado paga de más |
| Ajuste no abre período | dejar que el ajuste cuente como período | el "próximo pago" salta al día del ajuste |
| Cupo al bajar | quitar la comprobación de `cupoDeCuenta` | una cuenta con 3 unidades baja a Starter (tope 1) y queda inválida |
| Fin de mes | sumar 30 días en vez de un mes calendario | un período del 31 de enero no termina el 27 de febrero |

## A verificar en la primera prueba real (modo prueba)

1. La forma **real** del webhook frente al ejemplo de 2020. El cuerpo crudo queda guardado justamente para esto.
2. Que `wompi_hash`, con guion bajo, llegue por Vercel. Algunos proxies descartan headers con
   guion bajo. Si no llegara, el camino de vuelta (redirect + consulta) sigue confirmando pagos, y se decide ahí.
3. Que `GET /TransaccionCompra/{id}` devuelva las transacciones de un enlace con las credenciales del negocio, como afirma la doc.
4. Cuántas veces y por cuánto tiempo reintenta Wompi.

Para probar el webhook hace falta una URL pública. Como un pago de prueba no activa nada, se puede
probar contra `www.cardly-sv.site` con las credenciales de prueba, después de aplicar la migración.

## Orden de entrega

| Tarea | Qué | Se verifica |
|---|---|---|
| 1 | `lib/wompi/{config,firma,webhook}.ts` y `lib/comercios/prorrateo.ts`, con sus pruebas | pruebas puras y mutaciones |
| 2 | `lib/wompi/cliente.ts` y sus pruebas | `fetch` falso |
| 3 | Migración `0037` y tipos | Daniel la aplica; verificación de solo lectura |
| 4 | `cobros.ts` y `pagosWompi.ts` (candado y conciliación), extracción de `aplicarPlanDestino` | pruebas con base de datos (Daniel las corre) |
| 5 | Ruta del webhook | pruebas de la ruta con firma válida e inválida |
| 6 | Acciones, botones y página de vuelta del dueño | recorrido en el navegador |
| 7 | `/admin/pagos` y su enlace | recorrido en el navegador |
| 8 | `.env.local.example`, `DESIGN.md` si aplica, `ESTADO-Y-PLAN` | lectura |
| 9 | Revisión final del conjunto | como la del rediseño |

**Despliegue:** migración primero, deploy después. Después de desplegar, Daniel pone la URL del
webhook en el panel de Wompi y hace la primera prueba real.

## Fase 2: avisos al celular del dueño (bosquejo, spec propia)

Hoy no hay nada de esto: el manifest actual es del portal del cliente (`/mi-tarjeta`), no hay service
worker ni la librería de Web Push, y las "notificaciones push" de la migración `0026` son de los pases
de Wallet de los clientes finales.

- **Cobros del mes solos:** un cron diario (junto a `/api/cron/avisos`) crea el cobro del período
  siguiente unos días antes de que venza el último pagado, para que "pago próximo" y "pago pendiente"
  existan como dato.
- **App instalable:** manifest propio para `/comercio` (`start_url` en el panel, `display: standalone`,
  íconos), service worker, y un botón "Instalar" con las instrucciones de iOS (Compartir → Agregar a
  inicio), porque iOS solo entrega push a una app ya instalada (iOS 16.4 o superior).
- **Web Push:** claves VAPID, la dependencia `web-push`, una tabla de suscripciones por dueño, el permiso
  pedido con un toque del usuario, envío desde el cron, y limpieza de suscripciones muertas.
- **Avisos:** pago próximo (unos días antes) y pago pendiente o vencido. El diseño de la pantalla de
  ajustes ("recibir avisos en este celular") entra acá.
- **A decidir cuando llegue:** cuántos días antes avisar, qué cuenta como "vencido", y si el cajero
  también recibe avisos (propuesta: solo los dueños).

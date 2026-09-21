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

## Supuestos míos, a confirmar al revisar

- Subir de plan cobra **el precio completo del plan nuevo, por un período que arranca el día del pago**.
  No hay prorrateo: es lo más simple y lo que el catálogo (`PLANES`) permite hoy.
- Solo se acepta **tarjeta de crédito o débito**. Puntos Agrícola, cuotas, Bitcoin, QuickPay y Nequi
  quedan apagados; se prenden con una constante cuando se decida.
- **Bajar de plan no cambia**: sigue siendo una solicitud que FM resuelve (`solicitarCambioPlan`).
- **Los pilotos (cuentas sin plan) que quieran un plan pasan por el pago.** Es consecuencia de la
  decisión 1. FM puede seguir asignando un plan a mano desde la ficha de la cuenta, que no se toca.

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

## Modelo de datos (migración 0037, se aplica a mano ANTES del deploy)

```sql
-- Qué plan se aplica cuando este cobro se confirma, y el enlace de Wompi que se le generó.
alter table cobros
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
    'monto_distinto', 'ya_pagado', 'error')),
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
| Falla interna al aplicar | `error` | responde `500`, Wompi reintenta, y el reintento vuelve a aplicar |

El monto y el plan salen **siempre de nuestra base**, nunca del webhook ni del navegador.

## Aplicar el pago (`confirmarPagoCobro`)

1. `update cobros set estado='pagado', pagado_en=<hoy>, metodo='Wompi' where id=$1 and estado='pendiente'
   returning …`. Una sola sentencia hace de candado: si no devuelve fila, otro camino ya lo aplicó.
2. Si el cobro tiene `plan_destino`: aplica el plan con la regla que hoy vive en `subirPlanPorElDueno`
   (el límite nunca baja, y el "sin tope" de las cuentas viejas sobrevive). Esa lógica se **extrae** a
   `aplicarPlanDestino`, y `subirPlanPorElDueno` deja de ser un camino del dueño.
3. Licencia: `licencia_estado = 'activo'`, `licencia_activa_desde` si estaba vacía, y
   `licencia_monto_mensual` con el precio del plan vigente.
4. Subscribe a Meta (`notificarPagoAMeta`, con `after()`) **solo si el paso 1 reclamó la fila**: un
   reintento del webhook no lo cuenta dos veces.

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
- `lib/comercios/cobros.ts`: `crearCobroPendiente`, `reclamarCobroPagado`.
- `app/api/wompi/webhook/route.ts`: ruta pública (`/api/*` ya queda fuera del matcher del proxy).
- `app/comercio/(protegido)/plan/`: `accionIniciarPagoPlan`, botones de pago, y `pago/resultado/page.tsx`.
- `app/admin/(protegido)/pagos/page.tsx` y un enlace "Pagos" en la navegación del admin.

## Pantallas

**Dueño, `/comercio/plan`:**
- Los botones de subir plan pasan de "cambiar ya" a **"Pasar a Growth · $49/mes · Pagar"**. Tocar crea el
  cobro y lleva a Wompi. El texto que hoy dice "El cambio es inmediato… no te pedimos tarjeta acá" se corrige.
- Una cuenta inactiva ve "Activá tu cuenta" con el botón del primer mes.
- **Próximo pago**: la fecha siguiente al último período pagado, y **Pagar mensualidad** para adelantarla.
- En la lista de cobros, cada pendiente con monto mayor que cero lleva **Pagar**.
- Página de vuelta: "Pago confirmado", "Estamos confirmando tu pago" o "No pudimos confirmarlo".

**Admin, `/admin/pagos`:** fecha, cuenta (con enlace a su ficha), monto, insignia **Real** o **Prueba**,
conciliación (pastilla) y el cuerpo crudo desplegable. Filtro "Solo lo que necesita atención".

## Seguridad

- Firma obligatoria y comparación en tiempo constante. Sin `WOMPI_CLIENT_SECRET`, la ruta responde `500` y no procesa.
- Credenciales solo en el servidor (`import 'server-only'`, sin `NEXT_PUBLIC_`). Nunca se guarda la
  contraseña de la cuenta Wompi, y la app no llama a ningún endpoint que la pida.
- Un enlace equivale a un cobro y a un pago: `cantidadMaximaPagosExitosos: 1`, vigencia de 48 h,
  `esMontoEditable: false`. Si vence, el siguiente toque de Pagar crea otro.
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
falso, y la tabla de conciliación. Con base de datos (necesitan `.env.local`): el candado de
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
| 1 | `lib/wompi/{config,firma,webhook}.ts` y sus pruebas | pruebas puras y mutaciones |
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

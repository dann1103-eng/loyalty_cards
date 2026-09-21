# Pasarela de pagos con Wompi

**Fecha:** 2026-09-21 · **Rama:** `claude/pasarela-wompi` · **Estado:** v2, después de la revisión
independiente del 2026-09-21. **Implementado en la rama** (tareas 1 a 11; ver
`docs/superpowers/plans/2026-09-21-pasarela-wompi.md`), **sin desplegar**: falta que Daniel aplique la migración
`0037` (aplicada por Daniel el 2026-09-21) y corra las pruebas con base de datos. El punto 0 quedó
**resuelto el 2026-09-21**: el App ID y el API Secret del negocio alcanzan para crear enlaces de pago (en modo prueba).

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

1. **El plan nuevo se aplica solo cuando se confirma el pago.**
2. **Un cobro por mes, pagado con un botón.** No se usa la suscripción recurrente de Wompi.
3. **La app del dueño tiene que poder instalarse en el celular y mandarle notificaciones**, con "pago
   pendiente" y "pago próximo" como primeros avisos. Es la **Fase 2**.
4. **Subir de plan con el período ya pagado y en curso se prorratea** (se cobra solo la diferencia por
   los días que faltan). **Al renovar**, sea que suba, baje o siga igual, se cobra el precio completo del
   plan elegido.

## Supuestos míos, a confirmar (cada uno con lo que pasa si no)

- **Las dos situaciones no se pisan.** A mitad de período solo se puede **subir, con prorrateo**. En los
  **últimos 7 días** solo se puede **renovar, con cualquier plan**, al precio completo. Sin esta
  separación, el último día del período un ajuste de $0.67 dejaba el plan alto para siempre, y renovar y
  después subir con prorrateo daba el plan más caro a mitad de precio (lo encontró la revisión). Si
  preferís que en los últimos 7 días también se pueda subir con prorrateo, es una condición en
  `opcionesPago.ts`, pero reabre esos dos agujeros.
- **Bajar de plan:** al renovar, pagando el plan más chico y con la comprobación de cupo. Se aplica **al
  confirmarse el pago**, o sea hasta 7 días antes de que termine el período. A mitad de período sigue
  siendo una solicitud que FM resuelve, y no hay devolución por los días no usados.
- **Los pilotos (cuentas sin plan) que quieran un plan pasan por el pago.** FM puede seguir asignando un
  plan a mano desde la ficha de la cuenta, que no se toca.
- **Precio negociado:** renovar el mismo plan cobra `licencia_monto_mensual` si es mayor que cero (si no,
  el del catálogo). Cambiar de plan cobra el del catálogo y la pantalla lo avisa. El prorrateo se
  calcula contra `licencia_monto_mensual`.
- **Períodos que no son de un mes** (un cobro manual de FM por 3 meses): no hay autogestión de subir.
  La pantalla manda a escribir a FM. La fórmula solo vale para períodos de hasta 31 días.
- **Meta:** Subscribe se envía solo para cobros `tipo = 'periodo'`. Un ajuste es un upgrade, no una
  suscripción nueva, y Meta optimizaría anuncios hacia él.
- **Solo tarjeta de crédito o débito.** Puntos Agrícola, cuotas, Bitcoin, QuickPay y Nequi quedan
  apagados con una constante.
- **Qué pasa cuando un período vence sin renovar: no se hace nada en la Fase 1.** Hoy `licencia_estado`
  no gatea ningún flujo del panel y nada baja un plan por falta de pago; esto **ya era así** y la
  pasarela no lo empeora ni lo arregla. `/admin/pagos` y la ficha de la cuenta muestran el vencimiento.
  Aplicarlo (bajar, bloquear o solo avisar) es decisión de Daniel, ver "Preguntas abiertas".

## Lo que dice la documentación de Wompi

Leída completa el 2026-09-21 (47 páginas de <https://docs.wompi.sv/llms.txt> y el Swagger en
<https://api.wompi.sv/swagger/v1/swagger.json>). Lo que condiciona el diseño:

| Hecho | Consecuencia |
|---|---|
| OAuth2 `client_credentials` contra `POST https://id.wompi.sv/connect/token` (`audience=wompi_api`). El App ID es el `client_id` y el API Secret el `client_secret`. El token dura 3600 s. | Un cliente que cachea el token en memoria y lo renueva antes de vencer. |
| `POST /EnlacePago` crea el enlace y devuelve `idEnlace`, `urlEnlace` (corta), `urlEnlaceLargo`, `urlQrCodeEnlace`. Cada enlace acepta su propio `urlRedirect`, `urlWebhook`, `vigencia`, `limitesDeUso` y `datosAdicionales`. **La página de la doc no dice con qué credenciales se autentica** (las demás sí). El Swagger dice OAuth2 y la página de autenticación usa el token del negocio para `GET /EnlacePago`. | **Sin verificar con una llamada real: es el punto 0 de "A verificar".** Todo el diseño depende de que el App ID y el API Secret alcancen para crear enlaces. |
| Cobrar con nuestra propia pantalla (`/TransaccionCompra/3Ds`) exige mandar número de tarjeta y CVV por nuestro servidor. | No se usa: nos metería en las obligaciones de seguridad de datos de tarjeta. |
| Consultar por id, editar, activar y desactivar enlaces (`/EnlacePago/{id}…`) piden **usuario y contraseña de la cuenta Wompi**. | Esas credenciales no se guardan en la app. Los enlaces son de un solo uso, con vigencia corta, y no hace falta desactivarlos. |
| `GET /TransaccionCompra/{id}` acepta las credenciales del negocio. | Es la verificación autoritativa de un pago en la página de vuelta. |
| El webhook llega **solo para transacciones exitosas**, es un `POST` con cuerpo JSON y el header `wompi_hash`: HMAC-SHA256 en hexadecimal del cuerpo **crudo**, con el API Secret como llave. Wompi reintenta la entrega (la doc no dice cuántas veces ni tras un `500`). | La firma se calcula sobre los **bytes** recibidos, antes de parsear. El manejo es idempotente. |
| El cuerpo del webhook trae `IdTransaccion`, `Monto`, `EsProductiva`, `ResultadoTransaccion` (`ExitosaAprobada`…) y `EnlacePago.IdentificadorEnlaceComercio`. El ejemplo es de 2020 y el Swagger no lo describe. | Se guarda el cuerpo crudo, el parser tolera mayúsculas y minúsculas, y un cuerpo irreconocible con firma válida se guarda igual. |
| **La doc se contradice sobre el hash del redirect de un enlace.** La página de crear enlace dice que es la concatenación de `idTransaccion + monto + esReal + formaPago + esAprobada + codigoAutorizacion + mensaje`. La de validar el redirect dice que es `identificadorEnlaceComercio + idTransaccion + idEnlace + monto`, y los redirects de enlace solo traen esos cuatro. | Se implementa la variante de 4 campos, en ese orden, y **no es bloqueante**: la verdad de la página de vuelta es la consulta a la API. Una diferencia se registra en el log. |
| Modo prueba: todo se aprueba, salvo un CVV `111`. El webhook trae `EsProductiva: false`, y las pruebas no salen en el reporte de Wompi. | Un pago de prueba se registra y se ve, pero nunca activa nada. |
| Un webhook **por enlace** (`configuracion.urlWebhook`) reemplaza al del panel para ese enlace. | Cada enlace lleva la URL del webhook de la app. La misma URL se pone en el panel de Wompi, para que un enlace hecho a mano allá también caiga a `/admin/pagos`. |
| Los enlaces recurrentes exigen que el cliente acepte la suscripción a mano, y la doc no dice si avisan por webhook. | No entran en esta fase. |

## Alcance

**Fase 1 (esta spec):** cliente de Wompi, opciones de pago con prorrateo, enlace por intento de pago,
webhook, conciliación, `/admin/pagos` con sus acciones de resolución, cambio de plan condicionado al pago,
y "próximo pago" visible para el dueño.

**Fase 2 (spec propia, después):** avisos de pago pendiente y pago próximo, app instalable y notificaciones
al celular. Ver el bosquejo al final.

**Fuera de alcance:** suscripciones recurrentes de Wompi, reembolsos (se hacen en el panel de Wompi),
facturación fiscal (sigue sin personería jurídica, ver `cobros.ts`), otras formas de pago, otras
pasarelas, hacer cumplir el vencimiento, y que los clientes finales le paguen a los comercios.

## Flujo de punta a punta

```
dueño en /comercio/plan            servidor                          Wompi
       │ toca una opción de pago      │                                │
       ├─────────────────────────────►│ valida la opción y crea (o     │
       │                              │ reusa) el cobro pendiente      │
       │                              │ POST /EnlacePago ─────────────►│
       │                              │◄──────────── urlEnlace ────────┤
       │◄──── redirige a urlEnlace ───┤                                │
       ├──────────────────────────────┼───────── paga con tarjeta ────►│
       │                              │◄── POST /api/wompi/webhook ────┤  (camino principal)
       │◄── redirige a /comercio/plan/pago/resultado?… ────────────────┤  (camino de respaldo)
       │                              │
       │            ambos caminos terminan en confirmarPagoCobro (idempotente)
       │                              │ → plan y licencia aplicados, cobro pagado, Subscribe a Meta
admin ─┴── ve el evento en /admin/pagos
```

## Confirmar sin depender solo del webhook

Como el plan solo cambia al confirmarse el pago, un webhook lento no puede dejar al dueño colgado.

- **Webhook:** si la firma es válida, se confía en él (es el primer método que documenta Wompi). No llama
  a la API, para no depender de su disponibilidad. Si trae `ResultadoTransaccion` y no es
  `ExitosaAprobada`, no se aplica.
- **Página de vuelta** (`/comercio/plan/pago/resultado`): consulta `GET /TransaccionCompra/{idTransaccion}`
  y solo si `esAprobada` y `esReal` son verdaderos y el monto es el del cobro llama a
  `confirmarPagoCobro`. Además exige que el cobro sea **de la cuenta de la sesión**. Si Wompi todavía no lo
  refleja, muestra "Estamos confirmando tu pago" y se recarga sola unos segundos. Un pago de prueba tiene
  su propio mensaje ("Es un pago de prueba: no cambia tu plan").
- **Si el dueño cierra la pestaña antes de volver**, llega el webhook.
- **Si no llega ninguno**, el cobro sigue pendiente y FM lo resuelve con las acciones de `/admin/pagos`
  (abajo). No existe hoy una acción que marque como pagado un cobro **pendiente**: `registrarCobro` crea
  uno nuevo y `marcarCobroPagado` no aplica plan ni avisa a Meta. Esta spec agrega esa acción.

## Cuánto se cobra

**Definiciones.** "Hoy" es la fecha en `America/El_Salvador` (`hoyEnZona`, que ya existe en
`lib/tarjetas/vigencia.ts`). Los **períodos pagados** son los cobros `tipo = 'periodo'` y
`estado = 'pagado'`. El **período en curso** es el que contiene hoy. Lo **cubierto** llega hasta el
`periodo_hasta` **más lejano** de los períodos pagados. El **precio actual** es `licencia_monto_mensual`.

**Estado de la cuenta y qué se le ofrece** (una sola función pura, `opcionesPago.ts`, que usan la pantalla
y la acción; la acción no acepta montos):

| Estado | Cómo se reconoce | Qué se ofrece | Cuánto paga |
|---|---|---|---|
| **Sin período** | ningún período pagado contiene hoy ni es futuro | Elegir cualquier plan | El precio completo; período nuevo de hoy a un mes menos un día |
| **A mitad de período** | hoy está en un período pagado y faltan **más de 7** días | **Subir** de plan | La diferencia prorrateada; el período no cambia |
| **En la ventana** | hoy está en un período pagado y faltan **7 o menos** días | **Renovar** con cualquier plan (mismo, más caro o más chico) | El precio completo del plan elegido; período nuevo desde el día siguiente a lo cubierto |
| **Ya renovado** | lo cubierto termina **después** del período en curso | Nada por su cuenta | — (para cambiar de plan escribe a FM) |
| **No mensual** | el período en curso dura más de 31 días | Nada por su cuenta | — (escribe a FM) |
| Bajar a mitad de período | — | Solicitud a FM, sin cambios | — |

**Fórmula del prorrateo.** Los días se cuentan completos y **hoy cuenta**: en un período del 1 al 30 de
septiembre, hoy 15, faltan 16 de 30. La aritmética es en **centavos enteros**:

```
ajuste_centavos = redondear( (precio_nuevo_centavos − precio_actual_centavos) × dias_restantes ÷ dias_del_periodo )
```

| Cambio (hoy 15 de septiembre, período 1–30) | Cuenta | Cobra |
|---|---|---|
| Starter → Growth | 20 × 16 ÷ 30 | **$10.67** |
| Growth → Pro | 40 × 16 ÷ 30 | **$21.33** |
| Starter → Pro | 60 × 16 ÷ 30 | **$32.00** |

**Reglas de borde:**
- Redondeo al centavo, hacia arriba en la mitad exacta. Un ajuste menor que $0.01 no se ofrece.
- Solo se ofrece **subir**: el destino es más caro en el catálogo **y** `precio_nuevo − precio_actual > 0`.
  Con un precio negociado igual o mayor al del destino no hay diferencia que cobrar, y la pantalla manda a
  escribir a FM.
- `dias_del_periodo` son los días reales del período (28 a 31).
- **Un período dura un mes calendario menos un día**: el fin es el **mismo día del mes siguiente, con
  tope al último día de ese mes, menos un día**. Uno que arranca el 15 de septiembre termina el 14 de
  octubre. Uno que arranca el 31 de enero termina el 27 de febrero (28 en año bisiesto). Un período que
  arranca el 29, 30 o 31 "deriva" hacia el 28 en los siguientes; es lo esperado.
- **El cobro de un ajuste** lleva `periodo_desde = hoy` y `periodo_hasta` = el fin del período en curso, y
  guarda en `nota` la cuenta hecha ("Starter → Growth, 16 de 30 días"). Un ajuste calculado hoy y pagado
  mañana cobra un día de más: es a favor de FM y el enlace vence antes (ver Seguridad).
- **Renovar con un plan más chico exige que la cuenta quepa**: se bloquea **antes de cobrar** si el
  límite resultante es menor que las unidades usadas, con el mensaje de `resolverSolicitud`. Lo mismo vale
  para un piloto sin plan que elige uno más chico que lo que ya usa. Se vuelve a comprobar al aplicar.
- **Cambiar de plan al renovar reinicia el precio** al del catálogo: la pantalla lo avisa cuando la
  cuenta tenía un precio negociado.
- Un dueño tiene **un solo intento de pago abierto** (un cobro pendiente de la app). Al iniciar otro se
  reusa el existente si es la misma opción con el enlace todavía vigente; si no, el anterior se anula y se
  crea uno nuevo. Solo se anulan cobros que **creó la app** (`metodo = 'Wompi'`), nunca los que registró FM.

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
  add column wompi_enlace_vence timestamptz,
  -- La transacción que pagó este cobro. Sirve para distinguir el REINTENTO de la misma transacción
  -- (se reaplica sin miedo) de un DOBLE PAGO con otra transacción (se marca ya_pagado).
  add column wompi_id_transaccion text,
  -- Un ajuste siempre dice a qué plan sube.
  add constraint cobros_ajuste_con_plan check (tipo <> 'ajuste' or plan_destino is not null);

-- Una transacción paga como máximo un cobro. Es la red de seguridad de la base contra un doble reclamo.
create unique index cobros_wompi_transaccion_uk on cobros (wompi_id_transaccion)
  where wompi_id_transaccion is not null;

-- Como máximo UN intento de pago abierto por cuenta. Cierra la carrera de dos toques o dos pestañas.
-- Los cobros pendientes que registra FM a mano nunca llevan metodo = 'Wompi', así que no entran.
create unique index cobros_un_intento_pendiente on cobros (cuenta_id)
  where estado = 'pendiente' and metodo = 'Wompi';

-- Un registro por cada transacción que Wompi nos informa, que confirmamos por consulta, o que FM aplica a mano.
create table pagos_wompi (
  id uuid primary key default gen_random_uuid(),
  id_transaccion text not null unique,       -- idempotencia: una transacción se procesa una vez
  fuente text not null check (fuente in ('webhook', 'redirect', 'manual')),
  cobro_id uuid references cobros(id),       -- null si el enlace no lo creó la app
  cuenta_id uuid references cuentas_comercio(id),
  identificador_enlace text,                 -- lo que mandamos (el id del cobro) o el de un enlace manual
  monto numeric not null default 0,
  es_real boolean not null default false,
  fecha_transaccion timestamptz,
  conciliacion text not null default 'pendiente' check (conciliacion in (
    'pendiente', 'aplicado', 'prueba', 'sin_cobro', 'cobro_anulado', 'monto_distinto',
    'ya_pagado', 'plan_no_aplicable', 'no_aprobada', 'error')),
  detalle text,
  revisado_en timestamptz,                   -- FM lo marcó como visto; saca el evento de "necesita atención"
  payload jsonb not null,                    -- el cuerpo crudo: trae nombre y correo del pagador
  created_at timestamptz not null default now()
);
create index pagos_wompi_created_idx on pagos_wompi (created_at desc);
create index pagos_wompi_cobro_idx on pagos_wompi (cobro_id);
alter table pagos_wompi enable row level security;   -- deny-all salvo service_role, como el resto
```

`plan_destino`, `tipo` y las columnas de Wompi solo las escribe código nuevo, así que aplicar la migración
antes del deploy no rompe nada de lo que corre hoy.

**Cómo se reconoce un intento de pago de la app:** los cobros que crea la app llevan `metodo = 'Wompi'`
mientras están pendientes. Al confirmarse el pago, `metodo` se conserva.

## Conciliación

Se evalúa **en este orden**. El monto y el plan salen **siempre de nuestra base**, nunca del webhook ni
del navegador.

| # | Situación | `conciliacion` | Efecto |
|---|---|---|---|
| 0 | Firma inválida o ausente | (no se guarda) | `401`, y una línea en el log con los **nombres** de los headers recibidos (para diagnosticar el guion bajo de `wompi_hash`) |
| 1 | Firma válida pero el cuerpo no se reconoce | `error` | se guarda el cuerpo crudo con un id sintético (`sin-id-` + huella del cuerpo) y se responde `200`: mejor un pago visible en el admin que uno perdido por un reintento infinito |
| 2 | Resultado distinto de `ExitosaAprobada` | `no_aprobada` | se guarda y se ve |
| 3 | `EsProductiva` falso y las pruebas no están aceptadas | `prueba` | se guarda y se ve; no aplica nada |
| 4 | El identificador no es un UUID, o no es un cobro de la app (enlace hecho a mano en el panel de Wompi) | `sin_cobro` | se guarda y se ve; `200`. El UUID se valida **antes** de consultar la base |
| 5 | Cobro anulado | `cobro_anulado` | no aplica; FM decide |
| 6 | Monto distinto al del cobro (comparado en centavos) | `monto_distinto` | no aplica; FM decide |
| 7 | Todo bien | `aplicado` | ver "Aplicar el pago" |
| 8 | Se cobró, pero el plan ya no cabe (el dueño agregó un negocio entre medio) | `plan_no_aplicable` | el cobro queda pagado, el plan no cambia, `200`; FM lo resuelve |
| 9 | El cobro ya lo pagó **otra** transacción | `ya_pagado` | no aplica; posible doble pago, FM devuelve |
| 10 | Falla interna | `error` | responde `500`; el reintento (de Wompi o de FM) vuelve a aplicar |

Los estados 5, 6, 8, 9 y 10 quedan en **"necesita atención"** hasta que FM los marque como revisados.

## Aplicar el pago (`confirmarPagoCobro`)

El orden importa: **primero se da el servicio y después se registra el pago**. Si algo falla en el medio,
lo peor que puede pasar es "plan aplicado y cobro todavía pendiente", que el reintento completa. El orden
inverso dejaba "cobro pagado y plan sin aplicar": plata tomada sin servicio.

1. Validar (filas 2 a 6 de la tabla).
2. **Aplicar plan y licencia**, idempotente:
   - Si el cobro tiene `plan_destino`, `aplicarPlanDestino` junta las dos reglas que hoy viven separadas:
     **subir** (`subirPlanPorElDueno`: el límite nunca baja, y el "sin tope" de las cuentas viejas
     sobrevive) y **bajar** (`resolverSolicitud`: comprueba el cupo y fija el límite sugerido).
   - **La dirección la decide la intención del cobro, no el plan que la cuenta tiene al confirmar.** Un
     **ajuste nunca baja**: si la cuenta ya está en ese plan o en uno más caro, no hace nada y sigue. Un
     **período** fija el plan exacto. Aplicar el mismo plan otra vez es un éxito sin cambios.
   - Licencia: `licencia_estado = 'activo'`, `licencia_activa_desde` si estaba vacía, y
     `licencia_monto_mensual` con el precio vigente. Un ajuste no abre ningún período.
   - Si al bajar el cupo ya no alcanza: la conciliación queda en `plan_no_aplicable`, y se sigue con el 3
     (la plata entró).
3. **Reclamar el cobro:** `update cobros set estado='pagado', pagado_en=<hoy>, wompi_id_transaccion=$tx
   where id=$1 and estado='pendiente' returning …`. Una sola sentencia hace de candado.
   - Reclamó la fila: sigue al 4.
   - No la reclamó y `cobros.wompi_id_transaccion` es **esta** transacción: es un reintento propio, sigue.
   - No la reclamó y la pagó **otra** transacción: `ya_pagado`.
4. Subscribe a Meta (`notificarPagoAMeta`, con `after()`), **solo si el paso 3 reclamó la fila** y el cobro
   es de `tipo = 'periodo'`.
5. Fijar la conciliación del evento.

## Acciones de FM en `/admin/pagos`

Sin esto, los estados de "necesita atención" no tendrían salida.

- **Reintentar** (eventos en `error`): vuelve a correr `confirmarPagoCobro` **re-leyendo el cuerpo guardado**,
  no las columnas: un webhook que llegó irreconocible (id `sin-id-…`, monto 0) puede entenderse después con un
  parser arreglado. Si el cuerpo trae otro id de transacción, el reproceso nace como evento nuevo y el viejo
  queda revisado con la nota "Reprocesado como la transacción …".
- **Aplicar a mano** (eventos en `monto_distinto` o `cobro_anulado`): FM decide aceptar ese pago. Corre
  `confirmarPagoCobro` con `fuente = 'manual'`, saltando las comprobaciones de monto y de anulado, y un
  cobro anulado vuelve a `pendiente` antes de reclamarse.
- **Marcar revisado** (cualquier evento que necesita atención): setea `revisado_en`.
- **Marcar pagado** (en la ficha de la cuenta, sobre un cobro pendiente de la app): para cuando el dueño
  pagó por otro medio. Crea un evento `manual` con id sintético y aplica igual que un pago real.

## Módulos

- `lib/wompi/config.ts`: lee las variables de entorno (`server-only`). Las pruebas se aceptan **solo** si
  `WOMPI_ACEPTAR_PRUEBAS = '1'` **y** `VERCEL_ENV` está ausente o es `development`. Es una lista de
  permitidos y no de denegados: un despliegue Preview comparte la base real y con la regla inversa
  (`!== 'production'`) aceptaría pruebas.
- `lib/wompi/firma.ts`: HMAC-SHA256 hexadecimal **sobre bytes**, comparación con `timingSafeEqual` y en
  minúsculas, y el hash del redirect (variante de 4 campos).
- `lib/wompi/cliente.ts`: token en memoria (se renueva antes de vencer), `crearEnlacePago` y
  `consultarTransaccion`, con `fetch` inyectable para probar sin red.
- `lib/wompi/webhook.ts`: parser tolerante del cuerpo (mayúsculas o minúsculas) que devuelve un objeto
  tipado o un motivo de rechazo.
- `lib/comercios/prorrateo.ts`: **puro**. Aritmética de fechas y de dinero, sobre `sumarDias` de
  `lib/tarjetas/vigencia.ts`. `calcularAjuste`, `hastaDelPeriodo`, `estadoDelPeriodo` y
  `DIAS_VENTANA_RENOVACION = 7`.
- `lib/comercios/opcionesPago.ts`: **puro**. La tabla "Estado de la cuenta y qué se le ofrece". Es la
  **única fuente de verdad** de la pantalla y de la acción.
- `lib/comercios/cobros.ts`: `crearCobroPendiente`, `guardarEnlaceDelCobro`, `reclamarCobroPagado`,
  `anularIntentosPendientes`, `listarPeriodosPagados`.
- `lib/comercios/planCuenta.ts`: se **extrae** `aplicarPlanDestino` y se agrega `activarLicencia`.
  `subirPlanPorElDueno` queda como envoltorio delgado para no romper sus pruebas, y **`accionSubirPlan` se
  borra** (si quedara exportada seguiría siendo una acción de servidor que sube de plan gratis).
- `lib/comercios/confirmarPago.ts`: la orquestación de arriba, con un **repositorio inyectable** (una
  interfaz con las operaciones de base de datos): su lógica se prueba sin base de datos y con
  mutaciones. `repositorioPagosSupabase.ts` es el adaptador real, que se prueba contra la base.
- `lib/comercios/iniciarPagoPlan.ts`: crea el intento (cobro pendiente + enlace de Wompi), con sus
  dependencias inyectables por la misma razón.
- `app/api/wompi/webhook/route.ts`: ruta pública (`/api/*` ya queda fuera del matcher del proxy).
- `app/comercio/(protegido)/plan/`: acción de iniciar pago, opciones en pantalla y `pago/resultado/page.tsx`.
- `lib/comercios/pagosAdmin.ts`: las reglas **puras** del panel (`necesitaAtencion`, `accionesDisponibles`,
  `entradaParaReintentar`, `describirPeriodo`) y las consultas (`listarPagos`, `obtenerPago`,
  `contarPagosAtencion`, `marcarRevisado`). `lib/comercios/resolverPagos.ts`: `reintentarPago`,
  `aplicarPagoAMano` y `marcarCobroPagadoAMano`, con el repositorio inyectable; cada una **revalida el estado
  del evento en el servidor** (el botón de la pantalla puede estar viejo).
- `app/admin/(protegido)/pagos/`: la pantalla y **una sola acción** (`accionResolverPago`, con `accion` en el
  formulario: un estado único hace que el mensaje sea el de lo último que hizo FM), más un enlace "Pagos" con
  la cuenta de los que necesitan atención. En la ficha de la cuenta: `accionMarcarCobroPagado`, las insignias
  de tipo y plan, y la línea de vencimiento.

## Pantallas

**Dueño, `/comercio/plan`:** las opciones salen de `opcionesPago.ts`.
- **A mitad de período:** "Pasar a Growth · pagás $10.67 hoy (16 días que faltan)" y, en chico, "Desde el
  1 de octubre, $49/mes".
- **En la ventana:** "Renovar con Starter · $29", "Renovar con Growth · $49"… con el precio completo a la
  vista, y el aviso de que cambiar de plan reinicia un precio negociado.
- **Sin período:** "Elegir Growth · $49". Una cuenta inactiva ve "Activá tu cuenta".
- **Ya renovado o no mensual:** un texto que manda a escribir a FM. Una opción bloqueada por cupo dice
  cuánto usa y cuánto permite el plan.
- **Próximo pago:** la fecha siguiente a lo cubierto.
- El texto "El cambio es inmediato… no te pedimos tarjeta acá" se corrige.
- En la lista de cobros, un pendiente de la app con su enlace vigente lleva **Continuar pago**. Los ajustes
  se distinguen ("Ajuste por subir de plan").
- Página de vuelta: "Pago confirmado", "Estamos confirmando tu pago", "Es un pago de prueba" o "No
  pudimos confirmarlo".

**Admin, `/admin/pagos`:** fecha, cuenta (con enlace a su ficha), monto, insignia **Real** o **Prueba**,
conciliación (pastilla), el cuerpo crudo desplegable, y las acciones de arriba. Filtro "Solo lo que
necesita atención". La ficha de la cuenta muestra si el período venció.

## Seguridad

- Firma obligatoria, calculada sobre los **bytes** del cuerpo (`arrayBuffer`): `request.text()` descarta
  un BOM inicial y reemplaza bytes inválidos, y con eso la firma dejaría de coincidir. Comparación en
  tiempo constante y en minúsculas. Sin `WOMPI_CLIENT_SECRET`, la ruta responde `500` y no procesa.
- Credenciales solo en el servidor (`import 'server-only'`, sin `NEXT_PUBLIC_`). Nunca se guarda la
  contraseña de la cuenta Wompi, y la app no llama a ningún endpoint que la pida.
- **Un enlace equivale a un intento y a un pago**: `cantidadMaximaPagosExitosos: 1`,
  `esMontoEditable: false`, `esCantidadEditable: false`, `cantidadPorDefecto: 1`, las seis formas de pago
  explícitas (solo tarjeta en `true`), y vigencia de **2 horas** (`fechaInicio` es obligatoria en el
  Swagger cuando se manda `vigencia`). Una vigencia corta acota las dos fugas que no se pueden cerrar del
  lado de Wompi (no se pueden desactivar enlaces): pagar un enlace de un intento ya anulado, y pagar
  cuando el precio ya no corresponde. Un ajuste solo se ofrece con más de 7 días de período por delante,
  así que 2 horas nunca cruzan su fin.
- Los importes salen de `opcionesPago.ts` en el servidor. La acción del dueño recibe **solo el plan y la
  acción elegidos**, nunca un monto.
- La página de vuelta exige que el cobro sea de la cuenta de la sesión (mismo patrón que `obtenerCobro`).
- El cuerpo crudo guarda nombre y correo del pagador: lo lee solo el admin y no se le muestra al dueño.
- Un pago de prueba no activa nada. Ver la regla de `VERCEL_ENV` en `config.ts`.
- Los enlaces y el webhook apuntan a `www.cardly-sv.site` (`NEXT_PUBLIC_BASE_URL`), directo, sin redirect
  entre el apex y `www`.

## Variables de entorno

`WOMPI_CLIENT_ID` y `WOMPI_CLIENT_SECRET` (secretos), `WOMPI_ACEPTAR_PRUEBAS` (solo desarrollo), y
opcionales `WOMPI_API_URL` y `WOMPI_ID_URL`. Solo los **nombres** van en `.env.local.example`.

## Pruebas

**Puras** (corren sin `.env.local`): firma, hash del redirect, parser del webhook, cliente con `fetch`
falso, prorrateo, opciones de pago, y **`confirmarPago` y `iniciarPagoPlan` con un repositorio falso** (que
implementa el candado con la misma semántica que la base). Las pruebas de fechas corren con
`TZ=UTC` y con `TZ=America/El_Salvador`, porque `new Date('2026-09-30')` da otro día según el huso.
**Con base de datos** (necesitan `.env.local` y la migración): el adaptador real, con dos reclamos
concurrentes del mismo cobro, y `aplicarPlanDestino`. Cada rama crítica lleva su mutación.

| Aserción | Qué romper | Falla con |
|---|---|---|
| Firma sobre el cuerpo crudo | calcular el HMAC sobre `JSON.stringify(JSON.parse(cuerpo))` | la prueba con espacios y saltos de línea falla |
| Firma sobre bytes | calcularla sobre el texto ya decodificado | la prueba con un BOM inicial falla |
| Longitud distinta | quitar el chequeo de longitud antes de `timingSafeEqual` | la prueba de firma corta lanza en vez de devolver `false` |
| Orden del hash del redirect | invertir `idTransaccion` e `idEnlace` | el hash armado en la prueba con `node:crypto` deja de coincidir (los ejemplos de la doc no traen el secreto, no sirven de vector) |
| Prueba no activa | ignorar `esReal` | `prueba` pasa a `aplicado` |
| Guarda de entorno | aceptar pruebas con `VERCEL_ENV = 'preview'` | la prueba de config falla |
| Resultado | ignorar `ResultadoTransaccion` | una declinada se aplica |
| Monto | comparar contra el monto del webhook en vez del del cobro | un monto alterado se aplica |
| UUID | quitar la validación del identificador | un identificador manual llega a la consulta y da `error` en vez de `sin_cobro` |
| Idempotencia | quitar `estado='pendiente'` del reclamo | dos llamadas reclaman dos veces y Meta se notifica dos veces |
| Reintento propio | quitar la comparación de `wompi_id_transaccion` | un reintento legítimo queda como `ya_pagado` |
| Doble pago | tratar toda repetición como reintento propio | una segunda transacción se marca `aplicado` |
| Orden | reclamar antes de aplicar el plan | la prueba de fallo en el paso de plan deja el cobro pagado y el plan sin cambiar |
| Ajuste nunca baja | quitar la regla | un ajuste pagado sobre una cuenta que ya subió la baja de plan |
| Meta | avisar también en ajustes | un ajuste dispara Subscribe |
| Días restantes | no contar hoy | Starter → Growth el 15 de septiembre da $10.00 en vez de $10.67 |
| Días del período | usar 30 fijo | un período de 31 o de 28 días da otro importe |
| Redondeo | truncar | 20 × 16 ÷ 30 da $10.66 |
| Centavos | operar en punto flotante | un caso de mitad exacta ($0.50 negociado) se desvía un centavo |
| Solo subir | quitar `precio_nuevo − precio_actual > 0` | un precio negociado mayor genera un ajuste negativo |
| Ventana | ampliarla a 30 días | el día 10 del período ofrece renovar |
| Fases disjuntas | ofrecer ajuste dentro de la ventana | el último día se ofrece un ajuste de $0.67 |
| Ya renovado | ofrecer renovar de nuevo | una cuenta ya renovada vuelve a ver "Renovar" |
| Lo cubierto | usar el período que contiene hoy en vez del más lejano | el siguiente período arranca en una fecha ya cubierta |
| Precio negociado | usar el precio del catálogo al renovar el mismo plan | una cuenta con precio pactado paga de más |
| Cupo | quitar la comprobación al bajar | una cuenta con 3 unidades baja a Starter (tope 1) |
| Fin de mes | sumar 30 días en vez de un mes calendario | un período del 31 de enero no termina el 27 de febrero |
| `accionSubirPlan` | volver a exportarla | la prueba de que ya no existe falla |

## A verificar en la primera prueba real (modo prueba)

0. **Que el App ID y el API Secret alcancen para crear un enlace** (`POST /EnlacePago`). La página de la
   doc no dice con qué credenciales se autentica. Es lo primero que se prueba, con un script de solo
   lectura y creación de un enlace de prueba (Tarea 5), **antes** de construir sobre el cliente.
1. La forma **real** del webhook frente al ejemplo de 2020. El cuerpo crudo queda guardado para esto.
2. Que `wompi_hash`, con guion bajo, llegue por Vercel. Si no llegara, el camino de vuelta sigue
   confirmando pagos y se decide ahí. El log de la ruta imprime los nombres de los headers.
3. Cuál de las dos variantes del hash del redirect usa Wompi (la doc se contradice).
4. Que `GET /TransaccionCompra/{id}` devuelva las transacciones de un enlace con las credenciales del
   negocio, y si `datosAdicionales` (que el enlace acepta) vuelve ahí: serviría de segundo vínculo entre
   la transacción y el cobro.
5. Cuántas veces y por cuánto tiempo reintenta Wompi, y si reintenta ante un `500`.
6. Si un mismo `identificadorEnlaceComercio` admite un segundo enlace.
7. Que el redirect admita una URL con querystring.

Para probar el webhook hace falta una URL pública. Como un pago de prueba **no activa nada** en Vercel,
desplegar con las credenciales de prueba prueba la firma, el header y el formato, sin riesgo. Para probar
la activación de punta a punta hace falta un túnel a `localhost` con `WOMPI_ACEPTAR_PRUEBAS=1` en
`.env.local` y `NEXT_PUBLIC_BASE_URL` apuntando al túnel.

**Lista para pasar a producción real:** poner el negocio de Wompi en productivo, verificar
`estaProductivo: true` en la respuesta de un enlace, regenerar el API Secret (apareció en una captura),
cambiar las variables en Vercel, y confirmar que el webhook del panel apunta a `www`.

## Orden de entrega

| Tarea | Qué | Se verifica |
|---|---|---|
| 1 | `prorrateo.ts` y `opcionesPago.ts` | pruebas puras, con `TZ=UTC` y `TZ=America/El_Salvador`, y mutaciones |
| 2 | `lib/wompi/{config,firma,webhook}.ts` | pruebas puras y mutaciones |
| 3 | `lib/wompi/cliente.ts` | `fetch` falso |
| 4 | Migración `0037`, tipos y script de verificación | Daniel aplica la migración; verificación de solo lectura |
| 5 | **Script de conexión** (`scripts/probar-wompi.ts`) | Daniel lo corre y me pasa lo que imprime (sin secretos): responde el punto 0 |
| 6 | `planCuenta.ts` (`aplicarPlanDestino`, `activarLicencia`, borrar `accionSubirPlan`) y `cobros.ts` | pruebas con base de datos (las corre Daniel) |
| 7 | `confirmarPago.ts` y el adaptador | repositorio falso con mutaciones; adaptador contra la base |
| 8 | Ruta del webhook | pruebas de la ruta con firma válida e inválida |
| 9 | `iniciarPagoPlan.ts` | repositorio falso |
| 10 | Pantalla del dueño, acción y página de vuelta | recorrido en el navegador |
| 11 | `/admin/pagos` y sus acciones | recorrido en el navegador |
| 12 | `.env.local.example`, `DESIGN.md` si aplica, `ESTADO-Y-PLAN` | lectura |
| 13 | Revisión final del conjunto | como la del rediseño |

**Despliegue:** migración primero, deploy después. Después de desplegar, Daniel pone la URL del webhook en
el panel de Wompi y hace la primera prueba real.

## Preguntas abiertas para Daniel (cada una con mi valor por defecto)

1. **¿Qué pasa cuando un período vence sin renovar?** Por defecto: nada en la Fase 1, solo se muestra.
   Hacer cumplir el pago (bajar el plan, bloquear altas nuevas o solo avisar) es una decisión de producto y
   toca el alta pública, que hoy da el cupo del plan sin cobrar.
2. **¿Las fases disjuntas** (subir con prorrateo a mitad de período, renovar en los últimos 7 días) **te
   cierran?** Por defecto sí, por los dos agujeros que cierran.
3. **¿Bajar al renovar se aplica ya o al empezar el período siguiente?** Por defecto, ya (hasta 7 días
   antes). Aplicarlo al empezar el siguiente necesita un proceso que lo ejecute ese día.
4. **¿Un ajuste dispara Subscribe a Meta?** Por defecto no.
5. **¿El negocio de Wompi es solo de Cardly?** Si lo comparten otros sistemas, el webhook del panel les
   cambiaría las notificaciones. Por defecto se asume que es solo de Cardly.

## Fase 2: avisos al celular del dueño (bosquejo, spec propia)

Hoy no hay nada de esto: el manifest actual es del portal del cliente (`/mi-tarjeta`), no hay service
worker ni la librería de Web Push, y las "notificaciones push" de la migración `0026` son de los pases
de Wallet de los clientes finales.

- **Los avisos salen de las fechas, no de cobros autogenerados.** "Pago próximo" y "pago pendiente" se
  calculan con los períodos pagados y la ventana de 7 días; un cron que crease cobros pendientes chocaría
  con la regla de un solo intento abierto y avisaría de cobros que el dueño no eligió.
- **Sin un cron nuevo:** ya hay dos en `vercel.json` y el plan Hobby de Vercel permite dos. Los avisos de
  pago se suman a `/api/cron/avisos`.
- **App instalable:** manifest propio para `/comercio` (`start_url` en el panel, `display: standalone`,
  íconos), service worker, y un botón "Instalar" con las instrucciones de iOS (Compartir → Agregar a
  inicio), porque iOS solo entrega push a una app ya instalada (iOS 16.4 o superior).
- **Web Push:** claves VAPID, la dependencia `web-push`, una tabla de suscripciones por dueño, el permiso
  pedido con un toque del usuario, envío desde el cron, y limpieza de suscripciones muertas.
- **A decidir cuando llegue:** cuántos días antes avisar (propuesta: los mismos 7 de la ventana), qué
  cuenta como "vencido" (depende de la pregunta 1), y si el cajero también recibe avisos (propuesta: solo
  los dueños).

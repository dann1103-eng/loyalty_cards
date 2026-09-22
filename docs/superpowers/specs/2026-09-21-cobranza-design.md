# Cobranza: pedir un pago, ciclos vencidos, bloqueo y excepciones

**Fecha:** 2026-09-21 · **Estado:** borrador para revisión de Daniel. Nada de esto está implementado. Se apoya
en la pasarela Wompi (`docs/superpowers/specs/2026-09-21-pasarela-wompi-design.md`), ya construida.

## Por qué

La pasarela deja que el dueño pague su plan con un botón, pero nada obliga a pagar ni permite a FM manejar los
casos reales: pedirle un pago a un cliente en cualquier momento (también para probar), regalar el servicio a un
cliente (Barbiere Di Paolo), posponer un pago o perdonar un ciclo. Hoy `licencia_estado` es solo informativo:
**no gatea nada**. Esta spec agrega la regla de negocio que Daniel pidió y las herramientas de FM para manejarla.

## Decisiones de Daniel (2026-09-21)

1. **FM puede pedirle un pago a un cliente** cuando quiera, no solo al terminar el ciclo (sirve para probar).
2. **Si una cuenta no paga 15 días después de que venció su ciclo, se bloquea.** El bloqueo es **el panel y el
   escáner del comercio**: el dueño y sus cajeros ven una pantalla de cuenta suspendida y el dueño solo puede
   entrar a `/comercio/plan` a pagar. **Las tarjetas y el Wallet de los clientes finales siguen funcionando.**
3. **Solo FM autoriza que una cuenta esté activa sin pagar.** Herramientas de FM: **posponer** el pago, **perdonar**
   el ciclo, y dejar a un cliente como **exento** (no paga nunca, como Barbiere Di Paolo).
4. **Las cuentas que ya existen quedan exentas** el día que se publica: nada cambia hasta que FM las pase a
   «normal» una por una, cuando empiece a cobrarles.
5. Después de esto viene el rework del admin (spec aparte).

## Supuestos míos, a confirmar (cada uno con lo que pasa si no)

| Supuesto | Si no |
|---|---|
| «Marcar impago» **no es una acción**: el estado se **deriva de las fechas**. No hace falta un cron ni un botón. | Si querés marcar a mano, se agrega un modo «moroso» manual. |
| **Vencimiento** = el fin del último período **pagado** (`cubiertoHasta`). Bloquea cuando `hoy` supera el vencimiento en **más de 15 días**. | Cambia `DIAS_GRACIA_COBRANZA`, una constante. |
| Una cuenta **nueva o recién pasada a «normal» que nunca pagó** cuenta desde su `cobranza_desde` (el día que se creó o se pasó a normal): tiene **15 días para el primer pago**, y después se bloquea. | Si querés un plazo distinto para el primer pago, se separa la constante. |
| **Posponer hasta una fecha** = «no se bloquea hasta esa fecha (inclusive)». Pasada la fecha, vuelve la regla normal desde el vencimiento real, así que si ya pasaron más de 15 días desde el vencimiento, se bloquea al día siguiente. | Alternativa: que la fecha mueva el vencimiento y se sumen 15 días más. |
| **Perdonar el ciclo** cubre justo el ciclo que venció (arranca el día siguiente al último período pagado) con un cobro de **$0** pagado. El siguiente ciclo se paga normal. No dispara el Subscribe de Meta. | — |
| Una cuenta **exenta** ve en su plan «Tu cuenta tiene el servicio sin costo» y no ve botones de pago propios. Un pago que FM le pida sí lo puede pagar. | Si querés que igual pueda pagar por su cuenta, se muestran las opciones. |
| **`licencia_estado`** (activo/inactivo) **no se toca**: sigue siendo informativo. El rework del admin lo unifica con la cobranza. | — |
| Las **campañas y avisos automáticos** a clientes finales siguen corriendo en una cuenta bloqueada. | Se pueden frenar para cuentas bloqueadas en una segunda vuelta. |
| El **registro público** de clientes finales (`/registro/<comercio>`) sigue abierto en una cuenta bloqueada. | Se puede cerrar en una segunda vuelta. |

## Modelo de datos (migración 0038, se aplica a mano ANTES del deploy)

```sql
-- 0038: cobranza por cuenta (spec 2026-09-21-cobranza-design.md).
alter table cuentas_comercio
  add column cobranza text not null default 'normal'
    check (cobranza in ('normal', 'exenta')),
  add column cobranza_desde date not null default current_date,
  add column cobranza_pospuesta_hasta date;

-- Las cuentas que YA existen no empiezan a cobrarse solas: quedan exentas hasta que FM las pase a 'normal'.
update cuentas_comercio set cobranza = 'exenta';
```

- `cobranza`: `'normal'` (se cobra y se puede bloquear) o `'exenta'` (nunca se bloquea). **Cuentas nuevas: `normal`**
  por defecto. El formulario de «Nueva cuenta» de FM lleva el selector, para crear una exenta desde el principio.
- `cobranza_desde`: desde cuándo se cuenta el plazo si la cuenta nunca pagó. Pasar una cuenta a `normal` lo pone
  en **hoy**: el cliente arranca con 15 días.
- `cobranza_pospuesta_hasta`: fecha hasta la que no se bloquea, o `null`.
- **Sin cambios de esquema en `cobros`.** Un cobro pedido por FM lleva `metodo = 'Pedido por FM'` y uno perdonado
  `metodo = 'Perdonado por FM'`. Migración primero, deploy después, como siempre: el código nuevo escribe estas
  columnas y sin la migración fallaría todo el guardado de cuentas.

## Estado de cobranza (derivado, función pura)

`estadoDeCobranza({ cobranza, desde, pospuestaHasta, periodosPagados, hoy })`. Se evalúa **en este orden**:

| # | Situación | Estado |
|---|---|---|
| 1 | `cobranza = 'exenta'` | `exenta` |
| 2 | `pospuestaHasta` y `hoy <= pospuestaHasta` | `pospuesta` (con la fecha) |
| 3 | Hay períodos pagados y `hoy <= cubiertoHasta` | `al_dia` (con hasta cuándo y los días que quedan) |
| 4 | El vencimiento es `cubiertoHasta` (o `desde` si nunca pagó), `diasVencida = hoy − vencimiento`, y `diasVencida <= 15` | `vencida` (con `diasVencida`, `diasParaBloqueo = 15 − diasVencida` y si es el primer pago) |
| 5 | `diasVencida > 15` | `bloqueada` (con `diasVencida`) |

Reglas: se compara con fechas `AAAA-MM-DD` de calendario (sin horas), en la zona de El Salvador, igual que el
resto de la cobranza (`prorrateo.ts`). Un período pagado en el futuro cuenta para `cubiertoHasta`. Un cobro de
$0 perdonado cuenta como pagado.

## Acciones de FM (ficha de la cuenta)

Todas son acciones de servidor con `verifyFmAdmin()` primero y fuera de `try/catch`, y delegan en `lib/` con
pruebas.

1. **Modo de cobranza** (`exenta` / `normal`). Pasar a `normal` fija `cobranza_desde = hoy`. Pasar a `exenta`
   limpia la fecha de posponer.
2. **Posponer el pago** hasta una fecha (futura). Se puede quitar.
3. **Perdonar este ciclo:** crea un cobro `periodo`, `pagado`, monto 0, `metodo = 'Perdonado por FM'`, cubriendo
   el ciclo que venció (desde el día siguiente al último período pagado, o desde `cobranza_desde` si nunca pagó),
   con `pagado_en = hoy`. Pide confirmación aparte. No avisa a Meta.
4. **Pedir un pago al cliente:** FM elige el **monto** (precargado con el del plan, editable: sirve para probar con
   $1), el **plan** (opcional: si lo hay, se aplica al pagar) y el **período**. Crea un cobro `pendiente` con
   `metodo = 'Pedido por FM'`. El dueño lo ve en su plan con un botón **«Pagar $X»**.
5. **Anular un cobro pendiente** (de cualquier tipo). Hoy no existe.

Además: **«Marcar pagado»** (ya existe) también sirve para un cobro pedido por FM cuando el cliente pagó por otro
medio.

## Pedir un pago al cliente: cómo lo paga el dueño

- El cobro de FM **no se crea con enlace**: el enlace de Wompi dura 2 horas y el dueño puede tardar días. Se crea
  **cuando el dueño toca «Pagar»** (acción `accionPagarCobro`): valida que el cobro sea **de su cuenta** y esté
  pendiente y pedido por FM, y si ya tiene un enlace vigente lo reusa; si no, crea uno nuevo y lo guarda.
- **No choca con el intento propio del dueño.** El índice único de «un intento abierto por cuenta» cubre solo
  `metodo = 'Wompi'`, así que un cobro `Pedido por FM` convive con él, y `anularIntentosPendientes` no lo toca.
- La confirmación es la de siempre (`confirmarPagoCobro`): busca el cobro por el identificador del enlace, compara
  el monto, aplica el plan si hay y marca pagado. El Subscribe a Meta sale igual que con cualquier cobro de período.
- **Spike resuelto (2026-09-21, negocio de Wompi en modo prueba):** SÍ acepta dos enlaces con el mismo
  `identificadorEnlaceComercio` — se creó `spike-dup-…` dos veces seguidas y las dos veces Wompi devolvió un
  `idEnlace` distinto sin quejarse. `accionPagarCobro` puede simplemente crear un enlace nuevo cada vez que hace
  falta (el anterior venció, o no había ninguno), sin anular ni editar nada antes.

## Cómo se bloquea (el gate)

`verifyComercioAcceso()` (`lib/comercio/verifyComercioAcceso.ts`) es el gate **único** del panel, del escáner y de
sus acciones. Se le agrega la cobranza:

- El **layout** de `(protegido)` usa una variante **sin bloqueo** (`verifyComercioAccesoSinBloqueo`): dibuja el
  shell y un **banner** según el estado. Un `redirect()` desde el layout sacaría también a `/comercio/plan`.
- **Cada página y cada acción** llaman a `verifyComercioAcceso()`, que **sí bloquea**: si la cuenta está `bloqueada`,
  redirige al **dueño** a `/comercio/plan?suspendida=1` y al **cajero** a `/comercio/suspendida` (sin acceso a
  pagar). **`/comercio/plan`, su página de resultado, el comprobante y `/comercio/suspendida` usan la variante
  sin bloqueo.**
- El costo: una consulta a la cuenta por request. Si la cuenta es `exenta` no se consulta nada más; si es
  `normal`, una consulta a los períodos pagados. Ambas quedan memoizadas por render (`cache`).
- `redirect()` funciona lanzando: sigue **fuera** de todo `try/catch`.

## Pantallas

**Dueño (`/comercio/plan` y banner del panel):**
- `vencida`: banner «Tu pago venció hace N días. Te quedan M días antes de que se suspenda tu cuenta» con el botón
  de pagar. Primer pago: «Tu período de prueba termina en M días».
- `bloqueada`: pantalla «Tu cuenta está suspendida» con las opciones de pago; el resto del panel redirige acá.
- `pospuesta`: «Tu pago está pospuesto hasta el …».
- `exenta`: «Tu cuenta tiene el servicio sin costo», sin botones de pago propios.
- Cobros pedidos por FM y pendientes: **«Pagar $X»** en la lista de cobros.
- Cajero con la cuenta bloqueada: `/comercio/suspendida`, «La cuenta está suspendida. Avisale al dueño».

**FM (ficha de la cuenta):** una sección **«Cobranza»** arriba, con el estado (`Al día hasta …`, `Vencida hace N
días`, `Bloqueada`, `Exenta`, `Pospuesta hasta …`) y los controles de las cinco acciones. **La lista de cuentas**
lleva una insignia de estado por cuenta. El rework del admin (spec aparte) reorganiza todo esto.

## Seguridad

- Cada acción de FM: `verifyFmAdmin()` primero. El dueño **no puede** tocar su modo de cobranza, ni posponer, ni
  perdonar: no hay ninguna acción suya que escriba esas columnas.
- `accionPagarCobro` recibe solo el id del cobro y lo **acota a la cuenta de la sesión**: un id ajeno no sirve.
  El monto sale de la base, nunca del navegador.
- El bloqueo se aplica en el **servidor**: un cajero no puede acreditar desde una pestaña vieja o con una acción
  armada a mano, porque cada acción llama al gate.

## Pruebas (con mutación obligatoria)

- `estadoDeCobranza`: pura, con `TZ=UTC` y `TZ=America/El_Salvador`. Mutaciones: no distinguir exenta, posponer
  exclusivo/inclusivo, el día 15 exacto (no bloquea) y el 16 (bloquea), vencimiento tomado del período equivocado,
  primer pago contra `cobranza_desde`, período perdonado como pagado.
- `periodoAPerdonar`: pura (el ciclo que venció, fin de mes, nunca pagó).
- Acciones de FM y `accionPagarCobro`: contra la base (las corre el asistente con el cwd en el checkout principal).
  Mutaciones: cobro de otra cuenta, cobro ya pagado, monto del navegador, perdonar dispara Meta.
- El gate: pruebas de que un cajero y un dueño de cuenta bloqueada son redirigidos, y de que `/comercio/plan`
  no lo es.

## Fuera de alcance (anotado)

Cobro recurrente automático de Wompi; notificaciones al celular (Fase 2 de la pasarela); frenar campañas y avisos
a clientes finales en una cuenta bloqueada; cerrar el registro público de una cuenta bloqueada; que el dueño
pida él mismo posponer (hoy lo hace escribiéndote); historial de auditoría de los cambios de modo; unificar
`licencia_estado` con la cobranza (rework del admin).

## Orden de entrega

| Tarea | Qué | Se verifica |
|---|---|---|
| 0 | ~~**Spike:** enlace duplicado con el mismo identificador~~ **HECHO** (2026-09-21): Wompi lo acepta | script contra el negocio de Wompi en prueba |
| 1 | Migración `0038` y tipos | Daniel aplica; verificación de solo lectura |
| 2 | `estadoDeCobranza` y `periodoAPerdonar` (puras) | pruebas + mutaciones, en las dos zonas |
| 3 | Capa de datos y acciones de FM (modo, posponer, perdonar, pedir pago, anular) | pruebas con base + mutaciones |
| 4 | `accionPagarCobro` (dueño paga un cobro pedido) | pruebas con base + recorrido en el navegador |
| 5 | El gate (`verifyComercioAcceso`) y las pantallas del dueño y del cajero | pruebas del gate + navegador |
| 6 | Ficha de la cuenta y lista de cuentas de FM | navegador |
| 7 | Revisión final del conjunto | como la de la pasarela |

**Despliegue:** migración primero, deploy después. Como la migración deja todas las cuentas existentes exentas,
publicar no cambia nada para ningún cliente hasta que FM las pase a «normal».

## Preguntas abiertas para Daniel (cada una con mi valor por defecto)

1. ¿Los **15 días** valen igual para el primer pago de una cuenta nueva (período de prueba de 15 días)? Por
   defecto sí.
2. ¿Una cuenta **exenta** debe poder pagar por su cuenta si quiere? Por defecto no ve botones; FM le puede pedir
   un pago.
3. ¿Querés que la lista de cuentas **avise** (por ejemplo con un número en la barra, como «Pagos») cuántas están
   vencidas o bloqueadas? Por defecto solo la insignia en la lista.

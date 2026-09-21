# Pasarela de pagos con Wompi — plan de implementación (registro de lo hecho)

> **Para agentes:** este documento NO trae bloques de código a propósito. El plan se ejecutó tarea por
> tarea directamente contra la spec, sin un plan con código escrito de antemano, y **los archivos
> publicados son la única fuente de verdad**: copiar código acá solo dejaría una segunda versión que un
> agente futuro podría "restaurar" por encima de un arreglo posterior. Cada tarea apunta a sus archivos y a
> su commit.

**Objetivo:** que el dueño pague su plan (o suba de plan, con prorrateo) con un botón dentro de la app, y
que cada transacción de Wompi caiga al panel de FM, con el plan aplicado solo cuando el pago se confirma.

**Arquitectura:** un enlace de pago de Wompi por intento (`cobros` con `metodo = 'Wompi'`), confirmado por
dos caminos que terminan en la MISMA función (`confirmarPagoCobro`): el webhook firmado y la página de
vuelta del dueño. La lógica corre contra un repositorio inyectable (falso en las pruebas, Supabase en
producción). El dinero se calcula en centavos enteros.

**Tecnología:** Next.js 16 (App Router), Supabase, Vitest 4, TypeScript estricto. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-09-21-pasarela-wompi-design.md` (v2). **Leela antes de tocar nada.**

**Rama:** `claude/pasarela-wompi`. **Nada está publicado ni desplegado.**

---

## Estado por tarea

| # | Tarea | Estado | Commit | Archivos principales |
|---|---|---|---|---|
| 1 | Prorrateo, límite por plan y opciones de pago (puros) | ✅ mutaciones corridas | `def3cad` | `lib/comercios/{prorrateo,limitePlan,opcionesPago}.ts` |
| 2 | Configuración, firma sobre bytes y parser del webhook | ✅ mutaciones corridas | `f393b4e` | `lib/wompi/{config,firma,webhook}.ts` |
| 3 | Cliente de la API (token en memoria, reintento ante 401) | ✅ mutaciones corridas | `9f29d26` | `lib/wompi/cliente.ts` |
| 4 | Migración `0037`, tipos y script de verificación | ✅ aplicada por Daniel y verificada el 2026-09-21 (15 de 15 OK) | `7260101` | `supabase/migrations/0037_pagos_wompi.sql`, `lib/supabase/types.ts`, `scripts/verificar-0037.ts` |
| 5 | Script de conexión (punto 0) | ✅ corrido el 2026-09-21: las credenciales del negocio crean enlaces | `74cf235` | `scripts/probar-wompi.ts` |
| 6 | `planCuenta` (`aplicarPlanDestino`, `activarLicencia`), `cobros`; se borra `accionSubirPlan` | ✅ con pruebas de base y mutaciones | `e6a42eb` | `lib/comercios/{planCuenta,cobros}.ts` |
| 7 | `confirmarPagoCobro` y su repositorio | ✅ mutaciones corridas, adaptador incluido | `9ba3ddc`, `e6a42eb` | `lib/comercios/{confirmarPago,repositorioPagosSupabase}.ts`, `test/fixtures/repositorioPagosFalso.ts` |
| 8 | Ruta del webhook | ✅ mutaciones corridas | `9ba3ddc`, `e6a42eb` | `lib/wompi/procesarWebhook.ts`, `app/api/wompi/webhook/route.ts` |
| 9 | `iniciarPagoPlan` (crea el intento y el enlace) | ✅ mutaciones corridas, adaptador incluido | `9ba3ddc`, `e6a42eb` | `lib/comercios/{iniciarPagoPlan,iniciarPagoPlanSupabase,confirmarPorRedirect,confirmarRetornoSupabase}.ts` |
| 10 | Pantalla del dueño, acción y página de vuelta | ✅ tipos y lint; ❌ **no se vio en el navegador** | `e6a42eb` | `app/comercio/(protegido)/plan/**`, `lib/comercios/vistaOpciones.ts` |
| 11 | `/admin/pagos`, sus acciones, "Marcar pagado" y vencimiento en la ficha | ✅ lógica y consultas con mutaciones; ❌ **no se vio en el navegador** | `c31f236`, `40e6593` | `lib/comercios/{pagosAdmin,resolverPagos,resolverPagosSupabase}.ts`, `app/admin/(protegido)/pagos/**`, `app/admin/(protegido)/cuentas/**` |
| 12 | `.env.local.example`, spec, este registro, `ESTADO-Y-PLAN` | ✅ | (este commit) | — |
| 13 | Revisión final del conjunto | ✅ dos revisores; hallazgos verificados y corregidos (ver abajo) | (este commit) | — |

"❌ no se vio en el navegador": este worktree no tiene `.env.local`, y las pantallas del dueño y de FM
piden sesión y base de datos. Lo que se verificó es tipos, lint y la lógica que las alimenta.

## Mutation-testing: qué se midió

Cada tabla vive en el encabezado de su archivo de prueba, con el nombre de la prueba que atrapa cada
mutación. Se corrieron todas las de los módulos puros (rompé la línea, confirmá que falla la prueba
correcta, restaurá). Conteo de mutaciones medidas y muertas por módulo: `prorrateo` 8, `opcionesPago` 6,
`limitePlan` 3, `wompi/config` 4, `wompi/firma` 5, `wompi/webhook` 4, `wompi/cliente` 8,
`confirmarPago` 15, `procesarWebhook` 7, `iniciarPagoPlan` 10, `confirmarPorRedirect` 5, ruta del webhook
7, `vistaOpciones` 4, `urlParaContinuarPago` 4, `pagosAdmin` 13, `resolverPagos` 10, más las de la revisión final (en el encabezado de cada `.test.ts`).

**Pruebas con base de datos** (`cobros`, `planCuenta`, `repositorioPagosSupabase`, `iniciarPagoPlanSupabase`,
`pagosAdminDb`): corridas el 2026-09-21 contra Supabase, **92 de 92 en verde a la primera**. Se corren desde el
worktree con el cwd en el checkout principal, para que tomen su `.env.local` sin leerlo ni copiarlo:
`cd <checkout principal> && npx --prefix <worktree> vitest run --root <worktree> --config <worktree>/vitest.config.ts <archivos>`.
Después se les hicieron **30 mutaciones** a la capa de base (el filtro de estado del reclamo, el manejo del
23505, `anularIntentosPendientes` sin filtrar por método, el candado por cuenta, los períodos pagados, la
idempotencia del evento, "un campo ausente no se toca", ajuste que nunca baja, comprobación de cupo, fecha de
alta de la licencia, límite, y las consultas del panel): **28 murieron por la prueba correcta**; una
(`obtenerIntentoAbierto` sin filtrar por método) muere en `iniciarPagoPlanSupabase.test.ts` y no en
`cobros.test.ts`, y otra (el `detalle` que un campo ausente no debe pisar) era un hueco real de la prueba y
se cerró. Quedan **dos equivalentes**: la conversión `Number(...)` del precio (PostgREST ya devuelve un número)
y la falla de `cupoDeCuenta` (no se puede provocar con una base real).

## Cómo verificar

Las pruebas puras (sin base ni `.env.local`) se corren con una config aparte que no carga el setup que
exige Supabase. En este worktree se usó una en el directorio temporal de la sesión; en el checkout
principal, con `.env.local`, basta la suite normal:

```bash
npm test
npx tsc --noEmit
npm run lint
```

Las pruebas de fechas dependen de la zona horaria del proceso: corré las puras también con
`TZ=America/El_Salvador` y con `TZ=UTC`.

## Lo que solo puede hacer Daniel (en este orden)

1. ~~Aplicar `supabase/migrations/0037_pagos_wompi.sql`~~ **HECHO y verificado** el 2026-09-21
   (`scripts/verificar-0037.ts`, solo lectura: 15 de 15 OK).
2. **En el checkout principal, con `.env.local`:** traer la rama y correr `npm test`. Con la migración ya
   aplicada, las pruebas con base tienen que pasar; **nunca se han ejecutado**, y son la única verificación
   del adaptador real. **Si alguna falla, es información sobre el adaptador real: avisá antes de
   desplegar.**
3. **`WOMPI_CLIENT_ID` y `WOMPI_CLIENT_SECRET`:** ya están en el `.env.local` del checkout principal;
   **faltan en Vercel**. **Regenerá el API Secret antes de producción**: apareció en una captura de pantalla
   y en el chat.
4. **Punto 0 (YA RESUELTO el 2026-09-21, no repetir salvo que cambien las credenciales):**

   ```bash
   npx tsx --conditions=react-server scripts/probar-wompi.ts
   ```

   y pasame lo que imprime (no imprime secretos). Responde si las credenciales del negocio alcanzan para
   crear enlaces de pago; si no, el diseño cambia.
5. **Desplegar** (migración primero, deploy después, con tu permiso), y **recién entonces** poner en el
   panel de Wompi la URL del webhook: `https://www.cardly-sv.site/api/wompi/webhook`. No pongas un redirect
   entre el apex y `www`.
6. **Primera prueba real en modo prueba.** Con el negocio de Wompi en pruebas, un pago NO aplica el plan
   en producción (la guarda `WOMPI_ACEPTAR_PRUEBAS` lo impide): lo que se ve es el evento en `/admin/pagos`
   como «Prueba». Para ver el flujo completo hace falta cambiar el negocio a productivo (un cobro REAL, de monto chico), o
   probar en local con `WOMPI_ACEPTAR_PRUEBAS=1` (ahí el webhook no llega sin un túnel, pero la página de
   vuelta sí confirma el pago consultando la API).
7. Mirar las pantallas del dueño (`/comercio/plan`, `/comercio/plan/pago/resultado`) y de FM
   (`/admin/pagos`, la ficha de una cuenta) a ancho de teléfono.

## A verificar con el primer pago real

Lo que la documentación de Wompi no deja claro, y que el sistema está armado para tolerar mientras se
confirma (detalle en la sección "A verificar" de la spec):

- Si el header `wompi_hash` (con guion bajo) llega a la ruta a través de Vercel. Si falta, la ruta responde
  401 y deja en el log los NOMBRES de los headers recibidos.
- El formato real del cuerpo del webhook. Un cuerpo firmado que no se reconoce se guarda con id
  `sin-id-…` y se ve en `/admin/pagos` con su cuerpo crudo; "Reintentar" lo reprocesa cuando el parser se
  arregla.
- Qué variante de hash trae el redirect. Es un aviso que no bloquea: la verdad la da la consulta a la API.
- Cómo reintenta Wompi si la ruta responde 500.

## Preguntas abiertas para Daniel

Las de la spec (sección "Preguntas abiertas"), con su valor por defecto ya implementado:

1. Un período que vence sin renovar **solo se muestra**; no baja el plan ni bloquea altas.
2. Fases disjuntas: subir con prorrateo a mitad de período, renovar en los últimos 7 días.
3. Bajar de plan al renovar se aplica ya, no al empezar el período siguiente.
4. Un ajuste (subir de plan a mitad de período) **no** dispara Subscribe a Meta.
5. Se asume que el negocio de Wompi es solo de Cardly.

Una más, que salió al hacer el panel: un evento que quedó `pendiente` (la función murió entre registrarlo
y resolverlo) **no** cuenta como "necesita atención" ni ofrece "Reintentar": solo lo ve en «Todos», como
«Procesando». Si Wompi reintenta el webhook cuando la ruta no responde 200 (es uno de los puntos por verificar), normalmente se resuelve solo.
Si preferís que aparezca en la lista de atención pasado un rato, es un cambio chico.

## Fase 2 (spec propia, después)

App instalable (PWA) para el dueño y avisos al celular (Web Push, VAPID): pago pendiente, pago próximo.
Los avisos se derivan de las fechas de los períodos y salen del cron que ya existe. Bosquejo en la spec.

## Revisión final (Tarea 13)

Dos revisores independientes (uno de cumplimiento de la spec y seguridad del flujo de dinero, otro de
calidad del código y de pruebas decorativas). **Cada hallazgo se verificó contra el código antes de
aplicarlo**; los que se aplicaron llevan su prueba y su mutación (en el encabezado de cada `.test.ts`).
Ninguno encontró una vía para aplicar un plan o marcar un cobro pagado sin firma válida, ni para ver o
pagar el cobro de otra cuenta.

**Corregido** (todo con prueba, y cada mutación murió por la prueba correcta):

- **Renovar el MISMO plan quedaba bloqueado por cupo** para una cuenta con límite negociado o una Pro
  heredada "sin tope": la pantalla comparaba contra el límite sugerido del catálogo, pero la aplicación no
  toca el límite cuando el plan es el mismo. Eran las primeras cuentas que se iban a cobrar.
- **La página de vuelta podía tapar al webhook firmado**: registraba eventos `prueba` o `no_aprobada`
  (terminales), y el webhook real de esa misma transacción llegaba como "repetido". Ahora ese camino no
  registra eventos negativos. Además ata la transacción al cobro (`datosAdicionales.cobro`), no rompe si la
  base falla al leer el cobro, y se le agregó la tabla de estados a las pruebas.
- **`confirmarPagoCobro` aplicaba el plan de un cobro que ya había pagado OTRA transacción** antes de
  descubrirlo. Ahora corta antes.
- **Título y explicación sin botones** ("¿Necesitás más lugar?") para una cuenta en el plan más alto o con una
  solicitud pendiente.
- **Precio pactado con 3 decimales**: se lleva a centavos antes de mandarlo al cobro y a Wompi.
- **El método «Wompi» quedó reservado** para el registro manual de cobros pendientes (uno de FM se habría
  confundido con un intento de la app). Ojo: la regla vive en `validarCobroManual`, NO en el validador
  compartido, porque el cobro que crea la propia app valida con ese mismo método; `tsc` atrapó el primer
  intento, que la había puesto en el compartido (vitest no chequea tipos, y ninguna prueba pura llama a
  `crearCobroPendiente`).
- **La ficha de la cuenta** dice cuándo venció el último período pagado en vez de "sin período".
- **Pruebas decorativas**: la firma sobre bytes en la ruta (un BOM inicial), lo que FM ve en el panel
  (cuenta, cobro y detalle del evento), las condiciones para reusar un intento abierto, el día en UTC contra
  el de la zona, `hoy` en la licencia y el reclamo, la mutación de punto flotante en el prorrateo, y la
  falla de `marcarRevisado`.
- **El repositorio falso ahora espeja al real** en lo que le faltaba (la fuente del evento y el reemplazo
  del cuerpo cuando el webhook llega después del redirect).
- **Comentarios y documentos que no coincidían con el código** (spec, `types.ts`, `planCuenta.ts`,
  `firma.test.ts`, `conversionesMeta.ts`).

**Conocido y NO corregido** (decisión de dejarlo, con su porqué):

- **Dos pestañas a la vez pueden anularse el intento entre sí**: la segunda ve el cobro de la primera sin
  enlace todavía y lo anula, y el pago de la primera cae como `cobro_anulado`. Es rara y tiene salida
  (FM lo aplica a mano desde `/admin/pagos`). Un enlace de Wompi no se puede desactivar desde la app.
- **El aviso de `MarcarPagado` desaparece al tener éxito** (el cobro deja de estar pendiente y el
  componente ya no se dibuja). Si el plan no cupo, el evento queda en `/admin/pagos` como «Plan no
  aplicado» y en el contador de la nav.
- **La solicitud de cambio de plan** (`FormularioSolicitud` + `resolverSolicitud`) sigue aplicando el plan
  sin pasar por el pago cuando FM aprueba. Es lo que la spec deja para bajar de plan; subir por esa vía es
  una decisión de producto.
- **Campos y ramas sin lectores** (`ResultadoAplicarPlan.cambio`, `PagoWebhook.formaPago`, la rama singular
  de "unidad") y **duplicación menor** (`ES_UUID`, `esObjeto`, formateadores de fecha por pantalla): no
  cambian el comportamiento.
- **Accesibilidad menor**: `aria-describedby` en los botones bloqueados y manejo de foco al confirmar. Se
  agregó `aria-current` a los filtros de `/admin/pagos`.
- **`cuentaDelComercio`** está exportada desde un archivo `'use server'` sin autenticar (preexistente).
- El parser exige `EsProductiva` (la API de consulta usa `esReal`) y `RESULTADOS_NUMERICOS` es un mapeo
  supuesto: si el webhook real difiere, el evento queda guardado como «Error» con su cuerpo y "Reintentar"
  lo reprocesa cuando se arregle el parser.

**Verificación al cierre:** `tsc --noEmit` y `eslint` limpios; 282 pruebas puras en verde con `TZ=UTC` y con
`TZ=America/El_Salvador`; `next build` pasa (`NODE_OPTIONS=--max-old-space-size=6144`). Siguen **sin verse** las pantallas en el navegador.

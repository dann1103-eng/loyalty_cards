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
| 4 | Migración `0037`, tipos y script de verificación | ⏳ **falta que Daniel la aplique** | `7260101` | `supabase/migrations/0037_pagos_wompi.sql`, `lib/supabase/types.ts`, `scripts/verificar-0037.ts` |
| 5 | Script de conexión (punto 0) | ⏳ **falta que Daniel lo corra** | `74cf235` | `scripts/probar-wompi.ts` |
| 6 | `planCuenta` (`aplicarPlanDestino`, `activarLicencia`), `cobros`; se borra `accionSubirPlan` | ✅ lógica; ⏳ pruebas con base sin correr | `e6a42eb` | `lib/comercios/{planCuenta,cobros}.ts` |
| 7 | `confirmarPagoCobro` y su repositorio | ✅ mutaciones corridas; ⏳ adaptador contra la base sin correr | `9ba3ddc`, `e6a42eb` | `lib/comercios/{confirmarPago,repositorioPagosSupabase}.ts`, `test/fixtures/repositorioPagosFalso.ts` |
| 8 | Ruta del webhook | ✅ mutaciones corridas | `9ba3ddc`, `e6a42eb` | `lib/wompi/procesarWebhook.ts`, `app/api/wompi/webhook/route.ts` |
| 9 | `iniciarPagoPlan` (crea el intento y el enlace) | ✅ mutaciones corridas; ⏳ adaptador contra la base sin correr | `9ba3ddc`, `e6a42eb` | `lib/comercios/{iniciarPagoPlan,iniciarPagoPlanSupabase,confirmarPorRedirect,confirmarRetornoSupabase}.ts` |
| 10 | Pantalla del dueño, acción y página de vuelta | ✅ tipos y lint; ❌ **no se vio en el navegador** | `e6a42eb` | `app/comercio/(protegido)/plan/**`, `lib/comercios/vistaOpciones.ts` |
| 11 | `/admin/pagos`, sus acciones, "Marcar pagado" y vencimiento en la ficha | ✅ lógica con mutaciones; ⏳ consultas contra la base sin correr; ❌ **no se vio en el navegador** | `c31f236`, `40e6593` | `lib/comercios/{pagosAdmin,resolverPagos,resolverPagosSupabase}.ts`, `app/admin/(protegido)/pagos/**`, `app/admin/(protegido)/cuentas/**` |
| 12 | `.env.local.example`, spec, este registro, `ESTADO-Y-PLAN` | ✅ | (este commit) | — |
| 13 | Revisión final del conjunto | ⏳ ver "Revisión final" abajo | | |

"❌ no se vio en el navegador": este worktree no tiene `.env.local`, y las pantallas del dueño y de FM
piden sesión y base de datos. Lo que se verificó es tipos, lint y la lógica que las alimenta.

## Mutation-testing: qué se midió

Cada tabla vive en el encabezado de su archivo de prueba, con el nombre de la prueba que atrapa cada
mutación. Se corrieron todas las de los módulos puros (rompé la línea, confirmá que falla la prueba
correcta, restaurá). Conteo de mutaciones medidas y muertas por módulo: `prorrateo` 8, `opcionesPago` 6,
`limitePlan` 3, `wompi/config` 4, `wompi/firma` 5, `wompi/webhook` 4, `wompi/cliente` 8,
`confirmarPago` 15, `procesarWebhook` 7, `iniciarPagoPlan` 10, `confirmarPorRedirect` 5, ruta del webhook
7, `vistaOpciones` 4, `urlParaContinuarPago` 4, `pagosAdmin` 12, `resolverPagos` 9.

**Sin correr** (necesitan `.env.local` y la migración `0037`): `cobros.test.ts`, `planCuenta.test.ts`,
`repositorioPagosSupabase.test.ts`, `iniciarPagoPlanSupabase.test.ts` y `pagosAdminDb.test.ts`. Los
encabezados de estos archivos lo dicen. **Hasta que corran, el adaptador real de la base no está
verificado**: la lógica se probó contra un repositorio falso que tiene que espejar su semántica (ver el
comentario de `test/fixtures/repositorioPagosFalso.ts`).

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

1. **En el checkout principal, con `.env.local`:** traer la rama y correr `npm test`. Las pruebas con base
   fallan hasta el paso 2; eso es lo esperado y es la medida de lo que se rompería en producción sin la
   migración.
2. **Aplicar `supabase/migrations/0037_pagos_wompi.sql` en Supabase Studio** y avisar. Después:

   ```bash
   npx tsx --conditions=react-server scripts/verificar-0037.ts
   ```

   (solo lectura; confirma columnas, índices y RLS). Volver a correr `npm test`: ahora las pruebas con
   base tienen que pasar. **Si alguna falla, es información sobre el adaptador real: avisá antes de
   desplegar.**
3. **Poner `WOMPI_CLIENT_ID` y `WOMPI_CLIENT_SECRET` en `.env.local` y en Vercel** (nunca por el chat).
   **Regenerá el API Secret antes de producción**: apareció en una captura de pantalla.
4. **Punto 0:**

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

Pendiente al escribir este registro. Cuando se haga: revisión independiente de cumplimiento de la spec y de
calidad de código sobre todo el conjunto, verificando cada hallazgo contra el código antes de aplicarlo, y
`tsc`, `eslint` y `next build` (en este worktree, con `NODE_OPTIONS=--max-old-space-size=6144`).

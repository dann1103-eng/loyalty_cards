# Estado del proyecto y plan para continuar — FM Lealtad

> **Propósito:** documento de retomada. Si empezás una sesión nueva, leé esto primero: dice qué
> está hecho, qué falta, y las decisiones cerradas que no hay que reabrir. Los planes
> (`docs/superpowers/plans/*.md`) son la fuente de verdad del *cómo* de cada tarea ya construida.
> Reemplaza a `ESTADO-Y-PLAN-FASE-3.md` (obsoleto — cubría un estado de 2026-07-17/20, mucho antes
> de todo lo de acá abajo).
>
> Última actualización: **2026-07-25**.

## AL DÍA: todo en producción

`master` desplegado en `loyalty-cards-rose.vercel.app`, 222 pruebas verdes, typecheck y lint
limpios. Dos proyectos grandes se completaron y mergearon en esta sesión, encima de todo lo que ya
documentaba `ESTADO-Y-PLAN-FASE-3.md` (rediseño Stitch, panel comercio, Apple Wallet, portal
cliente, panel FM):

### 1. Cuentas multi-negocio + sucursales + cajeros + BI (10 fases, migraciones 0008-0010)
- **`cuentas_comercio`**: el cliente que paga (agrupa 1+ `comercios` distintos — marcas/tipos de
  tarjeta diferentes bajo un mismo cliente).
- **`sucursales`**: locales de la MISMA marca que comparten una sola tarjeta/QR de registro.
- Login multi-comercio con selector en el header; cajeros por sucursal (creados por el dueño,
  atados a una sucursal fija); escáner con atribución (`sucursal_id` + `cajero_usuario_id` en el
  ledger); RPCs atómicos para acreditar/canjear (`acreditar_puntos_atomico`,
  `canjear_recompensa_atomico`); BI en panel dueño (`/comercio/reportes`) y panel FM
  (`/admin/reportes`).
- Spec: `docs/superpowers/specs/2026-07-21-multi-negocio-sucursales-bi-design.md`. Plan:
  `docs/superpowers/plans/2026-07-21-multi-negocio-sucursales-bi.md`.

### 2. Plan/facturación a nivel cuenta + límite combinado (migración 0011)
Corrección sobre lo anterior, disparada por el usuario probando en producción: el monto/plan de
licencia seguía atado al `comercio` en vez de a la `cuenta` que paga, y el límite de plan no
contaba las sucursales (encontró el hueco en la cuenta real "Verde Raíz": 1 comercio + 2 sucursales
con límite 2, sin ningún bloqueo).
- `licencia_estado`/`plan`/`monto`/`activa_desde` viven en `cuentas_comercio`, no en `comercios`.
  Pausar una cuenta pausa TODOS sus comercios a la vez.
- Catálogo real de 3 planes (Starter $29/mes límite 1, Growth $49/mes límite 2, Pro $89/mes sin
  límite) — ver `[[reference-cardly-pricing]]` en memoria para la fuente.
- El límite de cada cuenta cuenta **comercios distintos + sucursales, sumados** (antes solo
  comercios). `limite_negocios` admite `null` = sin tope.
- Plan (con las 3 rondas de revisión que encontraron y corrigieron 5 bugs reales, documentadas
  dentro): `docs/superpowers/plans/2026-07-25-plan-cuenta-facturacion.md`.
- Guía de pruebas manuales (para las dos secciones de arriba juntas, **el usuario todavía no la
  recorrió** al momento de escribir esto): `docs/guia-pruebas-manuales-cuentas-sucursales.md`.

## Decisiones cerradas — no reabrir sin señal explícita del usuario

- **Comercios distintos vs. sucursales** son dos ejes separados a propósito: comercio distinto =
  otra marca/tipo de tarjeta; sucursal = mismo local físico distinto, misma tarjeta. El límite de
  plan cubre ambos JUNTOS (una sola suma), no dos topes independientes.
- El límite es un *default* sugerido por plan, siempre editable por FM por cuenta (tratos
  negociados) — nunca estricto.
- El catálogo de 3 planes es el real de `fm-ai-website.vercel.app/productos/cardly`. Ese sitio
  también menciona un **límite de clientes** (500/2500/sin límite) y un **setup inicial $149
  único** — ninguno de los dos está modelado todavía; son features aparte si se piden.

## Peso del pass — HECHO el 2026-07-26

Plan en `plans/2026-07-26-peso-del-pass-y-robustez.md`. El dueño reportó que sus tarjetas tardaban en
actualizarse; el pass pesaba 1763 KB y el iPhone se lo baja ENTERO en cada acreditación.

**Peor caso medido: 1458 KB → 516 KB.** Dos causas, las dos por guardar píxeles que nadie ve:

1. El MISMO buffer de logo iba en las tres densidades (`logo.png`, `@2x`, `@3x`).
2. `redimensionarLogo` acotaba solo el ANCHO. El área del logo de Apple es de 160×50 **puntos**, así
   que un logo cuadrado entregaba 480×480 px para pintar 50 pt de alto: tres veces los píxeles
   dibujados. Acotando también el alto (`fit: 'inside'`, altos 50/100/150) los tres logos pasaron de
   1024 KB a **81 KB**.

Las franjas se cuantizan a paleta con `sharp`. **Calidad 100, no 80**: a 80 y a 90, la banda de marca
SIN foto —la que ve todo comercio que no subió imagen— se quedaba con TRES colores y el borde del
resplandor salía escalonado. A 100 sale con cero píxeles alterados y aun así baja de 14.6 a 4.8 KB.

### Lo que NO es obvio y hay que recordar

**La prueba de peso NO protege el logo por densidad.** Comprobado, no supuesto: con el logo bien
acotado los tres pesan 81 KB juntos, así que repetir el más grande suma solo 79 KB (595 vs 516) y
ningún presupuesto sensato separa esos números. El arreglo hizo la regresión *demasiado barata para
que una alarma de peso la vea*. Ese candado vive ahora en `generatePass.test.ts` y es de **forma**:
los tres `logo*.png` deben ser distintos entre sí y medir 50/100/150 de alto.

`PRESUPUESTO_PASS_KB` vive en `lib/apple/imagenesPass.ts` y lo importa `scripts/verificar-wallet.ts`:
dos números que significan lo mismo en dos archivos divergen.

También se borró `app/api/tarjetas/[tarjetaId]/puntos/`: código muerto del walking skeleton que
acreditaba puntos SIN atribución de sucursal ni cajero y sin `syncObjetoTarjeta`, a diferencia del
flujo real (`/comercio/escanear`).

## Pendiente / en pausa (no retomar salvo pedido explícito)

- **Google Wallet — solicitud de acceso de publicación**: el walking-skeleton está completo y
  funcionando (class/object sync, save link, todo cableado), pero el usuario pidió dejar en stand-by
  el trámite de acceso de publicación de Google para priorizar lo de cuentas/sucursales. No se
  retomó.
- ~~**Texto configurable al reverso de la tarjeta**~~ → **HECHO el 2026-07-26.** Spec en
  `specs/2026-07-26-reverso-tarjeta-configurable-design.md`, plan en
  `plans/2026-07-26-reverso-tarjeta-configurable.md`, migración `0013`, pruebas manuales en la
  Parte 4 de `docs/guia-pruebas-manuales-cuentas-sucursales.md`.
  Tres capas: sección "Cómo funciona" armada por el sistema en cada generación desde `reglas_puntos`
  y `recompensas` (nunca una copia congelada), términos y redes que carga el dueño, y el pie fijo de
  Cardly SV. Lo que NO es obvio y conviene recordar: la parte "viva" **exige el push** —
  `notificarCambioComercio` se llama ahora también al crear/eliminar regla y crear/desactivar
  recompensa; sin eso el reverso queda congelado hasta que el cliente pase por caja.
  Fuera de alcance deliberado: Google Wallet (`textModulesData`/`linksModuleData`), marca blanca por
  plan, y más redes que las cuatro.

## Si algo no cuadra

El flujo de migraciones a mano + verificación con script descartable, y el patrón de merge
fast-forward a `master` (sin merge commit), son los mismos de siempre — ver `CLAUDE.md`. Si un
subagente reporta un git worktree con historia de OTRA feature (Google Wallet, etc.) al arrancar,
es la infraestructura de la sesión, no un error — ver la nota sobre esto en `CLAUDE.md`.

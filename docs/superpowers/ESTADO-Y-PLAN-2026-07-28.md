# Estado del proyecto y plan para continuar — FM Lealtad

> **Propósito:** documento de retomada. Si empezás una sesión nueva, leé esto primero: dice qué
> está hecho, qué falta, y las decisiones cerradas que no hay que reabrir. Los planes
> (`docs/superpowers/plans/*.md`) son la fuente de verdad del *cómo* de cada tarea ya construida.
> Última actualización: **2026-07-28**. (Absorbió y reemplazó a `ESTADO-Y-PLAN-FASE-3.md`, borrado
> por obsoleto — su contenido de 2026-07-17/20 quedó cubierto por lo de acá abajo. Está en la
> historia de git si hiciera falta.)

## AL DÍA: todo en producción

`master` desplegado en **`www.cardly-sv.site`** (el dominio propio; `loyalty-cards-rose.vercel.app`
sigue sirviendo pero ya no es el canónico), 415 pruebas verdes, typecheck limpio. Rediseño Stitch,
panel comercio, Apple Wallet, portal cliente, panel FM, cuentas/sucursales/cajeros/BI, y — desde el
2026-07-28 — **Google Wallet en producción abierta**:

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

## Google Wallet — COMPLETO Y EN PRODUCCIÓN ABIERTA (2026-07-28)

Ya no es modo Demo: **cualquier cliente puede agregar su tarjeta**, igual que en Apple. Verificado
por tres vías (consola sin el cartel "modo Demo", clases "Activa", y `programName` sin el prefijo
`[SOLO PARA PRUEBAS]`).

**Módulo `lib/google/`** (espejo de `lib/apple/`): `walletClient` (auth por cuenta de servicio),
`ids`/`colorHex`/`construirRecursos` (puros), `syncClase` (LoyaltyClass = branding del comercio),
`syncObjeto` (LoyaltyObject = saldo + grilla de UNA tarjeta), `syncComercio` (re-sincroniza todos
los objetos de un comercio), `linkGuardar` (JWT RS256 → botón "Agregar a Google Wallet"),
`heroUrl` (URL + versión de la grilla). Ruta nueva `app/api/tarjetas/[id]/hero.png`.

**Lo que NO es obvio y hay que recordar:**

1. **Google CACHEA cada imagen por URL.** Si la URL no cambia, el pass muestra la imagen vieja para
   siempre aunque el objeto se patchee. Por eso `heroUrl.ts` cuelga un `?v=<hash>` que resume TODO
   lo que la grilla dibuja. Bug real: el contador decía "3 de 8" sobre ocho sellos vacíos.
   Cualquier imagen futura que dependa de datos cambiantes necesita el mismo tratamiento.
2. **Asimetría clase/objeto:** logo y colores de cabecera viven en la CLASE (una llamada actualiza a
   todos los clientes); la GRILLA de sellos vive en el `heroImage` de CADA OBJETO. Un cambio de
   branding necesita las dos (`syncClaseComercio` + `syncObjetosComercio`).
3. **`heroImage` SÍ existe a nivel de objeto** (el spec original decía que era solo de clase —
   falso, verificado contra el `.d.ts` de `googleapis`). Eso es lo que hace posible la grilla por
   cliente.
4. **`programLogo` es obligatorio en la API**: un comercio sin logo simplemente no tiene Google
   Wallet habilitado (Apple sí cae a `logoText`).
5. **Las clases NO se pueden borrar** (la API solo tiene get/insert/list/patch/update). Nunca crear
   clases de QA contra el emisor real con nombres tipo "QA ..." — quedan visibles para siempre y las
   ve el revisor de Google. Solo se pueden renombrar.
6. **Autorreparación:** `linkGuardar` reintenta el sync si falta la clase/objeto. Google, a
   diferencia de Apple, crea el recurso UNA vez vía REST; si esa llamada falla (cold start lento),
   quedaba roto para siempre. Bug real en producción.

**Trámite con Google (por si hace falta con otro emisor):** el formulario de "Request publishing
access" de la consola promete 2-3 días hábiles, pero lo que realmente destrabó fue **responder el
hilo de soporte** (`google-wallet-passes-support@google.com`) pidiéndolo explícitamente — aprobado a
mano en ~2 horas. **Los correos de Google NO son fuente de verdad del estado del emisor; la consola
sí** (hubo tres correos parecidos y solo el tercero era el de publicación).

## Apple — arreglo de dominio (2026-07-28)

El apex `cardly-sv.site` tenía un **308 redirect** a `www`, y **Apple Wallet no sigue redirecciones
en llamadas autenticadas**: las trata como fallo de auth (401 en `/api/apple/v1/devices/...`), así
que esos passes nunca se registraban para push y sus dueños no recibían actualizaciones de saldo, en
silencio. Arreglado en Vercel poniendo el apex a servir directo (Domains → Edit → "Connect to an
environment") en vez de redirigir.

**Regla permanente: NUNCA poner un redirect entre `cardly-sv.site` y `www.cardly-sv.site` (en
ninguna dirección).** El `webServiceURL` queda grabado DENTRO de cada `.pkpass` al emitirlo y no se
puede cambiar a distancia; hay passes vivos con cada uno de los dos hosts, así que ambos tienen que
responder directo. Si algún día se quiere canonicalizar por SEO, va con `<link rel="canonical">`.

## Pendiente / en pausa (no retomar salvo pedido explícito)
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

## Tanda 1 — Antifraude y control de sellos (HECHO el 2026-07-28, en producción)

Spec en `specs/2026-07-28-antifraude-control-sellos-design.md`, migración `0015`. Nace del primer
feedback real de los comercios: sospecha de que un cajero regala sellos. **480 pruebas verdes.**

Lo que hay ahora: historial de movimientos por cliente (`/comercio/clientes/[tarjetaId]`), quitar
sellos con motivo obligatorio (dueño **y** cajero, desde el escáner), cuatro perillas de control por
comercio, autorización del dueño cuando un límite bloquea al cajero, reporte de actividad por cajero
(`/comercio/reportes/cajeros`), y movimientos recientes en el portal del cliente.

Lo que NO es obvio y conviene recordar:

- **El límite se aplica DENTRO del RPC con `for no key update` explícito, y tiene que seguir así.**
  En READ COMMITTED un `count(*)` no toma lock y no hay predicate locking, así que dos escaneos
  simultáneos del mismo cliente se colarían. Meter el conteo en el `WHERE` del `UPDATE` tampoco
  sirve: la re-evaluación EPQ solo sustituye la fila bloqueada. **Invariante a sostener a mano:**
  cualquier camino futuro que inserte en `transacciones_puntos` debe tomar ese lock primero.
- **La prueba de carrera usa 100 en paralelo por 3 rondas y eso no es exceso.** La primera versión
  usaba 8 y pasaba TAMBIÉN con el lock removido — o sea que no probaba nada. Se midió: con 8 la
  contención aparece 2 de cada 3 veces; con 100, siempre. Si alguien baja esos números, la prueba
  vuelve a ser decoración.
- **`acreditar_puntos_atomico` quedó como wrapper delegante de `acreditar_atomico`.** No se puede
  agregar un parámetro con `CREATE OR REPLACE` (crea un overload ambiguo, 42725), y mantener la
  firma fue lo que permitió aplicar la migración antes del deploy sin romper el código vivo. Se
  puede borrar en una migración futura — el código nuevo ya no la usa.
- **El ajuste SOLO puede restar, y es una decisión de seguridad.** Si pudiera sumar, un cajero
  bloqueado por el tope tendría puerta trasera; la corrección hacia arriba pasa por el camino
  forzado, que es del dueño y deja la fila marcada. **Las forzadas sí cuentan para el tope.**
- **`puntos_otorgados` en los reportes ahora es BRUTO, no neto**, a propósito: así el fraude no se
  autoborra del reporte. Las cuatro funciones de `0010` filtran `tipo = 'acreditacion'` — eran
  cuatro y no tres, `reporte_fm_comercios` también contaba filas crudas.
- **`comercios.zona_horaria` tiene CHECK de lista cerrada y su espejo es `lib/comercio/zonasHorarias.ts`.**
  Se mueven JUNTOS. Un nombre de zona inválido hace que `at time zone` lance 22023 **dentro** del RPC
  de acreditar: un typo en configuración dejaría al comercio sin poder sellar.
- **`FormularioControles.tsx` usa campos NO controlados a propósito**, al revés que el resto del
  proyecto. Es de EDICIÓN, no de alta: con campos controlados el reset posterior al Server Action
  desmarcaba la casilla de "pedir monto" en el DOM sin avisarle a React (bug encontrado en el QA del
  dueño; el dato se guardaba bien, solo se dibujaba mal). Ver el comentario del archivo.

Hoja de ruta acordada para lo que sigue: **Tanda 2** selector de país en el registro + imagen por
premio (`recompensas.foto_url` existe desde `0001` y nunca se cableó) + exportar clientes a CSV;
**Tanda 3** geopush y campañas; **Tanda 4** autogestión de plan y los 6 tipos de tarjeta que dicen
"Próximamente". Stripe queda fuera: **no acepta negocios de El Salvador**, haría falta una entidad
en EE.UU. o UK.

## Si algo no cuadra

El flujo de migraciones a mano + verificación con script descartable, y el patrón de merge
fast-forward a `master` (sin merge commit), son los mismos de siempre — ver `CLAUDE.md`. Si un
subagente reporta un git worktree con historia de OTRA feature (Google Wallet, etc.) al arrancar,
es la infraestructura de la sesión, no un error — ver la nota sobre esto en `CLAUDE.md`.

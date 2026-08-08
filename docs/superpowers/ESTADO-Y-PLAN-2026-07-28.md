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

### La ronda de mutación encontró TRES pruebas falsas (ninguna en el código de produccion)

Se corrió completa el 2026-07-28. Vale la pena que quede escrito porque las tres habrían pasado
inadvertidas con la suite en verde:

1. **La prueba de carrera con 8 llamadas paralelas pasaba TAMBIÉN con el lock removido.** La
   transacción dura microsegundos y la latencia de red decenas de milisegundos, así que las
   peticiones llegan escalonadas y casi nunca se solapan. Medido: con 8 la contención aparece 2 de
   cada 3 veces; con 100, siempre. Ahora usa 100 por 3 rondas. **No bajar esos números.**
2. **Agrupar M1 y M2 en un solo archivo las canceló entre sí.** Las dos tocan el conteo del tope:
   M2 lo infla (cuenta el ajuste) y M1 afloja la comparación, así que el resultado seguía siendo
   "bloquear" por el motivo equivocado. Moraleja: las mutaciones que tocan la misma línea se corren
   AISLADAS.
3. **"Un ajuste no libera cupo" miraba la dirección equivocada.** Afirmaba que la segunda
   acreditación quedaba bloqueada, pero quitar el filtro de tipo hace que bloquee MÁS, no menos.
   Se agregó la inversa ("un AJUSTE no CONSUME cupo"), que es la que atrapa el daño real: un cliente
   al que le corrigieron un sello quedándose sin poder recibir uno legítimo.

Hoja de ruta acordada para lo que sigue: **Tanda 2** selector de país en el registro + imagen por
premio (`recompensas.foto_url` existe desde `0001` y nunca se cableó) + exportar clientes a CSV;
**Tanda 3** geopush y campañas; **Tanda 4** autogestión de plan y los 6 tipos de tarjeta que dicen
"Próximamente". Stripe queda fuera: **no acepta negocios de El Salvador**, haría falta una entidad
en EE.UU. o UK.

## EN CURSO — Programas de tarjeta (migración 0024 YA APLICADA)

Spec: `specs/2026-07-29-programas-de-tarjeta-design.md`. Es una reestructuración que REVIERTE la
decisión del 2026-07-28 de "un tipo por comercio": ahora un comercio ofrece hasta 2 programas a la
vez, cada uno con su nombre, su configuración y su propio QR de registro.

**La 0024 ya está aplicada y verificada**: 21 tarjetas antes, 21 después, cada una apuntando al
programa principal de su comercio. Fue la PRIMERA migración del proyecto que mueve datos vivos —
las 23 anteriores solo agregaban columnas.

### Lo que falta (en este orden)

1. `lib/supabase/types.ts` con `programas_tarjeta` y `tarjetas.programa_id`.
2. Capa de datos de programas (CRUD + tope de 2 activos por comercio, validado en TS).
3. Pantalla de programas en el panel del dueño.
4. Registro por programa: `/registro/<comercioSlug>/<programaSlug>`, conservando la URL vieja
   (sin slug) apuntando al principal — **hay QR impresos en los locales con esa URL**.
5. El escáner deduce la operación del programa de la TARJETA escaneada, no de `comercios.tipo_tarjeta`.
6. Migración de contracción: retirar `comercios.tipo_tarjeta` y su configuración una vez desplegado.

### Lo que NO cambia, y es la buena noticia

Los seis motores (`acreditar_atomico`, `usar_cupon_atomico`, `consumir_saldo_atomico`,
`usar_visita_atomico`, `renovar_membresia_atomico`, `registrar_compra_atomico`) trabajan sobre una
tarjeta concreta y no leen `comercios.tipo_tarjeta`. No se tocan.

### Pendientes que se DEJARON esperando a propósito

El dibujo del pase por tipo, el portal del cliente y la pantalla de niveles de descuento. Son justo
las piezas que cambian con varios programas por comercio: construirlas antes sería tirarlas.

## Notificaciones push activas — código completo, falta QA manual (2026-07-30)

Spec: `specs/2026-07-29-notificaciones-push-design.md`. Plan:
`plans/2026-07-29-notificaciones-push.md`. Migración `0026` (tablas `difusiones` y
`notificaciones_enviadas`; `tarjetas.aviso_texto`/`aviso_hasta`/`aviso_inactividad_enviado_en`;
`comercios.aviso_inactividad_activo`/`aviso_inactividad_dias`/`aviso_inactividad_mensaje`) — YA
APLICADA y verificada con `scripts/verificar-0026.ts`.

Push disparado por el SERVIDOR, no por cercanía (a diferencia de geopush): campaña manual desde
`/comercio/notificaciones` (tope de 4 cada 30 días; el dueño elige mensaje, vigencia y programa) y
aviso automático de inactividad (perilla en `/comercio/reglas`, cron diario). Los dos caminos
comparten `enviarMensajeTarjeta` (`lib/comercio/enviarMensajeTarjeta.ts`): Apple vía
`changeMessage` en el reverso, Google vía `addmessage`, con el candado de 3 mensajes/24h por
tarjeta que exige Google (filtrado por canal, no por origen) y rastro en `notificaciones_enviadas`.

**Task 13 del plan (verificación end-to-end) — Step 1 completo, Steps 2-3 quedan pendientes para
el usuario/controlador** (no se puede correr un navegador real ni pegarle al cron de producción
desde un subagente):
- `npx tsc --noEmit && npx eslint . && npm test`: limpio. 75 archivos de prueba, 690 pruebas, todas
  en verde.
- Pendiente:
  1. `/comercio/reglas`: activar el aviso de inactividad, guardar, recargar, confirmar que persiste.
  2. `/comercio/notificaciones`: mandar una campaña, confirmar historial + contador de cupo, y que
     la 5ª campaña del mes se rechaza con el mensaje del tope.
  3. Con una tarjeta real instalada (Apple o Google): confirmar que el aviso llega de verdad al
     reverso del pase / como notificación push, no solo al historial.
  4. `curl -i https://www.cardly-sv.site/api/cron/inactividad` debe devolver `401`, no `500`
     (confirma que `CRON_SECRET` está configurado en producción).
- Esta rama (`claude/post-mvp-features-3f6590`) todavía no se fusionó a `master` — "en producción"
  aplica recién después del merge y de que el usuario recorra los 4 puntos de arriba.

## Si algo no cuadra

El flujo de migraciones a mano + verificación con script descartable, y el patrón de merge
fast-forward a `master` (sin merge commit), son los mismos de siempre — ver `CLAUDE.md`. Si un
subagente reporta un git worktree con historia de OTRA feature (Google Wallet, etc.) al arrancar,
es la infraestructura de la sesión, no un error — ver la nota sobre esto en `CLAUDE.md`.

---

# Sesión del 2026-07-30 (madrugada) — qué quedó hecho y qué sigue

Todo lo de abajo está **fusionado a `master` y desplegado**.

## Corregido en producción

1. **Notificaciones push a Android: `messageType` era `'TEXT'`.** Con ese valor la API devuelve éxito
   pero el mensaje solo se escribe en el detalle del pase y NADIE recibe nada. Con
   `TEXT_AND_NOTIFY` llega. Confirmado en un teléfono real.
   - **El texto de la notificación de Android NO se puede controlar.** Google lo genera ("Mensaje
     nuevo / Presiona para ver el pase"). La FAQ oficial: *"Developer authored push notifications are
     not currently supported"*. En **iPhone SÍ** se lee el mensaje del dueño (`changeMessage`). La
     asimetría es la INVERSA de la que decía el spec original; ya está corregida ahí.
2. **Geopush: faltaba `merchantLocations` en el OBJETO**, no solo en la clase. Empujado a las
   tarjetas existentes con `scripts/resincronizar-objetos-google.ts` (ojo: ese script necesita
   `NEXT_PUBLIC_BASE_URL` de producción, si no Google rechaza el patch ENTERO por la heroImage).
3. **El pase leía `comercios.tipo_tarjeta`**, columna legada desde la 0024, en SEIS lugares. Una
   tarjeta de cupón se le instalaba al cliente dibujada como sellos. Costó dos rondas: el primer
   arreglo tocó 2 de 6 y se declaró cerrado. **Lección: cuando una columna se muda de tabla, barrer
   TODOS los consumidores con grep.**
4. **Regresión de `sello_meta`** que introdujo ese arreglo: `guardarBranding` escribía solo la
   columna del comercio, así que cambiar la meta de sellos dejó de tener efecto. Ya escribe también
   el programa principal.
5. **Dinero mostrado como puntos.** Una gift card de $25.00 decía "PUNTOS 2500". Nuevo módulo puro
   `lib/tarjetas/contadorPase.ts`, compartido por Apple y Google.
6. **El conteo de "tarjetas alcanzadas" contaba llamadas exitosas, no clientes.** Ahora usa
   `hasUsers`, que viene gratis en la respuesta del `addmessage`.
7. **519 comercios huérfanos en la base REAL**, por tres fugas encadenadas del fixture de pruebas.
   Limpiados y la causa cerrada — hoy una corrida completa deja CERO. Ver el comentario largo en
   `test/fixtures/entornoComercio.ts:limpiar()`.

## Branding por programa: 11 de 12 tareas, más el rediseño de la pantalla

Plan: `docs/superpowers/plans/2026-07-30-branding-por-programa.md`.
Spec: `docs/superpowers/specs/2026-07-30-branding-por-programa-design.md`.

Hechas: **1** (migración 0027), **2** (`brandingEfectivo`), **3** (ruta de Storage), **4** (pase de
Apple), **5** (la ruta que dibuja), **6 y 7** (clase de Google por programa), **8** (portal),
**9** (escritura + `sello_meta`), **10** (propagación a los teléfonos), **11** (UI).
Falta: **12** (verificación manual en un teléfono real).

**Rediseño del 2026-07-31 (feedback del dueño).** La UI de la Tarea 11 se había construido dentro de
Programas, con formulario propio, y por eso perdió la vista previa en vivo; además exponía la
columna `branding_propio` como una casilla "Usar marca propia" que el dueño no entendió. Corregido:

- El diseño de tarjetas vive en **Marca** (`/comercio/branding`), con un selector arriba
  (`?programa=<id>`, enlaces GET) y REUSANDO `FormularioBranding`/`FormularioReverso` — o sea, la
  misma vista previa que dibuja el pase real. Programas quedó con tipo, configuración y QR.
- **Vacío = hereda**, con el valor del negocio como placeholder gris (mismo patrón que
  `/comercio/reglas`). `branding_propio` y `reverso_propio` ya NO se muestran: se derivan de lo que
  el dueño carga (`hayMarcaPropia` / `hayReversoPropio`), y para volver atrás hay un botón
  "Usar el mismo diseño de mi negocio" que apaga el interruptor SIN borrar las columnas.
- El aviso de Google dejó de ser un párrafo arriba de todo: es una línea corta, solo junto a los
  tres campos que crean la clase (fondo, logo, portada) y solo diseñando una tarjeta.
- **Reverso por programa** (migración `0029`, que ya estaba aplicada en la base pero cuyo `.sql`
  nunca había llegado al repo — reconstruido y verificado con `scripts/verificar-0029.ts`).
  `reversoEfectivo` vive junto a `brandingEfectivo` y lo consume `datosPassDeTarjeta`.

**Ojo con la 6 y la 7:** son las que crean clases PERMANENTES en el emisor de Google. La API no
tiene `delete`. El diseño las acota a los tres campos que Google realmente usa, pero es una puerta
que no se cierra. La clase de un programa se crea PEREZOSAMENTE, en `linkGuardar` (cuando un cliente
toca "guardar en Google Wallet"), no al guardar el formulario: así una tarjeta que el dueño solo
estaba probando no deja un recurso permanente en el emisor.

**Verificado contra la API real:** un `LoyaltyObject` SÍ se puede mover de clase con `patch`, y las
clases nuevas nacen `approved` (no `UNDER_REVIEW`) porque el emisor ya está aprobado. Costo: la
clase `<emisor>.prueba_mover_clase_2026_07_30` quedó para siempre.

## Pendiente que necesita al usuario

- Confirmar en un **iPhone** que la campaña se lee en la pantalla de bloqueo (es el canal donde el
  texto del dueño SÍ aparece).
- Confirmar el **geopush en Android** ahora que las ubicaciones están en el objeto. Requiere
  "Permitir siempre" + ubicación precisa, y el interruptor de pases cercanos POR PASE (los pases ya
  guardados no se inscriben solos).
- `curl -i https://www.cardly-sv.site/api/cron/inactividad` → debe dar `401`, no `500`.
- **El cupón no tiene campo de valor.** Solo vigencia; qué ofrece el cupón vive en el texto del pase
  y el sistema no lo entiende. Decisión de producto pendiente.
- **`/comercio/notificaciones` dice "N tarjetas alcanzadas"** — ya corregido para contar solo
  quienes tienen el pase instalado.

## Specs listos sin implementar

- `docs/superpowers/specs/2026-07-30-estado-tarjetas-design.md` — eliminar/archivar/anular/anonimizar
  clientes. Revisado, con 3 bloqueantes ya corregidos. **Sin plan todavía.**
- `docs/superpowers/plans/2026-07-30-editor-cartel-qr.md` — QR imprimibles. Plan escrito, nunca
  implementado.

---

# Sesión del 2026-08-02 al 08-07 — cartel/QR imprimible, y qué queda

> Corrige la sección anterior: el plan `2026-07-30-editor-cartel-qr.md` **sí se implementó** y está
> en producción. Suite: **977 verdes en 97 archivos** (eran 415 cuando nació este documento).

## En producción

**Editor de cartel/QR por programa** (`/comercio/programas/<id>/cartel`, migración 0028). Tres
plantillas × dos formatos (sticker 10×10 cm, mostrador A5), vista previa en vivo con la MISMA
función que exporta, y descarga en PNG a 300 dpi y PDF.

Lo que no es obvio y costó encontrar:
- **El texto se convierte a CONTORNOS al exportar** (`textoInter.ts`). El runtime de Vercel no tiene
  ninguna fuente y `@font-face` NO funciona en librsvg 2.61.2 — está medido contando píxeles con
  cuatro MIME distintos, no supuesto. Un `<text>` ahí sale como un cuadradito por letra, sin error.
  Por eso `construirCartelSvg` exige el dibujante como parámetro obligatorio: un default volvería a
  los cuadraditos en silencio.
- **`opentype.js` 2.0.0 está roto**; el repo está clavado en 1.3.4.
- El QR estaba **descentrado un 4.6% del ancho** en las tres plantillas que lo centran: la tarjeta
  blanca mide el QR más un margen del 12% a cada lado, y se restaba medio lado del QR. Arreglado con
  `ladoTarjetaQr()`. Ver la regla nueva en CLAUDE.md sobre reemplazos "en todos los sitios".

**Elementos libres del cartel** (migración 0030): hasta 12 textos y franjas de color por coordenada,
en PORCENTAJES del lienzo (el formato se elige AL DESCARGAR, después de colocarlos). Se arrastran
sobre la vista previa o se mueven con deslizadores y flechas. Las franjas se dibujan DEBAJO de la
tarjeta blanca del QR: una franja no puede matar el código, pase lo que pase.

**Frase del cartel por tipo de tarjeta** (`ctaSugerido.ts`): sellos → "Acumulá sellos y ganá",
cashback → "Acumulá saldo con tus compras", y así los ocho. Es solo el valor inicial; una frase ya
guardada gana siempre. El tipo sale del PROGRAMA, no de `comercios`.

**Otras correcciones de producción de estas sesiones:** geopush en Android; `TEXT_AND_NOTIFY` en
Google (`TEXT` devolvía éxito y no notificaba a nadie); `merchantLocations` en el objeto además de
la clase; conteo honesto de "tarjetas alcanzadas" (usaba éxitos de API, ahora `hasUsers`); 519
objetos huérfanos limpiados; branding y reverso POR PROGRAMA (0027/0029), con clase de Google propia
y creación perezosa; y la vista previa de Marca que inventaba una meta de sellos inexistente.

## PENDIENTES — lo que sigue

### 1. Contracción de `comercios.tipo_tarjeta` — es un bug vivo, no solo deuda
La 0024 movió el tipo a `programas_tarjeta`, pero la columna vieja sigue existiendo Y siendo leída
(`lib/apple/datosPassDeTarjeta.ts`, `lib/google/syncObjeto.ts`, `lib/google/linkGuardar.ts`,
`lib/comercio/programas.ts`, `app/admin/(protegido)/comercios/[id]/clientes/page.tsx`).

El daño concreto, verificado en el código: `app/comercio/(protegido)/branding/page.tsx:94` decide
`esSellos` con `c.tipo_tarjeta` cuando no hay programa seleccionado, mientras `guardarBranding.ts:83`
escribe `sello_meta` en el **programa principal**. Si el panel de FM cambia el tipo del comercio sin
propagarlo, Marca esconde el campo de meta y **el siguiente guardado le borra la meta al principal**
— la grilla de sellos desaparece de los pases sin que nadie toque nada.

Orden sugerido: propagar/leer siempre del programa en esos cinco lugares, y recién después la
migración de contracción que retira la columna.

### 2. `e2e/owner-branding.spec.ts` está desactualizado
Quedó viejo tras el rediseño de la pantalla de Marca (branding por programa). No corre en `npm test`
(Vitest excluye `e2e/**`), así que no rompe nada — pero tampoco protege nada.

### 3. Decisiones de producto que el usuario tiene que tomar
- **El cupón no tiene campo de valor.** Solo vigencia; qué ofrece vive en el texto del pase y el
  sistema no lo entiende. No hay columna `cupon_valor` — verificado.
- **Ergonomía del arrastre en el cartel:** el punto de agarre de un texto mide 32 px y la vista
  previa 260. Si en el teléfono se siente incómodo, los dos son un número.

### 4. Specs y planes escritos sin implementar
- `specs/2026-07-30-estado-tarjetas-design.md` — eliminar/archivar/anular/anonimizar clientes.
  Revisado, 3 bloqueantes corregidos, **sin plan todavía**.
- ~~Del plan de tandas: **Tanda 2**~~ → **YA ESTABA HECHA**, verificado el 2026-08-07. Las tres
  cosas existen y funcionan: la imagen por premio (`recompensas.foto_url`), el **selector de país**
  (`lib/clientes/paises.ts` — 18 países con sus largos nacionales válidos, cableado en el registro,
  el portal y las dos rutas de API, con 15 pruebas que cubren hasta los países que comparten código
  de marcado) y **exportar clientes a CSV** (`/comercio/clientes/exportar`). Este documento decía
  que estaban pendientes: estaba desactualizado.
- ~~Queda **Tanda 4**~~ → **HECHA el 2026-08-07.** Subir de plan es inmediato desde
  `/comercio/plan`; bajar sigue siendo una solicitud que resuelve FM, y esa asimetría es
  deliberada (subir es alguien aceptando pagar más: no hay nada que negociar, y hacerlo esperar
  cuesta plata de los dos lados). Sin pasarela: el monto de la cuenta se actualiza y FM factura como
  siempre. **Ojo con lo que no era obvio:** subir de plan podía QUITARLE cupo a una cuenta con
  límite negociado (un Starter con cupo 5 pasando a Growth recibía el sugerido, que es 2) — ahora
  gana el mayor, y `null` de Pro le gana a cualquier número.
- Fuera de alcance permanente: Stripe (no acepta negocios de El Salvador) y N1co (espera la
  personería jurídica). **Con la Tanda 4 cerrada, ya no queda nada de la hoja de tandas original.**

### 5. QA manual que necesita al usuario
- Que una **franja puesta encima del QR** no impida escanear el cartel impreso (el diseño lo
  garantiza; falta la prueba con papel y teléfono).
- Confirmar en un **iPhone** que la campaña se lee en la pantalla de bloqueo.
- `curl -i https://www.cardly-sv.site/api/cron/inactividad` → debe dar `401`, no `500`.

---

# Sesión del 2026-08-07 — los ocho tipos de tarjeta, de verdad funcionales

> Corrige el pendiente **#1** de la sección anterior (ya no aplica: los lectores del panel del dueño
> y del panel de FM leen del programa) y cierra el hueco de **Descuento por nivel**.
> Migración **0031 APLICADA y verificada** (`scripts/verificar-0031.ts`). Suite: **985 verdes en 98
> archivos**.

## El hallazgo: la 0024 mudó la configuración de tabla y los motores no se enteraron

La migración 0024 mudó `sello_meta`, `cashback_porcentaje`, `multipass_visitas`, `membresia_dias` y
`cupon_vigencia_dias` de `comercios` a `programas_tarjeta`, e hizo el backfill. Desde entonces la
pantalla que edita esos números es **Programas**, y escribe SOLO en `programas_tarjeta`. **Nadie
volvió a escribir las columnas de `comercios`** — pero tres motores seguían leyéndolas.

Para cualquier comercio dado de alta DESPUÉS de la 0024 esas columnas son `null` para siempre. O sea:

| Tipo | Qué pasaba en producción |
|---|---|
| **Prepago** | "Vender paquete" siempre fallaba: *"Todavía no configuraste cuántas visitas trae el paquete. Andá a **Reglas**"* — y Reglas ya no tiene ese campo. |
| **Cashback** | "Acreditar cashback" siempre fallaba, con el mismo mensaje y el mismo callejón sin salida. |
| **Membresía** | "Renovar" siempre fallaba: el RPC leía `comercios.membresia_dias`. |
| **Cupón** | `cupon_vigencia_dias` **nunca se aplicó a nada**: `registrarCliente` no escribía `vigencia_hasta`, y `usar_cupon_atomico` deja pasar el null. Una campaña de 7 días era canjeable para siempre. |
| **Descuento** | `crearNivel`/`eliminarNivel` existían **sin ninguna pantalla que los llamara**: sin umbrales, todos los clientes quedaban en "Sin descuento todavía" para siempre. |
| **Gift card / cashback** | El portal del cliente y las dos pantallas de Clientes mostraban **$25.00 como "2500 puntos"**, y cupón/membresía/descuento como "0 puntos". |

### Por qué la suite estaba en verde con todo eso roto

**El fixture de tests copia la configuración del comercio al programa** (`entornoComercio.ts`:
`crearComercio({ multipass_visitas: 10 })` espeja al principal). Quedaba en las DOS tablas, así que
daba igual cuál leyera el motor. Las pruebas medían la columna legada y pasaban.

La prueba honesta vive en **`lib/tarjetas/tiposFuncionales.test.ts`**: carga la configuración por el
camino de producción (`crearPrograma`, la misma función de la pantalla) y **deja el comercio con sus
columnas vacías**. Arrancó con 6 de 6 en rojo. **Regla para el futuro: si una prueba de un motor
configura el comercio, no está probando lo que vive el dueño.**

## Qué se arregló

- `venderPaquete` y `acreditarCashback` leen del **programa de la tarjeta** (`resolverProgramaDeTarjeta`).
- `registrarCliente` emite el cupón **con su fecha** (`vencimientoInicialCupon` + `hoyEnZona`, en la
  zona del comercio). Se fija AL EMITIR y no se recalcula: cambiar el plazo no le acorta el cupón a
  quien ya lo tiene.
- **Se retiró `formatearSaldo`** (`lib/portal/buscarTarjetas.ts`). No se arregló su cuerpo a
  propósito: el defecto estaba en su **firma** —sin la fecha ni el acumulado no hay forma de
  describir cupón, membresía ni descuento—, así que arreglarlo habría dejado la trampa armada para
  el próximo llamador. Sus cuatro consumidores pasan por `describirFila`
  (**`lib/tarjetas/estadoTarjeta.ts`**, módulo nuevo), que viaja junto a `COLUMNAS_ESTADO`: pedir la
  función sin las columnas deja de ser posible.
- **Pantalla de niveles de descuento** (`programas/NivelesDescuento.tsx` + dos server actions). Los
  niveles siguen siendo **del comercio** (`niveles_descuento.comercio_id`, 0018) — decisión
  explícita del usuario: sin migración, y el tope de 2 programas activos hace que compartir la
  escalera entre dos programas de descuento no se dé en la práctica. Por eso `descuento` sigue fuera
  del desplegable de "programa nuevo".
- **`sello_meta` y el tipo se leen del programa** en escáner, las dos pantallas de Clientes, el panel
  del dueño y el panel de FM. En Marca, la decisión de mostrar "Meta de sellos" ahora sale del
  programa **principal** — la misma fila que escribe `guardarBranding`. Eso cierra el pendiente #1:
  leer y escribir ya no pueden discrepar.
- `Programa` ganó `selloMeta` (`lib/comercio/programas.ts`), que es lo que hizo posible lo anterior.

## Lo que NO es obvio y hay que recordar

1. **La zona horaria del comercio es parte de la corrección, no un detalle.** El escáner comparaba
   la vigencia contra `new Date().toISOString()` (UTC) mientras `usar_cupon_atomico` usa la zona del
   comercio: a las 7 de la tarde en El Salvador la pantalla decía "Venció" y el RPC lo seguía
   aceptando. El cajero le decía que no a un cliente al que el sistema le decía que sí.
2. **La 0031 cambia el CUERPO del RPC, no su firma.** Agregar un `p_dias` habría creado un overload
   ambiguo (42725) — el mismo tropiezo que documentó `acreditar_puntos_atomico` en la 0015. Con la
   firma intacta se aplica ANTES del deploy sin romper el código vivo. Y los días se leen ADENTRO
   del RPC para no reabrir la carrera que cerró la 0019: la fecha se sigue calculando dentro del
   propio `UPDATE`.
3. **`vencimientoInicialCupon` usa `hoy + días`, no `hoy + días - 1`.** Es la misma convención que
   ya usaba `renovar_membresia_atomico` (`greatest(vigencia_hasta, hoy) + v_dias`), y el día de
   gracia cae a favor del cliente — igual criterio que el redondeo del cashback.
4. **Mutation-testing corrido: 5 mutaciones, las 5 matan su prueba por el motivo correcto.** La más
   valiosa es la del portal: sacándole `vigencia_hasta` al `select`, un cupón vencido pasa a leerse
   **"Disponible"**. Una prueba unitaria del formateador habría seguido en verde — el defecto nunca
   estuvo en el formateador sino en la consulta.
5. **La 0031 trajo su propia prueba de mutación, sin escribirla.** La prueba de membresía estuvo en
   rojo mientras la migración no se aplicó y pasó a verde con ella, **sin que cambiara una línea de
   TypeScript**: la base sin migrar ERA la mutación, y la mató. `verificar-0031.ts` prueba además la
   otra mitad (sin días en el programa → `membresia_sin_configurar`), sin la cual la primera podría
   estar pasando por cualquier motivo.

## Lo que sigue pendiente acá

- **QA manual del usuario, un tipo por vez:** crear un programa de cada tipo, registrar una tarjeta
  y correr su operación desde el escáner real. Es lo único que no cubre la suite: las pruebas llaman
  a los motores directo, no a través de la pantalla.
- **La migración de contracción** que retira `comercios.tipo_tarjeta` y su configuración sigue
  pendiente. Ya no es urgente —nadie las lee para decidir nada— pero mientras existan invitan a que
  alguien las vuelva a leer.
- **`descuento` sigue fuera del desplegable de "programa nuevo"** (`FormularioNuevoPrograma.tsx`), y
  es coherente: sus niveles son del COMERCIO, así que dos programas de descuento compartirían la
  escalera. Un comercio llega al tipo por el panel de FM (su programa principal espeja el tipo), y
  ahí la pantalla nueva de niveles ya lo hace usable de punta a punta.

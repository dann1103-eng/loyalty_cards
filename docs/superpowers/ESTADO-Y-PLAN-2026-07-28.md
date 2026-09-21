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
  4. `curl -i https://www.cardly-sv.site/api/cron/avisos` (se llamaba `/api/cron/inactividad` hasta el 2026-09-13) debe devolver `401`, no `500`
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
- `curl -i https://www.cardly-sv.site/api/cron/avisos` (se llamaba `/api/cron/inactividad` hasta el 2026-09-13) → debe dar `401`, no `500`.
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
- `curl -i https://www.cardly-sv.site/api/cron/avisos` (se llamaba `/api/cron/inactividad` hasta el 2026-09-13) → debe dar `401`, no `500`.

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

---

## 2026-08-13 — Catálogo de planes nuevo (escalera 1/3/10) y onboarding opcional

Disparado por un análisis competitivo que Daniel pidió sobre tres plataformas que él mismo señaló:
**Vuelvo Cards** (El Salvador, competencia directa), **Loyalty Ladder** (Guatemala) y **Devotio
Rewards** (LatAm).

**HALLAZGO QUE MANDA SOBRE TODO LO DEMÁS, verificado por CNAME contra 8.8.8.8:** los tres resuelven
`app.<dominio>` a `ns.digitalwallet.cards`, el MISMO host de `app.boomerangme.biz`. Son marcas
blancas de Boomerangme. Consecuencias: sus 8 tipos de tarjeta son los 8 de Boomerangme (por eso
"Multipass" aparece con ese nombre inventado en dos sitios distintos); tienen piso de costo real
(Agency $259/mes + $15/mes por sub-cuenta) mientras que acá el costo marginal por comercio es ~0; y
no controlan su roadmap. **Cardly es el único de la lista con código propio** — ésa es la ventaja
que ninguno puede copiar sin dejar de revender. Detalle en la memoria `reference-competencia-cardly`.

**Vuelvo cobra SOLO anual** ($300/$600/$1,200 por adelantado) + setup $97/$147/$197. No ofrecen mes
a mes. Su arma no es el precio, es el plazo.

### Qué cambió en el código

| | Antes | Ahora |
|---|---|---|
| Starter | $29 · 1 | $29 · 1 |
| Growth | $49 · **2** | $49 · **3** |
| Pro | $89 · **sin límite** | $89 · **10** |
| Instalación | $150 obligatorio | **onboarding opcional, $150 en los tres planes** |

La escalera 1/3/10 es la que usan TODOS los competidores; el comprador ya la vio antes de llegar.
Y el tope de Pro en 10 coincide con el techo TÉCNICO del geopush (Apple ignora la ubicación 11 en
silencio, Google rechaza la clase entera con más de 10), así que el plan deja de prometer algo que
la plataforma no puede cumplir. Arriba de 10 se sube `limite_negocios` a mano desde el panel FM.

Archivos: `lib/comercios/cuentas.ts` (PLANES), `lib/comercios/planCuenta.ts`, `app/page.tsx`, y las
cinco pantallas que ramificaban sobre `limiteSugerido === null` (rama ya muerta).

### El bug que el cambio introducía y se atrapó antes de shipear

`subirPlanPorElDueno` calculaba `Math.max(destino.limiteSugerido, cuenta.limite_negocios ?? 0)`.
Ese `?? 0` trata "sin tope" como CERO. Mientras Pro era `null` no importaba (el null venía del plan
destino y se resolvía antes). Con Pro en 10, una cuenta vieja con `limite_negocios = null` que
subiera de plan quedaba en `Math.max(10, 0) = 10`: **le revocábamos en silencio el sin-límite que ya
había comprado, justo al aceptar pagar más.** Arreglado con `yaEstabaSinTope` y prueba de regresión
(`subir NO le quita el sin-tope a una cuenta que ya lo tenía`). Ninguna cuenta existente cambia por
el cambio de catálogo: `limite_negocios` vive por cuenta y solo se toca al cambiar de plan.

### Geopush: un defecto arreglado, y un síntoma que sigue SIN explicar

Daniel reportó que el aviso por cercanía no llega ni en su iPhone ni en los Android de prueba. Se
instrumentaron 5 bordes contra producción real y **el servidor está limpio**: la BD tiene las 2
sucursales de Farmacias ABC activas con coordenadas, `listarUbicacionesGeopush` las devuelve con su
`relevantText`, las 7 tarjetas generarían un `.pkpass` con las 2 `locations`, y la API real de
Google devuelve `merchantLocations` con las 2 en la CLASE y en los 3 objetos muestreados.
`merchantLocations` es el campo correcto (el `.d.ts` instalado dice literal que dispara
notificación; `locations` es el deprecado). **No re-investigar eso.**

**Defecto real encontrado y arreglado:** `accionGuardarGeopush` llamaba a `syncClaseComercio` pero
NO a `syncObjetosComercio`. Un objeto ya emitido solo recibía las coordenadas nuevas por una venta o
por correr a mano `scripts/resincronizar-objetos-google.ts`. Como `construirRecursos.ts` documenta,
las ubicaciones a nivel de OBJETO son las que hacen que a un Android le llegue el aviso. Arreglado
con prueba nueva (`app/comercio/(protegido)/sucursales/actions.test.ts`), verificada por mutación.

**Lo que queda abierto es la ENTREGA al teléfono, y la prueba la tiene que hacer Daniel:** borrar el
pase, volver a agregarlo desde el link de registro, y recién ahí pasar por el local.
- Si con el pase recién agregado funciona → la causa es la actualización de pases ya instalados (el
  push automático de Apple nunca se confirmó funcionando en su dispositivo).
- Si tampoco → es comportamiento de plataforma: mirar `maxDistance` (hoy 100 m, el extremo angosto)
  y el tiempo de permanencia que exige Google.
- **En iPhone NO hay notificación con sonido, por diseño** — es una sugerencia en la pantalla de
  bloqueo. Parte del reporte puede ser esa diferencia de expectativa.

### Pendiente de decisión del dueño

- **Plan anual con dos meses gratis.** Es la única arma real de Vuelvo y hoy no existe acá. Requiere
  su propia migración (periodicidad por cuenta), no es un cambio de constantes.
- **El adicional por local sobre el tope de Pro.** El análisis propone $12/mes; todavía no se fijó ni
  se modeló — hoy se resuelve subiendo `limite_negocios` a mano.

---

## 2026-09-08 — El editor de marca deja de mentir, y la foto de la franja se puede encuadrar

Disparado por Daniel dándose de alta como un cliente nuevo cualquiera: eligió **membresía** (una
tarjeta que solo muestra el QR), entró al editor de marca y encontró tres cosas.

1. **La vista previa estaba cableada a puntos o sellos.** Debajo de la franja decía "PUNTOS 0"
   aunque el pase real de una membresía no lleva ningún contador. Una gift card de $25 se
   previsualizaba como "PUNTOS 2500" — la misma unidad equivocada que ya se había arreglado en el
   pase el 2026-08-07, pero que seguía viva en la pantalla.
2. **La foto de fondo de la franja salía cortada y no había forma de acomodarla.** Apple fija la
   franja en 375×123 y la foto se recortaba al centro: el logo que Daniel había puesto arriba
   quedaba partido al medio. El único control era el difuminado.
3. **Las etiquetas hablaban de sellos en todos los tipos** ("Franja personalizada (reemplaza la
   grilla de sellos)" en una membresía).

Spec: `specs/2026-09-08-editor-marca-por-tipo-y-encuadre-franja-design.md`.
Plan: `plans/2026-09-08-editor-marca-por-tipo-y-encuadre-franja.md`.
**Migración 0032 APLICADA y verificada** (`scripts/verificar-0032.ts`).

### Lo que ahora existe

- **`lib/tarjetas/frentePase.ts`** — qué va en el campo primario (sobre la franja) y en el
  secundario (debajo). Vivía inline dentro de `generarPassApple`, y la vista previa lo
  re-adivinaba con su propio `if/else`: por eso pudo divergir. Ahora las dos leen la misma función
  y no pueden decir cosas distintas ni en una palabra.
- **`lib/comercio/encuadreFranja.ts`** — el encuadre de la foto: **modo** (`llenar`/`completa`),
  **foco** X e Y (0–100, semántica de `object-position`) y **zoom** (100–300%). `colocarFoto`
  decide dónde va la foto dentro de un marco cualquiera y `rectanguloVisible` es su inversa (la
  ventana de la foto que ocupa el marco). Cinco consumidores: la vista previa (CSS), la franja del
  pase de Apple (next/og), la grilla de sellos y la portada de clase de Google, y el cartel (SVG).
  Como el marco es un parámetro, la misma foto se ve coherente en la franja 3:1 y en el cartel
  vertical.
- **Migración 0032**: cuatro columnas en `comercios` (NOT NULL con default, así nada existente
  cambia de aspecto) y cuatro en `programas_tarjeta` (nullable).
- **Ruta nueva `app/api/comercios/[comercioId]/franja.png`**: la portada de la `LoyaltyClass` de
  Google pasa a ser la MISMA banda compuesta que va en el pase de Apple.
- **El cartel imprimible** aplica el mismo encuadre en su plantilla "foto".
- **El editor**: bloque "Foto de fondo de la franja" con radios de modo, tres deslizadores y el
  difuminado mudado adentro, más **arrastrar la foto directamente sobre la vista previa**.

### Lo que NO es obvio y hay que recordar

1. **El encuadre VIAJA CON LA FOTO; no se hereda campo por campo como los colores.** Un color del
   negocio sirve igual en cualquier tarjeta, pero la posición de una foto solo tiene sentido para
   ESA foto: heredar el foco del negocio sobre una foto distinta da siempre un resultado sin
   sentido. La regla vive dentro de `brandingEfectivo` (con foto propia, su encuadre o el default;
   heredando la foto, el encuadre del negocio) para que ningún consumidor pueda divergir. Vale
   también para la vista previa: una tarjeta que hereda la foto se previsualiza con el encuadre
   del NEGOCIO, que es el que ve el cliente.
2. **Hay TRES lugares que construyen la clase de Google, no dos.** `syncClaseComercio`,
   `syncClasePrograma` y **la clase EMBEBIDA en el JWT de `linkGuardar`**, que Google upsertea por
   id al procesarlo. La revisión del plan lo atrapó: sin cambiar el tercero, cada cliente que toca
   "Agregar a Google Wallet" habría devuelto la portada a la foto cruda, deshaciendo en silencio lo
   que la ruta nueva logró. Y la URL tiene que corresponder a la clase que VIAJA (la del comercio
   salvo que el programa tenga clase propia) y hashearse con los campos de ESA clase, o Google
   re-descarga en cada JWT.
3. **`onLoad` de una `<img>` no alcanza para medir la foto, y ninguna prueba lo podía atrapar.**
   El HTML llega renderizado del servidor, así que el navegador termina de bajar la foto ANTES de
   que React hidrate; `onLoad` no vuelve a dispararse y `medidasFoto` se quedaba en `null`. El
   encuadre no se aplicaba NUNCA y los deslizadores no movían nada, con el typecheck limpio y las
   ~1000 pruebas en verde. Se encontró **midiendo en el navegador** con `getBoundingClientRect`
   sobre el componente real (una página temporal fuera del gate, borrada al terminar) — que es
   exactamente el procedimiento que CLAUDE.md ya documentaba para una interfaz sin pruebas de
   componentes. Arreglado con un `ref` que mide al montar, además del `onLoad`.
4. **La franja personalizada (`strip_url`) queda FUERA de la portada de la clase de Google.** La
   ruta fuerza `stripUrl: null`: con franja, `componerFranja` devuelve los bytes crudos del archivo
   (formato y tamaño arbitrarios) y servirlos como `image/png` es lo que Google rechaza al validar
   la clase.
5. **Dos reglas distintas en el formulario: cuándo se VE el bloque y cuándo VIAJAN los campos.** Si
   viajaran solo cuando se ven, publicar los colores con una franja personalizada puesta le
   borraría al dueño el encuadre que ya había ajustado. En el negocio viajan siempre (columnas NOT
   NULL); en una tarjeta, solo con foto propia.
6. **Cambio VISIBLE para los comercios existentes en Android:** la portada de las tarjetas que no
   son de sellos deja de ser la foto cruda y pasa a ser la banda con velo, difuminado y encuadre —
   o sea, igual que en iPhone. Fue una decisión explícita de Daniel, no un efecto colateral.

### Lo que queda pendiente acá

- **QA en teléfono real, que solo puede hacer Daniel:** subir una foto con el logo arriba,
  encuadrarla, publicar, y confirmar en un iPhone (`.pkpass`) y en un Android (portada de la clase)
  que llega el mismo encuadre que muestra la pantalla. Ojo con Google: cachea por URL, así que el
  cambio se ve recién cuando el `?v=` cambia (lo hace solo al guardar).
- **La vista previa de la franja personalizada** ahora se muestra tal cual en la pantalla; nunca se
  verificó contra un pase real con `strip_url` puesta.

---

## 2026-09-08 (tarde) — El panel deja de hablarle de sellos a quien no los tiene (entrega 1 de 2)

Disparado por Daniel siguiendo con la misma cuenta de **membresía**: terminada la personalización, el
panel le pedía "Definí cómo se ganan los sellos" y "Cargá tu primer premio", y una métrica gigante
decía "PUNTOS VIGENTES 0". Pidió auditar TODO.

**La auditoría encontró 38 lugares.** El patrón es siempre el mismo: una rama **binaria**
(`esSellos ? … : …`) sobre un catálogo de **ocho** tipos, o una lectura del contador universal
`tarjetas.puntos_actuales` sin mirar qué significa en ese tipo.

Spec: `specs/2026-09-08-coherencia-por-tipo-de-tarjeta-design.md` (**tres** rondas de revisión: 13,
12 y 3 hallazgos). Plan de esta entrega: `plans/2026-09-08-coherencia-pantallas-por-tipo.md`.
**Sin migración.** Suite: **1150 verdes en 110 archivos**.

### Lo que entró

- **`lib/tarjetas/textosPorTipo.ts`** y **`lib/tarjetas/etiquetaEscaner.ts`**: los textos salen de
  tablas por tipo con prueba de cobertura de los ocho, no de un `if` sobre sellos.
- **`pasosParaTipo`** (`primerosPasos.ts`): el tutorial cambia sus cuatro pasos según el tipo.
- **`mensajeAcreditacion`** (`unidadPrograma.ts`): la confirmación del cajero, en la unidad del
  programa y con el género concordado.
- **`historial.ts`**: `uso` y `renovacion` dejan de colapsarse en `acreditacion`.
- **`app/registro/**`**: la pantalla que ve el cliente usa la marca del comercio y el tipo real.
- **`exportarClientes.ts`**: el CSV pasa a `describirFila` + `COLUMNAS_ESTADO`.
- Y los consumidores: panel, clientes, recompensas, reglas, sucursales, portal, panel de FM.

### Lo que no es obvio y hay que recordar

1. **El tutorial era IMPOSIBLE de completar, y esa es la forma más cara del defecto.** El paso 2
   apuntaba a Reglas, pantalla que para seis de los ocho tipos ESCONDE su formulario y dice "tu
   tarjeta no necesita estas reglas". Como el `hecho` se derivaba de que existiera una fila en
   `reglas_puntos`, el dueño quedaba clavado en "1 de 4" para siempre, y `PrimerosPasos` solo se
   esconde con los cuatro hechos. **Un checklist cuyo paso vive en una pantalla que lo esconde no
   es un texto mal escrito: es un callejón sin salida.** La prueba que lo cierra recorre los ocho
   tipos y verifica que ningún paso apunte a una pantalla que no le sirve a ese tipo.
2. **El `hecho` de "términos" se lee con `reversoEfectivo`, no con la columna del programa.** En
   modo negocio el editor de Marca escribe `comercios.terminos_uso`, y ese es el flujo por defecto
   (el selector de programa aparece recién con dos tarjetas). Leyendo solo la del programa, el dueño
   que YA escribió sus términos quedaba clavado en 3 de 4: el mismo bug, por otra puerta.
3. **La pantalla de registro era ciega a la marca Y al tipo**, y es el momento de la conversión.
   `page.tsx` hacía `select('id, nombre')`, así que la tarjeta de muestra era un degradado marrón
   fijo que decía "TARJETA DE LEALTAD" y "0 PUNTOS" — a un comercio azul de membresía, recién
   personalizado. La resolución de marca vive en `marcaDelRegistro.ts` y NO dentro de cada
   `page.tsx`: hay DOS entradas de registro (el QR viejo sin programa y el de un programa no
   principal), y tocar una sola era la trampa del "reemplazo en todos los sitios de llamada".
4. **Tres pantallas dibujan una réplica de la tarjeta y las tres pasan por `frentePase`**: el editor
   de marca, el registro del cliente y el alta en el panel de FM. Es un guardarraíl explícito: si
   una vuelve a tener su propio `if`, el dueño diseña una cosa y su cliente ve otra.
5. **El trato es distinto a propósito.** El panel del dueño **vosea**; el registro y el portal
   **tutean**. Decisión de Daniel el 2026-09-08. No unificar una frase suelta: mezclar los dos
   registros en la misma pantalla se nota.
6. **`ETIQUETA_PRINCIPAL` no se puede importar desde una página**: vive en un archivo `'use server'`,
   que solo exporta funciones async. Por eso `etiquetaEscaner.ts` deriva de `accionPrincipal` del
   catálogo, que es la misma fuente, en vez de duplicar la tabla.
7. **En los controles antifraude, "operaciones" y no "escaneos"**: el tope diario y la espera cuentan
   MOVIMIENTOS registrados, y un escaneo abandonado no suma. En puntos se conserva "acreditaciones"
   porque más abajo hay otra perilla que sí limita puntos.

### Lo que queda (entrega 2, CON migración 0033)

- **Reportes que cuentan operaciones.** Hoy filtran `tipo = 'acreditacion'`, así que una membresía
  reporta CERO actividad con cientos de renovaciones y la pantalla antifraude por cajero es ciega.
  Ojo con la trampa que encontró la tercera ronda de revisión: agregar los `filter` sin SACAR el
  predicado del `WHERE` compartido deja el conteo idéntico y todas las pruebas en verde.
- **Secciones muertas y navegación.** Premios y Programas intercambian superficie en los tipos con
  contador `'ninguno'` (un canje descuenta de un contador que nunca se mueve).
- **Identidad del pase**: `nombre_pase` y la vigencia en el frente, en las dos billeteras.

### Fuera de alcance, anotado para no perderlo

- **Una campaña disparada por el VENCIMIENTO** (avisarle al socio antes de que se le venza). Es lo
  que de verdad necesita un negocio de membresías: hoy el único aviso automático se dispara por
  INACTIVIDAD, y alguien que renovó ayer no está inactivo.
- **`reporte_fm_comercios.saldo_circulante`**, que suma `puntos_actuales` de todos los comercios y
  todos los tipos: el mismo defecto de la métrica del panel, a escala de plataforma.

---

## 2026-09-09 — Reportes por operaciones, navegación por tipo, e identidad del pase (entrega 2 de 2)

Cierra el trabajo abierto el 2026-09-08. **Migración 0033 APLICADA y verificada**
(`scripts/verificar-0033.ts`). Plan: `plans/2026-09-08-reportes-navegacion-identidad-pase.md`.

### Lo que entró

- **Los reportes cuentan OPERACIONES.** El ledger distingue `acreditacion`, `ajuste`, `uso` y
  `renovacion` (0019), pero las cinco funciones de reporte filtraban `tipo = 'acreditacion'`: un
  comercio de membresía veía CERO actividad con cientos de renovaciones, y la pantalla antifraude
  por cajero era ciega frente a un cajero que regala renovaciones. La columna `acreditaciones` pasó
  a `operaciones`.
- **`resumenPrograma`**: la métrica del panel se parte por programa y cada familia de tipo trae su
  propia PREGUNTA (suma en su unidad / dinero / vigentes sobre el total / con descuento).
- **Navegación por tipo**: Premios y Programas intercambian superficie donde ningún premio se puede
  canjear nunca.
- **Secciones muertas**: el escáner no trae recompensas que el tipo no puede canjear, y los cuatro
  límites antifraude solo se ofrecen donde la operación pasa por `acreditar_atomico`.
- **El pase dice cómo se llama y hasta cuándo vale**: `programas_tarjeta.nombre_pase` (opcional,
  hasta 40 caracteres) y la vigencia en el frente, en las DOS billeteras.

### Lo que NO es obvio y hay que recordar

1. **CONTAR se ensancha; SUMAR no se toca.** Un `uso` lleva delta NEGATIVO en prepago (`-1`, 0020)
   y en gift card (`-monto`, 0022). Meterlo en `sum(puntos_delta)` habría convertido el reporte
   antifraude de BRUTO a NETO: un cajero que otorga y después consume se borraría solo del reporte,
   que es exactamente lo que la 0015 decidió impedir. Por eso el `WHERE` se ensancha y la suma lleva
   su propio `filter`.
2. **El predicado tiene que SALIR del `WHERE` compartido, o el cambio es INERTE.** Si se deja
   `tipo = 'acreditacion'` en el `WHERE` y se agregan `filter` nuevos, ninguna fila `uso` ni
   `renovacion` llega al agregado: el conteo sale idéntico, la membresía sigue en cero y TODAS las
   pruebas siguen verdes porque para puntos y sellos nada cambia. Lo encontró la tercera ronda de
   revisión del spec.
3. **Renombrar una columna de salida NO es una migración aditiva.** `create or replace` falla con
   "cannot change return type", así que hay `drop` + `create` — y eso borra el ACL: hay que repetir
   los `revoke` ADEMÁS de los `grant`, o `reporte_fm_comercios()` (sin parámetros, cross-comercio)
   queda invocable por `anon`. **Y la regla "migración primero, deploy después" NO aplica acá:** el
   código en producción leía `.acreditaciones`, así que aplicarla sola rompió cuatro pantallas hasta
   el deploy. Para un renombre, el orden correcto es deploy tolerante → migración, o las dos en la
   misma ventana.
4. **Google NO puede tomar `frentePase().primario`.** `loyaltyPointsDe` usaba `contadorPase` a
   propósito: en Google el texto va SIEMPRE, también con grilla, porque es lo que se lee en la vista
   de lista de Wallet. Con `hayGrilla: true` el primario es `null`, así que tomarlo dejaba a Android
   **sin el contador de sellos**. Por eso `frentePase` tiene un cuarto campo, `listado`.
5. **`validTimeInterval` va SIN offset** (`2026-10-12T23:59:59`): la API lo interpreta como hora
   local del teléfono. Con `Z`, el pase se apagaría a las 6 de la tarde en El Salvador. Y va gateado
   por `usaVigencia`, para que una fecha basura en una tarjeta de puntos no le apague el pase a nadie.
6. **Asimetría Apple/Google ante el vencimiento, documentada y aceptada.** Google marca el pase
   vencido con `validTimeInterval`; Apple no (su `expirationDate` está fuera de alcance) y su texto
   se refresca con el push, que ocurre al operar la tarjeta. El pase de Apple de una membresía
   vencida sigue diciendo "Activa hasta el …" hasta el próximo escaneo.
7. **La barra inferior: es un INTERCAMBIO, no un ocultamiento.** Premios vivía SOLO en la barra y
   Programas SOLO en el menú, así que subir uno sin bajar el otro duplica el destino, y sacar Premios
   sin reemplazo descentra el botón de Escanear (se centra por estar en la posición 3 de 5). Un `map`
   simétrico aplicado a las dos superficies hace que media mudanza no se pueda escribir por descuido.
   Y la invariante vieja (`hrefs[Math.floor(largo/2)] === escanear`) **no atrapaba** el caso de
   cuatro destinos: se reescribió como "misma cantidad de destinos de cada lado".
8. **Membresía y cupón vencidos necesitan lo OPUESTO en el aviso de inactividad.** El cupón vencido
   se saltea (el cajero no lo va a poder canjear); el socio con la membresía vencida es justamente a
   quien hay que escribirle. Un `if (usaVigencia) saltear vencidos` —la "limpieza obvia"— silenciaría
   al único público que ese aviso debería alcanzar. El comportamiento ya era correcto; lo que faltaba
   era el comentario que impide la limpieza.
9. **El formulario antifraude NO se esconde entero en los tipos donde no aplica.** La zona horaria
   vive ahí y es el ÚNICO lugar del producto donde se puede elegir — y es la que decide a qué hora
   vence un cupón en el mostrador. Se esconden los cuatro límites; los dos que se guardan viajan como
   `<input type="hidden">`, porque el Server Action lee los seis campos y lo ausente se guarda `null`:
   sin eso, entrar a cambiar la zona horaria borraba en silencio los topes del dueño.

### Pendiente, anotado para no perderlo

- **`pedir_monto_compra` sigue ofreciéndose en cupón y membresía**, donde es una perilla muerta:
  `usar_cupon_atomico` y `renovar_membresia_atomico` no reciben el monto y el dato se descarta.
- **Una campaña disparada por el VENCIMIENTO** (avisarle al socio antes de que se le venza). Hoy el
  único aviso automático se dispara por INACTIVIDAD, y quien renovó ayer no está inactivo. Es lo que
  de verdad necesita un negocio de membresías.
- **`reporte_fm_comercios.saldo_circulante`** sigue sumando `puntos_actuales` de todos los comercios
  y todos los tipos: el defecto de la métrica del panel, a escala de plataforma.
- **QA en teléfono real**: escribir un nombre de pase, publicar, y confirmar en un iPhone y un
  Android que aparece arriba y que la fecha se lee bien.

## 2026-09-13 — Aviso antes del vencimiento, y los tres pendientes de la entrega 2

Spec: `specs/2026-09-09-aviso-antes-del-vencimiento-design.md`. Plan:
`plans/2026-09-13-aviso-vencimiento-y-pendientes.md`. **Migración 0034 APLICADA y verificada**
(`scripts/verificar-0034.ts`). **Migración 0035 (retirar `saldo_circulante`) APLICADA y verificada**
(`scripts/verificar-0035.ts`), DESPUÉS del deploy de 29c92e7 como pide una sustractiva (nota 3 de la
sección del 2026-09-09). Suite al cierre: **1302 verdes en 118 archivos**.

### Lo que entró

- **Aviso antes del vencimiento, por programa** (membresía y cupón). El dueño lo enciende en la
  tarjeta del programa, en Programas: días de anticipación y un mensaje opcional; la FECHA la agrega
  la app con la de cada cliente, y hay vista previa en vivo con la misma función que usa el cron
  (`textoAviso`). Idempotencia con `tarjetas.aviso_vencimiento_para` (una fecha, no un booleano: al
  renovar cambia `vigencia_hasta` y el aviso del período siguiente sale solo).
- **El cron `/api/cron/inactividad` pasó a llamarse `/api/cron/avisos`** y corre los dos pases:
  primero vencimiento, después inactividad. `vercel.json` sigue con dos entradas.
- **`usaMontoDeCompra`** en el catálogo: la casilla "pedir monto" deja de ofrecerse en cupón,
  membresía y prepago, donde el monto se descartaba.
- **El panel de FM deja de mostrar el saldo circulante** (sumaba sellos + centavos + visitas).
- **Defecto de dinero en la autorización del dueño, arreglado.** Autorizar una operación bloqueada
  por una perilla acreditaba 1: un paquete de 10 visitas quedaba en 1 visita, $25.00 de gift card en
  1 centavo, el cashback en 1 centavo. Ahora el escáner guarda QUÉ operación se bloqueó y
  `accionAutorizarOperacion` la repite en el servidor con el escritor forzado (`acreditadorForzado`).
  Se retiraron `accionAcreditarForzado` y `accionAcreditar`: dos Server Actions exportadas que
  aceptaban un delta crudo del navegador.
- **Las pruebas del aviso de inactividad ya no pueden avisarle a clientes reales** (ver nota 1).

### Lo que NO es obvio y hay que recordar

1. **Una prueba que llama a un RECORRIDO de toda la base, sin mocks, manda push a clientes reales.**
   `avisoInactividad.test.ts` llamaba a `procesarAvisosInactividad` con la `enviarMensajeTarjeta` de
   verdad: el día que un comercio real encendiera el aviso, cada corrida de la suite les mandaba un
   push y les marcaba la tarjeta como avisada, silenciando el aviso legítimo del cron. No pasó (se
   verificó con una consulta de solo lectura: cero comercios con el aviso encendido, cero envíos en la
   auditoría). Hacen DOS cercos, porque son dos escrituras: el doble de `enviarMensajeTarjeta` y
   `tarjetasActivasDelComercio` filtrada a los comercios de la prueba — el recorrido graba
   `aviso_inactividad_enviado_en` por su cuenta, se haya entregado o no. Un `beforeAll` aborta el
   archivo si los mocks se caen.
2. **El de inactividad saltea por `aviso_hasta` vigente, NUNCA por `aviso_vencimiento_para`.** Hay un
   solo par `aviso_texto`/`aviso_hasta` por tarjeta y `enviarMensajeTarjeta` lo pisa. Saltear por la
   marca de vencimiento parece lo mismo y es lo opuesto: la marca no se limpia hasta la renovación,
   así que silenciaría para siempre al socio con la membresía vencida. La prueba de ese socio tiene la
   marca puesta para atrapar esa refactorización. Y el ORDEN del cron importa: vencimiento primero.
3. **Los días de anticipación se cruzan contra el plazo que llega en el MISMO envío**, no contra el de
   la base: si el dueño acorta la membresía de 30 a 15 y deja el aviso en 20, es 15 contra 20.
4. **`avisoVencimiento.ts` no se puede importar desde el navegador**: arrastra Apple y `googleapis`
   por `enviarMensajeTarjeta`. Los topes, el texto y la validación viven en
   `avisoVencimientoConfiguracion.ts` (reexportados desde `avisoVencimiento.ts`); el formulario y
   `programas.ts` importan de ahí.
5. **El escritor inyectado tiene el default NORMAL a propósito.** `venderPaquete`, `cargarGiftCard` y
   `acreditarCashback` reciben `acreditar = acreditarPuntos`: un llamador que se olvide del escritor
   forzado vuelve a chocar con el tope, que es el lado seguro. Las operaciones con RPC propio (gastar
   saldo, usar visita o cupón, renovar, registrar compra) no pasan por ninguna perilla, así que
   "autorizarlas" devuelve error y no ejecuta nada.
6. **Una tarjeta de métrica sola a todo el ancho va sin la inclinación** de `.metric-carta`: el
   `rotate(0.6deg)` es del par, y a 1046px dejaba un borde 11px más alto que el otro.

### Pendiente, anotado para no perderlo

- **Sellos, en el servidor**: la cantidad de la operación principal la manda el cliente. Una petición
  manipulada podría sumar varios sellos de una vez, frenada solo por el tope por transacción. Ya
  pasaba antes; es un endurecimiento aparte.
- **`procesarAvisosInactividad` graba `aviso_inactividad_enviado_en` aunque no haya entregado nada**;
  el de vencimiento solo marca si alcanzó un canal.
- **Si `procesarAvisosVencimiento` lanza, ese día no corre el de inactividad** (la ruta no los aísla).
- **QA en teléfono real**: encender el aviso en una membresía con una tarjeta que venza dentro de la
  ventana, disparar el cron y confirmar que llega el push con la fecha bien escrita, en iPhone y
  Android. Y la del nombre del pase, que sigue pendiente.

## 2026-09-13 (tarde) — Verificación de dominio y píxel de Meta

Pedido del dueño: verificar el dominio en Meta, instalar el píxel y medir seis eventos, sin mandar a
Meta nada del panel del negocio ni de los clientes de los comercios.

### Qué quedó

- **Verificación de dominio**: `verification.other` en la `metadata` estática de `app/page.tsx`. Sale
  en el `<head>` del HTML del servidor (medido con curl, con agente de navegador y con
  `facebookexternalhit`), solo en la portada.
- **Píxel** (`app/_ui/PixelMeta.tsx`, en el layout raíz): se instala solo si la ruta lo admite.
  `lib/marketing/pixelMeta.ts` excluye `/registro`, `/mi-tarjeta`, `/comercio` (login y activar
  incluidos: la URL de activar lleva un token de un solo uso) y `/admin`. PageView a mano por cambio de
  ruta; `disablePushState`, `autoConfig` apagado y `allowDuplicatePageViews` (el porqué de cada uno,
  en `instalarPixel`).
- **Eventos**: ViewContent (sección `#precios` visible, una vez por carga), Lead (envío exitoso de la
  demo), CompleteRegistration (alta de cuenta, una vez por comercio en ese navegador), Contact (clic
  en WhatsApp, solo existe con `NEXT_PUBLIC_WHATSAPP_CARDLY`), Subscribe (servidor, ver abajo).
- **El alta dejó de terminar con `redirect()`**: devuelve `{ ok, destino }` y el formulario mide y
  navega. El panel no carga el píxel, así que el evento tiene que salir antes de entrar. Sin
  JavaScript queda un botón "Continuar".
- **Subscribe va por la API de conversiones** (`lib/marketing/conversionesMeta.ts`): no hay pasarela y
  el pago lo confirma FM al registrar un cobro `pagado`. Manda el monto en USD y el correo de los dueños
  activos de la cuenta cifrado con SHA-256; `event_id` = hash del id del cobro. `registrarCobro`
  ahora devuelve el id. Sin `META_CAPI_TOKEN`, no hace nada.

### Lo que se aprendió midiendo

1. **`fbq('consent', 'revoke')` RETIENE, no descarta**: un `track` hecho a mano en una ruta excluida
   salió al volver a la portada. La defensa real es que `dispararEvento` no llama al píxel fuera de las
   rutas que lo admiten.
2. **Por defecto el píxel ignora un PageView con la misma URL que el anterior**: la vuelta a la portada
   desde "Buscá tu tarjeta" no se contaba.
3. **En una pestaña oculta Chrome no corre los IntersectionObserver**: ViewContent no sale hasta que la
   página se ve. Probarlo con la pestaña al frente.

### Pendiente

- En el Administrador de eventos: **apagar la coincidencia avanzada automática** y "Rastrear eventos
  automáticamente sin código". El código apaga lo segundo; lo primero se configura allá, y leería los
  campos de los formularios de las páginas con píxel.
- `marcarCobroPagado` no la llama nadie; si se conecta, tiene que avisar a Meta solo en la transición a
  pagado.

## 2026-09-17 — El frente del pase como los diseños, el apellido del cliente, y tres modelos en la portada

Spec: `specs/2026-09-17-frente-del-pase-como-los-disenos-design.md`. Plan:
`plans/2026-09-17-frente-del-pase-y-apellido.md`. **Migración 0036 (`clientes.apellido`) APLICADA y
verificada** (`scripts/verificar-0036.ts`).

### Lo que entró (deploy A)

- **El frente del pase sigue el orden de los diseños de Daniel**, en Apple, en Google y en la vista
  previa del editor: el ESTADO arriba a la derecha (`VÁLIDO HASTA 16/10/2026`, `SALDO $50.00`,
  `SELLOS 7 de 10`; nada en descuento), la franja limpia, NOMBRE y APELLIDO debajo, y
  "Powered by Cardly" bajo el QR. El nombre del pase se escribe sobre la franja SOLO si es la banda
  de marca: con franja propia (que ya trae su texto) o con la grilla de sellos, no.
- **`frentePase`** cambió de contrato: `estado`, `sobreFranja`, `titular`, `listado` (se fueron
  `primario`, `secundario`, `encabezado` e `hayGrilla`), y recibe `franja: 'propia' | 'grilla' |
  'banda'` calculada por cada consumidor con lo que DE VERDAD llegó al pase.
- **El apellido se pide al registrarse** (obligatorio en el QR; opcional en el alta por teléfono del
  panel) y se ve en el escáner, Clientes (con buscador por apellido), el admin y el CSV.
- **En Google todos los tipos llevan el hero de su tarjeta** (no solo sellos), y los objetos llevan
  los módulos `nombre_pase`, `estado`, `nombre`, `apellido` y el `alternateText` del QR.
- **Portada**: membresía, gift card y descuento en la tira; el cartel quedó en "+3".

### Lo que NO es obvio y hay que recordar

1. **Google va en DOS deploys.** La plantilla de filas de la clase (Task 9) NO está publicada. La clase
   se re-sincroniza sola en cada registro, cada "Agregar a Google Wallet", cada guardado de marca,
   `admin/comercios/actions.ts`, `sucursales/actions.ts` y `campanasVencidas.ts`: publicar la
   plantilla junto con los objetos nuevos dejaría tarjetas con filas vacías. Orden: deploy A → fase
   `objetos` del script con 0 fallos de Google → deploy B (la plantilla) → fase `clases`.
2. **En un `patch` de Google, un campo omitido deja el valor VIEJO.** Por eso `textModulesData` viaja
   siempre (aunque sea `[]`) y el hero viaja en todos los tipos: si no, un nombre de pase borrado o una
   franja propia quitada se seguirían viendo en Android para siempre.
   **Y por eso `loyaltyPoints.balance` manda el otro tipo en `null`**: un objeto que nació con
   `balance.int` y al que ahora se le manda `balance.string` queda con los dos puestos, y Google
   rechaza el patch ENTERO con `400 More than one type of loyalty point balances cannot be set` —
   esa tarjeta deja de actualizar su saldo en Android, en silencio. Apareció en producción el
   2026-09-17 en un programa de sellos que nació sin meta (entero) y después la configuró (texto).
3. **Google rechaza el patch ENTERO si el `heroImage` no carga.** `componerStrips` ya no devuelve null
   cuando la franja propia no baja: cae a la grilla o a la banda, y además informa QUÉ dibujó
   (`strips.franja`), que es lo que `frentePase` necesita para volver a escribir el nombre del pase
   encima. Con un 404, esa tarjeta dejaba de actualizar el saldo en Android.
4. **La franja que sube el comercio se ENCAJA COMPLETA** en el marco (375×123) con el color de la
   tarjeta rellenando los lados: antes iban sus bytes crudos y Wallet la recortaba (M&M Inversiones
   vio su nombre partido en el iPhone). **Y el velo oscuro sobre la FOTO solo se pinta cuando la app
   escribe algo encima** (el nombre del pase, o la grilla de sellos): sin texto solo apagaba la foto.
   Ojo: la foto en modo "Llenar" la sigue recortando Wallet en el teléfono — eso se resuelve con el
   encuadre "Completa" del editor, no con código.
5. **`VERSION_COMPOSICION` en `heroUrl.ts` sube cuando cambia CÓMO se dibuja la franja.** El hash del
   `?v=` solo mira los datos, así que sin ese número Google seguiría sirviendo para siempre la imagen
   vieja que tiene cacheada. Y el nombre del pase ya entra al hash, porque ahora decide el velo.
6. **La versión del hero (`versionHeroTarjeta`) solo incluye los puntos cuando la imagen es la
   grilla.** Con franja propia o banda la imagen no cambia al operar; con los puntos en el `?v=`,
   Google volvía a bajarla en cada compra. `syncObjeto` y `linkGuardar` usan el MISMO ayudante.
7. **Un cliente existente NO recibe apellido** al registrarse en otro programa (gana el primer
   registro, como el nombre): completarlo "si está vacío" dejaría que cualquiera que conozca un
   teléfono le escriba un apellido a otra persona, visible en su tarjeta de todos los comercios.
8. **El código de barras de Apple pasó de string a objeto**, con `format`, `message`,
   `messageEncoding` y `altText` explícitos: `filterValid` descarta en silencio un código mal formado
   y el pase saldría sin QR.
9. **Los pases de Apple ya instalados cambian en su próxima operación**, sin push masivo.

### Pendiente, anotado para no perderlo

- ~~Fase `objetos`~~ **HECHA el 2026-09-17: 28 de 28, 0 fallos**, corrida tres veces (la última desde `1ced6a5`, con la franja encajada y sin velo). En el
  camino hizo falta arreglar dos cosas: el reloj de la PC estaba ~4 h atrasado (todas las llamadas
  daban `invalid_grant`, sin tocar nada en Google) y el balance del patch (nota 2).
- **Task 9 (la plantilla de filas) ya está hecha y probada en la rama `claude/plantilla-filas-google`**,
  SIN publicar. Orden: fase `objetos` con 0 fallos → QA de Daniel en Android → merge + push (deploy
  B) → fase `clases` desde ese commit.
- **QA en teléfono**: iPhone y Android, membresía con franja propia, gift card, descuento, un cliente
  sin apellido; en Android, que un ítem vacío de la plantilla no deje hueco.
- **Objeto creado solo por el JWT** (cuando `syncObjetoTarjeta` falló en `linkGuardar`): queda en
  Google con `google_object_id` null en la base, el script no lo ve y no se repara solo.
- **Google no pone separador de miles** en el estado de puntos (viaja como texto).

## 2026-09-20 — Rediseño neumórfico de la app, y la prueba de contraste que no existía

Spec: `specs/2026-09-20-rediseno-neumorfico-design.md` (la sección final, "Cambios al implementar",
PREVALECE sobre la tabla de migración). Plan: `plans/2026-09-20-rediseno-neumorfico.md`. Rama
`claude/app-neumorphism-redesign-f8c05a`, **integrada a `master` el 2026-09-20** (fast-forward, a
pedido de Daniel), con el tablero de revisión borrado en el commit previo. Sin migraciones de base.

### Lo que entró

- **La app entera (34 pantallas, no la portada) pasó a neumórfico, con el tema CLARO por defecto.**
  Lo que se levanta es del mismo color que la página y la forma sale de dos sombras; los campos se
  hunden. El oscuro pasó de carbón a azul marino (sacado del Deep del kit). El alto contraste quedó
  **plano a propósito**: las mismas clases, ahí, dibujan un borde blanco y nada de sombra. Todo el
  cambio es `app/globals.css` más seis TSX con estilos inline que pasaron a clases.
- **Una prueba de contraste WCAG que hoy no existía** (`lib/diseno/`): mide los tres temas leyendo
  el CSS con un parser único, en pares de tokens y en pares por regla (el color y el fondo de la
  regla real, sobre la superficie que de verdad la contiene). También verifica que ningún
  `box-shadow` meta en una lista un token que vale `none`, que el foco sea `outline`, que un hover
  no le pise el estado a la fila activa, que la portada revierta el foco de la app, y que la copia
  del CSS del tablero de revisión esté sincronizada. 44 pruebas nuevas, más las 7 de
  `lib/tema.test.ts` reescritas sobre el parser nuevo: 51, todas con mutación verificada.
- **Destapó dos fallos que estaban EN PRODUCCIÓN** y los arregló:
  - el botón **"Acreditar" del escáner** (el que más toca el cajero) estaba a **2.31:1** en el tema
    oscuro, el default de hoy; pasó a 6.84:1 (`--acento-fuerte` del oscuro, `#514ba8` → `#a49df0`);
  - la **pastilla "inactivo"** en alto contraste estaba a 5.97:1 sobre su fila, cuando ese tema pide
    7:1; pasó a 7.31:1 (`--error-suave`, alpha 0.22 → 0.12).
- **Tablero de revisión** en `public/tablero-neumorfico/`: todos los componentes, con marcado copiado
  de los TSX reales, en los tres temas a la vez, con interruptores "Antes/Después", "Sol" y "Grises".

### Lo que NO es obvio y hay que recordar

1. **Las pantallas de `/comercio/*` y `/admin/*` no renderizan sin `.env.local`.** El proxy de
   Next lanza ahí (`lib/supabase/proxy.ts:13`; el matcher está en `proxy.ts`). Por eso la
   verificación visual del panel se hizo sobre el tablero, que es estático, y su marcado se copió
   de los TSX en vez de inventarse. Lo que está fuera de esas rutas sí renderiza, y se recorrió en
   los tres temas: la portada `/` (el foco, con el teclado real), `/mi-tarjeta` (panel en relieve,
   campos hundidos, botón sólido; en alto contraste plano con bordes) y `/registro-comercio` (el
   plan elegido se marca con el acento en los tres). El recorrido del panel queda pendiente (abajo).
2. **El relieve comunica FORMA, nunca ESTADO.** Lo activo se marca con el acento. Verificado con un
   filtro de sol: el relieve se lava y el chip activo sigue clarísimo. **Y todo estado tiene una
   señal que no es sombra**, porque en alto contraste el relieve vale `none`: un hover que solo
   "sube" ahí no se ve (apareció tres veces en las revisiones).
3. **Un token compuesto de relieve va SOLO en su `box-shadow`.** `none, x` invalida la declaración
   entera y la sombra desaparece justo en alto contraste. Lo vigila una prueba.
4. **Los portales de las hojas NO se sacan**, aunque el header ya no sea vidrio: es `sticky` con
   `z-index: 40` y crea un contexto de apilamiento; sin portal, la barra inferior le pasa por encima
   a la hoja y tapa "Cerrar sesión".
5. **El tablero está en `public/`, o sea que integrado a `master` se serviría en producción.** Se
   borra en el commit previo a integrar. Mientras exista, una prueba exige que
   `propuesta.css` sea idéntica a `globals.css`.
6. **Colores de tokens de tema en hex o `rgba()`, no en `oklch()`** (se cambió la regla de
   `DESIGN.md`): la prueba de contraste no puede imitar el mapeo de gamut del navegador.
7. **El cambio de default llega de golpe a quien nunca eligió tema** (casi todos los cajeros): pasan
   del oscuro al claro sin aviso.
8. **La regla global de foco de la app alcanza también a la portada**, que antes usaba el anillo del
   navegador. Con el violeta del tema sobre sus bandas de color fijo quedaba en 2.31:1 y hasta
   1.00:1 (el foco de "Agendá tu demo" desaparecía en oscuro). `inicio.module.css` la revierte con
   `outline: revert`, y una prueba ata su lista de elementos a la de `globals.css`: si agregás un
   elemento a la regla global, la prueba te pide sumarlo en la portada.
9. **Un `.X:hover` le gana a un `.X-activa`** (0,2,0 contra 0,1,0) y le borra la señal de activo.
   Pasó dos veces; se escribe `.X:not(.X-activa):hover`, y lo vigila una prueba.

**Verificación al cierre:** pruebas de diseño 51/51, `eslint` y `tsc --noEmit` limpios, y
`npx next build` pasa con `/` y `/mi-tarjeta` todavía estáticas (la regla nueva de la portada
llega intacta al CSS de producción). En este worktree el build necesita
`NODE_OPTIONS=--max-old-space-size=6144`: con el heap por defecto se queda sin memoria en el paso de
TypeScript, porque Next toma como raíz el checkout principal (hay dos lockfiles).

### Revisión final del conjunto

Cero problemas críticos. Se verificó cada hallazgo contra el código antes de corregirlo, y todos se
confirmaron. Corregido: el foco de la portada (arriba); el hover de "Reportes" en el menú, que le
borraba el borde de acento a la fila activa; `.contexto-pastilla` sin estilo deshabilitado; el activo
de "Escanear", que era un anillo de 1.18:1 y pasó a un aro de `outline` de 5.81:1 (**es un cambio
visible en el botón más tocado: miralo**); el radio de las cuentas del portal (12 → 16px, como la
spec); filas de botones levantados de 8-10px a 12px de separación; comentarios y documentos que
decían cosas falsas; y el plan, que había quedado distinto del CSS publicado en tres bloques.

**Deuda que ya estaba antes de esta rama** (no se tocó; queda anotada):
- La **alerta de error del formulario de demo de la portada** mide **2.33:1** en claro y 2.39:1 en
  oscuro (pide 4.5). Igual antes y después del rediseño: lo único que cambia es cuál tema ve primero
  un visitante nuevo. Es texto `--error` del tema sobre la banda violeta fija del cierre.
- El **velo del escáner** (`.escaner-guia`, `box-shadow: 0 0 0 200vmax …`) no se ve nunca: la
  animación `qr-pulso` anima `box-shadow` y lo pisa durante todo el ciclo.
- La clase **`.subtitle`** se usa en siete TSX (títulos `<h2>` de formularios del comercio y del
  admin) y no existe en ningún CSS: esos títulos salen con el estilo del navegador.
- `--shadow-card` (alias sin consumidores) y las reglas `.sello*`, que ninguna pantalla pinta: la
  vista previa del editor de marca dibuja sus sellos con estilos inline.

### Pendiente de Daniel, después de publicar

1. **Correr la suite completa en el checkout principal** (`git pull` y `npm test`, que ahí tiene
   `.env.local`). En la sesión corrieron solo las pruebas de diseño (51/51), con una config aparte
   sin Supabase. Se revisó que ninguna otra prueba importe lo que cambió salvo
   `programas/actions.test.ts`, que dibuja `FormularioConfiguracionPrograma`: ahí solo cambió el
   estilo del contenedor de la vista previa, y la prueba mira nombres, valores y texto.
2. **Decisiones de diseño abiertas** (se ajustan con un token, sin tocar pantallas): el fondo
   lavanda y el azul marino; la intensidad del relieve; las métricas neutras; el borde visible de
   `.btn-borde` en claro y oscuro; en alto contraste, que "fila con foco" y "fila activa" se
   parecen; el aro del activo de "Escanear". El tablero de revisión se borró al integrar, pero vive
   en la historia (commit `a0cc9e1`, `public/tablero-neumorfico/`) si hace falta volver a verlo.
3. **Recorrer las pantallas reales** en los tres temas, a ancho de teléfono: sobre todo
   `/comercio/panel`, `/comercio/escanear`, `/comercio/clientes`, `/registro/<slug>` y
   `/admin/comercios` (`/mi-tarjeta` y `/registro-comercio` ya se recorrieron sin `.env.local`; con
   él, vale mirar `/mi-tarjeta` con un teléfono que tenga tarjetas, que es el portal con cuentas). Y `/` **con el teclado** (Tab): el foco tiene que ser el anillo del
   navegador, visible sobre todas las bandas. De la portada solo cambió esa regla; de su formulario
   de demo siguen al tema la alerta, la tilde de éxito y el anillo de los campos.
4. **Teléfono real a pleno sol**, con el escáner y la cámara.
5. **Avisar a los comercios piloto**: los cajeros que nunca eligieron tema pasan del oscuro al
   claro de golpe. Si alguno lo pide, el oscuro y el alto contraste están a un toque en el menú.

## 2026-09-21 — Pasarela de pagos con Wompi (en la rama `claude/pasarela-wompi`, SIN desplegar)

Spec: `docs/superpowers/specs/2026-09-21-pasarela-wompi-design.md` (v2). Registro por tarea, con commits y
lo que falta correr: `docs/superpowers/plans/2026-09-21-pasarela-wompi.md`. **Nada de esto está en master ni
en producción**, y no debe desplegarse hasta aplicar la migración `0037`.

### Lo que entró

- **El dueño paga con un botón** en `/comercio/plan`: cada intento es un `cobros` con `metodo = 'Wompi'` y
  un enlace de pago de Wompi (vigente 2 horas; se reusa mientras dure). El plan cambia **solo cuando el pago
  se confirma**, nunca al pedirlo. Suscripciones recurrentes de Wompi: descartadas (un cobro por mes).
- **Prorrateo** al subir de plan a mitad de período (centavos enteros), precio completo al renovar (ventana
  de los últimos 7 días) y al activar. Las fases son disjuntas. Una sola tabla (`opcionesPago.ts`) alimenta
  la pantalla y la acción.
- **Webhook firmado** (`/api/wompi/webhook`) y **página de vuelta** del dueño: los dos terminan en
  `confirmarPagoCobro`, así que un pago no depende de que llegue el webhook.
- **`/admin/pagos`**: cada transacción con lo que el sistema hizo con ella, filtro "Necesitan atención"
  (con contador en la nav), y las salidas: reintentar, aplicar a mano, marcar revisado. En la ficha de la
  cuenta: "Marcar pagado" para un cobro pendiente de la app, insignias de ajuste/plan y la línea de
  vencimiento del período.
- Se borró `accionSubirPlan` (subir de plan gratis) y `subirPlanPorElDueno`.

### Lo que NO es obvio y hay que recordar

1. **Primero el servicio, después el pago.** `confirmarPagoCobro` aplica el plan y la licencia (idempotente)
   ANTES de reclamar el cobro. Al revés, un fallo entre las dos cosas dejaría un cliente que pagó sin plan y
   un cobro "pagado" que ya no se puede reprocesar. Un reintento de la misma transacción se distingue de un
   doble pago por `cobros.wompi_id_transaccion`.
2. **La firma se calcula sobre los BYTES** del cuerpo (`request.arrayBuffer()`), no sobre un JSON
   re-serializado ni sobre `text()` (que descarta un BOM). El header se llama `wompi_hash`, **con guion
   bajo**, y algunos proxies descartan esos headers: si falta, la ruta deja en el log los NOMBRES de los
   headers recibidos (nunca los valores). Es lo que responde si Vercel lo entrega.
3. **Un pago de prueba no aplica nada en producción.** La guarda es una lista de permitidos: se aceptan
   pruebas solo con `WOMPI_ACEPTAR_PRUEBAS=1` **y** `VERCEL_ENV` ausente o `development`. Una guarda inversa
   (`!== 'production'`) habría aceptado pruebas en los Preview, que comparten la base real.
4. **Un cuerpo firmado que no se reconoce no se pierde**: se guarda con id `sin-id-<huella>` y conciliación
   `error`, y se responde 200 (un reintento infinito no arregla un parser). "Reintentar" re-lee el CUERPO
   guardado; si ahora trae un id de transacción, nace un evento nuevo y el viejo queda revisado con nota.
5. **Dos índices únicos parciales hacen el trabajo sucio**: un solo intento pendiente de la app por cuenta, y
   una transacción paga a lo sumo un cobro. La ruta clasifica el error 23505 en vez de lanzarlo: lanzarlo
   haría que Wompi reintentara para siempre algo que reintentar no arregla.
6. **`confirmarPagoCobro` valida el UUID del identificador antes de tocar la base.** Un enlace hecho a mano
   en el panel de Wompi trae otro identificador, y un no-UUID en una consulta da un error de sintaxis de
   Postgres que se leería como falla interna.
7. **Las acciones de FM revalidan el estado en el servidor** (`accionesDisponibles`): el botón de la
   pantalla puede estar viejo. Los tres botones de un pago comparten UNA acción con `name="accion"`; con
   tres estados separados, un error viejo taparía el resultado nuevo.
8. **El repositorio falso es un espejo, y un espejo que nada obliga a sincronizar vuelve decorativa la
   suite** (la misma lección que el fixture de `entornoComercio`). Su semántica tiene que ser la del
   adaptador de Supabase; `repositorioPagosSupabase.test.ts` corre los mismos casos contra la base, **pero
   esas pruebas todavía no se han ejecutado** (falta `.env.local` y la migración).
9. **Lo que sale de `pagos_wompi.payload` es dato hostil** y trae nombre y correo del pagador: solo se
   muestra en `/admin/pagos`, plegado, y `aJson` lo normaliza antes de guardarlo.
10. **La nav de `/admin` cuenta los pagos por revisar en el layout**: `contarPagosAtencion` devuelve `null`
    (y la nav no muestra número) si la consulta falla o si la migración no está aplicada, en vez de romper
    todo el panel o mostrar un cero falso.
11. **Hueco que ya existía y NO se arregló**: el alta pública (`altaAutoservicio`) le da a la cuenta el
    cupo de su plan sin cobrar, y `licencia_estado` no gatea nada. La pasarela cobra, pero no hace cumplir
    el pago: un período vencido solo se muestra. Es una decisión de producto (pregunta abierta 1 de la spec).

12. **Un validador compartido por dos llamadores con necesidades opuestas.** El método «Wompi» se reservó
    para el registro manual de cobros pendientes, y el primer intento puso la regla en el validador que
    también usa `crearCobroPendiente` (el cobro de la propia app, que es justo `pendiente` + `Wompi`):
    habría rechazado TODOS los pagos. Lo atrapó `tsc` (vitest no chequea tipos, y ninguna prueba pura llama a
    `crearCobroPendiente`). La regla vive en `validarCobroManual`, y una prueba fija que el cobro de la app
    SIGUE validando. Es el mismo aprendizaje de "un reemplazo en todos los sitios asume que todos hacen lo
    mismo".
13. **Un redirect no puede registrar un evento terminal.** `prueba` y `no_aprobada` no se reprocesan; si la
    página de vuelta los dejaba guardados, el webhook FIRMADO de la misma transacción llegaba como
    "repetido" y el cobro quedaba pendiente con la plata cobrada, sin que nadie lo viera.
14. **Renovar el mismo plan no toca el límite**, así que no puede bloquearse por cupo: comparar contra el
    límite sugerido le prohibía pagar a una cuenta con un límite negociado mayor o a una Pro "sin tope".

### Revisión final

Dos revisores independientes; cada hallazgo se verificó contra el código y se corrigió con su prueba y su
mutación. Lo corregido y lo que se dejó (con su porqué) está en
`docs/superpowers/plans/2026-09-21-pasarela-wompi.md`, sección "Revisión final".

### Verificación

`tsc --noEmit` y `eslint` limpios; **282 pruebas puras** en verde con `TZ=UTC` y con
`TZ=America/El_Salvador`; `next build` pasa; todas las mutaciones de los módulos puros medidas y muertas por
la prueba correcta (tablas en los encabezados de cada `.test.ts`). Las 5 pruebas con base de datos de la feature SÍ se corrieron (92 de 92, más 30 mutaciones). **No se han visto**
las pantallas en el navegador.

### Pendiente de Daniel, en este orden

1. ~~Aplicar `0037_pagos_wompi.sql` en Studio~~ **HECHO** (2026-09-21): `scripts/verificar-0037.ts` dio 15 de
   15 OK (columnas, índices únicos parciales y checks).
2. ~~Correr las pruebas con base de datos~~ **HECHO** (2026-09-21): las 5 de la feature, 92 de 92 en verde, y 30
   mutaciones a la capa de base (28 muertas por la prueba correcta, 1 cubierta en otro archivo, 1 hueco
   cerrado). Falta solo `npm test` COMPLETO en el checkout principal cuando la rama esté ahí, por si algo
   ajeno a la feature se movió.
3. `WOMPI_CLIENT_ID` y `WOMPI_CLIENT_SECRET`: ya están en el `.env.local` del checkout principal; **faltan en
   Vercel**. **Regenerar el API Secret** antes de producción (se vio en una captura y en el chat).
4. Correr `scripts/probar-wompi.ts` y pasar lo que imprime: responde si las credenciales del negocio alcanzan
   para crear enlaces (el "punto 0"). **RESUELTO el 2026-09-21**: sí alcanzan, en modo prueba (negocio
   `Cardly SV`, no productivo); se creó un enlace de prueba de $1. Las credenciales quedaron en el
   `.env.local` del checkout principal; falta ponerlas en Vercel.
5. Con tu permiso, desplegar (migración primero) y **después** poner la URL del webhook en el panel de
   Wompi: `https://www.cardly-sv.site/api/wompi/webhook`.
6. Mirar `/comercio/plan`, `/comercio/plan/pago/resultado`, `/admin/pagos` y la ficha de una cuenta a ancho
   de teléfono, y hacer la primera prueba real.
7. Contestar las preguntas abiertas de la spec (qué pasa al vencer un período, downgrade, Meta en ajustes,
   si el negocio de Wompi es solo de Cardly).

### Fase 2, anotada

App instalable (PWA) para el dueño y avisos al celular (Web Push, VAPID): pago pendiente y pago próximo,
derivados de las fechas de los períodos y enviados desde el cron que ya existe (Vercel Hobby permite dos).
Necesita su propia spec.

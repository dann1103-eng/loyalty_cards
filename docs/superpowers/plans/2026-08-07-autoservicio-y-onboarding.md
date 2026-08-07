# Autoservicio, tutorial y simplificación — plan de trabajo por iteraciones

> Nace del pedido del 2026-08-07: que un comercio se dé de alta solo desde el sitio, elija plan,
> pague, caiga en su portal y aprenda a usarlo sin que nadie le explique. Más una segunda misión
> aparte: puntos para pedidos a domicilio. Este documento es el estado del programa — se actualiza
> en cada iteración del loop implementar → auditar.

## AUDITORÍA (2026-08-07) — cuánto autoservicio hay hoy: cero

Verificado leyendo el código, no supuesto:

1. **`app/page.tsx` (cardly-sv.site) no da de alta a nadie.** Su formulario (`_inicio/FormularioDemo`)
   escribe en la tabla `prospectos` (0014) y ahí muere. El propio archivo lo dice en su comentario de
   cabecera: *"todo botón apunta al formulario real de #demo (no a un alta instantánea que no
   existe)"*.
2. **FM crea la cuenta y el comercio a mano** desde `/admin/cuentas/nuevo` y `/admin/comercios/nuevo`
   (`crearCuenta`, `crearComercio`).
3. **El dueño entra por invitación**, no por registro: FM le manda un link por WhatsApp →
   `/comercio/activar` → define su clave. El token es de un solo uso.
4. **El plan se pide, no se compra**: `/comercio/plan` crea una fila en `solicitudes` (0017) y FM la
   aprueba o rechaza en `/admin/solicitudes`.
5. **Los cobros los registra FM a mano** (`registrarCobro`, `marcarCobroPagado`). **No hay ninguna
   pasarela de pago en el repo.** El comprobante aclara en el propio documento que no es factura
   fiscal.

O sea: entre "conozco Cardly" y "estoy usando mi panel" hay hoy cuatro pasos manuales de FM.

## LA DECISIÓN QUE DESBLOQUEA TODO: separar alta de cobro

El pago online tiene dos trabas, y la segunda es más grande que la que preguntó el usuario:

- **Stripe pide que el NEGOCIO esté en un país soportado**, con entidad legal y tax ID de ese país —
  no alcanza con una cuenta bancaria estadounidense. Ugly Cash da una cuenta, no una entidad. **Hay
  que confirmarlo con el proveedor antes de construir nada sobre eso.**
- **Y aparte, sin personería jurídica no hay DTE** — lo dice el propio `lib/comercios/cobros.ts`, y
  es la misma razón por la que N1co está en espera. Cobrar suscripciones recurrentes depende de esa
  entidad, no del procesador que se elija.

**Por eso el alta y el cobro se construyen separados.** El alta self-service, el tutorial y la
simplificación NO dependen de la pasarela: el paso de pago arranca siendo el mismo que hoy hace FM
(transferencia / pago manual), pero **auto-servido**, y se cambia por una pasarela cuando exista la
entidad. Eso desbloquea hoy la mayor parte del pedido en vez de dejarlo todo esperando un trámite.

## SUPUESTOS QUE TOMÉ (corregime si alguno está mal)

1. **El alta vive en ESTE repo**, colgando de `app/page.tsx` (cardly-sv.site ya le habla a dueños de
   comercio). El sitio de marketing con el catálogo de precios es otro proyecto y no lo tengo acá.
2. **Una cuenta nacida self-service NO recibe acceso ilimitado gratis para siempre**, pero tampoco
   se le pone un candado nuevo a los comercios que ya existen: nace marcada como prueba y el gate
   real se define junto con el cobro. Hoy `licencia_estado` no gatea ningún flujo del panel comercio
   — tocar eso sin cuidado deja afuera a clientes reales.
3. **El tutorial es dentro del producto**, no un PDF: pasos que se marcan solos cuando la acción ya
   está hecha.

## ITERACIONES

- **A — Alta self-service. ✅ HECHA.** Ver abajo.
- **B — Tutorial guiado en el panel. ✅ HECHA.** Ver abajo.
- **C — Simplificación de interfaces** (la vara: una persona de 50 años, sin ayuda). ✅ HECHA — las
  cinco pantallas (reglas, recompensas, sucursales, escáner y marca). Ver abajo.
- **D — Puntos por delivery.** Spec escrito: `specs/2026-08-07-puntos-por-delivery-design.md`.
  Resultado del diseño: **son DOS features, no una**, y la barata cubre la mayoría de los pedidos.
  Ver el resumen abajo.
- **Continuo:** cacería de bugs en los tipos de tarjeta (lo de la sesión anterior sigue vivo).

### A — Alta self-service (hecha)

`crearCuentaAutoservicio` (`lib/comercios/altaAutoservicio.ts`) arma en una operación: cuenta →
comercio → sucursal principal → programa principal → membresía owner → cuenta de Auth. Reusa
`crearCuenta`, `crearComercio` y el mismo `EMAIL_RE` de cajeros, así que un negocio nacido
self-service es indistinguible de uno dado de alta por FM.

Pantalla en `/registro-comercio` (pública: el matcher del proxy solo cubre `/admin` y `/comercio`).
La portada dejó de mandar todo a `#demo`: cabecera y hero van al alta, y **cada plan de la tabla de
precios entra con SU plan ya elegido** (`?plan=<id>`). `#demo` queda como segunda opción.

Lo que NO es obvio:

- **La cuenta de Auth se crea PRIMERA**, aunque sea la más incómoda de compensar. El rechazo más
  probable es "ese correo ya existe", y descubrirlo después de crear cuenta y comercio deja el peor
  residuo del sistema: un comercio sin membresía, invisible para su dueño, comiéndose un cupo del
  plan y reteniendo el slug. **Medido con una mutación: con la verificación tardía queda un comercio
  de más en la base real (38 vs 37).**
- **La cuenta nace `licencia_estado: 'inactivo'`** — es la verdad (no pagó) y es seguro, porque ese
  campo no gatea ningún flujo del panel del comercio. FM ve en `/admin/cuentas` a quién cobrar.
- **Un `?plan=` inventado cae a `starter`**, no deja los radios sin marcar. Sin ese guard, el
  formulario se ve completo y el alta falla con "elegí un plan". Verificado en el navegador.

### B — Tutorial guiado (hecha)

`primerosPasos` (`lib/comercio/primerosPasos.ts`) + `PrimerosPasos.tsx` en el panel. Cuatro pasos —
logo, reglas, primer premio, primer cliente — que **se marcan solos** desde el estado real.

**Por qué se deriva y no se guarda en una columna `tutorial_paso`:** una casilla guardada miente en
cuanto el dueño deshace algo (desactiva su único premio y el tutorial lo sigue felicitando), y
obliga a acordarse de marcarla desde cada pantalla que la afecta — el mismo acoplamiento que hizo
que `sello_meta` se leyera de una tabla y se escribiera en otra. Hay una prueba de que desactivar la
recompensa devuelve el paso a pendiente.

Va ARRIBA de las métricas y solo mientras falte algo: un negocio recién dado de alta tiene todo en
cero, y dos tarjetas grandes diciendo "0 clientes" no le dicen qué hacer. Solo lo ve el DUEÑO — el
cajero no puede completar ninguno de los cuatro pasos.

**Verificado en el navegador de punta a punta**, no solo con pruebas: alta desde la portada → sesión
iniciada → panel con "0 de 4" → se carga un premio → recarga → "1 de 4", el paso hecho con su tilde,
sin ser enlace, y la línea guía apuntando al siguiente. Las cuentas de prueba se borraron de la base
real (cero huérfanos).

### C — Simplificación de interfaces (primera tanda)

La auditoría se hizo **en el navegador**, dando de alta una cuenta por el flujo nuevo y recorriendo
las pantallas como un dueño que las ve por primera vez. El hallazgo que unió todo no era de
redacción sino un BUG: varias pantallas decían **"puntos"** aunque el programa fuera de sellos.

Y peor: `lib/apple/construirReverso.ts` tenía su propio `unidad()` con el mismo defecto
(`tipo === 'sellos' ? 'sellos' : 'puntos'`), así que **un cliente con gift card leía "Ganás 1 punto
por cada visita" en el reverso de su propia tarjeta**, y uno de prepago veía sus visitas descritas
como puntos. Es el mismo defecto que `formatearSaldo`: una función cuya firma no podía expresar el
caso, escrita dos veces.

Se creó `lib/tarjetas/unidadPrograma.ts`, que **deriva la palabra del campo `contador` del catálogo**
(`tipos.ts`) en vez de tener una lista propia. Devuelve `null` donde no hay unidad que nombrar —
dinero (se formatea con `formatearCentavos`) o sin contador (no hay nada que contar) — y ese null
obliga al llamador a resolverlo bien en vez de recibir una palabra inventada. Hay una prueba que
recorre `TIPOS` y falla si un tipo nuevo se cuela sin decidir cómo se llama su unidad: así nació
este bug.

Lo que cambió para el dueño:

- **Reglas**: "Valor (puntos por visita, o puntos por cada $1 de compra)" metía los dos significados
  en un solo texto porque el campo es compartido. Ahora la etiqueta cambia con el tipo elegido y usa
  la palabra de SU programa: *"¿Cuántos sellos por cada $1 de compra?"*. Verificado en el navegador
  que el cambio del `<select>` la actualiza de verdad.
- **Reglas** además leía el tipo de `comercios.tipo_tarjeta` (columna legada): un comercio al que FM
  le cambió el tipo sin propagarlo veía el formulario antifraude equivocado. Ahora sale del programa
  principal.
- **Reglas** ya no muestra el formulario en los tipos donde estas reglas no aplican (gift card,
  cashback, cupón, membresía, descuento): antes se cargaba algo que después nadie leía.
- **Recompensas**: "Costo en puntos" → *"¿Cuántos sellos cuesta?"*, y la lista deja de decir "puntos".

- **Sucursales**: a una cuenta Starter recién creada, lo PRIMERO que le aparecía era "Alcanzaste el
  límite de tu plan… escribinos a soporte". Arrancaba con un reproche y una dirección de correo en
  vez de un camino. Ahora se dice en positivo y con botón a `/comercio/plan`, que ya existe.
- **Escáner** (lo que lee el CAJERO en el mostrador): con prepago decía "Corregir: quitar puntos"
  cuando estaba quitando una VISITA; con gift card mostraba el premio a "250 puntos" cuando cuesta
  $2.50, y "le faltan 150" en vez de "$1.50". El payload del servidor dejó de mandar el booleano
  `esSellos` —que era la causa: obligaba a repetir la decisión en cada texto— y manda la unidad.
- **Marca**: el botón "Usar un borrador sugerido" escribe términos que van TAL CUAL a la tarjeta de
  cada cliente, y tenía el mismo `esSellos ? 'sellos' : 'puntos'` adentro. A un comercio de gift card
  le proponía escribir *"Los puntos no tienen valor monetario"* —falso, el saldo ES el producto— y a
  uno de cupón *"no vencen"*, cuando vence por diseño. Ahora vive en
  `lib/comercio/borradorTerminos.ts`, con las dos primeras líneas por tipo y una prueba que recorre
  los ocho verificando que **nunca se promete algo que el tipo no puede cumplir**.

**Dos cosas que conviene recordar de esta fase:**

1. **El artículo gramatical viaja CON la palabra.** Se había resuelto con un regex sobre el texto ya
   armado (`replace(/^Los (visitas)/, 'Las $1')`) — conocimiento disperso que el próximo llamador
   repite o se olvida. Ahora `Unidad` lleva su `articulo`, así que la unidad novena que se agregue
   no puede producir "Los visitas" en la tarjeta de un cliente.
2. **Una mutación que "sobrevive" primero hay que confirmarla en el ARCHIVO.** Una de las de esta
   tanda pasó en verde y era mentira: el escapado del shell hizo que el reemplazo nunca se aplicara.
   Rehecha verificando el contenido con `grep` antes de correr, mató su prueba. Una mutación que no
   se aplicó se lee EXACTAMENTE igual que una prueba floja, y lleva a la conclusión opuesta.

## D — Puntos por delivery: lo que resolvió el diseño

> Detalle completo en `specs/2026-08-07-puntos-por-delivery-design.md`. Acá va solo la conclusión.

**El hueco real, verificado en el código:** `registrarCliente` tiene UN solo llamador,
`app/api/registro/route.ts`. O sea que **un comercio no puede darle una tarjeta a alguien que no está
parado enfrente**. A quien ya la tiene sí puede acreditarle; al cliente nuevo de delivery, no.

**La pregunta que ordena todo: ¿el comercio sabe quién compró?** Las tres opciones que se venían
barajando mezclaban dos problemas distintos, y separarlos muestra que el QR solo hace falta en uno:

- Pedido por llamada, WhatsApp, app propia, o app de delivery que comparte el número → **sabe el
  teléfono**. Alcanza una pantalla de alta + acreditación por teléfono. **Sin migración.**
- App de delivery que NO comparte el número → **el cliente es anónimo**. Recién ahí hace falta un
  código al portador.

**Y el correo no reemplaza al QR** por la misma razón que hace difícil el caso: si no sabe quién
compró, tampoco sabe a qué correo mandarlo.

**El hallazgo bloqueante sigue en pie y determina el esquema de v2:** un QR con un punto ya asignado
es dinero al portador. Un solo uso garantizado por el `where usado_en is null` del propio UPDATE (no
por un `if` previo), vencimiento en horas, código impredecible, y la acreditación por
`acreditarPuntos` para heredar los topes antifraude. Lo que el diseño NO puede evitar —que lo
reclame la persona equivocada— hay que decírselo al dueño en la pantalla donde los genera.

### Un hallazgo que salió de verificar el diseño antes de construirlo

`/api/tarjetas/<id>/pass.pkpass` responde **404 sin `apple_serial_number`**, y ese init vivía en
`app/api/registro/route.ts` — el único llamador de `registrarCliente`. Mientras hubo un solo camino
de alta no se notó; el camino nuevo del panel habría emitido **tarjetas imposibles de instalar**, y
el dueño no habría tenido cómo diagnosticarlo. Se mudó DENTRO de `registrarCliente`, con su prueba y
su mutación. Es el tercer caso del mismo patrón en estas sesiones —después de `sello_meta` y de la
vigencia del cupón—: **un paso imprescindible que vive en quien llama en vez de en lo llamado**.

## Apéndice: las tres opciones tal como se plantearon

El pedido: que el cliente que compra por domicilio acumule su punto sin que el comercio tenga que
hacerlo a mano. Las opciones y lo que cada una cuesta de verdad:

1. **QR impreso en el ticket del POS.** Es lo más limpio para el cliente, pero exige integrarse con
   el POS de CADA comercio — y en El Salvador eso es un universo fragmentado. No escala como primera
   versión.
2. **QR desde impresora térmica aparte** (o la misma, por una segunda impresión). Evita la
   integración, pero le agrega un paso manual al comercio, que es justo lo que se quería quitar.
3. **Alta por teléfono en el momento de la llamada.** Ya funciona hoy con lo construido: el cajero
   busca por teléfono en `/comercio/clientes` y acredita. **Costo de implementación: cero.**

**El punto que hay que resolver antes de elegir:** un QR con un punto ya asignado es un **portador**
— quien lo escanea se lo lleva, y si se fotografía o reenvía, se lo llevan varios. Cualquier versión
necesita que el punto sea de UN SOLO USO y con vencimiento corto, igual que el cupón (`usado_en`,
`vigencia_hasta`), o se convierte en un agujero de fraude peor que el que resolvió la Tanda 1.

Recomendación para cuando toque: empezar por un **"punto al portador" genérico** (un código de un
solo uso que el comercio imprime como quiera, sin integrarse con nadie), medir si algún cliente
realmente lo usa, y recién entonces evaluar la integración con POS. La opción 3 ya cubre el caso hoy
para quien atiende por llamada.

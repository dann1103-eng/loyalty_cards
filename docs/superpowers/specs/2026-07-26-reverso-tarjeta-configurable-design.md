# Reverso configurable de la tarjeta — diseño

**Fecha:** 2026-07-26
**Estado:** aprobado por el usuario (decisiones §12). Revisado por subagente y corregido.

## 1. Problema

El pass de Apple **hoy no tiene reverso**: `lib/apple/generatePass.ts` no arma ningún `backFields`, así
que el cliente que toca la "i" de su tarjeta no encuentra nada. No sabe cómo gana puntos, qué puede
canjear, cuáles son los términos, ni cómo contactar al comercio.

El usuario lo pidió tras ver la tarjeta de un competidor (Devotio Rewards), cuyo reverso muestra:
términos de uso numerados, links a Instagram y Facebook, el nombre de la empresa y los datos del
emisor de la plataforma. Estaba encolado en `docs/superpowers/ESTADO-Y-PLAN-2026-07-25.md:63`.

## 2. Objetivo

Que cada comercio pueda configurar qué dice el reverso de sus tarjetas, combinando tres capas:

1. Lo que **el sistema ya sabe** (regla de puntos y catálogo de recompensas), armado solo.
2. Lo que **el dueño escribe** (términos de uso) y **aporta** (sus redes sociales).
3. El **pie de Cardly SV**, igual en todos los comercios.

## 3. Qué ve el cliente, en orden

| # | `key` | Etiqueta | Origen |
|---|-------|----------|--------|
| 1 | `como_funciona` | `Cómo funciona` | Sistema (§4). Se omite si el dueño la apaga o si no hay nada que decir. |
| 2 | `terminos` | `Términos de uso` | Texto libre del dueño. Se omite si está vacío. |
| 3 | `instagram` | `Instagram` | Dueño. Link tocable. Se omite si está vacío. |
| 4 | `facebook` | `Facebook` | Dueño. Link tocable. Se omite si está vacío. |
| 5 | `whatsapp` | `WhatsApp` | Dueño. Link tocable. Se omite si está vacío. |
| 6 | `sitio` | `Sitio web` | Dueño. Link tocable. Se omite si está vacío. |
| 7 | `empresa` | `Nombre de empresa` | `comercios.nombre`. **Siempre.** |
| 8 | `emisor` | `Información del emisor` | Constante de Cardly SV. **Siempre.** |

**Toda sección vacía se omite por completo** — nunca un campo con la etiqueta y el valor en blanco, ni
la palabra "null".

Un **comercio recién creado**, sin reglas ni recompensas ni nada configurado, obtiene un reverso con
**exactamente dos campos: 7 y 8**. La sección 1 no aparece, porque sin reglas ni recompensas no tiene
nada que decir (§4) y un encabezado "Cómo funciona" seguido de nada es peor que su ausencia.
Verificado que ese estado es real: ni `reglas_puntos` ni `recompensas` reciben filas por defecto
(`supabase/migrations/0001_esquema_inicial.sql:50-69`) y `crearComercio` no inserta ninguna.

### Cómo se arma cada campo — `value` es OBLIGATORIO

⚠️ **Trampa verificada en la librería instalada.** `value` es `.required()` en el esquema Joi
(`node_modules/passkit-generator/lib/cjs/schemas/PassFieldContent.js:14`), y `FieldsArray` **atrapa el
error de validación y solo hace `console.warn`, descartando el campo**
(`node_modules/passkit-generator/lib/cjs/FieldsArray.js:45-70`). Un campo armado solo con
`attributedValue` **no aparece en el pass y no falla nada**: se pierde en silencio y nadie se entera
hasta que un cliente reporta que no ve sus redes.

Por lo tanto, **todos los campos llevan `value`**, sin excepción.

**Campos de redes (3-6):**
- `label`: el nombre de la red (`Instagram`, `Facebook`, `WhatsApp`, `Sitio web`).
- `value`: la URL en texto plano. Es lo que el cliente ve si por lo que sea el link no se renderiza —
  degradación legible, no un campo mudo.
- `attributedValue`: `<a href="{URL escapada}">{nombre de la red}</a>`. Apple prioriza este sobre
  `value` y lo muestra como link azul tocable, igual que en la referencia.

**Campo del emisor (8):** un solo campo, con `value` **multilínea** (`\n`) y sin `attributedValue`:

```
Cardly SV
soporte@cardly-sv.site
www.cardly-sv.site
```

Va por `value` y no por `attributedValue` porque `attributedValue` de Apple **solo admite `<a>`** — no
`<br>` ni marcado de bloque — así que no hay forma de apilar tres líneas ahí. Se le agrega
`dataDetectorTypes: ['PKDataDetectorTypeLink']` para que iOS convierta el correo y el sitio en
tocables por su cuenta. Si el detector no dispara, el texto igual se lee y se copia: degradación
aceptable.

El dominio va **con `www`**: `https://www.cardly-sv.site`. El dominio raíz redirige, y esa redirección
ya rompió el registro de passes en producción el 2026-07-26
(`docs/guia-pruebas-manuales-cuentas-sucursales.md:687-691`). Escribir la URL sin `www` acá sería
sembrar el mismo bug en la tarjeta de cada cliente.

Los datos de Cardly viven como constante en código (`lib/apple/emisorCardly.ts`), no en la base: son
nuestros, idénticos para todos los comercios, y ponerlos en `comercios` invitaría a que un comercio
los edite.

## 4. La sección automática ("Cómo funciona")

Se arma **en cada generación del pass**, leyendo la base. Nunca se congela una copia. Si el dueño sube
una recompensa de 5 a 8 puntos, el reverso de las tarjetas ya emitidas se corrige — pero eso **exige
un aviso push**, ver §5.

### De dónde sale cada parte — y qué tan cierta es

**Cómo se ganan puntos** — de `reglas_puntos`.

⚠️ **Estas reglas son DECLARATIVAS: el sistema no las aplica.** Verificado en
`lib/comercio/acreditar.ts:63-80` — el cajero digita a mano la cantidad (`delta`) y el RPC
`acreditar_puntos_atomico` la suma tal cual; `reglas_puntos` solo se lee para listarla en el panel
(`app/comercio/(protegido)/reglas/page.tsx:16`). Esta parte del reverso comunica la **política
declarada por el dueño**, no un cálculo que la plataforma garantice. Sigue siendo lo correcto para
mostrar —es lo que el dueño mismo configuró y lo que el cliente necesita saber— pero no debe
describirse como una garantía del sistema.

**Qué se puede canjear** — de `recompensas` con `activa = true`, ordenadas por `costo_puntos`
ascendente. Esta parte **sí la hace cumplir el sistema**: el RPC de canje rechaza recompensas
inactivas o de otro comercio y valida el saldo (`lib/comercio/canje.ts:46-53`). `recompensas` usa
borrado suave (`activa=false`), así que filtrar por `activa = true` es lo correcto.

### Una línea por TIPO de regla, no una por fila

`reglas_puntos` **no tiene unique por tipo**: `crearRegla` no deduplica
(`lib/comercio/reglas.ts:18-42`) y el panel las lista todas. Un comercio con tres reglas `por_visita`
imprimiría tres líneas contradictorias en la tarjeta del cliente.

Regla: **para cada tipo (`por_visita`, `por_monto`) se toma la fila más reciente por `activa_desde` y
se emite UNA línea.** Un comercio puede tener a lo sumo dos líneas de "cómo ganás". Las filas viejas
del mismo tipo se ignoran: son historial, no política vigente.

### Redacción generada

La unidad depende de `comercios.tipo_tarjeta`: `'sellos'` → "sello"/"sellos", cualquier otro valor →
"punto"/"puntos". **Singular cuando la cantidad es exactamente 1**, y esto aplica tanto a las líneas
de reglas como a las de recompensas.

`reglas_puntos.valor` es `numeric` y admite decimales; se formatea sin ceros de relleno (`1` y no
`1.00`, `0.5` y no `0.50`).

- `por_visita` con valor N → `Ganás N puntos por cada visita.`
- `por_monto` con valor N → `Ganás N puntos por cada $1 de compra.`

La semántica de `por_monto` sale de la etiqueta del formulario que llena el dueño
(`app/comercio/(protegido)/reglas/FormularioRegla.tsx:21`). Como el sistema no calcula nada, esa
etiqueta es la ÚNICA fuente de verdad del significado.

**Cambio acompañante:** esa etiqueta dice "unidad de monto", que es ambiguo. Ahora que su
interpretación se imprime en la tarjeta de cada cliente, se ajusta a
`Valor (puntos por visita, o puntos por cada $1 de compra)` para que lo que el dueño entiende al
cargarla y lo que el cliente lee coincidan exactamente.

Si el comercio usa sellos y tiene `sello_meta`, se agrega: `Completá tus N sellos.`

Recompensas, una línea por cada una: `• {nombre} — {costo_puntos} puntos` (o `sellos`, o singular).
Si tiene `descripcion`, esa descripción va en la línea siguiente: son las palabras del propio dueño.

**Sin reglas Y sin recompensas activas, la sección entera se omite** (nada de encabezado huérfano).
Con una de las dos, se emite solo esa parte.

### Sobre el largo

**Sin tope de cantidad.** Un comercio con veinte recompensas produce un reverso largo y Apple lo hace
scrollear. Cortar en las primeras N sería ocultarle recompensas reales al cliente sin que nadie se
entere.

Honestidad sobre el límite: `crearRecompensa` **no valida el largo** de `nombre` ni de `descripcion`
(`lib/comercio/recompensas.ts:26-33`), así que en teoría un dueño podría escribir un ensayo en una
descripción y agrandar el pass. Si eso llega a pasar, la corrección correcta es ponerle un tope a
`recompensas.descripcion` en su propio validador — no truncar en silencio acá. Queda registrado, no
se resuelve en este spec.

### Decimales que nadie puede acreditar

`FormularioRegla.tsx:22` acepta `step="0.01"` y `crearRegla` admite cualquier valor `> 0`, así que
"Ganás 0.5 puntos por cada visita." es un reverso posible — pero `acreditarPuntos` exige un entero
(`lib/comercio/acreditar.ts:70`), así que el cajero no puede acreditar medio punto. Es una
inconsistencia preexistente del proyecto, no la introduce este trabajo. El formateo de decimales
existe para no imprimir `1.00`, no para bendecir esa combinación.

## 5. El aviso push: sin esto, "vivo" es mentira

Wallet solo vuelve a descargar el pass cuando recibe un aviso push. **Hoy ninguna de las acciones que
cambian el reverso lo dispara**: `notificarCambioComercio` existe
(`lib/apple/notificarCambioComercio.ts`) pero solo lo llaman el panel de FM
(`app/admin/(protegido)/comercios/actions.ts:69`) y el editor de marca
(`app/comercio/(protegido)/branding/actions.ts:43,152`).

Sin cerrar ese hueco, un dueño cambia una recompensa y el reverso de sus clientes sigue prometiendo lo
viejo hasta que cada uno pase por caja. Eso convierte la decisión §12.1 en una promesa vacía.

El precedente ya está escrito en el repo: `branding/actions.ts:40-43` llama `notificarCambioComercio`
con el comentario "sin esto, muestran el diseño viejo hasta el próximo cambio de puntos — bug visto
en el piloto".

**Alcance añadido, obligatorio:** llamar `notificarCambioComercio` al final de las acciones que
cambian lo que el reverso muestra:

- `app/comercio/(protegido)/reglas/actions.ts` — crear y eliminar regla.
- `app/comercio/(protegido)/recompensas/actions.ts` — crear y desactivar recompensa.
- `accionGuardarReverso` (§8).

Igual que en branding: best-effort, después de que el cambio se guardó, y su falla nunca revierte el
guardado.

## 6. Modelo de datos — migración 0013

Sobre `comercios`, todas nullable salvo el interruptor:

| Columna | Tipo | Nota |
|---------|------|------|
| `terminos_uso` | `text` | Texto libre multilínea del dueño. |
| `red_instagram` | `text` | URL completa. |
| `red_facebook` | `text` | URL completa. |
| `red_whatsapp` | `text` | URL completa (`https://wa.me/…`). |
| `sitio_web` | `text` | URL completa. |
| `mostrar_como_funciona` | `boolean not null default true` | Interruptor de la sección §4. |

Verificado que ninguna existe hoy. `0013` es el número libre: master tiene hasta
`0012_sucursal_principal.sql`.

Columnas explícitas y no un `jsonb` de redes: el conjunto es chico y estable, la validación por
columna es directa, y agregar TikTok mañana es una migración de una línea.

`default true` en el interruptor: los comercios que ya existen quedan con la sección automática
encendida, que es el comportamiento deseado.

**`lib/supabase/types.ts` se actualiza EN EL MISMO COMMIT** que la migración — las seis columnas en
`Row`, `Insert` y `Update` de `comercios`. Ese archivo se mantiene a mano (lo dice él mismo en sus
líneas 16-17) y sin eso el `update()` de §8 no compila.

**La migración la aplica el usuario a mano** en Supabase Studio (regla del proyecto: el asistente no
corre DDL). Se entrega el `.sql`, el usuario avisa, y después se verifica con un script de solo
lectura.

## 7. Validación — la única defensa

La base no respalda nada de esto (sin CHECKs, como el resto del esquema).
`lib/comercio/guardarReverso.ts` es la única barrera:

- **URLs**: se parsean con `new URL()` y **el protocolo debe ser exactamente `https:`**. Se rechaza
  `http:` y cualquier otro esquema — `javascript:` sobre todo, porque ese valor termina dentro de un
  `href` en el pass.
- **Se guarda la cadena cruda** (con `trim()`), no `new URL().href`: la normalización de `URL` agrega
  barras finales y percent-encodea, y devolverle al dueño algo distinto de lo que escribió es
  desconcertante. La defensa contra comillas es el escape de §7.1, no la normalización.
- **Largo de términos**: tope de 2000 caracteres, con mensaje que dice el largo actual.
- **Largo de URLs**: tope de 500 caracteres.
- Todo campo vacío o solo-espacios se guarda como `null`, nunca como cadena vacía: así la lógica de
  omitir secciones tiene un solo caso que mirar.
- `mostrar_como_funciona` se normaliza a booleano.

### 7.1 Escape de HTML

`attributedValue` se interpreta como HTML y el `href` sale de un valor que escribió el dueño, así que
**la URL se escapa** antes de interpolarla (`&`, `<`, `>`, `"`, `'`). Sin eso, una URL con comillas
rompe el atributo y puede inyectar marcado. La validación de §7 ya restringe mucho; el escape es la
defensa que no depende de que la validación sea perfecta.

**Qué NO es HTML y por lo tanto no se escapa:** los `value` de texto plano — términos de uso, nombre
de empresa, el bloque del emisor, y **toda la sección "Cómo funciona"**, que contiene texto del dueño
(`recompensas.nombre` y `recompensas.descripcion`). Esa sección va en `value`, nunca en
`attributedValue`: no necesita links y meterla en HTML sería exponer texto de usuario sin escapar sin
ninguna ganancia.

## 8. Dónde se edita

Una **sección nueva al final del editor de marca** (`/comercio/branding`), no una pantalla aparte ni
una entrada nueva en el nav inferior: ese nav ya venía sin espacio (fue lo que originó el trabajo del
2026-07-25) y esto es conceptualmente lo mismo que ya vive ahí — cómo se ve y qué dice tu tarjeta.

Piezas, siguiendo el patrón que ya usa branding:

- `app/comercio/(protegido)/branding/FormularioReverso.tsx` — cliente, `useActionState`, con su propio
  `<form>` independiente del de colores.
- `accionGuardarReverso` en el `actions.ts` que ya existe.
- `lib/comercio/guardarReverso.ts` — validación + update, **separado de `guardarBranding`**, que no se
  toca. Son responsabilidades distintas y mezclarlas engorda una función que ya valida colores, meta y
  difuminado.

El `comercio_id` SIEMPRE viene del gate `verifyComercioOwner()`, nunca del formulario.

### 8.1 El borrador de términos se inserta con un BOTÓN, no como valor por defecto

Un dueño frente a una caja de texto vacía no escribe nada. Pero precargar el borrador como
`defaultValue` del textarea tiene una consecuencia inaceptable: el dueño que solo quiere cargar su
Instagram aprieta Guardar, el borrador viaja en el `FormData` y **queda persistido como los términos
legales del comercio sin que nadie los haya leído ni aceptado**.

Solución: el textarea arranca **vacío**, con un botón `Usar un borrador sugerido` al lado que lo llena
en el cliente. Escribir esos términos pasa a ser un acto explícito. El dueño puede editarlo entero o
borrarlo.

### 8.2 Texto literal del borrador

Va acá y no "a criterio del implementador": es texto cuasi-legal que termina en la tarjeta de cada
cliente, y dos implementadores escribirían dos documentos distintos.

`{unidad}` es "puntos" o "sellos" según `tipo_tarjeta`. `{comercio}` es el nombre del comercio.
Deliberadamente **no repite** cómo se ganan {unidad} ni qué se canjea: de eso ya se encarga la sección
automática, y duplicarlo es justo lo que se desactualiza.

```
1. Los {unidad} no tienen valor monetario y no se canjean por efectivo.
2. Los {unidad} no vencen.
3. La tarjeta es personal: no se transfiere ni se combina con otras.
4. Las recompensas están sujetas a disponibilidad.
5. No acumulable con otras promociones.
6. {comercio} puede modificar o terminar el programa avisando en el local.
```

## 9. Errores y degradación

El reverso es **best-effort, igual que la franja y el logo**: ninguna falla suya puede impedir que se
emita un pass. Si la consulta de reglas o recompensas falla, se omite la sección automática y el pass
sale con el resto. Un cliente con un reverso incompleto está infinitamente mejor que uno sin tarjeta.

`datosPassDeTarjeta` ya trae el comercio entero (`select('*, comercios(*)')`), así que las columnas
nuevas llegan sin consulta extra. Reglas y recompensas sí necesitan dos consultas más, que se hacen
en paralelo.

## 10. Pruebas

- **`construirReverso` (pura, sin BD)** — acá vive la mayor parte del riesgo: singular/plural, sellos
  vs puntos, formateo de decimales, una línea por tipo de regla (no una por fila), secciones omitidas
  cuando faltan datos, orden de los campos, y que un comercio sin nada configurado produzca
  **exactamente dos campos** (`empresa` y `emisor`).
- **Que todos los campos lleven `value`** — la trampa de §3. Una prueba que recorra los campos
  generados y falle si alguno tiene `attributedValue` sin `value`; sin ella, el campo se pierde en
  silencio.
- **Validación** — `http://` rechazado, `javascript:` rechazado, términos sobre el tope rechazados,
  vacíos convertidos a `null`, URL cruda preservada sin normalizar.
- **Escape de HTML** — una URL con comillas no rompe el `href`.
- **`generarPassApple`** — un pass real con reverso: que `pass.json` tenga los `backFields` en el
  orden esperado y que los links viajen en `attributedValue`. Extiende `generatePass.test.ts`.
- **Mutation-testing obligatorio** en: el orden de los campos, el interruptor, el rechazo de esquemas
  de URL, y la selección de una regla por tipo. Romper la línea, confirmar que la prueba falla por el
  motivo correcto, restaurar.

## 11. Fuera de alcance

- **Google Wallet.** Su equivalente (`textModulesData` / `linksModuleData`) no se toca; el trámite de
  publicación sigue en pausa por decisión previa.
- **Número de serie y fecha de actualización** en el reverso (el competidor los muestra). El usuario
  no los pidió.
- **Quitar el pie de Cardly en planes superiores** (marca blanca). Decisión comercial, no técnica.
- **Más redes** (TikTok, X). Una migración de una línea cuando alguien las pida.
- **Tope de largo en `recompensas.descripcion`** (§4). Registrado, no resuelto acá.
- **Editar el reverso desde el panel de FM.** Lo configura el dueño.

## 12. Decisiones registradas

1. **La sección "Cómo funciona" es viva, no una copia congelada.** Se rechazó precargarla como texto
   editable: un reverso que promete una recompensa que ya cambió es una promesa incumplida frente al
   cliente final, no un detalle cosmético. El dueño conserva control total vía el interruptor y el
   texto libre de términos. **Esta decisión obliga al alcance añadido de §5** — sin el push, "vivo" no
   se cumple.
2. **El pie del emisor lleva nombre, correo (`soporte@cardly-sv.site`) y sitio
   (`www.cardly-sv.site`).** El correo se agregó el 2026-07-26, cuando el usuario compró el buzón del
   dominio; hasta entonces el spec decía "solo el sitio".
3. **El pie de Cardly va en todos los comercios**, sin excepción por plan.
4. **El borrador de términos se inserta con un botón explícito**, nunca como valor por defecto del
   formulario: un texto legal que nadie leyó no debe quedar atribuido al comercio (§8.1).
5. **Columnas explícitas y no un `jsonb` de redes**, por validación directa y coherencia con el
   esquema existente.
6. **Una línea por tipo de regla, la más reciente**, porque nada impide filas duplicadas y varias
   líneas contradictorias en la tarjeta serían peores que ninguna.

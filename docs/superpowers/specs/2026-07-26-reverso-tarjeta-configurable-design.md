# Reverso configurable de la tarjeta — diseño

**Fecha:** 2026-07-26
**Estado:** aprobado por el usuario (decisiones §11)

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

| # | Sección | Etiqueta | Origen |
|---|---------|----------|--------|
| 1 | Cómo funciona | `Cómo funciona` | Sistema (§4). Se omite si el dueño la apaga. |
| 2 | Términos de uso | `Términos de uso` | Texto libre del dueño. Se omite si está vacío. |
| 3 | Instagram | `Instagram` | Dueño. Link tocable. Se omite si está vacío. |
| 4 | Facebook | `Facebook` | Dueño. Link tocable. Se omite si está vacío. |
| 5 | WhatsApp | `WhatsApp` | Dueño. Link tocable. Se omite si está vacío. |
| 6 | Sitio web | `Sitio web` | Dueño. Link tocable. Se omite si está vacío. |
| 7 | Nombre de empresa | `Nombre de empresa` | `comercios.nombre`. Siempre. |
| 8 | Información del emisor | `Información del emisor` | Constante de Cardly SV. Siempre. |

**Toda sección vacía se omite por completo** — nunca un campo con la etiqueta y el valor en blanco,
ni la palabra "null". Un comercio recién creado que no configuró nada obtiene un reverso con las
secciones 1, 7 y 8, que es información correcta y suficiente.

### Links tocables

`passkit-generator` expone `attributedValue` en `PassFieldContent`
(`node_modules/passkit-generator/lib/types/schemas/PassFieldContent.d.ts:11`), y Apple lo renderiza
con HTML: un `<a href="…">Etiqueta</a>` sale como link azul, igual que en la captura del competidor.
**Verificado en la librería instalada, no supuesto.**

El texto visible del link es fijo por sección ("Instagram", "Facebook", …), no la URL cruda: una URL
larga se ve mal y no aporta. El `href` es lo que guardó el dueño.

### Información del emisor

Valor: `Cardly SV` y el sitio `cardly-sv.site` como link. **Sin correo de contacto** — decisión
explícita del usuario: por ahora solo el sitio.

Vive como constante en código (`lib/apple/emisorCardly.ts`), no en la base: es nuestro dato, idéntico
para todos los comercios, y ponerlo en `comercios` invitaría a que un comercio lo edite.

## 4. La sección automática ("Cómo funciona")

Se arma **en cada generación del pass**, leyendo la base. Nunca se congela una copia. Esto es
deliberado: si el dueño sube una recompensa de 5 a 8 puntos, el reverso de todas las tarjetas ya
emitidas se corrige en la siguiente actualización en vez de seguir prometiendo lo viejo.

### De dónde sale cada parte — y qué tan cierta es

**Cómo se ganan puntos** — de `reglas_puntos` (todas las filas del comercio, ordenadas por
`activa_desde` descendente).

⚠️ **Estas reglas son DECLARATIVAS: el sistema no las aplica.** Verificado en
`lib/comercio/acreditar.ts` — el cajero digita a mano la cantidad (`delta`) y el RPC
`acreditar_puntos_atomico` la suma tal cual; `reglas_puntos` solo se lee para listarla en el panel.
O sea que esta parte del reverso comunica la **política declarada por el dueño**, no un cálculo que
la plataforma garantice. Sigue siendo lo correcto para mostrar (es lo que el dueño mismo configuró y
lo que el cliente necesita saber), pero no debe describirse como una garantía del sistema.

**Qué se puede canjear** — de `recompensas` con `activa = true`, ordenadas por `costo_puntos`
ascendente. Esta parte **sí la hace cumplir el sistema**: el RPC de canje rechaza recompensas
inactivas o de otro comercio (`recompensa_no_disponible`) y valida el saldo (`saldo_insuficiente`),
verificado en `lib/comercio/canje.ts`.

### Redacción generada

La unidad depende de `comercios.tipo_tarjeta`: `'sellos'` → "sello"/"sellos", cualquier otro caso →
"punto"/"puntos". Singular cuando la cantidad es exactamente 1.

Reglas (`reglas_puntos.valor` es `numeric`, admite decimales; se formatea sin ceros de relleno):

- `por_visita` con valor N → `Ganás N puntos por cada visita.`
- `por_monto` con valor N → `Ganás N puntos por cada $1 de compra.`

La semántica de `por_monto` sale de la etiqueta del formulario que llena el dueño —
"Valor (puntos por visita, o puntos por unidad de monto)",
`app/comercio/(protegido)/reglas/FormularioRegla.tsx:21`. Como el sistema no calcula nada, esa
etiqueta es la ÚNICA fuente de verdad del significado.

**Cambio acompañante:** esa etiqueta dice "unidad de monto", que es ambiguo. Ahora que su
interpretación se imprime en la tarjeta de cada cliente, se ajusta a
`Valor (puntos por visita, o puntos por cada $1 de compra)` para que lo que el dueño entiende al
cargarla y lo que el cliente lee coincidan exactamente.

Si el comercio usa sellos y tiene `sello_meta`, se agrega: `Completá tus N sellos.`

Recompensas, una línea por cada una: `• {nombre} — {costo_puntos} puntos` y, si tiene `descripcion`,
esa descripción en la línea siguiente (son las palabras del propio dueño).

Sin reglas y sin recompensas activas, la sección entera se omite (no un encabezado huérfano).

**Sin tope de cantidad.** Un comercio con veinte recompensas produce un reverso largo, y Apple lo
hace scrollear. Cortar en las primeras N sería ocultarle recompensas reales al cliente sin que nadie
se entere; el texto pesa bytes, no megabytes, y el peso del pass ya tiene su propia vigilancia
(`scripts/verificar-wallet.ts`).

## 5. Modelo de datos — migración 0013

Sobre `comercios`, todas nullable salvo el interruptor:

| Columna | Tipo | Nota |
|---------|------|------|
| `terminos_uso` | `text` | Texto libre multilínea del dueño. |
| `red_instagram` | `text` | URL completa. |
| `red_facebook` | `text` | URL completa. |
| `red_whatsapp` | `text` | URL completa (`https://wa.me/…`). |
| `sitio_web` | `text` | URL completa. |
| `mostrar_como_funciona` | `boolean not null default true` | Interruptor de la sección §4. |

Columnas explícitas y no un `jsonb` de redes: el conjunto es chico y estable, la validación por
columna es directa, y agregar TikTok mañana es una migración de una línea. Es la opción que sigue el
estilo del resto del esquema.

`default true` en el interruptor: los comercios que ya existen quedan con la sección automática
encendida, que es el comportamiento que queremos por defecto.

**La migración la aplica el usuario a mano** en Supabase Studio (regla del proyecto: el asistente no
corre DDL). Se entrega el `.sql` y después se verifica con un script de solo lectura.

## 6. Validación — la única defensa

La base no respalda nada de esto (sin CHECKs, como el resto del esquema). `lib/comercio/guardarReverso.ts`
es la única barrera:

- **URLs**: deben empezar con `https://` y parsear con `new URL()`. Se rechaza `http://` y cualquier
  esquema raro (`javascript:` sobre todo — ese valor termina dentro de un `href` en el pass).
- **Largo de términos**: tope de 2000 caracteres, con mensaje que dice el largo actual.
- **Largo de URLs**: tope de 500 caracteres.
- Todo campo vacío o solo-espacios se guarda como `null`, no como cadena vacía: así la lógica de
  omitir secciones tiene un solo caso que mirar.
- `mostrar_como_funciona` se normaliza a booleano.

### Escape de HTML

`attributedValue` se interpreta como HTML. El `href` sale de un valor que escribió el dueño, así que
**la URL se escapa** antes de interpolarla (`&`, `<`, `>`, `"`). Sin eso, una URL con comillas rompe
el atributo y puede inyectar marcado en el pass. La validación de §6 ya restringe mucho, pero el
escape es la defensa que no depende de que la validación sea perfecta.

Los `value` de texto plano (términos, nombre de empresa) NO son HTML y no se escapan.

## 7. Dónde se edita

Una **sección nueva al final del editor de marca** (`/comercio/branding`), no una pantalla aparte ni
una entrada nueva en el nav inferior: ese nav ya venía sin espacio (fue lo que originó el trabajo del
2026-07-25) y esto es conceptualmente lo mismo que ya vive ahí — cómo se ve y qué dice tu tarjeta.

Piezas, siguiendo el patrón que ya usa branding:

- `app/comercio/(protegido)/branding/FormularioReverso.tsx` — cliente, `useActionState`, con su
  propio `<form>` independiente del de colores.
- La acción vive en el `actions.ts` que ya existe, como `accionGuardarReverso`.
- `lib/comercio/guardarReverso.ts` — validación + update, **separado de `guardarBranding`**, que no
  se toca. Son dos responsabilidades distintas y mezclarlas engorda una función que ya valida
  colores, meta y difuminado.

El `comercio_id` SIEMPRE viene del gate `verifyComercioOwner()`, nunca del formulario.

### Borrador sugerido de términos

Un dueño frente a una caja de texto vacía no escribe nada. La primera vez (`terminos_uso` en null) el
campo se muestra **precargado con un borrador editable** —las cláusulas estándar del rubro, adaptadas
a si el comercio usa sellos o puntos— que el dueño puede reescribir entero o borrar.

El borrador es un valor por defecto **del formulario**, no de la base: mientras el dueño no guarde,
`terminos_uso` sigue en null y el reverso no muestra la sección. Nunca se le atribuye al comercio un
texto que nadie aceptó.

## 8. Errores y degradación

El reverso es **best-effort, igual que la franja y el logo**: ninguna falla suya puede impedir que se
emita un pass. Si la consulta de reglas o recompensas falla, se omite la sección automática y el pass
sale con el resto. Un cliente con un reverso incompleto está infinitamente mejor que uno sin tarjeta.

`datosPassDeTarjeta` ya trae el comercio entero, así que las columnas nuevas llegan sin consulta
extra. Reglas y recompensas sí necesitan dos consultas más, que se hacen en paralelo.

## 9. Pruebas

- **`construirReverso` (pura, sin BD)** — la mayor parte del riesgo vive acá: singular/plural,
  sellos vs puntos, formateo de decimales, secciones omitidas cuando faltan datos, orden de los
  campos, y que un comercio sin nada configurado produzca exactamente los tres campos fijos.
- **Validación** — `http://` rechazado, `javascript:` rechazado, términos sobre el tope rechazados,
  vacíos convertidos a null.
- **Escape de HTML** — una URL con comillas no rompe el `href`.
- **`generarPassApple`** — un pass real con reverso: que `pass.json` tenga los `backFields` en el
  orden esperado y que los links viajen en `attributedValue`. Extiende `generatePass.test.ts`.
- **Mutation-testing obligatorio** en el orden de los campos, en el interruptor y en el rechazo de
  esquemas de URL: romper la línea, confirmar que la prueba falla por el motivo correcto, restaurar.

## 10. Fuera de alcance

- **Google Wallet.** Su equivalente (`textModulesData` / `linksModuleData`) no se toca; el trámite de
  publicación sigue en pausa por decisión previa.
- **Número de serie y fecha de actualización** en el reverso (el competidor los muestra). El usuario
  no los pidió; se agregan después si los quiere.
- **Quitar el pie de Cardly en planes superiores** (marca blanca). Es una decisión comercial, no
  técnica, y hoy no existe el requisito.
- **Más redes** (TikTok, X). Una migración de una línea cuando alguien las pida.
- **Editar el reverso desde el panel de FM.** Lo configura el dueño.

## 11. Decisiones registradas

1. **La sección "Cómo funciona" es viva, no una copia congelada.** Se rechazó precargarla como texto
   editable: un reverso que promete una recompensa que ya cambió es una promesa incumplida frente al
   cliente final, no un detalle cosmético. El dueño conserva control total vía el interruptor y el
   texto libre de términos.
2. **Sin correo de contacto de Cardly**, solo el sitio. Decisión explícita del usuario.
3. **El pie de Cardly va en todos los comercios**, sin excepción por plan.
4. **Términos con borrador sugerido en el formulario, no en la base.** Un texto legal que nadie
   aceptó no debe quedar atribuido al comercio.
5. **Columnas explícitas y no un `jsonb` de redes**, por validación directa y coherencia con el
   esquema existente.

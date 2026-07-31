# Branding por programa de tarjeta

Fecha: 2026-07-30
Estado: diseño, pendiente de revisión y plan

## Por qué

Desde la migración 0024 un comercio puede tener varios programas de tarjeta (el principal más, por
ejemplo, un "Cupón de bienvenida" o una gift card). Pero **el branding sigue siendo uno solo para
todo el comercio**: colores, logo, franja e ícono de sello viven en la tabla `comercios`.

Consecuencia para el dueño: crea un programa secundario y no encuentra dónde darle otra cara,
porque no existe. Las dos tarjetas se ven idénticas en la billetera del cliente, que además las ve
una al lado de la otra.

## Precondición: que TODO el sistema lea el programa (ya está, pero costó dos rondas)

El 2026-07-30, investigando este mismo reclamo, apareció algo más grave: media docena de lugares
leían `comercios.tipo_tarjeta` y `comercios.sello_meta` — columnas LEGADAS desde la 0024 — en vez
del programa. Una tarjeta de cupón se le instalaba al cliente dibujada como tarjeta de sellos
mientras el escáner la operaba como cupón.

El primer arreglo (`a6c0b98`) tocó solo `datosPassDeTarjeta` y `syncObjeto`, y **se declaró cerrado
sin haber buscado los demás consumidores**. La revisión de este spec encontró los que faltaban:

- **`lib/google/linkGuardar.ts`** — el peor. Llamaba a `syncObjetoTarjeta` (que ya escribía bien) y
  DESPUÉS embebía en el JWT un objeto armado con el tipo del comercio; como Google hace upsert por
  id al procesar el JWT, ese cuerpo **pisaba** al correcto. El camino "Agregar a Google Wallet"
  reintroducía el bug en silencio.
- **`app/api/tarjetas/[tarjetaId]/hero.png/route.ts`** — la ruta que DIBUJA la grilla. Falla
  silenciosa doble: componía la imagen equivocada y, como `versionHero` hashea el branding, la URL
  cambiaba y Google **re-descargaba la misma imagen mal dibujada**.
- **`lib/portal/buscarTarjetas.ts`** — el portal del cliente.

Y una **regresión introducida por ese mismo arreglo**: `guardarBranding` escribe `sello_meta` solo
en `comercios`, y nada en producción escribe `programas_tarjeta.sello_meta` (`crearPrograma` y
`guardarConfiguracionPrograma` no lo tocan). Al hacer que el pase leyera la columna del programa,
cambiar la meta de sellos dejó de tener efecto: quedaba congelada en el valor del backfill de la
0024. Corregido haciendo que `guardarBranding` escriba también el programa principal.

**Lección que este spec hereda:** cuando una columna se muda de tabla, hay que barrer TODOS los
consumidores con un grep, no arreglar los que uno recuerda. Este trabajo mueve 8 columnas más.

## La restricción que ordena todo el diseño: la LoyaltyClass de Google

Google guarda **logo, colores y nombre del programa en la `LoyaltyClass`**, no en el objeto. Hoy hay
**una clase por comercio** (`comercios.google_class_id`, ver `lib/google/syncClase.ts`). Branding
por programa obliga a **una clase por programa**.

Y ahí está el problema: **las clases de Google NO se pueden borrar** — la API no tiene `delete`
(documentado en `CLAUDE.md`). Cada programa que alguien cree genera una clase permanente e
irreversible en el emisor de producción, visible para el revisor de Google. Un dueño que cree y
borre diez programas de prueba deja diez clases para siempre.

Esto convierte una decisión de UI en una decisión con consecuencias externas irreversibles, y es la
razón por la que este trabajo necesita spec en vez de irse directo a implementar.

Del lado de Apple no hay equivalente: el `.pkpass` se genera entero en cada emisión, así que el
branding por programa es gratis y reversible.

## Decisiones

1. **El branding por programa es OPCIONAL y se HEREDA.** Cada campo nuevo en `programas_tarjeta`
   nace `null` y `null` significa "usá el del comercio". Así:
   - Ningún comercio existente cambia de aspecto al aplicar la migración.
   - El dueño que no quiera diferenciar nada no tiene que tocar nada.
   - No se duplica el branding del comercio en cada programa, que quedaría desincronizado apenas el
     dueño cambie el logo del negocio.

2. **La clase de Google se crea PEREZOSAMENTE, y SOLO por los 3 campos que Google realmente usa.**
   `construirClase` (`lib/google/construirRecursos.ts:33-53`) manda a la clase exactamente
   `color_fondo` (→`hexBackgroundColor`), `logo_url` (→`programLogo`) y `hero_url` (→`heroImage`).
   Los otros cinco —`color_texto`, `color_label`, `strip_url`, `sello_icono_url`,
   `difuminado_franja`— **no tocan la clase**: viven en el `.pkpass` de Apple y en el `heroImage`
   del OBJETO, que ya es por tarjeta.

   Por eso el disparador es "el programa define color_fondo, logo_url o hero_url propios", y no
   "el programa tiene cualquier branding propio". Con la regla amplia, un dueño que solo cambia el
   ícono del sello de su cupón generaría una clase **permanente e irreversible** que no necesita
   para nada. Los otros cinco campos son gratis y reversibles en las dos plataformas.

   Mientras un programa no defina ninguno de esos tres, sus objetos siguen colgando de la clase del
   comercio y no se crea nada.

3. **`google_class_id` en el programa NO alcanza: hacen falta DOS estados.** `syncClaseComercio`
   decide `insert` vs `patch` mirando esa columna (`syncClase.ts:49-52`) y el id es determinístico
   (`ids.ts:4-6`). Con una sola columna, el ciclo encender → apagar (vuelve a null) → reencender
   haría un `insert` sobre un id que YA existe en Google, y no se puede limpiar borrando la clase
   — que es la premisa entera de este spec.

   Van separados: `google_class_id` (una vez creado NUNCA vuelve a null: registra que la clase
   existe) y `branding_propio` (booleano: si el programa usa su branding o hereda).

4. **Al desactivar el branding propio, los objetos NO se mueven de vuelta.** Se le hace `patch` a la
   clase del programa con el branding del comercio. Es más barato, no toca passes instalados, y
   evita el problema de la clase huérfana. Es lo que hace posible la decisión 3: la clase sigue
   existiendo y sirviendo, solo que mostrando lo heredado.

5. **La UI avisa que es irreversible ANTES de crear la clase**, con esas palabras, y solo cuando el
   dueño toca uno de los tres campos de la decisión 2. No es un detalle de copy: es la única
   defensa contra un dueño que experimenta.

6. **El branding heredado se resuelve en UN solo lugar**, una función pura
   (`lib/comercio/brandingEfectivo.ts`) que recibe el branding del comercio y el del programa y
   devuelve el efectivo. Los consumidores son NUEVE, no cinco — la revisión completó el inventario,
   y dos de ellos fallan en silencio si se los olvida:

   | Consumidor | Qué hace | Riesgo si se olvida |
   |---|---|---|
   | `lib/apple/datosPassDeTarjeta.ts` | arma el `.pkpass` | pase con la marca del comercio |
   | `lib/google/syncClase.ts` | crea/actualiza la clase | — |
   | `lib/google/syncObjeto.ts` | actualiza el objeto | — |
   | `lib/google/linkGuardar.ts` | JWT de "Agregar a Google Wallet" | **pisa** el objeto correcto |
   | `lib/portal/buscarTarjetas.ts` | portal del cliente | muestra la marca equivocada |
   | **`app/api/tarjetas/[id]/hero.png/route.ts`** | **DIBUJA la imagen** | **silencioso: la URL cambia y sirve la imagen vieja** |
   | `lib/google/syncComercio.ts` | re-sincroniza todas las tarjetas | hay que poder acotarlo a un programa |
   | `lib/apple/notificarCambioComercio.ts` | refresca los `.pkpass` instalados | ningún iPhone se entera del cambio |
   | `scripts/resincronizar-objetos-google.ts` | re-sync manual | guarda incompleta |

   El de `hero.png` es el que más importa: `versionHero` (`lib/google/heroUrl.ts:33-39`) hashea el
   branding para el cache-busting. Si el hash pasa a usar el branding efectivo pero la ruta sigue
   leyendo `comercios`, **la URL cambia, Google re-descarga, y sirve la imagen equivocada** — el
   cache-busting funcionando perfecto para entregar lo incorrecto. Sin error, sin aviso.

   **Ojo con el `??`:** el mismo error que ya se cometió con `sello_meta` el 2026-07-30. Para el
   branding, `??` SÍ es correcto (null = heredar, no hay "color nulo legítimo"), pero conviene
   dejarlo escrito para que nadie copie el patrón al revés.

7. **Alcance de los campos:** los ocho que ya tiene `comercios` — `color_fondo`, `color_texto`,
   `color_label`, `logo_url`, `hero_url`, `strip_url`, `sello_icono_url`, `difuminado_franja` — más
   **`sello_meta`**, que ya vive en `programas_tarjeta` desde la 0024 pero hoy **nadie escribe**
   (ver la sección de precondición). Es el noveno campo del mismo formulario; dejarlo afuera daría
   una pantalla donde los colores funcionan y la meta no, sin nada que explique la diferencia.

8. **Las imágenes por programa necesitan su propia ruta de almacenamiento.**
   `rutaImagenComercio(comercioId, campo, ext)` (`lib/comercio/imagenComercio.ts:42-44`) devuelve
   `<comercioId>/<campo>.<ext>` y la subida usa `upsert: true`. Subir el logo del programa B por ese
   camino **pisaría el logo del comercio**. Hace falta una ruta con el programa adentro, siguiendo
   el patrón que ya existe en `rutaImagenRecompensa` (líneas 54-56).

9. **`programName`/`issuerName` de la clase se quedan con el nombre del COMERCIO.** `construirClase`
   los pone así hoy (`construirRecursos.ts:37-38`) y se mantiene: el cliente tiene que reconocer de
   qué negocio es la tarjeta. La diferencia entre programas la dan el logo, los colores y la imagen
   — que es lo que el dueño pidió. Se deja escrito para que nadie lo cambie sin pensarlo.

## Modelo de datos

```sql
alter table programas_tarjeta
  add column color_fondo text,
  add column color_texto text,
  add column color_label text,
  add column logo_url text,
  add column hero_url text,
  add column strip_url text,
  add column sello_icono_url text,
  add column difuminado_franja text,
  -- DOS estados separados a propósito (decisión 3):
  --   google_class_id: la clase existe en Google. Una vez seteado NUNCA vuelve a null, porque las
  --   clases no se pueden borrar y un segundo insert sobre el mismo id fallaría.
  --   branding_propio: si este programa usa SU branding o hereda el del comercio.
  add column google_class_id text,
  add column branding_propio boolean not null default false;
```

`sello_meta` no se agrega: ya existe en `programas_tarjeta` desde la 0024. Lo que falta es que
alguien lo ESCRIBA desde la UI (ver decisión 7).

Todo nullable sin default: `null` es el estado de herencia y es el que tienen todos los programas
existentes tras migrar. Sin CHECK de colores, igual que en `comercios` — la validación vive en
`validar()` de la capa app, que es la única defensa (ver `CLAUDE.md`).

## Riesgos y pendientes para el plan

- **Migrar los objetos a la clase nueva: VERIFICADO CONTRA LA API REAL el 2026-07-30, funciona.**
  Era el mayor riesgo abierto del diseño y quedó cerrado con una prueba, no con un supuesto.

  Qué se hizo: se creó una clase real en el emisor de producción con `reviewStatus: 'UNDER_REVIEW'`
  (tal como la crea `construirClase`), se movió un `LoyaltyObject` existente —elegido con
  `hasUsers === false`, para no tocar ningún pase instalado en un teléfono— con
  `loyaltyobject.patch({ classId })`, se confirmó releyendo el objeto que el `classId` cambió de
  verdad, y se lo devolvió a su clase original.

  Dos resultados, y el segundo no lo esperaba:
  1. **Un objeto SÍ se puede mover de clase con `patch`.** `classId` no es inmutable.
  2. **Google devolvió la clase recién creada como `approved`, no como `UNDER_REVIEW`.** Con el
     emisor ya aprobado, las clases nuevas nacen aprobadas, así que la condición *"must be
     approved"* que exige la doc de `classId` se cumple sola. El bloqueo que este spec temía **no
     existe**, y la salida alternativa ("branding propio solo para tarjetas nuevas") queda
     descartada por innecesaria.

  Costo permanente de la verificación: la clase `<emisor>.prueba_mover_clase_2026_07_30`
  (`programName: "Verificacion tecnica"`) queda para siempre en el emisor — las clases de Google no
  se borran. Autorizado explícitamente por el dueño tras advertírselo.
- **`syncClaseComercio` deja de ser una sola llamada por comercio, y tiene CINCO llamadores** que el
  plan debe revisar uno por uno: `app/api/registro/route.ts:92`,
  `app/comercio/(protegido)/sucursales/actions.ts:165`,
  `app/admin/(protegido)/comercios/actions.ts:76`,
  `app/comercio/(protegido)/branding/actions.ts` (líneas 50, 152 y 201) y `linkGuardar.ts:40`.

  **El de sucursales es el que no se ve venir: las ubicaciones del geopush viven en la CLASE**
  (`construirRecursos.ts:46-52`). Crear o mover una sucursal tendrá que actualizar la clase del
  comercio Y la de cada programa con clase propia, o los clientes de esos programas pierden el
  aviso por cercanía — justo lo que se arregló el 2026-07-30.
- **Dónde vive la UI: sin decidir.** `app/comercio/(protegido)/branding/page.tsx` es del comercio y
  además decide `esSellos` con la columna legada. Las opciones son un selector de programa ahí, o
  una pestaña de marca dentro de `/comercio/programas`. Lo resuelve el plan.
- **Falta el script de verificación de la migración.** El repo tiene `scripts/verificar-00NN.ts`
  para 0012-0018, 0024 y 0026; esta migración necesita el suyo.
- **La validación reusa lo que ya existe**, no se reescribe: `lib/comercios/validarColorRgb.ts` y
  `NIVELES_DIFUMINADO` de `lib/apple/difuminadoFranja.ts`, igual que `guardarBranding.ts:3-4`. La BD
  no valida nada de esto (sin CHECK de colores), así que la capa app es la única defensa.
- **Cobertura mínima:** que un programa sin branding propio herede TODO; que uno con branding
  parcial herede solo lo que no definió; que cambiar el branding del comercio se propague a los
  herederos y NO pise al que tiene el suyo; que no se cree clase de Google mientras el programa no
  toque ninguno de los TRES campos de la decisión 2; que el ciclo encender → apagar → reencender NO
  intente un segundo `insert`; y que subir una imagen de programa no pise la del comercio.

  **La prueba que no puede faltar, porque es la única que separa "la URL cambió" de "la imagen
  cambió":** que `/api/tarjetas/<id>/hero.png` dibuje con el branding EFECTIVO del programa. Su
  mutación: hacer que la ruta lea `comercios` y confirmar que la prueba falla por el color o el
  ícono — no por un 404.
- **No crear clases de QA contra el emisor real** (`CLAUDE.md`): las pruebas de Google mockean
  `walletClient`, como ya hacen `syncClase.test.ts` y `syncObjeto.test.ts`.

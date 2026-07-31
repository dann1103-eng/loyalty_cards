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

## Lo que este trabajo NO tiene que arreglar (ya se arregló)

El 2026-07-30, al investigar este mismo reclamo, apareció algo más grave y **ya está corregido**:
`datosPassDeTarjeta` y `syncObjeto` leían `comercios.tipo_tarjeta` y `comercios.sello_meta` —
columnas LEGADAS desde la 0024— en vez del programa. Una tarjeta de cupón se le instalaba al cliente
dibujada como tarjeta de sellos mientras el escáner la operaba como cupón. Ese arreglo es
precondición de este trabajo: el pase ya sabe a qué programa pertenece.

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

2. **La clase de Google se crea PEREZOSAMENTE: solo cuando el programa tiene branding propio.**
   Mientras un programa hereda todo, sus objetos siguen colgando de la clase del comercio y no se
   crea ninguna clase nueva. La primera vez que el dueño le guarda branding propio, ahí sí se crea
   su clase y se migran sus objetos.

   Esto acota el daño irreversible a lo que el dueño pidió explícitamente. Crear una clase por
   programa desde el alta llenaría el emisor de clases de programas que nadie diferenció nunca.

3. **La UI avisa que es irreversible ANTES de crear la clase**, con esas palabras. No es un detalle
   de copy: es la única defensa contra un dueño que experimenta.

4. **El branding heredado se resuelve en UN solo lugar**, una función pura
   (`lib/comercio/brandingEfectivo.ts`) que recibe el branding del comercio y el del programa y
   devuelve el efectivo. Hoy hay al menos cinco consumidores (`datosPassDeTarjeta`, `syncClase`,
   `syncObjeto`, `linkGuardar`, `buscarTarjetas` del portal) y si cada uno hace su propio
   `programa.color_fondo ?? comercio.color_fondo`, uno se va a olvidar.

   **Ojo con el `??`:** el mismo error que ya se cometió con `sello_meta` el 2026-07-30. Para el
   branding, `??` SÍ es correcto (null = heredar, no hay "color nulo legítimo"), pero conviene
   dejarlo escrito para que nadie copie el patrón al revés.

5. **Alcance de los campos:** los mismos que ya tiene `comercios` — `color_fondo`, `color_texto`,
   `color_label`, `logo_url`, `hero_url`, `strip_url`, `sello_icono_url`, `difuminado_franja`.
   Ni más ni menos: un subconjunto obligaría a explicar por qué unos se heredan y otros no.

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
  -- Clase propia de Google. null = este programa usa la clase del comercio (herencia).
  add column google_class_id text;
```

Todo nullable sin default: `null` es el estado de herencia y es el que tienen todos los programas
existentes tras migrar. Sin CHECK de colores, igual que en `comercios` — la validación vive en
`validar()` de la capa app, que es la única defensa (ver `CLAUDE.md`).

## Riesgos y pendientes para el plan

- **Migrar los objetos de un programa a su clase nueva. ES EL MAYOR RIESGO ABIERTO y va como primer
  paso verificable del plan, no como supuesto.** Lo que sí se pudo confirmar leyendo los tipos
  instalados (`node_modules/googleapis/.../walletobjects/v1.d.ts:916`): la documentación de
  `LoyaltyObject.classId` **no** lo marca como inmutable, lo cual es alentador pero no es prueba.

  Y ahí mismo aparece una condición que el diseño tiene que respetar sí o sí: la clase destino
  *"must already exist, and **must be approved**"*. Nuestro `construirClase` crea toda clase con
  `reviewStatus: 'UNDER_REVIEW'` (`lib/google/construirRecursos.ts:38`). O sea que una clase nueva
  por programa **podría no aceptar objetos hasta estar aprobada**, y la aprobación no depende de
  nosotros. Si es así, el branding propio solo podría aplicarse a las tarjetas emitidas después de
  que la clase quede aprobada, y el plan necesita decidir qué se le muestra al dueño mientras tanto.

  Salida alternativa si mover objetos resulta imposible: que el branding propio aplique únicamente
  a tarjetas nuevas, y que la UI lo diga.
- **`syncClaseComercio` deja de ser una sola llamada por comercio.** Un cambio de branding del
  comercio tiene que propagarse a las clases de todos los programas que heredan ese campo.
- **Cobertura mínima:** que un programa sin branding propio herede TODO; que uno con branding
  parcial herede solo lo que no definió; que cambiar el branding del comercio se propague a los
  herederos y NO pise al que tiene el suyo; que no se cree clase de Google mientras el programa
  herede todo; y que el pase de cada programa salga con su propio logo y colores.
- **No crear clases de QA contra el emisor real** (`CLAUDE.md`): las pruebas de Google mockean
  `walletClient`, como ya hacen `syncClase.test.ts` y `syncObjeto.test.ts`.

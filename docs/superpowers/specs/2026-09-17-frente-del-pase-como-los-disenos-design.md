# El frente del pase como los diseños, el apellido del cliente, y tres modelos más en la portada

Fecha: 2026-09-17
Estado: decisiones tomadas por el usuario en conversación; aprobado para plan e implementación

## Por qué

Daniel mandó tres diseños de tarjeta para la portada: **descuento** (CASA, joyería), **membresía**
(Infinit GYM) y **gift card** (Amy Art). Los tres comparten un orden del frente que el pase real NO
tiene hoy:

- arriba a la izquierda el logo; **arriba a la derecha el ESTADO** ("VÁLIDO HASTA 16/10/2026",
  "Saldo $50"; nada en el descuento);
- la franja es una imagen del comercio que **ya trae su texto dibujado** ("Mensualidad VIP",
  "GIFT CARD", "40% de descuento") — la app no escribe nada encima;
- debajo, **NOMBRE** a la izquierda y **APELLIDO** a la derecha, cada uno con su rótulo;
- el QR con **"Powered by Cardly"** debajo.

Hoy el pase real pone el nombre del pase arriba a la derecha (0033), el estado SOBRE la franja
(`primaryFields`), el nombre completo del cliente sin rótulo a la derecha de la fila secundaria, nada
debajo del QR, y en Google no lleva el nombre del cliente. La base guarda un solo campo de nombre.

Consultado, el usuario eligió **cambiar el pase real** para que se vea como los diseños (en vez de
publicar las ilustraciones con una nota que aclare la diferencia), y después sumar los modelos a la
portada.

## Decisiones

Las marcadas (U) las tomó el usuario; el resto se presentó y se aprobó.

1. **(U) El pase real adopta el orden de los diseños**, en Apple, en Google y en la vista previa del
   editor de marca. Las dos billeteras y la vista previa siguen sin poder divergir: un solo módulo
   puro decide qué va en cada lugar (`frentePase`).

2. **(U) El apellido se PIDE al registrarse.** Columna nueva `clientes.apellido` (0036). Partir el
   nombre existente en la primera palabra se descartó: "María José López" quedaría APELLIDO "José
   López".

3. **(U) El nombre del pase (`nombre_pase`) se escribe sobre la BANDA LISA, y solo ahí.** Si el
   comercio subió una imagen de franja propia, la imagen manda y no se escribe nada encima (así son
   los diseños: el texto viene dibujado en la imagen). Con la grilla de sellos tampoco (taparía los
   círculos). Sin imagen propia y sin grilla, la banda de colores quedaría vacía, y el nombre del
   pase es lo único que nombra la tarjeta en el frente.

4. **(U) "Powered by Cardly" debajo del QR, en todos los pases de todos los comercios**, en las dos
   billeteras. Sin regla por plan.

5. **Arriba a la derecha va el ESTADO del tipo**, con fecha CORTA (`16/10/2026`): la frase larga de
   `describirSaldo` ("Activa hasta el 16 de octubre de 2026") no entra en la esquina del logo.

6. **Un cliente que ya existe NO recibe apellido al registrarse en otro programa.** Misma regla que
   el nombre desde siempre (gana el primer registro). Completarlo "si está vacío" dejaría que
   cualquiera que conozca un teléfono le escriba un apellido a otra persona, y ese apellido se vería
   en su tarjeta de TODOS los comercios. Esos clientes muestran solo NOMBRE (con lo que escribieron,
   que muchas veces ya es el nombre completo porque el campo usaba `autocomplete="name"`).

7. **El apellido se ve** en el pase, en el escáner, en la lista y el detalle de Clientes (y su
   buscador), en la lista de clientes del admin y en el CSV exportado (columna nueva). **No cambian**
   el saludo del portal ("Hola, María") ni el reporte de mejores clientes (tocar una función SQL que
   nadie necesita tocar).

8. **Google muestra la franja propia del comercio en TODOS los tipos**, no solo en sellos. Hoy la
   franja propia solo llega a Google dentro del hero de sellos; una membresía o una gift card con
   franja propia se ven en Android con la foto compuesta de la clase, o sin franja. Sin esto, los
   tres diseños —que son sobre todo su franja— no existirían en Android. La ruta
   `/api/tarjetas/<id>/hero.png` ya devuelve los bytes de la franja propia para cualquier tipo, y
   `versionHero` ya incluye `stripUrl`.

9. **Orden de entrega (aprobado):** migración 0036 → registro → `frentePase` → Apple → Google (objetos
   antes que plantilla) → vista previa → escáner/Clientes/CSV → portada → suite, navegador, deploy, y
   por último la actualización de Google para todos los comercios con un script que primero muestra
   cuántos toca.

10. **Los pases de Apple ya instalados se actualizan solos en la próxima operación de cada cliente.**
    Sin push masivo: avisarle a todos los iPhone para cambiar un diseño es desproporcionado.

## El frente, lugar por lugar

| Tipo y estado | Arriba a la derecha (`estado`) | Sobre la franja (`sobreFranja`) |
|---|---|---|
| Membresía vigente | VÁLIDO HASTA · 16/10/2026 | nombre del pase, si la franja es banda lisa |
| Membresía vencida | VENCIÓ EL · 03/08/2026 | ″ |
| Membresía sin activar | MEMBRESÍA · Sin activar | ″ |
| Cupón con fecha, vigente | VÁLIDO HASTA · fecha | ″ |
| Cupón con fecha, vencido | VENCIÓ EL · fecha | ″ |
| Cupón sin vencimiento | CUPÓN · Disponible | ″ |
| Cupón usado | CUPÓN · Usado | ″ |
| Gift card, cashback | SALDO · $50.00 | ″ |
| Puntos | PUNTOS · 1250 (número, con separador del teléfono) | ″ |
| Prepago | VISITAS · 4 (número) | ″ |
| Sellos con meta | SELLOS · 7 de 10 | ″ (con grilla, nada) |
| Sellos sin meta | SELLOS · 7 (número) | ″ |
| Descuento | nada | ″ |

- **Debajo de la franja**: NOMBRE (izquierda) y APELLIDO (derecha, alineado a la derecha). Sin
  apellido, solo NOMBRE. Sin nombre resoluble, ninguno de los dos.
- **Debajo del QR**: "Powered by Cardly".
- El **último día** del vencimiento todavía es "VÁLIDO HASTA" (mismo `sigueVigente` de todo el
  sistema).
- `listado` (la línea única que Google usa en `loyaltyPoints` y en la vista de lista) **no cambia**.

### La franja, en tres estados

`frentePase` recibe **qué hay en la franja** en vez de `hayGrilla`:

- `'propia'`: el comercio subió una imagen de franja (`stripUrl`).
- `'grilla'`: sellos con meta y la grilla compuesta existe, sin franja propia.
- `'banda'`: cualquier otro caso (la banda de marca, con o sin foto; o la composición falló).

Cada consumidor lo calcula de SUS datos: Apple de `stripUrl` y de que `componerStrips` haya devuelto
algo; Google de `stripUrl` y de que el objeto lleve hero; la vista previa de `urls.strip` y la meta.
Esto corrige de paso una asimetría: hoy Google calcula `hayGrilla` sin mirar la franja propia.

## El contrato de `frentePase`

```ts
export type Franja = 'propia' | 'grilla' | 'banda';

export interface FrentePase {
  estado: CampoFrente | null;     // Apple headerFields; Google fila 1, derecha
  sobreFranja: string | null;     // Apple primaryFields; Google fila 1, izquierda
  titular: { nombre: string; apellido: string | null } | null; // Apple secondaryFields; Google fila 2
  listado: CampoFrente | null;    // Google loyaltyPoints (igual que hoy)
}
```

Entradas: las de hoy menos `hayGrilla`, más `franja: Franja`, `nombreCliente: string | null` y
`apellidoCliente: string | null`. Nombre y apellido se recortan; vacío vale null. `CampoFrente`
conserva `numero` (Apple `numberStyle`, Google `balance.int`).

`primario`, `secundario` y `encabezado` **desaparecen**: dejarlos convive con la trampa de que un
consumidor siga leyendo el lugar viejo. El compilador marca a cada uno.

La fecha corta sale de una función nueva `formatearFechaCorta('2026-10-16') → '16/10/2026'`, por
recorte de texto (sin `Date`: no hay zona horaria que la corra un día). Las etiquetas del estado por
tipo van en tabla, no en `if`.

"Powered by Cardly" es una constante exportada (`PIE_CODIGO`) que usan Apple, Google y la vista
previa.

## Apple (`lib/apple/generatePass.ts`)

- `estado` → `headerFields` (`key: 'estado'`), con `numberStyle` cuando `numero !== null`.
- `sobreFranja` → `primaryFields` (`key: 'nombre_pase'`, sin rótulo).
- `titular` → `secondaryFields`: `{ key: 'nombre', label: 'NOMBRE' }` y, si hay apellido,
  `{ key: 'apellido', label: 'APELLIDO', textAlignment: 'PKTextAlignmentRight' }`.
- `setBarcodes` pasa de string a objeto: QR con `message`, `messageEncoding: 'iso-8859-1'` y
  `altText: PIE_CODIGO`. Hoy el string genera cuatro formatos sin `altText`; Wallet usa el primero
  que soporta (QR), así que quedarse solo con QR no cambia lo que escanea el cajero.
- `DatosPass` suma `apellidoCliente`; `datosPassDeTarjeta` lee `clientes(nombre, apellido)`.
- La franja: `'propia'` si hay `stripUrl`; `'grilla'` si es sellos con meta y `strips !== null`;
  `'banda'` si no.

## Google (`lib/google/**`)

**Objeto** (`construirObjeto`, compartido por `syncObjetoTarjeta` y `generarLinkGuardar`):

- `textModulesData` con ids fijos: `nombre_pase` (solo si `sobreFranja`), `estado` (header = rótulo,
  body = valor), `nombre` (header "NOMBRE") y `apellido` (header "APELLIDO"), cada uno solo si existe.
- `barcode.alternateText = PIE_CODIGO`.
- `heroImage` cuando hay grilla **o franja propia** (decisión 8), con la misma URL versionada de hoy.
- `loyaltyPoints` desde `listado`, sin cambios. `validTimeInterval` sin cambios.
- `TarjetaParaObjeto` suma `nombreCliente`, `apellidoCliente` y `stripUrl` (o la franja ya
  resuelta); `syncObjeto` y `linkGuardar` los leen.

**Clase** (`construirClase`, compartida por `syncClaseComercio`, `syncClasePrograma` y
`generarLinkGuardar`): `classTemplateInfo.cardTemplateOverride.cardRowTemplateInfos` con DOS filas
`twoItems`:

1. `object.textModulesData['nombre_pase']` | `object.textModulesData['estado']`
2. `object.textModulesData['nombre']` | `object.textModulesData['apellido']`

Google dibuja el hero DESPUÉS de la primera fila cuando hay más de una, así que el orden queda
estado → franja → nombres → QR, como en los diseños. La plantilla REEMPLAZA las filas por defecto
(puntos, nombre de socio).

**Orden de despliegue, obligatorio:** primero se sincronizan los OBJETOS (con la plantilla por
defecto, los módulos nuevos aparecen abajo en los detalles: inocuo), y recién después las CLASES.
Al revés, entre los dos pasos cada tarjeta mostraría filas que apuntan a módulos que todavía no
tiene.

**Script** `scripts/actualizar-frente-google.ts`: recorre todos los comercios con clase; primero
imprime cuántos comercios, clases de programa y objetos va a tocar y termina (modo ensayo); con
`--aplicar` sincroniza objetos de todos y después clases de todos, en secuencia, y resume
éxitos y fallos. Lo corre el usuario en SU terminal (usa credenciales de producción).

## Vista previa del editor de marca (`FormularioBranding.tsx`)

Réplica del mismo orden: logo | estado arriba; franja con `sobreFranja` encima solo en `'banda'`;
fila NOMBRE / APELLIDO con los rótulos y un ejemplo ("María" / "Rivera"); QR con "Powered by
Cardly" debajo. Las otras dos réplicas chicas que usan `frentePase` —la del registro del cliente
(`RegistroCliente.tsx`) y la del formulario de comercio del admin (`FormularioComercio.tsx`)—
pasan a mostrar `estado`.

## El apellido

**Migración 0036** (aditiva; se aplica ANTES del deploy, porque el insert del registro la usa):

```sql
alter table clientes
  add column apellido text
    check (apellido is null or (btrim(apellido) <> '' and char_length(apellido) <= 120));
```

**Registro** (`/api/registro`, `RegistroCliente.tsx`, `registrarCliente`):

- Campo **Apellido** obligatorio, validado igual que el nombre (recortado, 1 a 120). Mensaje
  "Apellido inválido".
- Autocompletado `given-name` / `family-name` (hoy `name`, que mete el nombre completo en "Nombre").
- `registrarCliente` recibe el apellido y lo inserta solo al CREAR el cliente (decisión 6).

**Alta por teléfono desde el panel** (`altaPorTelefono`, "Agregar cliente"): Apellido **opcional**.
El dueño que carga a un cliente de delivery puede no saberlo; ahí vale más el cliente cargado que el
campo completo.

**Donde se muestra** (decisión 7): un ayudante `nombreCompleto(nombre, apellido)` para escáner,
Clientes (lista, detalle, buscador — que pasa a buscar también por apellido), admin y CSV (columna
"Apellido" después de "Nombre").

## La portada (`app/page.tsx`)

- Tres modelos nuevos en la tira "Tarjetas para cada negocio": `tarjeta-membresia.webp`,
  `tarjeta-gift-card.webp`, `tarjeta-descuento.webp` (ya convertidos al lienzo 695×1090 de los
  existentes, tarjeta a 661 px de ancho en la misma posición).
- Cada modelo declara su `tipo`, y `TIPOS_SIN_MODELO` se deriva de esos tipos en vez de excluir
  `'sellos'` y `'puntos'` a mano. El cartel pasa a "+3" (cashback, prepago, cupón) solo.
- La nota debajo de la tira se mantiene: con el pase nuevo, el logo, el estado, los nombres y el
  código se ven como en las ilustraciones; el fondo sigue siendo un color sólido.

## Pruebas

- `frentePase`: la tabla completa de arriba, fila por fila (incluidos el último día y el día
  siguiente); `sobreFranja` en los tres estados de franja; titular con y sin apellido, y con blancos.
  **Mutaciones**: escribir el nombre del pase también en `'propia'`; usar la fecha larga; tomar
  "VÁLIDO HASTA" con `>` en vez del `sigueVigente`.
- `formatearFechaCorta`: formato y ausencia de corrimiento de día.
- Apple: header/primary/secondary por caso, `altText`, un solo formato QR con el mismo `message`.
- Google: módulos por caso, `alternateText`, hero con franja propia en un tipo que no es sellos,
  plantilla de dos filas en la clase. **Mutación**: invertir filas.
- Registro: apellido guardado al crear; NO se escribe sobre un cliente existente (**mutación**:
  completarlo si está vacío); rechazo de apellido vacío o de 121 caracteres en la ruta.
- CSV: encabezado exacto con la columna nueva. Buscador de Clientes por apellido.
- `e2e/registro.spec.ts` completa el apellido.
- Portada y vistas previas: medición en el navegador (sin pruebas de componente en el repo).

## Riesgos que solo se cierran en un teléfono

- **Google con un ítem vacío** (descuento sin estado, cliente sin apellido): se espera que Google
  oculte el ítem; si deja un hueco, se ajusta la plantilla. Se verifica en el comercio de prueba de
  Daniel en un Android — no se crean clases de QA contra el emisor real.
- **Los módulos referenciados en filas pueden repetirse en los detalles** de Google. Aceptable; si
  molesta, se agrega un `detailsTemplateOverride` en otra entrega.
- **Esquina del logo en Apple**: un logo muy ancho recorta el estado. La fecha corta existe para eso.

## Fuera de alcance

- Push masivo a los pases de Apple instalados (decisión 10).
- Que el cliente edite su nombre o apellido después de registrarse.
- Regla de "Powered by Cardly" por plan.
- Cambiar el reporte de mejores clientes o el saludo del portal.

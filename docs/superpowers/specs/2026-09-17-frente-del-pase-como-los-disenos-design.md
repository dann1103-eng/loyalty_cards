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

9. **Orden de entrega (aprobado), con Google partido en DOS deploys:** migración 0036 → registro →
   `frentePase` → Apple → objetos de Google → vista previa → escáner/Clientes/CSV → portada → suite,
   navegador, **deploy A** → script de OBJETOS → **deploy B** (la plantilla de filas en
   `construirClase`) → script de CLASES. La plantilla no puede salir en el deploy A: la clase se
   actualiza sola en cada registro (`app/api/registro/route.ts`, `syncClaseComercio`), en cada
   "Agregar a Google Wallet" (`linkGuardar`) y en cada guardado de marca, mientras que un objeto solo
   cambia cuando se opera su tarjeta. Con la plantilla ya puesta y objetos viejos, esas tarjetas se
   verían con filas vacías y sin contador. (Ver "Orden de despliegue" en la sección de Google.)

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
| Cupón usado (con o sin fecha: USADO GANA, como en `describirSaldo`) | CUPÓN · Usado | ″ |
| Gift card, cashback | SALDO · $50.00 | ″ |
| Puntos | PUNTOS · 1250 (en Apple con el separador del teléfono; en Google sin separador) | ″ |
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

`frentePase` recibe **qué hay DE VERDAD en la franja** en vez de `hayGrilla`:

- `'propia'`: la imagen de franja del comercio **llegó al pase**.
- `'grilla'`: sellos con meta, sin franja propia, y la grilla compuesta existe.
- `'banda'`: cualquier otro caso — la banda de marca (con o sin foto), o no hay franja porque la
  composición o la descarga fallaron.

"Llegó al pase" y no "el comercio subió una": si la descarga de la franja propia falla,
`componerStrips` devuelve null y el pase sale SIN franja. Tratarlo como `'propia'` dejaría una
tarjeta sin franja y sin nombre del pase hasta la próxima operación del cliente.

| Consumidor | `'propia'` | `'grilla'` | `'banda'` |
|---|---|---|---|
| Apple | `stripUrl && strips !== null` | sellos con meta `&& !stripUrl && strips !== null` | el resto |
| Google | `stripUrl && heroImageUrl` | sellos con meta `&& !stripUrl && heroImageUrl` | el resto |
| Vista previa del editor | `urls.strip` | sellos con meta configurada `&& !urls.strip` | el resto |
| Réplica del registro (`RegistroCliente`) | — | — | siempre `'banda'` (hoy `hayGrilla: false`) |
| Réplica del admin (`FormularioComercio`) | — | sellos con meta de demo (hoy `hayGrilla: true`) | el resto |

La fila de Google corrige de paso una asimetría: hoy calcula `hayGrilla` sin mirar la franja propia.

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
`apellidoCliente: string | null`, todas OBLIGATORIAS (un consumidor nuevo tiene que decidir cada
una). Nombre y apellido se recortan; vacío vale null; apellido sin nombre no produce titular. Las
réplicas chicas del registro y del admin pasan `null` en los dos: solo muestran `estado`.
`CampoFrente` conserva `numero` (Apple `numberStyle` y el `balance.int` de `loyaltyPoints` en Google,
que sale de `listado`).

`primario`, `secundario` y `encabezado` **desaparecen**: dejarlos convive con la trampa de que un
consumidor siga leyendo el lugar viejo. El compilador marca a cada uno.

**La etiqueta del estado depende del tipo Y del estado**, así que hay una rama por estado de la
fecha (vigente / vencida / sin fecha / usado) y dentro de cada rama la etiqueta sale de una tabla
por tipo: `VÁLIDO HASTA` y `VENCIÓ EL` son comunes a membresía y cupón; sin fecha y usado usan el
nombre del tipo (`MEMBRESÍA`, `CUPÓN`). Un tipo con vigencia nuevo tiene que agregarse a la tabla o
no lleva estado — nunca hereda "MEMBRESÍA". Los tipos con contador siguen saliendo de `contadorPase`.

La fecha corta sale de una función nueva `formatearFechaCorta('2026-10-16') → '16/10/2026'`, por
recorte de texto (sin `Date`: no hay zona horaria que la corra un día).

"Powered by Cardly" es una constante exportada (`PIE_CODIGO`) que usan Apple, Google y la vista
previa.

## Apple (`lib/apple/generatePass.ts`)

- `estado` → `headerFields` (`key: 'estado'`), con `numberStyle: 'PKNumberStyleDecimal'` cuando
  `numero !== null` (el esquema de passkit-generator lo admite en cualquier campo).
- `sobreFranja` → `primaryFields` (`key: 'nombre_pase'`, sin rótulo).
- `titular` → `secondaryFields`: `{ key: 'nombre', label: 'NOMBRE' }` y, si hay apellido,
  `{ key: 'apellido', label: 'APELLIDO', textAlignment: 'PKTextAlignmentRight' }`.
- `setBarcodes` pasa de string a objeto, con TODOS los campos explícitos:
  `{ format: 'PKBarcodeFormatQR', message: qrToken, messageEncoding: 'iso-8859-1', altText: PIE_CODIGO }`.
  `format` y `message` son obligatorios en el esquema, y `filterValid` DESCARTA en silencio un
  código mal formado: el pase saldría sin QR y sin error. La prueba afirma exactamente UN código.
  Hoy el string genera cuatro formatos sin `altText`; Wallet usa el primero que soporta (QR), así que
  quedarse solo con QR no cambia lo que escanea el cajero.
- `DatosPass` suma `apellidoCliente: string | null`; `datosPassDeTarjeta` lee
  `clientes(nombre, apellido)`. Las pruebas que arman `DatosPass` a mano (`generatePass.test.ts`,
  `pesoPass.test.ts`) lo agregan.

## Google (`lib/google/**`)

**Objeto** (`construirObjeto`, compartido por `syncObjetoTarjeta` y `generarLinkGuardar`):

- `TarjetaParaObjeto` suma `nombreCliente`, `apellidoCliente` y `stripUrl: string | null` (el dato
  crudo); la franja se resuelve ADENTRO de `construirObjeto` con la tabla de arriba. `syncObjeto` y
  `linkGuardar` leen `clientes(nombre, apellido)` y ya tienen `marca.stripUrl`.
- `textModulesData` con ids fijos, cada uno solo si su dato existe:
  - `nombre_pase`: header `'Tarjeta'` (el de hoy), body = `sobreFranja`;
  - `estado`: header = etiqueta, body = valor (texto; Google no le pone separador de miles a un
    texto, así que 1250 puntos se leen "1250" en Android y con separador en iPhone — aceptado);
  - `nombre`: header `'NOMBRE'`; `apellido`: header `'APELLIDO'`.
- `barcode.alternateText = PIE_CODIGO`.
- `heroImage` cuando la franja es `'grilla'` **o `'propia'`** (decisión 8), con la URL versionada.
  **Con franja propia, la versión NO incluye puntos ni meta**: la imagen son los bytes de la franja
  y no cambia al operar, y con los puntos en el hash Google volvería a bajar hasta 2 MB en cada
  compra de una gift card. La versión la calcula UN ayudante compartido,
  `versionHeroTarjeta(marca, puntos, selloMeta)` en `heroUrl.ts` (con `stripUrl` ignora puntos y
  meta), que usan `syncObjeto` y `linkGuardar`: si los dos caminos armaran distinto el `?v=`, Google
  volvería a bajar la imagen en cada JWT. Una prueba lo fija.
- `loyaltyPoints` desde `listado` y `validTimeInterval`, sin cambios.

**Clase** (`construirClase`, compartida por `syncClaseComercio`, `syncClasePrograma` y
`generarLinkGuardar`): `classTemplateInfo.cardTemplateOverride.cardRowTemplateInfos` con DOS filas
`twoItems`, cada ítem con `firstValue.fields: [{ fieldPath }]`:

1. `object.textModulesData['nombre_pase']` | `object.textModulesData['estado']`
2. `object.textModulesData['nombre']` | `object.textModulesData['apellido']`

Según la documentación de plantillas de tarjetas de lealtad de Google, el hero se dibuja después de
la primera fila cuando hay más de una: el orden queda estado → franja → nombres → QR, como en los
diseños. La plantilla REEMPLAZA las filas por defecto (puntos, nombre de socio).

### Orden de despliegue (obligatorio)

Dos deploys, porque la clase se actualiza sola en cada registro, cada "Agregar a Google Wallet" y
cada guardado de marca (decisión 9):

1. **Deploy A**: todo menos la plantilla. Los objetos que se toquen desde ahí salen con los módulos
   nuevos; con la plantilla por defecto, esos módulos aparecen abajo en los detalles (inocuo).
2. **Script, fase objetos** (ver abajo), repetida hasta terminar con **0 fallos**.
3. **Deploy B**: solo la plantilla en `construirClase`. **No se hace mientras la fase objetos tenga
   fallos**: apenas sale, cada registro, guardado de marca y "Agregar a Google Wallet" le pone la
   plantilla a la clase, corra o no el script, así que el control tiene que estar ANTES del deploy.
4. **Script, fase clases**, corrida desde el commit del deploy B (el script usa el `construirClase`
   de la copia local, no el desplegado).

### Script `scripts/actualizar-frente-google.ts`

Ejecución: `npx tsx --conditions=react-server scripts/actualizar-frente-google.ts <objetos|clases> [--aplicar]`.

- **Aborta** si `NEXT_PUBLIC_BASE_URL` no es `https://` o apunta a `localhost`: Google rechaza el
  patch ENTERO con `400 Image cannot be loaded` si las URLs de imagen no son públicas.
- Sin `--aplicar` es un **ensayo**: imprime cuántos comercios, clases y objetos tocaría, y termina.
- **Fase `objetos`**: solo tarjetas con `google_object_id is not null` (la consulta de
  `scripts/resincronizar-objetos-google.ts`). Nunca `syncObjetosComercio`, que no filtra y
  CREARÍA objetos. En secuencia, con `syncObjetoTarjeta`. Resume éxitos y fallos por comercio.
- **Fase `clases`**: `syncClaseComercio` solo para comercios con `google_class_id`, y para las de
  programa, `syncClasePrograma` SOLO sobre programas con `google_class_id` (sobre todos crearía
  clases permanentes), leyendo su resultado para contar éxitos y fallos.
  `syncClasesDeProgramasConClase` no sirve acá: devuelve `void` y solo loguea. La protección de las
  tarjetas no está en esta fase sino en la condición del deploy B.
- Lo corre el usuario (o el asistente con su autorización explícita en el chat): toca los pases
  reales de todos los clientes.

## Vista previa del editor de marca (`FormularioBranding.tsx`)

Réplica del mismo orden: logo | estado arriba; franja con `sobreFranja` encima solo en `'banda'`;
fila NOMBRE / APELLIDO con los rótulos y un ejemplo ("María" / "Rivera"); QR con "Powered by
Cardly" debajo. Las réplicas chicas del registro (`RegistroCliente.tsx`) y del admin
(`FormularioComercio.tsx`) pasan a mostrar `estado` (ver la tabla de franjas para su `franja`).

## El apellido

**Migración 0036** (aditiva; se aplica ANTES del deploy, porque el insert del registro la usa):

```sql
alter table clientes
  add column apellido text
    check (apellido is null or (btrim(apellido) <> '' and char_length(apellido) <= 120));
```

**`registrarCliente(supabase, comercioId, programaId, nombre, apellido, telefono)`**: `apellido:
string | null`, OBLIGATORIO en la firma y ya limpio (recortado, vacío → null); cada llamador (ruta,
alta por teléfono, seed, pruebas) decide. Se inserta solo al CREAR el cliente (decisión 6). Un `''`
que llegara igual rompería el alta entera con 23514, así que la limpieza vive en los llamadores y
una prueba fija que un apellido en blanco llega como null.

**Ruta `/api/registro`**, espejo exacto del nombre:

- `typeof apellido !== 'string'` o `!apellido` → 400 `'Faltan datos'` (como el nombre);
- recortado vacío o más de 120 → 400 `'Apellido inválido'`.

**Formulario del registro** (`RegistroCliente.tsx`): campo "Apellido" obligatorio (`required`,
`maxLength={120}`, placeholder "Tu apellido") debajo de "Nombre"; autocompletado `given-name` /
`family-name` (hoy `name`, que mete el nombre completo en "Nombre"); el body del fetch suma
`apellido`.

**Alta por teléfono desde el panel** (`lib/comercio/altaPorTelefono.ts`,
`clientes/agregar/actions.ts`, `FormularioAgregarCliente.tsx`): Apellido **opcional**
(`maxLength={120}`, sin `required`). `altaPorTelefono` lo recorta; vacío → null; más de 120 →
`'El apellido puede tener hasta 120 caracteres.'` sin llamar a `registrarCliente`.

**Donde se muestra** (decisión 7):

- Ayudante puro `nombreCompleto(nombre, apellido)` (con apellido null devuelve el nombre) para el
  escáner (`buscarTarjetaPorToken`), la lista y el detalle de Clientes, y la lista de clientes del
  admin.
- El buscador de Clientes sale de `clientes/page.tsx` a una función pura
  `coincideBusqueda(cliente, q)` que mira nombre, apellido y teléfono, para poder probarla.
- CSV: columna **"Apellido" aparte**, después de "Nombre" (NO pasa por `nombreCompleto`; vacía si
  no hay).

## La portada (`app/page.tsx`) — commit propio

- Tres modelos nuevos en la tira "Tarjetas para cada negocio": `tarjeta-membresia.webp`,
  `tarjeta-gift-card.webp`, `tarjeta-descuento.webp` (ya convertidos al lienzo 695×1090 de los
  existentes, tarjeta a 661 px de ancho en la misma posición).
- Cada modelo declara su `tipo`, y `TIPOS_SIN_MODELO` se deriva de esos tipos en vez de excluir
  `'sellos'` y `'puntos'` a mano. El cartel pasa a "+3" (cashback, prepago, cupón) solo.
- La nota debajo de la tira **no cambia de texto**.

## Pruebas

- `frentePase`: la tabla completa, fila por fila (incluidos el último día y el día siguiente, y el
  cupón usado con fecha); `sobreFranja` en los tres estados de franja; titular con y sin apellido,
  con blancos y con apellido sin nombre. **Mutaciones**: escribir el nombre del pase también en
  `'propia'`; usar la fecha larga; poner la fecha antes que "usado" en el cupón.
- `formatearFechaCorta`: formato, y sin corrimiento de día con `TZ` de América.
- Apple: header/primary/secondary por caso, `altText`, exactamente un código QR con el mismo
  `message`; la franja `'banda'` cuando la franja propia no bajó. **Mutación**: `'propia'` solo por
  `stripUrl`.
- Google: módulos por caso, `alternateText`, hero con franja propia en un tipo que no es sellos, y su
  versión sin puntos (`versionHeroTarjeta`); plantilla de dos filas en la clase (deploy B).
  **Mutación**: invertir filas.
- Script: el guardián de `NEXT_PUBLIC_BASE_URL` en una función pura probada.
- Registro: apellido guardado al crear; NO se escribe sobre un cliente existente (**mutación**:
  completarlo si está vacío); `'Faltan datos'` y `'Apellido inválido'` en la ruta; alta por teléfono
  con apellido vacío (null) y con 121 caracteres.
- `nombreCompleto`, `coincideBusqueda` (por apellido) y el encabezado exacto del CSV.
- `e2e/registro.spec.ts` completa el apellido.
- Portada y vistas previas: medición en el navegador (sin pruebas de componente en el repo).

## Riesgos que solo se cierran en un teléfono

- **Google con un ítem vacío** (descuento sin estado, cliente sin apellido): se espera que Google
  oculte el ítem; si deja un hueco, se ajusta la plantilla. Se verifica en el comercio de prueba de
  Daniel en un Android — no se crean clases de QA contra el emisor real.
- **Los módulos referenciados en filas pueden repetirse en los detalles** de Google. Aceptable; si
  molesta, se agrega un `detailsTemplateOverride` en otra entrega.
- **`hero.png` sirve los bytes crudos de la franja propia con `Content-Type: image/png`** aunque el
  archivo sea JPG o WebP. En sellos ya pasaba; en los demás tipos es nuevo. Y Google rechaza el
  patch ENTERO si no puede cargar la imagen: una franja que no acepte no deja "sin franja", deja el
  objeto sin crear o sin actualizar el saldo. **El riesgo arranca con el deploy A** (que es el que
  activa el hero con franja propia en todos los tipos), no con el B. Antes del deploy A, el
  controlador lista en producción (solo lectura) los programas que NO son de sellos y tienen franja
  propia efectiva y tarjetas con objeto en Google, y el tipo de archivo de esas franjas: si hay
  alguno, se prueba esa URL de `hero.png` contra Google con su tarjeta antes de publicar.
- **Objeto creado solo por el JWT** (cuando `syncObjetoTarjeta` falló en `linkGuardar`): existe en
  Google con `google_object_id` null en la base, el script no lo ve y queda con filas vacías tras el
  deploy B. No se arregla solo: al operar, `syncObjetoTarjeta` intenta crearlo con el mismo id fijo,
  Google responde que ya existe y el error se atrapa. Queda así hasta repararlo aparte; hueco
  conocido, fuera de esta entrega.
- **Esquina del logo en Apple**: un logo muy ancho recorta el estado. La fecha corta existe para eso.

## Fuera de alcance

- Push masivo a los pases de Apple instalados (decisión 10).
- Que el cliente edite su nombre o apellido después de registrarse.
- Regla de "Powered by Cardly" por plan.
- Cambiar el reporte de mejores clientes o el saludo del portal.

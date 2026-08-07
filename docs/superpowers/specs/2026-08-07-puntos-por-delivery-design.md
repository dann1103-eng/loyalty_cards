# Puntos para pedidos a domicilio — diseño

> Nace del pedido del 2026-08-07. El dueño quiere que un cliente que compra por delivery acumule sin
> que el comercio tenga que hacerlo a mano por cada pedido. La idea que traía era imprimir un QR con
> un punto ya asignado en el ticket del pedido.
>
> Este documento es DISEÑO, no plan de implementación. Su trabajo es contestar qué se construye
> primero y por qué, porque acá elegir mal cuesta más que escribirlo.

## 1. El hueco real, verificado en el código

`registrarCliente` tiene UN solo llamador: `app/api/registro/route.ts`, o sea el formulario que abre
el cliente después de escanear el QR del local.

**Un comercio no tiene hoy ninguna forma de darle una tarjeta a alguien que no está parado enfrente.**
Puede buscar y acreditarle a quien YA tiene tarjeta (`/comercio/clientes` → escáner), pero al cliente
nuevo de delivery no puede ni darle de alta.

Ese es el hueco, y es más chico que el problema que parecía.

## 2. La pregunta que ordena todo: ¿el comercio sabe quién compró?

Las tres opciones que se venían barajando (QR desde el POS, QR desde impresora térmica, alta por
teléfono) mezclan dos problemas distintos. Separarlos deja ver que **el QR solo hace falta en uno**:

| Caso | ¿Sabe el teléfono? | Qué hace falta |
|---|---|---|
| Pedido por llamada o WhatsApp | **Sí**, lo tiene en la mano | Una pantalla para dar de alta y acreditar por teléfono |
| App propia del comercio | **Sí** | Lo mismo |
| App de delivery que comparte el número | **Sí** | Lo mismo |
| App de delivery que NO lo comparte | **No**, el cliente es anónimo | Un código al portador que el cliente reclama |

El caso difícil —y el único que necesita el QR— es el último. El dueño lo dijo con todas las letras:
*"para los deliveries es difícil saber a quién tiene que caerle el correo, porque no se suele dar
información de quién está comprando"*.

**Conclusión: hay dos features, no una, y la barata cubre la mayoría de los pedidos.**

## 3. Qué se construye, en orden

### v1 — Alta y acreditación por teléfono desde el panel (sin migración)

Una pantalla donde el dueño escribe el teléfono del cliente y cuánto acreditarle. Si ese teléfono ya
tiene tarjeta en el comercio, acredita sobre la que existe; si no, la crea y acredita.

Reusa `registrarCliente` + `acreditarPuntos` tal cual. Eso **no es ahorro de tipeo, es la garantía**
de que la acreditación por delivery herede la atribución de sucursal y cajero, el ledger y los cuatro
controles antifraude de la Tanda 1. Escribir un camino propio sería duplicar esas reglas, y dos
copias de una regla terminan divergiendo — pasó con `venderPaquete` leyendo la columna equivocada.

Cubre pedidos por llamada, por WhatsApp, por app propia y por toda app de delivery que comparta el
número. **Cero migración, cero tablas nuevas.**

### v2 — Código al portador (necesita migración)

Para el cliente anónimo. El comercio genera códigos de un solo uso; los imprime como quiera (en el
ticket del POS, en una impresora térmica aparte, o pegados a mano). El cliente escanea, se identifica
con su teléfono, y el punto cae en su tarjeta.

**No se integra con ningún POS.** Un código es una URL y un QR: cualquier sistema que pueda imprimir
un texto puede imprimirlo, y el que no, se imprime aparte. Integrarse con los puntos de venta de El
Salvador —un universo fragmentado, uno por comercio— es un proyecto entero y no puede ser el primero.

## 4. El hallazgo bloqueante: un código al portador se puede fotografiar

**Un QR con un punto ya asignado es dinero al portador.** Quien lo escanea se lo lleva. Si el cliente
lo fotografía y lo manda a un grupo, se lo llevan todos los del grupo. Si el repartidor le saca una
foto antes de entregarlo, se lo lleva él.

Esto no es un riesgo teórico que se mitiga con una advertencia: es la propiedad central del diseño y
determina el esquema. Sin resolverlo, esta feature es un agujero de fraude más grande que el que
cerró la Tanda 1 — y peor, uno que el dueño no puede ver, porque cada canje se ve legítimo.

Lo que exige, y por qué cada cosa:

1. **Un solo uso, garantizado por la base y no por un `if`.** El candado va en el `where usado_en is
   null` del propio UPDATE, igual que `usar_cupon_atomico` (0019) y `canjear_recompensa_atomico`
   (0009). Bajo READ COMMITTED el segundo update bloquea, re-lee la fila nueva y re-evalúa el where
   (EPQ), así que dos personas escaneando el mismo código a la vez no pueden cobrarlo dos veces. Un
   `select` previo y un `if` sí se colarían.
2. **Vencimiento corto.** Un código que no vence es un billete al portador que circula para siempre.
   Vence junto con el pedido: horas, no meses. El default propuesto es 48 h, editable por el comercio.
3. **Código impredecible.** `encode(gen_random_bytes(16), 'hex')`, el mismo generador que
   `tarjetas.qr_token` (0001). Un correlativo se adivina y se cobra sin haber comprado nada.
4. **Scope por programa.** El código pertenece al programa que lo emitió; reclamarlo contra otro
   comercio no puede funcionar.
5. **La acreditación pasa por `acreditarPuntos`**, así que los topes antifraude aplican solos. Un
   comercio que emite mil códigos por error sigue chocando contra el techo por transacción.

**Lo que el diseño NO puede evitar:** que la persona equivocada lo reclame primero. Un código al
portador es, por definición, de quien lo tiene. Se acota (un uso, poco tiempo, poco valor) pero no se
elimina. **Eso hay que decírselo al dueño en la pantalla donde los genera**, no enterrarlo acá.

## 5. Por qué el correo no reemplaza al QR

Se barajó mandarlo por correo. No sirve para el caso difícil por la misma razón que lo hace difícil:
si el comercio no sabe quién compró, tampoco sabe a qué correo mandarlo. Y donde sí sabe el correo,
casi siempre sabe también el teléfono — y ahí ya alcanza v1, sin código ninguno.

## 6. Esquema propuesto para v2

```sql
create table codigos_reclamo (
  id uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references comercios(id),
  programa_id uuid not null references programas_tarjeta(id),
  -- Impredecible, como tarjetas.qr_token (0001). Un correlativo se adivina.
  codigo text not null unique default encode(gen_random_bytes(16), 'hex'),
  -- Cuánto vale, en la unidad del programa (ver lib/tarjetas/unidadPrograma.ts). Mismo contador
  -- universal que puntos_actuales: en sellos son sellos, en gift card son CENTAVOS.
  valor integer not null check (valor > 0),
  expira_en timestamptz not null,
  -- El candado del uso único. Nunca se lee con un select previo: va en el where del UPDATE.
  usado_en timestamptz,
  usado_por_tarjeta_id uuid references tarjetas(id),
  creado_por_usuario_id uuid references usuarios_comercio(id),
  created_at timestamptz not null default now()
);
create index codigos_reclamo_comercio_idx on codigos_reclamo (comercio_id, created_at desc);
```

`valor` en la unidad del programa y no en "puntos": los ocho tipos comparten el contador entero y su
significado depende del tipo — la lección de `formatearSaldo` y de `unidadPrograma`.

## 7. Fuera de alcance, y por qué

- **Integración con POS.** Ver §3. Un código es una URL: el que pueda imprimir texto ya está
  integrado. Se evalúa cuando haya un comercio real pidiéndolo, no antes.
- **Que el código lo emita el POS solo, por cada pedido.** Es la integración de arriba con otro
  nombre.
- **Códigos con valor variable según el monto del pedido.** Requiere que el POS mande el monto, o sea
  integración. En v2 el dueño elige el valor al generar.

## 8. DECISIÓN (2026-08-07): v2 NO se construye

Daniel lo zanjó el mismo día: **no hay ningún comercio real pidiendo acreditar a distancia**, y su
lectura es que muy pocos lo van a pedir más allá de lo que ya existe — otorgar en vivo, con el
cliente presente.

Así que **v1 se construyó y v2 queda diseñado sin implementar**. Es la decisión correcta y conviene
que quede escrita, porque el costo de v2 no es el de escribirlo: es una tabla más, un camino de
acreditación más, y **una superficie de fraude nueva que el diseño acota pero no cierra** (un código
al portador es, por definición, de quien lo tiene). Abrir eso sin un usuario que lo pida es pagar un
riesgo permanente por una función que nadie usa.

**Si algún día un comercio lo pide, lo primero que hay que preguntarle es POR QUÉ APP entran sus
pedidos.** Si esa app le comparte el teléfono del cliente —y la mayoría lo hace— v1 ya lo resolvía y
no hace falta construir nada. El QR solo se justifica con una app que oculte al comprador.

Este documento queda entonces como diseño listo para retomar: el esquema de §6 y las cinco
propiedades de seguridad de §4 no hay que volver a pensarlas.

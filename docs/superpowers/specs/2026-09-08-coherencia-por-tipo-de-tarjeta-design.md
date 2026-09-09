# Coherencia por tipo de tarjeta en todo el panel, y la identidad del pase de membresía

Fecha: 2026-09-08
Estado: diseño aprobado por el usuario en conversación (alcance completo); pendiente de plan

## Por qué

Daniel siguió con la cuenta nueva de **membresía** que usó para el editor de marca. Terminada la
personalización, el panel le seguía hablando de sellos y de puntos: el tutorial le pedía "Definí
cómo se ganan los sellos" y "Cargá tu primer premio", y una métrica gigante decía "PUNTOS
VIGENTES 0". Pidió auditar TODO para que el panel sea coherente con el programa contratado.

La auditoría encontró **38 lugares** incoherentes, repartidos en tres clases. El patrón es siempre
el mismo: una rama **binaria** (`esSellos ? … : …`, `tipo === 'puntos'`) sobre un catálogo de
**ocho** tipos, o una lectura del contador universal `tarjetas.puntos_actuales` sin mirar qué
significa en ese tipo.

**Lo que hace este trabajo distinto de un barrido de textos:** el repositorio YA tiene resuelto el
problema en un puñado de módulos puros (`contadorPase`, `frentePase`, `describirFila` +
`COLUMNAS_ESTADO`, `unidadPrograma`/`describirCosto`, `ETIQUETA_PRINCIPAL`). Casi todos los
hallazgos son consumidores que no los usan, a veces a dos líneas de distancia de donde sí se usan.
La corrección no es escribir lógica nueva: es **hacer imposible no pasar por ella**.

## Los tres defectos que el usuario ve, y por qué son la punta del ovillo

1. **El tutorial es imposible de completar.** El paso "reglas" se marca hecho con una fila en
   `reglas_puntos`, pero la pantalla de Reglas le dice a una membresía "Tu tarjeta no se gana con
   sellos ni con puntos, así que no necesita estas reglas". Nunca va a crear una, así que el
   checklist queda clavado en **1 de 4 para siempre** (`PrimerosPasos.tsx` solo se esconde con los
   cuatro hechos) insistiendo con algo que la app misma le dijo que no necesita.
2. **"Puntos vigentes" suma peras con manzanas.** `panel/page.tsx` suma `puntos_actuales` de TODAS
   las tarjetas del comercio sin mirar el tipo del programa de cada una. En membresía siempre da
   cero; en gift card y cashback esa columna son **centavos**, así que $1 250,00 circulantes se
   muestran como "125000 puntos"; en un comercio con dos programas de tipos distintos el número no
   es interpretable en ninguna unidad.
3. **El pase de una membresía no dice si está activa.** `contadorPase` devuelve `null` para
   contador `'ninguno'`, y `DatosPass` ni siquiera lleva `vigencia_hasta`. El frente del pase
   muestra logo, franja y el nombre del cliente, nada más. Mientras tanto el borrador de términos
   que la propia app genera dice: *"La membresía vale hasta la fecha que aparece en la tarjeta"* —
   una fecha que no aparece en ninguna parte. Lo mismo para el cupón.

4. **La pantalla que ve el CLIENTE al registrarse es ciega al tipo Y a la marca.** Daniel la
   fotografió desde su teléfono el 2026-09-08, después de personalizar su marca: dice *"empieza a
   sumar puntos"* y muestra una tarjeta de muestra que dice **"TARJETA DE LEALTAD"** y **"0
   PUNTOS"** sobre un **degradado marrón fijo** (`RegistroCliente.tsx:31-33`), en un comercio cuya
   marca es azul. La causa es que `app/registro/[comercioSlug]/page.tsx` solo consulta
   `select('id, nombre')`: el componente no recibe ni el tipo ni los colores ni el logo. O sea que
   el dueño configura su marca y **la primera pantalla que su cliente ve no la usa**. Es el
   hallazgo más caro de la auditoría en términos de percepción: es el momento de la conversión.

## Decisiones

1. **La unidad y el estado se leen SIEMPRE por los módulos existentes.** Ningún consumidor imprime
   `puntos_actuales`, `puntos_delta` ni `puntos_totales` crudos. Pasan por `describirFila`
   (estado de una tarjeta), `describirCosto` (un costo o un delta) o `contadorPase`/`frentePase`
   (lo que va en el pase y en cualquier réplica suya).

2. **Los agregados que mezclan tipos no se muestran: se parten por programa, y cada tipo tiene su
   pregunta.** La métrica del panel deja de ser una suma global. Un número que suma centavos con
   sellos no se arregla con una etiqueta mejor: no existe la etiqueta correcta.

   `describirFila` NO sirve acá: describe UNA tarjeta, no un agregado. Y para los tres tipos con
   contador `'ninguno'` no hay nada que sumar. Entonces el agregado es un módulo puro nuevo,
   `lib/tarjetas/resumenPrograma.ts`, con **una pregunta por familia de tipo**:

   | Familia | Qué se muestra | Ejemplo |
   |---|---|---|
   | contador `'entero'` (puntos, sellos, prepago) | la suma, en su unidad | "1 240 sellos · sin canjear" |
   | contador `'centavos'` (gift card, cashback) | la suma con `formatearCentavos` | "$1 250.00 · saldo circulante" |
   | `usaVigencia` (membresía, cupón) | CUÁNTAS siguen vigentes hoy, contra el total | "12 activas · de 15" |
   | descuento | cuántos clientes ya alcanzaron un nivel | "8 con descuento · de 40" |

   Para una membresía "cuántos socios activos tengo" es LA métrica del negocio, así que la carta no
   se esconde: cambia de pregunta. La función es pura y recibe `hoyIso` (mismo criterio que
   `describirSaldo`), y las filas llegan con `COLUMNAS_ESTADO`.

3. **El tutorial se DERIVA del tipo del programa principal.** `PASOS` deja de ser una constante y
   pasa a ser una función del tipo. Cada tipo recibe pasos que **puede completar**, y ninguno
   apunta a una pantalla que le va a decir que eso no aplica. Se conserva la propiedad que el
   módulo ya documenta y que es su mejor idea: el estado se deriva de los datos reales, nunca se
   guarda.

4. **Los reportes CUENTAN operaciones; lo que SUMAN no se toca.** El ledger distingue
   `acreditacion`, `ajuste`, `canje`, `uso` y `renovacion` (0019). Las funciones de reporte (0015 y
   0010) filtran `tipo = 'acreditacion'`, así que para una membresía **todo el módulo de reportes
   está estructuralmente en cero**, incluida la pantalla antifraude por cajero: es ciega frente a
   un cajero que regala renovaciones.

   La corrección se parte en dos, y la distinción es lo más importante de esta decisión:

   - **`count(*)` pasa a `tipo in ('acreditacion','uso','renovacion')`.** Una operación es lo que el
     cajero le hizo a una tarjeta de cara al cliente. Puntos y sellos NO cambian (nunca generan
     `uso` ni `renovacion`); gift card y prepago SÍ empiezan a contar sus consumos, que es lo
     correcto y hay que anunciarlo como cambio visible.
   - **`sum(puntos_delta)` se queda EXACTAMENTE como está**, filtrada a `'acreditacion'`. Un `uso`
     NO lleva delta cero: lleva `-1` en prepago (0020) y `-monto` en gift card (0022). Meterlo en
     la suma convertiría el total de BRUTO a NETO y desharía la decisión explícita de la 0015 (que
     el fraude no se autoborre del reporte). Una suma que mezcla lo otorgado con lo consumido no
     sirve para juzgar a un cajero.

   La columna `acreditaciones` **se renombra a `operaciones`**, porque un nombre que ya no describe
   lo que cuenta es la trampa que este trabajo entero combate. Renombrar cambia el tipo de retorno,
   así que `create or replace` NO alcanza: la migración hace `drop function` + `create` + **volver
   a otorgar los `grant … to service_role`** que dan la 0010 y la 0015, todo dentro de la misma
   transacción, y `lib/reportes/reportes.ts` actualiza sus tipos derivados de `Database[...]`.
   Alcanza a `reporte_sucursales`, `reporte_top_clientes`, `reporte_tendencia`,
   `reporte_cajeros` y `reporte_fm_comercios` (esta última alimenta el panel de FM, y entra: si no,
   FM ve cero actividad en cada comercio de membresía de la plataforma).

5. **Una sección que no puede funcionar no ocupa un lugar en la barra.** En los tipos con contador
   `'ninguno'` (cupón, membresía, descuento) un canje descuenta de un contador que nunca se mueve:
   **ninguna recompensa se puede canjear jamás**. En esos tipos, Premios y Programas **cambian de
   superficie**: Premios sale de la barra y baja al menú, y Programas sube del menú a la barra, en
   la misma posición. No es "esconder Premios": la barra del dueño lleva exactamente cinco destinos
   y el botón de Escanear se centra por estar en la posición 3 de 5; sacar uno lo descentra sin que
   nada se queje (lo dice `navegacion.ts`). Y el intercambio tiene que ser simultáneo porque hoy
   Premios vive SOLO en la barra y Programas SOLO en el menú: duplicar cualquiera de los dos rompe
   la invariante de que las dos superficies no repiten destino.

   Consecuencias que el plan tiene que ejecutar y no dar por resueltas:
   - `enlacesBarraPorRol` **y** `enlacesMenuPorRol` reciben el tipo.
   - El único llamador es `NavInferior`, montado desde `app/comercio/(protegido)/layout.tsx`, que
     hoy NO consulta programas. Hace falta una consulta nueva ahí, o sea en cada pantalla del
     panel: se resuelve con el mismo `listarProgramas` que ya usa el panel, y se mide su costo.
   - La invariante que se prueba es **"Escanear al centro del arreglo devuelto"**, no "cinco
     destinos": el cajero recibe tres y un rol desconocido uno, y las pruebas vigentes ya lo
     afirman. Escribirla como "siempre cinco" es escribir una prueba en rojo.
   - Se conservan las dos pruebas existentes: que barra y menú no repitan destino, y que entre las
     dos sumen las doce secciones.

   En gift card y cashback (contador `'centavos'`) los premios SÍ se canjean: no se toca nada.

6. **El pase gana identidad y vigencia, y las dos por el mismo camino que el frente ya usa.**
   - **Nombre del pase**: columna nueva `programas_tarjeta.nombre_pase`, opcional. Vacío = el pase
     sale como hoy. NO se reusa `programas_tarjeta.nombre`: el programa principal nace llamándose
     como el comercio (0024, `c.nombre`), así que mostrarlo sería repetir el nombre del negocio que
     ya está en el logo.
   - **Vigencia**: `DatosPass` gana `vigenciaHasta`, y `frentePase` deja de devolver `null` para
     cupón y membresía. Devuelve el estado que `describirSaldo` ya sabe redactar ("Activa hasta el
     12 de octubre" y "Vencida el 3 de agosto" en membresía; "Disponible hasta el…" y "Venció el…"
     en cupón). Como `frentePase` lo comparten el pase y la vista previa del editor, el dueño ve
     exactamente lo mismo que su cliente.
   - **`frentePase` gana `hoyIso` en su firma**, por el mismo motivo que `describirSaldo` lo tiene:
     sin fecha por argumento no se puede probar el borde del vencimiento sin congelar el reloj. Sus
     dos llamadores son un módulo de servidor (`generatePass`) y un componente CLIENTE
     (`FormularioBranding`), así que los dos tienen que pasarla.
   - **Google también pasa por `frentePase`.** Hoy `construirRecursos.ts` llama a `contadorPase`
     directo, así que si solo se cambiara Apple la vigencia se decidiría en dos lugares — justo lo
     que el guardarraíl de este spec prohíbe. `loyaltyPointsDe` migra a `frentePase`.
   - **El cache-busting de Google NO aplica acá, y meterlo sería un error.** `versionHero` versiona
     la URL de una IMAGEN y su comentario dice que resume todo lo que altera esa imagen.
     `nombre_pase` y la vigencia viajan en `textModulesData` y `validTimeInterval` del
     `LoyaltyObject`: son campos JSON que se escriben en el patch de la API, no se cachean por URL
     y no cambian un solo píxel. Lo que hace falta es que el objeto se re-sincronice cuando cambian,
     que es lo que ya hace `propagarMarcaPrograma`.
   - **Asimetría conocida entre plataformas, y se documenta en vez de disimularse.** Google recibe
     `validTimeInterval` y marca solo el pase vencido. Apple no (su `expirationDate` está fuera de
     alcance) y su texto solo se refresca cuando llega un push, que hoy ocurre al operar la
     tarjeta. O sea que el pase de Apple de una membresía vencida va a seguir diciendo "Activa
     hasta el 3 de agosto" hasta el próximo escaneo. Es aceptable —el cajero ve el estado real al
     escanear— pero tiene que estar escrito.

7. **`nombre_pase` se edita en Marca, y en modo negocio escribe el programa PRINCIPAL.** Es el
   mismo camino que ya usa la meta de sellos (`guardarBranding` escribe `sello_meta` en el
   principal), y por el mismo motivo: el editor de marca es la pantalla de identidad, y en modo
   negocio no hay selector de programa. No es branding heredable: es identidad del programa, como
   `sello_meta`, así que no entra en `brandingEfectivo` ni en `hayMarcaPropia`.

8. **Los textos cableados se resuelven por TABLA POR TIPO, no por `if`.** El patrón ya existe en el
   repositorio (`ETIQUETA_PRINCIPAL` del escáner, `CTA_POR_TIPO` del cartel, `UNIDADES`): un
   `Record<string, …>` que el compilador y una prueba obligan a cubrir. Un tipo nuevo no puede
   heredar "puntos" por descuido.

## Modelo de datos — migración 0033

```sql
-- 0033: nombre del pase por programa, y reportes que cuentan TODAS las operaciones.
begin;

-- El nombre que el cliente ve en su pase (Apple: headerField; Google: textModulesData). Opcional:
-- null = el pase sale como hasta ahora. NO se reusa `nombre`, que es el rótulo interno del dueño y
-- en el programa principal nace igual al nombre del comercio (0024).
alter table programas_tarjeta
  add column nombre_pase text check (nombre_pase is null or btrim(nombre_pase) <> '');

commit;
```

Las funciones de reporte de la 0015 y la 0010 se **reemplazan** (`create or replace`) para contar
operaciones en vez de solo acreditaciones. El detalle exacto de cada función va en el plan; la
regla es una sola y se escribe una vez en SQL:

```sql
-- Una OPERACIÓN es lo que un cajero le hizo a una tarjeta de cara al cliente: acreditar, usar
-- (cupón, visita de prepago, cobro de gift card) o renovar (membresía). `ajuste` y `canje` quedan
-- fuera porque ya se cuentan por separado en las mismas consultas.
-- Sin esto, un comercio de membresía ve CERO actividad aunque tenga cientos de renovaciones, y la
-- pantalla antifraude por cajero —que existe para detectar a quien regala cosas— es ciega.
tp.tipo in ('acreditacion', 'uso', 'renovacion')
```

`scripts/verificar-0033.ts` (solo lectura, salvo el sondeo del CHECK) verifica la columna nueva y
que una función de reporte cuente una fila `renovacion`.

## Trabajo, por grupos

### Grupo 1 — Los datos falsos que ya tienen su función escrita

| Dónde | Hoy | Pasa a |
|---|---|---|
| `panel/page.tsx` métrica | suma global + `esSellos ? 'Puntos' : 'Sellos'` | una línea por programa activo con `describirFila`/`describirSaldo`; ver decisión 2 |
| `clientes/[tarjetaId]/page.tsx` historial | `+{delta}` / `queda {saldo}` crudos | `describirCosto(tipo, …)`; en contador `'ninguno'` no se imprime número |
| `mi-tarjeta/PortalCliente.tsx` movimientos | idem, **al cliente** | idem |
| `registro/[comercioSlug]/RegistroCliente.tsx` | `<b>0</b><span>Puntos</span>`, `"Tarjeta de lealtad"` y un degradado marrón fijo, sin recibir tipo ni marca | ver Grupo 1-bis |
| `admin/.../FormularioComercio.tsx` | `esSellos ? '0 de 10' : '0'` | `frentePase` |
| `reportes/page.tsx`, `reportes/cajeros/page.tsx` | enteros crudos y celdas vacías | `describirCosto`; y donde quede vacío, no se imprime el separador |
| `exportarClientes.ts` | `describirCosto(tipo, puntos_actuales)` → columna vacía | `describirFila` + `COLUMNAS_ESTADO` en el `select` |
| `historial.ts` | `normalizarClase` colapsa `uso`/`renovacion` en `acreditacion` | clases propias con su etiqueta ("Uso", "Renovación") |
| `escanear/actions.ts:219` **y** `:427` | `cantidad === 1 ? 'Sello agregado.' : …` en LOS DOS (la acreditación normal y el switch por tipo); sumar 1 punto confirma "Sello agregado" | mensaje por unidad del tipo, en una sola función compartida |
| `reglas/FormularioControles.tsx` | `esDePuntos ? 'acreditaciones' : 'sellos'` | `unidadPrograma`, que ya se calcula en `reglas/page.tsx` y no se pasa |

### Grupo 1-bis — La pantalla de registro usa la marca y el tipo (defecto 4)

Es la pantalla que el cliente ve al escanear el QR, y hoy no recibe nada del comercio salvo el
nombre. Se corrige de raíz, no con un texto:

- Las dos páginas de registro YA resuelven el programa completo (con `tipoTarjeta` y `selloMeta`)
  vía `resolverProgramaPorSlug`, y simplemente no se lo pasan al componente. O sea que del tipo no
  falta consultar nada: falta **pasarlo**. Lo único que hay que agregar es el **branding efectivo**
  (`brandingEfectivo`, con las mismas columnas que ya usa el editor de marca).
- `VistaTarjeta` deja de tener el degradado marrón fijo: usa `colorFondo`, `colorTexto` y
  `colorLabel` del comercio, el logo si lo hay, y `frentePase` para el contador. Sin contador no
  dibuja el bloque de número. El rótulo "Tarjeta de lealtad" pasa a ser la etiqueta del tipo
  (`TIPOS`), y el nombre del pase (`nombre_pase`, Grupo 5) si está cargado.
- El copy de conversión (`"empieza a sumar puntos"`, `"suma puntos en cada visita"`) sale de una
  tabla por tipo, con el mismo patrón que `CTA_POR_TIPO` del cartel.

**Guardarraíl:** esta tarjeta de muestra y la vista previa del editor de marca describen la MISMA
cosa. Las dos tienen que salir de `frentePase`; si una de las dos vuelve a inventar su propio
`if`, el dueño diseña algo y su cliente ve otra cosa — que es el defecto que este trabajo entero
está cerrando.

### Grupo 2 — Tutorial por tipo (decisión 3)

`PASOS` pasa a `pasosParaTipo(tipo)`. Cada tipo devuelve cuatro pasos, y el segundo y el tercero
son los que cambian:

| Tipo | Paso 2 | Paso 3 | `hecho` de los pasos 2 y 3 |
|---|---|---|---|
| puntos, sellos | Definí cómo se ganan | Cargá tu primer premio | `reglas_puntos` / `recompensas` activas |
| prepago | Definí cuántas visitas trae el paquete | Cargá tu primer premio | `multipass_visitas` / recompensas |
| cashback | Definí tu porcentaje de cashback | Cargá tu primer premio | `cashback_porcentaje` / recompensas |
| gift card | Cargá tu primer premio | Escribí los términos de tu tarjeta | recompensas / `terminos_uso` |
| membresía | Definí cuánto dura la membresía | Escribí los términos de tu membresía | `membresia_dias` / `terminos_uso` |
| cupón | Definí cuántos días vale el cupón | Escribí los términos de tu cupón | `cupon_vigencia_dias` / `terminos_uso` |
| descuento | Cargá tus niveles de descuento | Escribí los términos | `niveles_descuento` / `terminos_uso` |

**Ningún paso puede colgar de `nombre_pase`.** Es opcional por la decisión 6, y un paso opcional
como condición de completitud dejaría al dueño clavado en "3 de 4" para siempre: exactamente el
defecto 1 que este trabajo cierra. Todos los criterios de la tabla son configuración que el tipo de
verdad necesita.

El `hecho` de cada paso se sigue derivando de los datos reales, nunca se guarda. Dos pruebas
obligatorias: **para los ocho tipos hay exactamente cuatro pasos**, y **todos son alcanzables** (el
destino de cada paso muestra de verdad el formulario que ese paso pide para ese tipo — hoy Reglas
lo esconde para seis de los ocho, que es lo que rompe el tutorial).

### Grupo 3 — Reportes que cuentan operaciones (decisión 4)

Migración de las funciones + UI que rotula por tipo. Donde el monto no signifique nada (contador
`'ninguno'`), la columna se omite en vez de mostrar cero o vacío.

### Grupo 4 — Secciones muertas (decisión 5)

- `navegacion.ts`: `enlacesBarraPorRol(rol)` gana el tipo. Con contador `'ninguno'`, Premios sale y
  entra Programas, **en la misma posición**, para que Escanear siga en el centro. Prueba: la barra
  tiene siempre cinco destinos y Escanear siempre en el índice 2.
- `escanear/actions.ts`: no se traen recompensas cuando el tipo no puede canjearlas. Hoy el cajero
  ve la lista completa con el botón deshabilitado y "le faltan " colgado.
- `recompensas/page.tsx`: con contador `'ninguno'`, un aviso como el que ya tiene Reglas, en vez de
  ofrecer cargar premios que nadie podrá canjear.
- `reglas/page.tsx`: los controles antifraude solo se ofrecen donde la operación pasa por
  `acreditar_atomico`.
- `avisoInactividad.ts`: **membresía y cupón necesitan lo OPUESTO ante una fecha vencida**, y por
  eso NO se unifican bajo `usaVigencia`. Un cupón vencido se saltea (hoy ya se hace: el cajero no
  lo va a poder canjear, invitarlo sería mandarlo a un rechazo). Un socio con la membresía vencida
  es justamente a quien hay que escribirle, con un mensaje de renovación. Un `if (usaVigencia)
  saltear vencidos` silenciaría al único público que este aviso debería alcanzar.

### Grupo 5 — Nombre del pase y vigencia (decisiones 6 y 7)

- Migración + `types.ts` + `guardarBranding`/`guardarBrandingPrograma` + campo en el editor de Marca
  (junto a la meta de sellos, con su ayuda: "Lo que tu cliente ve arriba en su tarjeta").
- `frentePase` gana `vigenciaHasta` y `nombrePase`; devuelve además un `encabezado`. Apple lo pone
  en `headerFields`; Google en `textModulesData` del objeto, más `validTimeInterval` para que un
  pase vencido se vea vencido.
- `datosPassDeTarjeta` lleva `vigencia_hasta` y `nombre_pase` a `DatosPass`.
- La vista previa del editor los muestra, porque comparte `frentePase`.
- **Cache-busting de Google**: los dos campos entran en `versionHero` igual que el encuadre, o el
  pase guardado se queda con el nombre viejo.

### Grupo 6 — Textos (decisión 8)

Los subtítulos de atajos del panel, los placeholders de inactividad y de geopush, el copy del
registro, la nota del directorio de clientes, el pie de la vista previa de marca y el texto de
entrada del portal. Cada uno por tabla por tipo o derivado de `unidadPrograma`/`TIPOS`.

## Fuera de alcance

- Cambiar el significado de `puntos_actuales` o partirla en columnas por tipo. Es la migración más
  grande del sistema y no hace falta: los formateadores ya resuelven la lectura.
- Rediseñar la barra inferior más allá del reemplazo de un destino.
- `expirationDate` de Apple (haría que un pase vencido se archive solo). Se muestra la fecha; no se
  cambia el ciclo de vida del pase.
- Traducciones y multi-idioma.

## Orden de trabajo

1. Migración 0033 (columna + funciones de reporte) y `verificar-0033.ts`. El usuario la aplica.
2. Grupo 1, que es donde están los datos falsos.
3. Grupo 2 (tutorial) y Grupo 6 (textos).
4. Grupo 3 (reportes) y Grupo 4 (secciones muertas).
5. Grupo 5 (nombre y vigencia en el pase), que es el único que toca Apple y Google.
6. Verificación en navegador, estado del proyecto, commit.

**Migración primero, deploy después**, como siempre: la columna nueva entra al payload de guardado
del editor de marca, así que sin la migración se rompería TODO el guardado, no solo lo nuevo.

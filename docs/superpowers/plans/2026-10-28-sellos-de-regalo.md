# Sellos de regalo al registrarse: plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usá superpowers:subagent-driven-development para implementar
> este plan tarea por tarea (implementador + revisión de spec-compliance + revisión de calidad, por
> tarea). Los pasos usan casillas (`- [ ]`) para el seguimiento.
>
> **Este plan NO trae bloques de código completos a propósito**, igual que
> `2026-09-23-onboarding-manifest-monto-resena.md`: un bloque del plan que no se mantiene byte-idéntico
> al archivo publicado es peor que no tenerlo (regla del CLAUDE.md). Acá van las firmas, las reglas en
> orden, los textos exactos y el contrato del SQL. **Los archivos publicados son la única fuente de
> verdad.**

**Objetivo:** que el dueño de un programa de sellos elija con cuántos sellos ya puestos arranca la
tarjeta de un cliente nuevo (efecto de progreso empezado: Nunes y Drèze, "The Endowed Progress Effect",
Journal of Consumer Research 32(4), 2006). Toda tarjeta nueva de ese programa nace con esos sellos, con
un movimiento "Regalo de bienvenida" en su historial, y el pase muestra el número correcto desde el
primer momento. Las tarjetas que ya existen no cambian.

**Arquitectura:** una columna `programas_tarjeta.sellos_regalo` (0 por defecto) y una función de base
`emitir_tarjeta` que crea la tarjeta Y el movimiento de regalo en la misma transacción. `registrarCliente`
deja de insertar la tarjeta directo y llama a esa función. El regalo se lee ADENTRO de la función (como
los días de la membresía en la 0031): ningún llamador puede pasar un regalo equivocado. La validación
vive en una función pura de TS que corre al guardar la meta, y un CHECK de la base hace de respaldo.

**Tecnología:** Next.js 16.2.10 (App Router), Supabase, Vitest 4, TypeScript estricto. Sin dependencias
nuevas.

---

## 1. Lo que hay hoy (investigación del 2026-10-28)

- **Toda tarjeta nace en UN solo lugar:** `registrarCliente` (`lib/clientes/registrarCliente.ts`), con
  un `insert` directo a `tarjetas`. Lo llaman tres caminos: el registro público por QR
  (`app/api/registro/route.ts`), "Agregar cliente" por teléfono (`lib/comercio/altaPorTelefono.ts`,
  desde `app/comercio/(protegido)/clientes/agregar/actions.ts`) y el seed de demos. No hay otro
  `insert` a `tarjetas` fuera de pruebas y scripts de verificación. Hoy la tarjeta nace con
  `puntos_actuales = 0` (default de la columna).
- **"Agregar cliente"** crea la tarjeta con `registrarCliente` y DESPUÉS acredita la cantidad con
  `acreditarPuntos` (mismos controles antifraude que el escáner).
- **La meta de sellos** vive en `programas_tarjeta.sello_meta` desde la 0024. NO se edita en Programas
  (el formulario de configuración devuelve `null` para sellos): se edita en **Marca**, campo "Meta de
  sellos", con dos escritores: `guardarBranding` (modo negocio, escribe en el programa PRINCIPAL) y
  `guardarBrandingPrograma` (modo tarjeta). La validación es solo TS (entero > 0) más el CHECK
  `sello_meta > 0` de la 0005.
- **La meta es del PROGRAMA, no de cada tarjeta**, y el costo del premio es aparte: `canjes` resta el
  `costo_puntos` de la recompensa, no la meta. La meta decide cuántas casillas dibuja el pase y el
  "N de M"; el premio lo decide la recompensa.
- **El historial** (`historial_tarjeta`, 0015) calcula el saldo de cada movimiento como la SUMA CORRIDA
  de los movimientos de `transacciones_puntos` + `canjes`. Por eso el regalo tiene que ser un
  movimiento del libro y no solo un número en la tarjeta: sin él, cada fila del historial de esa
  tarjeta quedaría corrida en 2 para siempre.
- **El CHECK de `transacciones_puntos.tipo`** es lista cerrada: `('acreditacion', 'ajuste', 'uso',
  'renovacion')` desde la 0019. Un tipo nuevo exige ampliarlo (mismo movimiento que la 0019).
- **Reportes y antifraude no se enteran de un tipo nuevo, y eso es lo correcto:** los reportes filtran
  `tipo in ('acreditacion', 'uso', 'renovacion')` (0033/0040) y el tope diario y la espera entre
  sellos cuentan solo `tipo = 'acreditacion'` (0015). Un regalo no es una visita ni una operación del
  cajero. El aviso de inactividad toma el último movimiento de cualquier tipo, pero el regalo nace en
  el mismo instante que la tarjeta, así que no cambia nada.
- **Los pases leen el contador de la fila de la tarjeta:** Apple (`datosPassDeTarjeta.ts`), Google
  (`syncObjeto.ts` y `linkGuardar.ts`, incluido el hash del hero). Si la tarjeta NACE con el regalo en
  la misma transacción, los dos pases dicen "2 de 10" desde la primera vez que se piden. No hace falta
  tocar código de pases, sí probarlo.
- **La página de registro miente si no se toca:** la tarjeta de muestra (`VistaTarjeta` en
  `app/registro/[comercioSlug]/RegistroCliente.tsx`) dibuja `puntos: 0` "porque la tarjeta acaba de
  nacer". Con regalo diría "0 de 10" mientras el pase dice "2 de 10".
- **El FM puede cambiarle el tipo al programa principal** (`propagarTipoAlProgramaPrincipal`), solo si
  no tiene tarjetas. Un regalo configurado en sellos quedaría en la columna de un programa de puntos.
- **Esta Mac no tiene `.env.local`:** la suite de integración (las pruebas contra Supabase) no corre
  acá. Ver "Antes de empezar".

## 2. Decisiones

### Tomadas en el plan

1. **El campo va en Marca, debajo de "Meta de sellos"**, en los dos modos (negocio y tarjeta). Ahí
   vive la meta, así que meta y regalo llegan en el MISMO envío y se validan juntos, sin leer la base
   (el criterio del aviso de vencimiento contra su plazo). Rótulo: "Sellos de regalo al registrarse".
2. **El regalo se da UNA vez, cuando nace la tarjeta.** No se repite después de canjear (la tarjeta de
   Cardly es una sola y el canje resta el costo del premio). Un cliente que ya tenía tarjeta en ese
   programa y vuelve a registrarse no recibe nada.
3. **Las tarjetas que ya existen no cambian.** Guardar o cambiar el regalo no toca ninguna tarjeta.
4. **El movimiento de regalo no lleva cajero ni sucursal.** Es del programa, no de quien atendió: si
   llevara cajero, inflaría su reporte.
5. **No cuenta en reportes ni en antifraude** (ver la investigación). Los reportes miden visitas y
   operaciones; un regalo no es ninguna de las dos.
6. **Validación:** entero, 0 o más, 0 por defecto, menor que la meta, y con meta configurada si es
   mayor que 0. En TS (con mensaje para el dueño) y con un CHECK de respaldo en la base.
7. **El regalo solo se aplica si el programa es de sellos** (lo decide `emitir_tarjeta`), así un
   cambio de tipo hecho por el FM deja la columna inofensiva.
8. **Dónde se trabaja:** en un worktree propio, fuera de la carpeta compartida, en la rama
   `claude/sellos-de-regalo`. Motivo: `push` a `master` despliega, y si alguien publica `master` por
   otra cosa con este código adentro y sin la migración aplicada, se cae el registro de TODOS los
   comercios (la función `emitir_tarjeta` no existiría). En la rama no puede pasar.

### Para Daniel (el plan asume la recomendada)

**D1. ¿Solo sellos, o también puntos?** Recomendado: **solo sellos.**
- El efecto necesita una meta visible: en sellos el pase dibuja las casillas y dice "2 de 10". En
  puntos no hay una meta única (cada premio cuesta distinto) y el pase dice "50 puntos": eso se lee
  como bono de bienvenida, que es otra mecánica, no como "ya avancé".
- "Menos que la meta" no tiene equivalente en puntos: habría que inventar otro tope (por ejemplo,
  menos que el premio más barato).
- Si después querés "puntos de bienvenida", la función de la base y el tipo de movimiento ya
  sirven: es una feature chica aparte.

**D2. El regalo es un descuento real. ¿Cómo se lo explicamos al dueño?** Recomendado: **decirlo
claro en la pantalla, sin sugerir subir la meta.**
- En el estudio, las dos tarjetas pedían el mismo esfuerzo (8 compras). En Cardly eso no se puede
  replicar subiendo la meta, por dos razones que encontré en el código:
  1. La meta es del programa, no de cada tarjeta: si el dueño la sube de 10 a 12, TODOS sus clientes
     pasan a necesitar 12. El que iba "9 de 10" amanece "9 de 12". Es lo contrario de "las tarjetas que
     ya existen no cambian".
  2. El premio no se cobra con la meta sino con el costo de la recompensa, que es otro número. Subir
     la meta sola no cambia cuánto cuesta el premio.
- Entonces el campo lleva, debajo, el efecto en vivo y sin rodeos: *"Un cliente nuevo arranca con 2
  de 10 sellos: le faltan 8. Es un regalo de verdad, y las tarjetas que ya existen no cambian."*
- Replicar el estudio exactamente (meta congelada en cada tarjeta al nacer) es un proyecto aparte y
  grande: el pase, el escáner, el portal y los reportes leen la meta del programa.

**D3. ¿Se lo contamos al cliente en la página de registro?** Recomendado: **sí, antes y después.**
- El efecto depende de que el cliente lo NOTE. El pase ya lo muestra, pero la página de registro es
  el primer contacto.
- Antes de registrarse: la tarjeta de muestra dibuja los sellos de regalo y una línea dice "Arrancás
  con 2 sellos de regalo".
- Después: la tarjeta de muestra dibuja los sellos que REALMENTE recibió (0 si ya tenía tarjeta) y la
  frase de "Tu tarjeta está lista" lo menciona solo si los recibió.
- Además, sin tocar la tarjeta de muestra, la página diría "0 de 10" mientras el pase dice "2 de 10".
  Eso no es opcional: la pantalla no puede contradecir al pase.

## 3. Diseño

### 3.1 Migración `0043_sellos_de_regalo.sql` (contrato)

Una transacción (`begin; … commit;`), aditiva, aplicable ANTES del deploy sin romper el código vivo:

1. `alter table programas_tarjeta add column sellos_regalo integer not null default 0;`
   Ningún programa existente cambia (todos quedan en 0).
2. CHECK `programas_tarjeta_sellos_regalo_check`:
   `sellos_regalo >= 0 and (sellos_regalo = 0 or (sello_meta is not null and sellos_regalo < sello_meta))`.
   Respaldo de la validación de TS. Cruza dos columnas a propósito: hace imposible bajar la meta por
   debajo del regalo por cualquier camino (otra pestaña, un script).
3. Ampliar `transacciones_puntos_tipo_check` a
   `('acreditacion', 'ajuste', 'uso', 'renovacion', 'regalo')`, con el mismo `drop constraint if
   exists` + `add constraint` de la 0019. Ninguna fila existente se toca.
4. Función `emitir_tarjeta(p_comercio_id uuid, p_programa_id uuid, p_cliente_id uuid,
   p_vigencia_hasta date) returns table(id_tarjeta uuid, token_qr text, sellos_regalados integer)`,
   `language plpgsql`, `set search_path = public`:
   - Lee `sellos_regalo` del programa (`where id = p_programa_id and comercio_id = p_comercio_id`),
     y usa 0 si el programa no es `tipo_tarjeta = 'sellos'` o no se encontró.
   - `insert into tarjetas (cliente_id, comercio_id, programa_id, vigencia_hasta, puntos_actuales)`
     con el regalo como saldo inicial, `returning id, qr_token`.
   - Si el regalo es mayor que 0: `insert into transacciones_puntos (tarjeta_id, puntos_delta, tipo)`
     con `'regalo'` (sin cajero, sin sucursal, sin motivo; `forzado` queda en false).
   - Devuelve la fila. Las columnas de salida NO se llaman como columnas de tabla (`id_tarjeta`,
     `token_qr`, `sellos_regalados`): en plpgsql un `returning qr_token` con una salida `qr_token`
     revienta por ambigüedad (la advertencia de la 0009/0015).
   - Si la tarjeta ya existe, el insert lanza `23505` y la transacción entera se cae (no queda ningún
     regalo suelto). PostgREST devuelve ese código en `error.code`, así que el manejo de carreras de
     `registrarCliente` sigue igual.
   - El invariante de la 0015 ("todo escritor de `transacciones_puntos` toma el lock de la fila de la
     tarjeta") se cumple solo: la fila recién insertada es invisible para cualquier otra transacción
     hasta el commit. Dejarlo dicho en el comentario.
   - `revoke execute … from public, anon, authenticated; grant execute … to service_role;` como el
     resto de las funciones.

Script de verificación `scripts/verificar-0043.ts`, de SOLO LECTURA: (a) `select sellos_regalo` de
`programas_tarjeta` responde y todas las filas están en 0; (b) llamar `emitir_tarjeta` con uuids
inexistentes devuelve `23503` (la función existe y corrió; la FK la frenó sin escribir nada) y NO
`PGRST202` (no existe). El CHECK y el tipo `'regalo'` los prueban las pruebas de integración.

### 3.2 La regla, pura: `lib/tarjetas/sellosRegalo.ts`

- `validarSellosRegalo(selloMeta: number | null, sellosRegalo: number): string | null`, reglas EN
  ESTE ORDEN:
  1. No entero o menor que 0 → `'Los sellos de regalo tienen que ser un número entero, 0 o más.'`
  2. Igual a 0 → `null` (válido con cualquier meta, incluida ninguna).
  3. Meta `null` → `'Poné la meta de sellos antes de regalar sellos.'`
  4. Mayor o igual que la meta → `` `Los sellos de regalo tienen que ser menos que la meta (${selloMeta}): si no, la tarjeta nacería completa.` ``
- `sellosRegaloDesdeFormulario(valor: FormDataEntryValue | null): number`: ausente (`null`) o vacío
  → `0`; si no, `Number(valor.trim())` (un `'2a'` da `NaN` y lo rechaza la regla 1). **Ausente es 0 a
  propósito**: el campo solo se dibuja en sellos (igual que la meta, que en ese caso se manda vacía y
  queda en `null`). Si ausente fuera "no tocar", un programa al que el FM le cambió el tipo quedaría
  con meta `null` y regalo 2, y el CHECK tumbaría TODO el guardado de Marca de ese dueño.
- `describirArranque(selloMeta: number, sellosRegalo: number): string` (el texto de abajo del campo,
  solo con regalo > 0 y meta válida): `` `Un cliente nuevo arranca con ${r} de ${m} sellos: le faltan ${m - r}. Es un regalo de verdad, y las tarjetas que ya existen no cambian.` ``
- `textoRegaloRegistro(sellosRegalo: number): string` (página de registro, solo con > 0):
  `'Arrancás con 1 sello de regalo.'` / `` `Arrancás con ${n} sellos de regalo.` ``

### 3.3 Escritura (Marca)

- `DatosBranding` gana `sellos_regalo: number` y `DatosBrandingPrograma` gana `sellosRegalo: number`,
  **obligatorios** (no opcionales): un llamador que no lo mande no compila, en vez de borrar el regalo.
- `guardarBranding` y `guardarBrandingPrograma` llaman `validarSellosRegalo(meta, regalo)` DESPUÉS de
  validar la meta (si la meta es inválida, el dueño lee ese error primero) y escriben `sellos_regalo`
  en el MISMO `update` que `sello_meta` (en `guardarBranding`, el del programa principal). Mismo
  update = el CHECK cruzado evalúa los dos valores nuevos juntos.
- Las dos Server Actions de `app/comercio/(protegido)/branding/actions.ts` leen el campo con
  `sellosRegaloDesdeFormulario(formData.get('sellos_regalo'))`.
- Lectura: `sellos_regalo` entra a `CAMPOS_PROGRAMA` / `FilaPrograma` / `Programa.sellosRegalo`
  (`lib/comercio/programas.ts`) y a `BrandingProgramaFila.sellosRegalo` (`guardarBrandingPrograma.ts`,
  que es de donde el modo tarjeta de Marca precarga la meta).
- `guardarComercio.ts`: el rollback que REPONE el programa principal tras un borrado fallido (líneas
  ~371 y ~454) copia también `sellos_regalo`. Sin eso, un borrado fallido le quita el regalo al
  programa en silencio.

### 3.4 Emisión

- `registrarCliente`: el `insert` de la tarjeta nueva pasa a `supabase.rpc('emitir_tarjeta', …)`. El
  resto (buscar cliente, buscar tarjeta existente, carrera `23505`, `inicializarApple`, la vigencia
  del cupón calculada en TS) queda igual.
- `RegistrarClienteResult` gana `sellosRegalo: number`: lo que devolvió la función en la tarjeta
  nueva, y `0` en los dos caminos de tarjeta ya existente (la encontrada y la ganadora de la carrera).
- `app/api/registro/route.ts` devuelve también `sellosRegalo` en el JSON.
- `altaYAcreditacionPorTelefono`: con tarjeta nueva y regalo > 0, el mensaje es
  `` `Listo: ${nombre} ya tiene su tarjeta con ${regalo} de regalo y ${acreditado}. Ahora tiene ${queda}.` ``
  donde `regalo = describirCosto(tipo, sellosRegalo)` ("2 sellos"). Ejemplo: "Listo: Ana ya tiene su
  tarjeta con 2 sellos de regalo y 1 sello. Ahora tiene 3 de 10 sellos." Sin regalo, los mensajes de
  hoy no cambian.

### 3.5 Historial

`lib/comercio/historial.ts`: `'regalo'` entra a `ClaseMovimiento`, a `CLASES` y a `ETIQUETAS`
(`'Regalo de bienvenida'`). Los `Record<ClaseMovimiento, …>` de la ficha del dueño
(`app/comercio/(protegido)/clientes/[tarjetaId]/page.tsx`: ícono `'card_giftcard'`, tono `'menta'`)
dejan de compilar hasta que se agregue, que es justo para lo que son Records. El portal del cliente lo
muestra con la misma etiqueta.

### 3.6 Pantallas

- **Marca** (`FormularioBranding.tsx` + `page.tsx`): campo `sellos_regalo` debajo de "Meta de
  sellos", con la MISMA condición (`esSellos`), controlado como la meta (`valores`), `type="number"`,
  `min=0`, `max` = meta − 1 cuando hay meta, `step=1`, `placeholder="0"`. Debajo, en vivo,
  `describirArranque` cuando el regalo es mayor que 0 y la meta es válida. Precarga: modo negocio
  desde el programa principal, modo tarjeta desde `marca.sellosRegalo` (el mismo origen que la meta,
  ver el comentario de `page.tsx` sobre por qué la meta sale del principal).
- **Registro** (`app/registro/[comercioSlug]/…`): la página de servidor pasa `sellosRegalo` del
  programa (solo si es sellos); `VistaTarjeta` recibe `puntos` en vez del `0` fijo. Antes de
  registrarse: `puntos = sellosRegalo` del programa y la línea `textoRegaloRegistro`. Después:
  `puntos = sellosRegalo` que devolvió la API, y la línea solo si es mayor que 0.

## 4. Antes de empezar (todas las tareas)

**Prerrequisito de Daniel: `.env.local`.** Esta Mac no lo tiene (solo está `.env.local.example`), y
sin él no corre ninguna prueba contra Supabase ni el dev server. Lo pone Daniel en SU terminal (copiado
de la otra máquina o con `vercel env pull`), en la carpeta del worktree de abajo. Nunca leerlo ni
imprimirlo. Hasta que esté, se avanza con lo que no lo necesita (la migración, la regla pura, el
código), y las pruebas de integración se escriben y quedan para correr cuando llegue.

**Dónde se trabaja:** worktree `/Applications/Projects/loyalty_cards-sellos-regalo`, rama
`claude/sellos-de-regalo`, creado desde `master` (`a2b50fd`). Cada subagente verifica con
`git -C /Applications/Projects/loyalty_cards-sellos-regalo branch --show-current`; si imprime
`claude/sellos-de-regalo`, prosigue. Los subagentes arrancan en un worktree de infraestructura ajeno:
`cd` con la ruta absoluta en cada comando Bash y rutas absolutas en Read/Write/Edit.

**¿Está aplicada la 0043?** Lo anota la Tarea 1 con fecha cuando `verificar-0043.ts` la confirma.
Hasta entonces, las pruebas que tocan `sellos_regalo` o `emitir_tarjeta` fallan con "column … does not
exist" o `PGRST202`: se escriben, se confirma que fallan por ESA razón, y el verde y sus mutaciones se
difieren a la Tarea 7. Esa suite roja es la medida exacta de lo que rompería publicar sin migrar.

**Las pruebas cargan la configuración por el camino de producción:** el regalo y la meta se escriben
con `guardarBranding` (modo negocio) o `guardarBrandingPrograma` (modo tarjeta), las mismas funciones
que llama Marca. Nunca con un `update` directo, salvo para fabricar un estado que el código no deja
escribir pero la realidad sí produce (el cambio de tipo del FM), y ahí se dice por qué.

**Mutation-testing obligatorio:** cada tarea lista sus mutaciones. Romper la línea, confirmar que la
prueba FALLA por la razón correcta (mensaje o valor exacto), restaurar. El encabezado del archivo de
prueba las documenta como "confirmadas" solo después de correrlas.

**Nada de dev server en subagentes.** La verificación en el navegador la hace el controlador.

**Commits:** en la rama, identidad `Daniel <268727888+dann1103-eng@users.noreply.github.com>`
(`git -c user.name="Daniel" -c user.email="268727888+dann1103-eng@users.noreply.github.com" commit`),
`-m` plano, trailer `Co-Authored-By:` al final. `npx tsc --noEmit` y `npx eslint <archivos tocados>`
limpios antes de cada commit. **Sin push.**

**Estilo:** comentarios e identificadores en español (voseo), con la densidad de comentarios del
código de alrededor: se explica el POR QUÉ, con el caso real que lo motivó.

---

## Tarea 1: Migración 0043, verificación y tipos

**Archivos:** crear `supabase/migrations/0043_sellos_de_regalo.sql`,
`scripts/verificar-0043.ts`; modificar `lib/supabase/types.ts`.

- [ ] Escribir la migración según 3.1, con comentarios del porqué al estilo de la 0019 y la 0031.
- [ ] `types.ts`: `sellos_regalo: number` en `programas_tarjeta` (Row; opcional en Insert/Update) y
      `emitir_tarjeta` en `Functions` (Args y Returns). Ampliar el comentario de
      `transacciones_puntos.tipo` con `'regalo'`.
- [ ] `verificar-0043.ts` según 3.1 (solo lectura, `npx tsx --conditions=react-server`).
- [ ] El controlador revisa el SQL, se lo pega a Daniel en el chat, Daniel lo corre en Studio y avisa.
- [ ] Correr `verificar-0043.ts` y anotar acá la fecha en que quedó aplicada.

## Tarea 2: La regla, pura

**Archivos:** crear `lib/tarjetas/sellosRegalo.ts` y `lib/tarjetas/sellosRegalo.test.ts`.

- [ ] Pruebas primero (corren sin `.env.local` si el archivo no importa Supabase): cada regla de 3.2
      con su mensaje EXACTO; 0 con meta null es válido; 1.5, -1 y `NaN` rechazados por la regla 1;
      regalo igual a la meta rechazado y meta − 1 aceptado (el borde); `sellosRegaloDesdeFormulario`
      con `null`, `''`, `'  '`, `'2'`, `'2a'`; `describirArranque` y `textoRegaloRegistro` con
      singular y plural.
- [ ] Implementar.
- [ ] **Mutaciones:** `>=` → `>` en la regla 4; quitar la regla 3; ausente → `NaN` en vez de 0;
      singular roto en `textoRegaloRegistro`.

**Ojo:** `vitest.setup.ts` exige `.env.local` para TODO archivo. Mientras no esté, correr esta prueba
con una config de vitest sin el setup, en el scratchpad (como la sesión del 2026-10-28).

## Tarea 3: Marca guarda y lee el regalo

**Archivos:** modificar `lib/comercio/guardarBranding.ts`, `lib/comercio/guardarBrandingPrograma.ts`,
`app/comercio/(protegido)/branding/actions.ts`, `lib/comercio/programas.ts`,
`lib/comercios/guardarComercio.ts`; pruebas en `guardarBranding.test.ts`,
`guardarBrandingPrograma.test.ts` y `branding/actions.test.ts`.

- [ ] Según 3.3.
- [ ] Pruebas (integración): guardar meta 10 + regalo 2 por cada función y releer con
      `obtenerPrograma` / `brandingDeProgramas` (`sellosRegalo === 2`); regalo 10 con meta 10
      rechazado con el mensaje exacto y la fila SIN tocar; regalo 2 con meta vacía rechazado; la
      acción sin el campo escribe 0 (desde el HTML real del formulario si `actions.test.ts` ya lo hace
      así); el rollback de `guardarComercio` repone el regalo.
- [ ] **Mutaciones:** sacar `sellos_regalo` del `update` de cada función (la relectura da 0); validar
      antes de la meta (sale el mensaje equivocado con meta inválida); ausente → no escribir (la prueba
      del formulario sin campo lo detecta).

## Tarea 4: Toda tarjeta nueva nace con su regalo, y el historial lo cuenta

**Archivos:** modificar `lib/clientes/registrarCliente.ts`, `app/api/registro/route.ts`,
`lib/comercio/historial.ts`, `app/comercio/(protegido)/clientes/[tarjetaId]/page.tsx`; crear
`lib/tarjetas/sellosRegalo.integracion.test.ts` (la prueba honesta, al estilo de
`tiposFuncionales.test.ts`).

- [ ] Según 3.4 (`registrarCliente`, la ruta) y 3.5.
- [ ] Prueba honesta, comercio con columnas legadas vacías y config por `guardarBranding` /
      `guardarBrandingPrograma`:
  1. Registro en un programa de sellos con meta 10 y regalo 2: la tarjeta queda en 2,
     `esNuevaTarjeta` true, `sellosRegalo` 2; en el libro hay UNA fila `tipo 'regalo'`, delta 2,
     sin cajero ni sucursal.
  2. `historialTarjeta` la devuelve como `'regalo'` con saldo 2; después de `acreditarPuntos` 1, la
     acreditación tiene saldo 3 y la tarjeta vale 3 (la suma corrida cuadra).
  3. Volver a registrar el mismo teléfono: misma tarjeta, `sellosRegalo` 0, sigue en 2 y sigue
     habiendo UNA fila de regalo.
  4. Una tarjeta emitida ANTES de poner el regalo sigue con su saldo después de guardarlo.
  5. Programa principal de sellos con regalo 2, cambiado a puntos como lo hace el FM (`update`
     directo del tipo: es el estado que deja `propagarTipoAlProgramaPrincipal`, que no limpia el
     regalo): la tarjeta nueva nace en 0 y sin fila de regalo.
  6. Lo que ve el cliente en el pase: los datos de Apple (`datosPassDeTarjeta` + `frentePase`) dicen
     "2 de 10" y el objeto de Google arma el contador en 2. Medir el texto o campo que se dibuja, no
     la columna.
  7. Regalo 0 (el caso de todos los comercios de hoy): la tarjeta nace en 0 y no hay fila de regalo.
- [ ] Correr `registrarCliente.test.ts` entero: la prueba de dos registros en paralelo ejercita la
      carrera `23505` a través de la función nueva.
- [ ] **Mutaciones:** en la migración (aplicada con `create or replace` en un SQL de prueba que pega
      Daniel, o se difieren y se documentan si no es posible): quitar la condición `'sellos'`
      (cae el caso 5); insertar con saldo 0 (cae el 1); no escribir la fila de regalo (caen 1 y 2). En
      TS: volver al `insert` directo (cae el 1); devolver el regalo también en la tarjeta existente
      (cae el 3); sacar `'regalo'` de `CLASES` (cae el 2: sale como acreditación).

**Ojo con las mutaciones de SQL:** solo se pueden correr contra la base real. Si Daniel prefiere no
aplicar SQL de prueba, quedan documentadas como "no corridas" con la razón, y los casos 1, 2 y 5 son
igual la defensa (los tres fallaban antes de la función).

## Tarea 5: "Agregar cliente" lo dice

**Archivos:** `lib/comercio/altaPorTelefono.ts` y su prueba.

- [ ] Según 3.4. Prueba: alta nueva con regalo 2 y cantidad 1 → saldo 3 y el mensaje EXACTO del
      ejemplo; alta de un teléfono que ya tenía tarjeta → mensaje de siempre, sin "de regalo".
- [ ] **Mutaciones:** mencionar el regalo también en tarjeta existente; quitar el regalo del mensaje.

## Tarea 6: Pantallas (Marca y registro)

**Archivos:** `app/comercio/(protegido)/branding/FormularioBranding.tsx`,
`app/comercio/(protegido)/branding/page.tsx`, `app/registro/[comercioSlug]/page.tsx`,
`app/registro/[comercioSlug]/[programaSlug]/page.tsx`, `app/registro/[comercioSlug]/RegistroCliente.tsx`.

- [ ] Según 3.6. Los textos salen de `sellosRegalo.ts` (ya probados en la Tarea 2): las pantallas no
      arman frases propias.
- [ ] Verificación en el navegador (el controlador, con el dev server del worktree y `.env.local`):
      en Marca de Farmacias ABC (comercio de pruebas de Daniel) poner meta 10 y regalo 2, ver el texto
      en vivo, guardar, recargar y ver el valor; intentar 10 y ver el mensaje; registrar un teléfono
      de prueba por el QR y ver "Arrancás con 2 sellos de regalo", la muestra con 2 llenos y la
      tarjeta real en 2 (escáner y ficha con "Regalo de bienvenida"). Dejar el comercio como estaba.

## Tarea 7: Cierre

- [ ] Con la 0043 aplicada y `.env.local` presente: suite completa, `tsc`, `eslint`; correr las
      mutaciones diferidas.
- [ ] Agregar la sección del 2026-10-28 a `docs/superpowers/ESTADO-Y-PLAN-2026-07-28.md` (qué se hizo,
      qué no es obvio, pendientes).
- [ ] Revisión final de toda la rama (requesting-code-review) y verificar cada hallazgo antes de
      aplicarlo.
- [ ] Avisarle a Daniel que está listo para publicar. **No se publica sin que lo pida.** Orden:
      migración aplicada (ya lo está desde la Tarea 1) → merge a `master` → push.

## Orden y despliegue

1. Tarea 1 primero: la migración es aditiva y se puede aplicar hoy sin tocar nada de lo que funciona
   (el código vivo no conoce la columna ni la función, y el regalo nace en 0 para todos).
2. Tareas 2 a 6 en la rama, en orden (la 4 usa la regla de la 2 y la columna de la 3).
3. Publicar SOLO con la 0043 aplicada: el código nuevo llama a `emitir_tarjeta` en cada registro, y
   sin la función se caería el alta de clientes de todos los comercios.
4. El reel "Te falta poco" puede anunciar la feature recién cuando esté publicada y probada en
   producción con un registro real.

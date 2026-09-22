# Cobranza + rework de navegación (admin y comercio) — plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usá superpowers:subagent-driven-development para implementar
> este plan tarea por tarea (implementador + revisión de spec-compliance + revisión de calidad, por
> tarea). Los pasos usan casillas (`- [ ]`) para el seguimiento.
>
> **Este plan NO trae bloques de código completos a propósito** (desviación deliberada del formato
> estándar de `writing-plans`, ya usada y documentada en
> `docs/superpowers/plans/2026-09-21-pasarela-wompi.md`): las dos specs de las que sale este plan ya
> tienen firmas, SQL, tablas de comportamiento y ejemplos de prueba muy precisos, y un bloque de código
> del plan que no se mantiene byte-idéntico al archivo publicado es peor que no tenerlo — una tarea
> futura que relea un plan viejo puede "restaurar" un bug ya arreglado (regla del CLAUDE.md de este
> proyecto). **Los archivos publicados son la única fuente de verdad.** Cada tarea apunta a su spec y a
> sus archivos exactos.

**Objetivo:** que FM pueda pedirle un pago a un cliente en cualquier momento, que una cuenta que no paga
15 días después de vencer su ciclo se bloquee sola (panel + escáner, nunca las tarjetas del cliente
final), que FM tenga las excepciones (exenta / posponer / perdonar) — y que el admin y el panel del
comercio queden reorganizados alrededor de eso: un dashboard de entrada, las cuentas al centro (sin
"Comercios" suelto), y las pantallas más largas (Marca del comercio) partidas en pestañas.

**Arquitectura:** estado de cobranza DERIVADO de fechas (función pura `estadoDeCobranza`, sin cron ni
botón de "marcar impago"), con un interruptor manual (`licencia_estado`) que corta de inmediato por
encima de cualquier fecha. El gate único de `/comercio` (`verifyComercioAcceso`) se parte en una variante
que bloquea (páginas y acciones) y otra que no (el layout, para poder mostrar el banner y dejar pagar).
El dashboard del admin agrega 6 métricas con `Promise.all` sobre consultas existentes + dos módulos
nuevos. Las pantallas largas (Marca, ficha de cuenta) se parten en pestañas puramente visuales sobre los
mecanismos de guardado que YA existen — nunca se inventa un guardado nuevo donde no hace falta.

**Tecnología:** Next.js 16 (App Router), Supabase, Vitest 4, TypeScript estricto. Sin dependencias nuevas.

**Specs:** `docs/superpowers/specs/2026-09-21-cobranza-design.md` y
`docs/superpowers/specs/2026-09-21-rework-admin-comercio-design.md` (esta segunda, aprobada tras SEIS
rondas de revisión — cada corrección real está documentada en su historial de commits). **Leé las dos
antes de tocar nada.**

**Rama:** `claude/cobranza-y-rework-admin` (nueva, arrancada desde `master` tras publicar la pasarela
Wompi). Nada de esto está publicado.

**Restricción real de esta sesión:** la migración `0038` la aplica Daniel a mano en Supabase Studio — el
asistente no puede correr DDL. Mientras no esté aplicada, **todo lo que dependa de las columnas nuevas de
`cuentas_comercio` (`cobranza`, `cobranza_desde`, `cobranza_pospuesta_hasta`) se escribe y se prueba en lo
que no necesita base real (puro), y sus pruebas contra Supabase quedan ESCRITAS PERO SIN CORRER** — mismo
patrón que la pasarela Wompi. Lo que NO depende de esas columnas (pedir un pago, que el dueño lo pague,
anular un cobro, todo lo del rework que no es la pestaña "Cobranza") se construye Y se prueba contra la
base real de punta a punta en esta misma sesión (el mismo truco de siempre: correr los tests con el `cwd`
en el checkout principal, que sí tiene `.env.local`, sin leerlo).

---

## Antes de empezar (todas las tareas)

**Dónde se trabaja:** `C:\Users\Daniel\Desktop\Proyectos\Loyalty Cards\.claude\worktrees\focused-aryabhata-28e859`,
rama `claude/cobranza-y-rework-admin`. Cada subagente verifica con `git branch --show-current` ANTES de
tocar nada (los subagentes arrancan en un worktree de infraestructura de la sesión ajeno a este repo —
instruírles `cd` con la ruta absoluta de arriba en cada comando Bash, y rutas absolutas en Read/Write/Edit).

**Pruebas puras** (sin `.env.local`): config aparte en el scratchpad de la sesión,
`vitest.plan.config.mjs` — agregar cada archivo `.test.ts` nuevo a su `include`. Correr con `TZ=UTC` y
con `TZ=America/El_Salvador` (fechas de calendario).

**Pruebas contra Supabase** (para lo que NO depende de la migración `0038`): desde el checkout principal
(`C:\Users\Daniel\Desktop\Proyectos\Loyalty Cards`), `npx --prefix <worktree> vitest run --root <worktree>
--config <worktree>/vitest.config.ts <archivo>`.

**Mutation-testing obligatorio** en toda lógica pura y en toda rama de seguridad (acotar por cuenta,
rechazar un id ajeno, etc.): romper la línea, confirmar que la prueba falla por el motivo correcto,
restaurar. Igual que el resto del proyecto.

**No hay pruebas de componentes.** Para las pantallas nuevas: sacar la aritmética a un módulo puro y
probarla con mutación; verificar el pegamento con el DOM en el navegador (recorrido real, capturas), no
con un test de React.

---

## Tarea 1 — `estadoDeCobranza` y `periodoAPerdonar` (puros)

**Spec:** cobranza, "Estado de cobranza" (tabla de 5 filas) y "Perdonar el ciclo".

**Archivos:**
- Crear: `lib/comercios/cobranza.ts`
- Test: `lib/comercios/cobranza.test.ts`

**Qué hace:**
- `export const DIAS_GRACIA_COBRANZA = 15;`
- `estadoDeCobranza(entrada: { cobranza: 'normal' | 'exenta'; desde: string; pospuestaHasta: string | null; periodosPagados: PeriodoPagado[]; hoy: string }): EstadoCobranza` — el tipo union con 5 variantes de la tabla de la spec (`exenta`, `pospuesta` con fecha, `al_dia` con `hasta`/`diasRestantes`, `vencida` con `diasVencida`/`diasParaBloqueo`/`esPrimerPago`, `bloqueada` con `diasVencida`). Reusa el TIPO `PeriodoPagado` de `lib/comercios/prorrateo.ts`, pero **NO** la función `estadoDelPeriodo` para sacar `cubiertoHasta`: esa función filtra `pagados.hasta >= hoy` ANTES de calcular nada, así que en el caso central de esta spec (`hoy` ya pasó el `hasta` de todos los períodos — exactamente `vencida`/`bloqueada`) devuelve `{ tipo: 'sin_periodo' }` **sin** `cubiertoHasta`. `cubiertoHasta` se calcula acá, independiente, con un `reduce` propio sobre TODOS los `periodosPagados` sin filtrar por fecha (`periodosPagados.reduce((max, p) => (p.hasta > max ? p.hasta : max), '')`, o `null` si el arreglo está vacío) — es la misma cuenta que hace `estadoDelPeriodo` internamente (línea `cubiertoHasta = pagados.reduce(...)`), solo que sin el filtro previo que la vacía justo cuando más importa.
- `periodoAPerdonar(entrada: { periodosPagados: PeriodoPagado[]; cobranzaDesde: string; hoy: string }): { desde: string; hasta: string }` — el ciclo que venció: arranca el día siguiente al último período pagado (o `cobranzaDesde` si nunca pagó), termina con `hastaDelPeriodo` (de `prorrateo.ts`).

**Tabla de mutación (cada fila se corre, se rompe, se confirma el mensaje exacto, se restaura):**
- no distinguir `exenta` primero → falla el caso "exenta con fechas vencidas igual da exenta"
- posponer exclusivo en vez de inclusivo (`hoy < pospuestaHasta` en vez de `<=`) → falla "el último día de la posposición todavía no bloquea"
- el día 15 exacto bloquea (debería ser `vencida`) → falla "15 días exactos: vencida, no bloqueada"
- el día 16 no bloquea (debería ser `bloqueada`) → falla "16 días: bloqueada"
- vencimiento tomado de `desde` en vez de `cubiertoHasta` cuando SÍ hay períodos pagados → falla "una cuenta que ya pagó antes cuenta desde el último período, no desde `cobranza_desde`"
- calcular `cubiertoHasta` pasando por `estadoDelPeriodo` (que lo vacía justo en `vencida`/`bloqueada`) → falla el caso de arriba también: es la mutación que un implementador cometería siguiendo el texto viejo de esta tarea
- primer pago no usa `cobranzaDesde` → falla "una cuenta que nunca pagó cuenta desde `cobranza_desde`"
- un período de $0 (perdonado) no cuenta como pagado → falla "un ciclo perdonado cubre igual que uno pagado"
- `periodoAPerdonar` arranca del período equivocado → falla su caso de "arranca el día siguiente al último pagado"

**Verificar:** `TZ=UTC` y `TZ=America/El_Salvador`, ambas verdes.

- [x] Escribir `cobranza.test.ts` con los casos de la tabla de la spec (al_dia, vencida día 1, vencida día
  15, bloqueada día 16, exenta, pospuesta antes/en/después de la fecha, primer pago, período perdonado
  cuenta como pagado) — todos en rojo (el módulo no existe).
- [x] Escribir `cobranza.ts` mínimo para que pasen.
- [x] Correr las mutaciones de la tabla de arriba, una por una, restaurando cada vez.
- [x] `git add lib/comercios/cobranza.ts lib/comercios/cobranza.test.ts && git commit` (mensaje describiendo
  qué se agregó; identidad `Daniel <268727888+dann1103-eng@users.noreply.github.com>`, trailer
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`).

**Estado: ✅ completa** (commit `f127d53`). Spec-compliance ✅ y calidad de código ✅ ("Ready to merge:
Yes") — ambas revisiones corrieron pruebas y mutaciones por su cuenta, no solo leyeron el reporte del
implementador. Pendientes menores anotados por el revisor de calidad, no bloqueantes, para retomar si
conviene: (1) el parámetro `hoy` de `periodoAPerdonar` queda sin usar en el cuerpo — la propia spec no lo
necesita para el cálculo, así que se deja tal cual la firma que pide el plan; (2) faltan 2 combinaciones
de prueba de bajo riesgo (vencida-tras-posponer, bloqueada-sin-pago-previo) que reusan rutas de código ya
cubiertas — se pueden agregar en la Tarea 11 junto con el resto de la suite de cobranza contra la
migración real.

## Tarea 2 — Migración `0038` (SQL, tipos, script de verificación)

**Spec:** cobranza, "Modelo de datos".

**Archivos:**
- Crear: `supabase/migrations/0038_cobranza.sql` (el SQL exacto de la spec: las tres columnas + el
  `update … set cobranza = 'exenta'`)
- Modificar: `lib/supabase/types.ts` (agregar `cobranza`, `cobranza_desde`, `cobranza_pospuesta_hasta` a
  `Row`/`Insert`/`Update` de `cuentas_comercio`; agregar la migración al comentario-lista del encabezado)
- Crear: `scripts/verificar-0038.ts` (solo lectura — mismo patrón que `verificar-0037.ts`: confirma que
  las tres columnas existen, que el `check` de `cobranza` rechaza un valor inválido, que las cuentas
  existentes quedaron `exenta`)

- [x] Escribir el SQL, byte-idéntico al de la spec.
- [x] Actualizar `types.ts`.
- [x] Escribir `scripts/verificar-0038.ts`.
- [x] `npx tsc --noEmit` limpio.
- [x] Commit.
- [x] **Avisar a Daniel** (en el resumen final de esta sesión, no bloquea el resto): el SQL está listo
  para que lo aplique a mano cuando vuelva. Hasta entonces, nada de la Tarea 5 en adelante que dependa de
  estas columnas puede probarse contra Supabase.

**Estado: ✅ completa** (commits `bfdc727` + `ce06e6a`). Primera ronda de calidad encontró 3 Important
reales (verificados por el controlador antes de pedir la corrección, no solo confiados): faltaba
`begin;`/`commit;` en el SQL (rompía la convención desde la 0038 — hasta una migración de una sola
sentencia como la 0036 lo hace), `cobranza_desde` usaba `current_date` del servidor en vez de
`(now() at time zone 'America/El_Salvador')::date` (violaba la convención documentada en
`0019_vigencia_cupon_membresia.sql:53`), y `scripts/verificar-0038.ts` dejaba huérfana la fila de prueba
inválida si el CHECK fallaba en rechazarla. Los tres se corrigieron (commit `ce06e6a`), incluyendo
actualizar el bloque SQL de la spec para seguir byte-idéntico a la migración. Ambas re-revisiones
(spec-compliance y calidad) confirmaron los fixes de forma independiente — "Ready to merge: Yes".

**⚠️ Pendiente para Daniel:** el SQL de `supabase/migrations/0038_cobranza.sql` está listo para aplicar a
mano en Supabase Studio. Hasta que lo haga, nada de la Tarea 5 en adelante que dependa de estas columnas
puede probarse contra Supabase real.

## Tarea 3 — `estadoEfectivo` (une `licencia_estado` + `estadoDeCobranza`)

**Spec:** rework, "Unificación con `licencia_estado`".

**Archivos:**
- Modificar: `lib/comercios/cobranza.ts` (agrega `estadoEfectivo`)
- Modificar: `lib/comercios/cobranza.test.ts`

**Qué hace:** `estadoEfectivo(entrada: EntradaCobranza & { licenciaEstado: string }): EstadoCobranza` —
si `licenciaEstado === 'inactivo'` devuelve `{ tipo: 'bloqueada', diasVencida: 0 }` (o el shape que use
`bloqueada`) SIN mirar nada más; si no, delega en `estadoDeCobranza`.

**Mutación:** una cuenta `inactivo` da `bloqueada` aunque sea `exenta` o esté al día → falla el caso
dedicado; una cuenta `activo` delega sin cambios → falla si se rompe la delegación.

**⚠️ AVISO QUE NO SE PUEDE SALTAR (spec rework, "Unificación con `licencia_estado`"): `M&M Inversiones`
y `Segundo` YA tienen `licencia_estado = 'inactivo'` en la base REAL, hoy.** En cuanto `estadoEfectivo`
esté cableado al gate (Tarea 5) y la Tarea 11 lo verifique de punta a punta, esas DOS cuentas de clientes
reales quedan bloqueadas — sin que nadie las haya tocado ese día. La spec termina esa sección diciendo
literalmente: **"Sin tu respuesta, NO hago el deploy de esta parte."** Esto no es un detalle de esta
tarea: es una condición para TODO lo que sigue. `estadoEfectivo` se puede escribir y probar (es pura), pero
**nadie corre la Tarea 11 (verificar el gate de punta a punta con datos reales) ni se publica nada de esta
rama a `master` sin que Daniel haya dicho explícitamente qué hacer con esas dos cuentas** — dejarlas
bloquear, o pasarlas a `activo` antes. Repetido en la Tarea 11 para que no se pierda.

- [ ] Test primero (rojo), después la función.
- [ ] Mutación, restaurar.
- [ ] Commit.

## Tarea 3b — El selector de cobranza en "Nueva cuenta"

**Spec:** cobranza, "Modelo de datos": *"Cuentas nuevas: `normal` por defecto. El formulario de «Nueva
cuenta» de FM lleva el selector, para crear una exenta desde el principio."* Ninguna otra tarea de este
plan toca el ALTA de una cuenta (4b es sobre cuentas YA EXISTENTES) — sin esta tarea, FM no puede dar de
alta una cuenta exenta desde el principio, y toda cuenta nueva queda `normal` sin forma de cambiarlo hasta
tener la ficha completa. **Depende de la migración** (escribe la columna `cobranza`): código + test
escritos, sin correr, como el resto de lo que toca esas columnas.

**⚠️ `leerDatos(formData)` y el tipo `DatosCuenta` los COMPARTEN `accionCrearCuenta` Y
`accionActualizarCuenta`** (`app/admin/(protegido)/cuentas/actions.ts`, una sola función `leerDatos` para
las dos). Si `cobranza` entra a `DatosCuenta` sin más, editar la pestaña **Datos** de una cuenta YA
EXISTENTE (spec rework: esa pestaña es solo `FormularioCuenta (nombre, plan, límite, monto, licencia)`,
SIN cobranza — el modo vive nada más en la pestaña Cobranza, vía `cambiarModoCobranza` de la Tarea 4b, que
tiene efectos secundarios reales al cambiar de modo) pisaría el modo de cobranza de la cuenta **sin esos
efectos secundarios** — un bug de negocio, no cosmético. Por eso `cobranza` **NO entra a `DatosCuenta`
ni a `leerDatos`**: es un parámetro APARTE, exclusivo del alta.

**Archivos:**
- Modificar: `lib/comercios/cuentas.ts` (`crearCuenta` suma un parámetro propio
  `cobranza?: 'normal' | 'exenta'` — NO en `DatosCuenta`, NO en `actualizarCuenta` — con
  `'normal'` como default si se omite; valida contra la lista de valores)
- Modificar: `app/admin/(protegido)/cuentas/FormularioCuenta.tsx` (el `<select>` nuevo, **renderizado SOLO
  cuando `!inicial`** — ojo, esto es DISTINTO al patrón del campo `plan`, que siempre se renderiza y solo
  cambia su valor por defecto según `inicial`: acá el campo entero no existe en el DOM al editar, no solo
  cambia su valor. `inicial` presente = está editando una cuenta que ya existe, confirmado contra
  `nuevo/page.tsx` — que no pasa `inicial` — y `[id]/page.tsx` — que sí lo pasa)
- Modificar: `app/admin/(protegido)/cuentas/actions.ts` (`accionCrearCuenta` lee `formData.get('cobranza')`
  POR SU CUENTA, aparte de `leerDatos`, y se lo pasa a `crearCuenta` como el parámetro nuevo;
  `accionActualizarCuenta` no cambia — sigue sin tocar `cobranza` para nada)

- [ ] `crearCuenta` con el parámetro nuevo, el `<select>` condicional a `!inicial`, `accionCrearCuenta`
  leyendo el campo aparte — todo escrito. Confirmar que `actualizarCuenta` y `leerDatos` quedan
  IDÉNTICOS a como están hoy (ni un campo de cobranza pasa por ahí).
- [ ] Test de `crearCuenta` con `cobranza: 'exenta'` (y sin pasarlo, default `'normal'`) — escrito, con el
  comentario `// SIN CORRER: necesita la migración 0038.` en el encabezado, sin correr.
- [ ] `npx tsc --noEmit` limpio.
- [ ] Commit.

## Tarea 4 — Capa de datos y acciones de FM: cobranza (Tarea 3 de la spec de cobranza)

**Spec:** cobranza, "Acciones de FM" (las 5), y "Pedir un pago al cliente".

**Separá esta tarea en DOS mitades, por lo que dijimos arriba sobre qué necesita la migración:**

### 4a — Lo que NO necesita la migración 0038 (se construye y se prueba de punta a punta ahora)

**Archivos:**
- Crear: `lib/comercios/pedirPago.ts` (+ test contra Supabase)
  - `pedirPago(supabase, cuentaId, datos: { monto: number; plan: string | null; periodoDesde: string;
    periodoHasta: string }): Promise<ResultadoRegistroCobro>` — crea un cobro `pendiente`,
    `metodo = 'Pedido por FM'`, con `tipo` derivado de si hay `plan` (`'periodo'`) o no
    (`'ajuste'`, monto libre — ver spec para el caso "sirve para probar con $1"). Reusa `validarCobro`
    o una variante: el monto puede no coincidir con ningún plan del catálogo a propósito.
  - `anularCobroPendiente` YA EXISTE (`lib/comercios/cobros.ts`) — confirmá que sirve tal cual para
    "anular un cobro pendiente de cualquier tipo" (no solo `metodo = 'Wompi'`); si no, ampliarla.
- Crear: `lib/comercios/accionesCobranza.ts` (o sumar a `app/admin/(protegido)/cuentas/actions.ts`,
  decidir al implementar cuál mantiene el archivo en un tamaño razonable):
  - `accionPedirPago(cuentaId, prevState, formData)`: `verifyFmAdmin()` primero, fuera de try/catch.
  - `accionAnularCobro(cuentaId, cobroId, prevState, formData)`: ídem, acota el cobro a la cuenta.
- Crear: `lib/comercios/accionPagarCobro.ts` (o en `app/comercio/(protegido)/plan/actions.ts`) (+ test
  contra Supabase):
  - `accionPagarCobro(cobroId, prevState, formData)`: el DUEÑO paga un cobro que FM le pidió. Acota por
    `verifyComercioOwner()` (o el gate que corresponda) + el cobro tiene que ser de SU cuenta,
    `metodo = 'Pedido por FM'` y `pendiente`. Si ya tiene un enlace vigente (`wompi_enlace_vence` en el
    futuro) lo reusa; si no, `crearEnlacePago` con el MISMO `identificador` (spec: **spike confirmado, Wompi
    acepta enlaces duplicados** — no hace falta anular nada antes) y `guardarEnlaceDelCobro`.

**Pruebas (contra Supabase, corren AHORA):**
- `pedirPago`: crea el cobro con los campos correctos; el monto no tiene que coincidir con ningún plan.
- `accionAnularCobro`: anula solo si es de esa cuenta y sigue pendiente; un cobro de otra cuenta no se
  toca (mutación: quitar el filtro por cuenta → falla el caso "no anula el de otra cuenta").
- `accionPagarCobro`: reusa un enlace vigente; crea uno nuevo si venció o no había; rechaza un cobro que
  no es `'Pedido por FM'`, uno ya pagado, uno de otra cuenta (cada rechazo con su mutación).

- [ ] Tests primero (rojo) para `pedirPago`, `accionAnularCobro`, `accionPagarCobro`.
- [ ] Implementación de las tres.
- [ ] Mutaciones de la lista de arriba, restaurando cada una.
- [ ] `npx tsc --noEmit`, `npm run lint` (o el comando de lint del proyecto) limpios.
- [ ] Commit.

### 4b — Lo que SÍ necesita la migración (se escribe y se prueba en lo puro; DB sin correr)

**Archivos:**
- Crear: `lib/comercios/modoCobranza.ts` (+ test puro donde aplique, + test contra Supabase SIN CORRER)
  - `cambiarModoCobranza(supabase, cuentaId, modo: 'normal' | 'exenta')`: pasar a `normal` fija
    `cobranza_desde = hoy`; pasar a `exenta` limpia `cobranza_pospuesta_hasta`.
  - `posponerPago(supabase, cuentaId, hasta: string | null)`: fecha futura o `null` para quitarlo.
  - `perdonarCiclo(supabase, cuentaId, hoy: string)`: usa `periodoAPerdonar` (Tarea 1) + crea un cobro
    `periodo`, `pagado`, `monto: 0`, `metodo: 'Perdonado por FM'`, `pagado_en: hoy`. NO llama a
    `notificarPagoAMeta`.
- Acciones de servidor correspondientes en el mismo archivo de acciones de 4a.

**Test:** escribí el archivo de test COMPLETO (casos + mutaciones anotadas en el encabezado, igual que el
resto del proyecto) pero **no lo corras** — el `describe`/`it` va a fallar con un error de columna
inexistente hasta que la migración esté aplicada. Dejá una nota en el encabezado del test:
`// SIN CORRER: necesita la migración 0038 (cuentas_comercio.cobranza). Ver docs/superpowers/plans/2026-09-21-cobranza-y-rework-admin.md.`

- [ ] Escribir `modoCobranza.ts` y su test (sin correrlo).
- [ ] `npx tsc --noEmit` limpio (esto SÍ hay que verificarlo, aunque el test no corra: un error de tipos
  se detecta sin tocar la base).
- [ ] Commit, dejando claro en el mensaje que la parte de base no se corrió.

## Tarea 5 — El gate de bloqueo (`verifyComercioAcceso`)

**Spec:** cobranza, "Cómo se bloquea (el gate)". **Depende de la migración** (necesita `estadoEfectivo`
con datos reales de `cuentas_comercio`) — se escribe y se prueba en lo que se pueda sin DB, el resto sin
correr, igual que la Tarea 4b.

**Archivos:**
- Modificar: `lib/comercio/verifyComercioAcceso.ts` (agrega la variante que bloquea; la que no bloquea
  puede ser la función actual, o al revés — decidir el nombre que rompa menos código existente)
- Modificar: `app/comercio/(protegido)/layout.tsx` (usa la variante SIN bloqueo + banner)
- Crear: `app/comercio/suspendida/page.tsx` (pantalla del cajero)
- Modificar: `app/comercio/(protegido)/plan/page.tsx`, `pago/resultado/page.tsx`,
  `plan/comprobante/[cobroId]/page.tsx` (siguen usando la variante SIN bloqueo — son las únicas
  excepciones)
- Test: `lib/comercio/verifyComercioAcceso.test.ts` (si no existe, crearlo) — **sin correr** la parte que
  necesita `cuentas_comercio.cobranza` real.

**Pruebas (parte pura, corre ahora):** dado un `estadoEfectivo` ya calculado, ¿a dónde redirige un owner
vs. un cajero? (Esto SÍ se puede probar puro, inyectando el estado en vez de calculándolo desde la base —
separar "calcular el estado" de "decidir a dónde redirige" en dos funciones, la segunda pura y
testeable sin DB.)

- [ ] Separar la función en: `decidirRedireccion(estado: EstadoCobranza, rol: 'owner' | 'cajero'):
  string | null` (pura, testeable ahora) + el wrapper que arma `estado` desde la base (sin correr su
  test hasta la migración).
- [ ] Test puro de `decidirRedireccion` con mutación.
- [ ] El resto de la Tarea 5 (wiring real, pantallas) se escribe pero no se verifica en el navegador
  todavía — necesita datos reales de cobranza.
- [ ] `npx tsc --noEmit` limpio.
- [ ] Commit.

## Tarea 6 — Dashboard: `fusionarActividad` y `lib/fm/dashboard.ts` (puro + Supabase, corre ahora salvo una tarjeta)

**Spec:** rework, "El dashboard".

**Archivos:**
- Crear: `lib/fm/actividad.ts` (+ test puro)
- Crear: `lib/fm/dashboard.ts` (+ test contra Supabase)

**`fusionarActividad`:** pura, mutación (orden invertido, límite ignorado, desempate que reordena).

**`ingresosDelMes`, `tamanoDeCartera`, `contarSolicitudesPendientes`, `actividadReciente`:** las CUATRO
NO dependen de la migración 0038 — se construyen y prueban contra Supabase ahora, con mutación en cada
una (criterio `null` ante error, nunca un cero falso).

**`contarCuentasEnRiesgo`:** SÍ depende de `estadoEfectivo`/columnas de cobranza. Se escribe, su test se
escribe, **no se corre**.

- [ ] Test de `fusionarActividad` (rojo → verde → mutación).
- [ ] Tests de las 4 funciones que no dependen de la migración, contra Supabase, con mutación cada una.
- [ ] `contarCuentasEnRiesgo`: implementación + test escrito, sin correr.
- [ ] `npx tsc --noEmit` limpio.
- [ ] Commit.

## Tarea 7 — Nav del admin, dashboard, borrado de `/admin/comercios`, alta de comercio desde cuenta

**Spec:** rework, "Nav", "El dashboard" (la página), y toda la sección sobre las rutas de `/admin/comercios`
que se borran y los 5 lugares que quedaban apuntando ahí.

**Archivos:**
- Modificar: `app/admin/(protegido)/layout.tsx` (saca "Comercios", logo → `<Link href="/admin">`)
- Crear: `app/admin/(protegido)/page.tsx` (el dashboard — layout A: 4 tarjetas arriba, cartera chica,
  actividad reciente. La tarjeta de "Cuentas vencidas o bloqueadas" puede mostrar un placeholder tipo "—"
  hasta que la Tarea 9/migración esté lista — **no bloquea el resto del dashboard**)
- Borrar: `app/admin/(protegido)/comercios/page.tsx`, `app/admin/(protegido)/comercios/nuevo/page.tsx`
- Modificar: `app/admin/(protegido)/comercios/actions.ts` (borra `accionCrearComercio`; corrige los
  redirects + `revalidatePath` de `accionActualizarComercio`/`accionEliminarComercio` a
  `/admin/cuentas/${cuentaId}`, leyendo `cuenta_id` de `formData` / del registro antes de borrar)
- Modificar: `app/admin/(protegido)/comercios/[id]/editar/page.tsx` (los dos "← Volver")
- Modificar: `app/admin/login/actions.ts` (redirect a `/admin` en vez de `/admin/comercios`)
- Modificar: `app/admin/(protegido)/cuentas/[id]/page.tsx` (agrega el formulario "Nuevo comercio" —
  `<details>` plegado, debajo de `FormularioVincular`) y `app/admin/(protegido)/cuentas/actions.ts`
  (`accionCrearComercioDeCuenta`)

- [ ] Borrar las dos páginas y `accionCrearComercio`.
- [ ] Arreglar los 5 lugares (login, actualizar, eliminar ×2 con revalidatePath, los dos Volver).
- [ ] `accionCrearComercioDeCuenta` + el `<details>` en la ficha de cuenta.
- [ ] El dashboard (`app/admin/(protegido)/page.tsx`), con la tarjeta de vencidas/bloqueadas en
  placeholder.
- [ ] `npx tsc --noEmit`, lint limpios.
- [ ] Recorrido en el navegador: loguearse cae en el dashboard (no 404); guardar/borrar un comercio desde
  `[id]/editar` vuelve a la cuenta dueña; `/admin/comercios` y `/admin/comercios/nuevo` dan 404; crear un
  comercio nuevo desde una cuenta lo deja vinculado a ESA cuenta.
- [ ] Commit.

## Tarea 8 — Ficha de cuenta con pestañas + insignia en la lista

**Spec:** rework, "La ficha de cuenta, con pestañas" y "Lista de cuentas".

**Archivos:**
- Modificar: `app/admin/(protegido)/cuentas/[id]/page.tsx` (pestañas `?tab=datos|negocios|cobros|cobranza`
  — Datos/Negocios/Cobros son el contenido que YA existe, solo reagrupado; Cobranza queda con los
  controles de la Tarea 4 y 4b — los de 4b (modo, posponer, perdonar) se muestran pero fallarán hasta la
  migración: dejarlos visibles con un aviso, no ocultarlos, para no tener que volver a tocar la pantalla
  después)
- Modificar: `app/admin/(protegido)/cuentas/page.tsx` (las dos pastillas — cobranza usa `estadoEfectivo`
  con placeholder hasta la migración, cupo sigue como está)

- [ ] Pestañas con las tres que no dependen de la migración, funcionando de punta a punta.
- [ ] La pestaña Cobranza con los controles de "pedir pago" y "anular" (Tarea 4a) funcionando ya; los de
  4b visibles con un aviso "disponible cuando se aplique la migración 0038" si el modo/posponer/perdonar
  todavía no corren.
- [ ] `npx tsc --noEmit` limpio.
- [ ] Recorrido en el navegador de las 4 pestañas, en los tres temas, a ancho de teléfono.
- [ ] Commit.

## Tarea 9 — Marca del comercio, con pestañas

**Spec:** rework, "Marca, con pestañas" (la sección más revisada de las dos specs — seguila al pie de la
letra: Colores+Franja comparten un `<form>`, Imágenes es independiente, Reverso es independiente,
`noValidate` + auto-cambio a Colores ante un error de color).

**Archivos:**
- Modificar: `app/comercio/(protegido)/branding/page.tsx`, `FormularioBranding.tsx`,
  `FormularioReverso.tsx` (pestañas `?seccion=colores|imagenes|franja|reverso`)

- [ ] Pestañas puramente visuales sobre los TRES mecanismos de guardado existentes (no se toca ningún
  Server Action).
- [ ] `noValidate` en el form de Colores/Franja + el auto-cambio de pestaña ante un error de color.
- [ ] `npx tsc --noEmit` limpio.
- [ ] Recorrido en el navegador: los 15 tipos de campo en las 4 pestañas; el caso de la spec (editar
  Colores sin guardar, ir a Reverso, guardar solo Reverso, volver y confirmar que Colores sigue sin
  guardar y Reverso sí); el caso del color vacío publicado desde Franja (vuelve a Colores con el error
  visible, no en silencio).
- [ ] Commit.

## Tarea 10 — Menú "más opciones" agrupado

**Spec:** rework, "Menú 'más opciones', agrupado".

**Archivos:**
- Modificar: `lib/comercio/navegacion.ts` (+ test — actualizar las aserciones exactas que ya existen en
  `navegacion.test.ts` para el nuevo campo `grupo`, incluido en `ENLACE_PREMIOS`)
- Modificar: `app/comercio/(protegido)/MenuOpciones.tsx`

- [ ] Agregar `grupo` a `ENLACES_MENU` y a `ENLACE_PREMIOS`.
- [ ] Actualizar `navegacion.test.ts` (las igualdades exactas que hoy no tienen `grupo`).
- [ ] `MenuOpciones.tsx` agrupa con los tres subtítulos.
- [ ] `npx tsc --noEmit` limpio; pruebas puras verdes en las dos zonas.
- [ ] Recorrido en el navegador del menú agrupado, con y sin canje (el intercambio Premios↔Programas).
- [ ] Commit.

## Tarea 11 — Cuando Daniel aplique la migración `0038`

**No es una tarea para el asistente ahora — es la que desbloquea todo lo que quedó "escrito, sin correr".**

**⚠️ Antes del paso 5 (el recorrido del gate), preguntarle a Daniel qué hacer con `M&M Inversiones` y
`Segundo`** (ver el aviso de la Tarea 3): esas dos cuentas tienen `licencia_estado = 'inactivo'` desde
antes de esta rama, y verificar el gate de punta a punta las bloquea de verdad. No se publica nada de esta
rama a `master` sin su respuesta.

Cuando Daniel avise que aplicó `0038`:
1. Correr `scripts/verificar-0038.ts` (solo lectura).
2. Correr TODAS las pruebas contra Supabase que quedaron sin correr (Tareas 4b, 5, 6, 8): deberían pasar
   a la primera si el código está bien: si alguna falla, es información real sobre el adaptador, no un
   fallo de la prueba.
3. Completar las mutaciones de esas pruebas (las que dependían de datos reales).
4. Sacar los placeholders/avisos de "disponible cuando se aplique la migración" del dashboard y de la
   pestaña Cobranza.
5. Recorrido completo en el navegador de todo lo que dependía de la migración: el gate bloqueando de
   verdad, el modo exenta/normal, posponer, perdonar, la tarjeta de vencidas/bloqueadas del dashboard.

## Tarea 12 — Revisión final del conjunto

Igual que la de la pasarela Wompi: dos revisores independientes (spec-compliance + seguridad; calidad de
código + pruebas decorativas), cada hallazgo verificado contra el código antes de aplicar nada,
`tsc`/`eslint`/`next build` limpios. Se hace DESPUÉS de la Tarea 11 (con la migración ya aplicada y todo
corrido de punta a punta) — hacerla antes dejaría sin revisar justo la mitad de la cobranza.

---

## Qué se puede terminar HOY (sin Daniel) vs. qué espera la migración

| Tarea | Se completa hoy | Espera la migración `0038` |
|---|---|---|
| 1 — `estadoDeCobranza`/`periodoAPerdonar` | Sí, entera (pura) | — |
| 2 — Migración + tipos + script | El SQL/tipos/script sí; que Daniel la APLIQUE, no | Aplicarla |
| 3 — `estadoEfectivo` | La función sí (pura); el gate/deploy que la usa, NO sin la respuesta de Daniel sobre M&M/Segundo | Verificarla en el gate real (Tarea 11) |
| 3b — selector de cobranza en "Nueva cuenta" | Código sí; prueba de base sin correr | Correr y verificar |
| 4a — pedir pago, anular, `accionPagarCobro` | Sí, entera, con base real | — |
| 4b — modo/posponer/perdonar | Código sí; pruebas de base sin correr | Correr y verificar |
| 5 — el gate | La parte pura (`decidirRedireccion`) sí; el resto, código sin correr | Correr y verificar en el navegador |
| 6 — dashboard | 5 de 6 métricas, con base real; "vencidas/bloqueadas" en placeholder | Esa tarjeta |
| 7 — nav, dashboard (página), borrado de rutas, alta desde cuenta | Sí, entera | — |
| 8 — ficha de cuenta con pestañas | Datos/Negocios/Cobros enteras; Cobranza parcial (4a sí, 4b con aviso) | El resto de Cobranza |
| 9 — Marca con pestañas | Sí, entera | — |
| 10 — menú agrupado | Sí, entera | — |
| 11 — cuando Daniel aplique | — | Todo lo de arriba que quedó pendiente |
| 12 — revisión final | — | Se hace después de la 11 |

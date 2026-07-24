# Diseño: Cuentas multi-negocio + Sucursales + Cajeros + BI (Fase 6)

**Fecha:** 2026-07-21
**Estado:** Borrador para revisión (spec-document-reviewer + usuario) antes de escribir el plan de implementación.
**Origen:** brainstorming dirigido por el usuario (decisiones cerradas abajo). Exploración del código
verificada contra los archivos vivos, no de memoria.

## 1. Contexto y problema

FM Lealtad vende programas de lealtad a clientes-negocio. Hoy el modelo asume implícitamente
**una cuenta de acceso = un comercio**: no existe un concepto de "cliente que paga" por encima del
comercio, ni sucursales, ni cuentas de cajero, ni reportería. Ya hay un cliente real por entrar con
**2 negocios distintos** (uno con tarjeta de sellos, otro de puntos), y a futuro clientes con
**varias sucursales de la misma marca**.

Este proyecto cubre los DOS casos, que son distintos a propósito:

- **Comercios distintos** bajo un mismo cliente que paga — cada uno con su branding y tipo de tarjeta
  propios, sus propios clientes y su propia tarjeta. (El caso del cliente que ya viene.)
- **Sucursales** de un mismo comercio que **comparten una sola tarjeta** (como una tarjeta de café
  válida en cualquier local de la cadena), con atribución por sucursal de cada visita/canje, cuentas
  de cajero por sucursal, y pantallas de estadísticas/BI.

## 2. Decisiones cerradas (no reabrir)

1. Nueva tabla `cuentas_comercio` (el cliente que paga) con `limite_negocios` **aplicado por código**
   (bloquea la creación/vinculación del negocio N+1).
2. `licencia_estado`/`licencia_plan`/`licencia_monto_mensual` se quedan POR comercio (permite pausar
   un negocio del cliente sin tocar el otro).
3. **Login multi-comercio con selector.** 1 comercio → directo al panel (UX idéntica a hoy); 2+ →
   pantalla "elegí tu negocio" + selector en el header. La selección vive en cookie pero SIEMPRE se
   revalida contra la lista real de membresías (una cookie manipulada apuntando a un negocio ajeno se
   rechaza).
4. **Sucursales comparten la tarjeta/branding/QR del comercio.** Seguro sin cambiar el modelo de
   tarjetas porque `tarjetas` ya es `UNIQUE(cliente_id, comercio_id)`. Un solo QR de registro por
   marca. Una tarjeta distinta = otro comercio (caso 1), no una sucursal.
5. **Atribución por transacción:** `sucursal_id` + `cajero_usuario_id` en `transacciones_puntos` y
   `canjes` (hoy ambas columnas de cajero existen pero nunca se escriben, y no hay `sucursal_id`).
6. **Cuentas de cajero creadas por el DUEÑO** desde su panel, cada una atada a una sucursal. El rol
   `cajero` ya existe en `usuarios_comercio` (CHECK de la 0001) pero no se usa en ningún lado.
7. **Arreglo de atomicidad OBLIGATORIO:** acreditar/canjear pasan a funciones atómicas de Postgres
   (RPC), reemplazando el patrón leer-luego-escribir que hoy asume "un solo cajero por comercio".
8. **Pantallas de BI en AMBOS paneles** (dueño y FM), con agregaciones hechas en SQL.

## 3. Colisión crítica descubierta (bloquea la decisión 3)

`usuarios_comercio.email` es `UNIQUE` global (migración 0001). "Una cuenta administra varios
comercios" necesita ≥2 filas con el mismo `auth_user_id`/`email` → imposible con ese unique.

**Arreglo (migración 0008):** `drop constraint usuarios_comercio_email_key;
add constraint usuarios_comercio_comercio_email_key unique (comercio_id, email)`.

Impacto: los `upsert(..., { onConflict: 'email' })` de los seeds pasan a
`onConflict: 'comercio_id,email'` (`scripts/seed-usuario-comercio.ts`, `scripts/seed-demo-owners.ts`).
`usuarios_fm` no se toca (su unique de email es correcto: los admin FM sí son globales).

Segundo bug que esto arregla: `esOwnerDeComercio` usa `.maybeSingle()` y el propio código
(`lib/comercio/esOwnerDeComercio.ts:20-24`) advierte que 2 filas owner lanzan `PGRST116` y **bloquean
al usuario**. Pasar a una lista lo elimina de raíz.

## 4. Arquitectura

### 4.1 Migraciones (aplicadas A MANO por el usuario en Studio; append-only; la última es 0007)

**`0008_cuentas_sucursales_cajeros.sql`** — schema + backfill en una sola migración:
- `cuentas_comercio (id uuid pk, nombre text not null, limite_negocios int not null default 1
  check (limite_negocios > 0), created_at timestamptz)` + RLS deny-all (patrón del resto del esquema).
- `comercios add column cuenta_id uuid references cuentas_comercio(id)` **nullable, se queda nullable**
  → bloque `do $$` que, por cada comercio existente, crea una cuenta 1:1 con `nombre = comercio.nombre`
  y `limite_negocios = 1`, y la asigna. (Los 6 comercios actuales quedan cada uno en su cuenta con
  límite 1: cero cambio de comportamiento.)
  **Por qué nullable y no `NOT NULL`:** un `NOT NULL` rompería ~18 helpers de test y seeds que insertan
  comercios con solo `{nombre, slug}` (p. ej. `acreditar.test.ts`, `canje.test.ts`,
  `registrarCliente.test.ts`, los `route.test.ts` de Apple/portal, etc.), y con `fileParallelism:false`
  contra la BD viva un solo helper olvidado tumba la suite entera. La defensa real es la capa lib
  (`validar()` en `guardarComercio.ts`), exactamente el patrón documentado del proyecto ("la BD casi no
  respalda la validación; `validar()` es la ÚNICA defensa"). Un `cuenta_id` null degrada con gracia
  (queda fuera de los reportes agrupados por cuenta y fuera de cualquier límite), no rompe nada. Los
  seeds REALES (`scripts/seed-demo-comercios.ts`, `scripts/seed-pilot-comercio.ts`) SÍ se actualizan
  para crear+asignar una cuenta (son datos que se muestran); los helpers de test que insertan comercios
  DIRECTO (`insert({nombre, slug})`, saltándose `validar()` — `acreditar.test.ts`, `canje.test.ts`,
  etc.) se dejan como están (filas descartables, con `cuenta_id` null, que prueban otra cosa).
  **EXCEPCIÓN — `lib/comercios/guardarComercio.test.ts` SÍ debe refactorizarse:** su factory
  `datosValidos()` (líneas 33-50) NO inserta directo — construye un `DatosComercio` y lo pasa por la
  CAPA LIB (`crearComercio`/`actualizarComercio`), justo donde §4.3 agrega la regla `validar()` "La
  cuenta es obligatoria." + `verificarLimiteCuenta`. Sin refactor, esa suite entera se pone roja (el
  primer test esperaría `ok:true` y recibiría "La cuenta es obligatoria."; los tests que crean 2
  comercios —p. ej. slug duplicado— fallarían por límite antes de llegar a lo que aseveran, porque una
  cuenta nace con `limite_negocios` default 1). Refactor: un helper async `cuentaDePrueba()` que inserta
  una `cuentas_comercio` con `limite_negocios` alto (p. ej. 999, para que el límite no interfiera con lo
  que esos tests prueban), `datosValidos()` pasa a async (o recibe el `cuentaId`) y arrastra ese
  `cuenta_id`, y el `afterEach` borra las `cuentas_comercio` de prueba DESPUÉS de los comercios (orden
  FK, §5). Este refactor es parte del paso 5 de §6.
- Swap del unique de email (§3).
- `sucursales (id uuid pk, comercio_id uuid not null references comercios(id), nombre text not null,
  activa boolean not null default true, created_at timestamptz)` + RLS.
- `usuarios_comercio add column sucursal_id uuid references sucursales(id)` (nullable; solo cajeros).
- `transacciones_puntos add column sucursal_id uuid references sucursales(id)`; igual en `canjes`.
- Extender `scripts/verify-schema.ts` (`TABLAS`) con `cuentas_comercio`, `sucursales`; correr
  `npm run verify-schema`.

**`0009_rpc_atomico.sql`** — dos funciones `plpgsql` (`set search_path = public`). La función entera
es la transacción; el `UPDATE ... RETURNING` toma lock de fila y serializa cajeros concurrentes — eso
es lo que reemplaza el leer-luego-escribir.

**SEGURIDAD (crítico) — las funciones son `SECURITY INVOKER` (default), NO `SECURITY DEFINER`, y se
les REVOCA `EXECUTE` de los roles públicos.** Razón: Supabase expone toda función del schema `public`
en `POST /rest/v1/rpc/<nombre>` a cualquier rol con `EXECUTE`, y `CREATE FUNCTION` otorga `EXECUTE` a
`PUBLIC` por defecto. La anon key va al bundle del navegador (`lib/supabase/client.ts`), así que es
pública. Una función `SECURITY DEFINER` corre con privilegios del dueño (superusuario, ignora RLS):
sin protección, cualquiera podría `POST .../rpc/acreditar_puntos_atomico` con un `p_comercio_id`
ajeno y acreditar/canjear en cualquier tarjeta, saltándose `verifyComercioAcceso` por completo (el
gate solo protege el camino de Server Action, no el endpoint REST directo). `SECURITY DEFINER` ni
siquiera se necesita: TODOS los callers usan `createServiceClient()` (service_role, que ya ignora
RLS) — escáner, ruta de puntos, seed, tests. Con `SECURITY INVOKER`, si `anon` invocara la función,
el cuerpo corre como `anon` y choca con el RLS deny-all de `tarjetas`/`transacciones_puntos`/`canjes`
(migración 0001) → no escribe nada. Defensa en profundidad, en el MISMO `.sql`:
```sql
revoke execute on function acreditar_puntos_atomico(...) from public, anon, authenticated;
revoke execute on function canjear_recompensa_atomico(...) from public, anon, authenticated;
grant execute on function acreditar_puntos_atomico(...) to service_role;
grant execute on function canjear_recompensa_atomico(...) to service_role;
```
Esto mismo aplica a TODAS las funciones de reportes de 0010 (un `p_comercio_id` ajeno filtraría BI
cross-tenant). Verificación manual obligatoria tras aplicar: intentar el RPC con la anon key debe
fallar/no escribir. Es el primer RPC del proyecto — no hay de dónde "copiarlo bien", por eso queda
explícito acá.

Las dos funciones:
- `acreditar_puntos_atomico(p_comercio_id, p_tarjeta_id, p_delta, p_sucursal_id, p_cajero_usuario_id)`
  → `returns table(estado text, puntos_actuales int)`. Valida sucursal∈comercio Y `activa = true` (si
  no null) → si no cumple, `sucursal_invalida`; `update tarjetas ... where id = p_tarjeta_id and
  comercio_id = p_comercio_id returning` (not found → `tarjeta_no_encontrada`); inserta en
  `transacciones_puntos` con `sucursal_id` + `cajero_usuario_id`; devuelve `ok`.
- `canjear_recompensa_atomico(p_comercio_id, p_tarjeta_id, p_recompensa_id, p_sucursal_id,
  p_cajero_usuario_id)` → `returns table(estado text, puntos_actuales int, nombre_recompensa text,
  costo_puntos int)`. Lee recompensa scoped + activa (si no → `recompensa_no_disponible`); valida
  sucursal∈comercio Y activa (si no → `sucursal_invalida`);
  `update tarjetas ... where ... and puntos_actuales >= v_costo returning` (not found →
  re-lee la tarjeta scoped: falta la tarjeta → `tarjeta_no_encontrada`, o `saldo_insuficiente`
  devolviendo saldo + costo para el mensaje "le faltan N"); inserta en `canjes`; devuelve `ok`.
  **Elimina la reversa best-effort** de `canje.ts` (ya no hace falta: decremento + insert en una sola
  transacción).

**`0010_reportes.sql`** — funciones set-returning `SECURITY INVOKER` con el MISMO `revoke execute ...
from public, anon, authenticated` + `grant ... to service_role` que 0009 (crítico: un `p_comercio_id`
ajeno vía anon key filtraría BI cross-tenant). Scope por `p_comercio_id` que viene del gate, nunca del
cliente; agregación en SQL (`count`/`group by`, no en JS):
- `reporte_sucursales(p_comercio_id)` → por sucursal: acreditaciones, puntos_otorgados, canjes,
  clientes_unicos (join a `tarjetas` porque las tablas de ledger no tienen `comercio_id`; bucket NULL
  para filas legacy sin sucursal).
- `reporte_top_clientes(p_comercio_id, p_limite)`, `reporte_tendencia(p_comercio_id, p_dias)`.
- `reporte_fm_comercios()` (+ opcional `reporte_fm_cuentas()`) cross-cliente para el panel FM. **El
  join `comercios → cuentas_comercio` debe ser LEFT join (o bucket "sin cuenta")** — igual que el bucket
  NULL de `sucursal_id` — para que un comercio con `cuenta_id` null (§4.1) no desaparezca en silencio
  del rollup por cuenta.
- Índices: `transacciones_puntos(sucursal_id)`, `canjes(sucursal_id)`, `transacciones_puntos(tarjeta_id)`,
  `transacciones_puntos(created_at)`.

### 4.2 `lib/supabase/types.ts` (a mano, en el mismo commit de cada migración)

Nuevas tablas `cuentas_comercio` y `sucursales`; columna `cuenta_id` (Row/Insert requeridos) en
`comercios`; `sucursal_id` nullable en `usuarios_comercio`/`transacciones_puntos`/`canjes`. **Entradas
`Relationships`** para cada FK nueva — son load-bearing: sin ellas los joins embebidos no tipan (ver
comentario en `types.ts:182-185`). Reemplazar `Functions: { [_ in never]: never }` por una entrada por
cada RPC que exista al final (2 de 0009 + las de 0010 — `reporte_sucursales`, `reporte_top_clientes`,
`reporte_tendencia`, `reporte_fm_comercios`, y `reporte_fm_cuentas` si se incluye); si falta la
entrada, `supabase.rpc()` no tipa. Las entradas de `Functions` se agregan en el commit de la migración
que crea cada función (las de 0009 en el paso 8, las de 0010 en el paso 10 — ver §6).

### 4.3 Cuentas + límite (panel FM)

- `lib/comercios/cuentas.ts` (nuevo): `crearCuenta`, `actualizarCuenta`, `verificarLimiteCuenta`,
  `asignarComercioACuenta`. Validación en la capa lib (patrón "`validar()` es la única defensa" de
  `guardarComercio.ts`).
- **El límite se aplica en TODOS los caminos que meten un comercio bajo una cuenta, no solo al crear**
  (esto es lo que corrige el hueco: el caso real — agrupar los 2 comercios del cliente que ya viene, o
  los 6 comercios que el backfill dejó cada uno en su cuenta de límite 1 — se hace REASIGNANDO
  `cuenta_id`, no creando). `verificarLimiteCuenta(supabase, cuentaId, { excluyendoComercioId? })`
  cuenta los comercios de la cuenta DESTINO (excluyendo el propio comercio si ya pertenece a ella,
  para que un update que no cambia de cuenta no se auto-bloquee) y falla si `count >= limite_negocios`
  con "Esta cuenta ya alcanzó su límite de N negocios." Lo llaman: `crearComercio` (antes del insert),
  `asignarComercioACuenta`, y `actualizarComercio` cuando `cuenta_id` cambia. El TOCTOU (check-luego-
  escribir) se acepta y documenta en una superficie de un solo admin FM; no se sobre-ingenieriza con
  trigger.
- `lib/comercios/guardarComercio.ts`: `DatosComercio` gana `cuenta_id`; `crearComercio` llama
  `verificarLimiteCuenta` antes del insert; `actualizarComercio` lo llama cuando `cuenta_id` cambia;
  `validar()` agrega "La cuenta es obligatoria." (defensa a nivel app del `cuenta_id` nullable, §4.1).
- Panel FM: nueva área `app/admin/(protegido)/cuentas/` (listar/crear/editar límite/vincular
  comercios), gate `verifyFmAdmin()` en cada página y cada acción (fuera de try/catch); selector
  `cuenta_id` en `FormularioComercio.tsx`; link de nav en `app/admin/(protegido)/layout.tsx`. La lista
  de cuentas muestra el conteo de negocios de cada una; una cuenta que queda con 0 comercios (tras
  reasignar) se puede eliminar desde ahí (borrar `cuentas_comercio` sin comercios que la referencien es
  seguro; con comercios, el FK 23503 lo impide — mismo patrón que `eliminarComercio`).

### 4.4 Login multi-comercio + selector

- `lib/comercio/membresiasDeUsuario.ts` (nuevo): devuelve la lista
  `{ usuarioComercioId, comercioId, nombre, rol, sucursalId }` sin `.maybeSingle()` (fix del lockout).
  Falla cerrado → `[]` con `console.error`.
- `esOwnerDeComercio` → devuelve la LISTA de comercios donde la cuenta es owner (reescribir su test
  para arrays).
- `lib/comercio/verifyComercioAcceso.ts` (nuevo, `cache()`, `server-only`): admite owner O cajero;
  resuelve el comercio activo desde la cookie `fm_comercio_activo` SIEMPRE validada contra la lista;
  1 membresía → esa; 2+ sin cookie válida → `redirect('/comercio/elegir')`.
- `verifyComercioOwner` → wrapper que además exige `rol === 'owner'`; conserva su return actual y le
  agrega `comercios` (la lista, para el selector del header). Las páginas/acciones de dueño existentes
  lo siguen llamando sin cambios. Si el usuario NO es owner del comercio activo pero SÍ tiene una
  membresía de cajero → `redirect('/comercio/escanear')` (no `sin-permiso`: es un cajero legítimo en la
  página equivocada); sin ninguna membresía → `redirect('/comercio/login?error=sin-permiso')`.
- `ownerDeSesion` (route handler `app/api/tarjetas/[tarjetaId]/puntos/route.ts`) → resuelve el comercio
  activo o `null` (2+ comercios sin cookie válida → `null` → 401). Es un endpoint legacy (el flujo real
  es `/comercio/escanear`): tras el RPC sigue funcionando, puebla `cajero_usuario_id` desde la sesión
  pero deja `sucursal_id` en null (no tiene contexto de sucursal). Ese 401 para un dueño de 2+ sin
  cookie es aceptable y se documenta, no se resuelve acá.
- Pantalla `app/comercio/elegir/` (FUERA de `(protegido)`, hermana de `login` — evita el loop de
  layout que documenta `CLAUDE.md:29-31`). `actions.ts`: `elegirComercio(comercioId)` revalida que
  `comercioId ∈ membresías`, setea la cookie httpOnly sameSite=lax, redirect al panel.
- Selector en el header (`app/comercio/(protegido)/layout.tsx` pasa a llamar `verifyComercioAcceso`
  para que los cajeros también entren al escáner): dropdown si owner con 2+; shell mínima (solo
  Escanear) si cajero. `cambiarComercioActivo` vive en `app/comercio/actions.ts`.
- `app/comercio/login/actions.ts`: tras el login, redirige por rol/cantidad.

**Invariante de seguridad:** `comercio_id` SIEMPRE del gate, nunca del formulario. La cookie de
comercio activo es entrada del cliente y por eso se valida contra la lista real en cada request.

### 4.5 Sucursales + cajeros (panel del dueño)

- `lib/comercio/sucursales.ts` (nuevo, espeja `recompensas.ts`): `crearSucursal`, `renombrarSucursal`,
  `cambiarEstadoSucursal` (soft enable/disable, nunca hard-delete: `transacciones_puntos`/`canjes` las
  referencian), `listarSucursales`, `sucursalPerteneceAComercio` (para validar el picker del dueño).
- UI `app/comercio/(protegido)/sucursales/` (page/actions/formulario/botón estado), gate
  `verifyComercioOwner()`.
- `lib/comercio/cajeros.ts` (nuevo): `crearCajero(serviceSupabase, comercioId, {email, password,
  sucursalId})` valida email/password/`sucursalId ∈ comercioId` → `auth.admin.createUser({email,
  password, email_confirm: true})` (mismo patrón que `scripts/seed-usuario-comercio.ts`) → insert en
  `usuarios_comercio {comercio_id, email, rol:'cajero', auth_user_id, sucursal_id}`. `listarCajeros`,
  `desactivarCajero` (quita la fila de `usuarios_comercio` → pierde acceso).
- UI `app/comercio/(protegido)/cajeros/`, gate `verifyComercioOwner()`.

**Seguridad:** la acción corre `createServiceClient()` (server-only, nunca al bundle del navegador);
está owner-gated; `sucursalId` se valida contra el comercio de la sesión; la contraseña del cajero
**nunca se loguea** (a diferencia del `console.error(error)` genérico del resto). Esto es un flujo de
PRODUCTO en runtime (el dueño crea a su cajero), distinto de la regla de CLAUDE.md sobre contraseñas de
seed que no pasan por el chat.

### 4.6 Escáner: cajero-fijo vs dueño-selector + atribución

- `escanear/page.tsx`: gate → `verifyComercioAcceso()`. Cajero → pasa `sucursalFija = {id, nombre}` a
  `Escaner`; owner → `listarSucursales(comercioId)` activas → picker. **Si el cajero tiene su
  `sucursal_id` apuntando a una sucursal desactivada** (`activa = false`), el escáner muestra un estado
  "tu sucursal está desactivada, contactá al dueño" y no permite acreditar — coherente con que el RPC
  también rechaza sucursal inactiva (§4.1). (Al owner no le afecta: el picker solo lista activas.)
- `Escaner.tsx`: etiqueta read-only (cajero) o `<select>` (owner); pasa `sucursalIdSeleccionada` a las
  acciones. El resto (cámara jsQR, token manual, lista de recompensas) sin cambios.
- `escanear/actions.ts`: gate → `verifyComercioAcceso()` en las tres acciones. Cajero → fuerza
  `sucursalId = sesion.sucursalId` (IGNORA cualquier valor del cliente). Owner → valida el
  `sucursalId` recibido contra el comercio (`sucursalPerteneceAComercio`), rechaza si no. Para ambos,
  `cajeroUsuarioId = sesion.usuarioComercioId` (los dueños también tienen fila en `usuarios_comercio`);
  esto por fin puebla el `cajero_usuario_id` que hoy siempre es null. Pasa `{sucursalId,
  cajeroUsuarioId}` a los wrappers.

### 4.7 Integración RPC atómico (mismo contrato de retorno)

- `lib/comercio/acreditar.ts`: `acreditarPuntos(supabase, comercioId, tarjetaId, delta, opciones?)`
  conserva la validación de `delta` (ya testeada); reemplaza leer+insertar+actualizar por
  `supabase.rpc('acreditar_puntos_atomico', …)`; lee `data?.[0]` y mapea `estado` → mensajes
  byte-idénticos a hoy (`'Esa tarjeta no existe en tu comercio.'`, etc.). `opciones` opcional mantiene
  el seed (`scripts/seed-demo-comercios.ts:231`, llamada de 4 args) y la ruta de puntos sin cambios.
- `lib/comercio/canje.ts`: `canjearRecompensa(..., opciones?)` reemplaza todo el cuerpo por
  `supabase.rpc('canjear_recompensa_atomico', …)`; el RPC devuelve `costo_puntos` y `puntos_actuales`
  para preservar el mensaje "le faltan N". El contrato `ResultadoCanje` queda intacto → los asserts de
  `canje.test.ts` siguen valiendo.

### 4.8 BI: queries + pantallas (agregación en SQL)

- `lib/reportes/reportes.ts` (nuevo): wrappers tipados sobre los RPC de 0010; `comercioId` SIEMPRE del
  gate.
- Dueño: `app/comercio/(protegido)/reportes/page.tsx` (gate owner) — tarjetas por sucursal (más
  clientes, más acreditaciones/visitas, más premios dados), tendencia, top clientes. Agregar a
  `ATAJOS` (panel) + `NavInferior`. Primer lugar donde se LEEN `transacciones_puntos`/`canjes`.
- FM: `app/admin/(protegido)/reportes/page.tsx` (gate `verifyFmAdmin`) — tabla agregada cross-cliente
  por comercio y por cuenta; link de nav en el layout admin.
- **Ajuste de copy (cosmético):** `app/mi-tarjeta/PortalCliente.tsx` dice "El canje se hace en el
  local" (singular); con multi-sucursal se ajusta a un texto neutral. El portal y los passes por lo
  demás son 100% compatibles con sucursales compartidas: leen saldo a nivel `tarjetas` y branding a
  nivel `comercios`, nunca tocan `transacciones_puntos`/`canjes`.

## 5. Testing (TDD + mutation testing obligatorio en lo crítico)

Tests de integración contra Supabase vivo (`fileParallelism:false`), asertan el mensaje específico,
limpian en `afterEach` con teardown FK-ordenado. **El orden de borrado importa por las aristas nuevas:**
`transacciones_puntos`/`canjes` → antes de `sucursales`; `usuarios_comercio` → antes de `sucursales`;
`sucursales` → antes de `comercios`; `comercios` → antes de `cuentas_comercio`. (Como `cuenta_id` es
nullable, los helpers sintéticos que no crean cuenta no necesitan borrar `cuentas_comercio`; los que sí
la crean, la borran al final.) Mutation-testear (romper la línea guardada, confirmar que la prueba
falla por la razón correcta con el mensaje correcto, restaurar):

- **`membresiasDeUsuario`/`esOwnerDeComercio` (lista):** un usuario dueño de DOS comercios devuelve
  AMBOS (el caso que antes bloqueaba con PGRST116). Mutación: volver a `.maybeSingle()` → el test de
  dos-comercios falla.
- **Validación de la cookie de comercio activo:** una cookie apuntando a un comercio que NO está en la
  lista se rechaza (no se honra). Mutación: quitar el chequeo `∈ membresías` → el test de cookie
  manipulada falla. (Testear el resolver puro, no el `redirect`, para no depender del contexto de
  request de Next.)
- **`verificarLimiteCuenta`:** al `count == limite` bloquea; al `count < limite` pasa. Mutación:
  `>=` → `>` → el test "al límite" falla.
- **RPC atómicos vía wrappers:** portar todos los casos de `acreditar.test.ts`/`canje.test.ts` (scope
  cross-comercio, saldo insuficiente, recompensa ajena/inactiva, fila de ledger escrita) — deben
  quedar verdes contra el RPC. NUEVO: `sucursal_id` + `cajero_usuario_id` quedan persistidos; una
  sucursal de otro comercio se rechaza (`sucursal_invalida`). Mutación de scope: quitar
  `and comercio_id = p_comercio_id` del `UPDATE` del RPC → el test cross-comercio falla.
- **Atribución del cajero:** la acción de un cajero ignora un `sucursalId` ajeno enviado por el cliente
  y registra el suyo. Mutación: hacer que la acción confíe en el valor del cliente → falla.
- **`sucursalPerteneceAComercio`:** una sucursal de otro comercio se rechaza.
- **Blindaje REST de los RPC (C1, verificación manual obligatoria tras aplicar 0009 y 0010):** con la
  anon key (no la service key), un `POST /rest/v1/rpc/acreditar_puntos_atomico` con parámetros
  arbitrarios debe fallar o no escribir NADA (el `revoke execute` lo corta; el RLS deny-all lo
  respalda). Igual para las funciones de reportes con un `p_comercio_id` ajeno: no deben devolver datos.
  Se corre una vez con un script descartable de solo-verificación y se documenta el resultado.

## 6. Orden de construcción (⚑ = requiere migración aplicada a mano ANTES)

1. **⚑ Migración 0008** + `types.ts` (tablas/columnas/Relationships, no Functions todavía) +
   `verify-schema.ts` + `npm run verify-schema`. *Nada del lado app se puede probar antes de esto.*
2. Arreglar `onConflict` de los seeds a `'comercio_id,email'`.
3. Auth core: `membresiasDeUsuario` + `esOwnerDeComercio` (lista) + `verifyComercioAcceso` + reescribir
   `verifyComercioOwner`/`ownerDeSesion`. Tests + mutación.
4. Selector: `app/comercio/elegir/` + dropdown del header + `cambiarComercioActivo` + redirect por rol
   en el login.
5. `cuentas_comercio` lib + pantallas FM + `cuenta_id`/límite en `crearComercio`. Tests + mutación.
6. Sucursales lib + CRUD del dueño.
7. Cajeros lib + CRUD del dueño (runtime `admin.createUser`).
8. **⚑ Migración 0009** (RPC atómicos) + `Functions` en `types.ts`; reescribir `acreditar.ts`/
   `canje.ts` a `.rpc()`; portar tests + mutación.
9. Escáner: gate → `verifyComercioAcceso`, picker/lock de sucursal, threading `sucursalId` +
   `cajeroUsuarioId`.
10. **⚑ Migración 0010** (funciones BI + índices) + `Functions` en `types.ts`; `lib/reportes/` +
    pantalla reportes del dueño + pantalla reportes FM.

## 7. Explícitamente fuera de alcance

- **Recompensas/reglas por sucursal** — hoy son a nivel comercio y se quedan así; las sucursales
  comparten el catálogo del comercio.
- **Pasarela de pago / cobro automático del plan** — `limite_negocios` se administra a mano en el
  panel FM, igual que el resto de la licencia.
- **Registro que sepa la sucursal** — un solo QR por marca (decisión 4); la sucursal se conoce por
  quién escanea, no por dónde se registró el cliente.
- **RPC atómico para el resto de escrituras** — solo acreditar/canjear (las que tienen concurrencia
  real entre sucursales).

## 8. Nota de proceso

Al aprobar este spec (spec-document-reviewer + usuario), se genera el plan de implementación
tarea-por-tarea con `writing-plans` y se ejecuta con subagent-driven-development (implementador +
revisión de spec-compliance + revisión de code-quality por tarea), con mutation-testing en las ramas
críticas — la vara vigente del proyecto.

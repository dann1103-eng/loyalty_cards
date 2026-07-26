# Diseño: Panel comercio móvil — nav, sucursal Principal, switcher de contexto, alta self-serve y accesos de cajero

**Fecha:** 2026-07-25
**Estado:** Borrador para revisión (spec-document-reviewer + usuario) antes de escribir el plan de implementación.
**Origen:** brainstorming dirigido por el usuario sobre su QA en producción desde móvil (captura de la
sección Cajeros cortada por la nav). Exploración del código verificada contra los archivos vivos.

## 1. Contexto y problema

Cinco problemas/pedidos del usuario sobre el panel comercio, todos encima de lo ya desplegado
(cuentas multi-negocio + sucursales + cajeros + BI + plan por cuenta, migraciones 0008–0011):

1. **La nav inferior móvil no muestra todos los íconos y no se puede deslizar.** `NavInferior.tsx`
   tiene 8 enlaces en un flex `justify-content: space-around` sin overflow: en un viewport de ~375px
   entran ~6 y el resto queda cortado (Clientes y Reportes hoy son inalcanzables desde la nav).
2. **Callejón sin salida en planes con límite 1 (Starter).** El cupo cuenta comercios + sucursales
   sumados (`verificarLimiteCuenta`), así que un comercio Starter ya consume su única unidad →
   `crearSucursal` bloquea SIEMPRE (1+1=2>1) → sin sucursal activa, la sección Cajeros no permite
   crear ninguno ("Primero agregá una sucursal activa"). **Una cuenta Starter hoy no puede tener
   cajeros.** El usuario pide que todo comercio tenga una sucursal por defecto: la que representa el
   local en el que se trabaja.
3. **Crear un local nuevo debe preguntar QUÉ se crea.** Si la cuenta tiene cupo, un modal debe
   ofrecer "Sucursal" (otro local, misma tarjeta) o "Comercio nuevo" (otra marca, con su tipo de
   tarjeta e identidad propios). Hoy crear comercios es exclusivo del admin FM.
4. **Switcher de contexto en el topnav.** Un botón que diga en qué comercio/sucursal se están viendo
   los datos y permita cambiar, para tener distinción visual de lo que se gestiona. Excepción:
   Reportes, que debe mostrar el conglomerado con filtros propios.
5. **Los cajeros deben poder ver el Resumen y el directorio de Clientes** (para la asignación manual
   de puntos vía el flujo Acreditar/Canjear). Hoy ambos usan `verifyComercioOwner` y expulsan al
   cajero; su nav solo muestra Escanear.

## 2. Decisiones cerradas (confirmadas con el usuario en el brainstorming)

1. **Sucursal "Principal" como fila real que NO consume cupo.** Toda alta de comercio crea su
   sucursal Principal (`es_principal = true`); backfill para los existentes. El cupo pasa a contar
   **comercios + sucursales ADICIONALES** (la principal es gratis): Starter = 1 local con cajeros
   funcionando; Growth = 2 locales. Se descartó la alternativa "principal virtual sin fila" (dejaba
   dos representaciones para siempre y mezclaba el histórico "sin asignar" con "Principal").
2. **Alta de comercio self-serve: esencial en el modal, identidad en /marca.** El modal pide nombre
   y tipo de tarjeta; al crear, el panel se switchea al comercio nuevo y aterriza en
   `/comercio/branding` (el editor real, con preview) para terminar la identidad. Se descartó
   embeber el editor de marca en el modal (duplicaría el formulario y podrían divergir).
3. **Reportes = todos los comercios que administrás como owner, filtrable.** Ignora el switcher:
   agrega los comercios de las membresías owner de la sesión (la lista que ya devuelve el gate), con
   filtro propio Todo · comercio · sucursal. Se descartó "solo comercio activo + filtro sucursal".
4. **La nav se vuelve deslizable** (carrusel horizontal con snap y fades), no se recorta a un menú
   "Más". Se agrega Reglas a la nav (hoy solo alcanzable desde los atajos del panel).
5. **El cajero conserva el escáner como pantalla de aterrizaje post-login**; gana Resumen y Clientes
   en su nav. Reportes, Marca, Premios, Reglas, Sucursales y Cajeros siguen owner-only.

## 3. Migración `0012_sucursal_principal.sql` (a mano en Studio, append-only)

```sql
-- 0012: sucursal "Principal" por comercio. La primera sucursal de todo comercio pasa a ser su
-- principal: no consume cupo del plan (la aplica la capa app), no se puede desactivar (capa app),
-- y es la default para cajeros/atribución. Máximo una por comercio (índice parcial).

alter table sucursales add column es_principal boolean not null default false;

create unique index sucursales_principal_unica on sucursales (comercio_id) where es_principal;

-- Backfill 1: comercios que YA tienen sucursales → la más antigua pasa a principal (desempate por
-- id para que sea determinista). El dueño puede renombrarla, así que no impone nada.
update sucursales s
set es_principal = true
where s.id = (
  select s2.id from sucursales s2
  where s2.comercio_id = s.comercio_id
  order by s2.created_at, s2.id
  limit 1
);

-- Backfill 2: una principal debe estar disponible — si la elegida estaba inactiva, se reactiva
-- (sin esto, un comercio con todas sus sucursales apagadas seguiría sin poder crear cajeros).
update sucursales set activa = true where es_principal and not activa;

-- Backfill 3: comercios SIN sucursales → se les crea su "Principal" activa.
insert into sucursales (comercio_id, nombre, activa, es_principal)
select c.id, 'Principal', true, true
from comercios c
where not exists (select 1 from sucursales s where s.comercio_id = c.id);
```

La BD solo garantiza "máximo una principal por comercio"; que exista **exactamente una** lo asegura
la capa app (alta de comercio + regla de auto-reparación en `crearSucursal`, §4.2). Un comercio sin
principal (fila insertada por fuera del flujo) degrada al comportamiento actual, sin romper nada.

Verificación post-migración: script read-only `scripts/verificar-0012.ts` (cuenta principales por
comercio = 1, ninguna principal inactiva, columnas nuevas presentes).

## 4. Arquitectura

### 4.1 Cupo del plan: la principal es gratis (`lib/comercios/cuentas.ts`)

- `verificarLimiteCuenta` pasa a contar sucursales con `.eq('es_principal', false)` (las inactivas
  siguen contando, como hoy — sin cambio de política ahí).
- Los dos llamadores que cuentan "sucursales propias" de un comercio a mover
  (`asignarComercioACuenta` en `cuentas.ts` y el camino move-de-cuenta de `actualizarComercio` en
  `guardarComercio.ts`) excluyen igual la principal en su `unidadesAAgregar`.
- Resultado: crear un comercio consume 1 (su principal viene gratis); cada sucursal adicional
  consume 1. Starter queda 1/1 (pleno pero funcional), Verde Raíz queda 2/2 en vez del 3/2 actual.
- Nueva función `cupoDeCuenta(supabase, cuentaId)` → `{ limite: number | null, usadas: number }`,
  extraída del MISMO conteo que usa `verificarLimiteCuenta` (una sola implementación del conteo,
  compartida — dos copias divergirían). La usan la página Sucursales y el switcher para decidir si
  ofrecen "Agregar" o muestran el aviso de límite.

### 4.2 Sucursales: candados y auto-reparación (`lib/comercio/sucursales.ts`)

- `SucursalListada` y `listarSucursales` exponen `esPrincipal`.
- `crearSucursal`: si el comercio **no tiene ninguna sucursal**, la que se crea nace
  `es_principal = true` y **no** verifica cupo (es la principal que faltaba — auto-reparación del
  caso "alta de comercio dejó al comercio sin principal por un fallo parcial"). Si ya hay
  sucursales, comportamiento actual: verifica cupo y nace `es_principal = false`.
- `cambiarEstadoSucursal`: candado nuevo — desactivar una principal devuelve
  `{ ok: false, error: 'La sucursal principal no se puede desactivar.' }` (se lee `es_principal`
  antes del update; mensaje exacto asertado en tests). La UI además no muestra el botón para la
  principal. Renombrarla sigue permitido.
- `crearSucursalPrincipal(supabase, comercioId)`: helper que inserta la fila
  `{ nombre: 'Principal', activa: true, es_principal: true }`. Lo llama `crearComercio`
  (`guardarComercio.ts`) tras un insert exitoso — así el alta de FM y la self-serve (§4.6) crean la
  principal por el mismo camino y ningún caller puede olvidarla. Si el insert de la principal falla:
  se loguea y `crearComercio` devuelve igual `ok: true` (el comercio existe; la primera sucursal
  creada a mano se vuelve principal por la regla de auto-reparación).

### 4.3 Nav inferior deslizable (`NavInferior.tsx` + `globals.css`)

- `.nav-inferior`: `overflow-x: auto` + `justify-content: flex-start`, ítems `flex: 0 0 auto`,
  scrollbar oculta (`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`),
  `scroll-snap-type: x proximity` con `scroll-snap-align: center` en los enlaces, y `mask-image`
  con degradado en ambos bordes (~16px) para insinuar contenido adicional; `padding-inline`
  suficiente para que el primer/último ítem queden fuera del fade en los extremos. Desktop sigue
  ocultándola (≥760px, sin cambios).
- La pestaña activa se auto-centra al navegar: efecto sobre `usePathname` que hace
  `scrollIntoView({ inline: 'center', block: 'nearest' })` del enlace activo dentro del contenedor.
- `ENLACES` gana Reglas (`/comercio/reglas`, icono `rule`) después de Premios.
- El filtro por rol se extrae a una función pura exportada `enlacesPorRol(rol)` (testeable):
  owner → todos; cajero → Resumen (`/comercio/panel`), Escanear, Clientes. Cualquier otro rol →
  solo Escanear (comportamiento actual de fallback).

### 4.4 Contexto "sucursal activa" (cookie + gate)

- `lib/comercio/cookieComercio.ts` gana `COOKIE_SUCURSAL_ACTIVA = 'fm_sucursal_activa'` (mismas
  `opcionesCookieComercio()`).
- Resolución PURA nueva `resolverSucursalActiva(rol, sucursalIdMembresia, sucursalesActivas,
  cookieValue)` en `lib/comercio/sucursalActiva.ts` (espeja `resolverComercioActivo`): para
  `cajero` devuelve SIEMPRE `sucursalIdMembresia` (la cookie se ignora — candado); para owner
  devuelve la cookie solo si apunta a una sucursal activa del comercio activo, si no `null`
  (= "todas").
- `verifyComercioAcceso` resuelve y devuelve además `sucursalActiva: { id, nombre } | null`:
  para owner, si hay cookie, UNA consulta service (`id, nombre` con `.eq('comercio_id', activo)
  .eq('activa', true)`); para cajero, la de su membresía (absorbe el fetch ad-hoc que hoy hace el
  layout). `cache()` ya memoiza por request. La cookie es input del cliente: **nunca** se usa sin
  esta revalidación.
- El ÚNICO setter es `cambiarContextoActivo(comercioId, sucursalId | null)` (§4.5) — no hay una
  acción separada solo-sucursal: cambiar de sucursal dentro del mismo comercio pasa por la misma
  acción con el comercio actual.
- `fijarComercioActivo` y el login **borran** `fm_sucursal_activa` al fijar comercio (cambiar de
  comercio resetea a "todas"; una cookie huérfana de otra sesión igual moriría en la revalidación,
  esto solo la limpia antes). En `cambiarContextoActivo`, la cookie de sucursal se escribe DESPUÉS
  del fijado/borrado del comercio — sin ese orden, elegir "Comercio B · Sucursal X" en el sheet
  aterrizaría en "todas".

### 4.5 Switcher de contexto en el header (`SelectorContexto.tsx`, reemplaza `SelectorComercio.tsx`)

- El layout arma, para los comercios owner, sus sucursales activas (una consulta service
  `.in('comercio_id', ownerIds).eq('activa', true)` agrupada en memoria) y renderiza la pastilla:
  `{comercio}` o `{comercio} · {sucursal}` si hay sucursal activa. Siempre visible para owner
  (aunque tenga 1 comercio y solo la Principal); para cajero, pastilla estática no interactiva con
  `{comercio} · {su sucursal}` (reemplaza el subtítulo actual del header con el mismo dato).
- Tap → bottom sheet (overlay CSS propio, sin dependencia nueva): por cada comercio una fila
  cabecera ("todas las sucursales") y sus sucursales activas anidadas (la Principal etiquetada);
  selección actual resaltada; al final **"+ Agregar local…"** que navega a
  `/comercio/sucursales?agregar=1` (abre el modal de §4.6).
- Acción única del sheet `cambiarContextoActivo(comercioId, sucursalId | null)` en
  `app/comercio/actions.ts`: gates/redirects FUERA de try/catch; valida el comercio contra las
  membresías **owner** de la sesión y la sucursal con `sucursalPerteneceAComercio` + activa, ANTES
  de escribir cookie alguna. NO reusa `fijarComercioActivo` tal cual (esa valida contra TODAS las
  membresías y siempre termina en `redirect('/comercio/panel')`, `Promise<never>`): reusa el
  *patrón* — revalidar contra membresías antes de escribir la cookie. Comportamiento: si cambia el
  comercio → fija cookie de comercio, escribe/borra la de sucursal y redirect a `/comercio/panel`
  (mundo de datos distinto); si el comercio no cambia → solo la cookie de sucursal (un id la
  escribe; `null` la BORRA = "todas"), `revalidatePath('/comercio', 'layout')` y SIN redirect
  (te quedás donde estás).
- Qué scopea la sucursal activa (owner): **Escanear** (el picker de atribución arranca
  preseleccionado en ella, editable por operación — hoy arranca en "Sin especificar"),
  **Cajeros** (lista filtrada a esa sucursal y `FormularioCajero` con `defaultValue` en ella;
  en "todas", la lista completa como hoy pero con la Principal preseleccionada en el form —
  preselección que es comportamiento NUEVO: hoy arranca en "Elegí una sucursal"), **Resumen** (se agrega una
  carta de actividad de esa sucursal con visitas/canjes desde `reporteSucursales`). Marca, Premios,
  Reglas y Clientes son del comercio (la tarjeta es compartida) y no cambian con la sucursal.
  Reportes ignora el contexto (§4.7).

### 4.6 Modal "¿Qué estás creando?" (`app/comercio/(protegido)/sucursales/ModalAgregarLocal.tsx`)

- La página Sucursales reemplaza el formulario siempre-visible por un botón **Agregar** que abre el
  modal (y se auto-abre con `?agregar=1`). El server pasa `cupoDeCuenta` y:
  - sin cupo restante → en lugar del modal, aviso: "Alcanzaste el límite de tu plan
    (N locales). Hablá con FM para ampliarlo." (la edición/estado de sucursales existentes sigue
    disponible).
  - comercio sin `cuenta_id` (legado): "Comercio nuevo" no se ofrece (no hay cuenta a la que
    asociarlo); "Sucursal" sí, con el comportamiento degradado actual (sin tope).
- **Paso 1**: dos tarjetas — "Sucursal: otro local que usa la misma tarjeta de {comercio}" y
  "Comercio nuevo: otra marca, con su propia tarjeta e identidad".
- **Paso 2a (Sucursal)**: solo nombre → reusa `accionCrearSucursal` existente (useActionState;
  al éxito cierra y la lista revalidada muestra la nueva). Que comparta la tarjeta es intrínseco al
  modelo — el copy lo dice, no hay nada más que configurar.
- **Paso 2b (Comercio)**: nombre + tipo de tarjeta (solo los `disponible: true` de
  `TIPOS_TARJETA`: puntos/sellos, mismas descripciones) → `accionCrearComercioPropio` (nueva). Al
  éxito, la propia acción fija el comercio nuevo como activo, borra la cookie de sucursal y hace
  `redirect('/comercio/branding?nuevo=1')`; la página de marca muestra un banner "Configurá la
  identidad de tu nuevo comercio" cuando ve `nuevo=1`.
- `crearComercioPropio` en `lib/comercios/crearComercioPropio.ts`:
  1. Deriva la **cuenta del comercio activo de la sesión** (nunca del formulario); sin `cuenta_id`
     → error claro.
  2. Slug autogenerado del nombre (minúsculas, sin acentos, espacios→guiones, colapsa guiones;
     vacío → `comercio`) con desambiguación `-2`, `-3`…: la disponibilidad se PRE-verifica con un
     select sobre `comercios.slug` (máx. 5 candidatos). `crearComercio` no expone el código 23505
     (lo traduce a mensaje), así que NO se matchea el error para reintentar: una colisión residual
     por carrera devuelve ese error tal cual y el usuario reintenta.
  3. Reusa `crearComercio` (que valida, verifica cupo y crea la sucursal Principal, §4.2) con
     los colores default del editor de marca (`rgb(19, 19, 21)` fondo / `rgb(245, 245, 240)` texto /
     `rgb(255, 157, 66)` etiqueta — los fallbacks de `branding/page.tsx`; los placeholder del
     formulario de FM son blanco/blanco/blanco, una tarjeta ilegible). `sello_meta` queda
     NULL (la 0005 no define default y `DatosComercio` ni lo incluye; `formatearSaldo` tolera null)
     — la meta de sellos se configura después en /marca, como los colores.
  4. Crea la membresía owner en `usuarios_comercio` (`auth_user_id` de la sesión, email copiado de
     la fila de la membresía owner actual, `rol: 'owner'`, `activo: true`).
  5. Si la membresía falla, **compensación best-effort**: borra la principal y el comercio recién
     creados (service client), loguea si tampoco se puede, y devuelve error — nunca `ok` con un
     comercio que el usuario no puede administrar.

### 4.7 Reportes conglomerado (`/comercio/reportes`)

- El gate sigue `verifyComercioOwner`; el alcance pasa a **todos los comercios de `comercios`**
  (la lista owner que el gate ya devuelve). Filtros por querystring, validados ANTES de correr
  cualquier RPC de reportes: `?comercio=<id>` contra esa lista en memoria, y `?sucursal=<id>` con
  una consulta de pertenencia al comercio filtrado; un id ajeno/inválido cae a "Todo". UI de filtros con chips GET (sin JS): fila 1
  `Todo · {cada comercio}`; con comercio elegido, fila 2 `Todas · {sus sucursales}`.
- **Todo**: métricas cabecera sumadas; sección por comercio (cada uno con sus sucursales, la
  Principal etiquetada); tendencia agregada día a día; top de clientes fusionado (orden por
  visitas, puntos como desempate, top 5) con etiqueta del comercio en cada fila.
- **Por comercio**: la vista actual (sin cambios de fondo).
- **Por sucursal**: la carta de ESA sucursal + cabecera con sus números; tendencia y top de
  clientes NO se muestran en esta vista (los RPC de la 0010 son por comercio; en su lugar, una nota
  "La tendencia y el top de clientes son del comercio completo" con link para quitar el filtro).
  Crear RPCs por sucursal queda explícitamente fuera de alcance (evita DDL nuevo).
- La agregación vive en `lib/reportes/reportes.ts`: wrappers `Promise.all` sobre los RPC por
  comercio existentes + helpers de merge **puros y exportados** (`sumarTendencias`,
  `fusionarTopClientes`) para testear sin BD. Cero migraciones SQL para esta sección.

### 4.8 Accesos del cajero

- `/comercio/panel` y `/comercio/clientes` cambian su gate a `verifyComercioAcceso` (compartido) y
  renderizan por rol: el cajero ve métricas, QR de registro (le sirve en caja para registrar
  clientes) y SOLO los atajos de sus secciones (Escanear, Clientes); el owner ve todo como hoy.
  Clientes es read-only + el enlace "Acreditar / Canjear" hacia `/comercio/escanear?token=…`, cuyas
  acciones ya usan gate compartido con atribución server-side — la asignación manual de puntos del
  cajero queda cubierta sin tocar ninguna Server Action.
- El enlace del logo del header (`inicio`) pasa a `/comercio/panel` para ambos roles (el cajero
  ahora tiene Resumen); el redirect post-login del cajero sigue siendo `/comercio/escanear` (su
  herramienta principal), igual que el rebote de `verifyComercioOwner` en páginas owner-only.

## 5. Seguridad (candados y sus mutation-tests)

| Candado | Dónde | Mutación que la prueba debe atrapar |
|---|---|---|
| La cookie de sucursal se ignora para cajeros | `resolverSucursalActiva` | devolver la cookie para rol cajero |
| Cookie de sucursal revalidada (pertenencia + activa) | `verifyComercioAcceso` / `cambiarContextoActivo` | quitar `.eq('comercio_id')` o el chequeo de `activa` |
| La principal no consume cupo pero las extra sí | `verificarLimiteCuenta` | quitar `.eq('es_principal', false)` |
| La principal no se desactiva | `cambiarEstadoSucursal` | quitar el candado → mensaje exacto |
| Cuenta destino derivada de la sesión | `crearComercioPropio` | tomar `cuenta_id` de un parámetro del cliente |
| Sin membresía owner no queda comercio vivo | `crearComercioPropio` | saltarse la compensación |
| Filtros de reportes validados contra membresías | página reportes | usar el querystring sin validar |
| Nav por rol no expone secciones owner | `enlacesPorRol` | devolver todos los enlaces para cajero |

Los redirect de gates siguen FUERA de todo try/catch (`NEXT_REDIRECT`). Ninguna cookie nueva se usa
sin revalidar server-side. `SUPABASE_SERVICE_ROLE_KEY` sigue solo en server (sin cambios).

## 6. Errores y estados borde

- Comercio sin principal (fallo parcial de alta): Sucursales lista normal; la primera sucursal
  creada a mano se vuelve principal gratis (§4.2); Cajeros vuelve a pedir sucursal — degradación
  suave, nunca bloqueo duro.
- `listarSucursales`/`cupoDeCuenta` con error de BD: la página Sucursales conserva el patrón
  actual (error visible, no "agregá la primera"); el switcher muestra la pastilla sin sheet de
  sucursales (solo comercios).
- Cambio de comercio con cookie de sucursal vieja: se borra al fijar; si sobreviviera, la
  revalidación la descarta a "todas".
- Slug: 5 colisiones seguidas → error claro "No se pudo generar una dirección única, cambiá el
  nombre." (caso ~imposible, pero no un loop infinito).
- Reportes sin actividad o con RPC caído: mismos estados vacíos fail-soft actuales (`[]`).

## 7. Testing

- **Puras (nuevas):** `resolverSucursalActiva`, `enlacesPorRol`, slugify + desambiguación,
  `sumarTendencias`, `fusionarTopClientes`.
- **Lib: integración contra Supabase REAL con fixtures y teardown — el patrón existente de
  `cuentas.test.ts`/`sucursales.test.ts`/`guardarComercio.test.ts`/`cajeros.test.ts` (en este repo
  NO se mockea Supabase; los únicos mocks viven en `lib/google`/`lib/apple` y son de las APIs de
  billeteras):** cupo con `es_principal` (crear comercio 1 unidad, sucursal extra 1, principal
  gratis), auto-reparación de `crearSucursal`, candado de `cambiarEstadoSucursal`,
  `crearComercioPropio` (cuenta de sesión, slug, membresía, compensación — "membresía falla" se
  provoca DE VERDAD con un `auth_user_id` inexistente, que viola la FK a `auth.users`),
  `crearComercio` crea principal. Inyección de fallos puntual (spy sobre el insert de la principal
  para el caso "alta parcial") solo donde la integración real no puede provocar el fallo.
- **Mutation-testing obligatorio** sobre los candados de §5: romper la línea, ver FALLAR la prueba
  por la razón correcta (mensaje/aserción específica), restaurar.
- Migración 0012 la corre el usuario en Studio; verificación con `scripts/verificar-0012.ts`
  (solo lectura). Sin dev server en subagentes; la verificación visual la hace el controlador con
  las herramientas de navegador o el usuario en producción.

## 8. Fases de implementación (cada una shippeable)

1. **Migración 0012 + cupo + candados de sucursales** (§3, §4.1, §4.2) — desbloquea cajeros en
   Starter y da la Principal en la UI de Sucursales.
2. **Nav deslizable + accesos de cajero** (§4.3, §4.8).
3. **Contexto de sucursal + switcher** (§4.4, §4.5).
4. **Modal de creación + alta self-serve** (§4.6).
5. **Reportes conglomerado** (§4.7).

## 9. Fuera de alcance (explícito)

- Gate de licencia en el panel comercio (hoy `licencia_estado` solo se usa en el admin FM; el alta
  self-serve mantiene esa política — endurecerlo sería un proyecto aparte).
- RPCs de tendencia/top por sucursal (0010 es por comercio; la vista por sucursal lo comunica).
- Límite de clientes por plan y setup fee (siguen sin modelar, ver estado del proyecto).
- Paginación del directorio de clientes; texto configurable al reverso de la tarjeta; trámite de
  Google Wallet (en pausa por decisión previa).

# Atajo de Android, monto mínimo de compra y reseña de Google — plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usá superpowers:subagent-driven-development para implementar
> este plan tarea por tarea (implementador + revisión de spec-compliance + revisión de calidad, por
> tarea). Los pasos usan casillas (`- [ ]`) para el seguimiento.
>
> **Este plan NO trae bloques de código completos a propósito**, igual que
> `2026-09-21-pasarela-wompi.md` y `2026-09-21-cobranza-y-rework-admin.md`: la spec ya tiene las firmas,
> el SQL, las reglas en orden y los textos exactos, y un bloque de código del plan que no se mantiene
> byte-idéntico al archivo publicado es peor que no tenerlo (regla del CLAUDE.md). **Los archivos
> publicados son la única fuente de verdad.** Cada tarea apunta a su sección de la spec y a sus archivos.

**Objetivo:** que el dueño que instala el panel en Android abra su panel y no el portal del cliente;
que un comercio pueda exigir el monto de la compra y un mínimo para sumar sellos/puntos; y que pueda
pedir una reseña de Google antes de que el cliente saque su tarjeta.

**Arquitectura:** manifests servidos por Route Handlers en `/manifiestos/*` y enlazados con
`metadata.manifest` por pantalla (Next 16 no admite `manifest.ts` anidado). La regla de monto es una
función pura aplicada en los dos caminos que acreditan puntos/sellos (escáner y "Agregar cliente"),
con el mínimo como `bloqueoLimite` para reusar el panel de autorización del dueño. La reseña es un paso
de cliente en `RegistroCliente` (sistema de honor) con el link validado contra una lista de hosts de
Google al guardar y al leer.

**Tecnología:** Next.js 16.2.10 (App Router), Supabase, Vitest 4, TypeScript estricto. Sin dependencias
nuevas.

**Spec:** `docs/superpowers/specs/2026-09-23-onboarding-manifest-monto-resena-design.md`. **Leela entera
antes de tocar nada** — en particular las decisiones 6 y 7 y la sección "Orden y despliegue".

**Rama:** `claude/cobranza-y-rework-admin` (la misma de la cobranza, ya publicada en `master` hasta
`6639521`). Se publica con `git push origin <sha>:master`.

---

## Antes de empezar (todas las tareas)

**Dónde se trabaja:** `C:\Users\Daniel\Desktop\Proyectos\Loyalty Cards\.claude\worktrees\focused-aryabhata-28e859`.
Cada subagente verifica con `git -C "<esa ruta>" branch --show-current` ANTES de tocar nada; si imprime
`claude/cobranza-y-rework-admin`, prosigue. Los subagentes arrancan en un worktree de infraestructura
ajeno a este repo: `cd` con la ruta absoluta en cada comando Bash y rutas absolutas en Read/Write/Edit.

**Pruebas:** este worktree YA tiene `.env.local` (lo copió Daniel), así que `npx vitest run <archivo>`
corre desde la ruta de arriba, puras y contra Supabase. Nunca leer ni imprimir `.env.local`.

**¿Está aplicada la migración 0039?** Lo dice el Paso 3 de la Tarea 2 (queda anotado ahí con fecha
cuando `verificar-0039.ts` la confirma). Toda tarea que tenga pruebas contra Supabase sobre
`exigir_monto_compra`, `monto_minimo_compra_centavos`, `pedir_resena_google` o `resena_google_url`
sigue UNA de dos rutas:
- **0039 ya aplicada:** rojo por la razón del feature → implementar → verde → mutaciones, todo en la
  misma tarea (como cualquier otra).
- **0039 todavía no aplicada:** esas pruebas fallan con "column … does not exist". Se escriben, se
  corren para confirmar que fallan por ESA razón, y el verde y sus mutaciones se difieren a la
  Tarea 9. No es un bloqueo: la tarea se entrega igual.

Las pruebas puras corren y pasan en cualquiera de los dos casos.

**Mutation-testing obligatorio** (CLAUDE.md): por cada rama crítica, romper la línea que la prueba dice
proteger, confirmar que la prueba FALLA por la razón correcta (mensaje exacto), restaurar. Cada tarea
lista sus mutaciones; el encabezado del archivo de prueba las documenta como "confirmadas" solo después
de correrlas.

**Nada de dev server en subagentes** (secuestra el puerto 3000). La verificación en el navegador la hace
el controlador.

**Commits:** identidad `Daniel <268727888+dann1103-eng@users.noreply.github.com>`
(`git -c user.name="Daniel" -c user.email="268727888+dann1103-eng@users.noreply.github.com" commit`),
`-m` plano, trailer `Co-Authored-By:` al final. `npx tsc --noEmit` y `npx eslint <archivos tocados>`
limpios antes de cada commit.

**Estilo:** comentarios e identificadores en español (voseo), con la densidad de comentarios del código
de alrededor: se explica el POR QUÉ, con el caso real que lo motivó.

---

## Tarea 1 — Manifests del panel del comercio y del admin (se publica sola)

**Spec:** sección 1. Sin migración: se implementa, se revisa, se verifica en el navegador y se publica
ANTES de empezar la Tarea 2.

**Archivos:**
- Crear: `lib/manifiestos.ts` — dos funciones puras `manifiestoComercio()` y `manifiestoAdmin()` que
  devuelven `MetadataRoute.Manifest` (tabla de la spec), y dos constantes exportadas con sus URLs
  (`URL_MANIFIESTO_COMERCIO = '/manifiestos/comercio.webmanifest'`, `URL_MANIFIESTO_ADMIN = …`).
- Crear: `lib/manifiestos.test.ts` — objetos + guardarraíl de archivos.
- Crear: `app/manifiestos/comercio.webmanifest/route.ts` y `app/manifiestos/admin.webmanifest/route.ts`
  — `GET` que responde el JSON con `Content-Type: application/manifest+json`.
- Modificar (agregar `export const metadata: Metadata = { manifest: URL_… }`):
  `app/comercio/(protegido)/layout.tsx`, `app/comercio/login/page.tsx`, `app/comercio/activar/page.tsx`,
  `app/comercio/clave/page.tsx`, `app/comercio/elegir/page.tsx`, `app/comercio/suspendida/page.tsx`,
  `app/admin/(protegido)/layout.tsx`, `app/admin/login/page.tsx`.
- Modificar: `app/registro-comercio/page.tsx` — SUMAR `manifest: URL_MANIFIESTO_COMERCIO` a su
  `metadata` existente (no reemplazarlo).
- NO crear `app/comercio/layout.tsx` ni `app/admin/layout.tsx` (regla del proyecto).
- NO tocar `app/manifest.ts` ni `lib/supabase/proxy.ts`.

- [ ] **Paso 1: pruebas (rojo).** En `lib/manifiestos.test.ts`:
  - Comercio: `start_url === '/comercio/panel'`, `id === '/comercio/panel'`, `scope === '/comercio/'`,
    `display === 'standalone'`, íconos `/mi-tarjeta/icono-192` y `-512` con `sizes` y `type`, y que
    `start_url` empiece con `scope` (invariante del navegador: fuera del scope, el scope se descarta).
  - Admin: `start_url === '/admin'`, `scope === '/admin'`, y la misma invariante `start_url` ⊂ `scope`.
  - Ninguno de los dos tiene `start_url` que empiece con `/mi-tarjeta` (el bug original).
  - Guardarraíl de archivos (estilo `lib/marca.test.ts`): recorre `app/comercio` y `app/admin`; todo
    `page.tsx` que NO esté bajo `(protegido)` y el `layout.tsx` de cada `(protegido)` tienen que
    declarar su manifest; además nombra explícitamente `app/registro-comercio/page.tsx`. "Declarar" es:
    **quitar los comentarios primero** (igual que `sinComentarios` en `lib/marca.test.ts:57-64`) y
    después matchear `manifest:\s*URL_MANIFIESTO_COMERCIO` (o `_ADMIN`), NO el nombre suelto de la
    constante: con el nombre suelto, un archivo que conserva el `import` pero perdió la clave
    `manifest` pasaría, y las mutaciones del Paso 4 sobrevivirían. Si la lista de archivos recorridos da
    menos de 8 (6 de comercio + 2 de admin), la prueba falla (una prueba que no mira nada pasa sola). El
    mensaje de falla lista los archivos que no declaran su manifest.
  - Correr: `npx vitest run lib/manifiestos.test.ts` → falla (módulo inexistente).
- [ ] **Paso 2: implementar** `lib/manifiestos.ts`, los dos Route Handlers y los `metadata` de las 9
  pantallas. Colores (`background_color`/`theme_color`) iguales a `app/manifest.ts` — importarlos de un
  solo lugar si se puede sin tocar `app/manifest.ts`; si no, un comentario que diga que se mueven juntos.
- [ ] **Paso 3: verde.** `npx vitest run lib/manifiestos.test.ts`.
- [ ] **Paso 4: mutaciones** (cada una debe fallar con su aserción, luego restaurar):
  - `scope: '/admin/'` en el admin → falla la invariante start_url ⊂ scope.
  - `start_url: '/mi-tarjeta'` en el comercio → falla.
  - Borrar el `export const metadata` de `app/comercio/elegir/page.tsx` DEJANDO el `import` de la
    constante → el guardarraíl lista ese archivo.
  - Borrar la clave `manifest` de `app/registro-comercio/page.tsx` dejando el `import` → lo lista.
  - Comentar la línea `manifest: URL_MANIFIESTO_ADMIN` de `app/admin/login/page.tsx` → lo lista.
- [ ] **Paso 5:** `npx tsc --noEmit`; `npx eslint` de los archivos tocados. Commit.
- [ ] **Paso 6 (controlador): navegador**, con `preview_start` (config `dev` de `.claude/launch.json`,
  corre en ESTE worktree): `/comercio/login` tiene UN solo `link[rel=manifest]` con href
  `/manifiestos/comercio.webmanifest`; `/admin/login` → admin; `/mi-tarjeta` y `/registro/<slug real>`
  → `/manifest.webmanifest`. `fetch('/manifiestos/comercio.webmanifest', { credentials: 'omit' })` →
  200, `content-type` `application/manifest+json`, `start_url` correcto. Chequear con `javascript_tool`.
- [ ] **Paso 7 (controlador): publicar** — `git push origin <sha de la tarea>:master`, esperar el deploy
  (`gh api repos/dann1103-eng/loyalty_cards/commits/<sha>/status --jq .state` hasta `success`), y
  confirmar en producción con `curl -s https://www.cardly-sv.site/comercio/login | grep -o 'rel="manifest"[^>]*'`
  y `curl -sI https://www.cardly-sv.site/manifiestos/comercio.webmanifest`.
- [ ] **Paso 8 (Daniel):** en Android, borrar el atajo viejo y volver a agregarlo desde el login del
  comercio. Anotar el resultado acá.

**Estado (2026-09-23): pasos 1-7 ✅, publicado en `master` (`d27b327`, deploy de Vercel `success`).**
Commits `9d2a08d` + `655a678` (correcciones de la revisión de calidad) + `d27b327` (dos menores).
Spec-compliance ✅; calidad: "Cambios requeridos" en la primera pasada —el hallazgo real fue que
`sinComentarios` no quitaba los `//` al final de línea en archivos CRLF (el working tree de este repo
lo es), así que una declaración comentada pasaba la guarda; además dos comentarios falsos (que
`app/manifest.ts` solo admite default export; que los Route Handlers se cachean solos) y ninguna
prueba de las rutas— y "Aprobado" en la segunda. M1-M9 confirmadas (encabezado de
`lib/manifiestos.test.ts`). Navegador: cada pantalla del dueño/FM lleva UN `link[rel=manifest]` al
suyo; `/mi-tarjeta`, `/registro/…` y `/` siguen con el de la raíz; los dos manifests responden 200 con
`application/manifest+json` sin cookies. Producción: verificado con `curl` el mismo resultado. El mismo
bug de CRLF queda latente en `lib/marca.test.ts` (falla ruidoso, no silencioso): tarea aparte.

---

## Tarea 2 — Migración 0039 y tipos

**Spec:** secciones 2 y 3 ("Base de datos") y "Orden y despliegue".

**Archivos:**
- Crear: `supabase/migrations/0039_monto_minimo_y_resena.sql` — el SQL de las dos secciones de la spec
  en UN archivo, dentro de `begin;` / `commit;`, con un comentario de encabezado al estilo de `0038`.
- Modificar: `lib/supabase/types.ts` — las cuatro columnas en `Row`, `Insert` (opcionales) y `Update`
  (opcionales) de `comercios`, con comentarios al estilo de los vecinos; y la línea de `0039` en la
  lista de migraciones del encabezado.
- Crear: `scripts/verificar-0039.ts` — solo lectura, al estilo de `scripts/verificar-0038.ts`: selecciona
  las cuatro columnas de un comercio y confirma que existen y que los defaults quedaron (`false`/`null`
  en todas las filas: contar las que no).

- [ ] **Paso 1:** escribir los tres archivos. `npx tsc --noEmit` limpio.
- [ ] **Paso 2:** commit (NO se publica: sin la migración, el código de las tareas 4-8 rompería lecturas).
- [ ] **Paso 3 (controlador):** pegarle a Daniel el SQL EXACTO del archivo en el chat para que lo corra en
  Supabase Studio. Cuando avise, correr
  `npx tsx --env-file=.env.local --conditions=react-server scripts/verificar-0039.ts` desde el worktree y
  anotar el resultado acá. — **APLICADA por Daniel el 2026-09-23**; `verificar-0039.ts`: las cuatro
  columnas existen, los 21 comercios en sus defaults, y los cinco CHECK rechazan su violación (23514 con
  el nombre de constraint correcto).

**Estado (2026-09-23): pasos 1-2 ✅** (commits `0038f16` + `1243f8a` + `906a5c4`). Revisión combinada
spec+calidad: aprobada; el revisor aplicó el `.sql` en un Postgres 18 descartable, con filas
existentes, y probó cada CHECK contra su violación. Menores aplicados: encabezado del `.sql` (eran TRES
implicaciones, no dos, y el NOT NULL de `pedir_monto_compra` importa para filas FUTURAS), el script
intenta violar los cinco CHECK sin dejar nada escrito (slug existente: si el CHECK no frenara, frena el
unique del slug con 23505) y exige que el 23514 venga del constraint bajo prueba, conteos con
`count: 'exact'`, y `42703` distinguido de otros errores. Hoy el script responde "0039 NO está
aplicada" y corta antes de cualquier insert.

---

## Tarea 3 — La regla de monto, pura

**Spec:** sección 2, "La regla, en una función pura".

**Archivos:**
- Modificar: `lib/tarjetas/tipos.ts` — campo nuevo `aplicaReglaDeMonto: boolean` en la interfaz
  `TipoTarjeta` (con el comentario de por qué es un campo y no un `if`, como `usaMontoDeCompra`),
  `true` en puntos y sellos, `false` en los otros seis; función `aplicaReglaDeMonto(tipoTarjeta)` que lo
  lee, junto a `usaMontoDeCompra`.
- Modificar: `lib/tarjetas/tipos.test.ts` — la tabla de los ocho tipos para el campo nuevo.
- Crear: `lib/comercio/montoAcreditacion.ts` — `validarMontoAcreditacion` (pura),
  `ofreceReglaDeMonto(programas)` (pura: `true` si algún programa, activo o no, pasa
  `aplicaReglaDeMonto` — la comparten la página de Reglas y su prueba, Tarea 4) y `leerReglaDeMonto`
  (lee `exigir_monto_compra`, `monto_minimo_compra_centavos` de `comercios` por id; `null` si falla,
  con `console.error`).
- Crear: `lib/comercio/montoAcreditacion.test.ts`.

- [ ] **Paso 1: pruebas (rojo)** de `validarMontoAcreditacion`, una por fila:
  - Sin regla (`exigir: false`, `minimo: null`): monto `null` → ok; monto `0` → ok.
  - `exigir: true`, sin mínimo: `null` → `'Escribí el monto de la compra (por ejemplo 19.99).'` SIN
    `bloqueoLimite`; `0` → el mismo error; `1` → ok.
  - `exigir: false` pero `minimo: 1000` (combinación que la BD prohíbe; la función no depende de eso):
    `null` → el error de monto faltante.
  - `minimo: 1000`: `999` → `'La compra mínima para sumar es $10.00.'` CON `bloqueoLimite: true`;
    `1000` → ok (el mínimo es inclusivo); `1001` → ok.
  - `minimo: 1000`, `autorizado: true`: `999` → ok; `null` → sigue siendo el error de monto faltante
    (la autorización NO saltea el paso 1).
  - Formato del mensaje con centavos: `minimo: 1050` → `'$10.50'`.
  - `aplicaReglaDeMonto`: `true` para `'puntos'` y `'sellos'`, `false` para los otros seis, y para un
    tipo desconocido lo que diga `tipoOPuntos` (cae a puntos → `true`; documentarlo en la prueba).
  - `ofreceReglaDeMonto`: lista vacía → `false`; solo cupón y membresía → `false`; membresía principal +
    sellos secundario → `true`; un sellos DESACTIVADO → `true` (sus tarjetas se siguen acreditando).
- [ ] **Paso 2:** implementar. **Paso 3:** verde (`npx vitest run lib/comercio/montoAcreditacion.test.ts lib/tarjetas/tipos.test.ts`).
- [ ] **Paso 4: mutaciones:** `<` → `<=` en la comparación del mínimo (falla "1000 → ok"); quitar
  `&& !autorizado` (falla "autorizado 999 → ok"); quitar `|| montoCentavos <= 0` (falla "0 → error");
  poner `bloqueoLimite: true` también en el monto faltante (falla la aserción "SIN bloqueoLimite");
  `aplicaReglaDeMonto: true` en `cashback` (falla la tabla).
- [ ] **Paso 5:** prueba de `leerReglaDeMonto` contra Supabase (comercio del fixture
  `test/fixtures/entornoComercio.ts`, con las TRES columnas seteadas juntas por update —
  `pedir_monto_compra`, `exigir_monto_compra`, `monto_minimo_compra_centavos` — o los CHECK la
  rechazan). Ruta según la 0039 (ver "Antes de empezar").
- [ ] **Paso 6:** tsc + eslint, commit.

---

**Estado (2026-09-23): código ✅, revisado y aprobado** (commits `81fcd4c` + `6a5d514` + `81365c7`).
63 pruebas puras verdes; 2 contra Supabase de `leerReglaDeMonto` en rojo por la 0039 (control positivo
con 42703 y el caso de las tres columnas con PGRST204), diferidas a la Tarea 9. Hallazgo real de la
revisión: con `NaN` el paso 1 dejaba pasar la acreditación (`NaN <= 0` es false) — la condición pasó
a `!(montoCentavos > 0)`. 9 mutaciones confirmadas (encabezado de `montoAcreditacion.test.ts`).

## Tarea 4 — Configuración en Reglas → Controles

**Spec:** sección 2, "Configuración" y "Validación de la configuración".

**Archivos:**
- Modificar: `lib/comercio/controlesAcreditacion.ts` — los dos campos nuevos en `ControlesAcreditacion`,
  `controlesDesdeFormulario` (parseo del mínimo e implicaciones), `validar()` (cuatro reglas nuevas y
  `MAXIMO_MONTO_MINIMO_CENTAVOS`), `leerControles`/`guardarControles` (select y update con las columnas
  nuevas — el select sigue siendo UN literal, ver el comentario del archivo).
- Crear: `lib/comercio/controlesAcreditacion.test.ts` — la parte pura (`controlesDesdeFormulario`).
- Modificar: `app/comercio/(protegido)/reglas/actions.ts` — `accionGuardarControles` lee
  `exigir_monto_compra` (`=== 'on'`) y `monto_minimo_compra` (texto).
- Modificar: `app/comercio/(protegido)/reglas/FormularioControles.tsx` — prop nueva
  `ofreceReglaDeMonto: boolean`; el checkbox de "Pedir" se dibuja si `usaMontoDeCompra ||
  ofreceReglaDeMonto` (su input oculto sigue igual en el caso contrario); el sub-bloque (checkbox +
  campo) debajo, solo si `ofreceReglaDeMonto`; SIN inputs ocultos cuando no se muestra (la spec
  explica por qué); `clave` suma los dos campos; el mínimo se precarga con `formatearCentavos`.
  **El campo del mínimo es `type="text" inputMode="decimal"`, NO `type="number"`** como sus vecinos:
  `value="$10.50"` no es un número válido, el navegador vaciaría el campo, y el dueño guardaría `null`
  borrando su mínimo sin enterarse.
- Crear: `app/comercio/(protegido)/reglas/datosControles.ts` — `datosFormularioControles(supabase,
  comercioId)`, sin `'use server'`: junta `leerControles`, la llamada
  `listarProgramas(supabase, comercioId, { soloActivos: false })` (el default filtra los activos,
  `lib/comercio/programas.ts:188-205`; el principal no se puede desactivar —`desactivarPrograma` filtra
  `es_principal = false`—, así que buscarlo en la lista completa es seguro), la derivación del tipo
  principal y `programas === null || ofreceReglaDeMonto(programas)` (la función compartida de la
  Tarea 3; si la lista falla, se MUESTRA el sub-bloque en vez de esconderlo, porque esconderlo haría
  que guardar cualquier campo borre el mínimo sin que el dueño se entere) en un solo
  punto de entrada. Es COMPARTIDA por `page.tsx` y por `dibujarReglas` en `actions.test.ts` — no una
  copia de la llamada en cada lado (revisión de calidad, 2026-09-23: la primera versión de esta tarea
  tenía la prueba repitiendo la lógica, y una mutación que le sacara `{ soloActivos: false }` a
  page.tsx no la atrapaba ninguna prueba).
- Modificar: `app/comercio/(protegido)/reglas/page.tsx` — llamar a `datosFormularioControles` en vez de
  armar `leerControles`/`listarProgramas`/las derivaciones por su cuenta.
- Modificar: `app/comercio/(protegido)/reglas/actions.test.ts` — casos contra Supabase y de HTML; su
  helper `dibujarReglas` (líneas ~42-90) llama a la MISMA `datosFormularioControles` que `page.tsx`, así
  que ya no recibe el tipo principal a mano — lo deriva del comercio real, igual que la pantalla.

- [ ] **Paso 1: pruebas puras (rojo)** en `controlesAcreditacion.test.ts`:
  - Mínimo `''` → `null`; `'10'` → `1000`; `'$10.50'` → `1050`; `'10x'` → `NaN`; `'-5'` → `NaN`.
  - Implicaciones: mínimo con exigir apagado → `exigirMontoCompra: true` y `pedirMontoCompra: true`;
    exigir prendido con pedir apagado → `pedirMontoCompra: true`; todo apagado y mínimo vacío → todo
    `false`/`null`.
  - Ida y vuelta: `formatearCentavos(1050)` pasado como texto del mínimo vuelve a `1050` exacto (y lo
    mismo con `1`, `99`, `100_000`).
- [ ] **Paso 2: pruebas de `validar` y del formulario** en `reglas/actions.test.ts` (con `enviar()` y
  `dibujarReglas()`, que ya existen): mínimo `NaN` → error del mínimo; mínimo `'0'` → error (no
  positivo); mínimo `100_001` → error del tope; guardar exigir + mínimo `$10.50` y releer →
  `true`/`1050`; guardar con el sub-bloque ausente (sin los campos en el FormData) → `false`/`null`
  aunque antes estuviera en `true`/`1050`; el HTML de `dibujarReglas` con ese guardado contiene el
  texto precargado EXACTO `$10.50` (no `10.5`) en un input `type="text"`; un comercio con membresía
  principal y sellos secundario dibuja el checkbox de "Pedir" y el sub-bloque; membresía principal y un
  sellos DESACTIVADO también dibuja el sub-bloque; uno con solo cupón no lo dibuja;
  y las pruebas EXISTENTES de preservación de `pedir_monto_compra` (líneas ~104-156) siguen pasando sin
  cambios. Ruta según la 0039.
- [ ] **Paso 3:** implementar. Pruebas puras verdes (y las de Supabase, si la 0039 ya está).
- [ ] **Paso 4: mutaciones:** cambiar el `NaN` del parseo por `null` (falla `'10x'`); quitar
  `|| minimo !== null` de la implicación de exigir (falla); precargar con `String(centavos / 100)` en vez
  de `formatearCentavos` (falla la aserción del HTML `$10.50` — la de ida y vuelta NO la atrapa, porque
  `"10.5"` vuelve a parsear a 1050); volver a condicionar el checkbox "Pedir" solo a `usaMontoDeCompra`
  (falla el caso membresía + sellos); llamar a `listarProgramas` sin `{ soloActivos: false }` DENTRO de
  `datosFormularioControles` (falla el caso del sellos desactivado — con la función compartida, esta
  mutación la atrapa la prueba directamente, no hace falta el navegador contra `page.tsx` real);
  `type="number"` en el mínimo (falla la aserción de `type="text"`). Las que tocan la base, según la
  ruta de la 0039. Sumar también, puras y confirmables HOY sin la 0039 (llamando a `guardarControles`
  con un `comercioId` cualquiera, ya que `validar()` corta antes de tocar Supabase): borrar cada una de
  las cuatro ramas nuevas de `validar()` (mínimo no positivo, el tope, exigir sin pedir, mínimo sin
  exigir) — cada una cae con el mensaje exacto de esa rama.
- [ ] **Paso 5:** tsc + eslint, commit.

---

**Estado (2026-09-23): código ✅, revisado y aprobado** (commits `28ff084` + `ce35f35` + `f5da3dc` +
`03f5986`). 17 pruebas puras verdes, 6 mutaciones puras confirmadas; `reglas/actions.test.ts` 13/13 en
rojo SOLO por la 0039 (incluidas las 4 viejas: `leerControles` ahora selecciona las columnas nuevas).
Hallazgos reales de la revisión: (1) `dibujarReglas` COPIABA la llamada a `listarProgramas` de la
página — quitarle `{ soloActivos: false }` a la página no lo atrapaba nada —; se extrajo
`reglas/datosControles.ts`, que usan las dos; (2) si la lista de programas fallaba, el sub-bloque se
escondía y guardar borraba el mínimo en silencio — ahora degrada hacia mostrarlo. Mutaciones del HTML
y de la base: pendientes (Tarea 9).

## Tarea 5 — La regla en el escáner

**Spec:** sección 2, "Dónde se aplica → Escáner" y "Escáner (UI)".

**Archivos:**
- Modificar: `app/comercio/(protegido)/escanear/actions.ts`:
  - `ejecutarOperacion`, rama `default` (puntos y sellos): antes de `acreditar`, `leerReglaDeMonto`
    (error de lectura → `{ ok: false, error: 'No se pudo verificar la regla de monto. Probá de nuevo.' }`)
    y `validarMontoAcreditacion({ …, autorizado: autorizacion !== null })`; si falla, devolver su
    `error` y su `bloqueoLimite` tal cual. El `montoCompra` sigue viajando como hoy.
  - `accionBuscarPorToken`: sumar a la consulta de `comercios` las dos columnas nuevas; si
    `aplicaReglaDeMonto(tipo.valor)`, devolver `exigirMontoCompra` y `montoMinimoTexto`
    (`formatearCentavos` o `null`).
  - `ResultadoEscaneo`: los dos campos nuevos, comentados.
- Modificar: `app/comercio/(protegido)/escanear/Escaner.tsx` — mostrar el campo también con
  `exigirMontoCompra`; etiqueta sin "(opcional)" en ese caso; "Mínimo $X" junto al campo; botón
  principal deshabilitado mientras el monto esté vacío y `exigirMontoCompra`.
- Modificar: `app/comercio/(protegido)/escanear/actions.test.ts` — casos contra Supabase.

- [ ] **Paso 1: pruebas (rojo)** en `escanear/actions.test.ts`, con un comercio de sellos que exige
  mínimo `$10.00` (usar el fixture que ya usa el archivo; la regla se setea con UN update a
  `comercios` que pone JUNTAS `pedir_monto_compra: true`, `exigir_monto_compra: true` y
  `monto_minimo_compra_centavos: 1000`, o los CHECK de la 0039 lo rechazan):
  - `accionOperacionPrincipal` con monto `'9.99'` → `ok: false`, error exacto del mínimo,
    `bloqueoLimite: true`, y el saldo de la tarjeta NO cambió (releerlo).
  - Con `'10.00'` → `ok: true` y el saldo subió 1.
  - Sin monto → error de monto faltante, sin `bloqueoLimite`, saldo igual.
  - `accionAutorizarOperacion` (sesión de dueño) con `'9.99'` y motivo → `ok: true`, saldo subió.
  - Mismo comercio, tarjeta de un programa de CUPÓN sin monto → la respuesta NO es ni el error de monto
    faltante ni el del mínimo (asertar eso, no `ok: true`: un cupón recién creado por el fixture puede
    fallar por otras razones propias). Un cupón y no una gift card: la gift card en cero falla por
    saldo y enturbia la mutación.
  - `accionBuscarPorToken` → `exigirMontoCompra: true`, `montoMinimoTexto: '$10.00'` en la de sellos;
    ausentes/`false` en la de cupón.
  - Ruta según la 0039.
- [ ] **Paso 2:** implementar. tsc + eslint. Commit.
- [ ] **Mutaciones** (con la base migrada; si no lo está, en la Tarea 9): pasar `autorizado: false`
  fijo (falla la autorización bajo el mínimo); aplicar la regla antes del `switch`, para todos los tipos
  (falla el caso del cupón); no devolver `bloqueoLimite` (falla esa aserción).

---

**Estado (2026-09-23): código ✅, revisado y aprobado** (commits `2c50242` + `9d89ce5`).
`escanear/actions.test.ts`: 11 verdes, 8 en rojo SOLO por la 0039 (6 nuevas + 2 viejas). La prueba de
la falla cerrada (lectura de la regla ilegible → "No se pudo verificar la regla de monto…") corre
VERDE hoy y su mutación (fallar abierto) está confirmada por el controlador. **Consecuencia que hay que
saber:** como esa lectura falla hacia lo restrictivo, publicar esta rama antes de la 0039 rechaza TODA
acreditación de puntos/sellos del escáner en todos los comercios (aviso en el ESTADO y en la memoria).

## Tarea 6 — La regla en "Agregar cliente"

**Spec:** sección 2, "Dónde se aplica → Agregar cliente" (decisión 7).

**Archivos:**
- Modificar: `lib/comercio/altaPorTelefono.ts` — `montoCompraCentavos?: number | null` en
  `DatosAltaPorTelefono`; con programa de puntos/sellos: leer la regla ANTES de `registrarCliente` (si
  `leerReglaDeMonto` devuelve `null`, rechazar ahí con el mensaje de la spec, sin crear nada); paso 1
  ANTES de `registrarCliente`, paso 2 DESPUÉS (devuelve `bloqueoLimite: true`); `montoCompra` a
  `acreditarPuntos` (en dólares, como hace el escáner: `centavos / 100` — es el contrato de
  `OpcionesAcreditar`, `lib/comercio/acreditar.ts:65-67`, no una precarga de texto).
- Modificar: `app/comercio/(protegido)/clientes/agregar/actions.ts` — leer `monto_compra` con
  `centavosDesdeTexto` (vacío → `null`).
- Modificar: `app/comercio/(protegido)/clientes/agregar/page.tsx` — leer la regla del comercio y pasarle
  al formulario `exigirMontoCompra` y `montoMinimoTexto`.
- Modificar: `app/comercio/(protegido)/clientes/agregar/FormularioAgregarCliente.tsx` — campo
  "Monto de la compra ($)" solo si `exigirMontoCompra` y el programa ELEGIDO pasa `aplicaReglaDeMonto`.
- Modificar: `lib/comercio/altaPorTelefono.test.ts` — casos contra Supabase.

- [ ] **Paso 1: pruebas (rojo)**, comercio de sellos con mínimo `$10.00` (las tres columnas seteadas
  juntas, como en la Tarea 5):
  - Sin monto → error de monto faltante y NO existe cliente con ese teléfono (contar antes y después).
  - Con `999` → `ok: false`, `bloqueoLimite: true`, error exacto del mínimo, la tarjeta SÍ existe y su
    saldo es 0.
  - Con `1000` → `ok: true`, saldo 1, y la transacción del ledger tiene `monto_compra = 10`.
  - Comercio SIN regla → las pruebas existentes del archivo siguen pasando sin cambios.
  - Ruta según la 0039.
- [ ] **Paso 2:** implementar. tsc + eslint. Commit.
- [ ] **Mutaciones** (con la base migrada; si no, en la Tarea 9): mover el paso 1 después de
  `registrarCliente` (falla "no existe cliente"); no pasar `montoCompra` a `acreditarPuntos` (falla el
  ledger).

---

**Estado (2026-09-23): código ✅, revisado y aprobado** (commits `7f102cd` + `bb0a05a`).
`altaPorTelefono.test.ts`: 4 verdes, 10 en rojo SOLO por la 0039 (6 viejas por la falla cerrada, 4
nuevas por PGRST204). `altaPorTelefono.reglaIlegible.test.ts` (mock de `leerReglaDeMonto`) corre VERDE
hoy, con sus 2 mutaciones confirmadas. Hallazgo de la revisión: ninguna prueba protegía la condición
`aplicaReglaDeMonto` (un comercio con la regla no habría podido dar de alta gift card/prepago): se
agregó el caso de gift card (pendiente de la 0039).

## Tarea 7 — Configuración de la reseña de Google

**Spec:** sección 3, "Configuración" y "Validación del link".

**Archivos:**
- Crear: `lib/comercio/resenaGoogle.ts` — `validarUrlResenaGoogle` (pura), `leerResenaGoogle`
  (devuelve `{ pedir, url }` con la url REVALIDADA: una guardada que ya no pasa se devuelve como
  `null`), `guardarResenaGoogle` (valida: pedir sin link válido → `'Pegá el link para dejar reseña en
  Google.'`; link inválido → el error de la validación).
- Crear: `lib/comercio/resenaGoogle.test.ts`.
- Modificar: `app/comercio/(protegido)/reglas/actions.ts` — `accionGuardarResenaGoogle`
  (`verifyComercioOwner`, fuera de try/catch), con su tipo de estado.
- Crear: `app/comercio/(protegido)/reglas/FormularioResenaGoogle.tsx` — mismo patrón no controlado +
  `key` que `FormularioControles` (y su comentario explicando por qué).
- Modificar: `app/comercio/(protegido)/reglas/page.tsx` — el bloque "Registro de clientes".

- [ ] **Paso 1: pruebas puras (rojo)** de `validarUrlResenaGoogle`:
  - Aceptados: `https://g.page/r/abc/review`, `https://goo.gl/maps/x`, `https://maps.app.goo.gl/x`,
    `https://www.google.com/maps/place/x`, `https://search.google.com/local/writereview?placeid=x`,
    `https://google.com/x`, `https://www.google.com.sv/maps/x`, con espacios alrededor (se recortan).
  - Rechazados: `http://g.page/r/abc` (no https), `https://google.com.malo.com/x`,
    `https://malogoogle.com/x`, `https://g.page.malo.com/x`, `javascript:alert(1)`, `no es un link`,
    `https://instagram.com/negocio`.
  - Vacío → `null` válido.
  - Cada error con su mensaje exacto (definirlos en la implementación y fijarlos en la prueba).
- [ ] **Paso 2: pruebas contra Supabase:** guardar pedir + link válido y releer; pedir sin link →
  error; guardar el link con pedir apagado y releer; escribir por update directo un link inválido (con
  `pedir_resena_google: false`, o con pedir y un link no nulo, para no chocar con el CHECK) y confirmar
  que `leerResenaGoogle` devuelve `url: null`. Ruta según la 0039.
- [ ] **Paso 3:** implementar. Pruebas puras verdes (y las de Supabase, si la 0039 ya está). tsc +
  eslint. Commit.
- [ ] **Paso 4: mutaciones puras:** `endsWith('google.com')` sin el punto (falla `malogoogle.com`);
  `includes` en vez de igualdad/sufijo (falla `google.com.malo.com`); quitar el chequeo de `https:`
  (falla `http://`). **Contra Supabase** (según la ruta de la 0039): quitar la revalidación al leer
  (falla el caso del link inválido guardado).

---

**Estado (2026-09-23): código ✅, revisado y aprobado** (commits `455b165` + `727efa2`; spec `ff365d2`).
32 verdes (puras, stub que prueba que "pedir sin link" y "link inválido" no tocan la base, y la acción
desde el HTML real del formulario), 5 contra Supabase en rojo SOLO por la 0039. **Cambio de spec por
seguridad** tras la revisión: la lista `*.google.com` dejaba pasar `sites.google.com`,
`docs.google.com/forms` y las redirecciones `/url`/`/amp` — ahora hosts exactos, `goo.gl` solo con
`/maps/`, sin usuario/contraseña/puerto, se guarda `url.href` y se valida su largo (CHECK de la 0039).
Mutación pendiente: la revalidación al leer.

## Tarea 8 — El paso de reseña en el registro del cliente

**Spec:** sección 3, "Lo que ve el cliente".

**Archivos:**
- Modificar: `app/registro/[comercioSlug]/page.tsx` y `app/registro/[comercioSlug]/[programaSlug]/page.tsx`
  — leer la reseña con `leerResenaGoogle` (así la revalidación es UNA) y pasar
  `resenaGoogleUrl = pedir ? url : null`. Consulta APARTE de la del comercio (no ensanchar el `select`
  que decide "no encontrado"): si la lectura falla —también si la 0039 no está aplicada—, `null` y el
  registro sigue en pie. Un comentario en cada página dice por qué (mismo criterio que
  `marcaDelRegistro`).
- Modificar: `app/registro/[comercioSlug]/RegistroCliente.tsx` — el paso nuevo antes del formulario
  (textos EXACTOS de la spec), `target="_blank" rel="noopener noreferrer"`, dos estados con nombre
  propio: `tocoGoogle` (habilita "Ya la dejé", se guarda en `sessionStorage` por slug) y `continuo`
  (pasa al formulario, no se guarda). La LECTURA de `sessionStorage` va con `useSyncExternalStore`
  y snapshot de servidor `false` (nunca en el render ni en el inicializador de `useState`: rompe la
  hidratación y deja el botón deshabilitado tras recargar; y no con `useEffect` + `setState`, que la
  regla `react-hooks/set-state-in-effect` rechaza en este repo); try/catch en cada acceso.

- [ ] **Paso 1:** implementar. No hay pruebas de componentes en este repo (CLAUDE.md): la lógica de
  "¿mostrar el paso?" es `resenaGoogleUrl !== null && !continuo`; si crece más que eso, sacarla a una
  función pura con prueba.
- [ ] **Paso 2:** tsc + eslint. Commit.
- [ ] **Paso 3 (controlador, Tarea 9):** verificación en el navegador.

---

**Estado (2026-09-23): código ✅, revisado** (commits `125bb7f` + `55e474e` + `fd4e384`). Con la 0039
sin aplicar, `leerResenaGoogle` devuelve null y el registro queda exactamente como antes. Correcciones:
el texto del paso pasó a TUTEO (las pantallas del cliente tutean por decisión del 2026-09-08; la spec
lo había escrito en voseo); la lectura de `sessionStorage` es con `useSyncExternalStore` (la regla de
lint prohíbe `setState` en `useEffect`); "Ya la dejé" es `btn-borde`; se quitó una nota que la spec no
pedía. Falta la verificación en el navegador (Tarea 9).

## Tarea 9 — Cierre: correr todo con la base migrada, verificar y publicar

Requiere que Daniel haya aplicado la 0039 y que `verificar-0039.ts` la haya confirmado (Tarea 2).

- [ ] Correr TODAS las pruebas contra Supabase de las Tareas 3-7 que hayan quedado diferidas (las que
  se escribieron antes de la 0039) y sus mutaciones pendientes. Actualizar los encabezados de
  mutation-testing a "confirmadas".
- [ ] Suite completa (`npx vitest run`), `npx tsc --noEmit`, `npm run lint`. Si una falla por red
  (timeout, `fetch failed`), re-correr ESE archivo solo antes de concluir nada.
- [ ] Navegador (controlador), con `preview_start`:
  - Reglas: el sub-bloque aparece en un comercio con programa de sellos y no en uno sin
    puntos/sellos; guardar `$10.00`, recargar, sigue `$10.00`; vaciarlo y destildar exigir.
  - Escáner: tarjeta de sellos con la regla → campo sin "(opcional)", "Mínimo $10.00", botón
    deshabilitado vacío; `9.99` → panel de autorización (sesión de dueño).
  - Agregar cliente: el campo aparece solo con un programa de sellos elegido.
  - Registro: con reseña activa, el paso aparece, el continuar se habilita tras tocar el link, y
    tras recargar la pestaña no vuelve a pedirlo; sin reseña, no aparece.
  - Las pruebas de navegador se hacen sobre un comercio de prueba o restaurando al final lo que se
    cambie; NUNCA dejar una regla activa en un comercio piloto.
- [ ] Publicar: `git push origin HEAD:master`, esperar el deploy, y verificar en producción que el QR de
  registro de un comercio real sigue abriendo (`curl -s https://www.cardly-sv.site/registro/<slug>` no
  dice "no encontrado").
- [ ] Actualizar la memoria `backlog-post-onboarding-2026-09-22` (qué quedó hecho) y el
  `docs/superpowers/ESTADO-Y-PLAN-2026-07-28.md` (sección más reciente).

**Estado de la Tarea 9 (2026-09-23):**
- Migración 0039 aplicada y verificada (Tarea 2, Paso 3).
- Los 8 archivos que dependían de ella: 126/126 verdes. Las 13 mutaciones que habían quedado pendientes,
  confirmadas (`a967547`, encabezados actualizados; ninguna sobrevivió); el controlador reprodujo la de
  `soloActivos` en `datosControles.ts` (cae "sellos DESACTIVADO").
- Suite completa: **2059/2059, 164/164 archivos**. `tsc --noEmit` y `npm run lint` limpios.
- Navegador (controlador, comercio demo `cafe-aurora-demo`, restaurado después): el paso de reseña se
  dibuja con los textos exactos; "Ya la dejé" deshabilitado hasta tocar el link (`href`, `target`,
  `rel` correctos) y habilitado después; **tras recargar la pestaña vuelve habilitado** (sessionStorage +
  `useSyncExternalStore`), sin errores de consola; al continuar, el formulario de siempre. Con la
  reseña apagada, `/registro/cafe-aurora-demo`, `die-oma-cafe-bistro` y `pulso-cafe` muestran el
  formulario normal.
- **No verificado en el navegador, por decisión de Daniel** ("publicá ya, lo pruebo yo"): Reglas, el
  escáner y "Agregar cliente" necesitan una sesión de dueño. Su lógica de servidor y el HTML del
  formulario de Reglas sí están cubiertos por pruebas; el detalle visual del escáner (botón
  deshabilitado, "Mínimo $X"/"Obligatorio") lo prueba Daniel en producción.
- Publicado en `master` (ver el commit de este registro).

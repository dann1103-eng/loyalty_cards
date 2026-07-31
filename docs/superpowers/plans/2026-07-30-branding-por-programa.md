# Branding por programa — Plan de implementación

> **Para quien lo ejecute:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans`, tarea por tarea. Los pasos usan checkbox (`- [ ]`).

**Goal:** que cada programa de tarjeta pueda tener su propio logo, colores e imágenes, heredando los
del comercio en todo lo que no defina.

**Architecture:** columnas nuevas nullable en `programas_tarjeta` donde `null` = heredar; una función
pura resuelve el branding efectivo y la usan los NUEVE consumidores; la `LoyaltyClass` propia de
Google se crea perezosamente y solo si el programa define uno de los tres campos que Google
realmente usa.

**Tech Stack:** Next.js (App Router), Supabase (Postgres + Storage), `googleapis` (Wallet),
`passkit-generator`, Vitest contra Supabase real.

**Spec:** `docs/superpowers/specs/2026-07-30-branding-por-programa-design.md` — leerlo entero antes
de empezar. Este plan no repite el razonamiento, solo lo ejecuta.

---

## Antes de escribir una línea

Tres cosas de este proyecto que, si se ignoran, cuestan una tarde:

1. **`null` NO siempre significa "heredar".** Para las 8 columnas de branding sí. Para `sello_meta`
   NO: un cupón tiene `sello_meta = null` legítimamente. Usar `??` sobre `sello_meta` fue un bug
   real el 2026-07-30 (`expected 8 to be null`). El helper cuelga del PROGRAMA entero, no de cada
   campo. Ver `lib/apple/datosPassDeTarjeta.ts:36-44`.
2. **Las clases de Google no se borran.** Cada clase creada es permanente y visible para el revisor
   de Google. Las pruebas MOCKEAN `walletClient` (patrón de `syncClase.test.ts`), nunca llaman de
   verdad.
3. **El fixture limpia por `comercio_id`.** Si una tarea agrega una tabla o un recurso de Storage,
   hay que sumarlo a `test/fixtures/entornoComercio.ts:limpiar()` o quedan huérfanos permanentes en
   la base REAL — pasó el 2026-07-30 con 519 comercios.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/0027_branding_por_programa.sql` | columnas nuevas |
| `scripts/verificar-0027.ts` | verificación de solo lectura |
| `lib/comercio/brandingEfectivo.ts` | **función pura**: comercio + programa → branding efectivo |
| `lib/comercio/guardarBrandingPrograma.ts` | validación y escritura del branding de un programa |
| `lib/comercio/imagenComercio.ts` | agregar `rutaImagenPrograma` |
| `lib/google/syncClase.ts` | crear/actualizar la clase del PROGRAMA |
| Los 9 consumidores del spec | pasar a leer el branding efectivo |
| `app/comercio/(protegido)/programas/` | UI de marca por programa |

---

### Task 1: Migración 0027

**Files:**
- Create: `supabase/migrations/0027_branding_por_programa.sql`
- Create: `scripts/verificar-0027.ts`
- Modify: `lib/supabase/types.ts`

- [ ] **Step 1: Escribir la migración**

```sql
-- 0027: branding por programa de tarjeta.
-- Ver docs/superpowers/specs/2026-07-30-branding-por-programa-design.md.
begin;

alter table programas_tarjeta
  add column color_fondo text,
  add column color_texto text,
  add column color_label text,
  add column logo_url text,
  add column hero_url text,
  add column strip_url text,
  add column sello_icono_url text,
  add column difuminado_franja text,
  -- DOS estados separados a propósito. google_class_id registra que la clase EXISTE en Google y
  -- una vez seteado NUNCA vuelve a null: las clases no se borran y un segundo insert sobre el
  -- mismo id falla. branding_propio dice si el programa usa SU branding o hereda el del comercio.
  add column google_class_id text,
  add column branding_propio boolean not null default false;

commit;
```

Todo nullable (salvo el booleano con default), así que los programas existentes nacen heredando y
nada cambia de aspecto. Mismo criterio que 0015, 0024 y 0026.

- [ ] **Step 2: Actualizar `lib/supabase/types.ts`**

Agregar las 10 columnas a `programas_tarjeta` en `Row` (todas `string | null` salvo
`branding_propio: boolean`), `Insert` y `Update` (opcionales). Sumar la línea de la 0027 al
comentario de migraciones del encabezado.

- [ ] **Step 3: Escribir `scripts/verificar-0027.ts`**

Espejar `scripts/verificar-0026.ts`: leer una fila de `programas_tarjeta` seleccionando las 10
columnas nuevas y confirmar que no da error; confirmar que `branding_propio` viene `false` por
default en un programa existente. Imprimir `OK:`/`FALLO:` y salir con código 1 si hubo fallos.

- [ ] **Step 4: ENTREGAR LA MIGRACIÓN AL USUARIO AHORA, no al final**

El asistente **no puede** correr DDL en este proyecto (política escrita en `CLAUDE.md`). Pegarle el
`.sql` completo en el chat, pedirle que lo corra en Supabase Studio y esperar su confirmación.
**Todas las tareas siguientes necesitan las columnas para que sus pruebas pasen**, así que esto no
puede quedar para el final — es el error que se cometió al planificar la 0026 y hubo que corregirlo.

Es una migración puramente aditiva sin dependencia de código desplegado, así que aplicarla antes del
deploy es seguro: el código viejo la ignora.

- [ ] **Step 5: Verificar y commitear**

```bash
npx tsx --conditions=react-server scripts/verificar-0027.ts
git add supabase/migrations/0027_branding_por_programa.sql scripts/verificar-0027.ts lib/supabase/types.ts
git commit -m "Branding por programa: migracion 0027"
```

---

### Task 2: `brandingEfectivo` — la función pura

**Files:**
- Create: `lib/comercio/brandingEfectivo.ts`
- Test: `lib/comercio/brandingEfectivo.test.ts`

Es el corazón del trabajo: nueve consumidores la van a usar. Si cada uno hiciera su propio `??`, uno
se olvidaría — y ese olvido ya pasó dos veces este mes.

- [ ] **Step 1: Escribir las pruebas** (módulo puro, sin base de datos)

Casos obligatorios:
- programa con todo en null → devuelve exactamente el branding del comercio;
- programa con `color_fondo` propio → ese color, y el RESTO heredado (herencia campo por campo);
- programa con `logo_url` propio pero `hero_url` null → logo propio, hero del comercio;
- `branding_propio: false` con campos cargados → **hereda igual** (el booleano manda, no los campos);
- `sello_meta` NO se hereda con `??`: un programa de cupón con `sello_meta: null` bajo un comercio
  con `sello_meta: 8` devuelve **null**, no 8. Este es el caso que ya rompió una vez.

- [ ] **Step 2: Correr y ver el rojo**

`npx vitest run lib/comercio/brandingEfectivo.test.ts` → falla por módulo inexistente.

- [ ] **Step 3: Implementar**

```ts
// Resuelve el branding que se le muestra al cliente para UNA tarjeta: lo del programa si lo tiene,
// lo del comercio si no. Función PURA para que los nueve consumidores compartan una sola definición
// de "efectivo" y no puedan divergir.
export interface BrandingBase {
  colorFondo: string | null;
  colorTexto: string | null;
  colorLabel: string | null;
  logoUrl: string | null;
  heroUrl: string | null;
  stripUrl: string | null;
  selloIconoUrl: string | null;
  difuminadoFranja: string;
}

export function brandingEfectivo(
  comercio: BrandingBase,
  programa: (Partial<BrandingBase> & { brandingPropio: boolean }) | null,
): BrandingBase {
  // Sin programa, o con el branding propio apagado: todo del comercio. El booleano manda sobre los
  // campos — así apagar el branding propio no obliga a limpiar cada columna.
  if (!programa || !programa.brandingPropio) return comercio;
  // `??` acá SÍ es correcto: null = "no lo definí, heredá". No hay color nulo legítimo.
  // OJO: esto NO aplica a sello_meta, donde null es un valor válido (un cupón no tiene meta).
  // sello_meta se resuelve aparte, colgando del programa entero. Ver datosPassDeTarjeta.ts.
  return {
    colorFondo: programa.colorFondo ?? comercio.colorFondo,
    colorTexto: programa.colorTexto ?? comercio.colorTexto,
    colorLabel: programa.colorLabel ?? comercio.colorLabel,
    logoUrl: programa.logoUrl ?? comercio.logoUrl,
    heroUrl: programa.heroUrl ?? comercio.heroUrl,
    stripUrl: programa.stripUrl ?? comercio.stripUrl,
    selloIconoUrl: programa.selloIconoUrl ?? comercio.selloIconoUrl,
    difuminadoFranja: programa.difuminadoFranja ?? comercio.difuminadoFranja,
  };
}

// Los TRES campos que Google guarda en la LoyaltyClass. Solo estos justifican crear una clase
// propia — el resto vive en el .pkpass y en el heroImage del objeto, que ya es por tarjeta. Crear
// una clase por un cambio de ícono de sello sería un recurso PERMANENTE que no hace falta.
export function necesitaClasePropia(
  programa: { brandingPropio: boolean; colorFondo: string | null; logoUrl: string | null; heroUrl: string | null } | null,
): boolean {
  if (!programa || !programa.brandingPropio) return false;
  return programa.colorFondo !== null || programa.logoUrl !== null || programa.heroUrl !== null;
}
```

- [ ] **Step 4: Verde + mutación**

Correr las pruebas. Después romper `if (!programa || !programa.brandingPropio)` quitando la segunda
condición y confirmar que falla la prueba del booleano; restaurar. Romper `necesitaClasePropia`
devolviendo `true` siempre y confirmar que falla; restaurar.

- [ ] **Step 5: Commit**

---

### Task 3: Ruta de Storage por programa

**Files:**
- Modify: `lib/comercio/imagenComercio.ts`
- Test: el archivo de prueba existente de ese módulo

`rutaImagenComercio(comercioId, campo, ext)` devuelve `<comercioId>/<campo>.<ext>` y la subida usa
`upsert: true`. Subir el logo de un programa por ahí **pisaría el logo del comercio**.

- [ ] **Step 1: Prueba** — `rutaImagenPrograma(comercioId, programaId, campo, ext)` devuelve una ruta
  que incluye el `programaId` y que NUNCA coincide con `rutaImagenComercio` del mismo comercio y
  campo. Assert explícito de desigualdad: es el bug que se está previniendo.
- [ ] **Step 2:** rojo. **Step 3:** implementar siguiendo `rutaImagenRecompensa` (líneas 54-56).
  **Step 4:** verde. **Step 5:** commit.

---

### Task 4: El pase de Apple lee el branding efectivo

**Files:**
- Modify: `lib/apple/datosPassDeTarjeta.ts`
- Test: `lib/apple/datosPassDeTarjeta.test.ts`

- [ ] **Step 1: Prueba** — un programa con `branding_propio` y `color_fondo` propio produce un
  `datos.colorFondo` distinto al del comercio, y un `colorTexto` IGUAL al del comercio (herencia
  parcial en la misma aserción).
- [ ] **Step 2:** rojo. **Step 3:** ampliar el join a las columnas nuevas y pasar el resultado de
  `brandingEfectivo` en vez de los campos de `comercios`. **Step 4:** verde.
- [ ] **Step 5: Mutación** — volver a `tarjeta.comercios.color_fondo` y confirmar que la prueba
  falla por el color; restaurar. **Step 6:** commit.

---

### Task 5: La ruta que DIBUJA — la más importante del plan

**Files:**
- Modify: `app/api/tarjetas/[tarjetaId]/hero.png/route.ts`
- Test: crear `app/api/tarjetas/[tarjetaId]/hero.png/route.test.ts`

Esta es la que falla en SILENCIO. `versionHero` (`lib/google/heroUrl.ts:33-39`) hashea el branding
para el cache-busting: si el hash pasa a usar el efectivo pero la ruta sigue leyendo `comercios`,
**la URL cambia, Google re-descarga, y sirve la imagen equivocada**. Cache-busting perfecto
entregando lo incorrecto, sin un solo error en los logs.

- [ ] **Step 1: Prueba** — la única que separa "la URL cambió" de "la imagen cambió". Con un
  programa que define `sello_icono_url` propio, invocar el handler y confirmar que
  `componerStrips` recibió el ícono del PROGRAMA. Mockear `componerStrips` y asertar sobre sus
  argumentos es suficiente y evita comparar bytes de PNG.
- [ ] **Step 2:** rojo. **Step 3:** implementar. **Step 4:** verde.
- [ ] **Step 5: Mutación** — hacer que la ruta lea `comercios` y confirmar que la prueba falla **por
  el ícono, no por un 404**. Si falla con 404, la prueba no está probando lo que dice. Restaurar.
- [ ] **Step 6:** commit.

---

### Task 6: La clase de Google, por programa

**Files:**
- Modify: `lib/google/syncClase.ts`, `lib/google/ids.ts`
- Test: `lib/google/syncClase.test.ts`

- [ ] **Step 1: Pruebas** (con `walletClient` MOCKEADO, nunca Google real):
  - programa sin branding propio → **no se llama** a `loyaltyclass.insert`, y el objeto usa la clase
    del comercio;
  - programa con `color_fondo` propio → se crea la clase con id `<emisor>.programa_<uuid>` y se
    guarda en `programas_tarjeta.google_class_id`;
  - programa que YA tiene `google_class_id` → `patch`, nunca un segundo `insert`;
  - **el ciclo completo**: encender → apagar (`branding_propio=false`, `google_class_id` INTACTO) →
    reencender → sigue siendo `patch`. Esta es la que protege contra el insert duplicado sobre un id
    que Google no deja borrar.
- [ ] **Step 2:** rojo. **Step 3:** implementar `idClasePrograma` en `ids.ts` y la lógica en
  `syncClase.ts`. **Step 4:** verde.
- [ ] **Step 5: Mutación** — hacer que el apagado ponga `google_class_id = null` y confirmar que la
  prueba del ciclo falla con un segundo `insert`; restaurar. **Step 6:** commit.

---

### Task 7: `syncObjeto` y `linkGuardar`

**Files:**
- Modify: `lib/google/syncObjeto.ts`, `lib/google/linkGuardar.ts`
- Test: los archivos de prueba existentes

El `classId` del objeto pasa a ser `programa.google_class_id ?? comercio.google_class_id`. **Ojo:**
la guarda de "Google Wallet habilitado" (`syncObjeto.ts:32-34`) sigue colgando del COMERCIO — sin
logo del comercio no hay Google Wallet para nadie, tenga el programa lo que tenga.

`linkGuardar` embebe la clase en el JWT: tiene que embeber la del PROGRAMA cuando corresponda, o
Google la pisa con la del comercio (el bug del 2026-07-30, commit `998bcae`).

- [ ] Pruebas (clase propia → el objeto la usa; sin clase propia → la del comercio; el JWT lleva la
  clase correcta), rojo, implementar, verde, mutación, commit.

---

### Task 8: El portal del cliente

**Files:**
- Modify: `lib/portal/buscarTarjetas.ts`
- Test: el existente

- [ ] Prueba de que el portal muestra los colores del programa; rojo; implementar; verde; commit.

---

### Task 9: Escritura — `guardarBrandingPrograma` y `sello_meta`

**Files:**
- Create: `lib/comercio/guardarBrandingPrograma.ts`
- Test: `lib/comercio/guardarBrandingPrograma.test.ts`

- [ ] **Step 1: Pruebas**
  - valida colores con `validarColorRgb` y difuminado con `NIVELES_DIFUMINADO` (reusar, no
    reescribir — la BD no valida nada de esto);
  - scope por `comercio_id`: conocer el id de un programa ajeno no permite cambiarle la marca;
  - guardar `sello_meta` del programa (el campo que hoy nadie escribe — ver el spec);
  - al guardar, si `necesitaClasePropia` da true, se crea/actualiza la clase; si da false, NO se
    toca Google.
- [ ] Rojo, implementar, verde, mutación (quitar el scope por `comercio_id` y confirmar que la
  prueba de programa ajeno falla), commit.

---

### Task 10: Propagación — que el cambio LLEGUE a los teléfonos

**Files:**
- Modify: `lib/google/syncComercio.ts`, `lib/apple/notificarCambioComercio.ts`,
  `app/comercio/(protegido)/branding/actions.ts`, `app/comercio/(protegido)/sucursales/actions.ts`

Sin esta tarea el dueño guarda el branding y **no pasa nada visible**: los `.pkpass` instalados no se
refrescan y los objetos de Google no se re-sincronizan.

- [ ] Poder acotar `syncObjetosComercio` a un programa; un `notificarCambioPrograma` equivalente al
  del comercio; y que guardar branding de PROGRAMA dispare ambos.
- [ ] **El llamador de sucursales:** las ubicaciones del geopush viven en la CLASE
  (`construirRecursos.ts:46-52`). Crear o mover una sucursal ahora tiene que actualizar la clase del
  comercio **y la de cada programa con clase propia**, o esos clientes pierden el aviso por
  cercanía. Prueba explícita.
- [ ] Commit.

---

### Task 11: UI

**Files:**
- Modify: `app/comercio/(protegido)/programas/` (página, `actions.ts`, formulario nuevo)

- [ ] Panel de marca por programa, siguiendo el patrón de `FormularioConfiguracionPrograma.tsx`
  (campos no controlados con `key`, `useActionState`, gate `verifyComercioOwner`).
- [ ] Un interruptor "usar branding propio" y, debajo, los campos. Con el interruptor apagado, los
  campos se muestran deshabilitados con los valores heredados como placeholder — así el dueño VE qué
  está heredando.
- [ ] **El aviso de irreversibilidad** al tocar color de fondo, logo o imagen de portada, con esas
  palabras: crear la clase de Google no se puede deshacer. Es la única defensa contra un dueño que
  experimenta.
- [ ] Commit.

---

### Task 12: Verificación end-to-end

- [ ] `npx tsc --noEmit`, `npx eslint` sobre los archivos tocados (el `eslint .` completo se queda
  sin memoria en esta máquina — usar la lista de archivos), y `npm test` COMPLETO.
- [ ] Confirmar **cero huérfanos**: `npx tsx --conditions=react-server scripts/limpiar-comercios-prueba.ts`
  debe decir "Nada que limpiar" después de la suite.
- [ ] Verificación manual en el navegador (la hace el controlador o el usuario, NO un subagente):
  crear un programa secundario, darle color y logo propios, y confirmar en un teléfono real que la
  segunda tarjeta se ve distinta de la primera.
- [ ] Actualizar `docs/superpowers/ESTADO-Y-PLAN-2026-07-28.md`.
- [ ] Commit final.

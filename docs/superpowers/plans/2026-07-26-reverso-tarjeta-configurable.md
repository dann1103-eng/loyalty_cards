# Reverso configurable de la tarjeta — plan de implementación

> **Para trabajadores agénticos:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development
> para implementar este plan tarea por tarea. Los pasos usan checkbox (`- [ ]`) para seguimiento.

**Objetivo:** que el pass de Apple tenga reverso, con una sección armada por el sistema, texto y redes
que carga el dueño, y un pie fijo de Cardly SV.

**Arquitectura:** una función PURA (`construirReverso`) que recibe datos planos y devuelve el arreglo
de campos, sin tocar Supabase — ahí vive casi todo el riesgo y ahí van casi todas las pruebas.
`datosPassDeTarjeta` hace las dos consultas nuevas y le pasa el resultado a `generatePass` por
`DatosPass`. La edición vive en el editor de marca, con su propio formulario y su propia función de
guardado, sin tocar `guardarBranding`.

**Spec:** `docs/superpowers/specs/2026-07-26-reverso-tarjeta-configurable-design.md` — leelo antes de
empezar. Este plan lo implementa, no lo reemplaza.

**Stack:** Next.js 16 App Router, Supabase, `passkit-generator`, vitest.

---

## Reglas del proyecto que NO se negocian

- **Código y comentarios en español**, siempre.
- **El asistente NO corre DDL.** La migración se le entrega al usuario, él la corre en Supabase Studio
  y avisa. Después se verifica con un script de solo lectura.
- **La validación de aplicación es la ÚNICA defensa**: la base casi no tiene CHECKs.
- **Mutation-testing obligatorio** en las ramas críticas: rompé la línea que la prueba dice proteger,
  confirmá que la prueba FALLA por la razón correcta, restaurá.
- Identidad de commits: `Daniel <268727888+dann1103-eng@users.noreply.github.com>`, `-m` plano.
- **No inicies el dev server.**

## Estructura de archivos

| Archivo | Responsabilidad |
|---------|-----------------|
| `supabase/migrations/0013_reverso_tarjeta.sql` | **CREAR.** Seis columnas nuevas en `comercios`. La corre el usuario. |
| `lib/supabase/types.ts` | **MODIFICAR.** Las seis columnas en `Row`/`Insert`/`Update` de `comercios`. Mismo commit que la migración. |
| `lib/apple/emisorCardly.ts` | **CREAR.** Constante con los datos de Cardly SV. |
| `lib/apple/construirReverso.ts` | **CREAR.** Función pura: datos planos → campos del reverso. El corazón. |
| `lib/apple/construirReverso.test.ts` | **CREAR.** La mayor parte de las pruebas. |
| `lib/apple/generatePass.ts` | **MODIFICAR.** `DatosPass.reverso` + `pass.backFields.push`. |
| `lib/apple/generatePass.test.ts` | **MODIFICAR.** Un pass real con reverso. |
| `lib/apple/datosPassDeTarjeta.ts` | **MODIFICAR.** Dos consultas nuevas, best-effort. |
| `lib/comercio/guardarReverso.ts` | **CREAR.** Validación + update. Separado de `guardarBranding`. |
| `lib/comercio/guardarReverso.test.ts` | **CREAR.** |
| `app/comercio/(protegido)/branding/FormularioReverso.tsx` | **CREAR.** Formulario del dueño. |
| `app/comercio/(protegido)/branding/actions.ts` | **MODIFICAR.** `accionGuardarReverso`. |
| `app/comercio/(protegido)/branding/page.tsx` | **MODIFICAR.** Leer columnas nuevas, montar el formulario. |
| `app/comercio/(protegido)/reglas/actions.ts` | **MODIFICAR.** Push al crear/eliminar. |
| `app/comercio/(protegido)/recompensas/actions.ts` | **MODIFICAR.** Push al crear/desactivar. |
| `app/comercio/(protegido)/reglas/FormularioRegla.tsx` | **MODIFICAR.** Etiqueta ambigua. |
| `scripts/verificar-0013.ts` | **CREAR.** Verificación de solo lectura de la migración. |

---

### Tarea 1: Migración 0013 + tipos

Va primera y sola porque **el usuario tiene que correr el SQL a mano**. Entregásela y seguí con la
Tarea 2 mientras tanto: las tareas 2 y 3 no tocan la base.

**Archivos:**
- Crear: `supabase/migrations/0013_reverso_tarjeta.sql`
- Crear: `scripts/verificar-0013.ts`
- Modificar: `lib/supabase/types.ts` (Row/Insert/Update de `comercios`)

- [ ] **Paso 1: Escribir la migración**

```sql
-- 0013: reverso configurable de la tarjeta.
-- El pass no tenia reverso; estas columnas guardan lo que el dueno escribe y aporta. La seccion
-- "Como funciona" NO se guarda: se arma en cada generacion desde reglas_puntos y recompensas, para
-- que no pueda quedar prometiendo una recompensa que ya cambio.
alter table comercios
  add column terminos_uso text,
  add column red_instagram text,
  add column red_facebook text,
  add column red_whatsapp text,
  add column sitio_web text,
  -- default true: los comercios que ya existen quedan con la seccion automatica encendida, que es
  -- el comportamiento deseado. El dueno la apaga si prefiere redactar todo el mismo.
  add column mostrar_como_funciona boolean not null default true;
```

- [ ] **Paso 2: Entregarle el SQL al usuario y esperar**

Pegale el contenido del `.sql` en el chat y pedile que lo corra en Supabase Studio. **No sigas con la
Tarea 4 hasta que confirme.** Las tareas 2 y 3 sí podés hacerlas mientras.

- [ ] **Paso 3: Agregar las seis columnas a `lib/supabase/types.ts`**

En `Row` de `comercios` (después de `cuenta_id`):

```ts
          terminos_uso: string | null;
          red_instagram: string | null;
          red_facebook: string | null;
          red_whatsapp: string | null;
          sitio_web: string | null;
          mostrar_como_funciona: boolean;
```

En `Insert` y en `Update`, las mismas seis pero **todas opcionales** (`terminos_uso?: string | null;`
… `mostrar_como_funciona?: boolean;`).

Ese archivo se mantiene a mano — lo dice él mismo en sus líneas 16-17 — y sin esto el `update()` de la
Tarea 5 no compila.

- [ ] **Paso 4: Script de verificación de solo lectura**

`scripts/verificar-0013.ts`, siguiendo el patrón de `scripts/verificar-0012.ts`: consulta las seis
columnas de un comercio cualquiera, e informa `OK` o `FALLO` con el mensaje de error. No escribe nada.

- [ ] **Paso 5: Correr el verificador (después de que el usuario confirme)**

```bash
npx tsx --conditions=react-server scripts/verificar-0013.ts
```

Esperado: `OK: las seis columnas del reverso existen y son consultables.`

- [ ] **Paso 6: `npx tsc --noEmit`** — esperado: sin salida.

- [ ] **Paso 7: Commit**

```bash
git add supabase/migrations/0013_reverso_tarjeta.sql scripts/verificar-0013.ts lib/supabase/types.ts
git commit -m "Migracion 0013: columnas del reverso de la tarjeta"
```

---

### Tarea 2: `construirReverso` — la función pura

El corazón del trabajo. **No toca Supabase**: recibe datos planos y devuelve campos. Por eso se puede
probar exhaustivamente sin base de datos, y por eso acá va la mayoría de las pruebas.

**Archivos:**
- Crear: `lib/apple/emisorCardly.ts`
- Crear: `lib/apple/construirReverso.ts`
- Crear: `lib/apple/construirReverso.test.ts`

- [ ] **Paso 1: La constante del emisor**

`lib/apple/emisorCardly.ts`:

```ts
// Datos de Cardly SV que van al pie del reverso de TODAS las tarjetas, de todos los comercios.
// Viven en codigo y no en la base a proposito: son nuestros, identicos para todos, y ponerlos en
// `comercios` invitaria a que un comercio los edite.
//
// El sitio va CON `www` y SIN esquema. El `www` no es cosmetico: el dominio raiz redirige, y esa
// redireccion rompio el registro de passes en produccion el 2026-07-26 (ver
// docs/guia-pruebas-manuales-cuentas-sucursales.md). Sin esquema porque este texto lo linkifican los
// detectores de datos de iOS, que reconocen `www.` por su cuenta.
export const EMISOR_CARDLY = {
  nombre: 'Cardly SV',
  correo: 'soporte@cardly-sv.site',
  sitio: 'www.cardly-sv.site',
} as const;
```

- [ ] **Paso 2: Escribir las pruebas ANTES de la implementación**

En `lib/apple/construirReverso.test.ts`. Los casos que importan:

1. **Un comercio sin nada configurado produce EXACTAMENTE dos campos**, `empresa` y `emisor`. Nada de
   secciones vacías ni encabezados huérfanos.
2. **Todos los campos llevan `value`.** Recorré los campos generados en varios escenarios y fallá si
   alguno tiene `attributedValue` sin `value`. Esta prueba es la más importante del archivo: `value`
   es `.required()` en el esquema Joi de passkit y `FieldsArray` **descarta el campo con un
   `console.warn` sin lanzar**, así que sin esta prueba un campo mal armado desaparece del pass en
   silencio.
3. **Una línea por TIPO de regla, la más reciente.** Con tres filas `por_visita` de valores 1, 5 y 2 y
   fechas distintas, sale UNA sola línea, la de la fila más reciente.
4. **Sellos vs puntos y singular vs plural**: `1 punto` / `2 puntos` / `1 sello` / `10 sellos`, tanto
   en las líneas de reglas como en las de recompensas.
5. **Decimales sin ceros de relleno**: `0.5` y no `0.50`; `1` y no `1.00`.
6. **`sello_meta` NO revive la sección**: comercio de sellos con meta pero sin reglas ni recompensas →
   la sección `como_funciona` no aparece.
7. **El interruptor apagado quita la sección** aunque haya reglas y recompensas.
8. **Orden de los campos** exactamente el de la tabla del spec §3.
9. **Escape de HTML**: una URL con comillas no rompe el `href` del `attributedValue`.
10. **Recompensas inactivas ya vienen filtradas** por el llamador — la función pura recibe solo las
    activas; documentalo en el comentario, no lo re-filtres acá.

- [ ] **Paso 3: Correr las pruebas y verificar que FALLAN**

```bash
npx vitest run lib/apple/construirReverso.test.ts
```
Esperado: FAIL, "Failed to resolve import" o "construirReverso is not a function".

- [ ] **Paso 4: Implementar `lib/apple/construirReverso.ts`**

Firma y tipos:

```ts
export interface CampoReverso {
  key: string;
  label: string;
  value: string;
  attributedValue?: string;
}

export interface ReglaReverso {
  tipo: string;
  valor: number;
  activa_desde: string;
}

export interface RecompensaReverso {
  nombre: string;
  descripcion: string | null;
  costo_puntos: number;
}

export interface DatosReverso {
  nombreComercio: string;
  tipoTarjeta: string;
  selloMeta: number | null;
  mostrarComoFunciona: boolean;
  terminosUso: string | null;
  redInstagram: string | null;
  redFacebook: string | null;
  redWhatsapp: string | null;
  sitioWeb: string | null;
  reglas: ReglaReverso[];
  // SOLO las activas: el filtro `activa = true` lo hace quien consulta. Esta funcion no re-filtra
  // porque no puede: no recibe ese campo.
  recompensas: RecompensaReverso[];
}

export function construirReverso(datos: DatosReverso): CampoReverso[]
```

Piezas obligatorias, cada una con su porqué en un comentario:

- `escaparHtml(texto)` — `&` PRIMERO, después `<`, `>`, `"`, `'`. Exportada, para poder probarla sola.
- `unidad(tipoTarjeta, cantidad)` — `'sellos'` → sello/sellos, resto → punto/puntos; singular cuando
  la cantidad es exactamente 1.
- `formatearValor(n)` — `String(Number(n))`, que colapsa `1.00` a `1` y `0.50` a `0.5`.
- `reglaVigenteDeTipo(reglas, tipo)` — la de `activa_desde` mayor, comparando con
  `new Date(...).getTime()` y NO comparando cadenas (dos formatos de offset distintos ordenarían mal).
- `campoLink(key, label, url)` — devuelve `{ key, label, value: url, attributedValue: '<a href="…">…</a>' }`.
  **`value` SIEMPRE**, con la URL cruda: es lo que el cliente ve si el link no se renderiza.

Orden de emisión, tal cual §3 del spec: `como_funciona`, `terminos`, `instagram`, `facebook`,
`whatsapp`, `sitio`, `empresa`, `emisor`. Los seis primeros se omiten cuando no hay dato; los dos
últimos van siempre.

Texto de `como_funciona` (líneas unidas con `\n`), en este orden: `por_visita`, `por_monto`, meta de
sellos, y después las recompensas:

- `Ganás {valor} {unidad} por cada visita.`
- `Ganás {valor} {unidad} por cada $1 de compra.`
- `Completá tus {meta} {unidad}.` — solo si es de sellos Y hay meta Y la sección ya tiene alguna otra
  línea (la meta sola no justifica la sección).
- `• {nombre} — {costo} {unidad}` y, si hay descripción, la descripción en la línea siguiente.

Se omite la sección entera si `!mostrarComoFunciona`, o si no hay ninguna regla vigente Y no hay
recompensas.

Campo del emisor: `value` de tres líneas separadas por `\n` (nombre, correo, sitio), **sin
`attributedValue`** (solo admite `<a>`, no hay forma de apilar líneas) y **sin `dataDetectorTypes`**
(omitir la clave deja todos los detectores de iOS activos; fijarla los restringe y podría apagar
justo el correo).

- [ ] **Paso 5: Correr las pruebas hasta verde**

```bash
npx vitest run lib/apple/construirReverso.test.ts
```

- [ ] **Paso 6: Mutation-testing (OBLIGATORIO)**

Rompé una por una y confirmá que la prueba correcta falla **por el motivo correcto** (leé el mensaje,
no te conformes con "falló"):

1. En `campoLink`, quitá `value` → debe fallar la prueba 2 con un mensaje sobre `value` ausente.
2. En `reglaVigenteDeTipo`, invertí la comparación (quedarse con la más VIEJA) → debe fallar la 3.
3. En `unidad`, devolvé siempre el plural → debe fallar la 4.
4. Invertí dos campos en el orden de emisión → debe fallar la 8.
5. Hacé que `sello_meta` habilite la sección por sí sola → debe fallar la 6.

Restaurá el archivo después de cada una. Si alguna mutación deja las pruebas VERDES, la prueba es
decoración: arreglá la prueba, no el código.

- [ ] **Paso 7: `npx tsc --noEmit`** — sin salida.

- [ ] **Paso 8: Commit**

```bash
git add lib/apple/emisorCardly.ts lib/apple/construirReverso.ts lib/apple/construirReverso.test.ts
git commit -m "Reverso de la tarjeta: constructor puro de los campos"
```

---

### Tarea 3: Cablear el reverso al pass

**Archivos:**
- Modificar: `lib/apple/generatePass.ts`
- Modificar: `lib/apple/generatePass.test.ts`

- [ ] **Paso 1: Prueba que falla**

En `generatePass.test.ts`, agregá `reverso: []` a `datosBase()` (todas las pruebas existentes deben
seguir pasando) y una prueba nueva: generar un pass con dos campos de reverso, uno simple y uno con
`attributedValue`, y asertar sobre `passJson.storeCard.backFields` que están **en el mismo orden** y
que el `attributedValue` viajó.

- [ ] **Paso 2: Correr y ver que falla** — `npx vitest run lib/apple/generatePass.test.ts`

- [ ] **Paso 3: Implementar**

En `DatosPass`, un campo nuevo:

```ts
  // Campos del reverso del pass, ya armados por construirReverso. Arreglo vacio = pass sin reverso
  // (es lo que pasa si las consultas de reglas/recompensas fallan: best-effort, ver datosPassDeTarjeta).
  reverso: CampoReverso[];
```

Y antes del `pass.setBarcodes(...)`:

```ts
  for (const campo of datos.reverso) {
    pass.backFields.push(campo);
  }
```

Uno por uno y no `push(...datos.reverso)`: `FieldsArray` valida cada campo y **descarta el inválido
con un `console.warn` sin lanzar**, así que empujarlos de a uno no cambia el comportamiento pero deja
el bucle donde se puede depurar.

- [ ] **Paso 4: Pruebas verdes** — `npx vitest run lib/apple/generatePass.test.ts`

- [ ] **Paso 5: Commit**

```bash
git add lib/apple/generatePass.ts lib/apple/generatePass.test.ts
git commit -m "El pass emite los campos del reverso"
```

---

### Tarea 4: Las consultas — `datosPassDeTarjeta`

**Requiere la migración de la Tarea 1 ya aplicada.**

**Archivos:**
- Modificar: `lib/apple/datosPassDeTarjeta.ts`

- [ ] **Paso 1: Implementar**

Después de resolver la tarjeta y ANTES de armar el objeto, dos consultas en paralelo, envueltas para
que su falla no tumbe la emisión:

```ts
  // Reglas y recompensas para la seccion automatica del reverso. BEST-EFFORT: si fallan, el pass
  // sale SIN esa seccion en vez de no salir. Un cliente con un reverso incompleto esta infinitamente
  // mejor que uno sin tarjeta. Por eso el catch devuelve arreglos vacios y no relanza.
  const [reglas, recompensas] = await Promise.all([
    supabase.from('reglas_puntos').select('tipo, valor, activa_desde').eq('comercio_id', tarjeta.comercio_id),
    supabase.from('recompensas').select('nombre, descripcion, costo_puntos').eq('comercio_id', tarjeta.comercio_id).eq('activa', true),
  ]);
  if (reglas.error) console.warn('[apple] no se pudieron leer las reglas para el reverso:', reglas.error.message);
  if (recompensas.error) console.warn('[apple] no se pudieron leer las recompensas para el reverso:', recompensas.error.message);
```

Y en el objeto devuelto, `reverso: construirReverso({ … })` con los campos del comercio y
`reglas: reglas.data ?? []`, `recompensas: recompensas.data ?? []`.

`.eq('activa', true)` en recompensas: el filtro va acá porque `construirReverso` es pura y no recibe
ese campo (ver su comentario).

- [ ] **Paso 2: `npx tsc --noEmit`** — sin salida.

- [ ] **Paso 3: Verificar contra producción con un pass real**

```bash
npx tsx --conditions=react-server scripts/verificar-wallet.ts https://www.cardly-sv.site
```

No es una prueba unitaria: confirma que un pass real sigue generándose y que su peso no se disparó.

- [ ] **Paso 4: Commit**

```bash
git add lib/apple/datosPassDeTarjeta.ts
git commit -m "El reverso se arma con las reglas y recompensas del comercio"
```

---

### Tarea 5: `guardarReverso` — validación y guardado

**Requiere la migración aplicada.**

**Archivos:**
- Crear: `lib/comercio/guardarReverso.ts`
- Crear: `lib/comercio/guardarReverso.test.ts`

Seguí el patrón EXACTO de `lib/comercio/guardarBranding.ts`: mismo shape de resultado
(`{ ok: true } | { ok: false; error: string }`), mismo `.select('id').single()` con el manejo de
`PGRST116`, mismos mensajes en español dirigidos al dueño. **No toques `guardarBranding`.**

- [ ] **Paso 1: Pruebas primero.** Casos:

1. `http://ejemplo.com` se rechaza con un mensaje que nombra la red.
2. `javascript:alert(1)` se rechaza.
3. **`"ht\ntps://ejemplo.com"` se rechaza** — el caso que motivó el doble chequeo: el parser WHATWG
   borra los saltos de línea antes de parsear, así que `new URL()` devuelve `protocol === 'https:'` y
   solo el `startsWith` lo atrapa. Verificado en Node. Sin esta prueba, alguien "simplifica" el
   validador a una sola condición y abre el hueco de nuevo.
4. Términos de 2001 caracteres se rechazan; 2000 pasan.
5. Una URL de 501 caracteres se rechaza.
6. Cadenas vacías o solo-espacios se guardan como `null`, no como `''`.
7. **La URL se guarda CRUDA**: `https://ejemplo.com/a b` no se convierte en `.../a%20b`.

- [ ] **Paso 2: Verlas fallar.**

- [ ] **Paso 3: Implementar.** Lo esencial:

```ts
const LARGO_MAXIMO_TERMINOS = 2000;
const LARGO_MAXIMO_URL = 500;

// Las DOS condiciones, no una. El parser WHATWG borra tabs y saltos de linea ANTES de parsear, asi
// que "ht\ntps://ejemplo.com" devuelve protocol 'https:' y pasaria un chequeo que mire solo el
// protocolo — pero lo que se GUARDA es la cadena cruda, que no empieza con https:// y termina asi
// dentro del href del pass. El startsWith cierra esa brecha; el new URL() rechaza javascript:,
// http: y cualquier basura que empiece bien pero no sea una URL. Comprobado en Node.
export function validarUrlHttps(valor: string): boolean {
  if (!valor.startsWith('https://')) return false;
  try {
    return new URL(valor).protocol === 'https:';
  } catch {
    return false;
  }
}
```

Y `normalizarOpcional(v: string): string | null` que hace `trim()` y devuelve `null` si queda vacío,
para que la lógica de omitir secciones del reverso tenga un solo caso que mirar.

- [ ] **Paso 4: Verde.**

- [ ] **Paso 5: Mutation-testing (OBLIGATORIO)**

1. Quitá el `startsWith` de `validarUrlHttps` → debe fallar la prueba 3 (la del salto de línea).
2. Cambiá `> LARGO_MAXIMO_TERMINOS` por `>=` → debe fallar el borde de la prueba 4.
3. Devolvé `''` en vez de `null` en `normalizarOpcional` → debe fallar la 6.

- [ ] **Paso 6: Commit**

```bash
git add lib/comercio/guardarReverso.ts lib/comercio/guardarReverso.test.ts
git commit -m "Validacion y guardado del reverso configurable"
```

---

### Tarea 6: La UI del dueño

**Archivos:**
- Crear: `app/comercio/(protegido)/branding/FormularioReverso.tsx`
- Modificar: `app/comercio/(protegido)/branding/actions.ts`
- Modificar: `app/comercio/(protegido)/branding/page.tsx`

- [ ] **Paso 1: `accionGuardarReverso`** en el `actions.ts` que ya existe, calcada de
`accionGuardarBranding`: `verifyComercioOwner()` **FUERA de cualquier try/catch** (usa `redirect()`,
que lanza `NEXT_REDIRECT`), `createServiceClient()`, `guardarReverso(...)`, `revalidatePath` y
**`await notificarCambioComercio(supabase, comercioId)`** al final — sin eso el dueño guarda su
Instagram y los clientes siguen viendo el reverso viejo.

- [ ] **Paso 2: `FormularioReverso.tsx`** — cliente, `useActionState`, `<form>` propio e
independiente del de colores. Contiene:

- Un checkbox `mostrar_como_funciona`, con un texto que explique qué hace: que la sección se arma sola
  con sus reglas y recompensas y se mantiene al día.
- Un `<textarea name="terminos_uso">` que **arranca vacío cuando no hay términos guardados**, con un
  botón `Usar un borrador sugerido` al lado que lo llena en el cliente.
  **NO uses `defaultValue` con el borrador**: si lo hacés, el dueño que solo quiere cargar su
  Instagram aprieta Guardar y el borrador queda persistido como los términos legales de su comercio
  sin que nadie los haya leído.
- Cuatro `<input type="url">` para las redes, con `placeholder` de ejemplo (`https://instagram.com/tunegocio`).

Texto literal del borrador, con `{unidad}` = "puntos" o "sellos" y `{comercio}` el nombre:

```
1. Los {unidad} no tienen valor monetario y no se canjean por efectivo.
2. Los {unidad} no vencen.
3. La tarjeta es personal: no se transfiere ni se combina con otras.
4. Las recompensas están sujetas a disponibilidad.
5. No acumulable con otras promociones.
6. {comercio} puede modificar o terminar el programa avisando en el local.
```

- [ ] **Paso 3: `page.tsx`** — agregá las seis columnas al `select` y montá `<FormularioReverso>`
después de `<FormularioBranding>`.

- [ ] **Paso 4: `npx tsc --noEmit` y la suite completa** — `npx vitest run`.

- [ ] **Paso 5: Commit**

```bash
git add "app/comercio/(protegido)/branding/"
git commit -m "Editor del reverso de la tarjeta en el panel del dueno"
```

---

### Tarea 7: El push que hace que "vivo" sea cierto

Sin esto, la decisión central del spec es una promesa vacía: el dueño cambia una recompensa y el
reverso de sus clientes sigue prometiendo lo viejo hasta que cada uno pase por caja.

**Archivos:**
- Modificar: `app/comercio/(protegido)/reglas/actions.ts`
- Modificar: `app/comercio/(protegido)/recompensas/actions.ts`
- Modificar: `app/comercio/(protegido)/reglas/FormularioRegla.tsx`

- [ ] **Paso 1:** En las cuatro acciones —crear regla, eliminar regla, crear recompensa, desactivar
recompensa— agregá `await notificarCambioComercio(supabase, comercioId)` **después** de que el cambio
se guardó y solo si salió bien. Copiá el patrón de `branding/actions.ts:43`, incluido el comentario
que explica por qué existe.

Best-effort: su falla nunca revierte el guardado.

- [ ] **Paso 2:** En `FormularioRegla.tsx:21`, cambiá la etiqueta a
`Valor (puntos por visita, o puntos por cada $1 de compra)`. La anterior decía "unidad de monto", que
es ambiguo — y ahora esa interpretación se imprime en la tarjeta de cada cliente, así que lo que el
dueño entiende al cargarla y lo que el cliente lee tienen que coincidir.

- [ ] **Paso 3: `npx tsc --noEmit` y `npx vitest run`.**

- [ ] **Paso 4: Commit**

```bash
git add "app/comercio/(protegido)/reglas/" "app/comercio/(protegido)/recompensas/"
git commit -m "Avisar a Wallet cuando cambian reglas o recompensas"
```

---

### Tarea 8: Cierre

- [ ] **Paso 1: Suite completa** — `npx vitest run`. Todo verde, sin excepciones.
- [ ] **Paso 2: `npx tsc --noEmit`** — sin salida.
- [ ] **Paso 3: Verificación del pass real**

```bash
npx tsx --conditions=react-server scripts/verificar-wallet.ts https://www.cardly-sv.site
```

- [ ] **Paso 4:** Agregá a `docs/guia-pruebas-manuales-cuentas-sucursales.md` una Parte 4 con el
paso a paso manual: configurar el reverso, guardar, abrir la tarjeta en el iPhone, tocar la "i", y
verificar que las secciones aparecen en orden y que los links de redes abren. Incluí el caso de
cambiar una recompensa y confirmar que el reverso se actualiza solo.
- [ ] **Paso 5:** Actualizá `docs/superpowers/ESTADO-Y-PLAN-2026-07-25.md`: el bullet del reverso
configurable pasa de pendiente a hecho.
- [ ] **Paso 6: Commit y push a master.**

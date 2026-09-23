# Después del primer onboarding: atajo de Android, monto mínimo de compra y reseña de Google

**Fecha:** 2026-09-23 · **Estado:** diseño aprobado por Daniel (2026-09-23), con todas las opciones
recomendadas y el texto fijo en el paso de reseña. Spec aprobada por un revisor independiente en la
segunda pasada; la primera encontró que la sección 1 original no funcionaba en Next 16 (ver
"Corrección" abajo). Daniel NO leyó este documento escrito: pidió que se avanzara con autonomía
mientras estaba lejos de la computadora, así que las decisiones 6 y 7 quedan para su confirmación. Tres piezas
independientes que salieron del primer onboarding con clientes reales (2026-09-22). Contexto previo:
memoria `backlog-post-onboarding-2026-09-22`.

## Decisiones de Daniel (2026-09-23)

1. **Monto mínimo de compra: por COMERCIO**, no por programa (mismo patrón que `pedir_monto_compra`).
2. **Bajo el mínimo: se RECHAZA la acreditación** con un error claro. No se acredita en cero.
3. **Reseña de Google: sistema de honor.** La app no puede verificar que la reseña exista (Google no
   lo permite en tiempo real sin la API de Business Profile), y así está bien.
4. **Reseña: por COMERCIO**, no por programa.
5. **Texto del paso de reseña: fijo.** Sin mensaje personalizable. La promesa de "tu primer sello" la
   comunica el comercio (cartel, de palabra) y la cumple el cajero con el escáner.

Decisiones tomadas por el asistente con autonomía (Daniel lejos de la computadora, 2026-09-23), cada
una para cerrar un hallazgo de la revisión de la spec:

6. **El dueño puede autorizar una acreditación bajo el mínimo**, con motivo, por el MISMO panel de
   autorización que ya usan las perillas antifraude. El cajero sigue viendo el rechazo (decisión 2);
   sin esto el dueño no tendría ninguna forma de dar un sello por una compra chica: el único ajuste
   manual que existe (`quitarPuntos`) solo resta.
7. **La regla de monto aplica también a "Agregar cliente" (alta por teléfono)**, que hoy acredita
   directo con `acreditarPuntos`. Si no, sería el camino para esquivar el mínimo.

---

## 1. El atajo de Android del dueño abre `/mi-tarjeta`

### El problema (confirmado)

`app/manifest.ts` es el manifest del portal del CLIENTE (`start_url: '/mi-tarjeta'`) y hoy es el único
del sitio: Next inyecta su `<link rel="manifest">` en TODAS las páginas. El dueño que en Android toca
"Agregar a pantalla de inicio" / "Instalar app" desde su login o su panel instala el portal del
cliente.

### Corrección respecto de la primera versión de esta spec

La primera versión proponía `app/comercio/manifest.ts` anidado. **No funciona en Next 16.2.10:** el
archivo especial `manifest` solo se reconoce en la raíz de `app/`. Verificado por el revisor y
reproducido: `isMetadataRouteFile('/comercio/manifest.ts', exts, true)` da `false`
(`node_modules/next/dist/lib/metadata/is-metadata-route.js:166`, regex anclada a la raíz), y
`build/webpack/loaders/metadata/discover.js:104` solo junta `manifest` en el layout/página raíz. Lo
que sí es por segmento es el campo **`metadata.manifest`** exportado
(`resolve-metadata.js:268`, el segmento más profundo gana).

### El diseño

**Los manifests los sirven Route Handlers, fuera del matcher del proxy:**

- `app/manifiestos/comercio.webmanifest/route.ts` → `/manifiestos/comercio.webmanifest`
- `app/manifiestos/admin.webmanifest/route.ts` → `/manifiestos/admin.webmanifest`

Mismo patrón de carpeta con punto que `app/api/tarjetas/[tarjetaId]/pass.pkpass/route.ts`. Responden
`Content-Type: application/manifest+json`. Viven fuera de `/comercio/*` y `/admin/*` a propósito: el
navegador pide el manifest **sin cookies**, y el proxy (`lib/supabase/proxy.ts`) redirige al login
toda ruta sin sesión de esas dos ramas. Así el proxy no se toca.

El contenido sale de un módulo puro con prueba, `lib/marca/manifiestos.ts` (o donde el plan lo ubique
junto a la marca):

| | Comercio | Admin |
|---|---|---|
| `name` | `Cardly SV — Panel del comercio` | `Cardly SV — Admin` |
| `short_name` | `Cardly` | `Cardly Admin` |
| `start_url` / `id` | `/comercio/panel` | `/admin` |
| `scope` | `/comercio/` | `/admin` (sin barra final: `/admin` no empieza con `/admin/`, y un `start_url` fuera del `scope` hace que el navegador descarte el scope) |
| íconos | los mismos `/mi-tarjeta/icono-192` y `-512` | ídem |

- `start_url: '/comercio/panel'`: la página que comparten el dueño y el cajero (gate
  `verifyComercioAcceso`). Sin sesión, el proxy la manda a `/comercio/login`. No existe página en
  `/comercio` a secas.
- Íconos reusados: `/mi-tarjeta/icono-*` dibujan el ícono genérico de Cardly (`renderIconoCardly`,
  `lib/portal/iconoCardly.tsx`) y son públicos.
- `display`, `background_color` y `theme_color` iguales a los del manifest raíz.

**Cada pantalla del dueño y de FM apunta a su manifest** con `export const metadata = { manifest: … }`
(la URL es una constante exportada del mismo módulo, no un literal repetido):

- Comercio: `app/comercio/(protegido)/layout.tsx` (cubre todo el panel) y las páginas fuera de
  `(protegido)`: `login`, `activar`, `clave`, `elegir`, `suspendida`. Más `app/registro-comercio/page.tsx`
  (el alta self-service del dueño), que YA exporta `metadata`: se le agrega la clave, no se reemplaza.
- Admin: `app/admin/(protegido)/layout.tsx` y `app/admin/login/page.tsx`.
- **`app/comercio/layout.tsx` y `app/admin/layout.tsx` siguen sin existir** (regla del proyecto).
- Todas son Server Components sin `metadata` hoy (verificado), salvo `registro-comercio`.

**Guardarraíl** (mismo estilo que `lib/marca.test.ts`): una prueba recorre `app/comercio` y `app/admin`
y falla si algún `page.tsx` fuera de `(protegido)`, o el `layout.tsx` de `(protegido)`, no referencia la
constante de su manifest; y nombra explícitamente `app/registro-comercio/page.tsx`, que vive fuera de
esas dos carpetas. Así una pantalla nueva del dueño no vuelve a heredar el del cliente en silencio.

### Descartado

- `manifest.ts` anidado: Next 16 no lo soporta (ver Corrección).
- Servir los manifests bajo `/comercio/…` y eximirlos en el proxy: funciona, pero toca el archivo de
  sesión más sensible del sistema sin ninguna necesidad.
- Crear `app/comercio/layout.tsx` solo para la metadata: la regla del proyecto lo prohíbe.

### Verificación

- Prueba pura de los dos objetos (start_url, scope, id, íconos) y el guardarraíl de archivos.
- Navegador: `/comercio/login` lleva UN solo `<link rel="manifest">` y apunta a
  `/manifiestos/comercio.webmanifest`; `/admin/login` al de admin; `/mi-tarjeta` y `/registro/<slug>`
  siguen con `/manifest.webmanifest`; `fetch('/manifiestos/comercio.webmanifest', { credentials: 'omit' })`
  devuelve 200 con `application/manifest+json`.
- Android real (Daniel): borrar el atajo viejo y agregarlo de nuevo desde el login del comercio. Un
  atajo ya instalado NO se corrige solo.

---

## 2. Monto de compra obligatorio y monto mínimo para sumar

### El problema

Hoy `comercios.pedir_monto_compra` (0015) solo MUESTRA un campo de monto opcional en el escáner; el
monto se guarda como evidencia (`transacciones_puntos.monto_compra`) y nunca gatea nada. Daniel quiere
que el comercio pueda (a) exigir el monto y (b) fijar un mínimo de compra para sumar sellos/puntos
("solo sello consumos de $10 en adelante"), o dejarlo como funciona hoy.

### Base de datos — migración `0039` (comercios, solo columnas nuevas)

```sql
alter table comercios
  add column exigir_monto_compra boolean not null default false,
  add column monto_minimo_compra_centavos integer
    check (monto_minimo_compra_centavos is null or monto_minimo_compra_centavos > 0),
  add constraint comercios_exigir_implica_pedir
    check (not exigir_monto_compra or pedir_monto_compra),
  add constraint comercios_minimo_implica_exigir
    check (monto_minimo_compra_centavos is null or exigir_monto_compra);
```

Centavos enteros, como todo el dinero del proyecto. Las filas existentes cumplen todo (defaults
false/null; `pedir_monto_compra` es NOT NULL desde 0015).

### Configuración (por comercio, en *Reglas → Controles*, `FormularioControles.tsx`)

El checkbox actual **"Pedir el monto de la compra" no cambia** (ni su visibilidad ni su input oculto de
preservación, que tienen pruebas en `reglas/actions.test.ts`). Debajo, un sub-bloque nuevo, **visible
si el comercio tiene al menos un programa ACTIVO de puntos o sellos** (no solo el principal: un
comercio de membresía con un programa secundario de sellos también tiene que poder fijar el mínimo):

- Checkbox **"Exigir el monto para sumar"**.
- Campo **"Mínimo de compra para sumar ($)"**, opcional. Leyenda: "Si lo llenás, el monto pasa a ser
  obligatorio."

Cuando el sub-bloque NO se muestra, sus campos no viajan y el guardado deja `exigir = false` y
`mínimo = null`. **No se preservan con inputs ocultos, a propósito:** sin ningún programa de puntos o
sellos activo esa configuración no gobierna nada, y preservarla crearía dos problemas encontrados en
la revisión: una perilla invisible que vuelve a aplicarse sola si mañana se activa un programa de
sellos, y un `exigir` guardado que (por la implicación `pedir = pedir || exigir`) impediría destildar
"Pedir" sin que el dueño pudiera ver por qué. El `key` del formulario suma los dos campos nuevos (se
remonta tras guardar, como ya hace con los otros).

El mínimo guardado vuelve al campo como texto con `formatearCentavos` (aritmética entera; nunca
`centavos / 100`), y una prueba confirma que ese texto vuelve a parsear a los mismos centavos exactos
(`centavosDesdeTexto` tolera el `$`).

### Validación de la configuración (`lib/comercio/controlesAcreditacion.ts`)

`ControlesAcreditacion` suma `exigirMontoCompra: boolean` y `montoMinimoCompraCentavos: number | null`
(y `leerControles`/`guardarControles` las leen y escriben).

`controlesDesdeFormulario` recibe `exigirMontoCompra: boolean` y `montoMinimoCompra: string`:
- Texto del mínimo vacío → `null`. No vacío → `centavosDesdeTexto`; si no parsea (`"10x"`, `"-5"`) →
  `NaN`, para que `validar()` lo rechace. Mismo criterio que el `aEntero` del archivo ("no tragarse un
  typo en silencio").
- Implicaciones, resueltas acá y documentadas: `exigir = exigirCheckbox || minimo !== null` y
  `pedir = pedirCheckbox || exigir`. El dueño no puede armar desde el formulario una combinación que la
  BD rechace.

`validar()` agrega (defensa para cualquier otro llamador): mínimo no entero positivo → error; mínimo
por encima de `MAXIMO_MONTO_MINIMO_CENTAVOS = 100_000` ($1,000, atajador de typo) → error; exigir sin
pedir → error; mínimo sin exigir → error.

### La regla, en una función pura (`lib/comercio/montoAcreditacion.ts`)

A qué tipos aplica NO es un `if` con `'puntos' | 'sellos'` escrito a mano: es un campo nuevo del
catálogo de tipos (`lib/tarjetas/tipos.ts`, junto a `usaMontoDeCompra`/`requiereMonto`), `true` en
puntos y sellos y `false` en los otros seis. Es el patrón del proyecto para que un noveno tipo no
compile hasta que alguien decida su valor.

```ts
aplicaReglaDeMonto(tipoValor: string): boolean          // lee el campo del catálogo

validarMontoAcreditacion({ exigir, minimoCentavos, montoCentavos, autorizado }):
  | { ok: true }
  | { ok: false; error: string; bloqueoLimite?: true }
```

En orden:
1. Si `exigir || minimoCentavos !== null` y `montoCentavos` es `null` o `<= 0` →
   `'Escribí el monto de la compra (por ejemplo 19.99).'` (el texto que el escáner ya usa). **No** es
   `bloqueoLimite`: se resuelve tecleando el monto, no autorizando. Un monto de $0.00 no es una compra.
2. Si `minimoCentavos !== null && montoCentavos < minimoCentavos && !autorizado` →
   `'La compra mínima para sumar es $10.00.'` (con `formatearCentavos`), **con `bloqueoLimite: true`**.
3. Si no, ok.

Más un lector `leerReglaDeMonto(supabase, comercioId)` → `{ exigir, minimoCentavos } | null`. Si la
lectura falla, la acreditación se rechaza con "No se pudo verificar la regla de monto. Probá de nuevo."
(falla hacia lo restrictivo: una falla de lectura acá casi seguro tumbaría el RPC igual).

### Dónde se aplica (los DOS caminos que acreditan puntos/sellos)

**Escáner — `ejecutarOperacion`** (`app/comercio/(protegido)/escanear/actions.ts`), en la rama de
puntos y sellos (el `default` del switch), antes de `acreditar`:
- `autorizado = autorizacion !== null`. Como `accionAutorizarOperacion` corre la misma
  `ejecutarOperacion`, el dueño que autoriza con motivo saltea SOLO el mínimo (paso 2); el monto
  faltante (paso 1) no se autoriza.
- El rechazo por mínimo llega al escáner como `bloqueoLimite`, así que el escáner ya muestra el panel de
  autorización que existe (`Escaner.tsx:197-222`); para un cajero, `accionAutorizarOperacion` responde
  que solo el dueño puede.
- El `montoCompra` sigue viajando al RPC como evidencia, igual que hoy.

**Agregar cliente — `altaYAcreditacionPorTelefono`** (`lib/comercio/altaPorTelefono.ts`), si el
programa elegido es de puntos o sellos:
- `DatosAltaPorTelefono` suma `montoCompraCentavos?: number | null` (OPCIONAL: ausente = `null`, así los
  llamadores y pruebas existentes siguen compilando; con la regla activa, ausente se rechaza como monto
  faltante). La acción (`clientes/agregar/actions.ts`) lo lee de un campo nuevo `monto_compra` con
  `centavosDesdeTexto`.
- Paso 1 (monto faltante) se valida ANTES de `registrarCliente`: una validación que falla no crea nada.
- Paso 2 (mínimo) se valida DESPUÉS de `registrarCliente`, justo donde hoy acredita: devuelve
  `bloqueoLimite`, y el formulario ya dice "El cliente ya quedó dado de alta: pedile al dueño que lo
  autorice desde el escáner" (`FormularioAgregarCliente.tsx:117`). Mismo contrato que las perillas
  antifraude.
- El monto viaja a `acreditarPuntos` como `montoCompra` (evidencia), que hoy este camino no manda.
- El formulario muestra el campo "Monto de la compra ($)" cuando el comercio lo exige **y el programa
  elegido pasa `aplicaReglaDeMonto`** (el formulario ya conoce el tipo del elegido,
  `FormularioAgregarCliente.tsx:33`): en una gift card o un prepago el campo sería ignorado. La página
  le pasa `exigirMontoCompra` y el mínimo formateado; misma leyenda del mínimo.

Descartado: aplicarlo en el RPC `acreditar_atomico`. Cubriría los dos caminos de una vez, pero obliga
a redefinir las dos funciones largas de la 0015 (el riesgo más alto posible acá), y el mínimo no tiene
condición de carrera.

### Escáner (UI)

`ResultadoEscaneo` suma `exigirMontoCompra?: boolean` y `montoMinimoTexto?: string | null`, calculados
en `accionBuscarPorToken` solo si `aplicaReglaDeMonto(tipo)`. Con `exigirMontoCompra`:
- El campo de monto se muestra aunque `pedirMontoCompra` no lo mostrara (no debería pasar por el CHECK,
  pero la UI no depende de eso), y su etiqueta pierde el "(opcional)".
- Se muestra "Mínimo $10.00" junto al campo.
- El botón principal queda deshabilitado mientras el monto esté vacío. El input no está dentro de un
  `<form>` (los botones son `onClick`), así que `required` no haría nada. La validación de verdad es la
  del servidor.

---

## 3. Reseña de Google antes del registro

### Base de datos — misma migración `0039`

```sql
alter table comercios
  add column pedir_resena_google boolean not null default false,
  add column resena_google_url text
    check (resena_google_url is null or char_length(resena_google_url) <= 500),
  add constraint comercios_resena_con_link
    check (not pedir_resena_google or resena_google_url is not null);
```

### Configuración (por comercio)

Un bloque nuevo **"Registro de clientes"** en la página *Reglas*, con su propio formulario
(`FormularioResenaGoogle.tsx`) y su propia acción (owner-only, `verifyComercioOwner`, igual que las
otras de esa página):

- Checkbox "Pedir una reseña en Google antes de sacar la tarjeta".
- Campo "Link para dejar reseña en Google" (obligatorio si el checkbox está marcado). Se puede guardar
  el link con el checkbox apagado (queda listo para prenderlo).

### Validación del link (`lib/comercio/resenaGoogle.ts`, pura, con mutaciones)

`validarUrlResenaGoogle(texto)`: recorta; vacío → `null`; `new URL()` que no parsea → error; protocolo
distinto de `https:` → error; host fuera de la lista → error. Hosts aceptados: `g.page`, `goo.gl`,
`maps.app.goo.gl`, `google.com` y `*.google.com`, `google.com.sv` y `*.google.com.sv` (el mercado es El
Salvador y un link copiado de Maps puede venir con el dominio local). Comparación EXACTA de host o
sufijo con punto (nunca `includes`): rechaza `google.com.malo.com`, `malogoogle.com`, `javascript:…`.

Por qué la lista: el link se muestra en una página pública que el cliente toma como del negocio. Ataja
el pegado equivocado (el link de Instagram) y le quita a una cuenta de dueño comprometida la forma de
mandar a los clientes a cualquier sitio.

**Se revalida al LEER, antes de usarlo como `href`** (lo que sale de la base es dato hostil, regla del
proyecto): un valor guardado que ya no pasa la validación se trata como si no hubiera link.

### Lo que ve el cliente (`RegistroCliente.tsx`)

Las dos páginas de registro (`app/registro/[comercioSlug]/page.tsx` y
`.../[programaSlug]/page.tsx`) pasan `resenaGoogleUrl: string | null`: el link revalidado si
`pedir_resena_google` está activo; si no, `null`. Con `null` no cambia nada.

Con link, antes del formulario hay un paso nuevo:

- Título: **"Antes de tu tarjeta"**. Texto: **"¿Nos dejás una reseña en Google? Nos ayuda
  muchísimo."**
- Botón principal **"Dejar mi reseña en Google"**: `<a target="_blank" rel="noopener noreferrer">`.
- Botón **"Ya la dejé, sacar mi tarjeta"**: deshabilitado hasta que se toca el de Google. Lleva al
  formulario de siempre.
- Se recuerda en `sessionStorage` (clave por slug de comercio, lecturas y escrituras en try/catch) que
  el cliente ya tocó el link, para que si iOS recarga la pestaña al volver de la app de Google Maps no
  tenga que tocarlo de nuevo.

Sistema de honor: `/api/registro` no cambia y no verifica nada. "Agregar cliente" (alta por teléfono)
no pasa por este paso. Las tarjetas ya emitidas no se tocan.

---

## Orden y despliegue

1. **Manifest** — sin migración. Se implementa, se verifica y se publica solo.
2. **Migración 0039** — la corre Daniel a mano en Studio (flujo del proyecto). Verificación después con
   un script de solo lectura.
3. **Monto** y **reseña** — se implementan en la rama, pero **no se publican hasta que 0039 esté
   aplicada**. El riesgo no es solo el guardado de Reglas: también las LECTURAS. Si las páginas de
   registro seleccionan `pedir_resena_google`/`resena_google_url` antes de la migración, la consulta
   falla y TODO comercio responde "no encontrado" en su QR de registro; `leerControles` devolvería
   `null` y el escáner no podría leer la regla de monto. Publicar antes de la migración rompe el
   registro de clientes de todos los comercios.

`lib/supabase/types.ts` suma las cuatro columnas en `Row`/`Insert`/`Update` de `comercios` (y la
lista de migraciones del encabezado).

## Pruebas

- Puras con mutaciones: `aplicaReglaDeMonto`, `validarMontoAcreditacion` (cada rama, incluido
  `autorizado` y el $0.00), `validarUrlResenaGoogle` (cada host aceptado y cada imitación rechazada),
  `controlesDesdeFormulario` (vacío → null, typo → NaN, implicaciones), los objetos de los manifests,
  el guardarraíl de archivos del manifest.
- Contra Supabase: `guardarControles`/`leerControles` con los campos nuevos y sus rechazos; el guardado
  y la lectura de la reseña; `ejecutarOperacion` con un comercio que exige mínimo (bajo el mínimo no
  cambia el saldo y responde `bloqueoLimite`; en el mínimo suma; autorizado bajo el mínimo suma);
  `altaYAcreditacionPorTelefono` con monto faltante (no crea cliente) y bajo el mínimo (crea la tarjeta
  sin acreditar). Las acciones de Reglas conservan la configuración de monto cuando el sub-bloque no se
  muestra.
- Navegador: el paso de reseña (con y sin link, y tras recargar), el escáner con el campo obligatorio y
  el panel de autorización del mínimo, los controles nuevos en Reglas, "Agregar cliente" con monto, y el
  `<link rel="manifest">` por sección.

## Fuera de alcance

- Sello automático de bienvenida al registrarse (otra feature y, con sistema de honor, un sello gratis
  para cualquiera).
- Verificación real de reseñas (API de Google Business Profile).
- Mínimo por programa y mínimo para cashback.
- Mandar el monto como evidencia en otros caminos que hoy no lo mandan (fuera de los dos de arriba).

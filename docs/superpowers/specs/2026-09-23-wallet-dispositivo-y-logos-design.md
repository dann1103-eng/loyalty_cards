# Wallet según el teléfono y logos sin recorte

**Fecha:** 2026-09-23 · **Estado:** diseño aprobado por Daniel (2026-09-23). Primera de dos entregas
pedidas tras los onboardings del 2026-09-22/23; la segunda (Reportes con filtros + Excel) tiene su
propia spec. Sin migración.

## Decisiones de Daniel (2026-09-23)

1. **Botón de Wallet según el teléfono**, con un link para ver el otro ("solo el suyo + link al otro").
   Computadora o dispositivo no reconocido: los dos. También en el portal `/mi-tarjeta`.
2. **El logo se dibuja tal como lo subió el comercio** (cuadrado, circular o rectangular), salvo donde
   Google lo impide. Google dibuja SIEMPRE el `programLogo` dentro de un círculo; lo más fiel posible
   es: logo cuadrado con margen en el círculo + el "logo ancho" (`wideProgramLogo`) para los
   rectangulares. En Apple Wallet, el cartel y la tarjeta de muestra no hay restricción: tal cual.

---

## 1. El botón de Wallet según el teléfono

### Hoy
La pantalla de éxito del registro (`app/registro/[comercioSlug]/RegistroCliente.tsx`) muestra "Agregar
a Apple Wallet" SIEMPRE y "Agregar a Google Wallet" si `googleWalletDisponible`. Un cliente de Android
ve primero el botón de Apple (que en Android no sirve), y la nota "ábrelo desde Safari" y el texto
"Directo en tu Apple Wallet" le hablan a todos. El portal `/mi-tarjeta` solo ofrece el `.pkpass`. No
hay detección de dispositivo en ningún lugar del repo.

### Detección (servidor, pura)
`lib/clientes/plataforma.ts` (nuevo, puro, con prueba):
`detectarPlataforma(userAgent: string | null): 'ios' | 'android' | 'otra'`.
- `'ios'`: `iPhone`, `iPod` o `iPad` en el user agent (incluye Chrome/Firefox/navegadores internos de
  WhatsApp/Instagram en iPhone, que también dicen `iPhone`).
- `'android'`: `Android` en el user agent (Chrome, Samsung Internet, navegadores internos).
- `'otra'`: todo lo demás — computadoras, user agent ausente, y el **iPad con iPadOS 13+**, que
  Safari reporta como `Macintosh` a propósito (del lado del servidor no se distingue de una Mac).
Se decide en el SERVIDOR, leyendo `(await headers()).get('user-agent')` en las páginas: no hay
desajuste de hidratación y la primera pintura ya es la correcta.

### Pantalla de éxito del registro
Las dos páginas de registro (`app/registro/[comercioSlug]/page.tsx` y `.../[programaSlug]/page.tsx`)
pasan `plataforma` a `RegistroCliente`.
- `'ios'`: solo "Agregar a Apple Wallet". La nota "¿No se abrió? … ábrelo desde Safari" se muestra
  siempre que el botón de Apple esté a la vista en `'ios'` u `'otra'` (un iPad con iPadOS 13+ cae en
  `'otra'` y la necesita); en `'android'` no.
- `'android'`: solo "Agregar a Google Wallet" si `googleWalletDisponible`; si Google no está disponible
  (el comercio no tiene logo, o la sincronización de la clase falló en ese momento), se muestra el de
  Apple como hoy y NO se muestra el link "¿Tienes otro teléfono?" (no hay otro botón que revelar).
- `'otra'`: los dos, como hoy.
- En `'ios'` y `'android'`, debajo, un link "¿Tenés otro teléfono?" (tuteo: **"¿Tienes otro
  teléfono?"** — las pantallas del cliente tutean) que muestra el otro botón. Existe porque la
  detección por user agent puede fallar (un navegador raro, un modo escritorio).
- El texto del formulario "Directo en tu Apple Wallet" pasa a depender de la plataforma: "Directo en
  tu Apple Wallet" (ios), "Directo en tu Google Wallet" (android), "Directo en la billetera de tu
  teléfono" (otra). Todo en tuteo.

### Portal `/mi-tarjeta`
`app/mi-tarjeta/page.tsx` lee el user agent y pasa `plataforma` a `PortalCliente`. Donde hoy dice
"Descargar mi pass de nuevo" (el `.pkpass`), aplica la misma regla, con el botón de Google apuntando a
`/api/tarjetas/<id>/google-wallet`. Para saber si Google está disponible para cada tarjeta, la búsqueda
del portal (`lib/portal/buscarTarjetas.ts`) suma un booleano `googleDisponible` =
`comercios.logo_url != null` — la MISMA regla que `linkGuardar` (`lib/google/linkGuardar.ts:38`, que
exige el logo DEL COMERCIO, no el del programa) y que el registro (`syncClaseComercio`). Con otra regla,
un comercio sin logo propio pero con un programa con logo mostraría un botón que responde 404. Se suma
`logo_url` al select embebido de `comercios` que la búsqueda ya hace: no agrega consultas.

---

## 2. Logos sin recorte

### Cartel del QR (`lib/comercio/cartel/`)
Hoy el logo se dibuja en una caja CUADRADA de lado `lado` con `preserveAspectRatio="xMidYMid slice"`
(`plantillas.ts:63-65`), o sea "cubrir": a un logo ancho le cortan los costados. Hay tres plantillas
(`centrado`, `split`, `foto`) y dos formatos (`sticker`, `mostrador`): seis combinaciones, todas
dibujan el logo con esa misma función.
- `resolverDatosCartel` ya mide el logo con sharp (`bajarImagen`) y descarta las medidas: ahora las
  pasa (`logoAncho`, `logoAlto`; `null` si no se pudo medir).
- **Regla de la caja (función pura con prueba, patrón `arrastre.ts`):** el ALTO reservado sigue siendo
  el `lado` de hoy (así nada de lo que está debajo del logo se mueve: en `centrado` el nombre, el QR y
  `altoDisponible` salen de `logoLado`, `plantillas.ts:91-105`; en `split × mostrador`, la y del
  nombre, `:151`). El ANCHO de la caja crece con la proporción del logo hasta un máximo por
  combinación. El logo se dibuja con `preserveAspectRatio="xMidYMid meet"` (entero, sin recorte),
  centrado en la caja. Un logo cuadrado o circular queda igual que hoy; uno ancho ocupa un rectángulo
  de alto `lado`. Sin medidas: caja cuadrada (hoy), pero con `meet`.
- **Anclaje (corrección de la revisión de la Tarea 3):** en `foto` el logo va anclado a la ESQUINA:
  su x queda fija en el margen de siempre y la caja crece solo hacia la derecha (`xMinYMid meet`);
  centrar la caja ahí se comía el margen y pegaba un logo ancho al borde del papel. En
  `split × mostrador` el tope deja margen dentro de la franja. La prueba de "dentro del lienzo" exige
  un margen mínimo, no solo `x >= 0`.
- **`split × sticker`** (el nombre a la derecha del logo, `plantillas.ts:173`): ahí la caja NUNCA es
  más ANCHA que el cuadrado de hoy (`anchoMaximo = lado`, con `meet`): un logo ancho entra entero pero
  más chico, y la caja no se le mete encima al nombre (cuya x es fija). Un logo ALTO da una caja más
  angosta que el cuadrado: con `meet` se dibuja exactamente el mismo rectángulo que dentro del
  cuadrado, así que visualmente no cambia nada — no "restaurar" la caja cuadrada por eso. El nombre no tiene ajuste de ancho (`texto.ts:32-42`, `textoInter.ts:76-84`): un
  nombre largo ya puede salirse del lienzo HOY, y agrandar la caja del logo lo empeoraría. Ajustar el
  nombre queda fuera de esta spec.
- Pruebas: una nueva que asevera `meet` en el `<image>` del logo (la existente de `xMidYMid slice`,
  `plantillas.test.ts:174-177`, es de la foto de fondo y corre con `logoDataUri: null`, así que sigue
  igual); y que ninguna caja de logo se sale del lienzo en X (hoy la prueba de "nada se sale" solo mira
  Y, `plantillas.test.ts:248`), en las seis combinaciones, con un logo 3:1 y uno 1:3.

### Tarjeta de muestra del registro (`.cardface-logo`, `app/globals.css`)
Hoy es un círculo de 54 px con `object-fit: cover`: recorta los logos anchos. Pasa a una caja que
respeta la proporción: alto máximo ~54 px, ancho automático hasta un máximo, `object-fit: contain`, sin
máscara circular. El fondo blanco y la sombra se revisan en el navegador para que un logo con fondo
propio no quede dentro de una "pastilla" rara.

### Google Wallet
**Restricción de Google:** el `programLogo` de la `LoyaltyClass` se dibuja SIEMPRE dentro de un círculo
(guías de marca de Google Wallet: PNG cuadrado ≥ 660×660, fondo a sangre, ~15 % de margen de
seguridad; Google aplica la máscara). Hoy mandamos la URL cruda del logo: recortado al ras (lo hace
`redimensionarImagen.ts` al subirlo) y de ≤ 480 px — por eso "Pulso CAFÉ" queda cortado y diminuto.

**`programLogo` (siempre):** una imagen compuesta en el servidor, servida por una ruta nueva
`app/api/comercios/[comercioId]/logo.png/route.ts` (patrón de `franja.png`: lee la marca efectiva del
comercio o del `?programa=`, con scope por comercio): un cuadrado de 660×660 con el color de fondo de la
tarjeta (`colorFondo`; blanco si no hay — en la práctica todo comercio tiene `color_fondo`, porque el
alta los precarga) y el logo con `fit: 'contain'` dentro del área segura central (~70 % del lado, para
que entero quepa en el círculo).

**Esta ruta NO puede fallar para un comercio con logo.** Google descarga las imágenes de la clase al
crearla o parcharla y rechaza el patch ENTERO con `400 Image cannot be loaded` si no puede
(`scripts/actualizar-frente-google.ts:26-29`). A diferencia de `heroImage` (opcional, donde
`franja.png` responde 404 sin problema), `programLogo` es obligatorio: si la ruta fallara, fallaría la
sincronización de la clase, y con ella Google Wallet para cada registro nuevo de ese comercio y el
link de guardado. Por eso, si componer la imagen falla, la ruta sirve los bytes del logo original
(convertidos a PNG si hace falta); solo responde 404 si el comercio no tiene logo o el programa no es
suyo. Lo mismo `logo-ancho.png`.

**`wideProgramLogo` (solo logos apaisados):** si el logo es ancho (proporción ≥ 1.6 : 1), la clase suma
el logo ancho, servido por `.../logo-ancho.png/route.ts`: PNG de 1280×400 con fondo transparente y el
logo con `fit: 'contain'`, alineado a la izquierda y centrado en alto. Según Google, en Android el logo
ancho reemplaza la cabecera por defecto (círculo + nombre del emisor) por el logo completo — para un
logo que ya contiene el nombre (Pulso) es justo lo que se quiere. El `programLogo` se sigue mandando
(es obligatorio y Google lo usa en la lista de tarjetas).

**Cómo se decide si es ancho:** hacen falta las medidas del logo. La clase se sincroniza en caminos
calientes — `syncClaseComercio` corre en CADA registro de cliente (`app/api/registro/route.ts:85`) y
`generarLinkGuardar` arma la clase en cada toque de "Agregar a Google Wallet" (`linkGuardar.ts:75,124`)
—, así que:
- `medidasLogo(url)` descarga el logo con un timeout corto (~2 s) y lee ancho/alto con sharp, con una
  **caché en memoria por URL** (la URL del logo ya trae `?v=<timestamp>` del bucket, así que una URL
  dada siempre mide lo mismo; la caché es por instancia del servidor y está bien que se pierda). Se
  cachean los éxitos, y los fallos solo 30 s: un `null` por timeout (p. ej. un arranque en frío justo
  después de subir el logo) no puede dejar el logo ancho apagado hasta que reinicie la instancia, pero
  tampoco conviene que, con el bucket lento, cada camino vuelva a esperar el tope entero. Una medición
  en curso para la misma URL se reusa en vez de descargar de nuevo (`linkGuardar` mide el mismo logo dos
  veces seguidas).
- Sin base URL PÚBLICA no se mide nada (no hay rutas compuestas; se degrada a la URL cruda). "Pública" es
  `esBaseUrlPublica` (`lib/google/baseUrlPublica.ts`), no solo "que exista": en desarrollo
  `NEXT_PUBLIC_BASE_URL` es `http://localhost:3000`, y Google rechaza el patch ENTERO (`400 Image cannot be
  loaded`) si una imagen de la clase apunta a un host local — con un chequeo de presencia, toda
  sincronización de clase desde el dev server fallaría para todos los comercios.
- `logosDeClase` es PURA: recibe `medidas: { ancho, alto } | null` ya resueltas y decide. Así las
  pruebas no dependen de la red (las de `syncClase*`/`linkGuardar` usan logos falsos como
  `https://ejemplo.com/logo.png`: la medición se inyecta o se mockea en esas pruebas).

**Poner y quitar el logo ancho (los syncs hacen `patch`):** en un `patch`, un campo omitido conserva
su valor VIEJO en Google (`construirRecursos.ts:220-223`). Entonces:
- medido y ancho → `wideProgramLogo` con la URL de `logo-ancho.png`;
- medido y NO ancho → `wideProgramLogo: null`, para BORRAR uno anterior (un comercio que cambia su logo
  ancho por uno cuadrado). El truco del `null` está verificado para `balance`
  (`construirRecursos.ts:118-125`) pero NO para este campo, y el mismo archivo registra que Google
  rechaza un `loyaltyPoints` nulo: **la implementación lo verifica contra la API real** antes de
  publicar, sobre la clase de un comercio demo existente (nunca una clase de QA nueva: no se pueden
  borrar), usando como imagen una URL pública que ya exista (el logo del demo en el bucket), porque la
  ruta `logo-ancho.png` todavía no está desplegada y Google tiene que poder descargarla. Si Google
  rechaza el `null`, plan B: para un logo NO ancho se OMITE el campo (igual que con la medición
  fallida) y el caso raro de un comercio que cambia su logo ancho por uno cuadrado se corrige a mano
  (queda documentado). NO se manda un logo ancho "de relleno": se lo pondría a todas las clases con
  logo cuadrado y les quitaría la cabecera por defecto (círculo + nombre);
- medición fallida → se OMITE el campo (un error pasajero no agrega ni quita el logo ancho).

**Un solo lugar para las URLs (regla del proyecto):** como `heroUrlDeClase` (`lib/google/heroUrl.ts`),
`logosDeClase(comercioId, programaId, marca, medidas)` arma las URLs con su `?v=` y la usan los TRES
lugares que construyen la clase: `syncClase`, `syncClasePrograma` y la clase embebida en el JWT de
`linkGuardar` — y en `linkGuardar`, siguiendo la MISMA rama que ya usa para la portada
(`claseDelPrograma ? programa : comercio`, `linkGuardar.ts:133-141`), para no ponerle a la clase del
comercio el logo del programa. `construirClase` recibe los logos ya resueltos; su cambio de firma
alcanza también a `scripts/actualizar-frente-google.ts` (tsconfig compila `scripts/`).

**`?v=` (cache-busting, regla del proyecto):** Google cachea cada imagen por URL. La versión resume
todo lo que altera la imagen (URL del logo — que ya trae su propio `?v=<timestamp>` del bucket —,
`colorFondo` y una constante de versión de la composición). Cambiar el logo o el color cambia la URL.

**Sin base URL pública** (`esBaseUrlPublica` falso: ausente, `http://` o localhost — desarrollo): se
degrada a la URL cruda del logo (como hace
`heroUrlDeClase`), sin logo ancho.

**Pases ya emitidos:** el logo es de la CLASE (asimetría clase/objeto, CLAUDE.md), así que basta
re-sincronizar las clases — cosa que producción ya hace sola en cada registro, cada "Agregar a Google
Wallet" y cada guardado de marca; el script solo acelera que llegue a TODOS los comercios. Se agrega
a `scripts/actualizar-frente-google.ts` una fase NUEVA `logos` que llama a `syncClaseComercio` /
`syncClasePrograma` (exactamente lo que corre producción), sin tocar la fase `clases` ni su guarda
`copiaTraePlantillaDeFilas`: esa guarda protege el orden del **deploy B** (la plantilla de filas de la
clase, terminada pero SIN publicar en la rama `claude/plantilla-filas-google`, commit `a2dba8e`; orden
en `docs/superpowers/ESTADO-Y-PLAN-2026-07-28.md` ~1026-1030 y ~1068-1070), que no tiene nada que ver
con los logos. La fase `logos` se corre **después** del deploy que agrega `logo.png` y `logo-ancho.png`
(antes, Google recibiría 404 y rechazaría el patch). No crea clases nuevas ni de QA.

**Convivencia con el deploy B:** esta spec cambia la firma de `construirClase`, la misma función a la
que el deploy B le agrega `classTemplateInfo`. Los dos cambios son independientes (uno pone logos, el
otro la plantilla) y los `patch` no se pisan (un campo omitido conserva su valor). El que se mergee
SEGUNDO tiene que llevar los dos: al integrar `claude/plantilla-filas-google` después de esto, se
resuelve el conflicto conservando los logos resueltos Y la plantilla.

**Logo ancho borroso:** un logo de 480 px de ancho (el tope actual de subida) estirado a 1280×400 se
ve algo blando. Se acepta; subir el tope solo ayudaría a los logos que se vuelvan a subir.

### Apple Wallet
Sin cambios: su área de logo es apaisada y `redimensionarLogo` usa `fit: 'inside'`. Ya se ve tal cual.

---

## Pruebas

- Puras con mutaciones: `detectarPlataforma` (user agents reales: Safari/Chrome/WhatsApp en iPhone,
  Chrome/Samsung en Android, iPad con iPadOS que dice Macintosh → 'otra', Windows, Mac, vacío/null);
  la caja del logo del cartel (cuadrado, circular, 3:1, 1:3, sin medidas) en las seis combinaciones;
  `logosDeClase` (URLs, `?v=` que cambia con el logo y con el color; ancho → URL, no ancho → `null`,
  sin medidas → clave omitida; degradación sin base URL pública (ausente Y `http://localhost:3000`); rama comercio vs programa).
- `medidasLogo`: caché por URL (la segunda llamada no descarga), timeout → `null`.
- Rutas `logo.png` y `logo-ancho.png`: responden PNG con las medidas correctas (660×660 / 1280×400),
  404 sin logo y para un programa ajeno, y **si la composición falla sirven el logo original** (nunca
  un error para un comercio con logo).
- Verificación contra la API real de Google, sobre la clase de un comercio demo existente: poner el
  logo ancho y quitarlo con `null` (o el plan B). Resultado anotado en el plan.
- Las pruebas existentes de `construirClase`/`syncClase*`/`linkGuardar` que fijan `programLogo` se
  actualizan a la URL compuesta.
- Navegador: el registro con user agent de iPhone, de Android y de escritorio (el panel del navegador
  permite emular teléfono); el link "¿Tienes otro teléfono?"; el portal; el cartel con un logo ancho
  (Pulso) en las seis combinaciones de plantilla y formato; la tarjeta de muestra.
- Android real (Daniel): el pase de Pulso Café después de re-sincronizar.

## Fuera de alcance

- Cambiar el recorte al ras que hace `redimensionarImagen.ts` al subir el logo (favorece a Apple y al
  cartel; para Google se compone aparte).
- Subir el límite de 480 px del logo (el compuesto escala con `contain`; se revisa si se ve borroso).
- La reseña de Google (se retoma después, ver la conversación del 2026-09-23 sobre las políticas de
  Google: no condicionar beneficios a reseñas).

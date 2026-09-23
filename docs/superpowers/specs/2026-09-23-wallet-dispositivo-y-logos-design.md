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
- `'ios'`: solo "Agregar a Apple Wallet", y la nota de Safari.
- `'android'`: solo "Agregar a Google Wallet" si `googleWalletDisponible`; si Google no está disponible
  para ese comercio (sin logo), se muestra el de Apple como hoy (no dejar al cliente sin botón).
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
del portal (`lib/portal/buscarTarjetas.ts`) suma un booleano `googleDisponible` = la tarjeta tiene logo
efectivo (el del programa o el del comercio: la misma regla que usan `syncClasePrograma` y
`linkGuardar`, que devuelven 404/error sin logo). Leer los dos logos no agrega consultas si la búsqueda
ya trae el branding; si agrega una, es aceptable (pantalla de consulta, no de mostrador).

---

## 2. Logos sin recorte

### Cartel del QR (`lib/comercio/cartel/`)
Hoy el logo se dibuja en una caja CUADRADA con `preserveAspectRatio="xMidYMid slice"`
(`plantillas.ts:63-65`), o sea "cubrir": a un logo ancho le cortan los costados. Se usa en las cuatro
plantillas (centrado, mostrador, sticker, foto).
- `resolverDatosCartel` ya mide el logo con sharp (`bajarImagen`) y descarta las medidas: ahora las
  pasa (`logoAncho`, `logoAlto`).
- La caja del logo toma la PROPORCIÓN del logo, acotada por un ancho y un alto máximos por plantilla,
  y el logo se dibuja con `preserveAspectRatio="xMidYMid meet"` (entero, sin recorte). Un logo cuadrado
  o circular queda igual que hoy; uno ancho ocupa un rectángulo.
- En la plantilla sticker, el nombre arranca después del ancho REAL del logo (hoy `x + logoLado`).
- La prueba `plantillas.test.ts` que busca `xMidYMid slice` se refiere a la foto de fondo: se ajusta
  para que distinga la foto (sigue `slice`) del logo (`meet`).
- La cuenta de la caja vive en una función pura con prueba (patrón `arrastre.ts` del cartel).

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
`app/api/comercios/[comercioId]/logo.png/route.ts` (mismo patrón que `franja.png`: lee la marca
efectiva del comercio o del `?programa=`, con scope por comercio; 404 si no hay logo): un cuadrado de
660×660 con el color de fondo de la tarjeta (`colorFondo`; blanco si no hay) y el logo con
`fit: 'contain'` dentro del área segura central (~70 % del lado, para que entero quepa en el círculo).

**`wideProgramLogo` (solo logos apaisados):** si el logo es ancho (proporción ≥ 1.6 : 1), la clase suma
el logo ancho, servido por `.../logo-ancho.png/route.ts`: PNG de 1280×400 con fondo transparente y el
logo con `fit: 'contain'`, alineado a la izquierda y centrado en alto. Según Google, en Android el logo
ancho reemplaza la cabecera por defecto (círculo + nombre del emisor) por el logo completo — para un
logo que ya contiene el nombre (Pulso) es justo lo que se quiere. El `programLogo` se sigue mandando
(es obligatorio y Google lo usa en la lista de tarjetas).

**Cómo se decide si es ancho:** al armar la clase se descarga el logo y se leen sus medidas con sharp
(una función `medidasLogo(url)` con timeout; si falla, se trata como NO ancho: se manda solo el
cuadrado, que siempre se ve entero). Se paga una descarga del logo por sincronización de clase, no por
cliente.

**Un solo lugar para las URLs (regla del proyecto):** como `heroUrlDeClase` (`lib/google/heroUrl.ts`),
una función `logosDeClase(comercioId, programaId, marca)` arma las dos URLs con su `?v=` y la usan los
TRES lugares que construyen la clase: `syncClase`, `syncClasePrograma` y la clase embebida en el JWT de
`linkGuardar`. `construirClase` recibe las URLs ya resueltas.

**`?v=` (cache-busting, regla del proyecto):** Google cachea cada imagen por URL. La versión resume
todo lo que altera la imagen (URL del logo — que ya trae su propio `?v=<timestamp>` del bucket —,
`colorFondo` y una constante de versión de la composición). Cambiar el logo o el color cambia la URL.

**Sin `NEXT_PUBLIC_BASE_URL`** (desarrollo): se degrada a la URL cruda del logo (como hace
`heroUrlDeClase`), sin logo ancho.

**Pases ya emitidos:** el logo es de la CLASE (asimetría clase/objeto, CLAUDE.md), así que basta
re-sincronizar las clases. Un script de una vez recorre los comercios y programas con clase de Google y
llama a `syncClaseComercio`/`syncClasePrograma`. No crea clases nuevas ni de QA (las clases no se
pueden borrar).

### Apple Wallet
Sin cambios: su área de logo es apaisada y `redimensionarLogo` usa `fit: 'inside'`. Ya se ve tal cual.

---

## Pruebas

- Puras con mutaciones: `detectarPlataforma` (user agents reales: Safari/Chrome/WhatsApp en iPhone,
  Chrome/Samsung en Android, iPad con iPadOS que dice Macintosh → 'otra', Windows, Mac, vacío/null);
  la caja del logo del cartel (cuadrado, circular, 3:1, 1:3) y el ancho real en la plantilla sticker;
  `logosDeClase` (URLs, `?v=` que cambia con el logo y con el color, sin logo ancho si no es apaisado o si
  falla la medición, degradación sin base URL).
- Rutas `logo.png` y `logo-ancho.png`: responden PNG con las medidas correctas (660×660 / 1280×400),
  404 sin logo y para un programa ajeno.
- Las pruebas existentes de `construirClase`/`syncClase*`/`linkGuardar` que fijan `programLogo` se
  actualizan a la URL compuesta.
- Navegador: el registro con user agent de iPhone, de Android y de escritorio (el panel del navegador
  permite emular teléfono); el link "¿Tienes otro teléfono?"; el portal; el cartel con un logo ancho
  (Pulso) en las cuatro plantillas; la tarjeta de muestra.
- Android real (Daniel): el pase de Pulso Café después de re-sincronizar.

## Fuera de alcance

- Cambiar el recorte al ras que hace `redimensionarImagen.ts` al subir el logo (favorece a Apple y al
  cartel; para Google se compone aparte).
- Subir el límite de 480 px del logo (el compuesto escala con `contain`; se revisa si se ve borroso).
- La reseña de Google (se retoma después, ver la conversación del 2026-09-23 sobre las políticas de
  Google: no condicionar beneficios a reseñas).

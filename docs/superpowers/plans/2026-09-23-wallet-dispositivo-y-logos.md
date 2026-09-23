# Wallet según el teléfono y logos sin recorte — plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usá superpowers:subagent-driven-development para implementar
> este plan tarea por tarea (implementador + revisión de spec-compliance + revisión de calidad, por
> tarea). Los pasos usan casillas (`- [ ]`) para el seguimiento.
>
> **Sin bloques de código completos, a propósito** (convención de los planes de este repo desde
> `2026-09-21-pasarela-wompi.md`): la spec tiene las reglas, los tamaños y los textos exactos, y un bloque
> de código del plan que no se mantiene byte-idéntico al archivo publicado es peor que no tenerlo
> (CLAUDE.md). **Los archivos publicados son la única fuente de verdad.**

**Objetivo:** que el cliente vea el botón de SU billetera (Apple en iPhone, Google en Android) y que el
logo del comercio se vea entero — como lo subió — en el cartel, en la tarjeta de muestra y, dentro de
lo que Google permite, en Google Wallet.

**Arquitectura:** detección de plataforma pura en el servidor (user agent) pasada como prop a un
componente compartido de botones de Wallet. El cartel dibuja el logo con `meet` en una caja con la
proporción del logo. Para Google, dos rutas que componen el logo (cuadrado con margen para el
`programLogo` circular; ancho para `wideProgramLogo`), con URLs versionadas armadas en UN solo lugar
(`logosDeClase`) para los tres caminos que construyen la clase.

**Tecnología:** Next.js 16.2.10, sharp (ya en el repo), Vitest 4. Sin dependencias nuevas. **Sin
migración.**

**Spec:** `docs/superpowers/specs/2026-09-23-wallet-dispositivo-y-logos-design.md`. Leela entera antes
de tocar nada.

**Rama:** `claude/cobranza-y-rework-admin` (publicada en `master` hasta `e197b8a`). Se publica con
`git push origin HEAD:master` cuando la Tarea 7 esté cerrada.

---

## Antes de empezar (todas las tareas)

**Dónde se trabaja:** `C:\Users\Daniel\Desktop\Proyectos\Loyalty Cards\.claude\worktrees\focused-aryabhata-28e859`.
Cada subagente verifica con `git -C "<esa ruta>" branch --show-current` ANTES de tocar nada; si imprime
`claude/cobranza-y-rework-admin`, prosigue (los subagentes arrancan en un worktree de infraestructura
ajeno: `cd` con la ruta absoluta en cada Bash, rutas absolutas en Read/Write/Edit).

**Pruebas:** `npx vitest run <archivo>` desde esa ruta (tiene `.env.local`; nunca leerlo ni imprimirlo).
**Mutation-testing obligatorio** (CLAUDE.md): romper la línea protegida, confirmar que la prueba falla
por la razón correcta (mensaje exacto), restaurar; documentar en el encabezado de la prueba solo las
mutaciones corridas.

**Sin dev server en subagentes.** La verificación en el navegador la hace el controlador.

**Commits:** `git -c user.name="Daniel" -c user.email="268727888+dann1103-eng@users.noreply.github.com" commit -F <archivo>`
(mensaje en un archivo del scratchpad, para que el shell no toque backticks), en español, trailer
`Co-Authored-By:` al final. `npx tsc --noEmit` y `npx eslint <archivos tocados>` limpios antes de cada
commit.

**Estilo:** comentarios e identificadores en español, con el POR QUÉ y el caso real. Los textos que ve el
CLIENTE FINAL van en **tuteo** (registro y portal, decisión del 2026-09-08); el panel del dueño vosea.

**Google (CLAUDE.md):** no crear clases de QA contra el emisor real (no se pueden borrar); toda imagen
que dependa de datos cambiantes lleva `?v=`; un cambio de logo es de la CLASE.

---

## Tarea 1 — Detección de plataforma y botones de Wallet compartidos

**Spec:** §1, "Detección" y "Pantalla de éxito del registro".

**Archivos:**
- Crear: `lib/clientes/plataforma.ts` — `detectarPlataforma(userAgent): 'ios' | 'android' | 'otra'`, y
  una función pura `botonesWallet({ plataforma, googleDisponible, mostrarOtro })` que devuelve qué
  botones se ven y si se ofrece el link "¿Tienes otro teléfono?" (reglas de la spec: ios → Apple;
  android → Google si disponible, si no Apple sin link; otra → los dos; `mostrarOtro` → los dos).
- Crear: `lib/clientes/plataforma.test.ts`.
- Crear: `app/_ui/BotonesWallet.tsx` ('use client') — dibuja los botones (clases `wallet-btn` y los
  íconos que hoy viven en `RegistroCliente.tsx`, movidos acá) según `botonesWallet`, con el estado
  `mostrarOtro` y el link en tuteo. Props: `plataforma`, `urlApple`, `urlGoogle | null`, `textoApple`
  (el registro dice "Agregar a Apple Wallet"; el portal "Descargar mi pass de nuevo") y su par de Google.
- Modificar: `app/registro/[comercioSlug]/RegistroCliente.tsx` — usar `BotonesWallet` en la pantalla de
  éxito; prop nueva `plataforma`; la nota de Safari cada vez que el botón de Apple está a la vista en
  `ios` u `otra` (no en `android`; spec); el texto del formulario "Directo en tu …" según la
  plataforma (spec). Los íconos se mueven al componente compartido.
- Modificar: las dos páginas de registro — leer `(await headers()).get('user-agent')`, pasar
  `plataforma={detectarPlataforma(ua)}`.

- [ ] **Paso 1 (rojo):** pruebas de `detectarPlataforma` con user agents REALES (copiarlos completos en
  la prueba): Safari iPhone, Chrome iPhone (`CriOS`), navegador interno de WhatsApp e Instagram en
  iPhone, Chrome Android, Samsung Internet, navegador interno de Instagram en Android, un iPad VIEJO
  (iOS 12, el UA dice `iPad`) → `'ios'`, iPad con iPadOS 13+ (dice `Macintosh`) → `'otra'`, Chrome Windows, Safari Mac, `''` y `null`. Y de `botonesWallet`: las
  combinaciones de plataforma × google disponible × mostrarOtro (incluido "android sin Google → solo
  Apple, sin link").
- [ ] **Paso 2:** implementar. Verde.
- [ ] **Paso 3: mutaciones** (confirmar y documentar): quitar `iPad` de la regex iOS (cae el iPad viejo);
  quitar `iPhone` (caen los de iPhone); en `botonesWallet`, android sin Google mostrando el link (cae
  esa fila); `otra` mostrando un solo botón (cae).
- [ ] **Paso 4:** tsc + eslint. Commit.
- [ ] **Paso 5 (controlador):** con el dev server (antes, confirmar que `cafe-aurora-demo` NO tiene la
  reseña de Google activa: si la tuviera, el HTML del servidor es el paso de reseña y no el formulario), `curl -A "<UA iPhone>"`, `-A "<UA Android>"` y sin UA
  a `http://localhost:3000/registro/cafe-aurora-demo` → el texto "Directo en tu …" correcto en cada
  caso (el HTML del formulario sale del servidor). La pantalla de éxito se ve en la Tarea 6.

---

## Tarea 2 — Botones en el portal `/mi-tarjeta`

**Spec:** §1, "Portal `/mi-tarjeta`".

**Archivos:**
- Modificar: `lib/portal/buscarTarjetas.ts` — sumar `logo_url` al select embebido de `comercios` que ya
  hace, y devolver `googleDisponible: comercios.logo_url != null` por tarjeta (la regla de
  `linkGuardar.ts:38`; comentario que remita ahí).
- Modificar: `lib/portal/buscarTarjetas.test.ts` — la tarjeta de un comercio con logo → `true`, sin logo →
  `false` (el fixture de comercio permite setear `logo_url`).
- Modificar: `app/mi-tarjeta/page.tsx` — leer el user agent y pasar `plataforma` a `PortalCliente`.
- Modificar: `app/mi-tarjeta/PortalCliente.tsx` — reemplazar el `<a>` de "Descargar mi pass de nuevo"
  por `BotonesWallet` con la URL de Apple y, si `googleDisponible`, la de Google
  (`/api/tarjetas/<id>/google-wallet`). Textos en tuteo.

- [ ] **Paso 1 (rojo):** las pruebas de `googleDisponible`, incluido el caso que motiva la regla: un
  comercio SIN logo cuyo programa principal tiene logo propio (`branding_propio` + `logo_url`, por update
  sobre el programa que crea el fixture) → `false`.
- [ ] **Paso 2:** implementar. Verde. tsc + eslint.
- [ ] **Paso 3: mutación:** `googleDisponible` desde el logo efectivo del PROGRAMA en vez del comercio
  (cae el caso de arriba). Confirmar.
- [ ] **Paso 4:** commit.

---

## Tarea 3 — El logo entero en el cartel

**Spec:** §2, "Cartel del QR".

**Archivos:**
- Crear: una función pura para la caja del logo (p. ej. `lib/comercio/cartel/cajaLogo.ts` + prueba):
  entra `lado` reservado, ancho máximo de la combinación y las medidas del logo (o `null`); sale ancho y
  alto de la caja. Alto = `lado` siempre; ancho = `lado × proporción`, acotado al máximo; sin medidas o
  en `split × sticker` → cuadrada.
- Modificar: `lib/comercio/cartel/resolverDatosCartel.ts` — pasar `logoAncho`/`logoAlto` de `bajarImagen`
  (hoy se descartan, ~174-188); `null` si no se pudo medir.
- Modificar: `lib/comercio/cartel/plantillas.ts` — `logoSvg` (~56, exportada ~252) usa la caja y
  `preserveAspectRatio="xMidYMid meet"`; en cada combinación, centrar la caja donde hoy va el cuadrado
  sin mover nada de lo de abajo. Leer las seis combinaciones (`centrado`/`split`/`foto` × `sticker`/
  `mostrador`) y fijar el ancho máximo de cada una para que la caja no se salga del lienzo.
- Modificar: `lib/comercio/cartel/tipos.ts` — `DatosCartel` suma `medidasLogo: Medidas | null` (como
  `medidasFoto`). Fixtures a actualizar: `plantillas.test.ts` (~21-28), `export.test.ts` (~24-31),
  `test/fixtures/rasterizarSinFuentes.ts`, `resolverDatosCartel.test.ts`.
- Modificar: `lib/comercio/cartel/plantillas.test.ts`.

- [ ] **Paso 1 (rojo):** pruebas de la caja (cuadrado, circular = cuadrado, 3:1 acotado, 1:3, sin
  medidas, split×sticker siempre cuadrada) y de plantillas: el `<image>` del logo lleva `meet` (la
  prueba existente de `xMidYMid slice` es de la foto de fondo y queda igual); en las seis combinaciones
  con un logo 3:1 y uno 1:3, la caja del logo no se sale del lienzo en X (ni por la derecha NI por la
  izquierda: `x >= 0` — sin acotar, un 3:1 en `split × mostrador` se sale por la IZQUIERDA, centrado en
  64 → x = -32) ni en Y; y la Y del nombre y
  del QR no cambia respecto de un logo cuadrado.
- [ ] **Paso 2:** implementar. Verde. tsc + eslint.
- [ ] **Paso 3: mutaciones:** volver a `slice` en el logo (cae la de `meet`); no acotar el ancho (cae la de
  "no se sale en X"); en split×sticker usar la caja ancha (cae esa fila).
- [ ] **Paso 4:** commit.
- [ ] **Paso 5 (controlador, Tarea 6):** el cartel de un comercio con logo ancho en las seis combinaciones.

---

## Tarea 4 — El logo entero en la tarjeta de muestra del registro

**Spec:** §2, "Tarjeta de muestra del registro".

**Archivos:** `app/globals.css` (`.cardface-logo` y su `img`), y `RegistroCliente.tsx` si el markup
necesita un cambio mínimo.

- [ ] **Paso 1:** `.cardface-logo` pasa de círculo de 54 px con `cover` a una caja que respeta la
  proporción (alto máximo ~54 px, ancho automático hasta un máximo razonable, `object-fit: contain`, sin
  `border-radius` circular). Revisar si el fondo blanco y la sombra siguen teniendo sentido.
- [ ] **Paso 2:** tsc/eslint (si se tocó TSX). Commit. (Sin pruebas de componentes en este repo; se verifica
  en el navegador en la Tarea 6.)

---

## Tarea 5 — Logos de Google: rutas compuestas, medición y `logosDeClase`

**Spec:** §2, "Google Wallet" completa (restricción, rutas que nunca fallan, medición con caché, los tres
casos del logo ancho, un solo lugar para las URLs, `?v=`, degradación sin base URL).

**Archivos:**
- Crear: `lib/google/logosClase.ts` (o dentro de `heroUrl.ts` si queda más coherente con
  `heroUrlDeClase`) — `medidasLogo(url)` (descarga con timeout ~2 s, sharp, caché en memoria SOLO de las
  exitosas), `esLogoAncho(medidas)` (proporción ≥ 1.6), la versión (`?v=`) y `logosDeClase(comercioId,
  programaId, marca, medidas)` PURA → `{ programLogo: url, wideProgramLogo: url | null | undefined }`
  (`undefined` = omitir la clave).
- Crear: su prueba.
- Crear: `lib/google/componerLogo.ts` (componer el cuadrado 660×660 y el ancho 1280×400 con sharp) + prueba.
- `componerLogo` recibe un `Buffer` (así el respaldo de la ruta reusa los bytes ya descargados).
- Crear: `app/api/comercios/[comercioId]/logo.png/route.ts` y `.../logo-ancho.png/route.ts` — patrón de
  `franja.png` (marca efectiva por `?programa=` con scope por comercio); si componer falla, servir el
  logo original; 404 solo sin logo o programa ajeno. Comentario del porqué (Google rechaza el patch
  entero si no puede bajar una imagen de la clase).
- Modificar: `lib/google/construirRecursos.ts` — `construirClase` recibe los logos resueltos y pone
  `programLogo` y, según el caso, `wideProgramLogo` (URL / `null` / sin clave). OJO: los campos opcionales
  de ese archivo se agregan con un spread por verdad (`...(x ? {...} : {})`, ~42); escrito igual, el `null`
  se perdería en silencio. Distinguir `undefined` (omitir) de `null` (mandar).
- Base URL: medir y armar rutas compuestas SOLO si `esBaseUrlPublica(process.env.NEXT_PUBLIC_BASE_URL)`
  (`lib/google/baseUrlPublica.ts`); si no (desarrollo: `http://localhost:3000`), URL cruda y sin logo ancho
  — con un chequeo de presencia, cada sync de clase desde el dev server fallaría con 400.
- Modificar: `lib/google/syncClase.ts`, `lib/google/syncClasePrograma.ts`, `lib/google/linkGuardar.ts`
  (en este, la MISMA rama programa/comercio que la portada, ~133-141) — medir y llamar a `logosDeClase`.
- Modificar: `scripts/actualizar-frente-google.ts` para que compile con la firma nueva (sin tocar las
  fases existentes todavía; la fase `logos` es la Tarea 8).
- Modificar: las pruebas existentes que fijan `programLogo` (`construirRecursos.test.ts`,
  `syncClase.test.ts`, `syncClasePrograma.test.ts`, `linkGuardar.test.ts`), inyectando o mockeando la
  medición para no depender de la red.

- [ ] **Paso 1 (rojo):** pruebas de `logosDeClase` (URLs y `?v=`; cambia con el logo y con el color;
  ancho → URL; medido no ancho → `null`; sin medidas → clave omitida; base URL ausente Y
  `http://localhost:3000` → URL cruda y sin logo ancho; rama programa vs comercio); de `construirClase`
  (URL; `'wideProgramLogo' in clase` con valor `null`; clave ausente); a nivel sync, que el `requestBody`
  del patch lleve `wideProgramLogo === null` para un logo medido no ancho (`syncClase.test.ts` ya
  captura el `requestBody`, ~88); a nivel `linkGuardar`, que la clase del COMERCIO (sin `?programa=`)
  lleve el logo del comercio aunque el programa tenga logo propio (modelo: `linkGuardar.test.ts` ~142); de `medidasLogo` (caché: la segunda llamada no descarga; un fallo no
  se cachea; timeout → null), de `componerLogo` (medidas de salida 660×660 y 1280×400; un logo 3:1 entra
  entero en el área segura) y de las rutas (PNG y medidas; 404 sin logo y programa ajeno; con una
  composición forzada a fallar, sirve el original). En las pruebas de rutas, `fetch` se stubea para
  devolver un PNG hecho con sharp (`franja.png/route.test.ts` ~8 mockea el componedor; acá hace falta
  además el respaldo con bytes reales).
- [ ] **Paso 2:** implementar. Verde. Actualizar las pruebas existentes. tsc + eslint.
- [ ] **Paso 3: mutaciones:** omitir `wideProgramLogo` en vez de `null` para un logo no ancho (cae);
  un spread por verdad en `construirClase` (cae la de `null` en la clase y la del `requestBody`); usar un
  chequeo de presencia en vez de `esBaseUrlPublica` (cae el caso localhost);
  cachear también los fallos (cae la de "un fallo no se cachea"); `linkGuardar` usando el logo del
  programa para la clase del comercio (cae la rama); la ruta respondiendo 500 cuando falla la
  composición (cae la del original); umbral de ancho mal (p. ej. 1.2: cae un 4:3 que no debe ser ancho).
- [ ] **Paso 4:** commit.

---

## Tarea 6 — Verificación en el navegador (controlador)

- [ ] Dev server (`preview_start`, config `dev`).
- [ ] Registro de `cafe-aurora-demo` con el preset móvil del panel (UA Android) y en escritorio: textos
  del formulario; registrar un cliente de prueba y ver la pantalla de éxito (solo Google en Android + el
  link; los dos en escritorio); el link revela el otro. (En desarrollo, gracias a `esBaseUrlPublica`, la
  clase se sincroniza con el logo crudo, así que Google queda disponible.) El iPhone NO se puede emular
  en el panel: su pantalla de éxito queda cubierta solo por las pruebas de `botonesWallet`.
- [ ] Borrar el cliente de prueba A MANO con un script temporal (`scripts/limpiar-datos-prueba.ts` NO
  sirve: borra comercios de prueba por slug y protege a `cafe-aurora-demo`, ~30-32). Orden, como en ese
  script (~177-196): notificaciones y registros de Apple de la tarjeta, transacciones y canjes, la
  tarjeta, y el cliente si no le queda otra tarjeta.
- [ ] La tarjeta de muestra con un logo ancho (subir temporalmente uno o usar un comercio que ya lo tenga,
  sin tocar pilotos; restaurar).
- [ ] El cartel del comercio con logo ancho en las seis combinaciones (el editor usa la misma
  `construirCartelSvg`).
- [ ] `GET /api/comercios/<id>/logo.png` y `logo-ancho.png` de ese comercio: medidas y aspecto.
- [ ] Portal `/mi-tarjeta` con el UA Android: el botón de Google.

---

## Tarea 7 — Verificar el `null` del logo ancho contra la API real (controlador)

**Spec:** §2, "Poner y quitar el logo ancho".

- [ ] Script temporal (en `scripts/_temp-*.ts`, se borra al terminar) que, sobre la clase de Google de un
  comercio DEMO existente (no piloto, no una clase nueva): (1) `patch` con `wideProgramLogo` apuntando a
  una URL pública que ya exista (el logo del demo en el bucket); (2) `get` y confirmar que quedó; (3)
  `patch` con `wideProgramLogo: null`; (4) `get` y confirmar si se borró o si Google rechazó el patch.
  (5) Si quedó puesto (Google rechazó el `null`), restaurar con `loyaltyclass.update` usando el cuerpo
  del `get` SIN `wideProgramLogo` (`update` borra lo que no se manda; re-sincronizar NO sirve: un patch
  que omite el campo lo conserva, y desde este worktree el sync nuevo falla sin las rutas desplegadas).
  Ese `update` es además el "arreglo manual" del plan B: queda probado acá.
- [ ] Anotar el resultado acá. Si Google rechaza el `null`: aplicar el plan B de la spec (omitir para
  logos no anchos; documentar el arreglo manual del cambio ancho → cuadrado) ANTES de publicar, con su
  prueba ajustada.

---

## Tarea 8 — Publicar y re-sincronizar las clases

- [ ] Suite completa verde, `tsc --noEmit`, `npm run lint`.
- [ ] `git push origin HEAD:master`; esperar el deploy (`gh api …/commits/<sha>/status`); verificar en
  producción con `curl` que `/api/comercios/<id>/logo.png` de Pulso Café responde PNG 660×660 y
  `logo-ancho.png` 1280×400.
- [ ] Agregar a `scripts/actualizar-frente-google.ts` la fase `logos` (spec: llama a
  `syncClaseComercio`/`syncClasePrograma`, lo mismo que corre producción; SIN tocar la fase `clases` ni
  su guarda `copiaTraePlantillaDeFilas`, que protege el deploy B). Commit, y correrla primero en ensayo y
  después con `--aplicar` (con `NEXT_PUBLIC_BASE_URL=https://www.cardly-sv.site`). Anotar el resumen
  (0 fallos esperados).
- [ ] Después del deploy, tocar "Agregar a Google Wallet" para una tarjeta de un comercio demo con logo
  CUADRADO: el JWT embebe la clase con `wideProgramLogo: null`, que la Tarea 7 (REST) no probó. El
  riesgo es bajo (`balance` ya viaja con `null` dentro del JWT), pero si Google lo rechazara el botón se
  rompería para la mayoría de los comercios.
- [ ] Pushear también el commit de la fase `logos` (se hace después del primer push).
- [ ] Daniel: Android real con el pase de Pulso Café (y la cabecera con el logo ancho).
- [ ] Actualizar el ESTADO (sección 2026-09-23) y la memoria.

## Nota: convivencia con el deploy B
`claude/plantilla-filas-google` (`a2dba8e`, sin publicar) también cambia `construirClase`. Al integrarla
después de este plan, resolver el conflicto conservando los logos resueltos Y la plantilla (spec,
"Convivencia con el deploy B").

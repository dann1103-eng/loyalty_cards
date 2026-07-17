# Diseño: Portal del cliente (consulta de saldo, instalable como PWA)

**Fecha:** 2026-07-16
**Estado:** Auto-aprobado, mismas condiciones que [2026-07-16-fase3-autogestion-catalogo-design.md](2026-07-16-fase3-autogestion-catalogo-design.md) — ver esa nota de cabecera. Documento separado a propósito: superficie distinta (cara al cliente final, sin contraseña), con su propia decisión de alcance sobre privacidad.

## 1. Contexto y el malentendido que vale la pena aclarar primero

El pedido original fue "el portal de los clientes lista para descargarla como app o como convenga." En este sistema, **ese "descargar como app" ya existe y ya funciona**: agregar la tarjeta a Apple Wallet (o Google, cuando se retome) ES la experiencia de "instalar la app" — el pass vive en la pantalla de bloqueo, se actualiza solo, no requiere abrir nada. Eso es Fase 0/1, completo y en producción.

Lo que **no existe todavía** es una forma de que el cliente consulte su estado (saldo de puntos/sellos, recompensas disponibles) **sin** tener el pass a la mano o fuera de la pantalla de Wallet — por ejemplo, desde una computadora, o para revisar qué puede canjear antes de ir al comercio. Eso es lo que este documento diseña: una vista web ligera, instalable (PWA — ícono en la pantalla de inicio, no una "app" nativa de tienda), que complementa al pass, no lo reemplaza.

## 2. Alcance

- Página `/mi-tarjeta` (o similar): el cliente ingresa su **número de teléfono**, ve su(s) tarjeta(s) — si tiene una en varios comercios, elige cuál — y para la elegida: saldo de puntos o grilla de sellos (con los mismos colores/ícono que su pass real), lista de recompensas disponibles (informativa: qué puede canjear y cuánto le falta), y un botón para volver a descargar el pass (reutiliza el endpoint de descarga ya existente).
- **Solo lectura.** El canje real sigue pasando por el cajero físico escaneando el pass — este portal no vende ni canjea nada por sí mismo. Evita construir un segundo camino de canje con sus propios riesgos de seguridad/duplicidad, cuando el existente (cajero escanea) ya funciona.
- Instalable: `manifest` (ícono, nombre, color de tema) para que el navegador ofrezca "agregar a pantalla de inicio." Sin service worker en esta primera versión — no hay necesidad de soporte offline para una consulta de saldo, y añadir uno sin necesitarlo sería la complejidad prematura que este proyecto evita a propósito.

## 3. Identidad: por qué SOLO teléfono, sin código de verificación — Y por qué SÍ lleva límite de intentos

**Corrección tras revisión (2026-07-16):** la primera versión de este documento justificaba saltarse toda protección comparando este portal con `/api/tarjetas/[id]/puntos`. Esa comparación **era falsa en dos sentidos** y se retira: (a) ese endpoint se identifica con un UUID de 122 bits — imposible de adivinar — mientras que un teléfono local salvadoreño son 8 dígitos (spec MVP §4/§12), un espacio de búsqueda millones de veces menor y a menudo consecutivo; (b) cité que era "una decisión de la Fase 0, documentada en el código" — **no existe tal comentario en el código**, y el spec original en realidad dice lo contrario: ese endpoint sin auth es deuda técnica temporal que "debe ganar autenticación de cajero antes de cualquier uso real" (spec MVP §12). Cité mal un precedente que apunta en la dirección opuesta a la que yo afirmaba.

**Decisión correcta, más angosta:** SÍ se pide solo teléfono, sin código SMS — pero **con límite de intentos**, no sin ninguna protección.

Por qué solo teléfono (sin SMS):
1. Es el modelo de identidad ya existente (`clientes.telefono`), no una barra más baja que el resto del sistema.
2. Lo expuesto (saldo, recompensas) no es financiero ni de pago.
3. Un código por SMS requeriría contratar un servicio de terceros (Twilio o similar) — una decisión de gasto recurrente que no me corresponde tomar sin aprobación explícita, incluso con autonomía total para diseño.

Por qué NO alcanza con "solo teléfono, sin nada más": `createServiceClient()` ignora RLS por completo y `clientes` no tiene `comercio_id` — una sola consulta por teléfono cruza **todos** los comercios a la vez (más alcance que el que tiene un dueño de comercio autenticado sobre su propio negocio). Sin límite de intentos, alguien podría iterar un rango de teléfonos y aprender, por número: si es cliente real, en qué comercios, su saldo y su nombre. El dato en sí es de bajo riesgo; la **enumeración masiva** es el riesgo real, y es evitable sin gastar en nada nuevo.

**Mitigación (gratuita, sin servicios de terceros):** tabla nueva `intentos_consulta_portal(id, ip, created_at)`. Antes de cada consulta, contar intentos de esa IP en los últimos 15 minutos; más de 10 → responder "Demasiados intentos, intenta de nuevo más tarde" sin tocar `clientes`. Esto exige que el lookup sea una **ruta API** (`app/api/portal/consulta/route.ts`), no un Server Action puro, porque una ruta API sí tiene acceso directo a las cabeceras de la petición (`x-forwarded-for` / `x-real-ip`) para identificar la IP — un Server Action no lo expone igual de directo.

No se pretende resolver la existencia-o-no de un teléfono en una sola consulta (eso es inherente a que la herramienta sirva para algo); lo que el límite de intentos evita es que alguien raspe el sistema completo, número por número.

Si en el futuro se decide que hace falta más fricción, la mejora natural es SMS/OTP — sigue anotado como el siguiente paso obvio, no descartado para siempre.

## 4. Implementación

- **Ruta API** `app/api/portal/consulta/route.ts` (POST, no Server Action — ver §3 sobre por qué hace falta acceso a la IP). Recibe el teléfono, aplica el límite de intentos, busca en `clientes` por `telefono`, y devuelve las `tarjetas` asociadas con su comercio (nombre, colores, tipo de tarjeta, saldo) y las `recompensas` activas de cada comercio. Usa `createServiceClient()`.
- Página cliente (`'use client'`) con un formulario simple de teléfono → resultado, consumiendo esa ruta.
- `app/manifest.ts` (soportado nativamente por Next.js: `MetadataRoute.Manifest`) + **íconos reales de 192×192 y 512×512 en `public/`** (hoy `public/` solo tiene los SVG de arranque de Next — no sirven para esto, hace falta generarlos/exportarlos del branding genérico de FM).
- **Honestidad sobre iOS, ya que todos los clientes reales están en iPhone:** Safari **no ofrece** proactivamente "agregar a inicio" — es una acción manual desde el botón de Compartir. El ícono de inicio en iOS no sale del `manifest`, sale de una etiqueta `<link rel="apple-touch-icon">` (y metadata `appleWebApp`) que hay que agregar al layout de esta ruta — el layout raíz hoy (`app/layout.tsx`) no la tiene. El copy de la página debe decir "agrégala desde Compartir → Agregar a inicio", no insinuar que el navegador la va a ofrecer solo.

## 5. Explícitamente fuera de alcance

- Verificación por SMS/OTP (ver §3) — el límite de intentos por IP es la mitigación de esta fase, no un sustituto que se declare "suficiente para siempre."
- Canje/redención desde el portal — sigue siendo exclusivo del cajero físico.
- Service worker / soporte offline.
- Notificaciones push desde este portal (Cardly las ofrece; quedaría ligado a Web Push, otra integración nueva — no se arma sin aprobación).
- Cuenta con contraseña para el cliente — sigue sin existir, a propósito.
- Limpieza automática de `intentos_consulta_portal` (crecerá lento; una tarea de limpieza periódica es una mejora futura, no bloqueante para el MVP).

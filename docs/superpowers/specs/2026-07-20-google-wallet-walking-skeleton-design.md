# Diseño: Google Wallet — walking skeleton (Fase 5)

**Fecha:** 2026-07-20
**Estado:** Borrador para revisión del usuario antes de escribir el plan de implementación.
**Fuentes:** verificado contra la documentación oficial vigente de Google (developers.google.com/wallet)
y el repo `google-wallet/rest-samples` el 2026-07-20 — **no de memoria de entrenamiento**, a propósito
(la API pudo cambiar desde el corte de conocimiento). Cada afirmación técnica de este documento tiene
una fuente citada al pie.

## 1. Contexto

El proyecto ya tiene Apple Wallet completo en producción (Fases 0-4). Google Wallet quedó pausado desde
el diseño original — las columnas `comercios.google_class_id` y `tarjetas.google_object_id` se dejaron
preparadas en el esquema desde el día 1, pero nunca se construyó nada encima.

Mismo enfoque que funcionó para Apple: **walking skeleton primero** — un flujo end-to-end real y
angosto (un comercio, un cliente, agregar el pass, ver el saldo actualizarse) antes de construir
paridad completa con lo que ya existe para Apple.

## 2. Diferencias clave con Apple (esto cambia el diseño, no es un detalle menor)

Verificadas contra la documentación oficial hoy, no asumidas por analogía con Apple:

1. **No hay protocolo de push ni registro de dispositivo.** Apple exige que el dispositivo se
   "registre" (`apple_push_registrations`) y que un push APNs le avise "algo cambió" para que el
   dispositivo vuelva a pedir el pass. Google Wallet es más simple: el servidor llama directo
   `loyaltyobject.patch()` sobre el objeto por su ID, y Google Wallet sincroniza el cambio al
   dispositivo del usuario **sin ningún paso intermedio**. No hace falta una tabla equivalente a
   `apple_push_registrations`, ni un servicio de push propio.
   [Fuente: JWT/REST samples, google-wallet/rest-samples/nodejs/demo-loyalty.js]

2. **El branding vive en la CLASE, no en el objeto — actualizarlo es UNA llamada, no un loop.**
   Para Apple, `notificarCambioComercio()` recorre cada `tarjeta` del comercio y empuja un push por
   una. Para Google, los colores/logo/nombre del programa viven en `LoyaltyClass`
   (`comercios.google_class_id`); un solo `loyaltyclass.patch()` actualiza la vista de **todos** los
   cardholders de ese comercio a la vez. Más simple y más barato que el equivalente de Apple.

3. **RESTRICCIÓN REAL: no hay forma de reproducir la grilla de sellos visual que construimos para
   Apple.** El campo `heroImage` (la imagen de fondo/banner) existe a nivel de **`LoyaltyClass`**
   — no a nivel de `LoyaltyObject`. Como el progreso de sellos es por-cliente (7 de 10, 3 de 10...),
   y `heroImage` es la MISMA imagen para todos los cardholders de un comercio, **no se puede
   componer una imagen distinta por cliente** como hace `lib/apple/stripPass.tsx` con next/og.
   Para Google, sellos se muestra con el campo estructurado `loyaltyPoints` (texto/número, ej.
   `"7 de 10 sellos"`) — el mismo enfoque de puro texto que usamos para Apple ANTES del pulido
   visual reciente. Esto va en el documento como restricción de la plataforma, no como algo que
   "falta implementar": Google Wallet simplemente no ofrece ese gancho.
   [Fuente: developers.google.com/wallet/retail/loyalty-cards/rest/v1/loyaltyobject — heroImage no
   aparece entre los campos de LoyaltyObject, solo entre los de LoyaltyClass]

4. **La firma es JWT (RS256), no PKCS#7.** Apple firma el `.pkpass` completo con un certificado
   X.509 (`passkit-generator`). Google firma un JWT con la clave privada de una **cuenta de
   servicio de Google Cloud** (algoritmo RS256, librería `jsonwebtoken`). El JWT firmado se pega al
   final de una URL fija: `https://pay.google.com/gp/v/save/{token}` — ese es el botón
   "Agregar a Google Wallet".
   [Fuente: developers.google.com/wallet/retail/loyalty-cards/use-cases/jwt]

5. **Actualizar SÍ requiere que el objeto ya exista del lado de Google** — igual que Apple exige
   que el dispositivo se haya registrado antes de poder recibir push. La diferencia: para Google,
   nosotros mismos creamos el objeto vía REST (`loyaltyobject.insert()`) en el momento del
   registro del cliente — no dependemos de que el usuario complete el flujo de guardado primero.
   Así, `accreditarPuntos`/`canjearRecompensa`/cambios de branding pueden llamar `patch()` en
   cualquier momento después del registro, sin ambigüedad de "¿ya se guardó el pass o no?" — mismo
   patrón que usa `app/api/registro/route.ts` con `apple_serial_number`/`apple_auth_token` hoy
   (se inicializan siempre, no solo cuando el dispositivo efectivamente agrega el pass).

## 3. Modo demo vs. acceso de publicación — corrección a una nota vieja del proyecto

Una memoria de este proyecto (2026-07-09) decía "el perfil de emisor de Google Wallet aún debe
pedirse/aprobarse (tarda unos días)". Verificado hoy contra la documentación oficial: **crear la
cuenta de Emisor es autoservicio inmediato** (formulario + aceptar términos, sin aprobación de
Google de por medio) — la nota vieja probablemente confundía esto con el paso siguiente.

Lo que SÍ tiene una capa extra es la **"publicación"**: toda cuenta nueva arranca en **modo demo**,
donde los passes creados **solo pueden agregarse a la wallet de cuentas con rol Admin/Developer en
el proyecto, o cuentas agregadas a mano como "cuenta de prueba"**. Para que un cliente cualquiera
(no vos) pueda agregar el pass, hay que pedir "acceso de publicación" desde el Google Wallet API
Dashboard — la documentación no detalla ese trámite ni su duración.
[Fuente: developers.google.com/wallet/retail/loyalty-cards/getting-started/issuer-onboarding]

**Consecuencia para el walking skeleton: podemos construir y probar TODO de punta a punta ahora
mismo, en modo demo, con tu propia cuenta de Google** (que automáticamente tiene rol Admin sobre
el Issuer que crees) — exactamente como probamos Apple Wallet primero en tu iPhone real antes de
abrirlo a clientes. Pedir acceso de publicación es un paso aparte, en paralelo, no bloqueante para
empezar.

## 4. Arquitectura propuesta

- **`comercios.google_class_id`** (ya existe): el ID de la `LoyaltyClass` de ese comercio —
  branding, nombre del programa. Se crea (o actualiza) una vez por comercio, en el mismo momento
  en que hoy se genera el pass de Apple por primera vez, o al guardar branding.
- **`tarjetas.google_object_id`** (ya existe): el ID del `LoyaltyObject` de esa tarjeta — saldo,
  vinculado a la clase del comercio. Se crea en `app/api/registro/route.ts`, en el mismo paso
  donde hoy se inicializa `apple_serial_number`.
- **`lib/google/`** (nuevo, espejo de `lib/apple/`):
  - `walletClient.ts` — cliente autenticado (`googleapis` + cuenta de servicio), análogo a
    `cargarCertificados()` de `generatePass.ts`.
  - `syncClase.ts` — crea o actualiza (`patch`) la `LoyaltyClass` de un comercio a partir de sus
    datos de branding. Reemplaza al loop de `notificarCambioComercio` para el lado Google: una
    sola llamada.
  - `syncObjeto.ts` — crea (`insert`) o actualiza (`patch`) el `LoyaltyObject` de una tarjeta:
    saldo actual, texto de sellos si aplica.
  - `jwtGuardar.ts` — arma y firma el JWT que produce el link "Agregar a Google Wallet".
- **Server actions/endpoints existentes que ya tocan Apple, extendidos** (no duplicados): el
  registro público, `accreditarPuntos`, `canjearRecompensa`, y el guardado de branding
  (FM y dueño) llaman también al equivalente Google, con el mismo criterio "best-effort, nunca
  rompe el flujo principal" que ya usa `notificarCambioTarjeta` para Apple (si Google Wallet falla,
  se loguea y se sigue — el cliente ya tiene su pass de Apple funcionando).
- **Botón "Agregar a Google Wallet"** junto al de Apple en `/registro/[comercioSlug]` — visible
  solo si `comercio.google_class_id` existe (permite lanzar comercio por comercio, no todo o nada).

## 5. Variables de entorno nuevas (mismo patrón que las de Apple: nunca en el chat)

Análogas a `APPLE_WWDR_B64`/`APPLE_SIGNER_CERT_B64`: la clave de la cuenta de servicio de Google
Cloud es un JSON completo — se guarda en base64 en una sola variable, igual que los certs de Apple.

- `GOOGLE_WALLET_ISSUER_ID` — el ID numérico del Emisor (Google Pay & Wallet Console).
- `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_B64` — el archivo JSON de la cuenta de servicio, en base64.
- (`NEXT_PUBLIC_BASE_URL` ya existe, se reutiliza si Google necesita alguna URL pública.)

## 6. Prerrequisitos — lo que el usuario hace antes de que se pueda escribir código real

Pasos verificados contra la documentación oficial de hoy:

1. **Crear la cuenta de Emisor** en la [Google Pay & Wallet Console](https://pay.google.com/business/console/):
   entrar con la cuenta de Google que va a ser Admin, completar el nombre público del negocio,
   aceptar los Términos de Servicio adicionales de Google Wallet API + la política de privacidad.
2. En el dashboard, **"Create a pass"** dentro de la tarjeta "Google Wallet API" → **"Build your
   first pass"** → aceptar los Términos de Servicio de Google Wallet API. Esto termina de crear la
   cuenta de Emisor y da acceso al **Google Wallet API Dashboard**. Anotar el **Issuer ID**
   numérico que aparece ahí.
3. **Crear un proyecto de Google Cloud** (si no tenés uno ya) y **habilitar "Google Wallet API"**
   en la consola de Google Cloud (necesario para usar la API REST, aparte de la cuenta de Emisor).
4. **Crear una cuenta de servicio** en ese proyecto de Google Cloud (IAM & Admin → Service
   Accounts), generar una **clave JSON** y descargarla. Esa cuenta de servicio necesita permiso
   sobre tu cuenta de Emisor: en el Google Wallet API Dashboard hay una sección para agregar el
   email de la cuenta de servicio con rol de acceso a la API.
5. Guardá el archivo JSON descargado en un lugar seguro **de tu compu** (no lo pegues en el chat).
   Cuando llegue el momento de configurar las variables de entorno, yo te doy el comando exacto
   para convertirlo a base64 en tu terminal — mismo mecanismo que ya usaste con los certificados
   de Apple.

**No hace falta esperar "aprobación" para arrancar** (§3) — con el Issuer ID + la cuenta de
servicio ya se puede construir y probar todo en modo demo, con tu propia cuenta.

## 7. Explícitamente fuera de alcance (este walking skeleton)

- **Grilla visual de sellos por cliente** — restricción de la plataforma (§2.3), no una tarea
  pendiente. Sellos se muestra como texto (`"7 de 10 sellos"`).
- **Acceso de publicación / clientes reales no-admin** — se pide en paralelo (§3), no bloquea el
  desarrollo, pero el lanzamiento a clientes reales de un comercio específico espera a que esté
  aprobado.
- **Multi-issuer / cuentas de servicio por comercio** — un solo Emisor de FM para todos los
  comercios, igual que Apple usa un solo Pass Type ID para todos (diferenciados por contenido).
- **Ofertas, gift cards, boarding passes** — Google Wallet tiene tipos de pass separados para cada
  uno; este documento cubre solo `LoyaltyClass`/`LoyaltyObject` (el equivalente a nuestras tarjetas
  de puntos/sellos).
- **Migración de clientes ya registrados en Apple** — cada cliente decide agregar el pass de
  Google si quiere; no hay conversión automática de un wallet a otro.

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

## 3. Identidad: por qué SOLO teléfono, sin código de verificación

**Decisión deliberada, no un descuido:** este portal identifica al cliente pidiendo únicamente su número de teléfono, sin enviar un código de verificación por SMS.

Razones:
1. **Ya es el modelo de identidad de todo el sistema.** `clientes.telefono` es la clave de identidad global desde la Fase 0 (una persona, un registro, aunque tenga tarjetas en varios comercios) — no se está bajando la barra de seguridad respecto al resto del proyecto.
2. **Lo que se expone es de bajo riesgo real:** saldo de puntos/sellos y una lista de recompensas. No hay datos de pago, dirección, ni nada financiero — es el mismo nivel de sensibilidad que ya tiene `/api/tarjetas/[id]/puntos`, que este mismo proyecto decidió dejar sin autenticar en esta fase (decisión de la Fase 0, documentada en el código).
3. **Un código por SMS requeriría contratar un servicio de terceros** (Twilio o equivalente) que este proyecto no tiene configurado. Es una decisión de gasto recurrente y una integración nueva — **no me corresponde comprometer ese gasto en nombre del usuario sin su aprobación explícita**, incluso bajo la instrucción de continuar con autonomía total. Autonomía para tomar decisiones de diseño y alcance no es lo mismo que autorización para contratar un servicio pago nuevo.

Si en el futuro se decide que hace falta más fricción/seguridad aquí, la mejora natural es agregar verificación por SMS — queda anotado como el siguiente paso obvio, no descartado para siempre.

## 4. Implementación

- Server Action (o ruta API) que recibe el teléfono, busca en `clientes` por `telefono`, y devuelve las `tarjetas` asociadas con su comercio (nombre, colores, tipo de tarjeta, saldo) y las `recompensas` activas de cada comercio. Usa `createServiceClient()` — el mismo patrón de autorización a nivel de aplicación que el resto del proyecto (aquí "autorización" es, deliberadamente, mínima: solo saber el teléfono).
- Página cliente (`'use client'`) con un formulario simple de teléfono → resultado.
- `app/manifest.ts` (soportado nativamente por Next.js) + íconos en `public/`.

## 5. Explícitamente fuera de alcance

- Verificación por SMS/OTP (ver §3).
- Canje/redención desde el portal — sigue siendo exclusivo del cajero físico.
- Service worker / soporte offline.
- Notificaciones push desde este portal (Cardly las ofrece; quedaría ligado a Web Push, otra integración nueva — no se arma sin aprobación).
- Cuenta con contraseña para el cliente — sigue sin existir, a propósito.

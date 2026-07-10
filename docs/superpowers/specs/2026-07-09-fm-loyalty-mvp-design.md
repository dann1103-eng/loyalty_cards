# Diseño: MVP de tarjetas de lealtad en Apple/Google Wallet (FM Communications Solutions)

**Fecha:** 2026-07-09
**Estado:** Aprobado por el usuario para pasar a plan de implementación

## 1. Contexto

FM Communications Solutions ofrece un servicio de cliente frecuente a sus comercios clientes: el cliente final escanea un QR físico en la tienda, se registra con nombre y teléfono, y recibe una tarjeta de puntos virtual que guarda en Apple Wallet o Google Wallet. En cada compra, el cajero escanea el QR de la tarjeta y el sistema suma puntos. El saldo se actualiza solo vía notificación push. No se imprime nada ni se instala ninguna app del lado del cliente.

FM opera como **plataforma multi-comercio**: firma y emite las tarjetas de todos sus comercios con una sola cuenta de Apple y una de Google (modelo similar a PassKit.com o LoopyLoyalty), en vez de que cada comercio tenga su propia cuenta de desarrollador. El costo fijo es US$99/año de Apple Developer Program (ya inscrito y pagado) más el desarrollo; cada comercio nuevo no agrega costo de licencia.

**Stack:** Next.js + Supabase, `passkit-generator` para los passes de Apple, API REST de Google Wallet.

## 2. Objetivo del MVP

Tener **un comercio piloto (cafetería) funcionando de punta a punta**: un cliente real se registra, guarda su tarjeta en su wallet, el cajero le suma puntos en cada compra, y el cliente puede canjear premios que el propio comercio configuró. La base de datos se diseña multi-comercio desde el día 1 (no cuesta más), pero el alta de comercios nuevos en el MVP es manual (por FM), no self-service.

## 3. Actores y roles

- **Cliente final** — pasivo. No tiene login ni app. Solo ve la tarjeta en su wallet (saldo al frente, posiblemente promos al reverso en una fase futura).
- **Comercio** — dos roles bajo un mismo login (Supabase Auth), en la misma PWA:
  - **owner** — configura la regla de puntos (crear, editar) y el catálogo de recompensas (crear, editar, desactivar).
  - **cajero** — escanea el QR del cliente, suma puntos, procesa canjes.
  - En el piloto, es probable que ambos roles sean la misma persona, pero se modelan por separado desde el inicio.
- **FM (plataforma)** — dueño de la cuenta Apple Developer y del issuer de Google Wallet. Da de alta comercios nuevos manualmente (script / Supabase Studio directo). **No se construye UI de auto-registro de comercios en este MVP.**

## 4. Modelo de datos (Supabase / Postgres)

| Tabla | Campos clave | Notas |
|---|---|---|
| `comercios` | `id`, `nombre`, `slug`, `branding` (colores hex, logo_url, strip/hero art url), `google_class_id` | El **Pass Type ID y certificado de Apple son globales** (una sola identidad de firma para todos los comercios); lo que varía por comercio es el contenido/branding del pass, no la credencial. Google sí requiere una "class" distinta por comercio (ver §6). |
| `usuarios_comercio` | `id`, `comercio_id`, `email`, `rol` (`owner`\|`cajero`), `auth_user_id` (FK a Supabase Auth) | Login con Supabase Auth; RLS restringe cada usuario a su `comercio_id`. |
| `clientes` | `id`, `nombre`, `telefono` (único global), `created_at` | Un cliente = una persona; puede tener tarjetas en varios comercios de FM. El teléfono se almacena SIEMPRE normalizado al formato canónico `+<código de país><dígitos>` (normalización server-side; números locales de 8 dígitos asumen +503). |
| `tarjetas` | `id`, `cliente_id`, `comercio_id`, `puntos_actuales`, `qr_token` (único, secreto), `apple_serial_number`, `google_object_id`, `created_at` | Une cliente+comercio. El QR del pass codifica `qr_token`. Único por (`cliente_id`, `comercio_id`). |
| `reglas_puntos` | `id`, `comercio_id`, `tipo` (`por_visita`\|`por_monto`), `valor`, `activa_desde` | Configurable por el owner. La regla vigente es la de `activa_desde` más reciente; editar la regla **inserta una fila nueva** en vez de mutar la anterior, para no alterar cómo se explican las transacciones pasadas. Fórmula: para `por_monto`, `valor` = puntos otorgados por cada unidad de moneda gastada (ej. `valor=1` → 1 punto por cada $1 de `monto_compra`; cálculo `floor(monto_compra * valor)`); para `por_visita`, `valor` = puntos fijos por transacción. |
| `recompensas` | `id`, `comercio_id`, `nombre`, `descripcion`, `foto_url`, `costo_puntos`, `tipo` (`codigo_descuento`\|`articulo_gratis`\|`otro`), `valor` (ej. el código), `activa` (bool) | CRUD del owner (crear, editar, desactivar), con subida de foto a Supabase Storage. "Eliminar" en la UI es un **soft-delete** (`activa = false`): la fila nunca se borra físicamente porque `canjes` referencia `recompensa_id` para el historial de redenciones. |
| `transacciones_puntos` | `id`, `tarjeta_id`, `cajero_usuario_id`, `puntos_delta`, `monto_compra` (nullable), `created_at` | Historial de sumas de puntos. |
| `canjes` | `id`, `tarjeta_id`, `recompensa_id`, `cajero_usuario_id`, `puntos_gastados`, `created_at`, `estado` (`completado`) | Historial de redenciones. En el MVP el flujo es síncrono y solo produce `completado`; el campo queda listo para estados futuros (ej. `cancelado`). |

**Resolución de identidad:** al registrar, primero se busca `cliente` por `telefono` a nivel global (se crea si no existe), y luego se busca/crea la `tarjeta` para el par (`cliente_id`, `comercio_id`) correspondiente. Esto es lo que permite que la misma persona tenga tarjetas en varios comercios de FM sin duplicar su registro de cliente — relevante si/cuando se da de alta un segundo comercio piloto (§10 Fase 5 contempla 1–2 cafeterías).

Row Level Security (RLS) de Supabase restringe cada tabla con `comercio_id` (tarjetas, transacciones, canjes, reglas, recompensas, usuarios_comercio) a su propio comercio. **Excepción:** `clientes` no tiene `comercio_id` — es global por diseño — así que el paso de buscar/crear `cliente` por teléfono corre por una vía que no está sujeta a esa restricción por comercio (de lo contrario se rompería la búsqueda cross-comercio de clientes recurrentes).

## 5. Componentes

1. **Landing de registro** (`/registro/[comercio_slug]`) — pública. Formulario nombre + teléfono → busca o crea el `cliente` por teléfono (a nivel global) → busca o crea la `tarjeta` para ese `cliente` en este `comercio` → genera el pass firmado con el branding del comercio → muestra botones "Add to Apple Wallet" / "Guardar en Google Wallet".
2. **Servicio de generación de pass** — construye el `.pkpass` firmado (passkit-generator) y/o el objeto de Google Wallet (REST API) con los datos de la tarjeta y el branding del comercio.
3. **Backend de puntos y canjes** — API routes (Next.js): crear tarjeta, sumar puntos, listar recompensas elegibles para una tarjeta, canjear una recompensa, consultar historial.
4. **PWA de comercio** — un solo codebase, rutas protegidas por rol:
   - **Vista cajero:** escanear QR con la cámara del teléfono (ej. librería `html5-qrcode` o equivalente), ver cliente + saldo, sumar puntos (pide monto si la regla es `por_monto`), ver recompensas disponibles y canjear.
   - **Vista owner:** CRUD de la regla de puntos (tipo + valor) y CRUD del catálogo de recompensas (nombre, descripción, foto, costo en puntos, tipo). "Eliminar" una recompensa es un soft-delete (`activa = false`); nunca se borra físicamente porque `canjes` guarda el historial de redenciones. La gestión de logins adicionales (`usuarios_comercio`, ej. dar de alta a otro cajero) es manual vía FM/Supabase Studio en el MVP, igual que el alta de comercios — no hay UI de autogestión de usuarios.
5. **Servicio de actualización push** — dispara cada vez que cambian los puntos de una tarjeta (suma o canje):
   - **Apple:** requiere implementar el protocolo **PassKit Web Service** de Apple (registro/desregistro de dispositivo, endpoint de "passes actualizados", endpoint de "última versión del pass") + envío de push vía APNs. Esto es un requisito del protocolo, no una llamada de API simple.
   - **Google:** más directo — un `PATCH` al objeto vía la API REST actualiza el pass sin necesidad de un protocolo de registro de dispositivo.

## 6. Notas técnicas: Apple vs. Google

- **Apple:** una cuenta, un Pass Type ID, un certificado — compartido por todos los comercios. Los comercios se diferencian solo por el contenido del pass (nombre, colores, logo, arte). El certificado del Pass Type ID expira anualmente y debe renovarse (alerta administrativa a futuro).
- **Google:** el modelo de Google Wallet es Issuer → Class → Object. Un solo Issuer (FM), pero **cada comercio necesita su propia "Class"** (es la plantilla/branding), y cada cliente tiene un "Object" (su tarjeta individual) bajo la Class de su comercio.

## 7. Flujos clave

**Registro:**
QR físico (codifica `comercio_slug`) → landing `/registro/[slug]` → formulario → busca o crea `cliente` por teléfono (global) → busca o crea `tarjeta` para (`cliente`, comercio), con `qr_token` nuevo si es la primera vez → genera pass firmado con el branding del comercio → el cliente lo agrega a su wallet.

**Sumar puntos:**
Cajero autenticado abre la PWA → escanea el QR de la tarjeta → el sistema resuelve `tarjeta_id` desde `qr_token` → aplica la `regla_puntos` del comercio (si es `por_monto`, el cajero ingresa el monto de la compra) → inserta en `transacciones_puntos`, actualiza `tarjetas.puntos_actuales` → dispara actualización push → el wallet del cliente se actualiza solo.

**Canje:**
Cajero escanea el QR → ve las recompensas con `costo_puntos <= puntos_actuales` → el cliente elige una → el cajero confirma el canje → se inserta en `canjes`, se restan los puntos, se entrega el código de descuento o el artículo en persona, se dispara push.

## 8. Manejo de errores

- QR no encontrado / inválido → mensaje claro en la PWA del cajero, no debe romper el flujo.
- Falla de push (token de dispositivo expirado o inválido) → no bloquea la transacción; el punto ya quedó guardado en base de datos; se reintenta en el siguiente cambio de saldo.
- Teléfono ya registrado (en este comercio o en otro comercio de FM) → se reutiliza el `cliente` existente; solo se crea una `tarjeta` nueva si no existía ya una para ese par (`cliente`, comercio).
- Certificado de Apple por expirar → requiere monitoreo administrativo (fuera del alcance de código del MVP, pero se documenta como riesgo operativo).

## 9. Estrategia de pruebas

- Unit tests del cálculo de puntos (`por_visita` vs. `por_monto`) y de la elegibilidad de recompensas (`costo_puntos <= puntos_actuales`).
- Test de generación de pass: validar estructura y firma del `.pkpass`; mock de la API de Google Wallet.
- Prueba end-to-end del flujo registro → pass → suma de puntos → push, con un iPhone real para Apple (es la parte más frágil de simular con mocks).

## 10. Secuencia de fases (build order)

0. **Setup** — esquema completo en Supabase (todas las tablas de §4), configuración de credenciales Apple (cuenta ya pagada), solicitud del perfil de emisor de Google Wallet en paralelo (Google Cloud Console).
1. **Walking skeleton, solo Apple** — landing de registro mínima (comercio piloto fijo) → generación y firma real de `.pkpass` → botón "Add to Apple Wallet" funcionando en un iPhone real → suma de puntos vía llamada directa (sin PWA de cajero todavía) → push real actualizando el saldo. **Este es el hito que valida el mayor riesgo técnico del proyecto.**
2. **Google Wallet** — mismo flujo completo, agregando la Class del comercio piloto y el objeto por cliente.
3. **Configurabilidad real** — CRUD de regla de puntos y CRUD de catálogo de recompensas (vista owner).
4. **PWA de cajero completa** — login con rol, escáner de QR por cámara, sumar puntos y canjear, conectado a las reglas/recompensas reales del comercio piloto.
5. **Piloto en producción** — alta manual de 1–2 cafeterías reales (kit gráfico del diseñador: íconos, logo, arte principal, colores según especificaciones de Apple/Google), pruebas con clientes reales, ajustes según feedback.

## 11. Explícitamente fuera de alcance del MVP

- Panel self-service para que comercios nuevos se den de alta solos (FM lo hace manualmente para el piloto).
- Notificaciones de proximidad (avisos por cercanía al local).
- Promociones en el reverso de la tarjeta.
- Precios/planes SaaS para comercios (queda como decisión de negocio pendiente, no de este spec técnico).

## 12. Decisiones registradas

- MVP alrededor de **un comercio piloto** (cafetería), con base de datos multi-comercio desde el inicio.
- El usuario codea esto él mismo con Claude Code como copiloto.
- Apple Developer Program: inscripción Individual, ya pagada.
- Google Wallet: perfil de emisor pendiente de solicitar/aprobar.
- Reglas de puntos y catálogo de recompensas son **configurables por cada comercio** (owner) — es la pieza central del producto, no un extra.
- Secuencia de construcción: Approach B (vertical slice / walking skeleton), Apple primero por ser la parte más incierta técnicamente y por ya tener la cuenta lista.
- Identidad de cliente: `cliente` es único por teléfono a nivel **global** (una persona, un registro, aunque tenga tarjetas en varios comercios); `tarjeta` es única por (`cliente_id`, `comercio_id`).
- Borrado de recompensas: "eliminar" desde la UI del owner siempre es un soft-delete (`activa = false`); nunca se borra la fila físicamente, para no romper el historial de `canjes`.
- Normalización de teléfono: server-side antes de registrar; formato canónico `+<código de país><dígitos>`; default +503 para números locales de 8 dígitos. (Decisión agregada durante la implementación, revisión de calidad de la Tarea 5.)

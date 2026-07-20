# FM Lealtad — DESIGN.md para Google Stitch

> **Cómo usar esto (Daniel):** pegá la sección "DESIGN SYSTEM" + la pantalla que querés generar
> (de "SCREENS") como prompt en [labs.google.com/stitch](https://labs.google.com/stitch). Una
> pantalla por prompt da mejores resultados. La paleta la decide Stitch dentro de las restricciones
> de abajo — pedile 2–3 propuestas de paleta con la primera pantalla y elegí una; después fijala en
> este doc para que todas las pantallas salgan coherentes.
>
> Este doc **reemplaza** la dirección visual "cafetería" de `DESIGN.md` (raíz) para el rediseño.
> La identidad café queda como inspiración opcional, no como requisito.

---

## DESIGN SYSTEM (paste into Stitch with every screen prompt)

### Product context
FM Lealtad is a multi-merchant loyalty-card platform (El Salvador). Cards live in Apple Wallet.
Three surfaces: an **FM admin panel** (internal: manage merchants, licenses, card catalogs), a
**merchant owner panel** (self-service: card branding, points rules, rewards, clients, QR), and a
public **client registration page**. All UI copy is in **Spanish** (es-SV). Users are small-business
owners, not tech people: clarity beats cleverness.

### Atmosphere
- Register: **product / software UI** (tools that serve daily work), with a warm human touch.
- Density: **5/10** — daily-app balanced. Comfortable, never cramped, never empty-luxury.
- Variance: **5/10** — offset asymmetric where it helps scanning, predictable where users work.
- Motion: **4/10** — fluid, subtle, physical. No spectacle.
- Mood words: **confiable, cálido, artesanal-moderno, ligero, honesto.**

### Color (Stitch decides the palette within these constraints)
- Propose a palette with: 1 neutral ramp (background, surface, borders, 3 text strengths) +
  **exactly 1 accent** (saturation < 80%) + 1 danger tone + 1 success tone.
- Neutrals must be subtly tinted (choose one temperature and keep it everywhere; no warm/cool mix).
- NEVER pure black `#000000` or pure white surfaces without tint. No purple/blue neon AI look.
- Light theme (users work in daylight, on phones and modest laptops). Dark mode out of scope.
- Optional inspiration (not required): the brand's former identity was espresso/cream/caramel.

### Typography
- Sans-serif only (this is software UI). **Inter is banned.** Prefer `Geist`, `Satoshi` or
  `Outfit`; numbers and codes (points, stamps, QR tokens, phone numbers) in a mono like
  `Geist Mono` or `JetBrains Mono`.
- Hierarchy by weight + color more than by size. Body max 65ch, min 1rem. Headlines track-tight,
  scaled with `clamp()`.

### Components
- **Buttons:** one primary per view. Tactile push on active. No outer glows.
- **Cards/surfaces:** only when elevation means hierarchy; shadows tinted to background hue. For
  lists, prefer clean rows with dividers over card grids. Never nested cards, never 3-equal-cards rows.
- **Forms:** label above input, helper below, inline errors in the danger tone. Focus ring in the
  accent. Touch targets ≥ 44px.
- **Card preview ("la tarjeta"):** a wallet-card-proportioned mockup (rounded ~16px, brandable
  background color, merchant name, big counter). It must feel like the real Apple Wallet pass the
  client will get. It updates **live** as the owner edits colors/images/goal.
- **QR blocks:** QR codes render on a white tile with quiet-zone padding, the client name + a mono
  short code under it, and a print/download action.
- **Empty states:** composed, warm, in Spanish, always with the one action that fills them
  ("Todavía no hay recompensas. Agregá la primera."). No sad-face illustrations.
- **Loading:** skeletons matching layout. No spinners.
- **Destructive actions:** inline confirm zone, never a modal reflex. "Desactivar" (soft) is visually
  calmer than "Eliminar" (hard).

### Layout & responsive
- Max width 1100–1400px centered for panels; generous but purposeful whitespace.
- CSS Grid; single column under 768px, no horizontal scroll ever; `min-h-[100dvh]`.
- Panel chrome: slim top bar with merchant/brand name and "Salir"; content area with a clear
  page title + one primary action on the same line.

### Motion
- Spring-like ease-out for reveals; staggered list mounts (cascade). Animate `transform`/`opacity`
  only. Live-preview changes (color typing → card mockup) transition in ≤150ms.

### Anti-patterns (NEVER)
No emojis in UI. No Inter. No generic serifs. No `#000`. No neon glows or gradient text. No
side-stripe colored borders. No hero-metric cliché (giant number + tiny label + gradient). No
identical card grids. No modal-first flows. No AI copy clichés ("Eleva tu negocio", "Sin fricciones").
No fake data in mocks: use Salvadoran-plausible names ("Cafetería Piloto", "María Rivera",
tel. `7845 1023`), never "John Doe/Acme". No em dashes in copy.

---

## SCREENS — Panel del COMERCIO (dueño)

### C1. Login (`/comercio/login`)
Correo + contraseña, un botón "Entrar", error inline genérico ("Correo o contraseña incorrectos.").
Marca "FM Lealtad" discreta. Nada más.

### C2. Resumen (`/comercio/panel`) — REDISEÑO + DATOS NUEVOS
- Métricas arriba (sin cliché hero-metric): **clientes con tarjeta**, **puntos/sellos otorgados**,
  tipo de tarjeta activo (Puntos/Sellos) con su descripción.
- **QR de registro del comercio** (enlace `/registro/[slug]`): tile de QR con acción
  imprimir/descargar y el texto "Mostralo en tu local: tus clientes lo escanean y crean su tarjeta."
- Atajos a Branding / Reglas / Recompensas / Clientes como filas limpias, no card grid.

### C3. Branding (`/comercio/branding`) — REDISEÑO + PREVIEW TOTAL
- **Vista previa en vivo de la tarjeta** (protagonista, sticky en desktop): colores, logo, franja
  (strip), imagen principal, ícono de sello y "7 de 10 sellos" se reflejan AL INSTANTE al editar,
  incluida la imagen recién subida.
- Editor al lado: 3 colores (con color-picker además del texto rgb), meta de sellos (solo si el
  tipo es sellos), y las 3–4 subidas de imagen con su miniatura actual y validación inline
  (PNG/JPG/WebP, máx 2 MB).

### C4. Reglas (`/comercio/reglas`)
Lista limpia de reglas (Por visita / Por monto + valor) con eliminar inline; formulario simple para
agregar. Estado vacío compuesto.

### C5. Recompensas (`/comercio/recompensas`)
Catálogo de premios activos (nombre, costo en puntos mono, tipo, descripción) con "Desactivar"
calmado (conserva historial). Form para crear. Estado vacío compuesto.

### C6. Clientes (`/comercio/clientes`) — PANTALLA NUEVA
- Tabla/lista: nombre, teléfono (mono), puntos o "N de M sellos" (mono), fecha de alta.
- Fila expandible (no modal) con el **QR de la tarjeta de ese cliente** (su `qr_token`) en tile
  imprimible/descargable, por si el cliente no tiene su pass a mano.
- Buscador por nombre/teléfono. Contador total arriba.

### C7. Escanear (`/comercio/escanear`) — PANTALLA NUEVA (Fase 4; diseñar ya)
- Mobile-first: visor de cámara para escanear el QR del pass del cliente.
- Al leerlo: tarjeta del cliente (nombre + saldo actual) y acción grande "+1 sello" / sumar puntos
  (según tipo), con confirmación visual del nuevo saldo y deshacer breve.
- Estado de error claro si el QR no corresponde a este comercio.

## SCREENS — Panel del ADMIN (FM)

### A1. Login (`/admin/login`)
Igual de mínimo que C1, marca "FM Lealtad · Panel interno".

### A2. Comercios (`/admin/comercios`) — REDISEÑO + DATOS NUEVOS
- Lista de comercios: nombre, slug, pastilla de licencia (activo/inactivo), tipo de tarjeta, y
  **# de clientes con tarjeta** (mono). Buscador. Botón "Nuevo comercio".

### A3. Nuevo / Editar comercio — REDISEÑO
- Form actual (nombre, slug, colores, licencia, tipo de tarjeta con "(Próximamente)" deshabilitados)
  + **la misma vista previa en vivo de la tarjeta** que C3 (colores al menos).
- Zona de peligro (eliminar) separada y calmada.

### A4. Detalle del comercio → Clientes (`/admin/comercios/[id]/clientes`) — PANTALLA NUEVA
- Mismos datos que C6 pero para FM: lista de clientes del comercio con puntos/sellos y **el QR por
  cliente** (mismo tile expandible). Métricas del comercio arriba (clientes, tarjetas, licencia).

## Página pública (fase posterior del rediseño)
`/registro/[slug]` y la home: mismo sistema, un punto más de calidez/brand (la primera impresión del
cliente final). El **portal del cliente** (`/mi-tarjeta`, plan aparte) heredará este sistema.

---

## Notas técnicas (no van a Stitch; para la implementación)
- `tarjetas.qr_token` ya existe (es lo que codifica el barcode del pass) → los QR de C6/A4 se
  renderizan de ahí (lib `qrcode` o SVG server-side). **Cero migraciones** para todo lo de arriba
  salvo C7.
- C7 (escanear/asignar) exige antes **proteger `POST /api/tarjetas/[id]/puntos` con
  `verifyComercioOwner`** (hoy no tiene gate: era del walking skeleton) y scopear la tarjeta al
  comercio de la sesión. Las tablas `canjes` y `transacciones_puntos` ya existen desde 0001.
- Conteos de clientes: `select count(*)` sobre `tarjetas` por `comercio_id` (join a `clientes`).

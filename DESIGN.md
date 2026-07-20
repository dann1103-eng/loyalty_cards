# DESIGN.md — FM Lealtad

> **⚠️ SUPERSEDIDO para el rediseño (2026-07-17):** Daniel decidió resetear la paleta y dejar que
> Google Stitch la proponga. La fuente de verdad del rediseño es
> [docs/design/STITCH-DESIGN.md](docs/design/STITCH-DESIGN.md). Este archivo documenta el sistema
> "cafetería" que sigue VIVO en producción hasta que el rediseño se apruebe y fusione.

> Sistema visual, documentado desde el código actual (`app/globals.css`) y **elevado** en el pase 1
> de rediseño (rama `redesign/impeccable-pass-1`, 2026-07-17). La identidad se conserva; se refina
> hacia un acabado más premium. Ver `PRODUCT.md` para el porqué.

## Identidad
**"Cafetería de especialidad / artesanal."** Espresso + papel crema + acento caramelo. Cálido,
tostado, hecho a mano. Fondo de avena con dos glows suaves de caramelo + grano de papel sutil.

## Estrategia de color: **Restrained**
Neutros cálidos (todos tintados hacia el matiz café, chroma baja) + **un acento** caramelo (≤10% de
la superficie) y un rojo arcilla solo para peligro/alertas. No es una superficie "bañada" en color:
la calidez viene de los neutros tintados, no de saturación.

Paleta en **OKLCH** (nunca `#000`/`#fff`; cada neutro tinta hacia el café):

| Rol | Token | OKLCH | Uso |
|---|---|---|---|
| Texto máximo | `--espresso` | `22% 0.024 55` | Títulos, texto principal |
| Texto fuerte | `--bean` | `30% 0.032 58` | Labels, nombres |
| Texto secundario | `--ink-soft` | `48% 0.034 62` | Notas, slugs, ayuda |
| Fondo app | `--oat` | `91.5% 0.026 79` | Body |
| Superficie base | `--cream` | `95.5% 0.018 81` | Paneles (base del gradiente) |
| Superficie clara | `--foam` | `98% 0.010 82` | Paneles (tope), texto sobre oscuro |
| "Blanco" tintado | `--paper` | `99.2% 0.006 82` | Inputs (NO `#fff`) |
| Bordes | `--line` | `86% 0.030 78` | Bordes de campos, filas |
| **Acento** | `--caramel` | `66% 0.125 64` | Focus, énfasis, acento primario |
| Acento oscuro | `--caramel-deep` | `54% 0.115 60` | Kicker, acento sobre claro |
| Peligro | `--clay` | `55% 0.118 39` | Alertas, eliminar |
| Éxito | `--leaf` | `52% 0.09 150` | Pastilla "activo" |

## Tema: **light, cálido** (decidido, no por defecto)
Escena: *dueño de una cafetería de barrio configurando su tarjeta desde el celular, de día, en su
local iluminado.* La calidez del papel crema refuerza el oficio artesanal. Dark mode NO aplica a esta
identidad (sería frío); si algún día se pide, sería un modo "noche tostada", no un gris azulado.

## Tipografía
- **Display:** serif (hoy `Georgia`). *Recomendación de dirección para tu OK:* subir a un serif con
  más carácter y contraste (ej. **Fraunces** vía `next/font`) — es la palanca #1 para el salto premium
  artesanal. No lo cambié en el pase 1 (es una decisión de identidad + requiere verificar `next/font`
  en este Next); queda propuesto.
- **Body:** `system-ui` sans (rápido, neutro, deja brillar al display). Se conserva.
- **Escala** (ratio ≥1.25): kicker 0.72rem · label 0.78rem · body 1rem · lede 1.02rem · fila 1.1rem ·
  título de sección 2rem · título hero `clamp(2.5rem, 9vw, 3.4rem)`. Números del contador en display.

## Elevación (sombras cálidas, tintadas al espresso)
Escala en tokens (antes eran ad-hoc):
- `--shadow-1` sutil (filas, inputs en focus) · `--shadow-2` media (paneles) · `--shadow-3` alta
  (tarjeta/pass preview, botón primario). Todas con tinte cálido `oklch(22% .02 55)`, no negro puro.

## Espaciado y forma
- **Radios:** campos 12px · botones 13px · paneles/tarjeta `--radius` 18px · pastillas 999px.
- **Ritmo:** tokens de espaciado (4/8/12/16/22/30/40) para variar y no caer en padding uniforme.
- Ancho de lectura ≤ 34ch en ledes; paneles de auth ≤ 430px; paneles internos ≤ 900px.

## Componentes (clases estables — no se renombran, para no romper el código)
`.shell/.stack` (layout de auth) · `.kicker/.title/.lede` (encabezados) · `.panel` (contenedor de
formulario) · `.field` (label+input/select, con focus ring caramelo) · `.btn-primary` (espresso, lift
en hover) · `.alerta` (arcilla) · `.cardface*` (maqueta del pass) · `.wallet-btn` (negro oficial de
Apple, se mantiene) · `.admin-*` (shell/top/main/fila/lista/vacío/error del panel) · `.pastilla*`
(badges de estado) · `.admin-eliminar` (peligro) · `.subida-imagen/.subida-preview` (branding) ·
`.reveal` (entrada escalonada, respeta `prefers-reduced-motion`).

## Motion
- Entrada escalonada `.reveal` con `cubic-bezier(0.2,0.7,0.2,1)` (ease-out, sin bounce). Se conserva.
- Hover de botones/filas: `translateY` + sombra, transición ≤0.2s. Nunca se anima layout.

## Qué hizo el pase 1 (rama `redesign/impeccable-pass-1`)
1. Migró toda la paleta a **OKLCH** conservando el look; tintó el blanco de inputs (`--paper`).
2. Introdujo **escala de sombras y espaciado** en tokens (elevación coherente, ritmo).
3. Refinó focus rings, bordes y micro-transiciones. **Sin cambiar marcado ni clases** → cero riesgo
   funcional (build/tests verdes).

## Qué necesita tu dirección (pase 2+, no lo hice a ciegas)
- **Font display** (Fraunces u otra) — el mayor salto, pero es identidad: tu decisión.
- **Rediseño por página** (jerarquía/layout de cada panel, estados vacíos con más personalidad,
  la home): mejor con tu ojo, iterando en vivo.

# PRODUCT.md — FM Lealtad

> Contexto de producto para el trabajo de diseño (skill `impeccable`). **Borrador extraído del
> proyecto real** (código, memoria del proyecto, diseño existente) por el asistente, 2026-07-17.
> Daniel: confirmá o ajustá — sobre todo tono, anti-referencias y la decisión de identidad visual.

## Qué es
Plataforma de tarjetas de lealtad **multi-comercio** que viven en la billetera del teléfono
(Apple Wallet hoy; Google Wallet pendiente). FM Communications (El Salvador) la licencia a comercios;
cada comercio tiene su tarjeta con su branding, y sus clientes la agregan al wallet desde un registro
público. Modelo piloto-primero: el primer comercio real es **Cafetería Piloto**.

## Usuarios (tres superficies, tres registros)
1. **Cliente final** — `/registro/[comercio]` y la home pública. Salvadoreño, teléfono en mano, sin
   cuenta. Quiere agregar su tarjeta al wallet en 10 segundos y confiar en que es del comercio real.
   *Primera impresión: esta superficie es medio **brand** (el diseño vende confianza).*
2. **Dueño del comercio** — `/comercio/*`. Autogestiona SU comercio: branding (colores, imágenes,
   meta de sellos), reglas de puntos, recompensas. Dueño de PyME, no técnico, apurado. *Superficie
   **product**: el diseño sirve la tarea, clara y sin fricción.*
3. **Admin de FM** — `/admin/*` (interno). Gestiona el catálogo de comercios (licencia, branding,
   tipo de tarjeta). *Superficie **product**, herramienta interna.*

## Marca y tono
- **Alma "cafetería de especialidad / artesanal":** cálido, tostado, hecho a mano. Espresso + papel
  crema + acento caramelo. Nace del piloto (una cafetería) y le queda bien a comercios de barrio.
- **Confiable y simple, no corporativo frío.** El usuario es una PyME salvadoreña, no una fintech.
- **Honesto:** los tipos de tarjeta no disponibles se muestran "(Próximamente)" y deshabilitados
  (anti-Cardly). El producto no promete lo que no hace.
- **Español** en todo (copy, identificadores, comentarios).

## Anti-referencias (qué NO queremos parecer)
- **SaaS genérico** navy/gris con tarjetas idénticas y "hero-metric" (número gigante + label + stats).
- **Cardly** y similares que muestran 8 tipos de tarjeta como si todos funcionaran.
- Cripto/neón, glassmorphism decorativo, dashboards fríos "de agencia".
- Cualquier cosa que grite "lo hizo una IA": grids de tarjetas repetidas, bordes laterales de color,
  texto con degradado.

## Principios estratégicos
- **La billetera es el producto; la web es el mostrador.** La web registra, configura y da confianza;
  el pass firmado (binario) es la entrega. La web NO reconstruye el pass, lo previsualiza.
- **Rápido y honesto sobre lo que hay.** Menos pasos, mensajes claros, cero promesas falsas.
- **Cálido antes que "moderno".** Preferimos calidez artesanal a minimalismo frío de moda.
- **Una identidad coherente en las 3 superficies**, con densidad distinta (registro respira; los
  paneles son más densos y utilitarios).

## Register
- Por defecto **product** (paneles de dueño y FM son la mayor parte de la superficie).
- La **home pública y `/registro`** se tratan con sensibilidad **brand** (primera impresión, confianza).

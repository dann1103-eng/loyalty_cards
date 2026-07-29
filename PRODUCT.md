# PRODUCT.md — Cardly SV

> Contexto de producto para el trabajo de diseño (skill `impeccable`). **Reescrito el 2026-07-27
> contra el código real.** La versión anterior describía "FM Lealtad" con una identidad de cafetería
> en tema claro: dos decisiones atrás, y llevaba a diseñar el producto equivocado.

## Qué es
Plataforma de tarjetas de lealtad **multi-comercio** que viven en la billetera del teléfono (Apple
Wallet en producción; Google Wallet cableado en `lib/google/`). Cada comercio tiene su tarjeta con
su marca, y sus clientes la agregan desde un registro público. El cajero acredita puntos o sellos
escaneando el QR del cliente, y el saldo se actualiza en el bolsillo de esa persona.

**La marca es Cardly SV.** Sitio `www.cardly-sv.site` (con `www`: el dominio raíz redirige y esa
redirección rompió el registro de passes en producción). Soporte `soporte@cardly-sv.site`. La fuente
de verdad es `lib/marca.ts`, y ningún texto de interfaz vuelve a escribir el nombre o el correo a
mano.

FM Communications (El Salvador) opera el producto, pero **ese nombre no aparece nunca delante de un
comercio ni de un cliente.** Se sacó de toda la interfaz visible (un dueño llegó a leer "Hablá con
FM para ampliarlo" en su panel: un nombre que para él no significa nada) y `lib/marca.test.ts` falla
si reaparece en `app/comercio`, `app/registro`, `app/mi-tarjeta`, `app/_inicio`, `app/page.tsx` o
las librerías que los sirven. `app/admin` es la única excepción: ahí "FM" es el nombre correcto de
quien está usando la pantalla.

## Cómo se vende (esto manda en la página pública)
- Quien paga es la **cuenta** (`cuentas_comercio`), no el comercio. Una cuenta agrupa comercios
  distintos (otra marca, otro tipo de tarjeta) y sucursales (mismo negocio, otro local, la misma
  tarjeta y el mismo saldo del cliente).
- Tres planes: Starter $29/mes, Growth $49/mes, Pro $89/mes. El límite del plan cuenta **comercios
  distintos y sucursales sumados**, y es un default sugerido que el operador puede ajustar por
  cuenta. El catálogo real vive en el sitio de marketing, no en este repo.
- La página pública **muestra los tres precios** (decisión del dueño, 2026-07-29: revierte la
  política anterior de "solo demo, sin precios públicos"). Lo que sigue vigente: **nada de
  contadores de piloto inventados** tipo "8 comercios ya usan Cardly" — restan, no suman, en una
  plataforma que recién está creciendo. La franja de confianza de `/` dice hechos verificables
  (tipos de tarjeta reales, Apple + Google Wallet), no cifras de uso.

## Usuarios (cuatro superficies, dos registros)
1. **Dueño que todavía no es cliente** — `/`. Es a quien le habla la página pública: PyME
   salvadoreña, entra desde el teléfono, decide en segundos si esto es serio. El cliente final nunca
   llega acá (llega por el código de su propio comercio). *Superficie **brand**: el diseño ES el
   argumento.*
2. **Cliente final** — `/registro/[comercioSlug]` y `/mi-tarjeta`. Salvadoreño, teléfono en mano,
   sin cuenta y sin ganas de instalar nada. Quiere su tarjeta en la billetera en diez segundos y
   confiar en que es del comercio real. *Mitad **brand** (vende confianza), mitad tarea.*
3. **Dueño y su cajero** — `/comercio/*`. El dueño autogestiona marca, reglas, recompensas,
   sucursales, cajeros y mira sus reportes; el cajero solo escanea, muchas veces por día, de pie y
   con una mano. *Superficie **product**: el diseño sirve la tarea.*
4. **Operador interno** — `/admin/*`. Catálogo de cuentas y comercios, licencias, planes, BI.
   *Superficie **product**, herramienta interna.*

## Marca y tono
- **Oscuro por defecto, con tres temas.** No es una preferencia estética suelta: el cajero atiende
  bajo el sol y el dueño revisa sus números de noche. Ver `DESIGN.md`.
- **Confiable y directo, no corporativo frío.** El interlocutor es una PyME salvadoreña, no una
  fintech ni un departamento de compras.
- **Honesto:** los tipos de tarjeta que todavía no funcionan se muestran deshabilitados y con
  "(Próximamente)" en vez de fingirse. El producto no promete lo que no hace, ni siquiera cuando el
  sitio de marketing ya lo listó.
- **Español salvadoreño con voseo** en todo: copy, identificadores y comentarios.
- **Nada de rayas largas (—) en el copy.** Comas, dos puntos, punto y coma o paréntesis.

## Anti-referencias (qué NO queremos parecer)
- **SaaS genérico**: navy y gris, tarjetas idénticas en grilla, la plantilla de "número gigante +
  label + estadísticas".
- **El sitio de marketing prometiendo de más.** Ocho tipos de tarjeta como si los ocho anduvieran.
- Cripto y neón, glassmorphism decorativo, dashboards fríos "de agencia".
- Cualquier cosa que grite "lo hizo una IA": grillas de cards repetidas con ícono + título + texto,
  bordes laterales de color, texto con degradado.
- **El reflejo de categoría.** Si alguien puede adivinar el tema y la paleta sabiendo solo el rubro
  ("lealtad → morado alegre", "fintech → navy y dorado"), es el primer reflejo del entrenamiento.

## Principios estratégicos
- **La billetera es el producto; la web es el mostrador.** La web registra, configura y da
  confianza; el pass firmado es la entrega. La web NO reconstruye el pass, lo previsualiza.
- **Rápido y honesto sobre lo que hay.** Menos pasos, mensajes claros, cero promesas falsas.
- **Lo público funciona sin JavaScript y se sirve estático.** La página de entrada y el registro son
  lo primero que ve alguien con una conexión mala en un teléfono barato.
- **Una identidad coherente en las cuatro superficies**, con densidad distinta: la página pública
  respira, el registro respira, los paneles son densos y utilitarios.

## Register
- Por defecto **product** (los paneles son la mayor parte de la superficie).
- La **página pública `/`** es **brand** sin matices: es la primera y muchas veces la única
  impresión. `/registro` y `/mi-tarjeta` se tratan con sensibilidad brand aunque sean tarea.

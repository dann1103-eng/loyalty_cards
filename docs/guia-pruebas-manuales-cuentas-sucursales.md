# Guía de pruebas manuales — Cuentas, sucursales, cajeros, BI y plan/facturación

Cubre todo lo que se construyó entre el merge de Fase 6 (`4a92865`) y el fix de plan/facturación
(`5e74427`), ya en producción. Pensada para ir marcando a medida que probás — no hace falta seguir
el orden exacto, pero sí conviene hacer la sección 1 primero (crea la cuenta/comercio de prueba que
las demás secciones reutilizan).

**Antes de empezar:** vas a necesitar tu login real de FM admin (`/admin/login`) — no hay cuenta de
prueba para eso. Para el lado del dueño/cajero podés crear cuentas descartables sin problema (son
filas normales que podés borrar después desde el propio panel FM).

---

## 1. Panel FM — Cuentas y catálogo de planes

**Crear una cuenta nueva con plan:**
1. `/admin/cuentas` → "Nueva cuenta".
2. Elegí "Growth" en el selector de plan.
3. ✅ Esperado: el campo "Monto mensual" se precarga a `49` y "Límite de negocios + sucursales" a
   `2`, automáticamente al elegir el plan.
4. Cambiá el límite a mano (p. ej. `5`) y guardá.
5. ✅ Esperado: guarda sin problema — el precargado es solo un default, no un tope fijo.

**Cuenta sin límite (Pro):**
1. Creá otra cuenta, elegí "Pro".
2. ✅ Esperado: el campo de límite queda vacío ("Vacío = sin límite" como placeholder).
3. Guardá con el límite vacío.
4. ✅ Esperado: guarda bien. En `/admin/cuentas`, esa fila muestra "∞" en vez de un número.

**Cuenta demo existente (sin plan asignado):**
1. Abrí cualquiera de las 6 cuentas piloto/demo (p. ej. "Café Aurora", "Cafetería Piloto") desde
   `/admin/cuentas`.
2. ✅ Esperado: el selector de plan muestra "— Elegí un plan —" (deshabilitado, no "Starter"
   preseleccionado en silencio).
3. Intentá guardar sin tocar el selector de plan.
4. ✅ Esperado: rechaza con un mensaje sobre el plan (el navegador no deja enviar un `<select>`
   deshabilitado como valor, así que en la práctica no vas a poder ni enviarlo).

**Pausar una cuenta con 2+ comercios (si tenés una a mano, o vinculá 2 comercios primero — sección 4):**
1. Editá la cuenta, cambiá "Estado de licencia" a "Inactivo", guardá.
2. Andá a `/admin/comercios`.
3. ✅ Esperado: **TODOS** los comercios de esa cuenta muestran la pastilla "inactivo" — antes de
   este fix, pausar afectaba un comercio a la vez; ahora es a nivel cuenta completa.
4. Volvé a poner la cuenta en "Activo" antes de seguir con otras pruebas (para no dejar comercios
   reales pausados).

---

## 2. Panel FM — Comercios (sin campos de licencia)

1. `/admin/comercios/nuevo` (o editá uno existente).
2. ✅ Esperado: el formulario NO tiene ningún campo de licencia/plan/monto — va directo del
   `<select>` de tipo de tarjeta al botón de guardar. La licencia se administra desde "Cuentas"
   ahora.
3. En la lista `/admin/comercios`, cada fila debería mostrar el monto y la pastilla de estado
   **heredados de la cuenta** del comercio (si esa cuenta tiene un monto asignado).

---

## 3. Panel FM — Límite combinado (el fix central)

Este es el hueco real que encontraste en producción sobre la cuenta "Verde Raíz" — confirmá que
quedó cerrado.

1. Creá una cuenta de prueba con límite `2` (plan Starter o el que quieras, ajustando el número).
2. Creá un comercio nuevo asignado a esa cuenta. ✅ Debería crear sin problema (1 de 2).
3. Como dueño de ese comercio (ver sección 5 para el login), andá a `/comercio/sucursales` y creá
   UNA sucursal. ✅ Debería crear sin problema (2 de 2 — comercio + sucursal cuentan juntos).
4. Intentá crear una SEGUNDA sucursal.
5. ✅ **Esperado: se rechaza**, con un mensaje que menciona el límite (algo como "Esta cuenta ya
   alcanzó su límite de 2 negocio(s)/sucursal(es)."). Esto es lo que antes NO pasaba — antes dejaba
   agregar sucursales sin tope.
6. Volvé a `/admin/cuentas/[esa cuenta]` → ✅ debería mostrar "2 de 2" y la pastilla "Llena".

**Caso extra — mover un comercio con sucursales:**
1. Con el comercio+sucursal del paso anterior, andá a "Cuentas" → creá una cuenta B con límite `3`
   que YA tenga 2 comercios vinculados (o vinculá 2 comercios cualquiera).
2. Intentá vincular (o reasignar editando el comercio) el comercio del paso 1 —que trae su sucursal
   consigo— a la cuenta B.
3. ✅ **Esperado: se rechaza** aunque la cuenta B "parezca" tener cupo para 1 más (2 de 3) — porque
   el comercio que se mueve trae 1 sucursal, y 2+1(comercio)+1(sucursal) = 4 > 3.

---

## 4. Panel del dueño — Login multi-comercio

**Dueño con 1 solo comercio:**
1. Login en `/comercio/login` con un dueño que administra un único comercio.
2. ✅ Esperado: entra directo a `/comercio/panel`, sin pantalla intermedia ni selector visible en
   el header.

**Dueño con 2+ comercios (vinculá 2 comercios a la misma cuenta primero, en el panel FM, o usá un
dueño que ya administre varios):**
1. Login con ese dueño.
2. ✅ Esperado: cae en `/comercio/elegir` — pantalla para elegir cuál comercio administrar.
3. Elegí uno → entrás a su panel.
4. ✅ Esperado: aparece un selector en el header para cambiar entre sus comercios sin volver a
   loguearse.
5. Cambiá de comercio con el selector → confirmá que el panel entero (branding, datos) cambia al
   comercio correcto.

---

## 5. Panel del dueño — Sucursales

1. `/comercio/sucursales` → crear, renombrar, y desactivar/reactivar una sucursal (dentro del cupo
   de tu cuenta, para no chocar con el límite de la sección 3).
2. ✅ Desactivar es un soft-delete: la sucursal desaparece de las opciones activas pero se puede
   reactivar, nunca se borra de verdad (protege el historial de transacciones/canjes).

---

## 6. Panel del dueño — Cajeros

1. `/comercio/cajeros` → crear un cajero nuevo, asignado a una sucursal específica (email +
   contraseña).
2. Cerrá sesión, logueate con ese cajero en `/comercio/login`.
3. ✅ Esperado: el cajero entra a una versión mínima del panel (básicamente solo "Escanear"), no ve
   el resto de las pantallas del dueño.
4. Andá a `/comercio/escanear`.
5. ✅ Esperado: la sucursal aparece FIJA (texto, no selector) — la del cajero, sin poder elegir
   otra.
6. Como dueño (no cajero), desactivá esa sucursal desde `/comercio/sucursales`, volvé a loguearte
   como el cajero y andá a escanear.
7. ✅ Esperado: mensaje claro de que su sucursal está desactivada, no puede operar.

---

## 7. Escáner — atribución por sucursal

1. Como DUEÑO (no cajero), andá a `/comercio/escanear`.
2. ✅ Esperado: aparece un `<select>` con las sucursales activas del comercio (a diferencia del
   cajero, que la tiene fija).
3. Escaneá o ingresá manualmente el token de una tarjeta de prueba, acreditá puntos/sellos eligiendo
   una sucursal del picker.
4. Verificá en `/comercio/reportes` (sección 9) que esa acreditación aparece bajo la sucursal
   correcta.

---

## 8. Acreditar y canjear (RPC atómico)

No debería haber cambios de comportamiento visibles acá (el fix de esta sesión no tocó estas
funciones) — es solo para confirmar que nada se rompió:
1. Acreditá puntos/sellos a una tarjeta de prueba varias veces.
2. Canjeá una recompensa cuando el saldo alcanza.
3. Intentá canjear una recompensa cuando NO alcanza el saldo.
4. ✅ Esperado: mensaje claro tipo "le faltan N puntos/sellos".

---

## 9. BI / Reportes

**Panel del dueño** (`/comercio/reportes`):
1. Con las acreditaciones/canjes de las secciones anteriores ya generadas, abrí la pantalla.
2. ✅ Esperado: tarjetas por sucursal (visitas, puntos otorgados, premios), tendencia de los
   últimos días, top de clientes. Si hay actividad sin sucursal asignada (de antes de este
   proyecto), aparece en un bucket "Sin sucursal" separado.

**Panel FM** (`/admin/reportes`):
1. Abrí la pantalla.
2. ✅ Esperado: tabla agregada de TODOS los comercios, agrupados por cuenta, con las mismas
   métricas. Comercios sin cuenta (no debería haber ninguno hoy) caerían en un grupo "Sin cuenta".

---

## Limpieza al terminar

Si creaste cuentas/comercios/sucursales/cajeros de prueba, borralos desde los paneles
correspondientes (Cuentas y Comercios en FM admin permiten eliminar; una cuenta con negocios
asignados hay que desvincularlos primero). No hace falta si preferís dejarlos como datos de
prueba permanentes — no interfieren con nada real.

---
---

# Parte 2 — Panel móvil, sucursal Principal, contexto y alta self-serve

Todo lo de arriba es la Parte 1 y sigue valiendo. Esta parte cubre lo construido después
(`9ddd9d8` → `5e78226`): sucursal Principal (migración 0012), nav deslizable, switcher de contexto
en el header, accesos nuevos del cajero, alta self-serve de comercio y reportes conglomerado.

Mismo formato que arriba: pasos concretos con lo que tenés que ver. Donde algo funciona distinto
que antes va marcado **CAMBIO respecto de antes** — para que no lo confundas con un bug.

**Antes de empezar:**

1. La migración 0012 ya está aplicada. Para confirmarlo desde tu compu (script de SOLO lectura, no
   escribe nada):
   `npx tsx --conditions=react-server scripts/verificar-0012.ts`
   ✅ Esperado: dos líneas `OK:` — que la columna `es_principal` existe y es consultable, y que los
   N comercios tienen exactamente 1 principal ACTIVA cada uno. Una línea `PROBLEMA:` nombra el
   comercio afectado; si aparece, resolvelo antes de seguir con lo demás.
2. **Todo lo visual de esta parte está calculado, nunca observado en una pantalla.** No hay
   verificación visual automatizada y ninguna prueba automatizada mira el nav, la pastilla, el
   panel del switcher, el modal ni los reportes. Por eso la sección 10 va primero y conviene
   hacerla en el teléfono, no en la compu.
3. Para lo de sucursales y contexto usá el dueño de "Verde Raíz": su Principal es **"Centro Santa
   Ana"** — el backfill ascendió la sucursal más antigua que ya existía, no creó una nueva.

---

## 10. Lo primero que conviene mirar (teléfono real, ~5 minutos)

Esto es lo que ningún cálculo puede responder. Hacelo antes que nada.

**A. La nav inferior se desliza (9 secciones):**
1. Login como dueño en el teléfono y mirá la barra de abajo.
2. ✅ Esperado: NO entran las 9 secciones a la vez, y los íconos de los dos bordes se ven
   desvanecidos (hay un degradado de 14px a cada lado que insinúa que la barra sigue).
3. Deslizá la barra con el dedo, para un lado y para el otro.
4. ✅ Esperado: se desliza, sin barra de scroll a la vista (está ocultada a propósito), y las
   pestañas frenan más o menos centradas al soltar.
5. Tocá "Reportes" (la última) y después "Resumen" (la primera).
6. ✅ Esperado: al aterrizar en cada pantalla la pestaña activa YA está a la vista y centrada, sin
   que tengas que buscarla deslizando.
7. **CAMBIO respecto de antes:** la nav tenía 8 ítems repartidos fijos en el ancho; ahora son 9
   (se agregó "Reglas") y por eso pasó a ser un carrusel.

**B. La pastilla del header: cuánto del nombre se llega a leer:**
1. Mirá arriba a la derecha del header, entre el nombre del comercio y el botón de salir.
2. ✅ Esperado: hay una pastilla que dice **"Todas"** (sin sucursal elegida todavía).
3. Elegí una sucursal desde el panel (sección 15 explica el flujo) y volvé a mirarla.
4. ✅ Esperado: ahora dice el nombre de la sucursal. En un teléfono de 360px entran ~12 caracteres,
   así que "Centro Santa Ana" se va a ver cortado como "Centro Santa…" — **es conocido y esperado,
   no es un bug**. Lo que hay que juzgar en pantalla real es si lo que se lee alcanza para
   distinguir una sucursal de otra.
5. ✅ Esperado: en móvil la pastilla NO tiene ícono adentro (la flecha doble solo aparece de 760px
   para arriba; se saca en móvil para darle esos ~22px al nombre). Juzgá lo que no se puede
   calcular: sin el ícono, ¿se entiende que esa pastilla es tocable?

**C. El panel del switcher: que cierre al tocar afuera y que no tape nada:**
1. Tocá la pastilla.
2. ✅ Esperado: sube un panel desde el borde de abajo; ocupa como mucho el 72% del alto de la
   pantalla.
3. Si la lista es larga, deslizá dentro del panel hasta el tope y seguí deslizando.
4. ✅ Esperado: scrollea ADENTRO del panel y la página de atrás no se mueve. Deslizar sobre el
   fondo oscuro tampoco mueve la página de atrás.
5. Mirá si el panel tapa algo que necesitás ver mientras elegís, y si el velo oscuro cubre la nav
   inferior y el header (deberían quedar debajo, intocables mientras el panel está abierto).
6. Tocá el fondo oscuro, fuera del panel.
7. ✅ Esperado: se cierra y NO cambia el contexto (la pastilla sigue diciendo lo mismo).

**D. El botón Salir sin la palabra:**
1. Mirá el extremo derecho del header en el teléfono.
2. ✅ Esperado: donde antes decía "Salir" ahora hay solo el ícono de salida, en un área tocable de
   44x44. **CAMBIO respecto de antes.** De 760px para arriba (tablet/compu) vuelve a mostrar la
   palabra "Salir" como siempre.
3. Juzgá lo único que no se puede calcular: ¿se entiende que ese ícono cierra la sesión, o parece
   otra cosa?
4. Tocalo (dejá esto para el final del bloque).
5. ✅ Esperado: cierra sesión y caés en `/comercio/login`. Es el mismo mecanismo de antes, solo
   cambió cómo se ve.

---

## 11. Sucursal Principal (migración 0012)

Todo comercio tiene ahora una sucursal que representa su propio local. No consume cupo del plan y
no se puede desactivar.

**Cómo se ve:**
1. Como dueño, andá a `/comercio/sucursales`.
2. ✅ Esperado: la Principal aparece SIEMPRE primera en la lista, con un ícono distinto (chincheta
   de local) y el subtítulo "Sucursal principal". En Verde Raíz es "Centro Santa Ana".
3. ✅ Esperado: la Principal **no tiene botón de Activar/Desactivar** — el botón directamente no
   está en su fila. Las demás sucursales sí lo tienen. **CAMBIO respecto de antes:** antes todas
   tenían toggle.
4. Renombrá la Principal desde su campo de nombre (eso sí se puede) y guardá.
5. ✅ Esperado: guarda con el nombre nuevo y sigue siendo la Principal (primera, con su subtítulo).

**Caso borde — intentar desactivar la Principal:**
1. Desde la app no hay forma: el botón no existe. La prueba en el teléfono es justamente que NO
   esté.
2. El candado real vive en el servidor y responde "La sucursal principal no se puede desactivar."
   — solo lo verías con un request armado a mano, así que no hay nada más que probar acá.
3. Contraprueba de que el toggle sigue vivo para las demás: desactivá una sucursal NO principal.
4. ✅ Esperado: pasa a la pastilla "Inactiva", y desaparece tanto del panel del switcher (sección
   15) como del picker de sucursal del escáner. Reactivala después.

**Chequeo del backfill (solo si tenías sucursales apagadas):**
1. La 0012 eligió como Principal la sucursal más antigua de cada comercio, y **si esa estaba
   inactiva, la reactivó**.
2. Recorré `/comercio/sucursales` de cada comercio tuyo.
3. ✅ Esperado: ninguna sucursal que hayas apagado a propósito reapareció activa. Si alguna sí
   (era la más antigua de su comercio), es esperado y no un bug — pero anotalo: ya no vas a poder
   volver a apagarla, hay que renombrarla o reorganizar.

---

## 12. El cupo del plan: el bug que la Principal arregla

Antes, el límite del plan contaba comercios + TODAS las sucursales. Un comercio de plan Starter
(límite 1) ya estaba 2/1 con su comercio y una sola sucursal, y como la sección Cajeros exige una
sucursal activa, **no se podían crear cajeros**. Ahora la Principal es gratis.

**Verificalo con una cuenta Starter:**
1. En FM admin, creá una cuenta con plan Starter (límite 1) y creale un comercio asignado.
2. Andá a `/admin/cuentas`.
3. ✅ Esperado: esa cuenta muestra **1 de 1**, no 2 de 1. **CAMBIO respecto de antes:** el comercio
   recién creado y su sucursal daban 2/1 apenas nacía.
4. Entrá como dueño de ese comercio y andá a `/comercio/cajeros`.
5. ✅ Esperado: aparece el formulario de alta de cajero, con la Principal ya elegida en el selector
   de sucursal — no el cartel "Primero agregá una sucursal activa". Esto era el callejón sin
   salida: la única forma de salir era crear una sucursal, y crearla chocaba con el límite.
6. Creá un cajero. ✅ Esperado: se crea sin tocar el cupo de la cuenta.
7. Volvé a `/comercio/sucursales`.
8. ✅ Esperado: en vez del botón "Agregar local" ves el aviso **"Alcanzaste el límite de tu plan
   (1 local). Hablá con FM para ampliarlo."** — Starter da para el local propio, no para uno
   segundo. Esto es correcto, no es el bug de antes.

**Caso borde — crear una sucursal con el plan lleno:**
1. Con la misma cuenta Starter (1 de 1), intentá agregar otra sucursal.
2. ✅ Esperado: no hay ni formulario ni botón — el aviso del límite ocupa ese lugar. El rechazo
   llega ANTES de que escribas nada.
3. En FM admin subile el límite a 2 y recargá `/comercio/sucursales`.
4. ✅ Esperado: vuelve a aparecer el botón "Agregar local".
5. Creá la sucursal y volvé a `/admin/cuentas`. ✅ Esperado: **2 de 2** y la pastilla "Llena"
   (comercio + sucursal adicional; la Principal sigue sin contar).

---

## 13. Nav inferior — qué ve cada rol

**Dueño:**
1. Recorré la nav deslizando.
2. ✅ Esperado: 9 secciones en este orden — Resumen, Escanear, Marca, Premios, Reglas, Sucursales,
   Cajeros, Clientes, Reportes. **CAMBIO respecto de antes:** "Reglas" no estaba en la nav (había
   que llegar por el atajo del Resumen).

**Cajero:**
1. Logueate como cajero y mirá la nav.
2. ✅ Esperado: 3 secciones — Resumen, Escanear, Clientes — repartidas en el ancho, sin necesidad
   de deslizar. **CAMBIO respecto de antes:** el cajero veía una sola (Escanear).
3. Tocá el nombre del comercio, arriba a la izquierda.
4. ✅ Esperado: te lleva al Resumen. **CAMBIO respecto de antes:** para el cajero ese enlace
   llevaba al escáner.
5. Escribí a mano una ruta que no le toca, por ejemplo `/comercio/sucursales`.
6. ✅ Esperado: te rebota al escáner (el gate de esas páginas sigue siendo solo del dueño).

---

## 14. Cajero — Resumen y Clientes

1. Como cajero, andá a `/comercio/panel`.
2. ✅ Esperado: ve las dos métricas de arriba (clientes con tarjeta y saldo vigente), el bloque
   "Tu programa", el QR de registro del local, y SOLO dos atajos: "Escanear tarjeta" y "Directorio
   de clientes". Nada de Marca, Premios, Reglas, Sucursales, Cajeros ni Reportes.
3. Andá a `/comercio/clientes` y buscá un cliente por nombre o teléfono.
4. ✅ Esperado: lo encuentra y puede abrir su ficha para ver el QR de la tarjeta.
5. Tocá "Acreditar / Canjear" en esa ficha.
6. ✅ Esperado: entra al escáner con el token del cliente ya cargado, sin usar la cámara — el
   camino para acreditar cuando el cliente no tiene el teléfono a mano.
7. Acreditá desde ahí.
8. ✅ Esperado: la acreditación queda atribuida a la sucursal del cajero (la de su membresía), sin
   que él pueda elegir otra. Verificalo después en Reportes (sección 19).

---

## 15. Switcher de contexto en el header

Reemplaza al selector de comercios que había antes. La pastilla dice **dónde estás parado**; el
comercio lo sigue diciendo la marca del header, a la izquierda.

**El panel:**
1. Como dueño, tocá la pastilla del header.
2. ✅ Esperado: sube un panel titulado "¿Qué estás gestionando?" con, para CADA comercio tuyo: una
   fila con el nombre del comercio y el subtítulo "Todas las sucursales", y abajo (indentadas) sus
   sucursales ACTIVAS. La Principal lleva la etiqueta "Principal".
3. ✅ Esperado: las sucursales desactivadas NO aparecen en esta lista.
4. ✅ Esperado: al final del panel hay un enlace "Agregar local…".
5. ✅ Esperado: la fila del contexto actual está resaltada (fondo distinto y borde de acento).

**CAMBIO respecto de antes — la pastilla aparece siempre:**
1. Logueate con un dueño que administra UN SOLO comercio.
2. ✅ Esperado: la pastilla está igual, y el panel muestra ese único comercio con sus sucursales.
   Antes el selector del header solo aparecía con 2 o más comercios; ahora aparece siempre porque
   también sirve para elegir sucursal. El `<select>` gris de antes ya no existe.

**Cambiar de sucursal (no te saca de la página):**
1. Estando en `/comercio/cajeros` (o cualquier otra pantalla), abrí el panel y elegí una sucursal
   del comercio en el que ya estás.
2. ✅ Esperado: el panel se cierra, la pastilla pasa a mostrar esa sucursal, y **seguís en la misma
   pantalla** (no te manda al Resumen).
3. Volvé a abrir el panel y elegí la fila del comercio ("Todas las sucursales").
4. ✅ Esperado: la pastilla vuelve a decir "Todas" y seguís en la misma pantalla.
5. Tocá la fila que YA está activa.
6. ✅ Esperado: solo cierra el panel, sin recargar nada.

**Cambiar de comercio (sí te lleva al Resumen):**
1. Con un dueño de 2+ comercios, elegí una sucursal del comercio A. Después abrí el panel y elegí
   el comercio B (o una sucursal de B).
2. ✅ Esperado: aterrizás en `/comercio/panel` del comercio B y todo el panel cambia (marca,
   colores, datos).
3. ✅ Esperado: si elegiste la fila "Todas las sucursales" de B, la pastilla dice "Todas" — el
   contexto de sucursal NO se arrastra del comercio anterior.
4. Cerrá sesión y volvé a entrar.
5. ✅ Esperado: arrancás en "Todas" — una sesión nueva no hereda la sucursal de la sesión anterior.

---

## 16. La sucursal activa scopea el panel

Con una sucursal elegida en la pastilla, tres pantallas cambian. Elegí "Centro Santa Ana" (o la
que uses) antes de empezar.

**Escáner:**
1. Como DUEÑO, andá a `/comercio/escanear`.
2. ✅ Esperado: el selector de sucursal viene **ya preseleccionado** en la sucursal del contexto.
   **CAMBIO respecto de antes:** arrancaba siempre en "Sin especificar".
3. Cambialo a otra sucursal en el selector y acreditá.
4. ✅ Esperado: se puede — la preselección es solo el punto de partida, seguís pudiendo elegir por
   operación (incluido "Sin especificar").

**Cajeros:**
1. Con la sucursal elegida, andá a `/comercio/cajeros`.
2. ✅ Esperado: la lista muestra SOLO los cajeros de esa sucursal. **CAMBIO respecto de antes:** se
   veían todos siempre.
3. ✅ Esperado: el formulario de alta viene con esa sucursal ya elegida.
4. Si esa sucursal no tiene cajeros, ✅ Esperado: el vacío dice "No hay cajeros en {nombre de la
   sucursal}." — no el genérico "Todavía no hay cajeros".
5. Volvé la pastilla a "Todas".
6. ✅ Esperado: vuelven a aparecer todos los cajeros del comercio, y el alta preselecciona la
   **Principal**. **CAMBIO respecto de antes:** el selector arrancaba en "Elegí una sucursal".

**Resumen:**
1. Con una sucursal elegida, andá a `/comercio/panel`.
2. ✅ Esperado: debajo de las dos métricas grandes aparece una tarjeta **"Actividad en {sucursal}"**
   con la etiqueta "contexto activo" y tres números: Clientes, Visitas, Premios.
3. Elegí una sucursal sin movimientos todavía.
4. ✅ Esperado: la tarjeta igual aparece, en cero. La sucursal que elegiste siempre se ve; no
   desaparece por no tener actividad.
5. Volvé a "Todas".
6. ✅ Esperado: la tarjeta desaparece y el Resumen queda como antes.

---

## 17. Caso borde — cajero cuya sucursal fue desactivada

1. Como dueño, creá (o usá) un cajero asignado a una sucursal NO principal.
2. Desde `/comercio/sucursales`, desactivá esa sucursal.
3. Con la pastilla en **"Todas"**, andá a `/comercio/cajeros`.
4. ✅ Esperado: el cajero SIGUE en la lista, con la pastilla roja/gris **"Sucursal desactivada"** y
   abajo el texto "No puede operar hasta que reactives la sucursal o le crees una cuenta en otra."
   Sigue visible justamente para que puedas darlo de baja.
5. Elegí otra sucursal en la pastilla del header y volvé a la lista.
6. ✅ Esperado: ese cajero NO aparece (el filtro es por la sucursal activa). Para verlo hay que
   estar en "Todas".
7. Cerrá sesión, entrá como ese cajero y mirá el header.
8. ✅ Esperado: bajo el nombre del comercio dice **"Sin sucursal activa"**. **CAMBIO respecto de
   antes:** el header seguía mostrando el nombre de su sucursal como si nada.
9. Andá a `/comercio/escanear`.
10. ✅ Esperado: "Tu sucursal está desactivada. Contactá al dueño para que la reactive o te
    reasigne a otra." y no hay escáner ni forma de acreditar.
11. Como dueño, reactivá la sucursal y volvé a entrar como el cajero.
12. ✅ Esperado: el aviso desaparece, el header vuelve a decir "Comercio · Sucursal" y puede
    acreditar de nuevo.

---

## 18. Modal "¿Qué estás creando?" — sucursal

El botón de la pantalla Sucursales ya no abre un formulario directo: abre un modal que pregunta
primero qué querés crear.

**Desde la pantalla Sucursales:**
1. `/comercio/sucursales` → tocá "Agregar local".
2. ✅ Esperado: sube un panel con el título "¿Qué estás creando?" y dos opciones: **Sucursal**
   ("Otro local que usa la misma tarjeta de {tu comercio}.") y **Comercio nuevo** ("Otra marca, con
   su propia tarjeta e identidad.").
3. Elegí "Sucursal".
4. ✅ Esperado: un solo campo de nombre y la aclaración de que va a usar la misma tarjeta y el
   mismo QR de registro de tu comercio.
5. Tocá "Volver". ✅ Esperado: regresa a la pregunta inicial sin perder el modal.
6. Elegí "Sucursal" otra vez, poné un nombre y tocá "Agregar sucursal".
7. ✅ Esperado: el modal se cierra solo y la sucursal nueva ya está en la lista de atrás.
8. Tocá el fondo oscuro o Escape con el modal abierto. ✅ Esperado: cierra sin crear nada.

**Desde el switcher (el camino que cruza pantallas):**
1. Estando en cualquier pantalla, abrí la pastilla del header y tocá "Agregar local…".
2. ✅ Esperado: te lleva a `/comercio/sucursales` **con el modal ya abierto** en la pregunta
   "¿Qué estás creando?".
3. Cerrá el modal (fondo o Escape) y mirá la barra de direcciones.
4. ✅ Esperado: la URL vuelve a `/comercio/sucursales` limpia, sin `?agregar=1`.
5. Recargá la página.
6. ✅ Esperado: el modal NO se reabre solo. (Si se reabre, la URL se quedó con el parámetro — eso
   sí sería un bug.)

**Caso borde — sin cupo:**
1. Con la cuenta llena (sección 12), volvé a `/comercio/sucursales`.
2. ✅ Esperado: no hay botón "Agregar local" en absoluto; en su lugar está el aviso del límite. El
   modal no se puede abrir ni desde ahí ni por `?agregar=1`.

---

## 19. Modal "¿Qué estás creando?" — comercio nuevo (self-serve)

**CAMBIO respecto de antes:** hasta ahora solo FM podía crear un comercio. Ahora el dueño puede,
siempre que su cuenta tenga cupo.

1. Abrí el modal y elegí "Comercio nuevo".
2. ✅ Esperado: dos campos — nombre del comercio y tipo de tarjeta (solo los tipos que funcionan
   hoy: puntos y sellos, como radios con su descripción), más la aclaración "Al crearlo te llevamos
   al editor de marca para configurar su identidad."
3. Poné un nombre y tocá "Crear comercio".
4. ✅ Esperado: aterrizás en la pantalla **Marca** (`/comercio/branding`) con un aviso arriba: "Tu
   comercio nuevo ya está creado. Este es su editor de marca…".
5. Mirá el header.
6. ✅ Esperado: la marca del header ya es el **comercio nuevo** (cambió bajo tus pies, por eso el
   aviso), y la pastilla dice "Todas".
7. Abrí la pastilla.
8. ✅ Esperado: el comercio nuevo está en la lista, con UNA sucursal: su Principal.
9. Andá a `/comercio/sucursales` del comercio nuevo.
10. ✅ Esperado: una sola fila, "Principal", marcada como principal y sin botón de desactivar.
11. Mirá la tarjeta en el editor de marca antes de tocar nada.
12. ✅ Esperado: nace con colores legibles (fondo oscuro, texto claro, etiquetas naranjas), no
    blanco sobre blanco.
13. En FM admin, abrí la cuenta del dueño.
14. ✅ Esperado: el comercio nuevo aparece vinculado a la MISMA cuenta que el comercio desde el que
    lo creaste, y el cupo subió en 1 (por el comercio; su Principal no cuenta).
15. Volvé al switcher y cambiá al comercio viejo y de nuevo al nuevo.
16. ✅ Esperado: se puede ir y venir; el dueño quedó como owner de los dos.

**Caso borde — comercio sin cuenta asociada:**
1. Si algún comercio tuyo no tiene cuenta (legado), abrí el modal desde ahí.
2. ✅ Esperado: la opción "Comercio nuevo" se ve apagada y no se puede tocar, con el motivo abajo:
   "Tu comercio no está asociado a una cuenta — contactá a FM." La opción "Sucursal" sigue viva.

---

## 20. Reportes conglomerado

**CAMBIO respecto de antes:** la pantalla mostraba solo el comercio activo; ahora muestra TODOS tus
comercios juntos y se filtra con chips.

1. Como dueño con 2+ comercios, andá a `/comercio/reportes`.
2. ✅ Esperado: arriba, una fila de chips: "Todo" (activo) + un chip por cada comercio tuyo.
3. ✅ Esperado: las métricas de cabecera (Visitas acreditadas / Premios canjeados) suman TODOS tus
   comercios, y más abajo hay un bloque por comercio, cada uno con sus sucursales.
4. ✅ Esperado: los comercios sin actividad no ocupan un bloque vacío cada uno: se nombran juntos
   en una línea "Sin actividad todavía: X, Y."
5. ✅ Esperado: en "Clientes más frecuentes", cada persona lleva al lado el nombre del comercio (una
   misma persona puede aparecer dos veces si tiene tarjeta en dos comercios tuyos — son tarjetas
   distintas, es correcto).
6. Tocá el chip de un comercio.
7. ✅ Esperado: aparece una SEGUNDA fila de chips con sus sucursales ("Todas" + una por sucursal,
   incluidas las desactivadas para poder consultar su histórico), y todo lo de abajo se reduce a
   ese comercio.
8. Tocá el chip de una sucursal.
9. ✅ Esperado: quedan la tarjeta de esa sucursal y las métricas de cabecera con SUS números, y
   **desaparecen la tendencia de los últimos 14 días y el top de clientes**, con la nota "Al
   filtrar por sucursal se ocultan la tendencia y el top de clientes: esos reportes solo existen
   por comercio." más el enlace "Quitar el filtro de sucursal →". Es intencional, no un bug.
10. Tocá ese enlace. ✅ Esperado: vuelve a la vista del comercio, con tendencia y top.
11. Tocá "Todo". ✅ Esperado: vuelve al conglomerado.
12. **Ojo con esto:** cambiá la sucursal en la pastilla del header y volvé a Reportes.
13. ✅ Esperado: Reportes **IGNORA** la pastilla — se filtra solo con sus propios chips. Es a
    propósito (la pantalla es del conjunto, no del contexto operativo), pero es lo más fácil de
    confundir con un bug de esta sesión.
14. Con un dueño de UN SOLO comercio, abrí la pantalla.
15. ✅ Esperado: el texto de arriba dice "Cómo se mueve tu programa de lealtad por sucursal" y las
    cartas van bajo el título "Por sucursal" (sin repetir el nombre del comercio en cada bloque).
16. Acreditá algo desde el escáner eligiendo una sucursal, volvé a Reportes.
17. ✅ Esperado: esa visita cayó en la carta de esa sucursal, y la Principal aparece etiquetada
    "Principal" en su carta.

---

## 21. Panel de FM — el cupo ya no cuenta las Principales

**Lista de cuentas:**
1. `/admin/cuentas`.
2. ✅ Esperado: el número usado de cada cuenta es comercios + sucursales **adicionales**. Una cuenta
   con 1 comercio y solo su Principal muestra **1 de N**, no 2. **CAMBIO respecto de antes.**
3. ✅ Esperado: la pastilla "Llena" aparece solo cuando el cupo está realmente agotado según esa
   cuenta.

**Ficha de una cuenta (el bug que escondía el formulario):**
1. Abrí una cuenta Growth (límite 2) que tenga 1 comercio con su Principal.
2. ✅ Esperado: dice **1 de 2** y el formulario de "vincular comercio" **está a la vista**. Antes se
   veía 2 de 2 y la pantalla escondía el formulario, aunque el servidor sí aceptaba el vínculo —
   ese era el desfase.
3. Vinculá un comercio disponible.
4. ✅ Esperado: lo acepta y pasa a 2 de 2 con la pastilla "Llena"; ahí sí desaparece el formulario.
5. Intentá vincular uno más (desde otra cuenta o reabriendo).
6. ✅ Esperado: rechazado, con el mensaje del límite ("Esta cuenta ya alcanzó su límite de 2
   negocio(s)/sucursal(es)."). El número que ves en pantalla y el que aplica el sistema ahora
   coinciden — ese es el punto de esta sección.

---

## 22. Panel de FM — eliminar un comercio

Eliminar ahora retira la sucursal Principal antes del borrado, y la repone **idéntica** si el
borrado no procede. Las sucursales que agregó el dueño siguen bloqueando el borrado.

**Borrado que SÍ procede:**
1. Creá un comercio de prueba desde FM y no le hagas nada más (sin clientes, reglas, recompensas,
   cajeros ni movimientos). Nace con su Principal.
2. `/admin/comercios/[ese comercio]/editar` → "Eliminar comercio" → confirmá.
3. ✅ Esperado: se borra. **CAMBIO respecto de antes:** con la 0012 todo comercio nace con una
   sucursal, así que sin este arreglo NINGÚN comercio sería borrable nunca — el error diría
   "tiene datos asociados" mintiendo.

**Borrado que NO procede — sucursal agregada por el dueño:**
1. Tomá un comercio de prueba y agregale una segunda sucursal (además de la Principal).
2. Intentá eliminarlo desde FM.
3. ✅ Esperado: rechazado, con "No se puede eliminar: tiene datos asociados (tarjetas, reglas de
   puntos, recompensas o sucursales)…".
4. **Lo importante:** entrá como dueño a `/comercio/sucursales` de ese comercio.
5. ✅ Esperado: la Principal **sigue ahí, con el mismo nombre de antes**, primera en la lista y
   marcada como principal. Si desapareció o se llama "Principal" cuando vos le habías puesto otro
   nombre, eso sí es un bug — reportalo.

**Borrado que NO procede — la Principal tiene actividad:**
1. Tomá un comercio de prueba cuya Principal tenga un cajero asignado (o movimientos atribuidos).
2. Intentá eliminarlo.
3. ✅ Esperado: mensaje distinto y más preciso: "No se puede eliminar: la sucursal principal tiene
   actividad asociada (cajeros, transacciones o canjes)…" — no el genérico de tarjetas/reglas, que
   te mandaría a buscar algo que no existe.
4. ✅ Esperado (igual que arriba): la Principal sigue intacta después del rechazo.

---

## 23. Otros casos borde que vale la pena forzar

1. **Sucursal desactivada mientras la tenías elegida:** con la sucursal X en la pastilla, desde otra
   sesión (o antes de recargar) desactivala y recargá.
   ✅ Esperado: el contexto cae solo a "Todas" — no queda una pastilla apuntando a una sucursal
   apagada.
2. **Dos comercios y la sucursal del otro:** elegí una sucursal en el comercio A, cambiá al B.
   ✅ Esperado: B arranca en "Todas", nunca con una sucursal de A.
3. **Doble toque en "Crear comercio":** tocá el botón dos veces rápido.
   ✅ Esperado: se crea UN solo comercio. (Dos comercios duplicados consumirían dos unidades del
   plan y el dueño no puede borrarlos — los tendría que limpiar FM a mano. Si pasa, reportalo.)
4. **Cajero y el switcher:** logueado como cajero, mirá el header.
   ✅ Esperado: NO hay pastilla de contexto. Su sucursal sale de su membresía y él no puede
   cambiarla.
5. **Comercio nuevo y el nav:** con un comercio recién creado (sin premios ni reglas), recorré la
   nav.
   ✅ Esperado: las 9 secciones están y ninguna revienta por falta de datos; muestran su vacío.
6. **Reportes con un solo comercio y sin actividad:** abrí Reportes en un comercio nuevo.
   ✅ Esperado: "Todavía no hay actividad registrada." y la tendencia dice "Aún no hay movimientos
   para graficar." — sin pantalla en blanco ni error.

---

## Qué NO está cubierto (para que sepas dónde pisás)

- **No hay verificación visual automatizada de nada de esta parte.** Todo lo que dice esta guía
  sobre cómo se ve algo (anchos, cortes de texto, qué entra en la pantalla, si el panel tapa o no)
  salió de calcular sobre el CSS, no de mirar un teléfono. La sección 10 existe por eso.
- **La app no tiene tests de UI.** Las pruebas automatizadas cubren la lógica (capa de datos, cupo,
  contexto, filtros, permisos por rol), no componentes ni pantallas. Los 3 archivos de Playwright
  que hay en `e2e/` son de antes (registro de cliente, branding del dueño, comercios de FM) y
  ninguno toca el nav, la pastilla, el switcher, el modal ni los reportes de esta sesión.
- **El corte del nombre en la pastilla es un compromiso aceptado, no un pendiente.** Se evaluó
  agrandarla y solo mueve el recorte al nombre del comercio. Si en el teléfono resulta que "Centro
  Santa…" no alcanza para distinguir sucursales, ahí sí hay que rediseñarlo — pero con evidencia de
  la pantalla real.
- **Reportes por sucursal es parcial a propósito:** tendencia y top de clientes solo existen por
  comercio; no hay versión por sucursal y quedó explícitamente fuera de alcance.
- **La ventana sin atomicidad al eliminar un comercio:** si el proceso muere justo entre el retiro
  de la Principal y el borrado, el comercio puede quedar sin Principal. Es improbable y no se puede
  provocar a mano; si alguna vez ves un comercio sin Principal en el script de verificación, esta
  es la causa a mirar primero.

---

## Limpieza de la Parte 2

Además de lo de la Parte 1: los comercios que crees con el alta self-serve **no los puede borrar el
dueño** — se eliminan desde FM admin (`/admin/comercios/[id]/editar`), y solo si no tienen
actividad ni sucursales extra. Si creaste varios para probar la sección 19, conviene limpiarlos ahí
mismo para que no te sigan comiendo cupo del plan de la cuenta.

---

# Parte 3 — Marca nueva y alta de dueños por link (2026-07-26)

Dos cosas entraron después de la Parte 2: el **rebranding a Cardly SV** con dominio propio, y el
**alta de dueños con link de invitación**, que reemplaza al script `npm run seed-comercio`.

**Antes de empezar:** verificá que en Vercel `NEXT_PUBLIC_BASE_URL` sea `https://cardly-sv.site` y
que hayas redesplegado después de cambiarla. Si no, los links que generes van a apuntar al dominio
viejo — funcionan, pero le mandás a tu cliente un enlace que no dice Cardly.

---

## 24. La marca, de un vistazo

1. Abrí `cardly-sv.site` (la portada pública).
   ✅ Esperado: dice **Cardly SV**, y abajo "FM Communications" como empresa. El texto habla de "tu
   negocio", no de "tu cafetería".
2. Mirá el título de la pestaña del navegador y, si instalaste la app del cliente, su nombre.
   ✅ Esperado: "Cardly SV" y "Mi Tarjeta — Cardly SV".
3. Entrá al login del comercio y al de FM.
   ✅ Esperado: los dos dicen Cardly SV. **CAMBIO respecto de antes.**
4. Abrí el portal del cliente (`/mi-tarjeta`) y una pantalla de registro (`/registro/<slug>`).
   ✅ Esperado: Cardly SV en ambas, y en la tarjeta que se dibuja arriba también.
5. Abrí un pass que ya tengas en la billetera.
   ✅ Esperado: **no cambió nada** — el pass muestra el nombre del comercio, nunca la marca de la
   plataforma. Si cambió algo acá, reportalo.

---

## 25. Dar de alta el dueño de un comercio (el flujo nuevo)

Reemplaza a correr `npm run seed-comercio` en la terminal. **Vos ya no elegís ni conocés la
contraseña de tu cliente.**

1. En FM admin, entrá a editar un comercio (`/admin/comercios/[id]/editar`) y bajá hasta la lista
   de dueños.
   ✅ Esperado: si no tiene ninguno, el vacío dice que generes el acceso abajo (ya **no** menciona
   el script). **CAMBIO respecto de antes.**
2. Escribí el correo del dueño y tocá **"Generar acceso"**.
   ✅ Esperado: aparece el link completo, en un bloque fácil de copiar desde el teléfono, con el
   correo al que corresponde y el aviso de que vence en 24 horas.
3. Fijate en la lista de dueños.
   ⚠️ El dueño nuevo **no aparece hasta que recargues** la página: es a propósito, recargar
   automáticamente se llevaría puesto el link, que solo existe en pantalla. Recargá y confirmá que
   ahora sí figura con rol `owner`.
4. Copiá el link y mandátelo a vos mismo **por WhatsApp** (no lo pegues directo en el navegador:
   ver la sección 27, que es justo el caso que falló la primera vez).
5. Abrilo desde el teléfono.
   ✅ Esperado: pantalla **"Activá tu acceso"** con un botón. Abrir el link NO activa nada todavía.
6. Tocá "Activar mi acceso".
   ✅ Esperado: pasás a "Definí tu contraseña", con tu correo a la vista.
7. Poné una contraseña de 8+ caracteres, repetila y guardá.
   ✅ Esperado: entrás directo al panel del comercio, ya con sesión.
8. Cerrá sesión y volvé a entrar con ese correo y esa contraseña.
   ✅ Esperado: entra normal. **Esa clave no la conoce nadie más que el dueño.**

---

## 26. Regenerar el link (link vencido u olvidó la contraseña)

1. En la lista de dueños, tocá **"Regenerar link"** junto a uno existente.
   ✅ Esperado: link nuevo, mismo comportamiento que el del alta.
2. Fijate en los **cajeros** de la lista.
   ✅ Esperado: se listan (para que veas quién entra) pero **sin botón de regenerar**, con la nota
   de que los da de alta el dueño desde su panel. Es a propósito: regenerarle el acceso a un cajero
   sería entregarte a vos un cambio de contraseña de un empleado de tu cliente.
3. Probá regenerar para un dueño que **nunca abrió** su primer link.
   ✅ Esperado: funciona igual, sin errores.

---

## 27. Los casos borde del link (acá está lo que ya falló una vez)

1. **Compartir por WhatsApp — el caso que rompió en producción el 2026-07-26.** Generá un link
   nuevo, pegalo en WhatsApp, esperá a que se arme la vista previa, y recién ahí tocalo.
   ✅ Esperado: funciona. Aparece "Activá tu acceso" y al tocar el botón entrás.
   ⚠️ **Por qué importa:** antes el link se canjeaba con solo abrirlo, y los servidores de WhatsApp
   lo abren solos para armar la vista previa del mensaje — o sea que el preview quemaba el token y
   el cliente llegaba a "ese link ya no sirve" sin haber hecho nada. Si alguna vez alguien mueve el
   canje de vuelta al momento de abrir la página, esto vuelve a romperse. **Probalo siempre por
   WhatsApp, no pegando el link en el navegador: pegarlo directo no reproduce el problema.**
2. **Abrir el mismo link dos veces.** Después de activar, volvé a tocar el link en el chat.
   ✅ Esperado: te lleva a "Definí tu contraseña" (porque la sesión ya existe), no a un error.
3. **Abrir un link ya usado desde OTRO teléfono** (sin sesión).
   ✅ Esperado: login con "Ese link de acceso ya no sirve: se usa una sola vez y vence a las 24
   horas. Pedile a FM un link nuevo."
4. **Link mal copiado** (borrale unos caracteres al final y abrilo).
   ✅ Esperado: "Link incompleto" con un enlace al inicio de sesión. No una pantalla rota.
5. **Definir la contraseña que ya tenías** (en un dueño que ya la había definido): abrí un link
   nuevo y escribí su clave actual.
   ✅ Esperado: mensaje pidiendo una distinta, con la salida "Entrá a tu panel" — no quedás
   atrapado en esa pantalla.
6. **Correo que ya es cajero de ESE comercio:** intentá generarle acceso de dueño.
   ✅ Esperado: rechazo explicando que ese correo ya está registrado como cajero y que hay que usar
   otro. **No** dice "dalo de baja primero": la baja de cajeros es lógica y la fila se conserva para
   el historial, así que el correo seguiría ocupado. **CAMBIO respecto de antes** (esto antes daba
   un "éxito" con link válido y la persona entraba sin permisos de dueño).
7. **Correo que ya es dueño de OTRO comercio:** generale acceso en este.
   ✅ Esperado: funciona; queda como dueño de los dos y el switcher del header le muestra ambos.

---

## Qué NO está cubierto (Parte 3)

- **No hay servicio de correo.** Los links se reparten a mano (WhatsApp). Si algún día se agrega
  envío de emails, este flujo se simplifica pero el canje debe seguir detrás del botón: los
  escáneres de seguridad de las casillas corporativas abren los links igual que WhatsApp.
- **La expiración de 24 horas es la de Supabase**, configurable en su panel, no en el código.
- **El link no se guarda en ningún lado:** si cerrás la pantalla sin copiarlo, hay que regenerarlo.
  Es a propósito (una credencial menos viviendo en la base).
- **Si una fila de `usuarios_comercio` tuviera `auth_user_id` en NULL** (solo pasaría insertándola a
  mano en Studio), el dueño completaría todo el flujo y chocaría con "sin permiso" al final. Hoy no
  hay ninguna así; si aparece ese síntoma, es lo primero a mirar.

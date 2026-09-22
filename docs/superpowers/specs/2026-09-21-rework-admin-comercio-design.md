# Rework de navegación: admin de FM y panel del comercio

**Fecha:** 2026-09-21 · **Estado:** diseño aprobado por Daniel (brainstorming + companion visual), sin
implementar. Depende de `docs/superpowers/specs/2026-09-21-cobranza-design.md` (aprobada, tampoco
implementada) para la pestaña "Cobranza" de la ficha de cuenta: esta spec define DÓNDE vive y qué
controles muestra; la lógica de negocio (`estadoDeCobranza`, migración `0038`, las acciones de posponer/
perdonar/exentar/pedir un pago) es la de esa spec, y se implementan juntas.

## Por qué

El admin de FM y el panel del comercio crecieron por acumulación de features (Wompi, cobranza que se
viene) y Daniel se pierde probando. Dos quejas concretas:
1. En el admin, "Comercios" es una pestaña separada de "Cuentas" cuando lo que le importa es la cuenta
   (el cliente que paga); entrar a una cuenta ya muestra sus negocios y sus cobros, así que la lista
   global de comercios es un camino de más. Y no hay una pantalla de entrada: `/admin` no lleva a ningún
   lado.
2. En el panel del comercio, la pantalla de Marca es un formulario de ~900 líneas en un solo scroll
   (colores, imágenes, franja, reverso, redes sociales, todo seguido).

## Decisiones de Daniel (2026-09-21, brainstorming + companion visual)

1. **"Comercios" desaparece del nav del admin, sin dejar una búsqueda global** — un comercio se ve y se
   edita entrando primero a su cuenta.
2. **"Nuevo comercio" deja de poder crearse suelto** — siempre nace desde adentro de una cuenta (nueva o
   existente).
3. **La pestaña se sigue llamando "Cuentas"** (no "Clientes": ese nombre ya lo usa el panel del comercio
   para sus clientes finales, y mezclarlos confundiría).
4. **Pantalla de entrada nueva: un dashboard**, con estas 6 cosas (companion visual, layout **A** — grilla
   pareja: 4 tarjetas urgentes arriba, cartera en chico debajo, actividad al final):
   - Pagos que necesitan atención
   - Ingresos del mes
   - Cuentas vencidas o bloqueadas
   - Solicitudes de plan pendientes
   - Tamaño de la cartera (cuentas, comercios, clientes)
   - Actividad reciente
5. **La ficha de una cuenta se parte en pestañas** (Datos · Negocios · Cobros · Cobranza) — crece con
   cobranza y ya no entra cómoda en una sola pantalla apilada.
6. **La pantalla de Marca del comercio se parte en pestañas** (Colores · Imágenes · Franja · Reverso),
   companion visual, layout **C**: una pestaña ocupa toda la pantalla, sin acordeón — así nunca hay scroll
   largo, a costa de perder la vista de conjunto (aceptado a propósito).
7. **El menú "más opciones" del comercio se agrupa con subtítulos**, sin cambiar qué hay: Reportes se
   queda destacado arriba; el resto se separa en "Tu programa" (Reglas, Programas, Notificaciones), "Tu
   equipo y locales" (Sucursales, Cajeros) y "Cuenta" (Mi plan).

## Supuestos míos, a confirmar (cada uno con lo que pasa si no)

| Supuesto | Si no |
|---|---|
| El dashboard reemplaza a `/admin` (hoy sin página propia): el logo del header pasa a ser un link ahí. No se agrega una pestaña "Dashboard" nueva al nav — sería redundante con el logo. | Se agrega una pestaña explícita "Inicio". |
| "Reportes" y "Solicitudes" **no cambian**: siguen siendo pantallas propias en el nav. El dashboard solo les apunta (el número de solicitudes pendientes, por ejemplo, linkea a `/admin/solicitudes`). | Se fusionan en otro lado. |
| "Ingresos del mes" = suma de `cobros.monto` donde `estado = 'pagado'` y `pagado_en` cae en el mes de calendario actual (zona El Salvador), sin importar el método (Wompi o registrado a mano por FM). | Se acota a un método, o a un rango de 30 días en vez de mes calendario. |
| "Tamaño de la cartera" = cuentas totales, comercios totales, y clientes = clientes DISTINTOS con al menos una tarjeta (no la suma de tarjetas: un cliente con tarjetas en dos comercios del piloto cuenta una vez). | Se cuenta por tarjeta, no por cliente. |
| "Actividad reciente" mezcla tres fuentes (pagos aplicados, cuentas nuevas, solicitudes nuevas), 5 de cada una, ordenadas por fecha y recortadas a las 8 más recientes. No incluye cobros registrados a mano sin pasar por un evento de pago (ver abajo). | Se agrega una cuarta fuente, o se ajustan los recortes. |
| Un cobro que FM **registra a mano** (`accionRegistrarCobro`, sin pasar por `confirmarPagoCobro`) no genera un evento en `pagos_wompi`, así que hoy no aparecería en "Ingresos del mes" ni en "Actividad reciente" si se calculan solo desde `pagos_wompi`. Por eso "Ingresos del mes" se calcula desde `cobros` (que sí lo tiene) y no desde `pagos_wompi`; "Actividad reciente" sí se queda corta en ese caso — es un costo aceptado, no todos los cobros manuales necesitan aparecer como "actividad". | Se agrega una cuarta fuente para cobros registrados a mano. |
| "Cuentas vencidas o bloqueadas" necesita `estadoDeCobranza` de la spec de cobranza — **hasta que esa migración y esa función existan, esta tarjeta del dashboard no se puede construir con sentido**. Se implementa junto con la Tarea 3 de la spec de cobranza (ver "Orden de entrega" abajo), no antes. | Se pospone esa tarjeta sola, dashboard sin ella primero. |

## Diseño: admin de FM

### Lista de cuentas (`app/admin/(protegido)/cuentas/page.tsx`)

Cada fila lleva una **insignia de estado** (`pastilla`, mismo componente visual que ya usan `/admin/pagos`
y los cobros): `Al día`, `Vencida`, `Bloqueada`, `Exenta` o `Pospuesta`, calculada con el mismo
`estadoEfectivo` que el gate y el dashboard (ver "Unificación con `licencia_estado`" más abajo). Es lo que
la spec de cobranza da por asumido ("la lista de cuentas lleva una insignia de estado por cuenta… el
rework del admin reorganiza todo esto") y que sin esta sección quedaba sin dueño.

**Convive con la pastilla de cupo que ya existe** (`Llena`/`Con cupo`, al borde derecho de cada fila,
segundo hijo de un `.admin-fila` con `justify-content: space-between`): NO la reemplaza. Van **las dos**,
envueltas en un `<div style={{ display: 'flex', gap: 8 }}>` que pasa a ser ese segundo hijo — la de
cobranza PRIMERO (más a la izquierda): es la que cambia de color con más significado (bloqueada en rojo,
vencida en ámbar, al día en verde, exenta/pospuesta en gris) y la que FM necesita ver primero para decidir
si entrar a esa cuenta es urgente. **A verificar en el navegador al implementar** (nombres de cuenta
reales son cortos, pero a 320-360px dos pastillas + el nombre + el ícono pueden apretar): si no entran
cómodas una al lado de la otra, se apilan verticalmente con el mismo `gap` en vez de en fila — es un
`flex-direction: column` condicional, no cambia qué información se muestra.

### Nav (`app/admin/(protegido)/layout.tsx`)

Se saca el link "Comercios". El logo/marca (`<span className="admin-marca">…`) pasa a ser un
`<Link href="/admin">`. Queda: **(logo→dashboard)** · Cuentas · Reportes · Solicitudes · Pagos · tema ·
Salir. Mismo criterio de "defensa en profundidad" que ya tiene el layout: el gate real vive en
`verifyFmAdmin()` de cada página.

**Sacar el link no alcanza: las rutas siguen vivas por URL directa, y una de ellas es justo lo que la
Decisión 2 dice que deja de existir.** Hoy `app/admin/(protegido)/comercios/` tiene cuatro páginas:
`page.tsx` (la lista global), `nuevo/page.tsx` (alta suelta — con un `<select>` de TODAS las cuentas,
exactamente lo que "Nuevo comercio deja de poder crearse suelto" dice que no debe poder pasar más),
`[id]/editar/page.tsx` y `[id]/clientes/page.tsx`. `[id]/editar` y `[id]/clientes` ya se alcanzan hoy
desde la ficha de cuenta (el link de cada fila de "Negocios de esta cuenta") y **se quedan, con las
consultas y acciones que ya tienen**, ahora como el único camino para llegar ahí. Pero `page.tsx` y
`nuevo/page.tsx` **se BORRAN** (no se dejan huérfanas: mientras existan, siguen siendo accesibles
tecleando la URL, y la Decisión 2 seguiría sin cumplirse de verdad).

**Borrar `page.tsx` deja tres lugares apuntando a una URL que ya no existe** (ninguno es el nav, que ya se
cubrió arriba — la búsqueda anterior por `href="..."` se perdió los `redirect(...)`, que no llevan
`href`):
1. `app/admin/login/actions.ts` (`iniciarSesion`): al loguearse, redirige a `/admin/comercios`. Pasa a
   redirigir a **`/admin`** (el dashboard nuevo) — es, de hecho, el arreglo correcto de una vez: FM entra
   directo a la pantalla que le importa, en vez de a la lista que se está borrando.
2. `accionActualizarComercio` (`app/admin/(protegido)/comercios/actions.ts`): al guardar cambios de un
   comercio, redirige a `/admin/comercios`. El formulario YA manda `cuenta_id` (es un campo del propio
   `FormularioComercio`), así que la acción lo lee de `formData` y redirige a
   **`/admin/cuentas/${cuentaId}`** — vuelve a la cuenta dueña de ese comercio, no a una lista.
3. `accionEliminarComercio`: al borrar un comercio, redirige a `/admin/comercios`. Antes de borrarlo, lee
   a qué cuenta pertenecía (`comercios.cuenta_id` del propio registro) y redirige ahí
   (**`/admin/cuentas/${cuentaId}`**), o a **`/admin/cuentas`** si el comercio no tenía cuenta asignada
   (caso raro, pero posible).

`accionCrearComercio` (la de `comercios/nuevo`) sí se borra entera junto con su página — nada más la
usa.

**Alta de un comercio nuevo, desde la ficha de cuenta (pestaña Negocios):** se agrega un formulario
"Nuevo comercio" ahí, además del "Vincular" que ya existe (que solo ata un comercio YA CREADO — no sirve
para esto). Reusa `FormularioComercio` (el mismo de `[id]/editar`) con `cuentas={[{ id: cuentaId, nombre:
cuenta.nombre }]}` — un array de UNA sola cuenta, la de la página en la que está parado: el `<select>`
quéda con una sola opción, ya elegida, sin dar vuelta a elegir otra cuenta por error. Una Server Action
nueva, `accionCrearComercioDeCuenta` (`cuentas/actions.ts`, patrón `.bind(null, cuentaId)` como el resto
de las acciones de esa ficha), delega en el mismo `crearComercio` de `lib/comercios/guardarComercio.ts`
(sin cambios ahí) y redirige a `/admin/cuentas/${cuentaId}` en vez de a `/admin/comercios`.

**Orden visual en la pestaña Negocios:** `FormularioVincular` (existente, un `<select>` + un botón) va
PRIMERO — es la acción más común (reasignar un comercio suelto) y no crece la pantalla. "Nuevo comercio"
(el `FormularioComercio` completo: 9 campos + vista previa de tarjeta) va DESPUÉS, dentro de un `<details>`
plegado por defecto ("+ Crear un comercio nuevo"): es la acción menos frecuente y la más pesada visualmente
de las dos, así que no debe ser lo primero que se vea al abrir la pestaña.

### El dashboard (`app/admin/(protegido)/page.tsx`, nuevo)

Server Component. Llama a `verifyFmAdmin()` primero (mismo patrón que toda página de `/admin`). Junta las
6 métricas con `Promise.all` y las dibuja con el layout A: una fila de 4 `metric-carta` arriba, una fila
chica con la cartera, y una lista de actividad reciente abajo. De las 4 tarjetas de arriba, tres linkean a
una pantalla propia (Pagos → `/admin/pagos`, Vencidas/bloqueadas → `/admin/cuentas`, Solicitudes →
`/admin/solicitudes`); **"Ingresos del mes" NO linkea a ningún lado** — no existe una pantalla de
"ingresos" en el admin y esta spec no agrega una, así que esa tarjeta es solo el número, sin link.

**Módulo nuevo `lib/fm/dashboard.ts`** (capa de datos, sin JSX — mismo criterio que `reporteCajeros` en
`lib/reportes/reportes.ts`: "`null` ante un error, nunca un cero falso". Es la EXCEPCIÓN deliberada de ese
archivo, no su regla general — el resto de `reportes.ts` es fail-soft con `[]`; acá se sigue la excepción
a propósito, porque un dashboard con un cero falso es tan engañoso como un reporte de auditoría vacío):

- `ingresosDelMes(supabase, hoy)`: `number | null`. `hoy` es `AAAA-MM-DD` (zona El Salvador,
  `hoyEnZona(null)`); el primer día del mes se calcula de `hoy`, no del reloj del servidor. Consulta
  `cobros` (`estado = 'pagado'`, `pagado_en` entre el primero del mes y `hoy`), suma `monto`.
- `tamanoDeCartera(supabase)`: `{ cuentas: number; comercios: number; clientes: number } | null`. Tres
  conteos (`select('id', { count: 'exact', head: true })`); `clientes` es `count distinct` sobre
  `tarjetas.cliente_id` (una consulta agregada, o `clientes` completo si no hay clientes sin ninguna
  tarjeta — a confirmar contra el esquema real al implementar).
- `contarSolicitudesPendientes(supabase)`: `number | null`. Mismo criterio que
  `contarPagosAtencion` (`lib/comercios/pagosAdmin.ts`): `count` con `estado = 'pendiente'`.
- `contarCuentasEnRiesgo(supabase, hoy)`: `number | null`. Lee `cuentas_comercio` (columnas de cobranza +
  `licencia_estado` + `id`) y `cobros` (`tipo = 'periodo'`, `estado = 'pagado'`) en DOS consultas (no una
  por cuenta), arma el mapa cuenta→períodos pagados, y para cada una llama `estadoEfectivo` (que envuelve
  a `estadoDeCobranza`, ver "Unificación con `licencia_estado`" en la ficha de cuenta más abajo); cuenta
  las que dan `vencida` o `bloqueada` (el nombre de la tarjeta en el dashboard es "Cuentas vencidas o
  bloqueadas": las dos cuentan, no solo las ya bloqueadas). La tarjeta linkea a `/admin/cuentas` (con la
  insignia de cada fila ya visible ahí — ver esa sección).
- `actividadReciente(supabase, limite)`: junta `pagos_wompi` (`conciliacion = 'aplicado'`, con el nombre
  de cuenta), `cuentas_comercio` (por `created_at`) y `solicitudes_plan` (por `created_at`), 5 de cada
  una, y llama a la función PURA `fusionarActividad` (abajo) para ordenar y recortar. `null` si CUALQUIERA
  de las tres consultas falla (una actividad a medias es peor que ninguna: parecería que no pasó nada).

**Módulo nuevo `lib/fm/actividad.ts`** (puro, con su tabla de mutaciones):

```ts
export type EventoActividad =
  | { tipo: 'pago'; fecha: string; cuentaNombre: string | null; monto: number; cuentaId: string | null }
  | { tipo: 'cuenta_nueva'; fecha: string; cuentaNombre: string; cuentaId: string }
  | { tipo: 'solicitud'; fecha: string; cuentaNombre: string | null; planSolicitado: string; cuentaId: string };

export function fusionarActividad(eventos: EventoActividad[], limite: number): EventoActividad[];
```

Ordena por `fecha` descendente (los `created_at` de las tres fuentes son comparables como texto ISO) y
recorta a `limite`. `fecha` empatada: se conserva el orden de entrada (estable), no hace falta desempate.

### La ficha de cuenta, con pestañas (`app/admin/(protegido)/cuentas/[id]/page.tsx`)

Mismo patrón que se va a usar en Marca: pestañas arriba (`?tab=datos|negocios|cobros|cobranza` en la URL,
para que cada una sea compartible y el botón atrás del navegador funcione), una sola visible a la vez.
Contenido de cada una es el que YA existe, solo reagrupado — no cambia ninguna consulta ni acción:

- **Datos:** `FormularioCuenta` (nombre, plan, límite, monto, licencia) + el botón de eliminar.
- **Negocios:** la lista de "Negocios de esta cuenta" + `FormularioVincular`.
- **Cobros:** el registro de cobros que ya existe (`FormularioCobro`, badges de Wompi/ajuste, "Marcar
  pagado").
- **Cobranza** (nueva, spec 2026-09-21-cobranza-design.md): el estado derivado y los cinco controles de
  esa spec (modo exenta/normal, posponer, perdonar, pedir un pago, anular un cobro pendiente).

La pestaña activa por defecto es **Cobranza** si la cuenta está `vencida` o `bloqueada` (es lo urgente),
si no **Datos**.

### Unificación con `licencia_estado` (la que la spec de cobranza deja pendiente para acá)

Hoy `licencia_estado` (activo/inactivo, pestaña Datos) es **puramente cosmético**: no bloquea nada, pese a
que su propio texto en pantalla dice "Pausar afecta TODOS los comercios de esta cuenta a la vez"
(`FormularioCuenta`). La cobranza agrega un bloqueo que SÍ es real, pero derivado de fechas — no le da a
FM un botón de "cortalo YA, sin esperar los 15 días" para un caso excepcional (un cliente problemático,
por ejemplo). La unificación es esa: **`licencia_estado = 'inactivo'` pasa a ser el interruptor manual de
corte inmediato**, evaluado ANTES que las fechas:

1. `licencia_estado = 'inactivo'` → `bloqueada`, sin importar fechas ni `cobranza` (ni una cuenta exenta
   se salva de un corte manual explícito — es la vía de escape para el caso excepcional).
2. Si no, se evalúa `estadoDeCobranza` tal como la otra spec lo define (exenta → pospuesta → al_dia →
   vencida → bloqueada por fecha).

No hace falta ninguna columna nueva (`licencia_estado` ya existe desde antes de esta rama) ni tocar la
migración `0038` de la spec de cobranza: el combinado se resuelve en el gate y en el dashboard, en una
función chica que envuelve a `estadoDeCobranza` (p. ej. `estadoEfectivo(cuenta) = cuenta.licencia_estado
=== 'inactivo' ? { tipo: 'bloqueada', ... } : estadoDeCobranza(...)`). El texto de la pestaña Datos se
corrige para que ya no mienta: pasa a decir algo como "Corta el acceso al panel y al escáner de
inmediato, sin esperar los 15 días de gracia" — mismo campo, mismo formulario, mismo botón; cambia el
texto y, por primera vez, cambia también lo que de verdad hace.

**⚠️ Esto SÍ tiene efecto inmediato el día del deploy, a diferencia del resto de la cobranza.** Hoy, en la
base real, `M&M Inversiones` y `Segundo` YA tienen `licencia_estado = 'inactivo'` (eran cosméticos hasta
ahora). En cuanto este cambio se publique, esas dos cuentas quedan bloqueadas de verdad — sin que nadie
haya tocado nada ese día. Es lo contrario de "Despliegue" en la spec de cobranza ("nada cambia hasta que
pases cuentas a normal"). Antes de este deploy, Daniel tiene que decidir por esas dos cuentas puntuales:
dejarlas bloquear (si de verdad están dadas de baja) o pasarlas a `activo` primero.

## Diseño: panel del comercio

### Marca, con pestañas (`app/comercio/(protegido)/branding/page.tsx` + `FormularioBranding.tsx`)

Se reparte el formulario de 908 líneas en cuatro pestañas (`?seccion=colores|imagenes|franja|reverso`),
una visible a la vez, layout C: sin acordeón, cada pestaña es toda la pantalla.

- **Colores:** la paleta (fondo, texto, label) **+ "Meta de sellos" y "Nombre del pase"** — hoy viven en
  el mismo bloque que la paleta y no son ni color, ni imagen, ni reverso; se quedan en Colores (primera
  pestaña) para no abrir una quinta categoría por dos campos.
- **Imágenes:** logo, strip, hero — "Recursos visuales".
- **Franja:** la foto de fondo de la franja y su encuadre (el `<fieldset>` que hoy vive al final de
  `FormularioBranding.tsx`).
- **Reverso:** `FormularioReverso` completo (términos, redes sociales, sitio web) — hoy es un componente
  aparte más abajo en la misma página; pasa a ser la cuarta pestaña.

**No las cuatro pestañas comparten un solo mecanismo de guardado — hay TRES, y cada pestaña usa el que le
corresponde. Esto no es nuevo: es exactamente cómo se guarda hoy, la spec solo lo reparte visualmente.**

- **Colores y Franja comparten un solo `<form>`, una sola Server Action**
  (`accionGuardarBranding` / `accionGuardarBrandingDePrograma`) y un solo botón "Publicar cambios" (línea
  850-852 de `FormularioBranding.tsx`). Esas DOS pestañas (no tres — "Recursos visuales"/Imágenes vive
  FUERA de este `<form>`, ver abajo) son **puramente visuales** sobre ese único formulario: nunca se
  desmontan. Las dos secciones se quedan SIEMPRE montadas en el DOM (mismo estado de React que hoy, un
  solo `useState` con todos los campos, incluidos `sello_meta` y `nombre_pase` que viven en el bloque de
  Colores); cambiar entre Colores y Franja solo alterna qué sección se ve (`style={{ display:
  pestañaActiva === 'colores' ? 'block' : 'none' }}` o equivalente), nunca desmonta ni condiciona qué
  inputs existen. Es la misma regla que ya protege el encuadre de la franja (comentario de
  `mandaEncuadre`, línea 238-242: "si viajaran solo cuando se ven… le borraría al dueño el encuadre que ya
  había ajustado") — extendida a las dos: **ni Colores ni Franja pueden perder sus valores al guardar por
  estar en la otra pestaña**, porque las dos viajan siempre en el mismo submit. **El botón "Publicar
  cambios" se muestra SOLO cuando la pestaña activa es Colores o Franja** (es el submit de ESE formulario;
  no tiene sentido mostrarlo sobre Imágenes o Reverso, que se guardan solos).
- **Imágenes (logo, strip, hero) YA es, y se queda, una serie de formularios independientes que se
  auto-guardan solos.** Hoy "Recursos visuales" vive en su propia `<section>` (línea 605-608 de
  `FormularioBranding.tsx`), FUERA del `<form>` de Colores/Franja: cada imagen es un `SubidaImagen.tsx`
  con su propio `<form>` (`accionSubirImagen`/`accionSubirImagenDePrograma`) que se envía SOLO al elegir
  el archivo (`input.form?.requestSubmit()`) y otro `<form>` propio para "Quitar". No hay ningún botón
  "Publicar cambios" que agregar acá ni que mover: cada imagen ya se guarda en el momento, sin esperar a
  nada de las otras pestañas. La pestaña Imágenes solo decide si esa `<section>` se ve o no
  (`display:none` cuando no es la activa) — ocultarla no afecta a un upload que ya se auto-envió.
- **Reverso es y se queda una tercera situación, también independiente** (ver el párrafo de abajo): su
  propio `<form>`, su propia Server Action, su propio botón "Guardar reverso", visible solo en su pestaña.

**Reverso es y se queda una situación DISTINTA — no se fusiona con las otras tres.** Hoy `FormularioReverso`
ya es un `<form>` propio con su propia Server Action (`accionGuardarReverso` /
`accionGuardarReversoDePrograma`, que llaman a `guardarReverso`/`guardarReversoPrograma` — funciones
distintas de `guardarBranding`), su propio botón "Guardar reverso" y su propio mensaje de éxito/error;
NUNCA fue atómico con Colores/Imágenes/Franja (guardar uno hoy no guarda el otro, y eso no es un bug de
esta spec, es como funciona desde antes). La pestaña "Reverso" solo cambia DÓNDE se ve ese formulario
independiente — sigue siendo su propio `<form>`, con su propio botón "Guardar reverso", separado del de
las otras tres pestañas (fusionarlos sería HTML inválido: un `<form>` dentro de otro — ver el comentario
de la línea 870-871 de `FormularioBranding.tsx` sobre exactamente ese problema con OTRO botón). El costo
es el de siempre: si el dueño edita Reverso y cambia de pestaña sin tocar "Guardar reverso", pierde ese
cambio — ni mejor ni peor que hoy, donde ya pasa lo mismo si navega a otra pantalla sin guardar.

**Los tres colores obligatorios (`required={!programaId}`) necesitan dejar de depender de la validación
nativa del navegador.** Hoy, con las tres pestañas siempre montadas, un campo `required` que queda oculto
por `display:none` no es enfocable, y el navegador bloquea el envío EN SILENCIO (sin mostrar ningún aviso,
en cualquier pestaña que no sea Colores). El formulario pasa a llevar `noValidate`, y la validación queda
enteramente del lado del servidor (`guardarBranding.ts` ya rechaza un color vacío o mal formado con un
error legible: "El color de fondo debe tener el formato rgb(r, g, b)…" — la defensa real, coherente con
que la base tampoco valida esto). Cuando la Server Action devuelve un error, el formulario cambia
automáticamente a la pestaña **Colores** (es la única con campos obligatorios) para que el aviso aparezca
junto al campo que lo causó, en vez de quedar huérfano en una pestaña que no tiene ese campo a la vista.

El selector de "¿qué tarjeta estás diseñando?" (cuando hay más de un programa) se queda ARRIBA de las
pestañas, fuera de ellas: no es parte del contenido de ninguna, es lo que decide de qué comercio/programa
son las cuatro.

### Menú "más opciones", agrupado (`app/comercio/(protegido)/MenuOpciones.tsx` + `lib/comercio/navegacion.ts`)

`ENLACES_MENU` (hoy una lista plana) pasa a tener un campo `grupo` opcional:

```ts
export interface EnlaceNav {
  href: string;
  icono: string;
  etiqueta: string;
  grupo?: 'programa' | 'equipo' | 'cuenta';
}
```

`MenuOpciones.tsx` sigue destacando el primero (Reportes, sin grupo) igual que hoy, y agrupa el resto por
`grupo` con un `<p className="titulo-seccion">` por cada uno (mismo estilo que ya usa "Configuración"),
en el orden: **Tu programa** (Reglas, Programas, Notificaciones) → **Tu equipo y locales** (Sucursales,
Cajeros) → **Cuenta** (Mi plan). El intercambio Premios↔Programas (`intercambiarSiNoHayCanje`) sigue
funcionando igual: agrega el campo `grupo` en el reemplazo, no lo pierde. **`ENLACE_PREMIOS` también
necesita `grupo: 'programa'`** (hoy solo vive en la barra, sin ese campo): sin él, un comercio sin canje
—que intercambia Programas por Premios DENTRO del menú— dejaría a Premios como el único enlace sin
sección, huérfano debajo de "Cuenta" en vez de agruparse bajo "Tu programa" con Reglas y Notificaciones.

## Seguridad

Nada nuevo: cada pestaña sigue siendo la MISMA página/acción de siempre, solo se reorganiza visualmente.
El dashboard llama a `verifyFmAdmin()` como cualquier página de `/admin`. Las funciones de
`lib/fm/dashboard.ts` no acotan por nada (son agregados de TODA la cartera): quien las llama ya pasó el
gate de FM.

## Pruebas

- `fusionarActividad`: pura, con mutación (orden invertido, límite ignorado, desempate que reordena).
- Las funciones de `lib/fm/dashboard.ts`: contra la base (las corre Daniel o se corren con el cwd en el
  checkout principal, como el resto de la pasarela). Casos: cero de cada cosa, una falla de consulta
  devuelve `null` y no tumba las demás.
- `estadoEfectivo`: pura, con mutación (una cuenta `licencia_estado = 'inactivo'` da `bloqueada` aunque
  esté `exenta` o al día; una cuenta `activo` delega sin cambios en `estadoDeCobranza`).
- `contarCuentasEnRiesgo`: depende de `estadoDeCobranza` (spec de cobranza) para el caso por fechas — sus
  mutaciones viven en la tabla de esa spec; acá se prueba que agrega bien sobre varias cuentas Y que
  respeta `estadoEfectivo` (una cuenta pausada a mano cuenta aunque su fecha diga "al día").
- Recorrido en el navegador: dashboard con datos reales, las cuatro pestañas de Marca, las cuatro pestañas
  de una ficha de cuenta, el menú agrupado del comercio, y crear un comercio nuevo desde la pestaña
  Negocios de una cuenta (confirmando que queda vinculado a ESA cuenta y no a otra) — en los tres temas, a
  ancho de teléfono. `/admin/comercios` y `/admin/comercios/nuevo` deben dar 404 después del borrado;
  `/admin/comercios/<id>/editar` y `/admin/comercios/<id>/clientes` tienen que seguir funcionando igual
  que hoy, alcanzados solo desde la ficha de cuenta. Incluye loguearse como FM y confirmar que cae en el
  dashboard (no en un 404), y guardar/borrar un comercio desde `[id]/editar` confirmando que vuelve a la
  cuenta dueña (no a la lista borrada). Incluye
  el caso que prueba que la separación de Reverso sigue siendo segura: editar Colores (sin guardar),
  cambiar a la pestaña Reverso, editar y guardar SOLO Reverso, volver a Colores y confirmar que el cambio
  de Colores sigue sin guardarse (es lo esperado: son formularios independientes) y que Reverso sí quedó
  guardado. Y el caso del `required` movido a validación de servidor: vaciar el color de fondo, cambiar a la
  pestaña Franja (que comparte el mismo formulario y el mismo botón) y publicar desde ahí, confirmar que
  NO se envía en silencio — vuelve a la pestaña Colores con el error visible. Y que el botón "Publicar
  cambios" NO aparece estando en Imágenes ni en Reverso (cada una tiene su propio guardado, sin botón
  compartido).

## Orden de entrega

Se implementa **junto con la spec de cobranza**, en este orden (retoma la numeración de esa spec desde su
Tarea 0):

| Tarea | Qué | Se verifica |
|---|---|---|
| 0–2 | (spec de cobranza) spike, migración `0038`, `estadoDeCobranza` puro | los de esa spec |
| 3 | (spec de cobranza) capa de datos y acciones de FM | los de esa spec |
| 3.5 | `fusionarActividad` (puro) y `lib/fm/dashboard.ts` (con base) | pruebas + mutaciones |
| 4 | Nav sin "Comercios", logo→dashboard, `app/admin/(protegido)/page.tsx`, borrar `comercios/page.tsx` + `comercios/nuevo/` + `accionCrearComercio`, los tres redirects que apuntaban ahí (login, `accionActualizarComercio`, `accionEliminarComercio`), alta de comercio desde la ficha de cuenta (`accionCrearComercioDeCuenta`) | navegador |
| 5 | `estadoEfectivo` (une `licencia_estado` + `estadoDeCobranza`); ficha de cuenta con pestañas (Datos·Negocios·Cobros·Cobranza) e insignia en la lista de cuentas | pruebas + mutaciones, navegador |
| 6 | (spec de cobranza) `accionPagarCobro`, gate de bloqueo, pantallas del dueño/cajero | los de esa spec |
| 7 | Marca con pestañas (Colores·Imágenes·Franja·Reverso) | navegador, los 15 tipos de campo |
| 8 | Menú "más opciones" agrupado | navegador |
| 9 | Revisión final del conjunto | como las anteriores |

**Despliegue:** igual que siempre — migración `0038` primero (la aplica Daniel a mano), deploy después.
Como la migración deja todas las cuentas existentes exentas (spec de cobranza), nada de esto cambia el
comportamiento para un cliente real hasta que Daniel pase cuentas a "normal" una por una — **con la
excepción de `M&M Inversiones` y `Segundo`** (ver "Unificación con `licencia_estado`" arriba): esas dos se
bloquean el mismo día, porque ya están marcadas `licencia_estado = 'inactivo'` desde antes.

## Preguntas abiertas para Daniel (cada una con mi valor por defecto)

1. **"Actividad reciente" sin cobros manuales de FM** (ver supuesto de arriba): ¿importa agregarlos, o
   con pagos+cuentas+solicitudes alcanza? Por defecto: alcanza.
2. **La pestaña activa por defecto de una cuenta vencida/bloqueada es "Cobranza"** en vez de "Datos": ¿de
   acuerdo, o preferís que siempre abra en "Datos"? Por defecto: Cobranza si hay algo urgente.
3. **`?tab=` / `?seccion=` en la URL** para que cada pestaña sea un link compartible: ¿te sirve, o preferís
   que sea solo estado de React (más simple, pero perdés el botón atrás y no podés mandar un link directo
   a "la pestaña de Cobros de esta cuenta")? Por defecto: en la URL.
4. **`M&M Inversiones` y `Segundo` se bloquean el día del deploy** (arriba, en "Unificación con
   `licencia_estado`") porque ya están `inactivo`. ¿Las dejo bloquear, o las paso a `activo` antes de
   publicar para que no corten de golpe? Sin tu respuesta, NO hago el deploy de esta parte.

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

### Nav (`app/admin/(protegido)/layout.tsx`)

Se saca el link "Comercios". El logo/marca (`<span className="admin-marca">…`) pasa a ser un
`<Link href="/admin">`. Queda: **(logo→dashboard)** · Cuentas · Reportes · Solicitudes · Pagos · tema ·
Salir. Mismo criterio de "defensa en profundidad" que ya tiene el layout: el gate real vive en
`verifyFmAdmin()` de cada página.

### El dashboard (`app/admin/(protegido)/page.tsx`, nuevo)

Server Component. Llama a `verifyFmAdmin()` primero (mismo patrón que toda página de `/admin`). Junta las
6 métricas con `Promise.all` y las dibuja con el layout A: una fila de 4 `metric-carta` (pagos, ingresos,
vencidas/bloqueadas, solicitudes — cada una linkea a su pantalla), una fila chica con la cartera, y una
lista de actividad reciente abajo.

**Módulo nuevo `lib/fm/dashboard.ts`** (capa de datos, sin JSX — mismo criterio que `lib/reportes/reportes.ts`
de "`null` ante un error, nunca un cero falso"):

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
  `id`) y `cobros` (`tipo = 'periodo'`, `estado = 'pagado'`) en DOS consultas (no una por cuenta), arma
  el mapa cuenta→períodos pagados, y para cada una llama `estadoDeCobranza` (de la spec de cobranza);
  cuenta las que dan `vencida` o `bloqueada`.
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

## Diseño: panel del comercio

### Marca, con pestañas (`app/comercio/(protegido)/branding/page.tsx` + `FormularioBranding.tsx`)

Se reparte el formulario de 908 líneas en cuatro pestañas (`?seccion=colores|imagenes|franja|reverso`),
una visible a la vez, layout C: sin acordeón, cada pestaña es toda la pantalla.

- **Colores:** la paleta (fondo, texto, label).
- **Imágenes:** logo, strip, hero — "Recursos visuales".
- **Franja:** la foto de fondo de la franja y su encuadre (el `<fieldset>` que hoy vive al final de
  `FormularioBranding.tsx`).
- **Reverso:** `FormularioReverso` completo (términos, redes sociales, sitio web) — hoy es un componente
  aparte más abajo en la misma página; pasa a ser la cuarta pestaña.

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
funcionando igual: agrega el campo `grupo` en el reemplazo, no lo pierde.

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
- `contarCuentasEnRiesgo`: depende de `estadoDeCobranza` (spec de cobranza) — sus mutaciones viven en la
  tabla de esa spec; acá solo se prueba que agrega bien sobre varias cuentas.
- Recorrido en el navegador: dashboard con datos reales, las cuatro pestañas de Marca, las cuatro pestañas
  de una ficha de cuenta, el menú agrupado del comercio — en los tres temas, a ancho de teléfono.

## Orden de entrega

Se implementa **junto con la spec de cobranza**, en este orden (retoma la numeración de esa spec desde su
Tarea 0):

| Tarea | Qué | Se verifica |
|---|---|---|
| 0–2 | (spec de cobranza) spike, migración `0038`, `estadoDeCobranza` puro | los de esa spec |
| 3 | (spec de cobranza) capa de datos y acciones de FM | los de esa spec |
| 3.5 | `fusionarActividad` (puro) y `lib/fm/dashboard.ts` (con base) | pruebas + mutaciones |
| 4 | Nav sin "Comercios", logo→dashboard, `app/admin/(protegido)/page.tsx` | navegador |
| 5 | Ficha de cuenta con pestañas (Datos·Negocios·Cobros·Cobranza) | navegador |
| 6 | (spec de cobranza) `accionPagarCobro`, gate de bloqueo, pantallas del dueño/cajero | los de esa spec |
| 7 | Marca con pestañas (Colores·Imágenes·Franja·Reverso) | navegador, los 15 tipos de campo |
| 8 | Menú "más opciones" agrupado | navegador |
| 9 | Revisión final del conjunto | como las anteriores |

**Despliegue:** igual que siempre — migración `0038` primero (la aplica Daniel a mano), deploy después.
Como la migración deja todas las cuentas existentes exentas (spec de cobranza), nada de esto cambia el
comportamiento para un cliente real hasta que Daniel pase cuentas a "normal" una por una.

## Preguntas abiertas para Daniel (cada una con mi valor por defecto)

1. **"Actividad reciente" sin cobros manuales de FM** (ver supuesto de arriba): ¿importa agregarlos, o
   con pagos+cuentas+solicitudes alcanza? Por defecto: alcanza.
2. **La pestaña activa por defecto de una cuenta vencida/bloqueada es "Cobranza"** en vez de "Datos": ¿de
   acuerdo, o preferís que siempre abra en "Datos"? Por defecto: Cobranza si hay algo urgente.
3. **`?tab=` / `?seccion=` en la URL** para que cada pestaña sea un link compartible: ¿te sirve, o preferís
   que sea solo estado de React (más simple, pero perdés el botón atrás y no podés mandar un link directo
   a "la pestaña de Cobros de esta cuenta")? Por defecto: en la URL.

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

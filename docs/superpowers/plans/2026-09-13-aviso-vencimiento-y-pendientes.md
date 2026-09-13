# Aviso antes del vencimiento, y los pendientes de monto y saldo — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Avisarle al socio y al del cupón ANTES de que se les venza la tarjeta, con el mensaje del dueño y la fecha real de cada uno; y cerrar dos defectos pendientes (la casilla del monto que se descarta, y el saldo del panel de FM que mezcla unidades).

**Architecture:** Un disparador nuevo sobre el sistema de notificaciones de la 0026, no un canal nuevo. La configuración vive por programa, la idempotencia es una fecha, y el cron existente pasa a llamarse por lo que hace.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase (DDL a mano por el usuario), vitest.

**Spec:** `docs/superpowers/specs/2026-09-09-aviso-antes-del-vencimiento-design.md` — manda sobre este plan si difieren. Leé las decisiones 1 a 8 antes de cualquier tarea.

**Estado de la base:** la **0034 YA ESTÁ APLICADA y verificada** (`scripts/verificar-0034.ts`), y `lib/supabase/types.ts` ya declara sus columnas. La **0035 NO existe todavía** y va al final, DESPUÉS del deploy (Task 7).

---

## Reglas para TODAS las tareas

- **Checkout:** `C:\Users\Daniel\Desktop\Proyectos\Loyalty Cards\.claude\worktrees\brand-editor-preview-adjustments-e82e88`, rama `claude/brand-editor-preview-adjustments-e82e88`. Verificalo con `git -C "<ruta>" branch --show-current` ANTES de tocar nada; prefijá cada comando con `cd "<ruta>" &&`.
- **Español** en identificadores, comentarios y textos. El panel del dueño **vosea**; lo que lee el cliente final en su teléfono (el texto por defecto del aviso) también vosea, igual que los avisos que ya existen.
- **TDD con mutación** en toda rama crítica, anotada en la prueba.
- **Nunca toques Google real** (mockeá `./walletClient`). **No inicies el dev server.**
- **No corras la suite COMPLETA** mientras haya otros subagentes editando: el resultado no es interpretable y le mete flakes a los demás (`fileParallelism: false`, una sola BD). Corré solo tus archivos. La suite completa la corre el controlador al final.
- **Commits por pathspec** (`git commit -m … -- <tus rutas>`), nunca `git add -A`: hay subagentes en paralelo y el índice es compartido. Identidad `Daniel <268727888+dann1103-eng@users.noreply.github.com>`, trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- `npx tsc --noEmit` limpio en tus archivos al cerrar.

---

### Task 1: El formateador de fecha, en un solo lugar

**Files:** `lib/tarjetas/tipos.ts`, `lib/tarjetas/vigencia.ts` (y sus pruebas si hace falta).

Hoy hay DOS copias privadas idénticas de `formatearFecha` (`tipos.ts:~207` y `vigencia.ts:~61`); la de `vigencia.ts` además acepta `null`. El aviso de vencimiento necesitaría una tercera.

- [ ] Exportar UNA (decidí dónde vive y explicalo; `vigencia.ts` es el candidato natural porque es el módulo de fechas) y hacer que la otra la use. Conservar la diferencia de firma con `null`, o unificarla sin romper a ningún llamador.
- [ ] Prueba que fije el formato ("12 de octubre de 2026") **y el borde de zona**: el mediodía UTC está puesto a propósito para que ninguna zona de América corra el día. MUTACIÓN: cambiar `T12:00:00Z` por `T00:00:00Z` tiene que hacer fallar la prueba del borde.
- [ ] Commit.

---

### Task 2: El módulo `lib/comercio/avisoVencimiento.ts`

**Files:** Create `lib/comercio/avisoVencimiento.ts` y su `.test.ts`. Depende de Task 1.

Hermano de `lib/comercio/avisoInactividad.ts`: leelo entero antes, incluido el comentario largo sobre por qué la guarda de cupón dice `'cupon'` y no `usaVigencia`.

**La parte pura** (con `hoyIso` por argumento, nunca `new Date()`):

- [ ] `correspondeAvisar({ vigenciaHasta, usadoEn, avisoVencimientoPara }, diasAntes, hoyIso)` devuelve `false` en CADA uno de estos casos, y cada uno es una prueba con su mutación:
  1. no hay `vigenciaHasta` (membresía sin activar, o cupón que no vence);
  2. el cupón ya se usó (`usadoEn` no nulo);
  3. ya se avisó para ESA misma fecha (`avisoVencimientoPara === vigenciaHasta`);
  4. la fecha ya pasó (`!sigueVigente(vigenciaHasta, hoyIso)`; el día del vencimiento todavía cuenta);
  5. todavía faltan MÁS de `diasAntes` días.
  Y `true` cuando faltan `diasAntes` o menos — **no** "exactamente `diasAntes`": si el cron falla un día, un aviso de igualdad estricta se pierde para siempre (decisión 5). Prueba explícita de "faltan menos de N, el cron no corrió el día N: igual avisa".
- [ ] `textoAviso(mensaje, tipoTarjeta, vigenciaHasta)`: el mensaje del dueño (o el default del tipo si viene vacío) seguido de "Vence el <fecha>." con el formateador de Task 1. **La fecha la pone la app, nunca el dueño** (decisión 1). Defaults en una tabla por tipo, con prueba que recorra los tipos con `usaVigencia`.
- [ ] `validarAvisoVencimiento({ activo, dias, mensaje }, tipoTarjeta, plazoDias)`:
  - apagado → no valida nada más;
  - encendido → exige `dias` entero entre 1 y `MAXIMO_DIAS_AVISO_VENCIMIENTO` (90);
  - **el mensaje es OPCIONAL** (vacío = default del tipo). NO copiar el `validar` de inactividad, que lo exige;
  - **`dias < plazoDias`** (decisión 8), con un mensaje que explique por qué: sin esto, con membresías de 30 días y aviso a 30, el socio recibe "está por vencer" al día siguiente de pagar;
  - **si el programa es un cupón SIN plazo** (`cupon_vigencia_dias` nulo = el cupón no vence nunca), el aviso no se puede encender: no hay vencimiento que avisar. Mensaje claro.
  - mensaje de más de 200 caracteres → error (espejo del CHECK).

**El recorrido:**

- [ ] `procesarAvisosVencimiento(supabase)`: programas activos con `aviso_vencimiento_activo = true` y tipo con `usaVigencia`; por cada tarjeta, `correspondeAvisar` con `hoyEnZona(comercio.zona_horaria)`; si corresponde, `enviarMensajeTarjeta(..., textoAviso(...), vigenteHasta, 'vencimiento')` y, **solo si el envío alcanzó al menos un canal**, grabar `tarjetas.aviso_vencimiento_para = vigencia_hasta`. Mirá cómo `avisoInactividad` decide "alcanzada" con `enviadoApple || enviadoGoogle` y copiá ese criterio: grabar la marca sin haber entregado nada dejaría a ese cliente sin aviso para siempre.
- [ ] Devuelve un resumen con las tarjetas avisadas (lo va a usar Task 3).
- [ ] Pruebas de integración contra la BD con `crearEntorno`, configurando el programa por el camino de producción (no la columna del comercio — la regla del fixture legado de CLAUDE.md). Casos: avisa dentro de la ventana; no avisa dos veces el mismo vencimiento; **vuelve a avisar tras renovar** (cambiar `vigencia_hasta` y correr de nuevo); no avisa a un cupón usado.
- [ ] `enviarMensajeTarjeta` recibe `origen: 'campana' | 'inactividad'`: ampliar la unión a `| 'vencimiento'` (la 0034 ya amplió el CHECK de la base).
- [ ] Commit.

---

### Task 3: El cron y la regla contra el aviso de inactividad

**Files:** `app/api/cron/inactividad/route.ts` → `app/api/cron/avisos/route.ts`, `vercel.json`, `lib/comercio/avisoInactividad.ts` (+prueba). Depende de Task 2.

- [ ] **Renombrar la ruta** a `/api/cron/avisos`, que corre los DOS pases: primero `procesarAvisosVencimiento`, después `procesarAvisosInactividad`. Actualizar `vercel.json` (sigue con DOS entradas, no tres). Conservar los dos candados (`CRON_SECRET` y el no-op).
- [ ] **La regla (decisión 7): `procesarAvisosInactividad` saltea la tarjeta cuyo `aviso_hasta` sea HOY o FUTURO.** No "no los dos el mismo día", que no resuelve nada: hay un solo par `aviso_texto`/`aviso_hasta` y `enviarMensajeTarjeta` lo sobrescribe, así que al día siguiente el de inactividad pisaría al de vencimiento.
  **NO saltear por `aviso_vencimiento_para`**: esa marca no se limpia hasta la próxima renovación y silenciaría PARA SIEMPRE al socio con la membresía vencida, que es justamente el destinatario que la prueba "el que dejó vencer su membresía es a quien más querés recordarle" protege.
- [ ] Pruebas: (a) una membresía inactiva Y por vencer recibe UN solo aviso, el de vencimiento; (b) cuando ese aviso caduca, el de inactividad vuelve a poder salir; (c) la prueba existente del socio vencido **sigue verde**. MUTACIÓN obligatoria: cambiar la condición a "saltear si `aviso_vencimiento_para` no es nulo" tiene que hacer FALLAR (c).
- [ ] Commit. Anunciar en el reporte que el `curl` de QA documentado cambia de path.

---

### Task 4: La interfaz en Programas

**Files:** `lib/comercio/programas.ts` (+prueba), `app/comercio/(protegido)/programas/FormularioConfiguracionPrograma.tsx`, y la página/acción que lo monta. Depende de Task 2.

- [ ] **Un solo escritor.** El formulario tiene un único `action` y `guardarConfiguracionPrograma` escribe sus columnas incondicionalmente. Las tres columnas nuevas entran a `DatosConfiguracionPrograma`, a `configuracionProgramaDesdeFormulario`, al `update`, y a `validarConfiguracion` — que llama a `validarAvisoVencimiento` de Task 2 con el plazo del propio programa (`membresia_dias` o `cupon_vigencia_dias` según el tipo). NO una segunda escritura desde `avisoVencimiento.ts`.
- [ ] El bloque "Aviso antes del vencimiento" (interruptor, días de anticipación, mensaje) solo se dibuja en tipos con `usaVigencia`. Texto de ayuda: la fecha la agrega la app. Mostrar en vivo cómo va a quedar el mensaje con una fecha de ejemplo, usando `textoAviso`, para que el dueño vea que no tiene que escribirla.
- [ ] **La `key` de remonte** del formulario tiene que incluir los campos nuevos, o después de guardar vuelven a mostrarse los valores viejos (el bug de React 19 con Server Actions, documentado en el editor de marca).
- [ ] En los tipos SIN `usaVigencia`, los tres campos no se dibujan; verificar que eso NO borre nada (hoy esos tipos tienen el aviso apagado por default, así que `null`/`false` es correcto — pero dejalo escrito).
- [ ] Pruebas: guardar y releer; la validación cruzada contra el plazo; el cupón sin plazo no puede encender el aviso.
- [ ] Commit.

---

### Task 5: Pendiente A — la casilla del monto

**Files:** `lib/tarjetas/tipos.ts` (+prueba), `app/comercio/(protegido)/reglas/**`, `app/comercio/(protegido)/escanear/**`. Depende de Task 1 (comparten `tipos.ts`).

- [ ] **Campo nuevo `usaMontoDeCompra` en `TIPOS`.** `false` en cupón y membresía, `true` en el resto. NO reusar `requiereMonto` (es "lo exige", deja afuera a puntos y sellos), ni `aplicanControlesAcreditacion` (incluye a descuento, que sí usa el monto), ni `usaVigencia` (fusión por coincidencia, que el propio `tipos.ts` prohíbe por escrito). Verificá cada valor contra el RPC real de ese tipo y documentalo como está documentado `aplicanControlesAcreditacion`.
- [ ] **Reglas** (mira el programa PRINCIPAL): no se ofrece la casilla donde no aplica, con el aviso. **Y el input oculto con el valor guardado**: `accionGuardarControles` lee la casilla del `FormData` y lo ausente se guarda `false`. La mordida idéntica ya está resuelta en ese mismo formulario tres líneas más arriba: seguí ese patrón.
- [ ] **Escáner** (es por TARJETA): hoy lee `comercios.pedir_monto_compra` sin mirar el tipo de la tarjeta escaneada. Condicionar al tipo de ESA tarjeta. Un comercio con principal de puntos y un programa de cupón NO debe pedir el monto sobre el cupón.
- [ ] MUTACIONES: (a) poner `usaMontoDeCompra: true` en membresía tiene que romper la prueba del catálogo; (b) quitar el input oculto tiene que romper la prueba que verifica que guardar controles no apaga la casilla. Si esa segunda prueba no existe, escribila.
- [ ] Commit.

---

### Task 6: Pendiente B, paso 1 — dejar de leer `saldo_circulante`

**Files:** `app/admin/(protegido)/reportes/page.tsx`, `lib/reportes/reportes.test.ts`, `lib/supabase/types.ts`. Independiente de las demás.

**Este paso NO toca la base.** Es sustractivo, así que va al revés que todo lo demás: primero el código deja de leer la columna y se despliega; recién después la 0035 la retira (Task 7). Aplicar la migración primero rompe el panel de FM, igual que pasó el 2026-09-09 con el renombre de `acreditaciones`.

- [ ] Quitar los TRES usos en la pantalla de FM: el `reduce` de la métrica de cabecera, la tarjeta "Saldo circulante" entera, y el `EstadisticaMini` por comercio. Nada de un "0" o un guion en su lugar: se va.
- [ ] `reportes.test.ts`: la aserción sobre `saldo_circulante` se quita (la columna todavía existe en la base, pero el código ya no la consume). Dejar escrito por qué.
- [ ] `types.ts`: **NO sacar todavía** `saldo_circulante` del tipo de retorno de `reporte_fm_comercios`. La base todavía la devuelve; el tipo tiene que describir la base. Se saca en Task 7, junto con la migración.
- [ ] `grep -rn saldo_circulante app lib` tiene que dar solo `types.ts`. Commit.

---

### Task 7 (controlador): migración 0035, verificación y cierre

- [ ] Suite completa, typecheck, lint, verificación en navegador (el bloque del aviso en Programas).
- [ ] **Deploy** con Tasks 1-6.
- [ ] Recién después: escribir la **0035** (`drop function reporte_fm_comercios()` + `create` sin `saldo_circulante` + repetir `revoke` Y `grant`, exactamente como la 0033), revisarla con un subagente, pasársela al usuario, verificar con un script, y sacar la columna de `types.ts`.
- [ ] Estado del proyecto, commit, deploy final.

# Reportes por operaciones, navegación e identidad del pase (entrega 2 de 2) — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que los reportes cuenten lo que de verdad hizo el cajero (y no solo las acreditaciones), que ninguna sección inoperante ocupe un lugar en la barra, y que el pase de una membresía diga cómo se llama y hasta cuándo está activa.

**Architecture:** Una migración que borra y recrea cuatro funciones de reporte (el renombre cambia el tipo de retorno, así que `create or replace` no alcanza) más una columna nueva; y del lado de TypeScript, extender `frentePase` con dos campos y hacer que la navegación reciba el tipo del programa principal.

**Tech Stack:** Postgres (Supabase, DDL a mano por el usuario), Next.js 16, React 19, TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-09-08-coherencia-por-tipo-de-tarjeta-design.md`, Grupos 3, 4 y 5 y las decisiones 4, 5 y 6. Manda sobre este plan si difieren. La entrega 1 (`plans/2026-09-08-coherencia-pantallas-por-tipo.md`) ya está en `master`.

**Esta entrega LLEVA MIGRACIÓN (0033), y va PRIMERO que el deploy.** La columna nueva entra al payload de guardado del editor de marca: sin la migración se rompe TODO el guardado de marca, no solo lo nuevo.

---

## Reglas para TODAS las tareas

Las mismas de la entrega 1 (worktree `…/.claude/worktrees/brand-editor-preview-adjustments-e82e88`, rama `claude/brand-editor-preview-adjustments-e82e88`, español, TDD con mutación, sin dev server en subagentes, commits con la identidad `Daniel <268727888+dann1103-eng@users.noreply.github.com>` y el trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`, `npx tsc --noEmit` limpio al cerrar).

**Y una más, específica de esta entrega: NUNCA se toca Google real.** Las clases de Google no se pueden borrar. Todas las pruebas mockean `./walletClient`.

---

### Task 1: Migración 0033

**Files:** Create `supabase/migrations/0033_operaciones_y_nombre_pase.sql` y `scripts/verificar-0033.ts`; modify `lib/supabase/types.ts`.

- [ ] **Step 1: la columna.**

```sql
alter table programas_tarjeta
  add column nombre_pase text check (nombre_pase is null or btrim(nombre_pase) <> '');
```

- [ ] **Step 2: las cuatro funciones con columna `acreditaciones` → `operaciones`.**
  `reporte_sucursales(uuid)`, `reporte_tendencia(uuid, integer)`, `reporte_cajeros(uuid, date, date)`
  y `reporte_fm_comercios()`. Para cada una: `drop function` + `create function` + repetir su
  `revoke execute … from public, anon, authenticated` **y** su `grant execute … to service_role`
  (0010:132-139 y 0015:624,630). Todo en una transacción.

  **La regla, y es lo único que importa de esta tarea:** lo que cuenta ACTIVIDAD se ensancha a
  `('acreditacion','uso','renovacion')`; lo que suma VALOR se queda en `'acreditacion'`.

  Y cada función tiene su forma, así que no se pueden tratar igual:
  - `reporte_sucursales`: tiene el predicado en el **`WHERE` compartido**
    (`where t.comercio_id = … and tp.tipo = 'acreditacion'`). **El `and tp.tipo = …` SE VA de ahí**
    y cada campo lleva su propio `filter`. Si el predicado se deja donde está, los `filter` nuevos
    son **inertes**: el conteo sale idéntico, la membresía sigue en cero y todas las pruebas siguen
    verdes. Es la forma de falla más peligrosa de esta entrega.
    Al sacarlo, `sum(tp.puntos_delta)` **necesita su propio** `filter (where tp.tipo =
    'acreditacion')`, o empieza a incluir los `ajuste`.
    La entidad de `clientes_unicos` sigue siendo `count(distinct t.cliente_id)`, NO `tp.tarjeta_id`:
    desde la 0024 un cliente con dos programas tiene dos tarjetas en el mismo comercio.
  - `reporte_cajeros`: **ya** usa `filter` campo por campo y no tiene `WHERE` por tipo. Solo se
    ensancha el `filter` del conteo. Ojo: su `clientes_unicos` hoy NO está filtrado por tipo, así
    que ponerle el filtro lo **estrecha** (deja fuera a quien solo tuvo un ajuste). Se le pone
    igual, y entra en los cambios visibles.
  - `reporte_tendencia`: mismo criterio, según su forma real.
  - `reporte_fm_comercios`: cada campo es una subconsulta escalar con su propio `where`; ahí sí se
    ensancha el `where` de la que cuenta.
  - `reporte_top_clientes` **NO se renombra** (sus columnas son `visitas` y `puntos_totales`), pero
    **sí** se ensancha el filtro de `visitas` y NO el de `puntos_totales`. Como su tipo de retorno
    no cambia, puede ir con `create or replace`.

- [ ] **Step 3: `lib/supabase/types.ts`** — la columna nueva en Row/Insert/Update de
  `programas_tarjeta`, y `acreditaciones` → `operaciones` en los tipos de `Functions`.
- [ ] **Step 4: `scripts/verificar-0033.ts`** (mismo esqueleto que `verificar-0032.ts`): la columna
  existe; las funciones devuelven `operaciones`; y **la prueba que de verdad importa** — insertar
  una fila `renovacion` de prueba y confirmar que `reporte_sucursales` la CUENTA y que
  `puntos_otorgados` NO se movió. Limpiar lo insertado al final.
- [ ] **Step 5:** `npx tsc --noEmit`, commit. **Checkpoint del controlador:** pasarle el SQL al
  usuario para Studio; después correr el script.

---

### Task 2: Los consumidores del renombre

**Files:** `lib/reportes/reportes.ts`, `lib/reportes/agregados.ts` (+pruebas), `app/comercio/(protegido)/reportes/page.tsx`, `app/comercio/(protegido)/reportes/cajeros/page.tsx`, `app/admin/(protegido)/reportes/page.tsx`, `app/comercio/(protegido)/panel/page.tsx`, `lib/comercio/exportarClientes.ts`.

- [ ] Barrer `acreditaciones` con grep y renombrar. La UI rotula por tipo: donde el monto no
  signifique nada (contador `'ninguno'`) **la columna se omite entera**, en vez de imprimir cero o
  dejar dos separadores pegados (hoy queda "0 acreditaciones · · 5 clientes").
- [ ] El panel rotula `actividadSucursal` como "Visitas"; con el conteo ancho, "Operaciones" es más
  honesto para los ocho tipos. Decidir y documentar.
- [ ] Verde, typecheck, commit.

---

### Task 3: `resumenPrograma` — la métrica del panel

**Files:** Create `lib/tarjetas/resumenPrograma.ts` (+prueba); modify `app/comercio/(protegido)/panel/page.tsx`.

Es la Task 3 de la entrega 1 que quedó postergada porque comparte archivo con el renombre. El spec
(decisión 2) trae la tabla de las cuatro familias, las entradas explícitas y el caso "sin tarjetas".

- [ ] Pruebas primero, con `hoyIso` fijo. Mutación obligatoria: devolver el entero crudo en la rama
  de centavos reproduce el "2500 puntos" sobre $25.00.
- [ ] El panel: la consulta trae `COLUMNAS_ESTADO` **más `programa_id`**; se agrupa por programa
  activo; `hoyIso` con `hoyEnZona(comercio.zona_horaria)` (hay que agregar `zona_horaria` al
  `select`); los niveles de descuento se leen una vez por comercio.

---

### Task 4: Navegación — Premios y Programas intercambian superficie

**Files:** `lib/comercio/navegacion.ts` (+prueba), `app/comercio/(protegido)/NavInferior.tsx`, `app/comercio/(protegido)/MenuOpciones.tsx`, `app/comercio/(protegido)/layout.tsx`.

- [ ] **Son DOS llamadores**, no uno: `NavInferior` (barra) y `MenuOpciones` (menú). Si el tipo llega
  solo a la barra, Programas entra ahí y SIGUE en el menú: destino duplicado.
- [ ] El layout no consulta programas hoy. Se agrega con `listarProgramas`. **Ante error, la
  navegación cae al reparto de hoy**, nunca a una barra vacía.
- [ ] La invariante que se prueba es **"Escanear queda al centro del arreglo devuelto"**, NO "cinco
  destinos": el cajero recibe tres y un rol desconocido uno, y las pruebas vigentes ya lo afirman.
  Se conservan las que verifican que barra y menú no repitan destino y que sumen las doce secciones.
- [ ] Mutación: no intercambiar (solo sacar Premios) descentra Escanear y rompe la invariante.

---

### Task 5: Las secciones que no pueden funcionar

**Files:** `app/comercio/(protegido)/escanear/actions.ts`, `app/comercio/(protegido)/reglas/page.tsx`, `lib/comercio/avisoInactividad.ts` (+prueba).

- [ ] El escáner no trae recompensas cuando el tipo no puede canjearlas (hoy el cajero ve la lista
  completa con el botón siempre deshabilitado).
- [ ] Los controles antifraude solo se ofrecen donde la operación pasa por `acreditar_atomico`.
- [ ] **Aviso de inactividad: membresía y cupón necesitan lo OPUESTO.** Un cupón vencido se saltea
  (ya se hace). Un socio con la membresía vencida es justamente a quien hay que escribirle. **NO
  unificar bajo `usaVigencia`**: un `if (usaVigencia) saltear vencidos` silenciaría al único
  público que este aviso debería alcanzar. Prueba explícita de los dos casos.

---

### Task 6: `frentePase` gana identidad y vigencia

**Files:** `lib/tarjetas/frentePase.ts` (+prueba), `lib/apple/generatePass.ts`, `lib/apple/datosPassDeTarjeta.ts`, `lib/google/construirRecursos.ts` (+prueba), `app/comercio/(protegido)/branding/**`, `lib/comercio/guardarBranding*.ts`.

- [ ] **Firma:** entra `vigenciaHasta`, `usadoEn`, `nombrePase` y **`hoyIso`**. Sale `primario`,
  `secundario`, **`encabezado`** y **`listado`**.
- [ ] **`listado` NO es `primario`.** `loyaltyPointsDe` (Google) usa hoy `contadorPase` a propósito:
  el texto va SIEMPRE, también con grilla, porque es lo que se lee en la vista de lista de Wallet.
  `frentePase` con `hayGrilla: true` devuelve `primario: null`, así que tomar ese campo dejaría a
  Android **sin el contador de sellos**. Y la rama sin grilla ya agrega la palabra, así que
  `${valor} sellos` encima daría "3 de 8 sellos sellos".
- [ ] **`hoyIso` sale del servidor** con `hoyEnZona(comercio.zona_horaria)`, nunca de un `new Date()`
  dentro del componente cliente (mismatch de hidratación), y `zona_horaria` hay que agregarla al
  `select` de la página de Marca. **La vista previa pasa `vigenciaHasta: null`** y ahí
  `describirSaldo` ya dice "Sin activar" / "Disponible" sin mirar el reloj: es el estado real de una
  tarjeta recién emitida.
- [ ] Apple: `encabezado` → `headerFields` (está libre). Google: `encabezado` → `textModulesData`,
  y la vigencia → `validTimeInterval`. **`versionHero` NO se toca**: versiona la URL de una imagen y
  estos campos no dibujan nada.
- [ ] `nombre_pase` se edita en Marca junto a la meta de sellos y, **en modo negocio, escribe el
  programa PRINCIPAL** — el mismo camino que ya usa `sello_meta` en `guardarBranding`. No entra en
  `brandingEfectivo` ni en `hayMarcaPropia`: es identidad del programa, no branding heredable.
- [ ] **Asimetría conocida, se documenta:** Google marca el pase vencido con `validTimeInterval`;
  Apple no (su `expirationDate` está fuera de alcance) y su texto se refresca con el push, que
  ocurre al operar la tarjeta. Un pase de Apple de una membresía vencida va a decir "Activa hasta
  el 3 de agosto" hasta el próximo escaneo.

---

### Task 7 (controlador): verificación y cierre

- [ ] Suite completa, typecheck, lint.
- [ ] Navegador: el panel de una membresía (carta de socios activos, barra con Programas y sin
  Premios), y el editor de marca con el nombre del pase y la vigencia en la vista previa.
- [ ] `scripts/verificar-0033.ts` contra la BD.
- [ ] Estado del proyecto, commit, merge y push.

# Estado del proyecto y plan para continuar — FM Lealtad

> **Propósito:** documento de retomada. Si empezás una sesión nueva, leé esto primero: dice qué
> está hecho, qué falta, en qué orden, y las trampas que ya nos mordieron. Es la fuente de verdad
> del estado; los planes (`plans/2026-07-16-*.md`) son la fuente de verdad del *cómo* de cada tarea.
>
> Última actualización: **2026-07-17**.

---

## 1. TL;DR

- **Fases 0+1 (walking skeleton Apple Wallet):** COMPLETO, en producción, validado en iPhone real.
- **Panel de FM (`/admin`):** COMPLETO, fusionado a `master`, desplegado, verificado con clic real
  en `https://loyalty-cards-rose.vercel.app/admin/login`.
- **Fase 3a (panel del dueño `/comercio` + catálogo de tipos de tarjeta + tarjetas de sellos):**
  CÓDIGO COMPLETO en la rama `feature/fase3-autogestion-catalogo` (HEAD `a83b382`). Las **16 tareas de
  código (1–16) están hechas, comiteadas y verificadas**: **92 pruebas de Vitest verdes** + e2e de
  Playwright (el flujo de registro corre en vivo y pasa; los de FM/dueño están escritos y se saltan sin
  credenciales `E2E_*`). Migración `0005` aplicada. Falta solo: el **paso del usuario** (crear el bucket
  y sembrar la cuenta del dueño, luego e2e manual — Tarea 15) y la **Tarea 17 (merge a `master` +
  deploy)**, que espera aprobación explícita. El portal del cliente es un plan aparte (migración
  `0006`), aún sin empezar.
- **Google Wallet:** pausado a pedido del usuario (sin tiempo). No es que esté roto — no se empezó.

---

## 2. Lo que está VIVO en producción (`master`)

`master` HEAD = `66918ed` (más los commits de planes `adcf049`, `1462cd7`). Desplegado en Vercel
(proyecto `loyalty-cards`, alias `loyalty-cards-rose.vercel.app`).

- **Registro público:** `/registro/[comercioSlug]` → tarjeta firmada `.pkpass` → Apple Wallet.
- **Panel de FM `/admin`:** login con cuenta compartida, lista de comercios, crear/editar/**eliminar**
  comercio (licencia + branding). Gate de auth `verifyFmAdmin` en layout + cada página + cada acción.
- Cuenta de FM ya sembrada: `soporte@fmcomsolutions.com` (1 fila en `usuarios_fm`). La contraseña la
  eligió el usuario en su terminal — **nunca pasa por el chat**.

Comercio real en la base: **Cafetería Piloto** (`slug=cafeteria-piloto`), con 1 tarjeta real ligada
a un pass de Apple en el iPhone del usuario. **Nunca borrar ni mutar esa fila en pruebas.**

---

## 3. Fase 3 — los dos frentes

Diseñada solo por el asistente bajo autonomía explícita del usuario ("no me preguntes nada"), pero
con specs escritos, auto-aprobados con esa nota, y pasados igual por revisión. Dos documentos porque
son superficies distintas:

### 3a. Autogestión + catálogo (panel del dueño)
- **Spec:** `docs/superpowers/specs/2026-07-16-fase3-autogestion-catalogo-design.md` (revisado 2 veces).
- **Plan:** `docs/superpowers/plans/2026-07-16-fase3-autogestion-catalogo.md` (**18 tareas, 0–17**,
  total final **91 pruebas**; revisado 1 vez y corregido).
- Qué construye: catálogo `tipo_tarjeta` (8 tipos, solo `puntos`+`sellos` funcionales; los otros 6
  salen "Próximamente" deshabilitados), tarjetas de **sellos** como **texto** ("7 de 10 sellos", NO
  imagen — este proyecto no tiene pipeline de composición de imágenes), login propio del dueño
  (`/comercio`, cuentas individuales en `usuarios_comercio`), CRUD de branding/reglas/recompensas,
  subida de imágenes a Supabase Storage mediada por el servidor, y pruebas Playwright.

### 3b. Portal del cliente
- **Spec:** `docs/superpowers/specs/2026-07-16-portal-cliente-design.md` (revisado 2 veces).
- **Plan:** `docs/superpowers/plans/2026-07-16-portal-cliente.md` (**10 tareas, 0–9**, total final
  **78 pruebas**; revisado 1 vez y corregido).
- Qué construye: `/mi-tarjeta` — el cliente ingresa su teléfono, ve su saldo y recompensas, y puede
  re-descargar el pass. PWA instalable (íconos generados con `next/og`, honesto sobre que en iOS es
  "Compartir → Agregar a inicio", no un prompt del navegador). Límite de intentos por IP contra
  enumeración de teléfonos.
- **DEPENDENCIA DURA:** su migración es `0006` y **lee `comercios.tipo_tarjeta`/`sello_meta`** → la
  Fase 3a debe aterrizar (al menos su migración `0005` + `types.ts`) ANTES de este plan. Correr
  `ls supabase/migrations/` para confirmar el próximo número libre antes de crear la migración.

---

## 4. Progreso concreto en la rama `feature/fase3-autogestion-catalogo`

Rama sacada de `master`. Estado: **69 pruebas verdes, typecheck/lint/build limpios.** Commits:

| Commit | Tarea | Qué |
|---|---|---|
| `88f155b` | 1 | Migración `0005` local + `types.ts` (columnas nuevas + join `usuarios_comercio→comercios`) |
| `70a3aaf` | 2 | Constante `TIPOS_TARJETA` + validación de `tipo_tarjeta` en `guardarComercio` + `leerDatos` |
| `5e652df` | 5 | `esOwnerDeComercio` + `verifyComercioOwner` (gate del dueño, clon exacto de `esAdminFm`) |

**La migración `0005` YA está aplicada en la base viva** (el usuario la pegó en Studio; verificado:
Cafetería Piloto intacta con `tipo_tarjeta='puntos'`, los dos CHECK rechazan valores inválidos).

### ✅ Deuda de proceso — SALDADA (2026-07-17)
Estas 3 tareas se habían escrito a mano SIN la doble revisión (una caída del clasificador de auto-mode
+ límite de sesión bloquearon el despacho de subagentes). **Ya se saldó:** las Tareas 2 y 5 pasaron
por revisión de calidad independiente (subagentes `superpowers:code-reviewer`) — **ambas aprobadas,
sin issues Critical ni Important.** La compliance de spec se verificó a nivel controlador (los diffs
coinciden textualmente con planes ya revisados). Único cambio derivado: la prueba del gate del dueño
(`esOwnerDeComercio.test.ts`) no mataba de forma robusta la mutación del filtro `.eq('auth_user_id')`
(dependía de que la BD tuviera exactamente 1 owner); se agregó una prueba de discriminación que la
mata siempre, verificada con mutation-testing real (commit `1a56279`). Baseline: 69 → **70 pruebas**.

---

## 5. Estado de las tareas — TODO el código de 3a está hecho (2026-07-17)

**Tareas 1–16: HECHAS, comiteadas y verificadas** en `feature/fase3-autogestion-catalogo` (HEAD
`a83b382`; commits en §4). Cada tarea con lógica pasó por TDD + **mutation-testing** (romper la línea,
ver fallar la prueba correcta, restaurar); las mecánicas por build/typecheck/lint. Resumen:

- **T3** `<select>` de `tipo_tarjeta` en FM · **T4** sellos como texto `"N de M sellos"` en el pass
  (rama `puntos` **byte-idéntica** → el pass real de Cafetería Piloto queda intacto).
- **T6** login/logout del dueño · **T7** layout protegido `(protegido)` + panel · **T8** proxy
  extendido a `/comercio` (revisado archivo completo; redirects en vivo se validan por Playwright).
- **T9** script del bucket `comercio-imagenes` (el usuario lo corre) · **T10** validadores de imagen ·
  **T11** `guardarBranding` · **T12** página de branding (subida real a Storage + maqueta de colores).
- **T13** CRUD de reglas (hard-delete) · **T14** CRUD de recompensas — **SOFT-DELETE
  (`update({activa:false})`)**, protegido por el test linchpin + mutation-test (`.delete()` lo rompe).
- **T15 (script)** `scripts/seed-usuario-comercio.ts` + `npm run seed-comercio` · **T16** Playwright:
  registro→pass corre en vivo y PASA; FM y dueño escritos, se saltan sin `E2E_*`. Corregido: Playwright
  no cargaba `.env.local` — se agregó `dotenv` a `playwright.config.ts`.

**Lo que falta para cerrar 3a — DOS pasos del USUARIO + el merge:**
- **Bucket de Storage:** correr `npm run seed-bucket` (crea `comercio-imagenes`, público de lectura).
- **Tarea 15 (PASO DEL USUARIO):** `npm run seed-comercio -- <email> "<pass>" cafeteria-piloto` en tu
  terminal (contraseña nunca por chat); opcional: poner `E2E_FM_*`/`E2E_OWNER_*` en `.env.local` para
  correr los 3 e2e; luego verificación manual e2e del panel (plan Task 15 Step 3, 10 pasos).
- **Tarea 17 (merge + deploy) — espera tu aprobación explícita** (despliega a producción):
  `git checkout master && git merge --ff-only feature/fase3-autogestion-catalogo && git push origin master`.

Después, **todo el plan del portal** (`2026-07-16-portal-cliente.md`), que depende de que 3a esté en
la base (migración `0006`).

---

## 6. Cómo retomar (mecánico)

```bash
cd "C:/Users/Daniel/Desktop/Loyalty Cards"
git checkout feature/fase3-autogestion-catalogo
git status                 # árbol limpio esperado
npm test                   # 92 passed esperado (todo 3a hecho); npm run e2e para los Playwright
```

- **Baseline real de `npm test` = 92** (el plan dice 91 porque no cuenta el test extra de
  endurecimiento del gate, `1a56279`). Desglose: 61 base + 3 (T2) + 2 (T4) + 5 (T5) + 1 (endurecimiento)
  + 6 (T10) + 4 (T11) + 5 (T13) + 5 (T14) = **92**. Playwright corre aparte (`npm run e2e`, no cuenta).
- **Migraciones se aplican A MANO.** El asistente NO puede correr `ALTER TABLE` (solo tiene llaves de
  API, no conexión directa a Postgres; el CLI de Supabase ve otra cuenta). Cuando una tarea tenga
  migración: el asistente escribe el `.sql` y lo pega en el chat, el usuario lo corre en Studio y
  avisa. El asistente verifica después con un script de solo-lectura contra la base.
- **Ejecución vía subagent-driven-development** con implementador + revisión de spec + revisión de
  calidad por tarea (skill `superpowers:subagent-driven-development`). Instrucción del usuario vigente:
  "la manera más segura y eficiente". Mantener las mutaciones para probar que las pruebas muerden.

---

## 7. Trampas que YA nos mordieron (no repetir)

- **`git`/commits:** identidad `Daniel <268727888+dann1103-eng@users.noreply.github.com>` — el form
  noreply es OBLIGATORIO (GH007 rechaza el gmail real). Commits con `-m` plano, SIN here-strings de
  PowerShell (corrompen el mensaje). `core.autocrlf=true`: para comparar bloques del plan contra
  archivos, usar `git show`/`git cat-file`, NO el working tree (muestra cada línea como cambiada).
- **`proxy.ts` layout trap:** `app/admin/layout.tsx` (y `app/comercio/layout.tsx`) NUNCA deben existir
  — un route group NO puede sacar una página de un layout que está por ENCIMA del grupo. El gate va
  DENTRO de `(protegido)`. Seguir el plan viejo al pie de la letra producía el `ERR_TOO_MANY_REDIRECTS`
  que decía prevenir.
- **`redirect()` lanza `NEXT_REDIRECT`:** envolver `verifyFmAdmin()`/`verifyComercioOwner()` en
  try/catch y tragarse el error DESACTIVA el gate. Llamarlos siempre FUERA de try/catch.
- **La BD NO respalda la validación de branding** (colores, monto, nombre): `validar()` en
  `guardarComercio.ts` es la única defensa (solo `licencia_estado` y `tipo_tarjeta` tienen CHECK).
  Cualquier ruta que escriba comercios saltándose `validar()` puede meter un color malo que revienta
  al firmar el pass en producción. Decisión: no duplicar la regex de color en SQL (dos copias divergen).
- **Teléfono siempre canónico:** cualquier búsqueda por teléfono debe llamar `normalizarTelefono()`
  primero (ver memoria del proyecto). Un `.trim()` a secas nunca matchea.
- **NO iniciar dev server** desde subagentes (`TaskStop` deja el hijo escuchando en el puerto 3000).
  La verificación visual la hace el controlador con las herramientas de navegador administradas, o el
  usuario a mano.
- **`SUPABASE_SERVICE_ROLE_KEY` nunca al bundle del navegador** (`import 'server-only'` + sin prefijo
  `NEXT_PUBLIC_`). Nunca leer/imprimir `.env.local`.
- **Infra flaky (2026-07-17):** el clasificador de seguridad de auto-mode puede caerse y bloquear TODO
  Bash/PowerShell (Read/Write siguen). Salir de auto-mode (aprobación manual) lo evita. Los subagentes
  pueden topar "session limit" con hora de reset fija. Cuando ambos pasan, NO seguir escribiendo código
  sin poder verificarlo.

---

## 8. Decisión de retomada — RESUELTA (2026-07-17)

Se tomó la **opción 1 (recomendada):** revisar las Tareas 2 y 5 antes de construir más. Hecho —
ambas aprobadas, gate del dueño endurecido (ver §4). El punto de control quedó comiteado en
`1a56279`. **Lo que sigue ahora es construir**, en el orden de dependencias de §5: empezar por las
tareas independientes de la migración (3, 4, 6, 8, 9), cada una vía subagent-driven-development
(implementador + revisión de spec + revisión de calidad), con mutation-testing en las ramas críticas.

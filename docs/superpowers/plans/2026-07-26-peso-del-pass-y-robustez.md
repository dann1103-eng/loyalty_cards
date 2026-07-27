# Peso del pass y robustez de actualización — plan

> **Para trabajadores agénticos:** SUB-SKILL REQUERIDA: superpowers:subagent-driven-development.

**Objetivo:** que un pass nunca vuelva a pesar tanto como para que la tarjeta tarde en actualizarse,
y que eso quede protegido por una prueba y no por la memoria de alguien.

**Punto de partida medido (2026-07-26, Farmacias ABC en producción):** 1763 KB.

| Parte | Peso | Por qué |
|-------|------|---------|
| `logo.png` + `@2x` + `@3x` | 331 KB × 3 = **993 KB** | El MISMO buffer de 480 px va en las tres densidades. |
| `strip.png` + `@2x` + `@3x` | 51 + 177 + 341 = **569 KB** | PNG de una foto. PNG es pésimo formato para fotos, y Apple no acepta otro. |
| resto (icon, pass.json, firma) | ~200 KB | |

**Arquitectura:** redimensionar y comprimir **al emitir el pass**, no al subir la imagen. La razón que
decide: funciona retroactivamente con todos los logos ya guardados, sin que ningún comercio vuelva a
subir nada. El costo en CPU es despreciable al lado de la composición de franjas con satori que ya
ocurre en ese mismo camino.

**Spec:** no hay documento aparte; este plan es la especificación. El proyecto es chico y su diseño
cabe acá.

## Reglas del proyecto que NO se negocian

- **Código y comentarios en ESPAÑOL.**
- **Mutation-testing obligatorio** en las ramas críticas.
- **No inicies el dev server.**
- Commits: identidad `Daniel <268727888+dann1103-eng@users.noreply.github.com>`, `-m` plano sin
  acentos en el subject, trailer `Co-Authored-By: Claude <noreply@anthropic.com>`.

## Estructura de archivos

| Archivo | Responsabilidad |
|---------|-----------------|
| `package.json` | **MODIFICAR.** `sharp` como dependencia explícita. |
| `lib/apple/imagenesPass.ts` | **CREAR.** Redimensionado y compresión de las imágenes que entran al pass. |
| `lib/apple/imagenesPass.test.ts` | **CREAR.** |
| `lib/apple/generatePass.ts` | **MODIFICAR.** Logo por densidad. |
| `lib/apple/stripPass.tsx` | **MODIFICAR.** Comprimir la salida de satori. |
| `lib/apple/pesoPass.test.ts` | **CREAR.** El presupuesto de peso: la prueba que impide la regresión. |
| `app/api/tarjetas/[tarjetaId]/puntos/` | **BORRAR.** Código muerto (ver Tarea 1). |

---

### Tarea 1: Borrar el endpoint muerto de puntos

**Requiere confirmación del usuario antes de ejecutarse.**

`app/api/tarjetas/[tarjetaId]/puntos/route.ts` es un resto del walking skeleton. Su propio comentario
lo dice: "El curl manual del piloto ya no aplica: el flujo es /comercio/escanear". Verificado que
**nadie lo llama**: las únicas referencias a `/api/tarjetas/…` en la app son `pass.pkpass` y
`google-wallet`.

No es inofensivo. Acredita puntos:
- **sin atribución de sucursal ni cajero** — el escáner sí las pasa, así que este camino ensucia el
  ledger y los reportes de BI con filas sin atribuir;
- **sin `syncObjetoTarjeta`** — una tarjeta de Google Wallet no se actualizaría por acá.

Parcharlo sería peor que borrarlo: dejaría parecer soportado un camino que rompe la atribución.

- [ ] **Paso 1:** Borrar el directorio completo (incluido su `.test.ts` si existe).
- [ ] **Paso 2:** `npx tsc --noEmit` y `npx vitest run` — nada debe romperse.
- [ ] **Paso 3:** Commit.

---

### Tarea 2: `lib/apple/imagenesPass.ts` — el módulo de imágenes

**Archivos:** crear `lib/apple/imagenesPass.ts` y su test; modificar `package.json`.

- [ ] **Paso 1:** Agregar `sharp` a `dependencies` con la versión que ya está instalada
  (`node -e "console.log(require('sharp/package.json').version)"`). Hoy `sharp` está disponible solo
  de rebote porque lo arrastra Next: importarlo sin declararlo es frágil ante cualquier cambio de
  su árbol de dependencias.

- [ ] **Paso 2: Pruebas primero.** Casos:
  1. `redimensionarLogo` devuelve las tres densidades con los anchos correctos (160 / 320 / 480) y
     **cada una pesa menos que la anterior**.
  2. Conserva la transparencia: un PNG con alfa sigue teniendo canal alfa después.
  3. No agranda: un logo de 100 px de ancho no se estira a 480.
  4. `comprimirPng` reduce el peso de un PNG fotográfico y **devuelve el original si el resultado
     pesara más** (pasa con imágenes ya optimizadas o de pocos colores).
  5. Ante un buffer que no es una imagen, ninguna de las dos lanza: devuelven el original.

- [ ] **Paso 3:** Verlas fallar.

- [ ] **Paso 4: Implementar.** Dos funciones exportadas:

```ts
export const ANCHOS_LOGO = [160, 320, 480] as const;  // @1x, @2x, @3x del area real de Apple
export async function redimensionarLogo(buf: Buffer): Promise<[Buffer, Buffer, Buffer]>
export async function comprimirPng(buf: Buffer): Promise<Buffer>
```

`redimensionarLogo`: `sharp(buf).resize({ width, withoutEnlargement: true }).png({ compressionLevel: 9 })`.
Los anchos salen del área que Apple dibuja para el logo (160×50 pt).

`comprimirPng`: `sharp(buf).png({ palette: true, quality: 80, effort: 8 })`. La cuantización a paleta
es lo que corta el peso de un PNG fotográfico; el `if (resultado.length >= buf.length) return buf`
evita el caso en que empeora.

**Best-effort SIEMPRE**: cualquier fallo devuelve el buffer original. Este módulo no puede ser la
razón por la que un cliente se quede sin tarjeta.

- [ ] **Paso 5:** Verde. **Paso 6:** Mutation-testing:
  1. Quitar `withoutEnlargement` → debe fallar la prueba 3.
  2. Quitar el `if (resultado.length >= buf.length)` → debe fallar la prueba 4.
  3. Devolver el mismo buffer en las tres densidades → debe fallar la prueba 1.

- [ ] **Paso 7:** Commit.

---

### Tarea 3: Cablear el logo por densidad y comprimir las franjas

**Archivos:** modificar `lib/apple/generatePass.ts` y `lib/apple/stripPass.tsx`.

- [ ] **Paso 1:** En `generatePass.ts`, reemplazar los tres `addBuffer` que hoy meten **el mismo
  buffer** por las tres densidades reales de `redimensionarLogo`. Dejá el comentario explicando que
  antes iba el mismo buffer tres veces y cuánto costaba (993 KB de 1763).

- [ ] **Paso 2:** En `stripPass.tsx`, pasar cada salida de satori por `comprimirPng` antes de
  devolverla.

⚠️ **Medí el resultado visual, no lo asumas.** La cuantización a paleta puede producir bandas
visibles en un degradado. Generá una franja antes y después y compará peso Y aspecto. Si el bandeo
se nota, subí `quality` o descartá la compresión de franjas y reportalo: media tarjeta fea no vale
200 KB.

- [ ] **Paso 3:** `npx vitest run lib/apple/` y `npx tsc --noEmit`.
- [ ] **Paso 4:** Commit.

---

### Tarea 4: El presupuesto de peso — la prueba que impide la regresión

**Archivo:** crear `lib/apple/pesoPass.test.ts`.

Esto es el "nunca más". Ya existe `scripts/verificar-wallet.ts`, pero solo sirve si alguien se acuerda
de correrlo. Una prueba corre siempre.

- [ ] **Paso 1:** La prueba genera un pass con el **peor caso realista**, no con imágenes de 1 píxel:
  un logo sintético de 480×480 y una foto de fondo de 1400×1400, ambos generados con `sharp` en el
  propio test (ruido a todo color, que es lo que peor comprime). Asierta que el `.pkpass` resultante
  pesa menos que el presupuesto.

- [ ] **Paso 2:** El presupuesto vive en UNA constante exportada y compartida con
  `scripts/verificar-wallet.ts` (hoy tiene su propio `PESO_PASS_SOSPECHOSO_KB = 700`): dos números
  que significan lo mismo en dos archivos divergen. Movelo a `lib/apple/imagenesPass.ts` y que el
  script lo importe.

- [ ] **Paso 3:** Mutation-testing: devolvé el mismo buffer en las tres densidades del logo → la
  prueba de presupuesto debe FALLAR. Si no falla, el peor caso que armaste no es lo bastante malo y
  la prueba no protege nada.

- [ ] **Paso 4:** Commit.

---

### Tarea 5: Cierre

- [ ] `npx vitest run` completo y `npx tsc --noEmit`.
- [ ] Push a master, esperar el despliegue de Vercel.
- [ ] `npx tsx --conditions=react-server scripts/verificar-wallet.ts https://www.cardly-sv.site` —
  medir el peso real y compararlo con los 1763 KB de partida.
- [ ] Anotar el resultado en `docs/superpowers/ESTADO-Y-PLAN-2026-07-25.md`.

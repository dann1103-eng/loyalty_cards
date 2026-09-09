# Coherencia por tipo en las pantallas (entrega 1 de 2) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que ninguna pantalla del dueño ni del cliente muestre un número en la unidad equivocada, un texto que hable de sellos a quien no los tiene, ni un tutorial que no se pueda completar.

**Architecture:** No se escribe lógica de dominio nueva. El repositorio ya tiene los módulos puros que resuelven los ocho tipos (`describirFila` + `COLUMNAS_ESTADO`, `describirCosto`/`unidadPrograma`, `frentePase`/`contadorPase`, `TIPOS`); casi todos los defectos son consumidores que no los usan. El trabajo es enrutarlos por ahí y, donde falta una pieza, agregar un módulo puro chico con pruebas de mutación (`resumenPrograma`, `pasosParaTipo`, `textosPorTipo`).

**Tech Stack:** Next.js 16 (App Router, Server Components), React 19, TypeScript, Supabase, vitest (`environment: 'node'`, integración contra la BD remota, sin pruebas de componentes).

**Spec:** `docs/superpowers/specs/2026-09-08-coherencia-por-tipo-de-tarjeta-design.md`. Manda sobre este plan si difieren. Esta entrega cubre los **Grupos 1, 1-bis, 2 y 6**. Los Grupos 3, 4 y 5 (reportes, secciones muertas y la identidad del pase) van en la entrega 2, que además lleva migración.

**Esta entrega NO tiene migración.** Se puede desplegar sola.

---

## Reglas para TODAS las tareas

- **Checkout:** el trabajo vive en el worktree
  `C:\Users\Daniel\Desktop\Proyectos\Loyalty Cards\.claude\worktrees\brand-editor-preview-adjustments-e82e88`
  (rama `claude/brand-editor-preview-adjustments-e82e88`). Verificalo con
  `git -C "<esa ruta>" branch --show-current` ANTES de tocar nada. Prefijá cada comando con
  `cd "<esa ruta>" &&` y usá rutas absolutas en Read/Write/Edit. `node_modules` es una junction y
  `.env.local` está copiado.
- **Español** en identificadores, comentarios y textos de interfaz. Comentarios que digan POR QUÉ.
- **TDD y mutación** en toda rama crítica: prueba en rojo, mínimo para verde, romper la línea que la
  prueba dice proteger y confirmar que FALLA por el motivo correcto, restaurar. Anotarlo en la prueba.
- **No inicies el dev server.** La verificación en navegador la hace el controlador.
- **Commits:** `git -c user.name="Daniel" -c user.email="268727888+dann1103-eng@users.noreply.github.com" commit -m "<titulo sin tildes>" -m "<cuerpo>" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"`. Nunca `git add -A`.
- `npx tsc --noEmit` limpio al cerrar cada tarea.

---

### Task 1: `textosPorTipo` — el fin de los textos cableados

**Files:** Create `lib/tarjetas/textosPorTipo.ts` y su `.test.ts`.

Módulo puro con UNA tabla por concepto, cubriendo los ocho tipos. El patrón ya existe en el
repositorio (`ETIQUETA_PRINCIPAL` del escáner, `CTA_POR_TIPO` del cartel): un `Record<string, …>`
que una prueba obliga a cubrir entero, para que un tipo nuevo no herede "puntos" por descuido.

- [ ] **Step 1: prueba en rojo**

```ts
import { describe, it, expect } from 'vitest';
import { TIPOS } from './tipos';
import { textoAtajoEscanear, textoAtajoReglas, promesaRegistro, placeholderInactividad, placeholderCercania, rotuloTarjeta } from './textosPorTipo';

// La razón de ser del módulo: hasta el 2026-09-08 estos seis textos estaban cableados a sellos o a
// puntos, así que los OTROS SEIS tipos leían una mecánica que su tarjeta no tiene. El caso que lo
// destapó: un comercio de membresía cuyo panel le decía "Sumá sellos/puntos o canjeá premios".
describe('textosPorTipo', () => {
  // EL guardián. Un tipo nuevo en TIPOS sin su texto acá rompe esta prueba, no la produccion.
  it('las seis tablas cubren los OCHO tipos, sin heredar el de puntos por descuido', () => {
    for (const tipo of TIPOS) {
      for (const [nombre, fn] of [
        ['atajo escanear', textoAtajoEscanear], ['atajo reglas', textoAtajoReglas],
        ['promesa registro', promesaRegistro], ['placeholder inactividad', placeholderInactividad],
        ['placeholder cercania', placeholderCercania], ['rotulo tarjeta', rotuloTarjeta],
      ] as const) {
        const texto = fn(tipo.valor);
        expect(texto, `${nombre} de ${tipo.valor}`).toBeTruthy();
      }
    }
  });

  it('membresía no habla de sumar, de sellos ni de premios en ningún texto', () => {
    // MUTACIÓN: devolver el texto de 'puntos' en el default de cualquier tabla rompe esta prueba.
    const textos = [textoAtajoEscanear, textoAtajoReglas, promesaRegistro, placeholderInactividad, placeholderCercania, rotuloTarjeta].map((f) => f('membresia').toLowerCase());
    for (const t of textos) {
      expect(t).not.toMatch(/sello|punto|premio|sum[áa]|acumul/);
    }
  });

  it('cada tipo dice lo suyo: renovar en membresía, canjear en cupón, saldo en gift card', () => {
    expect(textoAtajoEscanear('membresia').toLowerCase()).toContain('renov');
    expect(textoAtajoEscanear('cupon').toLowerCase()).toContain('cup');
    expect(textoAtajoEscanear('gift_card').toLowerCase()).toContain('saldo');
    expect(rotuloTarjeta('membresia')).toBe('Membresía');
  });

  it('un tipo desconocido cae al de puntos, nunca a undefined', () => {
    // Mismo criterio que tipoOPuntos: una fila vieja de la BD no puede dejar una pantalla en blanco.
    expect(textoAtajoEscanear('inventado')).toBe(textoAtajoEscanear('puntos'));
  });
});
```

- [ ] **Step 2:** correr, ver el rojo (módulo inexistente).
- [ ] **Step 3:** implementar `textosPorTipo.ts`. Seis funciones, cada una con su `Record<string, string>` de ocho entradas y un fallback a `puntos` vía `tipoOPuntos(valor).valor`. `rotuloTarjeta` devuelve la etiqueta de `TIPOS`. Comentario de cabecera explicando el defecto que cierra, con el caso de la membresía.
- [ ] **Step 4:** verde. Mutación: reemplazar el `Record` de `textoAtajoEscanear` por uno con solo `puntos` y confirmar que fallan la de cobertura y la de membresía.
- [ ] **Step 5:** commit (`"Los textos del panel salen de una tabla por tipo, no de un if sobre sellos"`).

---

### Task 2: `pasosParaTipo` — el tutorial que se puede completar

**Files:** Modify `lib/comercio/primerosPasos.ts` y su prueba (crearla si no existe).

- [ ] **Step 1: pruebas en rojo**

```ts
import { describe, it, expect } from 'vitest';
import { TIPOS } from '@/lib/tarjetas/tipos';
import { pasosParaTipo } from './primerosPasos';

// EL defecto que este cambio cierra (2026-09-08): los cuatro pasos eran fijos y hablaban de sellos.
// Para membresía el paso 2 apuntaba a Reglas, que para ese tipo ESCONDE el formulario y dice "tu
// tarjeta no necesita estas reglas". O sea que era imposible de completar, y como PrimerosPasos
// solo se esconde con los cuatro hechos, el dueño quedaba clavado en "1 de 4" para siempre.
describe('pasosParaTipo', () => {
  it('los ocho tipos tienen exactamente cuatro pasos, con clave, título, detalle y href', () => {
    for (const tipo of TIPOS) {
      const pasos = pasosParaTipo(tipo.valor);
      expect(pasos, tipo.valor).toHaveLength(4);
      for (const p of pasos) {
        expect(p.clave && p.titulo && p.detalle && p.href, `${tipo.valor}/${p.clave}`).toBeTruthy();
      }
    }
  });

  it('NINGÚN tipo sin unidad manda a Reglas: esa pantalla le esconde el formulario', () => {
    // MUTACIÓN: volver a una lista fija con el paso 'reglas' rompe acá, que es el bug original.
    for (const tipo of TIPOS.filter((t) => t.contador === 'ninguno' || t.contador === 'centavos')) {
      const destinos = pasosParaTipo(tipo.valor).map((p) => p.href);
      expect(destinos, tipo.valor).not.toContain('/comercio/reglas');
    }
  });

  it('NINGÚN tipo sin contador manda a cargar un premio: no se puede canjear nunca', () => {
    for (const tipo of TIPOS.filter((t) => t.contador === 'ninguno')) {
      const destinos = pasosParaTipo(tipo.valor).map((p) => p.href);
      expect(destinos, tipo.valor).not.toContain('/comercio/recompensas');
    }
  });

  it('membresía y cupón piden su plazo y sus términos', () => {
    for (const tipo of ['membresia', 'cupon']) {
      const claves = pasosParaTipo(tipo).map((p) => p.clave);
      expect(claves, tipo).toEqual(['marca', 'configuracion', 'terminos', 'cliente']);
    }
  });

  it('puntos y sellos conservan los cuatro pasos de siempre', () => {
    for (const tipo of ['puntos', 'sellos']) {
      expect(pasosParaTipo(tipo).map((p) => p.clave)).toEqual(['marca', 'reglas', 'premio', 'cliente']);
    }
  });
});
```

- [ ] **Step 2:** rojo.
- [ ] **Step 3:** implementar. `pasosParaTipo(tipo)` devuelve el catálogo sin estado, según la tabla del spec (Grupo 2). `primerosPasos(supabase, comercioId, tipo)` resuelve el `hecho` de cada clave:
  - `marca`: `comercios.logo_url`.
  - `reglas`: fila en `reglas_puntos`.
  - `premio`: recompensa activa.
  - `configuracion`: la columna del PROGRAMA PRINCIPAL que ese tipo necesita (`membresia_dias`, `cupon_vigencia_dias`, `cashback_porcentaje`, `multipass_visitas`), o una fila en `niveles_descuento` para descuento.
  - `terminos`: **con la herencia del pase**, `reversoEfectivo(comercio, programaPrincipal).terminosUso` no vacío. Leer solo la columna del programa dejaría clavado al dueño que escribió sus términos en modo negocio, que es el flujo por defecto.
  - `cliente`: alguna tarjeta.
  Conservar el comentario de cabecera que explica por qué el estado se deriva y no se guarda.
- [ ] **Step 4:** verde; mutación indicada; `PrimerosPasos.tsx` no cambia (recibe los pasos ya resueltos); `panel/page.tsx` pasa el tipo del principal.
- [ ] **Step 5:** commit.

---

### Task 3: `resumenPrograma` — la métrica del panel deja de mezclar unidades

**Files:** Create `lib/tarjetas/resumenPrograma.ts` y su `.test.ts`; modify `app/comercio/(protegido)/panel/page.tsx`.

- [ ] **Step 1: pruebas en rojo.** Casos obligatorios, con `hoyIso` fijo:
  - `puntos`/`sellos`/`prepago`: suma en su unidad ("1 240 sellos").
  - `gift_card`/`cashback`: `formatearCentavos` ("$1 250.00"), **nunca** el entero.
  - `membresia`/`cupon`: vigentes sobre total ("12 activas · de 15"), contando con `sigueVigente` contra `hoyIso`; un cupón `usado_en` no cuenta como vigente.
  - `descuento`: cuántos superaron algún umbral, usando `nivelParaAcumulado`.
  - Sin filas: devuelve `null` (el panel no dibuja la carta).
  - MUTACIÓN a documentar: devolver el entero crudo en la rama de centavos reproduce el "2500 puntos" sobre $25.00.
- [ ] **Step 2:** rojo.
- [ ] **Step 3:** implementar. Firma pura:
  `resumenPrograma({ tipoTarjeta, selloMeta, filas, niveles, hoyIso }) → { etiqueta, valor, sub } | null`,
  donde `filas` son `FilaEstado[]` del programa. Reusa `formatearCentavos`, `unidadPrograma`,
  `sigueVigente` y `nivelParaAcumulado`; no reimplementa ninguna.
- [ ] **Step 4:** `panel/page.tsx`: la consulta trae `COLUMNAS_ESTADO` **más `programa_id`**, se agrupa por programa activo, y se dibuja una carta por programa (con su nombre cuando hay más de uno). `hoyIso` con `hoyEnZona(comercio.zona_horaria)`, agregando `zona_horaria` al `select`. Los niveles de descuento se leen una vez por comercio. La carta de "Clientes con tarjeta" no cambia.
- [ ] **Step 5:** verde, typecheck, commit.

---

### Task 4: La pantalla que ve el cliente al registrarse

**Files:** Modify `app/registro/[comercioSlug]/RegistroCliente.tsx`, `app/registro/[comercioSlug]/page.tsx`, `app/registro/[comercioSlug]/[programaSlug]/page.tsx`.

Es el hallazgo más caro: el dueño personaliza su marca y la primera pantalla que su cliente ve
usa un degradado marrón fijo, dice "Tarjeta de lealtad" y "0 Puntos", y promete sumar puntos.

- [ ] **Step 1:** las dos páginas ya resuelven el programa con `resolverProgramaPorSlug` (o sea que
  el tipo NO hay que consultarlo, hay que pasarlo). Agregar la consulta del **branding efectivo**
  con `brandingEfectivo`, con las mismas columnas que usa el editor de marca.
- [ ] **Step 2:** `RegistroCliente` recibe `tipoTarjeta`, `selloMeta` y la marca. `VistaTarjeta`
  usa `colorFondo`/`colorTexto`/`colorLabel` y el logo si lo hay; el contador sale de `frentePase`
  y **no se dibuja** cuando no hay; el rótulo superior sale de `rotuloTarjeta` (Task 1); la promesa
  sale de `promesaRegistro` (Task 1).
- [ ] **Step 3:** typecheck y lint. Verificación visual: la hace el controlador (Task 9).
- [ ] **Step 4:** commit.

---

### Task 5: El historial deja de llamar "Acreditación" a una renovación

**Files:** Modify `lib/comercio/historial.ts` y su prueba; `app/comercio/(protegido)/clientes/[tarjetaId]/page.tsx`; `app/mi-tarjeta/PortalCliente.tsx`.

- [ ] **Step 1: prueba en rojo.** `normalizarClase` colapsa `uso` y `renovacion` en `acreditacion`,
  así que una renovación de membresía se le muestra al dueño Y al cliente como "Acreditación +0", y
  un cobro de gift card como "Acreditación -1250". La prueba fija: cada tipo del ledger conserva su
  clase, y `etiquetaClase` devuelve "Uso" y "Renovación".
- [ ] **Step 2-3:** implementar; `ClaseMovimiento` gana los dos valores.
- [ ] **Step 4:** las dos pantallas imprimen el delta y el saldo con `describirCosto` y, en contador
  `'ninguno'`, **no imprimen número**. Ojo con el portal: es lo que ve el cliente.
- [ ] **Step 5:** verde, mutación (volver a colapsar rompe la prueba), commit.

---

### Task 6: El CSV, el escáner y los controles antifraude

**Files:** Modify `lib/comercio/exportarClientes.ts` (+prueba), `app/comercio/(protegido)/escanear/actions.ts`, `app/comercio/(protegido)/reglas/page.tsx`, `app/comercio/(protegido)/reglas/FormularioControles.tsx`.

- [ ] **Step 1:** CSV: la columna "Saldo" sale vacía en cupón, membresía y descuento porque usa
  `describirCosto` (pensado para costos). Pasa a `describirFila` + `COLUMNAS_ESTADO` en el `select`
  (hoy no trae `vigencia_hasta` ni `usado_en`), con prueba de que una membresía exporta su fecha.
- [ ] **Step 2:** escáner: el mensaje `'Sello agregado.'` está en **DOS** sitios (la acreditación
  normal y el switch por tipo). Los dos salen de la unidad del tipo, en una sola función compartida.
- [ ] **Step 3:** controles antifraude: `FormularioControles` recibe la `Unidad` en vez del booleano
  `esDePuntos`, así los seis tipos que no son puntos dejan de leer "Control de sellos".
  `reglas/page.tsx` ya la calcula y no la pasa.
- [ ] **Step 4:** verde, typecheck, commit.

---

### Task 7: Los textos del panel, el portal y las notificaciones

**Files:** Modify `app/comercio/(protegido)/panel/page.tsx` (ATAJOS), `app/comercio/(protegido)/clientes/page.tsx`, `app/comercio/(protegido)/clientes/[tarjetaId]/page.tsx`, `app/comercio/(protegido)/branding/FormularioBranding.tsx`, `app/mi-tarjeta/PortalCliente.tsx`, `app/comercio/(protegido)/reglas/FormularioAvisoInactividad.tsx`, `app/comercio/(protegido)/sucursales/FormularioGeopush.tsx`, `app/comercio/(protegido)/recompensas/page.tsx`.

Todo consume Task 1. Sin lógica nueva.

- [ ] **Step 1:** los tres subtítulos de ATAJOS; la nota del directorio de clientes; los botones
  "Acreditar / Canjear", que salen de `accionPrincipal`; el pie de la vista previa de marca; el
  texto de entrada del portal; los dos placeholders; y en `recompensas/page.tsx` un aviso como el
  que ya tiene Reglas cuando el tipo no puede canjear, más `describirCosto` para el costo.
- [ ] **Step 2:** typecheck, lint, commit.

---

### Task 8: El panel de FM

**Files:** Modify `app/admin/(protegido)/comercios/FormularioComercio.tsx`.

- [ ] La vista previa del alta usa `esSellos ? '0 de 10' : '0'` y dice "Puntos" a una membresía.
  Pasa por `frentePase`, igual que las otras dos réplicas de la tarjeta. Commit.

---

### Task 9 (controlador): verificación y cierre

- [ ] Suite completa, typecheck, lint.
- [ ] Navegador contra el dev server del worktree: el panel de una membresía (tutorial completable,
  carta de socios activos, atajos sin sellos), y la pantalla de registro con la marca del comercio.
  Como está detrás del login, usar el método del repositorio: una página temporal que renderice los
  componentes reales fuera del gate, medir con `getBoundingClientRect`/`innerText`, y **borrarla**.
- [ ] Sección en `ESTADO-Y-PLAN`, commit, y anunciar la entrega 2.

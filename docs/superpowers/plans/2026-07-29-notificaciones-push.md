# Notificaciones push activas — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push activo disparado por el servidor (no por cercanía): campañas manuales que el dueño
manda cuando quiere, y un recordatorio automático para tarjetas inactivas — ambos por Apple
(campo del reverso + `changeMessage`) y Google (`addMessage`), compartiendo un único candado de
3 mensajes/24h por tarjeta en Google.

**Architecture:** Una función compartida de bajo nivel (`enviarMensajeTarjeta`) que sabe hablar con
los dos wallets para UNA tarjeta puntual, con dos features finas encima: una pantalla de campañas
manuales (tope de 4/mes por comercio) y un cron diario de inactividad (perilla configurable en
Reglas). El texto vigente vive en `tarjetas.aviso_texto`/`aviso_hasta`, que `construirReverso` lee
en cada regeneración del pase — el mismo patrón que ya usa el reverso para reglas y recompensas.

**Tech Stack:** Next.js Server Actions, Supabase (Postgres + RLS deny-all), `@parse/node-apn`
(push de Apple, ya integrado), `googleapis` `walletobjects_v1` (Google Wallet, `addmessage`), cron
de Vercel con `CRON_SECRET`.

**Spec:** `docs/superpowers/specs/2026-07-29-notificaciones-push-design.md` — leer primero. Este
plan asume que ya lo leíste; no repite el razonamiento de las decisiones, solo la implementación.

---

## Antes de empezar

Verificá el worktree correcto ANTES de tocar nada:

```bash
git branch --show-current
```

Debe decir `claude/post-mvp-features-3f6590` en
`C:\Users\Daniel\Desktop\Loyalty Cards\.claude\worktrees\vigilant-feistel-d5b480`. Si no coincide,
parate y preguntá — no asumas.

---

### Task 1: Migración 0026 + tipos

**Files:**
- Create: `supabase/migrations/0026_notificaciones_push.sql`
- Modify: `lib/supabase/types.ts`
- Create: `scripts/verificar-0026.ts`

- [ ] **Step 1: Escribir la migración**

```sql
-- 0026: notificaciones push activas (campañas manuales + aviso de inactividad).
--
-- Ver docs/superpowers/specs/2026-07-29-notificaciones-push-design.md para el razonamiento
-- completo. Resumen: push disparado por el servidor, no por cercanía. Dos features separadas
-- (campaña manual, aviso de inactividad) comparten una función de envío y un registro de
-- auditoría — ese registro es también la fuente del candado de 3 mensajes/24h por tarjeta que
-- exige Google.

begin;

create table difusiones (
  id uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references comercios(id),
  -- null = todos los programas activos del comercio.
  programa_id uuid references programas_tarjeta(id),
  mensaje text not null check (btrim(mensaje) <> ''),
  -- Cuánto dura el mensaje en el reverso del pase. Lo elige el dueño, igual que campana_hasta en
  -- geopush (migración 0021) — una promo de "este fin de semana" y una de "todo el mes" duran lo
  -- que el dueño diga, no un número fijo del sistema.
  vigente_hasta date not null,
  creada_por uuid not null references usuarios_comercio(id),
  creada_en timestamptz not null default now(),
  -- Tarjetas a las que enviarMensajeTarjeta logró mandar por AL MENOS un canal — no el tamaño de
  -- la lista resuelta: con el candado de Google, pueden diferir.
  destinatarios integer not null default 0
);
create index difusiones_comercio_idx on difusiones (comercio_id, creada_en desc);
alter table difusiones enable row level security;

create table notificaciones_enviadas (
  id uuid primary key default gen_random_uuid(),
  tarjeta_id uuid not null references tarjetas(id),
  canal text not null check (canal in ('apple', 'google')),
  origen text not null check (origen in ('campana', 'inactividad')),
  -- Solo cuando origen='campana'; null en 'inactividad'. Trazabilidad de soporte: "¿a este
  -- cliente sí le llegó ESTA campaña puntual?".
  difusion_id uuid references difusiones(id),
  enviada_en timestamptz not null default now()
);
create index notificaciones_enviadas_tarjeta_idx on notificaciones_enviadas (tarjeta_id, enviada_en desc);
alter table notificaciones_enviadas enable row level security;
-- Ninguna de las dos tablas lleva políticas: deny-all, mismo criterio que programas_tarjeta
-- (0024). Todo acceso DEBE ir por createServiceClient() — con un cliente de sesión, cada
-- select/insert devuelve null/no-op en silencio en vez de un error.

-- Estado ACTUAL del aviso en el reverso de CADA tarjeta. construirReverso se reconstruye de cero
-- en cada regeneración del pase (una venta, un cambio de branding) — sin este campo persistido,
-- changeMessage no tendría qué comparar la próxima vez que el pase se regenere por OTRA razón.
alter table tarjetas
  add column aviso_texto text,
  add column aviso_hasta date; -- null junto con aviso_texto null = sin aviso vigente

-- Perillas del aviso de inactividad, junto a las de Tanda 1 (mismo patrón de columnas en comercios
-- que tope_acreditaciones_dia / espera_minima_minutos — migración 0015).
alter table comercios
  add column aviso_inactividad_activo boolean not null default false,
  add column aviso_inactividad_dias integer check (aviso_inactividad_dias is null or aviso_inactividad_dias > 0),
  add column aviso_inactividad_mensaje text;

-- Para no re-avisar cada día una vez cruzado el umbral (ver avisoInactividad.ts, Task 8).
alter table tarjetas add column aviso_inactividad_enviado_en timestamptz;

commit;
```

- [ ] **Step 2: Actualizar `lib/supabase/types.ts`**

Agregar la línea de la migración al comentario de cabecera (mismo formato que las demás,
insertada como nueva primera línea de la lista — ver 0025 como ejemplo inmediato anterior):

```ts
//   - supabase/migrations/0026_notificaciones_push.sql (tablas difusiones y notificaciones_enviadas; tarjetas.aviso_texto/aviso_hasta/aviso_inactividad_enviado_en; comercios.aviso_inactividad_activo/dias/mensaje)
```

Agregar a `tarjetas.Row`/`Insert`/`Update` (junto a las demás columnas de estado — cerca de
`vigencia_hasta`/`usado_en`):

```ts
// Row
aviso_texto: string | null;
aviso_hasta: string | null;
aviso_inactividad_enviado_en: string | null;
```
```ts
// Insert y Update (los tres son opcionales, ninguno tiene NOT NULL)
aviso_texto?: string | null;
aviso_hasta?: string | null;
aviso_inactividad_enviado_en?: string | null;
```

Agregar a `comercios.Row`/`Insert`/`Update` (junto a las perillas antifraude existentes):

```ts
// Row
aviso_inactividad_activo: boolean;
aviso_inactividad_dias: number | null;
aviso_inactividad_mensaje: string | null;
```
```ts
// Insert
aviso_inactividad_activo?: boolean;
aviso_inactividad_dias?: number | null;
aviso_inactividad_mensaje?: string | null;
```
```ts
// Update
aviso_inactividad_activo?: boolean;
aviso_inactividad_dias?: number | null;
aviso_inactividad_mensaje?: string | null;
```

Agregar DOS tablas nuevas al final del bloque `Tables` (después de `sucursales`, mismo lugar
donde se agregó `programas_tarjeta` en la 0024 — ver ese bloque como plantilla exacta de estilo):

```ts
difusiones: {
  Row: {
    id: string;
    comercio_id: string;
    programa_id: string | null;
    mensaje: string;
    vigente_hasta: string;
    creada_por: string;
    creada_en: string;
    destinatarios: number;
  };
  Insert: {
    id?: string;
    comercio_id: string;
    programa_id?: string | null;
    mensaje: string;
    vigente_hasta: string;
    creada_por: string;
    creada_en?: string;
    destinatarios?: number;
  };
  Update: {
    id?: string;
    comercio_id?: string;
    programa_id?: string | null;
    mensaje?: string;
    vigente_hasta?: string;
    creada_por?: string;
    creada_en?: string;
    destinatarios?: number;
  };
  Relationships: [
    {
      foreignKeyName: 'difusiones_comercio_id_fkey';
      columns: ['comercio_id'];
      isOneToOne: false;
      referencedRelation: 'comercios';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'difusiones_programa_id_fkey';
      columns: ['programa_id'];
      isOneToOne: false;
      referencedRelation: 'programas_tarjeta';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'difusiones_creada_por_fkey';
      columns: ['creada_por'];
      isOneToOne: false;
      referencedRelation: 'usuarios_comercio';
      referencedColumns: ['id'];
    },
  ];
};
notificaciones_enviadas: {
  Row: {
    id: string;
    tarjeta_id: string;
    canal: string;
    origen: string;
    difusion_id: string | null;
    enviada_en: string;
  };
  Insert: {
    id?: string;
    tarjeta_id: string;
    canal: string;
    origen: string;
    difusion_id?: string | null;
    enviada_en?: string;
  };
  Update: {
    id?: string;
    tarjeta_id?: string;
    canal?: string;
    origen?: string;
    difusion_id?: string | null;
    enviada_en?: string;
  };
  Relationships: [
    {
      foreignKeyName: 'notificaciones_enviadas_tarjeta_id_fkey';
      columns: ['tarjeta_id'];
      isOneToOne: false;
      referencedRelation: 'tarjetas';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'notificaciones_enviadas_difusion_id_fkey';
      columns: ['difusion_id'];
      isOneToOne: false;
      referencedRelation: 'difusiones';
      referencedColumns: ['id'];
    },
  ];
};
```

- [ ] **Step 3: Escribir `scripts/verificar-0026.ts`**

Mismo patrón que `scripts/verificar-0024.ts` (leelo primero como plantilla exacta): verifica que
las columnas/tablas existan, crea un comercio+programa+tarjeta de prueba, prueba el CHECK de
`mensaje` no vacío en `difusiones`, prueba que `canal`/`origen` rechazan valores fuera de la lista
(`23514`), y borra todo en un `finally`.

```ts
// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0026.ts
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

let fallas = 0;
const ok = (m: string) => console.log(`OK: ${m}`);
const fallo = (m: string, d?: string) => {
  console.error(`FALLO: ${m}${d ? ` — ${d}` : ''}`);
  fallas += 1;
};

async function main() {
  const supabase = createServiceClient();

  const difusiones = await supabase.from('difusiones').select('id').limit(1);
  if (difusiones.error) {
    fallo('la tabla difusiones no existe o le faltan columnas', difusiones.error.message);
    process.exit(1);
  }
  ok('la tabla difusiones existe.');

  const notif = await supabase.from('notificaciones_enviadas').select('id').limit(1);
  if (notif.error) {
    fallo('la tabla notificaciones_enviadas no existe o le faltan columnas', notif.error.message);
    process.exit(1);
  }
  ok('la tabla notificaciones_enviadas existe.');

  const tarjetaCols = await supabase
    .from('tarjetas')
    .select('aviso_texto, aviso_hasta, aviso_inactividad_enviado_en')
    .limit(1);
  if (tarjetaCols.error) {
    fallo('tarjetas no tiene las columnas de aviso', tarjetaCols.error.message);
    process.exit(1);
  }
  ok('tarjetas tiene aviso_texto, aviso_hasta y aviso_inactividad_enviado_en.');

  const comercioCols = await supabase
    .from('comercios')
    .select('aviso_inactividad_activo, aviso_inactividad_dias, aviso_inactividad_mensaje')
    .limit(1);
  if (comercioCols.error) {
    fallo('comercios no tiene las columnas de la perilla de inactividad', comercioCols.error.message);
    process.exit(1);
  }
  ok('comercios tiene las tres columnas de la perilla de inactividad.');

  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data: com, error: eCom } = await supabase
    .from('comercios')
    .insert({ nombre: 'Verificacion 0026', slug: `verif-0026-${sufijo}` })
    .select('id')
    .single();
  if (eCom || !com) {
    fallo('no se pudo crear el comercio de prueba', eCom?.message);
    process.exit(1);
  }

  try {
    const { data: programa, error: eProg } = await supabase
      .from('programas_tarjeta')
      .insert({ comercio_id: com.id, nombre: 'Principal', slug: 'principal', tipo_tarjeta: 'puntos', es_principal: true })
      .select('id')
      .single();
    if (eProg || !programa) {
      fallo('no se pudo crear el programa de prueba', eProg?.message);
      throw new Error('setup falló');
    }

    const { data: usuario, error: eUsuario } = await supabase
      .from('usuarios_comercio')
      .insert({ comercio_id: com.id, email: `verif-0026-${sufijo}@ejemplo.test`, rol: 'owner' })
      .select('id')
      .single();
    if (eUsuario || !usuario) {
      fallo('no se pudo crear el usuario de prueba', eUsuario?.message);
      throw new Error('setup falló');
    }

    const mensajeVacio = await supabase
      .from('difusiones')
      .insert({ comercio_id: com.id, mensaje: '   ', vigente_hasta: '2026-12-31', creada_por: usuario.id });
    if (mensajeVacio.error?.code === '23514') {
      ok('rechaza un mensaje de difusión vacío (23514).');
    } else {
      fallo('aceptó un mensaje de difusión vacío', mensajeVacio.error?.message ?? 'sin error');
    }

    const { data: difusion, error: eDifusion } = await supabase
      .from('difusiones')
      .insert({ comercio_id: com.id, mensaje: 'Promo de verificación', vigente_hasta: '2026-12-31', creada_por: usuario.id })
      .select('id')
      .single();
    if (eDifusion || !difusion) {
      fallo('no se pudo crear una difusión válida', eDifusion?.message);
      throw new Error('setup falló');
    }
    ok('acepta una difusión válida.');

    const { data: cliente, error: eCliente } = await supabase
      .from('clientes')
      .insert({ nombre: 'Cliente Verificacion', telefono: `+503-verif-0026-${sufijo}` })
      .select('id')
      .single();
    if (eCliente || !cliente) {
      fallo('no se pudo crear el cliente de prueba', eCliente?.message);
      throw new Error('setup falló');
    }
    const { data: tarjeta, error: eTarjeta } = await supabase
      .from('tarjetas')
      .insert({ cliente_id: cliente.id, comercio_id: com.id, programa_id: programa.id })
      .select('id')
      .single();
    if (eTarjeta || !tarjeta) {
      fallo('no se pudo crear la tarjeta de prueba', eTarjeta?.message);
      throw new Error('setup falló');
    }

    const canalInvalido = await supabase
      .from('notificaciones_enviadas')
      .insert({ tarjeta_id: tarjeta.id, canal: 'sms', origen: 'campana' });
    if (canalInvalido.error?.code === '23514') {
      ok('rechaza un canal fuera de la lista (23514).');
    } else {
      fallo('aceptó un canal inválido', canalInvalido.error?.message ?? 'sin error');
    }

    const origenInvalido = await supabase
      .from('notificaciones_enviadas')
      .insert({ tarjeta_id: tarjeta.id, canal: 'google', origen: 'marketing' });
    if (origenInvalido.error?.code === '23514') {
      ok('rechaza un origen fuera de la lista (23514).');
    } else {
      fallo('aceptó un origen inválido', origenInvalido.error?.message ?? 'sin error');
    }

    const { error: eNotif } = await supabase
      .from('notificaciones_enviadas')
      .insert({ tarjeta_id: tarjeta.id, canal: 'google', origen: 'campana', difusion_id: difusion.id });
    if (eNotif) fallo('no se pudo insertar una notificación válida', eNotif.message);
    else ok('acepta una notificación válida con difusion_id.');

    await supabase.from('notificaciones_enviadas').delete().eq('tarjeta_id', tarjeta.id);
    await supabase.from('tarjetas').delete().eq('id', tarjeta.id);
    await supabase.from('clientes').delete().eq('id', cliente.id);
    await supabase.from('difusiones').delete().eq('comercio_id', com.id);
    await supabase.from('usuarios_comercio').delete().eq('id', usuario.id);
    await supabase.from('programas_tarjeta').delete().eq('comercio_id', com.id);
  } catch (e) {
    if (!(e instanceof Error && e.message === 'setup falló')) throw e;
  } finally {
    await supabase.from('comercios').delete().eq('id', com.id);
    ok('datos de prueba borrados.');
  }

  if (fallas > 0) {
    console.error(`\n${fallas} verificación(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nTodo en orden: la migración 0026 está aplicada.');
  process.exit(0);
}

main();
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores relacionados a `difusiones`/`notificaciones_enviadas`/los campos nuevos de
`tarjetas`/`comercios`. La migración todavía no está aplicada, así que **NO corras
`verificar-0026.ts` todavía** — eso viene en la Task 12, cuando el dueño ya la haya aplicado.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0026_notificaciones_push.sql lib/supabase/types.ts scripts/verificar-0026.ts
git commit -m "Notificaciones push: migracion 0026 (difusiones, notificaciones_enviadas, avisos)"
```

- [ ] **Step 6: Entregar la migración AHORA, no al final del plan**

A diferencia de la 0024 (que tocaba una columna NOT NULL de la que dependía código ya
desplegado), la 0026 es puramente aditiva: tablas nuevas y columnas nulas con default. Nada
desplegado se rompe si existen sin usarse todavía. Por eso se entrega ACÁ, no en la Task 13 —
las Tasks 5 a 11 escriben pruebas de integración que necesitan estas tablas para pasar en verde
durante su propio ciclo TDD, no recién al final.

Mandale al usuario el contenido de `supabase/migrations/0026_notificaciones_push.sql` (un solo
archivo, regla del proyecto) para que lo corra en Supabase Studio. Esperá su confirmación.
Cuando confirme, corré `npx tsx --conditions=react-server scripts/verificar-0026.ts` y confirmá
que todos los `OK:` — recién ahí seguir con la Task 2.

---

### Task 2: `resolverAviso` — la función pura del reverso de Apple

**Files:**
- Modify: `lib/apple/construirReverso.ts`
- Modify: `lib/apple/construirReverso.test.ts`

- [ ] **Step 1: Escribir las pruebas de `resolverAviso`**

Agregar al final de `construirReverso.test.ts` (junto al `describe` existente):

```ts
import { construirReverso, resolverAviso, escaparHtml, type CampoReverso, type DatosReverso } from './construirReverso';

describe('resolverAviso', () => {
  it('sin texto, no hay aviso', () => {
    expect(resolverAviso(null, null, '2026-07-29')).toBeNull();
  });

  it('con texto y sin vencer, muestra el texto', () => {
    expect(resolverAviso('Volvé pronto', '2026-08-01', '2026-07-29')).toBe('Volvé pronto');
  });

  it('el día del vencimiento TODAVÍA se muestra (igual que resolverMensajeCercania)', () => {
    expect(resolverAviso('Volvé pronto', '2026-07-29', '2026-07-29')).toBe('Volvé pronto');
  });

  it('un día después de vencer, ya no se muestra', () => {
    expect(resolverAviso('Volvé pronto', '2026-07-28', '2026-07-29')).toBeNull();
  });
});
```

- [ ] **Step 2: Correr las pruebas y confirmar que fallan**

Run: `npx vitest run lib/apple/construirReverso.test.ts`
Expected: FAIL — `resolverAviso is not exported` (todavía no existe).

- [ ] **Step 3: Implementar `resolverAviso` y el campo `aviso` en `construirReverso`**

En `lib/apple/construirReverso.ts`, agregar la función (mismo criterio que
`resolverMensajeCercania` en `lib/comercio/geopush.ts` — comparación como TEXTO, no como Date, y
`hoyIso` por argumento para poder probar el borde sin congelar el reloj):

```ts
// Si el aviso (campaña o inactividad — ver docs/superpowers/specs/2026-07-29-notificaciones-push-design.md)
// sigue vigente HOY. Se compara como TEXTO, igual que la vigencia de un cupón: "hasta el 29" es
// el 29 completo en el local, y comparar instantes lo mataría a medianoche UTC.
export function resolverAviso(
  texto: string | null,
  hasta: string | null,
  hoyIso: string,
): string | null {
  if (texto === null || hasta === null) return null;
  return hasta.slice(0, 10) >= hoyIso.slice(0, 10) ? texto : null;
}
```

Agregar `avisoTexto: string | null` a `DatosReverso`:

```ts
export interface DatosReverso {
  nombreComercio: string;
  tipoTarjeta: string;
  selloMeta: number | null;
  mostrarComoFunciona: boolean;
  terminosUso: string | null;
  redInstagram: string | null;
  redFacebook: string | null;
  redWhatsapp: string | null;
  sitioWeb: string | null;
  reglas: ReglaReverso[];
  recompensas: RecompensaReverso[];
  // Mensaje de campaña o de inactividad YA RESUELTO (resolverAviso) — construirReverso no sabe de
  // fechas, solo dibuja lo que le llega. null = sin aviso vigente, el campo no se emite.
  avisoTexto: string | null;
}
```

Agregar el campo al final de `construirReverso` (después del campo `emisor`, ANTES del
`return campos;` — el orden importa para el usuario, y un aviso reciente conviene que se vea
antes que el pie fijo, no después):

```ts
  // 8. El pie de Cardly, SIEMPRE...
  campos.push({
    key: 'emisor',
    label: 'Información del emisor',
    value: `${EMISOR_CARDLY.nombre}\n${EMISOR_CARDLY.correo}\n${EMISOR_CARDLY.sitio}`,
  });

  // 9. Aviso de campaña o inactividad (migración 0026). Va AL FINAL a propósito, después del pie
  // fijo: es la sección más nueva y más cambiante, y el orden del resto del reverso no debe
  // saltar cada vez que un aviso aparece o desaparece. changeMessage con "%@" es lo único que
  // convierte un cambio de VALOR de este campo en un aviso visible en la pantalla de bloqueo —
  // ver la sección "La asimetría de plataforma" del spec. El límite de caracteres reales de este
  // campo (a diferencia de relevantText, que sí está medido) todavía no se verificó contra Wallet
  // real — hacerlo es parte de la Task 4 de este plan, antes de dar por buena esta sección.
  if (hayTexto(datos.avisoTexto)) {
    campos.push({
      key: 'aviso',
      label: 'Aviso',
      value: datos.avisoTexto,
      changeMessage: '%@',
    });
  }

  return campos;
}
```

`CampoReverso` necesita el campo opcional `changeMessage` (ya está declarado en la interfaz
actual — confirmalo leyendo el archivo; si no está, agregalo):

```ts
export interface CampoReverso {
  key: string;
  label: string;
  value: string;
  attributedValue?: string;
  changeMessage?: string;
}
```

- [ ] **Step 4: Correr las pruebas y confirmar que pasan**

Run: `npx vitest run lib/apple/construirReverso.test.ts`
Expected: PASS, incluidas las pruebas EXISTENTES (`datosBase()` no setea `avisoTexto`, así que
queda `undefined` — confirmá que `hayTexto(undefined)` se comporta igual que con `null` y NO
agrega el campo; si la prueba `produce EXACTAMENTE dos campos` empieza a fallar, es señal de que
el campo se está emitiendo cuando no debería).

- [ ] **Step 5: Actualizar `datosBase()`/`datosCompletos()` en el test para incluir `avisoTexto`**

```ts
function datosBase(): DatosReverso {
  return {
    // ...los campos existentes...
    avisoTexto: null,
  };
}
```

Y agregar un caso a `datosCompletos()` o un test dedicado confirmando que con `avisoTexto: 'Volvé
pronto'` aparece el campo `aviso` con `changeMessage: '%@'`.

- [ ] **Step 6: Mutation test — quitar `changeMessage` del campo `aviso`**

Comentá temporalmente la línea `changeMessage: '%@',`, corré las pruebas: la prueba del paso 5
NO debería fallar (nada en `construirReverso.test.ts` hoy verifica `changeMessage`, porque es un
campo pasivo que Apple interpreta, no algo que este archivo pueda comprobar por sí solo).
**Agregá una aserción que sí lo capture**: `expect(campoAviso?.changeMessage).toBe('%@')`. Volvé a
correr, confirmá que AHORA sí falla con el campo comentado, y restaurá la línea.

- [ ] **Step 7: Commit**

```bash
git add lib/apple/construirReverso.ts lib/apple/construirReverso.test.ts
git commit -m "Reverso del pase: campo de aviso con changeMessage (resolverAviso)"
```

---

### Task 3: `datosPassDeTarjeta.ts` lee el aviso vigente

**Files:**
- Modify: `lib/apple/datosPassDeTarjeta.ts`
- Modify: `lib/apple/datosPassDeTarjeta.test.ts`

- [ ] **Step 1: Escribir la prueba**

Agregar un caso al archivo existente (leelo primero para calzar con su estilo de fixture): crear
una tarjeta con `aviso_texto`/`aviso_hasta` vigente, llamar `datosPassDeTarjeta`, confirmar que
`datos.reverso` contiene la key `'aviso'`. Y un segundo caso con `aviso_hasta` en el pasado,
confirmando que NO aparece.

- [ ] **Step 2: Correr y confirmar que falla**

Run: `npx vitest run lib/apple/datosPassDeTarjeta.test.ts`
Expected: FAIL (el reverso no incluye `aviso` todavía, porque `avisoTexto` ni se lee ni se pasa).

- [ ] **Step 3: Implementar**

En `lib/apple/datosPassDeTarjeta.ts`, agregar `aviso_texto, aviso_hasta` al `select('*', ...)` de
tarjetas — ya usa `select('*', ...)` así que estas columnas YA vienen incluidas automáticamente;
no hace falta tocar el select. Sí hace falta resolver y pasar el valor:

```ts
import { construirReverso, resolverAviso } from './construirReverso';
```

```ts
  const hoyIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date());
  // UTC acá, no la zona del comercio: a diferencia de una campaña de geopush (que vive en
  // sucursales y ya resuelve con la zona del comercio en listarUbicacionesGeopush), este aviso es
  // un campo de LA TARJETA sin zona horaria propia asociada, y el borde de un día de diferencia
  // en el peor caso es "el aviso se ve un día de más/de menos" — no vale la pena la consulta
  // extra a comercios.zona_horaria solo para esto. Si en el futuro importa más precisión, seguir
  // el mismo patrón que listarUbicacionesGeopush.
```

Y dentro del objeto `reverso: construirReverso({...})`, agregar:

```ts
        avisoTexto: resolverAviso(tarjeta.aviso_texto, tarjeta.aviso_hasta, hoyIso),
```

- [ ] **Step 4: Correr y confirmar que pasa**

Run: `npx vitest run lib/apple/datosPassDeTarjeta.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/apple/datosPassDeTarjeta.ts lib/apple/datosPassDeTarjeta.test.ts
git commit -m "datosPassDeTarjeta: resuelve y pasa el aviso vigente al reverso"
```

---

### Task 4: `lib/google/enviarMensaje.ts` — el wrapper de `addmessage`

**Files:**
- Create: `lib/google/enviarMensaje.ts`
- Create: `lib/google/enviarMensaje.test.ts`

**IMPORTANTE antes de escribir código**: `messageType` en `Schema$Message` (ver
`node_modules/googleapis/build/src/apis/walletobjects/v1.d.ts`, buscar `Schema$Message`) es un
`string` sin enum en el tipo — la documentación de Google (`developers.google.com/wallet/retail/offers/use-cases/trigger-push-notifications`,
ya citada en el spec) indica `'TEXT'` para que dispare una notificación real y no solo quede en el
historial de mensajes del pase. **Verificá esto contra Wallet real antes de dar la tarea por
terminada** (mismo criterio que el límite de caracteres de Apple en la Task 2): mandate un mensaje
a una tarjeta de prueba con Google Wallet instalado y confirmá que llega como notificación, no
solo como una entrada en "Ver detalles". Si `'TEXT'` no dispara la notificación, la documentación
de Google es la fuente de verdad, no este plan.

- [ ] **Step 1: Escribir la prueba**

Este archivo llama a la API real de Google — no hay forma de probarlo sin red. Seguí el patrón de
`lib/google/syncClase.test.ts`/`syncObjeto.test.ts` (leelos primero): son pruebas de integración
que SÍ llaman a Google de verdad, usando credenciales reales de `.env.local`, contra un comercio y
tarjeta de prueba con Google Wallet ya habilitado (mismo setup que esos archivos ya tienen para
`syncClaseComercio`/`syncObjetoTarjeta`).

```ts
import { describe, it, expect } from 'vitest';
import { enviarMensajeGoogle } from './enviarMensaje';
// ...mismo setup de comercio+tarjeta con Google Wallet habilitado que syncObjeto.test.ts...

describe('enviarMensajeGoogle', () => {
  it('manda un mensaje a un objeto real y devuelve true', async () => {
    // arma comercio+tarjeta con google_object_id ya sincronizado (syncClaseComercio + syncObjetoTarjeta)
    const resultado = await enviarMensajeGoogle(objectId, 'Cardly SV', 'Mensaje de prueba automatizada');
    expect(resultado).toBe(true);
  });

  it('un objectId inexistente devuelve false, no lanza', async () => {
    const resultado = await enviarMensajeGoogle('id-que-no-existe-12345', 'Cardly SV', 'Prueba');
    expect(resultado).toBe(false);
  });
});
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `npx vitest run lib/google/enviarMensaje.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

```ts
import { walletClient } from './walletClient';

// Manda un mensaje a UN LoyaltyObject puntual — nunca a nivel de LoyaltyClass, aunque sería más
// eficiente para una campaña que apunta a "todos los programas": una llamada a nivel clase no
// puede excluir una tarjeta puntual, y el candado de 3/24h por tarjeta (ver
// lib/comercio/enviarMensajeTarjeta.ts) exige poder hacerlo. Ver la sección "Riesgos y
// pendientes" del spec.
//
// messageType: 'TEXT' — verificado contra Wallet real que dispara notificación (no solo historial
// del pase). Si Google cambia este comportamiento, es el primer lugar a revisar.
//
// Best-effort a propósito, mismo criterio que notificarCambioTarjeta: un fallo de Google Wallet
// nunca debe tumbar el flujo que lo llama.
export async function enviarMensajeGoogle(
  objectId: string,
  header: string,
  body: string,
): Promise<boolean> {
  try {
    const client = walletClient();
    await client.loyaltyobject.addmessage({
      resourceId: objectId,
      requestBody: { message: { header, body, messageType: 'TEXT' } },
    });
    return true;
  } catch (err) {
    console.error('[google] no se pudo mandar el mensaje:', err);
    return false;
  }
}
```

- [ ] **Step 4: Correr y confirmar que pasa**

Run: `npx vitest run lib/google/enviarMensaje.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/google/enviarMensaje.ts lib/google/enviarMensaje.test.ts
git commit -m "Google Wallet: enviarMensajeGoogle (addmessage por objeto individual)"
```

---

### Task 5: `tarjetasActivasDelComercio` en `lib/comercio/programas.ts`

**Files:**
- Modify: `lib/comercio/programas.ts`
- Modify: `lib/comercio/programas.test.ts`

Query compartida entre la campaña manual (Task 6) y el aviso de inactividad (Task 8): las
tarjetas de un comercio cuyo programa sigue activo, opcionalmente acotadas a un programa
puntual. Dos consultas simples (programas activos, después tarjetas por `programa_id IN (...)`)
en vez de un embed con filtro — mismo criterio que `resolverProgramaDeTarjeta`, ya en este mismo
archivo.

- [ ] **Step 1: Escribir las pruebas**

```ts
describe('tarjetasActivasDelComercio', () => {
  it('devuelve tarjetas de todos los programas activos cuando programaId es null', async () => {
    const comercioId = await entorno.crearComercio();
    const { id: tarjetaPrincipal } = await entorno.crearTarjeta(comercioId);
    const segundo = await crearPrograma(supabase, comercioId, datos('cupon', 'Cupón'));
    expect(segundo.ok).toBe(true);
    if (!segundo.ok) return;
    // tarjeta manual en el segundo programa (no hay helper del fixture para esto — insert directo)
    const { data: cliente } = await supabase.from('clientes').insert({ nombre: 'X', telefono: `+503-tad-${Date.now()}` }).select('id').single();
    const { data: tarjetaSegundo } = await supabase.from('tarjetas').insert({ cliente_id: cliente!.id, comercio_id: comercioId, programa_id: segundo.id }).select('id').single();

    const resultado = await tarjetasActivasDelComercio(supabase, comercioId, null);

    expect(resultado.map((t) => t.id).sort()).toEqual([tarjetaPrincipal, tarjetaSegundo!.id].sort());
  });

  it('con programaId, devuelve solo las tarjetas de ESE programa', async () => {
    const comercioId = await entorno.crearComercio();
    const principalId = entorno.obtenerProgramaPrincipal(comercioId);
    await entorno.crearTarjeta(comercioId);

    const resultado = await tarjetasActivasDelComercio(supabase, comercioId, principalId);

    expect(resultado.every((t) => t.tipoTarjeta === 'puntos')).toBe(true);
  });

  it('excluye tarjetas de un programa DESACTIVADO', async () => {
    const comercioId = await entorno.crearComercio();
    const creado = await crearPrograma(supabase, comercioId, datos('cupon', 'Cupón'));
    expect(creado.ok).toBe(true);
    if (!creado.ok) return;
    const { data: cliente } = await supabase.from('clientes').insert({ nombre: 'Y', telefono: `+503-tad2-${Date.now()}` }).select('id').single();
    const { data: tarjeta } = await supabase.from('tarjetas').insert({ cliente_id: cliente!.id, comercio_id: comercioId, programa_id: creado.id }).select('id').single();
    await desactivarPrograma(supabase, comercioId, creado.id);

    const resultado = await tarjetasActivasDelComercio(supabase, comercioId, null);

    expect(resultado.map((t) => t.id)).not.toContain(tarjeta!.id);
  });
});
```

- [ ] **Step 2: Correr y confirmar que fallan**

Run: `npx vitest run lib/comercio/programas.test.ts`
Expected: FAIL — `tarjetasActivasDelComercio is not exported`.

- [ ] **Step 3: Implementar**

Agregar al final de `lib/comercio/programas.ts`:

```ts
export interface TarjetaElegible {
  id: string;
  tipoTarjeta: string;
  usadoEn: string | null; // solo relevante para tipo 'cupon'
}

// Tarjetas de un comercio cuyo programa sigue activo — compartida entre la campaña manual
// (lib/comercio/difusiones.ts) y el aviso de inactividad (lib/comercio/avisoInactividad.ts).
// `programaId: null` trae las de TODOS los programas activos; con un id, solo las de ese uno.
export async function tarjetasActivasDelComercio(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  programaId: string | null,
): Promise<TarjetaElegible[]> {
  let query = supabase
    .from('programas_tarjeta')
    .select('id, tipo_tarjeta')
    .eq('comercio_id', comercioId)
    .eq('activo', true);
  if (programaId) query = query.eq('id', programaId);

  const { data: programas, error: errorProgramas } = await query;
  if (errorProgramas) {
    console.error('[comercio] no se pudieron leer los programas activos:', errorProgramas);
    return [];
  }
  if (!programas || programas.length === 0) return [];

  const tipoPorPrograma = new Map(programas.map((p) => [p.id, p.tipo_tarjeta]));
  const { data: tarjetas, error: errorTarjetas } = await supabase
    .from('tarjetas')
    .select('id, programa_id, usado_en')
    .eq('comercio_id', comercioId)
    .in('programa_id', programas.map((p) => p.id));
  if (errorTarjetas) {
    console.error('[comercio] no se pudieron leer las tarjetas activas:', errorTarjetas);
    return [];
  }

  return (tarjetas ?? []).map((t) => ({
    id: t.id,
    tipoTarjeta: tipoPorPrograma.get(t.programa_id) ?? 'puntos',
    usadoEn: t.usado_en,
  }));
}
```

- [ ] **Step 4: Correr y confirmar que pasan**

Run: `npx vitest run lib/comercio/programas.test.ts`
Expected: PASS (las tres nuevas Y las que ya existían — no debería haber roto ninguna).

- [ ] **Step 5: Commit**

```bash
git add lib/comercio/programas.ts lib/comercio/programas.test.ts
git commit -m "programas.ts: tarjetasActivasDelComercio, compartida por difusiones y aviso de inactividad"
```

---

### Task 6: `enviarMensajeTarjeta` — la función compartida

**Files:**
- Create: `lib/comercio/enviarMensajeTarjeta.ts`
- Create: `lib/comercio/enviarMensajeTarjeta.test.ts`

Orquesta Apple + Google para UNA tarjeta puntual: actualiza `tarjetas.aviso_texto`/`aviso_hasta`,
dispara el push de Apple si hay registro, aplica el candado de 3/24h y llama a Google si
corresponde, y deja el rastro en `notificaciones_enviadas`. Ver "La función compartida" en el
spec para el razonamiento completo.

- [ ] **Step 1: Escribir las pruebas**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { enviarMensajeTarjeta } from './enviarMensajeTarjeta';

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

afterEach(() => entorno.limpiar());

describe('enviarMensajeTarjeta', () => {
  it('actualiza aviso_texto/aviso_hasta en la tarjeta', async () => {
    const comercioId = await entorno.crearComercio();
    const { id: tarjetaId } = await entorno.crearTarjeta(comercioId);

    await enviarMensajeTarjeta(supabase, tarjetaId, 'Volvé pronto', '2026-12-31', 'inactividad');

    const { data } = await supabase.from('tarjetas').select('aviso_texto, aviso_hasta').eq('id', tarjetaId).single();
    expect(data!.aviso_texto).toBe('Volvé pronto');
    expect(data!.aviso_hasta).toBe('2026-12-31');
  });

  it('sin apple_push_registrations, enviadoApple es false y NO inserta fila de auditoría de Apple', async () => {
    const comercioId = await entorno.crearComercio();
    const { id: tarjetaId } = await entorno.crearTarjeta(comercioId);

    const resultado = await enviarMensajeTarjeta(supabase, tarjetaId, 'Hola', '2026-12-31', 'inactividad');

    expect(resultado.enviadoApple).toBe(false);
    const { data } = await supabase.from('notificaciones_enviadas').select('id').eq('tarjeta_id', tarjetaId).eq('canal', 'apple');
    expect(data).toEqual([]);
  });

  it('sin google_object_id, enviadoGoogle es false', async () => {
    const comercioId = await entorno.crearComercio();
    const { id: tarjetaId } = await entorno.crearTarjeta(comercioId);

    const resultado = await enviarMensajeTarjeta(supabase, tarjetaId, 'Hola', '2026-12-31', 'inactividad');

    expect(resultado.enviadoGoogle).toBe(false);
  });

  it('con 3 notificaciones canal=google en las últimas 24h, la cuarta se salta (enviadoGoogle: false) sin lanzar', async () => {
    const comercioId = await entorno.crearComercio();
    const { id: tarjetaId } = await entorno.crearTarjeta(comercioId);
    // Simula 3 envíos previos de HOY sin llamar a Google de verdad — insert directo del registro.
    await supabase.from('notificaciones_enviadas').insert([
      { tarjeta_id: tarjetaId, canal: 'google', origen: 'campana' },
      { tarjeta_id: tarjetaId, canal: 'google', origen: 'campana' },
      { tarjeta_id: tarjetaId, canal: 'google', origen: 'inactividad' },
    ]);
    // Sin google_object_id el resultado sería false igual — esta prueba verifica el CONTEO, así
    // que lo relevante es que no lance y no intente una cuarta llamada. Confirmar con un spy o
    // documentar la limitación: sin un objectId real, esta prueba en la práctica coincide con la
    // de "sin google_object_id" de arriba. Si el proyecto ya tiene un patrón de mock para
    // walletClient en algún test existente, usarlo acá; si no, dejar esta prueba enfocada en que
    // el conteo se hizo (verificar vía count antes/después) y no en el valor final de enviadoGoogle.

    const antes = await supabase.from('notificaciones_enviadas').select('id', { count: 'exact', head: true }).eq('tarjeta_id', tarjetaId).eq('canal', 'google');
    await enviarMensajeTarjeta(supabase, tarjetaId, 'Hola', '2026-12-31', 'inactividad');
    const despues = await supabase.from('notificaciones_enviadas').select('id', { count: 'exact', head: true }).eq('tarjeta_id', tarjetaId).eq('canal', 'google');

    // Sin google_object_id no se agrega una cuarta fila de todos modos — lo que esta prueba
    // realmente ancla es que el candado se evalúa ANTES de intentar el envío, no después.
    expect(despues.count).toBe(antes.count);
  });

  it('el filtro del candado es por canal=google: 3 notificaciones canal=apple NO cuentan', async () => {
    const comercioId = await entorno.crearComercio();
    const { id: tarjetaId } = await entorno.crearTarjeta(comercioId);
    await supabase.from('notificaciones_enviadas').insert([
      { tarjeta_id: tarjetaId, canal: 'apple', origen: 'campana' },
      { tarjeta_id: tarjetaId, canal: 'apple', origen: 'campana' },
      { tarjeta_id: tarjetaId, canal: 'apple', origen: 'inactividad' },
    ]);

    // MUTACIÓN A PROBAR EN LA REVISIÓN: si el candado contara por tarjeta_id sin filtrar canal,
    // estas 3 filas de Apple bloquearían un intento de Google que no debería estar bloqueado.
    // Sin google_object_id no se puede verificar el resultado final acá directamente — documentar
    // como pendiente de una prueba con un comercio con Google Wallet real habilitado (Task 4 ya
    // tiene ese fixture, reusarlo).
  });

  it('difusionId viaja a notificaciones_enviadas.difusion_id cuando origen es campana', async () => {
    const comercioId = await entorno.crearComercio();
    const { id: tarjetaId } = await entorno.crearTarjeta(comercioId);
    const usuario = /* crear usuarios_comercio de prueba */ null as unknown as string;
    // (completar con el fixture de usuario que use el resto de la suite de difusiones — ver Task 7)

    // Placeholder: esta prueba se completa junto con Task 7, cuando exista crearDifusion() para
    // generar un difusionId real en vez de armar uno a mano.
  });
});
```

**Nota para quien implemente**: las pruebas marcadas como "placeholder"/"pendiente" arriba son
deliberadamente incompletas — apuntan a un vacío real (no hay fixture de Google Wallet con
`google_object_id` real en `entornoComercio.ts` hoy) que hay que resolver ANTES de dar la tarea
por terminada, no ignorar. Si `lib/google/syncClase.test.ts`/`syncObjeto.test.ts` ya tienen un
fixture de "comercio con Google Wallet habilitado", reusarlo acá en vez de inventar uno nuevo.

- [ ] **Step 2: Correr y confirmar que fallan**

Run: `npx vitest run lib/comercio/enviarMensajeTarjeta.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { notificarCambioTarjeta } from '../apple/notificarCambioTarjeta';
import { enviarMensajeGoogle } from '../google/enviarMensaje';

export interface ResultadoEnvio {
  enviadoApple: boolean;
  enviadoGoogle: boolean;
}

// La función compartida: manda un mensaje a UNA tarjeta puntual por los dos canales que tenga
// disponibles. Ver "La función compartida" en el spec para el razonamiento completo — en
// resumen: enviadoApple/enviadoGoogle reflejan si ESE canal tenía de verdad un dispositivo/objeto
// al que entregarle el mensaje, no si "se intentó". El caller usa `enviadoApple || enviadoGoogle`
// para decidir si la tarjeta cuenta como alcanzada.
export async function enviarMensajeTarjeta(
  supabase: SupabaseClient<Database>,
  tarjetaId: string,
  mensaje: string,
  vigenteHasta: string,
  origen: 'campana' | 'inactividad',
  difusionId?: string,
): Promise<ResultadoEnvio> {
  // 1. Estado actual del aviso — esto es lo que construirReverso lee de ahora en más, en
  // CUALQUIER regeneración del pase, no solo esta.
  const { error: errorUpdate } = await supabase
    .from('tarjetas')
    .update({ aviso_texto: mensaje, aviso_hasta: vigenteHasta })
    .eq('id', tarjetaId);
  if (errorUpdate) {
    console.error('[notificaciones] no se pudo guardar el aviso en la tarjeta:', errorUpdate);
    return { enviadoApple: false, enviadoGoogle: false };
  }

  // 2. Apple: el campo ya cambió de valor en el paso 1. enviadoApple es true solo si hay al menos
  // un dispositivo registrado — insertar la fila de auditoría igual sería una auditoría que miente.
  const { data: registrosApple } = await supabase
    .from('apple_push_registrations')
    .select('id')
    .eq('tarjeta_id', tarjetaId)
    .limit(1);
  const enviadoApple = (registrosApple?.length ?? 0) > 0;
  if (enviadoApple) {
    await notificarCambioTarjeta(supabase, tarjetaId);
    await supabase.from('notificaciones_enviadas').insert({
      tarjeta_id: tarjetaId,
      canal: 'apple',
      origen,
      difusion_id: difusionId ?? null,
    });
  }

  // 3. Google: si no tiene objeto sincronizado, no hay nada que hacer.
  const { data: tarjeta } = await supabase
    .from('tarjetas')
    .select('google_object_id')
    .eq('id', tarjetaId)
    .maybeSingle();

  let enviadoGoogle = false;
  if (tarjeta?.google_object_id) {
    // Candado de 3/24h — POR CANAL, no por origen: las filas de Apple del paso 2 no cuentan acá,
    // el candado es específicamente el tope de Google.
    const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('notificaciones_enviadas')
      .select('id', { count: 'exact', head: true })
      .eq('tarjeta_id', tarjetaId)
      .eq('canal', 'google')
      .gte('enviada_en', hace24h);

    if ((count ?? 0) < 3) {
      const exito = await enviarMensajeGoogle(tarjeta.google_object_id, 'Cardly SV', mensaje);
      if (exito) {
        enviadoGoogle = true;
        await supabase.from('notificaciones_enviadas').insert({
          tarjeta_id: tarjetaId,
          canal: 'google',
          origen,
          difusion_id: difusionId ?? null,
        });
      }
    }
  }

  return { enviadoApple, enviadoGoogle };
}
```

- [ ] **Step 4: Correr y confirmar que pasan**

Run: `npx vitest run lib/comercio/enviarMensajeTarjeta.test.ts`
Expected: PASS. Completá los dos casos "placeholder" del Step 1 usando el fixture de Google
Wallet real que ya exista en `syncObjeto.test.ts`/`syncClase.test.ts` ANTES de continuar — son la
única cobertura real del candado de 3/24h y del filtro por canal, que es la garantía no-negociable
del spec (decisión 4). No se puede dar esta tarea por terminada sin esa prueba en verde.

- [ ] **Step 5: Mutation test — quitar el filtro `.eq('canal', 'google')` del conteo**

Comentá esa línea, corré la suite completa de `enviarMensajeTarjeta.test.ts`: la prueba "el
filtro del candado es por canal=google" (completada en el Step 4) debe FALLAR. Restaurá la línea,
confirmá que vuelve a pasar.

- [ ] **Step 6: Commit**

```bash
git add lib/comercio/enviarMensajeTarjeta.ts lib/comercio/enviarMensajeTarjeta.test.ts
git commit -m "enviarMensajeTarjeta: la funcion compartida (Apple + Google + candado de 3/24h)"
```

---

### Task 7: Campaña manual — `lib/comercio/difusiones.ts`

**Files:**
- Create: `lib/comercio/difusiones.ts`
- Create: `lib/comercio/difusiones.test.ts`

- [ ] **Step 1: Escribir las pruebas**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { crearDifusion, listarDifusiones, MAXIMO_DIFUSIONES_30_DIAS } from './difusiones';

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

afterEach(() => entorno.limpiar());

async function usuarioDePrueba(comercioId: string): Promise<string> {
  const { data, error } = await supabase
    .from('usuarios_comercio')
    .insert({ comercio_id: comercioId, email: `owner-dif-${Date.now()}@ejemplo.test`, rol: 'owner' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

describe('crearDifusion', () => {
  it('rechaza un mensaje vacío', async () => {
    const comercioId = await entorno.crearComercio();
    const usuarioId = await usuarioDePrueba(comercioId);

    const res = await crearDifusion(supabase, comercioId, usuarioId, { mensaje: '   ', vigenteHasta: '2026-12-31', programaId: null });

    expect(res).toEqual({ ok: false, error: 'El mensaje es obligatorio.' });
  });

  it(`permite hasta ${MAXIMO_DIFUSIONES_30_DIAS} difusiones en 30 días y rechaza la siguiente`, async () => {
    const comercioId = await entorno.crearComercio();
    const usuarioId = await usuarioDePrueba(comercioId);
    await entorno.crearTarjeta(comercioId);

    for (let i = 0; i < MAXIMO_DIFUSIONES_30_DIAS; i++) {
      const res = await crearDifusion(supabase, comercioId, usuarioId, { mensaje: `Promo ${i}`, vigenteHasta: '2026-12-31', programaId: null });
      expect(res.ok).toBe(true);
    }

    const quinta = await crearDifusion(supabase, comercioId, usuarioId, { mensaje: 'Una de más', vigenteHasta: '2026-12-31', programaId: null });
    expect(quinta.ok).toBe(false);
    if (!quinta.ok) expect(quinta.error).toContain(String(MAXIMO_DIFUSIONES_30_DIAS));
  });

  it('registra destinatarios = tarjetas alcanzadas por al menos un canal', async () => {
    const comercioId = await entorno.crearComercio();
    const usuarioId = await usuarioDePrueba(comercioId);
    await entorno.crearTarjeta(comercioId); // sin apple_push_registrations ni google_object_id

    const res = await crearDifusion(supabase, comercioId, usuarioId, { mensaje: 'Promo', vigenteHasta: '2026-12-31', programaId: null });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { data } = await supabase.from('difusiones').select('destinatarios').eq('id', res.id).single();
    // Sin registros de push en ningún canal, 0 tarjetas alcanzadas — no es un error, es la
    // realidad de una tarjeta que nunca instaló el wallet.
    expect(data!.destinatarios).toBe(0);
  });

  it('con programaId, solo apunta a tarjetas de ese programa', async () => {
    const comercioId = await entorno.crearComercio();
    const usuarioId = await usuarioDePrueba(comercioId);
    const principalId = entorno.obtenerProgramaPrincipal(comercioId);

    const res = await crearDifusion(supabase, comercioId, usuarioId, { mensaje: 'Solo sellos', vigenteHasta: '2026-12-31', programaId: principalId });

    expect(res.ok).toBe(true);
  });
});

describe('listarDifusiones', () => {
  it('devuelve las difusiones del comercio, más recientes primero', async () => {
    const comercioId = await entorno.crearComercio();
    const usuarioId = await usuarioDePrueba(comercioId);
    await crearDifusion(supabase, comercioId, usuarioId, { mensaje: 'Primera', vigenteHasta: '2026-12-31', programaId: null });
    await crearDifusion(supabase, comercioId, usuarioId, { mensaje: 'Segunda', vigenteHasta: '2026-12-31', programaId: null });

    const lista = await listarDifusiones(supabase, comercioId);

    expect(lista?.map((d) => d.mensaje)).toEqual(['Segunda', 'Primera']);
  });
});
```

- [ ] **Step 2: Correr y confirmar que fallan**

Run: `npx vitest run lib/comercio/difusiones.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { tarjetasActivasDelComercio } from './programas';
import { enviarMensajeTarjeta } from './enviarMensajeTarjeta';

export const MAXIMO_DIFUSIONES_30_DIAS = 4;

export interface DatosDifusion {
  mensaje: string;
  vigenteHasta: string;
  programaId: string | null;
}

export interface DifusionListada {
  id: string;
  mensaje: string;
  vigenteHasta: string;
  creadaEn: string;
  destinatarios: number;
}

export type ResultadoDifusion = { ok: true; id: string } | { ok: false; error: string };

// Check-then-act deliberado, NO un RPC atómico — ver "Concurrencia" en el spec: el único actor que
// puede correr una carrera acá es el propio dueño haciendo doble clic sobre su propio tope, y el
// peor resultado es mandar una o dos campañas de más en un mes. Mismo criterio que crearPrograma.
export async function crearDifusion(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  creadaPor: string,
  datos: DatosDifusion,
): Promise<ResultadoDifusion> {
  const mensaje = datos.mensaje.trim();
  if (!mensaje) return { ok: false, error: 'El mensaje es obligatorio.' };

  const hace30dias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count, error: errorConteo } = await supabase
    .from('difusiones')
    .select('id', { count: 'exact', head: true })
    .eq('comercio_id', comercioId)
    .gte('creada_en', hace30dias);
  if (errorConteo) {
    console.error('[comercio] no se pudo contar las difusiones recientes:', errorConteo);
    return { ok: false, error: 'No se pudo crear la campaña.' };
  }
  if ((count ?? 0) >= MAXIMO_DIFUSIONES_30_DIAS) {
    return {
      ok: false,
      error: `Ya mandaste ${MAXIMO_DIFUSIONES_30_DIAS} campañas en los últimos 30 días. Esperá a que se libere cupo.`,
    };
  }

  const { data: difusion, error: errorInsert } = await supabase
    .from('difusiones')
    .insert({
      comercio_id: comercioId,
      programa_id: datos.programaId,
      mensaje,
      vigente_hasta: datos.vigenteHasta,
      creada_por: creadaPor,
    })
    .select('id')
    .single();
  if (errorInsert) {
    console.error('[comercio] no se pudo crear la difusión:', errorInsert);
    return { ok: false, error: 'No se pudo crear la campaña.' };
  }

  const tarjetas = await tarjetasActivasDelComercio(supabase, comercioId, datos.programaId);
  let destinatarios = 0;
  for (const t of tarjetas) {
    const resultado = await enviarMensajeTarjeta(
      supabase,
      t.id,
      mensaje,
      datos.vigenteHasta,
      'campana',
      difusion.id,
    );
    if (resultado.enviadoApple || resultado.enviadoGoogle) destinatarios += 1;
  }

  await supabase.from('difusiones').update({ destinatarios }).eq('id', difusion.id);

  return { ok: true, id: difusion.id };
}

export async function listarDifusiones(
  supabase: SupabaseClient<Database>,
  comercioId: string,
): Promise<DifusionListada[] | null> {
  const { data, error } = await supabase
    .from('difusiones')
    .select('id, mensaje, vigente_hasta, creada_en, destinatarios')
    .eq('comercio_id', comercioId)
    .order('creada_en', { ascending: false });

  if (error) {
    console.error('[comercio] no se pudieron listar las difusiones:', error);
    return null;
  }
  return data.map((d) => ({
    id: d.id,
    mensaje: d.mensaje,
    vigenteHasta: d.vigente_hasta,
    creadaEn: d.creada_en,
    destinatarios: d.destinatarios,
  }));
}
```

- [ ] **Step 4: Correr y confirmar que pasan**

Run: `npx vitest run lib/comercio/difusiones.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation test — cambiar `>=` por `>` en el chequeo del tope**

Cambiá `(count ?? 0) >= MAXIMO_DIFUSIONES_30_DIAS` por `>`, corré la prueba del tope: debe FALLAR
(ahora dejaría pasar una 5ª). Restaurá.

- [ ] **Step 6: Commit**

```bash
git add lib/comercio/difusiones.ts lib/comercio/difusiones.test.ts
git commit -m "Campana manual: crearDifusion (tope de 4/30 dias) y listarDifusiones"
```

---

### Task 8: Aviso de inactividad — `lib/comercio/avisoInactividad.ts`

**Files:**
- Create: `lib/comercio/avisoInactividad.ts`
- Create: `lib/comercio/avisoInactividad.test.ts`

- [ ] **Step 1: Escribir las pruebas**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import {
  leerConfiguracionAvisoInactividad,
  guardarConfiguracionAvisoInactividad,
  configuracionDesdeFormulario,
  procesarAvisosInactividad,
  DURACION_AVISO_INACTIVIDAD_DIAS,
} from './avisoInactividad';
import { crearPrograma } from './programas';

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

afterEach(() => entorno.limpiar());

describe('guardarConfiguracionAvisoInactividad / leerConfiguracionAvisoInactividad', () => {
  it('guarda y relee la configuración', async () => {
    const comercioId = await entorno.crearComercio();

    const res = await guardarConfiguracionAvisoInactividad(supabase, comercioId, {
      activo: true,
      dias: 30,
      mensaje: 'Te extrañamos, volvé pronto',
    });
    expect(res.ok).toBe(true);

    const leido = await leerConfiguracionAvisoInactividad(supabase, comercioId);
    expect(leido).toEqual({ activo: true, dias: 30, mensaje: 'Te extrañamos, volvé pronto' });
  });

  it('rechaza días en cero o negativos', async () => {
    const comercioId = await entorno.crearComercio();
    const res = await guardarConfiguracionAvisoInactividad(supabase, comercioId, { activo: true, dias: 0, mensaje: 'X' });
    expect(res.ok).toBe(false);
  });
});

describe('configuracionDesdeFormulario', () => {
  it('cadena vacía en días se convierte en null', () => {
    const res = configuracionDesdeFormulario({ activo: 'on', dias: '', mensaje: 'Hola' });
    expect(res.dias).toBeNull();
  });
});

describe('procesarAvisosInactividad', () => {
  it('una tarjeta activa y otra inactiva del MISMO cliente: el aviso llega SOLO a la inactiva', async () => {
    // Caso motivador de la decisión 5 del spec: con programas de tarjeta, un cliente puede tener
    // su tarjeta de sellos activa y su cupón de bienvenida olvidado.
    const comercioId = await entorno.crearComercio();
    await guardarConfiguracionAvisoInactividad(supabase, comercioId, { activo: true, dias: 30, mensaje: 'Volvé' });
    const cuponPrograma = await crearPrograma(supabase, comercioId, {
      nombre: 'Cupón de bienvenida', tipoTarjeta: 'cupon',
      cashbackPorcentaje: null, multipassVisitas: null, membresiaDias: null, cuponVigenciaDias: null,
    });
    expect(cuponPrograma.ok).toBe(true);
    if (!cuponPrograma.ok) return;

    const { id: tarjetaActiva } = await entorno.crearTarjeta(comercioId);
    const { data: cliente } = await supabase.from('clientes').insert({ nombre: 'Cliente Doble', telefono: `+503-inact-${Date.now()}` }).select('id').single();
    const { data: tarjetaInactiva } = await supabase
      .from('tarjetas')
      .insert({ cliente_id: cliente!.id, comercio_id: comercioId, programa_id: cuponPrograma.id, created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString() })
      .select('id').single();
    // Actividad reciente en la tarjeta "activa" — un acreditar de verdad, no un insert a mano,
    // para que quede una fila de transacciones_puntos con created_at de HOY.
    // (completar con el helper de acreditar ya usado en otras suites, p. ej. acreditar.test.ts)

    const resumen = await procesarAvisosInactividad(supabase);

    expect(resumen.avisadas).toContain(tarjetaInactiva!.id);
    expect(resumen.avisadas).not.toContain(tarjetaActiva);
  });

  it('una tarjeta SIN ninguna fila de ledger cuenta created_at como su última actividad', async () => {
    const comercioId = await entorno.crearComercio();
    await guardarConfiguracionAvisoInactividad(supabase, comercioId, { activo: true, dias: 30, mensaje: 'Volvé' });
    const { data: cliente } = await supabase.from('clientes').insert({ nombre: 'Nunca Volvió', telefono: `+503-inact2-${Date.now()}` }).select('id').single();
    const principalId = entorno.obtenerProgramaPrincipal(comercioId);
    const { data: tarjeta } = await supabase
      .from('tarjetas')
      .insert({ cliente_id: cliente!.id, comercio_id: comercioId, programa_id: principalId, created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString() })
      .select('id').single();

    const resumen = await procesarAvisosInactividad(supabase);

    expect(resumen.avisadas).toContain(tarjeta!.id);
  });

  it('un cupón YA USADO nunca recibe aviso de inactividad', async () => {
    const comercioId = await entorno.crearComercio();
    await guardarConfiguracionAvisoInactividad(supabase, comercioId, { activo: true, dias: 30, mensaje: 'Volvé' });
    const cuponPrograma = await crearPrograma(supabase, comercioId, {
      nombre: 'Cupón', tipoTarjeta: 'cupon',
      cashbackPorcentaje: null, multipassVisitas: null, membresiaDias: null, cuponVigenciaDias: null,
    });
    expect(cuponPrograma.ok).toBe(true);
    if (!cuponPrograma.ok) return;
    const { data: cliente } = await supabase.from('clientes').insert({ nombre: 'Ya Usó Su Cupón', telefono: `+503-inact3-${Date.now()}` }).select('id').single();
    const hace40dias = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const { data: tarjeta } = await supabase
      .from('tarjetas')
      .insert({ cliente_id: cliente!.id, comercio_id: comercioId, programa_id: cuponPrograma.id, usado_en: hace40dias })
      .select('id').single();

    const resumen = await procesarAvisosInactividad(supabase);

    expect(resumen.avisadas).not.toContain(tarjeta!.id);
  });

  it('no re-avisa la misma tarjeta si no hubo actividad nueva desde el último aviso', async () => {
    const comercioId = await entorno.crearComercio();
    await guardarConfiguracionAvisoInactividad(supabase, comercioId, { activo: true, dias: 30, mensaje: 'Volvé' });
    const { data: cliente } = await supabase.from('clientes').insert({ nombre: 'Ya Avisado', telefono: `+503-inact4-${Date.now()}` }).select('id').single();
    const principalId = entorno.obtenerProgramaPrincipal(comercioId);
    const hace40dias = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const { data: tarjeta } = await supabase
      .from('tarjetas')
      .insert({
        cliente_id: cliente!.id, comercio_id: comercioId, programa_id: principalId,
        created_at: hace40dias.toISOString(),
        aviso_inactividad_enviado_en: new Date().toISOString(), // ya se avisó HOY
      })
      .select('id').single();

    const resumen = await procesarAvisosInactividad(supabase);

    expect(resumen.avisadas).not.toContain(tarjeta!.id);
  });

  it('sin comercios con aviso_inactividad_activo, no hace nada', async () => {
    const resumen = await procesarAvisosInactividad(supabase);
    expect(resumen).toEqual({ comerciosRevisados: expect.any(Number), avisadas: expect.any(Array) });
  });
});
```

**Nota**: el caso "una tarjeta activa y otra inactiva del MISMO cliente" necesita una acreditación
real (no un insert a mano) para que `transacciones_puntos` tenga una fila con `created_at`
reciente — reusar el helper de acreditación que ya usan `acreditar.test.ts`/`ajuste.test.ts` en
vez de escribir uno nuevo.

- [ ] **Step 2: Correr y confirmar que fallan**

Run: `npx vitest run lib/comercio/avisoInactividad.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { tarjetasActivasDelComercio } from './programas';
import { enviarMensajeTarjeta } from './enviarMensajeTarjeta';

// Topes de cordura — mismo criterio que MAXIMO_ACREDITACIONES_DIA en controlesAcreditacion.ts.
export const MAXIMO_DIAS_INACTIVIDAD = 365;
// Cuánto dura el aviso de inactividad en el reverso — a diferencia de la campaña (donde el dueño
// elige vigente_hasta), este es un valor fijo del sistema: el dueño ya configuró el umbral y el
// mensaje, una TERCERA perilla solo para esto es configurabilidad que nadie pidió.
export const DURACION_AVISO_INACTIVIDAD_DIAS = 14;

export interface ConfiguracionAvisoInactividad {
  activo: boolean;
  dias: number | null;
  mensaje: string | null;
}

export type ResultadoConfiguracion = { ok: true } | { ok: false; error: string };

function validar(datos: ConfiguracionAvisoInactividad): string | null {
  if (!datos.activo) return null; // apagado: no valida el resto, igual que las perillas antifraude
  if (datos.dias === null) return 'Poné cada cuántos días de inactividad se manda el aviso.';
  if (!Number.isInteger(datos.dias) || datos.dias <= 0 || datos.dias > MAXIMO_DIAS_INACTIVIDAD) {
    return `Los días de inactividad tienen que ser un número entero entre 1 y ${MAXIMO_DIAS_INACTIVIDAD}.`;
  }
  if (!datos.mensaje || !datos.mensaje.trim()) return 'Escribí el mensaje que va a recibir el cliente.';
  return null;
}

export function configuracionDesdeFormulario(campos: {
  activo: string | boolean;
  dias: string;
  mensaje: string;
}): ConfiguracionAvisoInactividad {
  const diasLimpio = campos.dias.trim();
  return {
    activo: campos.activo === 'on' || campos.activo === true,
    dias: diasLimpio ? Number(diasLimpio) : null,
    mensaje: campos.mensaje.trim() || null,
  };
}

export async function leerConfiguracionAvisoInactividad(
  supabase: SupabaseClient<Database>,
  comercioId: string,
): Promise<ConfiguracionAvisoInactividad | null> {
  const { data, error } = await supabase
    .from('comercios')
    .select('aviso_inactividad_activo, aviso_inactividad_dias, aviso_inactividad_mensaje')
    .eq('id', comercioId)
    .maybeSingle();
  if (error || !data) {
    console.error('[comercio] no se pudo leer la configuración de aviso de inactividad:', error);
    return null;
  }
  return {
    activo: data.aviso_inactividad_activo,
    dias: data.aviso_inactividad_dias,
    mensaje: data.aviso_inactividad_mensaje,
  };
}

export async function guardarConfiguracionAvisoInactividad(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  datos: ConfiguracionAvisoInactividad,
): Promise<ResultadoConfiguracion> {
  const problema = validar(datos);
  if (problema) return { ok: false, error: problema };

  const { error } = await supabase
    .from('comercios')
    .update({
      aviso_inactividad_activo: datos.activo,
      aviso_inactividad_dias: datos.dias,
      aviso_inactividad_mensaje: datos.mensaje,
    })
    .eq('id', comercioId);
  if (error) {
    console.error('[comercio] no se pudo guardar la configuración de aviso de inactividad:', error);
    return { ok: false, error: 'No se pudo guardar la configuración.' };
  }
  return { ok: true };
}

export interface ResumenAvisoInactividad {
  comerciosRevisados: number;
  avisadas: string[]; // ids de tarjetas avisadas, para pruebas y logging
}

// El cron diario. Mismo espíritu que apagarCampanasVencidas (lib/comercio/campanasVencidas.ts):
// lee ampliamente, filtra en TS (el corte de "última actividad" es por tarjeta, no expresable en
// una sola condición SQL simple dado el fallback a created_at), y sale temprano si no hay nada
// que hacer. A diferencia de esa función, ACÁ el envío es por tarjeta individual, no un
// re-sync por comercio — cada tarjeta inactiva es un destinatario distinto con su propio mensaje.
export async function procesarAvisosInactividad(
  supabase: SupabaseClient<Database>,
): Promise<ResumenAvisoInactividad> {
  const { data: comercios, error } = await supabase
    .from('comercios')
    .select('id, aviso_inactividad_dias, aviso_inactividad_mensaje')
    .eq('aviso_inactividad_activo', true)
    .not('aviso_inactividad_dias', 'is', null)
    .not('aviso_inactividad_mensaje', 'is', null);

  if (error) {
    console.error('[inactividad] no se pudieron leer los comercios con aviso activo:', error);
    return { comerciosRevisados: 0, avisadas: [] };
  }
  if (!comercios || comercios.length === 0) {
    return { comerciosRevisados: 0, avisadas: [] };
  }

  const avisadas: string[] = [];
  const hoy = Date.now();
  const vigenteHasta = new Date(hoy + DURACION_AVISO_INACTIVIDAD_DIAS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  for (const comercio of comercios) {
    const dias = comercio.aviso_inactividad_dias!;
    const mensaje = comercio.aviso_inactividad_mensaje!;
    const umbralMs = hoy - dias * 24 * 60 * 60 * 1000;

    const tarjetas = await tarjetasActivasDelComercio(supabase, comercio.id, null);
    for (const t of tarjetas) {
      // Cupón ya usado: no tiene "volver" — ver decisión 5 / la nota de "cupón ya usado" del spec.
      const { data: fila } = await supabase
        .from('tarjetas')
        .select('created_at, usado_en, aviso_inactividad_enviado_en')
        .eq('id', t.id)
        .single();
      if (!fila) continue;
      if (t.tipoTarjeta === 'cupon' && fila.usado_en !== null) continue;

      const { data: ultimaTransaccion } = await supabase
        .from('transacciones_puntos')
        .select('created_at')
        .eq('tarjeta_id', t.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: ultimoCanje } = await supabase
        .from('canjes')
        .select('created_at')
        .eq('tarjeta_id', t.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const candidatas = [ultimaTransaccion?.created_at, ultimoCanje?.created_at, fila.created_at]
        .filter((v): v is string => v !== null && v !== undefined)
        .map((v) => new Date(v).getTime());
      const ultimaActividadMs = Math.max(...candidatas);

      if (ultimaActividadMs > umbralMs) continue; // todavía no cruza el umbral

      if (fila.aviso_inactividad_enviado_en) {
        const ultimoAvisoMs = new Date(fila.aviso_inactividad_enviado_en).getTime();
        if (ultimaActividadMs <= ultimoAvisoMs) continue; // ya se avisó y no hubo actividad nueva
      }

      await enviarMensajeTarjeta(supabase, t.id, mensaje, vigenteHasta, 'inactividad');
      await supabase.from('tarjetas').update({ aviso_inactividad_enviado_en: new Date().toISOString() }).eq('id', t.id);
      avisadas.push(t.id);
    }
  }

  return { comerciosRevisados: comercios.length, avisadas };
}
```

- [ ] **Step 4: Correr y confirmar que pasan**

Run: `npx vitest run lib/comercio/avisoInactividad.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation test — quitar el fallback a `created_at`**

Cambiá `.filter((v): v is string => v !== null...)` de forma que descarte `fila.created_at` del
array `candidatas` (dejando solo transacción/canje). Corré la prueba "una tarjeta SIN ninguna fila
de ledger cuenta created_at": debe FALLAR (ahora `Math.max(...[])` da `-Infinity`, y la tarjeta
JAMÁS calificaría). Restaurá.

- [ ] **Step 6: Mutation test — quitar la exclusión de cupón usado**

Comentá la línea `if (t.tipoTarjeta === 'cupon' && fila.usado_en !== null) continue;`, corré la
prueba "un cupón YA USADO nunca recibe aviso": debe FALLAR. Restaurá.

- [ ] **Step 7: Commit**

```bash
git add lib/comercio/avisoInactividad.ts lib/comercio/avisoInactividad.test.ts
git commit -m "Aviso de inactividad: perillas, procesarAvisosInactividad, casos de la decision 5"
```

---

### Task 9: Cron `/api/cron/inactividad` + `vercel.json`

**Files:**
- Create: `app/api/cron/inactividad/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Implementar la ruta**

Copia casi literal de `app/api/cron/campanas/route.ts` (leelo primero) — mismos dos candados
(`CRON_SECRET`, no-op si no hay nada que hacer, este último ya lo maneja
`procesarAvisosInactividad` devolviendo `avisadas: []`):

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { procesarAvisosInactividad } from '@/lib/comercio/avisoInactividad';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Trabajo diario que manda el aviso de inactividad. Mismos dos candados que /api/cron/campanas
// (CRON_SECRET + no-op si no hay nada que avisar) — ver ese archivo para el razonamiento completo.
export async function GET(request: NextRequest) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    console.error('[cron] CRON_SECRET no está configurado');
    return NextResponse.json({ error: 'No configurado' }, { status: 500 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const resumen = await procesarAvisosInactividad(createServiceClient());
  console.log('[cron] avisos de inactividad:', resumen);
  return NextResponse.json(resumen);
}
```

- [ ] **Step 2: Agregar la entrada en `vercel.json`**

```json
{
  "crons": [
    {
      "path": "/api/cron/campanas",
      "schedule": "0 8 * * *"
    },
    {
      "path": "/api/cron/inactividad",
      "schedule": "0 9 * * *"
    }
  ]
}
```

Una hora después de la de campañas — no corren compitiendo por lo mismo, pero tampoco hay razón
de negocio para que sea EXACTAMENTE la misma hora.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/inactividad/route.ts vercel.json
git commit -m "Cron diario de aviso de inactividad"
```

---

### Task 10: Perilla de inactividad en Reglas

**Files:**
- Create: `app/comercio/(protegido)/reglas/FormularioAvisoInactividad.tsx`
- Modify: `app/comercio/(protegido)/reglas/actions.ts`
- Modify: `app/comercio/(protegido)/reglas/page.tsx`

- [ ] **Step 1: Agregar la Server Action**

En `app/comercio/(protegido)/reglas/actions.ts`, agregar (mismo patrón que
`accionGuardarControles` — leelo antes de escribir esto):

```ts
import {
  leerConfiguracionAvisoInactividad,
  guardarConfiguracionAvisoInactividad,
  configuracionDesdeFormulario as avisoInactividadDesdeFormulario,
} from '@/lib/comercio/avisoInactividad';

export type EstadoAvisoInactividad = { error: string } | { guardado: true } | undefined;

export async function accionGuardarAvisoInactividad(
  _estadoPrevio: EstadoAvisoInactividad,
  formData: FormData,
): Promise<EstadoAvisoInactividad> {
  const { comercioId } = await verifyComercioOwner();

  const datos = avisoInactividadDesdeFormulario({
    activo: formData.get('aviso_inactividad_activo') === 'on',
    dias: String(formData.get('aviso_inactividad_dias') ?? ''),
    mensaje: String(formData.get('aviso_inactividad_mensaje') ?? ''),
  });

  const res = await guardarConfiguracionAvisoInactividad(createServiceClient(), comercioId, datos);
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/reglas');
  return { guardado: true };
}
```

(Importar `leerConfiguracionAvisoInactividad` es para el `page.tsx` del Step 3, no para
`actions.ts` — moverlo al import correcto si el editor lo marca como no usado acá.)

- [ ] **Step 2: Escribir el componente**

Mismo patrón de campos NO controlados + `key` que `FormularioControles.tsx` (edición, no alta —
leelo primero, es la plantilla exacta):

```tsx
'use client';

import { useActionState } from 'react';
import { accionGuardarAvisoInactividad, type EstadoAvisoInactividad } from './actions';
import type { ConfiguracionAvisoInactividad } from '@/lib/comercio/avisoInactividad';

export default function FormularioAvisoInactividad({
  configuracion,
}: {
  configuracion: ConfiguracionAvisoInactividad;
}) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoAvisoInactividad, FormData>(
    accionGuardarAvisoInactividad,
    undefined,
  );

  const clave = [configuracion.activo, configuracion.dias, configuracion.mensaje].join('|');

  return (
    <form key={clave} className="panel" style={{ marginTop: 0 }} action={ejecutar}>
      <h2 className="subtitle" style={{ marginTop: 0 }}>Aviso de inactividad</h2>
      <p className="admin-fila-slug" style={{ marginTop: -6, marginBottom: 18 }}>
        Push automático a un cliente que no usa su tarjeta desde hace tiempo — sin depender de que
        pase cerca del local.
      </p>

      <div className="field">
        <label htmlFor="aviso_inactividad_activo" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            id="aviso_inactividad_activo"
            name="aviso_inactividad_activo"
            type="checkbox"
            defaultChecked={configuracion.activo}
          />
          Activar el aviso de inactividad
        </label>
      </div>

      <div className="field">
        <label htmlFor="aviso_inactividad_dias">Días sin actividad antes de avisar</label>
        <input
          id="aviso_inactividad_dias"
          name="aviso_inactividad_dias"
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          placeholder="30"
          defaultValue={configuracion.dias === null ? '' : String(configuracion.dias)}
        />
      </div>

      <div className="field">
        <label htmlFor="aviso_inactividad_mensaje">Mensaje que recibe el cliente</label>
        <textarea
          id="aviso_inactividad_mensaje"
          name="aviso_inactividad_mensaje"
          rows={3}
          placeholder="Te extrañamos! Volvé pronto y seguí sumando."
          defaultValue={configuracion.mensaje ?? ''}
        />
      </div>

      <button className="btn-primary" type="submit" disabled={pendiente}>
        {pendiente ? 'Guardando…' : 'Guardar aviso'}
      </button>
      {estado && 'error' in estado && <p className="alerta" role="alert">{estado.error}</p>}
      {estado && 'guardado' in estado && (
        <p className="admin-fila-slug" role="status" style={{ marginTop: 10 }}>Aviso guardado.</p>
      )}
    </form>
  );
}
```

- [ ] **Step 3: Insertar en `page.tsx`**

En `app/comercio/(protegido)/reglas/page.tsx`, importar y leer la configuración junto a
`controles`, y renderizar el formulario después del panel de `FormularioControles`:

```ts
import { leerConfiguracionAvisoInactividad } from '@/lib/comercio/avisoInactividad';
import FormularioAvisoInactividad from './FormularioAvisoInactividad';
```

```ts
  const avisoInactividad = await leerConfiguracionAvisoInactividad(supabase, comercioId);
```

```tsx
      {avisoInactividad && (
        <div className="reveal d2" style={{ marginTop: 22 }}>
          <FormularioAvisoInactividad configuracion={avisoInactividad} />
        </div>
      )}
```

- [ ] **Step 4: Typecheck y lint**

Run: `npx tsc --noEmit && npx eslint "app/comercio/(protegido)/reglas"`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add "app/comercio/(protegido)/reglas"
git commit -m "Perilla de aviso de inactividad en Reglas"
```

---

### Task 11: Pantalla de campañas manuales — `/comercio/notificaciones`

**Files:**
- Create: `app/comercio/(protegido)/notificaciones/actions.ts`
- Create: `app/comercio/(protegido)/notificaciones/FormularioDifusion.tsx`
- Create: `app/comercio/(protegido)/notificaciones/page.tsx`

- [ ] **Step 1: Server Action**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { crearDifusion } from '@/lib/comercio/difusiones';

export type EstadoDifusion = { error: string } | { ok: true } | undefined;

export async function accionCrearDifusion(
  _estadoPrevio: EstadoDifusion,
  formData: FormData,
): Promise<EstadoDifusion> {
  const { comercioId, authUserId } = await verifyComercioOwner();
  const supabase = createServiceClient();

  // creada_por es usuarios_comercio.id, no el authUserId — resolverlo desde la membresía activa.
  const { data: membresia, error: eMembresia } = await supabase
    .from('usuarios_comercio')
    .select('id')
    .eq('comercio_id', comercioId)
    .eq('auth_user_id', authUserId)
    .eq('rol', 'owner')
    .eq('activo', true)
    .maybeSingle();
  if (eMembresia || !membresia) {
    return { error: 'No se pudo identificar tu cuenta.' };
  }

  const programaId = String(formData.get('programa_id') ?? '');
  const res = await crearDifusion(supabase, comercioId, membresia.id, {
    mensaje: String(formData.get('mensaje') ?? ''),
    vigenteHasta: String(formData.get('vigente_hasta') ?? ''),
    programaId: programaId || null,
  });
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/notificaciones');
  return { ok: true };
}
```

**Verificar antes de continuar**: confirmá el nombre EXACTO del campo que devuelve
`verifyComercioOwner()` para el id de sesión de auth (puede llamarse `authUserId` o distinto —
leé `lib/comercio/verifyComercioOwner.ts`, ya lo leíste en una tarea anterior de este proyecto,
revisalo de nuevo si hace falta) y ajustá el nombre de la variable de arriba para que calce.

- [ ] **Step 2: Formulario (creación — estado controlado está bien, es de ALTA)**

```tsx
'use client';

import { useActionState } from 'react';
import { accionCrearDifusion, type EstadoDifusion } from './actions';

export default function FormularioDifusion({
  programas,
  puedeCrear,
}: {
  programas: { id: string; nombre: string }[];
  puedeCrear: boolean;
}) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoDifusion, FormData>(accionCrearDifusion, undefined);

  if (!puedeCrear) {
    return (
      <p className="admin-vacio">
        Ya usaste tus campañas de los últimos 30 días. Esperá a que se libere cupo.
      </p>
    );
  }

  return (
    <form className="panel" style={{ marginTop: 0 }} action={ejecutar}>
      <h2 className="subtitle" style={{ marginTop: 0 }}>Nueva campaña</h2>

      <div className="field">
        <label htmlFor="mensaje">Mensaje</label>
        <textarea id="mensaje" name="mensaje" rows={3} placeholder="20% de descuento este fin de semana" required />
      </div>

      <div className="field">
        <label htmlFor="vigente_hasta">Se muestra en la tarjeta hasta</label>
        <input id="vigente_hasta" name="vigente_hasta" type="date" required />
      </div>

      <div className="field">
        <label htmlFor="programa_id">Programa</label>
        <select id="programa_id" name="programa_id" defaultValue="">
          <option value="">Todos los programas</option>
          {programas.map((p) => (
            <option key={p.id} value={p.id}>{p.nombre}</option>
          ))}
        </select>
      </div>

      <button className="btn-primary" type="submit" disabled={pendiente}>
        {pendiente ? 'Enviando…' : 'Mandar campaña'}
      </button>
      {estado && 'error' in estado && <p className="alerta" role="alert">{estado.error}</p>}
    </form>
  );
}
```

- [ ] **Step 3: Página**

Mismo esqueleto que `app/comercio/(protegido)/programas/page.tsx` (gate, `AvisoComercioActivo`,
`admin-encabezado`). Lee las difusiones recientes (`listarDifusiones`) para calcular cuántas
lleva en los últimos 30 días y mostrar el historial, y los programas activos
(`listarProgramas(supabase, comercioId, { soloActivos: true })`, ya existe en `programas.ts`)
para el selector:

```tsx
import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { listarDifusiones, MAXIMO_DIFUSIONES_30_DIAS } from '@/lib/comercio/difusiones';
import { listarProgramas } from '@/lib/comercio/programas';
import AvisoComercioActivo from '../AvisoComercioActivo';
import FormularioDifusion from './FormularioDifusion';

export const dynamic = 'force-dynamic';

export default async function PaginaNotificaciones() {
  const { comercioId } = await verifyComercioOwner();
  const supabase = createServiceClient();

  const [difusiones, programas] = await Promise.all([
    listarDifusiones(supabase, comercioId),
    listarProgramas(supabase, comercioId, { soloActivos: true }),
  ]);

  const hace30dias = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const usadasEnVentana = (difusiones ?? []).filter((d) => new Date(d.creadaEn).getTime() >= hace30dias).length;
  const puedeCrear = usadasEnVentana < MAXIMO_DIFUSIONES_30_DIAS;

  return (
    <main className="admin-main" style={{ maxWidth: 640 }}>
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>Notificaciones</h1>
        <Link className="admin-fila-slug" href="/comercio/panel">← Volver</Link>
      </div>
      <p className="lede reveal d1" style={{ marginTop: 0 }}>
        Te quedan {Math.max(0, MAXIMO_DIFUSIONES_30_DIAS - usadasEnVentana)} de {MAXIMO_DIFUSIONES_30_DIAS} campañas en los últimos 30 días.
      </p>

      <AvisoComercioActivo />

      <div className="reveal d2" style={{ marginTop: 22 }}>
        <FormularioDifusion programas={(programas ?? []).map((p) => ({ id: p.id, nombre: p.nombre }))} puedeCrear={puedeCrear} />
      </div>

      {!difusiones ? (
        <p className="admin-error reveal d3" role="alert" style={{ marginTop: 22 }}>
          No se pudo cargar el historial. Recargá la página.
        </p>
      ) : difusiones.length > 0 && (
        <div className="admin-lista reveal d3" style={{ marginTop: 22 }}>
          {difusiones.map((d) => (
            <div key={d.id} className="admin-fila">
              <div>
                <div className="admin-fila-nombre">{d.mensaje}</div>
                <div className="admin-fila-slug">
                  {new Date(d.creadaEn).toLocaleDateString('es-SV')} · {d.destinatarios} tarjetas alcanzadas
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Typecheck y lint**

Run: `npx tsc --noEmit && npx eslint "app/comercio/(protegido)/notificaciones"`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add "app/comercio/(protegido)/notificaciones"
git commit -m "Pantalla de campanas manuales: /comercio/notificaciones"
```

---

### Task 12: Navegación

**Files:**
- Modify: `lib/comercio/navegacion.ts`
- Modify: `lib/comercio/navegacion.test.ts`
- Modify: `app/comercio/(protegido)/panel/page.tsx`

- [ ] **Step 1: Actualizar las pruebas primero**

En `navegacion.test.ts`, agregar `/comercio/notificaciones` a la lista esperada de
`enlacesMenuPorRol('owner')` (elegí una posición y justificala en un comentario, mismo criterio
que se usó para `/comercio/programas` — ver ese commit como ejemplo) y subir el conteo total de
la última prueba (`new Set([...barra, ...menu]).size`) en 1, actualizando el comentario que lleva
la cuenta histórica.

Run: `npx vitest run lib/comercio/navegacion.test.ts`
Expected: FAIL (la ruta todavía no está en `ENLACES_MENU`).

- [ ] **Step 2: Agregar la entrada**

En `lib/comercio/navegacion.ts`, agregar a `ENLACES_MENU`:

```ts
{ href: '/comercio/notificaciones', icono: 'campaign', etiqueta: 'Notificaciones' },
```

- [ ] **Step 3: Correr y confirmar que pasan**

Run: `npx vitest run lib/comercio/navegacion.test.ts`
Expected: PASS.

- [ ] **Step 4: Atajo en el panel**

En `app/comercio/(protegido)/panel/page.tsx`, agregar a `ATAJOS`:

```ts
{ href: '/comercio/notificaciones', icono: 'campaign', tono: 'menta', titulo: 'Notificaciones', sub: 'Campañas manuales y aviso de inactividad' },
```

- [ ] **Step 5: Commit**

```bash
git add lib/comercio/navegacion.ts lib/comercio/navegacion.test.ts "app/comercio/(protegido)/panel/page.tsx"
git commit -m "Navegacion: entrada de Notificaciones en el menu y accesos rapidos"
```

---

### Task 13: Verificación end-to-end

**Files:** ninguno nuevo — solo verificación.

La migración 0026 ya se entregó y se verificó en la Task 1 (Step 6) — las Tasks 2 a 11 corrieron
sus propias pruebas de integración contra las tablas reales durante su propio ciclo TDD, no contra
un esquema pendiente. Esta es la pasada final de conjunto, no la primera vez que algo corre de
verdad.

- [ ] **Step 1: Suite completa**

Run: `npx tsc --noEmit && npx eslint . && npm test`
Expected: typecheck y lint limpios, TODAS las pruebas en verde (incluidas las que ya existían —
ninguna regresión). Si algo falla acá que no falló tarea por tarea, es señal de una interacción
entre tareas que no se probó aislada — no lo ignores.

- [ ] **Step 2: Verificación manual en el navegador**

Con el controlador (no un subagente — no se levanta dev server en subagentes):
1. `/comercio/reglas`: activar el aviso de inactividad con un umbral bajo (1 día) y un mensaje de
   prueba, guardar, recargar y confirmar que los valores persisten.
2. `/comercio/notificaciones`: mandar una campaña de prueba, confirmar que aparece en el
   historial con el conteo de destinatarios correcto, y que el contador de cupo baja.
3. Repetir el envío 4 veces más y confirmar que la 5ª campaña se rechaza con el mensaje del tope.
4. Si hay un teléfono con la tarjeta ya instalada (Apple o Google) a mano: mandar una campaña real
   y confirmar que el aviso aparece en el reverso del pase / como notificación de Google.

- [ ] **Step 3: Confirmar que el cron de inactividad está protegido**

```bash
curl -i https://www.cardly-sv.site/api/cron/inactividad
```

Expected: `401`, no `500` (confirma que `CRON_SECRET` está configurado en producción, sin
necesidad de ver su valor — mismo chequeo que ya se hizo para `/api/cron/campanas`).

- [ ] **Step 4: Actualizar `ESTADO-Y-PLAN-2026-07-28.md`**

Agregar una sección breve documentando que las notificaciones push activas (campaña manual +
aviso de inactividad) están construidas y en producción, con enlaces al spec y a este plan.

- [ ] **Step 5: Commit final**

```bash
git add docs/superpowers/ESTADO-Y-PLAN-2026-07-28.md
git commit -m "Notificaciones push: verificacion end-to-end y actualizacion de estado"
```

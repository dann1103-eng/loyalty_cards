// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0040.ts
//
// Verificación de la migración 0040 (reportes con filtros), DESPUÉS de que Daniel la aplique en
// Studio. SOLO LECTURA: selects y llamadas a funciones `stable`; no escribe nada.
//
// Qué mira:
//   1. Las cuatro funciones nuevas existen y responden por PostgREST con sus argumentos CON NOMBRE
//      (PostgREST resuelve la función por esos nombres: uno mal escrito en la SQL da PGRST202), y
//      devuelven exactamente las columnas que declara lib/supabase/types.ts.
//   2. La llave ANÓNIMA no puede ejecutarlas (patrón de verificar-0035): viaja en el bundle del
//      navegador, y sin los `revoke` cualquiera leería por REST los reportes de cualquier comercio.
//   3. Para cada comercio demo (slug '%-demo'), las nuevas contra las VIEJAS de la 0033, sin fechas
//      ni filtros (salvo "Por día", que va con los últimos 14 días):
//      - reporte_resumen contra reporte_sucursales, fila por fila (sucursal, incluida "sin
//        sucursal"): visitas, acumulado y premios IGUALES; clientes nuevo >= viejo, porque la
//        definición nueva suma a quien solo canjeó. La fila total (`es_total`) NO se compara:
//        contra la suma de las viejas daría falsos rojos (quien fue a dos sucursales cuenta 1 en el
//        total y 1 en cada sucursal).
//      - reporte_cajeros_alcance contra reporte_cajeros: todo igual salvo Clientes. Ahí no vale
//        ni siquiera el >=: la vieja contaba cualquier fila del ledger (ajustes incluidos) y no
//        contaba a quien solo canjeó; la nueva, al revés.
//      - reporte_clientes contra reporte_top_clientes: visitas y acumulado por cliente. La vieja
//        solo lista a quien tuvo visitas, así que un cliente que está SOLO en la nueva tiene que
//        traer 0 visitas y 0 acumulado (solo canjeó).
//      - reporte_por_dia('dia') contra reporte_tendencia(14), DÍA POR DÍA. Un día que la nueva no
//        trae cuenta como 0: su tramo arranca en la primera actividad del alcance (`primera`), así
//        que un demo nuevo o sin actividad devuelve menos filas que la vieja, que trae siempre 14.
//        La ventana (hoy−13 a hoy, en la zona del comercio) sale del resultado de la VIEJA, que
//        calcula "hoy" con el now() de la base en la zona del comercio: el reloj de esta PC no entra
//        (ya estuvo mal alguna vez), y la nueva recibe las dos fechas explícitas.
//
// EL TOPE DE 1000 FILAS de PostgREST (max-rows) corta sin avisar. Las dos lecturas que pueden pasarlo
// van paginadas: reporte_top_clientes con `.order()` + `.range()` hasta una página vacía, y
// reporte_clientes SOLO con su `p_offset` (un `.range()` iría por fuera de la página que la función
// ya devuelve), cortando con `offset_efectivo`/`total`. Las demás son una fila por sucursal, por
// cajero o por día: si alguna llegara a 1000, el script lo marca como falla en vez de comparar una
// lista que pudo venir cortada.
//
// Si la 0040 NO está aplicada, las funciones no existen: el paso 1 lo dice (PGRST202) y el script
// termina ahí con código 1, sin comparar nada.
//
// OJO, ruido que no es la migración: si alguien opera un demo MIENTRAS corre el script, la vieja y
// la nueva pueden leer momentos distintos. Si una diferencia no se repite al volver a correrlo, era
// eso.
//
// EN ROJO: la 0040 NO se edita (ya está aplicada). El arreglo va en una 0041.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { requireEnv } from '../lib/env';
import { createServiceClient } from '../lib/supabase/server';
import type { Database } from '../lib/supabase/types';

type Funciones = Database['public']['Functions'];
type Fila<F extends keyof Funciones> = Funciones[F]['Returns'] extends readonly (infer R)[] ? R : never;
type Cliente = ReturnType<typeof createServiceClient>;

const NUEVAS = ['reporte_resumen', 'reporte_por_dia', 'reporte_clientes', 'reporte_cajeros_alcance'] as const;
type Nueva = (typeof NUEVAS)[number];

// max-rows de PostgREST en Supabase.
const TOPE_POSTGREST = 1000;
const TAMANO_PAGINA = 1000;
// `limit` interno de reporte_top_clientes: el máximo de un `integer`, para que la función vieja no
// corte nada por su cuenta (lo que corta PostgREST lo resuelve la paginación).
const SIN_LIMITE = 2_147_483_647;
const DIAS_TENDENCIA = 14;
// Cuántas diferencias se imprimen por comparación; el resto se cuenta.
const MAX_DETALLE = 10;

// Las columnas que declara types.ts, una por una: `Record<keyof …, true>` hace que el compilador
// exija TODAS y rechace una de más, así que esta lista no se puede desfasar de los tipos sin que
// `tsc` lo diga. El paso 1 compara la respuesta real contra ella.
const COLUMNAS: { [F in Nueva]: Record<keyof Fila<F>, true> } = {
  reporte_resumen: {
    comercio_id: true, sucursal_id: true, sucursal_nombre: true, sucursal_activa: true,
    operaciones: true, puntos_otorgados: true, canjes: true, clientes_unicos: true, es_total: true,
  },
  reporte_por_dia: { periodo: true, operaciones: true, canjes: true, es_mes: true },
  reporte_clientes: {
    comercio_id: true, cliente_id: true, nombre: true, apellido: true, telefono: true,
    operaciones: true, puntos_otorgados: true, canjes: true, ultima_actividad: true,
    total: true, offset_efectivo: true,
  },
  reporte_cajeros_alcance: {
    comercio_id: true, cajero_usuario_id: true, cajero_email: true, cajero_activo: true,
    operaciones: true, puntos_otorgados: true, monto_total: true, forzadas: true, ajustes: true,
    puntos_ajustados: true, canjes: true, clientes_unicos: true,
  },
};

// Las columnas de reporte_cajeros que tienen que dar IGUAL en reporte_cajeros_alcance: todas menos
// la clave y Clientes (ver el encabezado). Mismo truco del Record: si types.ts gana una columna en la
// vieja, `tsc` obliga a decidir acá si se compara.
type ColumnaCajero = Exclude<keyof Fila<'reporte_cajeros'>, 'cajero_usuario_id' | 'clientes_unicos'>;
const IGUALES_CAJEROS: Record<ColumnaCajero, true> = {
  cajero_email: true, cajero_activo: true, operaciones: true, puntos_otorgados: true,
  monto_total: true, forzadas: true, ajustes: true, puntos_ajustados: true, canjes: true,
};

let fallas = 0;
const ok = (m: string) => console.log(`OK: ${m}`);
const fallo = (m: string, d?: string) => {
  console.error(`FALLO: ${m}${d ? ` — ${d}` : ''}`);
  fallas += 1;
};
const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Sale con código 1 SIN process.exit(). En esta PC (Windows, Node 24, tsx), process.exit() con las
// conexiones de fetch de supabase-js todavía abiertas revienta con "Assertion failed: !(handle->flags
// & UV_HANDLE_CLOSING)" y sale con 127 en vez de 1 — se vio contra un PostgREST falso, y a
// verificar-0035 le pasa igual. Con exitCode el proceso termina solo cuando se cierran, y el
// mensaje queda como la última línea.
function terminarConFalla(m: string) {
  console.error(m);
  process.exitCode = 1;
}

type Respuesta = { data: readonly object[] | null; error: { code: string; message: string } | null };

// Una llamada mínima a cada función nueva, sobre el alcance de TODOS los demos (así es más probable
// que haya filas para mirar las columnas). Sirve para los dos clientes: servicio y anónimo.
function llamadasMinimas(ids: string[], hoy: string): Record<Nueva, (c: Cliente) => PromiseLike<Respuesta>> {
  const base = { p_comercios: ids, p_desde: null, p_hasta: null, p_sucursal_id: null, p_cajero_id: null };
  return {
    reporte_resumen: (c) => c.rpc('reporte_resumen', base),
    // p_hasta es obligatorio en por día (con null devuelve cero filas y no habría columnas que mirar).
    reporte_por_dia: (c) => c.rpc('reporte_por_dia', { ...base, p_hasta: hoy, p_agrupar: 'auto' }),
    reporte_clientes: (c) =>
      c.rpc('reporte_clientes', { ...base, p_orden: 'visitas', p_desc: true, p_limite: 1, p_offset: 0 }),
    reporte_cajeros_alcance: (c) => c.rpc('reporte_cajeros_alcance', base),
  };
}

// Lee una respuesta que NO se pagina (una fila por sucursal, cajero o día). Si llega al tope de
// PostgREST no se compara: pudo venir cortada.
async function leer<T>(
  etiqueta: string,
  consulta: PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const { data, error } = await consulta;
  if (error) throw new Error(`${etiqueta}: ${error.message}`);
  const filas = data ?? [];
  if (filas.length >= TOPE_POSTGREST) {
    throw new Error(`${etiqueta} devolvió ${filas.length} filas: pudo cortarlas el tope de PostgREST`);
  }
  return filas;
}

// reporte_top_clientes (vieja): `.order()` explícito (su propio orden, por visitas, no es total y
// no sirve para paginar) + `.range()`, avanzando por lo RECIBIDO y cortando con una página VACÍA,
// así un max-rows menor que la página tampoco trunca (como leerPorId en actualizar-frente-google).
async function leerTopClientes(sb: Cliente, comercioId: string): Promise<Fila<'reporte_top_clientes'>[]> {
  const filas: Fila<'reporte_top_clientes'>[] = [];
  const vistos = new Set<string>();
  for (let desde = 0; ; ) {
    const { data, error } = await sb
      .rpc('reporte_top_clientes', { p_comercio_id: comercioId, p_limite: SIN_LIMITE })
      .order('cliente_id')
      .range(desde, desde + TAMANO_PAGINA - 1);
    if (error) throw new Error(`reporte_top_clientes: ${error.message}`);
    const pagina = data ?? [];
    if (pagina.length === 0) return filas;
    for (const f of pagina) {
      // También evita un bucle infinito si el `.range()` se ignorara.
      if (vistos.has(f.cliente_id)) throw new Error(`reporte_top_clientes repitió al cliente ${f.cliente_id} al paginar`);
      vistos.add(f.cliente_id);
      filas.push(f);
    }
    desde += pagina.length;
  }
}

// reporte_clientes (nueva): SOLO con `p_offset`. Corta cuando la función devuelve otra página que la
// pedida (`offset_efectivo` distinto: se pidió más allá del final y devolvió la última) o cuando ya
// se juntaron `total` filas. Al final, lo juntado tiene que ser exactamente `total`: si no, faltaron
// o sobraron filas y la comparación no vale.
async function leerClientes(sb: Cliente, comercioId: string): Promise<Fila<'reporte_clientes'>[]> {
  const filas: Fila<'reporte_clientes'>[] = [];
  const vistos = new Set<string>();
  let total: number | null = null;
  for (let offset = 0; ; ) {
    const { data, error } = await sb.rpc('reporte_clientes', {
      p_comercios: [comercioId], p_desde: null, p_hasta: null, p_sucursal_id: null, p_cajero_id: null,
      p_orden: 'visitas', p_desc: true, p_limite: TAMANO_PAGINA, p_offset: offset,
    });
    if (error) throw new Error(`reporte_clientes: ${error.message}`);
    const pagina = data ?? [];
    // Cero filas = total 0 (la función acota el offset, así que nunca devuelve una página vacía
    // teniendo filas).
    if (pagina.length === 0) break;
    const { offset_efectivo, total: totalPagina } = pagina[0];
    if (offset_efectivo !== offset) break;
    if (total !== null && totalPagina !== total) {
      throw new Error(`el total de reporte_clientes cambió entre páginas (${total} → ${totalPagina}): ¿hubo actividad durante la corrida?`);
    }
    total = totalPagina;
    for (const f of pagina) {
      const clave = `${f.comercio_id}|${f.cliente_id}`;
      if (vistos.has(clave)) throw new Error(`reporte_clientes repitió la fila ${clave} al paginar`);
      vistos.add(clave);
      filas.push(f);
    }
    offset += pagina.length;
    if (offset >= total) break;
  }
  if (filas.length !== (total ?? 0)) {
    throw new Error(`reporte_clientes juntó ${filas.length} filas pero su total dice ${total ?? 0}`);
  }
  return filas;
}

// 'AAAA-MM-DD' + n días, con aritmética de calendario en UTC: no depende de la zona del proceso.
function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

type Comparacion = { resumen: string; diferencias: string[] };

// En los detalles, "vieja → nueva".
async function compararResumen(sb: Cliente, comercioId: string): Promise<Comparacion> {
  const [vieja, nueva] = await Promise.all([
    leer('reporte_sucursales', sb.rpc('reporte_sucursales', { p_comercio_id: comercioId })),
    leer(
      'reporte_resumen',
      sb.rpc('reporte_resumen', {
        p_comercios: [comercioId], p_desde: null, p_hasta: null, p_sucursal_id: null, p_cajero_id: null,
      }),
    ),
  ]);
  const diferencias: string[] = [];

  const totales = nueva.filter((f) => f.es_total);
  if (totales.length !== 1) diferencias.push(`reporte_resumen trajo ${totales.length} filas total (es_total); tiene que ser exactamente 1`);

  const clave = (sucursalId: string | null) => sucursalId ?? 'sin sucursal';
  const porClaveVieja = new Map(vieja.map((f) => [clave(f.sucursal_id), f]));
  const porClaveNueva = new Map<string, Fila<'reporte_resumen'>>();
  for (const f of nueva) {
    if (f.es_total) continue;
    if (f.comercio_id !== comercioId) diferencias.push(`una fila de reporte_resumen trae otro comercio_id (${f.comercio_id})`);
    porClaveNueva.set(clave(f.sucursal_id), f);
  }

  for (const k of new Set([...porClaveVieja.keys(), ...porClaveNueva.keys()])) {
    const v = porClaveVieja.get(k);
    const n = porClaveNueva.get(k);
    const nombre = k === 'sin sucursal' ? 'sin sucursal' : `"${v?.sucursal_nombre ?? n?.sucursal_nombre ?? '?'}" (${k})`;
    if (!v) { diferencias.push(`sucursal ${nombre}: está en la nueva y no en la vieja`); continue; }
    if (!n) { diferencias.push(`sucursal ${nombre}: está en la vieja y no en la nueva`); continue; }
    if (v.operaciones !== n.operaciones) diferencias.push(`sucursal ${nombre}: visitas ${v.operaciones} → ${n.operaciones}`);
    if (v.puntos_otorgados !== n.puntos_otorgados) diferencias.push(`sucursal ${nombre}: acumulado ${v.puntos_otorgados} → ${n.puntos_otorgados}`);
    if (v.canjes !== n.canjes) diferencias.push(`sucursal ${nombre}: premios ${v.canjes} → ${n.canjes}`);
    if (n.clientes_unicos < v.clientes_unicos) diferencias.push(`sucursal ${nombre}: clientes ${v.clientes_unicos} → ${n.clientes_unicos} (la nueva tiene que dar >=)`);
  }
  return {
    resumen: `${porClaveVieja.size} fila(s) por sucursal en la vieja y ${porClaveNueva.size} en la nueva; visitas, acumulado y premios iguales; clientes nuevo >= viejo`,
    diferencias,
  };
}

async function compararCajeros(sb: Cliente, comercioId: string): Promise<Comparacion> {
  const [vieja, nueva] = await Promise.all([
    leer('reporte_cajeros', sb.rpc('reporte_cajeros', { p_comercio_id: comercioId, p_desde: null, p_hasta: null })),
    leer(
      'reporte_cajeros_alcance',
      sb.rpc('reporte_cajeros_alcance', {
        p_comercios: [comercioId], p_desde: null, p_hasta: null, p_sucursal_id: null, p_cajero_id: null,
      }),
    ),
  ]);
  const diferencias: string[] = [];

  const clave = (cajeroId: string | null) => cajeroId ?? 'sin registrar';
  const porClaveVieja = new Map(vieja.map((f) => [clave(f.cajero_usuario_id), f]));
  const porClaveNueva = new Map<string, Fila<'reporte_cajeros_alcance'>>();
  for (const f of nueva) {
    if (f.comercio_id !== comercioId) diferencias.push(`una fila de reporte_cajeros_alcance trae otro comercio_id (${f.comercio_id})`);
    porClaveNueva.set(clave(f.cajero_usuario_id), f);
  }

  const columnas = Object.keys(IGUALES_CAJEROS) as ColumnaCajero[];
  for (const k of new Set([...porClaveVieja.keys(), ...porClaveNueva.keys()])) {
    const v = porClaveVieja.get(k);
    const n = porClaveNueva.get(k);
    const nombre = k === 'sin registrar' ? 'sin registrar' : `${v?.cajero_email ?? n?.cajero_email ?? '?'} (${k})`;
    if (!v) { diferencias.push(`cajero ${nombre}: está en la nueva y no en la vieja`); continue; }
    if (!n) { diferencias.push(`cajero ${nombre}: está en la vieja y no en la nueva`); continue; }
    for (const col of columnas) {
      if (v[col] !== n[col]) diferencias.push(`cajero ${nombre}: ${col} ${String(v[col])} → ${String(n[col])}`);
    }
  }
  return {
    resumen: `${porClaveVieja.size} fila(s) por cajero en la vieja y ${porClaveNueva.size} en la nueva; todo igual salvo Clientes`,
    diferencias,
  };
}

async function compararClientes(sb: Cliente, comercioId: string): Promise<Comparacion> {
  const [vieja, nueva] = await Promise.all([leerTopClientes(sb, comercioId), leerClientes(sb, comercioId)]);
  const diferencias: string[] = [];

  const porClienteNueva = new Map<string, Fila<'reporte_clientes'>>();
  for (const f of nueva) {
    if (f.comercio_id !== comercioId) diferencias.push(`una fila de reporte_clientes trae otro comercio_id (${f.comercio_id})`);
    porClienteNueva.set(f.cliente_id, f);
  }
  const enVieja = new Set<string>();
  for (const v of vieja) {
    enVieja.add(v.cliente_id);
    const n = porClienteNueva.get(v.cliente_id);
    const nombre = `${v.cliente_nombre} (${v.cliente_id})`;
    if (!n) { diferencias.push(`cliente ${nombre}: está en la vieja (${v.visitas} visitas) y no en la nueva`); continue; }
    if (v.visitas !== n.operaciones) diferencias.push(`cliente ${nombre}: visitas ${v.visitas} → ${n.operaciones}`);
    if (v.puntos_totales !== n.puntos_otorgados) diferencias.push(`cliente ${nombre}: acumulado ${v.puntos_totales} → ${n.puntos_otorgados}`);
  }
  let soloPremios = 0;
  for (const n of nueva) {
    if (enVieja.has(n.cliente_id)) continue;
    if (n.operaciones === 0 && n.puntos_otorgados === 0) soloPremios += 1;
    else diferencias.push(`cliente ${n.nombre} (${n.cliente_id}): está en la nueva con ${n.operaciones} visitas y ${n.puntos_otorgados} de acumulado, y no en la vieja`);
  }
  return {
    resumen: `${vieja.length} cliente(s) en la vieja y ${nueva.length} en la nueva (${soloPremios} solo con premios); visitas y acumulado iguales`,
    diferencias,
  };
}

async function compararPorDia(sb: Cliente, comercioId: string): Promise<Comparacion> {
  const vieja = [
    ...(await leer('reporte_tendencia', sb.rpc('reporte_tendencia', { p_comercio_id: comercioId, p_dias: DIAS_TENDENCIA }))),
  ].sort((a, b) => a.dia.localeCompare(b.dia));
  if (vieja.length !== DIAS_TENDENCIA) {
    throw new Error(`reporte_tendencia(${DIAS_TENDENCIA}) devolvió ${vieja.length} días`);
  }
  vieja.forEach((f, i) => {
    if (f.dia !== sumarDias(vieja[0].dia, i)) throw new Error(`reporte_tendencia no devolvió ${DIAS_TENDENCIA} días seguidos`);
  });
  // La ventana, del now() de la base en la zona del comercio (ver el encabezado).
  const desde = vieja[0].dia;
  const hoy = vieja[DIAS_TENDENCIA - 1].dia;

  const nueva = await leer(
    'reporte_por_dia',
    sb.rpc('reporte_por_dia', {
      p_comercios: [comercioId], p_desde: desde, p_hasta: hoy, p_sucursal_id: null, p_cajero_id: null,
      p_agrupar: 'dia',
    }),
  );
  const diferencias: string[] = [];

  const porDia = new Map<string, Fila<'reporte_por_dia'>>();
  for (const f of nueva) {
    if (f.es_mes) diferencias.push(`${f.periodo}: vino agrupado por mes con p_agrupar = 'dia'`);
    if (f.periodo < desde || f.periodo > hoy) diferencias.push(`${f.periodo}: fuera de la ventana ${desde} a ${hoy}`);
    if (porDia.has(f.periodo)) diferencias.push(`${f.periodo}: repetido`);
    porDia.set(f.periodo, f);
  }
  // El recorte de `primera` solo quita días del PRINCIPIO: lo que venga son días seguidos hasta hoy.
  const periodos = [...porDia.keys()].sort();
  if (periodos.length > 0 && periodos.some((p, i) => p !== sumarDias(hoy, i - (periodos.length - 1)))) {
    diferencias.push(`los días de la nueva no son un tramo seguido que termina hoy (${periodos[0]} a ${periodos[periodos.length - 1]}, ${periodos.length} días)`);
  }

  for (const v of vieja) {
    const n = porDia.get(v.dia);
    const operaciones = n?.operaciones ?? 0;
    const canjes = n?.canjes ?? 0;
    if (v.operaciones !== operaciones || v.canjes !== canjes) {
      diferencias.push(
        `${v.dia}: visitas ${v.operaciones} → ${operaciones}, premios ${v.canjes} → ${canjes}${n ? '' : ' (el día no vino: cuenta como 0)'}`,
      );
    }
  }
  return {
    resumen: `${desde} a ${hoy}: ${DIAS_TENDENCIA} días iguales (la nueva trajo ${nueva.length}; los que faltan cuentan como 0)`,
    diferencias,
  };
}

async function comparar(etiqueta: string, correr: () => Promise<Comparacion>): Promise<boolean> {
  try {
    const { resumen, diferencias } = await correr();
    if (diferencias.length === 0) {
      ok(`${etiqueta} — ${resumen}.`);
      return true;
    }
    fallo(`${etiqueta} — ${diferencias.length} diferencia(s) (vieja → nueva)`);
    for (const d of diferencias.slice(0, MAX_DETALLE)) console.error(`    · ${d}`);
    if (diferencias.length > MAX_DETALLE) console.error(`    · … y ${diferencias.length - MAX_DETALLE} más`);
    return false;
  } catch (e) {
    fallo(`${etiqueta} — no se pudo comparar`, mensaje(e));
    return false;
  }
}

async function main() {
  const supabase = createServiceClient();
  const anon: Cliente = createClient<Database>(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    { auth: { persistSession: false } },
  );

  // 0. Los comercios demo.
  const { data: demos, error: eDemos } = await supabase
    .from('comercios')
    .select('id, nombre, slug')
    .like('slug', '%-demo')
    .order('slug');
  if (eDemos) {
    return terminarConFalla(`FALLO: no se pudieron listar los comercios demo — ${eDemos.message}`);
  }
  if (!demos || demos.length === 0) {
    return terminarConFalla("FALLO: no hay comercios demo (slug '%-demo'); no hay contra qué comparar.");
  }
  if (demos.length >= TOPE_POSTGREST) {
    return terminarConFalla(`FALLO: ${demos.length} comercios demo: la lista pudo venir cortada por el tope de PostgREST.`);
  }
  console.log(`Comercios demo: ${demos.length} (${demos.map((d) => d.slug).join(', ')}).\n`);

  // 1. Existencia, argumentos con nombre y columnas. La fecha de hoy solo le da a por día su p_hasta
  // obligatorio; acá no se compara nada, así que el reloj de la PC no importa.
  console.log('1. Las cuatro funciones nuevas');
  const llamadas = llamadasMinimas(demos.map((d) => d.id), new Date().toISOString().slice(0, 10));
  const faltantes: Nueva[] = [];
  for (const f of NUEVAS) {
    const r = await llamadas[f](supabase);
    if (r.error) {
      if (r.error.code === 'PGRST202') {
        faltantes.push(f);
        fallo(`${f} no existe para PostgREST (PGRST202)`, r.error.message);
      } else {
        fallo(`${f} falló con la llave de servicio (¿se perdió el grant?)`, `${r.error.code}: ${r.error.message}`);
      }
      continue;
    }
    const fila = r.data?.[0];
    if (!fila) {
      // Falla y no aviso (como verificar-0035): sin filas no se miró ninguna columna.
      fallo(`${f} respondió sin filas; no se pudieron mirar sus columnas`);
      continue;
    }
    const esperadas = Object.keys(COLUMNAS[f]);
    const recibidas = Object.keys(fila);
    const faltan = esperadas.filter((c) => !recibidas.includes(c));
    const sobran = recibidas.filter((c) => !esperadas.includes(c));
    if (faltan.length > 0 || sobran.length > 0) {
      fallo(
        `las columnas de ${f} no coinciden con lib/supabase/types.ts`,
        [faltan.length > 0 && `faltan: ${faltan.join(', ')}`, sobran.length > 0 && `sobran: ${sobran.join(', ')}`]
          .filter(Boolean)
          .join('; '),
      );
    } else {
      ok(`${f} responde con sus argumentos con nombre y devuelve sus ${esperadas.length} columnas.`);
    }
  }
  if (faltantes.length > 0) {
    return terminarConFalla(
      `\nLa migración 0040 no está aplicada (o PostgREST todavía no refrescó su caché de esquema): faltan ${faltantes.join(', ')}.` +
        "\nSi ya se aplicó, en Studio: notify pgrst, 'reload schema';  y volvé a correr este script." +
        '\nNo se compara nada más.',
    );
  }

  // 2. La llave anónima NO puede ejecutarlas. Se aserta el error EXACTO: una llave inválida, un fallo
  // de red o un "permission denied for table" también son errores, y ninguno prueba que el `revoke`
  // de la FUNCIÓN esté puesto.
  console.log('\n2. La llave anónima');
  for (const f of NUEVAS) {
    const r = await llamadas[f](anon);
    if (!r.error) {
      fallo(`la llave ANÓNIMA puede ejecutar ${f}: faltan los revoke`, `${r.data?.length ?? 0} filas`);
    } else if (r.error.code === '42501' && r.error.message.includes(`permission denied for function ${f}`)) {
      ok(`la llave anónima NO puede ejecutar ${f} (42501, permission denied for function).`);
    } else {
      fallo(`la llave anónima falló por OTRO motivo con ${f}; el revoke no quedó comprobado`, `${r.error.code}: ${r.error.message}`);
    }
  }

  // 3. Contra las funciones viejas, comercio por comercio.
  console.log('\n3. Contra las funciones viejas (vieja → nueva en los detalles)');
  const COMPARACIONES: [string, (sb: Cliente, id: string) => Promise<Comparacion>][] = [
    ['resumen', compararResumen],
    ['cajeros', compararCajeros],
    ['clientes', compararClientes],
    ['por día', compararPorDia],
  ];
  const porComercio: { nombre: string; fallidas: string[] }[] = [];
  for (const demo of demos) {
    console.log(`\n── ${demo.nombre} (${demo.slug}) ──`);
    const fallidas: string[] = [];
    for (const [etiqueta, correr] of COMPARACIONES) {
      if (!(await comparar(etiqueta, () => correr(supabase, demo.id)))) fallidas.push(etiqueta);
    }
    porComercio.push({ nombre: `${demo.nombre} (${demo.slug})`, fallidas });
  }

  console.log('\nResumen por comercio:');
  for (const { nombre, fallidas } of porComercio) {
    const cerradas = COMPARACIONES.length - fallidas.length;
    console.log(`  ${nombre}: ${cerradas}/${COMPARACIONES.length}${fallidas.length > 0 ? ` — no cerró: ${fallidas.join(', ')}` : ''}`);
  }
  const totalComparaciones = porComercio.length * COMPARACIONES.length;
  const totalFallidas = porComercio.reduce((s, c) => s + c.fallidas.length, 0);
  console.log(`Total: ${totalComparaciones - totalFallidas} de ${totalComparaciones} comparaciones cerraron.`);

  if (fallas > 0) {
    return terminarConFalla(`\n${fallas} verificación(es) fallaron. La 0040 NO se edita: el arreglo va en una 0041.`);
  }
  console.log('\nMigración 0040 verificada.');
}

// Un mensaje, no un stack: lo que se escapa hasta acá (una variable de entorno que falta, la red) se
// explica en una línea.
main().catch((e) => {
  terminarConFalla(`FALLO inesperado: ${mensaje(e)}`);
});

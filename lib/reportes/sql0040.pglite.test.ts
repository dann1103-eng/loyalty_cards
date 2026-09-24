import { afterAll, beforeAll, chai, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import type { Database } from '../supabase/types';

// ══ QUÉ PRUEBA ESTE ARCHIVO ══
// La SQL de la migración 0040 (reporte_resumen, reporte_por_dia, reporte_clientes,
// reporte_cajeros_alcance) CORRIENDO, antes de que Daniel la aplique a mano en Studio. Contra Supabase
// no se puede: el asistente no corre DDL, así que ahí la 0040 solo existe después de aplicada, y el
// protocolo de mutación (romper una línea, ver caer la prueba) necesita correr la SQL rota. Un error
// de SQL se arregla acá, no en producción.
//
// ══ CÓMO ══
// PGlite (Postgres compilado a WASM, en el mismo proceso). Una sola instancia por archivo: el
// esquema REAL, no una copia a mano — las migraciones 0001 a 0039 leídas del disco, en orden, y
// después la 0040 byte-idéntica, también del disco (una mutación se hace editando ESE archivo). El
// preámbulo pone lo que en Supabase ya existe: el esquema `auth` con `auth.users` (0001 y 0003 le
// apuntan una FK) y los roles anon/authenticated/service_role (sin ellos los revoke/grant fallan, y un
// grant con la firma mal escrita es justo lo que abortaría la transacción en Studio). pgcrypto se le
// da a PGlite al crearlo, y el `create extension` de la 0001 lo encuentra. Ninguna migración vieja
// necesitó parche (PGlite 0.5.8 = PostgreSQL 18.3).
//
// Cada caso usa comercios PROPIOS (ids nuevos): todas las funciones filtran por `p_comercios`, así que
// no hace falta limpiar. Los instantes se siembran calculados en la zona de CADA comercio con desfases
// FIJOS (El Salvador UTC−6 y Bogotá UTC−5, sin horario de verano desde 1988 y 1993): el oráculo no pasa
// por la conversión de Postgres que se está probando. La sesión corre en Asia/Tokyo (+09) y los bordes
// se repiten en UTC (lo que usa Supabase): nada de la 0040 puede depender del TimeZone de la sesión.
//
// ══ LO QUE PGLITE NO VE ══ (queda para las pruebas contra Supabase, Tarea 3): nombres de argumentos
// en PostgREST, el tope de filas (max-rows), `.range()` por fuera del resultado, tipos del JSON,
// PGRST203. Tampoco la VERSIÓN: PGlite trae Postgres 18, así que una función de Postgres 16+ pasaría
// acá y fallaría en un Supabase más viejo. Y la collation: el orden por nombre se asierta solo con
// nombres ASCII capitalizados igual, que ordenan igual en "C" y en en_US.
//
// ══ MUTACIONES ══ Corridas de verdad el 2026-09-23, una por vez, sobre el .sql del DISCO: un corredor
// reemplaza el texto exacto dentro de la función que corresponde (verificando cuántas veces aparece),
// corre este archivo y restaura con `git checkout --`. 104 corridas: 96 caen, 8 no (abajo, por qué).
// Formato: mutación → la prueba que cae: «el mensaje real» (el primero; acortado con …).
// R = reporte_resumen, D = reporte_por_dia, C = reporte_clientes, K = reporte_cajeros_alcance.
//
// Carga
//   grant de reporte_clientes con un integer menos → "la transacción entera llega al commit…":
//     «error al cargar la 0040: expected 'function reporte_clientes(uuid[], date, date, uuid, uuid,
//     text, boolean, integer) does not exist' to be null» (y las otras 32: sin funciones cae todo).
//   sin el revoke de reporte_resumen → ídem: «permisos de reporte_resumen: expected { existe: true,
//     anon: true, authenticated: true, service_role: true } to deeply equal { …anon: false, … }».
//   cajero_email renombrada a email_cajero → "argumentos y columnas…": «Returns de
//     reporte_cajeros_alcance: expected [ …'email_cajero'… ] to deeply equal [ …'cajero_email'… ]».
//
// Bordes → "bordes del período…" (el mensaje es el de R; C, K y D caen en su prueba del mismo bloque)
//   `>=` → `>` en el desde, visitas (R C K D): «America/El_Salvador (sesión UTC) · puntos (1 = X 00:00,
//     10 = X 23:59): expected 10 to be 11»; D: «día X solo (sesión UTC): expected [ '2026-03-10: 2
//     visitas, 4 premios, es_mes false' ] to deeply equal [ '2026-03-10: 4 visitas, 4 premios, …' ]».
//   `>=` → `>` en el desde, canjes (R C K D): «… · premios: expected 1 to be 2»; D: «'… 4 visitas, 2 premios'».
//   `<` → `<=` en el hasta, visitas (R C K): «… · puntos …: expected 111 to be 11».
//   `<` → `<=` en el hasta, canjes (R C K): «… · premios: expected 3 to be 2».
//   sin el `+ 1` del hasta (R C K D): «… · puntos …: expected undefined to be 11» (la fila del comercio
//     desaparece; también caen "filtros…" y "definiciones…"); D: «'2026-03-10: 0 visitas, 0 premios'».
//   `lim` con la zona del PRIMER comercio para todos (R C K): «America/Bogota (sesión UTC) · puntos …:
//     expected 110 to be 11»; D: «X-1 a X+1 (sesión UTC): expected [ '2026-03-09: 3 visitas, 3 premios',
//     '2026-03-10: 4 …', '2026-03-11: 1 visitas, 1 premios' ] …», y "por mes con dos zonas".
//   D: `conteo_dia` en la zona de la SESIÓN: «día X solo (sesión UTC): expected [ '2026-03-10: 2 visitas,
//     2 premios, es_mes false' ] …» (y 5 pruebas más).
//
// Filtros → "filtros de alcance, sucursal y cajero…" (en cada rama por separado; la de visitas da lo
// mismo con "visitas" en lugar de "premios")
//   sin el período en canjes (R C K): «America/El_Salvador (sesión UTC) · premios: expected 4 to be 2»;
//     C: aparece «'SV X-1 23:59': '0 visita, 1 premio'».
//   sin la sucursal en canjes (R C K D): «sucursal S1 · premios: expected 3 to be 2»; C: «sucursal S1:
//     expected { …, K2: '0 visita, 1 premio' } …»; K: «expected { c1: '1 visitas, 2 premios, 2 clientes' …».
//   sin el cajero en canjes (R C K D): «cajero c1 · premios: expected 3 to be 2»; K: «cajero c1: expected
//     { c1: …, c2: '0 visitas, 1 premios, 1 clientes' } to deeply equal { c1: … }».
//   canjes unidos a `lim` "on true" (R C K): «sin filtros, alcance [A] · premios: expected 4 to be 3»
//     (se cuela el premio del comercio B); D: «día X solo: '… 4 visitas, 6 premios'» — en D cae porque
//     DUPLICA filas con dos comercios; lo ajeno lo vuelve a filtrar conteo_dia (0040, (d)).
//   D, `primera` sin el filtro de sucursal o de cajero, en cada rama → "con 'Desde siempre' y un cajero o
//     una sucursal…": «cajero c2: expected [ { …periodo: '2026-08-31'… } …» (visitas: arranca en H-20) y
//     «…'2026-08-26'…» (canjes: H-25).
//
// Ajustes, bruto y clientes → "definiciones…" salvo aclaración
//   R, los ajustes entran a actividad: «filas por sucursal (la de solo ajustes no aparece): expected
//     [ 'Centro: 5 visitas', 'Solo ajustes: 0 visitas' ] to deeply equal [ 'Centro: 5 visitas' ]».
//   R, un ajuste cuenta como visita: «visitas: 3 de K1 (…) + K4 + K5; el ajuste no: expected 7 to be 5».
//   C, los ajustes entran a actividad: «expected { K1: { …ultima: '2026-04-21T00:00:00.000Z' }, …, K3:
//     { visitas: 0, acumulado: 0, premios: 0, … } } …» (la corrección de las 18:00 mueve la última
//     actividad de K1, y K3 aparece).
//   D, `primera` sin la exclusión de ajustes → "un ajuste viejo…": «días de la serie (de H-5 a H):
//     expected 31 to be 6».
//   K, un ajuste cuenta como visita: «… c1 … visitas: 5, … correcciones: 0 …».
//   K, Clientes cuenta ajustes: «… c2 … correcciones: 1, puntos_ajustados: -5, premios: 0, clientes: 1».
//   el acumulado sin el filtro de acreditación: R «acumulado BRUTO: …: expected 17 to be 14»; C «K1:
//     { visitas: 3, acumulado: 13 …»; K «c1 … acumulado: 16»; el monto de K sin ese filtro «monto: 17.5».
//   C, ultima_actividad solo de visitas: «K2: { …premios: 2, ultima: '1970-01-01T00:00:00.000Z' }» (null),
//     y el orden por última.
//   R, clientes sin distinct: «· clientes: expected 4 to be 2» (y 3 pruebas más).
//
// La fila total
//   es_total = "sucursal_id is null" → "la actividad 'sin sucursal'…": «cuántas filas tienen es_total:
//     expected 2 to be 1» (y los bordes: la fila del comercio pasa a ser "total").
//
// reporte_por_dia: tramo y agrupación → "auto decide…" / "cero filas…"
//   `> 62` → `>= 62`: «62 días con p_agrupar=auto: filas: expected 3 to be 62».
//   `> 62` → `> 63`: «63 días con p_agrupar=auto: por mes: expected [ { …periodo: '2026-07-20'… }, … ]».
//   auto sobre el período PEDIDO y no el tramo recortado: «62 días con p_agrupar=auto: filas: expected 3
//     to be 62».
//   sin el `pr.dia is not null`: «nunca activo, con desde: expected [ …11 filas en cero… ] to deeply equal []».
//   el tramo ignora p_desde: «día X solo: expected [ '2026-03-09: 0 visitas, …', '2026-03-10: …' ] …».
//
// reporte_clientes: paginación y orden
//   offset con división NUMÉRICA → "312 de a 50 → 300": «filas de la última página: expected 1 to be 12».
//   offset sin el greatest(…, 0) de afuera → "total 0…": «error: OFFSET must not be negative».
//   offset sin acotar por el total → "p_limite se acota…": «p_limite=5000, página 999: expected [] to
//     deeply equal [ [ 1001, 1000 ] ]».
//   offset sin greatest(p_offset, 0) → "p_limite se acota…": «error: OFFSET must not be negative».
//   p_limite sin el tope de 1000: «p_limite=5000: filas: expected 1001 to be 1000».
//   p_limite sin el piso de 1: «error: division by zero».
//   p_limite null = 1000: «p_limite=null: filas: expected 1000 to be 50».
//   p_orden sin validar contra la lista → "p_orden fuera de la lista…": «p_orden=xyz: expected [ 'Carla@A',
//     'Carla@B', 'Beto@B', 'Ana@A', 'AnaZeta@A', 'AnaAlfa@A' ] to deeply equal [ 'AnaAlfa@A', … ]».
//   p_desc null = siempre descendente: «nombre con p_desc null: expected [ 'Carla@A', … ] …».
//   sin desempate, o comercio_id → cliente_id → "ordena por cada columna…": «visitas desc: expected
//     [ 'AnaAlfa@A', 'Carla@A', 'AnaZeta@A', 'Carla@B', 'Beto@B', 'Ana@A' ] …» (y 4 pruebas más).
//   desempate sin comercio_id → "con TODAS las columnas empatadas…": «visitas desc: expected [ …, 'k5@Q',
//     'k5@P', …, 'k7@Q', 'k7@P', … ] …». (Con solo Carla@A/Carla@B esta mutación NO caía; por eso esa prueba.)
//   apellido desc sin `nulls last`: «nombre desc: expected [ …, 'Ana@A', 'AnaZeta@A', 'AnaAlfa@A' ] …».
//   nombre sin el desempate por apellido: «nombre asc: expected [ 'Ana@A', 'AnaZeta@A', 'AnaAlfa@A', … ] …».
//
// Columnas cruzadas en el select de afuera (en `language sql` se asignan por POSICIÓN)
//   C, apellido ↔ teléfono → "cada fila trae…": «AnaAlfa@A: expected { nombre: 'Ana', apellido:
//     '+5039…', telefono: 'Alfa' } …».
//   R, canjes ↔ clientes_unicos: «premios: expected 4 to be 2».
//   K, forzadas ↔ ajustes: «… c2 … forzadas: 1, correcciones: 0 …»; forzadas ↔ canjes: «… · premios:
//     expected +0 to be 2».
//
// NO CAEN (8), y está bien: cada una es equivalente, y la 0040 lo dice en su comentario.
//   D, `<` → `<=` en el hasta (visitas y canjes) y sin el filtro de período (cada rama): el left join
//     desde `dias` ya descarta lo que cae fuera del tramo (0040, reporte_por_dia, (c)).
//   D, los ajustes entran a actividad: los conteos filtran por clase ((a)).
//   D, sin el `p_hasta is not null` de lim: generate_series con un null tampoco da filas ((b)).
//   R, es_total = "los DOS ids null": una fila agrupada siempre trae comercio_id (NOT NULL en tarjetas).
//   C, apellido ascendente sin `nulls last`: es el default de asc.
// No se corrió floor() en lugar de la división entera: es equivalente (0040 y spec §5.3).

// Sin esto chai recorta todo valor a 40 caracteres ("expected [ …(3) ] to deeply equal [ …(3) ]") y
// el mensaje de una prueba caída no dice QUÉ fila cambió, que es justo lo que hay que leer.
chai.config.truncateThreshold = 0;

type Zona = 'America/El_Salvador' | 'America/Bogota';
const SV: Zona = 'America/El_Salvador';
const BO: Zona = 'America/Bogota';
const DESFASE_HORAS: Record<Zona, number> = { 'America/El_Salvador': -6, 'America/Bogota': -5 };
const ZONA_DE_SESION = 'Asia/Tokyo';

type Funciones = Database['public']['Functions'];
type FilaResumen = Funciones['reporte_resumen']['Returns'][number];
type FilaPorDia = Funciones['reporte_por_dia']['Returns'][number];
type FilaClientes = Funciones['reporte_clientes']['Returns'][number];
type FilaCajeros = Funciones['reporte_cajeros_alcance']['Returns'][number];

const DIR_MIGRACIONES = path.join(process.cwd(), 'supabase', 'migrations');
const ARCHIVO_0040 = '0040_reportes_con_filtros.sql';

const FIRMAS = {
  reporte_resumen: 'reporte_resumen(uuid[],date,date,uuid,uuid)',
  reporte_por_dia: 'reporte_por_dia(uuid[],date,date,uuid,uuid,text)',
  reporte_clientes: 'reporte_clientes(uuid[],date,date,uuid,uuid,text,boolean,integer,integer)',
  reporte_cajeros_alcance: 'reporte_cajeros_alcance(uuid[],date,date,uuid,uuid)',
} as const;

const PREAMBULO = `
  create schema auth;
  create table auth.users (id uuid primary key);
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
`;

function leerMigracion(archivo: string): string {
  return readFileSync(path.join(DIR_MIGRACIONES, archivo), 'utf8');
}

// 0001 a 0039, en orden y SIN huecos: si falta una, el esquema no es el de producción.
function migracionesAnteriores(): string[] {
  const archivos = readdirSync(DIR_MIGRACIONES)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) < 40)
    .sort();
  archivos.forEach((f, i) => {
    if (Number(f.slice(0, 4)) !== i + 1) throw new Error(`[test] falta la migración ${i + 1} (vino ${f})`);
  });
  if (archivos.length !== 39) throw new Error(`[test] se esperaban 39 migraciones, hay ${archivos.length}`);
  return archivos;
}

let db: PGlite;
let errorCarga0040: string | null = null;
let checkFunctionBodiesAlCargar: string | null = null;

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(PREAMBULO);
  for (const archivo of migracionesAnteriores()) await db.exec(leerMigracion(archivo));
  const r = await db.query<{ check_function_bodies: string }>('show check_function_bodies');
  checkFunctionBodiesAlCargar = r.rows[0].check_function_bodies;
  try {
    await db.exec(leerMigracion(ARCHIVO_0040));
  } catch (e) {
    errorCarga0040 = e instanceof Error ? e.message : String(e);
    await db.exec('rollback');
  }
  await db.exec(`set timezone = '${ZONA_DE_SESION}'`);
});

afterAll(async () => {
  await db?.close();
});

// ─── fechas ───────────────────────────────────────────────────────────────────

/** El instante (ISO, UTC) de una hora LOCAL 'AAAA-MM-DD HH:MM' de un comercio. */
function local(fechaHora: string, zona: Zona): string {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(fechaHora);
  if (!m) throw new Error(`[test] hora local mal escrita: ${fechaHora}`);
  const [a, mes, d, h, min] = m.slice(1).map(Number);
  return new Date(Date.UTC(a, mes - 1, d, h - DESFASE_HORAS[zona], min)).toISOString();
}

function sumarDias(fecha: string, n: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

async function conZonaDeSesion(zona: string, fn: () => Promise<void>): Promise<void> {
  await db.exec(`set timezone = '${zona}'`);
  try {
    await fn();
  } finally {
    await db.exec(`set timezone = '${ZONA_DE_SESION}'`);
  }
}
const ZONAS_DE_SESION = ['UTC', 'Asia/Tokyo'];

// ─── siembra ──────────────────────────────────────────────────────────────────

interface Comercio {
  id: string;
  zona: Zona;
  programaId: string;
  recompensaId: string;
}

let contadorTelefono = 0;
function telefonoNuevo(): string {
  contadorTelefono += 1;
  return `+5039${String(contadorTelefono).padStart(7, '0')}`;
}

/** Un uuid cuyo orden se controla: mismo prefijo aleatorio, `n` decide el orden (uuid ordena por bytes). */
function idOrdenado(prefijo: string, clase: number, n: number): string {
  return `${prefijo}-000${clase}-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

async function una<T>(sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<T>(sql, params);
  if (r.rows.length !== 1) throw new Error(`[test] se esperaba una fila y vinieron ${r.rows.length}: ${sql}`);
  return r.rows[0];
}

async function crearPrograma(comercioId: string, principal: boolean): Promise<string> {
  const { id } = await una<{ id: string }>(
    `insert into programas_tarjeta (comercio_id, nombre, slug, tipo_tarjeta, es_principal)
     values ($1, 'Programa', $2, 'puntos', $3) returning id`,
    [comercioId, `p-${randomUUID()}`, principal],
  );
  return id;
}

async function crearComercio(zona: Zona, id: string | null = null): Promise<Comercio> {
  const { id: comercioId } = await una<{ id: string }>(
    `insert into comercios (id, nombre, slug, zona_horaria)
     values (coalesce($1::uuid, gen_random_uuid()), 'Comercio de prueba', $2, $3) returning id`,
    [id, `prueba-${randomUUID()}`, zona],
  );
  const programaId = await crearPrograma(comercioId, true);
  const { id: recompensaId } = await una<{ id: string }>(
    `insert into recompensas (comercio_id, nombre, costo_puntos, tipo)
     values ($1, 'Café', 10, 'otro') returning id`,
    [comercioId],
  );
  return { id: comercioId, zona, programaId, recompensaId };
}

async function crearSucursal(comercio: Comercio, nombre: string): Promise<string> {
  const { id } = await una<{ id: string }>(
    `insert into sucursales (comercio_id, nombre) values ($1, $2) returning id`,
    [comercio.id, nombre],
  );
  return id;
}

async function crearCajero(comercio: Comercio, email: string): Promise<string> {
  const { id } = await una<{ id: string }>(
    `insert into usuarios_comercio (comercio_id, email, rol) values ($1, $2, 'cajero') returning id`,
    [comercio.id, email],
  );
  return id;
}

async function crearCliente(nombre: string, apellido: string | null = null, id: string | null = null): Promise<string> {
  const { id: clienteId } = await una<{ id: string }>(
    `insert into clientes (id, nombre, apellido, telefono)
     values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4) returning id`,
    [id, nombre, apellido, telefonoNuevo()],
  );
  return clienteId;
}

async function crearTarjeta(clienteId: string, comercio: Comercio, programaId = comercio.programaId): Promise<string> {
  const { id } = await una<{ id: string }>(
    `insert into tarjetas (cliente_id, comercio_id, programa_id) values ($1, $2, $3) returning id`,
    [clienteId, comercio.id, programaId],
  );
  return id;
}

interface Movimiento {
  en: string; // instante ISO
  sucursal?: string | null;
  cajero?: string | null;
}

interface Asiento extends Movimiento {
  tipo?: 'acreditacion' | 'uso' | 'renovacion' | 'ajuste';
  puntos?: number;
  forzado?: boolean;
  monto?: number | null;
}

/** Una fila de transacciones_puntos (visita o ajuste). */
async function asiento(tarjetaId: string, a: Asiento): Promise<void> {
  const tipo = a.tipo ?? 'acreditacion';
  const forzado = a.forzado ?? false;
  await db.query(
    `insert into transacciones_puntos
       (tarjeta_id, tipo, puntos_delta, created_at, sucursal_id, cajero_usuario_id, forzado, monto_compra, motivo)
     values ($1, $2, $3, $4::timestamptz, $5, $6, $7, $8, $9)`,
    [
      tarjetaId, tipo, a.puntos ?? 1, a.en, a.sucursal ?? null, a.cajero ?? null, forzado, a.monto ?? null,
      tipo === 'ajuste' || forzado ? 'prueba' : null,
    ],
  );
}

async function canje(tarjetaId: string, comercio: Comercio, m: Movimiento): Promise<void> {
  await db.query(
    `insert into canjes (tarjeta_id, recompensa_id, puntos_gastados, created_at, sucursal_id, cajero_usuario_id)
     values ($1, $2, 10, $3::timestamptz, $4, $5)`,
    [tarjetaId, comercio.recompensaId, m.en, m.sucursal ?? null, m.cajero ?? null],
  );
}

/** `cantidad` clientes nuevos en el comercio, cada uno con UNA visita en `en`. */
async function clientesEnMasa(comercio: Comercio, cantidad: number, en: string): Promise<void> {
  contadorTelefono += 1;
  const prefijo = `+5998${String(contadorTelefono).padStart(4, '0')}`;
  await db.query(
    `with nuevos as (
       insert into clientes (nombre, telefono)
       select 'Masivo ' || lpad(g::text, 5, '0'), $2 || lpad(g::text, 6, '0') from generate_series(1, $1::int) g
       returning id
     ), tarj as (
       insert into tarjetas (cliente_id, comercio_id, programa_id)
       select n.id, $3::uuid, $4::uuid from nuevos n
       returning id
     )
     insert into transacciones_puntos (tarjeta_id, tipo, puntos_delta, created_at)
     select t.id, 'acreditacion', 1, $5::timestamptz from tarj t`,
    [cantidad, prefijo, comercio.id, comercio.programaId, en],
  );
}

// ─── llamadas ─────────────────────────────────────────────────────────────────

interface Filtros {
  desde?: string | null;
  hasta?: string | null;
  sucursal?: string | null;
  cajero?: string | null;
}

function arregloUuid(ids: string[]): string {
  return `{${ids.join(',')}}`;
}

// `with ordinality` conserva el orden en que la FUNCIÓN devuelve las filas (su propio ORDER BY), y
// to_jsonb da números y fechas como los ve el JSON de PostgREST.
async function filas<T>(llamada: string, params: unknown[]): Promise<T[]> {
  const r = await db.query<{ fila: T }>(
    `select to_jsonb(r) - 'ordinality' as fila from ${llamada} with ordinality r order by r.ordinality`,
    params,
  );
  return r.rows.map((x) => x.fila);
}

function paramsComunes(comercios: string[], f: Filtros): unknown[] {
  return [arregloUuid(comercios), f.desde ?? null, f.hasta ?? null, f.sucursal ?? null, f.cajero ?? null];
}

function resumen(comercios: string[], f: Filtros = {}): Promise<FilaResumen[]> {
  return filas('reporte_resumen($1::uuid[], $2::date, $3::date, $4::uuid, $5::uuid)', paramsComunes(comercios, f));
}

function porDia(comercios: string[], f: Filtros, agrupar: string | null): Promise<FilaPorDia[]> {
  return filas('reporte_por_dia($1::uuid[], $2::date, $3::date, $4::uuid, $5::uuid, $6::text)', [
    ...paramsComunes(comercios, f),
    agrupar,
  ]);
}

interface Pagina {
  orden?: string | null;
  desc?: boolean | null;
  limite?: number | null;
  offset?: number | null;
}

function clientes(comercios: string[], f: Filtros = {}, p: Pagina = {}): Promise<FilaClientes[]> {
  return filas(
    'reporte_clientes($1::uuid[], $2::date, $3::date, $4::uuid, $5::uuid, $6::text, $7::boolean, $8::integer, $9::integer)',
    [...paramsComunes(comercios, f), p.orden ?? null, p.desc ?? null, p.limite ?? null, p.offset ?? null],
  );
}

function cajeros(comercios: string[], f: Filtros = {}): Promise<FilaCajeros[]> {
  return filas('reporte_cajeros_alcance($1::uuid[], $2::date, $3::date, $4::uuid, $5::uuid)', paramsComunes(comercios, f));
}

function totalDe(filasResumen: FilaResumen[]): FilaResumen {
  const totales = filasResumen.filter((f) => f.es_total);
  if (totales.length !== 1) throw new Error(`[test] se esperaba UNA fila total y hay ${totales.length}`);
  return totales[0];
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. La migración en sí
// ═════════════════════════════════════════════════════════════════════════════

describe('la 0040 como se va a pegar en Studio', () => {
  // Punto 13 de la revisión de la 1a.
  it('la transacción entera llega al commit, con check_function_bodies activo y los roles del preámbulo', async () => {
    expect(errorCarga0040, 'error al cargar la 0040').toBeNull();
    expect(checkFunctionBodiesAlCargar, 'check_function_bodies al cargar').toBe('on');

    // Es UNA transacción: si algo falla en Studio, no queda nada a medias.
    const sentencias = leerMigracion(ARCHIVO_0040)
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.trim().startsWith('--'));
    expect(sentencias[0].trim(), 'primera sentencia').toBe('begin;');
    expect(sentencias[sentencias.length - 1].trim(), 'última sentencia').toBe('commit;');

    for (const [nombre, firma] of Object.entries(FIRMAS)) {
      const r = await una<{ existe: boolean; anon: boolean; authenticated: boolean; service_role: boolean }>(
        `select to_regprocedure($1) is not null as existe,
                has_function_privilege('anon', $1, 'execute') as anon,
                has_function_privilege('authenticated', $1, 'execute') as authenticated,
                has_function_privilege('service_role', $1, 'execute') as service_role`,
        [firma],
      );
      expect(r, `permisos de ${nombre}`).toEqual({ existe: true, anon: false, authenticated: false, service_role: true });
    }
    const indices = await una<{ tarjetas: string | null; canjes: string | null }>(
      `select to_regclass('public.tarjetas_comercio_idx')::text as tarjetas,
              to_regclass('public.canjes_tarjeta_fecha_idx')::text as canjes`,
    );
    expect(indices).toEqual({ tarjetas: 'tarjetas_comercio_idx', canjes: 'canjes_tarjeta_fecha_idx' });
  });

  // Punto 12 de la revisión de la 1a: los tipos de TS están escritos A MANO; si una columna cambia de
  // nombre o de lugar en la SQL, el compilador no se entera.
  it('argumentos y columnas de las cuatro coinciden, en nombre y orden, con lib/supabase/types.ts', async () => {
    const typesTs = readFileSync(path.join(process.cwd(), 'lib', 'supabase', 'types.ts'), 'utf8');
    function clavesTs(funcion: string, bloque: 'Args' | 'Returns'): string[] {
      const inicio = typesTs.indexOf(`      ${funcion}: {`);
      if (inicio < 0) throw new Error(`[test] ${funcion} no está en types.ts`);
      const abre = typesTs.indexOf(`${bloque}: {`, inicio);
      const cierra = typesTs.indexOf('}', abre + bloque.length + 3);
      return [...typesTs.slice(abre + bloque.length + 3, cierra).matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]);
    }
    async function columnasSql(firma: string, modo: 'i' | 't'): Promise<string[]> {
      const r = await db.query<{ nombre: string }>(
        `select u.nombre from pg_proc p
         cross join lateral unnest(p.proargnames, p.proargmodes) with ordinality as u(nombre, modo, orden)
         where p.oid = to_regprocedure($1) and u.modo = $2 order by u.orden`,
        [firma, modo],
      );
      return r.rows.map((x) => x.nombre);
    }
    for (const [nombre, firma] of Object.entries(FIRMAS)) {
      expect(await columnasSql(firma, 'i'), `Args de ${nombre}`).toEqual(clavesTs(nombre, 'Args'));
      expect(await columnasSql(firma, 't'), `Returns de ${nombre}`).toEqual(clavesTs(nombre, 'Returns'));
    }
    // Spec §5.4: "las columnas de reporte_cajeros más comercio_id".
    expect(await columnasSql(FIRMAS.reporte_cajeros_alcance, 't')).toEqual([
      'comercio_id',
      ...(await columnasSql('reporte_cajeros(uuid,date,date)', 't')),
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Bordes del período: el día LOCAL de cada comercio, dos zonas en el mismo alcance
// ═════════════════════════════════════════════════════════════════════════════

describe('bordes del período: 00:00 local inclusive, 00:00 del día siguiente exclusive, en la zona de CADA comercio', () => {
  const X = '2026-03-10';
  // Por comercio, un cliente por instante, con una visita y un premio en ESE instante. Cada visita pesa
  // distinto: la suma de puntos dice CUÁLES entraron, no solo cuántas (con dos zonas, un corte en la
  // zona equivocada puede dejar la misma CANTIDAD de filas y otras filas).
  const INSTANTES = [
    { clave: 'X-1 23:59', hora: `${sumarDias(X, -1)} 23:59`, peso: 1000 },
    { clave: 'X 00:00', hora: `${X} 00:00`, peso: 1 },
    { clave: 'X 23:59', hora: `${X} 23:59`, peso: 10 },
    { clave: 'X+1 00:00', hora: `${sumarDias(X, 1)} 00:00`, peso: 100 },
  ];
  let sv: Comercio;
  let bo: Comercio;
  const etiqueta = new Map<string, string>(); // cliente_id → 'SV X 00:00'

  beforeAll(async () => {
    sv = await crearComercio(SV);
    bo = await crearComercio(BO);
    for (const [corto, comercio] of [['SV', sv], ['BO', bo]] as const) {
      for (const i of INSTANTES) {
        const clienteId = await crearCliente(`${corto} ${i.clave}`);
        etiqueta.set(clienteId, `${corto} ${i.clave}`);
        const tarjetaId = await crearTarjeta(clienteId, comercio);
        await asiento(tarjetaId, { en: local(i.hora, comercio.zona), puntos: i.peso });
        await canje(tarjetaId, comercio, { en: local(i.hora, comercio.zona) });
      }
    }
  });

  it('reporte_resumen: cuenta 00:00 y 23:59 del día X, no 23:59 de X-1 ni 00:00 de X+1 — visitas y premios', async () => {
    for (const zona of ZONAS_DE_SESION) {
      await conZonaDeSesion(zona, async () => {
        const f = await resumen([sv.id, bo.id], { desde: X, hasta: X });
        for (const comercio of [sv, bo]) {
          const fila = f.find((x) => !x.es_total && x.comercio_id === comercio.id);
          const nombre = `${comercio.zona} (sesión ${zona})`;
          expect(fila?.puntos_otorgados, `${nombre} · puntos (1 = X 00:00, 10 = X 23:59)`).toBe(11);
          expect(fila?.operaciones, `${nombre} · visitas`).toBe(2);
          expect(fila?.canjes, `${nombre} · premios`).toBe(2);
          expect(fila?.clientes_unicos, `${nombre} · clientes`).toBe(2);
        }
        const total = totalDe(f);
        expect([total.operaciones, total.puntos_otorgados, total.canjes, total.clientes_unicos]).toEqual([4, 22, 4, 4]);
      });
    }
  });

  it('reporte_clientes: exactamente los clientes de 00:00 y 23:59 del día X en cada zona, con su visita y su premio', async () => {
    for (const zona of ZONAS_DE_SESION) {
      await conZonaDeSesion(zona, async () => {
        const f = await clientes([sv.id, bo.id], { desde: X, hasta: X });
        const vistas = Object.fromEntries(
          f.map((x) => [etiqueta.get(x.cliente_id), `${x.operaciones} visita, ${x.canjes} premio`]),
        );
        expect(vistas, `sesión ${zona}`).toEqual({
          'SV X 00:00': '1 visita, 1 premio',
          'SV X 23:59': '1 visita, 1 premio',
          'BO X 00:00': '1 visita, 1 premio',
          'BO X 23:59': '1 visita, 1 premio',
        });
      });
    }
  });

  it('reporte_cajeros_alcance: el grupo "Sin registrar" de cada comercio cuenta los mismos bordes', async () => {
    for (const zona of ZONAS_DE_SESION) {
      await conZonaDeSesion(zona, async () => {
        const f = await cajeros([sv.id, bo.id], { desde: X, hasta: X });
        for (const comercio of [sv, bo]) {
          const fila = f.find((x) => x.comercio_id === comercio.id && x.cajero_usuario_id === null);
          const nombre = `${comercio.zona} (sesión ${zona})`;
          expect(fila?.puntos_otorgados, `${nombre} · puntos`).toBe(11);
          expect(fila?.operaciones, `${nombre} · visitas`).toBe(2);
          expect(fila?.canjes, `${nombre} · premios`).toBe(2);
          expect(fila?.clientes_unicos, `${nombre} · clientes`).toBe(2);
        }
      });
    }
  });

  it('reporte_por_dia: cada fila en el día local de SU comercio', async () => {
    for (const zona of ZONAS_DE_SESION) {
      await conZonaDeSesion(zona, async () => {
        const unDia = await porDia([sv.id, bo.id], { desde: X, hasta: X }, 'dia');
        expect(
          unDia.map((x) => `${x.periodo}: ${x.operaciones} visitas, ${x.canjes} premios, es_mes ${x.es_mes}`),
          `día X solo (sesión ${zona})`,
        ).toEqual([`${X}: 4 visitas, 4 premios, es_mes false`]);
        const tres = await porDia([sv.id, bo.id], { desde: sumarDias(X, -1), hasta: sumarDias(X, 1) }, 'dia');
        expect(
          tres.map((x) => `${x.periodo}: ${x.operaciones} visitas, ${x.canjes} premios`),
          `X-1 a X+1 (sesión ${zona})`,
        ).toEqual([
          `${sumarDias(X, -1)}: 2 visitas, 2 premios`,
          `${X}: 4 visitas, 4 premios`,
          `${sumarDias(X, 1)}: 2 visitas, 2 premios`,
        ]);
      });
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Los cuatro filtros, en visitas Y en canjes (cada filtro está escrito dos veces)
// ═════════════════════════════════════════════════════════════════════════════

describe('filtros de alcance, sucursal y cajero, en visitas Y en premios', () => {
  const D = '2026-05-10';
  let A: Comercio;
  let B: Comercio;
  let S1: string;
  let S2: string;
  let C1: string;
  let C2: string;
  let C3: string;
  const etiqueta = new Map<string, string>();
  const email = new Map<string, string>();
  // Cada cliente: una visita (con peso propio) y un premio, en la MISMA sucursal y con el MISMO cajero.
  //   K1: A, S1, C1 (10)   K2: A, S2, C1 (20)   K4: A, S1, C2 (40)   K3: B, S3, C3 (80)
  const PESO: Record<string, number> = { K1: 10, K2: 20, K4: 40, K3: 80 };
  const CAJERO_DE: Record<string, string> = { K1: 'c1', K2: 'c1', K4: 'c2', K3: 'c3' };

  beforeAll(async () => {
    A = await crearComercio(SV);
    B = await crearComercio(BO);
    S1 = await crearSucursal(A, 'S1');
    S2 = await crearSucursal(A, 'S2');
    const S3 = await crearSucursal(B, 'S3');
    C1 = await crearCajero(A, 'c1');
    C2 = await crearCajero(A, 'c2');
    C3 = await crearCajero(B, 'c3');
    email.set(C1, 'c1').set(C2, 'c2').set(C3, 'c3');
    const plan: Array<[string, Comercio, string, string]> = [
      ['K1', A, S1, C1],
      ['K2', A, S2, C1],
      ['K4', A, S1, C2],
      ['K3', B, S3, C3],
    ];
    for (const [nombre, comercio, sucursal, cajero] of plan) {
      const clienteId = await crearCliente(nombre);
      etiqueta.set(clienteId, nombre);
      const tarjetaId = await crearTarjeta(clienteId, comercio);
      await asiento(tarjetaId, { en: local(`${D} 12:00`, comercio.zona), puntos: PESO[nombre], sucursal, cajero });
      await canje(tarjetaId, comercio, { en: local(`${D} 13:00`, comercio.zona), sucursal, cajero });
    }
  });

  // Qué clientes tienen que quedar con cada combinación (visita y premio van juntos en este escenario;
  // lo que se asierta por separado es que CADA rama los filtre).
  function casos() {
    return [
      { nombre: 'sin filtros, alcance [A]', comercios: [A.id], f: {}, quedan: ['K1', 'K2', 'K4'] },
      { nombre: 'alcance [A, B]', comercios: [A.id, B.id], f: {}, quedan: ['K1', 'K2', 'K4', 'K3'] },
      { nombre: 'sucursal S1', comercios: [A.id], f: { sucursal: S1 }, quedan: ['K1', 'K4'] },
      { nombre: 'cajero c1', comercios: [A.id], f: { cajero: C1 }, quedan: ['K1', 'K2'] },
      { nombre: 'sucursal S1 y cajero c1', comercios: [A.id], f: { sucursal: S1, cajero: C1 }, quedan: ['K1'] },
    ];
  }
  const periodo = () => ({ desde: D, hasta: D });

  it('reporte_resumen', async () => {
    for (const c of casos()) {
      const total = totalDe(await resumen(c.comercios, { ...periodo(), ...c.f }));
      expect(total.operaciones, `${c.nombre} · visitas`).toBe(c.quedan.length);
      expect(total.puntos_otorgados, `${c.nombre} · puntos`).toBe(c.quedan.reduce((s, k) => s + PESO[k], 0));
      expect(total.canjes, `${c.nombre} · premios`).toBe(c.quedan.length);
      expect(total.clientes_unicos, `${c.nombre} · clientes`).toBe(c.quedan.length);
    }
  });

  it('reporte_por_dia', async () => {
    for (const c of casos()) {
      const f = await porDia(c.comercios, { ...periodo(), ...c.f }, 'dia');
      expect(f.map((x) => x.periodo), `${c.nombre} · días`).toEqual([D]);
      expect(f[0].operaciones, `${c.nombre} · visitas`).toBe(c.quedan.length);
      expect(f[0].canjes, `${c.nombre} · premios`).toBe(c.quedan.length);
    }
  });

  it('reporte_clientes', async () => {
    for (const c of casos()) {
      const f = await clientes(c.comercios, { ...periodo(), ...c.f });
      const vistas = Object.fromEntries(
        f.map((x) => [etiqueta.get(x.cliente_id), `${x.operaciones} visita, ${x.canjes} premio`]),
      );
      expect(vistas, c.nombre).toEqual(Object.fromEntries(c.quedan.map((k) => [k, '1 visita, 1 premio'])));
    }
  });

  it('reporte_cajeros_alcance', async () => {
    for (const c of casos()) {
      const f = await cajeros(c.comercios, { ...periodo(), ...c.f });
      const esperado: Record<string, string> = {};
      for (const k of c.quedan) {
        const previo = esperado[CAJERO_DE[k]];
        const n = previo ? Number(previo.split(' ')[0]) + 1 : 1;
        esperado[CAJERO_DE[k]] = `${n} visitas, ${n} premios, ${n} clientes`;
      }
      const vistas = Object.fromEntries(
        f.map((x) => [
          email.get(x.cajero_usuario_id ?? '') ?? 'sin registrar',
          `${x.operaciones} visitas, ${x.canjes} premios, ${x.clientes_unicos} clientes`,
        ]),
      );
      expect(vistas, c.nombre).toEqual(esperado);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Las definiciones: visita, acumulado BRUTO, premio, cliente, y los ajustes
// ═════════════════════════════════════════════════════════════════════════════

describe('definiciones: visitas, acumulado bruto, premios, clientes y ajustes', () => {
  const D = '2026-04-20';
  let E: Comercio;
  let S1: string;
  let SA: string;
  let C1: string;
  let C2: string;
  const etiqueta = new Map<string, string>();
  const horaLocal = (hh: string) => local(`${D} ${hh}`, SV);

  // K1: acreditación +10 ($12.50), uso −4 ($5.00), renovación +7 y, al final del día, un AJUSTE +2
  //     (un ajuste no es visita ni mueve su última actividad);
  // K2: solo premios, dos (cuenta como cliente; y con 2 premios contra 1 forzada y 1 corrección, un
  //     cruce de columnas en el select de afuera no pasa desapercibido: en `language sql` las columnas
  //     se asignan por POSICIÓN y dos bigint cruzados compilan igual);
  // K3: solo un ajuste −5, en la sucursal SA donde no pasó nada más (no es cliente, SA no aparece);
  // K4: una acreditación FORZADA +3;
  // K5: una acreditación +1 sin cajero ("Sin registrar").
  beforeAll(async () => {
    E = await crearComercio(SV);
    S1 = await crearSucursal(E, 'Centro');
    SA = await crearSucursal(E, 'Solo ajustes');
    C1 = await crearCajero(E, 'c1');
    C2 = await crearCajero(E, 'c2');
    const t: Record<string, string> = {};
    for (const k of ['K1', 'K2', 'K3', 'K4', 'K5']) {
      const clienteId = await crearCliente(k);
      etiqueta.set(clienteId, k);
      t[k] = await crearTarjeta(clienteId, E);
    }
    const enS1 = { sucursal: S1, cajero: C1 };
    await asiento(t.K1, { ...enS1, en: horaLocal('08:00'), tipo: 'acreditacion', puntos: 10, monto: 12.5 });
    await asiento(t.K1, { ...enS1, en: horaLocal('09:00'), tipo: 'uso', puntos: -4, monto: 5 });
    await asiento(t.K1, { ...enS1, en: horaLocal('10:00'), tipo: 'renovacion', puntos: 7 });
    await asiento(t.K1, { ...enS1, en: horaLocal('18:00'), tipo: 'ajuste', puntos: 2 });
    await canje(t.K2, E, { ...enS1, en: horaLocal('11:00') });
    await canje(t.K2, E, { ...enS1, en: horaLocal('12:00') });
    await asiento(t.K3, { sucursal: SA, cajero: C2, en: horaLocal('13:00'), tipo: 'ajuste', puntos: -5 });
    await asiento(t.K4, { ...enS1, en: horaLocal('14:00'), puntos: 3, forzado: true });
    await asiento(t.K5, { sucursal: S1, cajero: null, en: horaLocal('15:00'), puntos: 1 });
  });

  it('reporte_resumen: visitas sin ajustes, acumulado bruto, quien solo canjeó es cliente, y una sucursal con solo ajustes no aparece', async () => {
    const f = await resumen([E.id], { desde: D, hasta: D });
    const total = totalDe(f);
    expect(total.operaciones, 'visitas: 3 de K1 (acreditación, uso, renovación) + K4 + K5; el ajuste no').toBe(5);
    expect(total.puntos_otorgados, 'acumulado BRUTO: 10 + 3 + 1, sin el uso −4 ni la renovación +7').toBe(14);
    expect(total.canjes, 'premios').toBe(2);
    expect(total.clientes_unicos, 'clientes: K1, K2 (solo premios), K4, K5 — K3 (solo ajuste) no').toBe(4);
    expect(
      f.filter((x) => !x.es_total).map((x) => `${x.sucursal_nombre}: ${x.operaciones} visitas`),
      'filas por sucursal (la de solo ajustes no aparece)',
    ).toEqual(['Centro: 5 visitas']);
  });

  it('reporte_clientes: un cliente con solo ajustes no tiene fila, un ajuste no mueve la última actividad y quien solo canjeó sí tiene fila', async () => {
    const f = await clientes([E.id], { desde: D, hasta: D });
    const vistas = Object.fromEntries(
      f.map((x) => [
        etiqueta.get(x.cliente_id),
        {
          visitas: x.operaciones,
          acumulado: x.puntos_otorgados,
          premios: x.canjes,
          ultima: new Date(x.ultima_actividad).toISOString(),
        },
      ]),
    );
    expect(vistas).toEqual({
      K1: { visitas: 3, acumulado: 10, premios: 0, ultima: horaLocal('10:00') },
      K2: { visitas: 0, acumulado: 0, premios: 2, ultima: horaLocal('12:00') },
      K4: { visitas: 1, acumulado: 3, premios: 0, ultima: horaLocal('14:00') },
      K5: { visitas: 1, acumulado: 1, premios: 0, ultima: horaLocal('15:00') },
    });
  });

  it('reporte_cajeros_alcance: los ajustes SÍ entran, como Correcciones, sin ser visitas ni hacer clientes', async () => {
    const f = await cajeros([E.id], { desde: D, hasta: D });
    const quien = (id: string | null) => (id === C1 ? 'c1' : id === C2 ? 'c2' : id === null ? 'sin registrar' : id);
    expect(
      f.map((x) => ({
        cajero: quien(x.cajero_usuario_id),
        email: x.cajero_email,
        activo: x.cajero_activo,
        visitas: x.operaciones,
        acumulado: x.puntos_otorgados,
        monto: x.monto_total,
        forzadas: x.forzadas,
        correcciones: x.ajustes,
        puntos_ajustados: x.puntos_ajustados,
        premios: x.canjes,
        clientes: x.clientes_unicos,
      })),
    ).toEqual([
      // Orden: forzadas + ajustes de mayor a menor, "Sin registrar" al final.
      { cajero: 'c1', email: 'c1', activo: true, visitas: 4, acumulado: 13, monto: 12.5, forzadas: 1, correcciones: 1, puntos_ajustados: 2, premios: 2, clientes: 3 },
      { cajero: 'c2', email: 'c2', activo: true, visitas: 0, acumulado: 0, monto: 0, forzadas: 0, correcciones: 1, puntos_ajustados: -5, premios: 0, clientes: 0 },
      { cajero: 'sin registrar', email: null, activo: null, visitas: 1, acumulado: 1, monto: 0, forzadas: 0, correcciones: 0, puntos_ajustados: 0, premios: 0, clientes: 1 },
    ]);
  });

  it('reporte_por_dia: el día cuenta visitas y premios, no ajustes', async () => {
    expect(await porDia([E.id], { desde: D, hasta: D }, 'dia')).toEqual([
      { periodo: D, operaciones: 5, canjes: 2, es_mes: false },
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. reporte_resumen: la fila total
// ═════════════════════════════════════════════════════════════════════════════

describe('reporte_resumen: la fila total', () => {
  // Punto 1 de la revisión de la 1a.
  it('con entrada vacía (sin comercios, o un comercio sin actividad) devuelve exactamente UNA fila: la total, con ids null y todo en 0', async () => {
    const vacio = await crearComercio(SV);
    const esperado = [
      {
        comercio_id: null, sucursal_id: null, sucursal_nombre: null, sucursal_activa: null,
        operaciones: 0, puntos_otorgados: 0, canjes: 0, clientes_unicos: 0, es_total: true,
      },
    ];
    expect(await resumen([]), 'p_comercios vacío').toEqual(esperado);
    expect(await resumen([vacio.id]), 'comercio sin actividad').toEqual(esperado);
    expect(await resumen([vacio.id], { desde: '2026-01-01', hasta: '2026-01-31' }), 'con período').toEqual(esperado);
  });

  // Punto 2 de la revisión de la 1a.
  it('la actividad "sin sucursal" es una fila propia: se distingue de la total SOLO por es_total', async () => {
    const R = await crearComercio(SV);
    const S1 = await crearSucursal(R, 'Centro');
    const t = await crearTarjeta(await crearCliente('Sin sucursal'), R);
    const en = local('2026-02-02 10:00', SV);
    await asiento(t, { en, puntos: 1, sucursal: null });
    await canje(t, R, { en, sucursal: null });
    await asiento(t, { en, puntos: 2, sucursal: S1 });

    const f = await resumen([R.id]);
    expect(f.filter((x) => x.es_total).length, 'cuántas filas tienen es_total').toBe(1);
    expect(
      f.map((x) => ({
        es_total: x.es_total, comercio: x.comercio_id, sucursal: x.sucursal_nombre, activa: x.sucursal_activa,
        visitas: x.operaciones, puntos: x.puntos_otorgados, premios: x.canjes,
      })),
    ).toEqual([
      { es_total: true, comercio: null, sucursal: null, activa: null, visitas: 2, puntos: 3, premios: 1 },
      { es_total: false, comercio: R.id, sucursal: 'Centro', activa: true, visitas: 1, puntos: 2, premios: 0 },
      { es_total: false, comercio: R.id, sucursal: null, activa: null, visitas: 1, puntos: 1, premios: 1 },
    ]);
  });

  // Punto 8 de la revisión de la 1a.
  it('clientes de la fila total = distintos del alcance entero, no la suma de las filas', async () => {
    const X1 = await crearComercio(SV);
    const X2 = await crearComercio(BO);
    const S1 = await crearSucursal(X1, 'S1');
    const S2 = await crearSucursal(X1, 'S2');
    const S3 = await crearSucursal(X2, 'S3');
    const en = '2026-02-03T18:00:00.000Z';
    // El mismo cliente con tarjeta en los dos comercios.
    const k = await crearCliente('Dos comercios');
    await asiento(await crearTarjeta(k, X1), { en, sucursal: S1 });
    await asiento(await crearTarjeta(k, X2), { en, sucursal: S3 });
    const soloK = await resumen([X1.id, X2.id]);
    expect(soloK.filter((x) => !x.es_total).map((x) => x.clientes_unicos), 'una fila por comercio').toEqual([1, 1]);
    expect(totalDe(soloK).clientes_unicos, 'mismo cliente en dos comercios').toBe(1);

    // Otro que fue a dos sucursales del mismo comercio.
    const tOtro = await crearTarjeta(await crearCliente('Dos sucursales'), X1);
    await asiento(tOtro, { en, sucursal: S1 });
    await asiento(tOtro, { en, sucursal: S2 });
    const f = await resumen([X1.id, X2.id]);
    expect(f.filter((x) => !x.es_total).reduce((s, x) => s + x.clientes_unicos, 0), 'suma de las filas').toBe(4);
    expect(totalDe(f).clientes_unicos, 'total del alcance').toBe(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. reporte_por_dia: el tramo, cero filas, y la agrupación
// ═════════════════════════════════════════════════════════════════════════════

describe('reporte_por_dia: tramo recortado, cero filas y agrupación', () => {
  const H = '2026-09-20';

  // Punto 9 de la revisión de la 1a.
  it('un ajuste viejo no estira la serie hacia atrás', async () => {
    const P = await crearComercio(SV);
    const t = await crearTarjeta(await crearCliente('Ajuste viejo'), P);
    await asiento(t, { en: local(`${sumarDias(H, -30)} 10:00`, SV), tipo: 'ajuste', puntos: 5 });
    await asiento(t, { en: local(`${sumarDias(H, -5)} 10:00`, SV) });
    const f = await porDia([P.id], { desde: null, hasta: H }, 'dia');
    expect(f.length, 'días de la serie (de H-5 a H)').toBe(6);
    expect(f[0]).toEqual({ periodo: sumarDias(H, -5), operaciones: 1, canjes: 0, es_mes: false });
  });

  it('un alcance activo ANTES del período pero no en él devuelve el período entero en cero', async () => {
    const P = await crearComercio(SV);
    await asiento(await crearTarjeta(await crearCliente('Activo antes'), P), { en: local(`${sumarDias(H, -100)} 10:00`, SV) });
    const f = await porDia([P.id], { desde: sumarDias(H, -10), hasta: sumarDias(H, -4) }, 'dia');
    expect(f).toEqual(
      Array.from({ length: 7 }, (_, i) => ({ periodo: sumarDias(H, -10 + i), operaciones: 0, canjes: 0, es_mes: false })),
    );
  });

  it('cero filas: nunca activo; primera actividad después de p_hasta; p_hasta null; p_desde > p_hasta', async () => {
    const nunca = await crearComercio(SV);
    expect(await porDia([nunca.id], { desde: null, hasta: H }, 'dia'), 'nunca activo, desde siempre').toEqual([]);
    expect(await porDia([nunca.id], { desde: sumarDias(H, -10), hasta: H }, 'auto'), 'nunca activo, con desde').toEqual([]);

    const despues = await crearComercio(SV);
    const t = await crearTarjeta(await crearCliente('Después'), despues);
    await asiento(t, { en: local(`${sumarDias(H, 3)} 10:00`, SV) });
    await canje(t, despues, { en: local(`${sumarDias(H, 3)} 11:00`, SV) });
    expect(await porDia([despues.id], { desde: null, hasta: H }, 'dia'), 'primera después de hasta').toEqual([]);
    expect(await porDia([despues.id], { desde: sumarDias(H, -10), hasta: H }, 'dia'), 'ídem con desde').toEqual([]);

    const activo = await crearComercio(SV);
    await asiento(await crearTarjeta(await crearCliente('Activo'), activo), { en: local(`${sumarDias(H, -5)} 10:00`, SV) });
    expect(await porDia([activo.id], { desde: null, hasta: null }, 'dia'), 'p_hasta null').toEqual([]);
    expect(await porDia([activo.id], { desde: sumarDias(H, -3), hasta: null }, 'dia'), 'p_hasta null con desde').toEqual([]);
    expect(await porDia([activo.id], { desde: H, hasta: sumarDias(H, -2) }, 'dia'), 'p_desde > p_hasta').toEqual([]);
  });

  it('con "Desde siempre" y un cajero o una sucursal, la serie arranca en la primera actividad de ESE filtro (visitas y premios)', async () => {
    const P = await crearComercio(SV);
    const S1 = await crearSucursal(P, 'S1');
    const S2 = await crearSucursal(P, 'S2');
    const C1 = await crearCajero(P, 'c1');
    const C2 = await crearCajero(P, 'c2');
    const t = await crearTarjeta(await crearCliente('Filtros del tramo'), P);
    // S1/c1 empezó mucho antes (premio en H-25, visita en H-20); S2/c2 recién en H-3.
    await canje(t, P, { en: local(`${sumarDias(H, -25)} 10:00`, SV), sucursal: S1, cajero: C1 });
    await asiento(t, { en: local(`${sumarDias(H, -20)} 10:00`, SV), sucursal: S1, cajero: C1 });
    await asiento(t, { en: local(`${sumarDias(H, -3)} 10:00`, SV), sucursal: S2, cajero: C2 });
    await canje(t, P, { en: local(`${sumarDias(H, -2)} 10:00`, SV), sucursal: S2, cajero: C2 });
    const esperado = [
      { periodo: sumarDias(H, -3), operaciones: 1, canjes: 0, es_mes: false },
      { periodo: sumarDias(H, -2), operaciones: 0, canjes: 1, es_mes: false },
      { periodo: sumarDias(H, -1), operaciones: 0, canjes: 0, es_mes: false },
      { periodo: H, operaciones: 0, canjes: 0, es_mes: false },
    ];
    expect(await porDia([P.id], { hasta: H, cajero: C2 }, 'dia'), 'cajero c2').toEqual(esperado);
    expect(await porDia([P.id], { hasta: H, sucursal: S2 }, 'dia'), 'sucursal S2').toEqual(esperado);
    expect((await porDia([P.id], { hasta: H }, 'dia')).length, 'sin filtros arranca en H-25').toBe(26);
  });

  // Punto 10 de la revisión de la 1a. "Hace N días" = el tramo recortado tiene N días contando los dos
  // bordes: primera actividad en H-61 → 62 días; en H-62 → 63.
  it('auto decide sobre el tramo RECORTADO: 62 días → por día, 63 → por mes; otro valor o null = auto', async () => {
    const de62 = await crearComercio(SV);
    await asiento(await crearTarjeta(await crearCliente('62'), de62), { en: local(`${sumarDias(H, -61)} 10:00`, SV) });
    const de63 = await crearComercio(SV);
    await asiento(await crearTarjeta(await crearCliente('63'), de63), { en: local(`${sumarDias(H, -62)} 10:00`, SV) });
    const periodo = { desde: sumarDias(H, -99), hasta: H }; // pide 100 días

    for (const agrupar of ['auto', 'xyz', null]) {
      const f62 = await porDia([de62.id], periodo, agrupar);
      expect(f62.length, `62 días con p_agrupar=${agrupar}: filas`).toBe(62);
      expect(f62.every((x) => !x.es_mes), `62 días con p_agrupar=${agrupar}: por día`).toBe(true);
      expect(f62[0].periodo).toBe(sumarDias(H, -61));

      const f63 = await porDia([de63.id], periodo, agrupar);
      expect(f63, `63 días con p_agrupar=${agrupar}: por mes`).toEqual([
        { periodo: '2026-07-01', operaciones: 1, canjes: 0, es_mes: true },
        { periodo: '2026-08-01', operaciones: 0, canjes: 0, es_mes: true },
        { periodo: '2026-09-01', operaciones: 0, canjes: 0, es_mes: true },
      ]);
    }
    // Explícitos: mandan sobre el largo.
    expect((await porDia([de63.id], periodo, 'dia')).every((x) => !x.es_mes), "63 días con 'dia'").toBe(true);
    expect((await porDia([de62.id], periodo, 'mes')).map((x) => x.periodo), "62 días con 'mes'").toEqual([
      '2026-07-01', '2026-08-01', '2026-09-01',
    ]);
  });

  // Punto 11 de la revisión de la 1a. En El Salvador (−6) y Bogotá (−5) la misma hora local es otro
  // instante: 00:30 de Bogotá el 1 de septiembre es 23:30 de El Salvador el 31 de agosto.
  it('por mes con dos zonas: 23:30 local del último día del mes cuenta en ESE mes, 00:30 del 1 en el siguiente, para cada comercio', async () => {
    const msv = await crearComercio(SV);
    const mbo = await crearComercio(BO);
    for (const comercio of [msv, mbo]) {
      const t = await crearTarjeta(await crearCliente(`Mes ${comercio.zona}`), comercio);
      for (const hora of ['2026-08-31 23:30', '2026-09-01 00:30']) {
        await asiento(t, { en: local(hora, comercio.zona) });
        await canje(t, comercio, { en: local(hora, comercio.zona) });
      }
    }
    for (const zona of ZONAS_DE_SESION) {
      await conZonaDeSesion(zona, async () => {
        const periodo = { desde: '2026-08-01', hasta: '2026-09-30' };
        expect(await porDia([msv.id, mbo.id], periodo, 'mes'), `por mes (sesión ${zona})`).toEqual([
          { periodo: '2026-08-01', operaciones: 2, canjes: 2, es_mes: true },
          { periodo: '2026-09-01', operaciones: 2, canjes: 2, es_mes: true },
        ]);
        const dias = await porDia([msv.id, mbo.id], { desde: '2026-08-31', hasta: '2026-09-01' }, 'dia');
        expect(dias, `por día (sesión ${zona})`).toEqual([
          { periodo: '2026-08-31', operaciones: 2, canjes: 2, es_mes: false },
          { periodo: '2026-09-01', operaciones: 2, canjes: 2, es_mes: false },
        ]);
      });
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. reporte_clientes: orden, desempate y paginación
// ═════════════════════════════════════════════════════════════════════════════

describe('reporte_clientes: orden, desempate y paginación', () => {
  // Seis filas (cliente, comercio) con los ids ELEGIDOS, para que el desempate se pueda escribir a
  // mano: clientes Carla(1) < Beto(2) < Ana(3) < Ana Zeta(4) < Ana Alfa(5); comercios A(1) < B(2).
  // Carla tiene tarjeta en A y en B con las MISMAS métricas (desempata comercio_id). Beto está en B y
  // Ana Zeta en A: con la métrica empatada, "cliente → comercio" y "comercio → cliente" dan otro orden.
  //
  //               visitas  acumulado  premios  última
  //   Carla@A        2        20         1       t4
  //   Carla@B        2        20         1       t4
  //   Beto@B         2        50         0       t1
  //   Ana@A          1         5         2       t3   (apellido null)
  //   AnaZeta@A      2        30         1       t5
  //   AnaAlfa@A      3         5         0       t2
  const ORDENES: Array<[string, boolean, string[]]> = [
    ['visitas', true, ['AnaAlfa@A', 'Carla@A', 'Carla@B', 'Beto@B', 'AnaZeta@A', 'Ana@A']],
    ['visitas', false, ['Ana@A', 'Carla@A', 'Carla@B', 'Beto@B', 'AnaZeta@A', 'AnaAlfa@A']],
    ['acumulado', true, ['Beto@B', 'AnaZeta@A', 'Carla@A', 'Carla@B', 'Ana@A', 'AnaAlfa@A']],
    ['acumulado', false, ['Ana@A', 'AnaAlfa@A', 'Carla@A', 'Carla@B', 'AnaZeta@A', 'Beto@B']],
    ['premios', true, ['Ana@A', 'Carla@A', 'Carla@B', 'AnaZeta@A', 'Beto@B', 'AnaAlfa@A']],
    ['premios', false, ['Beto@B', 'AnaAlfa@A', 'Carla@A', 'Carla@B', 'AnaZeta@A', 'Ana@A']],
    ['ultima', true, ['AnaZeta@A', 'Carla@A', 'Carla@B', 'Ana@A', 'AnaAlfa@A', 'Beto@B']],
    ['ultima', false, ['Beto@B', 'AnaAlfa@A', 'Ana@A', 'Carla@A', 'Carla@B', 'AnaZeta@A']],
    // Nombre, después apellido en la MISMA dirección con el null al final en las dos.
    ['nombre', false, ['AnaAlfa@A', 'AnaZeta@A', 'Ana@A', 'Beto@B', 'Carla@A', 'Carla@B']],
    ['nombre', true, ['Carla@A', 'Carla@B', 'Beto@B', 'AnaZeta@A', 'AnaAlfa@A', 'Ana@A']],
  ];
  const D = '2026-06-15';
  let A: Comercio;
  let B: Comercio;
  let masivo1001: Comercio;
  let masivo312: Comercio;
  const etiqueta = new Map<string, string>(); // `${cliente_id}|${comercio_id}` → 'Carla@A'
  const nombreDe = (x: FilaClientes) => etiqueta.get(`${x.cliente_id}|${x.comercio_id}`) ?? '?';

  beforeAll(async () => {
    const prefijo = randomBytes(4).toString('hex');
    A = await crearComercio(SV, idOrdenado(prefijo, 1, 1));
    B = await crearComercio(SV, idOrdenado(prefijo, 1, 2));
    const h = (hh: string) => local(`${D} ${hh}`, SV);
    const [t1, t2, t3, t4, t5] = ['09:00', '10:00', '11:00', '12:00', '13:00'].map(h);

    // Se insertan al revés del orden de los ids: así el orden físico no coincide con el desempate.
    const anaAlfa = await crearCliente('Ana', 'Alfa', idOrdenado(prefijo, 4, 5));
    const anaZeta = await crearCliente('Ana', 'Zeta', idOrdenado(prefijo, 4, 4));
    const ana = await crearCliente('Ana', null, idOrdenado(prefijo, 4, 3));
    const beto = await crearCliente('Beto', 'Alfa', idOrdenado(prefijo, 4, 2));
    const carla = await crearCliente('Carla', 'Mora', idOrdenado(prefijo, 4, 1));
    const tarjeta = async (clienteId: string, comercio: Comercio, nombre: string) => {
      etiqueta.set(`${clienteId}|${comercio.id}`, nombre);
      return crearTarjeta(clienteId, comercio);
    };

    const tAnaAlfa = await tarjeta(anaAlfa, A, 'AnaAlfa@A');
    await asiento(tAnaAlfa, { en: h('08:08'), puntos: 1 });
    await asiento(tAnaAlfa, { en: h('08:09'), puntos: 2 });
    await asiento(tAnaAlfa, { en: t2, puntos: 2 });

    const tAnaZeta = await tarjeta(anaZeta, A, 'AnaZeta@A');
    await asiento(tAnaZeta, { en: h('08:06'), puntos: 15 });
    await asiento(tAnaZeta, { en: h('08:07'), puntos: 15 });
    await canje(tAnaZeta, A, { en: t5 });

    const tAna = await tarjeta(ana, A, 'Ana@A');
    await asiento(tAna, { en: h('08:04'), puntos: 5 });
    await canje(tAna, A, { en: h('08:05') });
    await canje(tAna, A, { en: t3 });

    const tBeto = await tarjeta(beto, B, 'Beto@B');
    await asiento(tBeto, { en: h('08:03'), puntos: 25 });
    await asiento(tBeto, { en: t1, puntos: 25 });

    for (const [comercio, nombre] of [[B, 'Carla@B'], [A, 'Carla@A']] as const) {
      const tCarla = await tarjeta(carla, comercio, nombre);
      await asiento(tCarla, { en: h('08:01'), puntos: 10 });
      await asiento(tCarla, { en: h('08:02'), puntos: 10 });
      await canje(tCarla, comercio, { en: t4 });
    }

    masivo1001 = await crearComercio(SV);
    await clientesEnMasa(masivo1001, 1001, local(`${D} 10:00`, SV));
    masivo312 = await crearComercio(SV);
    await clientesEnMasa(masivo312, 312, local(`${D} 10:00`, SV));
  });

  // Punto 7 de la revisión de la 1a (y spec §3).
  it('ordena por cada columna en las dos direcciones, con el desempate de la spec', async () => {
    for (const [orden, desc, esperado] of ORDENES) {
      const f = await clientes([A.id, B.id], {}, { orden, desc });
      expect(f.map(nombreDe), `${orden} ${desc ? 'desc' : 'asc'}`).toEqual(esperado);
    }
  });

  // Con solo Carla@A/Carla@B empatadas, sacar comercio_id del desempate NO tiró ninguna prueba: el orden
  // de entrada al sort las dejó bien de casualidad. Acá TODO empata (mismo nombre, mismas métricas, mismo
  // instante), así que el orden es puramente el desempate, y un par (cliente, comercio) sin comercio_id
  // queda a merced del sort — que con 24 filas ya no es estable.
  it('con TODAS las columnas empatadas, el orden es cliente_id y después comercio_id, y ninguna página repite', async () => {
    const prefijo = randomBytes(4).toString('hex');
    const P = await crearComercio(SV, idOrdenado(prefijo, 1, 1));
    const Q = await crearComercio(SV, idOrdenado(prefijo, 1, 2));
    const en = local(`${D} 10:00`, SV);
    const esperado: string[] = [];
    const nombres = new Map<string, string>();
    for (let n = 12; n >= 1; n -= 1) {
      const k = await crearCliente('Igual', 'Empate', idOrdenado(prefijo, 4, n));
      // Q antes que P: el orden físico va al revés del desempate.
      for (const [comercio, sufijo] of [[Q, 'Q'], [P, 'P']] as const) {
        nombres.set(`${k}|${comercio.id}`, `k${n}@${sufijo}`);
        await asiento(await crearTarjeta(k, comercio), { en, puntos: 1 });
      }
    }
    for (let n = 1; n <= 12; n += 1) esperado.push(`k${n}@P`, `k${n}@Q`);
    const nombre = (x: FilaClientes) => nombres.get(`${x.cliente_id}|${x.comercio_id}`) ?? '?';

    for (const orden of ['visitas', 'acumulado', 'premios', 'ultima', 'nombre']) {
      for (const desc of [true, false]) {
        const f = await clientes([P.id, Q.id], {}, { orden, desc });
        expect(f.map(nombre), `${orden} ${desc ? 'desc' : 'asc'}`).toEqual(esperado);
        const vistos: string[] = [];
        for (let offset = 0; offset < 24; offset += 5) {
          vistos.push(...(await clientes([P.id, Q.id], {}, { orden, desc, limite: 5, offset })).map(nombre));
        }
        expect(vistos, `${orden} ${desc ? 'desc' : 'asc'} de a 5`).toEqual(esperado);
      }
    }
  });

  // En `language sql` las columnas de salida se asignan por POSICIÓN: cruzar apellido y teléfono en el
  // select de afuera compila igual (los dos son text).
  it('cada fila trae el nombre, el apellido y el teléfono de SU cliente', async () => {
    const f = await clientes([A.id, B.id]);
    const r = await db.query<{ id: string; nombre: string; apellido: string | null; telefono: string }>(
      'select id, nombre, apellido, telefono from clientes where id = any($1::uuid[])',
      [arregloUuid(f.map((x) => x.cliente_id))],
    );
    const enTabla = new Map(r.rows.map((x) => [x.id, x]));
    for (const x of f) {
      const c = enTabla.get(x.cliente_id);
      expect({ nombre: x.nombre, apellido: x.apellido, telefono: x.telefono }, nombreDe(x)).toEqual({
        nombre: c?.nombre, apellido: c?.apellido, telefono: c?.telefono,
      });
    }
    expect(f.find((x) => nombreDe(x) === 'Ana@A')?.apellido, 'Ana sin apellido').toBeNull();
  });

  it('paginar de a 4 y de a 2 da el mismo orden: ni repite ni saltea', async () => {
    for (const [orden, desc, esperado] of ORDENES) {
      for (const limite of [4, 2]) {
        const vistos: string[] = [];
        for (let offset = 0; offset < esperado.length; offset += limite) {
          const f = await clientes([A.id, B.id], {}, { orden, desc, limite, offset });
          vistos.push(...f.map(nombreDe));
        }
        expect(vistos, `${orden} ${desc ? 'desc' : 'asc'} de a ${limite}`).toEqual(esperado);
      }
    }
  });

  // Punto 6 de la revisión de la 1a.
  it('p_desc null toma la dirección inicial de la columna: nombre ascendente, el resto descendente', async () => {
    for (const orden of ['visitas', 'acumulado', 'premios', 'ultima', 'nombre']) {
      const inicial = ORDENES.find(([o, desc]) => o === orden && desc === (orden !== 'nombre'));
      const f = await clientes([A.id, B.id], {}, { orden, desc: null });
      expect(f.map(nombreDe), `${orden} con p_desc null`).toEqual(inicial?.[2]);
    }
  });

  it('p_orden fuera de la lista (o null) ordena por visitas', async () => {
    const [, , visitasDesc] = ORDENES[0];
    const [, , visitasAsc] = ORDENES[1];
    for (const orden of ['xyz', null, '', 'VISITAS', "nombre'; drop table clientes; --"]) {
      expect((await clientes([A.id, B.id], {}, { orden })).map(nombreDe), `p_orden=${orden}`).toEqual(visitasDesc);
      expect((await clientes([A.id, B.id], {}, { orden, desc: false })).map(nombreDe), `p_orden=${orden} asc`).toEqual(
        visitasAsc,
      );
    }
  });

  it('una persona con tarjeta en dos comercios es DOS filas, y sus dos tarjetas de un mismo comercio suman en UNA', async () => {
    const f = await clientes([A.id, B.id]);
    expect(f.filter((x) => nombreDe(x).startsWith('Carla@')).length).toBe(2);
    expect(f.every((x) => x.total === 6), 'total').toBe(true);

    const P = await crearComercio(SV);
    const k = await crearCliente('Dos programas');
    const segundo = await crearPrograma(P.id, false);
    await asiento(await crearTarjeta(k, P), { en: local(`${D} 10:00`, SV), puntos: 3 });
    await asiento(await crearTarjeta(k, P, segundo), { en: local(`${D} 11:00`, SV), puntos: 4 });
    const g = await clientes([P.id]);
    expect(g.map((x) => [x.operaciones, x.puntos_otorgados, new Date(x.ultima_actividad).toISOString()])).toEqual([
      [2, 7, local(`${D} 11:00`, SV)],
    ]);
  });

  // Punto 6 de la revisión de la 1a.
  it('p_limite se acota a [1, 1000] y null = 50; total y offset_efectivo son iguales en todas las filas', async () => {
    const casos: Array<[number | null, number]> = [[null, 50], [0, 1], [-3, 1], [1, 1], [1000, 1000], [5000, 1000]];
    for (const [limite, filasEsperadas] of casos) {
      const f = await clientes([masivo1001.id], {}, { limite, offset: 0 });
      expect(f.length, `p_limite=${limite}: filas`).toBe(filasEsperadas);
      expect(new Set(f.map((x) => `${x.total}/${x.offset_efectivo}`)), `p_limite=${limite}: total/offset`).toEqual(
        new Set(['1001/0']),
      );
    }
    // Con el tope, la "última página" de 5000 es la de 1000: empieza en 1000 y trae 1 fila.
    const ultima = await clientes([masivo1001.id], {}, { limite: 5000, offset: 999_999 });
    expect(ultima.map((x) => [x.total, x.offset_efectivo]), 'p_limite=5000, página 999').toEqual([[1001, 1000]]);
    // p_offset negativo o null = 0.
    for (const offset of [-7, null]) {
      const f = await clientes([masivo312.id], {}, { limite: 50, offset });
      expect([f.length, f[0].offset_efectivo], `p_offset=${offset}`).toEqual([50, 0]);
    }
  });

  // Punto 5 de la revisión de la 1a. (El "7 de a 3" del plan NO sirve: 6/3 es exacto y la división
  // numérica da lo mismo; 6 de a 4 sí.)
  it('una página más allá del final devuelve la ÚLTIMA, alineada a múltiplo del límite: 312 de a 50 → 300', async () => {
    const f = await clientes([masivo312.id], {}, { limite: 50, offset: 999 * 50 });
    expect(f.length, 'filas de la última página').toBe(12);
    expect(new Set(f.map((x) => `${x.total}/${x.offset_efectivo}`))).toEqual(new Set(['312/300']));
    // Y la página que empieza justo en el borde se respeta.
    const borde = await clientes([masivo312.id], {}, { limite: 50, offset: 300 });
    expect([borde.length, borde[0].offset_efectivo]).toEqual([12, 300]);

    const chico = await clientes([A.id, B.id], {}, { limite: 4, offset: 4 * 998 });
    expect(chico.map((x) => [x.total, x.offset_efectivo]), '6 de a 4, página 999').toEqual([[6, 4], [6, 4]]);
  });

  // Puntos 3 y 4 de la revisión de la 1a.
  it('total 0: cero filas y sin error, con p_limite 1 (offset 0 y 250) y con la página 5 de a 50', async () => {
    const vacio = await crearComercio(SV);
    const casos: Array<[number | null, number | null]> = [[1, 0], [1, 250], [50, 200], [null, null]];
    for (const [limite, offset] of casos) {
      expect(await clientes([vacio.id], {}, { limite, offset }), `p_limite=${limite}, p_offset=${offset}`).toEqual([]);
    }
  });
});

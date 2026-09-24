import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { NextRequest } from 'next/server';
import leerExcel, { readSheet } from 'read-excel-file/node';
import { createServiceClient } from '@/lib/supabase/server';
import { crearEntorno } from '@/test/fixtures/entornoComercio';
import {
  reporteResumen,
  reportePorDia,
  reporteClientes,
  reporteCajerosAlcance,
  type FiltrosRpcReportes,
} from '@/lib/reportes/reportes';
import { cargarContextoReportes } from '@/lib/reportes/contextoReportes';

// GET /comercio/reportes/exportar (plan 2026-09-23, Tarea 5, segunda mitad; spec §4).
//
// QUÉ SE MOCKEA Y QUÉ NO:
//   - el gate (verifyComercioOwner): necesita las cookies de una request real. Devuelve DOS comercios
//     del dueño; lo que se prueba no es el gate sino que la ruta solo lea lo que el gate le da.
//   - el cargador y los cuatro wrappers se ENVUELVEN (`vi.fn(real)`): por defecto corren los REALES
//     contra la base, con datos sembrados a fechas elegidas; cada prueba de error pisa UNA llamada
//     (`mockResolvedValueOnce`). Así el camino feliz pasa por todo lo de producción —el cargador que
//     lee el tipo del programa principal de programas_tarjeta, los wrappers por PostgREST, el armado y
//     la escritura reales— y las pruebas de error no tienen que romper la base para provocar un null.
//   - el .xlsx se lee con read-excel-file: lo que importa es lo que abre el dueño.
//
// Las fechas: rangos FIJOS en el pasado (enero a marzo de 2026), así nada depende del día en que se
// corre, salvo la prueba de "Desde siempre", que compara contra el `hasta` que dice el nombre del
// archivo.
//
// ROJO DE PARTIDA (2026-09-24, con la ruta como stub que respondía 501 "TODO Tarea 5b"): caen las 14
// de entonces, las del archivo con `expected 501 to be 200`, las de error con `expected 501 to be 500` y
// la del gate con `promise resolved "Response { status: 501, … }" instead of rejecting`.
//
// MUTATION-TESTING (re-corridas TODAS el 2026-09-24 sobre el código de la revisión —15 pruebas, el
// error entero en el log—, una por vez y restauradas; con el mensaje que se vio caer). En las del camino
// feliz lo primero que se asierta es que console.error quedó vacío: el mensaje que se ve es el motivo
// REAL por el que la ruta falló.
// - "Por día" pedido con 'auto': caen las 7 del archivo, por ejemplo "un comercio elegido…" con
//   `expected [ [ …(2) ] ] to deeply equal []` y en el log `Error { "message": "excelReportes: la hoja
//   Por día recibió filas agrupadas por mes" }`. Cae por la SQL, no solo por el argumento: los tramos
//   pasan de 62 días (del 05/01 al 31/03 son 86; "Desde siempre", del 05/01 a hoy) y la 0040 los agrupó
//   por mes. (Detrás, la aserción del argumento 'dia'.)
// - El error respondido como un Excel vacío (responderError devolviendo un .xlsx con status 200): caen
//   las 7 de error con `expected 200 to be 500`.
// - El gate DENTRO del try: cae "el gate que redirige…" con `promise resolved "Response { status: 500, …
//   }" instead of rejecting` (el catch se comió el NEXT_REDIRECT y lo volvió un 500).
// - El `?comercio=` crudo a las RPC (`comercioIds: parametros.comercio ? [parametros.comercio] : …`):
//   cae "un comercio AJENO…" con `expected [ [ …(2) ] ] to deeply equal []` y en el log `Error {
//   "message": "excelReportes: una fila es de un comercio fuera del alcance: <el id del ajeno>" }` (sus
//   filas llegaron al armado).
// - La sucursal y el cajero crudos a las RPC (`{ ...filtrosRpc(filtros), sucursalId: parametros.sucursal
//   ?? null, cajeroId: parametros.cajero ?? null }`): cae "una sucursal de OTRO comercio y un cajero
//   AJENO…" con `expected [ [ …(3) ] ] to deeply equal [ [ …(3) ] ]` (llegan los dos ids en vez de
//   null). Sin esa aserción de argumentos cae IGUAL, por el archivo, con `expected [ +0, +0, +0 ] to
//   deeply equal [ 3, 1, 2 ]`: el Excel en ceros bajo un Resumen que dice "Todas" y "Todos".
// - El nombre del comercio sin sanear: caen 3; "un comercio elegido…" con `expected 'attachment;
//   filename="reportes-Café E…' to be 'attachment; filename="reportes-caf-ex…'`, el de comillas y salto
//   de línea con `TypeError { "message": "Headers.append: \"…\" is an invalid header value." }` en el log
//   y el de ☕ con `Cannot convert argument to a ByteString because the character at index 31 has a
//   value of 9749 which is greater than 255.` (sin sanear, esos dos nombres ni siquiera llegan a una
//   cabecera: la ruta da 500).
// Extras:
// - El fail-soft viejo (una lectura en null reemplazada por ceros: fila total en 0 y listas vacías):
//   caen las 4 "… devuelve null …" con `expected 200 to be 500`.
// - El armado y la escritura fuera del alcance del catch (un `return (async () => {…})()` sin await):
//   cae "el ARMADO que lanza…" con `Error: excelReportes: la hoja Por día recibió filas agrupadas por
//   mes` (el GET rechaza en vez de responder 500).
// - `generado: new Date(0)`: cae "un comercio elegido…" con `expected 0 to be greater than or equal to
//   1790256900000`.
// - El `{ ok: false }` del cargador tragado (resolviendo con un contexto vacío): cae "el cargador
//   devuelve { ok: false }…" con `expected 200 to be 500`.
// - Solo el `message` en el log (`responderError(error instanceof Error ? error.message : …)`): caen 2,
//   "una lectura que LANZA…" con `expected 'se cortó la conexión' to be Error: se cortó la conexión` y
//   "el ARMADO que lanza…" con `expected 'excelReportes: la hoja Por día recibi…' to be an instance of
//   Error`.
// - Un cargador que leyera la columna LEGADA `comercios.tipo_tarjeta` en vez del programa principal
//   (inyectado por el mock de contextoReportes, que no se toca): cae "un comercio elegido…" con
//   `expected [ [ 2, 1750, 'sellos', 1 ], …(1) ] to deeply equal [ [ 2, 17.5, '$', 1 ], …(1) ]`. Con el
//   fixture de antes (el tipo igual en las dos tablas) esa MISMA mutación pasaba las 15: era la
//   prueba decorativa de CLAUDE.md.

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const { gate } = vi.hoisted(() => ({
  gate: {
    redirigir: false,
    authUserId: '',
    comercioId: '',
    comercios: [] as { comercioId: string; nombre: string }[],
  },
}));

vi.mock('@/lib/comercio/verifyComercioOwner', async () => {
  // El redirect() REAL de Next: lanza NEXT_REDIRECT, que es lo que la ruta no puede atrapar.
  const { redirect } = await import('next/navigation');
  return {
    verifyComercioOwner: async () => {
      if (gate.redirigir) redirect('/comercio/login?error=sin-permiso');
      const activo = gate.comercios.find((c) => c.comercioId === gate.comercioId);
      return {
        authUserId: gate.authUserId,
        comercioId: gate.comercioId,
        nombre: activo?.nombre ?? '',
        sucursalActiva: null,
        comercios: gate.comercios,
      };
    },
  };
});

vi.mock('@/lib/reportes/reportes', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/reportes/reportes')>();
  return {
    ...real,
    reporteResumen: vi.fn(real.reporteResumen),
    reportePorDia: vi.fn(real.reportePorDia),
    reporteClientes: vi.fn(real.reporteClientes),
    reporteCajerosAlcance: vi.fn(real.reporteCajerosAlcance),
  };
});

vi.mock('@/lib/reportes/contextoReportes', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/reportes/contextoReportes')>();
  return { ...real, cargarContextoReportes: vi.fn(real.cargarContextoReportes) };
});

// ─────────────────────────────────────────────────────────────────────────────
// El escenario, sembrado UNA vez
// ─────────────────────────────────────────────────────────────────────────────
//
// Café Excel (El Salvador, CASHBACK: el acumulado son centavos) y Spa Excel (Bogotá, puntos) son del
// dueño; Ajeno Excel NO (no está en el gate), y tiene actividad en el mismo período.
//
// El cashback del café está SOLO en su programa principal: la columna legada `comercios.tipo_tarjeta`
// se pisa con 'sellos' después de crearlo. crearComercio escribe el tipo en las dos tablas, y con las
// dos iguales el "$" de la hoja no distinguiría si el cargador lee el programa (lo que configura el
// dueño) o la columna vieja (CLAUDE.md, "un fixture que espeja una columna legada…").
//
// Para los ids ajenos en la URL: una sucursal del SPA (del dueño, pero de otro comercio que el elegido)
// y un cajero del comercio AJENO.
//
//   tarjeta   comercio  actividad (2026)
//   ta        café      visita 05/01 10:00 en S1/C1 (1250 ¢) · visita 20/03 12:00 en S1/C1 (500 ¢)
//                       · premio 20/03 12:30 en S1/C1
//   tb        café      visita 10/02 09:00 sin sucursal ni cajero (300 ¢)
//   tSpa      spa       visita 15/03 10:00 de Bogotá (el MISMO cliente que ta)
//   tAjeno    ajeno     dos visitas en febrero
//
// Del 01/01 al 31/03, el café: 3 visitas, 1 premio, 2 clientes. La primera actividad es el 05/01: el
// tramo de "Por día" va del 05/01 al 31/03, 86 días. Con p_agrupar = 'auto' la SQL agruparía POR MES
// (pasa de 62 días): es lo que hace que la mutación "Por día con 'auto'" caiga acá.

const supabase = createServiceClient();
const escenario = crearEntorno(supabase);
let cafe = '';
let spa = '';
let ajeno = '';
let s1 = '';
let c1 = '';
let sucursalDelSpa = '';
let cajeroDelAjeno = '';

const CAFE_NOMBRE = 'Café Excel';
const SPA_NOMBRE = 'Spa Excel';
const TRIMESTRE = 'periodo=rango&desde=2026-01-01&hasta=2026-03-31';
const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MENSAJE_500 = 'No se pudo generar el Excel. Probá de nuevo.';

beforeAll(async () => {
  cafe = await escenario.crearComercio({ nombre: CAFE_NOMBRE, tipo_tarjeta: 'cashback' }); // America/El_Salvador
  // La columna legada, DISTINTA del programa principal (ver arriba; mismo patrón que
  // lib/tarjetas/tiposFuncionales.test.ts).
  const { error: eLegado } = await supabase.from('comercios').update({ tipo_tarjeta: 'sellos' }).eq('id', cafe);
  if (eLegado) throw eLegado;
  spa = await escenario.crearComercio({ nombre: SPA_NOMBRE, zona_horaria: 'America/Bogota' });
  ajeno = await escenario.crearComercio({ nombre: 'Ajeno Excel' });
  s1 = await escenario.crearSucursal(cafe);
  c1 = await escenario.crearCajero(cafe);
  sucursalDelSpa = await escenario.crearSucursal(spa);
  cajeroDelAjeno = await escenario.crearCajero(ajeno);
  const premio = await escenario.crearRecompensa(cafe, 1);
  const ta = await escenario.crearTarjeta(cafe);
  const tb = await escenario.crearTarjeta(cafe);
  const tSpa = await escenario.crearTarjeta(spa, 0, { clienteId: ta.clienteId });
  const tAjeno = await escenario.crearTarjeta(ajeno);

  await escenario.sembrarActividad([
    { clase: 'visita', tarjetaId: ta.id, createdAt: '2026-01-05T10:00:00-06:00', sucursalId: s1, cajeroId: c1, puntos: 1250 },
    { clase: 'visita', tarjetaId: ta.id, createdAt: '2026-03-20T12:00:00-06:00', sucursalId: s1, cajeroId: c1, puntos: 500 },
    { clase: 'canje', tarjetaId: ta.id, createdAt: '2026-03-20T12:30:00-06:00', sucursalId: s1, cajeroId: c1, recompensaId: premio },
    { clase: 'visita', tarjetaId: tb.id, createdAt: '2026-02-10T09:00:00-06:00', puntos: 300 },
    { clase: 'visita', tarjetaId: tSpa.id, createdAt: '2026-03-15T10:00:00-05:00' },
    { clase: 'visita', tarjetaId: tAjeno.id, createdAt: '2026-02-01T10:00:00-06:00' },
    { clase: 'visita', tarjetaId: tAjeno.id, createdAt: '2026-02-02T10:00:00-06:00' },
  ]);
});

afterAll(async () => {
  await escenario.limpiar();
});

let errores: MockInstance<typeof console.error>;

beforeEach(() => {
  gate.redirigir = false;
  gate.authUserId = crypto.randomUUID();
  gate.comercioId = cafe;
  gate.comercios = [
    { comercioId: cafe, nombre: CAFE_NOMBRE },
    { comercioId: spa, nombre: SPA_NOMBRE },
  ];
  // mockReset vuelve a la implementación REAL (la de `vi.fn(real)`) y descarta los "Once" que una
  // prueba anterior no llegó a consumir.
  for (const falso of [reporteResumen, reportePorDia, reporteClientes, reporteCajerosAlcance, cargarContextoReportes]) {
    vi.mocked(falso).mockReset();
  }
  // Silenciado y ESPIADO: en el camino feliz tiene que quedar vacío (y si no, la prueba muestra por qué
  // falló la ruta); en los de error, tiene que decir qué pasó.
  errores = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errores.mockRestore();
});

// ─────────────────────────────────────────────────────────────────────────────
// Ayudas
// ─────────────────────────────────────────────────────────────────────────────

async function descargar(consulta: string) {
  const { GET } = await import('./route');
  return GET(new NextRequest(`http://localhost/comercio/reportes/exportar?${consulta}`));
}

async function libro(r: Response) {
  return Buffer.from(await r.arrayBuffer());
}

type Fila = unknown[];

// El valor de una fila del Resumen por su rótulo (columna A).
function resumen(filas: Fila[], rotulo: string): unknown {
  const fila = filas.find((f) => f[0] === rotulo);
  if (!fila) throw new Error(`el Resumen no tiene el rótulo ${rotulo}`);
  return fila[1];
}

// Una fecha LEÍDA del .xlsx, redondeada al segundo: read-excel-file devuelve algunas horas 1 ms antes
// (error de coma flotante del lector; ver excelReportes.test.ts).
function alSegundo(d: unknown): Date {
  if (!(d instanceof Date)) throw new Error(`no es un Date: ${String(d)}`);
  return new Date(Math.round(d.getTime() / 1000) * 1000);
}

const diaDe = (d: unknown) => alSegundo(d).toISOString().slice(0, 10);

// Los argumentos con que se llamó a un wrapper: los filtros de la RPC (2.º) y el 3.º (agrupar / modo).
function llamadas(falso: unknown): { filtros: FiltrosRpcReportes; extra: unknown }[] {
  return vi.mocked(falso as (...a: unknown[]) => unknown).mock.calls.map((c) => ({
    filtros: c[1] as FiltrosRpcReportes,
    extra: c[2],
  }));
}

// La respuesta de error: 500, TEXTO PLANO, el mensaje de la spec y nada de Excel.
async function esperarError(r: Response) {
  expect(r.status).toBe(500);
  expect(r.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
  expect(r.headers.get('Content-Disposition')).toBeNull();
  expect(r.headers.get('Cache-Control')).toBe('no-store');
  expect(await r.text()).toBe(MENSAJE_500);
}

// Lo que la ruta registró junto a su prefijo: el motivo (un texto) o lo que atrapó.
function errorRegistrado(): unknown {
  const llamada = errores.mock.calls.find((c) => c[0] === '[reportes] no se pudo generar el Excel:');
  if (!llamada) throw new Error('la ruta no registró el error con su prefijo');
  return llamada[1];
}

const hoyEn = (zona: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );

// ─────────────────────────────────────────────────────────────────────────────
// El camino feliz: el .xlsx real
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /comercio/reportes/exportar: el archivo', () => {
  it('un comercio elegido, del 01/01 al 31/03: cabeceras, las cinco hojas y "Por día" SIEMPRE por día', async () => {
    const antes = Date.now();
    const r = await descargar(`${TRIMESTRE}&comercio=${cafe}`);

    // Lo primero: si la ruta falló, acá se ve por qué (el console.error de la ruta o de un wrapper).
    expect(errores.mock.calls).toEqual([]);
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toBe(TIPO_XLSX);
    // Sin el attachment, el navegador intentaría abrirlo; el nombre lleva el comercio saneado y el
    // período.
    expect(r.headers.get('Content-Disposition')).toBe(
      'attachment; filename="reportes-caf-excel-2026-01-01_2026-03-31.xlsx"',
    );
    // Un Excel cacheado mostraría los números viejos la próxima vez.
    expect(r.headers.get('Cache-Control')).toBe('no-store');

    // Las lecturas: el alcance y el período RESUELTOS, "Por día" con 'dia' (nunca 'auto') y los
    // clientes TODOS (sin orden ni página).
    const esperados: FiltrosRpcReportes = {
      comercioIds: [cafe],
      desde: '2026-01-01',
      hasta: '2026-03-31',
      sucursalId: null,
      cajeroId: null,
    };
    expect(llamadas(reporteResumen)).toEqual([{ filtros: esperados, extra: undefined }]);
    expect(llamadas(reportePorDia)).toEqual([{ filtros: esperados, extra: 'dia' }]);
    expect(llamadas(reporteClientes)).toEqual([{ filtros: esperados, extra: { modo: 'todas' } }]);
    expect(llamadas(reporteCajerosAlcance)).toEqual([{ filtros: esperados, extra: undefined }]);

    const buffer = await libro(r);
    const hojas = await leerExcel(buffer, { trim: false });
    expect(hojas.map((h) => h.sheet)).toEqual(['Resumen', 'Clientes', 'Por día', 'Por sucursal', 'Cajeros']);

    // Resumen: los filtros en texto y los números de la fila total.
    const r0 = await readSheet(buffer, 'Resumen', { trim: false });
    expect(resumen(r0, 'Comercio')).toBe(CAFE_NOMBRE);
    expect(resumen(r0, 'Sucursal')).toBe('Todas');
    expect(resumen(r0, 'Cajero')).toBe('Todos');
    expect(resumen(r0, 'Período')).toBe('Personalizado: del 01/01/2026 al 31/03/2026');
    expect([resumen(r0, 'Visitas'), resumen(r0, 'Premios'), resumen(r0, 'Clientes')]).toEqual([3, 1, 2]);
    // "Generado" es AHORA, en el reloj de El Salvador (UTC−6, sin horario de verano): la celda guarda
    // los componentes locales como si fueran UTC, al MINUTO (fechaExcel no lleva segundos).
    const generado = alSegundo(resumen(r0, 'Generado')).getTime() + 6 * 3600_000;
    expect(generado).toBeGreaterThanOrEqual(Math.floor(antes / 60_000) * 60_000);
    expect(generado).toBeLessThanOrEqual(Date.now());

    // Clientes: sin columna Comercio (uno solo en el alcance); el acumulado del cashback en DÓLARES.
    // La premisa que hace valer el "$": el programa principal dice cashback y la columna legada del
    // comercio, sellos. Leyendo la columna vieja saldría 1750 "sellos".
    const { data: legado, error: eLegado } = await supabase.from('comercios').select('tipo_tarjeta').eq('id', cafe).single();
    expect(eLegado).toBeNull();
    expect(legado?.tipo_tarjeta).toBe('sellos');
    const { data: principal, error: ePrincipal } = await supabase
      .from('programas_tarjeta')
      .select('tipo_tarjeta')
      .eq('comercio_id', cafe)
      .eq('es_principal', true)
      .single();
    expect(ePrincipal).toBeNull();
    expect(principal?.tipo_tarjeta).toBe('cashback');
    const clientes = await readSheet(buffer, 'Clientes', { trim: false });
    expect(clientes[0]).toEqual([
      'Nombre',
      'Apellido',
      'Teléfono',
      'Visitas',
      'Acumulado',
      'Unidad',
      'Premios',
      'Última actividad',
    ]);
    expect(clientes.slice(1).map((f) => [f[3], f[4], f[5], f[6]])).toEqual([
      [2, 17.5, '$', 1],
      [1, 3, '$', 0],
    ]);
    expect(clientes[1][2]).toMatch(/^\+503\d+$/);

    // Por día: 86 días, del 05/01 (la primera actividad) al 31/03, de a UNO, con los días vacíos.
    const porDia = await readSheet(buffer, 'Por día', { trim: false });
    expect(porDia[0]).toEqual(['Día', 'Visitas', 'Premios']);
    const dias = porDia.slice(1);
    expect(dias).toHaveLength(86);
    expect(diaDe(dias[0][0])).toBe('2026-01-05');
    expect(diaDe(dias[dias.length - 1][0])).toBe('2026-03-31');
    expect(dias.filter((f) => f[1] !== 0 || f[2] !== 0).map((f) => [diaDe(f[0]), f[1], f[2]])).toEqual([
      ['2026-01-05', 1, 0],
      ['2026-02-10', 1, 0],
      ['2026-03-20', 1, 1],
    ]);

    const porSucursal = await readSheet(buffer, 'Por sucursal', { trim: false });
    expect(porSucursal[0]).toEqual(['Comercio', 'Sucursal', 'Visitas', 'Acumulado', 'Unidad', 'Premios', 'Clientes']);
    expect(porSucursal.slice(1)).toEqual([
      [CAFE_NOMBRE, 'Sucursal Prueba', 2, 17.5, '$', 1, 1],
      [CAFE_NOMBRE, 'Sin sucursal', 1, 3, '$', 0, 1],
    ]);

    const cajeros = await readSheet(buffer, 'Cajeros', { trim: false });
    expect(cajeros[0]).toEqual([
      'Comercio',
      'Cajero',
      'Visitas',
      'Acumulado',
      'Unidad',
      'Monto vendido',
      'Forzadas',
      'Correcciones',
      'Premios',
      'Clientes',
    ]);
    expect(cajeros.slice(1).map((f) => [f[1], f[2], f[8]])).toEqual([
      [expect.stringMatching(/^cajero-.+@ejemplo\.test$/), 2, 1],
      ['Sin registrar', 1, 0],
    ]);
  });

  it('un comercio AJENO en ?comercio= cae a "Todo": ni una fila suya, y el archivo se llama "todos"', async () => {
    const r = await descargar(`${TRIMESTRE}&comercio=${ajeno}`);

    expect(errores.mock.calls).toEqual([]);
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Disposition')).toBe(
      'attachment; filename="reportes-todos-2026-01-01_2026-03-31.xlsx"',
    );
    // Las cuatro lecturas, con los DOS comercios del dueño y nunca el ajeno.
    for (const falso of [reporteResumen, reportePorDia, reporteClientes, reporteCajerosAlcance]) {
      expect(llamadas(falso).map((l) => l.filtros.comercioIds)).toEqual([[cafe, spa]]);
    }

    const buffer = await libro(r);
    const r0 = await readSheet(buffer, 'Resumen', { trim: false });
    expect(resumen(r0, 'Comercio')).toBe(`Todos (${CAFE_NOMBRE}, ${SPA_NOMBRE})`);
    // 3 del café + 1 del spa (las 2 del ajeno NO); el cliente de ta y tSpa es uno solo.
    expect([resumen(r0, 'Visitas'), resumen(r0, 'Clientes')]).toEqual([4, 2]);

    // Con dos comercios en el alcance, Clientes lleva la columna Comercio.
    const clientes = await readSheet(buffer, 'Clientes', { trim: false });
    expect(clientes[0][0]).toBe('Comercio');
    expect(new Set(clientes.slice(1).map((f) => f[0]))).toEqual(new Set([CAFE_NOMBRE, SPA_NOMBRE]));
  });

  it('"Desde siempre" con actividad de enero: "desde-siempre" en el nombre y "Por día" día por día hasta hoy', async () => {
    const hoyAntes = hoyEn('America/El_Salvador');
    const r = await descargar('periodo=todo');
    const hoyDespues = hoyEn('America/El_Salvador');

    expect(errores.mock.calls).toEqual([]);
    expect(r.status).toBe(200);
    // Con "Todo", el día de hoy es el del comercio ACTIVO (el café, El Salvador).
    const nombre = r.headers.get('Content-Disposition') ?? '';
    const hasta = nombre.match(/^attachment; filename="reportes-todos-desde-siempre_(\d{4}-\d{2}-\d{2})\.xlsx"$/)?.[1];
    expect([hoyAntes, hoyDespues]).toContain(hasta);
    expect(llamadas(reportePorDia)).toEqual([
      { filtros: { comercioIds: [cafe, spa], desde: null, hasta, sucursalId: null, cajeroId: null }, extra: 'dia' },
    ]);

    // Más de 62 días (con 'auto' serían meses): del 05/01, la primera actividad, a hoy, sin saltos.
    const dias = (await readSheet(await libro(r), 'Por día', { trim: false })).slice(1).map((f) => diaDe(f[0]));
    expect(dias.length).toBeGreaterThan(62);
    expect(dias[0]).toBe('2026-01-05');
    expect(dias[dias.length - 1]).toBe(hasta);
    const saltos = dias.slice(1).filter((d, i) => Date.parse(d) - Date.parse(dias[i]) !== 86_400_000);
    expect(saltos).toEqual([]);
  });

  it('la sucursal y el cajero de la URL llegan RESUELTOS: a las lecturas y, con nombre y email, al Resumen', async () => {
    const r = await descargar(`${TRIMESTRE}&comercio=${cafe}&sucursal=${s1}&cajero=${c1}`);

    expect(errores.mock.calls).toEqual([]);
    expect(r.status).toBe(200);
    expect(llamadas(reporteCajerosAlcance).map((l) => [l.filtros.sucursalId, l.filtros.cajeroId])).toEqual([[s1, c1]]);
    const r0 = await readSheet(await libro(r), 'Resumen', { trim: false });
    expect(resumen(r0, 'Sucursal')).toBe('Sucursal Prueba');
    expect(resumen(r0, 'Cajero')).toMatch(/^cajero-.+@ejemplo\.test$/);
    // Solo lo de S1/C1: las dos visitas de ta y su premio.
    expect([resumen(r0, 'Visitas'), resumen(r0, 'Premios'), resumen(r0, 'Clientes')]).toEqual([2, 1, 1]);
  });

  it('una sucursal de OTRO comercio y un cajero AJENO se descartan: el archivo es el del café entero', async () => {
    // La sucursal es del spa (del dueño, pero no del comercio elegido) y el cajero, de un comercio que
    // no es suyo. Pasados crudos a las RPC no filtrarían nada ajeno (la SQL acota por p_comercios),
    // pero el archivo saldría en CEROS mientras el Resumen dice "Todas" y "Todos": un reporte falso.
    const r = await descargar(`${TRIMESTRE}&comercio=${cafe}&sucursal=${sucursalDelSpa}&cajero=${cajeroDelAjeno}`);

    expect(errores.mock.calls).toEqual([]);
    expect(r.status).toBe(200);
    for (const falso of [reporteResumen, reportePorDia, reporteClientes, reporteCajerosAlcance]) {
      expect(llamadas(falso).map((l) => [l.filtros.comercioIds, l.filtros.sucursalId, l.filtros.cajeroId])).toEqual([
        [[cafe], null, null],
      ]);
    }
    const r0 = await readSheet(await libro(r), 'Resumen', { trim: false });
    expect(resumen(r0, 'Comercio')).toBe(CAFE_NOMBRE);
    expect(resumen(r0, 'Sucursal')).toBe('Todas');
    expect(resumen(r0, 'Cajero')).toBe('Todos');
    // Las del café entero, como sin filtros: 3 visitas, 1 premio, 2 clientes.
    expect([resumen(r0, 'Visitas'), resumen(r0, 'Premios'), resumen(r0, 'Clientes')]).toEqual([3, 1, 2]);
  });

  it.each([
    // Comillas, barra y un salto de línea: sin sanear, parten la cabecera (o la vuelven inválida).
    ['Café "El Sol" / Centro\r\nX', 'reportes-caf-el-sol-centro-x-2026-01-01_2026-03-31.xlsx'],
    // Nada que sobreviva al saneo: el respaldo del CSV de clientes.
    ['☕ ☕', 'reportes-comercio-2026-01-01_2026-03-31.xlsx'],
  ])('el nombre del comercio (%j) va saneado en el nombre del archivo', async (nombreComercio, archivo) => {
    gate.comercios = [
      { comercioId: cafe, nombre: nombreComercio },
      { comercioId: spa, nombre: SPA_NOMBRE },
    ];
    const r = await descargar(`${TRIMESTRE}&comercio=${cafe}`);

    expect(errores.mock.calls).toEqual([]);
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Disposition')).toBe(`attachment; filename="${archivo}"`);
    // Adentro del archivo el nombre va tal cual: una celda no es una cabecera HTTP.
    const r0 = await readSheet(await libro(r), 'Resumen', { trim: false });
    expect(resumen(r0, 'Comercio')).toBe(nombreComercio);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Errores: NUNCA un Excel con ceros
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /comercio/reportes/exportar: los errores', () => {
  it.each([
    ['reporte_resumen', reporteResumen],
    ['reporte_por_dia', reportePorDia],
    ['reporte_clientes', reporteClientes],
    ['reporte_cajeros_alcance', reporteCajerosAlcance],
  ])('%s devuelve null → 500 en texto plano, no un Excel', async (nombre, falso) => {
    vi.mocked(falso as typeof reporteResumen).mockResolvedValueOnce(null);

    const r = await descargar(`${TRIMESTRE}&comercio=${cafe}`);

    await esperarError(r);
    expect(errores).toHaveBeenCalledWith('[reportes] no se pudo generar el Excel:', `falló la lectura de ${nombre}`);
  });

  it('el cargador devuelve { ok: false } → 500, y no se corre ninguna lectura', async () => {
    vi.mocked(cargarContextoReportes).mockResolvedValueOnce({
      ok: false,
      error: 'No se pudieron leer las sucursales del comercio.',
    });

    const r = await descargar(`${TRIMESTRE}&comercio=${cafe}&sucursal=${s1}`);

    await esperarError(r);
    expect(errores).toHaveBeenCalledWith(
      '[reportes] no se pudo generar el Excel:',
      'No se pudieron leer las sucursales del comercio.',
    );
    // Sin el contexto, la sucursal de la URL no se puede validar: resolver con listas vacías la
    // descartaría en silencio y el Excel saldría sin filtrar.
    for (const falso of [reporteResumen, reportePorDia, reporteClientes, reporteCajerosAlcance]) {
      expect(falso).not.toHaveBeenCalled();
    }
  });

  it('una lectura que LANZA → 500, con el error ENTERO en el log', async () => {
    const error = new Error('se cortó la conexión');
    vi.mocked(reporteCajerosAlcance).mockRejectedValueOnce(error);

    await esperarError(await descargar(`${TRIMESTRE}&comercio=${cafe}`));
    // El mismo objeto, con su stack; no solo el texto.
    expect(errorRegistrado()).toBe(error);
  });

  it('el ARMADO que lanza (filas por mes en "Por día") → 500, con el error y su stack en el log', async () => {
    // Un bug determinístico: "Probá de nuevo" no alcanza sin el log (nota de la revisión de la 5a), y
    // el stack dice en qué línea del armado está.
    vi.mocked(reportePorDia).mockResolvedValueOnce({
      filas: [{ periodo: '2026-01-01', operaciones: 3, canjes: 1, es_mes: true }],
      alcanzoTope: false,
    });

    await esperarError(await descargar(`${TRIMESTRE}&comercio=${cafe}`));
    const error = errorRegistrado();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('excelReportes: la hoja Por día recibió filas agrupadas por mes');
    expect((error as Error).stack).toMatch(/excelReportes\.ts:\d+/);
  });

  it('el gate que redirige NO se atrapa: el NEXT_REDIRECT sale de la ruta, y no se lee nada', async () => {
    gate.redirigir = true;

    await expect(descargar(`${TRIMESTRE}&comercio=${cafe}`)).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;[a-z]+;\/comercio\/login\?error=sin-permiso;307;$/),
    });
    expect(cargarContextoReportes).not.toHaveBeenCalled();
    expect(errores).not.toHaveBeenCalled();
  });
});

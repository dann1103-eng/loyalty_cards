import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import JSZip from 'jszip';
import leerExcel, { readSheet } from 'read-excel-file/node';
import { createServiceClient } from '@/lib/supabase/server';
import { crearEntorno } from '@/test/fixtures/entornoComercio';

// GET /comercio/clientes/exportar: el CSV de siempre y, con ?formato=xlsx, la misma lista en .xlsx
// (plan 2026-09-23, Tarea 6; spec §6). Contra la base REAL: la ruta lee con filasParaExportar, así que
// lo que llega al archivo es lo que vive el dueño (zona del comercio, visitas de reporte_clientes).
//
// El gate va mockeado como en cartel/descargar/route.test.ts: necesita las cookies de una request real,
// y lo que se prueba acá no es el gate sino lo que la ruta hace con su comercioId y su nombre.
//
// escribirXlsx se mockea SOLO para provocar una excepción (fallas.escribirXlsx); si no, es la real. Es
// la única forma de ver el catch de la ruta: con datos legítimos nada de lo que hay adentro lanza.
//
// MUTATION-TESTING (corridas el 2026-09-24 sobre el código en verde, con el mensaje que se vio caer):
// - Ignorar `formato` (siempre el CSV): caen 2, "?formato=xlsx…" con `expected 'text/csv;
//   charset=utf-8' to be 'application/vnd.openxmlformats-office…'` y "si armar el .xlsx LANZA…" con
//   `expected 200 to be 500`.
// - Un `formato` repetido tomado como el primero (`.get()`): cae "un formato desconocido o
//   REPETIDO…" con `?formato=xlsx&formato=xlsx: expected 'application/vnd.openxmlformats-office…' to
//   be 'text/csv; charset=utf-8'`.
// - El teléfono sin '@': cae "?formato=xlsx…" con `expected null to be '@'` (read-excel-file devuelve
//   el mismo texto con o sin "@": solo el zip lo ve), y la pura de lib/comercio/exportarClientes.test.ts.
// - "Cliente desde" en UTC: caen las dos descargas, el CSV con `expected '2026-03-11' to be
//   '2026-03-10'` y el .xlsx con `el día UTC y no el del comercio: expected [ 2026, 3, 11 ] to deeply
//   equal [ 2026, 3, 10 ]`.
// - Un archivo vacío en vez del 500 (`filasParaExportar(...) ?? []`): cae "si la lectura falla…" con
//   `expected 200 to be 500`.
// - El catch que relanza: cae "si armar el .xlsx LANZA…" con `Error: write-excel-file reventó
//   (simulado)`. El catch sin el mensaje en el log: la misma, con `expected "error" to be called with
//   arguments: [ …(2) ]`.
// - El saneo de antes en vez de etiquetaDeArchivo (la regex sin normalize('NFD'), corrida el
//   2026-09-24): caen 3, las del CSV, el .xlsx y el formato desconocido, con Expected
//   `attachment; filename="clientes-panaderia-la-pena.csv"` y Received
//   `attachment; filename="clientes-panader-a-la-pe-a.csv"` (y el .xlsx igual).

const { sesion, fallas } = vi.hoisted(() => ({
  sesion: { comercioId: '', nombre: '' },
  fallas: { escribirXlsx: null as Error | null },
}));
vi.mock('@/lib/comercio/verifyComercioOwner', () => ({
  verifyComercioOwner: async () => ({ comercioId: sesion.comercioId, nombre: sesion.nombre }),
}));
vi.mock('@/lib/reportes/excelReportes', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/reportes/excelReportes')>();
  return {
    ...real,
    escribirXlsx: async (...args: Parameters<typeof real.escribirXlsx>) => {
      if (fallas.escribirXlsx) throw fallas.escribirXlsx;
      return real.escribirXlsx(...args);
    },
  };
});

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

const ENCABEZADOS = [
  'Nombre',
  'Apellido',
  'Teléfono',
  'Tarjeta',
  'Saldo',
  'Visitas (todas sus tarjetas)',
  'Cliente desde',
];
const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Un comercio en Bogotá con UNA tarjeta nacida a las 23:30 del 10 de marzo (04:30 del 11 en UTC) y
// tres visitas. El gate queda apuntando a él, con un nombre con acento y ñ que se sanea a
// "panaderia-la-pena" (etiquetaDeArchivo; con el saneo de antes, "panader-a-la-pe-a").
async function armarComercio(): Promise<{ telefono: string }> {
  const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos', zona_horaria: 'America/Bogota' });
  const { id, clienteId } = await entorno.crearTarjeta(comercioId, 4, { createdAt: '2026-03-10T23:30:00-05:00' });
  await entorno.sembrarActividad(
    Array.from({ length: 3 }, () => ({ clase: 'visita' as const, tarjetaId: id, createdAt: '2026-03-20T12:00:00-05:00' })),
  );
  const { data, error } = await supabase.from('clientes').select('telefono').eq('id', clienteId).single();
  if (error) throw error;
  sesion.comercioId = comercioId;
  sesion.nombre = 'Panadería La Peña';
  return { telefono: data.telefono };
}

async function descargar(consulta: string) {
  const { GET } = await import('./route');
  return GET(new NextRequest(`http://localhost/comercio/clientes/exportar${consulta}`));
}

// El formato que Excel le aplica a una celda de la hoja Clientes (la única del archivo): su `s` → el
// xf de cellXfs → su numFmt. null = General. Mismo método que lib/reportes/excelReportes.test.ts: lo que
// importa es el formato de la CELDA, no "algún lugar de styles.xml".
async function abrirZip(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const leer = async (ruta: string) => {
    const archivo = zip.file(ruta);
    if (!archivo) throw new Error(`el zip no tiene ${ruta}`);
    return archivo.async('string');
  };
  const hoja = await leer('xl/worksheets/sheet1.xml');
  const estilos = await leer('xl/styles.xml');
  function formatoDeCelda(referencia: string): string | null {
    const elemento = hoja.match(new RegExp(`<c\\b[^>]*\\br="${referencia}"[^>]*>`))?.[0];
    if (!elemento) throw new Error(`no hay celda ${referencia}`);
    const indice = Number(elemento.match(/\bs="(\d+)"/)?.[1] ?? 0);
    const xfs = [...(estilos.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '').matchAll(/<xf\b[^>]*>/g)].map(
      (m) => m[0],
    );
    const numFmtId = xfs[indice]?.match(/\bnumFmtId="(\d+)"/)?.[1];
    if (numFmtId === undefined) return null;
    const numFmt = estilos.match(new RegExp(`<numFmt\\b[^>]*\\bnumFmtId="${numFmtId}"[^>]*/>`))?.[0];
    return numFmt?.match(/\bformatCode="([^"]*)"/)?.[1] ?? `integrado:${numFmtId}`;
  }
  return { hoja, formatoDeCelda };
}

beforeEach(() => {
  sesion.comercioId = '';
  sesion.nombre = '';
  fallas.escribirXlsx = null;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await entorno.limpiar();
});

describe('GET /comercio/clientes/exportar', () => {
  it('sin formato baja el CSV de siempre: BOM, CRLF, apóstrofo en el teléfono y el día LOCAL', async () => {
    const { telefono } = await armarComercio();

    const r = await descargar('');

    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(r.headers.get('Content-Disposition')).toBe('attachment; filename="clientes-panaderia-la-pena.csv"');
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    // Por BYTES y no con r.text(): la decodificación UTF-8 del Body se come el BOM, y la prueba no lo
    // vería faltar.
    const bytes = Buffer.from(await r.arrayBuffer());
    expect([...bytes.subarray(0, 3)], 'sin el BOM, Excel en Windows lee "José" como "JosÃ©"').toEqual([0xef, 0xbb, 0xbf]);
    const lineas = bytes.subarray(3).toString('utf8').split('\r\n');
    expect(lineas[0]).toBe(ENCABEZADOS.map((e) => `"${e}"`).join(','));
    expect(lineas).toHaveLength(2);
    // Ningún valor de esta fila trae comas ni comillas: partir por '","' da las siete celdas.
    const celdas = lineas[1].slice(1, -1).split('","');
    expect(celdas).toHaveLength(7);
    expect(celdas[0]).toBe('Cliente Prueba');
    expect(celdas[1]).toBe('');
    expect(celdas[2]).toBe(`'${telefono}`);
    expect(celdas[5]).toBe('3');
    // 23:30 del 10 en Bogotá: dice 10, no el 11 de UTC.
    expect(celdas[6]).toBe('2026-03-10');
  });

  it('?formato=xlsx baja la hoja "Clientes": Visitas como número, la fecha como fecha, el teléfono como texto', async () => {
    const { telefono } = await armarComercio();

    const r = await descargar('?formato=xlsx');

    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toBe(TIPO_XLSX);
    expect(r.headers.get('Content-Disposition')).toBe('attachment; filename="clientes-panaderia-la-pena.xlsx"');
    expect(r.headers.get('Cache-Control')).toBe('no-store');

    const buffer = Buffer.from(await r.arrayBuffer());
    expect((await leerExcel(buffer, { trim: false })).map((h) => h.sheet)).toEqual(['Clientes']);
    const hoja = await readSheet(buffer, 'Clientes', { trim: false });
    expect(hoja[0]).toEqual(ENCABEZADOS);
    expect(hoja).toHaveLength(2);
    const [nombre, apellido, tel, tarjeta, saldo, visitas, desde] = hoja[1];
    expect(nombre).toBe('Cliente Prueba');
    expect(apellido).toBeNull();
    // Vuelve como el MISMO texto, con su +: ni un número ni el apóstrofo del CSV.
    expect(tel).toBe(telefono);
    expect(typeof tarjeta).toBe('string');
    expect(typeof saldo).toBe('string');
    expect(visitas).toBe(3);
    if (!(desde instanceof Date)) throw new Error(`"Cliente desde" no volvió como fecha: ${String(desde)}`);
    expect(
      [desde.getUTCFullYear(), desde.getUTCMonth() + 1, desde.getUTCDate()],
      'el día UTC y no el del comercio',
    ).toEqual([2026, 3, 10]);

    // Lo que read-excel-file no devuelve: el formato de cada celda y la fila fija.
    const zip = await abrirZip(buffer);
    // C2 = Teléfono. Sin "@", read-excel-file devolvería el mismo texto: solo el zip lo ve.
    expect(zip.formatoDeCelda('C2')).toBe('@');
    // F2 = Visitas: número General, sin formato de texto que lo vuelva "número guardado como texto".
    expect(zip.formatoDeCelda('F2')).toBeNull();
    // G2 = Cliente desde.
    expect(zip.formatoDeCelda('G2')).toBe('dd/mm/yyyy');
    const panel = zip.hoja.match(/<pane\b[^>]*\/>/)?.[0] ?? '';
    expect(panel).toContain('state="frozen"');
    expect(panel).toContain('ySplit="1"');
    // Ni una fórmula en el archivo.
    expect(zip.hoja).not.toMatch(/<f[\s>]/);
  });

  it('un formato desconocido o REPETIDO cae al CSV, nunca da error', async () => {
    await armarComercio();
    // Mismo criterio que los filtros de Reportes (spec 2026-09-23 §1): un parámetro inválido o repetido
    // cae a su valor por defecto.
    for (const consulta of ['?formato=pdf', '?formato=xlsx&formato=xlsx', '?formato=XLSX']) {
      const r = await descargar(consulta);
      expect(r.status, consulta).toBe(200);
      expect(r.headers.get('Content-Type'), consulta).toBe('text/csv; charset=utf-8');
      expect(r.headers.get('Content-Disposition'), consulta).toBe('attachment; filename="clientes-panaderia-la-pena.csv"');
    }
  });

  it('si la lectura falla, 500 en texto plano en los DOS formatos: nunca un archivo vacío', async () => {
    // Un comercioId que no es uuid: la base rechaza las lecturas (22P02) por el camino real, sin mocks.
    sesion.comercioId = 'no-es-un-uuid';
    sesion.nombre = 'Tienda Prueba';
    vi.spyOn(console, 'error').mockImplementation(() => {});

    for (const consulta of ['', '?formato=xlsx']) {
      const r = await descargar(consulta);
      expect(r.status, consulta).toBe(500);
      expect(r.headers.get('Content-Type'), consulta).toBe('text/plain; charset=utf-8');
      // Sin Content-Disposition: con <a download>, el navegador marca la descarga como fallida en vez
      // de guardar un archivo con el texto del error adentro.
      expect(r.headers.get('Content-Disposition'), consulta).toBeNull();
      expect(await r.text(), consulta).toBe('No se pudo generar la exportación. Probá de nuevo.');
    }
  });

  it('si armar el .xlsx LANZA, 500 en texto plano y el mensaje queda en el log', async () => {
    await armarComercio();
    const errores = vi.spyOn(console, 'error').mockImplementation(() => {});
    fallas.escribirXlsx = new Error('write-excel-file reventó (simulado)');

    const r = await descargar('?formato=xlsx');

    expect(r.status).toBe(500);
    expect(r.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(await r.text()).toBe('No se pudo generar la exportación. Probá de nuevo.');
    // El mensaje, no solo "falló": es un bug determinístico y "Probá de nuevo" no alcanza sin el log.
    expect(errores).toHaveBeenCalledWith(
      '[exportar] no se pudo generar la exportación de clientes:',
      'write-excel-file reventó (simulado)',
    );
  });
});

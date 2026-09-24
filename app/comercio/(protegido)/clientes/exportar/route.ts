import type { NextRequest } from 'next/server';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { filasParaExportar, generarCsv, hojaClientesExcel, BOM_UTF8 } from '@/lib/comercio/exportarClientes';
import { escribirXlsx, TIPO_XLSX } from '@/lib/reportes/excelReportes';
import { etiquetaDeArchivo } from '@/lib/reportes/etiquetaArchivo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Descarga de la base de clientes del comercio: el CSV de siempre y, con `?formato=xlsx`, la misma
// lista como .xlsx (plan 2026-09-23, Tarea 6; spec §6). Las mismas filas y columnas en los dos
// (lib/comercio/exportarClientes.ts las define una sola vez).
//
// Es un Route Handler y no un Server Action porque lo que devuelve es un ARCHIVO: un Server Action
// tendría que serializar el contenido al cliente y armar el Blob ahí, mientras que acá el navegador
// descarga directo con el Content-Disposition.
//
// Gate de DUEÑO: el cajero no exporta la base de clientes del negocio. verifyComercioOwner() va
// FUERA de cualquier try/catch — redirect() funciona lanzando NEXT_REDIRECT y atraparlo desactiva
// el gate.
//
// NUNCA UN ARCHIVO QUE PAREZCA CIERTO Y NO LO SEA: si una lectura falla (las tarjetas, las visitas, la
// zona del comercio, los programas o los niveles de descuento: filasParaExportar da null) o algo LANZA
// al armar el archivo, 500 en texto plano. Con <a download>, el navegador marca la descarga como
// fallida; no le guarda al dueño un .xlsx vacío, un CSV con las visitas en 0 ni un saldo en otra unidad.

const ERROR_EXPORTACION = 'No se pudo generar la exportación. Probá de nuevo.';

// ?formato=xlsx → el .xlsx. Cualquier otra cosa (sin formato, uno desconocido o uno REPETIDO) → el CSV
// de siempre. Mismo criterio que los filtros de Reportes (spec 2026-09-23 §1): un parámetro inválido
// cae a su valor por defecto y nunca da error; y uno repetido es inválido, no "el primero".
function formatoPedido(parametros: URLSearchParams): 'csv' | 'xlsx' {
  const valores = parametros.getAll('formato');
  return valores.length === 1 && valores[0] === 'xlsx' ? 'xlsx' : 'csv';
}

function error500(): Response {
  return new Response(ERROR_EXPORTACION, {
    status: 500,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function GET(request: NextRequest) {
  const { comercioId, nombre } = await verifyComercioOwner();

  const formato = formatoPedido(request.nextUrl.searchParams);

  // El nombre del comercio va en el archivo pero saneado (etiquetaDeArchivo, el mismo del Excel de
  // Reportes): es texto que escribió el dueño y termina en una cabecera HTTP.
  const etiqueta = etiquetaDeArchivo(nombre);

  try {
    const supabase = createServiceClient();
    const filas = await filasParaExportar(supabase, comercioId);

    // filasParaExportar ya registró qué lectura falló.
    if (filas === null) return error500();

    if (formato === 'xlsx') {
      const xlsx = await escribirXlsx([hojaClientesExcel(filas)]);
      return new Response(new Uint8Array(xlsx), {
        headers: {
          'Content-Type': TIPO_XLSX,
          'Content-Disposition': `attachment; filename="clientes-${etiqueta}.xlsx"`,
          // Una exportación cacheada mostraría datos viejos la próxima vez que el dueño la pida.
          'Cache-Control': 'no-store',
        },
      });
    }

    return new Response(BOM_UTF8 + generarCsv(filas), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="clientes-${etiqueta}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    // Con datos legítimos nada de lo de adentro lanza (un instante ilegible, una celda que la librería
    // rechaza): si pasa, es un bug determinístico, y "Probá de nuevo" no alcanza sin el mensaje en el log.
    console.error(
      '[exportar] no se pudo generar la exportación de clientes:',
      e instanceof Error ? e.message : String(e),
    );
    return error500();
  }
}

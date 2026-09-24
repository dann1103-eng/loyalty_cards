import type { NextRequest } from 'next/server';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { leerParametrosReportes } from '@/lib/reportes/parametrosReportes';
import { cargarContextoReportes, type FiltrosReportesCargados } from '@/lib/reportes/contextoReportes';
import { resolverFiltrosReportes } from '@/lib/reportes/filtrosReportes';
import {
  filtrosRpc,
  reporteResumen,
  reportePorDia,
  reporteClientes,
  reporteCajerosAlcance,
} from '@/lib/reportes/reportes';
import { armarHojasExcelReportes, escribirXlsx } from '@/lib/reportes/excelReportes';

// write-excel-file escribe el zip con APIs de Node (Buffer): runtime de Node, no Edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// El Excel de Reportes (spec 2026-09-23 §4): los mismos filtros que la pantalla, en cinco hojas.
//
// Es un Route Handler y no un Server Action porque devuelve un ARCHIVO (mismo motivo que
// clientes/exportar/route.ts); la pantalla lo enlaza con un <a download> (urlExcelReportes), nunca con
// <Link>, cuyo prefetch correría esta ruta entera en cada vista.
//
// El flujo es el de la cabecera de lib/reportes/contextoReportes.ts, el MISMO que la página, para que
// el archivo filtre igual que lo que el dueño está viendo:
//   gate → leerParametrosReportes → cargarContextoReportes → resolverFiltrosReportes → filtrosRpc →
//   las cuatro lecturas → armarHojasExcelReportes → escribirXlsx.
// Los ids de la URL (input del cliente) se validan en resolverFiltrosReportes ANTES de leer nada: un
// comercio que no es del dueño cae a "Todo"; una sucursal o un cajero de otro comercio, a "todas" y
// "todos". A las RPC llega solo lo que devolvió filtrosRpc.
//
// NUNCA UN ARCHIVO CON CEROS POR UN ERROR. Cualquier cosa que falle —el cargador con { ok: false },
// una lectura con null, algo que lanza en las lecturas, el armado o la escritura— responde 500 en
// TEXTO PLANO: con <a download>, el navegador marca la descarga como fallida en vez de guardarle al
// dueño un .xlsx que parece cierto, o un JSON crudo. El log lleva el motivo: los throw del armado son
// bugs determinísticos, y "Probá de nuevo" sin el log no le sirve a nadie para arreglarlos.

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MENSAJE_ERROR = 'No se pudo generar el Excel. Probá de nuevo.';

export async function GET(request: NextRequest) {
  // Gate del dueño FUERA de cualquier try/catch: redirect() funciona LANZANDO NEXT_REDIRECT, y el catch
  // de abajo lo convertiría en un 500 —el gate dejaría de redirigir—.
  const sesion = await verifyComercioOwner();

  try {
    const parametros = leerParametrosReportes(request.nextUrl.searchParams);
    const supabase = createServiceClient();

    const cargado = await cargarContextoReportes(supabase, sesion, parametros);
    // Sin el contexto no se puede validar la sucursal ni el cajero de la URL: resolver con listas
    // vacías los descartaría EN SILENCIO y el Excel saldría sin filtrar como si lo estuviera.
    if (!cargado.ok) return responderError(cargado.error);

    const filtros = resolverFiltrosReportes(sesion.comercios, parametros, cargado.contexto, new Date());
    const rpc = filtrosRpc(filtros);

    const [resumen, porDia, clientes, cajeros] = await Promise.all([
      reporteResumen(supabase, rpc),
      // SIEMPRE 'dia', nunca 'auto': la hoja se llama "Por día", y con 'auto' un tramo de más de 62
      // días llegaría agrupado por mes (el armado lo rechaza, pero el archivo no saldría).
      reportePorDia(supabase, rpc, 'dia'),
      // TODOS los clientes, por visitas desc: el Excel no lleva orden, dirección ni página.
      reporteClientes(supabase, rpc, { modo: 'todas' }),
      // Ya viene en el orden antifraude (el wrapper lo restaura después de paginar).
      reporteCajerosAlcance(supabase, rpc),
    ]);
    // Los wrappers ya registraron el detalle de la base; acá, cuáles fallaron.
    if (resumen === null || porDia === null || clientes === null || cajeros === null) {
      const lecturas = {
        reporte_resumen: resumen,
        reporte_por_dia: porDia,
        reporte_clientes: clientes,
        reporte_cajeros_alcance: cajeros,
      };
      const fallidas = Object.entries(lecturas)
        .filter(([, lectura]) => lectura === null)
        .map(([funcion]) => funcion);
      return responderError(`falló la lectura de ${fallidas.join(', ')}`);
    }

    const hojas = armarHojasExcelReportes({ filtros, generado: new Date(), resumen, porDia, clientes, cajeros });
    const xlsx = await escribirXlsx(hojas);

    return new Response(new Uint8Array(xlsx), {
      headers: {
        'Content-Type': TIPO_XLSX,
        'Content-Disposition': `attachment; filename="${nombreArchivo(filtros)}"`,
        // Un Excel cacheado le mostraría al dueño los números viejos la próxima vez que lo pida.
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return responderError(error instanceof Error ? error.message : String(error));
  }
}

function responderError(motivo: string): Response {
  console.error('[reportes] no se pudo generar el Excel:', motivo);
  return new Response(MENSAJE_ERROR, {
    status: 500,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// reportes-<comercio o "todos">-<desde o "desde-siempre">_<hasta>.xlsx (spec §4). Las fechas vienen del
// resolver (AAAA-MM-DD validadas); el comercio es el de los filtros RESUELTOS, nunca el id de la URL.
function nombreArchivo(filtros: FiltrosReportesCargados): string {
  const comercio = filtros.comercio ? sanearNombre(filtros.comercio.nombre) : 'todos';
  return `reportes-${comercio}-${filtros.desde ?? 'desde-siempre'}_${filtros.hasta}.xlsx`;
}

// El nombre del comercio lo escribió el dueño y termina en una cabecera HTTP: comillas o un salto de
// línea partirían el Content-Disposition, y un carácter fuera de Latin-1 la vuelve inválida (500). Mismo
// saneo que el CSV de clientes (clientes/exportar/route.ts): solo letras ASCII y dígitos, con guiones.
function sanearNombre(nombre: string): string {
  return nombre.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'comercio';
}

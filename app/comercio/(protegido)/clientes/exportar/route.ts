import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { filasParaExportar, generarCsv, BOM_UTF8 } from '@/lib/comercio/exportarClientes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Descarga de la base de clientes del comercio en CSV.
//
// Es un Route Handler y no un Server Action porque lo que devuelve es un ARCHIVO: un Server Action
// tendría que serializar el contenido al cliente y armar el Blob ahí, mientras que acá el navegador
// descarga directo con el Content-Disposition.
//
// Gate de DUEÑO: el cajero no exporta la base de clientes del negocio. verifyComercioOwner() va
// FUERA de cualquier try/catch — redirect() funciona lanzando NEXT_REDIRECT y atraparlo desactiva
// el gate.
export async function GET() {
  const { comercioId, nombre } = await verifyComercioOwner();

  const supabase = createServiceClient();
  const filas = await filasParaExportar(supabase, comercioId);

  if (filas === null) {
    return new Response('No se pudo generar la exportación.', { status: 500 });
  }

  const csv = BOM_UTF8 + generarCsv(filas);

  // El nombre del comercio va en el archivo pero saneado: es texto que escribió el dueño y termina
  // en una cabecera HTTP. Sin esto, un nombre con comillas o salto de línea podría partir el header.
  const etiqueta = nombre.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'comercio';

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="clientes-${etiqueta}.csv"`,
      // Una exportación cacheada mostraría datos viejos la próxima vez que el dueño la pida.
      'Cache-Control': 'no-store',
    },
  });
}

// Ejecutar vía: npx tsx --conditions=react-server scripts/snapshot-reportes.ts > antes.json
// (y después de aplicar la migración: ... > despues.json; luego comparar los dos archivos)
//
// Volcado de SOLO LECTURA de las cuatro funciones de reporte, para probar que la migración 0015 no
// mueve ni un número. La 0015 les agrega `where tipo = 'acreditacion'`, y como TODA fila del
// histórico queda clasificada como 'acreditacion' por el default de la columna, el diff antes/después
// TIENE que ser vacío. Si no lo es, algo se rompió al reescribir las funciones a mano.
//
// OJO con dos fuentes de ruido que NO son la migración:
//   - reporte_tendencia depende de now(): si el "antes" y el "después" caen en días distintos, la
//     serie se corre un día. Tomá los dos snapshots el mismo día.
//   - Si alguien acredita o canjea en producción ENTRE los dos snapshots, el diff lo va a mostrar.
//     Tomalos con minutos de diferencia, idealmente fuera del horario de los locales.
import { config } from 'dotenv';
// `quiet: true` es obligatorio acá y no en los demás scripts: dotenv v17 imprime un banner
// ("injected env (13) from .env.local") en STDOUT, y este script redirige stdout a un .json.
// Sin esto, el archivo sale con una línea de basura adelante y deja de ser JSON válido.
config({ path: '.env.local', quiet: true });

import { createServiceClient } from '../lib/supabase/server';

async function main() {
  const supabase = createServiceClient();

  const { data: comercios, error: eCom } = await supabase
    .from('comercios')
    .select('id, nombre')
    .order('id');
  if (eCom || !comercios) {
    console.error('FALLO: no se pudieron listar los comercios —', eCom?.message);
    process.exit(1);
  }

  const salida: Record<string, unknown> = {};

  const { data: fm, error: eFm } = await supabase.rpc('reporte_fm_comercios');
  if (eFm) {
    console.error('FALLO: reporte_fm_comercios —', eFm.message);
    process.exit(1);
  }
  salida['fm_comercios'] = fm;

  for (const comercio of comercios) {
    const [sucursales, topClientes, tendencia] = await Promise.all([
      supabase.rpc('reporte_sucursales', { p_comercio_id: comercio.id }),
      supabase.rpc('reporte_top_clientes', { p_comercio_id: comercio.id, p_limite: 50 }),
      supabase.rpc('reporte_tendencia', { p_comercio_id: comercio.id, p_dias: 30 }),
    ]);

    for (const [etiqueta, res] of [
      ['sucursales', sucursales],
      ['top_clientes', topClientes],
      ['tendencia', tendencia],
    ] as const) {
      if (res.error) {
        console.error(`FALLO: reporte_${etiqueta} de ${comercio.nombre} —`, res.error.message);
        process.exit(1);
      }
    }

    salida[`${comercio.id}|${comercio.nombre}`] = {
      sucursales: sucursales.data,
      top_clientes: topClientes.data,
      tendencia: tendencia.data,
    };
  }

  // JSON indentado para que un diff de texto sea legible. El orden de las claves ya es estable: los
  // comercios se insertan ordenados por id y JSON.stringify respeta el orden de inserción.
  // (NO pasar un arreglo como segundo argumento: ahí es una lista de propiedades PERMITIDAS que se
  // aplica en todos los niveles, así que borraría los datos anidados.)
  console.log(JSON.stringify(salida, null, 2));
  process.exit(0);
}

main();

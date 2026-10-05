// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0041.ts
// Verificación de SOLO LECTURA de la migración 0041 (segundo ícono de sello y su patrón): las tres
// columnas existen en comercios y en programas_tarjeta, y nacieron en NULL en todas las filas.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

async function main() {
  const supabase = createServiceClient();
  let fallas = 0;
  for (const tabla of ['comercios', 'programas_tarjeta'] as const) {
    const columnas = await supabase.from(tabla).select('id, sello_icono_2_url, sello_patron, sello_casillas').limit(1);
    if (columnas.error) {
      console.error(
        columnas.error.code === '42703'
          ? `FALLO: la 0041 NO está aplicada en ${tabla} — ${columnas.error.message}`
          : `FALLO: no se pudo leer ${tabla} — ${columnas.error.message}`,
      );
      fallas += 1;
      continue;
    }
    console.log(`OK: ${tabla} tiene sello_icono_2_url, sello_patron y sello_casillas.`);
    const total = await supabase.from(tabla).select('id', { count: 'exact', head: true });
    const conDatos = await supabase
      .from(tabla)
      .select('id', { count: 'exact', head: true })
      .or('sello_icono_2_url.not.is.null,sello_patron.not.is.null,sello_casillas.not.is.null');
    if (total.error || conDatos.error) {
      console.error(`FALLO: no se pudo contar ${tabla}`);
      fallas += 1;
      continue;
    }
    console.log(`    ${total.count} filas, ${conDatos.count} con algún valor en las columnas nuevas.`);
  }
  process.exit(fallas ? 1 : 0);
}

main().catch((e) => {
  console.error('FALLO GENERAL:', e);
  process.exit(1);
});

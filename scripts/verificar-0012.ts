// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0012.ts
// Verificación de SOLO LECTURA de la migración 0012 (sucursal principal). No escribe nada.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

async function main() {
  const supabase = createServiceClient();

  const { error: eMuestra } = await supabase
    .from('sucursales')
    .select('id, es_principal')
    .limit(1);
  if (eMuestra) {
    console.error('FALLO: no se pudo consultar es_principal (¿migración aplicada?):', eMuestra.message);
    process.exit(1);
  }
  console.log('OK: la columna es_principal existe y es consultable.');

  const { data: comercios, error: eComercios } = await supabase.from('comercios').select('id, nombre');
  const { data: sucursales, error: eSucursales } = await supabase
    .from('sucursales')
    .select('comercio_id, activa, es_principal');
  if (eComercios || !comercios || eSucursales || !sucursales) {
    console.error('FALLO: no se pudieron listar comercios/sucursales:', eComercios?.message ?? eSucursales?.message);
    process.exit(1);
  }

  let problemas = 0;
  for (const c of comercios) {
    const principales = sucursales.filter((s) => s.comercio_id === c.id && s.es_principal);
    if (principales.length !== 1) {
      console.error(`PROBLEMA: "${c.nombre}" tiene ${principales.length} sucursales principales (esperado: 1).`);
      problemas++;
    } else if (!principales[0].activa) {
      console.error(`PROBLEMA: la principal de "${c.nombre}" está inactiva.`);
      problemas++;
    }
  }
  if (problemas > 0) process.exit(1);
  console.log(`OK: ${comercios.length} comercio(s), cada uno con exactamente 1 principal activa.`);
}

main();

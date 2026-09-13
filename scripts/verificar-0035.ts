// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0035.ts
// Solo lectura: llama a la función con la llave de servicio y con la anónima, no escribe nada.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { createServiceClient } from '../lib/supabase/server';

let fallas = 0;
const ok = (m: string) => console.log(`OK: ${m}`);
const fallo = (m: string, d?: string) => {
  console.error(`FALLO: ${m}${d ? ` — ${d}` : ''}`);
  fallas += 1;
};

async function main() {
  const supabase = createServiceClient();

  // 1. La función responde con la llave de servicio y ya no trae la columna.
  const fm = await supabase.rpc('reporte_fm_comercios');
  if (fm.error) {
    fallo('reporte_fm_comercios falló con service_role (¿se perdió el grant?)', fm.error.message);
  } else {
    const fila = fm.data?.[0] as Record<string, unknown> | undefined;
    if (!fila) {
      // Falla y no aviso: sin filas no se miró ninguna columna, y "verificada" sería mentira.
      fallo('reporte_fm_comercios no devolvió filas; no se pudieron mirar las columnas');
    } else {
      if ('saldo_circulante' in fila) fallo('reporte_fm_comercios TODAVÍA devuelve saldo_circulante (¿no se aplicó la 0035?)');
      else ok('reporte_fm_comercios ya no devuelve saldo_circulante.');
      const esperadas = ['comercio_id', 'comercio_nombre', 'cuenta_id', 'cuenta_nombre', 'clientes', 'operaciones', 'canjes'];
      const faltan = esperadas.filter((c) => !(c in fila));
      if (faltan.length > 0) fallo('a reporte_fm_comercios le faltan columnas', faltan.join(', '));
      else ok('y conserva las siete columnas que lee la pantalla de FM.');
    }
  }

  // 2. LO QUE DE VERDAD IMPORTA: el `drop` borró el ACL. Sin los `revoke`, esta función —sin
  // parámetros y con datos de TODOS los comercios— sería invocable con la llave anónima, que viaja
  // en el bundle del navegador.
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  // Se aserta el error EXACTO: una llave inválida, un fallo de red o un "permission denied for table"
  // también son errores, y ninguno prueba que el `revoke` de la FUNCIÓN esté puesto.
  const intento = await anon.rpc('reporte_fm_comercios');
  if (!intento.error) {
    fallo('la llave ANÓNIMA puede ejecutar reporte_fm_comercios: faltan los revoke', `${intento.data?.length ?? 0} filas`);
  } else if (
    intento.error.code === '42501' &&
    intento.error.message.includes('permission denied for function reporte_fm_comercios')
  ) {
    ok('la llave anónima NO puede ejecutarla (42501, permission denied for function).');
  } else {
    fallo('la llave anónima falló por OTRO motivo; el revoke no quedó comprobado', `${intento.error.code}: ${intento.error.message}`);
  }

  if (fallas > 0) {
    console.error(`\n${fallas} verificación(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nMigración 0035 verificada.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

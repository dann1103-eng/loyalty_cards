// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0039.ts
// Verificación de la migración 0039 (monto mínimo de compra y reseña de Google). SOLO LECTURA: a
// diferencia de verificar-0038.ts, este script no inserta ni borra filas — se limita a leer las
// cuatro columnas nuevas de comercios y a contar cuántas filas se apartan de los defaults
// esperados (exigir_monto_compra/pedir_resena_google en false, monto_minimo_compra_centavos/
// resena_google_url en null), que es lo que deberían tener TODAS las filas justo después de aplicar
// la migración (nadie escribió estas columnas todavía).
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

async function main() {
  const supabase = createServiceClient();

  const { data: filas, error } = await supabase
    .from('comercios')
    .select('id, exigir_monto_compra, monto_minimo_compra_centavos, pedir_resena_google, resena_google_url');

  if (error) {
    console.error('FALLO: la migración 0039 NO está aplicada (o PostgREST todavía no la ve).');
    console.error(`Detalle: ${error.message}`);
    process.exit(1);
  }

  const comercios = filas ?? [];
  const total = comercios.length;
  const conExigirTrue = comercios.filter((c) => c.exigir_monto_compra === true).length;
  const conMinimoNoNulo = comercios.filter((c) => c.monto_minimo_compra_centavos !== null).length;
  const conPedirResenaTrue = comercios.filter((c) => c.pedir_resena_google === true).length;
  const conUrlNoNula = comercios.filter((c) => c.resena_google_url !== null).length;

  console.log('OK: la migración 0039 está aplicada — comercios tiene las cuatro columnas nuevas.');
  console.log(`Total de comercios: ${total}`);
  console.log(`  exigir_monto_compra = true: ${conExigirTrue}`);
  console.log(`  monto_minimo_compra_centavos != null: ${conMinimoNoNulo}`);
  console.log(`  pedir_resena_google = true: ${conPedirResenaTrue}`);
  console.log(`  resena_google_url != null: ${conUrlNoNula}`);
  console.log(
    '\nEsperado justo después de aplicar la migración: las cuatro cuentas en 0 (nadie escribió' +
      ' estas columnas todavía). Un número mayor a 0 más adelante es normal una vez que el código' +
      ' de las tareas 4-8 empiece a guardarlas.',
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

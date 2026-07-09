import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

const TABLAS = [
  'comercios', 'usuarios_comercio', 'clientes', 'tarjetas',
  'reglas_puntos', 'recompensas', 'transacciones_puntos', 'canjes',
  'apple_push_registrations',
];

async function main() {
  const supabase = createServiceClient();
  for (const tabla of TABLAS) {
    const { error } = await supabase.from(tabla).select('id').limit(1);
    if (error) throw new Error(`Tabla '${tabla}' falló: ${error.message}`);
    console.log(`OK: ${tabla}`);
  }
}

main();

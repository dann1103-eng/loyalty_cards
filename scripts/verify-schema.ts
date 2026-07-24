// Ejecutar vía: npm run verify-schema
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

// `as const`: el cliente tipado de Supabase solo acepta nombres de tabla literales en .from().
const TABLAS = [
  'comercios', 'usuarios_comercio', 'clientes', 'tarjetas',
  'reglas_puntos', 'recompensas', 'transacciones_puntos', 'canjes',
  'apple_push_registrations', 'usuarios_fm', 'intentos_consulta_portal',
  'cuentas_comercio', 'sucursales',
] as const;

async function main() {
  const supabase = createServiceClient();
  for (const tabla of TABLAS) {
    const { error } = await supabase.from(tabla).select('id').limit(1);
    if (error) throw new Error(`Tabla '${tabla}' falló: ${error.message}`);
    console.log(`OK: ${tabla}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

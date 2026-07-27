// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0014.ts
// Verificación de SOLO LECTURA de la migración 0014 (prospectos). No escribe nada.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

async function main() {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from('prospectos')
    .select('id, nombre, negocio, correo, telefono, mensaje, origen, atendido, created_at')
    .limit(1);
  if (error) {
    console.error('FALLO: no se pudo consultar prospectos —', error.message);
    console.error('¿Se corrió la migración 0014?');
    process.exit(1);
  }
  console.log('OK: la tabla prospectos existe con sus nueve columnas.');

  // RLS activa es lo que impide que cualquiera con la llave pública LEA los datos de contacto de
  // todos los prospectos. Se comprueba con un cliente ANÓNIMO: el de servicio la saltea por diseño,
  // así que verificar con él no probaría nada.
  const { createClient } = await import('@supabase/supabase-js');
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data: filas, error: eAnon } = await anon.from('prospectos').select('id').limit(1);

  if (!eAnon && filas && filas.length > 0) {
    console.error('PROBLEMA GRAVE: la llave pública puede LEER prospectos. Falta la política RLS.');
    process.exit(1);
  }
  console.log('OK: la llave pública no puede leer prospectos (deny-all, como el resto del esquema).');
  process.exit(0);
}

main();

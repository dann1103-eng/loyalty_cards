// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0013.ts
// Verificación de SOLO LECTURA de la migración 0013 (reverso configurable de la tarjeta).
// No escribe nada.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

const COLUMNAS = [
  'terminos_uso',
  'red_instagram',
  'red_facebook',
  'red_whatsapp',
  'sitio_web',
  'mostrar_como_funciona',
] as const;

async function main() {
  const supabase = createServiceClient();

  // Una consulta por columna: si falta una sola, el mensaje dice CUÁL, en vez de un fallo genérico
  // que obligaría a adivinar cuál de las seis quedó afuera.
  let faltantes = 0;
  for (const columna of COLUMNAS) {
    const { error } = await supabase.from('comercios').select(columna).limit(1);
    if (error) {
      console.error(`FALLO: no se pudo consultar "${columna}" — ${error.message}`);
      faltantes++;
    }
  }
  if (faltantes > 0) {
    console.error(`\n${faltantes} de ${COLUMNAS.length} columnas no existen. ¿Se corrió la migración 0013?`);
    process.exit(1);
  }
  console.log(`OK: las ${COLUMNAS.length} columnas del reverso existen y son consultables.`);

  // El default de mostrar_como_funciona es la razón por la que los comercios que YA existían quedan
  // con la sección automática encendida. Si el default no quedó aplicado, esos comercios saldrían
  // con el reverso a medias y nadie se enteraría hasta ver una tarjeta real.
  const { data, error } = await supabase
    .from('comercios')
    .select('nombre, mostrar_como_funciona, terminos_uso');
  if (error || !data) {
    console.error('FALLO: no se pudieron listar los comercios:', error?.message);
    process.exit(1);
  }

  const sinDefault = data.filter((c) => c.mostrar_como_funciona !== true);
  if (sinDefault.length > 0) {
    console.error(`PROBLEMA: ${sinDefault.length} comercio(s) quedaron con mostrar_como_funciona en false:`);
    for (const c of sinDefault) console.error(`  - ${c.nombre}`);
    process.exit(1);
  }
  console.log(`OK: los ${data.length} comercios existentes quedaron con la sección automática encendida.`);
  console.log(`OK: ${data.filter((c) => c.terminos_uso === null).length} comercio(s) con términos en null (esperado: todos, nadie configuró nada todavía).`);

  process.exit(0);
}

main();

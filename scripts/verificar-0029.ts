// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0029.ts
//
// Verifica la migración 0029 (reverso por programa): las seis columnas de reverso más el
// interruptor `reverso_propio` en programas_tarjeta. Mismo criterio que la 0027 con el branding:
// `null` en cada columna significa "heredá lo del comercio", y el booleano manda sobre los campos.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

let fallas = 0;
const ok = (m: string) => console.log(`OK: ${m}`);
const fallo = (m: string, d?: string) => {
  console.error(`FALLO: ${m}${d ? ` — ${d}` : ''}`);
  fallas += 1;
};

async function main() {
  const supabase = createServiceClient();

  const columnas = await supabase
    .from('programas_tarjeta')
    .select(
      'id, terminos_uso, red_instagram, red_facebook, red_whatsapp, sitio_web, mostrar_como_funciona, reverso_propio',
    )
    .limit(1);
  if (columnas.error) {
    fallo('a programas_tarjeta le faltan columnas de la 0029', columnas.error.message);
    process.exit(1);
  }
  ok('programas_tarjeta tiene las 7 columnas nuevas.');

  const fila = columnas.data?.[0] as Record<string, unknown> | undefined;
  if (!fila) {
    console.log('AVISO: no hay ningún programa en la base, no se pudo verificar los defaults.');
  } else {
    // reverso_propio tiene que nacer en false: los programas existentes heredan el reverso del
    // comercio y ninguna tarjeta viva puede cambiar de reverso al aplicar la migración.
    if (fila.reverso_propio !== false) {
      fallo('reverso_propio no nace en false', `valor leído: ${JSON.stringify(fila.reverso_propio)}`);
    } else {
      ok('reverso_propio nace en false (los programas existentes heredan).');
    }

    // mostrar_como_funciona es NULLABLE en el programa a propósito: null = heredar. En comercios es
    // NOT NULL con default true, y copiar ese default acá rompería la herencia.
    if (fila.mostrar_como_funciona === null) {
      ok('mostrar_como_funciona nace en null (heredar), no en true.');
    } else {
      console.log(
        `AVISO: mostrar_como_funciona vale ${JSON.stringify(fila.mostrar_como_funciona)} en el programa leído; si es un programa ya editado no es un error.`,
      );
    }

    const textos = [
      fila.terminos_uso,
      fila.red_instagram,
      fila.red_facebook,
      fila.red_whatsapp,
      fila.sitio_web,
    ];
    if (textos.every((v) => v === null)) {
      ok('las columnas de texto del reverso nacen en null (herencia).');
    } else {
      console.log('AVISO: algún programa ya tiene reverso propio cargado; no es un error.');
    }
  }

  if (fallas > 0) {
    console.error(`\n${fallas} verificación(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nTodo OK.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FALLO GENERAL:', e);
    process.exit(1);
  });

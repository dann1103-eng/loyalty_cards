// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0027.ts
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
      'id, color_fondo, color_texto, color_label, logo_url, hero_url, strip_url, sello_icono_url, difuminado_franja, google_class_id, branding_propio',
    )
    .limit(1);
  if (columnas.error) {
    fallo('a programas_tarjeta le faltan columnas de la 0027', columnas.error.message);
    process.exit(1);
  }
  ok('programas_tarjeta tiene las 10 columnas nuevas.');

  // El default importa: sin él, los programas existentes quedarían con branding_propio null y
  // brandingEfectivo los trataría como "no hereda" según cómo se escriba el chequeo.
  const fila = columnas.data?.[0];
  if (!fila) {
    console.log('AVISO: no hay ningún programa en la base, no se pudo verificar el default.');
  } else if (fila.branding_propio !== false) {
    fallo('branding_propio no nace en false', `valor leído: ${JSON.stringify(fila.branding_propio)}`);
  } else {
    ok('branding_propio nace en false (los programas existentes heredan).');
  }

  // Las 8 de branding tienen que ser nullable: null es el estado de herencia.
  const nulos = [
    fila?.color_fondo,
    fila?.color_texto,
    fila?.color_label,
    fila?.logo_url,
    fila?.hero_url,
    fila?.strip_url,
    fila?.sello_icono_url,
    fila?.difuminado_franja,
    fila?.google_class_id,
  ];
  if (fila && nulos.every((v) => v === null)) {
    ok('las columnas de branding nacen en null (herencia) en un programa existente.');
  } else if (fila) {
    console.log('AVISO: algún programa ya tiene branding propio cargado; no es un error.');
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

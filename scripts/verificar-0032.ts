// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0032.ts
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

  const comercios = await supabase
    .from('comercios')
    .select('id, encuadre_franja, foco_franja_x, foco_franja_y, zoom_franja')
    .limit(1);
  if (comercios.error) {
    fallo('a comercios le faltan columnas de la 0032', comercios.error.message);
    process.exit(1);
  }
  ok('comercios tiene las 4 columnas de encuadre.');

  const c = comercios.data?.[0];
  if (!c) {
    console.log('AVISO: no hay comercios en la base, no se pudo verificar el default.');
  } else if (c.encuadre_franja === 'llenar' && c.foco_franja_x === 50 && c.foco_franja_y === 50 && c.zoom_franja === 100) {
    ok('un comercio existente nace con el default (llenar, 50, 50, 100): se ve igual que antes.');
  } else {
    fallo('el default del comercio no es el esperado', JSON.stringify(c));
  }

  const programas = await supabase
    .from('programas_tarjeta')
    .select('id, encuadre_franja, foco_franja_x, foco_franja_y, zoom_franja')
    .limit(1);
  if (programas.error) {
    fallo('a programas_tarjeta le faltan columnas de la 0032', programas.error.message);
    process.exit(1);
  }
  ok('programas_tarjeta tiene las 4 columnas de encuadre.');

  const p = programas.data?.[0];
  if (!p) {
    console.log('AVISO: no hay programas en la base, no se pudo verificar que nazcan null.');
  } else if (p.encuadre_franja === null && p.foco_franja_x === null && p.foco_franja_y === null && p.zoom_franja === null) {
    ok('un programa existente nace con las 4 en null (sin encuadre propio).');
  } else {
    console.log('AVISO: algún programa ya tiene encuadre propio cargado; no es un error.');
  }

  // El CHECK tiene que rechazar un zoom fuera de rango: sin él, la única defensa sería TypeScript.
  if (c) {
    const { error } = await supabase.from('comercios').update({ zoom_franja: 999 }).eq('id', c.id);
    if (error && error.code === '23514') ok('el CHECK de zoom_franja rechaza 999.');
    else if (error) fallo('el update de prueba falló por otro motivo', error.message);
    else {
      fallo('el CHECK de zoom_franja NO existe: aceptó 999');
      await supabase.from('comercios').update({ zoom_franja: c.zoom_franja }).eq('id', c.id);
    }
  }

  if (fallas > 0) {
    console.error(`\n${fallas} verificación(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nMigración 0032 verificada.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

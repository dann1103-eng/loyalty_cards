// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0028.ts
//
// Verifica la migración 0028 (disenos_cartel) contra la base REAL. Crea y borra sus propias filas
// de prueba. No verifica solo que las columnas existan: los CHECK y el UNIQUE son la única defensa
// del esquema y hay que confirmar que RECHAZAN, no suponerlo.
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

  const tabla = await supabase
    .from('disenos_cartel')
    .select('id, programa_id, comercio_id, plantilla, color_fondo, color_texto, color_label, logo_url, texto_cta, texto_teaser, created_at, updated_at')
    .limit(1);
  if (tabla.error) {
    fallo('la tabla disenos_cartel no existe o le faltan columnas', tabla.error.message);
    process.exit(1);
  }
  ok('la tabla disenos_cartel existe con sus 12 columnas.');

  const { data: programa } = await supabase
    .from('programas_tarjeta')
    .select('id, comercio_id')
    .limit(1)
    .maybeSingle();
  if (!programa) {
    console.log('AVISO: no hay ningún programa en la base; no se pudieron probar CHECK ni UNIQUE.');
    return;
  }

  // 23514 = check_violation. Si esto NO rebota, el CHECK no está y una plantilla inventada llegaría
  // al dispatcher de plantillas, que no sabría qué dibujar.
  const plantillaMala = await supabase
    .from('disenos_cartel')
    .insert({ programa_id: programa.id, comercio_id: programa.comercio_id, plantilla: 'inventada' })
    .select('id');
  if (plantillaMala.error?.code === '23514') {
    ok('el CHECK de plantilla rechaza un valor fuera de la lista.');
  } else {
    fallo('una plantilla inválida NO fue rechazada', JSON.stringify(plantillaMala.error));
    if (plantillaMala.data?.[0]) await supabase.from('disenos_cartel').delete().eq('id', plantillaMala.data[0].id);
  }

  // btrim(texto_cta) <> '': un cartel con la llamada a la acción en blanco se imprime vacío.
  const ctaVacio = await supabase
    .from('disenos_cartel')
    .insert({ programa_id: programa.id, comercio_id: programa.comercio_id, texto_cta: '   ' })
    .select('id');
  if (ctaVacio.error?.code === '23514') {
    ok('el CHECK de texto_cta rechaza un texto en blanco.');
  } else {
    fallo('un texto_cta en blanco NO fue rechazado', JSON.stringify(ctaVacio.error));
    if (ctaVacio.data?.[0]) await supabase.from('disenos_cartel').delete().eq('id', ctaVacio.data[0].id);
  }

  const fila = await supabase
    .from('disenos_cartel')
    .insert({ programa_id: programa.id, comercio_id: programa.comercio_id })
    .select('id, plantilla, texto_cta')
    .single();
  if (fila.error) {
    fallo('no se pudo insertar una fila válida', fila.error.message);
  } else {
    ok(`defaults correctos — plantilla="${fila.data.plantilla}", texto_cta="${fila.data.texto_cta}".`);

    // 23505 = unique_violation. Sin el UNIQUE, un comercio podría acumular diseños duplicados del
    // mismo programa y la app no sabría cuál es el bueno.
    const duplicado = await supabase
      .from('disenos_cartel')
      .insert({ programa_id: programa.id, comercio_id: programa.comercio_id })
      .select('id');
    if (duplicado.error?.code === '23505') {
      ok('programa_id es UNIQUE: un solo diseño por programa.');
    } else {
      fallo('se permitió un SEGUNDO diseño para el mismo programa');
      if (duplicado.data?.[0]) await supabase.from('disenos_cartel').delete().eq('id', duplicado.data[0].id);
    }

    await supabase.from('disenos_cartel').delete().eq('id', fila.data.id);
    ok('fila de prueba borrada.');
  }

  if (fallas > 0) {
    console.error(`\n${fallas} verificación(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nTodo OK: la migración 0028 está aplicada.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FALLO GENERAL:', e);
    process.exit(1);
  });

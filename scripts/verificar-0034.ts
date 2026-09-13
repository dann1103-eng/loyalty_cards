// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0034.ts
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

  // 1. Las columnas del programa y sus defaults.
  const prog = await supabase
    .from('programas_tarjeta')
    .select('id, aviso_vencimiento_activo, aviso_vencimiento_dias, aviso_vencimiento_mensaje')
    .limit(1)
    .maybeSingle();
  if (prog.error) {
    fallo('a programas_tarjeta le faltan columnas de la 0034', prog.error.message);
    process.exit(1);
  }
  ok('programas_tarjeta tiene las 3 columnas del aviso de vencimiento.');
  if (prog.data) {
    if (prog.data.aviso_vencimiento_activo === false && prog.data.aviso_vencimiento_dias === null) {
      ok('un programa existente nace con el aviso APAGADO y sin días (nadie recibe nada por sorpresa).');
    } else {
      console.log('AVISO: algún programa ya tiene el aviso configurado; no es un error.');
    }

    // 2. El CHECK de cordura de los días. Se prueba y se restaura.
    const { error } = await supabase
      .from('programas_tarjeta')
      .update({ aviso_vencimiento_dias: 91 })
      .eq('id', prog.data.id);
    if (error && error.code === '23514') ok('el CHECK rechaza 91 días de anticipación.');
    else if (error) fallo('el update de prueba falló por otro motivo', error.message);
    else {
      fallo('el CHECK de días NO existe: aceptó 91');
      await supabase
        .from('programas_tarjeta')
        .update({ aviso_vencimiento_dias: prog.data.aviso_vencimiento_dias })
        .eq('id', prog.data.id);
    }
  }

  // 3. La marca de idempotencia en la tarjeta.
  const tar = await supabase.from('tarjetas').select('id, aviso_vencimiento_para').limit(1).maybeSingle();
  if (tar.error) {
    fallo('a tarjetas le falta aviso_vencimiento_para', tar.error.message);
  } else {
    ok('tarjetas tiene aviso_vencimiento_para.');
  }

  // 4. LO QUE DE VERDAD IMPORTA: la auditoría acepta el origen nuevo. Sin esto el push se mandaría
  // igual y quedaría un envío sin rastro. `tarjeta_id` es NOT NULL con FK, así que se usa una
  // tarjeta REAL y se borra la fila de prueba al terminar.
  if (tar.data) {
    const { data: fila, error } = await supabase
      .from('notificaciones_enviadas')
      .insert({ tarjeta_id: tar.data.id, canal: 'apple', origen: 'vencimiento' })
      .select('id')
      .single();
    if (error) {
      fallo('notificaciones_enviadas RECHAZA origen = vencimiento', error.message);
    } else {
      ok('notificaciones_enviadas acepta origen = vencimiento.');
      await supabase.from('notificaciones_enviadas').delete().eq('id', fila.id);
    }

    // Y que un origen inventado siga rechazándose: si el CHECK se hubiera caído en vez de ampliarse,
    // la prueba de arriba pasaría igual.
    const { error: errorInventado } = await supabase
      .from('notificaciones_enviadas')
      .insert({ tarjeta_id: tar.data.id, canal: 'apple', origen: 'inventado' });
    if (errorInventado && errorInventado.code === '23514') ok('y sigue rechazando un origen inventado (el CHECK se amplió, no se cayó).');
    else fallo('el CHECK de origen ya no filtra nada', errorInventado?.message ?? 'aceptó "inventado"');
  } else {
    console.log('AVISO: no hay tarjetas; no se pudo probar el CHECK de origen.');
  }

  if (fallas > 0) {
    console.error(`\n${fallas} verificación(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nMigración 0034 verificada.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

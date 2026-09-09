// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0033.ts
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

  // 1. La columna nueva.
  const col = await supabase.from('programas_tarjeta').select('id, nombre_pase').limit(1);
  if (col.error) {
    fallo('programas_tarjeta no tiene nombre_pase', col.error.message);
  } else {
    ok('programas_tarjeta.nombre_pase existe.');
    const fila = col.data?.[0];
    if (fila && fila.nombre_pase !== null) {
      console.log('AVISO: algún programa ya tiene nombre_pase cargado; no es un error.');
    } else if (fila) {
      ok('nace en null (el pase sale como antes hasta que el dueño lo escriba).');
    }
  }

  // 2. El CHECK del largo. Se prueba sobre una fila real y se restaura.
  const prog = await supabase.from('programas_tarjeta').select('id, nombre_pase').limit(1).maybeSingle();
  if (prog.data) {
    const largo = 'x'.repeat(41);
    const { error } = await supabase.from('programas_tarjeta').update({ nombre_pase: largo }).eq('id', prog.data.id);
    if (error && error.code === '23514') ok('el CHECK rechaza un nombre de 41 caracteres.');
    else if (error) fallo('el update de prueba falló por otro motivo', error.message);
    else {
      fallo('el CHECK de largo NO existe: aceptó 41 caracteres');
      await supabase.from('programas_tarjeta').update({ nombre_pase: prog.data.nombre_pase }).eq('id', prog.data.id);
    }
  }

  // 3. Las cuatro funciones devuelven `operaciones` y ya no `acreditaciones`.
  const { data: com } = await supabase.from('comercios').select('id').limit(1).maybeSingle();
  if (!com) {
    console.log('AVISO: no hay comercios; no se pudieron probar las funciones.');
  } else {
    const suc = await supabase.rpc('reporte_sucursales', { p_comercio_id: com.id });
    if (suc.error) fallo('reporte_sucursales falló', suc.error.message);
    else {
      const f = suc.data?.[0] as Record<string, unknown> | undefined;
      if (!f) console.log('AVISO: reporte_sucursales no devolvió filas para el comercio de prueba.');
      else if ('operaciones' in f && !('acreditaciones' in f)) ok('reporte_sucursales devuelve `operaciones`.');
      else fallo('reporte_sucursales no tiene la columna nueva', JSON.stringify(Object.keys(f)));
    }

    const ten = await supabase.rpc('reporte_tendencia', { p_comercio_id: com.id, p_dias: 3 });
    if (ten.error) fallo('reporte_tendencia falló', ten.error.message);
    else if ((ten.data?.[0] as Record<string, unknown> | undefined)?.operaciones !== undefined) ok('reporte_tendencia devuelve `operaciones`.');
    else fallo('reporte_tendencia no tiene la columna nueva');

    const caj = await supabase.rpc('reporte_cajeros', { p_comercio_id: com.id, p_desde: null, p_hasta: null });
    if (caj.error) fallo('reporte_cajeros falló', caj.error.message);
    else ok('reporte_cajeros responde (permisos y firma correctos).');
  }

  const fm = await supabase.rpc('reporte_fm_comercios');
  if (fm.error) fallo('reporte_fm_comercios falló', fm.error.message);
  else {
    const f = fm.data?.[0] as Record<string, unknown> | undefined;
    if (f && 'operaciones' in f) ok('reporte_fm_comercios devuelve `operaciones`.');
    else if (!f) console.log('AVISO: reporte_fm_comercios no devolvió filas.');
    else fallo('reporte_fm_comercios no tiene la columna nueva', JSON.stringify(Object.keys(f)));
  }

  if (fallas > 0) {
    console.error(`\n${fallas} verificación(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nMigración 0033 verificada.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

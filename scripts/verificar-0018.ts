// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0018.ts
// Verificación de la migración 0018 (los seis tipos de tarjeta). Crea datos propios y los borra.
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

  const comercio = await supabase
    .from('comercios')
    .select('cashback_porcentaje, multipass_visitas, membresia_dias, cupon_vigencia_dias')
    .limit(1);
  if (comercio.error) {
    fallo('comercios no tiene las columnas de configuración', comercio.error.message);
    process.exit(1);
  }
  ok('comercios tiene cashback_porcentaje, multipass_visitas, membresia_dias y cupon_vigencia_dias.');

  const tarjeta = await supabase
    .from('tarjetas')
    .select('vigencia_hasta, usado_en, acumulado_centavos')
    .limit(1);
  if (tarjeta.error) {
    fallo('tarjetas no tiene las columnas de estado', tarjeta.error.message);
    process.exit(1);
  }
  ok('tarjetas tiene vigencia_hasta, usado_en y acumulado_centavos.');

  const niveles = await supabase.from('niveles_descuento').select('id').limit(1);
  if (niveles.error) {
    fallo('la tabla niveles_descuento no existe', niveles.error.message);
    process.exit(1);
  }
  ok('la tabla niveles_descuento existe.');

  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data: com, error: eCom } = await supabase
    .from('comercios')
    .insert({ nombre: 'Verificacion 0018', slug: `verif-0018-${sufijo}` })
    .select('id')
    .single();
  if (eCom || !com) {
    fallo('no se pudo crear el comercio de prueba', eCom?.message);
    process.exit(1);
  }

  try {
    const porcentajeAbsurdo = await supabase
      .from('comercios')
      .update({ cashback_porcentaje: 150 })
      .eq('id', com.id);
    if (porcentajeAbsurdo.error?.code === '23514') {
      ok('rechaza un cashback de más de 100% (23514).');
    } else {
      fallo('aceptó un cashback de 150%', porcentajeAbsurdo.error?.message ?? 'sin error');
    }

    const valido = await supabase
      .from('comercios')
      .update({ cashback_porcentaje: 5.5, multipass_visitas: 10, membresia_dias: 30 })
      .eq('id', com.id);
    if (valido.error) fallo('rechazó una configuración válida', valido.error.message);
    else ok('acepta una configuración válida de cashback, multipass y membresía.');

    const nivel = await supabase
      .from('niveles_descuento')
      .insert({ comercio_id: com.id, desde_centavos: 10000, porcentaje: 5 });
    if (nivel.error) fallo('no se pudo crear un nivel de descuento', nivel.error.message);
    else ok('acepta un nivel de descuento.');

    // Dos niveles con el mismo umbral harían ambiguo qué descuento aplica.
    const duplicado = await supabase
      .from('niveles_descuento')
      .insert({ comercio_id: com.id, desde_centavos: 10000, porcentaje: 8 });
    if (duplicado.error?.code === '23505') {
      ok('rechaza dos niveles con el mismo umbral en un comercio (23505).');
    } else {
      fallo('aceptó dos niveles con el mismo umbral', duplicado.error?.message ?? 'sin error');
    }

    await supabase.from('niveles_descuento').delete().eq('comercio_id', com.id);
  } finally {
    await supabase.from('comercios').delete().eq('id', com.id);
    ok('datos de prueba borrados.');
  }

  if (fallas > 0) {
    console.error(`\n${fallas} verificación(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nTodo en orden: la migración 0018 está aplicada.');
  process.exit(0);
}

main();

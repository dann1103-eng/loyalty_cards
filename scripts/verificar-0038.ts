// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0038.ts
// Verificación de la migración 0038 (cobranza por cuenta). Crea su propia cuenta de prueba y la borra: la
// única forma honesta de comprobar que un CHECK está activo es intentar violarlo.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';
import { hoyEnZona } from '../lib/tarjetas/vigencia';

let fallas = 0;
const ok = (m: string) => console.log(`OK: ${m}`);
const fallo = (m: string, d?: string) => {
  console.error(`FALLO: ${m}${d ? ` — ${d}` : ''}`);
  fallas += 1;
};

// Mismo criterio que el resto de la cobranza: fecha de calendario AAAA-MM-DD en El Salvador, sin horas.
const hoyElSalvador = () => hoyEnZona('America/El_Salvador');

async function main() {
  const supabase = createServiceClient();

  // 1. Las tres columnas nuevas existen.
  const columnas = await supabase
    .from('cuentas_comercio')
    .select('cobranza, cobranza_desde, cobranza_pospuesta_hasta')
    .limit(1);
  if (columnas.error) {
    fallo('las columnas nuevas de cuentas_comercio no existen', columnas.error.message);
    console.error('¿Se corrió la migración 0038? PostgREST tarda unos segundos en verla.');
    process.exit(1);
  }
  ok('cuentas_comercio tiene cobranza, cobranza_desde y cobranza_pospuesta_hasta.');

  // 2. Una cuenta nueva (sin especificar cobranza) nace 'normal' con cobranza_desde = hoy.
  const { data: cuenta, error: eCuenta } = await supabase
    .from('cuentas_comercio')
    .insert({ nombre: `Verificacion 0038 ${Date.now()}` })
    .select('id, cobranza, cobranza_desde')
    .single();
  if (eCuenta || !cuenta) {
    fallo('no se pudo crear la cuenta de prueba', eCuenta?.message);
    process.exit(1);
  }

  try {
    if (cuenta.cobranza === 'normal') ok("una cuenta nueva nace con cobranza = 'normal'.");
    else fallo("una cuenta nueva no nació 'normal'", String(cuenta.cobranza));

    if (cuenta.cobranza_desde === hoyElSalvador()) ok('cobranza_desde de una cuenta nueva es hoy.');
    else fallo('cobranza_desde de una cuenta nueva no es hoy', `esperado ${hoyElSalvador()}, obtuvo ${cuenta.cobranza_desde}`);

    // 3. Un valor de cobranza inválido es rechazado por el CHECK. Pedimos el id de vuelta para poder
    // borrarla si el CHECK no la rechaza — si no, esta prueba (la que existe justo para detectar que el
    // CHECK falla) dejaría la fila inválida viva para siempre en la tabla real.
    const invalida = await supabase
      .from('cuentas_comercio')
      .insert({ nombre: `Verificacion 0038 invalida ${Date.now()}`, cobranza: 'inventado' })
      .select('id')
      .single();
    if (invalida.error?.code === '23514') ok("rechaza un valor de cobranza que no es 'normal' ni 'exenta' (23514).");
    else {
      fallo('permitió un valor de cobranza inválido', invalida.error?.message ?? 'sin error');
      if (invalida.data?.id) await supabase.from('cuentas_comercio').delete().eq('id', invalida.data.id);
    }
  } finally {
    await supabase.from('cuentas_comercio').delete().eq('id', cuenta.id);
  }

  // 4. Cuentas VIEJAS (datos ya existentes antes de esta migración) quedan 'exenta'. No podemos crear una
  // cuenta "vieja" desde este script — solo contamos cuántas cuentas ya existentes están en 'exenta' y lo
  // reportamos como información. En un ambiente de pruebas recién creado esto puede dar 0 (no hay cuentas
  // viejas), así que NO lo hacemos fallar: es una limitación de este script, no una aserción respaldada.
  const { count, error: eExentas } = await supabase
    .from('cuentas_comercio')
    .select('id', { count: 'exact', head: true })
    .eq('cobranza', 'exenta');
  if (eExentas) {
    fallo('no se pudo contar las cuentas exentas', eExentas.message);
  } else {
    console.log(`INFO: ${count ?? 0} cuenta(s) existente(s) con cobranza = 'exenta' (esperado > 0 si ya había cuentas antes de aplicar la 0038; 0 es normal en un ambiente nuevo).`);
  }

  if (fallas > 0) {
    console.error(`\n${fallas} verificación(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nLa migración 0038 está aplicada y funciona.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

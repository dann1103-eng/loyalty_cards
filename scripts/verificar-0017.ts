// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0017.ts
// Verificación de la migración 0017 (solicitudes de plan y cobros). Crea datos de prueba propios y
// los borra: la única forma honesta de comprobar que un CHECK está activo es intentar violarlo.
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

  for (const tabla of ['solicitudes_plan', 'cobros'] as const) {
    const { error } = await supabase.from(tabla).select('id').limit(1);
    if (error) {
      fallo(`la tabla ${tabla} no existe`, error.message);
      console.error('¿Se corrió la migración 0017? PostgREST tarda unos segundos en verla.');
      process.exit(1);
    }
    ok(`la tabla ${tabla} existe.`);
  }

  const { data: cuenta, error: eCuenta } = await supabase
    .from('cuentas_comercio')
    .insert({ nombre: `Verificacion 0017 ${Date.now()}` })
    .select('id')
    .single();
  if (eCuenta || !cuenta) {
    fallo('no se pudo crear la cuenta de prueba', eCuenta?.message);
    process.exit(1);
  }

  try {
    // Una solicitud pendiente por cuenta (índice único parcial).
    const primera = await supabase
      .from('solicitudes_plan')
      .insert({ cuenta_id: cuenta.id, plan_actual: 'starter', plan_solicitado: 'growth' });
    if (primera.error) fallo('no se pudo crear la primera solicitud', primera.error.message);
    else ok('acepta una solicitud pendiente.');

    const segunda = await supabase
      .from('solicitudes_plan')
      .insert({ cuenta_id: cuenta.id, plan_actual: 'starter', plan_solicitado: 'pro' });
    if (segunda.error?.code === '23505') {
      ok('rechaza una SEGUNDA solicitud pendiente en la misma cuenta (23505).');
    } else {
      fallo('permitió dos solicitudes pendientes a la vez', segunda.error?.message ?? 'sin error');
    }

    // Resuelta sin fecha de resolución: el dato que después nadie reconstruye.
    const sinFecha = await supabase
      .from('solicitudes_plan')
      .update({ estado: 'aprobada' })
      .eq('cuenta_id', cuenta.id);
    if (sinFecha.error?.code === '23514') {
      ok('rechaza una solicitud resuelta sin fecha de resolución (23514).');
    } else {
      fallo('aceptó una solicitud aprobada sin resuelta_en', sinFecha.error?.message ?? 'sin error');
    }

    const conFecha = await supabase
      .from('solicitudes_plan')
      .update({ estado: 'aprobada', resuelta_en: new Date().toISOString() })
      .eq('cuenta_id', cuenta.id);
    if (conFecha.error) fallo('rechazó una resolución VÁLIDA', conFecha.error.message);
    else ok('acepta resolver una solicitud con su fecha.');

    // Resuelta la anterior, se puede volver a solicitar.
    const tercera = await supabase
      .from('solicitudes_plan')
      .insert({ cuenta_id: cuenta.id, plan_actual: 'starter', plan_solicitado: 'pro' });
    if (tercera.error) {
      fallo('no dejó solicitar de nuevo tras resolver la anterior', tercera.error.message);
    } else {
      ok('deja solicitar otra vez una vez resuelta la anterior.');
    }

    // Cobros.
    const pagadoSinFecha = await supabase.from('cobros').insert({
      cuenta_id: cuenta.id,
      periodo_desde: '2026-07-01',
      periodo_hasta: '2026-07-31',
      monto: 49,
      estado: 'pagado',
    });
    if (pagadoSinFecha.error?.code === '23514') {
      ok('rechaza un cobro pagado sin fecha de pago (23514).');
    } else {
      fallo('aceptó un cobro pagado sin pagado_en', pagadoSinFecha.error?.message ?? 'sin error');
    }

    const periodoInvertido = await supabase.from('cobros').insert({
      cuenta_id: cuenta.id,
      periodo_desde: '2026-07-31',
      periodo_hasta: '2026-07-01',
      monto: 49,
    });
    if (periodoInvertido.error?.code === '23514') {
      ok('rechaza un período con las fechas invertidas (23514).');
    } else {
      fallo('aceptó un período invertido', periodoInvertido.error?.message ?? 'sin error');
    }

    const valido = await supabase
      .from('cobros')
      .insert({
        cuenta_id: cuenta.id,
        periodo_desde: '2026-07-01',
        periodo_hasta: '2026-07-31',
        monto: 49,
        estado: 'pagado',
        pagado_en: '2026-07-05',
      })
      .select('numero')
      .single();
    if (valido.error || !valido.data) {
      fallo('rechazó un cobro VÁLIDO', valido.error?.message);
    } else if (typeof valido.data.numero !== 'number') {
      fallo('el correlativo no se generó solo', String(valido.data.numero));
    } else {
      ok(`acepta un cobro válido y le asigna correlativo (#${valido.data.numero}).`);
    }

    await supabase.from('cobros').delete().eq('cuenta_id', cuenta.id);
    await supabase.from('solicitudes_plan').delete().eq('cuenta_id', cuenta.id);
  } finally {
    await supabase.from('cuentas_comercio').delete().eq('id', cuenta.id);
    ok('datos de prueba borrados.');
  }

  if (fallas > 0) {
    console.error(`\n${fallas} verificación(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nTodo en orden: la migración 0017 está aplicada.');
  process.exit(0);
}

main();

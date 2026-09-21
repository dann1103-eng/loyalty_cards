// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0037.ts
// Verificación de la migración 0037 (pasarela Wompi). Crea datos de prueba propios y los borra: la única
// forma honesta de comprobar que un CHECK o un índice único están activos es intentar violarlos.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

let fallas = 0;
const ok = (m: string) => console.log(`OK: ${m}`);
const fallo = (m: string, d?: string) => {
  console.error(`FALLO: ${m}${d ? ` — ${d}` : ''}`);
  fallas += 1;
};

const COBRO_BASE = { periodo_desde: '2026-09-01', periodo_hasta: '2026-09-30', monto: 29 };

async function main() {
  const supabase = createServiceClient();

  // 1. Las columnas y la tabla nuevas existen.
  const columnas = await supabase
    .from('cobros')
    .select('tipo, plan_destino, wompi_id_enlace, wompi_url_enlace, wompi_enlace_vence, wompi_id_transaccion')
    .limit(1);
  if (columnas.error) {
    fallo('las columnas nuevas de cobros no existen', columnas.error.message);
    console.error('¿Se corrió la migración 0037? PostgREST tarda unos segundos en verla.');
    process.exit(1);
  }
  ok('cobros tiene tipo, plan_destino y las columnas wompi_*.');

  const tabla = await supabase.from('pagos_wompi').select('id').limit(1);
  if (tabla.error) {
    fallo('la tabla pagos_wompi no existe', tabla.error.message);
    process.exit(1);
  }
  ok('la tabla pagos_wompi existe.');

  const { data: cuenta, error: eCuenta } = await supabase
    .from('cuentas_comercio')
    .insert({ nombre: `Verificacion 0037 ${Date.now()}` })
    .select('id')
    .single();
  if (eCuenta || !cuenta) {
    fallo('no se pudo crear la cuenta de prueba', eCuenta?.message);
    process.exit(1);
  }

  try {
    // 2. Las filas viejas (y las nuevas sin tipo) quedan como 'periodo'.
    const periodo = await supabase.from('cobros').insert({ cuenta_id: cuenta.id, ...COBRO_BASE, estado: 'pendiente' }).select('id, tipo').single();
    if (periodo.data?.tipo === 'periodo') ok("un cobro sin tipo queda como 'periodo'.");
    else fallo("un cobro sin tipo no quedó como 'periodo'", periodo.error?.message ?? String(periodo.data?.tipo));

    // 3. Un ajuste sin plan destino se rechaza (CHECK).
    const sinPlan = await supabase.from('cobros').insert({ cuenta_id: cuenta.id, ...COBRO_BASE, tipo: 'ajuste', estado: 'pendiente' });
    if (sinPlan.error?.code === '23514') ok('rechaza un ajuste sin plan_destino (23514).');
    else fallo('permitió un ajuste sin plan_destino', sinPlan.error?.message ?? 'sin error');

    // 4. Un tipo inválido se rechaza (CHECK).
    const tipoMalo = await supabase.from('cobros').insert({ cuenta_id: cuenta.id, ...COBRO_BASE, tipo: 'inventado', estado: 'pendiente' });
    if (tipoMalo.error?.code === '23514') ok("rechaza un tipo que no es 'periodo' ni 'ajuste' (23514).");
    else fallo('permitió un tipo inválido', tipoMalo.error?.message ?? 'sin error');

    // 5. Los cobros pendientes que NO son de la app (metodo distinto de 'Wompi') pueden ser varios.
    const manual = await supabase.from('cobros').insert({ cuenta_id: cuenta.id, ...COBRO_BASE, estado: 'pendiente', metodo: 'Transferencia' });
    if (!manual.error) ok("acepta un segundo cobro pendiente que no es de la app (metodo 'Transferencia').");
    else fallo('rechazó un cobro pendiente manual', manual.error.message);

    // 6. Como máximo UN intento de pago pendiente de la app por cuenta (índice único parcial).
    const intento1 = await supabase.from('cobros').insert({ cuenta_id: cuenta.id, ...COBRO_BASE, estado: 'pendiente', metodo: 'Wompi' });
    if (!intento1.error) ok("acepta un intento pendiente de la app (metodo 'Wompi').");
    else fallo('no aceptó el primer intento pendiente de la app', intento1.error.message);
    const intento2 = await supabase.from('cobros').insert({ cuenta_id: cuenta.id, ...COBRO_BASE, estado: 'pendiente', metodo: 'Wompi' });
    if (intento2.error?.code === '23505') ok('rechaza un SEGUNDO intento pendiente de la app en la misma cuenta (23505).');
    else fallo('permitió dos intentos pendientes de la app a la vez', intento2.error?.message ?? 'sin error');

    // 7. Un intento ya pagado no cuenta: se puede abrir otro. Y una transacción paga como máximo un cobro.
    const pagado = await supabase
      .from('cobros')
      .update({ estado: 'pagado', pagado_en: '2026-09-15', wompi_id_transaccion: 'tx-verificacion-0037' })
      .eq('cuenta_id', cuenta.id)
      .eq('metodo', 'Wompi');
    if (!pagado.error) ok('un intento pagado libera el lugar del único intento abierto.');
    else fallo('no se pudo pagar el intento', pagado.error.message);

    const otro = await supabase.from('cobros').insert({ cuenta_id: cuenta.id, ...COBRO_BASE, estado: 'pendiente', metodo: 'Wompi' }).select('id').single();
    if (otro.data) ok('tras pagar el intento, se puede abrir otro.');
    else fallo('no dejó abrir otro intento tras pagar el anterior', otro.error?.message);

    const mismaTx = await supabase
      .from('cobros')
      .update({ estado: 'pagado', pagado_en: '2026-09-15', wompi_id_transaccion: 'tx-verificacion-0037' })
      .eq('id', otro.data?.id ?? '');
    if (mismaTx.error?.code === '23505') ok('rechaza que UNA transacción pague DOS cobros (23505).');
    else fallo('permitió que una transacción pagara dos cobros', mismaTx.error?.message ?? 'sin error');

    // 8. pagos_wompi: idempotencia por id_transaccion, CHECKs y payload obligatorio.
    const evento = await supabase.from('pagos_wompi').insert({ id_transaccion: 'tx-evento-0037', fuente: 'webhook', payload: { ejemplo: true } }).select('id, conciliacion, monto, es_real').single();
    if (evento.data?.conciliacion === 'pendiente' && evento.data.es_real === false) ok("un evento nuevo nace 'pendiente' y sin plata real.");
    else fallo('el evento no nació con los defaults esperados', evento.error?.message);

    const repetido = await supabase.from('pagos_wompi').insert({ id_transaccion: 'tx-evento-0037', fuente: 'redirect', payload: {} });
    if (repetido.error?.code === '23505') ok('rechaza un segundo evento con la misma transacción (23505).');
    else fallo('permitió dos eventos con el mismo id_transaccion', repetido.error?.message ?? 'sin error');

    const conciliacionMala = await supabase.from('pagos_wompi').insert({ id_transaccion: 'tx-mala-0037', fuente: 'webhook', conciliacion: 'inventada', payload: {} });
    if (conciliacionMala.error?.code === '23514') ok('rechaza una conciliación que no está en la lista (23514).');
    else fallo('permitió una conciliación inválida', conciliacionMala.error?.message ?? 'sin error');

    const fuenteMala = await supabase.from('pagos_wompi').insert({ id_transaccion: 'tx-fuente-0037', fuente: 'telepatia', payload: {} });
    if (fuenteMala.error?.code === '23514') ok('rechaza una fuente que no está en la lista (23514).');
    else fallo('permitió una fuente inválida', fuenteMala.error?.message ?? 'sin error');
  } finally {
    await supabase.from('pagos_wompi').delete().in('id_transaccion', ['tx-evento-0037', 'tx-mala-0037', 'tx-fuente-0037']);
    await supabase.from('cobros').delete().eq('cuenta_id', cuenta.id);
    await supabase.from('cuentas_comercio').delete().eq('id', cuenta.id);
  }

  if (fallas > 0) {
    console.error(`\n${fallas} verificación(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nLa migración 0037 está aplicada y funciona.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

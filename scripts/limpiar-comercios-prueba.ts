// Borra los comercios de PRUEBA huérfanos que dejó el fixture de tests antes de que
// entornoComercio.ts aprendiera a limpiar notificaciones_enviadas y difusiones (migración 0026).
//
// Por qué existió el problema: esas dos tablas no tienen ON DELETE CASCADE, así que una fila en
// notificaciones_enviadas bloqueaba el borrado de su tarjeta, eso bloqueaba el del comercio, y
// borrar() del fixture solo hace console.error — el fallo era silencioso. El 2026-07-30 había 519
// comercios huérfanos, 47 de ellos con aviso_inactividad_activo=true, y procesarAvisosInactividad
// los recorría todos hasta hacer fallar por timeout a 6 pruebas que estaban verdes.
//
// SEGURIDAD: solo toca filas cuyo comercio se llama EXACTAMENTE 'Comercio Prueba' — el nombre que
// hardcodea crearComercio() en test/fixtures/entornoComercio.ts. Ningún comercio real se llama así.
// Imprime lo que va a borrar y exige --confirmar para borrar de verdad; sin esa bandera es un
// simulacro de solo lectura.
//
// Uso:
//   npx tsx --conditions=react-server scripts/limpiar-comercios-prueba.ts             (simulacro)
//   npx tsx --conditions=react-server scripts/limpiar-comercios-prueba.ts --confirmar (borra)
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

const NOMBRE_FIXTURE = 'Comercio Prueba';

async function main() {
  const confirmar = process.argv.includes('--confirmar');
  const supabase = createServiceClient();

  const { data: comercios, error } = await supabase
    .from('comercios')
    .select('id')
    .eq('nombre', NOMBRE_FIXTURE);
  if (error) {
    console.error('No se pudieron leer los comercios:', error.message);
    process.exit(1);
  }
  const ids = (comercios ?? []).map((c) => c.id);
  console.log(`Comercios llamados "${NOMBRE_FIXTURE}": ${ids.length}`);
  if (ids.length === 0) {
    console.log('Nada que limpiar.');
    return;
  }

  // Las tarjetas hacen falta por separado: notificaciones_enviadas se filtra por tarjeta_id, no por
  // comercio_id.
  const { data: tarjetas } = await supabase.from('tarjetas').select('id').in('comercio_id', ids);
  const tarjetaIds = (tarjetas ?? []).map((t) => t.id);

  const { data: clientesDeTarjetas } = await supabase
    .from('tarjetas')
    .select('cliente_id')
    .in('comercio_id', ids);
  const clienteIds = [...new Set((clientesDeTarjetas ?? []).map((t) => t.cliente_id))];

  console.log(`  tarjetas asociadas: ${tarjetaIds.length}`);
  console.log(`  clientes asociados: ${clienteIds.length}`);

  if (!confirmar) {
    console.log('\nSIMULACRO — no se borró nada. Volvé a correr con --confirmar para borrar.');
    return;
  }

  // MISMO orden de FKs que limpiar() en test/fixtures/entornoComercio.ts. Cambiarlo acá sin
  // cambiarlo allá es pedir un 23503.
  // PromiseLike y no Promise: el builder de postgrest-js es thenable pero no una Promise real
  // (no tiene .catch/.finally), así que tiparlo como Promise no compila.
  const paso = async (
    tabla: string,
    ejecutar: () => PromiseLike<{ error: { message: string } | null }>,
  ) => {
    const { error: e } = await ejecutar();
    if (e) {
      console.error(`  FALLÓ ${tabla}: ${e.message}`);
      process.exit(1);
    }
    console.log(`  OK ${tabla}`);
  };

  if (tarjetaIds.length) {
    await paso('notificaciones_enviadas', () =>
      supabase.from('notificaciones_enviadas').delete().in('tarjeta_id', tarjetaIds),
    );
  }
  await paso('difusiones', () => supabase.from('difusiones').delete().in('comercio_id', ids));
  if (tarjetaIds.length) {
    await paso('transacciones_puntos', () =>
      supabase.from('transacciones_puntos').delete().in('tarjeta_id', tarjetaIds),
    );
    await paso('canjes', () => supabase.from('canjes').delete().in('tarjeta_id', tarjetaIds));
  }
  await paso('usuarios_comercio', () => supabase.from('usuarios_comercio').delete().in('comercio_id', ids));
  await paso('sucursales', () => supabase.from('sucursales').delete().in('comercio_id', ids));
  await paso('recompensas', () => supabase.from('recompensas').delete().in('comercio_id', ids));
  await paso('tarjetas', () => supabase.from('tarjetas').delete().in('comercio_id', ids));
  await paso('programas_tarjeta', () => supabase.from('programas_tarjeta').delete().in('comercio_id', ids));
  if (clienteIds.length) {
    await paso('clientes', () => supabase.from('clientes').delete().in('id', clienteIds));
  }
  await paso('comercios', () => supabase.from('comercios').delete().in('id', ids));

  const { count } = await supabase
    .from('comercios')
    .select('id', { count: 'exact', head: true })
    .eq('nombre', NOMBRE_FIXTURE);
  console.log(`\nListo. Quedan ${count} comercios llamados "${NOMBRE_FIXTURE}".`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FALLO GENERAL:', e);
    process.exit(1);
  });

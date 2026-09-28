// Manda un push de actualización a TODOS los pases de Apple Wallet instalados, de todos los
// comercios. Sirve cuando cambia algo que va en TODOS los pases y que no pasa por ningún guardado
// que ya notifique — p. ej. el pie del emisor del reverso (lib/marca.ts): el 2026-09-28 el correo de
// soporte pasó de soporte@cardly-sv.site a soporte@fmcomsolutions.com, y sin este push cada iPhone
// seguía mostrando el viejo hasta que le sumaran un sello.
//
// El push de pases es SILENCIOSO (payload vacío, ver lib/apple/enviarPush.ts): el cliente no ve
// ninguna notificación, el iPhone solo vuelve a bajar su .pkpass. Funciona porque la ruta de
// "qué cambió" devuelve todos los seriales del dispositivo sin filtrar por fecha.
//
// Usa notificarCambioTarjeta, el mismo camino que un sello: borra los registros cuyo token Apple
// declare muerto (el cliente quitó el pase) y nunca lanza por un push fallido.
//
// Uso:
//   npx tsx --conditions=react-server scripts/actualizar-todos-los-pases-apple.ts             (simulacro)
//   npx tsx --conditions=react-server scripts/actualizar-todos-los-pases-apple.ts --confirmar (manda)
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';
import { notificarCambioTarjeta } from '../lib/apple/notificarCambioTarjeta';

async function main() {
  const confirmar = process.argv.includes('--confirmar');
  const supabase = createServiceClient();

  const { data: registros, error } = await supabase.from('apple_push_registrations').select('tarjeta_id');
  if (error) {
    console.error('No se pudieron leer los registros de Apple:', error.message);
    process.exit(1);
  }
  const tarjetaIds = [...new Set((registros ?? []).map((r) => r.tarjeta_id))];
  console.log(`Registros de dispositivos: ${registros?.length ?? 0} — tarjetas distintas: ${tarjetaIds.length}`);

  if (!confirmar) {
    console.log('\nSIMULACRO — no se mandó nada. Volvé a correr con --confirmar para mandar los push.');
    return;
  }

  let hechas = 0;
  for (const id of tarjetaIds) {
    await notificarCambioTarjeta(supabase, id);
    hechas += 1;
    if (hechas % 25 === 0) console.log(`  ${hechas}/${tarjetaIds.length}`);
  }

  const { count } = await supabase.from('apple_push_registrations').select('tarjeta_id', { count: 'exact', head: true });
  console.log(`\nListo: ${hechas} tarjetas notificadas. Registros que siguen vivos: ${count}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FALLO GENERAL:', e);
    process.exit(1);
  });

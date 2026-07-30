// Re-sincroniza los LoyaltyObject de Google de UN comercio.
//
// Para qué sirve: los objetos de Google se escriben una sola vez al crearse y después solo cuando
// algo mueve el saldo (acreditación, canje). Un cambio que afecta al CUERPO del objeto sin tocar el
// saldo —típicamente las ubicaciones del geopush— no llega solo a las tarjetas ya emitidas: se
// queda en el código y los clientes viejos siguen con el objeto viejo. Este script empuja el cuerpo
// nuevo a todas las tarjetas del comercio.
//
// Es idempotente: syncObjetoTarjeta hace `patch` con el cuerpo completo, así que correrlo dos veces
// deja lo mismo que correrlo una. Es la MISMA llamada que dispara cada venta, no una operación
// especial.
//
// Uso (OJO con NEXT_PUBLIC_BASE_URL, ver abajo):
//   NEXT_PUBLIC_BASE_URL=https://www.cardly-sv.site \
//     npx tsx --conditions=react-server scripts/resincronizar-objetos-google.ts <comercio_id>
//
// El override de NEXT_PUBLIC_BASE_URL NO es opcional cuando se corre desde una máquina de
// desarrollo: la grilla de sellos viaja como `heroImage` con una URL absoluta armada a partir de
// esa variable (lib/google/heroUrl.ts). Con el valor local queda `http://localhost:3000/...`, que
// los servidores de Google no pueden descargar, y la API RECHAZA EL PATCH ENTERO con
// `400 INVALID_ARGUMENT — Image cannot be loaded`. No falla solo la imagen: no se guarda nada, ni
// las ubicaciones. dotenv no pisa lo que ya está en el entorno, así que la variable puesta en la
// línea de comando gana sobre .env.local.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';
import { syncObjetoTarjeta } from '../lib/google/syncObjeto';
import { listarUbicacionesGeopush } from '../lib/comercio/geopush';

async function main() {
  const comercioId = process.argv[2];
  if (!comercioId) {
    console.error('Falta el comercio_id. Uso:');
    console.error('  npx tsx --conditions=react-server scripts/resincronizar-objetos-google.ts <comercio_id>');
    process.exit(1);
  }

  const supabase = createServiceClient();

  const { data: comercio } = await supabase
    .from('comercios')
    .select('nombre, google_class_id')
    .eq('id', comercioId)
    .maybeSingle();
  if (!comercio) {
    console.error(`No existe un comercio con id ${comercioId}.`);
    process.exit(1);
  }
  if (!comercio.google_class_id) {
    console.error(`"${comercio.nombre}" no tiene google_class_id: Google Wallet no está habilitado para él.`);
    process.exit(1);
  }

  const ubicaciones = await listarUbicacionesGeopush(supabase, comercioId);
  console.log(`Comercio: ${comercio.nombre}`);
  console.log(`Ubicaciones de geopush que van a quedar en cada objeto: ${ubicaciones.length}`);
  for (const u of ubicaciones) console.log(`  (${u.latitud}, ${u.longitud}) — ${u.nombre}`);

  // Solo las que YA tienen objeto en Google: las que no, se crean solas cuando el cliente pida su
  // link de guardado (lib/google/linkGuardar.ts) y ahí ya salen con el cuerpo nuevo.
  const { data: tarjetas, error } = await supabase
    .from('tarjetas')
    .select('id')
    .eq('comercio_id', comercioId)
    .not('google_object_id', 'is', null);
  if (error) {
    console.error('No se pudieron leer las tarjetas:', error.message);
    process.exit(1);
  }

  console.log(`\nTarjetas con objeto de Google a re-sincronizar: ${tarjetas?.length ?? 0}\n`);
  let ok = 0;
  let fallaron = 0;
  for (const t of tarjetas ?? []) {
    const res = await syncObjetoTarjeta(supabase, t.id);
    if (res.ok) {
      ok += 1;
      console.log(`  OK   ${t.id}`);
    } else {
      fallaron += 1;
      console.error(`  FALLÓ ${t.id} — ${res.error}`);
    }
  }

  console.log(`\nListo: ${ok} sincronizada(s), ${fallaron} con error.`);
  if (fallaron > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FALLO GENERAL:', e);
    process.exit(1);
  });

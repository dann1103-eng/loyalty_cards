// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-wallet.ts [dominio]
//   ej: npx tsx --conditions=react-server scripts/verificar-wallet.ts https://www.cardly-sv.site
//
// Verificación de SOLO LECTURA de la cadena completa de Apple Wallet en PRODUCCIÓN. No escribe en
// la base ni manda push.
//
// POR QUÉ EXISTE (2026-07-26): al mover la app a cardly-sv.site, NEXT_PUBLIC_BASE_URL quedó con el
// dominio SIN www. Vercel responde 308 desde el dominio raíz hacia www, y el pass salió con ese
// webServiceURL adentro. Cuando el iPhone intenta registrarse, el 308 lo manda a OTRO origen y el
// header `Authorization: ApplePass …` se cae en el salto (regla de fetch/redirect entre orígenes),
// así que el registro devuelve 401 y NUNCA se guarda el push token. Resultado: las tarjetas dejan
// de actualizarse solas, sin un solo error visible en ningún lado — ni en la app, ni en Vercel, ni
// en el teléfono. Un redirect es fatal acá y no lo delata nada más que esta prueba.
//
// La comprobación clave es el paso 3: el webServiceURL que viene DENTRO del pass tiene que
// contestar 200 DIRECTO, sin un solo redirect de por medio.
import { config } from 'dotenv';
config({ path: '.env.local' });

import JSZip from 'jszip';
import { createServiceClient } from '../lib/supabase/server';

const PESO_PASS_SOSPECHOSO_KB = 700;

function kb(bytes: number) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

async function main() {
  const dominio = (process.argv[2] ?? 'https://www.cardly-sv.site').replace(/\/$/, '');
  const passType = process.env.APPLE_PASS_TYPE_IDENTIFIER;
  if (!passType) {
    console.error('FALLO: falta APPLE_PASS_TYPE_IDENTIFIER en .env.local');
    process.exit(1);
  }
  const supabase = createServiceClient();
  let fallos = 0;

  // 1. Una tarjeta real con la que probar (la más reciente: es la que refleja el estado de hoy).
  const { data: tarjeta } = await supabase
    .from('tarjetas')
    .select('id, apple_serial_number, apple_auth_token, comercios(nombre)')
    .not('apple_serial_number', 'is', null)
    .not('apple_auth_token', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!tarjeta?.apple_serial_number || !tarjeta.apple_auth_token) {
    console.error('FALLO: no hay ninguna tarjeta con serial y token para probar.');
    process.exit(1);
  }
  const comercio = tarjeta.comercios as unknown as { nombre: string } | null;
  const auth = { Authorization: `ApplePass ${tarjeta.apple_auth_token}` };
  const ruta = `/v1/passes/${passType}/${tarjeta.apple_serial_number}`;
  console.log(`Probando con la tarjeta más reciente: ${comercio?.nombre ?? '?'} (serial ${tarjeta.apple_serial_number.slice(0, 8)}…)\n`);

  // 2. El dominio indicado tiene que servir el pass sin redirects.
  const resPass = await fetch(`${dominio}/api/apple${ruta}`, { headers: auth, redirect: 'manual' });
  if (resPass.status !== 200) {
    console.error(`FALLO: ${dominio} devolvió ${resPass.status} al pedir el pass` +
      (resPass.headers.get('location') ? ` (redirige a ${resPass.headers.get('location')})` : ''));
    process.exit(1);
  }
  const buffer = Buffer.from(await resPass.arrayBuffer());
  console.log(`OK: ${dominio} sirve el pass (${kb(buffer.length)}).`);

  // 3. LA PRUEBA QUE IMPORTA: el webServiceURL grabado adentro del pass tiene que contestar
  //    DIRECTO. Cualquier redirect rompe el registro del dispositivo en silencio.
  const zip = await JSZip.loadAsync(buffer);
  const passJson = JSON.parse(await zip.file('pass.json')!.async('string'));
  const webServiceURL: string = passJson.webServiceURL;
  console.log(`\nwebServiceURL grabado en el pass: ${webServiceURL}`);

  if (!webServiceURL.startsWith('https://')) {
    console.error('FALLO: el webServiceURL no es https — Apple no registra dispositivos así.');
    fallos++;
  }

  const resWs = await fetch(`${webServiceURL.replace(/\/$/, '')}${ruta}`, { headers: auth, redirect: 'manual' });
  if (resWs.status >= 300 && resWs.status < 400) {
    console.error(
      `FALLO: el webServiceURL responde ${resWs.status} y redirige a ${resWs.headers.get('location')}.\n` +
      '       El iPhone pierde el header Authorization en ese salto y el registro devuelve 401,\n' +
      '       así que las tarjetas NUNCA se actualizan solas. Poné NEXT_PUBLIC_BASE_URL con el\n' +
      '       dominio que contesta directo y volvé a desplegar.',
    );
    fallos++;
  } else if (resWs.status !== 200) {
    console.error(`FALLO: el webServiceURL responde ${resWs.status} (se esperaba 200).`);
    fallos++;
  } else {
    console.log('OK: el webServiceURL contesta 200 directo, sin redirects.');
  }

  // 4. Peso del pass: el iPhone se lo baja ENTERO en cada cambio de puntos.
  console.log('');
  const imagenes = Object.keys(zip.files).filter((n) => n.endsWith('.png')).sort();
  for (const nombre of imagenes) {
    const bytes = (await zip.file(nombre)!.async('nodebuffer')).length;
    console.log(`  ${nombre.padEnd(16)} ${kb(bytes).padStart(8)}`);
  }
  if (buffer.length / 1024 > PESO_PASS_SOSPECHOSO_KB) {
    console.error(
      `\nAVISO: el pass pesa ${kb(buffer.length)}, más de ${PESO_PASS_SOSPECHOSO_KB} KB. El teléfono lo baja\n` +
      '       entero cada vez que se acredita un punto, así que la tarjeta va a tardar en verse\n' +
      '       actualizada. Suele ser el logo o el ícono del sello guardados demasiado grandes\n' +
      '       (mirá LADOS_MAXIMOS en lib/comercio/redimensionarImagen.ts) — volvé a subirlos.',
    );
    fallos++;
  } else {
    console.log(`\nOK: el pass pesa ${kb(buffer.length)}.`);
  }

  // 5. Registros de dispositivo: sin ninguno, no hay a quién avisarle.
  const { count } = await supabase
    .from('apple_push_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('tarjeta_id', tarjeta.id);
  console.log(
    count
      ? `OK: la tarjeta tiene ${count} dispositivo(s) registrado(s) para recibir avisos.`
      : 'AVISO: esta tarjeta no tiene ningún dispositivo registrado. Si ya la agregaste a tu\n' +
        '       Wallet, quiere decir que el registro está fallando (mirá el webServiceURL de arriba).',
  );

  process.exit(fallos > 0 ? 1 : 0);
}

main();

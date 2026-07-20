// Ejecutar vía: npm run seed-demo-owners -- "<contraseña>"
// Crea la cuenta de DUEÑO de cada comercio DEMO (una por comercio: el gate usa maybeSingle y una
// cuenta con dos comercios quedaría bloqueada). Todas comparten la contraseña que pases como
// argumento — la elegís vos en TU terminal, nunca pasa por el chat. Idempotente: si la cuenta ya
// existe en Auth se reutiliza (la contraseña NO se cambia), y la fila de owner se upsertea.
// Emails resultantes: <slug>@fmcomsolutions.com (identificadores de Auth; no necesitan buzón real).
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

const SLUGS_DEMO = [
  'cafe-aurora-demo',
  'verde-raiz-demo',
  'brasa-urbana-demo',
  'dulce-nube-demo',
  'barberia-el-puerto-demo',
];

async function main() {
  const [password] = process.argv.slice(2);
  if (!password) {
    throw new Error('Uso: npm run seed-demo-owners -- "<contraseña>"');
  }

  const supabase = createServiceClient();

  for (const slug of SLUGS_DEMO) {
    const email = `${slug}@fmcomsolutions.com`;

    const { data: comercio, error: errorComercio } = await supabase
      .from('comercios')
      .select('id, nombre')
      .eq('slug', slug)
      .maybeSingle();
    if (errorComercio) throw errorComercio;
    if (!comercio) {
      console.log(`↷ ${slug}: el comercio no existe (corré antes npm run seed-demos); se salta.`);
      continue;
    }

    const { data: creado, error: errorCrear } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    let authUserId = creado?.user?.id;
    if (errorCrear) {
      const { data: lista, error: errorLista } = await supabase.auth.admin.listUsers();
      if (errorLista) throw errorLista;
      const existente = lista.users.find((u) => u.email === email);
      if (!existente) throw errorCrear;
      authUserId = existente.id;
      console.log(`  (${email} ya existía en Auth; se reutiliza — la contraseña NO cambió)`);
    }

    // onConflict 'email': la única columna única de usuarios_comercio aparte del id.
    const { error: errorFila } = await supabase
      .from('usuarios_comercio')
      .upsert(
        { comercio_id: comercio.id, email, rol: 'owner', auth_user_id: authUserId! },
        { onConflict: 'email' },
      );
    if (errorFila) throw errorFila;

    console.log(`✓ ${comercio.nombre} → ${email}`);
  }

  console.log('\nListo. Entrá a /comercio/login con cualquiera de esos correos y la contraseña que elegiste.');
  console.log('Cada cuenta ve SOLO su comercio (su panel, su escáner, sus clientes).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

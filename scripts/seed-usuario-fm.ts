// Ejecutar vía: npm run seed-fm -- correo@ejemplo.com "contraseña"
// Crea la cuenta compartida de FM en Supabase Auth y su fila en usuarios_fm.
// Idempotente: si el correo ya existe en Auth, solo asegura la fila en usuarios_fm.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    throw new Error('Uso: npm run seed-fm -- correo@ejemplo.com "contraseña"');
  }

  const supabase = createServiceClient();

  const { data: creado, error: errorCrear } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  let authUserId = creado?.user?.id;

  if (errorCrear) {
    // Ya existe: lo buscamos en la lista de usuarios.
    const { data: lista, error: errorLista } = await supabase.auth.admin.listUsers();
    if (errorLista) throw errorLista;
    const existente = lista.users.find((u) => u.email === email);
    if (!existente) throw errorCrear;
    authUserId = existente.id;
    console.log('La cuenta ya existía en Auth; se reutiliza.');
  }

  const { error: errorFila } = await supabase
    .from('usuarios_fm')
    .upsert({ auth_user_id: authUserId!, email }, { onConflict: 'auth_user_id' });
  if (errorFila) throw errorFila;

  console.log('Listo. Cuenta de FM habilitada:', email);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

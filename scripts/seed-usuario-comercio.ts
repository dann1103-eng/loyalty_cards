// Ejecutar vía: npm run seed-comercio -- correo@ejemplo.com "contraseña" slug-del-comercio
// Crea la cuenta de un DUEÑO en Supabase Auth y su fila (rol 'owner') en usuarios_comercio.
// Idempotente: si el correo ya existe en Auth, solo asegura la fila. No envía invitación por
// correo (este proyecto no tiene servicio de email) — FM corre esto a mano al dar de alta un dueño.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

async function main() {
  const [email, password, slug] = process.argv.slice(2);
  if (!email || !password || !slug) {
    throw new Error('Uso: npm run seed-comercio -- correo@ejemplo.com "contraseña" slug-del-comercio');
  }

  const supabase = createServiceClient();

  // Resolver el comercio por slug ANTES del upsert (la fila necesita comercio_id).
  const { data: comercio, error: errorComercio } = await supabase
    .from('comercios')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (errorComercio) throw errorComercio;
  if (!comercio) throw new Error(`No existe ningún comercio con slug "${slug}".`);

  // Crear la cuenta de Auth (o reutilizar si ya existe).
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
    console.log('La cuenta ya existía en Auth; se reutiliza.');
  }

  // onConflict: 'email' — la ÚNICA columna única de usuarios_comercio aparte de id. auth_user_id
  // aquí es nullable y NO único (a diferencia de usuarios_fm), así que 'auth_user_id' fallaría.
  const { error: errorFila } = await supabase
    .from('usuarios_comercio')
    .upsert(
      { comercio_id: comercio.id, email, rol: 'owner', auth_user_id: authUserId! },
      { onConflict: 'email' },
    );
  if (errorFila) throw errorFila;

  console.log(`Listo. Dueño habilitado para "${slug}":`, email);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

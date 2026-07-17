// Ejecutar vía: npm run seed-bucket
// Crea el bucket público 'comercio-imagenes' en Supabase Storage (idempotente).
// Público de LECTURA a propósito: logo/strip/hero/ícono de sello son públicos por naturaleza
// (aparecen en la tarjeta de cualquier cliente). La ESCRITURA no pasa por RLS de Storage: va
// mediada por un Server Action con service role (spec §4.4). No se diseña un segundo modelo de
// autorización (políticas de Storage) además del gate que ya existe.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

const BUCKET = 'comercio-imagenes';

async function main() {
  const supabase = createServiceClient();

  const { error } = await supabase.storage.createBucket(BUCKET, { public: true });

  if (error) {
    // Si ya existe, es idempotente: lo reportamos y salimos OK. Cualquier otro error sí es real.
    const msg = (error.message ?? '').toLowerCase();
    if (msg.includes('already exists') || msg.includes('duplicate')) {
      console.log(`El bucket '${BUCKET}' ya existía; nada que hacer.`);
      return;
    }
    throw error;
  }

  console.log(`Bucket '${BUCKET}' creado (público de lectura).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

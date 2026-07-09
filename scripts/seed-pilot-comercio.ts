import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

async function main() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('comercios')
    .upsert(
      {
        nombre: 'Cafetería Piloto',
        slug: 'cafeteria-piloto',
        color_fondo: 'rgb(35, 24, 18)',
        color_texto: 'rgb(255, 255, 255)',
        color_label: 'rgb(255, 255, 255)',
      },
      { onConflict: 'slug' },
    )
    .select()
    .single();

  if (error) throw error;
  console.log('Comercio piloto listo:', data);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

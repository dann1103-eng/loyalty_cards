// Ejecutar vía: npm run seed
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

// OJO: re-ejecutar este script REVIERTE las columnas de branding (nombre, colores) a estos
// valores placeholder. Cuando el kit gráfico real llegue en la Fase 5, no volver a correrlo.
async function main() {
  const supabase = createServiceClient();
  const slug = 'cafeteria-piloto';
  const nombre = 'Cafetería Piloto';

  // Cuenta (cliente que paga) del piloto. Idempotente: si el comercio ya tiene cuenta, se reusa;
  // si no, se crea una (límite 1). El comercio se upsertea por slug, así que sin esto re-correr el
  // seed acumularía cuentas huérfanas.
  const { data: existente } = await supabase
    .from('comercios')
    .select('cuenta_id')
    .eq('slug', slug)
    .maybeSingle();

  let cuentaId = existente?.cuenta_id ?? null;
  if (!cuentaId) {
    const { data: cuenta, error: eCuenta } = await supabase
      .from('cuentas_comercio')
      .insert({ nombre, limite_negocios: 1 })
      .select('id')
      .single();
    if (eCuenta) throw eCuenta;
    cuentaId = cuenta.id;
  }

  const { data, error } = await supabase
    .from('comercios')
    .upsert(
      {
        nombre,
        slug,
        color_fondo: 'rgb(35, 24, 18)',
        color_texto: 'rgb(255, 255, 255)',
        color_label: 'rgb(255, 255, 255)',
        cuenta_id: cuentaId,
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

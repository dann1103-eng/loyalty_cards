// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0042.ts
// Verificación de SOLO LECTURA de la migración 0042 (TikTok en el reverso y el velo de la grilla de
// sellos): las columnas existen en las dos tablas, todos los comercios nacieron oscureciendo y
// ningún programa nació con una decisión propia.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

async function main() {
  const supabase = createServiceClient();
  let fallas = 0;
  const fallo = (m: string) => {
    console.error(`FALLO: ${m}`);
    fallas += 1;
  };

  for (const tabla of ['comercios', 'programas_tarjeta'] as const) {
    const columnas = await supabase.from(tabla).select('id, red_tiktok, oscurecer_franja').limit(1);
    if (columnas.error) {
      fallo(
        columnas.error.code === '42703'
          ? `la 0042 NO está aplicada en ${tabla} — ${columnas.error.message}`
          : `no se pudo leer ${tabla} — ${columnas.error.message}`,
      );
      continue;
    }
    console.log(`OK: ${tabla} tiene red_tiktok y oscurecer_franja.`);
  }
  if (fallas) process.exit(1);

  const cabeza = { count: 'exact', head: true } as const;
  const conteos = await Promise.all([
    supabase.from('comercios').select('id', cabeza),
    supabase.from('comercios').select('id', cabeza).eq('oscurecer_franja', false),
    supabase.from('comercios').select('id', cabeza).not('red_tiktok', 'is', null),
    supabase.from('programas_tarjeta').select('id', cabeza),
    supabase.from('programas_tarjeta').select('id', cabeza).not('oscurecer_franja', 'is', null),
  ]);
  const malo = conteos.find((r) => r.error);
  if (malo?.error) fallo('no se pudo contar — ' + malo.error.message);
  const [comercios, sinVelo, conTiktok, programas, programasDecididos] = conteos.map((r) => r.count ?? 0);
  console.log('    comercios: ' + comercios + ' — con el oscurecido apagado: ' + sinVelo + ' — con TikTok: ' + conTiktok);
  console.log('    programas: ' + programas + ' — con decisión propia sobre el oscurecido: ' + programasDecididos);

  process.exit(fallas ? 1 : 0);
}

main().catch((e) => {
  console.error('FALLO GENERAL:', e);
  process.exit(1);
});

// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0030.ts
//
// Verifica la migración 0030 (elementos libres del cartel): la columna `elementos` en
// disenos_cartel, su default '[]', y el CHECK que la acota a una LISTA de a lo sumo 12.
//
// La comprobación del CHECK es el corazón de este script y por eso escribe de verdad: un CHECK que
// no existe no se nota leyendo la columna —los inserts válidos pasan igual— y solo se delata cuando
// alguien mete un objeto donde va una lista y la pantalla revienta al dibujar.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

let fallas = 0;
const ok = (m: string) => console.log(`OK: ${m}`);
const fallo = (m: string, d?: string) => {
  console.error(`FALLO: ${m}${d ? ` — ${d}` : ''}`);
  fallas += 1;
};

async function main() {
  const supabase = createServiceClient();

  const columna = await supabase.from('disenos_cartel').select('id, elementos').limit(1);
  if (columna.error) {
    fallo('disenos_cartel no tiene la columna elementos', columna.error.message);
    process.exit(1);
  }
  ok('disenos_cartel tiene la columna elementos.');

  const fila = columna.data?.[0] as { id: string; elementos: unknown } | undefined;
  if (!fila) {
    console.log('AVISO: no hay ningún diseño de cartel guardado; no se pudo verificar el default.');
  } else if (Array.isArray(fila.elementos)) {
    ok(`elementos es una lista en las filas existentes (la leída tiene ${fila.elementos.length}).`);
  } else {
    fallo('elementos no es una lista en una fila existente', JSON.stringify(fila.elementos));
  }

  // Para probar el CHECK hace falta una fila propia: se crea contra un programa REAL (la FK lo
  // exige) y se borra al final pase lo que pase. Se elige el programa de un comercio cualquiera que
  // TODAVÍA NO tenga diseño, para no pisarle el cartel a nadie — programa_id es UNIQUE.
  const { data: programas } = await supabase
    .from('programas_tarjeta')
    .select('id, comercio_id')
    .limit(50);
  const { data: conDiseno } = await supabase.from('disenos_cartel').select('programa_id');
  const ocupados = new Set((conDiseno ?? []).map((d) => d.programa_id));
  const libre = (programas ?? []).find((p) => !ocupados.has(p.id));

  if (!libre) {
    console.log('AVISO: todos los programas ya tienen diseño; no se pudo probar el CHECK.');
  } else {
    const base = { programa_id: libre.id, comercio_id: libre.comercio_id };
    try {
      // Un objeto es `Json` válido para TypeScript —la columna es jsonb y acepta cualquier JSON—,
      // así que acá no hay error de tipos que suprimir: lo que tiene que rechazarlo es el CHECK de
      // la base, y eso es exactamente lo que esta llamada mide.
      const noEsLista = await supabase
        .from('disenos_cartel')
        .insert({ ...base, elementos: { tipo: 'texto' } });
      if (noEsLista.error) {
        ok('el CHECK rechaza un jsonb que no es una lista.');
      } else {
        fallo('la base aceptó un objeto en elementos: falta el CHECK jsonb_typeof = array');
        await supabase.from('disenos_cartel').delete().eq('programa_id', libre.id);
      }

      const trece = Array.from({ length: 13 }, () => ({
        tipo: 'franja',
        x: 0,
        y: 0,
        ancho: 1,
        alto: 1,
        color: 'rgb(0, 0, 0)',
        radio: 0,
      }));
      const demasiados = await supabase.from('disenos_cartel').insert({ ...base, elementos: trece });
      if (demasiados.error) {
        ok('el CHECK rechaza más de 12 elementos.');
      } else {
        fallo('la base aceptó 13 elementos: el tope del CHECK no coincide con MAX_ELEMENTOS');
      }

      const doce = trece.slice(0, 12);
      const valido = await supabase.from('disenos_cartel').insert({ ...base, elementos: doce });
      if (valido.error) {
        fallo('la base rechazó 12 elementos válidos', valido.error.message);
      } else {
        ok('12 elementos válidos se guardan sin problema.');
      }
    } finally {
      await supabase.from('disenos_cartel').delete().eq('programa_id', libre.id);
      ok('la fila de prueba quedó borrada.');
    }
  }

  console.log(fallas === 0 ? '\nTodo OK.' : `\n${fallas} verificación(es) fallaron.`);
  process.exit(fallas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Error inesperado:', e);
  process.exit(1);
});

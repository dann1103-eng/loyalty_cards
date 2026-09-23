// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0039.ts
// Verificación de la migración 0039 (monto mínimo de compra y reseña de Google). Además de
// confirmar que las columnas existen, intenta VIOLAR cada uno de los cinco CHECK nuevos — la única
// forma honesta de comprobar que un CHECK está activo, igual que verificar-0037.ts/verificar-0038.ts.
//
// El truco para no dejar nada escrito: cada insert de prueba usa el `slug` de un comercio que YA
// existe (leído antes con un select), más UNA sola violación del CHECK bajo prueba. Postgres evalúa
// los CHECK de una fila ANTES que los índices únicos, y `comercios` no tiene triggers (nada corre
// entre el CHECK y el índice). Entonces: si el CHECK está activo, el insert falla con 23514 antes de
// llegar al índice único del slug — no se toca la tabla. Si el CHECK faltara, el insert seguiría
// hasta el índice único de `slug` (migración 0001) y fallaría igual, con 23505 — tampoco se toca la
// tabla. En ningún caso queda una fila viva; el código que distingue ambos casos es lo que prueba si
// el CHECK está ahí.
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

  // 1. Las cuatro columnas nuevas existen. 42703 = "column does not exist": es la única señal
  // confiable de "la 0039 no está aplicada todavía"; cualquier otro error (red, credenciales) es
  // un problema distinto y lo decimos así en vez de sugerir que falta la migración.
  const columnas = await supabase
    .from('comercios')
    .select('id, exigir_monto_compra, monto_minimo_compra_centavos, pedir_resena_google, resena_google_url')
    .limit(1);
  if (columnas.error) {
    if (columnas.error.code === '42703') {
      console.error('FALLO: la migración 0039 NO está aplicada (falta al menos una columna nueva en comercios).');
      console.error(`Detalle: ${columnas.error.message}`);
    } else {
      console.error('FALLO: no se pudo verificar la migración 0039 (no parece ser una columna faltante).');
      console.error(`Detalle: ${columnas.error.message}`);
    }
    process.exit(1);
  }
  ok('comercios tiene exigir_monto_compra, monto_minimo_compra_centavos, pedir_resena_google y resena_google_url.');

  // 2. Conteos, uno por condición con count exact/head — un select sin límite corta en 1000 filas
  // (max-rows de PostgREST) y daría un conteo mentiroso en cuanto hubiera más de 1000 comercios.
  const contar = async (etiqueta: string, resultado: { count: number | null; error: { message: string } | null }) => {
    if (resultado.error) {
      fallo(`no se pudo contar (${etiqueta})`, resultado.error.message);
      return null;
    }
    return resultado.count ?? 0;
  };

  const totalComercios = await contar('total', await supabase.from('comercios').select('id', { count: 'exact', head: true }));
  const conExigirTrue = await contar(
    'exigir_monto_compra = true',
    await supabase.from('comercios').select('id', { count: 'exact', head: true }).eq('exigir_monto_compra', true),
  );
  const conMinimoNoNulo = await contar(
    'monto_minimo_compra_centavos != null',
    await supabase.from('comercios').select('id', { count: 'exact', head: true }).not('monto_minimo_compra_centavos', 'is', null),
  );
  const conPedirResenaTrue = await contar(
    'pedir_resena_google = true',
    await supabase.from('comercios').select('id', { count: 'exact', head: true }).eq('pedir_resena_google', true),
  );
  const conUrlNoNula = await contar(
    'resena_google_url != null',
    await supabase.from('comercios').select('id', { count: 'exact', head: true }).not('resena_google_url', 'is', null),
  );

  console.log(`Total de comercios: ${totalComercios ?? '(no se pudo contar)'}`);
  const reportarConteo = (etiqueta: string, valor: number | null) => {
    console.log(`  ${etiqueta}: ${valor ?? '(no se pudo contar)'}`);
    if ((valor ?? 0) > 0) console.log(`  ATENCIÓN: hay ${valor} comercio(s) que ya se apartan del default en "${etiqueta}".`);
  };
  reportarConteo('exigir_monto_compra = true', conExigirTrue);
  reportarConteo('monto_minimo_compra_centavos != null', conMinimoNoNulo);
  reportarConteo('pedir_resena_google = true', conPedirResenaTrue);
  reportarConteo('resena_google_url != null', conUrlNoNula);

  // 3. Los cinco CHECK, cada uno aislado (una sola violación por insert; el resto de columnas
  // queda en una combinación que los OTROS cuatro CHECK aceptan, para no confundir cuál falló).
  const { data: existente, error: eExistente } = await supabase.from('comercios').select('slug').limit(1).maybeSingle();
  if (eExistente) {
    fallo('no se pudo leer un comercio existente para las pruebas de CHECK', eExistente.message);
  } else if (!existente) {
    console.log('INFO: no hay ningún comercio existente en la base — se omiten las pruebas de CHECK (necesitan un slug real para no dejar nada escrito).');
  } else {
    const slug = existente.slug;

    const probarCheck = async (
      etiqueta: string,
      constraintEsperado: string,
      datos: Record<string, unknown>,
    ) => {
      const intento = await supabase
        .from('comercios')
        .insert({ nombre: `Verificación 0039 ${etiqueta} ${Date.now()}`, slug, ...datos })
        .select('id')
        .single();
      // El 23514 tiene que venir del constraint BAJO PRUEBA: si lo frenara otro CHECK, este
      // seguiría sin estar verificado aunque el insert haya fallado "bien".
      if (intento.error?.code === '23514' && intento.error.message.includes(constraintEsperado)) {
        ok(`rechaza ${etiqueta} (23514 — ${intento.error.message}).`);
      } else if (intento.error?.code === '23514') {
        fallo(`"${etiqueta}" lo frenó un CHECK distinto de ${constraintEsperado}`, intento.error.message);
      } else if (intento.error?.code === '23505') {
        fallo(`el CHECK de "${etiqueta}" (${constraintEsperado}) no está activo: el insert llegó hasta el índice único del slug (23505)`, intento.error.message);
      } else if (intento.error) {
        fallo(`insert de prueba para "${etiqueta}" falló por una razón inesperada`, intento.error.message);
      } else {
        fallo(`¡grave! el insert de prueba para "${etiqueta}" tuvo ÉXITO — quedó una fila viva, borrándola`);
        if (intento.data?.id) await supabase.from('comercios').delete().eq('id', intento.data.id);
      }
    };

    await probarCheck('monto mínimo <= 0', 'comercios_monto_minimo_compra_centavos_check', {
      exigir_monto_compra: true,
      pedir_monto_compra: true,
      monto_minimo_compra_centavos: 0,
    });
    await probarCheck('exigir sin pedir', 'comercios_exigir_implica_pedir', {
      exigir_monto_compra: true,
      pedir_monto_compra: false,
      monto_minimo_compra_centavos: null,
    });
    await probarCheck('mínimo sin exigir', 'comercios_minimo_implica_exigir', {
      exigir_monto_compra: false,
      pedir_monto_compra: true,
      monto_minimo_compra_centavos: 1000,
    });
    await probarCheck('url de reseña > 500 caracteres', 'comercios_resena_google_url_check', {
      pedir_resena_google: false,
      resena_google_url: 'x'.repeat(501),
    });
    await probarCheck('pedir reseña sin link', 'comercios_resena_con_link', {
      pedir_resena_google: true,
      resena_google_url: null,
    });
  }

  if (fallas > 0) {
    console.error(`\n${fallas} verificación(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nLa migración 0039 está aplicada y sus CHECK funcionan.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

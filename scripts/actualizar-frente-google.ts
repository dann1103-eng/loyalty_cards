// Actualiza en Google Wallet el frente de los pases YA EMITIDOS, en dos fases separadas.
//
// Por qué hace falta: un objeto de Google se re-escribe solo cuando algo mueve su saldo, y una clase
// solo cuando alguien se registra, pide su link o el dueño guarda la marca. El frente nuevo (estado
// arriba, nombre y apellido, "Powered by Cardly" bajo el QR) no llega solo a las tarjetas que nadie
// toca.
//
// Por qué dos fases y en este orden (spec 2026-09-17, "Orden de despliegue"):
//   1. Deploy A (objetos con los módulos nuevos; clase sin plantilla) → fase `objetos`, repetida hasta
//      terminar con 0 fallos que no sean estructurales.
//   2. Deploy B (la plantilla de filas en construirClase) → fase `clases`.
// La plantilla de la clase apunta a `textModulesData['estado']`, `['nombre']`, etc.: un objeto que
// todavía no los tiene se ve con filas vacías. Y la clase NO espera a este script: desde el deploy B,
// cada registro, cada "Agregar a Google Wallet" y cada guardado de marca le pone la plantilla. Por eso
// el control es el exit code de la fase objetos, que tiene que dar 0 ANTES del deploy B.
//
// Las dos fases mandan lo que arma ESTA COPIA del código (construirObjeto / construirClase), no lo
// desplegado: cada una se corre desde el commit de su deploy.
//
// Uso:
//   NEXT_PUBLIC_BASE_URL=https://www.cardly-sv.site \
//     npx tsx --conditions=react-server scripts/actualizar-frente-google.ts <objetos|clases> [--aplicar]
//
// Sin `--aplicar` es un ENSAYO: lee la base, cuenta y lista lo que tocaría, y no llama a Google.
//
// El override de NEXT_PUBLIC_BASE_URL no es opcional desde una máquina de desarrollo: las imágenes
// viajan con URL absoluta armada sobre esa variable (lib/google/heroUrl.ts) y, con localhost, Google
// RECHAZA EL PATCH ENTERO con `400 Image cannot be loaded`. El script aborta antes de leer nada si la
// base no es pública, también en el ensayo. dotenv no pisa lo que ya está en el entorno, así que la
// variable puesta en la línea de comando gana sobre .env.local.
//
// Idempotente: syncObjetoTarjeta, syncClaseComercio y syncClasePrograma hacen `patch` con el cuerpo
// completo — la MISMA llamada que dispara cada venta o cada guardado de marca. Correr una fase dos
// veces deja lo mismo que correrla una.
import { config } from 'dotenv';
config({ path: '.env.local' });

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../lib/supabase/types';
import { createServiceClient } from '../lib/supabase/server';
import { syncObjetoTarjeta } from '../lib/google/syncObjeto';
import { syncClaseComercio } from '../lib/google/syncClase';
import { syncClasePrograma } from '../lib/google/syncClasePrograma';
import { construirClase } from '../lib/google/construirRecursos';
import { esBaseUrlPublica } from '../lib/google/baseUrlPublica';

type Supabase = SupabaseClient<Database>;
type Fase = 'objetos' | 'clases';

const USO =
  'NEXT_PUBLIC_BASE_URL=https://www.cardly-sv.site npx tsx --conditions=react-server scripts/actualizar-frente-google.ts <objetos|clases> [--aplicar]';

// Fallos que REINTENTAR NO ARREGLA: dependen de los datos del comercio o del programa, no de Google.
// Copiados LITERALES de los módulos de sync y comparados por igualdad exacta. Si uno de esos módulos
// cambia el texto, el fallo cae entre los reintentables y la fase sale con exit 1: el lado seguro, que
// frena el deploy B en vez de dejarlo pasar.
const FALLOS_ESTRUCTURALES = new Set([
  // lib/google/syncObjeto.ts: la tarjeta tiene objeto pero su comercio no tiene google_class_id.
  'El comercio no tiene Google Wallet habilitado.',
  // lib/google/syncClase.ts: Google exige programLogo.
  'El comercio todavía no tiene logo; Google Wallet lo requiere.',
  // lib/google/syncClasePrograma.ts: ídem, sin logo propio ni heredado.
  'El programa no tiene logo (ni propio ni heredado); Google lo requiere.',
]);

interface Resultado {
  comercio: string;
  recurso: string;
  error: string | null; // null = actualizado
}

type RespuestaSync = { ok: true } | { ok: false; error: string };

// Las funciones de sync atrapan sus errores, pero no todo lo que corre antes de su `try` (el armado de
// la marca, por ejemplo). Una excepción suelta cortaría la fase a mitad de camino y sin resumen: se
// anota como fallo de ESE recurso y se sigue con el próximo.
async function intentar(sync: () => Promise<RespuestaSync>): Promise<string | null> {
  try {
    const res = await sync();
    return res.ok ? null : res.error;
  } catch (e) {
    return `Excepción: ${e instanceof Error ? e.message : String(e)}`;
  }
}

const TAMANO_PAGINA = 500;

// PostgREST corta cada respuesta en su max-rows (1000 en Supabase) SIN AVISAR: una sola consulta sobre
// todas las tarjetas de producción dejaría afuera las que pasen del corte, y la fase terminaría con
// "0 fallos" sin haberlas tocado. Se pagina por id (keyset, no offset: una fila que entra o sale
// durante la corrida no corre la ventana) y se corta recién con una página VACÍA, así un max-rows
// menor que TAMANO_PAGINA tampoco trunca.
async function leerPorId<T extends { id: string }>(
  pagina: (despuesDe: string | null) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const filas: T[] = [];
  let despuesDe: string | null = null;
  for (;;) {
    const respuesta: { data: T[] | null; error: { message: string } | null } = await pagina(despuesDe);
    if (respuesta.error) throw new Error(respuesta.error.message);
    const data = respuesta.data ?? [];
    if (data.length === 0) return filas;
    filas.push(...data);
    despuesDe = data[data.length - 1].id;
  }
}

function porNombre<G extends { nombre: string }>(grupos: Map<string, G>): [string, G][] {
  return [...grupos].sort((a, b) => a[1].nombre.localeCompare(b[1].nombre, 'es'));
}

function terminarEnsayo(): number {
  console.log('\nEnsayo terminado: no se llamó a Google. Para aplicar, repetí con --aplicar.');
  return 0;
}

function imprimirResumenComercio(resultados: Resultado[]): void {
  const fallos = resultados.filter((r) => r.error !== null);
  console.log(`  ok ${resultados.length - fallos.length}, fallos ${fallos.length}`);
  for (const f of fallos) console.log(`  FALLÓ ${f.recurso} — ${f.error}`);
}

// ---------------------------------------------------------------------------------------------------
// Fase objetos

interface GrupoObjetos {
  nombre: string;
  tarjetas: string[];
}

async function leerObjetos(supabase: Supabase): Promise<Map<string, GrupoObjetos>> {
  // La consulta de scripts/resincronizar-objetos-google.ts, sobre TODOS los comercios: solo tarjetas
  // que YA tienen objeto. Nunca syncObjetosComercio, que no filtra y CREARÍA objetos para las que no
  // lo tienen (esas salen con el frente nuevo solas, cuando el cliente pide su link de guardado).
  const tarjetas = await leerPorId((despuesDe) => {
    const q = supabase
      .from('tarjetas')
      .select('id, comercio_id, comercios(nombre)')
      .not('google_object_id', 'is', null);
    return (despuesDe ? q.gt('id', despuesDe) : q).order('id').limit(TAMANO_PAGINA);
  });
  const grupos = new Map<string, GrupoObjetos>();
  for (const t of tarjetas) {
    const grupo = grupos.get(t.comercio_id) ?? { nombre: t.comercios?.nombre ?? '(sin nombre)', tarjetas: [] };
    grupo.tarjetas.push(t.id);
    grupos.set(t.comercio_id, grupo);
  }
  return grupos;
}

async function faseObjetos(supabase: Supabase, aplicar: boolean): Promise<number> {
  console.log('Esta fase manda los objetos que arma ESTA copia del código: corrila desde el commit del');
  console.log('deploy A o uno posterior, nunca desde uno anterior.\n');

  const grupos = porNombre(await leerObjetos(supabase));
  const total = grupos.reduce((n, [, g]) => n + g.tarjetas.length, 0);
  console.log(`Comercios: ${grupos.length}`);
  console.log(`Objetos (tarjetas con google_object_id): ${total}`);

  if (!aplicar) {
    for (const [id, g] of grupos) console.log(`  ${g.nombre} (${id}): ${g.tarjetas.length} objeto(s)`);
    return terminarEnsayo();
  }

  const resultados: Resultado[] = [];
  for (const [id, g] of grupos) {
    console.log(`\n${g.nombre} (${id}) — ${g.tarjetas.length} objeto(s)`);
    const delComercio: Resultado[] = [];
    // En secuencia a propósito: es la misma llamada de cada venta, y en paralelo sobre todos los
    // clientes de producción se chocaría con la cuota de la API.
    for (const tarjetaId of g.tarjetas) {
      delComercio.push({
        comercio: g.nombre,
        recurso: `objeto de la tarjeta ${tarjetaId}`,
        error: await intentar(() => syncObjetoTarjeta(supabase, tarjetaId)),
      });
    }
    imprimirResumenComercio(delComercio);
    resultados.push(...delComercio);
  }
  return resumir('objetos', resultados);
}

// ---------------------------------------------------------------------------------------------------
// Fase clases

interface GrupoClases {
  nombre: string;
  claseComercio: boolean;
  programas: { id: string; nombre: string }[];
}

async function leerClases(supabase: Supabase): Promise<Map<string, GrupoClases>> {
  const comercios = await leerPorId((despuesDe) => {
    const q = supabase.from('comercios').select('id, nombre').not('google_class_id', 'is', null);
    return (despuesDe ? q.gt('id', despuesDe) : q).order('id').limit(TAMANO_PAGINA);
  });
  // SOLO programas que YA tienen clase: syncClasePrograma sobre uno sin clase la CREARÍA si su marca
  // la necesita, y una clase de Google es permanente (la API no tiene `delete`).
  // syncClasesDeProgramasConClase no sirve acá: devuelve void y solo loguea, así que no se podría
  // contar qué falló.
  const programas = await leerPorId((despuesDe) => {
    const q = supabase
      .from('programas_tarjeta')
      .select('id, nombre, comercio_id, comercios(nombre)')
      .not('google_class_id', 'is', null);
    return (despuesDe ? q.gt('id', despuesDe) : q).order('id').limit(TAMANO_PAGINA);
  });

  const grupos = new Map<string, GrupoClases>();
  for (const c of comercios) grupos.set(c.id, { nombre: c.nombre, claseComercio: true, programas: [] });
  for (const p of programas) {
    // Un programa con clase cuyo comercio no la tiene también se actualiza: sus objetos cuelgan de la
    // clase del PROGRAMA, que es la que recibe la plantilla.
    const grupo = grupos.get(p.comercio_id) ?? {
      nombre: p.comercios?.nombre ?? '(sin nombre)',
      claseComercio: false,
      programas: [],
    };
    grupo.programas.push({ id: p.id, nombre: p.nombre });
    grupos.set(p.comercio_id, grupo);
  }
  return grupos;
}

// El recordatorio de "correr desde el commit del deploy B", verificado: la clase que arma esta copia
// tiene que traer la plantilla de filas. Sin ella, la fase le haría patch a todas las clases sin
// cambiarles nada y dejaría la impresión de que ya está hecha. construirClase es pura: esto no lee
// la base ni llama a Google.
function copiaTraePlantillaDeFilas(): boolean {
  const clase = construirClase('verificacion.plantilla', {
    nombre: 'Verificación',
    colorFondo: null,
    logos: { programLogo: 'https://www.cardly-sv.site/logo.png' },
    heroUrl: null,
    ubicaciones: [],
  });
  return (clase.classTemplateInfo?.cardTemplateOverride?.cardRowTemplateInfos?.length ?? 0) > 0;
}

async function faseClases(supabase: Supabase, aplicar: boolean): Promise<number> {
  console.log('RECORDATORIO: esta fase se corre desde el commit del DEPLOY B (la plantilla de filas en');
  console.log('construirClase), y solo después de que la fase objetos terminó sin fallos de Google. Manda');
  console.log('la clase que arma ESTA copia del código, no la desplegada.\n');

  if (!copiaTraePlantillaDeFilas()) {
    if (aplicar) {
      console.error('ABORTADO: el construirClase de esta copia NO trae classTemplateInfo con filas.');
      console.error('No estás en el commit del deploy B. No se leyó la base ni se llamó a Google.');
      return 1;
    }
    console.log('ADVERTENCIA: el construirClase de esta copia NO trae la plantilla de filas. Con --aplicar,');
    console.log('el script abortaría: esta copia no es la del deploy B.\n');
  }

  const grupos = porNombre(await leerClases(supabase));
  const clasesComercio = grupos.filter(([, g]) => g.claseComercio).length;
  const clasesPrograma = grupos.reduce((n, [, g]) => n + g.programas.length, 0);
  console.log(`Comercios: ${grupos.length}`);
  console.log(`Clases de comercio (comercios con google_class_id): ${clasesComercio}`);
  console.log(`Clases de programa (programas con google_class_id): ${clasesPrograma}`);

  if (!aplicar) {
    for (const [id, g] of grupos) {
      const partes = [
        ...(g.claseComercio ? ['clase del comercio'] : []),
        ...(g.programas.length > 0 ? [`${g.programas.length} clase(s) de programa`] : []),
      ];
      console.log(`  ${g.nombre} (${id}): ${partes.join(' + ')}`);
    }
    return terminarEnsayo();
  }

  const resultados: Resultado[] = [];
  for (const [comercioId, g] of grupos) {
    console.log(`\n${g.nombre} (${comercioId})`);
    const delComercio: Resultado[] = [];
    if (g.claseComercio) {
      delComercio.push({
        comercio: g.nombre,
        recurso: 'clase del comercio',
        error: await intentar(() => syncClaseComercio(supabase, comercioId)),
      });
    }
    for (const p of g.programas) {
      delComercio.push({
        comercio: g.nombre,
        recurso: `clase del programa "${p.nombre}" (${p.id})`,
        error: await intentar(async () => {
          const res = await syncClasePrograma(supabase, comercioId, p.id);
          // `ok` con classId null significa "este programa no tiene clase propia; no se hizo nada".
          // Imposible para un programa leído con google_class_id (que nunca vuelve a null): si
          // aparece, la clase NO se tocó y no se cuenta como actualizada.
          if (res.ok && res.classId === null) {
            return { ok: false, error: 'syncClasePrograma no tocó la clase: respondió que el programa no tiene clase propia.' };
          }
          return res;
        }),
      });
    }
    imprimirResumenComercio(delComercio);
    resultados.push(...delComercio);
  }
  return resumir('clases', resultados);
}

// ---------------------------------------------------------------------------------------------------

// Imprime el resumen final y devuelve el exit code: 1 si hubo algún fallo que no sea estructural.
function resumir(fase: Fase, resultados: Resultado[]): number {
  const fallos = resultados.filter((r): r is Resultado & { error: string } => r.error !== null);
  const estructurales = fallos.filter((r) => FALLOS_ESTRUCTURALES.has(r.error));
  const reintentables = fallos.filter((r) => !FALLOS_ESTRUCTURALES.has(r.error));

  console.log(`\n===== Resumen de la fase ${fase} =====`);
  console.log(`Actualizados: ${resultados.length - fallos.length} de ${resultados.length}`);
  console.log(`Fallos estructurales (reintentar no los arregla; decidí qué hacer con cada uno): ${estructurales.length}`);
  for (const f of estructurales) console.log(`  ${f.comercio} — ${f.recurso} — ${f.error}`);
  console.log(`Fallos de Google o de lectura (se reintentan corriendo la fase de nuevo): ${reintentables.length}`);
  for (const f of reintentables) console.log(`  ${f.comercio} — ${f.recurso} — ${f.error}`);

  if (reintentables.length > 0) {
    console.error(
      fase === 'objetos'
        ? `\nEXIT 1: ${reintentables.length} fallo(s) no estructurales. NO hagas el deploy B hasta que esta fase termine sin ellos.`
        : `\nEXIT 1: ${reintentables.length} fallo(s) no estructurales. Repetí la fase clases.`,
    );
    return 1;
  }
  if (estructurales.length > 0) {
    console.log(`\nSin fallos de Google. Quedan ${estructurales.length} estructural(es): revisalos antes de seguir.`);
  } else {
    console.log('\nListo: 0 fallos.');
  }
  return 0;
}

async function main(): Promise<number> {
  const [fase, ...resto] = process.argv.slice(2);
  const aplicar = resto.length === 1 && resto[0] === '--aplicar';
  // Cualquier argumento de más o mal escrito es error, no ensayo: `--aplicr` no tiene que pasar por un
  // ensayo exitoso y hacer creer que se aplicó.
  if ((fase !== 'objetos' && fase !== 'clases') || (resto.length > 0 && !aplicar)) {
    console.error('Uso:');
    console.error(`  ${USO}`);
    console.error('Sin --aplicar es un ensayo: lee la base, cuenta lo que tocaría y no llama a Google.');
    return 1;
  }

  const base = process.env.NEXT_PUBLIC_BASE_URL;
  if (!esBaseUrlPublica(base)) {
    console.error(`ABORTADO: NEXT_PUBLIC_BASE_URL no es una URL pública con https:// (vale ${JSON.stringify(base ?? null)}).`);
    console.error('Las imágenes de los pases viajan con URL absoluta armada sobre esa variable, y con una base');
    console.error('que Google no puede descargar la API rechaza el patch ENTERO con `400 Image cannot be loaded`.');
    console.error(`Corré: ${USO}`);
    return 1;
  }

  console.log(
    aplicar
      ? `Fase ${fase} — APLICANDO sobre los pases reales.`
      : `Fase ${fase} — ENSAYO: lee la base y no llama a Google.`,
  );
  console.log(`Base de las imágenes: ${base}\n`);

  const supabase = createServiceClient();
  return fase === 'objetos' ? faseObjetos(supabase, aplicar) : faseClases(supabase, aplicar);
}

main()
  .then((codigo) => process.exit(codigo))
  .catch((e) => {
    console.error('FALLO GENERAL:', e);
    process.exit(1);
  });

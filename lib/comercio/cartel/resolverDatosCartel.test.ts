import { afterEach, describe, expect, it } from 'vitest';
import { createServiceClient } from '../../supabase/server';
import type { Database } from '../../supabase/types';
import { crearEntorno } from '../../../test/fixtures/entornoComercio';
import { crearPrograma } from '../programas';
import { resolverDatosCartel } from './resolverDatosCartel';

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

// Marca del comercio, distinta de los defaults del sistema en los tres colores: así una prueba que
// diga "heredó del comercio" no puede pasar por accidente cuando en realidad cayó al default.
const MARCA_COMERCIO = {
  nombre: 'Café de Prueba',
  color_fondo: 'rgb(59, 42, 30)',
  color_texto: 'rgb(245, 237, 224)',
  color_label: 'rgb(232, 185, 120)',
};

// `fetch` de Node resuelve el esquema data: sin tocar la red (verificado: ok=true y el content-type
// declarado), así que es la forma determinista de probar el camino FELIZ de la conversión — con una
// URL de Storage real, la prueba dependería de que el bucket esté vivo y de que la red del que
// corre la suite funcione.
//
// El origen va PERCENT-ENCODED y el esperado en base64 A PROPÓSITO: si el origen ya fuera base64,
// una mutación que devuelva la URL tal cual (`return url`, sin descargar nada) daría exactamente el
// mismo string y la prueba pasaría sin que se hubiera convertido nada.
const LOGO_ORIGEN = 'data:image/png,%89PNG';
const LOGO_ESPERADO = 'data:image/png;base64,iVBORw==';
const FOTO_ORIGEN = 'data:image/webp,RIFF';
const FOTO_ESPERADA = 'data:image/webp;base64,UklGRg==';
const LOGO_PROGRAMA_ORIGEN = 'data:image/png,ABC';
const LOGO_PROGRAMA_ESPERADO = 'data:image/png;base64,QUJD';
// Puerto 1: undici lo tiene en su lista de "bad ports", así que `fetch` falla al instante y SIN
// tocar la red (verificado: `TypeError: fetch failed` con `cause: Error: bad port`). Deliberadamente
// NO se usa un dominio inexistente (p. ej. `https://ejemplo.test/…`): hay ISPs y resolvers que
// secuestran NXDOMAIN y devuelven una página de búsqueda con 200, y entonces esta prueba fallaría
// por el DNS de quien la corre en vez de por la lógica.
const URL_INALCANZABLE = 'http://127.0.0.1:1/logo.webp';

const comerciosCreados: string[] = [];

async function armarComercio(
  campos: Partial<Database['public']['Tables']['comercios']['Insert']> = {},
): Promise<{ comercioId: string; comercioSlug: string; programaId: string }> {
  // Slug propio (y no el que inventa el fixture) para poder asertar la URL del QR carácter por
  // carácter: sin conocerlo, lo único aserteable sería "contiene /registro/", que sobrevive a casi
  // cualquier mutación de urlRegistroPrograma.
  const comercioSlug = `cartel-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const comercioId = await entorno.crearComercio({ slug: comercioSlug, ...MARCA_COMERCIO, ...campos });
  comerciosCreados.push(comercioId);
  return { comercioId, comercioSlug, programaId: entorno.obtenerProgramaPrincipal(comercioId) };
}

afterEach(async () => {
  // `limpiar()` no nombra a disenos_cartel, pero SÍ la cubre: la FK programa_id tiene
  // `on delete cascade` contra programas_tarjeta (0028) y limpiar() borra los programas por
  // comercio_id. Verificado a mano contra la base REAL el 2026-07-31: borrar el programa borró su
  // diseño; borrar el comercio directo, en cambio, ni siquiera es posible (programas_tarjeta no
  // cascadea), así que el orden de limpiar() es lo que hace que la cascada corra.
  // Igual se borra explícito acá: cuesta una consulta y no depende de que ese orden no cambie —
  // basura en disenos_cartel sería permanente y en la base real (el 2026-07-30 hubo 519 comercios
  // huérfanos por un olvido así).
  if (comerciosCreados.length) {
    const { error } = await supabase.from('disenos_cartel').delete().in('comercio_id', comerciosCreados);
    if (error) console.error('[test] no se pudo limpiar disenos_cartel:', error);
    comerciosCreados.length = 0;
  }
  await entorno.limpiar();
});

describe('resolverDatosCartel', () => {
  it('devuelve null si el programa NO pertenece al comercio (chequeo de propiedad)', async () => {
    const propio = await armarComercio();
    const ajeno = await armarComercio();

    // El id del programa del PRIMER comercio, presentado como si fuera del segundo: es exactamente
    // lo que puede hacer un dueño editando el [id] de la URL. Sin el .eq('comercio_id') sobre
    // programas_tarjeta, esto devolvería el cartel de un comercio ajeno.
    const r = await resolverDatosCartel(supabase, ajeno.comercioId, propio.programaId);

    expect(r, 'un programa de otro comercio no puede resolverse').toBeNull();
  });

  it('sin fila en disenos_cartel, hereda la marca del comercio y usa los defaults del sistema', async () => {
    const { comercioId, comercioSlug, programaId } = await armarComercio();

    const r = await resolverDatosCartel(supabase, comercioId, programaId);

    expect(r).not.toBeNull();
    expect(r!.datos.nombreComercio).toBe('Café de Prueba');
    expect(r!.datos.plantilla).toBe('centrado');
    expect(r!.datos.colorFondo).toBe('rgb(59, 42, 30)');
    expect(r!.datos.colorTexto).toBe('rgb(245, 237, 224)');
    expect(r!.datos.colorLabel).toBe('rgb(232, 185, 120)');
    expect(r!.datos.textoCta).toBe('¡Escaneá y sumate!');
    expect(r!.datos.textoTeaser).toBeNull();
    // El principal NO lleva su slug en la URL (es el QR "del comercio"). Se compara la RUTA
    // completa, no un `toContain('/registro/')` ni un `endsWith(...)` booleano: lo primero deja
    // pasar un '/principal' colgado al final, y lo segundo falla con un inútil "expected false to
    // be true" que no dice qué URL salió.
    expect(new URL(r!.datos.urlRegistro).pathname).toBe(`/registro/${comercioSlug}`);
  });

  it('la fila de disenos_cartel PISA lo heredado, campo por campo', async () => {
    const { comercioId, programaId } = await armarComercio();
    const { error } = await supabase.from('disenos_cartel').insert({
      programa_id: programaId,
      comercio_id: comercioId,
      plantilla: 'split',
      color_fondo: 'rgb(0, 0, 0)',
      texto_cta: 'Sumate al club',
      texto_teaser: 'Tu 5to café gratis',
    });
    expect(error, 'el diseño de prueba tiene que haberse guardado').toBeNull();

    const r = await resolverDatosCartel(supabase, comercioId, programaId);

    expect(r!.datos.plantilla).toBe('split');
    expect(r!.datos.colorFondo, 'el override guardado gana').toBe('rgb(0, 0, 0)');
    expect(r!.datos.colorTexto, 'lo que el diseño dejó en null se hereda igual').toBe(
      'rgb(245, 237, 224)',
    );
    expect(r!.datos.textoCta).toBe('Sumate al club');
    expect(r!.datos.textoTeaser).toBe('Tu 5to café gratis');
    // `marcaEfectiva` es la marca SIN overrides: es lo que la pantalla usa para el toggle "volver a
    // mi marca", así que no puede contaminarse con el color del cartel.
    expect(r!.marcaEfectiva.colorFondo, 'la marca de referencia ignora el override').toBe(
      'rgb(59, 42, 30)',
    );
  });

  it('un programa con marca propia usa SUS colores y SU logo, no los del comercio', async () => {
    const { comercioId, programaId } = await armarComercio({ logo_url: LOGO_ORIGEN });
    // Branding por programa (migración 0027): el cartel de un programa con marca propia tiene que
    // salir con esa marca, igual que su pase de Apple/Google.
    const { error } = await supabase
      .from('programas_tarjeta')
      .update({
        branding_propio: true,
        color_fondo: 'rgb(9, 9, 9)',
        logo_url: LOGO_PROGRAMA_ORIGEN,
      })
      .eq('id', programaId);
    expect(error).toBeNull();

    const r = await resolverDatosCartel(supabase, comercioId, programaId);

    expect(r!.datos.colorFondo, 'el color del programa manda sobre el del comercio').toBe(
      'rgb(9, 9, 9)',
    );
    expect(r!.datos.colorTexto, 'lo que el programa no define lo hereda del comercio').toBe(
      'rgb(245, 237, 224)',
    );
    expect(r!.datos.logoDataUri, 'el logo bajado es el del programa').toBe(LOGO_PROGRAMA_ESPERADO);
    expect(r!.marcaEfectiva.colorFondo).toBe('rgb(9, 9, 9)');
  });

  it('un programa con el interruptor de marca propia APAGADO usa la marca del comercio', async () => {
    const { comercioId, programaId } = await armarComercio();
    // Columnas cargadas pero branding_propio en false: el interruptor manda SOBRE los campos
    // (brandingEfectivo), así que apagar la marca propia no obliga al dueño a limpiar cada columna.
    const { error } = await supabase
      .from('programas_tarjeta')
      .update({ branding_propio: false, color_fondo: 'rgb(9, 9, 9)' })
      .eq('id', programaId);
    expect(error).toBeNull();

    const r = await resolverDatosCartel(supabase, comercioId, programaId);

    expect(r!.datos.colorFondo, 'con el interruptor apagado, el color del programa no se mira').toBe(
      'rgb(59, 42, 30)',
    );
  });

  it('la URL del QR de un programa NO principal lleva su propio slug', async () => {
    const { comercioId, comercioSlug } = await armarComercio();
    const creado = await crearPrograma(supabase, comercioId, {
      nombre: 'Cupon de bienvenida',
      tipoTarjeta: 'cupon',
      cashbackPorcentaje: null,
      multipassVisitas: null,
      membresiaDias: null,
      cuponVigenciaDias: 30,
    });
    if (!creado.ok) throw new Error(creado.error);
    const { data: programa } = await supabase
      .from('programas_tarjeta')
      .select('slug')
      .eq('id', creado.id)
      .single();

    const r = await resolverDatosCartel(supabase, comercioId, creado.id);

    expect(new URL(r!.datos.urlRegistro).pathname).toBe(
      `/registro/${comercioSlug}/${programa!.slug}`,
    );
  });

  it('convierte el logo y la foto a data URI con sus bytes reales', async () => {
    const { comercioId, programaId } = await armarComercio({
      logo_url: LOGO_ORIGEN,
      hero_url: FOTO_ORIGEN,
    });

    const r = await resolverDatosCartel(supabase, comercioId, programaId);

    // El SVG del cartel NUNCA recibe una URL remota (spec §4.1): un renderizador de servidor puede
    // no resolver referencias externas y la imagen desaparecería en silencio del PNG/PDF.
    expect(r!.datos.logoDataUri).toBe(LOGO_ESPERADO);
    expect(r!.datos.fotoDataUri).toBe(FOTO_ESPERADA);
  });

  it('si la imagen no se puede descargar, sigue adelante sin ella (best-effort)', async () => {
    // Los DOS modos de falla del spec §7, en un mismo cartel: la red que revienta (el logo) y el
    // archivo borrado del bucket (la foto — Storage contesta 400 con un JSON de error, no un 200
    // vacío, así que sin el chequeo de `respuesta.ok` el cartel embebería ese JSON como si fuera
    // una imagen).
    const { comercioId, programaId } = await armarComercio({
      logo_url: URL_INALCANZABLE,
      hero_url: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/comercio-imagenes/no-existe-jamas.png`,
    });

    const r = await resolverDatosCartel(supabase, comercioId, programaId);

    // Una imagen faltante NUNCA bloquea la descarga del cartel — se arma sin ella.
    expect(r, 'un logo que no se baja no puede tumbar el cartel entero').not.toBeNull();
    expect(r!.datos.logoDataUri, 'la red que falla no deja un data URI a medias').toBeNull();
    expect(r!.datos.fotoDataUri, 'un 400 del bucket no es una imagen').toBeNull();
    expect(r!.datos.colorFondo).toBe('rgb(59, 42, 30)');
  });

  it('programaActivo refleja el estado real del programa', async () => {
    const { comercioId, programaId } = await armarComercio();

    const activo = await resolverDatosCartel(supabase, comercioId, programaId);
    expect(activo!.programaActivo).toBe(true);

    await supabase.from('programas_tarjeta').update({ activo: false }).eq('id', programaId);
    const inactivo = await resolverDatosCartel(supabase, comercioId, programaId);

    // La pantalla sigue siendo accesible con un programa desactivado (spec §7 — el dueño puede
    // querer archivar o reimprimir el diseño): resolverDatosCartel no lo excluye, solo informa su
    // estado para que la UI muestre el aviso de que ese QR ya no registra clientes.
    expect(inactivo, 'un programa desactivado se sigue pudiendo resolver').not.toBeNull();
    expect(inactivo!.programaActivo).toBe(false);
  });
});

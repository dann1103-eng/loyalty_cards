import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServiceClient } from '@/lib/supabase/server';
import { rutaImagenCartel } from '@/lib/comercio/imagenComercio';
import { crearEntorno } from '@/test/fixtures/entornoComercio';

// El gate del dueño se mockea porque necesita cookies de una request real: lo que estas pruebas
// verifican NO es el gate (que ya vive en verifyComercioOwner y se prueba aparte), sino que el
// comercioId que sale de él sea lo ÚNICO que decide sobre qué fila se escribe. Por eso el mock
// devuelve un comercioId controlado por la prueba: así se puede presentar el programa de un comercio
// como si fuera de otro, que es exactamente lo que puede hacer un dueño editando el [id] de la URL.
const { sesion } = vi.hoisted(() => ({ sesion: { comercioId: '' } }));
vi.mock('@/lib/comercio/verifyComercioOwner', () => ({
  verifyComercioOwner: async () => ({ comercioId: sesion.comercioId }),
}));
// revalidatePath necesita el store de request de Next; fuera de una request lanza. No es lo que se
// está probando acá.
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);
const BUCKET_IMAGENES = 'comercio-imagenes';
const comerciosCreados: string[] = [];
const programasCreados: string[] = [];

async function armarComercio(): Promise<{ comercioId: string; programaId: string }> {
  const comercioId = await entorno.crearComercio();
  const programaId = entorno.obtenerProgramaPrincipal(comercioId);
  comerciosCreados.push(comercioId);
  programasCreados.push(programaId);
  return { comercioId, programaId };
}

function formulario(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [clave, valor] of Object.entries(campos)) fd.append(clave, valor);
  return fd;
}

// Lo que quedó GUARDADO, que es lo único que importa: el valor de retorno de la acción puede decir
// { ok: true } y no haber escrito la fila correcta.
async function leerDiseno(programaId: string) {
  const { data } = await supabase
    .from('disenos_cartel')
    .select('plantilla, color_fondo, color_texto, color_label, logo_url, texto_cta, texto_teaser')
    .eq('programa_id', programaId)
    .maybeSingle();
  return data;
}

async function contarDisenos(programaId: string): Promise<number> {
  const { count } = await supabase
    .from('disenos_cartel')
    .select('id', { count: 'exact', head: true })
    .eq('programa_id', programaId);
  return count ?? 0;
}

beforeEach(() => {
  sesion.comercioId = '';
});

afterEach(async () => {
  // Igual que en resolverDatosCartel.test.ts: la cascada de la 0028 la cubriría, pero borrarla
  // explícito no depende del orden interno de limpiar() — y basura en disenos_cartel sería
  // permanente y en la base REAL.
  if (comerciosCreados.length) {
    const { error } = await supabase.from('disenos_cartel').delete().in('comercio_id', comerciosCreados);
    if (error) console.error('[test] no se pudo limpiar disenos_cartel:', error);

    // Ninguna prueba verde de este archivo sube nada a Storage (el camino feliz de la subida no se
    // ejerce: pide un round-trip al bucket REAL por cada corrida). Esto existe para el día en que
    // el chequeo de propiedad de accionSubirLogoCartel se rompa: sin el guard, la prueba del
    // programa ajeno llega hasta el upload y dejaría un archivo huérfano en el bucket de
    // producción. Se barre el producto cruzado comercio × programa porque justamente ese caso
    // combina el comercio de la SESIÓN con el programa de OTRO. Borrar de más no falla.
    const rutas = comerciosCreados.flatMap((comercioId) =>
      programasCreados.flatMap((programaId) =>
        ['png', 'jpg', 'webp'].map((ext) => rutaImagenCartel(comercioId, programaId, ext)),
      ),
    );
    const { error: eStorage } = await supabase.storage.from(BUCKET_IMAGENES).remove(rutas);
    if (eStorage) console.error('[test] no se pudo limpiar el bucket:', eStorage);

    comerciosCreados.length = 0;
    programasCreados.length = 0;
  }
  await entorno.limpiar();
});

describe('accionGuardarCartel', () => {
  it('rechaza un programa de OTRO comercio y no escribe nada', async () => {
    const { accionGuardarCartel } = await import('./actions');
    const propio = await armarComercio();
    const ajeno = await armarComercio();
    sesion.comercioId = ajeno.comercioId;

    // El id del programa del PRIMER comercio, presentado por la sesión del SEGUNDO: es lo que se
    // consigue editando el [id] de la URL a mano.
    const r = await accionGuardarCartel(propio.programaId, undefined, formulario({
      plantilla: 'split',
      texto_cta: 'Cartel intruso',
    }));

    expect(r).toEqual({ error: 'Ese programa no es de tu comercio.' });
    expect(await leerDiseno(propio.programaId), 'no puede haberse creado ninguna fila').toBeNull();
  });

  it('guarda plantilla, textos y colores personalizados', async () => {
    const { accionGuardarCartel } = await import('./actions');
    const { comercioId, programaId } = await armarComercio();
    sesion.comercioId = comercioId;

    const r = await accionGuardarCartel(programaId, undefined, formulario({
      plantilla: 'split',
      personalizar: 'on',
      color_fondo: 'rgb(1, 2, 3)',
      color_texto: 'rgb(4, 5, 6)',
      color_label: 'rgb(7, 8, 9)',
      texto_cta: 'Sumate al club',
      texto_teaser: 'Tu 5to café gratis',
    }));

    expect(r).toEqual({ ok: true });
    const fila = await leerDiseno(programaId);
    expect(fila?.plantilla).toBe('split');
    expect(fila?.color_fondo).toBe('rgb(1, 2, 3)');
    expect(fila?.color_texto).toBe('rgb(4, 5, 6)');
    expect(fila?.color_label).toBe('rgb(7, 8, 9)');
    expect(fila?.texto_cta).toBe('Sumate al club');
    expect(fila?.texto_teaser).toBe('Tu 5to café gratis');
  });

  it('apagar la personalización BORRA los overrides de color guardados', async () => {
    const { accionGuardarCartel } = await import('./actions');
    const { comercioId, programaId } = await armarComercio();
    sesion.comercioId = comercioId;

    await accionGuardarCartel(programaId, undefined, formulario({
      plantilla: 'centrado',
      personalizar: 'on',
      color_fondo: 'rgb(1, 2, 3)',
      color_texto: 'rgb(4, 5, 6)',
      color_label: 'rgb(7, 8, 9)',
      texto_cta: 'Sumate',
    }));

    // Sin la casilla marcada, el navegador NO manda la clave `personalizar`. Los colores SÍ se
    // mandan igual a propósito: un Server Action es un endpoint que recibe el FormData que sea, y
    // así la única línea que puede borrar los overrides es el `personalizar ? … : null`. Si la
    // prueba omitiera también los colores, borrar ese condicional la dejaría verde (los campos
    // ausentes ya dan null por su cuenta) y no estaría probando nada.
    const r = await accionGuardarCartel(programaId, undefined, formulario({
      plantilla: 'centrado',
      color_fondo: 'rgb(1, 2, 3)',
      color_texto: 'rgb(4, 5, 6)',
      color_label: 'rgb(7, 8, 9)',
      texto_cta: 'Sumate',
    }));

    expect(r).toEqual({ ok: true });
    const fila = await leerDiseno(programaId);
    // Los overrides se BORRAN, no se ocultan (spec §6.3): si el dueño vuelve a prender la
    // personalización, los selectores parten de su marca ACTUAL, nunca de un color viejo escondido.
    expect(fila?.color_fondo, 'el override viejo tiene que quedar borrado').toBeNull();
    expect(fila?.color_texto).toBeNull();
    expect(fila?.color_label).toBeNull();
  });

  it('con la personalización prendida pero un color en blanco, guarda null (= heredá)', async () => {
    const { accionGuardarCartel } = await import('./actions');
    const { comercioId, programaId } = await armarComercio();
    sesion.comercioId = comercioId;

    const r = await accionGuardarCartel(programaId, undefined, formulario({
      plantilla: 'centrado',
      personalizar: 'on',
      color_fondo: '   ',
      color_texto: 'rgb(4, 5, 6)',
      color_label: '',
      texto_cta: 'Sumate',
      texto_teaser: '   ',
    }));

    expect(r).toEqual({ ok: true });
    const fila = await leerDiseno(programaId);
    // combinarDatosCartel trata ''/'   ' como "heredá"; si acá se guardara la cadena en blanco tal
    // cual, la fila diría "override configurado" y el cartel dependería de que la capa de lectura
    // siga normalizando. El contrato es que en la BD solo hay null o un color de verdad.
    expect(fila?.color_fondo, 'en blanco se guarda como null, no como cadena vacía').toBeNull();
    expect(fila?.color_texto).toBe('rgb(4, 5, 6)');
    expect(fila?.color_label).toBeNull();
    expect(fila?.texto_teaser, 'un teaser en blanco es "sin teaser"').toBeNull();
  });

  it('rechaza un llamado a la acción vacío sin tocar lo ya guardado', async () => {
    const { accionGuardarCartel } = await import('./actions');
    const { comercioId, programaId } = await armarComercio();
    sesion.comercioId = comercioId;

    await accionGuardarCartel(programaId, undefined, formulario({
      plantilla: 'centrado',
      texto_cta: 'Sumate al club',
    }));

    const r = await accionGuardarCartel(programaId, undefined, formulario({
      plantilla: 'split',
      texto_cta: '   ',
    }));

    // La BD tiene un CHECK (btrim(texto_cta) <> ''), pero eso daría un error crudo de Postgres al
    // dueño; acá se corta antes y con un mensaje que se entiende.
    expect(r).toEqual({ error: 'El texto del llamado a la acción no puede quedar vacío.' });
    const fila = await leerDiseno(programaId);
    expect(fila?.texto_cta, 'el guardado anterior no se toca').toBe('Sumate al club');
    expect(fila?.plantilla, 'ni la plantilla del intento rechazado').toBe('centrado');
  });

  it('rechaza una plantilla inventada', async () => {
    const { accionGuardarCartel } = await import('./actions');
    const { comercioId, programaId } = await armarComercio();
    sesion.comercioId = comercioId;

    const r = await accionGuardarCartel(programaId, undefined, formulario({
      plantilla: 'holograma',
      texto_cta: 'Sumate',
    }));

    expect(r).toEqual({ error: 'Plantilla no válida.' });
    expect(await leerDiseno(programaId)).toBeNull();
  });

  it('guardar dos veces actualiza la MISMA fila, no crea una segunda', async () => {
    const { accionGuardarCartel } = await import('./actions');
    const { comercioId, programaId } = await armarComercio();
    sesion.comercioId = comercioId;

    await accionGuardarCartel(programaId, undefined, formulario({
      plantilla: 'centrado',
      texto_cta: 'Primero',
    }));
    const r = await accionGuardarCartel(programaId, undefined, formulario({
      plantilla: 'split',
      texto_cta: 'Segundo',
    }));

    expect(r).toEqual({ ok: true });
    expect(await contarDisenos(programaId), 'un programa tiene UN diseño de cartel').toBe(1);
    const fila = await leerDiseno(programaId);
    expect(fila?.texto_cta).toBe('Segundo');
    expect(fila?.plantilla).toBe('split');
  });

  it('guardar colores y textos NO borra el logo propio ya subido', async () => {
    const { accionGuardarCartel } = await import('./actions');
    const { comercioId, programaId } = await armarComercio();
    sesion.comercioId = comercioId;

    const { error } = await supabase.from('disenos_cartel').insert({
      programa_id: programaId,
      comercio_id: comercioId,
      logo_url: 'https://ejemplo.test/logo-del-cartel.png',
      texto_cta: 'Sumate',
    });
    expect(error, 'el diseño de prueba tiene que haberse guardado').toBeNull();

    await accionGuardarCartel(programaId, undefined, formulario({
      plantilla: 'foto',
      personalizar: 'on',
      color_fondo: 'rgb(1, 2, 3)',
      texto_cta: 'Sumate ya',
    }));

    const fila = await leerDiseno(programaId);
    // El motivo de escribir columna por columna en vez de un .upsert(): este formulario no manda
    // logo_url, y un upsert podría dejarlo en null. El dueño vería DESAPARECER el logo que subió,
    // sin un solo error, por haber tocado un color.
    expect(fila?.logo_url, 'el logo del cartel sobrevive a guardar colores').toBe(
      'https://ejemplo.test/logo-del-cartel.png',
    );
    expect(fila?.color_fondo).toBe('rgb(1, 2, 3)');
  });
});

describe('accionSubirLogoCartel', () => {
  it('rechaza un programa de OTRO comercio antes de tocar Storage', async () => {
    const { accionSubirLogoCartel } = await import('./actions');
    const propio = await armarComercio();
    const ajeno = await armarComercio();
    sesion.comercioId = ajeno.comercioId;

    const fd = new FormData();
    fd.append('archivo', new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' }));

    const r = await accionSubirLogoCartel(propio.programaId, undefined, fd);

    expect(r).toEqual({ error: 'Ese programa no es de tu comercio.' });
    expect(await leerDiseno(propio.programaId), 'no se crea la fila del cartel ajeno').toBeNull();
  });

  it('rechaza un archivo que no es una imagen permitida', async () => {
    const { accionSubirLogoCartel } = await import('./actions');
    const { comercioId, programaId } = await armarComercio();
    sesion.comercioId = comercioId;

    const fd = new FormData();
    fd.append('archivo', new File([new Uint8Array([1, 2, 3])], 'cartel.pdf', { type: 'application/pdf' }));

    const r = await accionSubirLogoCartel(programaId, undefined, fd);

    expect(r).toEqual({ error: 'Formato no permitido. Usa PNG, JPG o WebP.' });
    expect(await leerDiseno(programaId)).toBeNull();
  });

  it('avisa cuando no llegó ningún archivo', async () => {
    const { accionSubirLogoCartel } = await import('./actions');
    const { comercioId, programaId } = await armarComercio();
    sesion.comercioId = comercioId;

    const r = await accionSubirLogoCartel(programaId, undefined, new FormData());

    expect(r).toEqual({ error: 'No se recibió ninguna imagen.' });
  });
});

describe('accionQuitarLogoCartel', () => {
  it('deja el logo del cartel en null (vuelve a heredar el de la marca)', async () => {
    const { accionQuitarLogoCartel } = await import('./actions');
    const { comercioId, programaId } = await armarComercio();
    sesion.comercioId = comercioId;

    await supabase.from('disenos_cartel').insert({
      programa_id: programaId,
      comercio_id: comercioId,
      logo_url: 'https://ejemplo.test/logo-del-cartel.png',
      texto_cta: 'Sumate',
    });

    const r = await accionQuitarLogoCartel(programaId, undefined, new FormData());

    expect(r).toEqual({ ok: true });
    const fila = await leerDiseno(programaId);
    expect(fila?.logo_url).toBeNull();
    expect(fila?.texto_cta, 'quitar el logo no toca el resto del diseño').toBe('Sumate');
  });

  it('un comercio ajeno no puede quitarle el logo al cartel de otro', async () => {
    const { accionQuitarLogoCartel } = await import('./actions');
    const propio = await armarComercio();
    const ajeno = await armarComercio();

    await supabase.from('disenos_cartel').insert({
      programa_id: propio.programaId,
      comercio_id: propio.comercioId,
      logo_url: 'https://ejemplo.test/logo-del-cartel.png',
      texto_cta: 'Sumate',
    });

    sesion.comercioId = ajeno.comercioId;
    const r = await accionQuitarLogoCartel(propio.programaId, undefined, new FormData());

    expect(r).toEqual({ error: 'Ese programa no es de tu comercio.' });
    // El UPDATE filtra solo por programa_id: lo único que impide borrarle el logo a un cartel ajeno
    // es el chequeo de propiedad de arriba. Sin él, este borrado pasaría.
    const fila = await leerDiseno(propio.programaId);
    expect(fila?.logo_url, 'el logo del cartel ajeno sigue intacto').toBe(
      'https://ejemplo.test/logo-del-cartel.png',
    );
  });
});

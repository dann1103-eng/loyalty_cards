import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { syncClasePrograma, syncClasesDeProgramasConClase } from './syncClasePrograma';

// walletClient MOCKEADO, nunca Google real: las LoyaltyClass NO se pueden borrar (la API no tiene
// `delete`), así que una prueba que llamara de verdad dejaría basura permanente y visible para el
// revisor de Google en cada corrida. Es política escrita del proyecto — ver CLAUDE.md.
const insertMock = vi.fn();
const patchMock = vi.fn();

vi.mock('./walletClient', () => ({
  issuerId: () => 'issuer-test',
  walletClient: () => ({
    loyaltyclass: { insert: insertMock, patch: patchMock },
  }),
}));

// La medición del logo, mockeada: los logos de prueba son URLs falsas y nada baja de la red. Por
// defecto "no se pudo medir".
const medidasLogoMock = vi.fn();
vi.mock('./logoRemoto', () => ({
  medidasLogo: (...args: unknown[]) => medidasLogoMock(...args),
}));

const supabase = createServiceClient();
let comercioId: string | null = null;
let programaId: string | null = null;

// NEXT_PUBLIC_BASE_URL lo fija la prueba de la portada compuesta: se restaura para no filtrarlo al
// resto de la suite.
const BASE_ORIGINAL = process.env.NEXT_PUBLIC_BASE_URL;

beforeEach(() => {
  insertMock.mockReset().mockResolvedValue({});
  patchMock.mockReset().mockResolvedValue({});
  medidasLogoMock.mockReset().mockResolvedValue(null);
});

afterEach(async () => {
  if (BASE_ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
  else process.env.NEXT_PUBLIC_BASE_URL = BASE_ORIGINAL;
  if (programaId) await supabase.from('programas_tarjeta').delete().eq('id', programaId);
  if (comercioId) await supabase.from('comercios').delete().eq('id', comercioId);
  programaId = null;
  comercioId = null;
});

async function crearEscenario(programa: Record<string, unknown>) {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data: com, error: eC } = await supabase
    .from('comercios')
    .insert({
      nombre: 'Comercio Clase',
      slug: `test-clase-prog-${sufijo}`,
      logo_url: 'https://ejemplo.com/logo-comercio.png',
      google_class_id: 'issuer-test.comercio_x',
    })
    .select('id')
    .single();
  if (eC) throw eC;
  comercioId = com.id;

  const { data: prog, error: eP } = await supabase
    .from('programas_tarjeta')
    .insert({
      comercio_id: com.id,
      nombre: 'Secundario',
      slug: `sec-${sufijo}`,
      tipo_tarjeta: 'cupon',
      es_principal: false,
      ...programa,
    })
    .select('id')
    .single();
  if (eP) throw eP;
  programaId = prog.id;
  return prog.id;
}

describe('syncClasePrograma', () => {
  it('sin branding propio: NO crea ninguna clase en Google', async () => {
    // El caso que protege el emisor de producción. Cada clase creada es PERMANENTE, así que un
    // programa que hereda todo no debe generar ninguna: sus objetos siguen colgando de la clase
    // del comercio.
    const id = await crearEscenario({ branding_propio: false, color_fondo: 'rgb(1,2,3)' });

    const res = await syncClasePrograma(supabase, comercioId!, id);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.classId).toBeNull();
    expect(insertMock).not.toHaveBeenCalled();
    expect(patchMock).not.toHaveBeenCalled();
  }, 30_000);

  it('con branding propio pero SIN los tres campos de Google: tampoco crea clase', async () => {
    // color_texto y sello_icono_url no llegan a la LoyaltyClass: viven en el .pkpass y en el
    // heroImage del objeto. Crear una clase permanente por ellos sería basura irreversible.
    const id = await crearEscenario({
      branding_propio: true,
      color_texto: 'rgb(9,9,9)',
      sello_icono_url: 'https://ejemplo.com/s.png',
    });

    const res = await syncClasePrograma(supabase, comercioId!, id);

    expect(insertMock).not.toHaveBeenCalled();
    if (res.ok) expect(res.classId).toBeNull();
  }, 30_000);

  it('con color de fondo propio: crea la clase y guarda su id en el programa', async () => {
    const id = await crearEscenario({ branding_propio: true, color_fondo: 'rgb(255,0,0)' });

    const res = await syncClasePrograma(supabase, comercioId!, id);

    expect(insertMock).toHaveBeenCalledOnce();
    expect(patchMock).not.toHaveBeenCalled();
    const esperado = `issuer-test.programa_${id}`;
    if (res.ok) expect(res.classId).toBe(esperado);
    const { data } = await supabase
      .from('programas_tarjeta')
      .select('google_class_id')
      .eq('id', id)
      .single();
    expect(data!.google_class_id).toBe(esperado);
  }, 30_000);

  it('con foto propia: la clase apunta a la portada COMPUESTA de ESE programa, no a la foto cruda', async () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site';
    const id = await crearEscenario({ branding_propio: true, hero_url: 'https://ejemplo.com/hero-prog.jpg' });

    await syncClasePrograma(supabase, comercioId!, id);

    const uri = insertMock.mock.calls[0][0].requestBody.heroImage.sourceUri.uri;
    expect(uri).toMatch(
      new RegExp(`^https://www\\.cardly-sv\\.site/api/comercios/${comercioId}/franja\\.png\\?programa=${id}&v=[0-9a-f]{12}$`),
    );
  }, 30_000);

  // La clase del programa lleva los logos compuestos de ESE programa: `?programa=` para que la ruta
  // resuelva la misma marca efectiva, y medidos sobre SU logo.
  //
  // MUTACIÓN corrida el 2026-09-23 (restaurada y comparada con el índice de git): armar los logos con el
  // del COMERCIO, `logoUrl: c.logo_url ?? marca.logoUrl` → FALLA esta prueba con `expected "vi.fn()" to
  // be called with arguments: [ 'https://ejemplo.com/logo-prog.png' ]`.
  it('con logo propio: programLogo al logo compuesto del programa (?programa=), medido sobre SU logo', async () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site';
    medidasLogoMock.mockResolvedValue({ ancho: 480, alto: 160 });
    const id = await crearEscenario({ branding_propio: true, logo_url: 'https://ejemplo.com/logo-prog.png' });

    await syncClasePrograma(supabase, comercioId!, id);

    const cuerpo = insertMock.mock.calls[0][0].requestBody;
    expect(cuerpo.programLogo.sourceUri.uri).toMatch(
      new RegExp(`^https://www\\.cardly-sv\\.site/api/comercios/${comercioId}/logo\\.png\\?programa=${id}&v=[0-9a-f]{12}$`),
    );
    expect(cuerpo.wideProgramLogo.sourceUri.uri).toMatch(
      new RegExp(`^https://www\\.cardly-sv\\.site/api/comercios/${comercioId}/logo-ancho\\.png\\?programa=${id}&v=[0-9a-f]{12}$`),
    );
    expect(medidasLogoMock).toHaveBeenCalledWith('https://ejemplo.com/logo-prog.png');
  }, 30_000);

  it('logo medido y NO ancho: el patch de la clase del programa lleva wideProgramLogo === null', async () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site';
    medidasLogoMock.mockResolvedValue({ ancho: 300, alto: 300 });
    const id = await crearEscenario({
      branding_propio: true,
      color_fondo: 'rgb(255,0,0)',
      google_class_id: 'issuer-test.programa_ya_existe',
    });

    await syncClasePrograma(supabase, comercioId!, id);

    const cuerpo = patchMock.mock.calls[0][0].requestBody;
    expect('wideProgramLogo' in cuerpo).toBe(true);
    expect(cuerpo.wideProgramLogo).toBeNull();
    // Sin logo propio: hereda (y mide) el del comercio.
    expect(medidasLogoMock).toHaveBeenCalledWith('https://ejemplo.com/logo-comercio.png');
  }, 30_000);

  it('si el programa YA tiene google_class_id: patch, nunca un segundo insert', async () => {
    const id = await crearEscenario({
      branding_propio: true,
      color_fondo: 'rgb(255,0,0)',
      google_class_id: 'issuer-test.programa_ya_existe',
    });

    await syncClasePrograma(supabase, comercioId!, id);

    expect(patchMock).toHaveBeenCalledOnce();
    expect(insertMock).not.toHaveBeenCalled();
  }, 30_000);

  // LA prueba que justifica los dos estados separados del modelo de datos.
  //
  // Si al apagar el branding propio se pusiera google_class_id de vuelta en null, reencenderlo
  // haría un `insert` sobre un id que YA existe en Google — y no se puede limpiar borrando la
  // clase, porque la API no tiene delete. Quedaría un error permanente e irreparable.
  it('el ciclo encender → apagar → reencender NUNCA intenta un segundo insert', async () => {
    const id = await crearEscenario({ branding_propio: true, color_fondo: 'rgb(255,0,0)' });

    // 1. Encender: crea la clase.
    await syncClasePrograma(supabase, comercioId!, id);
    expect(insertMock).toHaveBeenCalledOnce();

    // 2. Apagar el branding propio. google_class_id NO se toca: la clase sigue existiendo.
    await supabase.from('programas_tarjeta').update({ branding_propio: false }).eq('id', id);
    await syncClasePrograma(supabase, comercioId!, id);
    const { data: tras } = await supabase
      .from('programas_tarjeta')
      .select('google_class_id')
      .eq('id', id)
      .single();
    expect(tras!.google_class_id, 'apagar NO debe borrar el id: la clase existe para siempre').toBe(
      `issuer-test.programa_${id}`,
    );

    // 3. Reencender: tiene que ser patch, no un segundo insert.
    await supabase.from('programas_tarjeta').update({ branding_propio: true }).eq('id', id);
    insertMock.mockClear();
    patchMock.mockClear();
    await syncClasePrograma(supabase, comercioId!, id);

    expect(insertMock, 'un segundo insert sobre una clase existente es irreparable').not.toHaveBeenCalled();
    expect(patchMock).toHaveBeenCalledOnce();
  }, 40_000);
});

// El barrido va en su PROPIO describe con crearEntorno, y no con crearEscenario, por una razón que
// no es de estilo: el afterEach de arriba borra UN programa por id. Este escenario necesita DOS, y
// el segundo quedaría huérfano, bloquearía por FK el borrado del comercio y dejaría basura
// permanente en la base REAL (incidente del 2026-07-30, CLAUDE.md). `entorno.limpiar()` borra por
// comercio_id, así que barre los dos.
describe('syncClasesDeProgramasConClase', () => {
  const entorno = crearEntorno(supabase);

  afterEach(() => entorno.limpiar());

  it('re-sincroniza SOLO los programas que ya tienen clase; nunca crea una nueva', async () => {
    // MUTACIÓN: quitar el .not('google_class_id','is',null) del select hace que el programa B —que
    // SÍ necesita clase propia (branding propio con color de fondo)— entre al barrido y se le cree
    // una LoyaltyClass PERMANENTE que nadie pidió. Las clases de Google no se pueden borrar.
    const comercio = await entorno.crearComercio({ logo_url: 'https://ejemplo.com/logo.png', google_class_id: 'issuer-test.comercio_y' });
    const programaA = entorno.obtenerProgramaPrincipal(comercio);
    await supabase.from('programas_tarjeta').update({ google_class_id: 'clase-x' }).eq('id', programaA);
    const { error } = await supabase.from('programas_tarjeta').insert({
      comercio_id: comercio,
      nombre: 'Sin clase',
      slug: `sin-clase-${Date.now()}`,
      tipo_tarjeta: 'cupon',
      es_principal: false,
      branding_propio: true,
      color_fondo: 'rgb(7,7,7)',
    });
    if (error) throw error;

    await syncClasesDeProgramasConClase(supabase, comercio);

    expect(insertMock, 'el barrido no crea clases: una clase de Google es permanente').not.toHaveBeenCalled();
    expect(patchMock).toHaveBeenCalledOnce();
    expect(patchMock).toHaveBeenCalledWith(expect.objectContaining({ resourceId: 'clase-x' }));
  }, 40_000);
});

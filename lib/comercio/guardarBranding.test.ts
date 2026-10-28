import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { guardarBranding, type DatosBranding } from './guardarBranding';
import { obtenerPrograma } from './programas';

const supabase = createServiceClient();
const idsDePrueba: string[] = [];

afterEach(async () => {
  if (!idsDePrueba.length) return;
  // programas_tarjeta ANTES que comercios: la FK no tiene cascada, y sin esto el borrado falla con
  // 23503 y deja comercios huérfanos en la base REAL — el incidente del 2026-07-30 documentado en
  // test/fixtures/entornoComercio.ts. Se borra por comercio_id, no por ids rastreados, para que
  // caiga también cualquier programa que una prueba haya creado por su cuenta.
  const { error: eProgramas } = await supabase
    .from('programas_tarjeta')
    .delete()
    .in('comercio_id', idsDePrueba);
  if (eProgramas) console.error('[test] no se pudieron borrar los programas de prueba:', eProgramas);
  const { error } = await supabase.from('comercios').delete().in('id', idsDePrueba);
  if (error) console.error('[test] no se pudieron borrar los comercios de prueba:', error);
  idsDePrueba.length = 0;
});

async function crearComercio(): Promise<string> {
  const slug = `test-branding-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase
    .from('comercios')
    .insert({ nombre: 'Comercio Branding', slug, tipo_tarjeta: 'sellos' })
    .select('id')
    .single();
  if (error) throw error;
  idsDePrueba.push(data.id);
  return data.id;
}

describe('guardarBranding', () => {
  it('guarda colores y sello_meta de un comercio existente', async () => {
    const id = await crearComercio();
    const res = await guardarBranding(supabase, id, {
      color_fondo: 'rgb(10, 20, 30)',
      color_texto: 'rgb(255, 255, 255)',
      color_label: 'rgb(200, 200, 200)',
      sello_meta: 10,
      sellos_regalo: 0,
      difuminado_franja: 'fuerte',
      nombre_pase: null,
      encuadre_franja: { modo: 'llenar', focoX: 50, focoY: 50, zoom: 100 },
      oscurecer_franja: true,
    });

    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('comercios')
      .select('color_fondo, sello_meta, difuminado_franja')
      .eq('id', id)
      .single();
    expect(data!.color_fondo).toBe('rgb(10, 20, 30)');
    expect(data!.sello_meta).toBe(10);
    expect(data!.difuminado_franja).toBe('fuerte');
  });

  it('rechaza un color con formato inválido', async () => {
    const id = await crearComercio();
    const res = await guardarBranding(supabase, id, {
      color_fondo: '#231812',
      color_texto: 'rgb(255, 255, 255)',
      color_label: 'rgb(255, 255, 255)',
      sello_meta: null,
      sellos_regalo: 0,
      difuminado_franja: 'medio',
      nombre_pase: null,
      encuadre_franja: { modo: 'llenar', focoX: 50, focoY: 50, zoom: 100 },
      oscurecer_franja: true,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/color/i);
  });

  it('rechaza un sello_meta menor o igual a cero', async () => {
    const id = await crearComercio();
    const res = await guardarBranding(supabase, id, {
      color_fondo: 'rgb(10, 20, 30)',
      color_texto: 'rgb(255, 255, 255)',
      color_label: 'rgb(255, 255, 255)',
      sello_meta: 0,
      sellos_regalo: 0,
      difuminado_franja: 'medio',
      nombre_pase: null,
      encuadre_franja: { modo: 'llenar', focoX: 50, focoY: 50, zoom: 100 },
      oscurecer_franja: true,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/meta|sellos/i);
  });

  it('rechaza un nivel de difuminado que no es uno de los 4 válidos', async () => {
    const id = await crearComercio();
    const res = await guardarBranding(supabase, id, {
      color_fondo: 'rgb(10, 20, 30)',
      color_texto: 'rgb(255, 255, 255)',
      color_label: 'rgb(255, 255, 255)',
      sello_meta: null,
      sellos_regalo: 0,
      difuminado_franja: 'extremo',
      nombre_pase: null,
      encuadre_franja: { modo: 'llenar', focoX: 50, focoY: 50, zoom: 100 },
      oscurecer_franja: true,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/difuminado/i);
  });

  // REGRESIÓN del 2026-07-30, y de las peores: silenciosa. Ese día el pase pasó a leer
  // programas_tarjeta.sello_meta (correcto, la 0024 mudó la config al programa), pero este
  // formulario —el ÚNICO lugar donde el dueño puede tocar la meta— seguía escribiendo solo la
  // columna legada de comercios. Efecto: cambiar la meta de sellos no tenía NINGÚN efecto sobre la
  // tarjeta del cliente; quedaba congelada en el valor del backfill. Sin error, sin aviso.
  it('la meta de sellos también se guarda en el programa principal, que es de donde la lee el pase', async () => {
    const comercioId = await crearComercio();
    const { data: programa, error: eP } = await supabase
      .from('programas_tarjeta')
      .insert({
        comercio_id: comercioId,
        nombre: 'Principal',
        slug: 'principal',
        tipo_tarjeta: 'sellos',
        es_principal: true,
        sello_meta: 5,
      })
      .select('id')
      .single();
    if (eP) throw eP;

    const res = await guardarBranding(supabase, comercioId, {
      color_fondo: 'rgb(10, 20, 30)',
      color_texto: 'rgb(255, 255, 255)',
      color_label: 'rgb(255, 255, 255)',
      sello_meta: 12,
      sellos_regalo: 0,
      difuminado_franja: 'medio',
      nombre_pase: null,
      encuadre_franja: { modo: 'llenar', focoX: 50, focoY: 50, zoom: 100 },
      oscurecer_franja: true,
    });

    expect(res.ok).toBe(true);
    const { data: fila } = await supabase
      .from('programas_tarjeta')
      .select('sello_meta')
      .eq('id', programa.id)
      .single();
    expect(fila!.sello_meta, 'el programa principal tiene que quedar con la meta nueva').toBe(12);
  });

  // El NOMBRE DEL PASE (0033) va por el MISMO camino que la meta de sellos y por el mismo motivo:
  // este formulario es el del COMERCIO, no tiene selector de programa, y la columna vive SOLO en
  // programas_tarjeta. Si se escribiera únicamente en `comercios` no existiría ninguna columna
  // donde caer — y el pase, que lee del programa, seguiría saliendo sin nombre.
  it('el nombre del pase se guarda en el programa principal, que es de donde lo lee el pase', async () => {
    const comercioId = await crearComercio();
    const { data: programa, error: eP } = await supabase
      .from('programas_tarjeta')
      .insert({
        comercio_id: comercioId,
        nombre: 'Principal',
        slug: 'principal',
        tipo_tarjeta: 'membresia',
        es_principal: true,
      })
      .select('id')
      .single();
    if (eP) throw eP;

    const res = await guardarBranding(supabase, comercioId, {
      color_fondo: 'rgb(10, 20, 30)',
      color_texto: 'rgb(255, 255, 255)',
      color_label: 'rgb(255, 255, 255)',
      sello_meta: null,
      sellos_regalo: 0,
      difuminado_franja: 'medio',
      // Con espacios de sobra a propósito: lo que se guarda tiene que ser el nombre RECORTADO, que
      // es lo que va a viajar al headerField de Apple y al textModulesData de Google.
      nombre_pase: '  Socio Oro  ',
      encuadre_franja: { modo: 'llenar', focoX: 50, focoY: 50, zoom: 100 },
      oscurecer_franja: true,
    });

    expect(res.ok).toBe(true);
    const { data: fila } = await supabase
      .from('programas_tarjeta')
      .select('nombre_pase')
      .eq('id', programa.id)
      .single();
    expect(fila!.nombre_pase).toBe('Socio Oro');

    // Y vaciarlo lo BORRA: el dueño tiene que poder arrepentirse y volver al pase sin nombre.
    const vaciado = await guardarBranding(supabase, comercioId, {
      color_fondo: 'rgb(10, 20, 30)',
      color_texto: 'rgb(255, 255, 255)',
      color_label: 'rgb(255, 255, 255)',
      sello_meta: null,
      sellos_regalo: 0,
      difuminado_franja: 'medio',
      nombre_pase: null,
      encuadre_franja: { modo: 'llenar', focoX: 50, focoY: 50, zoom: 100 },
      oscurecer_franja: true,
    });
    expect(vaciado.ok).toBe(true);
    const { data: despues } = await supabase
      .from('programas_tarjeta')
      .select('nombre_pase')
      .eq('id', programa.id)
      .single();
    expect(despues!.nombre_pase).toBeNull();
  });

  it('rechaza un nombre de pase más largo que el tope, con el mensaje de validarNombrePase', async () => {
    // MUTACIÓN: quitar la llamada a validarNombrePase deja que el CHECK de la 0033 devuelva un
    // 23514 mudo, que esta función traduce a "No se pudo guardar el branding" — el dueño ve un
    // error genérico y no sabe que el problema es el largo del nombre.
    const id = await crearComercio();
    const res = await guardarBranding(supabase, id, {
      color_fondo: 'rgb(10, 20, 30)',
      color_texto: 'rgb(255, 255, 255)',
      color_label: 'rgb(255, 255, 255)',
      sello_meta: null,
      sellos_regalo: 0,
      difuminado_franja: 'medio',
      nombre_pase: 'a'.repeat(41),
      encuadre_franja: { modo: 'llenar', focoX: 50, focoY: 50, zoom: 100 },
      oscurecer_franja: true,
    });
    expect(res).toEqual({ ok: false, error: 'El nombre del pase no puede pasar de 40 caracteres.' });
  });

  it('falla si el comercio ya no existe, en vez de reportar éxito', async () => {
    // Sin el .select('id').single(), un update de 0 filas devolvería ok:true habiendo escrito cero.
    const res = await guardarBranding(supabase, '00000000-0000-0000-0000-000000000000', {
      color_fondo: 'rgb(10, 20, 30)',
      color_texto: 'rgb(255, 255, 255)',
      color_label: 'rgb(255, 255, 255)',
      sello_meta: null,
      sellos_regalo: 0,
      difuminado_franja: 'medio',
      nombre_pase: null,
      encuadre_franja: { modo: 'llenar', focoX: 50, focoY: 50, zoom: 100 },
      oscurecer_franja: true,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/no existe/i);
  });

  it('guarda el encuadre de la foto de la franja', async () => {
    const id = await crearComercio();
    const res = await guardarBranding(supabase, id, {
      color_fondo: 'rgb(10, 20, 30)', color_texto: 'rgb(255, 255, 255)', color_label: 'rgb(200, 200, 200)',
      sello_meta: null, sellos_regalo: 0, difuminado_franja: 'medio', nombre_pase: null,
      encuadre_franja: { modo: 'completa', focoX: 10, focoY: 90, zoom: 150 },
      oscurecer_franja: true,
    });
    expect(res.ok).toBe(true);
    const { data } = await supabase.from('comercios').select('encuadre_franja, foco_franja_x, foco_franja_y, zoom_franja').eq('id', id).single();
    expect(data).toEqual({ encuadre_franja: 'completa', foco_franja_x: 10, foco_franja_y: 90, zoom_franja: 150 });
  });

  it('rechaza un encuadre inválido con el mensaje de validarEncuadre, sin escribir nada', async () => {
    // MUTACIÓN: quitar el `validarEncuadre` deja que el 23514 de la BD llegue como "No se pudo guardar".
    const id = await crearComercio();
    const res = await guardarBranding(supabase, id, {
      color_fondo: 'rgb(10, 20, 30)', color_texto: 'rgb(255, 255, 255)', color_label: 'rgb(200, 200, 200)',
      sello_meta: null, sellos_regalo: 0, difuminado_franja: 'medio', nombre_pase: null,
      encuadre_franja: { modo: 'llenar', focoX: 50, focoY: 50, zoom: 999 },
      oscurecer_franja: true,
    });
    expect(res).toEqual({ ok: false, error: 'El zoom debe ser un entero de 100 a 300.' });
  });

  it('sin encuadre (formulario roto) rechaza con mensaje claro: las columnas del comercio no admiten null', async () => {
    const id = await crearComercio();
    const res = await guardarBranding(supabase, id, {
      color_fondo: 'rgb(10, 20, 30)', color_texto: 'rgb(255, 255, 255)', color_label: 'rgb(200, 200, 200)',
      sello_meta: null, sellos_regalo: 0, difuminado_franja: 'medio', nombre_pase: null, encuadre_franja: null, oscurecer_franja: true,
    });
    expect(res).toEqual({ ok: false, error: 'Falta el encuadre de la foto de fondo.' });
  });
});

// El velo de la grilla de sellos (migración 0042), en el NEGOCIO: la columna es NOT NULL y nace en true.
describe('guardarBranding — oscurecer la foto detrás de los sellos', () => {
  const DATOS = {
    color_fondo: 'rgb(1, 2, 3)',
    color_texto: 'rgb(4, 5, 6)',
    color_label: 'rgb(7, 8, 9)',
    sello_meta: null,
    sellos_regalo: 0,
    difuminado_franja: 'medio',
    nombre_pase: null,
    encuadre_franja: { modo: 'llenar', focoX: 50, focoY: 50, zoom: 100 },
  };
  const leer = async (id: string) =>
    (await supabase.from('comercios').select('oscurecer_franja').eq('id', id).single()).data!.oscurecer_franja;

  it('un comercio nace oscureciendo, se puede apagar y volver a encender', async () => {
    const id = await crearComercio();
    expect(await leer(id)).toBe(true);

    expect((await guardarBranding(supabase, id, { ...DATOS, oscurecer_franja: false })).ok).toBe(true);
    // MUTACIÓN: quitar `oscurecer_franja` del update deja true y el dueño "apaga" algo que no se apaga.
    expect(await leer(id)).toBe(false);

    expect((await guardarBranding(supabase, id, { ...DATOS, oscurecer_franja: true })).ok).toBe(true);
    expect(await leer(id)).toBe(true);
  });
});

// Los SELLOS DE REGALO (migración 0043): cuántos sellos trae ya puestos la tarjeta de un cliente nuevo.
// Plan: docs/superpowers/plans/2026-10-28-sellos-de-regalo.md, sección 3.3.
//
// La configuración entra SIEMPRE por guardarBranding (la función que llama Marca) y se relee con
// obtenerPrograma, que es lo que lee el resto de la app. Nada de `update` directo sobre
// programas_tarjeta para fabricar el estado: una prueba que escribe el regalo por su cuenta no prueba
// lo que vive el dueño (CLAUDE.md, "un fixture que espeja una columna legada vuelve DECORATIVA toda la
// suite"). El comercio no tiene la columna `sellos_regalo`: solo existe en el programa.
//
// Estas pruebas NECESITAN la 0043 aplicada (sin ella fallan con "column ... does not exist", que es la
// medida exacta de lo que rompería publicar sin migrar). Las que no necesitan base (que el regalo se
// valida antes de escribir, el orden de los errores, que viaja en el mismo update) están en
// sellosRegaloEnMarca.test.ts, con sus mutaciones ya confirmadas.
//
// MUTACIONES PENDIENTES DE CORRER (con la 0043 aplicada; ninguna se corrió todavía):
//   - sacar `sellos_regalo` del update del programa en guardarBranding.ts: "guarda la meta 10 con el
//     regalo 2" falla con `expected 0 to be 2` (la relectura da el default).
//   - `sellos_regalo: datos.sellos_regalo || undefined` (el 0 no se escribe): "un regalo 0 BORRA el
//     anterior" falla con `expected 2 to be 0`.
//   - escribirlo en un SEGUNDO update, después del de la meta: "bajar la meta y el regalo juntos"
//     falla con "No se pudo guardar el branding." en vez de ok:true (el CHECK cruzado ve meta 5 con
//     regalo 6).
//   - sacar la llamada a validarSellosRegalo: "un regalo igual a la meta se rechaza" falla porque el
//     error es "No se pudo guardar el branding." (el 23514 mudo del CHECK) en vez del mensaje exacto.
//   - mover validarSellosRegalo DESPUÉS del update de comercios: la misma prueba falla igual que sin la
//     llamada (el CHECK frena el update del programa con "No se pudo guardar el branding."), y encima
//     el color nuevo ya quedó escrito en comercios; lo que distingue esta mutación de la anterior es
//     sellosRegaloEnMarca.test.ts ("no toca la base"), que ya la tiene confirmada.
//   - validarlo ANTES de la meta: "con la meta inválida lee primero el error de la meta" falla con el
//     mensaje del regalo en vez del de la meta.
describe('guardarBranding: sellos de regalo', () => {
  // Un comercio de sellos con su programa principal recién nacido: sin meta y sin regalo (los
  // defaults de la 0043), que es como llega un comercio nuevo a la pantalla de Marca.
  async function comercioDeSellos(): Promise<{ comercioId: string; programaId: string }> {
    const comercioId = await crearComercio();
    const { data, error } = await supabase
      .from('programas_tarjeta')
      .insert({ comercio_id: comercioId, nombre: 'Principal', slug: 'principal', tipo_tarjeta: 'sellos', es_principal: true })
      .select('id')
      .single();
    if (error) throw error;
    return { comercioId, programaId: data.id };
  }

  const BASE: DatosBranding = {
    color_fondo: 'rgb(10, 20, 30)',
    color_texto: 'rgb(255, 255, 255)',
    color_label: 'rgb(200, 200, 200)',
    sello_meta: 10,
    sellos_regalo: 2,
    difuminado_franja: 'medio',
    nombre_pase: null,
    encuadre_franja: { modo: 'llenar', focoX: 50, focoY: 50, zoom: 100 },
    oscurecer_franja: true,
  };

  it('guarda la meta 10 con el regalo 2 en el programa principal, y se relee como sellosRegalo', async () => {
    const { comercioId, programaId } = await comercioDeSellos();

    const res = await guardarBranding(supabase, comercioId, BASE);

    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    const programa = await obtenerPrograma(supabase, comercioId, programaId);
    expect(programa?.selloMeta).toBe(10);
    expect(programa?.sellosRegalo, 'el programa principal tiene que quedar con el regalo nuevo').toBe(2);
  });

  it('un regalo 0 BORRA el anterior: el dueño puede volver a "sin regalo"', async () => {
    const { comercioId, programaId } = await comercioDeSellos();
    expect((await guardarBranding(supabase, comercioId, BASE)).ok).toBe(true);

    const res = await guardarBranding(supabase, comercioId, { ...BASE, sellos_regalo: 0 });

    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    const programa = await obtenerPrograma(supabase, comercioId, programaId);
    expect(programa?.sellosRegalo).toBe(0);
    expect(programa?.selloMeta, 'quitar el regalo no toca la meta').toBe(10);
  });

  it('bajar la meta y el regalo juntos (de 10 con 6 a 5 con 2) pasa el CHECK cruzado', async () => {
    // El CHECK de la 0043 compara meta y regalo NUEVOS. En dos sentencias, bajar la meta primero
    // dejaría 5 con regalo 6 un instante, y la base lo rechaza. Es el caso que obliga a que viajen en
    // el MISMO update.
    const { comercioId, programaId } = await comercioDeSellos();
    expect((await guardarBranding(supabase, comercioId, { ...BASE, sello_meta: 10, sellos_regalo: 6 })).ok).toBe(true);

    const res = await guardarBranding(supabase, comercioId, { ...BASE, sello_meta: 5, sellos_regalo: 2 });

    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    const programa = await obtenerPrograma(supabase, comercioId, programaId);
    expect(programa?.selloMeta).toBe(5);
    expect(programa?.sellosRegalo).toBe(2);
  });

  it('un regalo igual a la meta se rechaza con el mensaje exacto y la fila queda SIN tocar', async () => {
    const { comercioId, programaId } = await comercioDeSellos();
    expect((await guardarBranding(supabase, comercioId, BASE)).ok).toBe(true);

    // Todo lo demás cambia a propósito (color y nombre del pase): si algo se escribiera antes de
    // rechazar, se vería. La fila de comercios es la primera que guardarBranding escribe.
    const res = await guardarBranding(supabase, comercioId, {
      ...BASE,
      color_fondo: 'rgb(99, 98, 97)',
      nombre_pase: 'Nombre nuevo',
      sellos_regalo: 10,
    });

    expect(res).toEqual({
      ok: false,
      error: 'Los sellos de regalo tienen que ser menos que la meta (10): si no, la tarjeta nacería completa.',
    });
    const programa = await obtenerPrograma(supabase, comercioId, programaId);
    expect(programa?.selloMeta).toBe(10);
    expect(programa?.sellosRegalo, 'el regalo anterior sigue ahí').toBe(2);
    expect(programa?.nombrePase, 'el nombre nuevo no se escribió').toBeNull();
    const { data: comercio } = await supabase.from('comercios').select('color_fondo').eq('id', comercioId).single();
    expect(comercio!.color_fondo, 'el color nuevo no se escribió').toBe('rgb(10, 20, 30)');
  });

  it('un regalo 2 con la meta vacía se rechaza con el mensaje exacto y la fila queda SIN tocar', async () => {
    const { comercioId, programaId } = await comercioDeSellos();

    const res = await guardarBranding(supabase, comercioId, { ...BASE, sello_meta: null, sellos_regalo: 2 });

    expect(res).toEqual({ ok: false, error: 'Poné la meta de sellos antes de regalar sellos.' });
    const programa = await obtenerPrograma(supabase, comercioId, programaId);
    expect(programa?.selloMeta).toBeNull();
    expect(programa?.sellosRegalo).toBe(0);
  });

  it('con la meta inválida lee primero el error de la meta, no el del regalo', async () => {
    const { comercioId } = await comercioDeSellos();

    const res = await guardarBranding(supabase, comercioId, { ...BASE, sello_meta: 0, sellos_regalo: 2 });

    expect(res).toEqual({ ok: false, error: 'La meta de sellos debe ser un número entero mayor que cero.' });
  });
});

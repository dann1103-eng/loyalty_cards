import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { crearPrograma, obtenerPrograma } from './programas';
import {
  guardarBrandingPrograma,
  brandingDeProgramas,
  brandingProgramaDesdeFormulario,
  volverAHeredarMarca,
  hayMarcaPropia,
  oscurecerDesdeFormulario,
} from './guardarBrandingPrograma';

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

afterEach(async () => {
  await entorno.limpiar();
});

// Un comercio con su programa principal (el que crea el fixture) y un segundo programa de cupón,
// que es el caso real que motivó todo esto: dos tarjetas del mismo negocio, una al lado de la otra
// en la billetera del cliente.
async function comercioConDosProgramas(): Promise<{ comercioId: string; principalId: string; cuponId: string }> {
  const comercioId = await entorno.crearComercio({
    color_fondo: 'rgb(1, 1, 1)',
    color_texto: 'rgb(2, 2, 2)',
    color_label: 'rgb(3, 3, 3)',
    difuminado_franja: 'medio',
  });
  const res = await crearPrograma(supabase, comercioId, {
    nombre: 'Cupon de bienvenida',
    tipoTarjeta: 'cupon',
    cashbackPorcentaje: null,
    multipassVisitas: null,
    membresiaDias: null,
    cuponVigenciaDias: null,
  });
  if (!res.ok) throw new Error(res.error);
  return { comercioId, principalId: entorno.obtenerProgramaPrincipal(comercioId), cuponId: res.id };
}

const BRANDING_VACIO = {
  brandingPropio: false,
  colorFondo: null,
  colorTexto: null,
  colorLabel: null,
  difuminadoFranja: null,
  encuadreFranja: null,
  oscurecerFranja: null,
  selloMeta: null,
  sellosRegalo: 0,
  nombrePase: null,
};

describe('guardarBrandingPrograma', () => {
  it('guarda colores, difuminado y el interruptor de un programa del comercio', async () => {
    const { comercioId, cuponId } = await comercioConDosProgramas();

    const res = await guardarBrandingPrograma(supabase, comercioId, cuponId, {
      ...BRANDING_VACIO,
      brandingPropio: true,
      colorFondo: 'rgb(10, 20, 30)',
      colorTexto: 'rgb(255, 255, 255)',
      difuminadoFranja: 'fuerte',
    });

    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('programas_tarjeta')
      .select('branding_propio, color_fondo, color_texto, color_label, difuminado_franja')
      .eq('id', cuponId)
      .single();
    expect(data!.branding_propio).toBe(true);
    expect(data!.color_fondo).toBe('rgb(10, 20, 30)');
    expect(data!.color_texto).toBe('rgb(255, 255, 255)');
    // null = heredá el del comercio. Se GUARDA null, no se copia el valor del comercio: copiarlo
    // dejaría al programa congelado en el color de hoy cuando el dueño cambie la marca del negocio.
    expect(data!.color_label, 'lo que el dueño no definió queda en null, que es la herencia').toBeNull();
    expect(data!.difuminado_franja).toBe('fuerte');
  });

  it('rechaza un color con formato inválido', async () => {
    const { comercioId, cuponId } = await comercioConDosProgramas();
    const res = await guardarBrandingPrograma(supabase, comercioId, cuponId, {
      ...BRANDING_VACIO,
      brandingPropio: true,
      colorFondo: '#231812',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/color de fondo/i);
  });

  it('rechaza un nivel de difuminado que no es uno de los 4 válidos', async () => {
    const { comercioId, cuponId } = await comercioConDosProgramas();
    const res = await guardarBrandingPrograma(supabase, comercioId, cuponId, {
      ...BRANDING_VACIO,
      brandingPropio: true,
      difuminadoFranja: 'extremo',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/difuminado/i);
  });

  it('rechaza un sello_meta menor o igual a cero', async () => {
    const { comercioId, cuponId } = await comercioConDosProgramas();
    const res = await guardarBrandingPrograma(supabase, comercioId, cuponId, {
      ...BRANDING_VACIO,
      selloMeta: 0,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/meta de sellos/i);
  });

  // LA prueba de seguridad de esta tarea. programas_tarjeta.id es un uuid que viaja en el
  // formulario: sin el scope por comercio_id, conocer el id de un programa ajeno alcanzaría para
  // cambiarle la marca al negocio de otro. El comercioId SIEMPRE viene del gate.
  it('no toca un programa de OTRO comercio aunque se conozca su id', async () => {
    const propio = await comercioConDosProgramas();
    const ajeno = await comercioConDosProgramas();

    const res = await guardarBrandingPrograma(supabase, propio.comercioId, ajeno.cuponId, {
      ...BRANDING_VACIO,
      brandingPropio: true,
      colorFondo: 'rgb(200, 0, 0)',
    });

    expect(res.ok, 'un programa de otro comercio no se puede tocar').toBe(false);
    if (!res.ok) expect(res.error).toMatch(/no existe/i);

    const { data } = await supabase
      .from('programas_tarjeta')
      .select('branding_propio, color_fondo')
      .eq('id', ajeno.cuponId)
      .single();
    expect(data!.color_fondo, 'el programa ajeno tiene que quedar intacto').toBeNull();
    expect(data!.branding_propio, 'el interruptor del programa ajeno tiene que quedar intacto').toBe(false);
  });

  it('falla si el programa ya no existe, en vez de reportar éxito', async () => {
    const { comercioId } = await comercioConDosProgramas();
    // Sin el .select().single(), un update de 0 filas devuelve 204 sin error y esto diría ok:true.
    const res = await guardarBrandingPrograma(
      supabase,
      comercioId,
      '00000000-0000-0000-0000-000000000000',
      BRANDING_VACIO,
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/no existe/i);
  });

  // sello_meta NO es branding: es la mecánica del programa, y el pase la lee SIEMPRE desde el
  // programa (datosPassDeTarjeta.ts), sin mirar branding_propio. Si se guardara solo con el
  // interruptor encendido, un comercio de sellos con un segundo programa de sellos no tendría
  // NINGUNA forma de ponerle su meta — el mismo agujero silencioso que el 2026-07-30 dejó la meta
  // congelada en el valor del backfill de la 0024.
  it('guarda sello_meta aunque el branding propio esté apagado: no es branding, es la mecánica', async () => {
    const { comercioId, cuponId } = await comercioConDosProgramas();

    const res = await guardarBrandingPrograma(supabase, comercioId, cuponId, {
      ...BRANDING_VACIO,
      brandingPropio: false,
      selloMeta: 7,
    });

    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('programas_tarjeta')
      .select('sello_meta')
      .eq('id', cuponId)
      .single();
    expect(data!.sello_meta, 'la meta se guarda con el interruptor apagado').toBe(7);
  });

  // El null de sello_meta es un VALOR (un cupón no tiene meta), no una ausencia: guardarlo tiene
  // que BORRAR la meta anterior, no dejarla. Es el mismo campo donde el `??` fue un bug real.
  it('sello_meta en null borra la meta anterior, no la hereda del comercio', async () => {
    const { comercioId, cuponId } = await comercioConDosProgramas();
    await guardarBrandingPrograma(supabase, comercioId, cuponId, { ...BRANDING_VACIO, selloMeta: 9 });

    const res = await guardarBrandingPrograma(supabase, comercioId, cuponId, {
      ...BRANDING_VACIO,
      selloMeta: null,
    });

    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('programas_tarjeta')
      .select('sello_meta')
      .eq('id', cuponId)
      .single();
    expect(data!.sello_meta).toBeNull();
  });

  // El resultado avisa si el programa quedó necesitando su propia LoyaltyClass, que es un recurso
  // PERMANENTE en Google (la API no tiene delete). La decisión se calcula sobre la fila REAL ya
  // escrita —no sobre los datos del formulario— porque logo_url y hero_url los escribe el Server
  // Action de subida, no esta función, y los tres campos cuentan.
  it('avisa que NO hace falta clase propia cuando el programa no define color, logo ni portada', async () => {
    const { comercioId, cuponId } = await comercioConDosProgramas();
    const res = await guardarBrandingPrograma(supabase, comercioId, cuponId, {
      ...BRANDING_VACIO,
      brandingPropio: true,
      colorTexto: 'rgb(9, 9, 9)',
      difuminadoFranja: 'sutil',
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(
        res.necesitaClasePropia,
        'cambiar solo el color de texto no justifica una clase permanente en Google',
      ).toBe(false);
    }
  });

  it('avisa que SÍ hace falta clase propia cuando el programa define color de fondo', async () => {
    const { comercioId, cuponId } = await comercioConDosProgramas();
    const res = await guardarBrandingPrograma(supabase, comercioId, cuponId, {
      ...BRANDING_VACIO,
      brandingPropio: true,
      colorFondo: 'rgb(10, 20, 30)',
    });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.necesitaClasePropia).toBe(true);
  });

  it('con el interruptor apagado no hace falta clase propia aunque el color siga cargado', async () => {
    const { comercioId, cuponId } = await comercioConDosProgramas();
    const res = await guardarBrandingPrograma(supabase, comercioId, cuponId, {
      ...BRANDING_VACIO,
      brandingPropio: false,
      colorFondo: 'rgb(10, 20, 30)',
    });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.necesitaClasePropia).toBe(false);
  });

  it('guarda el encuadre propio de un programa y lo lee de vuelta como unidad', async () => {
    const { comercioId, cuponId } = await comercioConDosProgramas();
    const res = await guardarBrandingPrograma(supabase, comercioId, cuponId, {
      ...BRANDING_VACIO, brandingPropio: true,
      encuadreFranja: { modo: 'completa', focoX: 0, focoY: 100, zoom: 120 },
    });
    expect(res.ok).toBe(true);
    const filas = await brandingDeProgramas(supabase, comercioId);
    expect(filas.find((f) => f.programaId === cuponId)?.encuadreFranja).toEqual({ modo: 'completa', focoX: 0, focoY: 100, zoom: 120 });
  });

  it('encuadre null SE ESCRIBE (hereda): deja las cuatro columnas en null aunque antes tuvieran valor', async () => {
    const { comercioId, cuponId } = await comercioConDosProgramas();
    await guardarBrandingPrograma(supabase, comercioId, cuponId, { ...BRANDING_VACIO, brandingPropio: true, encuadreFranja: { modo: 'llenar', focoX: 1, focoY: 2, zoom: 110 } });
    const res = await guardarBrandingPrograma(supabase, comercioId, cuponId, { ...BRANDING_VACIO, brandingPropio: true, encuadreFranja: null });
    expect(res.ok).toBe(true);
    const { data } = await supabase.from('programas_tarjeta').select('encuadre_franja, foco_franja_x, foco_franja_y, zoom_franja').eq('id', cuponId).single();
    expect(data).toEqual({ encuadre_franja: null, foco_franja_x: null, foco_franja_y: null, zoom_franja: null });
  });

  it('rechaza un encuadre inválido con el mensaje de validarEncuadre', async () => {
    const { comercioId, cuponId } = await comercioConDosProgramas();
    const res = await guardarBrandingPrograma(supabase, comercioId, cuponId, {
      ...BRANDING_VACIO, brandingPropio: true, encuadreFranja: { modo: 'raro', focoX: 50, focoY: 50, zoom: 100 } as never,
    });
    expect(res).toEqual({ ok: false, error: 'El modo de encuadre no es válido.' });
  });
});

describe('brandingDeProgramas', () => {
  it('devuelve el branding de los programas del comercio, y solo de ese comercio', async () => {
    const propio = await comercioConDosProgramas();
    const ajeno = await comercioConDosProgramas();
    await guardarBrandingPrograma(supabase, propio.comercioId, propio.cuponId, {
      ...BRANDING_VACIO,
      brandingPropio: true,
      colorFondo: 'rgb(10, 20, 30)',
      selloMeta: 6,
    });

    const filas = await brandingDeProgramas(supabase, propio.comercioId);

    const ids = filas.map((f) => f.programaId);
    expect(ids).toContain(propio.cuponId);
    expect(ids, 'un programa de otro comercio no puede aparecer acá').not.toContain(ajeno.cuponId);
    const cupon = filas.find((f) => f.programaId === propio.cuponId)!;
    expect(cupon.brandingPropio).toBe(true);
    expect(cupon.colorFondo).toBe('rgb(10, 20, 30)');
    expect(cupon.selloMeta).toBe(6);
  });
});

describe('volverAHeredarMarca', () => {
  // El botón "Usar el mismo diseño de mi negocio". Apaga el interruptor y NO borra las columnas: es
  // la promesa que ya documenta brandingEfectivo — apagarlo no obliga a limpiar cada columna, y
  // publicar de nuevo le devuelve al dueño lo que tenía.
  it('apaga el interruptor SIN borrar los colores que el dueño había puesto', async () => {
    const { comercioId, cuponId } = await comercioConDosProgramas();
    await guardarBrandingPrograma(supabase, comercioId, cuponId, {
      ...BRANDING_VACIO,
      brandingPropio: true,
      colorFondo: 'rgb(10, 20, 30)',
    });

    const res = await volverAHeredarMarca(supabase, comercioId, cuponId);

    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('programas_tarjeta')
      .select('branding_propio, color_fondo')
      .eq('id', cuponId)
      .single();
    expect(data!.branding_propio).toBe(false);
    expect(
      data!.color_fondo,
      'no se borra: publicar de nuevo tiene que devolverle el diseño que tenía',
    ).toBe('rgb(10, 20, 30)');
  });

  it('no apaga el de OTRO comercio aunque se conozca su id', async () => {
    const propio = await comercioConDosProgramas();
    const ajeno = await comercioConDosProgramas();
    await guardarBrandingPrograma(supabase, ajeno.comercioId, ajeno.cuponId, {
      ...BRANDING_VACIO,
      brandingPropio: true,
      colorFondo: 'rgb(10, 20, 30)',
    });

    const res = await volverAHeredarMarca(supabase, propio.comercioId, ajeno.cuponId);

    expect(res.ok).toBe(false);
    const { data } = await supabase
      .from('programas_tarjeta')
      .select('branding_propio')
      .eq('id', ajeno.cuponId)
      .single();
    expect(data!.branding_propio, 'el programa ajeno queda con su marca encendida').toBe(true);
  });
});

// Puro: la regla que decide el interruptor a partir de lo que el dueño cargó. Existe para que el
// dueño NUNCA tenga que ver ni entender `branding_propio` — el editor viejo se lo mostraba como
// casilla "Usar marca propia" y no se entendió.
// El NOMBRE DEL PASE (0033) por programa. No es branding y NO se rige por `brandingPropio`: es
// identidad del programa, como sello_meta, y el pase lo lee siempre de programas_tarjeta.
describe('guardarBrandingPrograma — nombre del pase', () => {
  it('guarda el nombre recortado y NO enciende branding_propio (no es marca, es identidad)', async () => {
    const { comercioId, cuponId } = await comercioConDosProgramas();

    const res = await guardarBrandingPrograma(supabase, comercioId, cuponId, {
      ...BRANDING_VACIO,
      nombrePase: '  2x1 de bienvenida  ',
    });

    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('programas_tarjeta')
      .select('nombre_pase, branding_propio')
      .eq('id', cuponId)
      .single();
    expect(data!.nombre_pase).toBe('2x1 de bienvenida');
    // MUTACIÓN: meter nombrePase en hayMarcaPropia haría que ponerle nombre a una tarjeta la
    // sacara del diseño del negocio sin que el dueño lo pidiera — el pase entero cambiaría de color.
    expect(data!.branding_propio, 'ponerle nombre a la tarjeta no la saca del diseño del negocio').toBe(false);
  });

  it('nombrePase null BORRA el anterior: el dueño puede volver al pase sin nombre', async () => {
    const { comercioId, cuponId } = await comercioConDosProgramas();
    await guardarBrandingPrograma(supabase, comercioId, cuponId, { ...BRANDING_VACIO, nombrePase: 'Temporada' });

    const res = await guardarBrandingPrograma(supabase, comercioId, cuponId, { ...BRANDING_VACIO, nombrePase: null });

    expect(res.ok).toBe(true);
    const { data } = await supabase.from('programas_tarjeta').select('nombre_pase').eq('id', cuponId).single();
    expect(data!.nombre_pase).toBeNull();
  });

  it('rechaza un nombre más largo que el tope con el mensaje de validarNombrePase', async () => {
    // MUTACIÓN: sin la validación, el CHECK de la 0033 devuelve un 23514 mudo y el dueño ve
    // "No se pudo guardar la marca del programa." sin saber qué campo corregir.
    const { comercioId, cuponId } = await comercioConDosProgramas();
    const res = await guardarBrandingPrograma(supabase, comercioId, cuponId, {
      ...BRANDING_VACIO,
      nombrePase: 'a'.repeat(41),
    });
    expect(res).toEqual({ ok: false, error: 'El nombre del pase no puede pasar de 40 caracteres.' });
  });
});

describe('hayMarcaPropia', () => {
  const NADA = {
    colorFondo: null,
    colorTexto: null,
    colorLabel: null,
    difuminadoFranja: null,
    logoUrl: null,
    heroUrl: null,
    stripUrl: null,
    selloIconoUrl: null,
    selloIcono2Url: null,
  };

  it('sin ningún campo: no hay marca propia', () => {
    expect(hayMarcaPropia(NADA)).toBe(false);
  });

  it('cualquiera de los ocho campos alcanza', () => {
    expect(hayMarcaPropia({ ...NADA, colorFondo: 'rgb(1,2,3)' })).toBe(true);
    expect(hayMarcaPropia({ ...NADA, colorTexto: 'rgb(1,2,3)' })).toBe(true);
    expect(hayMarcaPropia({ ...NADA, colorLabel: 'rgb(1,2,3)' })).toBe(true);
    expect(hayMarcaPropia({ ...NADA, difuminadoFranja: 'fuerte' })).toBe(true);
    expect(hayMarcaPropia({ ...NADA, logoUrl: 'https://ejemplo.com/l.png' })).toBe(true);
    expect(hayMarcaPropia({ ...NADA, heroUrl: 'https://ejemplo.com/h.png' })).toBe(true);
    expect(hayMarcaPropia({ ...NADA, stripUrl: 'https://ejemplo.com/s.png' })).toBe(true);
    expect(hayMarcaPropia({ ...NADA, selloIconoUrl: 'https://ejemplo.com/i.png' })).toBe(true);
    expect(hayMarcaPropia({ ...NADA, selloIcono2Url: 'https://ejemplo.com/i2.png' })).toBe(true);
  });
});

describe('brandingProgramaDesdeFormulario', () => {
  it('cadena vacía es null (heredar), y los valores llegan sin espacios de más', () => {
    const datos = brandingProgramaDesdeFormulario({
      brandingPropio: true,
      colorFondo: '  rgb(10, 20, 30)  ',
      colorTexto: '',
      colorLabel: '   ',
      difuminadoFranja: '',
      encuadre: { modo: '', focoX: '', focoY: '', zoom: '' },
      oscurecerFranja: '',
      selloMeta: '',
      sellosRegalo: 0,
      nombrePase: '  Socio Oro  ',
    });

    expect(datos.colorFondo).toBe('rgb(10, 20, 30)');
    expect(datos.colorTexto, 'un campo vacío significa heredar, no un color vacío').toBeNull();
    expect(datos.colorLabel).toBeNull();
    expect(datos.difuminadoFranja).toBeNull();
    expect(datos.selloMeta).toBeNull();
    expect(datos.nombrePase, 'el nombre llega recortado, que es como se guarda').toBe('Socio Oro');
  });

  it('el nombre del pase vacío es null: BORRAR el nombre, no guardar una cadena vacía', () => {
    // Acá `null` no significa "heredar" (el nombre no se hereda: es identidad del programa), sino
    // "esta tarjeta no tiene nombre propio en el pase" — y el CHECK de la base rechaza el ''.
    const datos = brandingProgramaDesdeFormulario({
      brandingPropio: false,
      colorFondo: '', colorTexto: '', colorLabel: '', difuminadoFranja: '',
      encuadre: { modo: '', focoX: '', focoY: '', zoom: '' },
      oscurecerFranja: '',
      selloMeta: '',
      sellosRegalo: 0,
      nombrePase: '   ',
    });
    expect(datos.nombrePase).toBeNull();
  });

  it('un sello_meta con basura queda NaN para que la validación lo rechace, no 12 en silencio', () => {
    // Number() y no parseInt: parseInt('12a') devuelve 12 y se tragaría el typo del dueño.
    const datos = brandingProgramaDesdeFormulario({
      brandingPropio: false,
      colorFondo: '',
      colorTexto: '',
      colorLabel: '',
      difuminadoFranja: '',
      encuadre: { modo: '', focoX: '', focoY: '', zoom: '' },
      oscurecerFranja: '',
      selloMeta: '12a',
      sellosRegalo: 0,
      nombrePase: '',
    });

    expect(Number.isNaN(datos.selloMeta)).toBe(true);
  });

  describe('encuadre', () => {
    const base = { brandingPropio: false, colorFondo: '', colorTexto: '', colorLabel: '', difuminadoFranja: '', oscurecerFranja: '', selloMeta: '', sellosRegalo: 0, nombrePase: '' };
    it('cuatro vacíos → null', () => {
      expect(brandingProgramaDesdeFormulario({ ...base, encuadre: { modo: '', focoX: '', focoY: '', zoom: '' } }).encuadreFranja).toBeNull();
    });
    it('un solo vacío NO es null: llega con NaN para que la validación lo rechace', () => {
      const r = brandingProgramaDesdeFormulario({ ...base, encuadre: { modo: 'llenar', focoX: '', focoY: '50', zoom: '100' } });
      expect(r.encuadreFranja).not.toBeNull();
      expect(Number.isNaN(r.encuadreFranja!.focoX)).toBe(true);
    });
  });
});

// El velo de la grilla de sellos (migración 0042) en una TARJETA: tri-estado, como el encuadre.
describe('oscurecer la foto detrás de los sellos, por tarjeta', () => {
  it("oscurecerDesdeFormulario: 'si' y 'no' son valores; vacío o basura es null (no lo toqué)", () => {
    expect(oscurecerDesdeFormulario('si')).toBe(true);
    expect(oscurecerDesdeFormulario('no')).toBe(false);
    expect(oscurecerDesdeFormulario('')).toBeNull();
    expect(oscurecerDesdeFormulario('on')).toBeNull();
  });

  it('se guarda false, y null lo vuelve a dejar sin decidir', async () => {
    const { comercioId, principalId } = await comercioConDosProgramas();
    const leer = async () =>
      (await supabase.from('programas_tarjeta').select('oscurecer_franja').eq('id', principalId).single()).data!
        .oscurecer_franja;

    expect((await guardarBrandingPrograma(supabase, comercioId, principalId, { ...BRANDING_VACIO, oscurecerFranja: false })).ok).toBe(true);
    // MUTACIÓN: quitar `oscurecer_franja` del update deja null y el pase sigue oscurecido.
    expect(await leer()).toBe(false);

    expect((await guardarBrandingPrograma(supabase, comercioId, principalId, { ...BRANDING_VACIO, oscurecerFranja: null })).ok).toBe(true);
    expect(await leer()).toBeNull();

    const fila = (await brandingDeProgramas(supabase, comercioId)).find((f) => f.programaId === principalId)!;
    expect(fila.oscurecerFranja).toBeNull();
  });
});

// Los SELLOS DE REGALO (migración 0043) por TARJETA: cuántos sellos trae ya puestos la tarjeta de un
// cliente nuevo. Plan: docs/superpowers/plans/2026-10-28-sellos-de-regalo.md, sección 3.3.
//
// Como la meta, el regalo es la mecánica del programa y no marca: se guarda con el interruptor de
// marca propia apagado (BRANDING_VACIO lo manda en false). La configuración entra SIEMPRE por
// guardarBrandingPrograma (la función que llama Marca) y se relee por los dos lectores que usa la
// app, brandingDeProgramas (precarga de Marca) y obtenerPrograma (registro y escáner). Ningún `update`
// directo sobre programas_tarjeta para fabricar el estado.
//
// Estas pruebas NECESITAN la 0043 aplicada (sin ella fallan con "column ... does not exist"). Lo que no
// necesita base (validar antes de escribir, el orden de los errores, el mismo update, que un 0 se
// escribe) está en sellosRegaloEnMarca.test.ts, con sus mutaciones ya confirmadas.
//
// MUTACIONES CONFIRMADAS (2026-10-28), cada una corrida contra la base real (con la 0043 aplicada) y
// restaurada después. Lo que la prueba recibió al fallar va entre acentos graves:
//   - sacar `sellos_regalo` del update en guardarBrandingPrograma.ts: fallan 4 pruebas. "guarda la meta
//     10 con el regalo 2" con `lo que leen el registro y el escáner: expected +0 to be 2` (falla en
//     el PRIMER lector, obtenerPrograma, antes de llegar al de Marca); "bajar" con `expected +0 to be
//     2`; "subir" con `expected +0 to be 6`; "un regalo igual a la meta" con `el regalo anterior sigue
//     ahí: expected +0 to be 2`.
//   - `sellos_regalo: datos.sellosRegalo || undefined`: falla SOLO "un regalo 0 BORRA el anterior",
//     con `expected 2 to be +0`.
//   - escribirlo en un SEGUNDO update posterior al de la meta: falla SOLO "bajar la meta y el regalo
//     juntos", con `No se pudo guardar la marca del programa.: expected false to be true`. "subir"
//     PASA con esta mutación, y es lo esperado: con la meta primero, subir es válido.
//   - la inversa, escribirlo en un update APARTE y ANTES del de la meta: fallan 5 pruebas. "subir la
//     meta y el regalo juntos" falla EN EL PASO DE SUBIR (la aserción de `res.ok` que sigue al guardado
//     de 10 con 6), con `No se pudo guardar la marca del programa.: expected false to be true`,
//     porque su partida se arma en dos guardados (meta sola, y después el regalo) para que la
//     mutación no la tumbe antes. Las otras cuatro ya fallan en su primer guardado desde cero
//     (meta vacía con regalo mayor que cero), sin llegar a lo que miden. Entre las dos mutaciones de
//     orden, ningún orden fijo de dos updates pasa "bajar" y "subir" a la vez.
//   - sacar la llamada a validarSellosRegalo: fallan "un regalo igual a la meta" y "un regalo 2 con la
//     meta vacía", ambas con `error: 'No se pudo guardar la marca del programa.'` en vez del mensaje
//     exacto (el 23514 mudo del CHECK).
//   - mover validarSellosRegalo DESPUÉS del update (guardarBrandingPrograma tiene un solo write): fallan
//     las dos mismas pruebas, con el mismo mensaje genérico en vez del exacto, porque el CHECK frena el
//     update antes de que la validación en TS corra. Acá SÍ distingue el mensaje exacto (a diferencia
//     de guardarBranding, que escribe en dos tablas y se ancla con el color nuevo).
//   - validarlo ANTES de la meta: falla SOLO "con la meta inválida lee primero el error de la meta",
//     recibiendo `Los sellos de regalo tienen que ser menos que la meta (0): si no, la tarjeta
//     nacería completa.` en vez de `La meta de sellos debe ser un número entero mayor que cero.`
//   - sacar `sellos_regalo` del select de brandingDeProgramas: fallan 5 pruebas con `expected
//     undefined to be ...` en el lector de Marca; la primera, "guarda la meta 10 con el regalo 2", con
//     `lo que precarga la pantalla de Marca: expected undefined to be 2`.
//   - `sellosRegalo: 0` fijo en el mapeo de brandingDeProgramas: fallan 3 pruebas; la primera, con
//     `lo que precarga la pantalla de Marca: expected +0 to be 2`.
//   - gobernar el regalo con el interruptor (`datos.brandingPropio ? datos.sellosRegalo : undefined`):
//     fallan 4 pruebas, la primera con `lo que leen el registro y el escáner: expected +0 to be 2`,
//     porque BRANDING_VACIO manda brandingPropio en false.
describe('guardarBrandingPrograma: sellos de regalo', () => {
  // Un comercio de sellos con su programa principal (el del fixture, sin meta ni regalo).
  async function comercioDeSellos(): Promise<{ comercioId: string; programaId: string }> {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    return { comercioId, programaId: entorno.obtenerProgramaPrincipal(comercioId) };
  }

  const leerEnMarca = async (comercioId: string, programaId: string) =>
    (await brandingDeProgramas(supabase, comercioId)).find((f) => f.programaId === programaId)!;

  it('guarda la meta 10 con el regalo 2 y se relee como sellosRegalo por los dos lectores', async () => {
    const { comercioId, programaId } = await comercioDeSellos();

    const res = await guardarBrandingPrograma(supabase, comercioId, programaId, {
      ...BRANDING_VACIO,
      selloMeta: 10,
      sellosRegalo: 2,
    });

    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    const programa = await obtenerPrograma(supabase, comercioId, programaId);
    expect(programa?.selloMeta).toBe(10);
    expect(programa?.sellosRegalo, 'lo que leen el registro y el escáner').toBe(2);
    const enMarca = await leerEnMarca(comercioId, programaId);
    expect(enMarca.sellosRegalo, 'lo que precarga la pantalla de Marca').toBe(2);
    expect(enMarca.brandingPropio, 'el regalo se guarda con el interruptor de marca apagado').toBe(false);
  });

  it('un regalo 0 BORRA el anterior: el dueño puede volver a "sin regalo"', async () => {
    const { comercioId, programaId } = await comercioDeSellos();
    const setup = await guardarBrandingPrograma(supabase, comercioId, programaId, {
      ...BRANDING_VACIO,
      selloMeta: 10,
      sellosRegalo: 2,
    });
    expect(setup.ok, setup.ok ? '' : setup.error).toBe(true);

    const res = await guardarBrandingPrograma(supabase, comercioId, programaId, {
      ...BRANDING_VACIO,
      selloMeta: 10,
      sellosRegalo: 0,
    });

    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    expect((await leerEnMarca(comercioId, programaId)).sellosRegalo).toBe(0);
  });

  it('bajar la meta y el regalo juntos (de 10 con 6 a 5 con 2) pasa el CHECK cruzado', async () => {
    // El CHECK de la 0043 compara meta y regalo NUEVOS. En dos sentencias, bajar la meta primero
    // dejaría 5 con regalo 6 un instante, y la base lo rechaza.
    const { comercioId, programaId } = await comercioDeSellos();
    const subida = await guardarBrandingPrograma(supabase, comercioId, programaId, {
      ...BRANDING_VACIO,
      selloMeta: 10,
      sellosRegalo: 6,
    });
    expect(subida.ok, subida.ok ? '' : subida.error).toBe(true);

    const res = await guardarBrandingPrograma(supabase, comercioId, programaId, {
      ...BRANDING_VACIO,
      selloMeta: 5,
      sellosRegalo: 2,
    });

    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    const programa = await obtenerPrograma(supabase, comercioId, programaId);
    expect(programa?.selloMeta).toBe(5);
    expect(programa?.sellosRegalo).toBe(2);
  });

  it('subir la meta y el regalo juntos (de 5 con 2 a 10 con 6) pasa el CHECK cruzado', async () => {
    // La inversa de la anterior. En dos sentencias, subir el regalo primero dejaría 5 con regalo 6 un
    // instante y la base lo rechaza: el orden que arregla un caso rompe el otro, y solo un MISMO update
    // pasa los dos. La partida (meta 5 con regalo 2) se arma en dos guardados, la meta sola primero:
    // un guardado que escribiera el regalo antes que la meta ya tropezaría armando la partida desde
    // cero (meta vacía con regalo 2), y la prueba dejaría de medir el paso de SUBIR.
    const { comercioId, programaId } = await comercioDeSellos();
    for (const sellosRegalo of [0, 2]) {
      const setup = await guardarBrandingPrograma(supabase, comercioId, programaId, {
        ...BRANDING_VACIO,
        selloMeta: 5,
        sellosRegalo,
      });
      expect(setup.ok, setup.ok ? '' : setup.error).toBe(true);
    }

    const res = await guardarBrandingPrograma(supabase, comercioId, programaId, {
      ...BRANDING_VACIO,
      selloMeta: 10,
      sellosRegalo: 6,
    });

    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    const programa = await obtenerPrograma(supabase, comercioId, programaId);
    expect(programa?.selloMeta).toBe(10);
    expect(programa?.sellosRegalo).toBe(6);
    const enMarca = await leerEnMarca(comercioId, programaId);
    expect(enMarca.selloMeta).toBe(10);
    expect(enMarca.sellosRegalo).toBe(6);
  });

  it('un regalo igual a la meta se rechaza con el mensaje exacto y la fila queda SIN tocar', async () => {
    const { comercioId, programaId } = await comercioDeSellos();
    const setup = await guardarBrandingPrograma(supabase, comercioId, programaId, {
      ...BRANDING_VACIO,
      selloMeta: 10,
      sellosRegalo: 2,
    });
    expect(setup.ok, setup.ok ? '' : setup.error).toBe(true);

    // Además del regalo cambia el color y se enciende el interruptor: si algo se escribiera antes de
    // rechazar, se vería.
    const res = await guardarBrandingPrograma(supabase, comercioId, programaId, {
      ...BRANDING_VACIO,
      brandingPropio: true,
      colorFondo: 'rgb(9, 9, 9)',
      selloMeta: 10,
      sellosRegalo: 10,
    });

    expect(res).toEqual({
      ok: false,
      error: 'Los sellos de regalo tienen que ser menos que la meta (10): si no, la tarjeta nacería completa.',
    });
    const enMarca = await leerEnMarca(comercioId, programaId);
    expect(enMarca.selloMeta).toBe(10);
    expect(enMarca.sellosRegalo, 'el regalo anterior sigue ahí').toBe(2);
    expect(enMarca.brandingPropio, 'el interruptor no se encendió').toBe(false);
    expect(enMarca.colorFondo, 'el color nuevo no se escribió').toBeNull();
  });

  it('un regalo 2 con la meta vacía se rechaza con el mensaje exacto y la fila queda SIN tocar', async () => {
    const { comercioId, programaId } = await comercioDeSellos();

    const res = await guardarBrandingPrograma(supabase, comercioId, programaId, {
      ...BRANDING_VACIO,
      selloMeta: null,
      sellosRegalo: 2,
    });

    expect(res).toEqual({ ok: false, error: 'Poné la meta de sellos antes de regalar sellos.' });
    const enMarca = await leerEnMarca(comercioId, programaId);
    expect(enMarca.selloMeta).toBeNull();
    expect(enMarca.sellosRegalo).toBe(0);
  });

  it('con la meta inválida lee primero el error de la meta, no el del regalo', async () => {
    const { comercioId, programaId } = await comercioDeSellos();

    const res = await guardarBrandingPrograma(supabase, comercioId, programaId, {
      ...BRANDING_VACIO,
      selloMeta: 0,
      sellosRegalo: 2,
    });

    expect(res).toEqual({ ok: false, error: 'La meta de sellos debe ser un número entero mayor que cero.' });
  });
});

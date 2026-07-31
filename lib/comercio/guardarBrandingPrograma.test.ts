import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { crearPrograma } from './programas';
import {
  guardarBrandingPrograma,
  brandingDeProgramas,
  brandingProgramaDesdeFormulario,
  volverAHeredarMarca,
  hayMarcaPropia,
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
  selloMeta: null,
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
      selloMeta: '',
    });

    expect(datos.colorFondo).toBe('rgb(10, 20, 30)');
    expect(datos.colorTexto, 'un campo vacío significa heredar, no un color vacío').toBeNull();
    expect(datos.colorLabel).toBeNull();
    expect(datos.difuminadoFranja).toBeNull();
    expect(datos.selloMeta).toBeNull();
  });

  it('un sello_meta con basura queda NaN para que la validación lo rechace, no 12 en silencio', () => {
    // Number() y no parseInt: parseInt('12a') devuelve 12 y se tragaría el typo del dueño.
    const datos = brandingProgramaDesdeFormulario({
      brandingPropio: false,
      colorFondo: '',
      colorTexto: '',
      colorLabel: '',
      difuminadoFranja: '',
      selloMeta: '12a',
    });

    expect(Number.isNaN(datos.selloMeta)).toBe(true);
  });
});

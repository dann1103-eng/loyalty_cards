import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { crearPrograma } from './programas';
import {
  guardarReversoPrograma,
  reversoDePrograma,
  volverAHeredarReverso,
  hayReversoPropio,
  mostrarComoFuncionaDesdeFormulario,
} from './guardarReversoPrograma';

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

afterEach(async () => {
  await entorno.limpiar();
});

// Mismo escenario que guardarBrandingPrograma.test.ts: el comercio con su programa principal y un
// cupón al lado — dos tarjetas del mismo negocio en la billetera del cliente, cada una con lo suyo
// al dorso.
async function comercioConCupon(): Promise<{ comercioId: string; cuponId: string }> {
  const comercioId = await entorno.crearComercio({
    terminos_uso: 'Términos del negocio.',
    red_instagram: 'https://instagram.com/negocio',
    mostrar_como_funciona: true,
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
  return { comercioId, cuponId: res.id };
}

const REVERSO_VACIO = {
  terminosUso: '',
  redInstagram: '',
  redFacebook: '',
  redWhatsapp: '',
  sitioWeb: '',
  mostrarComoFunciona: null,
};

describe('guardarReversoPrograma', () => {
  it('guarda términos y redes del programa, y deja en null lo que no se escribió', async () => {
    const { comercioId, cuponId } = await comercioConCupon();

    const res = await guardarReversoPrograma(supabase, comercioId, cuponId, {
      ...REVERSO_VACIO,
      terminosUso: '  El cupón vence a los 30 días.  ',
      redInstagram: 'https://instagram.com/cupon',
    });

    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('programas_tarjeta')
      .select('terminos_uso, red_instagram, red_facebook, sitio_web, reverso_propio')
      .eq('id', cuponId)
      .single();
    expect(data!.terminos_uso, 'se guarda recortado').toBe('El cupón vence a los 30 días.');
    expect(data!.red_instagram).toBe('https://instagram.com/cupon');
    // null = heredá el del comercio. Se GUARDA null y no se copia el valor del comercio: copiarlo
    // dejaría el cupón congelado en el Facebook de hoy cuando el dueño cambie el del negocio.
    expect(data!.red_facebook, 'lo que el dueño no escribió queda en null, que es la herencia').toBeNull();
    expect(data!.sitio_web).toBeNull();
    expect(data!.reverso_propio, 'escribir un campo enciende el interruptor solo').toBe(true);
  });

  // El dueño NUNCA ve ni toca `reverso_propio`: se deriva de lo que escribió. Con todo vacío el
  // programa no tiene reverso propio y hereda entero — si esto guardara `true`, un programa sin una
  // sola línea propia mostraría un reverso VACÍO en vez del del comercio.
  it('con todos los campos vacíos el interruptor queda apagado (hereda entero)', async () => {
    const { comercioId, cuponId } = await comercioConCupon();

    const res = await guardarReversoPrograma(supabase, comercioId, cuponId, REVERSO_VACIO);

    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('programas_tarjeta')
      .select('reverso_propio, terminos_uso')
      .eq('id', cuponId)
      .single();
    expect(data!.reverso_propio).toBe(false);
    expect(data!.terminos_uso).toBeNull();
  });

  // mostrar_como_funciona es NULLABLE en el programa a propósito: null = heredar. Guardarlo como
  // `false` cuando el dueño eligió "como en mi negocio" le apagaría la sección en esa tarjeta.
  it('mostrarComoFunciona null se guarda como null (heredar), no como false', async () => {
    const { comercioId, cuponId } = await comercioConCupon();

    await guardarReversoPrograma(supabase, comercioId, cuponId, {
      ...REVERSO_VACIO,
      terminosUso: 'Algo propio.',
      mostrarComoFunciona: null,
    });

    const { data } = await supabase
      .from('programas_tarjeta')
      .select('mostrar_como_funciona')
      .eq('id', cuponId)
      .single();
    expect(data!.mostrar_como_funciona).toBeNull();
  });

  it('mostrarComoFunciona en false se guarda como false y enciende el interruptor solo', async () => {
    const { comercioId, cuponId } = await comercioConCupon();

    const res = await guardarReversoPrograma(supabase, comercioId, cuponId, {
      ...REVERSO_VACIO,
      mostrarComoFunciona: false,
    });

    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('programas_tarjeta')
      .select('mostrar_como_funciona, reverso_propio')
      .eq('id', cuponId)
      .single();
    expect(data!.mostrar_como_funciona).toBe(false);
    expect(
      data!.reverso_propio,
      'apagar la sección solo en esta tarjeta ES tener reverso propio',
    ).toBe(true);
  });

  it('rechaza un enlace que no es https', async () => {
    const { comercioId, cuponId } = await comercioConCupon();

    const res = await guardarReversoPrograma(supabase, comercioId, cuponId, {
      ...REVERSO_VACIO,
      redInstagram: 'http://instagram.com/cupon',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Instagram/i);
  });

  it('rechaza unos términos más largos que el tope', async () => {
    const { comercioId, cuponId } = await comercioConCupon();

    const res = await guardarReversoPrograma(supabase, comercioId, cuponId, {
      ...REVERSO_VACIO,
      terminosUso: 'x'.repeat(2001),
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/2000 caracteres/);
  });

  // LA prueba de seguridad: programas_tarjeta.id es un uuid que viaja en la URL del formulario. Sin
  // el scope por comercio_id, conocer el id de un programa ajeno alcanzaría para escribirle el
  // reverso al negocio de otro. El comercioId SIEMPRE viene del gate.
  it('no toca un programa de OTRO comercio aunque se conozca su id', async () => {
    const propio = await comercioConCupon();
    const ajeno = await comercioConCupon();

    const res = await guardarReversoPrograma(supabase, propio.comercioId, ajeno.cuponId, {
      ...REVERSO_VACIO,
      terminosUso: 'Texto inyectado.',
    });

    expect(res.ok, 'un programa de otro comercio no se puede tocar').toBe(false);
    if (!res.ok) expect(res.error).toMatch(/no existe/i);

    const { data } = await supabase
      .from('programas_tarjeta')
      .select('terminos_uso, reverso_propio')
      .eq('id', ajeno.cuponId)
      .single();
    expect(data!.terminos_uso, 'el programa ajeno tiene que quedar intacto').toBeNull();
    expect(data!.reverso_propio).toBe(false);
  });

  it('falla si el programa ya no existe, en vez de reportar éxito', async () => {
    const { comercioId } = await comercioConCupon();

    // Sin el .select().single(), un update de 0 filas devuelve 204 sin error y esto diría ok:true.
    const res = await guardarReversoPrograma(
      supabase,
      comercioId,
      '00000000-0000-0000-0000-000000000000',
      REVERSO_VACIO,
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/no existe/i);
  });
});

describe('volverAHeredarReverso', () => {
  // El botón "Usar el mismo reverso de mi negocio". Apaga el interruptor y NO borra las columnas:
  // publicar de nuevo le devuelve al dueño exactamente el reverso que tenía escrito.
  it('apaga el interruptor SIN borrar lo que el dueño había escrito', async () => {
    const { comercioId, cuponId } = await comercioConCupon();
    await guardarReversoPrograma(supabase, comercioId, cuponId, {
      ...REVERSO_VACIO,
      terminosUso: 'El cupón vence a los 30 días.',
    });

    const res = await volverAHeredarReverso(supabase, comercioId, cuponId);

    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('programas_tarjeta')
      .select('reverso_propio, terminos_uso')
      .eq('id', cuponId)
      .single();
    expect(data!.reverso_propio).toBe(false);
    expect(
      data!.terminos_uso,
      'no se borra: volver a publicar tiene que devolverle lo que tenía',
    ).toBe('El cupón vence a los 30 días.');
  });

  it('no apaga el de OTRO comercio aunque se conozca su id', async () => {
    const propio = await comercioConCupon();
    const ajeno = await comercioConCupon();
    await guardarReversoPrograma(supabase, ajeno.comercioId, ajeno.cuponId, {
      ...REVERSO_VACIO,
      terminosUso: 'Términos ajenos.',
    });

    const res = await volverAHeredarReverso(supabase, propio.comercioId, ajeno.cuponId);

    expect(res.ok).toBe(false);
    const { data } = await supabase
      .from('programas_tarjeta')
      .select('reverso_propio')
      .eq('id', ajeno.cuponId)
      .single();
    expect(data!.reverso_propio, 'el programa ajeno queda con su reverso encendido').toBe(true);
  });
});

describe('reversoDePrograma', () => {
  it('devuelve el reverso guardado del programa', async () => {
    const { comercioId, cuponId } = await comercioConCupon();
    await guardarReversoPrograma(supabase, comercioId, cuponId, {
      ...REVERSO_VACIO,
      terminosUso: 'El cupón vence a los 30 días.',
      mostrarComoFunciona: false,
    });

    const fila = await reversoDePrograma(supabase, comercioId, cuponId);

    expect(fila).not.toBeNull();
    expect(fila!.terminosUso).toBe('El cupón vence a los 30 días.');
    expect(fila!.mostrarComoFunciona).toBe(false);
    expect(fila!.reversoPropio).toBe(true);
    expect(fila!.sitioWeb).toBeNull();
  });

  it('devuelve null para un programa de otro comercio', async () => {
    const propio = await comercioConCupon();
    const ajeno = await comercioConCupon();

    const fila = await reversoDePrograma(supabase, propio.comercioId, ajeno.cuponId);

    expect(fila).toBeNull();
  });
});

// Puro: la regla que decide el interruptor. Se prueba aparte porque es lo que hace que el dueño
// nunca tenga que ver el booleano — si esta función se equivoca, el programa muestra un reverso
// vacío o ignora el que el dueño escribió.
describe('hayReversoPropio', () => {
  const NADA = {
    terminosUso: null,
    redInstagram: null,
    redFacebook: null,
    redWhatsapp: null,
    sitioWeb: null,
    mostrarComoFunciona: null,
  };

  it('sin ningún campo: no hay reverso propio', () => {
    expect(hayReversoPropio(NADA)).toBe(false);
  });

  it('cualquiera de los seis campos alcanza', () => {
    expect(hayReversoPropio({ ...NADA, terminosUso: 'x' })).toBe(true);
    expect(hayReversoPropio({ ...NADA, redInstagram: 'x' })).toBe(true);
    expect(hayReversoPropio({ ...NADA, redFacebook: 'x' })).toBe(true);
    expect(hayReversoPropio({ ...NADA, redWhatsapp: 'x' })).toBe(true);
    expect(hayReversoPropio({ ...NADA, sitioWeb: 'x' })).toBe(true);
    // `false` NO es "vacío": es la decisión de apagar la sección solo en esta tarjeta.
    expect(hayReversoPropio({ ...NADA, mostrarComoFunciona: false })).toBe(true);
    expect(hayReversoPropio({ ...NADA, mostrarComoFunciona: true })).toBe(true);
  });
});

// En la pantalla del programa este campo NO es una casilla: es tri-estado (heredar / mostrar /
// ocultar) y una casilla solo tiene dos. La conversión vive acá, en un módulo puro y testeable, y
// no adentro del Server Action — mismo criterio que brandingProgramaDesdeFormulario.
describe('mostrarComoFuncionaDesdeFormulario', () => {
  it('la opción vacía es heredar (null), no apagar', () => {
    expect(mostrarComoFuncionaDesdeFormulario('')).toBeNull();
  });

  it('"si" y "no" son decisiones propias de esta tarjeta', () => {
    expect(mostrarComoFuncionaDesdeFormulario('si')).toBe(true);
    expect(mostrarComoFuncionaDesdeFormulario('no')).toBe(false);
  });

  // Cualquier otra cosa (un <select> manipulado, un campo que no llegó) cae en heredar: es el
  // estado que NO cambia lo que el cliente ve hoy.
  it('un valor desconocido cae en heredar, no en apagar la sección', () => {
    expect(mostrarComoFuncionaDesdeFormulario('cualquiera')).toBeNull();
  });
});

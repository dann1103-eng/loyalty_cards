import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { createServiceClient } from '../supabase/server';
import { crearEntorno, type EntornoComercio } from '../../test/fixtures/entornoComercio';
import {
  leerConfiguracionAvisoInactividad,
  guardarConfiguracionAvisoInactividad,
  configuracionDesdeFormulario,
  procesarAvisosInactividad,
  DURACION_AVISO_INACTIVIDAD_DIAS,
} from './avisoInactividad';
import { crearPrograma, tarjetasActivasDelComercio } from './programas';
import { acreditarPuntos } from './acreditar';
import { enviarMensajeTarjeta } from './enviarMensajeTarjeta';

// ══ POR QUÉ ESTE ARCHIVO NO PUEDE TOCAR NADA QUE NO HAYA CREADO ══
// procesarAvisosInactividad recorre TODOS los comercios de la base con el aviso encendido, y la base
// de las pruebas es la REAL. Hasta el 2026-09-13 este archivo lo llamaba sin ningún mock: el día que
// un comercio de verdad encendiera su aviso, cada corrida de la suite les mandaba un push por APNs y
// por Google a sus clientes, les sobrescribía el aviso del reverso, y les marcaba
// `aviso_inactividad_enviado_en` — con lo que el cron de verdad, al día siguiente, ya no les mandaba
// el aviso legítimo. No pasó (ningún comercio real lo tenía encendido), pero el dueño está por
// encenderlo.
//
// Hacen falta DOS cercos, porque son dos escrituras distintas:
//   1. enviarMensajeTarjeta se reemplaza ENTERA (mismo criterio que avisoVencimiento.test.ts). El
//      doble solo escribe el aviso —lo mismo que el paso 1 de la función real, que las pruebas
//      necesitan para leer `aviso_hasta`— en las tarjetas que creó ESTE archivo. Para cualquier otra
//      contesta "no alcanzó ningún canal" y no toca nada.
//   2. tarjetasActivasDelComercio devuelve [] para los comercios que no creó este archivo. Con el
//      primer cerco solo NO alcanza: procesarAvisosInactividad graba `aviso_inactividad_enviado_en`
//      por su cuenta, se haya entregado o no, así que seguiría marcando las tarjetas de los comercios
//      reales. Para los comercios de la prueba delega en la función de verdad.
// El `beforeAll` de abajo aborta el archivo entero si alguno de los dos mocks se cae.
const doble = vi.hoisted(() => {
  const comerciosPropios = new Set<string>();
  const tarjetasPropias = new Set<string>();
  const entregables = new Set<string>();
  const enviar = vi.fn(
    async (
      supabase: SupabaseClient<Database>,
      tarjetaId: string,
      mensaje: string,
      vigenteHasta: string,
      _origen: 'campana' | 'inactividad' | 'vencimiento',
      _difusionId?: string,
    ) => {
      if (!tarjetasPropias.has(tarjetaId)) return { enviadoApple: false, enviadoGoogle: false };
      const { error } = await supabase
        .from('tarjetas')
        .update({ aviso_texto: mensaje, aviso_hasta: vigenteHasta })
        .eq('id', tarjetaId);
      if (error) throw error;
      return { enviadoApple: entregables.has(tarjetaId), enviadoGoogle: false };
    },
  );
  return { comerciosPropios, tarjetasPropias, entregables, enviar };
});

vi.mock('./enviarMensajeTarjeta', () => ({ enviarMensajeTarjeta: doble.enviar }));

vi.mock('./programas', async (importOriginal) => {
  const original = await importOriginal<typeof import('./programas')>();
  return {
    ...original,
    tarjetasActivasDelComercio: vi.fn(
      async (...args: Parameters<typeof original.tarjetasActivasDelComercio>) =>
        doble.comerciosPropios.has(args[1]) ? original.tarjetasActivasDelComercio(...args) : [],
    ),
  };
});

const supabase = createServiceClient();
// `base` crea sin registrar: lo usa solo la prueba que simula un comercio AJENO. Todo lo demás pasa
// por `entorno`, que anota lo que crea para que los dos cercos lo dejen pasar.
const base = crearEntorno(supabase);
const entorno: EntornoComercio = {
  ...base,
  async crearComercio(campos) {
    const id = await base.crearComercio(campos);
    doble.comerciosPropios.add(id);
    return id;
  },
  async crearTarjeta(comercioId, puntos, opciones) {
    const tarjeta = await base.crearTarjeta(comercioId, puntos, opciones);
    doble.tarjetasPropias.add(tarjeta.id);
    return tarjeta;
  },
};

beforeAll(() => {
  if (!vi.isMockFunction(enviarMensajeTarjeta) || !vi.isMockFunction(tarjetasActivasDelComercio)) {
    throw new Error(
      '[test] avisoInactividad.test.ts corre contra la base REAL: sin los mocks de enviarMensajeTarjeta y ' +
        'tarjetasActivasDelComercio les mandaría push a clientes de verdad. Ver el comentario del principio.',
    );
  }
});
beforeEach(() => {
  doble.entregables.clear();
  doble.enviar.mockClear();
});
afterEach(async () => {
  await entorno.limpiar();
  doble.comerciosPropios.clear();
  doble.tarjetasPropias.clear();
});

describe('el cerco: nada de lo que no creó la prueba se toca', () => {
  it('el doble no escribe sobre una tarjeta ajena ni dice haberla alcanzado', async () => {
    // MUTACIÓN: sin el `tarjetasPropias.has` del doble, esta prueba FALLA (le escribe el aviso).
    const comercioAjeno = await base.crearComercio();
    const ajena = await base.crearTarjeta(comercioAjeno);

    const envio = await enviarMensajeTarjeta(supabase, ajena.id, 'No debería llegar', '2099-01-01', 'inactividad');

    expect(envio).toEqual({ enviadoApple: false, enviadoGoogle: false });
    const { data } = await supabase.from('tarjetas').select('aviso_texto, aviso_hasta').eq('id', ajena.id).single();
    expect(data, 'el doble le escribió el aviso a una tarjeta que la prueba no creó').toEqual({
      aviso_texto: null,
      aviso_hasta: null,
    });
  });

  it('el recorrido no marca ni avisa a las tarjetas de un comercio que la prueba no creó', async () => {
    // Simula un comercio REAL con el aviso encendido y un cliente inactivo. MUTACIÓN: sin el filtro
    // de tarjetasActivasDelComercio esta prueba FALLA — verificado: el recorrido la cuenta como
    // avisada, y le graba `aviso_inactividad_enviado_en` aunque el doble no entregue nada.
    const comercioAjeno = await base.crearComercio();
    await guardarConfiguracionAvisoInactividad(supabase, comercioAjeno, { activo: true, dias: 30, mensaje: 'Volvé' });
    const ajena = await base.crearTarjeta(comercioAjeno, 0, {
      createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const resumen = await procesarAvisosInactividad(supabase);

    expect(resumen.avisadas).not.toContain(ajena.id);
    expect(doble.enviar.mock.calls.filter((c) => c[1] === ajena.id)).toHaveLength(0);
    const { data } = await supabase
      .from('tarjetas')
      .select('aviso_inactividad_enviado_en, aviso_hasta')
      .eq('id', ajena.id)
      .single();
    expect(data, 'marcó como avisada la tarjeta de un comercio ajeno').toEqual({
      aviso_inactividad_enviado_en: null,
      aviso_hasta: null,
    });
  });
});

describe('guardarConfiguracionAvisoInactividad / leerConfiguracionAvisoInactividad', () => {
  it('guarda y relee la configuración', async () => {
    const comercioId = await entorno.crearComercio();

    const res = await guardarConfiguracionAvisoInactividad(supabase, comercioId, {
      activo: true,
      dias: 30,
      mensaje: 'Te extrañamos, volvé pronto',
    });
    expect(res.ok).toBe(true);

    const leido = await leerConfiguracionAvisoInactividad(supabase, comercioId);
    expect(leido).toEqual({ activo: true, dias: 30, mensaje: 'Te extrañamos, volvé pronto' });
  });

  it('rechaza días en cero o negativos', async () => {
    const comercioId = await entorno.crearComercio();
    const res = await guardarConfiguracionAvisoInactividad(supabase, comercioId, { activo: true, dias: 0, mensaje: 'X' });
    expect(res.ok).toBe(false);
  });
});

describe('configuracionDesdeFormulario', () => {
  it('cadena vacía en días se convierte en null', () => {
    const res = configuracionDesdeFormulario({ activo: 'on', dias: '', mensaje: 'Hola' });
    expect(res.dias).toBeNull();
  });
});

describe('procesarAvisosInactividad', () => {
  it('una tarjeta activa y otra inactiva del MISMO cliente: el aviso llega SOLO a la inactiva', async () => {
    // Caso motivador de la decisión 5 del spec: con programas de tarjeta, un cliente puede tener
    // su tarjeta de sellos activa y su cupón de bienvenida olvidado.
    const comercioId = await entorno.crearComercio();
    await guardarConfiguracionAvisoInactividad(supabase, comercioId, { activo: true, dias: 30, mensaje: 'Volvé' });
    const cuponPrograma = await crearPrograma(supabase, comercioId, {
      nombre: 'Cupón de bienvenida', tipoTarjeta: 'cupon',
      cashbackPorcentaje: null, multipassVisitas: null, membresiaDias: null, cuponVigenciaDias: null,
    });
    expect(cuponPrograma.ok).toBe(true);
    if (!cuponPrograma.ok) return;

    const { id: tarjetaActiva } = await entorno.crearTarjeta(comercioId);
    const tarjetaInactiva = await entorno.crearTarjeta(comercioId, 0, {
      programaId: cuponPrograma.id,
      createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    });
    // Actividad reciente en la tarjeta "activa" — un acreditar de verdad, no un insert a mano, para
    // que quede una fila de transacciones_puntos con created_at de HOY (mismo helper que
    // acreditar.test.ts/historial.test.ts usan con este mismo fixture).
    const resultadoAcreditar = await acreditarPuntos(supabase, comercioId, tarjetaActiva, 1);
    expect(resultadoAcreditar.ok).toBe(true);

    const resumen = await procesarAvisosInactividad(supabase);

    expect(resumen.avisadas).toContain(tarjetaInactiva.id);
    expect(resumen.avisadas).not.toContain(tarjetaActiva);

    // vigenteHasta es un valor fijo del sistema (DURACION_AVISO_INACTIVIDAD_DIAS), no una perilla
    // más — confirmá que lo que quedó grabado en la tarjeta es HOY + esos días, no un valor mágico.
    const { data: filaAviso } = await supabase.from('tarjetas').select('aviso_hasta').eq('id', tarjetaInactiva.id).single();
    const esperado = new Date(Date.now() + DURACION_AVISO_INACTIVIDAD_DIAS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(filaAviso!.aviso_hasta).toBe(esperado);
  });

  it('una tarjeta SIN ninguna fila de ledger cuenta created_at como su última actividad', async () => {
    const comercioId = await entorno.crearComercio();
    await guardarConfiguracionAvisoInactividad(supabase, comercioId, { activo: true, dias: 30, mensaje: 'Volvé' });
    const tarjeta = await entorno.crearTarjeta(comercioId, 0, {
      createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const resumen = await procesarAvisosInactividad(supabase);

    expect(resumen.avisadas).toContain(tarjeta.id);
  });

  it('una tarjeta SIN ninguna fila de ledger y created_at RECIENTE no se avisa', async () => {
    // Discrimina el mismo fallback que la prueba anterior, pero desde el otro lado: con una
    // tarjeta VIEJA, Math.max(...[]) (candidatas vacío, sin el fallback a created_at) da
    // -Infinity, que la comparación `> umbralMs` trata como "siempre vencido" — así que esa
    // prueba de arriba pasa igual con o sin el fallback, por coincidencia. Acá, con created_at
    // de HOY, el fallback SÍ importa: sin él, -Infinity seguiría marcando esta tarjeta como
    // vencida cuando en realidad es nueva.
    const comercioId = await entorno.crearComercio();
    await guardarConfiguracionAvisoInactividad(supabase, comercioId, { activo: true, dias: 30, mensaje: 'Volvé' });
    const { id: tarjetaId } = await entorno.crearTarjeta(comercioId); // created_at de HOY, sin ledger

    const resumen = await procesarAvisosInactividad(supabase);

    expect(resumen.avisadas).not.toContain(tarjetaId);
  });

  it('un cupón YA USADO nunca recibe aviso de inactividad', async () => {
    const comercioId = await entorno.crearComercio();
    await guardarConfiguracionAvisoInactividad(supabase, comercioId, { activo: true, dias: 30, mensaje: 'Volvé' });
    const cuponPrograma = await crearPrograma(supabase, comercioId, {
      nombre: 'Cupón', tipoTarjeta: 'cupon',
      cashbackPorcentaje: null, multipassVisitas: null, membresiaDias: null, cuponVigenciaDias: null,
    });
    expect(cuponPrograma.ok).toBe(true);
    if (!cuponPrograma.ok) return;
    const hace40dias = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    // created_at TAMBIÉN vencido (no solo usado_en): sin esto, la tarjeta ya queda afuera por el
    // umbral de inactividad (created_at por default es HOY) y la prueba pasaría igual con o sin
    // la exclusión de cupón usado — no discriminaría la mutación del Step 6.
    const tarjeta = await entorno.crearTarjeta(comercioId, 0, {
      programaId: cuponPrograma.id,
      createdAt: hace40dias,
    });
    // usado_en no es parte del helper (lo necesita solo esta prueba): se aplica por update, con la
    // tarjeta YA rastreada para la limpieza.
    await supabase.from('tarjetas').update({ usado_en: hace40dias }).eq('id', tarjeta.id);

    const resumen = await procesarAvisosInactividad(supabase);

    expect(resumen.avisadas).not.toContain(tarjeta.id);
  });

  it('no re-avisa la misma tarjeta si no hubo actividad nueva desde el último aviso', async () => {
    const comercioId = await entorno.crearComercio();
    await guardarConfiguracionAvisoInactividad(supabase, comercioId, { activo: true, dias: 30, mensaje: 'Volvé' });
    const hace40dias = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const tarjeta = await entorno.crearTarjeta(comercioId, 0, {
      createdAt: hace40dias.toISOString(),
    });
    // "ya se avisó HOY": va por update para que la tarjeta quede rastreada por el fixture.
    await supabase
      .from('tarjetas')
      .update({ aviso_inactividad_enviado_en: new Date().toISOString() })
      .eq('id', tarjeta.id);

    const resumen = await procesarAvisosInactividad(supabase);

    expect(resumen.avisadas).not.toContain(tarjeta.id);
  });

  it('sin comercios con aviso_inactividad_activo, no hace nada', async () => {
    const resumen = await procesarAvisosInactividad(supabase);
    expect(resumen).toEqual({ comerciosRevisados: expect.any(Number), avisadas: expect.any(Array) });
  });
});

describe('un cupón VENCIDO tampoco recibe aviso', () => {
  it('no se le pide volver por algo que ya no se le puede dar', async () => {
    // El código salteaba el cupón YA USADO pero no el VENCIDO, y son las dos formas en que un cupón
    // muere. `usar_cupon_atomico` rechaza un cupón vencido con 'cupon_vencido', así que el push le
    // dice al cliente que vuelva por algo que el cajero no le va a poder entregar: queda mal el
    // comercio y el cliente se va con las manos vacías.
    const comercioId = await entorno.crearComercio();
    await guardarConfiguracionAvisoInactividad(supabase, comercioId, { activo: true, dias: 30, mensaje: 'Volvé' });
    const cuponPrograma = await crearPrograma(supabase, comercioId, {
      nombre: 'Cupón vencido', tipoTarjeta: 'cupon',
      cashbackPorcentaje: null, multipassVisitas: null, membresiaDias: null, cuponVigenciaDias: null,
    });
    expect(cuponPrograma.ok).toBe(true);
    if (!cuponPrograma.ok) return;

    const hace40dias = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    // created_at viejo TAMBIÉN, por el mismo motivo que la prueba del cupón usado: si no, la tarjeta
    // queda afuera por el umbral de inactividad y la prueba pasaría sin discriminar nada.
    const tarjeta = await entorno.crearTarjeta(comercioId, 0, {
      programaId: cuponPrograma.id,
      createdAt: hace40dias,
    });
    // Vencido pero NO usado: es exactamente el caso que la condición vieja dejaba pasar.
    await supabase.from('tarjetas').update({ vigencia_hasta: '2020-01-01' }).eq('id', tarjeta.id);

    const resumen = await procesarAvisosInactividad(supabase);

    expect(resumen.avisadas, 'le pidió volver por un cupón que ya no puede canjear').not.toContain(tarjeta.id);
  });

  it('un cupón VIGENTE sí recibe el aviso', async () => {
    // La otra mitad: si se saltearan TODOS los cupones, la prueba de arriba pasaría igual y la
    // feature quedaría sin servir para el caso que más la necesita — recordarle a alguien que tiene
    // un cupón sin usar y a punto de vencer.
    const comercioId = await entorno.crearComercio();
    await guardarConfiguracionAvisoInactividad(supabase, comercioId, { activo: true, dias: 30, mensaje: 'Volvé' });
    const cuponPrograma = await crearPrograma(supabase, comercioId, {
      nombre: 'Cupón vigente', tipoTarjeta: 'cupon',
      cashbackPorcentaje: null, multipassVisitas: null, membresiaDias: null, cuponVigenciaDias: null,
    });
    expect(cuponPrograma.ok).toBe(true);
    if (!cuponPrograma.ok) return;

    const hace40dias = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const tarjeta = await entorno.crearTarjeta(comercioId, 0, {
      programaId: cuponPrograma.id,
      createdAt: hace40dias,
    });
    const dentroDeUnAnio = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await supabase.from('tarjetas').update({ vigencia_hasta: dentroDeUnAnio }).eq('id', tarjeta.id);

    const resumen = await procesarAvisosInactividad(supabase);

    expect(resumen.avisadas).toContain(tarjeta.id);
  });
});

describe('una membresía VENCIDA sí recibe el aviso', () => {
  it('el que dejó vencer su membresía es a quien más querés recordarle', async () => {
    // Esta prueba nació de una mutación que SOBREVIVIÓ: quitarle el `tipoTarjeta === 'cupon'` a la
    // guarda no rompía nada, porque todas las pruebas de vigencia usaban cupones. Pero sin ese
    // scope, una membresía vencida —que TIENE vigencia_hasta— quedaría salteada, y es exactamente
    // el cliente al que hay que avisarle: un cupón vencido ya no se puede canjear, pero una
    // membresía vencida se RENUEVA. Son opuestos y la misma columna los describe.
    const comercioId = await entorno.crearComercio();
    await guardarConfiguracionAvisoInactividad(supabase, comercioId, { activo: true, dias: 30, mensaje: 'Volvé' });
    const membresia = await crearPrograma(supabase, comercioId, {
      nombre: 'Socios', tipoTarjeta: 'membresia',
      cashbackPorcentaje: null, multipassVisitas: null, membresiaDias: 30, cuponVigenciaDias: null,
    });
    expect(membresia.ok).toBe(true);
    if (!membresia.ok) return;

    const hace40dias = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const tarjeta = await entorno.crearTarjeta(comercioId, 0, {
      programaId: membresia.id,
      createdAt: hace40dias,
    });
    await supabase.from('tarjetas').update({ vigencia_hasta: '2020-01-01' }).eq('id', tarjeta.id);

    const resumen = await procesarAvisosInactividad(supabase);

    expect(resumen.avisadas, 'no le avisó a alguien con la membresía vencida').toContain(tarjeta.id);
  });
});

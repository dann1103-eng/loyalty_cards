import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { TIPOS } from '../tarjetas/tipos';
import { hoyEnZona, sumarDias } from '../tarjetas/vigencia';
import {
  correspondeAvisar,
  textoAviso,
  validarAvisoVencimiento,
  procesarAvisosVencimiento,
  AVISO_VENCIMIENTO_POR_TIPO,
  DURACION_AVISO_VENCIMIENTO_DIAS,
  MAXIMO_DIAS_AVISO_VENCIMIENTO,
} from './avisoVencimiento';

// ══ POR QUÉ SE MOCKEA enviarMensajeTarjeta ENTERA, y no solo Google ══
// procesarAvisosVencimiento recorre TODOS los programas con el aviso encendido de la base, y la base
// de las pruebas es la REAL. Con la función de verdad, una corrida de esta suite le podría mandar un
// push a un socio de verdad de un comercio de verdad (Apple no está mockeado en ningún lado), y le
// grabaría la marca de "ya avisado" a su tarjeta: el día que le tocaba, el aviso ya no saldría.
// El doble devuelve "no alcanzó ningún canal" para toda tarjeta que la prueba no haya declarado
// entregable, así que sobre las ajenas el recorrido no escribe nada. Y sin tocar Google ni Apple.
const entregables = new Set<string>();
const enviarMock = vi.fn(async (_supabase: unknown, tarjetaId: string, _mensaje: string, _vigenteHasta: string, _origen: string) => ({
  enviadoApple: entregables.has(tarjetaId),
  enviadoGoogle: false,
}));

vi.mock('./enviarMensajeTarjeta', () => ({
  enviarMensajeTarjeta: (...args: Parameters<typeof enviarMock>) => enviarMock(...args),
}));

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

beforeEach(() => {
  entregables.clear();
  enviarMock.mockClear();
});
afterEach(() => entorno.limpiar());

function llamadasA(tarjetaId: string) {
  return enviarMock.mock.calls.filter((c) => c[1] === tarjetaId);
}

// ─────────────────────────────────────────────────────────────────────────────
// correspondeAvisar — la ventana, pura
// ─────────────────────────────────────────────────────────────────────────────

describe('correspondeAvisar', () => {
  const HOY = '2026-09-13';
  const sinAvisar = { usadoEn: null, avisoVencimientoPara: null };

  it('faltan EXACTAMENTE N días: avisa', () => {
    expect(correspondeAvisar({ ...sinAvisar, vigenciaHasta: '2026-09-23' }, 10, HOY)).toBe(true);
  });

  it('faltan MENOS de N (el cron no corrió el día N): igual avisa', () => {
    // MUTACIÓN (a): con la ventana en igualdad estricta (`=== diasAntes`) esta prueba FALLA. Es el
    // caso de la decisión 5: si el cron se cae el día justo, el aviso de igualdad se pierde para
    // siempre y nadie se entera.
    expect(
      correspondeAvisar({ ...sinAvisar, vigenciaHasta: '2026-09-20' }, 10, HOY),
      'con faltan 7 y aviso a 10 no avisó: la ventana es "N o menos", no "exactamente N"',
    ).toBe(true);
  });

  it('el mismo día del vencimiento todavía cuenta', () => {
    expect(correspondeAvisar({ ...sinAvisar, vigenciaHasta: HOY }, 10, HOY)).toBe(true);
  });

  it('caso 5: faltan MÁS de N días: no avisa todavía', () => {
    expect(correspondeAvisar({ ...sinAvisar, vigenciaHasta: '2026-09-24' }, 10, HOY)).toBe(false);
  });

  it('cuenta los días de calendario cruzando el fin de mes', () => {
    expect(correspondeAvisar({ ...sinAvisar, vigenciaHasta: '2026-10-08' }, 10, '2026-09-28')).toBe(true);
    expect(correspondeAvisar({ ...sinAvisar, vigenciaHasta: '2026-10-09' }, 10, '2026-09-28')).toBe(false);
  });

  it('caso 1: sin vigenciaHasta (membresía sin activar, cupón que no vence) no avisa', () => {
    expect(correspondeAvisar({ ...sinAvisar, vigenciaHasta: null }, 10, HOY)).toBe(false);
  });

  it('caso 2: un cupón YA USADO no avisa aunque esté dentro de la ventana', () => {
    // MUTACIÓN (b): sin el chequeo de usadoEn esta prueba FALLA.
    expect(
      correspondeAvisar({ vigenciaHasta: '2026-09-20', usadoEn: '2026-09-01T15:00:00+00:00', avisoVencimientoPara: null }, 10, HOY),
      'le avisó "tu cupón está por vencer" a un cupón que ya se usó',
    ).toBe(false);
  });

  it('caso 3: ya se avisó para ESA misma fecha: no avisa de nuevo', () => {
    expect(
      correspondeAvisar({ vigenciaHasta: '2026-09-20', usadoEn: null, avisoVencimientoPara: '2026-09-20' }, 10, HOY),
    ).toBe(false);
  });

  it('la marca de un vencimiento ANTERIOR no frena el aviso del período nuevo', () => {
    // Es la razón de que la marca sea una fecha y no un booleano (decisión 4): al renovar,
    // vigencia_hasta cambia y el aviso siguiente sale sin que nadie resetee nada.
    expect(
      correspondeAvisar({ vigenciaHasta: '2026-09-20', usadoEn: null, avisoVencimientoPara: '2026-08-21' }, 10, HOY),
    ).toBe(true);
  });

  it('caso 4: la fecha ya pasó: no avisa (ahí le toca al aviso de inactividad)', () => {
    expect(correspondeAvisar({ ...sinAvisar, vigenciaHasta: '2026-09-12' }, 10, HOY)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// textoAviso — el mensaje del dueño + la fecha que pone la app
// ─────────────────────────────────────────────────────────────────────────────

describe('textoAviso', () => {
  it('mensaje vacío en una membresía: el texto por defecto del tipo, más la fecha real', () => {
    expect(textoAviso(null, 'membresia', '2026-10-12')).toBe(
      'Tu membresía está por vencer. Renovala en el local. Vence el 12 de octubre de 2026.',
    );
  });

  it('mensaje vacío en un cupón: el texto por defecto del tipo, más la fecha real', () => {
    expect(textoAviso('', 'cupon', '2026-10-12')).toBe(
      'Tu cupón está por vencer. Aprovechalo antes de que se te pase. Vence el 12 de octubre de 2026.',
    );
  });

  it('un mensaje de puros espacios cuenta como vacío', () => {
    expect(textoAviso('   ', 'cupon', '2026-10-12')).toBe(
      'Tu cupón está por vencer. Aprovechalo antes de que se te pase. Vence el 12 de octubre de 2026.',
    );
  });

  it('el mensaje del dueño va primero y la fecha la agrega la app', () => {
    expect(textoAviso('¡Renová esta semana y te regalamos un batido!', 'membresia', '2026-10-12')).toBe(
      '¡Renová esta semana y te regalamos un batido! Vence el 12 de octubre de 2026.',
    );
  });

  it('si el dueño no cerró la frase, se le pone el punto para que la fecha no quede pegada', () => {
    expect(textoAviso('  Te esperamos en el gimnasio  ', 'membresia', '2026-10-12')).toBe(
      'Te esperamos en el gimnasio. Vence el 12 de octubre de 2026.',
    );
  });

  it('cada tipo con vigencia tiene su texto por defecto propio', () => {
    // Un tipo nuevo con usaVigencia hace fallar esta prueba hasta que alguien le escriba su texto:
    // si no, heredaría el genérico y el cliente leería algo que no describe su tarjeta.
    const conVigencia = TIPOS.filter((t) => t.usaVigencia);
    expect(conVigencia.length).toBeGreaterThan(0);
    for (const tipo of conVigencia) {
      const propio = AVISO_VENCIMIENTO_POR_TIPO[tipo.valor];
      expect(propio, `el tipo ${tipo.valor} no tiene texto por defecto`).toBeTruthy();
      expect(textoAviso(null, tipo.valor, '2026-10-12')).toBe(`${propio} Vence el 12 de octubre de 2026.`);
    }
    const textos = conVigencia.map((t) => AVISO_VENCIMIENTO_POR_TIPO[t.valor]);
    expect(new Set(textos).size).toBe(textos.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validarAvisoVencimiento
// ─────────────────────────────────────────────────────────────────────────────

describe('validarAvisoVencimiento', () => {
  it('apagado no exige días ni cruza contra el plazo', () => {
    expect(validarAvisoVencimiento({ activo: false, dias: null, mensaje: null }, 'membresia', 30)).toBeNull();
    expect(validarAvisoVencimiento({ activo: false, dias: 30, mensaje: null }, 'membresia', 30)).toBeNull();
    expect(validarAvisoVencimiento({ activo: false, dias: 10, mensaje: null }, 'cupon', null)).toBeNull();
  });

  it('encendido exige los días', () => {
    expect(validarAvisoVencimiento({ activo: true, dias: null, mensaje: null }, 'membresia', 30)).toBe(
      'Poné cuántos días antes del vencimiento se manda el aviso.',
    );
  });

  it('los días son un entero entre 1 y el máximo', () => {
    const rango = `Los días de anticipación tienen que ser un número entero entre 1 y ${MAXIMO_DIAS_AVISO_VENCIMIENTO}.`;
    for (const dias of [0, -3, 2.5, Number.NaN, MAXIMO_DIAS_AVISO_VENCIMIENTO + 1]) {
      expect(validarAvisoVencimiento({ activo: true, dias, mensaje: null }, 'membresia', 365), `dias=${dias}`).toBe(rango);
    }
    expect(validarAvisoVencimiento({ activo: true, dias: MAXIMO_DIAS_AVISO_VENCIMIENTO, mensaje: null }, 'membresia', 365)).toBeNull();
    expect(validarAvisoVencimiento({ activo: true, dias: 1, mensaje: null }, 'membresia', 365)).toBeNull();
  });

  it('el mensaje es OPCIONAL: vacío usa el texto por defecto del tipo', () => {
    expect(validarAvisoVencimiento({ activo: true, dias: 7, mensaje: null }, 'membresia', 30)).toBeNull();
    expect(validarAvisoVencimiento({ activo: true, dias: 7, mensaje: '' }, 'cupon', 30)).toBeNull();
  });

  it('en membresía la anticipación no puede alcanzar la duración de la renovación', () => {
    // MUTACIÓN (c): sin el cruce `dias < plazoDias` esta prueba FALLA. Con membresía de 30 días y
    // aviso a 30, el socio recibe "tu membresía está por vencer" al día siguiente de pagar.
    expect(
      validarAvisoVencimiento({ activo: true, dias: 30, mensaje: null }, 'membresia', 30),
      'dejó guardar un aviso que le llega al socio apenas renueva',
    ).toBe(
      'El aviso tiene que salir con menos de 30 días de anticipación: cada renovación dura 30 días, así que avisar 30 días antes le diría "está por vencer" al socio apenas termina de pagar.',
    );
    expect(validarAvisoVencimiento({ activo: true, dias: 45, mensaje: null }, 'membresia', 30)).toBe(
      'El aviso tiene que salir con menos de 30 días de anticipación: cada renovación dura 30 días, así que avisar 45 días antes le diría "está por vencer" al socio apenas termina de pagar.',
    );
    expect(validarAvisoVencimiento({ activo: true, dias: 29, mensaje: null }, 'membresia', 30)).toBeNull();
  });

  it('en cupón la anticipación no puede alcanzar los días de vigencia', () => {
    expect(validarAvisoVencimiento({ activo: true, dias: 7, mensaje: null }, 'cupon', 7)).toBe(
      'El aviso tiene que salir con menos de 7 días de anticipación: el cupón vale 7 días desde que se entrega, así que avisar 7 días antes le diría "está por vencer" al cliente apenas lo recibe.',
    );
    expect(validarAvisoVencimiento({ activo: true, dias: 6, mensaje: null }, 'cupon', 7)).toBeNull();
  });

  it('un cupón SIN plazo no vence nunca: el aviso no se puede encender', () => {
    expect(validarAvisoVencimiento({ activo: true, dias: 5, mensaje: null }, 'cupon', null)).toBe(
      'Este cupón no vence nunca (no tiene días de vigencia), así que no hay vencimiento que avisar. Poné los días de vigencia o apagá el aviso.',
    );
  });

  it('una membresía sin duración configurada tampoco puede encenderlo', () => {
    expect(validarAvisoVencimiento({ activo: true, dias: 5, mensaje: null }, 'membresia', null)).toBe(
      'Poné cuántos días dura cada renovación antes de encender el aviso.',
    );
  });

  it('un tipo sin vigencia no puede encender el aviso', () => {
    expect(validarAvisoVencimiento({ activo: true, dias: 5, mensaje: null }, 'puntos', null)).toBe(
      'Este tipo de tarjeta no tiene fecha de vencimiento: no hay aviso que mandar.',
    );
  });

  it('el mensaje admite hasta 200 caracteres, contados como los cuenta la base', () => {
    const error = 'El mensaje del aviso puede tener hasta 200 caracteres.';
    expect(validarAvisoVencimiento({ activo: true, dias: 7, mensaje: 'a'.repeat(200) }, 'membresia', 30)).toBeNull();
    expect(validarAvisoVencimiento({ activo: true, dias: 7, mensaje: 'a'.repeat(201) }, 'membresia', 30)).toBe(error);
    // char_length de Postgres cuenta caracteres, no unidades UTF-16: 200 emojis son 200 para el
    // CHECK aunque para `.length` de JS sean 400. Rechazarlos sería frenar algo que la base acepta.
    expect(validarAvisoVencimiento({ activo: true, dias: 7, mensaje: '🎉'.repeat(200) }, 'membresia', 30)).toBeNull();
  });

  it('lo que el CHECK de la base rechaza se rechaza aunque el aviso esté apagado', () => {
    // El CHECK de la 0034 no mira el interruptor. Dejarlo pasar acá solo cambia un motivo claro por
    // un "No se pudo guardar la configuración" genérico al llegar a la base.
    expect(validarAvisoVencimiento({ activo: false, dias: null, mensaje: 'a'.repeat(201) }, 'membresia', 30)).toBe(
      'El mensaje del aviso puede tener hasta 200 caracteres.',
    );
    expect(validarAvisoVencimiento({ activo: false, dias: 91, mensaje: null }, 'membresia', 365)).toBe(
      `Los días de anticipación tienen que ser un número entero entre 1 y ${MAXIMO_DIAS_AVISO_VENCIMIENTO}.`,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// procesarAvisosVencimiento — el recorrido, contra la base
// ─────────────────────────────────────────────────────────────────────────────
// La configuración se escribe en el PROGRAMA, por su id, y el comercio queda con sus valores por
// defecto: si el recorrido leyera la configuración del comercio (la columna legada), estas pruebas
// no lo tapan. Ver la regla del fixture legado en CLAUDE.md.

type CamposPrograma = Partial<{
  tipo_tarjeta: string;
  membresia_dias: number | null;
  cupon_vigencia_dias: number | null;
  aviso_vencimiento_activo: boolean;
  aviso_vencimiento_dias: number | null;
  aviso_vencimiento_mensaje: string | null;
}>;

async function comercioConPrograma(campos: CamposPrograma): Promise<{ comercioId: string; hoy: string }> {
  const comercioId = await entorno.crearComercio({ zona_horaria: 'America/El_Salvador' });
  const { error } = await supabase
    .from('programas_tarjeta')
    .update(campos)
    .eq('id', entorno.obtenerProgramaPrincipal(comercioId));
  if (error) throw error;
  return { comercioId, hoy: hoyEnZona('America/El_Salvador') };
}

async function tarjetaQueVence(comercioId: string, vigenciaHasta: string): Promise<string> {
  const { id } = await entorno.crearTarjeta(comercioId);
  const { error } = await supabase.from('tarjetas').update({ vigencia_hasta: vigenciaHasta }).eq('id', id);
  if (error) throw error;
  return id;
}

async function marcaDe(tarjetaId: string): Promise<string | null> {
  const { data, error } = await supabase.from('tarjetas').select('aviso_vencimiento_para').eq('id', tarjetaId).single();
  if (error) throw error;
  return data.aviso_vencimiento_para;
}

const MEMBRESIA_CON_AVISO: CamposPrograma = {
  tipo_tarjeta: 'membresia',
  membresia_dias: 30,
  aviso_vencimiento_activo: true,
  aviso_vencimiento_dias: 10,
  aviso_vencimiento_mensaje: null,
};

describe('procesarAvisosVencimiento', () => {
  it('avisa a la membresía dentro de la ventana, con la fecha real, y graba la marca', async () => {
    // El programa NO tiene mensaje: copiarle al recorrido el filtro del cron de inactividad
    // (`.not('aviso_vencimiento_mensaje', 'is', null)`) hace FALLAR esta prueba — verificado.
    const { comercioId, hoy } = await comercioConPrograma(MEMBRESIA_CON_AVISO);
    const vence = sumarDias(hoy, 7);
    const dentro = await tarjetaQueVence(comercioId, vence);
    const fuera = await tarjetaQueVence(comercioId, sumarDias(hoy, 20));
    entregables.add(dentro).add(fuera);

    const resumen = await procesarAvisosVencimiento(supabase);

    expect(resumen.avisadas).toContain(dentro);
    expect(resumen.avisadas, 'avisó a una membresía a la que le faltan 20 días con aviso a 10').not.toContain(fuera);
    expect(llamadasA(fuera)).toHaveLength(0);

    const [llamada] = llamadasA(dentro);
    expect(llamada[2]).toBe(textoAviso(null, 'membresia', vence));
    expect(llamada[4]).toBe('vencimiento');
    expect(await marcaDe(dentro)).toBe(vence);
  });

  it('el aviso queda en el reverso hasta el vencimiento o DURACION días, lo que llegue primero', async () => {
    const { comercioId, hoy } = await comercioConPrograma({ ...MEMBRESIA_CON_AVISO, membresia_dias: 90, aviso_vencimiento_dias: 60 });
    const pronto = await tarjetaQueVence(comercioId, sumarDias(hoy, 3));
    const lejos = await tarjetaQueVence(comercioId, sumarDias(hoy, 40));
    entregables.add(pronto).add(lejos);

    await procesarAvisosVencimiento(supabase);

    // Pasada la fecha el texto "Vence el …" ya es falso, y un aviso vigente en el reverso frena al de
    // inactividad, que es el que le corresponde al socio vencido.
    expect(llamadasA(pronto)[0][3]).toBe(sumarDias(hoy, 3));
    expect(llamadasA(lejos)[0][3]).toBe(sumarDias(hoy, DURACION_AVISO_VENCIMIENTO_DIAS));
  });

  it('el mensaje del dueño viaja con la fecha que pone la app', async () => {
    const { comercioId, hoy } = await comercioConPrograma({
      ...MEMBRESIA_CON_AVISO,
      aviso_vencimiento_mensaje: 'Renová esta semana y te regalamos un batido',
    });
    const vence = sumarDias(hoy, 2);
    const tarjeta = await tarjetaQueVence(comercioId, vence);
    entregables.add(tarjeta);

    await procesarAvisosVencimiento(supabase);

    expect(llamadasA(tarjeta)[0][2]).toBe(textoAviso('Renová esta semana y te regalamos un batido', 'membresia', vence));
  });

  it('no avisa dos veces el mismo vencimiento', async () => {
    const { comercioId, hoy } = await comercioConPrograma(MEMBRESIA_CON_AVISO);
    const tarjeta = await tarjetaQueVence(comercioId, sumarDias(hoy, 5));
    entregables.add(tarjeta);

    const primera = await procesarAvisosVencimiento(supabase);
    expect(primera.avisadas).toContain(tarjeta);

    enviarMock.mockClear();
    const segunda = await procesarAvisosVencimiento(supabase);

    expect(segunda.avisadas, 'avisó dos veces por el mismo vencimiento').not.toContain(tarjeta);
    expect(llamadasA(tarjeta)).toHaveLength(0);
  });

  it('vuelve a avisar tras renovar, sin que nadie resetee la marca', async () => {
    const { comercioId, hoy } = await comercioConPrograma(MEMBRESIA_CON_AVISO);
    const tarjeta = await tarjetaQueVence(comercioId, sumarDias(hoy, 3));
    entregables.add(tarjeta);
    await procesarAvisosVencimiento(supabase);
    expect(await marcaDe(tarjeta)).toBe(sumarDias(hoy, 3));

    // La renovación mueve vigencia_hasta; la marca sigue apuntando al vencimiento viejo.
    const nuevoVencimiento = sumarDias(hoy, 9);
    await supabase.from('tarjetas').update({ vigencia_hasta: nuevoVencimiento }).eq('id', tarjeta);
    enviarMock.mockClear();

    const resumen = await procesarAvisosVencimiento(supabase);

    expect(resumen.avisadas, 'el período nuevo se quedó sin aviso').toContain(tarjeta);
    expect(await marcaDe(tarjeta)).toBe(nuevoVencimiento);
  });

  it('no avisa a un cupón usado, y sí al que sigue sin usar', async () => {
    const { comercioId, hoy } = await comercioConPrograma({
      tipo_tarjeta: 'cupon',
      cupon_vigencia_dias: 30,
      aviso_vencimiento_activo: true,
      aviso_vencimiento_dias: 10,
      aviso_vencimiento_mensaje: null,
    });
    const vence = sumarDias(hoy, 5);
    const usado = await tarjetaQueVence(comercioId, vence);
    const sinUsar = await tarjetaQueVence(comercioId, vence);
    await supabase.from('tarjetas').update({ usado_en: new Date().toISOString() }).eq('id', usado);
    entregables.add(usado).add(sinUsar);

    const resumen = await procesarAvisosVencimiento(supabase);

    expect(resumen.avisadas, 'le avisó a un cupón que ya se usó').not.toContain(usado);
    expect(llamadasA(usado)).toHaveLength(0);
    expect(resumen.avisadas).toContain(sinUsar);
    expect(llamadasA(sinUsar)[0][2]).toBe(textoAviso(null, 'cupon', vence));
  });

  it('no graba la marca si no había a quién entregarle, y reintenta al día siguiente', async () => {
    // MUTACIÓN (d): grabando la marca sin mirar si el envío alcanzó un canal, esta prueba FALLA.
    // Grabarla sin haber entregado nada dejaría a ese cliente sin aviso para siempre.
    const { comercioId, hoy } = await comercioConPrograma(MEMBRESIA_CON_AVISO);
    const tarjeta = await tarjetaQueVence(comercioId, sumarDias(hoy, 4));
    // NO entregable: el doble responde enviadoApple=false, enviadoGoogle=false.

    const resumen = await procesarAvisosVencimiento(supabase);

    expect(llamadasA(tarjeta)).toHaveLength(1);
    expect(await marcaDe(tarjeta), 'grabó "ya avisado" sin haberle entregado nada').toBeNull();
    expect(resumen.avisadas).not.toContain(tarjeta);
    expect(resumen.sinEntregar).toContain(tarjeta);

    // Instaló el pase: la corrida siguiente sí le llega.
    entregables.add(tarjeta);
    const despues = await procesarAvisosVencimiento(supabase);
    expect(despues.avisadas).toContain(tarjeta);
    expect(await marcaDe(tarjeta)).toBe(sumarDias(hoy, 4));
  });

  it('un programa sin vigencia no avisa aunque tenga el interruptor encendido', async () => {
    const { comercioId, hoy } = await comercioConPrograma({
      tipo_tarjeta: 'puntos',
      aviso_vencimiento_activo: true,
      aviso_vencimiento_dias: 10,
    });
    const tarjeta = await tarjetaQueVence(comercioId, sumarDias(hoy, 3));
    entregables.add(tarjeta);

    const resumen = await procesarAvisosVencimiento(supabase);

    expect(resumen.avisadas).not.toContain(tarjeta);
    expect(llamadasA(tarjeta)).toHaveLength(0);
  });

  it('con el interruptor apagado no avisa', async () => {
    const { comercioId, hoy } = await comercioConPrograma({ ...MEMBRESIA_CON_AVISO, aviso_vencimiento_activo: false });
    const tarjeta = await tarjetaQueVence(comercioId, sumarDias(hoy, 3));
    entregables.add(tarjeta);

    const resumen = await procesarAvisosVencimiento(supabase);

    expect(resumen.avisadas).not.toContain(tarjeta);
    expect(llamadasA(tarjeta)).toHaveLength(0);
  });
});

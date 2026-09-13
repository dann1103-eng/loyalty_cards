import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import {
  listarProgramas,
  crearPrograma,
  guardarConfiguracionPrograma,
  desactivarPrograma,
  resolverProgramaPorSlug,
  obtenerPrograma,
  configuracionProgramaDesdeFormulario,
  tarjetasActivasDelComercio,
  MAXIMO_PROGRAMAS_ACTIVOS,
  type DatosNuevoPrograma,
} from './programas';

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

afterEach(() => entorno.limpiar());

// Config vacía por default: cada prueba solo llena el campo que le importa a SU tipo.
function datos(tipoTarjeta: string, nombre: string, overrides: Partial<DatosNuevoPrograma> = {}): DatosNuevoPrograma {
  return {
    nombre,
    tipoTarjeta,
    cashbackPorcentaje: null,
    multipassVisitas: null,
    membresiaDias: null,
    cuponVigenciaDias: null,
    ...overrides,
  };
}

// El aviso antes del vencimiento tal como NACE un programa (defaults de la 0034): apagado y vacío. Lo
// usan los llamadores que prueban otra cosa: `guardarConfiguracionPrograma` escribe las tres columnas
// siempre, así que todo llamador tiene que decir qué aviso manda.
const SIN_AVISO = { avisoVencimientoActivo: false, avisoVencimientoDias: null, avisoVencimientoMensaje: null };

async function filaPrograma(programaId: string) {
  const { data, error } = await supabase
    .from('programas_tarjeta')
    .select('slug, es_principal, activo, tipo_tarjeta, cashback_porcentaje')
    .eq('id', programaId)
    .single();
  if (error) throw error;
  return data;
}

describe('crearPrograma', () => {
  it('crea un programa nuevo, nunca principal, con slug autogenerado del nombre', async () => {
    const comercioId = await entorno.crearComercio();

    const res = await crearPrograma(supabase, comercioId, datos('cupon', 'Cupón de Bienvenida'));

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const fila = await filaPrograma(res.id);
    expect(fila.slug).toBe('cupon-de-bienvenida');
    expect(fila.es_principal).toBe(false);
    expect(fila.activo).toBe(true);
  });

  it('rechaza nombre vacío', async () => {
    const comercioId = await entorno.crearComercio();
    const res = await crearPrograma(supabase, comercioId, datos('puntos', '   '));
    expect(res).toEqual({ ok: false, error: 'El nombre del programa es obligatorio.' });
  });

  it('rechaza un tipo que no está en el catálogo', async () => {
    const comercioId = await entorno.crearComercio();
    // 'multipass' y no 'prepago': el mismo error de nombre que ya costó una tanda de pruebas rotas
    // en tipos.ts (ver el comentario ahí) — vale la pena guardarlo también acá.
    const res = await crearPrograma(supabase, comercioId, datos('multipass', 'Paquete'));
    expect(res).toEqual({ ok: false, error: 'El tipo de tarjeta no es válido.' });
  });

  it('rechaza cashback sin porcentaje', async () => {
    const comercioId = await entorno.crearComercio();
    const res = await crearPrograma(supabase, comercioId, datos('cashback', 'Cashback VIP'));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('porcentaje');
  });

  it('rechaza prepago sin cantidad de visitas', async () => {
    const comercioId = await entorno.crearComercio();
    const res = await crearPrograma(supabase, comercioId, datos('prepago', 'Paquete de 10'));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('visitas');
  });

  it('acepta un cupón SIN vigencia — null es "nunca vence", una config válida', async () => {
    const comercioId = await entorno.crearComercio();
    const res = await crearPrograma(supabase, comercioId, datos('cupon', 'Cupón sin fecha'));
    expect(res.ok).toBe(true);
  });

  it('si el slug del nombre ya está tomado en el comercio, agrega -2', async () => {
    const comercioId = await entorno.crearComercio();
    // El fixture ya creó el programa principal con slug 'principal'. Un nombre que slugifica igual
    // tiene que resolver la colisión, no chocar contra el unique (comercio_id, slug).
    const res = await crearPrograma(supabase, comercioId, datos('puntos', 'Principal'));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const fila = await filaPrograma(res.id);
    expect(fila.slug).toBe('principal-2');
  });

  it(`permite hasta ${MAXIMO_PROGRAMAS_ACTIVOS} programas activos y rechaza el siguiente`, async () => {
    const comercioId = await entorno.crearComercio(); // 1: el principal, ya activo
    const segundo = await crearPrograma(supabase, comercioId, datos('cupon', 'Segundo programa')); // 2
    expect(segundo.ok).toBe(true);

    const tercero = await crearPrograma(supabase, comercioId, datos('cupon', 'Tercer programa'));
    expect(tercero).toEqual({
      ok: false,
      error: `Ya tenés ${MAXIMO_PROGRAMAS_ACTIVOS} programas activos. Desactivá uno antes de crear otro.`,
    });
  });

  it('un programa desactivado NO cuenta para el tope', async () => {
    const comercioId = await entorno.crearComercio();
    const segundo = await crearPrograma(supabase, comercioId, datos('cupon', 'Segundo programa'));
    expect(segundo.ok).toBe(true);
    if (!segundo.ok) return;

    const baja = await desactivarPrograma(supabase, comercioId, segundo.id);
    expect(baja.ok).toBe(true);

    // Con el segundo desactivado, queda 1 activo (el principal): hay lugar para uno más.
    const tercero = await crearPrograma(supabase, comercioId, datos('cupon', 'Tercer programa'));
    expect(tercero.ok).toBe(true);
  });
});

describe('guardarConfiguracionPrograma', () => {
  it('guarda la configuración y una lectura posterior la refleja', async () => {
    const comercioId = await entorno.crearComercio();
    const creado = await crearPrograma(supabase, comercioId, datos('cashback', 'Cashback', { cashbackPorcentaje: 3 }));
    expect(creado.ok).toBe(true);
    if (!creado.ok) return;

    const res = await guardarConfiguracionPrograma(supabase, comercioId, creado.id, {
      cashbackPorcentaje: 7.5,
      multipassVisitas: null,
      membresiaDias: null,
      cuponVigenciaDias: null,
      ...SIN_AVISO,
    });
    expect(res.ok).toBe(true);

    const fila = await filaPrograma(creado.id);
    expect(Number(fila.cashback_porcentaje)).toBe(7.5);
  });

  it('rechaza una configuración inválida para el tipo del programa (el tipo se lee de la fila)', async () => {
    const comercioId = await entorno.crearComercio();
    const creado = await crearPrograma(supabase, comercioId, datos('cashback', 'Cashback', { cashbackPorcentaje: 3 }));
    expect(creado.ok).toBe(true);
    if (!creado.ok) return;

    const res = await guardarConfiguracionPrograma(supabase, comercioId, creado.id, {
      cashbackPorcentaje: 150, // fuera de 0-100
      multipassVisitas: null,
      membresiaDias: null,
      cuponVigenciaDias: null,
      ...SIN_AVISO,
    });
    expect(res.ok).toBe(false);
  });

  it('rechaza un programaId de OTRO comercio', async () => {
    const comercioA = await entorno.crearComercio();
    const comercioB = await entorno.crearComercio();
    const deB = await crearPrograma(supabase, comercioB, datos('cashback', 'Cashback B', { cashbackPorcentaje: 3 }));
    expect(deB.ok).toBe(true);
    if (!deB.ok) return;

    const res = await guardarConfiguracionPrograma(supabase, comercioA, deB.id, {
      cashbackPorcentaje: 9,
      multipassVisitas: null,
      membresiaDias: null,
      cuponVigenciaDias: null,
      ...SIN_AVISO,
    });
    expect(res.ok).toBe(false);

    // Y el programa de B queda intacto — no se filtró el update por fuera del scope.
    const fila = await filaPrograma(deB.id);
    expect(Number(fila.cashback_porcentaje)).toBe(3);
  });
});

// ══ El aviso antes del vencimiento, guardado por el MISMO escritor que el resto de la configuración ══
// La pantalla tiene un único formulario con un único `action`, y guardarConfiguracionPrograma escribe
// sus columnas incondicionalmente: el aviso entra por acá o no entra (spec 2026-09-09, "La interfaz").
// Todos estos programas se configuran con crearPrograma/guardarConfiguracionPrograma, el camino de
// producción, nunca con un insert a mano ni con la columna del comercio.
describe('guardarConfiguracionPrograma — el aviso antes del vencimiento', () => {
  async function membresia(comercioId: string, dias: number) {
    const creado = await crearPrograma(supabase, comercioId, datos('membresia', 'Socios', { membresiaDias: dias }));
    if (!creado.ok) throw new Error(`[test] no se pudo crear la membresía: ${creado.error}`);
    return creado.id;
  }

  const configMembresia = (membresiaDias: number, aviso: { activo: boolean; dias: number | null; mensaje: string | null }) => ({
    cashbackPorcentaje: null,
    multipassVisitas: null,
    membresiaDias,
    cuponVigenciaDias: null,
    avisoVencimientoActivo: aviso.activo,
    avisoVencimientoDias: aviso.dias,
    avisoVencimientoMensaje: aviso.mensaje,
  });

  it('guarda los tres campos, y la lectura del programa los devuelve', async () => {
    const comercioId = await entorno.crearComercio();
    const programaId = await membresia(comercioId, 30);

    const res = await guardarConfiguracionPrograma(
      supabase,
      comercioId,
      programaId,
      configMembresia(30, { activo: true, dias: 5, mensaje: 'Pasá a renovar, te esperamos' }),
    );
    expect(res).toEqual({ ok: true });

    // Se relee por obtenerPrograma, la misma lectura que arma el `Programa` de la pantalla: una
    // columna que se escribe pero no se lee dejaría el formulario mostrando el aviso apagado.
    const programa = await obtenerPrograma(supabase, comercioId, programaId);
    expect(programa?.avisoVencimientoActivo).toBe(true);
    expect(programa?.avisoVencimientoDias).toBe(5);
    expect(programa?.avisoVencimientoMensaje).toBe('Pasá a renovar, te esperamos');
  });

  it('un programa recién creado tiene el aviso apagado y vacío', async () => {
    const comercioId = await entorno.crearComercio();
    const programaId = await membresia(comercioId, 30);

    const programa = await obtenerPrograma(supabase, comercioId, programaId);

    expect(programa?.avisoVencimientoActivo).toBe(false);
    expect(programa?.avisoVencimientoDias).toBeNull();
    expect(programa?.avisoVencimientoMensaje).toBeNull();
  });

  it('rechaza avisar con tantos días de anticipación como dura la membresía, y no escribe nada', async () => {
    // Decisión 8: renovar deja vigencia_hasta = hoy + 30, así que un aviso a 30 días le llegaría al
    // socio al día siguiente de pagar.
    //
    // MUTACIÓN verificada: quitar la llamada a validarAvisoVencimiento dentro de validarConfiguracion
    // (programas.ts) hace fallar esta prueba — el guardado devuelve ok y el aviso queda encendido.
    const comercioId = await entorno.crearComercio();
    const programaId = await membresia(comercioId, 30);

    const res = await guardarConfiguracionPrograma(
      supabase,
      comercioId,
      programaId,
      configMembresia(30, { activo: true, dias: 30, mensaje: null }),
    );

    expect(res).toEqual({
      ok: false,
      error:
        'El aviso tiene que salir con menos de 30 días de anticipación: cada renovación dura 30 días, así que avisar 30 días antes le diría "está por vencer" al socio apenas termina de pagar.',
    });
    expect((await obtenerPrograma(supabase, comercioId, programaId))?.avisoVencimientoActivo).toBe(false);
  });

  it('cruza contra la duración que llega en el MISMO envío, no contra la que estaba guardada', async () => {
    // El dueño tenía membresía de 30 días con aviso a 20, y ahora acorta la duración a 15 sin tocar
    // el aviso. Contra la base (30) pasaría; contra lo que está guardando (15) no.
    //
    // MUTACIÓN verificada: validar contra `membresia_dias` leído de la BASE en
    // guardarConfiguracionPrograma, en vez del que llega en `datos`, hace fallar esta prueba.
    const comercioId = await entorno.crearComercio();
    const programaId = await membresia(comercioId, 30);
    const previo = await guardarConfiguracionPrograma(
      supabase,
      comercioId,
      programaId,
      configMembresia(30, { activo: true, dias: 20, mensaje: null }),
    );
    expect(previo).toEqual({ ok: true });

    const res = await guardarConfiguracionPrograma(
      supabase,
      comercioId,
      programaId,
      configMembresia(15, { activo: true, dias: 20, mensaje: null }),
    );

    expect(res).toEqual({
      ok: false,
      error:
        'El aviso tiene que salir con menos de 15 días de anticipación: cada renovación dura 15 días, así que avisar 20 días antes le diría "está por vencer" al socio apenas termina de pagar.',
    });
    // Y no se escribió la mitad: la duración sigue en 30.
    expect((await obtenerPrograma(supabase, comercioId, programaId))?.membresiaDias).toBe(30);
  });

  it('y al revés: alargar la duración y encender el aviso en el mismo envío se acepta', async () => {
    // La otra cara de la prueba anterior: con 10 días guardados, un aviso a 20 solo es válido por la
    // duración de 60 que viene en este mismo envío. Validar contra la base lo rechazaría.
    const comercioId = await entorno.crearComercio();
    const programaId = await membresia(comercioId, 10);

    const res = await guardarConfiguracionPrograma(
      supabase,
      comercioId,
      programaId,
      configMembresia(60, { activo: true, dias: 20, mensaje: null }),
    );

    expect(res).toEqual({ ok: true });
    const programa = await obtenerPrograma(supabase, comercioId, programaId);
    expect(programa?.membresiaDias).toBe(60);
    expect(programa?.avisoVencimientoDias).toBe(20);
  });

  it('en un cupón cruza contra los días que vale el cupón', async () => {
    const comercioId = await entorno.crearComercio();
    const creado = await crearPrograma(supabase, comercioId, datos('cupon', 'Cupón', { cuponVigenciaDias: 10 }));
    if (!creado.ok) throw new Error(creado.error);
    const cupon = (avisoDias: number) => ({
      ...datos('cupon', 'Cupón', { cuponVigenciaDias: 10 }),
      avisoVencimientoActivo: true,
      avisoVencimientoDias: avisoDias,
      avisoVencimientoMensaje: null,
    });

    expect(await guardarConfiguracionPrograma(supabase, comercioId, creado.id, cupon(10))).toEqual({
      ok: false,
      error:
        'El aviso tiene que salir con menos de 10 días de anticipación: el cupón vale 10 días desde que se entrega, así que avisar 10 días antes le diría "está por vencer" al cliente apenas lo recibe.',
    });
    expect(await guardarConfiguracionPrograma(supabase, comercioId, creado.id, cupon(3))).toEqual({ ok: true });
    expect((await obtenerPrograma(supabase, comercioId, creado.id))?.avisoVencimientoDias).toBe(3);
  });

  it('un cupón SIN días de vigencia no vence nunca: no puede encender el aviso', async () => {
    const comercioId = await entorno.crearComercio();
    const creado = await crearPrograma(supabase, comercioId, datos('cupon', 'Cupón sin fecha'));
    if (!creado.ok) throw new Error(creado.error);

    const res = await guardarConfiguracionPrograma(supabase, comercioId, creado.id, {
      ...datos('cupon', 'Cupón sin fecha'),
      avisoVencimientoActivo: true,
      avisoVencimientoDias: 3,
      avisoVencimientoMensaje: null,
    });

    expect(res).toEqual({
      ok: false,
      error:
        'Este cupón no vence nunca (no tiene días de vigencia), así que no hay vencimiento que avisar. Poné los días de vigencia o apagá el aviso.',
    });
    expect((await obtenerPrograma(supabase, comercioId, creado.id))?.avisoVencimientoActivo).toBe(false);
  });

  it('un tipo SIN vigencia guarda su configuración con el aviso apagado y vacío', async () => {
    // Es lo que manda su formulario, que no dibuja el bloque del aviso: nada que perder, porque en
    // estos tipos el aviso nace apagado y en null y ninguna pantalla lo puede encender.
    const comercioId = await entorno.crearComercio();
    const creado = await crearPrograma(supabase, comercioId, datos('cashback', 'Cashback', { cashbackPorcentaje: 3 }));
    if (!creado.ok) throw new Error(creado.error);

    const res = await guardarConfiguracionPrograma(supabase, comercioId, creado.id, {
      ...datos('cashback', 'Cashback', { cashbackPorcentaje: 7.5 }),
      ...SIN_AVISO,
    });

    expect(res).toEqual({ ok: true });
    const programa = await obtenerPrograma(supabase, comercioId, creado.id);
    expect(programa?.cashbackPorcentaje).toBe(7.5);
    expect(programa?.avisoVencimientoActivo).toBe(false);
    expect(programa?.avisoVencimientoDias).toBeNull();
  });

  it('y un envío armado a mano no le puede encender el aviso a un tipo sin vigencia', async () => {
    const comercioId = await entorno.crearComercio();
    const creado = await crearPrograma(supabase, comercioId, datos('cashback', 'Cashback', { cashbackPorcentaje: 3 }));
    if (!creado.ok) throw new Error(creado.error);

    const res = await guardarConfiguracionPrograma(supabase, comercioId, creado.id, {
      ...datos('cashback', 'Cashback', { cashbackPorcentaje: 3 }),
      avisoVencimientoActivo: true,
      avisoVencimientoDias: 3,
      avisoVencimientoMensaje: null,
    });

    expect(res).toEqual({
      ok: false,
      error: 'Este tipo de tarjeta no tiene fecha de vencimiento: no hay aviso que mandar.',
    });
  });
});

describe('desactivarPrograma', () => {
  it('desactiva un programa no-principal', async () => {
    const comercioId = await entorno.crearComercio();
    const creado = await crearPrograma(supabase, comercioId, datos('cupon', 'Cupón'));
    expect(creado.ok).toBe(true);
    if (!creado.ok) return;

    const res = await desactivarPrograma(supabase, comercioId, creado.id);
    expect(res.ok).toBe(true);
    expect((await filaPrograma(creado.id)).activo).toBe(false);
  });

  it('rechaza desactivar el programa PRINCIPAL', async () => {
    const comercioId = await entorno.crearComercio();
    const principalId = entorno.obtenerProgramaPrincipal(comercioId);

    const res = await desactivarPrograma(supabase, comercioId, principalId);

    expect(res.ok).toBe(false);
    expect((await filaPrograma(principalId)).activo).toBe(true);
  });

  it('rechaza un id que no existe', async () => {
    const comercioId = await entorno.crearComercio();
    const res = await desactivarPrograma(supabase, comercioId, '00000000-0000-0000-0000-000000000000');
    expect(res.ok).toBe(false);
  });

  it('rechaza un programaId de OTRO comercio (no lo desactiva por scope equivocado)', async () => {
    const comercioA = await entorno.crearComercio();
    const comercioB = await entorno.crearComercio();
    const deB = await crearPrograma(supabase, comercioB, datos('cupon', 'Cupón B'));
    expect(deB.ok).toBe(true);
    if (!deB.ok) return;

    const res = await desactivarPrograma(supabase, comercioA, deB.id);

    expect(res.ok).toBe(false);
    expect((await filaPrograma(deB.id)).activo).toBe(true);
  });
});

describe('listarProgramas', () => {
  it('ordena el principal primero', async () => {
    const comercioId = await entorno.crearComercio();
    const principalId = entorno.obtenerProgramaPrincipal(comercioId);
    const creado = await crearPrograma(supabase, comercioId, datos('cupon', 'Cupón'));
    expect(creado.ok).toBe(true);

    const lista = await listarProgramas(supabase, comercioId);

    expect(lista).not.toBeNull();
    expect(lista![0].id).toBe(principalId);
    expect(lista![0].esPrincipal).toBe(true);
  });

  it('por default trae solo los programas activos', async () => {
    const comercioId = await entorno.crearComercio();
    const creado = await crearPrograma(supabase, comercioId, datos('cupon', 'Cupón'));
    expect(creado.ok).toBe(true);
    if (!creado.ok) return;
    await desactivarPrograma(supabase, comercioId, creado.id);

    const lista = await listarProgramas(supabase, comercioId);

    expect(lista!.map((p) => p.id)).not.toContain(creado.id);
  });

  it('con soloActivos:false trae también los desactivados', async () => {
    const comercioId = await entorno.crearComercio();
    const creado = await crearPrograma(supabase, comercioId, datos('cupon', 'Cupón'));
    expect(creado.ok).toBe(true);
    if (!creado.ok) return;
    await desactivarPrograma(supabase, comercioId, creado.id);

    const lista = await listarProgramas(supabase, comercioId, { soloActivos: false });

    expect(lista!.map((p) => p.id)).toContain(creado.id);
  });
});

describe('resolverProgramaPorSlug', () => {
  it('con slug null resuelve al programa principal', async () => {
    const comercioId = await entorno.crearComercio();
    const principalId = entorno.obtenerProgramaPrincipal(comercioId);

    const res = await resolverProgramaPorSlug(supabase, comercioId, null);

    expect(res?.id).toBe(principalId);
  });

  it('con un slug de un programa activo, lo resuelve', async () => {
    const comercioId = await entorno.crearComercio();
    const creado = await crearPrograma(supabase, comercioId, datos('cupon', 'Cupón de Bienvenida'));
    expect(creado.ok).toBe(true);
    if (!creado.ok) return;

    const res = await resolverProgramaPorSlug(supabase, comercioId, 'cupon-de-bienvenida');

    expect(res?.id).toBe(creado.id);
  });

  it('un programa desactivado no resuelve por su slug — null, como si no existiera', async () => {
    const comercioId = await entorno.crearComercio();
    const creado = await crearPrograma(supabase, comercioId, datos('cupon', 'Cupón de Bienvenida'));
    expect(creado.ok).toBe(true);
    if (!creado.ok) return;
    await desactivarPrograma(supabase, comercioId, creado.id);

    const res = await resolverProgramaPorSlug(supabase, comercioId, 'cupon-de-bienvenida');

    expect(res).toBeNull();
  });

  it('un slug que no existe en el comercio da null', async () => {
    const comercioId = await entorno.crearComercio();
    const res = await resolverProgramaPorSlug(supabase, comercioId, 'no-existe');
    expect(res).toBeNull();
  });

  it('el slug de un programa de OTRO comercio no resuelve (scope por comercio_id)', async () => {
    const comercioA = await entorno.crearComercio();
    const comercioB = await entorno.crearComercio();
    const deB = await crearPrograma(supabase, comercioB, datos('cupon', 'Cupón de Bienvenida'));
    expect(deB.ok).toBe(true);

    const res = await resolverProgramaPorSlug(supabase, comercioA, 'cupon-de-bienvenida');

    expect(res).toBeNull();
  });
});

describe('obtenerPrograma', () => {
  it('devuelve el programa cuando el id y el comercio coinciden', async () => {
    const comercioId = await entorno.crearComercio();
    const principalId = entorno.obtenerProgramaPrincipal(comercioId);

    const res = await obtenerPrograma(supabase, comercioId, principalId);

    expect(res?.id).toBe(principalId);
  });

  it('devuelve null si el programa es de OTRO comercio', async () => {
    const comercioA = await entorno.crearComercio();
    const comercioB = await entorno.crearComercio();
    const principalDeB = entorno.obtenerProgramaPrincipal(comercioB);

    const res = await obtenerPrograma(supabase, comercioA, principalDeB);

    expect(res).toBeNull();
  });
});

describe('configuracionProgramaDesdeFormulario', () => {
  it('cadena vacía se convierte en null', () => {
    const res = configuracionProgramaDesdeFormulario({
      cashbackPorcentaje: '',
      multipassVisitas: '',
      membresiaDias: '',
      cuponVigenciaDias: '',
      avisoVencimientoActivo: '',
      avisoVencimientoDias: '',
      avisoVencimientoMensaje: '',
    });
    expect(res).toEqual({
      cashbackPorcentaje: null,
      multipassVisitas: null,
      membresiaDias: null,
      cuponVigenciaDias: null,
      ...SIN_AVISO,
    });
  });

  it('acepta coma decimal', () => {
    const res = configuracionProgramaDesdeFormulario({
      cashbackPorcentaje: '5,5',
      multipassVisitas: '',
      membresiaDias: '',
      cuponVigenciaDias: '',
      avisoVencimientoActivo: '',
      avisoVencimientoDias: '',
      avisoVencimientoMensaje: '',
    });
    expect(res.cashbackPorcentaje).toBe(5.5);
  });

  it('un typo como "5x" da NaN, no lo trunca a 5 en silencio', () => {
    const res = configuracionProgramaDesdeFormulario({
      cashbackPorcentaje: '5x',
      multipassVisitas: '',
      membresiaDias: '',
      cuponVigenciaDias: '',
      avisoVencimientoActivo: '',
      avisoVencimientoDias: '',
      avisoVencimientoMensaje: '',
    });
    expect(Number.isNaN(res.cashbackPorcentaje)).toBe(true);
  });

  it('el aviso: la casilla marcada llega como "on", y un mensaje de puros espacios es null', () => {
    const res = configuracionProgramaDesdeFormulario({
      cashbackPorcentaje: '',
      multipassVisitas: '',
      membresiaDias: '30',
      cuponVigenciaDias: '',
      avisoVencimientoActivo: 'on',
      avisoVencimientoDias: '5',
      avisoVencimientoMensaje: '   ',
    });
    expect(res.avisoVencimientoActivo).toBe(true);
    expect(res.avisoVencimientoDias).toBe(5);
    expect(res.avisoVencimientoMensaje).toBeNull();
  });

  it('el aviso: el mensaje se guarda sin los espacios de las puntas', () => {
    const res = configuracionProgramaDesdeFormulario({
      cashbackPorcentaje: '',
      multipassVisitas: '',
      membresiaDias: '30',
      cuponVigenciaDias: '',
      avisoVencimientoActivo: '',
      avisoVencimientoDias: '',
      avisoVencimientoMensaje: '  Te esperamos  ',
    });
    expect(res.avisoVencimientoActivo).toBe(false);
    expect(res.avisoVencimientoMensaje).toBe('Te esperamos');
  });
});

describe('tarjetasActivasDelComercio', () => {
  it('devuelve tarjetas de todos los programas activos cuando programaId es null', async () => {
    const comercioId = await entorno.crearComercio();
    const { id: tarjetaPrincipal } = await entorno.crearTarjeta(comercioId);
    const segundo = await crearPrograma(supabase, comercioId, datos('cupon', 'Cupón'));
    expect(segundo.ok).toBe(true);
    if (!segundo.ok) return;
    // tarjeta manual en el segundo programa (no hay helper del fixture para esto — insert directo)
    const { data: cliente } = await supabase.from('clientes').insert({ nombre: 'X', telefono: `+503-tad-${Date.now()}` }).select('id').single();
    const { data: tarjetaSegundo } = await supabase.from('tarjetas').insert({ cliente_id: cliente!.id, comercio_id: comercioId, programa_id: segundo.id }).select('id').single();

    const resultado = await tarjetasActivasDelComercio(supabase, comercioId, null);

    expect(resultado.map((t) => t.id).sort()).toEqual([tarjetaPrincipal, tarjetaSegundo!.id].sort());
    // El tipo va POR PROGRAMA (el segundo es 'cupon', no 'puntos') — si se hardcodeara un tipo fijo,
    // esta aserción lo atrapa aunque la de arriba (que solo mira ids) no lo haga.
    const tipoPorId = new Map(resultado.map((t) => [t.id, t.tipoTarjeta]));
    expect(tipoPorId.get(tarjetaPrincipal)).toBe('puntos');
    expect(tipoPorId.get(tarjetaSegundo!.id)).toBe('cupon');
  });

  it('con programaId, devuelve solo las tarjetas de ESE programa', async () => {
    const comercioId = await entorno.crearComercio();
    const principalId = entorno.obtenerProgramaPrincipal(comercioId);
    const { id: tarjetaPrincipal } = await entorno.crearTarjeta(comercioId);
    const segundo = await crearPrograma(supabase, comercioId, datos('cupon', 'Cupón'));
    expect(segundo.ok).toBe(true);
    if (!segundo.ok) return;
    const { data: cliente } = await supabase.from('clientes').insert({ nombre: 'Z', telefono: `+503-tad3-${Date.now()}` }).select('id').single();
    const { data: tarjetaSegundo } = await supabase.from('tarjetas').insert({ cliente_id: cliente!.id, comercio_id: comercioId, programa_id: segundo.id }).select('id').single();

    const resultado = await tarjetasActivasDelComercio(supabase, comercioId, principalId);

    // Si el filtro por programaId se neutraliza, la tarjeta del SEGUNDO programa se colaría acá.
    expect(resultado.map((t) => t.id)).toEqual([tarjetaPrincipal]);
    expect(resultado.map((t) => t.id)).not.toContain(tarjetaSegundo!.id);
    expect(resultado.every((t) => t.tipoTarjeta === 'puntos')).toBe(true);
  });

  it('excluye tarjetas de un programa DESACTIVADO', async () => {
    const comercioId = await entorno.crearComercio();
    const creado = await crearPrograma(supabase, comercioId, datos('cupon', 'Cupón'));
    expect(creado.ok).toBe(true);
    if (!creado.ok) return;
    const { data: cliente } = await supabase.from('clientes').insert({ nombre: 'Y', telefono: `+503-tad2-${Date.now()}` }).select('id').single();
    const { data: tarjeta } = await supabase.from('tarjetas').insert({ cliente_id: cliente!.id, comercio_id: comercioId, programa_id: creado.id }).select('id').single();
    await desactivarPrograma(supabase, comercioId, creado.id);

    const resultado = await tarjetasActivasDelComercio(supabase, comercioId, null);

    expect(resultado.map((t) => t.id)).not.toContain(tarjeta!.id);
  });
});

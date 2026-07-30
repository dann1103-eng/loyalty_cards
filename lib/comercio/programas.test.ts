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
    });
    expect(res.ok).toBe(false);

    // Y el programa de B queda intacto — no se filtró el update por fuera del scope.
    const fila = await filaPrograma(deB.id);
    expect(Number(fila.cashback_porcentaje)).toBe(3);
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
    });
    expect(res).toEqual({
      cashbackPorcentaje: null,
      multipassVisitas: null,
      membresiaDias: null,
      cuponVigenciaDias: null,
    });
  });

  it('acepta coma decimal', () => {
    const res = configuracionProgramaDesdeFormulario({
      cashbackPorcentaje: '5,5',
      multipassVisitas: '',
      membresiaDias: '',
      cuponVigenciaDias: '',
    });
    expect(res.cashbackPorcentaje).toBe(5.5);
  });

  it('un typo como "5x" da NaN, no lo trunca a 5 en silencio', () => {
    const res = configuracionProgramaDesdeFormulario({
      cashbackPorcentaje: '5x',
      multipassVisitas: '',
      membresiaDias: '',
      cuponVigenciaDias: '',
    });
    expect(Number.isNaN(res.cashbackPorcentaje)).toBe(true);
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
  });

  it('con programaId, devuelve solo las tarjetas de ESE programa', async () => {
    const comercioId = await entorno.crearComercio();
    const principalId = entorno.obtenerProgramaPrincipal(comercioId);
    await entorno.crearTarjeta(comercioId);

    const resultado = await tarjetasActivasDelComercio(supabase, comercioId, principalId);

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

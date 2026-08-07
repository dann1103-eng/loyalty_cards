import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { primerosPasos, PASOS } from './primerosPasos';

// El tutorial del panel: cuatro pasos que se marcan SOLOS cuando la acción ya está hecha.
//
// Por qué se derivan del estado real y no se guardan en una columna "tutorial_paso": una casilla
// guardada miente en cuanto el dueño deshace algo (borra su único premio, por ejemplo) y además
// obliga a acordarse de marcarla desde cada pantalla que la afecta. Derivarlo no puede desincronizarse.
const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

afterEach(async () => {
  await entorno.limpiar();
});

function hecho(pasos: Awaited<ReturnType<typeof primerosPasos>>, clave: string): boolean {
  return pasos.find((p) => p.clave === clave)!.hecho;
}

describe('primerosPasos', () => {
  it('un comercio recién creado no tiene ningún paso hecho', async () => {
    const comercioId = await entorno.crearComercio();

    const pasos = await primerosPasos(supabase, comercioId);

    expect(pasos).toHaveLength(PASOS.length);
    expect(pasos.every((p) => !p.hecho), 'un comercio vacío no puede tener pasos hechos').toBe(true);
  });

  it('subir el logo marca "diseñá tu tarjeta"', async () => {
    const comercioId = await entorno.crearComercio();
    await supabase.from('comercios').update({ logo_url: 'https://ejemplo.test/logo.png' }).eq('id', comercioId);

    const pasos = await primerosPasos(supabase, comercioId);

    expect(hecho(pasos, 'marca')).toBe(true);
    // Y SOLO ese: si un paso marcara a los demás, la lista dejaría de guiar a nadie.
    expect(hecho(pasos, 'premio')).toBe(false);
    expect(hecho(pasos, 'cliente')).toBe(false);
  });

  it('una recompensa ACTIVA marca "cargá tu primer premio"; una desactivada no', async () => {
    const comercioId = await entorno.crearComercio();
    const recompensaId = await entorno.crearRecompensa(comercioId, 10);

    expect(hecho(await primerosPasos(supabase, comercioId), 'premio')).toBe(true);

    // Desactivarla lo devuelve a pendiente: el dueño se quedó otra vez sin nada que canjear, y el
    // tutorial tiene que decírselo en vez de seguir felicitándolo.
    await supabase.from('recompensas').update({ activa: false }).eq('id', recompensaId);
    expect(hecho(await primerosPasos(supabase, comercioId), 'premio')).toBe(false);
  });

  it('una tarjeta emitida marca "sumá tu primer cliente"', async () => {
    const comercioId = await entorno.crearComercio();
    await entorno.crearTarjeta(comercioId, 0);

    expect(hecho(await primerosPasos(supabase, comercioId), 'cliente')).toBe(true);
  });

  it('una regla de puntos marca "definí cómo se ganan"', async () => {
    const comercioId = await entorno.crearComercio();
    await supabase.from('reglas_puntos').insert({ comercio_id: comercioId, tipo: 'por_visita', valor: 1 });

    expect(hecho(await primerosPasos(supabase, comercioId), 'reglas')).toBe(true);
  });

  it('NO cuenta lo que es de OTRO comercio', async () => {
    // Sin el scope por comercio_id, el primer negocio que cargue un premio le marcaría el paso a
    // todos los demás — y el tutorial felicitaría a alguien que no hizo nada.
    const mio = await entorno.crearComercio();
    const ajeno = await entorno.crearComercio();
    await entorno.crearRecompensa(ajeno, 10);
    await entorno.crearTarjeta(ajeno, 0);

    const pasos = await primerosPasos(supabase, mio);

    expect(hecho(pasos, 'premio')).toBe(false);
    expect(hecho(pasos, 'cliente')).toBe(false);
  });

  it('cada paso lleva a dónde hacerlo', async () => {
    // Un tutorial que dice "cargá un premio" sin decir dónde es una lista de reproches.
    const comercioId = await entorno.crearComercio();
    const pasos = await primerosPasos(supabase, comercioId);

    for (const paso of pasos) {
      expect(paso.href, `el paso "${paso.clave}" no lleva a ninguna pantalla`).toMatch(/^\/comercio\//);
      expect(paso.titulo.length).toBeGreaterThan(0);
    }
  });
});

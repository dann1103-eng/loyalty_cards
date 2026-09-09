import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { TIPOS } from '../tarjetas/tipos';
import { primerosPasos, pasosParaTipo, CATALOGO_POR_TIPO } from './primerosPasos';

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
  const paso = pasos.find((p) => p.clave === clave);
  if (!paso) throw new Error(`el tutorial no tiene el paso "${clave}": ${pasos.map((p) => p.clave).join(', ')}`);
  return paso.hecho;
}

// ─────────────────────────────────────────────────────────────────────────────
// El catálogo por tipo (puro, sin BD)
// ─────────────────────────────────────────────────────────────────────────────

// EL defecto que este cambio cierra (2026-09-08): los cuatro pasos eran fijos y hablaban de sellos.
// Para membresía el paso 2 apuntaba a Reglas, que para ese tipo ESCONDE el formulario y dice "tu
// tarjeta no necesita estas reglas". O sea que era imposible de completar, y como PrimerosPasos
// solo se esconde con los cuatro hechos, el dueño quedaba clavado en "1 de 4" para siempre.
describe('pasosParaTipo', () => {
  // EL guardián de cobertura. Un tipo nuevo en TIPOS sin su entrada acá rompe esta prueba, y no la
  // producción: sin ella, el fallback a 'puntos' le daría cuatro pasos que hablan de otra tarjeta.
  it('los OCHO tipos tienen su propia entrada en el catálogo, sin heredar la de puntos', () => {
    for (const tipo of TIPOS) {
      expect(
        Object.prototype.hasOwnProperty.call(CATALOGO_POR_TIPO, tipo.valor),
        `el tipo ${tipo.valor} no tiene pasos propios`,
      ).toBe(true);
    }
  });

  it('los ocho tipos tienen exactamente cuatro pasos, con clave, título, detalle y href', () => {
    for (const tipo of TIPOS) {
      const pasos = pasosParaTipo(tipo.valor);
      expect(pasos, tipo.valor).toHaveLength(4);
      for (const p of pasos) {
        expect(p.clave && p.titulo && p.detalle && p.href, `${tipo.valor}/${p.clave}`).toBeTruthy();
        expect(p.href, `${tipo.valor}/${p.clave}`).toMatch(/^\/comercio\//);
      }
      // Cuatro pasos DISTINTOS: dos con la misma clave harían que el `hecho` de uno pisara al otro.
      expect(new Set(pasos.map((p) => p.clave)).size, tipo.valor).toBe(4);
    }
  });

  it('NINGÚN tipo sin unidad manda a Reglas: esa pantalla le esconde el formulario', () => {
    // MUTACIÓN: volver a una lista fija con el paso 'reglas' rompe acá, que es el bug original.
    for (const tipo of TIPOS.filter((t) => t.contador === 'ninguno' || t.contador === 'centavos')) {
      const destinos = pasosParaTipo(tipo.valor).map((p) => p.href);
      expect(destinos, tipo.valor).not.toContain('/comercio/reglas');
    }
  });

  it('NINGÚN tipo sin contador manda a cargar un premio: no se puede canjear nunca', () => {
    for (const tipo of TIPOS.filter((t) => t.contador === 'ninguno')) {
      const destinos = pasosParaTipo(tipo.valor).map((p) => p.href);
      expect(destinos, tipo.valor).not.toContain('/comercio/recompensas');
    }
  });

  it('membresía y cupón piden su plazo y sus términos', () => {
    for (const tipo of ['membresia', 'cupon']) {
      const claves = pasosParaTipo(tipo).map((p) => p.clave);
      expect(claves, tipo).toEqual(['marca', 'configuracion', 'terminos', 'cliente']);
    }
  });

  it('puntos y sellos conservan los cuatro pasos de siempre', () => {
    for (const tipo of ['puntos', 'sellos']) {
      expect(pasosParaTipo(tipo).map((p) => p.clave)).toEqual(['marca', 'reglas', 'premio', 'cliente']);
    }
  });

  it('gift card carga premio y términos; prepago y cashback, su configuración y un premio', () => {
    expect(pasosParaTipo('gift_card').map((p) => p.clave)).toEqual(['marca', 'premio', 'terminos', 'cliente']);
    for (const tipo of ['prepago', 'cashback']) {
      expect(pasosParaTipo(tipo).map((p) => p.clave), tipo).toEqual([
        'marca',
        'configuracion',
        'premio',
        'cliente',
      ]);
    }
    expect(pasosParaTipo('descuento').map((p) => p.clave)).toEqual([
      'marca',
      'configuracion',
      'terminos',
      'cliente',
    ]);
  });

  it('cada tipo se nombra a sí mismo: sellos habla de sellos y membresía de membresía', () => {
    expect(pasosParaTipo('sellos')[1].titulo.toLowerCase()).toContain('sello');
    expect(pasosParaTipo('puntos')[1].titulo.toLowerCase()).toContain('punto');
    expect(pasosParaTipo('prepago')[1].titulo.toLowerCase()).toContain('visita');
    expect(pasosParaTipo('membresia')[1].titulo.toLowerCase()).toContain('membres');
    // Y NINGUNO de los seis que no son de puntos/sellos nombra una mecánica que no tiene.
    for (const tipo of ['membresia', 'cupon', 'descuento', 'gift_card', 'cashback']) {
      const texto = pasosParaTipo(tipo).map((p) => `${p.titulo} ${p.detalle}`).join(' ').toLowerCase();
      expect(texto, tipo).not.toMatch(/sello/);
    }
  });

  it('un tipo desconocido cae al de puntos, nunca a undefined', () => {
    // Mismo criterio que tipoOPuntos: una fila vieja de la BD no puede dejar el panel en blanco.
    expect(pasosParaTipo('inventado')).toEqual(pasosParaTipo('puntos'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// El estado real (contra la BD)
// ─────────────────────────────────────────────────────────────────────────────

describe('primerosPasos', () => {
  it('un comercio recién creado no tiene ningún paso hecho', async () => {
    const comercioId = await entorno.crearComercio();

    const pasos = await primerosPasos(supabase, comercioId, 'sellos');

    expect(pasos).toHaveLength(4);
    expect(pasos.every((p) => !p.hecho), 'un comercio vacío no puede tener pasos hechos').toBe(true);
  });

  it('subir el logo marca "diseñá tu tarjeta"', async () => {
    const comercioId = await entorno.crearComercio();
    await supabase.from('comercios').update({ logo_url: 'https://ejemplo.test/logo.png' }).eq('id', comercioId);

    const pasos = await primerosPasos(supabase, comercioId, 'sellos');

    expect(hecho(pasos, 'marca')).toBe(true);
    // Y SOLO ese: si un paso marcara a los demás, la lista dejaría de guiar a nadie.
    expect(hecho(pasos, 'premio')).toBe(false);
    expect(hecho(pasos, 'cliente')).toBe(false);
  });

  it('una recompensa ACTIVA marca "cargá tu primer premio"; una desactivada no', async () => {
    const comercioId = await entorno.crearComercio();
    const recompensaId = await entorno.crearRecompensa(comercioId, 10);

    expect(hecho(await primerosPasos(supabase, comercioId, 'sellos'), 'premio')).toBe(true);

    // Desactivarla lo devuelve a pendiente: el dueño se quedó otra vez sin nada que canjear, y el
    // tutorial tiene que decírselo en vez de seguir felicitándolo.
    await supabase.from('recompensas').update({ activa: false }).eq('id', recompensaId);
    expect(hecho(await primerosPasos(supabase, comercioId, 'sellos'), 'premio')).toBe(false);
  });

  it('una tarjeta emitida marca "sumá tu primer cliente"', async () => {
    const comercioId = await entorno.crearComercio();
    await entorno.crearTarjeta(comercioId, 0);

    expect(hecho(await primerosPasos(supabase, comercioId, 'sellos'), 'cliente')).toBe(true);
  });

  it('una regla de puntos marca "definí cómo se ganan"', async () => {
    const comercioId = await entorno.crearComercio();
    await supabase.from('reglas_puntos').insert({ comercio_id: comercioId, tipo: 'por_visita', valor: 1 });

    expect(hecho(await primerosPasos(supabase, comercioId, 'sellos'), 'reglas')).toBe(true);
  });

  it('NO cuenta lo que es de OTRO comercio', async () => {
    // Sin el scope por comercio_id, el primer negocio que cargue un premio le marcaría el paso a
    // todos los demás — y el tutorial felicitaría a alguien que no hizo nada.
    const mio = await entorno.crearComercio();
    const ajeno = await entorno.crearComercio();
    await entorno.crearRecompensa(ajeno, 10);
    await entorno.crearTarjeta(ajeno, 0);
    await supabase.from('comercios').update({ terminos_uso: 'Términos del ajeno' }).eq('id', ajeno);

    const pasos = await primerosPasos(supabase, mio, 'sellos');

    expect(hecho(pasos, 'premio')).toBe(false);
    expect(hecho(pasos, 'cliente')).toBe(false);
    expect(pasos.every((p) => !p.hecho), 'ningún paso ajeno puede colarse').toBe(true);
  });

  it('cada paso lleva a dónde hacerlo', async () => {
    // Un tutorial que dice "cargá un premio" sin decir dónde es una lista de reproches.
    const comercioId = await entorno.crearComercio();
    const pasos = await primerosPasos(supabase, comercioId, 'membresia');

    for (const paso of pasos) {
      expect(paso.href, `el paso "${paso.clave}" no lleva a ninguna pantalla`).toMatch(/^\/comercio\//);
      expect(paso.titulo.length).toBeGreaterThan(0);
    }
  });

  it('el plazo de la membresía se lee del PROGRAMA, no de la columna legada del comercio', async () => {
    // La 0024 mudó la configuración por tipo a programas_tarjeta y nadie escribe ya la columna del
    // comercio. Un `hecho` que la leyera daría "listo" a un comercio que en producción no tiene el
    // plazo cargado (y al revés, dejaría clavado al que sí lo cargó por la pantalla de Programas).
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'membresia' });
    const programaId = entorno.obtenerProgramaPrincipal(comercioId);

    expect(hecho(await primerosPasos(supabase, comercioId, 'membresia'), 'configuracion')).toBe(false);

    await supabase.from('comercios').update({ membresia_dias: 30 }).eq('id', comercioId);
    expect(
      hecho(await primerosPasos(supabase, comercioId, 'membresia'), 'configuracion'),
      'la columna LEGADA del comercio no puede marcar el paso',
    ).toBe(false);

    await supabase.from('programas_tarjeta').update({ membresia_dias: 30 }).eq('id', programaId);
    expect(hecho(await primerosPasos(supabase, comercioId, 'membresia'), 'configuracion')).toBe(true);
  });

  it('cada tipo mira SU columna: los días del cupón no marcan el paso de la membresía', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'membresia' });
    const programaId = entorno.obtenerProgramaPrincipal(comercioId);
    await supabase
      .from('programas_tarjeta')
      .update({ cupon_vigencia_dias: 15, multipass_visitas: 10, cashback_porcentaje: 5 })
      .eq('id', programaId);

    expect(hecho(await primerosPasos(supabase, comercioId, 'membresia'), 'configuracion')).toBe(false);
  });

  it('los términos escritos en MODO NEGOCIO marcan el paso, igual que los lee el pase', async () => {
    // EL defecto 1, otra vez: el editor de Marca sin programa seleccionado —el flujo por defecto,
    // porque el selector aparece recién con dos tarjetas— escribe comercios.terminos_uso. Leyendo
    // solo la columna del programa, el dueño que ya escribió sus términos queda clavado en 3 de 4.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'membresia' });

    expect(hecho(await primerosPasos(supabase, comercioId, 'membresia'), 'terminos')).toBe(false);

    await supabase
      .from('comercios')
      .update({ terminos_uso: 'La membresía se renueva cada 30 días.' })
      .eq('id', comercioId);

    expect(hecho(await primerosPasos(supabase, comercioId, 'membresia'), 'terminos')).toBe(true);
  });

  it('un programa con reverso propio manda sobre el del comercio, como en el pase', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'cupon' });
    const programaId = entorno.obtenerProgramaPrincipal(comercioId);
    await supabase
      .from('programas_tarjeta')
      .update({ reverso_propio: true, terminos_uso: 'Válido por una sola vez.' })
      .eq('id', programaId);

    expect(hecho(await primerosPasos(supabase, comercioId, 'cupon'), 'terminos')).toBe(true);
  });

  it('unos términos en blanco NO cuentan como escritos', async () => {
    // Un `Boolean(texto)` a secas daría por hecho el paso con un espacio, y el reverso del pase
    // saldría igual de vacío que antes.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'membresia' });
    await supabase.from('comercios').update({ terminos_uso: '   \n  ' }).eq('id', comercioId);

    expect(hecho(await primerosPasos(supabase, comercioId, 'membresia'), 'terminos')).toBe(false);
  });

  it('descuento: el paso de configuración lo marcan los niveles cargados', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'descuento' });

    expect(hecho(await primerosPasos(supabase, comercioId, 'descuento'), 'configuracion')).toBe(false);

    // niveles_descuento no lo rastrea el fixture y no tiene ON DELETE CASCADE: sin este finally,
    // una prueba en rojo dejaría el comercio sin poder borrarse (basura permanente en la BD real).
    try {
      await supabase
        .from('niveles_descuento')
        .insert({ comercio_id: comercioId, desde_centavos: 10000, porcentaje: 5 });

      expect(hecho(await primerosPasos(supabase, comercioId, 'descuento'), 'configuracion')).toBe(true);
    } finally {
      await supabase.from('niveles_descuento').delete().eq('comercio_id', comercioId);
    }
  });

  it('una membresía completa termina el tutorial: es la prueba de que se puede completar', async () => {
    // El corazón del defecto. Antes de este cambio, ninguna combinación de datos ponía los cuatro
    // pasos en verde para una membresía, porque el paso 2 exigía una regla que su pantalla ni
    // siquiera deja cargar. PrimerosPasos solo se esconde con los cuatro hechos.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'membresia' });
    const programaId = entorno.obtenerProgramaPrincipal(comercioId);

    await supabase
      .from('comercios')
      .update({ logo_url: 'https://ejemplo.test/logo.png', terminos_uso: 'Renovás cada 30 días.' })
      .eq('id', comercioId);
    await supabase.from('programas_tarjeta').update({ membresia_dias: 30 }).eq('id', programaId);
    await entorno.crearTarjeta(comercioId, 0);

    const pasos = await primerosPasos(supabase, comercioId, 'membresia');

    expect(
      pasos.filter((p) => p.hecho).length,
      `quedaron pendientes: ${pasos.filter((p) => !p.hecho).map((p) => p.clave).join(', ')}`,
    ).toBe(4);
  });
});

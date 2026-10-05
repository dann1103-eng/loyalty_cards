import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { guardarPatronSellos, patronSellosDesdeFormulario } from './guardarPatronSellos';

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

afterEach(async () => {
  await entorno.limpiar();
});

const patronDelComercio = async (id: string) =>
  (await supabase.from('comercios').select('sello_patron, sello_casillas').eq('id', id).single()).data!;
const patronDelPrograma = async (id: string) =>
  (await supabase.from('programas_tarjeta').select('sello_patron, sello_casillas').eq('id', id).single()).data!;

describe('patronSellosDesdeFormulario', () => {
  it('lee las casillas de un texto separado por comas, tolerando espacios y huecos', () => {
    expect(patronSellosDesdeFormulario(' casillas ', '5, 10,,3')).toEqual({ patron: 'casillas', casillas: [5, 10, 3] });
    expect(patronSellosDesdeFormulario('ultimo', '')).toEqual({ patron: 'ultimo', casillas: [] });
  });
});

describe('guardarPatronSellos', () => {
  it('negocio: guarda el patrón, y las casillas saneadas y en orden', async () => {
    const comercioId = await entorno.crearComercio();

    const res = await guardarPatronSellos(supabase, comercioId, null, { patron: 'casillas', casillas: [10, 5, 5, 99, 2.5] });

    expect(res).toEqual({ ok: true, patron: { patron: 'casillas', casillas: [5, 10] } });
    expect(await patronDelComercio(comercioId)).toEqual({ sello_patron: 'casillas', sello_casillas: [5, 10] });
    // El patrón del negocio NO se escribe en su programa: la tarjeta lo hereda al leer.
    expect(await patronDelPrograma(entorno.obtenerProgramaPrincipal(comercioId))).toEqual({
      sello_patron: null,
      sello_casillas: null,
    });
  });

  it('con otro patrón, las casillas que hubiera se guardan en null', async () => {
    const comercioId = await entorno.crearComercio();
    await guardarPatronSellos(supabase, comercioId, null, { patron: 'casillas', casillas: [5] });

    const res = await guardarPatronSellos(supabase, comercioId, null, { patron: 'ultimo', casillas: [5] });

    expect(res).toEqual({ ok: true, patron: { patron: 'ultimo', casillas: [] } });
    expect(await patronDelComercio(comercioId)).toEqual({ sello_patron: 'ultimo', sello_casillas: null });
  });

  it('tarjeta: escribe en el programa y no toca el negocio', async () => {
    const comercioId = await entorno.crearComercio();
    const programaId = entorno.obtenerProgramaPrincipal(comercioId);

    const res = await guardarPatronSellos(supabase, comercioId, programaId, { patron: 'mitades', casillas: [] });

    expect(res.ok).toBe(true);
    expect(await patronDelPrograma(programaId)).toEqual({ sello_patron: 'mitades', sello_casillas: null });
    expect(await patronDelComercio(comercioId)).toEqual({ sello_patron: null, sello_casillas: null });
  });

  it('el programa de OTRO comercio no se escribe (el scope es comercio_id, no solo el id)', async () => {
    const mio = await entorno.crearComercio();
    const ajeno = await entorno.crearComercio();
    const programaAjeno = entorno.obtenerProgramaPrincipal(ajeno);

    const res = await guardarPatronSellos(supabase, mio, programaAjeno, { patron: 'ultimo', casillas: [] });

    expect(res).toEqual({ ok: false, error: 'Ese programa no existe.' });
    expect(await patronDelPrograma(programaAjeno)).toEqual({ sello_patron: null, sello_casillas: null });
  });

  it('un patrón desconocido se RECHAZA, no se guarda el de por defecto', async () => {
    const comercioId = await entorno.crearComercio();

    const res = await guardarPatronSellos(supabase, comercioId, null, { patron: 'zigzag', casillas: [] });

    expect(res).toEqual({ ok: false, error: 'Elegí dónde va el segundo sello.' });
    expect(await patronDelComercio(comercioId)).toEqual({ sello_patron: null, sello_casillas: null });
  });

  it('"casillas" sin ninguna casilla válida se rechaza', async () => {
    const comercioId = await entorno.crearComercio();

    const res = await guardarPatronSellos(supabase, comercioId, null, { patron: 'casillas', casillas: [0, 99] });

    expect(res).toEqual({ ok: false, error: 'Elegí al menos una casilla para el segundo sello.' });
    expect(await patronDelComercio(comercioId)).toEqual({ sello_patron: null, sello_casillas: null });
  });
});

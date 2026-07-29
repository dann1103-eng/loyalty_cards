import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { TIPOS } from './tipos';

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

afterEach(async () => {
  await entorno.limpiar();
});

// El catálogo de TypeScript y el CHECK de comercios.tipo_tarjeta (migración 0005) tienen que
// coincidir. Si divergen, el panel de FM ofrece un tipo que la base rechaza con 23514, o queda un
// tipo guardado que ninguna pantalla sabe dibujar.
//
// Esta prueba existe porque la primera versión NO verificaba eso: comparaba el catálogo contra una
// lista escrita en el mismo archivo de prueba, así que pasaba en verde afirmando nada. Fue así como
// se coló 'multipass' —el nombre que usa la competencia— cuando el valor real es 'prepago'.
// La única forma honesta de comprobarlo es intentar guardarlos.
describe('el catálogo de tipos coincide con el CHECK de la base', () => {
  it('la BD acepta TODOS los tipos del catálogo', async () => {
    for (const tipo of TIPOS) {
      const comercioId = await entorno.crearComercio({ tipo_tarjeta: tipo.valor });
      const { data } = await supabase
        .from('comercios')
        .select('tipo_tarjeta')
        .eq('id', comercioId)
        .single();
      expect(data!.tipo_tarjeta, `la BD rechazó el tipo "${tipo.valor}" del catálogo`).toBe(tipo.valor);
    }
  });

  it('la BD RECHAZA un tipo que no está en el catálogo', async () => {
    // La otra mitad: si el CHECK aceptara cualquier cosa, la prueba de arriba pasaría siempre y no
    // estaría comprobando nada.
    const { error } = await supabase
      .from('comercios')
      .insert({ nombre: 'Tipo inventado', slug: `tipo-falso-${Date.now()}`, tipo_tarjeta: 'multipass' });

    expect(error).not.toBeNull();
    expect(error!.code).toBe('23514');
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { registrarCliente } from './registrarCliente';

const supabase = createServiceClient();
let ids: { comercioId: string } | null = null;
let idsB: { comercioId: string } | null = null;
const telefonosDePrueba: string[] = [];

afterEach(async () => {
  // Orden importa: borrar hijos (tarjetas) antes que padres (clientes/comercios) por las foreign keys.
  const comercioIds = [ids?.comercioId, idsB?.comercioId].filter(Boolean) as string[];
  if (comercioIds.length) {
    await supabase.from('tarjetas').delete().in('comercio_id', comercioIds);
  }
  if (telefonosDePrueba.length) {
    await supabase.from('clientes').delete().in('telefono', telefonosDePrueba);
    telefonosDePrueba.length = 0;
  }
  if (comercioIds.length) {
    await supabase.from('comercios').delete().in('id', comercioIds);
  }
  ids = null;
  idsB = null;
});

async function crearComercioDePrueba(slug: string): Promise<string> {
  const { data, error } = await supabase
    .from('comercios')
    .insert({ nombre: 'Comercio de prueba', slug })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

describe('registrarCliente', () => {
  it('crea cliente y tarjeta nuevos cuando el teléfono no existe', async () => {
    const comercioId = await crearComercioDePrueba(`test-a-${Date.now()}`);
    ids = { comercioId };
    const telefono = `+503-test-${Date.now()}`;
    telefonosDePrueba.push(telefono);

    const resultado = await registrarCliente(supabase, comercioId, 'Cliente Prueba', telefono);

    expect(resultado.esNuevoCliente).toBe(true);
    expect(resultado.esNuevaTarjeta).toBe(true);
    expect(resultado.qrToken).toHaveLength(32);
  });

  it('reutiliza el cliente si el teléfono ya existe en OTRO comercio', async () => {
    const comercioA = await crearComercioDePrueba(`test-b1-${Date.now()}`);
    const comercioB = await crearComercioDePrueba(`test-b2-${Date.now()}`);
    ids = { comercioId: comercioA };
    idsB = { comercioId: comercioB };
    const telefono = `+503-test-${Date.now()}`;
    telefonosDePrueba.push(telefono);

    const primero = await registrarCliente(supabase, comercioA, 'Cliente Prueba', telefono);
    const segundo = await registrarCliente(supabase, comercioB, 'Cliente Prueba', telefono);

    expect(segundo.clienteId).toBe(primero.clienteId);
    expect(segundo.tarjetaId).not.toBe(primero.tarjetaId);
    expect(segundo.esNuevoCliente).toBe(false);
    expect(segundo.esNuevaTarjeta).toBe(true);
  });

  it('recupera la misma tarjeta si el teléfono ya existe en el MISMO comercio', async () => {
    const comercioId = await crearComercioDePrueba(`test-c-${Date.now()}`);
    ids = { comercioId };
    const telefono = `+503-test-${Date.now()}`;
    telefonosDePrueba.push(telefono);

    const primero = await registrarCliente(supabase, comercioId, 'Cliente Prueba', telefono);
    const segundo = await registrarCliente(supabase, comercioId, 'Cliente Prueba', telefono);

    expect(segundo.tarjetaId).toBe(primero.tarjetaId);
    // El qr_token no debe cambiar entre registros: los passes ya emitidos siguen siendo escaneables.
    expect(segundo.qrToken).toBe(primero.qrToken);
    expect(segundo.esNuevaTarjeta).toBe(false);
  });

  it('converge en una sola identidad cuando dos registros del mismo teléfono corren en paralelo', async () => {
    const comercioId = await crearComercioDePrueba(`test-d-${Date.now()}`);
    ids = { comercioId };
    const telefono = `+503-test-${Date.now()}`;
    telefonosDePrueba.push(telefono);

    // Sin importar quién gane la carrera del insert (vía unique + reintento con relectura),
    // ambas llamadas deben terminar apuntando al mismo cliente y la misma tarjeta.
    const [a, b] = await Promise.all([
      registrarCliente(supabase, comercioId, 'Cliente Prueba', telefono),
      registrarCliente(supabase, comercioId, 'Cliente Prueba', telefono),
    ]);

    expect(a.clienteId).toBe(b.clienteId);
    expect(a.tarjetaId).toBe(b.tarjetaId);
  });
});

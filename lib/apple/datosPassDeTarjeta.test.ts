import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { datosPassDeTarjeta } from './datosPassDeTarjeta';

// Contra Supabase REAL, como el resto de las pruebas de integración del repo (nunca mocks).
//
// MUTATION-TESTING: esta prueba existe porque el `.order('costo_puntos')` de la consulta de
// recompensas NO estaba protegido por nada. Sin él, PostgREST devuelve el orden FÍSICO de la tabla,
// que cambia cada vez que `desactivarRecompensa` reescribe una fila: el reverso de un mismo comercio
// saldría con las recompensas en distinto orden de una emisión a otra y ningún test se enteraría.
// El orden se decide acá y NO en construirReverso (que respeta el que recibe), así que si no se
// prueba acá no se prueba en ningún lado.
const supabase = createServiceClient();

let creados: { comercioId: string; clienteId: string; tarjetaId: string } | null = null;

afterEach(async () => {
  if (!creados) return;
  // En orden inverso a las FK.
  await supabase.from('recompensas').delete().eq('comercio_id', creados.comercioId);
  await supabase.from('tarjetas').delete().eq('id', creados.tarjetaId);
  await supabase.from('clientes').delete().eq('id', creados.clienteId);
  await supabase.from('comercios').delete().eq('id', creados.comercioId);
  creados = null;
});

async function crearEscenario(costosEnOrdenDeInsercion: number[]) {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data: comercio } = await supabase
    .from('comercios')
    .insert({ nombre: 'Comercio Reverso', slug: `test-reverso-${sufijo}` })
    .select('id')
    .single();
  const { data: cliente } = await supabase
    .from('clientes')
    .insert({ nombre: 'Cliente Reverso', telefono: `+503-rev-${sufijo}` })
    .select('id')
    .single();
  const { data: tarjeta } = await supabase
    .from('tarjetas')
    .insert({
      cliente_id: cliente!.id,
      comercio_id: comercio!.id,
      apple_serial_number: `serial-rev-${sufijo}`,
      apple_auth_token: '0123456789abcdef0123456789abcdef',
    })
    .select('id, apple_serial_number')
    .single();

  // Se insertan UNA POR UNA y a propósito en un orden que NO es el ascendente por costo: si la
  // consulta perdiera su `.order()`, saldrían en este orden y la aserción de abajo lo delataría.
  //
  // El error del insert se revisa SIEMPRE: `tipo` tiene un CHECK en la 0001
  // (`codigo_descuento`/`articulo_gratis`/`otro`) y la primera versión de esta prueba usaba un valor
  // inválido. Los inserts fallaban en silencio, el comercio quedaba sin recompensas y la prueba
  // moría con un "expected undefined to be defined" que no decía nada del problema real.
  for (const costo of costosEnOrdenDeInsercion) {
    const { error } = await supabase.from('recompensas').insert({
      comercio_id: comercio!.id,
      nombre: `Premio de ${costo}`,
      costo_puntos: costo,
      tipo: 'otro',
    });
    if (error) throw new Error(`no se pudo crear la recompensa de ${costo}: ${error.message}`);
  }

  creados = { comercioId: comercio!.id, clienteId: cliente!.id, tarjetaId: tarjeta!.id };
  return tarjeta!.apple_serial_number!;
}

describe('datosPassDeTarjeta — reverso', () => {
  it('las recompensas del reverso salen por costo ASCENDENTE, no en el orden en que se cargaron', async () => {
    const serial = await crearEscenario([30, 10, 20]);

    const resultado = await datosPassDeTarjeta(supabase, serial);
    expect(resultado).not.toBeNull();

    const comoFunciona = resultado!.datos.reverso.find((c) => c.key === 'como_funciona');
    expect(comoFunciona, 'el comercio tiene recompensas, así que la sección debe existir').toBeDefined();

    // Solo las líneas de premios, en el orden en que quedaron.
    const costos = comoFunciona!.value
      .split('\n')
      .filter((l) => l.startsWith('•'))
      .map((l) => Number(l.match(/Premio de (\d+)/)![1]));

    expect(costos).toEqual([10, 20, 30]);
  }, 30_000);

  it('una recompensa desactivada no aparece en el reverso', async () => {
    // El otro filtro que vive en la consulta y no en construirReverso (que ni siquiera recibe
    // `activa`): si se cayera el `.eq('activa', true)`, el cliente vería premios dados de baja.
    const serial = await crearEscenario([10, 20]);
    // `.select()` y revisión del error por la misma razón que en el insert: un update que no afecta
    // ninguna fila devuelve 204 sin error, la recompensa seguiría activa, y la prueba pasaría sin
    // haber probado nada. Se exige explícitamente que haya desactivado UNA fila.
    const { data: desactivadas, error } = await supabase
      .from('recompensas')
      .update({ activa: false })
      .eq('comercio_id', creados!.comercioId)
      .eq('costo_puntos', 20)
      .select('id');
    if (error) throw new Error(`no se pudo desactivar la recompensa: ${error.message}`);
    expect(desactivadas, 'la desactivación tiene que afectar exactamente una fila').toHaveLength(1);

    const resultado = await datosPassDeTarjeta(supabase, serial);
    const comoFunciona = resultado!.datos.reverso.find((c) => c.key === 'como_funciona');

    expect(comoFunciona!.value).toContain('Premio de 10');
    expect(comoFunciona!.value).not.toContain('Premio de 20');
  }, 30_000);

  it('un comercio sin reglas ni recompensas produce un reverso de exactamente dos campos', async () => {
    const serial = await crearEscenario([]);

    const resultado = await datosPassDeTarjeta(supabase, serial);

    // Sin nada que decir, la sección automática no se emite: quedan solo los dos campos fijos.
    expect(resultado!.datos.reverso.map((c) => c.key)).toEqual(['empresa', 'emisor']);
  }, 30_000);
});

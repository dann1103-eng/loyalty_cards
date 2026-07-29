import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { listarNiveles, crearNivel, eliminarNivel, registrarCompra } from './descuento';

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

const nivelesCreados: string[] = [];

afterEach(async () => {
  if (nivelesCreados.length) {
    await supabase.from('niveles_descuento').delete().in('comercio_id', nivelesCreados);
    nivelesCreados.length = 0;
  }
  await entorno.limpiar();
});

async function comercioConNiveles(): Promise<string> {
  const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'descuento' });
  nivelesCreados.push(comercioId);
  await crearNivel(supabase, comercioId, 10000, 5);
  await crearNivel(supabase, comercioId, 30000, 10);
  await crearNivel(supabase, comercioId, 50000, 15);
  return comercioId;
}

async function acumuladoDe(tarjetaId: string): Promise<number> {
  const { data } = await supabase
    .from('tarjetas')
    .select('acumulado_centavos')
    .eq('id', tarjetaId)
    .single();
  return Number(data!.acumulado_centavos);
}

describe('niveles de descuento', () => {
  it('se listan ordenados por umbral', async () => {
    const comercioId = await comercioConNiveles();
    const niveles = await listarNiveles(supabase, comercioId);
    expect(niveles!.map((n) => n.desdeCentavos)).toEqual([10000, 30000, 50000]);
    expect(niveles!.map((n) => n.porcentaje)).toEqual([5, 10, 15]);
  });

  it('rechaza dos niveles con el mismo umbral, con un mensaje entendible', async () => {
    // El unique de la BD devuelve 23505; sin traducirlo el dueño vería un código.
    const comercioId = await comercioConNiveles();
    const res = await crearNivel(supabase, comercioId, 10000, 8);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('$100.00');
  });

  it('rechaza porcentajes fuera de rango', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'descuento' });
    nivelesCreados.push(comercioId);
    for (const pct of [0, -5, 101]) {
      expect((await crearNivel(supabase, comercioId, 20000, pct)).ok, `${pct}%`).toBe(false);
    }
  });

  it('NO elimina el nivel de otro comercio', async () => {
    const comercioA = await comercioConNiveles();
    const comercioB = await entorno.crearComercio({ tipo_tarjeta: 'descuento' });
    const niveles = await listarNiveles(supabase, comercioA);

    await eliminarNivel(supabase, comercioB, niveles![0].id);

    expect((await listarNiveles(supabase, comercioA))!).toHaveLength(3);
  });
});

describe('registrarCompra', () => {
  it('suma al gasto histórico y devuelve el nivel que le toca ahora', async () => {
    const comercioId = await comercioConNiveles();
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    const res = await registrarCompra(supabase, comercioId, id, 12000); // $120

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.acumuladoCentavos).toBe(12000);
      expect(res.porcentaje).toBe(5);
      expect(res.mensaje).toContain('$120.00');
    }
  });

  it('el acumulado SUMA entre compras y sube de nivel', async () => {
    const comercioId = await comercioConNiveles();
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    await registrarCompra(supabase, comercioId, id, 20000);
    const segunda = await registrarCompra(supabase, comercioId, id, 15000);

    expect(segunda.ok).toBe(true);
    if (segunda.ok) {
      expect(segunda.acumuladoCentavos).toBe(35000);
      // $350 pasó el umbral de $300: sube a 10%.
      expect(segunda.porcentaje).toBe(10);
    }
  });

  it('sin llegar al primer umbral no hay descuento todavía', async () => {
    const comercioId = await comercioConNiveles();
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    const res = await registrarCompra(supabase, comercioId, id, 5000);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.porcentaje).toBeNull();
      expect(res.mensaje).toContain('acumulados');
    }
  });

  it('el nivel se calcula al LEER, así que cambiar los umbrales reordena a todos', async () => {
    // Si el nivel se guardara en la tarjeta, este cliente se quedaría en 5% para siempre y nadie
    // sabría de dónde salió ese número.
    const comercioId = await comercioConNiveles();
    const { id } = await entorno.crearTarjeta(comercioId, 0);
    await registrarCompra(supabase, comercioId, id, 12000); // 5% con los umbrales actuales

    // El dueño sube el descuento del primer tramo: borra el 5% de $100 y pone 12% en su lugar.
    // Hay que BORRAR primero: el unique (comercio_id, desde_centavos) impide dos niveles en el
    // mismo umbral, y sin asertar el resultado ese rechazo pasaría inadvertido — la prueba fallaría
    // sin decir por qué (pasó al escribirla).
    const niveles = await listarNiveles(supabase, comercioId);
    const borrado = await eliminarNivel(
      supabase,
      comercioId,
      niveles!.find((n) => n.porcentaje === 5)!.id,
    );
    expect(borrado.ok).toBe(true);
    const creado = await crearNivel(supabase, comercioId, 10000, 12);
    expect(creado.ok, 'no se pudo reemplazar el nivel').toBe(true);

    const res = await registrarCompra(supabase, comercioId, id, 100);
    expect(res.ok).toBe(true);
    // El MISMO cliente, sin gastar nada nuevo relevante, pasa de 5% a 12%.
    if (res.ok) expect(res.porcentaje).toBe(12);
  });

  it('deja la compra en el historial como visita, con su monto y sin puntos', async () => {
    const comercioId = await comercioConNiveles();
    const { id } = await entorno.crearTarjeta(comercioId, 0);
    const cajeroId = await entorno.crearCajero(comercioId);

    await registrarCompra(supabase, comercioId, id, 12345, { cajeroUsuarioId: cajeroId });

    const { data } = await supabase
      .from('transacciones_puntos')
      .select('tipo, puntos_delta, monto_compra, cajero_usuario_id')
      .eq('tarjeta_id', id);
    expect(data).toHaveLength(1);
    // Cuenta como visita en los reportes (que filtran tipo='acreditacion') pero no otorgó nada.
    expect(data![0].tipo).toBe('acreditacion');
    expect(data![0].puntos_delta).toBe(0);
    expect(Number(data![0].monto_compra)).toBe(123.45);
    expect(data![0].cajero_usuario_id).toBe(cajeroId);
  });

  it('rechaza montos no positivos', async () => {
    const comercioId = await comercioConNiveles();
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    for (const monto of [0, -500]) {
      expect((await registrarCompra(supabase, comercioId, id, monto)).ok, `${monto}`).toBe(false);
    }
    expect(await acumuladoDe(id)).toBe(0);
  });

  it('diez compras simultáneas suman TODAS, ninguna se pierde', async () => {
    // La suma va dentro del UPDATE. Con leer-modificar-escribir, varias leerían el mismo acumulado y
    // el cliente no llegaría al nivel que ya se ganó — perdería descuento que pagó con sus compras.
    const comercioId = await comercioConNiveles();
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    await Promise.all(
      Array.from({ length: 10 }, () => registrarCompra(supabase, comercioId, id, 1000)),
    );

    expect(await acumuladoDe(id)).toBe(10000);
  });

  it('NO registra sobre una tarjeta de otro comercio', async () => {
    const comercioA = await comercioConNiveles();
    const comercioB = await entorno.crearComercio({ tipo_tarjeta: 'descuento' });
    const { id } = await entorno.crearTarjeta(comercioA, 0);

    expect((await registrarCompra(supabase, comercioB, id, 5000)).ok).toBe(false);
    expect(await acumuladoDe(id)).toBe(0);
  });
});

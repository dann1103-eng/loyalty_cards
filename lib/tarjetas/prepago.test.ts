import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { usarVisita, venderPaquete } from './prepago';

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

afterEach(async () => {
  await entorno.limpiar();
});

async function saldoDe(tarjetaId: string): Promise<number> {
  const { data } = await supabase
    .from('tarjetas')
    .select('puntos_actuales')
    .eq('id', tarjetaId)
    .single();
  return data!.puntos_actuales;
}

async function ledgerDe(tarjetaId: string) {
  const { data } = await supabase
    .from('transacciones_puntos')
    .select('tipo, puntos_delta')
    .eq('tarjeta_id', tarjetaId);
  return data ?? [];
}

describe('usarVisita', () => {
  it('descuenta una visita y la deja en el historial como "uso"', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'prepago', multipass_visitas: 10 });
    const { id } = await entorno.crearTarjeta(comercioId, 5);
    const cajeroId = await entorno.crearCajero(comercioId);

    const res = await usarVisita(supabase, comercioId, id, { cajeroUsuarioId: cajeroId });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.visitasRestantes).toBe(4);
    expect(await saldoDe(id)).toBe(4);

    const ledger = await ledgerDe(id);
    expect(ledger).toHaveLength(1);
    // tipo 'uso', NO 'ajuste': si fuera ajuste, el reporte por cajero contaría cada visita normal
    // del negocio como una corrección, y esa columna es la que sirve para detectar algo raro.
    expect(ledger[0].tipo).toBe('uso');
    expect(ledger[0].puntos_delta).toBe(-1);
  });

  it('avisa distinto cuando era la ÚLTIMA visita', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'prepago', multipass_visitas: 10 });
    const { id } = await entorno.crearTarjeta(comercioId, 1);

    const res = await usarVisita(supabase, comercioId, id);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.mensaje).toContain('la última');
  });

  it('NO deja el contador en negativo', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'prepago', multipass_visitas: 10 });
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    const res = await usarVisita(supabase, comercioId, id);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('A este cliente se le acabaron las visitas.');
      // El flag viaja aparte del texto para que el escáner pueda ofrecer vender otro paquete en el
      // momento, en vez de dejar al cajero en un callejón sin salida.
      expect(res.sinVisitas).toBe(true);
    }
    expect(await saldoDe(id)).toBe(0);
    expect(await ledgerDe(id)).toHaveLength(0);
  });

  it('diez usos simultáneos sobre tres visitas gastan exactamente tres', async () => {
    // El guard vive en el `where puntos_actuales >= 1` del propio UPDATE. Con un `if` previo y un
    // select, los diez leerían 3 y los diez pasarían: el cliente entraría diez veces pagando tres.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'prepago', multipass_visitas: 10 });
    const { id } = await entorno.crearTarjeta(comercioId, 3);

    const resultados = await Promise.all(
      Array.from({ length: 10 }, () => usarVisita(supabase, comercioId, id)),
    );

    expect(resultados.filter((r) => r.ok)).toHaveLength(3);
    expect(await saldoDe(id)).toBe(0);
    expect(await ledgerDe(id)).toHaveLength(3);
  });

  it('NO usa la visita de una tarjeta de otro comercio', async () => {
    const comercioA = await entorno.crearComercio({ tipo_tarjeta: 'prepago', multipass_visitas: 10 });
    const comercioB = await entorno.crearComercio({ tipo_tarjeta: 'prepago', multipass_visitas: 10 });
    const { id } = await entorno.crearTarjeta(comercioA, 5);

    const res = await usarVisita(supabase, comercioB, id);

    expect(res.ok).toBe(false);
    expect(await saldoDe(id)).toBe(5);
  });
});

describe('venderPaquete', () => {
  it('suma las visitas configuradas por el comercio', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'prepago', multipass_visitas: 10 });
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    const res = await venderPaquete(supabase, comercioId, id);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.visitasRestantes).toBe(10);
    expect(await saldoDe(id)).toBe(10);
  });

  it('SUMA sobre lo que quedaba, no lo reemplaza', async () => {
    // Un cliente con 2 visitas que compra otro paquete de 10 tiene que quedar con 12. Reemplazar le
    // borraría dos visitas que ya pagó.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'prepago', multipass_visitas: 10 });
    const { id } = await entorno.crearTarjeta(comercioId, 2);

    await venderPaquete(supabase, comercioId, id);

    expect(await saldoDe(id)).toBe(12);
  });

  it('queda en el historial como acreditación, con la atribución del cajero', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'prepago', multipass_visitas: 10 });
    const { id } = await entorno.crearTarjeta(comercioId, 0);
    const cajeroId = await entorno.crearCajero(comercioId);

    await venderPaquete(supabase, comercioId, id, { cajeroUsuarioId: cajeroId });

    const ledger = await ledgerDe(id);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].tipo).toBe('acreditacion');
    expect(ledger[0].puntos_delta).toBe(10);
  });

  it('avisa cuando el comercio no configuró el tamaño del paquete', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'prepago' });
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    const res = await venderPaquete(supabase, comercioId, id);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('cuántas visitas trae el paquete');
    expect(await saldoDe(id)).toBe(0);
  });

  it('respeta los límites antifraude, porque reusa el camino de acreditar', async () => {
    // Es la ventaja de no haber escrito una función propia: las reglas de la Tanda 1 aplican solas.
    const comercioId = await entorno.crearComercio({
      tipo_tarjeta: 'prepago',
      multipass_visitas: 10,
      tope_acreditaciones_dia: 1,
    });
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    expect((await venderPaquete(supabase, comercioId, id)).ok).toBe(true);
    const segunda = await venderPaquete(supabase, comercioId, id);

    expect(segunda.ok).toBe(false);
    if (!segunda.ok) expect(segunda.bloqueoLimite).toBe(true);
    expect(await saldoDe(id)).toBe(10);
  });
});

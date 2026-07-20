import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { buscarTarjetaPorToken, acreditarPuntos } from './acreditar';

const supabase = createServiceClient();
const comerciosDePrueba: string[] = [];
const clientesDePrueba: string[] = [];
const tarjetasDePrueba: string[] = [];

afterEach(async () => {
  // Orden FK: ledger (transacciones) → tarjetas → clientes/comercios.
  if (tarjetasDePrueba.length) {
    await supabase.from('transacciones_puntos').delete().in('tarjeta_id', tarjetasDePrueba);
    const { error } = await supabase.from('tarjetas').delete().in('id', tarjetasDePrueba);
    if (error) console.error('[test] no se pudieron borrar las tarjetas:', error);
    tarjetasDePrueba.length = 0;
  }
  if (clientesDePrueba.length) {
    const { error } = await supabase.from('clientes').delete().in('id', clientesDePrueba);
    if (error) console.error('[test] no se pudieron borrar los clientes:', error);
    clientesDePrueba.length = 0;
  }
  if (comerciosDePrueba.length) {
    const { error } = await supabase.from('comercios').delete().in('id', comerciosDePrueba);
    if (error) console.error('[test] no se pudieron borrar los comercios:', error);
    comerciosDePrueba.length = 0;
  }
});

async function crearComercio(): Promise<string> {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase
    .from('comercios')
    .insert({ nombre: 'Comercio Escáner', slug: `test-escaner-${sufijo}` })
    .select('id')
    .single();
  if (error) throw error;
  comerciosDePrueba.push(data.id);
  return data.id;
}

async function crearTarjeta(comercioId: string, puntos = 0): Promise<{ id: string; qrToken: string }> {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data: cliente, error: eC } = await supabase
    .from('clientes')
    .insert({ nombre: 'Cliente Escáner', telefono: `+503${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}` })
    .select('id')
    .single();
  if (eC) throw eC;
  clientesDePrueba.push(cliente.id);
  const { data: tarjeta, error: eT } = await supabase
    .from('tarjetas')
    .insert({ cliente_id: cliente.id, comercio_id: comercioId, puntos_actuales: puntos, qr_token: `test-tok-${sufijo}` })
    .select('id, qr_token')
    .single();
  if (eT) throw eT;
  tarjetasDePrueba.push(tarjeta.id);
  return { id: tarjeta.id, qrToken: tarjeta.qr_token };
}

describe('buscarTarjetaPorToken', () => {
  it('encuentra la tarjeta por su token dentro del comercio', async () => {
    const comercioId = await crearComercio();
    const { id, qrToken } = await crearTarjeta(comercioId, 4);

    const res = await buscarTarjetaPorToken(supabase, comercioId, qrToken);

    expect(res).not.toBeNull();
    expect(res!.tarjetaId).toBe(id);
    expect(res!.puntosActuales).toBe(4);
    expect(res!.nombreCliente).toBe('Cliente Escáner');
  });

  it('devuelve null para el token de una tarjeta de OTRO comercio', async () => {
    // El escáner de un comercio NO debe resolver tarjetas ajenas: un QR de otro local se trata
    // igual que un token inexistente (sin filtrar información).
    const comercioA = await crearComercio();
    const comercioB = await crearComercio();
    const { qrToken } = await crearTarjeta(comercioA);

    expect(await buscarTarjetaPorToken(supabase, comercioB, qrToken)).toBeNull();
  });

  it('devuelve null para un token inexistente', async () => {
    const comercioId = await crearComercio();
    expect(await buscarTarjetaPorToken(supabase, comercioId, 'no-existe-para-nada')).toBeNull();
  });
});

describe('acreditarPuntos', () => {
  it('suma el delta, deja fila en el ledger y devuelve el nuevo saldo', async () => {
    const comercioId = await crearComercio();
    const { id } = await crearTarjeta(comercioId, 3);

    const res = await acreditarPuntos(supabase, comercioId, id, 2);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.puntosActuales).toBe(5);
    const { data } = await supabase.from('tarjetas').select('puntos_actuales').eq('id', id).single();
    expect(data!.puntos_actuales).toBe(5);
    // El ledger es la fuente de verdad de auditoría: sin fila, la acreditación no cuenta.
    const { data: ledger } = await supabase
      .from('transacciones_puntos')
      .select('puntos_delta')
      .eq('tarjeta_id', id);
    expect(ledger).toHaveLength(1);
    expect(ledger![0].puntos_delta).toBe(2);
  });

  it('rechaza deltas no positivos o no enteros sin tocar el saldo', async () => {
    const comercioId = await crearComercio();
    const { id } = await crearTarjeta(comercioId, 3);

    for (const delta of [0, -1, 1.5, NaN]) {
      const res = await acreditarPuntos(supabase, comercioId, id, delta);
      expect(res.ok).toBe(false);
    }
    const { data } = await supabase.from('tarjetas').select('puntos_actuales').eq('id', id).single();
    expect(data!.puntos_actuales).toBe(3);
  });

  it('NO acredita una tarjeta de OTRO comercio', async () => {
    // La rama de seguridad del escáner: un dueño no puede inflar tarjetas ajenas aunque conozca
    // el id. Sin el scope por comercio_id, esto acreditaría.
    const comercioA = await crearComercio();
    const comercioB = await crearComercio();
    const { id } = await crearTarjeta(comercioA, 3);

    const res = await acreditarPuntos(supabase, comercioB, id, 5);

    expect(res.ok).toBe(false);
    const { data } = await supabase.from('tarjetas').select('puntos_actuales').eq('id', id).single();
    expect(data!.puntos_actuales).toBe(3); // intacta
  });
});

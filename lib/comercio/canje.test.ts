import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { canjearRecompensa } from './canje';

const supabase = createServiceClient();
const comerciosDePrueba: string[] = [];
const clientesDePrueba: string[] = [];
const tarjetasDePrueba: string[] = [];

afterEach(async () => {
  // Orden FK: canjes → recompensas/tarjetas; transacciones → tarjetas; tarjetas → clientes/comercios.
  if (tarjetasDePrueba.length) {
    await supabase.from('canjes').delete().in('tarjeta_id', tarjetasDePrueba);
    await supabase.from('transacciones_puntos').delete().in('tarjeta_id', tarjetasDePrueba);
    const { error } = await supabase.from('tarjetas').delete().in('id', tarjetasDePrueba);
    if (error) console.error('[test] no se pudieron borrar las tarjetas:', error);
    tarjetasDePrueba.length = 0;
  }
  if (comerciosDePrueba.length) {
    await supabase.from('recompensas').delete().in('comercio_id', comerciosDePrueba);
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
    .insert({ nombre: 'Comercio Canje', slug: `test-canje-${sufijo}` })
    .select('id')
    .single();
  if (error) throw error;
  comerciosDePrueba.push(data.id);
  return data.id;
}

async function crearTarjeta(comercioId: string, puntos: number): Promise<string> {
  const { data: cliente, error: eC } = await supabase
    .from('clientes')
    .insert({ nombre: 'Cliente Canje', telefono: `+503${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}` })
    .select('id')
    .single();
  if (eC) throw eC;
  clientesDePrueba.push(cliente.id);
  const { data: tarjeta, error: eT } = await supabase
    .from('tarjetas')
    .insert({ cliente_id: cliente.id, comercio_id: comercioId, puntos_actuales: puntos })
    .select('id')
    .single();
  if (eT) throw eT;
  tarjetasDePrueba.push(tarjeta.id);
  return tarjeta.id;
}

async function crearRecompensa(comercioId: string, costo: number, activa = true): Promise<string> {
  const { data, error } = await supabase
    .from('recompensas')
    .insert({ comercio_id: comercioId, nombre: 'Café gratis', costo_puntos: costo, tipo: 'articulo_gratis', activa })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

describe('canjearRecompensa', () => {
  it('canjea: resta el costo, registra el canje y devuelve el nuevo saldo', async () => {
    const comercioId = await crearComercio();
    const tarjetaId = await crearTarjeta(comercioId, 12);
    const recompensaId = await crearRecompensa(comercioId, 10);

    const res = await canjearRecompensa(supabase, comercioId, tarjetaId, recompensaId);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.puntosActuales).toBe(2);
      expect(res.nombreRecompensa).toBe('Café gratis');
    }
    const { data: tarjeta } = await supabase.from('tarjetas').select('puntos_actuales').eq('id', tarjetaId).single();
    expect(tarjeta!.puntos_actuales).toBe(2);
    // El historial de canjes es el registro auditable (por eso recompensas usa soft-delete).
    const { data: canjes } = await supabase
      .from('canjes')
      .select('recompensa_id, puntos_gastados, estado')
      .eq('tarjeta_id', tarjetaId);
    expect(canjes).toHaveLength(1);
    expect(canjes![0].recompensa_id).toBe(recompensaId);
    expect(canjes![0].puntos_gastados).toBe(10);
    expect(canjes![0].estado).toBe('completado');
  });

  it('rechaza cuando no alcanzan los puntos: saldo intacto y SIN fila de canje', async () => {
    const comercioId = await crearComercio();
    const tarjetaId = await crearTarjeta(comercioId, 7);
    const recompensaId = await crearRecompensa(comercioId, 10);

    const res = await canjearRecompensa(supabase, comercioId, tarjetaId, recompensaId);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/alcanzan|puntos|sellos/i);
    const { data: tarjeta } = await supabase.from('tarjetas').select('puntos_actuales').eq('id', tarjetaId).single();
    expect(tarjeta!.puntos_actuales).toBe(7);
    const { data: canjes } = await supabase.from('canjes').select('id').eq('tarjeta_id', tarjetaId);
    expect(canjes).toHaveLength(0);
  });

  it('rechaza una recompensa desactivada (soft-delete)', async () => {
    const comercioId = await crearComercio();
    const tarjetaId = await crearTarjeta(comercioId, 50);
    const recompensaId = await crearRecompensa(comercioId, 10, false);

    const res = await canjearRecompensa(supabase, comercioId, tarjetaId, recompensaId);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/disponible/i);
  });

  it('rechaza una recompensa de OTRO comercio', async () => {
    const comercioA = await crearComercio();
    const comercioB = await crearComercio();
    const tarjetaId = await crearTarjeta(comercioA, 50);
    const recompensaAjena = await crearRecompensa(comercioB, 10);

    const res = await canjearRecompensa(supabase, comercioA, tarjetaId, recompensaAjena);

    expect(res.ok).toBe(false);
    const { data: tarjeta } = await supabase.from('tarjetas').select('puntos_actuales').eq('id', tarjetaId).single();
    expect(tarjeta!.puntos_actuales).toBe(50);
  });

  it('rechaza una tarjeta de OTRO comercio', async () => {
    const comercioA = await crearComercio();
    const comercioB = await crearComercio();
    const tarjetaAjena = await crearTarjeta(comercioA, 50);
    const recompensaId = await crearRecompensa(comercioB, 10);

    const res = await canjearRecompensa(supabase, comercioB, tarjetaAjena, recompensaId);

    expect(res.ok).toBe(false);
    const { data: tarjeta } = await supabase.from('tarjetas').select('puntos_actuales').eq('id', tarjetaAjena).single();
    expect(tarjeta!.puntos_actuales).toBe(50);
  });
});

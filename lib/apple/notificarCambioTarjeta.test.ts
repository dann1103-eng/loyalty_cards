import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { notificarCambioTarjeta } from './notificarCambioTarjeta';

const supabase = createServiceClient();
let ids: { comercioId: string; clienteId: string; tarjetaId: string } | null = null;

afterEach(async () => {
  if (!ids) return;
  await supabase.from('tarjetas').delete().eq('id', ids.tarjetaId);
  await supabase.from('clientes').delete().eq('id', ids.clienteId);
  await supabase.from('comercios').delete().eq('id', ids.comercioId);
  ids = null;
});

describe('notificarCambioTarjeta', () => {
  it('no lanza error cuando la tarjeta no tiene dispositivos registrados', async () => {
    const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { data: comercio } = await supabase
      .from('comercios').insert({ nombre: 'Comercio Test', slug: `test-push-${sufijo}` }).select('id').single();
    const { data: cliente } = await supabase
      .from('clientes').insert({ nombre: 'Cliente Test', telefono: `+503-push-${sufijo}` }).select('id').single();
    const { data: tarjeta } = await supabase
      .from('tarjetas').insert({ cliente_id: cliente!.id, comercio_id: comercio!.id }).select('id').single();

    ids = { comercioId: comercio!.id, clienteId: cliente!.id, tarjetaId: tarjeta!.id };

    await expect(notificarCambioTarjeta(supabase, tarjeta!.id)).resolves.not.toThrow();
  });
});

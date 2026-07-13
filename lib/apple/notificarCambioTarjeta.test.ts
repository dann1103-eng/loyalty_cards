import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { Responses, ResponseSent, ResponseFailure } from '@parse/node-apn';
import { createServiceClient } from '../supabase/server';
import { notificarCambioTarjeta } from './notificarCambioTarjeta';
import { enviarPushActualizacion } from './enviarPush';

// Mockeamos el envío APNs: los tests verifican la lógica de poda de registros contra la BD
// real, sin tocar Apple. (El envío real se valida a mano en la Tarea 12.)
vi.mock('./enviarPush', () => ({
  enviarPushActualizacion: vi.fn(),
}));

const enviarMock = vi.mocked(enviarPushActualizacion);
const supabase = createServiceClient();
let ids: { comercioId: string; clienteId: string; tarjetaId: string } | null = null;

// Respuestas con la forma real del `send()` de @parse/node-apn: Responses<ResponseSent, ResponseFailure>.
// En los tipos `status` es number (HTTP 410 = token muerto). Lo único que lee la lógica de poda es
// `failed[0].response?.reason`, así que la respuesta transitoria omite `response` a propósito.
type RespuestaApns = Responses<ResponseSent, ResponseFailure>;

function RESPUESTA_FALLIDA(reason: string): RespuestaApns {
  return { sent: [], failed: [{ device: 'push-tok', status: 410, response: { reason } }] };
}

function RESPUESTA_TRANSITORIA(): RespuestaApns {
  return { sent: [], failed: [{ device: 'push-tok', error: new Error('network') }] };
}

async function crearTarjeta(conDispositivo: boolean) {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data: comercio } = await supabase
    .from('comercios').insert({ nombre: 'Comercio Test', slug: `test-push-${sufijo}` }).select('id').single();
  const { data: cliente } = await supabase
    .from('clientes').insert({ nombre: 'Cliente Test', telefono: `+503-push-${sufijo}` }).select('id').single();
  const { data: tarjeta } = await supabase
    .from('tarjetas').insert({ cliente_id: cliente!.id, comercio_id: comercio!.id }).select('id').single();
  if (conDispositivo) {
    await supabase.from('apple_push_registrations').insert({
      tarjeta_id: tarjeta!.id, device_library_identifier: 'device-mock', push_token: 'push-tok',
    });
  }
  ids = { comercioId: comercio!.id, clienteId: cliente!.id, tarjetaId: tarjeta!.id };
  return ids;
}

async function contarRegistros(tarjetaId: string): Promise<number> {
  const { count } = await supabase
    .from('apple_push_registrations').select('id', { count: 'exact', head: true }).eq('tarjeta_id', tarjetaId);
  return count ?? 0;
}

beforeEach(() => {
  enviarMock.mockReset();
});

afterEach(async () => {
  if (!ids) return;
  await supabase.from('apple_push_registrations').delete().eq('tarjeta_id', ids.tarjetaId);
  await supabase.from('tarjetas').delete().eq('id', ids.tarjetaId);
  await supabase.from('clientes').delete().eq('id', ids.clienteId);
  await supabase.from('comercios').delete().eq('id', ids.comercioId);
  ids = null;
});

describe('notificarCambioTarjeta', () => {
  it('no lanza error ni envía push cuando la tarjeta no tiene dispositivos', async () => {
    const t = await crearTarjeta(false);
    await expect(notificarCambioTarjeta(supabase, t.tarjetaId)).resolves.not.toThrow();
    expect(enviarMock).not.toHaveBeenCalled();
  });

  it('borra el registro cuando APNs responde con un token muerto (BadDeviceToken)', async () => {
    const t = await crearTarjeta(true);
    enviarMock.mockResolvedValue(RESPUESTA_FALLIDA('BadDeviceToken'));
    await notificarCambioTarjeta(supabase, t.tarjetaId);
    expect(enviarMock).toHaveBeenCalledOnce();
    expect(await contarRegistros(t.tarjetaId)).toBe(0);
  });

  it('conserva el registro ante un fallo transitorio sin reason', async () => {
    const t = await crearTarjeta(true);
    enviarMock.mockResolvedValue(RESPUESTA_TRANSITORIA());
    await notificarCambioTarjeta(supabase, t.tarjetaId);
    expect(enviarMock).toHaveBeenCalledOnce();
    expect(await contarRegistros(t.tarjetaId)).toBe(1);
  });
});

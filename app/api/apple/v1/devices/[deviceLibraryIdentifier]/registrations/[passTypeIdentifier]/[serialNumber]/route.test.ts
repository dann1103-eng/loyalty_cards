import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, DELETE } from './route';
import { createServiceClient } from '@/lib/supabase/server';

const supabase = createServiceClient();
let ids: { comercioId: string; clienteId: string; tarjetaId: string; serialNumber: string } | null = null;

async function crearTarjetaDePrueba() {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data: comercio } = await supabase
    .from('comercios').insert({ nombre: 'Comercio Test', slug: `test-ws-${sufijo}` }).select('id').single();
  const { data: cliente } = await supabase
    .from('clientes').insert({ nombre: 'Cliente Test', telefono: `+503-ws-${sufijo}` }).select('id').single();
  const serialNumber = `serial-test-${sufijo}`;
  const { data: tarjeta } = await supabase
    .from('tarjetas')
    .insert({
      cliente_id: cliente!.id,
      comercio_id: comercio!.id,
      apple_serial_number: serialNumber,
      apple_auth_token: 'token-de-prueba-1234567890ab',
    })
    .select('id').single();

  ids = { comercioId: comercio!.id, clienteId: cliente!.id, tarjetaId: tarjeta!.id, serialNumber };
  return ids;
}

afterEach(async () => {
  if (!ids) return;
  await supabase.from('apple_push_registrations').delete().eq('tarjeta_id', ids.tarjetaId);
  await supabase.from('tarjetas').delete().eq('id', ids.tarjetaId);
  await supabase.from('clientes').delete().eq('id', ids.clienteId);
  await supabase.from('comercios').delete().eq('id', ids.comercioId);
  ids = null;
});

function crearRequest(serialNumber: string, authorization: string, body: unknown) {
  return new NextRequest(
    `http://localhost/api/apple/v1/devices/device-abc/registrations/pass.com.fmcomsolutions.loyalty/${serialNumber}`,
    { method: 'POST', headers: { authorization }, body: JSON.stringify(body) },
  );
}

describe('POST /api/apple/v1/devices/.../registrations/...', () => {
  it('registra un dispositivo nuevo cuando el token es correcto', async () => {
    const tarjeta = await crearTarjetaDePrueba();
    const request = crearRequest(tarjeta.serialNumber, 'ApplePass token-de-prueba-1234567890ab', { pushToken: 'push-token-de-prueba' });

    const response = await POST(request, {
      params: Promise.resolve({
        deviceLibraryIdentifier: 'device-abc',
        passTypeIdentifier: 'pass.com.fmcomsolutions.loyalty',
        serialNumber: tarjeta.serialNumber,
      }),
    });

    expect(response.status).toBe(201);
  });

  it('rechaza con 401 si el token de autenticación no coincide', async () => {
    const tarjeta = await crearTarjetaDePrueba();
    const request = crearRequest(tarjeta.serialNumber, 'ApplePass token-incorrecto', { pushToken: 'push-token-de-prueba' });

    const response = await POST(request, {
      params: Promise.resolve({
        deviceLibraryIdentifier: 'device-abc',
        passTypeIdentifier: 'pass.com.fmcomsolutions.loyalty',
        serialNumber: tarjeta.serialNumber,
      }),
    });

    expect(response.status).toBe(401);
  });

  it('es idempotente: registrar el mismo dispositivo dos veces devuelve 200 la segunda vez', async () => {
    const tarjeta = await crearTarjetaDePrueba();
    const hacerRequest = () => POST(
      crearRequest(tarjeta.serialNumber, 'ApplePass token-de-prueba-1234567890ab', { pushToken: 'push-token-de-prueba' }),
      { params: Promise.resolve({ deviceLibraryIdentifier: 'device-abc', passTypeIdentifier: 'pass.com.fmcomsolutions.loyalty', serialNumber: tarjeta.serialNumber }) },
    );
    const primera = await hacerRequest();
    const segunda = await hacerRequest();
    expect(primera.status).toBe(201);
    expect(segunda.status).toBe(200);
  });
});

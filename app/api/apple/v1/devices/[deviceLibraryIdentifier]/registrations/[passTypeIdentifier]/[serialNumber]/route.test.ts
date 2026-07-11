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

function crearRequest(serialNumber: string, authorization: string, body: unknown, method = 'POST') {
  return new NextRequest(
    `http://localhost/api/apple/v1/devices/device-abc/registrations/pass.com.fmcomsolutions.loyalty/${serialNumber}`,
    { method, headers: { authorization }, body: method === 'DELETE' ? undefined : JSON.stringify(body) },
  );
}

function paramsDe(serialNumber: string) {
  return {
    params: Promise.resolve({
      deviceLibraryIdentifier: 'device-abc',
      passTypeIdentifier: 'pass.com.fmcomsolutions.loyalty',
      serialNumber,
    }),
  };
}

async function contarRegistros(tarjetaId: string): Promise<number> {
  const { count } = await supabase
    .from('apple_push_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('tarjeta_id', tarjetaId);
  return count ?? 0;
}

describe('POST /api/apple/v1/devices/.../registrations/...', () => {
  it('registra un dispositivo nuevo cuando el token es correcto', async () => {
    const tarjeta = await crearTarjetaDePrueba();
    const response = await POST(
      crearRequest(tarjeta.serialNumber, 'ApplePass token-de-prueba-1234567890ab', { pushToken: 'push-token-de-prueba' }),
      paramsDe(tarjeta.serialNumber),
    );
    expect(response.status).toBe(201);
  });

  it('rechaza con 401 si el token de autenticación no coincide', async () => {
    const tarjeta = await crearTarjetaDePrueba();
    const response = await POST(
      crearRequest(tarjeta.serialNumber, 'ApplePass token-incorrecto', { pushToken: 'push-token-de-prueba' }),
      paramsDe(tarjeta.serialNumber),
    );
    expect(response.status).toBe(401);
  });

  it('es idempotente: registrar el mismo dispositivo dos veces devuelve 200 la segunda vez', async () => {
    const tarjeta = await crearTarjetaDePrueba();
    const hacer = () => POST(
      crearRequest(tarjeta.serialNumber, 'ApplePass token-de-prueba-1234567890ab', { pushToken: 'push-token-de-prueba' }),
      paramsDe(tarjeta.serialNumber),
    );
    const primera = await hacer();
    const segunda = await hacer();
    expect(primera.status).toBe(201);
    expect(segunda.status).toBe(200);
  });

  it('al re-registrar el mismo dispositivo, actualiza el push_token (APNs pudo rotarlo)', async () => {
    const tarjeta = await crearTarjetaDePrueba();
    await POST(
      crearRequest(tarjeta.serialNumber, 'ApplePass token-de-prueba-1234567890ab', { pushToken: 'token-viejo' }),
      paramsDe(tarjeta.serialNumber),
    );
    await POST(
      crearRequest(tarjeta.serialNumber, 'ApplePass token-de-prueba-1234567890ab', { pushToken: 'token-nuevo' }),
      paramsDe(tarjeta.serialNumber),
    );
    const { data } = await supabase
      .from('apple_push_registrations')
      .select('push_token')
      .eq('tarjeta_id', tarjeta.tarjetaId)
      .single();
    expect(data!.push_token).toBe('token-nuevo');
  });
});

describe('DELETE /api/apple/v1/devices/.../registrations/...', () => {
  it('desregistra el dispositivo con token correcto y elimina la fila', async () => {
    const tarjeta = await crearTarjetaDePrueba();
    await POST(
      crearRequest(tarjeta.serialNumber, 'ApplePass token-de-prueba-1234567890ab', { pushToken: 'push-token-de-prueba' }),
      paramsDe(tarjeta.serialNumber),
    );
    expect(await contarRegistros(tarjeta.tarjetaId)).toBe(1);

    const response = await DELETE(
      crearRequest(tarjeta.serialNumber, 'ApplePass token-de-prueba-1234567890ab', null, 'DELETE'),
      paramsDe(tarjeta.serialNumber),
    );
    expect(response.status).toBe(200);
    expect(await contarRegistros(tarjeta.tarjetaId)).toBe(0);
  });

  it('rechaza con 401 y NO elimina la fila si el token no coincide', async () => {
    const tarjeta = await crearTarjetaDePrueba();
    await POST(
      crearRequest(tarjeta.serialNumber, 'ApplePass token-de-prueba-1234567890ab', { pushToken: 'push-token-de-prueba' }),
      paramsDe(tarjeta.serialNumber),
    );

    const response = await DELETE(
      crearRequest(tarjeta.serialNumber, 'ApplePass token-incorrecto', null, 'DELETE'),
      paramsDe(tarjeta.serialNumber),
    );
    expect(response.status).toBe(401);
    expect(await contarRegistros(tarjeta.tarjetaId)).toBe(1);
  });
});

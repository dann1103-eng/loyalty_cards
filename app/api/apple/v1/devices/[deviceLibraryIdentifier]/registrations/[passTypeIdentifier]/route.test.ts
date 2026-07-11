import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { createServiceClient } from '@/lib/supabase/server';

const supabase = createServiceClient();
let ids: { comercioId: string; clienteId: string; tarjetaId: string; serialNumber: string } | null = null;

async function crearTarjetaRegistrada(deviceId: string) {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data: comercio } = await supabase.from('comercios').insert({ nombre: 'Comercio Test', slug: `test-ser-${sufijo}` }).select('id').single();
  const { data: cliente } = await supabase.from('clientes').insert({ nombre: 'Cliente Test', telefono: `+503-ser-${sufijo}` }).select('id').single();
  const serialNumber = `serial-test-${sufijo}`;
  const { data: tarjeta } = await supabase.from('tarjetas').insert({
    cliente_id: cliente!.id, comercio_id: comercio!.id, apple_serial_number: serialNumber, apple_auth_token: 'token-1234567890abcd',
  }).select('id').single();
  await supabase.from('apple_push_registrations').insert({ tarjeta_id: tarjeta!.id, device_library_identifier: deviceId, push_token: 'push-tok' });
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

function paramsDe(deviceId: string) {
  return { params: Promise.resolve({ deviceLibraryIdentifier: deviceId, passTypeIdentifier: 'pass.com.fmcomsolutions.loyalty' }) };
}

describe('GET seriales por dispositivo', () => {
  it('devuelve los serialNumbers de las tarjetas registradas en el dispositivo', async () => {
    const deviceId = `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const t = await crearTarjetaRegistrada(deviceId);
    const res = await GET(new NextRequest('http://localhost/x'), paramsDe(deviceId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.serialNumbers).toContain(t.serialNumber);
    expect(typeof body.lastUpdated).toBe('string');
  });

  it('devuelve 204 si el dispositivo no tiene tarjetas registradas', async () => {
    const res = await GET(new NextRequest('http://localhost/x'), paramsDe(`device-vacio-${Date.now()}`));
    expect(res.status).toBe(204);
  });
});

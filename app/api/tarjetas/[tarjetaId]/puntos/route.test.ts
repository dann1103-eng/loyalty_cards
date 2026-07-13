import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { createServiceClient } from '@/lib/supabase/server';

const supabase = createServiceClient();
let ids: { comercioId: string; clienteId: string; tarjetaId: string } | null = null;

afterEach(async () => {
  if (!ids) return;
  await supabase.from('transacciones_puntos').delete().eq('tarjeta_id', ids.tarjetaId);
  await supabase.from('tarjetas').delete().eq('id', ids.tarjetaId);
  await supabase.from('clientes').delete().eq('id', ids.clienteId);
  await supabase.from('comercios').delete().eq('id', ids.comercioId);
  ids = null;
});

describe('POST /api/tarjetas/[tarjetaId]/puntos', () => {
  it('suma puntos y actualiza el saldo de la tarjeta', async () => {
    const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { data: comercio } = await supabase
      .from('comercios').insert({ nombre: 'Comercio Test', slug: `test-puntos-${sufijo}` }).select('id').single();
    const { data: cliente } = await supabase
      .from('clientes').insert({ nombre: 'Cliente Test', telefono: `+503-puntos-${sufijo}` }).select('id').single();
    const { data: tarjeta } = await supabase
      .from('tarjetas').insert({ cliente_id: cliente!.id, comercio_id: comercio!.id }).select('id').single();

    ids = { comercioId: comercio!.id, clienteId: cliente!.id, tarjetaId: tarjeta!.id };

    const request = new NextRequest(`http://localhost/api/tarjetas/${tarjeta!.id}/puntos`, {
      method: 'POST',
      body: JSON.stringify({ puntosDelta: 10 }),
    });

    const response = await POST(request, { params: Promise.resolve({ tarjetaId: tarjeta!.id }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.puntosActuales).toBe(10);

    const { data: transacciones } = await supabase
      .from('transacciones_puntos').select('puntos_delta').eq('tarjeta_id', tarjeta!.id);
    expect(transacciones).toHaveLength(1);
    expect(transacciones![0].puntos_delta).toBe(10);
  });

  it('rechaza con 400 si puntosDelta no es un número positivo', async () => {
    const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { data: comercio } = await supabase
      .from('comercios').insert({ nombre: 'Comercio Test', slug: `test-puntos-${sufijo}` }).select('id').single();
    const { data: cliente } = await supabase
      .from('clientes').insert({ nombre: 'Cliente Test', telefono: `+503-puntos-${sufijo}` }).select('id').single();
    const { data: tarjeta } = await supabase
      .from('tarjetas').insert({ cliente_id: cliente!.id, comercio_id: comercio!.id }).select('id').single();

    ids = { comercioId: comercio!.id, clienteId: cliente!.id, tarjetaId: tarjeta!.id };

    const request = new NextRequest(`http://localhost/api/tarjetas/${tarjeta!.id}/puntos`, {
      method: 'POST',
      body: JSON.stringify({ puntosDelta: -5 }),
    });
    const response = await POST(request, { params: Promise.resolve({ tarjetaId: tarjeta!.id }) });
    expect(response.status).toBe(400);
  });

  it('rechaza con 400 si puntosDelta es fraccionario (columna integer)', async () => {
    const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { data: comercio } = await supabase
      .from('comercios').insert({ nombre: 'Comercio Test', slug: `test-puntos-${sufijo}` }).select('id').single();
    const { data: cliente } = await supabase
      .from('clientes').insert({ nombre: 'Cliente Test', telefono: `+503-puntos-${sufijo}` }).select('id').single();
    const { data: tarjeta } = await supabase
      .from('tarjetas').insert({ cliente_id: cliente!.id, comercio_id: comercio!.id }).select('id').single();

    ids = { comercioId: comercio!.id, clienteId: cliente!.id, tarjetaId: tarjeta!.id };

    const request = new NextRequest(`http://localhost/api/tarjetas/${tarjeta!.id}/puntos`, {
      method: 'POST',
      body: JSON.stringify({ puntosDelta: 10.5 }),
    });
    const response = await POST(request, { params: Promise.resolve({ tarjetaId: tarjeta!.id }) });
    expect(response.status).toBe(400);
  });

  it('devuelve 404 si la tarjeta no existe', async () => {
    const request = new NextRequest('http://localhost/api/tarjetas/00000000-0000-0000-0000-000000000000/puntos', {
      method: 'POST',
      body: JSON.stringify({ puntosDelta: 10 }),
    });
    const response = await POST(request, { params: Promise.resolve({ tarjetaId: '00000000-0000-0000-0000-000000000000' }) });
    expect(response.status).toBe(404);
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import JSZip from 'jszip';
import { GET } from './route';
import { createServiceClient } from '@/lib/supabase/server';

const supabase = createServiceClient();
const AUTH = 'token-de-prueba-1234567890ab';
let ids: { comercioId: string; clienteId: string; tarjetaId: string; serialNumber: string } | null = null;

async function crearTarjeta() {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data: comercio } = await supabase.from('comercios').insert({
    nombre: 'Comercio Test', slug: `test-lp-${sufijo}`,
    color_fondo: 'rgb(35, 24, 18)', color_texto: 'rgb(255, 255, 255)', color_label: 'rgb(255, 255, 255)',
  }).select('id').single();
  const { data: cliente } = await supabase.from('clientes').insert({ nombre: 'Cliente Test', telefono: `+503-lp-${sufijo}` }).select('id').single();
  const serialNumber = `serial-lp-${sufijo}`;
  const { data: tarjeta } = await supabase.from('tarjetas').insert({
    cliente_id: cliente!.id, comercio_id: comercio!.id, apple_serial_number: serialNumber, apple_auth_token: AUTH, puntos_actuales: 7,
  }).select('id').single();
  ids = { comercioId: comercio!.id, clienteId: cliente!.id, tarjetaId: tarjeta!.id, serialNumber };
  return { serialNumber };
}

afterEach(async () => {
  if (!ids) return;
  await supabase.from('tarjetas').delete().eq('id', ids.tarjetaId);
  await supabase.from('clientes').delete().eq('id', ids.clienteId);
  await supabase.from('comercios').delete().eq('id', ids.comercioId);
  ids = null;
});

function paramsDe(serialNumber: string) {
  return { params: Promise.resolve({ passTypeIdentifier: 'pass.com.fmcomsolutions.loyalty', serialNumber }) };
}

describe('GET último pass', () => {
  it('devuelve el .pkpass firmado con el token correcto', async () => {
    const { serialNumber } = await crearTarjeta();
    const req = new NextRequest('http://localhost/x', { headers: { authorization: `ApplePass ${AUTH}` } });
    const res = await GET(req, paramsDe(serialNumber));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.apple.pkpass');
    const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(['pass.json', 'manifest.json', 'signature']));
  });

  it('rechaza con 401 si el token es incorrecto', async () => {
    const { serialNumber } = await crearTarjeta();
    const req = new NextRequest('http://localhost/x', { headers: { authorization: 'ApplePass incorrecto' } });
    const res = await GET(req, paramsDe(serialNumber));
    expect(res.status).toBe(401);
  });

  it('devuelve 401 si el serial no existe', async () => {
    const req = new NextRequest('http://localhost/x', { headers: { authorization: `ApplePass ${AUTH}` } });
    const res = await GET(req, paramsDe(`serial-inexistente-${Date.now()}`));
    expect(res.status).toBe(401);
  });
});

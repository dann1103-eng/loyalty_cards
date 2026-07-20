import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { createServiceClient } from '@/lib/supabase/server';
import { LIMITE_INTENTOS } from '@/lib/portal/limiteIntentos';

const supabase = createServiceClient();
const ipsDePrueba: string[] = [];
let limpiar: { comercioId: string; clienteId: string; tarjetaId: string } | null = null;

afterEach(async () => {
  if (ipsDePrueba.length) {
    await supabase.from('intentos_consulta_portal').delete().in('ip', ipsDePrueba);
    ipsDePrueba.length = 0;
  }
  if (limpiar) {
    await supabase.from('tarjetas').delete().eq('id', limpiar.tarjetaId);
    await supabase.from('clientes').delete().eq('id', limpiar.clienteId);
    await supabase.from('comercios').delete().eq('id', limpiar.comercioId);
    limpiar = null;
  }
});

// Mismo motivo que en buscarTarjetas.test.ts: un teléfono sintético que no sobrevive
// normalizarTelefono() (por ejemplo "+000-route-<timestamp>") haría que esta prueba "encuentre"
// por comparación de string crudo, no porque la ruta normalice de verdad — un falso positivo.
function telefonoUnico(): string {
  const ultimos8DeReloj = String(Date.now()).slice(-8);
  const azar4Digitos = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `+503${ultimos8DeReloj}${azar4Digitos}`;
}

// x-forwarded-for de UN solo valor: así tanto el helper del paquete como el fallback (último
// valor) devuelven la misma IP, y el test no depende de cuál de los dos use obtenerIp().
function pedir(telefono: unknown, ip: string): NextRequest {
  ipsDePrueba.push(ip);
  return new NextRequest('http://localhost/api/portal/consulta', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ telefono }),
  });
}

describe('POST /api/portal/consulta', () => {
  it('devuelve las tarjetas para un teléfono registrado', async () => {
    const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const telefono = telefonoUnico();
    const { data: comercio } = await supabase
      .from('comercios').insert({ nombre: 'Portal Route Test', slug: `test-route-portal-${sufijo}` }).select('id').single();
    const { data: cliente } = await supabase
      .from('clientes').insert({ nombre: 'Cliente Route', telefono }).select('id').single();
    const { data: tarjeta } = await supabase
      .from('tarjetas').insert({ cliente_id: cliente!.id, comercio_id: comercio!.id, puntos_actuales: 3 }).select('id').single();
    limpiar = { comercioId: comercio!.id, clienteId: cliente!.id, tarjetaId: tarjeta!.id };

    const res = await POST(pedir(telefono, `ip-ok-${sufijo}`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.encontrado).toBe(true);
    expect(body.tarjetas).toHaveLength(1);
    expect(body.tarjetas[0].saldoTexto).toBe('3 puntos');
  });

  it('devuelve encontrado:false para un teléfono no registrado', async () => {
    const res = await POST(pedir(telefonoUnico(), `ip-none-${Date.now()}`));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.encontrado).toBe(false);
  });

  it('responde 429 cuando se supera el límite de intentos', async () => {
    const ip = `ip-flood-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    ipsDePrueba.push(ip);
    const filas = Array.from({ length: LIMITE_INTENTOS }, () => ({ ip }));
    await supabase.from('intentos_consulta_portal').insert(filas);

    const req = new NextRequest('http://localhost/api/portal/consulta', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ telefono: '+000-cualquiera' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(429);
  });

  it('rechaza con 400 un cuerpo sin teléfono', async () => {
    const res = await POST(pedir('', `ip-empty-${Date.now()}`));
    expect(res.status).toBe(400);
  });
});

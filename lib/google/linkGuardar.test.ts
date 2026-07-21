import { describe, it, expect, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createServiceClient } from '../supabase/server';
import { generarLinkGuardar } from './linkGuardar';

// Par de llaves de PRUEBA generado en memoria — nunca toca las credenciales reales del proyecto.
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

vi.mock('./walletClient', () => ({
  issuerId: () => 'issuer-test',
  credencialesServicio: () => ({ client_email: 'cuenta-prueba@test.iam.gserviceaccount.com', private_key: privateKey }),
}));

const supabase = createServiceClient();
let ids: { comercioId: string; clienteId: string; tarjetaId: string } | null = null;

async function crearTarjeta(opts: { googleClassId?: string | null; logoUrl?: string | null; puntos?: number }) {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data: comercio, error: eC } = await supabase
    .from('comercios')
    .insert({
      nombre: 'Comercio Link Test',
      slug: `test-google-link-${sufijo}`,
      google_class_id: opts.googleClassId === undefined ? 'issuer-test.comercio_x' : opts.googleClassId,
      logo_url: opts.logoUrl === undefined ? 'https://ejemplo.com/logo.png' : opts.logoUrl,
    })
    .select('id')
    .single();
  if (eC) throw eC;
  const { data: cliente, error: eCl } = await supabase
    .from('clientes').insert({ nombre: 'Cliente Test', telefono: `+503-link-${sufijo}` }).select('id').single();
  if (eCl) throw eCl;
  const { data: tarjeta, error: eT } = await supabase
    .from('tarjetas')
    .insert({ cliente_id: cliente.id, comercio_id: comercio.id, puntos_actuales: opts.puntos ?? 0 })
    .select('id')
    .single();
  if (eT) throw eT;
  ids = { comercioId: comercio.id, clienteId: cliente.id, tarjetaId: tarjeta.id };
  return ids;
}

afterEach(async () => {
  if (!ids) return;
  await supabase.from('tarjetas').delete().eq('id', ids.tarjetaId);
  await supabase.from('clientes').delete().eq('id', ids.clienteId);
  await supabase.from('comercios').delete().eq('id', ids.comercioId);
  ids = null;
});

describe('generarLinkGuardar', () => {
  it('produce un link https://pay.google.com/gp/v/save/<jwt> firmado y verificable', async () => {
    const t = await crearTarjeta({ puntos: 5 });
    const url = await generarLinkGuardar(supabase, t.tarjetaId);
    expect(url).toMatch(/^https:\/\/pay\.google\.com\/gp\/v\/save\//);

    const token = url!.replace('https://pay.google.com/gp/v/save/', '');
    const claims = jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as Record<string, unknown>;
    expect(claims.iss).toBe('cuenta-prueba@test.iam.gserviceaccount.com');
    expect(claims.aud).toBe('google');
    expect(claims.typ).toBe('savetowallet');
    const payload = claims.payload as { loyaltyClasses: Array<{ id: string }>; loyaltyObjects: Array<{ id: string; classId: string }> };
    expect(payload.loyaltyClasses[0].id).toBe('issuer-test.comercio_x');
    expect(payload.loyaltyObjects[0].id).toBe('issuer-test.tarjeta_' + t.tarjetaId);
    expect(payload.loyaltyObjects[0].classId).toBe('issuer-test.comercio_x');
  });

  it('devuelve null si el comercio no tiene Google Wallet habilitado (sin google_class_id)', async () => {
    const t = await crearTarjeta({ googleClassId: null });
    expect(await generarLinkGuardar(supabase, t.tarjetaId)).toBeNull();
  });

  it('devuelve null si el comercio no tiene logo (Google lo exige)', async () => {
    const t = await crearTarjeta({ logoUrl: null });
    expect(await generarLinkGuardar(supabase, t.tarjetaId)).toBeNull();
  });

  it('devuelve null para una tarjeta inexistente', async () => {
    expect(await generarLinkGuardar(supabase, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

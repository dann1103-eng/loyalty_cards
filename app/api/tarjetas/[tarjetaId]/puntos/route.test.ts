import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

// Fase 4: el endpoint quedó protegido por sesión de comercio. La lógica de acreditación (ledger,
// saldo, scoping por comercio) se prueba contra la BD real en lib/comercio/acreditar.test.ts;
// aquí se fija el CONTRATO HTTP del cascarón: validación (400) antes del auth, y 401 sin sesión.
// En Vitest no hay contexto de request de Next (cookies() lanza) → ownerDeSesion trata eso como
// sesión ausente, que es exactamente el caso "anónimo" que estas pruebas ejercitan.

function pedir(tarjetaId: string, body: unknown): [NextRequest, { params: Promise<{ tarjetaId: string }> }] {
  return [
    new NextRequest(`http://localhost/api/tarjetas/${tarjetaId}/puntos`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ tarjetaId }) },
  ];
}

const TARJETA = '00000000-0000-0000-0000-000000000000';

describe('POST /api/tarjetas/[tarjetaId]/puntos', () => {
  it('rechaza con 400 si puntosDelta no es un número positivo', async () => {
    const response = await POST(...pedir(TARJETA, { puntosDelta: -5 }));
    expect(response.status).toBe(400);
  });

  it('rechaza con 400 si puntosDelta es fraccionario (columna integer)', async () => {
    const response = await POST(...pedir(TARJETA, { puntosDelta: 10.5 }));
    expect(response.status).toBe(400);
  });

  it('rechaza con 401 un delta válido SIN sesión de comercio', async () => {
    // ESTE es el candado de la Fase 4: antes, este mismo request público acreditaba puntos a
    // cualquier tarjeta. Ahora, sin sesión de dueño, no toca nada y responde 401.
    const response = await POST(...pedir(TARJETA, { puntosDelta: 10 }));
    expect(response.status).toBe(401);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Esta prueba no toca la base ni ningún canal: los dos recorridos y el cliente de Supabase son
// dobles. Lo que se prueba es la RUTA — los candados, que corran los dos pases y en qué orden. Lo
// que hace cada pase lo prueban avisoVencimiento.test.ts y avisoInactividad.test.ts.
const orden: string[] = [];
const resumenVencimiento = { programasRevisados: 2, avisadas: ['t-venc'], sinEntregar: ['t-sin'] };
const resumenInactividad = { comerciosRevisados: 3, avisadas: ['t-inac'] };

const vencimientoMock = vi.fn(async (_supabase: unknown) => {
  orden.push('vencimiento');
  return resumenVencimiento;
});
const inactividadMock = vi.fn(async (_supabase: unknown) => {
  orden.push('inactividad');
  return resumenInactividad;
});

vi.mock('@/lib/comercio/avisoVencimiento', () => ({
  procesarAvisosVencimiento: (...a: Parameters<typeof vencimientoMock>) => vencimientoMock(...a),
}));
vi.mock('@/lib/comercio/avisoInactividad', () => ({
  procesarAvisosInactividad: (...a: Parameters<typeof inactividadMock>) => inactividadMock(...a),
}));
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({ doble: true }) }));

import { GET } from './route';

function pedido(authorization?: string): NextRequest {
  return new NextRequest('http://localhost/api/cron/avisos', {
    headers: authorization ? { authorization } : {},
  });
}

const secretoOriginal = process.env.CRON_SECRET;

beforeEach(() => {
  orden.length = 0;
  vencimientoMock.mockClear();
  inactividadMock.mockClear();
  process.env.CRON_SECRET = 'secreto-de-prueba';
});
afterEach(() => {
  if (secretoOriginal === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = secretoOriginal;
});

describe('GET /api/cron/avisos', () => {
  it('sin CRON_SECRET configurado falla cerrado y no corre ningún pase', async () => {
    delete process.env.CRON_SECRET;

    const res = await GET(pedido('Bearer undefined'));

    expect(res.status).toBe(500);
    expect(orden).toEqual([]);
  });

  it('con un secreto equivocado responde 401 y no corre ningún pase', async () => {
    const res = await GET(pedido('Bearer otro'));

    expect(res.status).toBe(401);
    expect(orden).toEqual([]);
  });

  it('corre los DOS pases, primero el de vencimiento', async () => {
    // MUTACIÓN: invirtiendo el orden en la ruta esta prueba FALLA. El orden importa (decisión 7):
    // el de inactividad saltea la tarjeta con un aviso vigente, así que tiene que evaluarse DESPUÉS
    // de que el de vencimiento haya escrito el del día. Al revés, una membresía inactiva y por
    // vencer recibe los dos push el mismo día y el reverso termina diciendo "volvé" sin la fecha.
    const res = await GET(pedido('Bearer secreto-de-prueba'));

    expect(res.status).toBe(200);
    expect(orden).toEqual(['vencimiento', 'inactividad']);
    expect(vencimientoMock).toHaveBeenCalledWith({ doble: true });
    expect(inactividadMock).toHaveBeenCalledWith({ doble: true });
  });

  it('el resumen trae los dos pases, con los sinEntregar del de vencimiento', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const res = await GET(pedido('Bearer secreto-de-prueba'));

      const cuerpo = { vencimiento: resumenVencimiento, inactividad: resumenInactividad };
      expect(await res.json()).toEqual(cuerpo);
      expect(log).toHaveBeenCalledWith('[cron] avisos:', cuerpo);
    } finally {
      log.mockRestore();
    }
  });
});

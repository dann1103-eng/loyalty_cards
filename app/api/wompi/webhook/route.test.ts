import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { RepositorioPagosFalso } from '@/test/fixtures/repositorioPagosFalso';
import type { CobroParaPago } from '@/lib/comercios/confirmarPago';
import { firmaHmac } from '@/lib/wompi/firma';

// Prueba del CABLEADO de la ruta: que lea la firma del header `wompi_hash`, que responda 401/500/200 y que
// pase a Meta. La lógica de fondo (firma, conciliación, idempotencia) se prueba en procesarWebhook.test.ts y
// confirmarPago.test.ts. Supabase, Meta y `after` se simulan: acá no hay base ni red.
//
// MUTATION-TESTING (cada fila se corrió):
//   - leer otro nombre de header que `wompi_hash`            → falla "acepta el webhook firmado en el header wompi_hash"
//   - re-serializar el JSON en vez de firmar lo recibido      → falla "la firma se calcula sobre los bytes: un cuerpo con formato distinto…"
//   - leer el cuerpo como texto (`request.text()`, que descarta un BOM inicial) → falla "un BOM inicial cuenta para la firma"
//   - responder 200 sin la variable de entorno del secreto   → falla "sin WOMPI_CLIENT_SECRET responde 500"
//   - no pasar `alReclamar` a Meta                           → falla "avisa a Meta con el monto del cobro"
//   - aceptar pruebas siempre                                → falla "un webhook de prueba no aplica nada"
//   - no invalidar la caché al aplicar                       → falla "al aplicar un pago invalida la caché del panel"
//   - invalidar la caché siempre                             → falla "un webhook que no aplica nada… no invalida la caché"
//   - no invalidar la caché cuando el plan no cupo           → falla "si el plan no cupo, la caché también se invalida (el cobro sí quedó pagado)"

const SECRETO = 'secreto-de-prueba';
const CUENTA = '11111111-1111-4111-8111-111111111111';
const COBRO = '22222222-2222-4222-8222-222222222222';

const estado = vi.hoisted(() => ({ repo: null as unknown, avisos: [] as unknown[], revalidadas: [] as unknown[][] }));

vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => void estado.revalidadas.push(args) }));
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({}) }));
vi.mock('@/lib/comercios/repositorioPagosSupabase', () => ({ repositorioPagosSupabase: () => estado.repo }));
vi.mock('@/lib/marketing/conversionesMeta', () => ({
  notificarPagoAMeta: async (_s: unknown, pago: unknown) => void estado.avisos.push(pago),
}));
// `after` solo funciona dentro de una request de Next: acá ejecuta el callback en el momento.
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: (fn: () => unknown) => void fn(),
}));

const { POST } = await import('./route');

const cobro = (extra: Partial<CobroParaPago> = {}): CobroParaPago => ({
  id: COBRO, cuentaId: CUENTA, tipo: 'periodo', estado: 'pendiente', monto: 49, planDestino: 'growth', wompiIdTransaccion: null, ...extra,
});

const cuerpoWompi = (extra: Record<string, unknown> = {}) => ({
  IdTransaccion: 'tx-ruta-1',
  Monto: 49,
  EsProductiva: true,
  ResultadoTransaccion: 'ExitosaAprobada',
  EnlacePago: { Id: 66, IdentificadorEnlaceComercio: COBRO },
  ...extra,
});

function peticion(cuerpo: unknown, encabezados: Record<string, string> | 'firmado' = 'firmado'): NextRequest {
  const bytes = new TextEncoder().encode(JSON.stringify(cuerpo, null, 2));
  const headers = encabezados === 'firmado' ? { wompi_hash: firmaHmac(bytes, SECRETO) } : encabezados;
  return new NextRequest('https://www.cardly-sv.site/api/wompi/webhook', { method: 'POST', body: bytes, headers });
}

beforeEach(() => {
  estado.repo = new RepositorioPagosFalso(cobro());
  estado.avisos = [];
  estado.revalidadas = [];
  vi.stubEnv('WOMPI_CLIENT_ID', 'id-de-prueba');
  vi.stubEnv('WOMPI_CLIENT_SECRET', SECRETO);
  vi.stubEnv('WOMPI_ACEPTAR_PRUEBAS', '');
  vi.stubEnv('VERCEL_ENV', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/wompi/webhook', () => {
  it('acepta el webhook firmado en el header wompi_hash y aplica el pago', async () => {
    const res = await POST(peticion(cuerpoWompi()));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, conciliacion: 'aplicado' });
    expect((estado.repo as RepositorioPagosFalso).cobros.get(COBRO)?.estado).toBe('pagado');
  });

  it('la firma se calcula sobre los bytes: un cuerpo con formato distinto al re-serializado se acepta igual', async () => {
    // peticion() manda el JSON con sangría; si la ruta re-serializara, la firma no coincidiría.
    const res = await POST(peticion(cuerpoWompi()));
    expect(res.status).toBe(200);
  });

  it('un BOM inicial cuenta para la firma: se firma lo que Wompi mandó, no lo que `text()` devuelve', async () => {
    // `Request.text()` descarta un BOM UTF-8 inicial, y con él cambiarían los bytes firmados.
    const json = new TextEncoder().encode(JSON.stringify(cuerpoWompi()));
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...json]);
    const req = new NextRequest('https://www.cardly-sv.site/api/wompi/webhook', {
      method: 'POST', body: bytes, headers: { wompi_hash: firmaHmac(bytes, SECRETO) },
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, conciliacion: 'aplicado' });
  });

  it('avisa a Meta con el monto del cobro, una sola vez', async () => {
    await POST(peticion(cuerpoWompi()));
    expect(estado.avisos).toEqual([{ cuentaId: CUENTA, cobroId: COBRO, monto: 49 }]);
  });

  it('al aplicar un pago invalida la caché del panel, para que el dueño vea su plan y su cupo nuevos', async () => {
    await POST(peticion(cuerpoWompi()));
    expect(estado.revalidadas).toEqual([['/comercio', 'layout']]);
  });

  it('si el plan no cupo, la caché también se invalida (el cobro sí quedó pagado)', async () => {
    (estado.repo as RepositorioPagosFalso).resultadoPlan = { ok: false, motivo: 'cupo', error: 'La cuenta usa 3 unidades y el plan Starter permite 1.' };
    const res = await POST(peticion(cuerpoWompi()));
    expect(await res.json()).toEqual({ ok: true, conciliacion: 'plan_no_aplicable' });
    expect(estado.revalidadas).toEqual([['/comercio', 'layout']]);
  });

  it('un webhook que no aplica nada (prueba, firma inválida) no invalida la caché', async () => {
    await POST(peticion(cuerpoWompi({ EsProductiva: false })));
    await POST(peticion(cuerpoWompi(), { wompi_hash: 'a'.repeat(64) }));
    expect(estado.revalidadas).toEqual([]);
  });

  it('sin el header wompi_hash responde 401, y deja en el log SOLO los nombres de los headers', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await POST(peticion(cuerpoWompi(), { 'x-otro': 'valor-secreto' }));

    expect(res.status).toBe(401);
    const mensaje = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(mensaje).toContain('x-otro');
    expect(mensaje).not.toContain('valor-secreto');
  });

  it('con una firma inválida responde 401 y no toca nada', async () => {
    const res = await POST(peticion(cuerpoWompi(), { wompi_hash: 'a'.repeat(64) }));
    expect(res.status).toBe(401);
    expect((estado.repo as RepositorioPagosFalso).eventos.size).toBe(0);
  });

  it('sin WOMPI_CLIENT_SECRET responde 500 y no procesa', async () => {
    vi.stubEnv('WOMPI_CLIENT_SECRET', '');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await POST(peticion(cuerpoWompi()));
    expect(res.status).toBe(500);
    expect((estado.repo as RepositorioPagosFalso).eventos.size).toBe(0);
  });

  it('un webhook de prueba (EsProductiva falso) no aplica nada', async () => {
    const res = await POST(peticion(cuerpoWompi({ EsProductiva: false })));
    expect(await res.json()).toEqual({ ok: true, conciliacion: 'prueba' });
    expect((estado.repo as RepositorioPagosFalso).cobros.get(COBRO)?.estado).toBe('pendiente');
    expect(estado.avisos).toEqual([]);
  });

  it('con WOMPI_ACEPTAR_PRUEBAS=1 en desarrollo, la prueba sí aplica', async () => {
    vi.stubEnv('WOMPI_ACEPTAR_PRUEBAS', '1');
    const res = await POST(peticion(cuerpoWompi({ EsProductiva: false })));
    expect(await res.json()).toEqual({ ok: true, conciliacion: 'aplicado' });
  });

  it('pero con VERCEL_ENV=production la prueba NO aplica aunque el flag esté puesto', async () => {
    vi.stubEnv('WOMPI_ACEPTAR_PRUEBAS', '1');
    vi.stubEnv('VERCEL_ENV', 'production');
    const res = await POST(peticion(cuerpoWompi({ EsProductiva: false })));
    expect(await res.json()).toEqual({ ok: true, conciliacion: 'prueba' });
  });
});

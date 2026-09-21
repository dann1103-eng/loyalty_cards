import { describe, it, expect, vi, afterEach } from 'vitest';
import { RepositorioPagosFalso } from '@/test/fixtures/repositorioPagosFalso';
import type { CobroParaPago } from '../comercios/confirmarPago';
import { firmaHmac } from './firma';
import { procesarWebhook, type EntradaWebhook } from './procesarWebhook';

// MUTATION-TESTING (cada fila se corrió: romper, ver fallar con ESE test, restaurar):
//   - firmar el JSON re-serializado y no los bytes recibidos → fallan "la firma se calcula sobre los bytes tal cual llegaron" y otras cuatro
//   - aceptar un webhook sin firma                          → fallan "sin firma o con firma inválida: 401…" y "un cuerpo alterado después de firmar es 401"
//   - responder 500 a un cuerpo irreconocible               → fallan "se guarda y se responde 200…" y "un cuerpo que no es JSON se guarda como texto crudo"
//   - no guardar el cuerpo irreconocible                    → fallan esas dos y "el mismo cuerpo reintentado no duplica el evento"
//   - dejar que una falla interna responda 200              → falla "una falla interna responde 500 para que Wompi reintente…"
//   - ignorar EsProductiva                                  → falla "un webhook de prueba (EsProductiva falso) no aplica nada"
//   - tratar una declinada como aprobada                    → falla "una transacción declinada no se aplica"

const SECRETO = 'secreto-de-prueba';
const CUENTA = '11111111-1111-4111-8111-111111111111';
const COBRO = '22222222-2222-4222-8222-222222222222';
const HOY = '2026-09-15';

const cobro = (extra: Partial<CobroParaPago> = {}): CobroParaPago => ({
  id: COBRO, cuentaId: CUENTA, tipo: 'periodo', estado: 'pendiente', monto: 49, planDestino: 'growth', wompiIdTransaccion: null, ...extra,
});

const cuerpoWompi = (extra: Record<string, unknown> = {}) => ({
  IdTransaccion: 'tx-1',
  Monto: 49,
  EsProductiva: true,
  ResultadoTransaccion: 'ExitosaAprobada',
  FechaTransaccion: '2026-09-15T18:00:00-06:00',
  EnlacePago: { Id: 66, IdentificadorEnlaceComercio: COBRO },
  ...extra,
});

// Con espacios y saltos de línea a propósito: si la ruta re-serializara el JSON, la firma dejaría de coincidir.
const bytesDe = (objeto: unknown) => new TextEncoder().encode(JSON.stringify(objeto, null, 2));

function entrada(cuerpo: Uint8Array, extra: Partial<EntradaWebhook> = {}): EntradaWebhook {
  return { cuerpo, firma: firmaHmac(cuerpo, SECRETO), secreto: SECRETO, aceptarPruebas: false, hoy: HOY, ...extra };
}

afterEach(() => vi.restoreAllMocks());

describe('firma', () => {
  it('la firma se calcula sobre los bytes tal cual llegaron', async () => {
    const repo = new RepositorioPagosFalso(cobro());
    const r = await procesarWebhook(repo, entrada(bytesDe(cuerpoWompi())));
    expect(r).toEqual({ estado: 200, cuerpo: { ok: true, conciliacion: 'aplicado' } });
    expect(repo.cobros.get(COBRO)?.estado).toBe('pagado');
  });

  it('un BOM inicial no rompe: la firma cubre los bytes y el JSON se parsea sin el BOM', async () => {
    const sinBom = bytesDe(cuerpoWompi());
    const conBom = new Uint8Array([0xef, 0xbb, 0xbf, ...sinBom]);
    const repo = new RepositorioPagosFalso(cobro());
    const r = await procesarWebhook(repo, entrada(conBom));
    expect(r.estado).toBe(200);
    expect(r.cuerpo.conciliacion).toBe('aplicado');
  });

  it('sin firma o con firma inválida: 401 y no se guarda nada', async () => {
    const repo = new RepositorioPagosFalso(cobro());
    const bytes = bytesDe(cuerpoWompi());
    for (const firma of [null, '', 'abc', firmaHmac(bytes, 'otro-secreto')]) {
      const r = await procesarWebhook(repo, { ...entrada(bytes), firma });
      expect(r).toEqual({ estado: 401, cuerpo: { ok: false, error: 'Firma inválida' } });
    }
    expect(repo.eventos.size).toBe(0);
    expect(repo.cobros.get(COBRO)?.estado).toBe('pendiente');
  });

  it('un cuerpo alterado después de firmar es 401', async () => {
    const original = bytesDe(cuerpoWompi());
    const alterado = bytesDe(cuerpoWompi({ Monto: 1 }));
    const repo = new RepositorioPagosFalso(cobro());
    const r = await procesarWebhook(repo, { ...entrada(alterado), firma: firmaHmac(original, SECRETO) });
    expect(r.estado).toBe(401);
  });
});

describe('cuerpo irreconocible con firma válida', () => {
  it('se guarda y se responde 200, para que Wompi no reintente para siempre', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const repo = new RepositorioPagosFalso(cobro());
    const bytes = new TextEncoder().encode(JSON.stringify({ transaccion: 'formato nuevo', total: 49 }));

    const r = await procesarWebhook(repo, entrada(bytes));

    expect(r).toEqual({ estado: 200, cuerpo: { ok: true, conciliacion: 'error' } });
    const [evento] = [...repo.eventos.values()];
    expect(evento.idTransaccion).toMatch(/^sin-id-[0-9a-f]{24}$/);
    expect(evento.conciliacion).toBe('error');
    expect(evento.detalle).toContain('Cuerpo no reconocido');
    expect(evento.payload).toEqual({ transaccion: 'formato nuevo', total: 49 });
    expect(repo.cobros.get(COBRO)?.estado).toBe('pendiente');
  });

  it('el mismo cuerpo reintentado no duplica el evento', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const repo = new RepositorioPagosFalso(cobro());
    const bytes = new TextEncoder().encode('{"algo":1}');
    await procesarWebhook(repo, entrada(bytes));
    await procesarWebhook(repo, entrada(bytes));
    expect(repo.eventos.size).toBe(1);
  });

  it('un cuerpo que no es JSON se guarda como texto crudo', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const repo = new RepositorioPagosFalso(cobro());
    const r = await procesarWebhook(repo, entrada(new TextEncoder().encode('esto no es json')));
    expect(r.estado).toBe(200);
    expect([...repo.eventos.values()][0].payload).toEqual({ cuerpoCrudo: 'esto no es json' });
  });

  it('un cuerpo al que le falta EsProductiva se guarda: no se asume si la plata es real', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const repo = new RepositorioPagosFalso(cobro());
    const r = await procesarWebhook(repo, entrada(bytesDe(cuerpoWompi({ EsProductiva: undefined }))));
    expect(r.cuerpo.conciliacion).toBe('error');
    expect(repo.cobros.get(COBRO)?.estado).toBe('pendiente');
  });
});

describe('qué se aplica', () => {
  it('un webhook de prueba (EsProductiva falso) no aplica nada', async () => {
    const repo = new RepositorioPagosFalso(cobro());
    const r = await procesarWebhook(repo, entrada(bytesDe(cuerpoWompi({ EsProductiva: false }))));
    expect(r.cuerpo.conciliacion).toBe('prueba');
    expect(repo.cobros.get(COBRO)?.estado).toBe('pendiente');
  });

  it('con las pruebas aceptadas (solo desarrollo) sí aplica', async () => {
    const repo = new RepositorioPagosFalso(cobro());
    const r = await procesarWebhook(repo, entrada(bytesDe(cuerpoWompi({ EsProductiva: false })), { aceptarPruebas: true }));
    expect(r.cuerpo.conciliacion).toBe('aplicado');
  });

  it('una transacción declinada no se aplica', async () => {
    const repo = new RepositorioPagosFalso(cobro());
    const r = await procesarWebhook(repo, entrada(bytesDe(cuerpoWompi({ ResultadoTransaccion: 'ExitosaDeclinada' }))));
    expect(r.cuerpo.conciliacion).toBe('no_aprobada');
    expect(repo.cobros.get(COBRO)?.estado).toBe('pendiente');
  });

  it('un enlace hecho a mano en el panel de Wompi (sin cobro de la app) queda como sin_cobro, con 200', async () => {
    const repo = new RepositorioPagosFalso(cobro());
    const cuerpo = cuerpoWompi({ EnlacePago: { Id: 7, IdentificadorEnlaceComercio: 'OC1234' } });
    const r = await procesarWebhook(repo, entrada(bytesDe(cuerpo)));
    expect(r).toEqual({ estado: 200, cuerpo: { ok: true, conciliacion: 'sin_cobro' } });
  });

  it('el mismo webhook dos veces se procesa una vez y avisa a Meta una vez', async () => {
    const repo = new RepositorioPagosFalso(cobro());
    const avisos: CobroParaPago[] = [];
    const alReclamar = (c: CobroParaPago) => void avisos.push(c);
    const bytes = bytesDe(cuerpoWompi());
    await procesarWebhook(repo, entrada(bytes, { alReclamar }));
    const segundo = await procesarWebhook(repo, entrada(bytes, { alReclamar }));
    expect(segundo).toEqual({ estado: 200, cuerpo: { ok: true, conciliacion: 'aplicado' } });
    expect(avisos).toHaveLength(1);
  });
});

describe('fallas', () => {
  it('una falla interna responde 500 para que Wompi reintente, y el reintento funciona', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const repo = new RepositorioPagosFalso(cobro(), { aplicarPlan: 1 });
    const bytes = bytesDe(cuerpoWompi());

    const primero = await procesarWebhook(repo, entrada(bytes));
    expect(primero).toEqual({ estado: 500, cuerpo: { ok: false, error: 'Falla interna' } });

    const reintento = await procesarWebhook(repo, entrada(bytes));
    expect(reintento).toEqual({ estado: 200, cuerpo: { ok: true, conciliacion: 'aplicado' } });
  });
});

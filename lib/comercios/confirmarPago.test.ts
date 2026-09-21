import { describe, it, expect } from 'vitest';
import { RepositorioPagosFalso, type Fallos } from '@/test/fixtures/repositorioPagosFalso';
import { confirmarPagoCobro, type CobroParaPago, type EntradaPago } from './confirmarPago';

// La lógica se prueba con un repositorio FALSO en memoria (test/fixtures/repositorioPagosFalso.ts). Lo que
// hay que cuidar es que el falso tenga la MISMA semántica que la base (`reclamarCobro` es atómico y
// condicional); el adaptador real se prueba contra Supabase en repositorioPagosSupabase.test.ts.
//
// MUTATION-TESTING (cada fila se corrió: romper, ver fallar con ESE test, restaurar):
//   - reclamar el cobro ANTES de aplicar el plan          → falla "el servicio va antes que el pago" (y otras cuatro)
//   - reclamar sin exigir estado pendiente                → fallan "una segunda transacción…", "dos llamadas simultáneas…" y "un reintento propio…"
//   - no comparar `wompiIdTransaccion` en el reintento    → fallan "dos llamadas simultáneas…" y "un reintento propio…" (queda ya_pagado)
//   - tratar toda repetición como reintento propio        → falla "una segunda transacción para el mismo cobro es ya_pagado"
//   - ignorar `esReal`                                    → falla "un pago de prueba no aplica nada"
//   - quitar la comparación del monto                     → fallan "un monto distinto no se aplica", "un centavo de diferencia…" y "reprocesa un evento…"
//   - comparar el monto sin centavos enteros              → falla "un centavo de diferencia es otro monto, y un desvío de punto flotante es el mismo"
//   - quitar la validación de UUID                        → falla "un identificador que no es UUID es sin_cobro y NO consulta la base"
//   - avisar a Meta también en un ajuste                  → falla "un ajuste pasa su tipo al aplicar el plan y no dispara Meta"
//   - avisar a Meta aunque no haya reclamado              → fallan "dos llamadas simultáneas…" y "un reintento propio (…) NO vuelve a avisar a Meta"
//   - quitar el atajo de eventos ya resueltos             → falla "un evento ya resuelto no se reprocesa"
//   - tratar plan_no_aplicable como aplicado              → falla "si el plan ya no cabe…"
//   - no lanzar cuando aplicarPlan falla de verdad        → falla "una falla interna al aplicar el plan se lanza…"
//   - aplicar un pago a un cobro anulado                  → falla "un cobro anulado no se aplica"
//   - forzar no revive un cobro anulado                   → falla "revive un cobro anulado"

const CUENTA = '11111111-1111-4111-8111-111111111111';
const COBRO = '22222222-2222-4222-8222-222222222222';
const HOY = '2026-09-15';

const cobroBase = (extra: Partial<CobroParaPago> = {}): CobroParaPago => ({
  id: COBRO,
  cuentaId: CUENTA,
  tipo: 'periodo',
  estado: 'pendiente',
  monto: 49,
  planDestino: 'growth',
  wompiIdTransaccion: null,
  ...extra,
});

// El repositorio falso vive en test/fixtures (lo comparten varias pruebas). Acá arranca con un cobro
// pendiente de $49 hacia Growth, que es el caso de casi todas.
class RepoFalso extends RepositorioPagosFalso {
  constructor(cobro: CobroParaPago | null = cobroBase(), fallos: Fallos = {}) {
    super(cobro, fallos);
  }
}

const pago = (extra: Partial<EntradaPago> = {}): EntradaPago => ({
  fuente: 'webhook',
  idTransaccion: 'tx-1',
  monto: 49,
  esReal: true,
  aprobada: true,
  identificadorEnlace: COBRO,
  fecha: '2026-09-15T18:00:00.000Z',
  payload: { IdTransaccion: 'tx-1' },
  ...extra,
});

function conMeta() {
  const avisos: CobroParaPago[] = [];
  return { avisos, opciones: { aceptarPruebas: false, hoy: HOY, alReclamar: (c: CobroParaPago) => void avisos.push(c) } };
}

const conciliacionDe = (repo: RepoFalso) => repo.conciliaciones();

describe('el camino feliz', () => {
  it('aplica el plan y la licencia, paga el cobro, avisa a Meta UNA vez y deja el evento en aplicado', async () => {
    const repo = new RepoFalso();
    const { avisos, opciones } = conMeta();

    const r = await confirmarPagoCobro(repo, pago(), opciones);

    expect(r).toEqual({ conciliacion: 'aplicado', repetido: false, detalle: null });
    expect(repo.planesAplicados).toEqual([{ cuentaId: CUENTA, plan: 'growth', tipo: 'periodo' }]);
    expect(repo.licencias).toEqual([CUENTA]);
    expect(repo.cobros.get(COBRO)).toMatchObject({ estado: 'pagado', wompiIdTransaccion: 'tx-1' });
    expect(avisos).toHaveLength(1);
    expect(conciliacionDe(repo)).toEqual(['aplicado']);
    expect([...repo.eventos.values()][0].cobroId).toBe(COBRO);
  });

  it('el servicio va antes que el pago: se aplica el plan ANTES de reclamar el cobro', async () => {
    const repo = new RepoFalso();
    await confirmarPagoCobro(repo, pago(), conMeta().opciones);
    expect(repo.llamadas).toEqual(['aplicarPlan', 'reclamarCobro']);
  });

  it('un ajuste pasa su tipo al aplicar el plan y no dispara Meta', async () => {
    const repo = new RepoFalso(cobroBase({ tipo: 'ajuste', monto: 10.67 }));
    const { avisos, opciones } = conMeta();
    const r = await confirmarPagoCobro(repo, pago({ monto: 10.67 }), opciones);
    expect(r.conciliacion).toBe('aplicado');
    expect(repo.planesAplicados[0].tipo).toBe('ajuste');
    expect(avisos).toHaveLength(0);
  });

  it('un cobro sin plan destino solo activa la licencia', async () => {
    const repo = new RepoFalso(cobroBase({ planDestino: null }));
    const r = await confirmarPagoCobro(repo, pago(), conMeta().opciones);
    expect(r.conciliacion).toBe('aplicado');
    expect(repo.planesAplicados).toEqual([]);
    expect(repo.licencias).toEqual([CUENTA]);
  });
});

describe('idempotencia', () => {
  it('un evento ya resuelto no se reprocesa: se devuelve lo guardado', async () => {
    const repo = new RepoFalso();
    const { avisos, opciones } = conMeta();
    await confirmarPagoCobro(repo, pago(), opciones);
    const r = await confirmarPagoCobro(repo, pago(), opciones);

    expect(r).toEqual({ conciliacion: 'aplicado', repetido: true, detalle: null });
    expect(repo.planesAplicados).toHaveLength(1);
    expect(avisos).toHaveLength(1);
  });

  it('una segunda transacción para el mismo cobro es ya_pagado, y no vuelve a avisar a Meta', async () => {
    const repo = new RepoFalso();
    const { avisos, opciones } = conMeta();
    await confirmarPagoCobro(repo, pago({ idTransaccion: 'tx-1' }), opciones);
    const r = await confirmarPagoCobro(repo, pago({ idTransaccion: 'tx-2' }), opciones);

    expect(r.conciliacion).toBe('ya_pagado');
    expect(repo.cobros.get(COBRO)?.wompiIdTransaccion).toBe('tx-1');
    expect(avisos).toHaveLength(1);
    expect(conciliacionDe(repo)).toEqual(['aplicado', 'ya_pagado']);
  });

  it('dos llamadas simultáneas de la MISMA transacción reclaman una sola vez', async () => {
    const repo = new RepoFalso();
    const { avisos, opciones } = conMeta();
    const [a, b] = await Promise.all([
      confirmarPagoCobro(repo, pago(), opciones),
      confirmarPagoCobro(repo, pago(), opciones),
    ]);
    expect([a.conciliacion, b.conciliacion]).toEqual(['aplicado', 'aplicado']);
    expect(avisos).toHaveLength(1);
    expect(repo.cobros.get(COBRO)?.estado).toBe('pagado');
  });
});

describe('reintentos tras una falla a medias', () => {
  it('si falla al aplicar el plan: evento en error, el cobro sigue pendiente, y el reintento lo completa', async () => {
    const repo = new RepoFalso(cobroBase(), { aplicarPlan: 1 });
    const { avisos, opciones } = conMeta();

    await expect(confirmarPagoCobro(repo, pago(), opciones)).rejects.toThrow('se cayó la base al aplicar el plan');
    expect(conciliacionDe(repo)).toEqual(['error']);
    expect(repo.cobros.get(COBRO)?.estado).toBe('pendiente');
    expect(avisos).toHaveLength(0);

    const r = await confirmarPagoCobro(repo, pago(), opciones);
    expect(r.conciliacion).toBe('aplicado');
    expect(repo.cobros.get(COBRO)?.estado).toBe('pagado');
    expect(avisos).toHaveLength(1);
  });

  it('si falla al reclamar (el plan ya se aplicó): el reintento reaplica el plan, reclama y avisa una vez', async () => {
    const repo = new RepoFalso(cobroBase(), { reclamarCobro: 1 });
    const { avisos, opciones } = conMeta();

    await expect(confirmarPagoCobro(repo, pago(), opciones)).rejects.toThrow('reclamar');
    expect(repo.planesAplicados).toHaveLength(1);
    expect(repo.cobros.get(COBRO)?.estado).toBe('pendiente');

    await confirmarPagoCobro(repo, pago(), opciones);
    expect(repo.planesAplicados).toHaveLength(2); // idempotente: aplicar dos veces el mismo plan no cambia nada
    expect(repo.cobros.get(COBRO)?.estado).toBe('pagado');
    expect(avisos).toHaveLength(1);
  });

  it('un reintento propio (el cobro ya lo pagó ESTA transacción) se completa y NO vuelve a avisar a Meta', async () => {
    // El reclamo funcionó pero se cayó la base al guardar el resultado del evento.
    const repo = new RepoFalso(cobroBase(), { actualizarEventoFinal: 1 });
    const { avisos, opciones } = conMeta();

    await expect(confirmarPagoCobro(repo, pago(), opciones)).rejects.toThrow('guardar el resultado');
    expect(repo.cobros.get(COBRO)).toMatchObject({ estado: 'pagado', wompiIdTransaccion: 'tx-1' });
    expect(avisos).toHaveLength(1);

    const r = await confirmarPagoCobro(repo, pago(), opciones);
    expect(r.conciliacion).toBe('aplicado'); // no 'ya_pagado': la pagó ella misma
    expect(avisos).toHaveLength(1); // Meta no se cuenta dos veces
  });

  it('una falla interna al aplicar el plan se lanza (Wompi reintenta), no se traga', async () => {
    const repo = new RepoFalso();
    repo.resultadoPlan = { ok: false, motivo: 'error', error: 'No se pudo cambiar el plan.' };
    await expect(confirmarPagoCobro(repo, pago(), conMeta().opciones)).rejects.toThrow('No se pudo cambiar el plan.');
    expect(repo.cobros.get(COBRO)?.estado).toBe('pendiente');
    expect(conciliacionDe(repo)).toEqual(['error']);
  });
});

describe('qué NO se aplica', () => {
  const sinEfectos = (repo: RepoFalso) => {
    expect(repo.planesAplicados).toEqual([]);
    expect(repo.licencias).toEqual([]);
    expect(repo.cobros.get(COBRO)?.estado).toBe('pendiente');
  };

  it('un pago de prueba no aplica nada', async () => {
    const repo = new RepoFalso();
    const r = await confirmarPagoCobro(repo, pago({ esReal: false }), conMeta().opciones);
    expect(r.conciliacion).toBe('prueba');
    sinEfectos(repo);
  });

  it('con las pruebas aceptadas (solo desarrollo) un pago de prueba SÍ aplica', async () => {
    const repo = new RepoFalso();
    const { opciones } = conMeta();
    const r = await confirmarPagoCobro(repo, pago({ esReal: false }), { ...opciones, aceptarPruebas: true });
    expect(r.conciliacion).toBe('aplicado');
  });

  it('un resultado que no es aprobado no aplica nada', async () => {
    const repo = new RepoFalso();
    const r = await confirmarPagoCobro(repo, pago({ aprobada: false }), conMeta().opciones);
    expect(r.conciliacion).toBe('no_aprobada');
    sinEfectos(repo);
  });

  it('un monto distinto no se aplica', async () => {
    const repo = new RepoFalso();
    const r = await confirmarPagoCobro(repo, pago({ monto: 29 }), conMeta().opciones);
    expect(r.conciliacion).toBe('monto_distinto');
    expect(r.detalle).toContain('29');
    sinEfectos(repo);
  });

  it('un centavo de diferencia es otro monto, y un desvío de punto flotante es el mismo', async () => {
    const distinto = new RepoFalso(cobroBase({ monto: 10.67 }));
    expect((await confirmarPagoCobro(distinto, pago({ monto: 10.66 }), conMeta().opciones)).conciliacion).toBe('monto_distinto');
    // Se compara en centavos enteros: 0.1 + 0.2 vale 0.30000000000000004 en punto flotante.
    const igual = new RepoFalso(cobroBase({ monto: 0.3 }));
    expect((await confirmarPagoCobro(igual, pago({ monto: 0.1 + 0.2 }), conMeta().opciones)).conciliacion).toBe('aplicado');
  });

  it('un cobro anulado no se aplica', async () => {
    const repo = new RepoFalso(cobroBase({ estado: 'anulado' }));
    const r = await confirmarPagoCobro(repo, pago(), conMeta().opciones);
    expect(r.conciliacion).toBe('cobro_anulado');
    expect(repo.planesAplicados).toEqual([]);
    expect(repo.cobros.get(COBRO)?.estado).toBe('anulado');
  });

  it('un identificador que no es UUID es sin_cobro y NO consulta la base', async () => {
    const repo = new RepoFalso();
    for (const identificador of ['OC1234', '', 'test-link', null]) {
      const r = await confirmarPagoCobro(repo, pago({ idTransaccion: `tx-${identificador}`, identificadorEnlace: identificador }), conMeta().opciones);
      expect(r.conciliacion).toBe('sin_cobro');
    }
    expect(repo.consultasDeCobro).toEqual([]);
  });

  it('un UUID que no es un cobro es sin_cobro', async () => {
    const repo = new RepoFalso(null);
    const r = await confirmarPagoCobro(repo, pago(), conMeta().opciones);
    expect(r.conciliacion).toBe('sin_cobro');
    expect(repo.consultasDeCobro).toEqual([COBRO]);
  });
});

describe('cuando la plata entró pero el plan ya no cabe', () => {
  it('si el plan ya no cabe: el cobro queda pagado, la licencia activa, el evento en plan_no_aplicable, y Meta avisa', async () => {
    const repo = new RepoFalso();
    repo.resultadoPlan = { ok: false, motivo: 'cupo', error: 'La cuenta usa 3 unidades y el plan Starter permite 1.' };
    const { avisos, opciones } = conMeta();

    const r = await confirmarPagoCobro(repo, pago(), opciones);

    expect(r).toEqual({ conciliacion: 'plan_no_aplicable', repetido: false, detalle: 'La cuenta usa 3 unidades y el plan Starter permite 1.' });
    expect(repo.cobros.get(COBRO)?.estado).toBe('pagado');
    expect(repo.licencias).toEqual([CUENTA]);
    expect(avisos).toHaveLength(1);
  });
});

describe('las acciones de FM a mano (forzar)', () => {
  it('acepta un monto distinto', async () => {
    const repo = new RepoFalso();
    const r = await confirmarPagoCobro(repo, pago({ fuente: 'manual', monto: 29, forzar: true }), conMeta().opciones);
    expect(r.conciliacion).toBe('aplicado');
    expect(repo.cobros.get(COBRO)?.estado).toBe('pagado');
  });

  it('revive un cobro anulado', async () => {
    const repo = new RepoFalso(cobroBase({ estado: 'anulado' }));
    const r = await confirmarPagoCobro(repo, pago({ fuente: 'manual', forzar: true }), conMeta().opciones);
    expect(r.conciliacion).toBe('aplicado');
    expect(repo.cobros.get(COBRO)?.estado).toBe('pagado');
  });

  it('reprocesa un evento que ya estaba resuelto como monto_distinto', async () => {
    const repo = new RepoFalso();
    const { opciones } = conMeta();
    expect((await confirmarPagoCobro(repo, pago({ monto: 29 }), opciones)).conciliacion).toBe('monto_distinto');
    const r = await confirmarPagoCobro(repo, pago({ monto: 29, fuente: 'manual', forzar: true }), opciones);
    expect(r.conciliacion).toBe('aplicado');
    expect(r.repetido).toBe(false);
  });
});

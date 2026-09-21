import { describe, it, expect } from 'vitest';
import { calcularOpcionesPago, type CuentaParaPagos } from './opcionesPago';

// Pruebas PURAS. Se corren con TZ=UTC y con TZ=America/El_Salvador.
//
// MUTATION-TESTING (cada fila se corrió: romper, ver fallar con ESE test, restaurar):
//   - ofrecer también el ajuste dentro de la ventana      → fallan "con 7 días restantes solo se renueva…" y otras cinco de la ventana
//   - ofrecer renovar cuando ya está renovado             → falla "ya renovado no ofrece nada…"
//   - usar el precio del catálogo al renovar el mismo plan → falla "renovar el mismo plan respeta el precio negociado…"
//   - quitar el bloqueo por cupo                          → fallan "bajar a un plan que no le cabe…", "una cuenta sin tope que baja…" y "no puede elegir Starter con 3 unidades…"
//   - ofrecer el ajuste hacia el mismo plan o uno menor   → falla "un precio negociado se prorratea contra el precio real" (Starter → Starter ya caía en "sin diferencia", así que solo un precio negociado lo delata)
//   - prorratear contra el precio del catálogo            → fallan "un precio negociado se prorratea…" y "un precio negociado igual o mayor…"

const SEP = { desde: '2026-09-01', hasta: '2026-09-30' };
const OCT = { desde: '2026-10-01', hasta: '2026-10-31' };

const cuenta = (extra: Partial<CuentaParaPagos> = {}): CuentaParaPagos => ({
  plan: 'starter',
  precioActual: 29,
  limite: 1,
  unidadesUsadas: 1,
  periodosPagados: [SEP],
  ...extra,
});

const resumen = (c: CuentaParaPagos, hoy: string) =>
  calcularOpcionesPago(c, hoy).opciones.map((o) => `${o.accion}:${o.plan}:${o.tipo}:${o.monto}`);

describe('sin período', () => {
  it('un piloto sin plan ni cobros elige cualquier plan al precio completo, desde hoy', () => {
    const r = calcularOpcionesPago(cuenta({ plan: null, precioActual: null, limite: null, periodosPagados: [] }), '2026-09-15');
    expect(r.estado).toEqual({ tipo: 'sin_periodo' });
    expect(r.opciones.map((o) => [o.accion, o.plan, o.tipo, o.monto, o.periodoDesde, o.periodoHasta])).toEqual([
      ['activar', 'starter', 'periodo', 29, '2026-09-15', '2026-10-14'],
      ['activar', 'growth', 'periodo', 49, '2026-09-15', '2026-10-14'],
      ['activar', 'pro', 'periodo', 89, '2026-09-15', '2026-10-14'],
    ]);
    expect(r.proximoPago).toBeNull();
  });

  it('un período vencido cuenta como sin período: el nuevo arranca hoy, no en el pasado', () => {
    const r = calcularOpcionesPago(cuenta(), '2026-10-05');
    expect(r.opciones[0]).toMatchObject({ accion: 'activar', periodoDesde: '2026-10-05', periodoHasta: '2026-11-04' });
  });
});

describe('a mitad de período', () => {
  it('solo se ofrece SUBIR, con prorrateo, y el período no cambia', () => {
    const r = calcularOpcionesPago(cuenta(), '2026-09-15');
    expect(resumen(cuenta(), '2026-09-15')).toEqual(['cambiar:growth:ajuste:10.67', 'cambiar:pro:ajuste:32']);
    expect(r.opciones[0]).toMatchObject({
      periodoDesde: '2026-09-15',
      periodoHasta: '2026-09-30',
      nota: 'Starter → Growth, 16 de 30 días',
      reiniciaPrecio: false,
      bloqueadaPor: null,
    });
    expect(r.proximoPago).toBe('2026-10-01');
  });

  it('en el plan más alto no hay nada que subir, y no es un aviso', () => {
    const pro = cuenta({ plan: 'pro', precioActual: 89, limite: 10 });
    const r = calcularOpcionesPago(pro, '2026-09-15');
    expect(r.opciones).toEqual([]);
    expect(r.aviso).toBeNull();
  });

  it('un precio negociado se prorratea contra el precio real de la cuenta', () => {
    // Starter negociado a $20: Growth cuesta 29 más, no 20 más.
    expect(resumen(cuenta({ precioActual: 20 }), '2026-09-15')).toEqual(['cambiar:growth:ajuste:15.47', 'cambiar:pro:ajuste:36.8']);
  });

  it('un precio negociado igual o mayor al del destino no ofrece ese ajuste, y el resto sí', () => {
    // Growth negociado a $90: no hay diferencia a favor de Pro ($89) ni de Growth.
    const c = cuenta({ plan: 'growth', precioActual: 90, limite: 3 });
    expect(resumen(c, '2026-09-15')).toEqual([]);
  });

  it('un ajuste sobre un precio negociado avisa que reinicia el precio', () => {
    const r = calcularOpcionesPago(cuenta({ precioActual: 20 }), '2026-09-15');
    expect(r.opciones.every((o) => o.reiniciaPrecio)).toBe(true);
  });

  it('un período que no es mensual, o una cuenta con período pero sin plan, manda a escribir', () => {
    const trimestre = cuenta({ periodosPagados: [{ desde: '2026-07-01', hasta: '2026-09-30' }] });
    expect(calcularOpcionesPago(trimestre, '2026-08-15')).toMatchObject({ opciones: [], aviso: expect.stringContaining('no es mensual') });
    const sinPlan = cuenta({ plan: null, precioActual: null });
    expect(calcularOpcionesPago(sinPlan, '2026-09-15')).toMatchObject({ opciones: [], aviso: expect.stringContaining('Escribinos') });
  });

  it('con 8 días restantes todavía es mitad de período', () => {
    expect(resumen(cuenta(), '2026-09-23')).toEqual(['cambiar:growth:ajuste:5.33', 'cambiar:pro:ajuste:16']);
  });
});

describe('en la ventana de renovación', () => {
  it('con 7 días restantes solo se renueva, y nunca se ofrece un ajuste', () => {
    const r = calcularOpcionesPago(cuenta(), '2026-09-24');
    expect(r.opciones.map((o) => `${o.accion}:${o.plan}:${o.tipo}`)).toEqual([
      'renovar:starter:periodo',
      'renovar:growth:periodo',
      'renovar:pro:periodo',
    ]);
    expect(r.opciones[0]).toMatchObject({ periodoDesde: '2026-10-01', periodoHasta: '2026-10-31', monto: 29 });
    expect(r.proximoPago).toBe('2026-10-01');
  });

  it('el último día también se renueva, sin ajuste de $0.67', () => {
    expect(resumen(cuenta(), '2026-09-30')).toEqual(['renovar:starter:periodo:29', 'renovar:growth:periodo:49', 'renovar:pro:periodo:89']);
  });

  it('renovar el mismo plan respeta el precio negociado; cambiar de plan cobra el catálogo y avisa', () => {
    const r = calcularOpcionesPago(cuenta({ precioActual: 20 }), '2026-09-26');
    expect(r.opciones[0]).toMatchObject({ plan: 'starter', monto: 20, reiniciaPrecio: false });
    expect(r.opciones[1]).toMatchObject({ plan: 'growth', monto: 49, reiniciaPrecio: true });
  });

  it('un precio negociado en $0 (mes regalado) renueva al precio del catálogo', () => {
    expect(calcularOpcionesPago(cuenta({ precioActual: 0 }), '2026-09-26').opciones[0]).toMatchObject({ plan: 'starter', monto: 29 });
  });

  it('bajar a un plan que no le cabe queda bloqueado, con el mensaje de cuánto usa', () => {
    const c = cuenta({ plan: 'growth', precioActual: 49, limite: 3, unidadesUsadas: 3 });
    const r = calcularOpcionesPago(c, '2026-09-26');
    const starter = r.opciones.find((o) => o.plan === 'starter');
    expect(starter?.bloqueadaPor).toBe('Tu cuenta usa 3 unidades y el plan Starter permite 1. Desactivá negocios o sucursales antes de elegirlo.');
    expect(r.opciones.find((o) => o.plan === 'growth')?.bloqueadaPor).toBeNull();
    expect(r.opciones.find((o) => o.plan === 'pro')?.bloqueadaPor).toBeNull();
  });

  it('una cuenta sin tope que baja a un plan con tope también queda bloqueada', () => {
    const c = cuenta({ plan: 'growth', precioActual: 49, limite: null, unidadesUsadas: 2 });
    expect(calcularOpcionesPago(c, '2026-09-26').opciones.find((o) => o.plan === 'starter')?.bloqueadaPor).toContain('permite 1');
  });
});

describe('sin período, con un piloto que ya usa más de lo que cabe en un plan chico', () => {
  it('no puede elegir Starter con 3 unidades, pero sí Growth', () => {
    const piloto = cuenta({ plan: null, precioActual: null, limite: null, unidadesUsadas: 3, periodosPagados: [] });
    const r = calcularOpcionesPago(piloto, '2026-09-15');
    expect(r.opciones.map((o) => [o.plan, o.bloqueadaPor === null])).toEqual([
      ['starter', false],
      ['growth', true],
      ['pro', true],
    ]);
  });
});

describe('ya renovado, futuro y no mensual', () => {
  it('ya renovado no ofrece nada y dice cuándo es el próximo pago', () => {
    const r = calcularOpcionesPago(cuenta({ periodosPagados: [SEP, OCT] }), '2026-09-26');
    expect(r.opciones).toEqual([]);
    expect(r.aviso).toContain('Ya pagaste el próximo período');
    expect(r.proximoPago).toBe('2026-11-01');
  });

  it('un período pagado que todavía no empezó, sin ninguno vigente, no ofrece nada', () => {
    const r = calcularOpcionesPago(cuenta({ periodosPagados: [OCT] }), '2026-09-15');
    expect(r.opciones).toEqual([]);
    expect(r.aviso).toBe('Tu próximo período ya está pagado.');
    expect(r.proximoPago).toBe('2026-10-01');
  });
});

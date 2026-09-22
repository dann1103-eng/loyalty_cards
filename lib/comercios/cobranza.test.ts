import { describe, it, expect } from 'vitest';
import { DIAS_GRACIA_COBRANZA, estadoDeCobranza, periodoAPerdonar } from './cobranza';

// Pruebas PURAS: sin base de datos, sin reloj. Se corren con TZ=UTC y con TZ=America/El_Salvador
// (misma convención que prorrateo.test.ts: la aritmética de fechas usa Date.UTC).
//
// MUTATION-TESTING (cada fila se corrió: romper, ver fallar con ESE test, restaurar):
//   - no distinguir 'exenta' primero (se evalúa después de posponer/vencimiento)
//       → falla "exenta con fechas vencidas igual da exenta"
//   - posponer exclusivo (`hoy < pospuestaHasta` en vez de `<=`)
//       → falla "el último día de la posposición todavía no bloquea"
//   - el día 15 exacto bloquea (debería ser vencida: `diasVencida < DIAS_GRACIA_COBRANZA`)
//       → falla "15 días exactos: vencida, no bloqueada"
//   - el día 16 no bloquea (debería ser bloqueada: `diasVencida <= DIAS_GRACIA_COBRANZA + 1`)
//       → falla "16 días: bloqueada"
//   - vencimiento tomado siempre de `desde`, ignorando `cubiertoHasta` cuando SÍ hay períodos pagados
//       → fallan 5: "15 días exactos: vencida, no bloqueada", "16 días: bloqueada", "pasada la
//         posposición vuelve la regla normal…", "una cuenta que ya pagó antes cuenta desde el
//         último período, no desde cobranza_desde" y (indirectamente) el resto que reusa `entradaBase.desde`
//   - `cubiertoHasta` calculado pasando por `estadoDelPeriodo` (que lo vacía justo en vencida/bloqueada,
//     porque esa función filtra `hasta >= hoy` ANTES de calcular nada)
//       → fallan 8: "15 días exactos…", "16 días…", "pasada la posposición…", "una cuenta que ya
//         pagó antes…", "un período pagado en el futuro cuenta para cubiertoHasta" y las 3 de
//         `periodoAPerdonar` completas
//   - primer pago usa `hoy` en vez de `cobranzaDesde` como vencimiento
//       → falla "una cuenta que nunca pagó cuenta desde cobranza_desde"
//   - `cubiertoHasta` solo mira el primer período (como si un ciclo perdonado agregado después no
//     extendiera la cobertura)
//       → fallan 2: "un ciclo perdonado cubre igual que uno pagado, aunque venga después de uno
//         real" y "usa el más lejano de varios períodos pagados, no el primero de la lista"
//   - `periodoAPerdonar` arranca en `cubiertoHasta` sin sumarle un día
//       → fallan 2: "arranca el día siguiente al último período pagado" y "usa el más lejano de
//         varios períodos pagados, no el primero de la lista"

const entradaBase = {
  cobranza: 'normal' as const,
  desde: '2026-01-01',
  pospuestaHasta: null,
  periodosPagados: [] as { desde: string; hasta: string }[],
};

describe('estadoDeCobranza', () => {
  it('al día: dentro del período pagado', () => {
    const pagado = { desde: '2026-08-01', hasta: '2026-08-30' };
    expect(
      estadoDeCobranza({ ...entradaBase, periodosPagados: [pagado], hoy: '2026-08-15' }),
    ).toEqual({ tipo: 'al_dia', hasta: '2026-08-30', diasRestantes: 16 });
  });

  it('al día: el último día del período pagado todavía es al_dia', () => {
    const pagado = { desde: '2026-08-01', hasta: '2026-08-30' };
    expect(
      estadoDeCobranza({ ...entradaBase, periodosPagados: [pagado], hoy: '2026-08-30' }),
    ).toEqual({ tipo: 'al_dia', hasta: '2026-08-30', diasRestantes: 1 });
  });

  it('vencida día 1: un día después de cubiertoHasta', () => {
    const pagado = { desde: '2026-08-01', hasta: '2026-08-30' };
    expect(
      estadoDeCobranza({ ...entradaBase, periodosPagados: [pagado], hoy: '2026-08-31' }),
    ).toEqual({ tipo: 'vencida', diasVencida: 1, diasParaBloqueo: 14, esPrimerPago: false });
  });

  it('15 días exactos: vencida, no bloqueada', () => {
    const pagado = { desde: '2026-08-01', hasta: '2026-08-30' };
    expect(
      estadoDeCobranza({ ...entradaBase, periodosPagados: [pagado], hoy: '2026-09-14' }),
    ).toEqual({ tipo: 'vencida', diasVencida: 15, diasParaBloqueo: 0, esPrimerPago: false });
    expect(DIAS_GRACIA_COBRANZA).toBe(15);
  });

  it('16 días: bloqueada', () => {
    const pagado = { desde: '2026-08-01', hasta: '2026-08-30' };
    expect(
      estadoDeCobranza({ ...entradaBase, periodosPagados: [pagado], hoy: '2026-09-15' }),
    ).toEqual({ tipo: 'bloqueada', diasVencida: 16 });
  });

  it('exenta con fechas vencidas igual da exenta', () => {
    expect(
      estadoDeCobranza({
        ...entradaBase,
        cobranza: 'exenta',
        desde: '2020-01-01',
        periodosPagados: [],
        hoy: '2026-09-21',
      }),
    ).toEqual({ tipo: 'exenta' });
  });

  it('pospuesta: antes de la fecha no bloquea', () => {
    const pagado = { desde: '2026-01-01', hasta: '2026-01-31' }; // muy vencido sin la posposición
    expect(
      estadoDeCobranza({
        ...entradaBase,
        pospuestaHasta: '2026-09-30',
        periodosPagados: [pagado],
        hoy: '2026-09-15',
      }),
    ).toEqual({ tipo: 'pospuesta', hasta: '2026-09-30' });
  });

  it('el último día de la posposición todavía no bloquea', () => {
    const pagado = { desde: '2026-01-01', hasta: '2026-01-31' };
    expect(
      estadoDeCobranza({
        ...entradaBase,
        pospuestaHasta: '2026-09-30',
        periodosPagados: [pagado],
        hoy: '2026-09-30',
      }),
    ).toEqual({ tipo: 'pospuesta', hasta: '2026-09-30' });
  });

  it('pasada la posposición vuelve la regla normal: si ya pasaron más de 15 días desde el vencimiento, bloquea', () => {
    const pagado = { desde: '2026-01-01', hasta: '2026-06-01' };
    expect(
      estadoDeCobranza({
        ...entradaBase,
        pospuestaHasta: '2026-06-20',
        periodosPagados: [pagado],
        hoy: '2026-06-21',
      }),
    ).toEqual({ tipo: 'bloqueada', diasVencida: 20 });
  });

  it('una cuenta que nunca pagó cuenta desde cobranza_desde', () => {
    expect(
      estadoDeCobranza({ ...entradaBase, desde: '2026-09-01', periodosPagados: [], hoy: '2026-09-05' }),
    ).toEqual({ tipo: 'vencida', diasVencida: 4, diasParaBloqueo: 11, esPrimerPago: true });
  });

  it('una cuenta que ya pagó antes cuenta desde el último período, no desde cobranza_desde', () => {
    const pagado = { desde: '2026-01-01', hasta: '2026-01-31' };
    // cobranza_desde queda muy atrás (creación original); si el vencimiento se tomara de ahí,
    // esto ya estaría bloqueada por miles de días en vez de vencida por unos pocos.
    expect(
      estadoDeCobranza({ ...entradaBase, desde: '2020-01-01', periodosPagados: [pagado], hoy: '2026-02-05' }),
    ).toEqual({ tipo: 'vencida', diasVencida: 5, diasParaBloqueo: 10, esPrimerPago: false });
  });

  it('un ciclo perdonado cubre igual que uno pagado, aunque venga después de uno real', () => {
    // El tipo PeriodoPagado no distingue "perdonado" ($0) de "pagado": desde esta función pura, un
    // ciclo perdonado es un período más. Si cubiertoHasta se calculara solo con el primer período
    // (o filtrara alguno), este caso lo detecta: el perdonado (agosto) es el que cubre hoy.
    const pagadoReal = { desde: '2026-07-01', hasta: '2026-07-31' };
    const perdonado = { desde: '2026-08-01', hasta: '2026-08-30' };
    expect(
      estadoDeCobranza({
        ...entradaBase,
        periodosPagados: [pagadoReal, perdonado],
        hoy: '2026-08-15',
      }),
    ).toEqual({ tipo: 'al_dia', hasta: '2026-08-30', diasRestantes: 16 });
  });

  it('un período pagado en el futuro cuenta para cubiertoHasta', () => {
    const futuro = { desde: '2026-10-01', hasta: '2026-10-31' };
    expect(
      estadoDeCobranza({ ...entradaBase, periodosPagados: [futuro], hoy: '2026-09-15' }),
    ).toEqual({ tipo: 'al_dia', hasta: '2026-10-31', diasRestantes: 47 });
  });
});

describe('periodoAPerdonar', () => {
  it('nunca pagó: arranca en cobranza_desde', () => {
    expect(
      periodoAPerdonar({ periodosPagados: [], cobranzaDesde: '2026-08-01', hoy: '2026-09-10' }),
    ).toEqual({ desde: '2026-08-01', hasta: '2026-08-31' });
  });

  it('arranca el día siguiente al último período pagado', () => {
    const pagado = { desde: '2026-07-01', hasta: '2026-07-31' };
    expect(
      periodoAPerdonar({ periodosPagados: [pagado], cobranzaDesde: '2020-01-01', hoy: '2026-09-10' }),
    ).toEqual({ desde: '2026-08-01', hasta: '2026-08-31' });
  });

  it('usa el más lejano de varios períodos pagados, no el primero de la lista', () => {
    const primero = { desde: '2026-06-01', hasta: '2026-06-30' };
    const masLejano = { desde: '2026-07-01', hasta: '2026-07-31' };
    expect(
      periodoAPerdonar({ periodosPagados: [primero, masLejano], cobranzaDesde: '2020-01-01', hoy: '2026-09-10' }),
    ).toEqual({ desde: '2026-08-01', hasta: '2026-08-31' });
  });
});

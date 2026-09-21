import { describe, it, expect } from 'vitest';
import {
  DIAS_MAXIMOS_PERIODO_MENSUAL,
  DIAS_VENTANA_RENOVACION,
  aCentavos,
  calcularAjuste,
  diasInclusive,
  estadoDelPeriodo,
  hastaDelPeriodo,
  periodoNuevo,
} from './prorrateo';

// Pruebas PURAS: sin base de datos, sin reloj. Se corren con TZ=UTC y con TZ=America/El_Salvador
// (la aritmética usa Date.UTC a propósito; ver la cabecera de prorrateo.ts).
//
// MUTATION-TESTING (cada fila se corrió: romper, ver fallar con ESE test, restaurar):
//   - no contar hoy en `diasRestantes`          → fallan los ejemplos de $10.67, $21.33, el primer y el último día
//   - 30 fijo en vez de los días reales         → fallan "usa los días REALES" y "la mitad exacta"
//   - truncar en vez de redondear               → fallan el ejemplo de $10.67, "el último día" y "la mitad exacta"
//   - `aCentavos` sin redondear (trunc)         → fallan "opera en centavos" y "no se desvía con precios de centavos"
//   - quitar el chequeo `diferencia <= 0`       → falla "un precio negociado igual o mayor al del destino"
//   - ventana de 30 días                        → fallan "a mitad de período" y "la ventana son los últimos 7 días"
//   - `cubiertoHasta` = el del período actual   → falla "ya renovado"
//   - sumar 30 días en vez de un mes calendario → fallan las 6 filas de fin de mes (31 de enero, bisiesto…)

const SEPTIEMBRE = { periodoDesde: '2026-09-01', periodoHasta: '2026-09-30' };

describe('diasInclusive', () => {
  it('cuenta los dos extremos', () => {
    expect(diasInclusive('2026-09-15', '2026-09-30')).toBe(16);
    expect(diasInclusive('2026-09-01', '2026-09-30')).toBe(30);
    expect(diasInclusive('2026-09-30', '2026-09-30')).toBe(1);
  });

  it('cruza fin de mes y de año', () => {
    expect(diasInclusive('2026-12-30', '2027-01-02')).toBe(4);
    expect(diasInclusive('2028-02-28', '2028-03-01')).toBe(3); // 2028 es bisiesto: existe el 29
    expect(diasInclusive('2027-02-28', '2027-03-01')).toBe(2);
  });
});

describe('hastaDelPeriodo', () => {
  it.each([
    ['2026-09-01', '2026-09-30'],
    ['2026-09-15', '2026-10-14'],
    ['2026-12-15', '2027-01-14'],
    ['2026-12-31', '2027-01-30'],
    ['2027-01-31', '2027-02-27'], // febrero no tiene 31: se usa el 28 y se resta un día
    ['2028-01-31', '2028-02-28'], // año bisiesto: febrero tiene 29
    ['2026-01-30', '2026-02-27'],
    ['2026-01-29', '2026-02-27'],
    ['2026-08-31', '2026-09-29'], // septiembre tiene 30
    ['2026-02-28', '2026-03-27'],
  ])('un período que arranca el %s termina el %s', (desde, hasta) => {
    expect(hastaDelPeriodo(desde)).toBe(hasta);
  });
});

describe('calcularAjuste', () => {
  const ajuste = (precioActual: number, precioNuevo: number, hoy: string, extra = SEPTIEMBRE) =>
    calcularAjuste({ precioActual, precioNuevo, hoy, ...extra });

  it('Starter → Growth el 15 de septiembre: 20 × 16 ÷ 30 = $10.67', () => {
    expect(ajuste(29, 49, '2026-09-15')).toEqual({ ok: true, monto: 10.67, centavos: 1067, diasRestantes: 16, diasPeriodo: 30 });
  });

  it('Growth → Pro y Starter → Pro', () => {
    expect(ajuste(49, 89, '2026-09-15')).toMatchObject({ ok: true, monto: 21.33 });
    expect(ajuste(29, 89, '2026-09-15')).toMatchObject({ ok: true, monto: 32 });
  });

  it('el mismo día que arrancó el período cobra la diferencia entera', () => {
    expect(ajuste(29, 49, '2026-09-01')).toMatchObject({ ok: true, monto: 20, diasRestantes: 30 });
  });

  it('el último día cobra un solo día', () => {
    expect(ajuste(29, 49, '2026-09-30')).toMatchObject({ ok: true, monto: 0.67, diasRestantes: 1 });
  });

  it('usa los días REALES del período: uno de 31 y uno de 28', () => {
    const de31 = { periodoDesde: '2026-10-01', periodoHasta: '2026-10-31' };
    expect(ajuste(29, 49, '2026-10-16', de31)).toMatchObject({ ok: true, diasPeriodo: 31, diasRestantes: 16, monto: 10.32 });
    const de28 = { periodoDesde: '2027-02-01', periodoHasta: '2027-02-28' };
    expect(ajuste(29, 49, '2027-02-15', de28)).toMatchObject({ ok: true, diasPeriodo: 28, diasRestantes: 14, monto: 10 });
  });

  it('la mitad exacta sube al centavo siguiente, con un precio con centavos', () => {
    // (0.50 de diferencia = 50 centavos) × 1 día ÷ 4 días = 12.5 centavos → 13. Con truncado daría 12.
    const de4 = { periodoDesde: '2026-09-27', periodoHasta: '2026-09-30' };
    expect(ajuste(10, 10.5, '2026-09-30', de4)).toMatchObject({ ok: true, centavos: 13, monto: 0.13 });
  });

  it('opera en centavos: un precio negociado con centavos no se desvía de a uno', () => {
    // 19.99 → 49: diferencia 2901 centavos. × 16 ÷ 30 = 1547.2 → 1547.
    expect(ajuste(19.99, 49, '2026-09-15')).toMatchObject({ ok: true, centavos: 1547, monto: 15.47 });
  });

  it('un precio negociado igual o mayor al del destino no tiene diferencia que cobrar', () => {
    expect(ajuste(49, 49, '2026-09-15')).toEqual({ ok: false, motivo: 'sin_diferencia' });
    expect(ajuste(60, 49, '2026-09-15')).toEqual({ ok: false, motivo: 'sin_diferencia' });
  });

  it('un mes regalado (precio actual en $0) cobra el precio nuevo prorrateado', () => {
    expect(ajuste(0, 49, '2026-09-15')).toMatchObject({ ok: true, monto: 26.13 });
  });

  it('fuera del período no hay ajuste', () => {
    expect(ajuste(29, 49, '2026-08-31')).toEqual({ ok: false, motivo: 'fuera_de_periodo' });
    expect(ajuste(29, 49, '2026-10-01')).toEqual({ ok: false, motivo: 'fuera_de_periodo' });
  });

  it('un período de más de 31 días no se prorratea', () => {
    const tresMeses = { periodoDesde: '2026-07-01', periodoHasta: '2026-09-30' };
    expect(ajuste(29, 49, '2026-09-15', tresMeses)).toEqual({ ok: false, motivo: 'no_mensual' });
    expect(DIAS_MAXIMOS_PERIODO_MENSUAL).toBe(31);
  });

  it('una diferencia que redondea a menos de un centavo no se ofrece', () => {
    expect(ajuste(10, 10.01, '2026-09-30')).toEqual({ ok: false, motivo: 'muy_chico' });
  });
});

describe('estadoDelPeriodo', () => {
  const sep = { desde: '2026-09-01', hasta: '2026-09-30' };
  const oct = { desde: '2026-10-01', hasta: '2026-10-31' };

  it('sin períodos pagados, o todos vencidos, no hay período', () => {
    expect(estadoDelPeriodo([], '2026-09-15')).toEqual({ tipo: 'sin_periodo' });
    expect(estadoDelPeriodo([sep], '2026-10-01')).toEqual({ tipo: 'sin_periodo' });
  });

  it('a mitad de período', () => {
    expect(estadoDelPeriodo([sep], '2026-09-15')).toMatchObject({
      tipo: 'en_curso', fase: 'mitad', diasRestantes: 16, diasPeriodo: 30, cubiertoHasta: '2026-09-30',
    });
  });

  it('la ventana son los últimos 7 días: con 8 restantes es mitad, con 7 es ventana', () => {
    expect(DIAS_VENTANA_RENOVACION).toBe(7);
    expect(estadoDelPeriodo([sep], '2026-09-23')).toMatchObject({ fase: 'mitad', diasRestantes: 8 });
    expect(estadoDelPeriodo([sep], '2026-09-24')).toMatchObject({ fase: 'ventana', diasRestantes: 7 });
    expect(estadoDelPeriodo([sep], '2026-09-30')).toMatchObject({ fase: 'ventana', diasRestantes: 1 });
  });

  it('ya renovado: lo cubierto llega más allá del período en curso', () => {
    expect(estadoDelPeriodo([sep, oct], '2026-09-26')).toMatchObject({
      tipo: 'en_curso', fase: 'ya_renovado', cubiertoHasta: '2026-10-31', hasta: '2026-09-30',
    });
  });

  it('con dos períodos que contienen hoy, el actual es el que termina más lejos', () => {
    const solapado = { desde: '2026-09-10', hasta: '2026-10-09' };
    expect(estadoDelPeriodo([sep, solapado], '2026-09-15')).toMatchObject({ hasta: '2026-10-09', cubiertoHasta: '2026-10-09' });
  });

  it('un período pagado que todavía no empezó, sin ninguno vigente, es "futuro"', () => {
    expect(estadoDelPeriodo([oct], '2026-09-15')).toEqual({ tipo: 'futuro', desde: '2026-10-01' });
  });

  it('un período de más de 31 días a mitad de camino es "no mensual", pero en la ventana se puede renovar', () => {
    const trimestre = { desde: '2026-07-01', hasta: '2026-09-30' };
    expect(estadoDelPeriodo([trimestre], '2026-08-15')).toMatchObject({ fase: 'no_mensual', diasPeriodo: 92 });
    expect(estadoDelPeriodo([trimestre], '2026-09-26')).toMatchObject({ fase: 'ventana' });
  });
});

describe('periodoNuevo', () => {
  it('sin nada cubierto arranca hoy', () => {
    expect(periodoNuevo(null, '2026-09-15')).toEqual({ desde: '2026-09-15', hasta: '2026-10-14' });
  });

  it('si lo cubierto ya venció arranca hoy, nunca en el pasado', () => {
    expect(periodoNuevo('2026-08-31', '2026-09-15')).toEqual({ desde: '2026-09-15', hasta: '2026-10-14' });
  });

  it('si lo cubierto no venció arranca el día siguiente, sin pisar fechas pagadas', () => {
    expect(periodoNuevo('2026-09-30', '2026-09-26')).toEqual({ desde: '2026-10-01', hasta: '2026-10-31' });
    expect(periodoNuevo('2026-09-30', '2026-09-30')).toEqual({ desde: '2026-10-01', hasta: '2026-10-31' });
  });

  it('el 31 de enero abre un período que termina el 27 de febrero', () => {
    expect(periodoNuevo('2027-01-30', '2027-01-28')).toEqual({ desde: '2027-01-31', hasta: '2027-02-27' });
  });
});

describe('aCentavos', () => {
  it('no se desvía con precios de centavos', () => {
    expect(aCentavos(10.67)).toBe(1067);
    expect(aCentavos(19.99)).toBe(1999);
    expect(aCentavos(0.1 + 0.2)).toBe(30);
  });
});

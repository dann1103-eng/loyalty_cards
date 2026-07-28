import { describe, it, expect } from 'vitest';
import {
  TIPOS,
  buscarTipo,
  tipoOPuntos,
  formatearCentavos,
  centavosDesdeTexto,
  describirSaldo,
  sigueVigente,
  nivelParaAcumulado,
} from './tipos';

// Módulo puro. Lo que se prueba acá es lo que, si falla, le muestra plata equivocada a un cliente.

const HOY = '2026-07-28';

describe('catálogo', () => {
  it('tiene los ocho tipos que acepta el CHECK de la BD', () => {
    // Si acá falta uno, el panel de FM lo ofrece y la BD lo rechaza (o al revés, queda un tipo
    // guardado que ninguna pantalla sabe dibujar).
    expect(TIPOS.map((t) => t.valor).sort()).toEqual(
      ['cashback', 'cupon', 'descuento', 'gift_card', 'membresia', 'multipass', 'puntos', 'sellos'].sort(),
    );
  });

  it('marca como "requiere monto" exactamente a los que no funcionan sin él', () => {
    // cashback calcula un porcentaje de la compra, gift card descuenta del saldo lo que se gastó, y
    // descuento acumula gasto. Los tres son inservibles sin el monto.
    const conMonto = TIPOS.filter((t) => t.requiereMonto).map((t) => t.valor).sort();
    expect(conMonto).toEqual(['cashback', 'descuento', 'gift_card']);
  });

  it('un tipo desconocido degrada a puntos en vez de romper', () => {
    // Una fila vieja o un valor escrito a mano no debe dejar a un cliente sin poder ver su tarjeta.
    expect(buscarTipo('lo-que-sea')).toBeNull();
    expect(tipoOPuntos('lo-que-sea').valor).toBe('puntos');
  });
});

describe('formatearCentavos', () => {
  it('escribe siempre dos decimales', () => {
    expect(formatearCentavos(1250)).toBe('$12.50');
    expect(formatearCentavos(5)).toBe('$0.05');
    expect(formatearCentavos(100)).toBe('$1.00');
    expect(formatearCentavos(0)).toBe('$0.00');
  });

  it('no se come el cero de los centavos redondos', () => {
    // El bug clásico de dividir por 100 y confiar en toString: 1200/100 = 12 → "$12" en vez de
    // "$12.00", que en un saldo se lee como una cifra distinta.
    expect(formatearCentavos(1200)).toBe('$12.00');
    expect(formatearCentavos(1205)).toBe('$12.05');
  });

  it('maneja negativos, que aparecen al corregir de más', () => {
    expect(formatearCentavos(-350)).toBe('-$3.50');
  });
});

describe('centavosDesdeTexto', () => {
  it('convierte sin pasar por punto flotante', () => {
    // Number('19.99') * 100 da 1998.9999999999998. Acá se multiplica sobre el string partido, así
    // que no hay redondeo que salga mal.
    expect(centavosDesdeTexto('19.99')).toBe(1999);
    expect(centavosDesdeTexto('12.50')).toBe(1250);
    expect(centavosDesdeTexto('0.07')).toBe(7);
    expect(centavosDesdeTexto('100')).toBe(10000);
  });

  it('acepta lo que la gente teclea de verdad', () => {
    expect(centavosDesdeTexto(' $12.50 ')).toBe(1250);
    expect(centavosDesdeTexto('12,50')).toBe(1250);
    expect(centavosDesdeTexto('12.5')).toBe(1250);
  });

  it('devuelve null en vez de NaN ante basura', () => {
    // Un NaN acá termina guardado como saldo. null obliga al caller a decidir.
    for (const valor of ['', 'abc', '12.345', '-5', '1.2.3']) {
      expect(centavosDesdeTexto(valor), `"${valor}"`).toBeNull();
    }
  });
});

describe('sigueVigente', () => {
  it('el día del vencimiento TODAVÍA cuenta', () => {
    // Se compara como texto y no como Date a propósito: comparar instantes hace que un pase venza
    // a medianoche UTC, o sea a las 6 de la tarde del día ANTERIOR en El Salvador.
    expect(sigueVigente('2026-07-28', HOY)).toBe(true);
    expect(sigueVigente('2026-07-29', HOY)).toBe(true);
    expect(sigueVigente('2026-07-27', HOY)).toBe(false);
  });

  it('sin fecha no hay vigencia', () => {
    expect(sigueVigente(null, HOY)).toBe(false);
    expect(sigueVigente(undefined, HOY)).toBe(false);
  });
});

describe('describirSaldo', () => {
  it('cashback y gift card se leen como PLATA, no como puntos', () => {
    // El riesgo central de reusar puntos_actuales como contador universal: el mismo 1250 es
    // "$12.50" o "1250 puntos" según el tipo. Si esto falla, un cliente ve un saldo falso.
    expect(describirSaldo({ tipo: 'cashback', contador: 1250 }, HOY)).toBe('$12.50 disponibles');
    expect(describirSaldo({ tipo: 'gift_card', contador: 1250 }, HOY)).toBe('$12.50 disponibles');
    expect(describirSaldo({ tipo: 'puntos', contador: 1250 }, HOY)).toBe('1250 puntos');
  });

  it('sellos con y sin meta', () => {
    expect(describirSaldo({ tipo: 'sellos', contador: 3, selloMeta: 10 }, HOY)).toBe('3 de 10 sellos');
    expect(describirSaldo({ tipo: 'sellos', contador: 3, selloMeta: null }, HOY)).toBe('3 sellos');
  });

  it('multipass cuenta visitas y concuerda en singular', () => {
    expect(describirSaldo({ tipo: 'multipass', contador: 4 }, HOY)).toBe('4 visitas disponibles');
    expect(describirSaldo({ tipo: 'multipass', contador: 1 }, HOY)).toBe('1 visita disponible');
    expect(describirSaldo({ tipo: 'multipass', contador: 0 }, HOY)).toBe('0 visitas disponibles');
  });

  it('puntos concuerda en singular', () => {
    expect(describirSaldo({ tipo: 'puntos', contador: 1 }, HOY)).toBe('1 punto');
  });

  it('cupón distingue disponible, usado y vencido', () => {
    const base = { tipo: 'cupon', contador: 0, vigenciaHasta: '2026-07-30' };
    expect(describirSaldo(base, HOY)).toBe('Disponible hasta el 30 de julio de 2026');
    // Usado gana sobre vigente: da igual que le quedaran días.
    expect(describirSaldo({ ...base, usadoEn: '2026-07-20T10:00:00Z' }, HOY)).toBe('Ya usado');
    expect(describirSaldo({ ...base, vigenciaHasta: '2026-07-01' }, HOY)).toBe('Venció el 1 de julio de 2026');
  });

  it('membresía distingue activa, vencida y sin activar', () => {
    expect(describirSaldo({ tipo: 'membresia', contador: 0, vigenciaHasta: '2026-08-30' }, HOY))
      .toBe('Activa hasta el 30 de agosto de 2026');
    expect(describirSaldo({ tipo: 'membresia', contador: 0, vigenciaHasta: '2026-07-01' }, HOY))
      .toBe('Vencida el 1 de julio de 2026');
    expect(describirSaldo({ tipo: 'membresia', contador: 0, vigenciaHasta: null }, HOY))
      .toBe('Sin activar');
  });

  it('descuento muestra el nivel, no el contador', () => {
    expect(describirSaldo({ tipo: 'descuento', contador: 0, porcentajeDescuento: 15 }, HOY))
      .toBe('15% de descuento');
    expect(describirSaldo({ tipo: 'descuento', contador: 0, porcentajeDescuento: null }, HOY))
      .toBe('Sin descuento todavía');
  });
});

describe('nivelParaAcumulado', () => {
  const niveles = [
    { desdeCentavos: 10000, porcentaje: 5 },
    { desdeCentavos: 30000, porcentaje: 10 },
    { desdeCentavos: 50000, porcentaje: 15 },
  ];

  it('gana el umbral MÁS ALTO ya superado', () => {
    // Con "el primero que coincide" el cliente se quedaría para siempre en 5%.
    expect(nivelParaAcumulado(60000, niveles)).toBe(15);
    expect(nivelParaAcumulado(35000, niveles)).toBe(10);
    expect(nivelParaAcumulado(12000, niveles)).toBe(5);
  });

  it('el umbral exacto YA cuenta', () => {
    // Con `>` en vez de `>=`, un cliente que gastó exactamente $100 no vería su 5%.
    expect(nivelParaAcumulado(10000, niveles)).toBe(5);
  });

  it('sin llegar al primer umbral no hay nivel', () => {
    expect(nivelParaAcumulado(9999, niveles)).toBeNull();
    expect(nivelParaAcumulado(0, niveles)).toBeNull();
  });

  it('sin niveles configurados no hay nivel', () => {
    expect(nivelParaAcumulado(999999, [])).toBeNull();
  });

  it('no depende del orden en que vengan los niveles', () => {
    const desordenados = [niveles[2], niveles[0], niveles[1]];
    expect(nivelParaAcumulado(60000, desordenados)).toBe(15);
  });
});

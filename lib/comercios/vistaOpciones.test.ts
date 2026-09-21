import { describe, expect, it } from 'vitest';
import { calcularOpcionesPago, type CuentaParaPagos } from './opcionesPago';
import { describirOpciones, dinero } from './vistaOpciones';

// Que el texto diga lo mismo que las opciones: el importe que se lee es el que cobra el servidor.
//
// MUTATION-TESTING (cada fila se corrió):
//   - mostrar el monto del plan y no el del ajuste     → falla "pagás solo la diferencia, con la cuenta hecha y el precio desde el próximo período"
//   - no avisar que se reinicia el precio pactado      → falla "avisa cuando cambiar de plan reinicia un precio negociado"
//   - no mostrar el porqué cuando no hay opciones      → falla "ya renovado: no hay botones y sí un aviso, con el próximo pago"
//   - formatear siempre con centavos                   → fallan "enteros sin centavos, el resto con dos" y los dos textos con importes enteros
//   - preguntar "¿Necesitás más lugar?" aunque no haya opciones → falla "a mitad de período sin opciones no promete un cobro"

const cuenta = (extra: Partial<CuentaParaPagos> = {}): CuentaParaPagos => ({
  plan: 'starter',
  precioActual: 29,
  limite: 1,
  unidadesUsadas: 1,
  periodosPagados: [{ desde: '2026-09-01', hasta: '2026-09-30' }],
  ...extra,
});

const vista = (c: CuentaParaPagos, hoy: string) => describirOpciones(calcularOpcionesPago(c, hoy), c.plan);

describe('dinero', () => {
  it('enteros sin centavos, el resto con dos', () => {
    expect(dinero(49)).toBe('$49');
    expect(dinero(10.67)).toBe('$10.67');
    expect(dinero(32)).toBe('$32');
    expect(dinero(0.5)).toBe('$0.50');
  });
});

describe('a mitad de período', () => {
  it('pagás solo la diferencia, con la cuenta hecha y el precio desde el próximo período', () => {
    const v = vista(cuenta(), '2026-09-15');

    expect(v.titulo).toBe('¿Necesitás más lugar?');
    expect(v.opciones.map((o) => [o.clave, o.titulo, o.importe])).toEqual([
      ['cambiar:growth', 'Pasar a Growth', '$10.67'],
      ['cambiar:pro', 'Pasar a Pro', '$32'],
    ]);
    expect(v.opciones[0].detalle).toBe(
      'Diferencia por los días que faltan (Starter → Growth, 16 de 30 días). Desde el 1 de octubre de 2026, $49/mes.',
    );
    expect(v.proximoPago).toBe('Tu próximo pago es el 1 de octubre de 2026.');
  });

  it('avisa cuando cambiar de plan reinicia un precio negociado', () => {
    const v = vista(cuenta({ precioActual: 20 }), '2026-09-15');
    expect(v.opciones[0].detalle).toContain('Tu precio pactado pasa al del plan.');
  });
});

describe('en la ventana', () => {
  it('ofrece renovar con cada plan, con el mes completo y las fechas del nuevo período', () => {
    const v = vista(cuenta(), '2026-09-26');

    expect(v.titulo).toBe('Renová tu plan');
    expect(v.explicacion).toContain('Tu período termina el 30 de septiembre de 2026');
    expect(v.opciones.map((o) => [o.titulo, o.importe])).toEqual([
      ['Renovar con Starter', '$29'],
      ['Renovar con Growth', '$49'],
      ['Renovar con Pro', '$89'],
    ]);
    expect(v.opciones[0].detalle).toBe('Del 1 de octubre de 2026 al 31 de octubre de 2026.');
  });

  it('una opción bloqueada por cupo lleva su mensaje', () => {
    const v = vista(cuenta({ plan: 'growth', precioActual: 49, limite: 3, unidadesUsadas: 3 }), '2026-09-26');
    expect(v.opciones.find((o) => o.plan === 'starter')?.bloqueadaPor).toContain('permite 1');
  });
});

describe('sin período', () => {
  it('una cuenta sin plan dice "Elegí tu plan" y ofrece los tres', () => {
    const v = vista(cuenta({ plan: null, precioActual: null, periodosPagados: [] }), '2026-09-15');
    expect(v.titulo).toBe('Elegí tu plan');
    expect(v.opciones.map((o) => o.titulo)).toEqual(['Elegir Starter', 'Elegir Growth', 'Elegir Pro']);
    expect(v.opciones[0].detalle).toBe('Un mes, del 15 de septiembre de 2026 al 14 de octubre de 2026.');
    expect(v.proximoPago).toBeNull();
  });

  it('una cuenta con plan cuyo período venció dice "Renová tu plan"', () => {
    expect(vista(cuenta(), '2026-10-05').titulo).toBe('Renová tu plan');
  });
});

describe('cuando no hay nada que ofrecer', () => {
  it('a mitad de período sin opciones no promete un cobro (plan más alto, o una solicitud oculta las de subir)', () => {
    const enElMasAlto = vista(cuenta({ plan: 'pro', precioActual: 89, limite: 10 }), '2026-09-15');
    expect(enElMasAlto.opciones).toEqual([]);
    expect(enElMasAlto.titulo).toBe('Tu plan');
    expect(enElMasAlto.explicacion).toBe('');

    // La página filtra las opciones de subir mientras hay una solicitud pendiente, ANTES de describirlas.
    const c = cuenta();
    const filtradas = { ...calcularOpcionesPago(c, '2026-09-15'), opciones: [] };
    expect(describirOpciones(filtradas, c.plan)).toMatchObject({ titulo: 'Tu plan', explicacion: '' });
  });

  it('ya renovado: no hay botones y sí un aviso, con el próximo pago', () => {
    const v = vista(cuenta({ periodosPagados: [{ desde: '2026-09-01', hasta: '2026-09-30' }, { desde: '2026-10-01', hasta: '2026-10-31' }] }), '2026-09-26');
    expect(v.opciones).toEqual([]);
    expect(v.aviso).toContain('Ya pagaste el próximo período');
    expect(v.proximoPago).toBe('Tu próximo pago es el 1 de noviembre de 2026.');
  });
});

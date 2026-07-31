import { describe, it, expect } from 'vitest';
import { contadorPase } from './contadorPase';

// Módulo PURO: qué número (y con qué etiqueta) ve el cliente en la cara de su pase.
//
// Existe por un bug real: hasta el 2026-07-30 generatePass dibujaba TODO lo que no fuera sellos
// como `label: 'PUNTOS', value: puntos_actuales`. Pero gift card y cashback guardan CENTAVOS en esa
// misma columna, así que una gift card de $25.00 le mostraba al cliente "PUNTOS 2500" — la unidad
// equivocada y con dos ceros de más.
describe('contadorPase', () => {
  it('gift card: centavos se ven como dólares, con etiqueta de saldo', () => {
    expect(contadorPase('gift_card', 2500, null)).toEqual({ etiqueta: 'SALDO', valor: '$25.00', numero: null });
  });

  it('cashback: mismo formato de dinero que la gift card', () => {
    expect(contadorPase('cashback', 750, null)).toEqual({ etiqueta: 'SALDO', valor: '$7.50', numero: null });
  });

  it('un saldo que no es múltiplo de 100 no pierde los centavos', () => {
    // 1999 centavos son $19.99, no $19.9 ni $20. Con una división flotante mal redondeada, este es
    // el caso que se rompe.
    expect(contadorPase('gift_card', 1999, null)).toEqual({ etiqueta: 'SALDO', valor: '$19.99', numero: null });
  });

  it('saldo en cero se ve como $0.00, no vacío', () => {
    expect(contadorPase('gift_card', 0, null)).toEqual({ etiqueta: 'SALDO', valor: '$0.00', numero: null });
  });

  it('prepago: son VISITAS, no puntos', () => {
    expect(contadorPase('prepago', 7, null)).toEqual({ etiqueta: 'VISITAS', valor: '7', numero: 7 });
  });

  it('puntos: sigue siendo el entero de siempre', () => {
    expect(contadorPase('puntos', 42, null)).toEqual({ etiqueta: 'PUNTOS', valor: '42', numero: 42 });
  });

  it('sellos con meta: "3 de 8"', () => {
    expect(contadorPase('sellos', 3, 8)).toEqual({ etiqueta: 'SELLOS', valor: '3 de 8', numero: null });
  });

  it('sellos SIN meta configurada: cae al entero pelado en vez de decir "3 de null"', () => {
    expect(contadorPase('sellos', 3, null)).toEqual({ etiqueta: 'SELLOS', valor: '3', numero: 3 });
  });

  it('cupón, membresía y descuento no tienen contador: devuelven null', () => {
    // Su estado es una fecha o un nivel, no un número en la cara del pase. Devolver 0 mostraría un
    // "PUNTOS 0" que no significa nada para el cliente.
    expect(contadorPase('cupon', 0, null)).toBeNull();
    expect(contadorPase('membresia', 0, null)).toBeNull();
    expect(contadorPase('descuento', 0, null)).toBeNull();
  });

  it('un tipo desconocido degrada a puntos, no revienta', () => {
    // Mismo criterio que tipoOPuntos: una fila con un tipo que este código no conoce todavía sigue
    // produciendo un pase válido.
    expect(contadorPase('tipo_del_futuro', 5, null)).toEqual({ etiqueta: 'PUNTOS', valor: '5', numero: 5 });
  });
});

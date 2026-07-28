import { describe, it, expect } from 'vitest';
import { normalizarTelefono } from './normalizarTelefono';

describe('normalizarTelefono', () => {
  it('agrega +503 a un número local de 8 dígitos', () => {
    expect(normalizarTelefono('77771234')).toBe('+50377771234');
  });

  it('quita espacios, guiones y paréntesis', () => {
    expect(normalizarTelefono('7777-1234')).toBe('+50377771234');
    expect(normalizarTelefono('7777 1234')).toBe('+50377771234');
    expect(normalizarTelefono('(7777) 1234')).toBe('+50377771234');
  });

  it('respeta un número que ya trae código de país', () => {
    expect(normalizarTelefono('+503 7777 1234')).toBe('+50377771234');
    expect(normalizarTelefono('50377771234')).toBe('+50377771234');
  });

  it('acepta otros códigos de país si vienen con +', () => {
    expect(normalizarTelefono('+1 555 123 4567')).toBe('+15551234567');
  });

  it('rechaza entradas sin suficientes dígitos', () => {
    expect(() => normalizarTelefono('1234')).toThrow();
    expect(() => normalizarTelefono('')).toThrow();
    expect(() => normalizarTelefono('abc')).toThrow();
  });

  it('rechaza un número sin + que no es ni local (8) ni 503 explícito (typo de 9 dígitos)', () => {
    expect(() => normalizarTelefono('777712345')).toThrow();
  });

  it('rechaza números que exceden el tope E.164 de 15 dígitos', () => {
    expect(() => normalizarTelefono('+' + '9'.repeat(20))).toThrow();
  });
});

describe('normalizarTelefono — multi-país', () => {
  it('usa el código del país elegido', () => {
    expect(normalizarTelefono('5555 1234', 'GT')).toBe('+50255551234');
    expect(normalizarTelefono('9999 1234', 'HN')).toBe('+50499991234');
    expect(normalizarTelefono('55 1234 5678', 'MX')).toBe('+525512345678');
  });

  it('sigue asumiendo El Salvador cuando no se pasa país', () => {
    // Es lo que preserva a los clientes ya registrados: TODOS son +503 y ninguna llamada vieja pasa
    // el segundo argumento. Cambiar este default reescribiría el significado de esos teléfonos.
    expect(normalizarTelefono('7777 1234')).toBe('+50377771234');
  });

  it('rechaza un largo que no corresponde al país elegido', () => {
    // La garantía original ("un typo de 9 dígitos NO debe convertirse silenciosamente en otro
    // número") es la razón de que paises.ts guarde los largos y no solo el código de marcado.
    // Guatemala usa 8 dígitos: nueve es un error de tecleo, no un número válido.
    expect(() => normalizarTelefono('55551234 9', 'GT')).toThrow(/Teléfono inválido/);
    // México usa 10: ocho dígitos serían un salvadoreño mal atribuido.
    expect(() => normalizarTelefono('7777 1234', 'MX')).toThrow(/Teléfono inválido/);
  });

  it('acepta países con más de un largo válido', () => {
    // Panamá admite 7 y 8. Con una sola longitud por país, la mitad de los panameños no podría
    // registrarse.
    expect(normalizarTelefono('6666 1234', 'PA')).toBe('+50766661234');
    expect(normalizarTelefono('666 1234', 'PA')).toBe('+5076661234');
  });

  it('acepta el número ya con su código de país adelante, sin el +', () => {
    expect(normalizarTelefono('50255551234', 'GT')).toBe('+50255551234');
    expect(normalizarTelefono('50377771234')).toBe('+50377771234');
  });

  it('un número con + manda sobre el país elegido', () => {
    // Si el cliente escribió su número completo, ése es el bueno aunque el select diga otra cosa.
    expect(normalizarTelefono('+50255551234', 'SV')).toBe('+50255551234');
  });

  it('un país desconocido se comporta como El Salvador en vez de romper', () => {
    // El valor viene de un <select>: si alguna vez llega uno viejo o manipulado, es mejor
    // comportarse como antes de esta feature que dejar al cliente sin poder registrarse.
    expect(normalizarTelefono('7777 1234', 'XX')).toBe('+50377771234');
  });

  it('distingue países que COMPARTEN código de marcado', () => {
    // EE.UU. y República Dominicana son los dos +1 y los dos de 10 dígitos: el resultado canónico
    // es el mismo a propósito, porque E.164 no los distingue. Lo que importa es que ninguno de los
    // dos falle por elegir el otro.
    expect(normalizarTelefono('305 123 4567', 'US')).toBe('+13051234567');
    expect(normalizarTelefono('809 123 4567', 'DO')).toBe('+18091234567');
  });
});

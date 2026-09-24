import { describe, it, expect } from 'vitest';
import { formatearTelefono } from './formatearTelefono';
import { PAISES } from './paises';

// El teléfono se GUARDA canónico (+50377771234, normalizarTelefono) y se MUESTRA partido, con los
// grupos del `ejemplo` de su país en paises.ts. Lo que no se puede partir con certeza sale tal cual:
// un número mal partido se lee como otro número.
//
// MUTATION-TESTING (corridas el 2026-09-24 con un script que aplica una por vez y restaura; 5 de 5
// caen):
// - Sin el chequeo de canónico (solo `startsWith('+')`): cae "lo que no es canónico…" con `expected
//   '+503 7777 -123' to be '+5037777-123'`.
// - Sin exigir un largo que el país acepta: cae "un largo que ningún país acepta…" con `expected '+503
//   123456789012' to be '+503123456789012'`.
// - Partir aunque el ejemplo no sume el largo: cae "un largo válido que el ejemplo no describe…" con
//   `expected '+507 1234 567' to be '+507 1234567'`. Ese largo sin el código aparte (`return
//   telefono`): la misma, con `expected '+5071234567' to be '+507 1234567'`.
// - Sin avanzar entre grupos: caen cuatro, "El Salvador…" con `expected '+503 7777 7777' to be '+503
//   7777 1234'`.

describe('formatearTelefono', () => {
  it('El Salvador: el código aparte y el número en dos grupos de cuatro, como el ejemplo "7777 1234"', () => {
    expect(formatearTelefono('+50377771234')).toBe('+503 7777 1234');
  });

  it('cada país con los grupos de SU ejemplo', () => {
    expect(formatearTelefono('+525512345678')).toBe('+52 55 1234 5678'); // México, "55 1234 5678"
    expect(formatearTelefono('+34612345678')).toBe('+34 612 34 56 78'); // España, "612 34 56 78"
    expect(formatearTelefono('+5016221234')).toBe('+501 622 1234'); // Belice, "622 1234"
  });

  it('el 1 lo comparten EE.UU. y República Dominicana: los dos parten igual', () => {
    expect(formatearTelefono('+13051234567')).toBe('+1 305 123 4567');
  });

  it('un largo válido que el ejemplo no describe: el código aparte y el número sin partir', () => {
    // Panamá acepta 7 y 8 dígitos; su ejemplo ("6666 1234") es de 8.
    expect(formatearTelefono('+5071234567')).toBe('+507 1234567');
    expect(formatearTelefono('+50766661234')).toBe('+507 6666 1234');
  });

  it('un largo que ningún país acepta sale tal cual (las pruebas siembran +503 con 12 dígitos)', () => {
    expect(formatearTelefono('+503123456789012')).toBe('+503123456789012');
  });

  it('un código que no está en la lista sale tal cual', () => {
    expect(formatearTelefono('+99912345678')).toBe('+99912345678');
  });

  it('ningún código de paises.ts es prefijo de otro (formatearTelefono lo supone al elegir el código)', () => {
    // Si un país nuevo rompiera esto, un mismo número podría leerse con dos códigos distintos y la
    // función partiría con el del primero que encuentre.
    const codigos = [...new Set(PAISES.map((p) => p.codigo))];
    const choques = codigos.flatMap((a) => codigos.filter((b) => a !== b && b.startsWith(a)).map((b) => `${a} → ${b}`));
    expect(choques).toEqual([]);
  });

  it('lo que no es canónico sale tal cual', () => {
    expect(formatearTelefono('+503 7777 1234')).toBe('+503 7777 1234');
    expect(formatearTelefono('77771234')).toBe('77771234');
    expect(formatearTelefono('+000-test-1')).toBe('+000-test-1');
    expect(formatearTelefono('')).toBe('');
    // Con el largo de un número salvadoreño si se cuenta el guion: partirlo daría "+503 7777 -123".
    expect(formatearTelefono('+5037777-123')).toBe('+5037777-123');
  });
});

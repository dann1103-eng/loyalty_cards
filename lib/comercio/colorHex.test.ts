import { describe, expect, it } from 'vitest';
import { hexDesdeRgb, rgbDesdeTexto } from './colorHex';

// Estas dos funciones son el traductor entre el formato que guarda la BD ("rgb(r, g, b)", el único
// que aceptan validarColorRgb/guardarBranding) y el que habla el `<input type="color">` nativo
// ("#rrggbb"). Sin ellas, un `<input type="color" value="rgb(59, 42, 30)">` es un valor INVÁLIDO
// para el DOM: el navegador lo normaliza a #000000 en silencio, y ese negro es lo que se manda al
// guardar. El dueño abre el editor, toca "guardar" sin mover un color, y su marca queda negra.

describe('hexDesdeRgb', () => {
  it('convierte rgb() al hex que entiende el selector nativo', () => {
    expect(hexDesdeRgb('rgb(59, 42, 30)')).toBe('#3b2a1e');
  });

  it('rellena con cero los componentes de un solo dígito', () => {
    // Sin el padStart, esto daría '#123' — un color completamente distinto (y válido para el DOM,
    // que lo leería como #112233), así que el bug sería invisible salvo por el color equivocado.
    expect(hexDesdeRgb('rgb(1, 2, 3)')).toBe('#010203');
  });

  it('recorta los componentes fuera de rango en vez de emitir un hex deforme', () => {
    // Un 300 sin recortar da '12c', y el resultado ('#12c0000') tiene 7 dígitos: el `<input
    // type="color">` lo descarta entero y vuelve a #000000.
    expect(hexDesdeRgb('rgb(300, 0, 0)')).toBe('#ff0000');
  });

  it('acepta espacios de más y mayúsculas', () => {
    expect(hexDesdeRgb('RGB(  10,20 ,  30 )')).toBe('#0a141e');
  });

  it('deja pasar un hex que ya venía en hex', () => {
    expect(hexDesdeRgb('  #A1B2C3  ')).toBe('#A1B2C3');
  });

  it('ante un valor que no es un color, devuelve el gris del sistema', () => {
    // El selector nativo necesita SIEMPRE un #rrggbb válido; devolver la basura tal cual lo dejaría
    // en #000000 y el dueño creería que su color de marca es negro.
    expect(hexDesdeRgb('azul marino')).toBe('#131315');
    expect(hexDesdeRgb('')).toBe('#131315');
  });
});

describe('rgbDesdeTexto', () => {
  it('devuelve tal cual lo que ya está en el formato de la BD', () => {
    expect(rgbDesdeTexto('rgb(59, 42, 30)')).toBe('rgb(59, 42, 30)');
  });

  it('traduce el hex del selector nativo al formato de la BD', () => {
    // Lo que manda un `<input type="color">` al cambiarlo. Sin esta traducción se guardaría
    // '#3b2a1e' en una columna donde el resto del sistema espera rgb(...).
    expect(rgbDesdeTexto('#3b2a1e')).toBe('rgb(59, 42, 30)');
  });

  it('acepta el hex sin almohadilla', () => {
    expect(rgbDesdeTexto('3b2a1e')).toBe('rgb(59, 42, 30)');
  });

  it('devuelve null ante algo que no es un color', () => {
    // null es "todavía no es un color" (el dueño está escribiendo), no un color negro: quien llama
    // usa ese null para quedarse con el valor anterior.
    expect(rgbDesdeTexto('rgb(1, 2)')).toBeNull();
    expect(rgbDesdeTexto('#abc')).toBeNull();
    expect(rgbDesdeTexto('')).toBeNull();
  });
});
